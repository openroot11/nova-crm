// Lógica compartida del ERP (Inventario, Compras, Caja): el único punto por
// donde cambian las existencias (applyMovement), para que el stock de cada
// material y su historial nunca se descuadren. Producción NO usa esto: no
// toca inventario, solo genera solicitudes de material (ver production.js).

const { db } = require('./db');

const MOVEMENT_TYPES = ['entrada', 'consumo', 'devolucion', 'ajuste'];
const UNITS = ['m', 'm2', 'und', 'kg', 'rollo', 'lt'];

// Categorías de gasto: las comparten Caja (cash_entries) y las facturas de
// compra recibidas (invoices), para que un gasto pagado en efectivo y uno
// que llegó con factura electrónica se sumen en el mismo rubro.
const EXPENSE_CATEGORIES = ['Compra de materiales', 'Arriendo', 'Servicios públicos', 'Nómina y pagos a operarios', 'Transporte y domicilios', 'Herramientas y mantenimiento', 'Publicidad', 'Impuestos', 'Otros gastos'];

// Fecha de hoy en Colombia (AAAA-MM-DD).
function todayBogota(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(d);
}

function nowUtc() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

// Registra el movimiento y actualiza el saldo del material en la misma
// transacción. qty con signo (+ entra, - sale). Una entrada con costo fija
// el costo actual del material. No deja que un consumo deje el stock en
// negativo.
async function applyMovement({ material_id, type, qty, unit_cost, work_order_id, note, user_id }) {
  if (!MOVEMENT_TYPES.includes(type)) throw Object.assign(new Error('Tipo de movimiento inválido'), { status: 400 });
  const amount = Number(qty);
  if (!Number.isFinite(amount) || amount === 0) throw Object.assign(new Error('La cantidad debe ser distinta de cero'), { status: 400 });

  const run = db.transaction(async () => {
    const material = await db.prepare('SELECT * FROM materials WHERE id = ?').get(Number(material_id));
    if (!material) throw Object.assign(new Error('Material no encontrado'), { status: 404 });
    const newStock = Math.round((Number(material.stock) + amount) * 1000) / 1000;
    if (type === 'consumo' && newStock < 0) {
      throw Object.assign(new Error(`No hay suficiente ${material.name}: quedan ${material.stock} ${material.unit}`), { status: 409 });
    }
    const given = Number(unit_cost) > 0 ? Number(unit_cost) : null;
    const movementCost = (type === 'entrada' || type === 'devolucion') && given ? given : Number(material.cost) || 0;
    const materialCost = type === 'entrada' && given ? given : Number(material.cost) || 0;
    await db
      .prepare('INSERT INTO stock_movements (material_id, type, qty, unit_cost, work_order_id, note, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(material.id, type, amount, movementCost, work_order_id || null, (note && String(note).trim()) || null, user_id || null);
    await db
      .prepare("UPDATE materials SET stock = ?, cost = ?, updated_at = datetime('now') WHERE id = ?")
      .run(newStock, materialCost, material.id);
    return db.prepare('SELECT * FROM materials WHERE id = ?').get(material.id);
  });
  return run();
}

module.exports = { MOVEMENT_TYPES, UNITS, EXPENSE_CATEGORIES, todayBogota, nowUtc, applyMovement };
