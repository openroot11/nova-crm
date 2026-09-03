const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// Abrir el archivo YA es "conectar" en SQLite (no hay handshake de red que
// pueda quedar a medias como con Postgres) -- por eso pasa aqui arriba, en
// vez de dentro de init(), a diferencia del pool de Postgres que se conectaba
// solo.
const conn = new DatabaseSync(path.join(DATA_DIR, 'nova_crm.db'));
conn.exec('PRAGMA journal_mode = WAL');
conn.exec('PRAGMA foreign_keys = ON');

function prepare(sql) {
  const stmt = conn.prepare(sql);
  return {
    get(...params) {
      return stmt.get(...params);
    },
    all(...params) {
      return stmt.all(...params);
    },
    run(...params) {
      return stmt.run(...params);
    },
  };
}

function exec(sql) {
  return conn.exec(sql);
}

// Misma firma que antes con Postgres (db.transaction(fn) -> fn ejecutable,
// fn puede ser async), pero mas simple: como SQLite es una sola conexion (no
// un pool), no hace falta AsyncLocalStorage para "pegar" las queries de
// dentro de fn() a la transaccion -- db.prepare(...) ya usa siempre la misma
// conexion, este sea o no el codigo que corre entre BEGIN y COMMIT.
function transaction(fn) {
  return async function runTransaction(...args) {
    exec('BEGIN');
    try {
      const result = await fn(...args);
      exec('COMMIT');
      return result;
    } catch (err) {
      try {
        exec('ROLLBACK');
      } catch {
        /* si el rollback tambien falla, se propaga el error original */
      }
      throw err;
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

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS advisors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  role TEXT DEFAULT 'Asesor Comercial',
  active INTEGER NOT NULL DEFAULT 1,
  is_group INTEGER NOT NULL DEFAULT 0,
  priority_order INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT,
  document TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_name TEXT NOT NULL,
  phone TEXT,
  document TEXT,
  product TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'asignado',
  assigned_advisor_id INTEGER REFERENCES advisors(id),
  amount REAL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  contacted_at TEXT,
  closed_at TEXT,
  reassigned_count INTEGER NOT NULL DEFAULT 0,
  source TEXT DEFAULT 'WhatsApp',
  quoted_at TEXT,
  channel_detail TEXT,
  last_followup_at TEXT,
  followup_count INTEGER NOT NULL DEFAULT 0,
  city TEXT,
  is_historical INTEGER NOT NULL DEFAULT 0,
  client_id INTEGER REFERENCES clients(id),
  sale_reference TEXT,
  contact_ack_at TEXT
);

CREATE TABLE IF NOT EXISTS reassignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER NOT NULL REFERENCES leads(id),
  from_advisor_id INTEGER REFERENCES advisors(id),
  to_advisor_id INTEGER REFERENCES advisors(id),
  reason TEXT,
  penalty_points INTEGER NOT NULL DEFAULT 5,
  at TEXT NOT NULL DEFAULT (datetime('now'))
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
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fecha TEXT NOT NULL,
  advisor_id INTEGER NOT NULL REFERENCES advisors(id),
  cliente TEXT,
  monto REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS informe_canales (
  fecha TEXT PRIMARY KEY,
  whatsapp INTEGER NOT NULL DEFAULT 0,
  correo INTEGER NOT NULL DEFAULT 0,
  llamadas INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'asesor' CHECK (role IN ('admin', 'coordinador', 'asesor')),
  advisor_id INTEGER REFERENCES advisors(id),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ad_spend (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  month TEXT NOT NULL UNIQUE,
  amount REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK (type IN ('rendimiento', 'rentabilidad', 'asesor')),
  period_from TEXT NOT NULL,
  period_to TEXT NOT NULL,
  advisor_id INTEGER REFERENCES advisors(id),
  generated_by INTEGER REFERENCES users(id),
  generated_at TEXT NOT NULL DEFAULT (datetime('now')),
  data TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER NOT NULL REFERENCES leads(id),
  amount REAL NOT NULL,
  paid_at TEXT NOT NULL,
  notes TEXT,
  registered_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Todo lo que NO sea Google Ads queda fuera de las vistas operativas/
-- agregadas del programa (Ventas, SLA, Seguimiento, Estadisticas, Dashboard,
-- Informe, Asesores) a peticion del negocio -- hoy coincide 100% con el lote
-- historico importado de Odoo en agosto (is_historical=1), pero la regla es
-- por canal, no por ese flag, asi que tambien aplica a cualquier lead futuro
-- que no sea de Ads. Los datos NO se borran de "leads" (siguen intactos ahi,
-- respaldos y backups los siguen incluyendo completos); esta vista es
-- puramente de lectura para esas pantallas. Ficha de Clientes (routes/
-- clients.js) sigue leyendo "leads" directamente a proposito, para no perder
-- el historial de compras de un cliente aunque su lead quede oculto aqui.
CREATE VIEW IF NOT EXISTS leads_visible AS
SELECT * FROM leads WHERE channel_detail = 'Google Ads';
`;

async function seedIfEmpty() {
  const row = await db.prepare('SELECT COUNT(*) AS c FROM advisors').get();
  if (row.c > 0) return;

  const insert = db.prepare('INSERT INTO advisors (name, role, active, is_group, priority_order) VALUES (?, ?, 1, 0, ?)');
  for (let idx = 0; idx < DEFAULT_ADVISORS.length; idx++) {
    const a = DEFAULT_ADVISORS[idx];
    await insert.run(a.name, a.role, idx + 1);
  }

  await setSetting('auto_backup_weekly', 'true');
  await setSetting('last_backup_at', '');
}

// CREATE TABLE IF NOT EXISTS no agrega columnas a una tabla que ya existe --
// para una base con datos reales (como esta, en uso desde antes de agregar
// contact_ack_at) hace falta migrar la columna a mano si todavia no esta.
function ensureColumn(table, column, definition) {
  const cols = conn.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) {
    exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

// Debe correr (y terminar) una sola vez al arrancar, antes de aceptar
// peticiones -- ver index.js.
async function init() {
  exec(SCHEMA_SQL);
  ensureColumn('leads', 'contact_ack_at', 'TEXT');
  // Semaforo de carga por asesor (ver server/routes/advisors.js): NULL =
  // "automatico" (se calcula solo desde cuantos leads vencidos tiene
  // encima); 'rojo'/'amarillo'/'verde' = forzado a mano por
  // coordinador/admin, que manda sobre el calculo automatico hasta que se
  // borre (vuelva a NULL).
  ensureColumn('advisors', 'manual_status_override', 'TEXT');
  // Direccion y correo del cliente: antes no se pedian en ningun formulario
  // (solo nombre/telefono/documento). Se agregan para el "pegar y
  // autocompletar" de Alta Rapida (ver ventas.js) -- viven en clients, no en
  // leads, porque son datos del contacto, no de un pedido puntual.
  ensureColumn('clients', 'address', 'TEXT');
  ensureColumn('clients', 'email', 'TEXT');
  // Enlace con Odoo (ver server/odoo.js): al crear un lead en el CRM tambien
  // se crea/deduplica el contacto y la oportunidad en Odoo, y al cotizar se
  // crea el sale.order. Guardamos esos ids para poder abrir/actualizar el
  // registro correcto despues (PDF, sincronizacion de vuelta). NULL = ese
  // lead nunca llego a Odoo (integracion apagada, o fallo puntual).
  ensureColumn('leads', 'odoo_partner_id', 'INTEGER');
  ensureColumn('leads', 'odoo_lead_id', 'INTEGER');
  ensureColumn('leads', 'odoo_order_id', 'INTEGER');
  ensureColumn('clients', 'odoo_partner_id', 'INTEGER');
  await seedIfEmpty();
}

module.exports = { db, getSetting, setSetting, DEFAULT_ADVISORS, init };
