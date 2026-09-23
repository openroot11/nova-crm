const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const PDFDocument = require('pdfkit');
const productionPdf = require('../productionPdf');
const { db, getSetting } = require('../db');
const { broadcast } = require('../realtime');
const nativeQuotes = require('../nativeQuotes');
const velaraServices = require('../velaraServices');
const P = require('../production');

// API del módulo Producción (ver server/production.js para la lógica y las
// reglas). Producción NO toca inventario: los materiales son requerimientos
// y solicitudes (bandeja para el futuro módulo de Inventario).
const router = express.Router();

const UPLOAD_ROOT = path.join(__dirname, '..', 'data', 'uploads');
const MAX_FILE_MB = 20;
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = path.join(UPLOAD_ROOT, 'op', String(Number(req.params.id) || 0));
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      const safe = file.originalname.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w.-]+/g, '_').slice(-80);
      cb(null, `${Date.now()}-${crypto.randomBytes(3).toString('hex')}-${safe}`);
    },
  }),
  limits: { fileSize: MAX_FILE_MB * 1024 * 1024 },
});

// Errores con status propio -- el manejador global de index.js responde 500.
function fail(res, err) {
  if (err && err.status) return res.status(err.status).json({ error: err.message });
  throw err;
}
const managerOnly = (req, res, next) =>
  P.isManager(req.user) ? next() : res.status(403).json({ error: 'Solo producción, coordinación o administración pueden hacer esto' });
const changed = (id, reason) => broadcast('production_changed', { id, reason });

function cleanDate(value) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const s = String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined;
}
// Texto limpio o null. Un campo que no vino también es null (SQLite no
// acepta undefined); los PATCH ya revisan "b.campo !== undefined" antes de
// llamar esto, así que "no vino" no pisa el valor guardado.
const text = (v) => (v === undefined || v === null ? null : String(v).trim() || null);

async function loadOp(req, res) {
  const op = await db.prepare('SELECT * FROM production_orders WHERE id = ?').get(Number(req.params.id));
  if (!op) {
    res.status(404).json({ error: 'Orden de producción no encontrada' });
    return null;
  }
  if (!(await P.canSeeOp(req.user, op))) {
    res.status(403).json({ error: 'No tienes permiso sobre esta orden' });
    return null;
  }
  return op;
}

// ---- datos de referencia -------------------------------------------------------

router.get('/meta', async (req, res) => {
  const workers = await db.prepare('SELECT id, name, specialty FROM workers WHERE active = 1 ORDER BY name').all();
  const advisors = await db.prepare('SELECT id, name FROM advisors WHERE active = 1 AND COALESCE(is_group, 0) = 0 ORDER BY name').all();
  res.json({
    statuses: P.STATUSES.map((s) => ({ key: s, label: P.STATUS_LABEL[s] })),
    transitions: P.TRANSITIONS,
    block_reasons: Object.entries(P.BLOCK_REASONS).map(([key, label]) => ({ key, label })),
    priorities: P.PRIORITIES,
    default_tasks: P.DEFAULT_TASKS,
    services: velaraServices.SERVICES.map((s) => ({ slug: s.slug, title: s.title })),
    workers,
    advisors,
    can_manage: P.isManager(req.user),
  });
});

// ---- pedidos ------------------------------------------------------------------------

router.get('/orders', async (req, res) => {
  const where = [];
  const args = [];
  if (req.query.status) {
    where.push('so.status = ?');
    args.push(req.query.status);
  }
  if (req.user.role === 'asesor') {
    where.push('(so.advisor_id = ? OR so.lead_id IN (SELECT id FROM leads WHERE assigned_advisor_id = ?))');
    args.push(req.user.advisor_id || -1, req.user.advisor_id || -1);
  }
  const rows = await db
    .prepare(
      `SELECT so.*, a.name AS advisor_name, q.number AS quotation_number,
              (SELECT COUNT(*) FROM production_orders op WHERE op.sales_order_id = so.id AND op.status != 'cancelada') AS ops_count,
              (SELECT GROUP_CONCAT(op.number, ', ') FROM production_orders op WHERE op.sales_order_id = so.id AND op.status != 'cancelada') AS ops_numbers
         FROM sales_orders so
         LEFT JOIN advisors a ON a.id = so.advisor_id
         LEFT JOIN quotations q ON q.id = so.quotation_id
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY CASE so.status WHEN 'por_validar' THEN 0 WHEN 'info_solicitada' THEN 1 WHEN 'recibido' THEN 2 WHEN 'validado' THEN 3 ELSE 4 END, so.received_at DESC`
    )
    .all(...args);
  res.json(rows);
});

router.get('/orders/:id', async (req, res) => {
  const so = await db
    .prepare('SELECT so.*, a.name AS advisor_name, q.number AS quotation_number FROM sales_orders so LEFT JOIN advisors a ON a.id = so.advisor_id LEFT JOIN quotations q ON q.id = so.quotation_id WHERE so.id = ?')
    .get(Number(req.params.id));
  if (!so) return res.status(404).json({ error: 'Pedido no encontrado' });
  if (!(await P.canSeeSalesOrder(req.user, so))) return res.status(403).json({ error: 'No tienes permiso sobre este pedido' });
  const ops = await P.listOps(req.user, ['op.sales_order_id = ?'], [so.id]);
  const activity = await db
    .prepare("SELECT l.*, COALESCE(u.username, 'Sistema') AS user_name FROM activity_log l LEFT JOIN users u ON u.id = l.user_id WHERE l.entity = 'pedido' AND l.entity_id = ? ORDER BY l.created_at DESC, l.id DESC")
    .all(so.id);
  let quotation = null;
  if (so.quotation_id) quotation = await nativeQuotes.readQuotation(so.quotation_id);
  res.json({ ...so, ops, activity, quotation });
});

async function insertSalesOrder(data, user) {
  const number = await P.nextSalesOrderNumber();
  const info = await db
    .prepare(
      `INSERT INTO sales_orders (number, quotation_id, lead_id, client_name, contact, phone, address, destination, advisor_id, product_summary, requested_date, status, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'por_validar', ?, ?)`
    )
    .run(number, data.quotation_id || null, data.lead_id || null, data.client_name, data.contact || null, data.phone || null, data.address || null, data.destination || null, data.advisor_id || null, data.product_summary || null, data.requested_date || null, data.notes || null, user.id || null);
  await P.log('pedido', info.lastInsertRowid, user.id, 'Pedido recibido', data.origin || null);
  return info.lastInsertRowid;
}

// Pedido manual (trabajo que no pasó por Cotizar).
router.post('/orders', managerOnly, async (req, res) => {
  const b = req.body || {};
  if (!text(b.client_name)) return res.status(400).json({ error: 'El cliente es obligatorio' });
  const id = await insertSalesOrder(
    {
      client_name: text(b.client_name),
      contact: text(b.contact),
      phone: text(b.phone),
      address: text(b.address),
      destination: text(b.destination),
      advisor_id: Number(b.advisor_id) || null,
      product_summary: text(b.product_summary),
      requested_date: cleanDate(b.requested_date) || null,
      notes: text(b.notes),
      origin: 'Registro manual',
    },
    req.user
  );
  changed(null, 'order');
  res.status(201).json(await db.prepare('SELECT * FROM sales_orders WHERE id = ?').get(id));
});

// "Enviar a producción" desde una cotización aprobada (o ya vendida).
router.post('/orders/from-quotation', async (req, res) => {
  const quotation = await nativeQuotes.readQuotation(Number((req.body || {}).quotation_id));
  if (!quotation) return res.status(404).json({ error: 'Cotización no encontrada' });
  if (!(await nativeQuotes.canAccessQuotation(req.user, quotation))) return res.status(403).json({ error: 'No tienes permiso sobre esta cotización' });
  if (!['aprobada', 'sale'].includes(quotation.state)) return res.status(409).json({ error: 'Solo se envía a producción una cotización aprobada o vendida' });
  const existing = await db.prepare("SELECT number FROM sales_orders WHERE quotation_id = ? AND status != 'cancelado'").get(quotation.id);
  if (existing) return res.status(409).json({ error: `Esta cotización ya está en producción como ${existing.number}` });
  const lead = await db.prepare('SELECT * FROM leads WHERE id = ?').get(quotation.lead_id);
  const client = lead && lead.client_id ? await db.prepare('SELECT * FROM clients WHERE id = ?').get(lead.client_id) : null;
  const service = velaraServices.findService(quotation.service_slug);
  const summary = [service ? service.title : null, ...quotation.lines.map((l) => `${Number(l.qty) || 1} × ${l.product_name}`)].filter(Boolean).join(' · ');
  const id = await insertSalesOrder(
    {
      quotation_id: quotation.id,
      lead_id: quotation.lead_id,
      client_name: lead ? lead.client_name : 'Cliente',
      contact: client && client.name !== lead?.client_name ? client.name : null,
      phone: (lead && lead.phone) || (client && client.phone) || null,
      address: (lead && lead.address) || (client && client.address) || null,
      destination: lead ? lead.city : null,
      advisor_id: lead ? lead.assigned_advisor_id : null,
      product_summary: summary,
      requested_date: null,
      notes: quotation.note || null,
      origin: `Desde la cotización ${quotation.number}`,
    },
    req.user
  );
  changed(null, 'order');
  res.status(201).json(await db.prepare('SELECT * FROM sales_orders WHERE id = ?').get(id));
});

router.patch('/orders/:id', managerOnly, async (req, res) => {
  const so = await db.prepare('SELECT * FROM sales_orders WHERE id = ?').get(Number(req.params.id));
  if (!so) return res.status(404).json({ error: 'Pedido no encontrado' });
  const b = req.body || {};
  const fields = ['client_name', 'contact', 'phone', 'address', 'destination', 'product_summary', 'notes'];
  const values = fields.map((f) => (b[f] !== undefined ? text(b[f]) : so[f]));
  if (!values[0]) return res.status(400).json({ error: 'El cliente no puede quedar vacío' });
  const requested = cleanDate(b.requested_date);
  await db
    .prepare(`UPDATE sales_orders SET ${fields.map((f) => `${f} = ?`).join(', ')}, requested_date = ?, advisor_id = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(...values, requested !== undefined ? requested : so.requested_date, b.advisor_id !== undefined ? Number(b.advisor_id) || null : so.advisor_id, so.id);
  await P.log('pedido', so.id, req.user.id, 'Pedido modificado');
  changed(null, 'order');
  res.json(await db.prepare('SELECT * FROM sales_orders WHERE id = ?').get(so.id));
});

router.post('/orders/:id/request-info', managerOnly, async (req, res) => {
  const so = await db.prepare('SELECT * FROM sales_orders WHERE id = ?').get(Number(req.params.id));
  if (!so) return res.status(404).json({ error: 'Pedido no encontrado' });
  const info = text((req.body || {}).info_request);
  if (!info) return res.status(400).json({ error: 'Indica qué información falta' });
  await db.prepare("UPDATE sales_orders SET status = 'info_solicitada', info_request = ?, updated_at = datetime('now') WHERE id = ?").run(info, so.id);
  await P.log('pedido', so.id, req.user.id, 'Información solicitada', info);
  changed(null, 'order');
  res.json({ ok: true });
});

router.post('/orders/:id/validate', managerOnly, async (req, res) => {
  const so = await db.prepare('SELECT * FROM sales_orders WHERE id = ?').get(Number(req.params.id));
  if (!so) return res.status(404).json({ error: 'Pedido no encontrado' });
  if (so.status === 'cancelado') return res.status(409).json({ error: 'El pedido está cancelado' });
  await db.prepare("UPDATE sales_orders SET status = 'validado', updated_at = datetime('now') WHERE id = ?").run(so.id);
  await P.log('pedido', so.id, req.user.id, 'Pedido validado: información completa');
  changed(null, 'order');
  res.json({ ok: true });
});

router.post('/orders/:id/cancel', managerOnly, async (req, res) => {
  const so = await db.prepare('SELECT * FROM sales_orders WHERE id = ?').get(Number(req.params.id));
  if (!so) return res.status(404).json({ error: 'Pedido no encontrado' });
  const reason = text((req.body || {}).reason);
  if (!reason) return res.status(400).json({ error: 'Indica el motivo de la cancelación' });
  const open = await db.prepare("SELECT COUNT(*) AS c FROM production_orders WHERE sales_order_id = ? AND status NOT IN ('cancelada', 'cerrada')").get(so.id);
  if (open.c > 0) return res.status(409).json({ error: 'El pedido tiene órdenes de producción abiertas; cancélalas primero' });
  await db.prepare("UPDATE sales_orders SET status = 'cancelado', cancel_reason = ?, updated_at = datetime('now') WHERE id = ?").run(reason, so.id);
  await P.log('pedido', so.id, req.user.id, 'Pedido cancelado', reason);
  changed(null, 'order');
  res.json({ ok: true });
});

// Crear una OP del pedido (1 pedido -> N OP). El producto y sus
// características se prellenan de la cotización si el pedido viene de una.
router.post('/orders/:id/ops', managerOnly, async (req, res) => {
  const so = await db.prepare('SELECT * FROM sales_orders WHERE id = ?').get(Number(req.params.id));
  if (!so) return res.status(404).json({ error: 'Pedido no encontrado' });
  if (so.status === 'cancelado') return res.status(409).json({ error: 'El pedido está cancelado' });
  const b = req.body || {};
  const quotation = so.quotation_id ? await nativeQuotes.readQuotation(so.quotation_id) : null;
  const service = velaraServices.findService(b.service_slug || quotation?.service_slug);
  const productName = text(b.product_name) || (service ? service.title : null);
  if (!productName) return res.status(400).json({ error: 'Indica el producto' });
  if (b.priority && !P.PRIORITIES.includes(b.priority)) return res.status(400).json({ error: 'Prioridad inválida' });
  const workerId = Number(b.responsible_worker_id) || null;
  if (workerId && !(await db.prepare('SELECT id FROM workers WHERE id = ?').get(workerId))) return res.status(400).json({ error: 'Responsable no encontrado' });

  const run = db.transaction(async () => {
    const n = await P.nextOpNumber();
    const warranty = Math.max(0, Number(await getSetting('warranty_months', '6')) || 0);
    const info = await db
      .prepare(
        `INSERT INTO production_orders (number, year, seq, sales_order_id, product_name, product_code, service_slug, quantity, unit, received_at, requested_date, committed_date, start_date, priority, responsible_worker_id, advisor_id, observations, warranty_months, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        n.number, n.year, n.seq, so.id, productName, text(b.product_code), service ? service.slug : null,
        Number(b.quantity) > 0 ? Number(b.quantity) : 1, text(b.unit) || 'und', so.received_at,
        cleanDate(b.requested_date) || so.requested_date || null, cleanDate(b.committed_date) || null, cleanDate(b.start_date) || null,
        b.priority || 'normal', workerId, so.advisor_id, text(b.observations), warranty, req.user.id || null
      );
    const opId = info.lastInsertRowid;
    // Características del producto: campos del servicio de la cotización.
    let pos = 0;
    if (quotation && service) {
      for (const f of service.fields) {
        const v = quotation.service_fields && quotation.service_fields[f.key];
        if (v) await db.prepare("INSERT INTO production_specs (op_id, section, label, value, position) VALUES (?, 'producto', ?, ?, ?)").run(opId, f.label, String(v), pos++);
      }
      const detail = quotation.lines.map((l) => `${Number(l.qty) || 1} × ${l.product_name}${l.description ? ` — ${l.description}` : ''}`).join('\n');
      if (detail) await db.prepare("INSERT INTO production_specs (op_id, section, label, value, position) VALUES (?, 'producto', 'Detalle de la cotización', ?, ?)").run(opId, detail, pos++);
    }
    await P.log('op', opId, req.user.id, 'OP creada', `${n.number} del pedido ${so.number}`);
    if (workerId) {
      const w = await db.prepare('SELECT name FROM workers WHERE id = ?').get(workerId);
      await P.log('op', opId, req.user.id, `OP asignada a ${w.name}`);
    }
    if (so.status === 'por_validar' || so.status === 'recibido') {
      await db.prepare("UPDATE sales_orders SET status = 'validado', updated_at = datetime('now') WHERE id = ?").run(so.id);
      await P.log('pedido', so.id, req.user.id, `OP ${n.number} creada; pedido validado`);
    } else {
      await P.log('pedido', so.id, req.user.id, `OP ${n.number} creada`);
    }
    return opId;
  });
  const opId = await run();
  changed(opId, 'created');
  res.status(201).json(await P.readOp(opId));
});

// ---- órdenes de producción -------------------------------------------------------

// GET /ops?q=&status=&responsible=&priority=&client=&product=&quick=
router.get('/ops', async (req, res) => {
  const { q, status, responsible, priority, client, product, from, to } = req.query;
  const where = [];
  const args = [];
  if (status === 'abiertas' || !status) {
    if (!status && req.query.all !== '1') where.push("op.status NOT IN ('cerrada', 'cancelada')");
  } else if (status) {
    where.push('op.status = ?');
    args.push(status);
  }
  if (responsible === 'none') where.push('op.responsible_worker_id IS NULL');
  else if (responsible) {
    where.push('op.responsible_worker_id = ?');
    args.push(Number(responsible));
  }
  if (priority) {
    where.push('op.priority = ?');
    args.push(priority);
  }
  if (client) {
    where.push('so.client_name LIKE ?');
    args.push(`%${client}%`);
  }
  if (product) {
    where.push('op.product_name LIKE ?');
    args.push(`%${product}%`);
  }
  if (from) {
    where.push('COALESCE(op.committed_date, op.requested_date) >= ?');
    args.push(from);
  }
  if (to) {
    where.push('COALESCE(op.committed_date, op.requested_date) <= ?');
    args.push(to);
  }
  if (q && q.trim()) {
    const like = `%${q.trim()}%`;
    where.push('(op.number LIKE ? OR so.number LIKE ? OR so.client_name LIKE ? OR op.product_name LIKE ? OR op.product_code LIKE ? OR w.name LIKE ?)');
    args.push(like, like, like, like, like, like);
  }
  res.json(await P.listOps(req.user, where, args));
});

router.get('/ops/:id', async (req, res) => {
  const op = await loadOp(req, res);
  if (!op) return;
  const full = await P.readOp(op.id);
  full.can_manage = P.isManager(req.user);
  full.allowed_next = P.TRANSITIONS[full.status] || [];
  res.json(full);
});

// Datos de la OP. Cambios de fecha y de responsable quedan en el historial.
router.patch('/ops/:id', managerOnly, async (req, res) => {
  const op = await loadOp(req, res);
  if (!op) return;
  if (['cerrada', 'cancelada'].includes(op.status)) return res.status(409).json({ error: 'La OP está cerrada' });
  const b = req.body || {};
  if (b.priority !== undefined && !P.PRIORITIES.includes(b.priority)) return res.status(400).json({ error: 'Prioridad inválida' });
  const sets = {};
  for (const f of ['product_name', 'product_code', 'unit', 'observations']) if (b[f] !== undefined) sets[f] = text(b[f]);
  if (sets.product_name === null) return res.status(400).json({ error: 'El producto no puede quedar vacío' });
  if (b.quantity !== undefined) sets.quantity = Number(b.quantity) > 0 ? Number(b.quantity) : op.quantity;
  if (b.priority !== undefined) sets.priority = b.priority;
  for (const f of ['requested_date', 'committed_date', 'start_date']) {
    const d = cleanDate(b[f]);
    if (d !== undefined) sets[f] = d;
  }
  if (b.requires_approval !== undefined) sets.requires_approval = b.requires_approval ? 1 : 0;
  if (b.responsible_worker_id !== undefined) {
    const wid = Number(b.responsible_worker_id) || null;
    if (wid && !(await db.prepare('SELECT id FROM workers WHERE id = ?').get(wid))) return res.status(400).json({ error: 'Responsable no encontrado' });
    sets.responsible_worker_id = wid;
  }
  // Solo lo que de verdad cambió (el formulario manda todos los campos).
  for (const k of Object.keys(sets)) {
    if (String(sets[k] ?? '') === String(op[k] ?? '')) delete sets[k];
  }
  const keys = Object.keys(sets);
  if (!keys.length) return res.json(await P.readOp(op.id));
  await db.prepare(`UPDATE production_orders SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`).run(...keys.map((k) => sets[k]), op.id);

  if (sets.committed_date !== undefined && sets.committed_date !== op.committed_date) {
    await P.log('op', op.id, req.user.id, 'Cambio de fecha de entrega', `${op.committed_date || 'sin fecha'} → ${sets.committed_date || 'sin fecha'}`);
  }
  if (sets.responsible_worker_id !== undefined && sets.responsible_worker_id !== op.responsible_worker_id) {
    const w = sets.responsible_worker_id ? await db.prepare('SELECT name FROM workers WHERE id = ?').get(sets.responsible_worker_id) : null;
    await P.log('op', op.id, req.user.id, w ? `OP asignada a ${w.name}` : 'Responsable quitado');
  }
  const LABELS = {
    product_name: 'producto', product_code: 'código', unit: 'unidad', observations: 'observaciones', quantity: 'cantidad',
    priority: 'prioridad', requested_date: 'entrega solicitada', start_date: 'inicio programado', requires_approval: 'exige aprobación',
  };
  const other = keys.filter((k) => !['committed_date', 'responsible_worker_id'].includes(k));
  if (other.length) await P.log('op', op.id, req.user.id, 'OP modificada', other.map((k) => LABELS[k] || k).join(', '));
  changed(op.id, 'updated');
  res.json(await P.readOp(op.id));
});

router.post('/ops/:id/transition', managerOnly, async (req, res) => {
  const op = await loadOp(req, res);
  if (!op) return;
  try {
    const updated = await P.transition(op.id, (req.body || {}).to, req.user, req.body || {});
    changed(op.id, 'status');
    res.json(updated);
  } catch (err) {
    fail(res, err);
  }
});

// Producto / especificaciones técnicas: se reemplaza la sección completa.
router.put('/ops/:id/specs', managerOnly, async (req, res) => {
  const op = await loadOp(req, res);
  if (!op) return;
  const { section, items } = req.body || {};
  if (!['producto', 'tecnica'].includes(section)) return res.status(400).json({ error: 'Sección inválida' });
  const clean = (Array.isArray(items) ? items : []).map((i) => ({ label: text(i.label), value: text(i.value) })).filter((i) => i.label);
  const run = db.transaction(async () => {
    await db.prepare('DELETE FROM production_specs WHERE op_id = ? AND section = ?').run(op.id, section);
    for (const [pos, i] of clean.entries()) {
      await db.prepare('INSERT INTO production_specs (op_id, section, label, value, position) VALUES (?, ?, ?, ?, ?)').run(op.id, section, i.label, i.value, pos);
    }
  });
  await run();
  await P.log('op', op.id, req.user.id, section === 'producto' ? 'Características del producto actualizadas' : 'Especificaciones técnicas actualizadas');
  changed(op.id, 'specs');
  res.json(await P.readOp(op.id));
});

router.put('/ops/:id/workers', managerOnly, async (req, res) => {
  const op = await loadOp(req, res);
  if (!op) return;
  const ids = [...new Set((Array.isArray((req.body || {}).worker_ids) ? req.body.worker_ids : []).map(Number).filter(Boolean))];
  const run = db.transaction(async () => {
    await db.prepare('DELETE FROM production_workers WHERE op_id = ?').run(op.id);
    for (const wid of ids) await db.prepare('INSERT OR IGNORE INTO production_workers (op_id, worker_id) SELECT ?, id FROM workers WHERE id = ?').run(op.id, wid);
  });
  await run();
  const names = (await db.prepare('SELECT w.name FROM production_workers pw JOIN workers w ON w.id = pw.worker_id WHERE pw.op_id = ?').all(op.id)).map((w) => w.name);
  await P.log('op', op.id, req.user.id, 'Operarios asignados', names.join(', ') || 'ninguno');
  changed(op.id, 'workers');
  res.json(await P.readOp(op.id));
});

// ---- tareas -------------------------------------------------------------------------

router.post('/ops/:id/tasks', managerOnly, async (req, res) => {
  const op = await loadOp(req, res);
  if (!op) return;
  const b = req.body || {};
  const names = b.template ? P.DEFAULT_TASKS : [text(b.name)].filter(Boolean);
  if (!names.length) return res.status(400).json({ error: 'Escribe el nombre de la tarea' });
  const max = (await db.prepare('SELECT COALESCE(MAX(position), -1) AS p FROM production_tasks WHERE op_id = ?').get(op.id)).p;
  for (const [i, name] of names.entries()) {
    await db
      .prepare('INSERT INTO production_tasks (op_id, name, worker_id, planned_date, notes, position) VALUES (?, ?, ?, ?, ?, ?)')
      .run(op.id, name, Number(b.worker_id) || null, cleanDate(b.planned_date) || null, text(b.notes), max + 1 + i);
  }
  await P.log('op', op.id, req.user.id, names.length > 1 ? 'Tareas estándar agregadas' : `Tarea agregada: ${names[0]}`);
  changed(op.id, 'tasks');
  res.status(201).json(await P.readOp(op.id));
});

router.patch('/tasks/:taskId', managerOnly, async (req, res) => {
  const task = await db.prepare('SELECT * FROM production_tasks WHERE id = ?').get(Number(req.params.taskId));
  if (!task) return res.status(404).json({ error: 'Tarea no encontrada' });
  const b = req.body || {};
  const statuses = ['pendiente', 'en_proceso', 'completada', 'bloqueada', 'anulada'];
  if (b.status !== undefined && !statuses.includes(b.status)) return res.status(400).json({ error: 'Estado de tarea inválido' });
  const status = b.status || task.status;
  const now = P.nowUtc();
  const started = status === 'en_proceso' || status === 'completada' ? task.started_at || now : status === 'pendiente' ? null : task.started_at;
  const finished = status === 'completada' ? task.finished_at || now : null;
  const planned = cleanDate(b.planned_date);
  await db
    .prepare('UPDATE production_tasks SET name = ?, worker_id = ?, planned_date = ?, status = ?, started_at = ?, finished_at = ?, notes = ? WHERE id = ?')
    .run(
      b.name !== undefined ? text(b.name) || task.name : task.name,
      b.worker_id !== undefined ? Number(b.worker_id) || null : task.worker_id,
      planned !== undefined ? planned : task.planned_date,
      status,
      started,
      finished,
      b.notes !== undefined ? text(b.notes) : task.notes,
      task.id
    );
  if (b.status !== undefined && b.status !== task.status) {
    const labels = { pendiente: 'pendiente', en_proceso: 'en proceso', completada: 'completada', bloqueada: 'bloqueada', anulada: 'anulada' };
    await P.log('op', task.op_id, req.user.id, `Tarea "${task.name}" ${labels[status]}`);
  } else if (b.worker_id !== undefined && (Number(b.worker_id) || null) !== task.worker_id) {
    const w = Number(b.worker_id) ? await db.prepare('SELECT name FROM workers WHERE id = ?').get(Number(b.worker_id)) : null;
    await P.log('op', task.op_id, req.user.id, `Tarea "${task.name}" asignada a ${w ? w.name : 'nadie'}`);
  }
  changed(task.op_id, 'tasks');
  res.json(await P.readOp(task.op_id));
});

// ---- diseños y archivos (con versiones) ------------------------------------------------

router.post('/ops/:id/files', managerOnly, (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? `El archivo supera ${MAX_FILE_MB} MB` : err.message });
    next();
  });
}, async (req, res) => {
  const op = await loadOp(req, res);
  if (!op) return;
  if (!req.file) return res.status(400).json({ error: 'Adjunta un archivo' });
  const kinds = ['diseno', 'plano', 'ficha', 'foto', 'pdf', 'otro'];
  const kind = kinds.includes(req.body.kind) ? req.body.kind : 'otro';
  const group = text(req.body.group_name) || (kind === 'diseno' ? 'Diseño principal' : req.file.originalname);
  const run = db.transaction(async () => {
    const prev = await db.prepare('SELECT COALESCE(MAX(version), 0) AS v FROM production_files WHERE op_id = ? AND group_name = ?').get(op.id, group);
    await db.prepare('UPDATE production_files SET is_current = 0 WHERE op_id = ? AND group_name = ?').run(op.id, group);
    await db
      .prepare('INSERT INTO production_files (op_id, kind, group_name, version, is_current, original_name, stored_path, mime, size, note, uploaded_by) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)')
      .run(op.id, kind, group, prev.v + 1, req.file.originalname, path.relative(UPLOAD_ROOT, req.file.path), req.file.mimetype, req.file.size, text(req.body.note), req.user.id || null);
    return prev.v + 1;
  });
  const version = await run();
  await P.log('op', op.id, req.user.id, kind === 'diseno' ? `Diseño cargado: ${group} v${version}` : `Archivo cargado: ${group} v${version}`, req.file.originalname);
  changed(op.id, 'files');
  res.status(201).json(await P.readOp(op.id));
});

// Marcar otra versión como vigente (sin borrar ninguna).
router.post('/files/:fileId/current', managerOnly, async (req, res) => {
  const f = await db.prepare('SELECT * FROM production_files WHERE id = ?').get(Number(req.params.fileId));
  if (!f) return res.status(404).json({ error: 'Archivo no encontrado' });
  await db.prepare('UPDATE production_files SET is_current = CASE WHEN id = ? THEN 1 ELSE 0 END WHERE op_id = ? AND group_name = ?').run(f.id, f.op_id, f.group_name);
  await P.log('op', f.op_id, req.user.id, `Cambio de diseño: ${f.group_name} v${f.version} vigente`);
  changed(f.op_id, 'files');
  res.json(await P.readOp(f.op_id));
});

router.get('/files/:fileId', async (req, res) => {
  const f = await db.prepare('SELECT * FROM production_files WHERE id = ?').get(Number(req.params.fileId));
  if (!f) return res.status(404).json({ error: 'Archivo no encontrado' });
  const op = await db.prepare('SELECT * FROM production_orders WHERE id = ?').get(f.op_id);
  if (!(await P.canSeeOp(req.user, op))) return res.status(403).json({ error: 'No tienes permiso sobre este archivo' });
  const abs = path.resolve(UPLOAD_ROOT, f.stored_path);
  if (!abs.startsWith(path.resolve(UPLOAD_ROOT)) || !fs.existsSync(abs)) return res.status(404).json({ error: 'El archivo ya no está en el disco' });
  res.setHeader('Content-Type', f.mime || 'application/octet-stream');
  res.setHeader('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename="${encodeURIComponent(f.original_name)}"`);
  fs.createReadStream(abs).pipe(res);
});

// ---- materiales requeridos y solicitudes (sin inventario) ----------------------------

router.post('/ops/:id/requirements', managerOnly, async (req, res) => {
  const op = await loadOp(req, res);
  if (!op) return;
  const b = req.body || {};
  if (!text(b.material)) return res.status(400).json({ error: 'Indica el material' });
  if (!(Number(b.qty) > 0)) return res.status(400).json({ error: 'Indica la cantidad requerida' });
  await db
    .prepare('INSERT INTO material_requirements (op_id, material, code, qty, unit, notes) VALUES (?, ?, ?, ?, ?, ?)')
    .run(op.id, text(b.material), text(b.code), Number(b.qty), text(b.unit) || 'und', text(b.notes));
  await P.log('op', op.id, req.user.id, `Material requerido: ${text(b.material)}`, `${Number(b.qty)} ${text(b.unit) || 'und'}`);
  changed(op.id, 'materials');
  res.status(201).json(await P.readOp(op.id));
});

router.patch('/requirements/:reqId', managerOnly, async (req, res) => {
  const r = await db.prepare('SELECT * FROM material_requirements WHERE id = ?').get(Number(req.params.reqId));
  if (!r) return res.status(404).json({ error: 'Requerimiento no encontrado' });
  const b = req.body || {};
  const statuses = ['pendiente', 'solicitado', 'disponible', 'bloqueado', 'anulado'];
  if (b.status !== undefined && !statuses.includes(b.status)) return res.status(400).json({ error: 'Estado inválido' });
  await db
    .prepare('UPDATE material_requirements SET qty = ?, unit = ?, notes = ?, status = ? WHERE id = ?')
    .run(Number(b.qty) > 0 ? Number(b.qty) : r.qty, text(b.unit) || r.unit, b.notes !== undefined ? text(b.notes) : r.notes, b.status || r.status, r.id);
  if (b.status && b.status !== r.status) await P.log('op', r.op_id, req.user.id, `Material "${r.material}": ${b.status}`);
  changed(r.op_id, 'materials');
  res.json(await P.readOp(r.op_id));
});

router.post('/requirements/:reqId/request', managerOnly, async (req, res) => {
  const r = await db.prepare('SELECT * FROM material_requirements WHERE id = ?').get(Number(req.params.reqId));
  if (!r) return res.status(404).json({ error: 'Requerimiento no encontrado' });
  const open = await db.prepare("SELECT number FROM material_requests WHERE requirement_id = ? AND status = 'pendiente'").get(r.id);
  if (open) return res.status(409).json({ error: `Ya hay una solicitud pendiente (${open.number})` });
  const number = await P.nextRequestNumber();
  await db
    .prepare('INSERT INTO material_requests (number, op_id, requirement_id, material, qty, unit, reason, requested_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(number, r.op_id, r.id, r.material, r.qty, r.unit, text((req.body || {}).reason) || 'Producción', req.user.id || null);
  await db.prepare("UPDATE material_requirements SET status = 'solicitado' WHERE id = ?").run(r.id);
  await P.log('op', r.op_id, req.user.id, `Solicitud de material ${number}`, `${r.material} · ${r.qty} ${r.unit}`);
  changed(r.op_id, 'materials');
  res.status(201).json(await P.readOp(r.op_id));
});

router.get('/material-requests', async (req, res) => {
  const rows = await db
    .prepare(
      `SELECT mr.*, op.number AS op_number, so.client_name, u.username AS requested_by_name
         FROM material_requests mr
         JOIN production_orders op ON op.id = mr.op_id
         JOIN sales_orders so ON so.id = op.sales_order_id
         LEFT JOIN users u ON u.id = mr.requested_by
        ${['pendiente', 'atendida', 'cancelada'].includes(req.query.status) ? 'WHERE mr.status = ?' : ''}
        ORDER BY CASE mr.status WHEN 'pendiente' THEN 0 ELSE 1 END, mr.created_at DESC`
    )
    .all(...(['pendiente', 'atendida', 'cancelada'].includes(req.query.status) ? [req.query.status] : []));
  res.json(rows);
});

// Marcar una solicitud como atendida/cancelada. Es solo un estado: NO mueve
// existencias (eso será del futuro módulo de Inventario).
router.patch('/material-requests/:reqId', managerOnly, async (req, res) => {
  const mr = await db.prepare('SELECT * FROM material_requests WHERE id = ?').get(Number(req.params.reqId));
  if (!mr) return res.status(404).json({ error: 'Solicitud no encontrada' });
  const status = (req.body || {}).status;
  if (!['pendiente', 'atendida', 'cancelada'].includes(status)) return res.status(400).json({ error: 'Estado inválido' });
  await db.prepare("UPDATE material_requests SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, mr.id);
  if (mr.requirement_id) {
    const reqStatus = status === 'atendida' ? 'disponible' : status === 'cancelada' ? 'pendiente' : 'solicitado';
    await db.prepare('UPDATE material_requirements SET status = ? WHERE id = ?').run(reqStatus, mr.requirement_id);
  }
  await P.log('op', mr.op_id, req.user.id, `Solicitud ${mr.number}: ${status}`);
  changed(mr.op_id, 'materials');
  res.json({ ok: true });
});

// ---- bloqueos ---------------------------------------------------------------------------

router.post('/ops/:id/blocks', managerOnly, async (req, res) => {
  const op = await loadOp(req, res);
  if (!op) return;
  try {
    const b = req.body || {};
    const updated = await P.addBlock(op.id, req.user, { reason: b.reason, responsible: text(b.responsible), notes: text(b.notes) });
    changed(op.id, 'block');
    res.status(201).json(updated);
  } catch (err) {
    fail(res, err);
  }
});

router.post('/blocks/:blockId/resolve', managerOnly, async (req, res) => {
  try {
    const updated = await P.resolveBlock(Number(req.params.blockId), req.user, { resolution: text((req.body || {}).resolution) });
    changed(updated.id, 'block');
    res.json(updated);
  } catch (err) {
    fail(res, err);
  }
});

// ---- control / revisión y aprobaciones -------------------------------------------------

// Resultado "correccion" devuelve la OP a producción (sección 20).
router.post('/ops/:id/reviews', managerOnly, async (req, res) => {
  const op = await loadOp(req, res);
  if (!op) return;
  if (op.status !== 'control') return res.status(409).json({ error: 'La revisión se registra cuando la OP está en Control / revisión' });
  const b = req.body || {};
  if (!['aprobado', 'correccion'].includes(b.result)) return res.status(400).json({ error: 'Indica si queda aprobado o requiere corrección' });
  if (b.result === 'correccion' && !text(b.notes)) return res.status(400).json({ error: 'Describe qué hay que corregir' });
  const checklist = b.checklist && typeof b.checklist === 'object' ? b.checklist : {};
  await db
    .prepare('INSERT INTO production_reviews (op_id, result, checklist, notes, reviewed_by) VALUES (?, ?, ?, ?, ?)')
    .run(op.id, b.result, JSON.stringify(checklist), text(b.notes), req.user.id || null);
  await P.log('op', op.id, req.user.id, b.result === 'aprobado' ? 'Control / revisión: aprobado' : 'Control / revisión: requiere corrección', text(b.notes));
  let result;
  try {
    result = b.result === 'correccion' ? await P.transition(op.id, 'en_produccion', req.user, { reason: text(b.notes) }) : await P.readOp(op.id);
  } catch (err) {
    return fail(res, err);
  }
  changed(op.id, 'review');
  res.status(201).json(result);
});

// Aprobación del asesor (sección 21). El asesor dueño del cliente puede
// firmar; la firma llega como imagen PNG (dataURL) desde el lienzo.
router.post('/ops/:id/approvals', async (req, res) => {
  const op = await loadOp(req, res);
  if (!op) return;
  if (!P.isManager(req.user) && req.user.role !== 'asesor') return res.status(403).json({ error: 'No tienes permiso para aprobar' });
  const b = req.body || {};
  if (!text(b.signed_name)) return res.status(400).json({ error: 'Escribe el nombre de quien aprueba' });
  if (!(b.confirm_features && b.confirm_quantities && b.confirm_design)) return res.status(400).json({ error: 'Hay que confirmar características, cantidades y diseño' });
  let signaturePath = null;
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String(b.signature || ''));
  if (!m) return res.status(400).json({ error: 'Falta la firma' });
  const buf = Buffer.from(m[1], 'base64');
  if (buf.length > 2 * 1024 * 1024) return res.status(400).json({ error: 'La firma es demasiado grande' });
  const dir = path.join(UPLOAD_ROOT, 'op', String(op.id));
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `firma-${Date.now()}.png`);
  fs.writeFileSync(file, buf);
  signaturePath = path.relative(UPLOAD_ROOT, file);
  const advisorId = req.user.advisor_id || op.advisor_id || null;
  await db
    .prepare('INSERT INTO production_approvals (op_id, advisor_id, signed_name, confirm_features, confirm_quantities, confirm_design, signature_path, notes, created_by) VALUES (?, ?, ?, 1, 1, 1, ?, ?, ?)')
    .run(op.id, advisorId, text(b.signed_name), signaturePath, text(b.notes), req.user.id || null);
  await P.log('op', op.id, req.user.id, `Aprobación comercial: ${text(b.signed_name)}`, 'Confirma características, cantidades y diseño');
  changed(op.id, 'approval');
  res.status(201).json(await P.readOp(op.id));
});

router.get('/approvals/:apId/signature', async (req, res) => {
  const ap = await db.prepare('SELECT * FROM production_approvals WHERE id = ?').get(Number(req.params.apId));
  if (!ap || !ap.signature_path) return res.status(404).json({ error: 'Firma no encontrada' });
  const op = await db.prepare('SELECT * FROM production_orders WHERE id = ?').get(ap.op_id);
  if (!(await P.canSeeOp(req.user, op))) return res.status(403).json({ error: 'Sin permiso' });
  const abs = path.resolve(UPLOAD_ROOT, ap.signature_path);
  if (!abs.startsWith(path.resolve(UPLOAD_ROOT)) || !fs.existsSync(abs)) return res.status(404).json({ error: 'Firma no encontrada' });
  res.setHeader('Content-Type', 'image/png');
  fs.createReadStream(abs).pipe(res);
});

// ---- documentos PDF (sección 22) ---------------------------------------------------------

router.get('/ops/:id/pdf/:doc', async (req, res) => {
  const op = await loadOp(req, res);
  if (!op) return;
  const def = productionPdf.DOCS[req.params.doc];
  if (!def) return res.status(404).json({ error: 'Documento no encontrado' });
  if (req.params.doc === 'acta' && !['entregada', 'cerrada'].includes(op.status)) {
    return res.status(409).json({ error: 'El acta de entrega se genera cuando la OP está entregada' });
  }
  const full = await P.readOp(op.id);
  const cfg = await productionPdf.companySettings();
  const doc = new PDFDocument({ size: 'LETTER', margin: 50 });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${def.title}-${full.number}.pdf"`);
  doc.pipe(res);
  def.draw(doc, full, cfg);
  doc.end();
  await P.log('op', op.id, req.user.id, `Documento generado: ${def.title.replace(/-/g, ' ')}`);
});

// ---- garantías (sobre OP entregadas) ----------------------------------------------------

const CLAIM_STATUSES = ['abierto', 'en_revision', 'resuelto', 'rechazado'];

router.get('/claims', async (req, res) => {
  const where = ['c.production_order_id IS NOT NULL'];
  const args = [];
  if (CLAIM_STATUSES.includes(req.query.status)) {
    where.push('c.status = ?');
    args.push(req.query.status);
  }
  if (req.user.role === 'asesor') {
    where.push('(op.advisor_id = ? OR so.lead_id IN (SELECT id FROM leads WHERE assigned_advisor_id = ?))');
    args.push(req.user.advisor_id || -1, req.user.advisor_id || -1);
  }
  const rows = await db
    .prepare(
      `SELECT c.*, op.id AS op_id, op.number, op.product_name, op.delivered_at, op.warranty_months, op.service_slug, so.client_name, so.phone
         FROM warranty_claims c
         JOIN production_orders op ON op.id = c.production_order_id
         JOIN sales_orders so ON so.id = op.sales_order_id
        WHERE ${where.join(' AND ')}
        ORDER BY CASE c.status WHEN 'abierto' THEN 0 WHEN 'en_revision' THEN 1 ELSE 2 END, c.reported_at DESC`
    )
    .all(...args);
  res.json(rows);
});

router.post('/ops/:id/claims', async (req, res) => {
  const op = await loadOp(req, res);
  if (!op) return;
  if (!['entregada', 'cerrada'].includes(op.status)) return res.status(409).json({ error: 'Solo se reclama garantía de un trabajo ya entregado' });
  const description = text((req.body || {}).description);
  if (!description) return res.status(400).json({ error: 'Describe el problema que reporta el cliente' });
  await db
    .prepare('INSERT INTO warranty_claims (production_order_id, description, created_by) VALUES (?, ?, ?)')
    .run(op.id, description, req.user.id || null);
  await P.log('op', op.id, req.user.id, 'Reclamo de garantía', description);
  changed(op.id, 'claim');
  res.status(201).json(await P.readOp(op.id));
});

router.patch('/claims/:claimId', managerOnly, async (req, res) => {
  const claim = await db.prepare('SELECT * FROM warranty_claims WHERE id = ?').get(Number(req.params.claimId));
  if (!claim) return res.status(404).json({ error: 'Reclamo no encontrado' });
  const { status, resolution } = req.body || {};
  if (status !== undefined && !CLAIM_STATUSES.includes(status)) return res.status(400).json({ error: 'Estado inválido' });
  const next = status || claim.status;
  const closed = next === 'resuelto' || next === 'rechazado';
  await db
    .prepare('UPDATE warranty_claims SET status = ?, resolution = ?, resolved_at = ? WHERE id = ?')
    .run(next, resolution !== undefined ? text(resolution) : claim.resolution, closed ? claim.resolved_at || P.nowUtc() : null, claim.id);
  if (claim.production_order_id) await P.log('op', claim.production_order_id, req.user.id, `Garantía: reclamo ${next}`, text(resolution));
  changed(claim.production_order_id, 'claim');
  res.json({ ok: true });
});

// ---- programación y reportes -------------------------------------------------------------

// OP activas con fechas, para calendario y línea de tiempo (sección 19).
router.get('/schedule', async (req, res) => {
  const from = cleanDate(req.query.from) || P.todayBogota(-7);
  const to = cleanDate(req.query.to) || P.todayBogota(35);
  const ops = await P.listOps(
    req.user,
    ["op.status NOT IN ('cancelada', 'cerrada')", "COALESCE(op.committed_date, op.requested_date) IS NOT NULL", 'COALESCE(op.start_date, op.committed_date, op.requested_date) <= ?', 'COALESCE(op.committed_date, op.requested_date) >= ?'],
    [to, from]
  );
  res.json({ from, to, ops });
});

// Reportes de producción (sección 25) sobre un periodo.
router.get('/reports', async (req, res) => {
  const today = P.todayBogota();
  const from = cleanDate(req.query.from) || `${today.slice(0, 8)}01`;
  const to = cleanDate(req.query.to) || today;
  const all = await P.listOps(req.user, [], []);
  const inRange = (d) => d && d.slice(0, 10) >= from && d.slice(0, 10) <= to;
  const local = (utc) => (utc ? new Date(new Date(`${utc.replace(' ', 'T')}Z`).getTime() - 5 * 3600000).toISOString().slice(0, 10) : null);
  const received = all.filter((o) => inRange(local(o.created_at)));
  const delivered = all.filter((o) => o.delivered_at && inRange(local(o.delivered_at)));
  const onTime = delivered.filter((o) => o.committed_date && local(o.delivered_at) <= o.committed_date).length;
  const daysBetween = (a, b) => (new Date(`${b.replace(' ', 'T')}Z`) - new Date(`${a.replace(' ', 'T')}Z`)) / 86400000;
  const withTimes = delivered.filter((o) => o.started_at && o.finished_at);
  const avgProd = withTimes.length ? withTimes.reduce((s, o) => s + daysBetween(o.started_at, o.finished_at), 0) / withTimes.length : null;
  const byResp = {};
  for (const o of all.filter((x) => !['cancelada'].includes(x.status))) {
    const k = o.responsible_name || 'Sin responsable';
    byResp[k] = byResp[k] || { name: k, abiertas: 0, entregadas: 0, vencidas: 0 };
    if (['entregada', 'cerrada'].includes(o.status)) {
      if (o.delivered_at && inRange(local(o.delivered_at))) byResp[k].entregadas++;
    } else byResp[k].abiertas++;
    if (o.alert === 'vencida') byResp[k].vencidas++;
  }
  const byStatus = Object.fromEntries(P.STATUSES.map((s) => [s, all.filter((o) => o.status === s).length]));
  res.json({
    from,
    to,
    totals: {
      recibidas: received.length,
      programadas: byStatus.programada,
      en_produccion: byStatus.en_produccion,
      terminadas: all.filter((o) => o.finished_at && inRange(local(o.finished_at))).length,
      entregadas: delivered.length,
      retrasadas: all.filter((o) => o.alert === 'vencida').length,
      bloqueadas: all.filter((o) => o.blocked).length,
      cumplimiento: delivered.length ? Math.round((onTime / delivered.length) * 100) : null,
      tiempo_promedio_dias: avgProd !== null ? Math.round(avgProd * 10) / 10 : null,
    },
    by_status: byStatus,
    by_responsible: Object.values(byResp).sort((a, b) => b.abiertas + b.entregadas - (a.abiertas + a.entregadas)),
    delivered: delivered.map((o) => ({ id: o.id, number: o.number, client_name: o.client_name, product_name: o.product_name, committed_date: o.committed_date, delivered: local(o.delivered_at), on_time: !!o.committed_date && local(o.delivered_at) <= o.committed_date })),
  });
});

module.exports = router;
