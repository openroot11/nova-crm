// Corre a mano, UNA VEZ, para destapar ventas ya cerradas (status =
// cerrado_ganado) que quedaron invisibles en Ventas Cerradas/Dashboard/
// Informe porque su lead no traia channel_detail = 'Google Ads' (la mayoria
// son leads historicos importados de Odoo en agosto, con canal "Otro").
// El cierre normal (POST /:id/close) ya fuerza ese canal en ventas nuevas --
// esto es solo para las que ya estaban cerradas ANTES de ese cambio.
//
//   cd server
//   node scripts/fix-hidden-closed-sales.js --check   # SOLO lista, no cambia nada
//   node scripts/fix-hidden-closed-sales.js           # aplica el cambio
//
// Es idempotente: correrlo dos veces no hace nada la segunda vez (ya no
// quedaria ninguna fila que cumpla el WHERE).

const { db, init } = require('../db');

const CHECK_ONLY = process.argv.includes('--check');

async function main() {
  await init();

  const rows = await db
    .prepare(
      `SELECT id, client_name, channel_detail, amount, sale_reference, closed_at
       FROM leads
       WHERE status = 'cerrado_ganado' AND channel_detail != 'Google Ads'
       ORDER BY closed_at DESC`
    )
    .all();

  if (!rows.length) {
    console.log('Nada que corregir -- todas las ventas cerradas ya estan visibles.');
    return;
  }

  const total = rows.reduce((s, l) => s + (l.amount || 0), 0);
  console.log(`${rows.length} ventas cerradas ocultas (canal != Google Ads), total $${total.toLocaleString('es-CO')}:\n`);
  for (const l of rows) {
    console.log(`  #${l.id}  ${l.client_name}  ${l.sale_reference || '(sin ref)'}  $${(l.amount || 0).toLocaleString('es-CO')}  canal=${l.channel_detail}  cerrado=${l.closed_at}`);
  }

  if (CHECK_ONLY) {
    console.log('\n--check: no se modifico nada. Corre sin la bandera para aplicar.');
    return;
  }

  const info = await db
    .prepare(`UPDATE leads SET channel_detail = 'Google Ads' WHERE status = 'cerrado_ganado' AND channel_detail != 'Google Ads'`)
    .run();
  console.log(`\nHECHO -- ${info.changes} ventas pasadas a canal 'Google Ads'. Ya deberian verse en Ventas Cerradas (recarga la app).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
