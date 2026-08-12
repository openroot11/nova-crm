// Script desechable, no forma parte de la app en marcha: copia todos los
// datos reales de la SQLite local (app/server/data/nova_crm.db) a Postgres
// en Supabase (via DATABASE_URL en .env), preservando los IDs para que las
// relaciones (leads.client_id, payments.lead_id, etc.) sigan cuadrando.
//
// Uso: node scripts/migrate-to-supabase.js
//
// Es seguro re-ejecutarlo contra un proyecto de Supabase vacio: si algo
// falla a mitad de camino, hay que vaciar las tablas en Supabase (o crear
// un proyecto nuevo) y correrlo de nuevo -- NUNCA borra ni toca la SQLite
// de origen.

const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { db: pg, init } = require('../db');

const SQLITE_PATH = path.join(__dirname, '..', 'data', 'nova_crm.db');

// Orden por dependencias FK: una tabla debe migrarse despues de todas las
// que referencia.
const TABLES = [
  { name: 'advisors', hasId: true, boolCols: ['active', 'is_group'] },
  { name: 'clients', hasId: true, boolCols: [] },
  { name: 'leads', hasId: true, boolCols: ['is_historical'] },
  { name: 'reassignments', hasId: true, boolCols: [] },
  { name: 'users', hasId: true, boolCols: ['active'] },
  { name: 'ad_spend', hasId: true, boolCols: [] },
  { name: 'reports', hasId: true, boolCols: [] },
  { name: 'payments', hasId: true, boolCols: [] },
  { name: 'settings', hasId: false, boolCols: [] },
  { name: 'informe_stats', hasId: false, boolCols: [] },
  { name: 'informe_ventas', hasId: true, boolCols: [] },
  { name: 'informe_canales', hasId: false, boolCols: [] },
];

const CHUNK_SIZE = 200;

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function bulkInsert(table, columns, rows, hasId) {
  if (!rows.length) return;
  const overriding = hasId ? ' OVERRIDING SYSTEM VALUE' : '';
  for (const batch of chunk(rows, CHUNK_SIZE)) {
    // "?" (no "$N") a proposito: el mismo shim de db.js que usa el resto del
    // backend traduce los placeholders y arma los parametros -- aqui no hace
    // falta reinventar eso.
    const rowPlaceholders = batch.map(() => `(${columns.map(() => '?').join(', ')})`).join(', ');
    const sql = `INSERT INTO ${table} (${columns.join(', ')})${overriding} VALUES ${rowPlaceholders}`;
    const params = [];
    batch.forEach((row) => columns.forEach((col) => params.push(row[col])));
    await pg.prepare(sql).run(...params);
  }
}

async function resetSequence(table) {
  await pg.exec(
    `SELECT setval(pg_get_serial_sequence('${table}', 'id'), COALESCE((SELECT MAX(id) FROM ${table}), 0) + 1, false)`
  );
}

async function main() {
  console.log('Abriendo SQLite de origen:', SQLITE_PATH);
  const sqlite = new DatabaseSync(SQLITE_PATH);

  console.log('Creando esquema en Supabase (si no existe)...');
  await init();

  // init() siembra los 3 asesores por defecto si la tabla esta vacia -- eso
  // chocaria con los IDs reales que se importan abajo (OVERRIDING SYSTEM
  // VALUE). Se vacia todo antes de importar, tanto por eso como para que
  // el script se pueda re-ejecutar sin dejar residuos de un intento previo.
  console.log('Vaciando tablas (deja el esquema, solo limpia filas)...');
  await pg.exec(
    `TRUNCATE ${TABLES.map((t) => t.name).join(', ')} RESTART IDENTITY CASCADE`
  );

  const counts = [];

  for (const { name, hasId, boolCols } of TABLES) {
    const rows = sqlite.prepare(`SELECT * FROM ${name}`).all();
    if (!rows.length) {
      counts.push({ table: name, sqlite: 0, postgres: 0 });
      console.log(`- ${name}: sin filas, se omite`);
      continue;
    }
    const columns = Object.keys(rows[0]);
    const transformed = rows.map((row) => {
      const out = { ...row };
      for (const col of boolCols) out[col] = Boolean(out[col]);
      return out;
    });

    console.log(`- ${name}: migrando ${rows.length} filas...`);
    await bulkInsert(name, columns, transformed, hasId);

    if (hasId) await resetSequence(name);

    const pgCountRow = await pg.prepare(`SELECT COUNT(*) AS c FROM ${name}`).get();
    counts.push({ table: name, sqlite: rows.length, postgres: pgCountRow.c });
  }

  console.log('\n=== Reconciliacion de conteos (SQLite vs Postgres) ===');
  let allMatch = true;
  for (const c of counts) {
    const ok = c.sqlite === c.postgres;
    if (!ok) allMatch = false;
    console.log(`${ok ? 'OK  ' : 'FAIL'} ${c.table.padEnd(18)} sqlite=${c.sqlite}  postgres=${c.postgres}`);
  }
  console.log(allMatch ? '\nTodos los conteos cuadran.' : '\nATENCION: hay conteos que no cuadran, revisar antes de continuar.');

  process.exit(allMatch ? 0 : 1);
}

main().catch((err) => {
  console.error('Migracion fallida:', err);
  process.exit(1);
});
