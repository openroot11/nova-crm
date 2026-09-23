const express = require('express');
const { db } = require('../db');
const { broadcast } = require('../realtime');
const { requireRole } = require('../middleware/auth');

const router = express.Router();
const canManage = requireRole('admin', 'coordinador', 'produccion');

// Operarios del taller, con cuántas órdenes de producción abiertas tiene
// cada uno como responsable (para repartir la carga al asignar).
router.get('/', async (req, res) => {
  const rows = await db
    .prepare(
      `SELECT w.*,
              (SELECT COUNT(*) FROM production_orders op WHERE op.responsible_worker_id = w.id AND op.status NOT IN ('entregada', 'cerrada', 'cancelada')) AS open_orders,
              (SELECT COUNT(*) FROM production_tasks t WHERE t.worker_id = w.id AND t.status IN ('pendiente', 'en_proceso')) AS open_tasks
         FROM workers w
        ${req.query.all === '1' ? '' : 'WHERE w.active = 1'}
        ORDER BY w.name ASC`
    )
    .all();
  res.json(rows);
});

router.post('/', canManage, async (req, res) => {
  const { name, specialty } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'El nombre es obligatorio' });
  const info = await db
    .prepare('INSERT INTO workers (name, specialty) VALUES (?, ?)')
    .run(String(name).trim(), (specialty && String(specialty).trim()) || null);
  broadcast('production_changed', { reason: 'workers' });
  res.status(201).json(await db.prepare('SELECT * FROM workers WHERE id = ?').get(info.lastInsertRowid));
});

router.patch('/:id', canManage, async (req, res) => {
  const id = Number(req.params.id);
  const w = await db.prepare('SELECT * FROM workers WHERE id = ?').get(id);
  if (!w) return res.status(404).json({ error: 'Operario no encontrado' });
  const { name, specialty, active } = req.body || {};
  if (name !== undefined && !String(name).trim()) return res.status(400).json({ error: 'El nombre no puede quedar vacío' });
  await db
    .prepare('UPDATE workers SET name = ?, specialty = ?, active = ? WHERE id = ?')
    .run(
      name !== undefined ? String(name).trim() : w.name,
      specialty !== undefined ? String(specialty).trim() || null : w.specialty,
      active !== undefined ? (active ? 1 : 0) : w.active,
      id
    );
  broadcast('production_changed', { reason: 'workers' });
  res.json(await db.prepare('SELECT * FROM workers WHERE id = ?').get(id));
});

module.exports = router;
