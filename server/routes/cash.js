const express = require('express');
const { db } = require('../db');
const { broadcast } = require('../realtime');
const { requireRole } = require('../middleware/auth');
const erp = require('../erp');

// Finanzas del taller (ERP): Caja (lo que entra y sale), Cartera (quién
// debe) y Rentabilidad (cuánto deja cada trabajo). Los ingresos por ventas
// NO se registran aquí: son los abonos que ya existen en "payments" (Ventas
// Cerradas / ficha del cliente), y Caja los suma al mostrar el periodo. Aquí
// se registran los gastos y cualquier otro ingreso (cash_entries).
const router = express.Router();
router.use(requireRole('admin', 'coordinador'));

const CATEGORIES = {
  egreso: erp.EXPENSE_CATEGORIES,
  ingreso: ['Otros ingresos', 'Aporte de socios'],
};
const METHODS = ['efectivo', 'transferencia', 'tarjeta', 'nequi', 'otro'];

function isoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? String(value) : null;
}

// Rango por defecto: el mes en curso (fechas locales de Colombia).
function range(query) {
  const today = erp.todayBogota();
  return { from: isoDate(query.from) || `${today.slice(0, 8)}01`, to: isoDate(query.to) || today };
}

router.get('/meta', (req, res) => {
  res.json({ categories: CATEGORIES, methods: METHODS });
});

// GET /api/cash/entries?from=&to=
// Movimientos del periodo: abonos de clientes (ingresos por ventas) + lo
// registrado en Caja, del más reciente al más viejo, con totales.
router.get('/entries', async (req, res) => {
  const { from, to } = range(req.query);
  // paid_at está en UTC: se pasa a hora de Colombia antes de comparar fechas.
  const payments = await db
    .prepare(
      `SELECT p.id, p.amount, p.method, p.notes, date(p.paid_at, '-5 hours') AS entry_date, p.paid_at AS created_at,
              l.client_name, l.id AS lead_id
         FROM payments p JOIN leads l ON l.id = p.lead_id
        WHERE date(p.paid_at, '-5 hours') BETWEEN ? AND ?`
    )
    .all(from, to);
  const entries = await db
    .prepare(
      `SELECT ce.*, po.number AS purchase_number
         FROM cash_entries ce LEFT JOIN purchase_orders po ON po.id = ce.purchase_order_id
        WHERE ce.entry_date BETWEEN ? AND ?`
    )
    .all(from, to);

  const rows = [
    ...payments.map((p) => ({
      source: 'abono',
      id: p.id,
      kind: 'ingreso',
      category: 'Abono de cliente',
      amount: p.amount,
      method: p.method || 'sin dato',
      description: `${p.client_name}${p.notes ? ` · ${p.notes}` : ''}`,
      entry_date: p.entry_date,
      created_at: p.created_at,
      lead_id: p.lead_id,
    })),
    ...entries.map((e) => ({
      source: 'caja',
      id: e.id,
      kind: e.kind,
      category: e.category,
      amount: e.amount,
      method: e.method,
      description: [e.description, e.purchase_number].filter(Boolean).join(' · ') || null,
      entry_date: e.entry_date,
      created_at: e.created_at,
      purchase_order_id: e.purchase_order_id,
    })),
  ].sort((a, b) => (a.entry_date === b.entry_date ? String(b.created_at).localeCompare(String(a.created_at)) : b.entry_date.localeCompare(a.entry_date)));

  const sum = (list) => Math.round(list.reduce((s, r) => s + Number(r.amount), 0));
  const ingresos = rows.filter((r) => r.kind === 'ingreso');
  const egresos = rows.filter((r) => r.kind === 'egreso');
  const group = (list, key) =>
    Object.entries(list.reduce((acc, r) => ((acc[r[key]] = (acc[r[key]] || 0) + Number(r.amount)), acc), {}))
      .map(([name, total]) => ({ name, total: Math.round(total) }))
      .sort((a, b) => b.total - a.total);

  res.json({
    from,
    to,
    rows,
    totals: { ingresos: sum(ingresos), egresos: sum(egresos), neto: sum(ingresos) - sum(egresos) },
    egresos_por_categoria: group(egresos, 'category'),
    ingresos_por_medio: group(ingresos, 'method'),
  });
});

router.post('/entries', async (req, res) => {
  const { kind, category, amount, method, description, entry_date, purchase_order_id } = req.body || {};
  if (!CATEGORIES[kind]) return res.status(400).json({ error: 'Indica si es ingreso o egreso' });
  if (!CATEGORIES[kind].includes(category)) return res.status(400).json({ error: 'Categoría inválida' });
  if (!(Number(amount) > 0)) return res.status(400).json({ error: 'El valor debe ser mayor que cero' });
  if (!METHODS.includes(method)) return res.status(400).json({ error: 'Medio de pago inválido' });
  let poId = null;
  if (purchase_order_id) {
    const po = await db.prepare('SELECT id FROM purchase_orders WHERE id = ?').get(Number(purchase_order_id));
    if (!po) return res.status(400).json({ error: 'Orden de compra no encontrada' });
    poId = po.id;
  }
  const info = await db
    .prepare('INSERT INTO cash_entries (kind, category, amount, method, description, entry_date, purchase_order_id, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(kind, category, Math.round(Number(amount)), method, (description && String(description).trim()) || null, isoDate(entry_date) || erp.todayBogota(), poId, req.user.id || null);
  broadcast('cash_changed', { reason: 'created' });
  if (poId) broadcast('purchases_changed', { reason: 'paid', id: poId });
  res.status(201).json(await db.prepare('SELECT * FROM cash_entries WHERE id = ?').get(info.lastInsertRowid));
});

// Borrar un movimiento de Caja mal registrado (solo admin). Los abonos de
// clientes se corrigen donde se registraron (Ventas Cerradas), no aquí.
router.delete('/entries/:id', requireRole('admin'), async (req, res) => {
  const id = Number(req.params.id);
  const e = await db.prepare('SELECT * FROM cash_entries WHERE id = ?').get(id);
  if (!e) return res.status(404).json({ error: 'Movimiento no encontrado' });
  await db.prepare('DELETE FROM cash_entries WHERE id = ?').run(id);
  broadcast('cash_changed', { reason: 'deleted' });
  if (e.purchase_order_id) broadcast('purchases_changed', { reason: 'paid', id: e.purchase_order_id });
  res.json({ ok: true });
});

// GET /api/cash/receivables -- Cartera: ventas ganadas con saldo pendiente,
// con la etapa de su orden de trabajo (un trabajo ya entregado y sin pagar
// es lo más urgente de cobrar).
router.get('/receivables', async (req, res) => {
  const rows = await db
    .prepare(
      `SELECT l.id AS lead_id, l.client_name, l.phone, l.amount, l.closed_at,
              COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.lead_id = l.id), 0) AS paid,
              (SELECT op.id FROM production_orders op JOIN sales_orders so ON so.id = op.sales_order_id
                WHERE so.lead_id = l.id AND op.status != 'cancelada' ORDER BY op.id DESC LIMIT 1) AS op_id
         FROM leads l
        WHERE l.status = 'cerrado_ganado' AND COALESCE(l.amount, 0) > 0`
    )
    .all();
  const orders = new Map(
    (await db.prepare("SELECT id, number, status, delivered_at FROM production_orders WHERE status != 'cancelada'").all()).map((o) => [o.id, o])
  );
  // "Entregado" en cartera = OP entregada o cerrada: es lo urgente de cobrar.
  const DELIVERED = ['entregada', 'cerrada'];
  const list = rows
    .map((r) => {
      const op = r.op_id ? orders.get(r.op_id) : null;
      return {
        ...r,
        balance: Math.round(r.amount - r.paid),
        op_number: op ? op.number : null,
        op_status: op ? op.status : null,
        delivered: op ? DELIVERED.includes(op.status) : false,
        delivered_at: op ? op.delivered_at : null,
      };
    })
    .filter((r) => r.balance > 0)
    .sort((a, b) => b.delivered - a.delivered || String(a.closed_at).localeCompare(String(b.closed_at)));
  res.json({ rows: list, total: list.reduce((s, r) => s + r.balance, 0) });
});

// GET /api/cash/profitability?from=&to= -- cuánto deja cada trabajo
// entregado en el periodo: valor sin IVA menos el material que consumió
// (sin mano de obra ni gastos fijos -- esos se ven en Caja).
router.get('/profitability', async (req, res) => {
  const { from, to } = range(req.query);
  const orders = await db
    .prepare(
      `SELECT wo.*,
              COALESCE((SELECT -SUM(sm.qty * sm.unit_cost) FROM stock_movements sm WHERE sm.work_order_id = wo.id AND sm.type IN ('consumo', 'devolucion')), 0) AS materials_cost
         FROM work_orders wo
        WHERE wo.stage = 'entregado' AND date(wo.delivered_at, '-5 hours') BETWEEN ? AND ?
        ORDER BY wo.delivered_at DESC`
    )
    .all(from, to);
  const rows = orders.map((o) => {
    const revenue = Math.round((Number(o.amount_total) || 0) / 1.19);
    const cost = Math.round(o.materials_cost);
    return {
      id: o.id,
      number: o.number,
      client_name: o.client_name,
      service_slug: o.service_slug,
      delivered_at: o.delivered_at,
      revenue,
      materials_cost: cost,
      margin: revenue - cost,
      margin_pct: revenue > 0 ? Math.round(((revenue - cost) / revenue) * 100) : null,
    };
  });
  const bySvc = {};
  for (const r of rows) {
    const k = r.service_slug || 'otro';
    bySvc[k] = bySvc[k] || { service_slug: k, jobs: 0, revenue: 0, materials_cost: 0, margin: 0 };
    bySvc[k].jobs++;
    bySvc[k].revenue += r.revenue;
    bySvc[k].materials_cost += r.materials_cost;
    bySvc[k].margin += r.margin;
  }
  const totals = rows.reduce((t, r) => ({ revenue: t.revenue + r.revenue, materials_cost: t.materials_cost + r.materials_cost, margin: t.margin + r.margin }), { revenue: 0, materials_cost: 0, margin: 0 });
  res.json({ from, to, rows, by_service: Object.values(bySvc).sort((a, b) => b.margin - a.margin), totals });
});

module.exports = router;
