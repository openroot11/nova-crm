require('dotenv').config();
const { Pool, types } = require('pg');
const { AsyncLocalStorage } = require('async_hooks');

if (!process.env.DATABASE_URL) {
  throw new Error('Falta DATABASE_URL en .env (cadena de conexion a Postgres de Supabase)');
}

// COUNT(*)/SUM(entero) en Postgres devuelven bigint (OID 20), que "pg" por
// defecto entrega como string (para no perder precision con numeros
// enormes). Aqui nunca se acerca a ese limite, y el resto del backend hace
// aritmetica directa sobre esos valores (sumas, divisiones) asumiendo que
// son numeros JS -- sin esto, cosas como "totales.asignados += fila.c"
// concatenarian strings en vez de sumar.
types.setTypeParser(20, (val) => parseInt(val, 10));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false },
});
pool.on('error', (err) => console.error('Error inesperado en el pool de Postgres:', err));

// Permite que codigo dentro de db.transaction(fn) seguir usando el mismo
// db.prepare(...).run()/.get()/.all() de siempre, pero que esas consultas
// viajen por la MISMA conexion que abrio BEGIN (necesario para que la
// transaccion realmente las agrupe) en vez de una conexion cualquiera del
// pool -- sin esto, reasignar un lead o el factory-reset podrian quedar a
// medias si algo falla a mitad de camino.
const txStorage = new AsyncLocalStorage();

async function query(sql, params) {
  const client = txStorage.getStore();
  return client ? client.query(sql, params) : pool.query(sql, params);
}

async function exec(sql) {
  // Sin segundo argumento: protocolo "simple" de Postgres, el unico que
  // acepta varias sentencias separadas por ";" en un solo string (lo usa el
  // schema de abajo). db.prepare(...).get/all/run() SIEMPRE pasan un
  // arreglo de parametros (aunque este vacio) para ir por el protocolo
  // parametrizado -- por diseno, nunca deben ejecutar mas de una sentencia.
  const client = txStorage.getStore();
  return client ? client.query(sql) : pool.query(sql);
}

// node:sqlite (y better-sqlite3) usan "?" posicional; aqui se traduce a
// $1,$2,... de Postgres sin tocar los ~147 SELECT/INSERT/UPDATE/DELETE ya
// escritos en el resto del backend.
function toPgSql(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

// Tablas sin columna "id" (su PK es otra) -- ver RETURNING mas abajo.
const NO_ID_TABLES = new Set(['settings', 'informe_canales', 'informe_stats']);

function insertTargetTable(sql) {
  const m = /^\s*insert\s+into\s+["']?(\w+)/i.exec(sql);
  return m ? m[1].toLowerCase() : null;
}

/**
 * Shim de compatibilidad: misma forma que node:sqlite's DatabaseSync
 * (db.prepare(sql).get/all/run(...params)), pero async por dentro (Postgres
 * vive en la red, no puede ser sincrono). Como node:sqlite es sincrono, el
 * resto del backend hoy llama estos metodos SIN await -- pasar a Postgres
 * obliga a agregar async/await en cada sitio que los usa, pero el SQL en si
 * (con "?") no se toca.
 *
 * .run() en un INSERT sin RETURNING propio le agrega "RETURNING id" solo y
 * expone el resultado como { lastInsertRowid }, para que el patron ya usado
 * en 8 sitios del backend ("INSERT..." + info.lastInsertRowid) siga
 * funcionando sin cambios en quien lo llama.
 */
function prepare(sql) {
  const trimmed = sql.trim();
  const pgSql = toPgSql(trimmed);
  const table = insertTargetTable(trimmed);
  const isInsert = table !== null;
  const alreadyReturning = /returning/i.test(trimmed);
  const autoReturning = isInsert && !alreadyReturning && !NO_ID_TABLES.has(table);
  const runSql = autoReturning ? `${pgSql} RETURNING id` : pgSql;

  return {
    async get(...params) {
      const res = await query(pgSql, params);
      return res.rows[0];
    },
    async all(...params) {
      const res = await query(pgSql, params);
      return res.rows;
    },
    async run(...params) {
      const res = await query(runSql, params);
      return {
        changes: res.rowCount,
        lastInsertRowid: autoReturning ? res.rows[0]?.id : undefined,
      };
    },
  };
}

// Misma firma que antes (db.transaction(fn) -> fn ejecutable), pero ahora
// async: reserva una sola conexion del pool para todo BEGIN/COMMIT/ROLLBACK,
// y la deja disponible (via AsyncLocalStorage) para que cualquier
// db.prepare(...).run() que corra dentro de fn() la reuse automaticamente.
function transaction(fn) {
  return async function runTransaction(...args) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await txStorage.run(client, () => fn(...args));
      await client.query('COMMIT');
      return result;
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* si el rollback tambien falla, se propaga el error original */
      }
      throw err;
    } finally {
      client.release();
    }
  };
}

const db = { prepare, exec, transaction };

async function getSetting(key, fallback = null) {
  const row = await db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

async function setSetting(key, value) {
  await db
    .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, String(value));
}

// Los 3 asesores reales del negocio.
const DEFAULT_ADVISORS = [
  { name: 'Harol', role: 'Asesor Comercial' },
  { name: 'Oscar', role: 'Asesor Comercial' },
  { name: 'Roberto', role: 'Asesor Comercial' },
];

// Formato identico al "datetime('now')" que usaba SQLite: texto UTC
// 'YYYY-MM-DD HH:MM:SS', sin sufijo de zona horaria -- el resto del backend
// (sla.js, routes/leads.js) ya sabe parsear exactamente ese formato, asi que
// se preserva tal cual en vez de migrar estas columnas a timestamptz nativo
// (eso tocaria logica de negocio, fuera del alcance de "solo la base de
// datos" de esta migracion).
const SCHEMA_SQL = `
CREATE OR REPLACE FUNCTION now_utc_text() RETURNS TEXT AS $$
  SELECT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS');
$$ LANGUAGE SQL STABLE;

CREATE TABLE IF NOT EXISTS advisors (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT DEFAULT 'Asesor Comercial',
  active BOOLEAN NOT NULL DEFAULT true,
  is_group BOOLEAN NOT NULL DEFAULT false,
  priority_order INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT now_utc_text()
);

CREATE TABLE IF NOT EXISTS clients (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT,
  document TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT now_utc_text()
);

CREATE TABLE IF NOT EXISTS leads (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  client_name TEXT NOT NULL,
  phone TEXT,
  document TEXT,
  product TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'asignado',
  assigned_advisor_id INTEGER REFERENCES advisors(id),
  amount REAL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT now_utc_text(),
  contacted_at TEXT,
  closed_at TEXT,
  reassigned_count INTEGER NOT NULL DEFAULT 0,
  source TEXT DEFAULT 'WhatsApp',
  quoted_at TEXT,
  channel_detail TEXT,
  last_followup_at TEXT,
  followup_count INTEGER NOT NULL DEFAULT 0,
  city TEXT,
  is_historical BOOLEAN NOT NULL DEFAULT false,
  client_id INTEGER REFERENCES clients(id)
);

CREATE TABLE IF NOT EXISTS reassignments (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  lead_id INTEGER NOT NULL REFERENCES leads(id),
  from_advisor_id INTEGER REFERENCES advisors(id),
  to_advisor_id INTEGER REFERENCES advisors(id),
  reason TEXT,
  penalty_points INTEGER NOT NULL DEFAULT 5,
  at TEXT NOT NULL DEFAULT now_utc_text()
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS informe_stats (
  fecha TEXT NOT NULL,
  advisor_id INTEGER NOT NULL REFERENCES advisors(id),
  asignados INTEGER NOT NULL DEFAULT 0,
  contactados INTEGER NOT NULL DEFAULT 0,
  cotizados INTEGER NOT NULL DEFAULT 0,
  pendientes INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (fecha, advisor_id)
);

CREATE TABLE IF NOT EXISTS informe_ventas (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  fecha TEXT NOT NULL,
  advisor_id INTEGER NOT NULL REFERENCES advisors(id),
  cliente TEXT,
  monto REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT now_utc_text()
);

CREATE TABLE IF NOT EXISTS informe_canales (
  fecha TEXT PRIMARY KEY,
  whatsapp INTEGER NOT NULL DEFAULT 0,
  correo INTEGER NOT NULL DEFAULT 0,
  llamadas INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'asesor' CHECK (role IN ('admin', 'coordinador', 'asesor')),
  advisor_id INTEGER REFERENCES advisors(id),
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TEXT NOT NULL DEFAULT now_utc_text()
);

CREATE TABLE IF NOT EXISTS ad_spend (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  month TEXT NOT NULL UNIQUE,
  amount REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT now_utc_text()
);

CREATE TABLE IF NOT EXISTS reports (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('rendimiento', 'rentabilidad', 'asesor')),
  period_from TEXT NOT NULL,
  period_to TEXT NOT NULL,
  advisor_id INTEGER REFERENCES advisors(id),
  generated_by INTEGER REFERENCES users(id),
  generated_at TEXT NOT NULL DEFAULT now_utc_text(),
  data TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  lead_id INTEGER NOT NULL REFERENCES leads(id),
  amount REAL NOT NULL,
  paid_at TEXT NOT NULL,
  notes TEXT,
  registered_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT now_utc_text()
);
`;

async function seedIfEmpty() {
  const row = await db.prepare('SELECT COUNT(*) AS c FROM advisors').get();
  if (row.c > 0) return;

  const insert = db.prepare('INSERT INTO advisors (name, role, active, is_group, priority_order) VALUES (?, ?, true, false, ?)');
  for (let idx = 0; idx < DEFAULT_ADVISORS.length; idx++) {
    const a = DEFAULT_ADVISORS[idx];
    await insert.run(a.name, a.role, idx + 1);
  }

  await setSetting('auto_backup_weekly', 'true');
  await setSetting('last_backup_at', '');
}

// Debe correr (y terminar) una sola vez al arrancar, antes de aceptar
// peticiones -- ver index.js.
async function init() {
  await exec(SCHEMA_SQL);
  await seedIfEmpty();
}

module.exports = { db, getSetting, setSetting, DEFAULT_ADVISORS, init, pool };
