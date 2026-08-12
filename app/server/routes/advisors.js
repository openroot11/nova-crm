const express = require('express');
const { db } = require('../db');
const rotation = require('../rotation');
const sla = require('../sla');
const { broadcast } = require('../realtime');
const { requireRole } = require('../middleware/auth');

const router = express.Router();

function todayPrefix() {
  return new Date().toISOString().slice(0, 10);
}

async function withMetrics(advisor) {
  if (advisor.is_group) {
    return { ...advisor, close_rate: null, sla_rate: null, calls_today: null };
  }
  const leads = await db.prepare('SELECT * FROM leads WHERE assigned_advisor_id = ?').all(advisor.id);
  const total = leads.length;
  const won = leads.filter((l) => l.status === 'cerrado_ganado').length;
  const slaOk = leads.filter((l) => sla.firstContactSlaMet(l)).length;
  const callsToday = leads.filter((l) => l.created_at.startsWith(todayPrefix())).length;
  return {
    ...advisor,
    close_rate: total ? Math.round((won / total) * 1000) / 10 : 0,
    sla_rate: total ? Math.round((slaOk / total) * 1000) / 10 : 100,
    calls_today: callsToday,
  };
}

router.get('/', async (req, res) => {
  const advisors = await Promise.all((await rotation.getOrderedAdvisors()).map(withMetrics));
  res.json(advisors);
});

router.post('/', requireRole('coordinador', 'admin'), async (req, res) => {
  const { name, role } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'name es requerido' });
  const maxOrder = (await db.prepare('SELECT COALESCE(MAX(priority_order), 0) AS m FROM advisors').get()).m;
  const info = await db
    .prepare('INSERT INTO advisors (name, role, active, is_group, priority_order) VALUES (?, ?, true, false, ?)')
    .run(name.trim(), role || 'Asesor Comercial', maxOrder + 1);
  broadcast('advisors_changed', { reason: 'created', id: info.lastInsertRowid });
  res.status(201).json(await withMetrics(await db.prepare('SELECT * FROM advisors WHERE id = ?').get(info.lastInsertRowid)));
});

router.patch('/:id', requireRole('coordinador', 'admin'), async (req, res) => {
  const id = Number(req.params.id);
  const advisor = await db.prepare('SELECT * FROM advisors WHERE id = ?').get(id);
  if (!advisor) return res.status(404).json({ error: 'Asesor no encontrado' });
  const { name, role } = req.body || {};
  await db
    .prepare('UPDATE advisors SET name = COALESCE(?, name), role = COALESCE(?, role) WHERE id = ?')
    .run(name ?? null, role ?? null, id);
  broadcast('advisors_changed', { reason: 'updated', id });
  res.json(await withMetrics(await db.prepare('SELECT * FROM advisors WHERE id = ?').get(id)));
});

router.post('/:id/pause', requireRole('coordinador', 'admin'), async (req, res) => {
  const id = Number(req.params.id);
  await rotation.setPaused(id, true);
  broadcast('advisors_changed', { reason: 'paused', id });
  res.json({ ok: true });
});

router.post('/:id/resume', requireRole('coordinador', 'admin'), async (req, res) => {
  const id = Number(req.params.id);
  await rotation.setPaused(id, false);
  broadcast('advisors_changed', { reason: 'resumed', id });
  res.json({ ok: true });
});

module.exports = router;
