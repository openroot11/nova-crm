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

function serialize(lead) {
  const advisor = lead.assigned_advisor_id
    ? db.prepare('SELECT id, name, is_group FROM advisors WHERE id = ?').get(lead.assigned_advisor_id)
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
  };
}

router.get('/', (req, res) => {
  const { status, critical_only, followup_only, advisor_id, product, source, channel_detail, from, to, q } = req.query;

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
  if (from) {
    conditions.push('created_at >= ?');
    params.push(`${from} 00:00:00`);
  }
  if (to) {
    conditions.push('created_at <= ?');
    params.push(`${to} 23:59:59`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  let rows = db.prepare(`SELECT * FROM leads ${where} ORDER BY created_at DESC`).all(...params);
  let serialized = rows.map(serialize);
  if (critical_only === '1') {
    serialized = serialized.filter((l) => l.sla_status === 'riesgo' || l.sla_status === 'vencido');
  }
  if (followup_only === '1') {
    serialized = serialized.filter((l) => l.followup_status === 'pendiente' || l.followup_status === 'urgente');
  }
  res.json(serialized);
});

router.get('/:id', (req, res) => {
  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(Number(req.params.id));
  if (!lead) return res.status(404).json({ error: 'Lead no encontrado' });
  if (!canOperateOn(req.user, lead)) return res.status(403).json({ error: 'No tienes permiso para ver este lead' });
  res.json(serialize(lead));
});

const DEFAULT_SOURCE = 'WhatsApp';
const DEFAULT_CHANNEL_DETAIL = 'Google Ads';

router.post('/', requireRole('coordinador', 'admin'), (req, res) => {
  const { client_name, phone, document, product, notes, advisor_id, source, channel_detail } = req.body || {};
  if (!client_name || !client_name.trim()) return res.status(400).json({ error: 'client_name es requerido' });
  if (!phone || !phone.trim()) return res.status(400).json({ error: 'phone es requerido' });
  const advisor = db.prepare('SELECT * FROM advisors WHERE id = ? AND active = 1').get(Number(advisor_id));
  if (!advisor) return res.status(400).json({ error: 'Selecciona un asesor activo para asignar el lead' });

  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const info = db
    .prepare(
      `INSERT INTO leads (client_name, phone, document, product, notes, status, assigned_advisor_id, source, channel_detail, created_at)
       VALUES (?, ?, ?, ?, ?, 'asignado', ?, ?, ?, ?)`
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
      now
    );

  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(info.lastInsertRowid);
  broadcast('leads_changed', { reason: 'created', id: lead.id });
  res.status(201).json(serialize(lead));
});

router.post('/:id/assign', requireRole('coordinador', 'admin'), (req, res) => {
  const id = Number(req.params.id);
  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(id);
  if (!lead) return res.status(404).json({ error: 'Lead no encontrado' });
  const { advisor_id } = req.body || {};
  const advisor = db.prepare('SELECT * FROM advisors WHERE id = ?').get(Number(advisor_id));
  if (!advisor) return res.status(400).json({ error: 'Asesor invalido' });

  db.prepare("UPDATE leads SET assigned_advisor_id = ?, status = 'asignado' WHERE id = ?").run(advisor.id, id);

  broadcast('leads_changed', { reason: 'assigned', id });
  res.json(serialize(db.prepare('SELECT * FROM leads WHERE id = ?').get(id)));
});

router.patch('/:id/contact', (req, res) => {
  const id = Number(req.params.id);
  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(id);
  if (!lead) return res.status(404).json({ error: 'Lead no encontrado' });
  if (!canOperateOn(req.user, lead)) return res.status(403).json({ error: 'No tienes permiso sobre este lead' });
  if (lead.status !== 'asignado') {
    return res.status(409).json({ error: 'Solo se puede marcar como contactado un lead en estado "asignado"' });
  }

  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  db.prepare("UPDATE leads SET status = 'contactado', contacted_at = ? WHERE id = ?").run(now, id);

  const updated = db.prepare('SELECT * FROM leads WHERE id = ?').get(id);
  broadcast('leads_changed', { reason: 'contacted', id });
  res.json(serialize(updated));
});

router.patch('/:id/quote', (req, res) => {
  const id = Number(req.params.id);
  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(id);
  if (!lead) return res.status(404).json({ error: 'Lead no encontrado' });
  if (!canOperateOn(req.user, lead)) return res.status(403).json({ error: 'No tienes permiso sobre este lead' });
  if (!['asignado', 'contactado'].includes(lead.status)) {
    return res.status(409).json({ error: 'Solo se puede cotizar un lead en estado "asignado" o "contactado"' });
  }

  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  db.prepare(
    "UPDATE leads SET status = 'cotizado', quoted_at = ?, contacted_at = COALESCE(contacted_at, ?) WHERE id = ?"
  ).run(now, now, id);

  const updated = db.prepare('SELECT * FROM leads WHERE id = ?').get(id);
  broadcast('leads_changed', { reason: 'quoted', id });
  res.json(serialize(updated));
});

// Registrar que se le dio seguimiento a una cotizacion enviada (se le
// insistio al cliente). Reinicia el reloj de "leads en riesgo de enfriarse"
// sin cambiar el estado del embudo.
router.post('/:id/followup', (req, res) => {
  const id = Number(req.params.id);
  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(id);
  if (!lead) return res.status(404).json({ error: 'Lead no encontrado' });
  if (!canOperateOn(req.user, lead)) return res.status(403).json({ error: 'No tienes permiso sobre este lead' });
  if (lead.status !== 'cotizado') {
    return res.status(409).json({ error: 'Solo se puede registrar seguimiento a un lead en estado "cotizado"' });
  }

  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  db.prepare('UPDATE leads SET last_followup_at = ?, followup_count = followup_count + 1 WHERE id = ?').run(now, id);

  const updated = db.prepare('SELECT * FROM leads WHERE id = ?').get(id);
  broadcast('leads_changed', { reason: 'followup', id });
  res.json(serialize(updated));
});

router.post('/:id/reassign', requireRole('coordinador', 'admin'), (req, res) => {
  const id = Number(req.params.id);
  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(id);
  if (!lead) return res.status(404).json({ error: 'Lead no encontrado' });
  const { to_advisor_id, reason } = req.body || {};
  const toAdvisor = db.prepare('SELECT * FROM advisors WHERE id = ?').get(Number(to_advisor_id));
  if (!toAdvisor) return res.status(400).json({ error: 'Asesor destino invalido' });

  const fromAdvisorId = lead.assigned_advisor_id;
  const tx = db.transaction(() => {
    // No se toca status/contacted_at/quoted_at: una reasignacion es solo un
    // cambio de dueño del lead, el progreso del embudo (contactado/cotizado)
    // ya alcanzado se conserva para el nuevo asesor.
    db.prepare(
      'UPDATE leads SET assigned_advisor_id = ?, reassigned_count = reassigned_count + 1 WHERE id = ?'
    ).run(toAdvisor.id, id);
    db.prepare(
      'INSERT INTO reassignments (lead_id, from_advisor_id, to_advisor_id, reason, penalty_points) VALUES (?, ?, ?, ?, ?)'
    ).run(id, fromAdvisorId, toAdvisor.id, reason || 'Reasignacion manual', 5);
  });
  tx();

  broadcast('leads_changed', { reason: 'reassigned', id });
  broadcast('advisors_changed', { reason: 'penalty', id: fromAdvisorId });
  res.json(serialize(db.prepare('SELECT * FROM leads WHERE id = ?').get(id)));
});

router.post('/:id/close', (req, res) => {
  const id = Number(req.params.id);
  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(id);
  if (!lead) return res.status(404).json({ error: 'Lead no encontrado' });
  if (!canOperateOn(req.user, lead)) return res.status(403).json({ error: 'No tienes permiso sobre este lead' });
  const { result, amount } = req.body || {};
  if (!['ganado', 'perdido'].includes(result)) return res.status(400).json({ error: 'result debe ser ganado|perdido' });
  if (lead.status.startsWith('cerrado')) {
    return res.status(409).json({ error: 'Este lead ya esta cerrado' });
  }

  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  db.prepare('UPDATE leads SET status = ?, closed_at = ?, amount = ? WHERE id = ?').run(
    result === 'ganado' ? 'cerrado_ganado' : 'cerrado_perdido',
    now,
    result === 'ganado' ? Number(amount) || 0 : 0,
    id
  );

  const closedLead = db.prepare('SELECT * FROM leads WHERE id = ?').get(id);
  broadcast('leads_changed', { reason: 'closed', id });
  if (result === 'ganado') {
    broadcast('sale_closed', {
      lead_id: id,
      client_name: closedLead.client_name,
      product: closedLead.product,
      advisor_id: closedLead.assigned_advisor_id,
    });
  }
  res.json(serialize(closedLead));
});

module.exports = router;
