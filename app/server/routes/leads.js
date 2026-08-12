const express = require('express');
const { db } = require('../db');
const sla = require('../sla');
const followup = require('../followup');
const { broadcast } = require('../realtime');
const { requireRole } = require('../middleware/auth');

const router = express.Router();

// Un asesor solo puede operar sobre sus propios leads; coordinador y admin
// operan sobre cualquiera. Se usa en las acciones de un solo lead (marcar
// contactado/cotizado, cerrar) donde un asesor sigue teniendo permiso, pero
// solo sobre lo suyo.
function canOperateOn(user, lead) {
  if (user.role !== 'asesor') return true;
  return lead.assigned_advisor_id === user.advisor_id;
}

function nowUtc() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

// Colombia es UTC-5 todo el año (sin horario de verano). El resto del
// sistema guarda todo en UTC (ver sla.js), asi que una fecha/hora que el
// usuario escribe a mano (hora de Colombia, para registrar algo atrasado)
// se convierte sumando 5h, sin depender de la zona horaria del servidor.
const COLOMBIA_UTC_OFFSET_HOURS = 5;

/**
 * Convierte un datetime-local del navegador ("YYYY-MM-DDTHH:MM" u
 * opcionalmente con segundos) a "YYYY-MM-DD HH:MM:SS" UTC. Devuelve null si
 * value es vacio/ausente (para poder usar "no vino nada, usa ahora"), y
 * lanza un Error legible si vino algo pero no es una fecha valida.
 */
function parseBackdatedInput(value) {
  if (value === undefined || value === null || value === '') return null;
  const normalized = String(value).trim().replace('T', ' ');
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})(?::(\d{2}))?$/.exec(normalized);
  if (!m) throw new Error('Fecha inválida');
  const [, y, mo, d, h, mi, s] = m;
  const utcMs = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h) + COLOMBIA_UTC_OFFSET_HOURS, Number(mi), Number(s || 0));
  const dt = new Date(utcMs);
  if (Number.isNaN(dt.getTime())) throw new Error('Fecha inválida');
  if (dt.getTime() > Date.now() + 60000) throw new Error('La fecha no puede ser en el futuro');
  return dt.toISOString().replace('T', ' ').slice(0, 19);
}

function predictLeadScore(lead, advisorRate = 0) {
  if (!lead) return 0;
  if (lead.status === 'cerrado_ganado') return 100;
  if (lead.status === 'cerrado_perdido') return 5;

  let score = 20;
  if (lead.status === 'contactado') score = 45;
  else if (lead.status === 'cotizado') score = 70;
  else if (lead.status === 'asignado') score = 30;

  const sourceBonus = {
    WhatsApp: 8,
    Correo: 6,
    Llamada: 10,
    Orgánico: 9,
    Referido: 12,
    Otro: 4,
  };
  score += sourceBonus[lead.source] || 0;

  if (lead.product === 'Carpas') score += 5;
  if (lead.product === 'Gramas') score += 3;
  if (lead.product === 'Baby Gym') score += 4;

  if (lead.followup_count >= 2) score += 6;
  if (lead.reassigned_count > 0) score -= Math.min(10, lead.reassigned_count * 4);
  if (lead.amount && lead.amount >= 1000000) score += 5;

  if (lead.created_at) {
    const created = new Date(lead.created_at.replace(' ', 'T') + 'Z');
    const ageDays = Math.max(0, Math.floor((Date.now() - created.getTime()) / 86400000));
    if (ageDays <= 2 && lead.status === 'asignado') score += 8;
    if (ageDays > 7 && lead.status === 'asignado') score -= 8;
    if (ageDays > 14 && lead.status === 'contactado') score -= 4;
  }

  score += Math.round(Math.max(0, Math.min(1, advisorRate)) * 20);
  score = Math.round(score);
  if (score < 5) score = 5;
  if (score > 95) score = 95;
  return score;
}

async function serialize(lead, advisorRate = 0) {
  const advisor = lead.assigned_advisor_id
    ? await db.prepare('SELECT id, name, is_group FROM advisors WHERE id = ?').get(lead.assigned_advisor_id)
    : null;
  return {
    ...lead,
    advisor_name: advisor ? advisor.name : null,
    sla_status: sla.slaStatus(lead),
    elapsed_label: lead.status.startsWith('cerrado')
      ? sla.formatElapsed(lead.created_at, sla.parseUtc(lead.closed_at || lead.created_at))
      : sla.formatElapsed(lead.created_at),
    remaining_label: lead.status.startsWith('cerrado') ? null : sla.remainingLabel(lead),
    followup_status: followup.followupStatus(lead),
    followup_elapsed_label: followup.followupElapsedLabel(lead),
    predicted_score: predictLeadScore(lead, advisorRate),
  };
}

router.get('/', async (req, res) => {
  const { status, critical_only, followup_only, advisor_id, product, source, channel_detail, city, from, to, closed_from, closed_to, q } = req.query;

  const conditions = [];
  const params = [];
  if (status) {
    conditions.push('status = ?');
    params.push(status);
  }
  if (q && q.trim()) {
    const term = q.trim();
    const like = `%${term}%`;
    if (/^\d+$/.test(term)) {
      conditions.push('(id = ? OR client_name LIKE ? OR phone LIKE ? OR document LIKE ?)');
      params.push(Number(term), like, like, like);
    } else {
      conditions.push('(client_name LIKE ? OR phone LIKE ? OR document LIKE ?)');
      params.push(like, like, like);
    }
  }
  if (req.user.role === 'asesor') {
    // Un asesor solo ve lo suyo, sin importar que filtro le manden desde el
    // cliente: se ignora cualquier advisor_id ajeno en vez de confiar en el.
    conditions.push('assigned_advisor_id = ?');
    params.push(req.user.advisor_id);
  } else if (advisor_id) {
    conditions.push('assigned_advisor_id = ?');
    params.push(Number(advisor_id));
  }
  if (product) {
    conditions.push('product = ?');
    params.push(product);
  }
  if (source) {
    conditions.push('source = ?');
    params.push(source);
  }
  if (channel_detail) {
    conditions.push('channel_detail = ?');
    params.push(channel_detail);
  }
  if (city) {
    conditions.push('city = ?');
    params.push(city);
  }
  if (from) {
    conditions.push('created_at >= ?');
    params.push(`${from} 00:00:00`);
  }
  if (to) {
    conditions.push('created_at <= ?');
    params.push(`${to} 23:59:59`);
  }
  // Rango sobre closed_at, aparte de from/to (creado): para reportes de
  // ventas concretadas (Ventas Cerradas) el rango que importa es cuando se
  // cerro, no cuando entro el lead -- distinto criterio del que ya usan
  // from/to en Registro Operativo/SLA/Seguimiento (esos si son por creacion).
  if (closed_from) {
    conditions.push('closed_at >= ?');
    params.push(`${closed_from} 00:00:00`);
  }
  if (closed_to) {
    conditions.push('closed_at <= ?');
    params.push(`${closed_to} 23:59:59`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const advisorStats = await db
    .prepare(`
      SELECT assigned_advisor_id,
             COUNT(*) AS total,
             SUM(CASE WHEN status = 'cerrado_ganado' THEN 1 ELSE 0 END) AS won
      FROM leads
      WHERE assigned_advisor_id IS NOT NULL
      GROUP BY assigned_advisor_id
    `)
    .all();
  const advisorRates = new Map();
  let totalWon = 0;
  let totalLeads = 0;
  advisorStats.forEach((row) => {
    advisorRates.set(row.assigned_advisor_id, row.total ? row.won / row.total : 0);
    totalWon += row.won;
    totalLeads += row.total;
  });
  const avgAdvisorRate = totalLeads ? totalWon / totalLeads : 0.15;

  const rows = await db.prepare(`SELECT * FROM leads ${where} ORDER BY created_at DESC`).all(...params);
  let serialized = await Promise.all(rows.map((row) => serialize(row, advisorRates.get(row.assigned_advisor_id) ?? avgAdvisorRate)));
  if (critical_only === '1') {
    serialized = serialized.filter((l) => l.sla_status === 'riesgo' || l.sla_status === 'vencido');
  }
  if (followup_only === '1') {
    serialized = serialized.filter((l) => l.followup_status === 'pendiente' || l.followup_status === 'urgente');
  }
  res.json(serialized);
});

router.get('/:id', async (req, res) => {
  const lead = await db.prepare('SELECT * FROM leads WHERE id = ?').get(Number(req.params.id));
  if (!lead) return res.status(404).json({ error: 'Lead no encontrado' });
  if (!canOperateOn(req.user, lead)) return res.status(403).json({ error: 'No tienes permiso para ver este lead' });
  const advisorStat = lead.assigned_advisor_id
    ? await db
        .prepare(
          `SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'cerrado_ganado' THEN 1 ELSE 0 END) AS won FROM leads WHERE assigned_advisor_id = ?`
        )
        .get(lead.assigned_advisor_id)
    : null;
  const advisorRate = advisorStat && advisorStat.total ? advisorStat.won / advisorStat.total : 0.15;
  res.json(await serialize(lead, advisorRate));
});

const DEFAULT_SOURCE = 'WhatsApp';
const DEFAULT_CHANNEL_DETAIL = 'Google Ads';

router.post('/', requireRole('coordinador', 'admin'), async (req, res) => {
  const { client_name, phone, document, product, notes, advisor_id, source, channel_detail, city, created_at, client_id } = req.body || {};
  if (!client_name || !client_name.trim()) return res.status(400).json({ error: 'client_name es requerido' });
  if (!phone || !phone.trim()) return res.status(400).json({ error: 'phone es requerido' });
  const advisor = await db.prepare('SELECT * FROM advisors WHERE id = ? AND active = true').get(Number(advisor_id));
  if (!advisor) return res.status(400).json({ error: 'Selecciona un asesor activo para asignar el lead' });
  let client = null;
  if (client_id) {
    client = await db.prepare('SELECT * FROM clients WHERE id = ?').get(Number(client_id));
    if (!client) return res.status(400).json({ error: 'Cliente invalido' });
  }

  let now;
  try {
    now = parseBackdatedInput(created_at) || nowUtc();
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  const info = await db
    .prepare(
      `INSERT INTO leads (client_name, phone, document, product, notes, status, assigned_advisor_id, source, channel_detail, city, created_at, client_id)
       VALUES (?, ?, ?, ?, ?, 'asignado', ?, ?, ?, ?, ?, ?)`
    )
    .run(
      client_name.trim(),
      phone.trim(),
      document || null,
      product || null,
      notes || null,
      advisor.id,
      (source && source.trim()) || DEFAULT_SOURCE,
      (channel_detail && channel_detail.trim()) || DEFAULT_CHANNEL_DETAIL,
      (city && city.trim()) || null,
      now,
      client ? client.id : null
    );

  const lead = await db.prepare('SELECT * FROM leads WHERE id = ?').get(info.lastInsertRowid);
  broadcast('leads_changed', { reason: 'created', id: lead.id });
  res.status(201).json(await serialize(lead));
});

router.post('/:id/assign', requireRole('coordinador', 'admin'), async (req, res) => {
  const id = Number(req.params.id);
  const lead = await db.prepare('SELECT * FROM leads WHERE id = ?').get(id);
  if (!lead) return res.status(404).json({ error: 'Lead no encontrado' });
  const { advisor_id } = req.body || {};
  const advisor = await db.prepare('SELECT * FROM advisors WHERE id = ?').get(Number(advisor_id));
  if (!advisor) return res.status(400).json({ error: 'Asesor invalido' });

  await db.prepare("UPDATE leads SET assigned_advisor_id = ?, status = 'asignado' WHERE id = ?").run(advisor.id, id);

  broadcast('leads_changed', { reason: 'assigned', id });
  res.json(await serialize(await db.prepare('SELECT * FROM leads WHERE id = ?').get(id)));
});

router.patch('/:id/contact', async (req, res) => {
  const id = Number(req.params.id);
  const lead = await db.prepare('SELECT * FROM leads WHERE id = ?').get(id);
  if (!lead) return res.status(404).json({ error: 'Lead no encontrado' });
  if (!canOperateOn(req.user, lead)) return res.status(403).json({ error: 'No tienes permiso sobre este lead' });
  if (lead.status !== 'asignado') {
    return res.status(409).json({ error: 'Solo se puede marcar como contactado un lead en estado "asignado"' });
  }

  let now;
  try {
    now = parseBackdatedInput((req.body || {}).at) || nowUtc();
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  if (now < lead.created_at) return res.status(400).json({ error: 'La fecha no puede ser anterior al registro del lead' });
  await db.prepare("UPDATE leads SET status = 'contactado', contacted_at = ? WHERE id = ?").run(now, id);

  const updated = await db.prepare('SELECT * FROM leads WHERE id = ?').get(id);
  broadcast('leads_changed', { reason: 'contacted', id });
  res.json(await serialize(updated));
});

router.patch('/:id/quote', async (req, res) => {
  const id = Number(req.params.id);
  const lead = await db.prepare('SELECT * FROM leads WHERE id = ?').get(id);
  if (!lead) return res.status(404).json({ error: 'Lead no encontrado' });
  if (!canOperateOn(req.user, lead)) return res.status(403).json({ error: 'No tienes permiso sobre este lead' });
  if (!['asignado', 'contactado'].includes(lead.status)) {
    return res.status(409).json({ error: 'Solo se puede cotizar un lead en estado "asignado" o "contactado"' });
  }

  let now;
  try {
    now = parseBackdatedInput((req.body || {}).at) || nowUtc();
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  if (now < lead.created_at) return res.status(400).json({ error: 'La fecha no puede ser anterior al registro del lead' });
  await db
    .prepare("UPDATE leads SET status = 'cotizado', quoted_at = ?, contacted_at = COALESCE(contacted_at, ?) WHERE id = ?")
    .run(now, now, id);

  const updated = await db.prepare('SELECT * FROM leads WHERE id = ?').get(id);
  broadcast('leads_changed', { reason: 'quoted', id });
  res.json(await serialize(updated));
});

// Registrar que se le dio seguimiento a una cotizacion enviada (se le
// insistio al cliente). Reinicia el reloj de "leads en riesgo de enfriarse"
// sin cambiar el estado del embudo.
router.post('/:id/followup', async (req, res) => {
  const id = Number(req.params.id);
  const lead = await db.prepare('SELECT * FROM leads WHERE id = ?').get(id);
  if (!lead) return res.status(404).json({ error: 'Lead no encontrado' });
  if (!canOperateOn(req.user, lead)) return res.status(403).json({ error: 'No tienes permiso sobre este lead' });
  if (lead.status !== 'cotizado') {
    return res.status(409).json({ error: 'Solo se puede registrar seguimiento a un lead en estado "cotizado"' });
  }

  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  await db.prepare('UPDATE leads SET last_followup_at = ?, followup_count = followup_count + 1 WHERE id = ?').run(now, id);

  const updated = await db.prepare('SELECT * FROM leads WHERE id = ?').get(id);
  broadcast('leads_changed', { reason: 'followup', id });
  res.json(await serialize(updated));
});

router.post('/:id/reassign', requireRole('coordinador', 'admin'), async (req, res) => {
  const id = Number(req.params.id);
  const lead = await db.prepare('SELECT * FROM leads WHERE id = ?').get(id);
  if (!lead) return res.status(404).json({ error: 'Lead no encontrado' });
  const { to_advisor_id, reason, at } = req.body || {};
  const toAdvisor = await db.prepare('SELECT * FROM advisors WHERE id = ?').get(Number(to_advisor_id));
  if (!toAdvisor) return res.status(400).json({ error: 'Asesor destino invalido' });

  let when;
  try {
    when = parseBackdatedInput(at) || nowUtc();
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  if (when < lead.created_at) return res.status(400).json({ error: 'La fecha no puede ser anterior al registro del lead' });

  const fromAdvisorId = lead.assigned_advisor_id;
  const tx = db.transaction(async () => {
    // No se toca status/contacted_at/quoted_at: una reasignacion es solo un
    // cambio de dueño del lead, el progreso del embudo (contactado/cotizado)
    // ya alcanzado se conserva para el nuevo asesor.
    await db
      .prepare('UPDATE leads SET assigned_advisor_id = ?, reassigned_count = reassigned_count + 1 WHERE id = ?')
      .run(toAdvisor.id, id);
    await db
      .prepare('INSERT INTO reassignments (lead_id, from_advisor_id, to_advisor_id, reason, penalty_points, at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, fromAdvisorId, toAdvisor.id, reason || 'Reasignacion manual', 5, when);
  });
  await tx();

  broadcast('leads_changed', { reason: 'reassigned', id });
  broadcast('advisors_changed', { reason: 'penalty', id: fromAdvisorId });
  res.json(await serialize(await db.prepare('SELECT * FROM leads WHERE id = ?').get(id)));
});

router.post('/:id/close', async (req, res) => {
  const id = Number(req.params.id);
  const lead = await db.prepare('SELECT * FROM leads WHERE id = ?').get(id);
  if (!lead) return res.status(404).json({ error: 'Lead no encontrado' });
  if (!canOperateOn(req.user, lead)) return res.status(403).json({ error: 'No tienes permiso sobre este lead' });
  const { result, amount, at } = req.body || {};
  if (!['ganado', 'perdido'].includes(result)) return res.status(400).json({ error: 'result debe ser ganado|perdido' });
  if (lead.status.startsWith('cerrado')) {
    return res.status(409).json({ error: 'Este lead ya esta cerrado' });
  }

  let now;
  try {
    now = parseBackdatedInput(at) || nowUtc();
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  if (now < lead.created_at) return res.status(400).json({ error: 'La fecha no puede ser anterior al registro del lead' });
  await db
    .prepare('UPDATE leads SET status = ?, closed_at = ?, amount = ? WHERE id = ?')
    .run(
      result === 'ganado' ? 'cerrado_ganado' : 'cerrado_perdido',
      now,
      result === 'ganado' ? Number(amount) || 0 : 0,
      id
    );

  const closedLead = await db.prepare('SELECT * FROM leads WHERE id = ?').get(id);
  broadcast('leads_changed', { reason: 'closed', id });
  if (result === 'ganado') {
    broadcast('sale_closed', {
      lead_id: id,
      client_name: closedLead.client_name,
      product: closedLead.product,
      advisor_id: closedLead.assigned_advisor_id,
    });
  }
  res.json(await serialize(closedLead));
});

// --- Abonos (pagos parciales) -------------------------------------------
// Se registran contra un pedido/lead especifico (asi se sabe a que venta
// corresponde cada pago); la ficha del cliente (ver routes/clients.js) los
// agrega de todos sus pedidos para mostrar el saldo pendiente.

router.get('/:id/payments', async (req, res) => {
  const id = Number(req.params.id);
  const lead = await db.prepare('SELECT * FROM leads WHERE id = ?').get(id);
  if (!lead) return res.status(404).json({ error: 'Lead no encontrado' });
  if (!canOperateOn(req.user, lead)) return res.status(403).json({ error: 'No tienes permiso sobre este lead' });
  const payments = await db.prepare('SELECT * FROM payments WHERE lead_id = ? ORDER BY paid_at DESC').all(id);
  res.json(payments);
});

router.post('/:id/payments', async (req, res) => {
  const id = Number(req.params.id);
  const lead = await db.prepare('SELECT * FROM leads WHERE id = ?').get(id);
  if (!lead) return res.status(404).json({ error: 'Lead no encontrado' });
  if (!canOperateOn(req.user, lead)) return res.status(403).json({ error: 'No tienes permiso sobre este lead' });
  const { amount, notes } = req.body || {};
  const amountNum = Number(amount);
  if (!amountNum || amountNum <= 0) return res.status(400).json({ error: 'amount debe ser mayor a 0' });

  let paidAt;
  try {
    paidAt = parseBackdatedInput((req.body || {}).paid_at) || nowUtc();
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  const info = await db
    .prepare('INSERT INTO payments (lead_id, amount, paid_at, notes, registered_by) VALUES (?, ?, ?, ?, ?)')
    .run(id, amountNum, paidAt, (notes && notes.trim()) || null, req.user.id || null);

  const payment = await db.prepare('SELECT * FROM payments WHERE id = ?').get(info.lastInsertRowid);
  broadcast('leads_changed', { reason: 'payment_registered', id });
  res.status(201).json(payment);
});

module.exports = router;
