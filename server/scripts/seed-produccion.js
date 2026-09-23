// Datos de PRUEBA del módulo Producción: pedidos (desde cotizaciones y
// manuales) y órdenes de producción en TODOS los estados, con tareas,
// especificaciones, un diseño con versiones, requerimientos y solicitudes de
// material, un bloqueo, control, aprobación, entrega y un reclamo de
// garantía. Las OP avanzan con las mismas reglas del sistema
// (production.transition), así el historial queda como en la vida real.
//
// Uso:  node scripts/seed-produccion.js      (correr antes seed-test-data.js
//                                              y seed-erp.js, que crean
//                                              cotizaciones y operarios)
// Se detiene si ya hay pedidos, para no mezclar con datos reales.

const path = require('path');
const fs = require('fs');
const { db, init } = require('../db');
const P = require('../production');
const velaraServices = require('../velaraServices');
const nativeQuotes = require('../nativeQuotes');

const UPLOAD_ROOT = path.join(__dirname, '..', 'data', 'uploads');
const SAMPLE_DESIGN = path.join(__dirname, '..', '..', '..', 'imagens velara', 'tapiceria', 'Lujo en cuero negro y costuras ámbar.png');
const SYSTEM = { id: null, role: 'admin' };

async function createOrder({ quotation, manual }) {
  const number = await P.nextSalesOrderNumber();
  let data;
  if (quotation) {
    const lead = await db.prepare('SELECT * FROM leads WHERE id = ?').get(quotation.lead_id);
    const service = velaraServices.findService(quotation.service_slug);
    data = {
      quotation_id: quotation.id,
      lead_id: lead.id,
      client_name: lead.client_name,
      phone: lead.phone,
      address: lead.address,
      destination: lead.city,
      advisor_id: lead.assigned_advisor_id,
      product_summary: [service?.title, ...quotation.lines.map((l) => `${Number(l.qty) || 1} × ${l.product_name}`)].filter(Boolean).join(' · '),
      origin: `Desde la cotización ${quotation.number}`,
    };
  } else {
    data = { ...manual, origin: 'Registro manual' };
  }
  const info = await db
    .prepare(
      `INSERT INTO sales_orders (number, quotation_id, lead_id, client_name, contact, phone, address, destination, advisor_id, product_summary, requested_date, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'por_validar')`
    )
    .run(number, data.quotation_id || null, data.lead_id || null, data.client_name, data.contact || null, data.phone || null, data.address || null, data.destination || null, data.advisor_id || null, data.product_summary || null, data.requested_date || null);
  await P.log('pedido', info.lastInsertRowid, null, 'Pedido recibido', data.origin);
  return db.prepare('SELECT * FROM sales_orders WHERE id = ?').get(info.lastInsertRowid);
}

async function createOp(so, quotation, fields) {
  const n = await P.nextOpNumber();
  const service = velaraServices.findService(quotation?.service_slug || fields.service_slug);
  const info = await db
    .prepare(
      `INSERT INTO production_orders (number, year, seq, sales_order_id, product_name, product_code, service_slug, quantity, unit, received_at, requested_date, committed_date, start_date, priority, responsible_worker_id, advisor_id, observations)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      n.number, n.year, n.seq, so.id, fields.product_name || service?.title || 'Trabajo', fields.product_code || null, service?.slug || null,
      fields.quantity || 1, fields.unit || 'und', so.received_at, fields.requested_date || null, fields.committed_date || null,
      fields.start_date || null, fields.priority || 'normal', fields.worker || null, so.advisor_id, fields.observations || null
    );
  const opId = info.lastInsertRowid;
  let pos = 0;
  if (quotation && service) {
    for (const f of service.fields) {
      const v = quotation.service_fields?.[f.key];
      if (v) await db.prepare("INSERT INTO production_specs (op_id, section, label, value, position) VALUES (?, 'producto', ?, ?, ?)").run(opId, f.label, String(v), pos++);
    }
  }
  for (const [label, value] of fields.product_specs || []) {
    await db.prepare("INSERT INTO production_specs (op_id, section, label, value, position) VALUES (?, 'producto', ?, ?, ?)").run(opId, label, value, pos++);
  }
  let tpos = 0;
  for (const [label, value] of fields.tech || []) {
    await db.prepare("INSERT INTO production_specs (op_id, section, label, value, position) VALUES (?, 'tecnica', ?, ?, ?)").run(opId, label, value, tpos++);
  }
  await P.log('op', opId, null, 'OP creada', `${n.number} del pedido ${so.number}`);
  if (fields.worker) {
    const w = await db.prepare('SELECT name FROM workers WHERE id = ?').get(fields.worker);
    await P.log('op', opId, null, `OP asignada a ${w.name}`);
  }
  await db.prepare("UPDATE sales_orders SET status = 'validado' WHERE id = ?").run(so.id);
  await P.log('pedido', so.id, null, `OP ${n.number} creada; pedido validado`);
  return opId;
}

async function addTasks(opId, workers, done) {
  for (const [i, name] of P.DEFAULT_TASKS.entries()) {
    const status = i < done ? 'completada' : i === done ? 'en_proceso' : 'pendiente';
    await db
      .prepare(
        `INSERT INTO production_tasks (op_id, name, worker_id, planned_date, status, started_at, finished_at, position)
         VALUES (?, ?, ?, ?, ?, CASE WHEN ? != 'pendiente' THEN datetime('now', '-1 days') END, CASE WHEN ? = 'completada' THEN datetime('now', '-3 hours') END, ?)`
      )
      .run(opId, name, workers[i % workers.length], P.todayBogota(i - 1), status, status, status, i);
  }
}

async function addRequirements(opId, list, requestFirst) {
  for (const [i, [material, qty, unit, status]] of list.entries()) {
    const info = await db.prepare('INSERT INTO material_requirements (op_id, material, qty, unit, status) VALUES (?, ?, ?, ?, ?)').run(opId, material, qty, unit, status || 'disponible');
    if (requestFirst && i === 0) {
      const number = await P.nextRequestNumber();
      await db.prepare('INSERT INTO material_requests (number, op_id, requirement_id, material, qty, unit) VALUES (?, ?, ?, ?, ?, ?)').run(number, opId, info.lastInsertRowid, material, qty, unit);
      await db.prepare("UPDATE material_requirements SET status = 'solicitado' WHERE id = ?").run(info.lastInsertRowid);
      await P.log('op', opId, null, `Solicitud de material ${number}`, `${material} · ${qty} ${unit}`);
    }
  }
}

async function addDesign(opId) {
  if (!fs.existsSync(SAMPLE_DESIGN)) return;
  const dir = path.join(UPLOAD_ROOT, 'op', String(opId));
  fs.mkdirSync(dir, { recursive: true });
  for (const v of [1, 2]) {
    const dest = path.join(dir, `ejemplo-diseno-v${v}.png`);
    fs.copyFileSync(SAMPLE_DESIGN, dest);
    await db.prepare('UPDATE production_files SET is_current = 0 WHERE op_id = ? AND group_name = ?').run(opId, 'Diseño principal');
    await db
      .prepare("INSERT INTO production_files (op_id, kind, group_name, version, is_current, original_name, stored_path, mime, size, note) VALUES (?, 'diseno', 'Diseño principal', ?, 1, ?, ?, 'image/png', ?, ?)")
      .run(opId, v, `Diseño cuero negro costuras ámbar v${v}.png`, path.relative(UPLOAD_ROOT, dest), fs.statSync(dest).size, v === 1 ? 'Propuesta inicial' : 'Ajuste: costura doble en el espaldar');
    await P.log('op', opId, null, `Diseño cargado: Diseño principal v${v}`);
  }
}

async function approve(opId, name) {
  await db
    .prepare('INSERT INTO production_approvals (op_id, advisor_id, signed_name, confirm_features, confirm_quantities, confirm_design, notes) SELECT id, advisor_id, ?, 1, 1, 1, ? FROM production_orders WHERE id = ?')
    .run(name, 'Aprobado con el cliente por WhatsApp (ejemplo)', opId);
  await P.log('op', opId, null, `Aprobación comercial: ${name}`, 'Confirma características, cantidades y diseño');
}

async function review(opId, result, notes) {
  await db
    .prepare('INSERT INTO production_reviews (op_id, result, checklist, notes) VALUES (?, ?, ?, ?)')
    .run(opId, result, JSON.stringify({ producto: true, cantidad: true, medidas: true, caracteristicas: true, acabados: true, diseno: true }), notes || null);
  await P.log('op', opId, null, result === 'aprobado' ? 'Control / revisión: aprobado' : 'Control / revisión: requiere corrección', notes || null);
}

async function main() {
  await init();
  if ((await db.prepare('SELECT COUNT(*) AS c FROM sales_orders').get()).c > 0) {
    console.log('Ya hay pedidos en la base -- no se cargó nada para no mezclar datos.');
    return;
  }
  const workers = (await db.prepare('SELECT id FROM workers WHERE active = 1 ORDER BY id').all()).map((w) => w.id);
  if (!workers.length) {
    console.log('No hay operarios: corre primero scripts/seed-erp.js');
    return;
  }
  const qIds = (await db.prepare("SELECT id FROM quotations WHERE state IN ('sale', 'aprobada') ORDER BY id").all()).map((q) => q.id);
  const quotations = [];
  for (const id of qIds) quotations.push(await nativeQuotes.readQuotation(id));
  const T = P.todayBogota;
  let qi = 0;
  const nextQ = () => quotations[qi++] || null;
  const go = (id, to, payload = {}) => P.transition(id, to, SYSTEM, payload);

  // 1. Ejemplo de la especificación: pedido manual, OP por validar (falta responsable).
  const so1 = await createOrder({ manual: { client_name: 'Gimnasio PowerFit', contact: 'Andrea Rincón', phone: '3005551234', address: 'Cra 51B # 84-120', destination: 'Barranquilla', product_summary: 'Forros para equipos × 12', requested_date: T(5) } });
  await createOp(so1, null, { product_name: 'Forros para equipos', product_code: 'FOR-EQ', quantity: 12, unit: 'und', requested_date: T(5), committed_date: T(5), service_slug: 'forros', product_specs: [['Material', 'Tela técnica deportiva'], ['Color', 'Negro con logo naranja']], tech: [['Medidas', 'Según plantilla de cada máquina (12 moldes)'], ['Instrucciones especiales', 'Logo bordado en el costado']] });

  // 2. Pedido manual con información solicitada (sin OP todavía).
  const so2 = await createOrder({ manual: { client_name: 'Restaurante Brasa Viva', phone: '3017778899', product_summary: 'Toldo para terraza', requested_date: T(12) } });
  await db.prepare("UPDATE sales_orders SET status = 'info_solicitada', info_request = ? WHERE id = ?").run('Medidas exactas de la terraza y color del toldo', so2.id);
  await P.log('pedido', so2.id, null, 'Información solicitada', 'Medidas exactas de la terraza y color del toldo');

  // 3. Pedido recién recibido desde cotización, por validar (sin OP).
  const q3 = nextQ();
  if (q3) await createOrder({ quotation: q3 });

  // 4..11: OP desde cotizaciones en cada estado.
  const plan = [
    { to: 'programada', days: 6, prio: 'normal' },
    { to: 'en_produccion', days: 3, prio: 'alta', done: 2 },
    { to: 'pausada', days: 2, prio: 'normal', done: 1, block: true },
    { to: 'en_produccion', days: -1, prio: 'urgente', done: 3 },
    { to: 'control', days: 1, prio: 'normal', done: 5 },
    { to: 'lista', days: 0, prio: 'normal', done: 5 },
    { to: 'entregada', days: -3, prio: 'normal', done: 5, claim: true },
    { to: 'cerrada', days: -8, prio: 'baja', done: 5 },
  ];
  let created = 1;
  for (const [i, step] of plan.entries()) {
    const q = nextQ();
    if (!q) break;
    const so = await createOrder({ quotation: q });
    const opId = await createOp(so, q, {
      quantity: q.lines.reduce((s, l) => s + (Number(l.qty) || 0), 0) || 1,
      requested_date: T(step.days),
      committed_date: T(step.days),
      priority: step.prio,
      worker: workers[i % workers.length],
      tech: [['Costura', 'Doble pespunte, hilo nylon calibre 40'], ['Acabados', 'Bordes ribeteados']],
    });
    created++;
    await addRequirements(opId, [['Cuero sintético premium negro', 6.5, 'm', step.block ? 'bloqueado' : 'disponible'], ['Espuma alta densidad 2 cm', 2, 'm2'], ['Hilo de nylon calibre 40', 1, 'rollo']], step.block || i === 1);
    if (i === 1 || i === 4) await addDesign(opId);
    await go(opId, 'programada');
    if (step.to === 'programada') continue;
    await addTasks(opId, workers, step.done ?? 0);
    await go(opId, 'en_produccion');
    if (step.block) {
      await P.addBlock(opId, SYSTEM, { reason: 'material_pendiente', responsible: 'Compras', notes: 'Pendiente cuero sintético premium negro (6,5 m)' });
      continue;
    }
    if (step.to === 'en_produccion') continue;
    await go(opId, 'control');
    if (step.to === 'control') continue;
    await review(opId, 'aprobado', 'Costuras y medidas conformes');
    await approve(opId, 'Asesor comercial (ejemplo)');
    await go(opId, 'lista', { responsible: 'Jefe de producción', authorized_by: 'Coordinación' });
    if (step.to === 'lista') continue;
    await go(opId, 'entregada', { responsible: 'Luis Barrios', received_by: 'Cliente (ejemplo)', notes: 'Entregado en el taller' });
    await db.prepare("UPDATE production_orders SET delivered_at = datetime('now', ?) WHERE id = ?").run(`${step.days} days`, opId);
    if (step.claim) {
      await db.prepare("INSERT INTO warranty_claims (production_order_id, description, reported_at) VALUES (?, ?, datetime('now', '-1 days'))").run(opId, 'Se soltó una costura del espaldar a los pocos días de uso.');
      await P.log('op', opId, null, 'Reclamo de garantía', 'Se soltó una costura del espaldar a los pocos días de uso.');
    }
    if (step.to === 'entregada') continue;
    await go(opId, 'cerrada');
  }
  const counts = await db.prepare('SELECT status, COUNT(*) AS c FROM production_orders GROUP BY status').all();
  console.log(`Producción: ${created} OP creadas.`);
  console.log('  Por estado:', counts.map((c) => `${P.STATUS_LABEL[c.status]} ${c.c}`).join(' · '));
  console.log(`  Pedidos: ${(await db.prepare('SELECT COUNT(*) AS c FROM sales_orders').get()).c}`);
  if (!fs.existsSync(SAMPLE_DESIGN)) console.log('  (no se encontró la imagen de ejemplo del diseño; las OP quedan sin archivo)');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
