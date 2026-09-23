const express = require('express');
const { db } = require('../db');
const { broadcast } = require('../realtime');
const { requireRole } = require('../middleware/auth');
const erp = require('../erp');

// Compras (ERP): proveedores y órdenes de compra. Recibir una orden mete
// cada línea al inventario (movimiento "entrada" con su costo) -- es la
// forma normal de subir existencias; la "+ Entrada" suelta de Inventario
// queda para lo que llega sin orden. Lo pagado a cada orden sale de Caja.
// Solo admin/coordinador (manejan plata y proveedores).
const router = express.Router();
router.use(requireRole('admin', 'coordinador'));

function fail(res, err) {
  if (err && err.status) return res.status(err.status).json({ error: err.message });
  throw err;
}

// ---- proveedores -------------------------------------------------------------

router.get('/suppliers', async (req, res) => {
  const rows = await db
    .prepare(
      `SELECT s.*,
              (SELECT COUNT(*) FROM purchase_orders po WHERE po.supplier_id = s.id AND po.status != 'cancelada') AS orders_count,
              (SELECT COALESCE(SUM(po.total), 0) FROM purchase_orders po WHERE po.supplier_id = s.id AND po.status = 'recibida') AS total_bought
         FROM suppliers s
        ${req.query.all === '1' ? '' : 'WHERE s.active = 1'}
        ORDER BY s.name ASC`
    )
    .all();
  res.json(rows);
});

const SUPPLIER_FIELDS = ['name', 'nit', 'contact', 'phone', 'email', 'notes'];
function supplierValues(body, current = {}) {
  return SUPPLIER_FIELDS.map((f) => (body[f] !== undefined ? String(body[f] || '').trim() || null : current[f] ?? null));
}

router.post('/suppliers', async (req, res) => {
  const body = req.body || {};
  if (!body.name || !String(body.name).trim()) return res.status(400).json({ error: 'El nombre del proveedor es obligatorio' });
  const info = await db
    .prepare(`INSERT INTO suppliers (${SUPPLIER_FIELDS.join(', ')}) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(...supplierValues(body));
  broadcast('purchases_changed', { reason: 'supplier' });
  res.status(201).json(await db.prepare('SELECT * FROM suppliers WHERE id = ?').get(info.lastInsertRowid));
});

router.patch('/suppliers/:id', async (req, res) => {
  const id = Number(req.params.id);
  const s = await db.prepare('SELECT * FROM suppliers WHERE id = ?').get(id);
  if (!s) return res.status(404).json({ error: 'Proveedor no encontrado' });
  const body = req.body || {};
  if (body.name !== undefined && !String(body.name).trim()) return res.status(400).json({ error: 'El nombre no puede quedar vacío' });
  const values = supplierValues(body, s);
  await db
    .prepare(`UPDATE suppliers SET ${SUPPLIER_FIELDS.map((f) => `${f} = ?`).join(', ')}, active = ? WHERE id = ?`)
    .run(...values, body.active !== undefined ? (body.active ? 1 : 0) : s.active, id);
  broadcast('purchases_changed', { reason: 'supplier' });
  res.json(await db.prepare('SELECT * FROM suppliers WHERE id = ?').get(id));
});

// ---- órdenes de compra ----------------------------------------------------------

async function readPurchase(id) {
  const po = await db
    .prepare(
      `SELECT po.*, s.name AS supplier_name, s.phone AS supplier_phone,
              (SELECT COALESCE(SUM(amount), 0) FROM cash_entries ce WHERE ce.purchase_order_id = po.id AND ce.kind = 'egreso') AS paid
         FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id
        WHERE po.id = ?`
    )
    .get(id);
  if (!po) return null;
  const lines = await db
    .prepare(
      `SELECT l.*, m.name AS material_name, m.unit, m.stock
         FROM purchase_order_lines l JOIN materials m ON m.id = l.material_id
        WHERE l.purchase_order_id = ? ORDER BY l.id`
    )
    .all(id);
  return { ...po, lines, balance: Math.max(0, Math.round(po.total - po.paid)) };
}

router.get('/orders', async (req, res) => {
  const { status, supplier_id } = req.query;
  const where = [];
  const params = [];
  if (status) {
    where.push('po.status = ?');
    params.push(status);
  }
  if (supplier_id) {
    where.push('po.supplier_id = ?');
    params.push(Number(supplier_id));
  }
  const rows = await db
    .prepare(
      `SELECT po.*, s.name AS supplier_name,
              (SELECT COALESCE(SUM(amount), 0) FROM cash_entries ce WHERE ce.purchase_order_id = po.id AND ce.kind = 'egreso') AS paid,
              (SELECT COUNT(*) FROM purchase_order_lines l WHERE l.purchase_order_id = po.id) AS lines_count
         FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY po.id DESC`
    )
    .all(...params);
  res.json(rows.map((r) => ({ ...r, balance: Math.max(0, Math.round(r.total - r.paid)) })));
});

router.get('/orders/:id', async (req, res) => {
  const po = await readPurchase(Number(req.params.id));
  if (!po) return res.status(404).json({ error: 'Orden de compra no encontrada' });
  res.json(po);
});

// Qué comprar: materiales activos en o por debajo del mínimo, con una
// cantidad sugerida que los deja en el doble del mínimo.
router.get('/suggestions', async (req, res) => {
  const rows = await db
    .prepare('SELECT * FROM materials WHERE active = 1 AND min_stock > 0 AND stock <= min_stock ORDER BY name')
    .all();
  res.json(
    rows.map((m) => ({
      material_id: m.id,
      material_name: m.name,
      unit: m.unit,
      stock: m.stock,
      min_stock: m.min_stock,
      qty: Math.max(1, Math.ceil(m.min_stock * 2 - m.stock)),
      unit_cost: m.cost,
    }))
  );
});

async function cleanLines(lines) {
  if (!Array.isArray(lines) || !lines.length) throw Object.assign(new Error('Agrega al menos un material'), { status: 400 });
  const out = [];
  for (const l of lines) {
    const qty = Number(l.qty);
    if (!(qty > 0)) throw Object.assign(new Error('Cada línea necesita una cantidad mayor que cero'), { status: 400 });
    const m = await db.prepare('SELECT id FROM materials WHERE id = ?').get(Number(l.material_id));
    if (!m) throw Object.assign(new Error('Material no encontrado en una línea'), { status: 400 });
    out.push({ material_id: m.id, qty, unit_cost: Math.max(0, Number(l.unit_cost) || 0) });
  }
  return out;
}

async function writeLines(poId, lines) {
  await db.prepare('DELETE FROM purchase_order_lines WHERE purchase_order_id = ?').run(poId);
  const insert = db.prepare('INSERT INTO purchase_order_lines (purchase_order_id, material_id, qty, unit_cost) VALUES (?, ?, ?, ?)');
  let total = 0;
  for (const l of lines) {
    await insert.run(poId, l.material_id, l.qty, l.unit_cost);
    total += l.qty * l.unit_cost;
  }
  await db.prepare("UPDATE purchase_orders SET total = ?, updated_at = datetime('now') WHERE id = ?").run(Math.round(total), poId);
}

router.post('/orders', async (req, res) => {
  const { supplier_id, lines, expected_date, notes } = req.body || {};
  try {
    const supplier = await db.prepare('SELECT id FROM suppliers WHERE id = ?').get(Number(supplier_id));
    if (!supplier) return res.status(400).json({ error: 'Elige un proveedor' });
    const clean = await cleanLines(lines);
    const run = db.transaction(async () => {
      const info = await db
        .prepare('INSERT INTO purchase_orders (supplier_id, expected_date, notes, created_by) VALUES (?, ?, ?, ?)')
        .run(supplier.id, expected_date || null, (notes && String(notes).trim()) || null, req.user.id || null);
      await db.prepare("UPDATE purchase_orders SET number = printf('OC-%04d', id) WHERE id = ?").run(info.lastInsertRowid);
      await writeLines(info.lastInsertRowid, clean);
      return info.lastInsertRowid;
    });
    const id = await run();
    broadcast('purchases_changed', { reason: 'created', id });
    res.status(201).json(await readPurchase(id));
  } catch (err) {
    fail(res, err);
  }
});

// Editar líneas/fecha/notas: solo mientras no se haya recibido.
router.put('/orders/:id', async (req, res) => {
  const id = Number(req.params.id);
  const po = await db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(id);
  if (!po) return res.status(404).json({ error: 'Orden de compra no encontrada' });
  if (po.status === 'recibida' || po.status === 'cancelada') return res.status(409).json({ error: 'La orden ya está cerrada; no se puede editar' });
  const { lines, expected_date, notes } = req.body || {};
  try {
    if (lines !== undefined) await writeLines(id, await cleanLines(lines));
    await db
      .prepare("UPDATE purchase_orders SET expected_date = ?, notes = ?, updated_at = datetime('now') WHERE id = ?")
      .run(expected_date !== undefined ? expected_date || null : po.expected_date, notes !== undefined ? String(notes).trim() || null : po.notes, id);
    broadcast('purchases_changed', { reason: 'updated', id });
    res.json(await readPurchase(id));
  } catch (err) {
    fail(res, err);
  }
});

router.post('/orders/:id/order', async (req, res) => {
  const id = Number(req.params.id);
  const po = await db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(id);
  if (!po) return res.status(404).json({ error: 'Orden de compra no encontrada' });
  if (po.status !== 'borrador') return res.status(409).json({ error: 'Solo un borrador se marca como pedido' });
  await db.prepare("UPDATE purchase_orders SET status = 'pedida', ordered_at = datetime('now'), updated_at = datetime('now') WHERE id = ?").run(id);
  broadcast('purchases_changed', { reason: 'ordered', id });
  res.json(await readPurchase(id));
});

// Recibir: cada línea entra al inventario con su costo, todo o nada.
router.post('/orders/:id/receive', async (req, res) => {
  const id = Number(req.params.id);
  const po = await readPurchase(id);
  if (!po) return res.status(404).json({ error: 'Orden de compra no encontrada' });
  if (po.status === 'recibida') return res.status(409).json({ error: 'Esta orden ya se recibió' });
  if (po.status === 'cancelada') return res.status(409).json({ error: 'La orden está cancelada' });
  try {
    // applyMovement abre su propia transacción por línea; si una falla, las
    // anteriores ya quedaron -- por eso se valida todo antes de empezar.
    for (const l of po.lines) {
      await erp.applyMovement({
        material_id: l.material_id,
        type: 'entrada',
        qty: l.qty,
        unit_cost: l.unit_cost,
        note: `${po.number} · ${po.supplier_name}`,
        user_id: req.user.id,
      });
    }
    await db
      .prepare("UPDATE purchase_orders SET status = 'recibida', received_at = datetime('now'), ordered_at = COALESCE(ordered_at, datetime('now')), updated_at = datetime('now') WHERE id = ?")
      .run(id);
    broadcast('purchases_changed', { reason: 'received', id });
    broadcast('materials_changed', { reason: 'purchase' });
    res.json(await readPurchase(id));
  } catch (err) {
    fail(res, err);
  }
});

router.post('/orders/:id/cancel', async (req, res) => {
  const id = Number(req.params.id);
  const po = await db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(id);
  if (!po) return res.status(404).json({ error: 'Orden de compra no encontrada' });
  if (po.status === 'recibida') return res.status(409).json({ error: 'Ya se recibió: el material ya entró al inventario' });
  await db.prepare("UPDATE purchase_orders SET status = 'cancelada', updated_at = datetime('now') WHERE id = ?").run(id);
  broadcast('purchases_changed', { reason: 'cancelled', id });
  res.json(await readPurchase(id));
});

module.exports = router;
