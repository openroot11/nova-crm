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

// Semaforo de carga: NO es rendimiento de ventas (close_rate/sla_rate de
// abajo), es cuantos leads propios YA estan vencidos (>24h sin contactar o
// sin cotizar, ver server/sla.js) en este momento -- el negocio lo pidio asi
// a proposito: es una señal de "esta desbordado ahora mismo", no una nota
// historica. 0 vencidos = verde (prioridad normal), 1-2 = amarillo
// (asignacion reducida), 3+ = rojo (no se le asigna nada nuevo). Un
// coordinador/admin puede forzar el color a mano (manual_status_override) --
// ese valor manda hasta que se vuelva a poner en "automatico".
const YELLOW_STUCK_THRESHOLD = 1;
const RED_STUCK_THRESHOLD = 3;

function autoStatusFromStuckCount(stuckCount) {
  if (stuckCount >= RED_STUCK_THRESHOLD) return 'rojo';
  if (stuckCount >= YELLOW_STUCK_THRESHOLD) return 'amarillo';
  return 'verde';
}

async function withMetrics(advisor) {
  if (advisor.is_group) {
    return { ...advisor, close_rate: null, sla_rate: null, calls_today: null, stuck_count: null, performance_status: null, performance_status_is_manual: false };
  }
  const leads = await db.prepare('SELECT * FROM leads_visible WHERE assigned_advisor_id = ?').all(advisor.id);
  const total = leads.length;
  const won = leads.filter((l) => l.status === 'cerrado_ganado').length;
  const slaOk = leads.filter((l) => sla.firstContactSlaMet(l)).length;
  const callsToday = leads.filter((l) => l.created_at.startsWith(todayPrefix())).length;
  const stuckCount = leads.filter((l) => !l.status.startsWith('cerrado') && sla.slaStatus(l) === 'vencido').length;
  const autoStatus = autoStatusFromStuckCount(stuckCount);
  return {
    ...advisor,
    close_rate: total ? Math.round((won / total) * 1000) / 10 : 0,
    sla_rate: total ? Math.round((slaOk / total) * 1000) / 10 : 100,
    calls_today: callsToday,
    stuck_count: stuckCount,
    performance_status: advisor.manual_status_override || autoStatus,
    performance_status_is_manual: !!advisor.manual_status_override,
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

// Forzar/soltar el color del semaforo a mano. status: 'rojo'|'amarillo'|
// 'verde' lo fija (manda sobre el calculo automatico); null lo suelta y
// vuelve a calcularse solo desde los leads vencidos.
router.patch('/:id/status', requireRole('coordinador', 'admin'), async (req, res) => {
  const id = Number(req.params.id);
  const advisor = await db.prepare('SELECT * FROM advisors WHERE id = ?').get(id);
  if (!advisor) return res.status(404).json({ error: 'Asesor no encontrado' });
  const { status } = req.body || {};
  if (status !== null && status !== undefined && !['rojo', 'amarillo', 'verde'].includes(status)) {
    return res.status(400).json({ error: 'status debe ser rojo, amarillo, verde, o null para automático' });
  }
  await db.prepare('UPDATE advisors SET manual_status_override = ? WHERE id = ?').run(status || null, id);
  broadcast('advisors_changed', { reason: 'status_updated', id });
  res.json(await withMetrics(await db.prepare('SELECT * FROM advisors WHERE id = ?').get(id)));
});

// A quien le toca el proximo lead: entre los asesores activos que NO esten
// en rojo, reparte por turnos ponderados por color -- verde pesa el doble
// que amarillo, así que un amarillo recibe aprox. la mitad de leads nuevos
// que un verde mientras dura su racha de vencidos. El turno de cada quien se
// mide con lo ya asignado HOY (calls_today, mismo dato que ya muestra
// Asesores) contra su peso -- se recalcula fresco en cada llamada, no hay
// cursor que guardar ni que se pueda desincronizar.
const TURN_WEIGHT = { verde: 2, amarillo: 1, rojo: 1 };

router.get('/suggest-turn', requireRole('coordinador', 'admin'), async (req, res) => {
  const all = await Promise.all((await rotation.getOrderedAdvisors()).map(withMetrics));
  const active = all.filter((a) => !a.is_group && a.active);
  let eligible = active.filter((a) => a.performance_status !== 'rojo');
  let allRed = false;

  if (eligible.length === 0) {
    if (active.length === 0) {
      return res.json({ advisor: null, reason: 'sin-asesores-activos', eligible: [], all_red: false });
    }
    // Si TODOS los activos cayeron en rojo (un backlog de vencidos puede
    // tumbarlos a los 3 a la vez, con un equipo tan chico), no se bloquea
    // Alta Rapida por completo -- se reparte entre todos igual, con aviso,
    // en vez de dejar sin forma de registrar un cliente nuevo.
    eligible = active;
    allRed = true;
  }

  let best = eligible[0];
  let bestRatio = Infinity;
  for (const a of eligible) {
    const ratio = (a.calls_today || 0) / TURN_WEIGHT[a.performance_status];
    if (ratio < bestRatio) {
      bestRatio = ratio;
      best = a;
    }
  }
  const reason = allRed ? 'todos-en-rojo' : best.performance_status === 'amarillo' ? 'turno reducido (amarillo)' : 'turno normal';
  res.json({ advisor: best, reason, eligible, all_red: allRed });
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
