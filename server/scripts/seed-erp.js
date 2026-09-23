// Datos de PRUEBA del ERP: operarios, materiales con existencias,
// proveedores y órdenes de compra, y gastos del mes en Caja. Las órdenes de
// producción de ejemplo están en seed-produccion.js.
//
// Uso:  node scripts/seed-erp.js
//
// Cada parte se carga solo si está vacía. Inserta directo en SQLite: si el
// servidor está corriendo, recarga la página después.

const { db, init } = require('../db');
const erp = require('../erp');

const WORKERS = [
  { name: 'Jhon Pérez', specialty: 'Costura y forros' },
  { name: 'Luis Barrios', specialty: 'Tapicería automotriz e instalación' },
  { name: 'Andrés Mejía', specialty: 'Sillines de moto y carpas' },
];

// [nombre, unidad, stock inicial, mínimo, costo por unidad]
const MATERIALS = [
  ['Cuero sintético premium negro', 'm', 38, 15, 42000],
  ['Cuero sintético premium café', 'm', 12, 10, 42000],
  ['Cuero sintético premium gris', 'm', 22, 10, 42000],
  ['Cuerina negra', 'm', 45, 15, 18000],
  ['Tela técnica deportiva negra', 'm', 30, 10, 24000],
  ['Neopreno negro 3 mm', 'm', 8, 10, 55000],
  ['Cuero genuino (vaqueta) negro', 'm2', 6, 4, 145000],
  ['Espuma alta densidad 2 cm', 'm2', 20, 8, 21000],
  ['Espuma alta densidad 5 cm', 'm2', 9, 6, 38000],
  ['Lona PVC blackout blanca', 'm2', 60, 25, 16500],
  ['Hilo de nylon calibre 40', 'rollo', 14, 5, 12000],
  ['Pegante de contacto', 'lt', 7, 3, 32000],
  ['Cierre (cremallera) #5', 'und', 60, 20, 1800],
  ['Grapas tapicería 10 mm', 'und', 3000, 800, 12],
];

// Cada bloque se carga solo si su parte está vacía, así el script se puede
// volver a correr para completar módulos nuevos sin duplicar lo anterior.
// Las órdenes de producción (y su garantía) de ejemplo las crea
// seed-produccion.js; Producción no consume inventario.
async function seedWorkshop() {
  if ((await db.prepare('SELECT COUNT(*) AS c FROM workers').get()).c === 0) {
    for (const w of WORKERS) await db.prepare('INSERT INTO workers (name, specialty) VALUES (?, ?)').run(w.name, w.specialty);
    console.log(`Operarios: ${WORKERS.length}.`);
  } else console.log('Operarios: ya hay -- se dejan como están.');
  if ((await db.prepare('SELECT COUNT(*) AS c FROM materials').get()).c === 0) {
    for (const [name, unit, stock, min, cost] of MATERIALS) {
      const info = await db.prepare('INSERT INTO materials (name, unit, min_stock, cost) VALUES (?, ?, ?, ?)').run(name, unit, min, cost);
      await erp.applyMovement({ material_id: info.lastInsertRowid, type: 'entrada', qty: stock, unit_cost: cost, note: 'Existencia inicial' });
    }
    console.log(`Inventario: ${MATERIALS.length} materiales.`);
  } else console.log('Inventario: ya hay materiales -- se dejan como están.');
}

// [nombre, NIT, contacto, teléfono, correo, notas] -- proveedores de EJEMPLO.
const SUPPLIERS = [
  ['Cueros y Sintéticos del Caribe', '900123456-1', 'Marta Ríos', '3004567890', 'ventas@cuerossintcaribe.co', 'Cuero sintético y cuerina. Entrega en 2 días.'],
  ['Espumas La Costa', '900654321-7', 'Jorge Díaz', '3157771122', 'pedidos@espumaslacosta.co', 'Espumas por lámina o cortadas a medida.'],
  ['Insumos Tapicería Barranquilla', '901112233-4', 'Luz Pérez', '3012223344', null, 'Hilos, pegantes, grapas y cierres.'],
];

async function seedPurchases() {
  if ((await db.prepare('SELECT COUNT(*) AS c FROM suppliers').get()).c > 0) {
    console.log('Compras: ya hay proveedores -- se deja como está.');
    return;
  }
  const ids = [];
  for (const s of SUPPLIERS) {
    const info = await db.prepare('INSERT INTO suppliers (name, nit, contact, phone, email, notes) VALUES (?, ?, ?, ?, ?, ?)').run(...s);
    ids.push(info.lastInsertRowid);
  }
  const mat = async (name) => db.prepare('SELECT * FROM materials WHERE name = ?').get(name);
  // [proveedor, estado, días desde hoy (fecha esperada), líneas [material, cant], pagado]
  const plan = [
    [0, 'recibida', -10, [['Cuero sintético premium negro', 20], ['Cuerina negra', 15]], 'total'],
    [2, 'recibida', -4, [['Hilo de nylon calibre 40', 6], ['Pegante de contacto', 4], ['Grapas tapicería 10 mm', 2000]], 'mitad'],
    [1, 'pedida', 2, [['Espuma alta densidad 5 cm', 8], ['Espuma alta densidad 2 cm', 10]], null],
    [0, 'borrador', 5, [['Neopreno negro 3 mm', 15]], null],
  ];
  let n = 0;
  for (const [si, status, days, lines, paid] of plan) {
    const info = await db
      .prepare('INSERT INTO purchase_orders (supplier_id, status, expected_date, created_at) VALUES (?, ?, ?, datetime(\'now\', ?))')
      .run(ids[si], 'borrador', erp.todayBogota(days), `${days - 3} days`);
    const poId = info.lastInsertRowid;
    await db.prepare("UPDATE purchase_orders SET number = printf('OC-%04d', id) WHERE id = ?").run(poId);
    let total = 0;
    for (const [name, qty] of lines) {
      const m = await mat(name);
      await db.prepare('INSERT INTO purchase_order_lines (purchase_order_id, material_id, qty, unit_cost) VALUES (?, ?, ?, ?)').run(poId, m.id, qty, m.cost);
      total += qty * m.cost;
      // Recibidas: su material entra al inventario (así cuadra el kárdex).
      if (status === 'recibida') {
        await erp.applyMovement({ material_id: m.id, type: 'entrada', qty, unit_cost: m.cost, note: `Compra de ejemplo · ${SUPPLIERS[si][0]}` });
      }
    }
    await db
      .prepare(
        `UPDATE purchase_orders SET status = ?, total = ?,
           ordered_at = CASE WHEN ? != 'borrador' THEN datetime('now', ?) END,
           received_at = CASE WHEN ? = 'recibida' THEN datetime('now', ?) END
         WHERE id = ?`
      )
      .run(status, Math.round(total), status, `${days - 2} days`, status, `${days} days`, poId);
    if (paid) {
      const amount = Math.round(paid === 'total' ? total : total / 2);
      await db
        .prepare("INSERT INTO cash_entries (kind, category, amount, method, description, entry_date, purchase_order_id) VALUES ('egreso', 'Compra de materiales', ?, 'transferencia', ?, ?, ?)")
        .run(amount, SUPPLIERS[si][0], erp.todayBogota(days), poId);
    }
    n++;
  }
  console.log(`Compras: ${SUPPLIERS.length} proveedores, ${n} órdenes de compra.`);
}

async function seedCash() {
  const other = await db.prepare("SELECT COUNT(*) AS c FROM cash_entries WHERE purchase_order_id IS NULL").get();
  if (other.c > 0) {
    console.log('Caja: ya hay movimientos -- se deja como está.');
    return;
  }
  // Gastos de EJEMPLO del mes: [categoría, valor, medio, descripción, día del mes]
  const today = erp.todayBogota();
  const month = today.slice(0, 8);
  const day = Number(today.slice(8, 10));
  const expenses = [
    ['Arriendo', 1800000, 'transferencia', 'Arriendo del local', 1],
    ['Servicios públicos', 285000, 'transferencia', 'Energía y agua', 5],
    ['Nómina y pagos a operarios', 1300000, 'efectivo', 'Quincena operarios', 15],
    ['Transporte y domicilios', 45000, 'efectivo', 'Domicilio entrega forros', 12],
    ['Herramientas y mantenimiento', 120000, 'efectivo', 'Mantenimiento máquina de coser', 9],
    ['Publicidad', 350000, 'tarjeta', 'Google Ads', 3],
  ].filter((e) => e[4] <= day);
  for (const [category, amount, method, description, d] of expenses) {
    await db
      .prepare("INSERT INTO cash_entries (kind, category, amount, method, description, entry_date) VALUES ('egreso', ?, ?, ?, ?, ?)")
      .run(category, amount, method, description, `${month}${String(d).padStart(2, '0')}`);
  }
  // Medio de pago de ejemplo para los abonos que no lo tienen.
  const methods = ['efectivo', 'transferencia', 'transferencia', 'nequi', 'tarjeta'];
  const pays = await db.prepare('SELECT id FROM payments WHERE method IS NULL').all();
  for (const [i, p] of pays.entries()) {
    await db.prepare('UPDATE payments SET method = ? WHERE id = ?').run(methods[i % methods.length], p.id);
  }
  console.log(`Caja: ${expenses.length} gastos del mes; medio de pago en ${pays.length} abonos.`);
}

async function main() {
  await init();
  await seedWorkshop();
  await seedPurchases();
  await seedCash();
  console.log('\nListo. Si el servidor está corriendo, recarga la página.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
