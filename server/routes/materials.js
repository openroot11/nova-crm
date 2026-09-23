const express = require('express');
const { db } = require('../db');
const { broadcast } = require('../realtime');
const { requireRole } = require('../middleware/auth');
const erp = require('../erp');

const router = express.Router();
const canManage = requireRole('admin', 'coordinador');

function fail(res, err) {
  if (err && err.status) return res.status(err.status).json({ error: err.message });
  throw err;
}

function serialize(m) {
  const stock = Number(m.stock) || 0;
  return {
    ...m,
    low_stock: !!m.active && Number(m.min_stock) > 0 && stock <= Number(m.min_stock),
    value: Math.round(stock * (Number(m.cost) || 0)),
  };
}

// GET /api/materials?all=1 -- sin "all" solo los activos (los que se
// pueden consumir en una orden).
router.get('/', async (req, res) => {
  const rows = await db
    .prepare(`SELECT * FROM materials ${req.query.all === '1' ? '' : 'WHERE active = 1'} ORDER BY name ASC`)
    .all();
  res.json(rows.map(serialize));
});

router.post('/', canManage, async (req, res) => {
  const { name, unit, min_stock, cost, stock } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'El nombre es obligatorio' });
  if (unit && !erp.UNITS.includes(unit)) return res.status(400).json({ error: 'Unidad inválida' });
  const info = await db
    .prepare('INSERT INTO materials (name, unit, min_stock, cost) VALUES (?, ?, ?, ?)')
    .run(String(name).trim(), unit || 'm', Math.max(0, Number(min_stock) || 0), Math.max(0, Number(cost) || 0));
  // Existencia inicial: entra como movimiento, para que el historial cuadre.
  if (Number(stock) > 0) {
    await erp.applyMovement({ material_id: info.lastInsertRowid, type: 'entrada', qty: Number(stock), unit_cost: Number(cost) || 0, note: 'Existencia inicial', user_id: req.user.id });
  }
  const created = await db.prepare('SELECT * FROM materials WHERE id = ?').get(info.lastInsertRowid);
  broadcast('materials_changed', { reason: 'created', id: created.id });
  res.status(201).json(serialize(created));
});

// Datos del material (no el stock -- ese solo cambia por movimientos).
router.patch('/:id', canManage, async (req, res) => {
  const id = Number(req.params.id);
  const m = await db.prepare('SELECT * FROM materials WHERE id = ?').get(id);
  if (!m) return res.status(404).json({ error: 'Material no encontrado' });
  const { name, unit, min_stock, cost, active } = req.body || {};
  if (name !== undefined && !String(name).trim()) return res.status(400).json({ error: 'El nombre no puede quedar vacío' });
  if (unit !== undefined && !erp.UNITS.includes(unit)) return res.status(400).json({ error: 'Unidad inválida' });
  await db
    .prepare("UPDATE materials SET name = ?, unit = ?, min_stock = ?, cost = ?, active = ?, updated_at = datetime('now') WHERE id = ?")
    .run(
      name !== undefined ? String(name).trim() : m.name,
      unit !== undefined ? unit : m.unit,
      min_stock !== undefined ? Math.max(0, Number(min_stock) || 0) : m.min_stock,
      cost !== undefined ? Math.max(0, Number(cost) || 0) : m.cost,
      active !== undefined ? (active ? 1 : 0) : m.active,
      id
    );
  const updated = await db.prepare('SELECT * FROM materials WHERE id = ?').get(id);
  broadcast('materials_changed', { reason: 'updated', id });
  res.json(serialize(updated));
});

// POST /api/materials/:id/movements
//   { type: 'entrada', qty, unit_cost, note }  -> compra/recepción (+qty)
//   { type: 'ajuste', counted, note }          -> conteo físico: el stock
//                                                 pasa a ser "counted"
// Consumos y devoluciones NO van por aquí: salen de la orden de trabajo.
router.post('/:id/movements', canManage, async (req, res) => {
  const id = Number(req.params.id);
  const m = await db.prepare('SELECT * FROM materials WHERE id = ?').get(id);
  if (!m) return res.status(404).json({ error: 'Material no encontrado' });
  const { type, qty, unit_cost, counted, note } = req.body || {};
  try {
    if (type === 'entrada') {
      if (!(Number(qty) > 0)) return res.status(400).json({ error: 'Indica cuánto entró (mayor que cero)' });
      await erp.applyMovement({ material_id: id, type, qty: Number(qty), unit_cost, note, user_id: req.user.id });
    } else if (type === 'ajuste') {
      const target = Number(counted);
      if (!Number.isFinite(target) || target < 0) return res.status(400).json({ error: 'Indica la cantidad contada (0 o más)' });
      const delta = Math.round((target - Number(m.stock)) * 1000) / 1000;
      if (delta === 0) return res.status(400).json({ error: 'El conteo coincide con el stock actual; no hay nada que ajustar' });
      await erp.applyMovement({ material_id: id, type, qty: delta, note: note || 'Conteo físico', user_id: req.user.id });
    } else {
      return res.status(400).json({ error: 'Tipo inválido (entrada o ajuste)' });
    }
    const updated = await db.prepare('SELECT * FROM materials WHERE id = ?').get(id);
    broadcast('materials_changed', { reason: type, id });
    res.status(201).json(serialize(updated));
  } catch (err) {
    fail(res, err);
  }
});

// Historial de movimientos del material (el "kárdex"), del más reciente al
// más viejo, con el número de la orden cuando es un consumo/devolución.
router.get('/:id/movements', async (req, res) => {
  const id = Number(req.params.id);
  const rows = await db
    .prepare(
      `SELECT sm.*, wo.number AS work_order_number, u.username AS created_by_name
         FROM stock_movements sm
         LEFT JOIN work_orders wo ON wo.id = sm.work_order_id
         LEFT JOIN users u ON u.id = sm.created_by
        WHERE sm.material_id = ?
        ORDER BY sm.created_at DESC, sm.id DESC
        LIMIT 200`
    )
    .all(id);
  res.json(rows);
});

module.exports = router;
