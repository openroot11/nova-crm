const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'nova_crm.db'));
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

// node:sqlite no trae un helper de transacciones como better-sqlite3;
// se agrega uno con la misma firma (db.transaction(fn) -> fn ejecutable)
// para que el resto del backend pueda usarlo igual.
db.transaction = function transaction(fn) {
  return function runTransaction(...args) {
    db.exec('BEGIN');
    try {
      const result = fn(...args);
      db.exec('COMMIT');
      return result;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  };
};

db.exec(`
CREATE TABLE IF NOT EXISTS advisors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  role TEXT DEFAULT 'Asesor Comercial',
  active INTEGER NOT NULL DEFAULT 1,
  is_group INTEGER NOT NULL DEFAULT 0,
  priority_order INTEGER NOT NULL,
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
  assigned_advisor_id INTEGER,
  amount REAL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  contacted_at TEXT,
  closed_at TEXT,
  reassigned_count INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (assigned_advisor_id) REFERENCES advisors(id)
);

CREATE TABLE IF NOT EXISTS reassignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER NOT NULL,
  from_advisor_id INTEGER,
  to_advisor_id INTEGER,
  reason TEXT,
  penalty_points INTEGER NOT NULL DEFAULT 5,
  at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (lead_id) REFERENCES leads(id),
  FOREIGN KEY (from_advisor_id) REFERENCES advisors(id),
  FOREIGN KEY (to_advisor_id) REFERENCES advisors(id)
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS informe_stats (
  fecha TEXT NOT NULL,
  advisor_id INTEGER NOT NULL,
  asignados INTEGER NOT NULL DEFAULT 0,
  contactados INTEGER NOT NULL DEFAULT 0,
  cotizados INTEGER NOT NULL DEFAULT 0,
  pendientes INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (fecha, advisor_id),
  FOREIGN KEY (advisor_id) REFERENCES advisors(id)
);

CREATE TABLE IF NOT EXISTS informe_ventas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fecha TEXT NOT NULL,
  advisor_id INTEGER NOT NULL,
  cliente TEXT,
  monto REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (advisor_id) REFERENCES advisors(id)
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
  advisor_id INTEGER,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (advisor_id) REFERENCES advisors(id)
);

CREATE TABLE IF NOT EXISTS ad_spend (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  month TEXT NOT NULL UNIQUE,
  amount REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK (type IN ('rendimiento', 'rentabilidad')),
  period_from TEXT NOT NULL,
  period_to TEXT NOT NULL,
  generated_by INTEGER,
  generated_at TEXT NOT NULL DEFAULT (datetime('now')),
  data TEXT NOT NULL,
  FOREIGN KEY (generated_by) REFERENCES users(id)
);
`);

function getSetting(key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

function setSetting(key, value) {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, String(value));
}

// Los 3 asesores reales del negocio (el seed original traia 4, incluyendo un
// "Jose" que nunca existio y un "Harold" mal escrito - ver migracion abajo).
const DEFAULT_ADVISORS = [
  { name: 'Harol', role: 'Asesor Comercial' },
  { name: 'Oscar', role: 'Asesor Comercial' },
  { name: 'Roberto', role: 'Asesor Comercial' },
];

/**
 * Agrega una columna a una tabla existente solo si todavia no existe.
 * Necesario porque hay datos reales en producción y no se puede recrear
 * la tabla con DROP/CREATE.
 */
function ensureColumn(table, column, ddl) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  const exists = columns.some((c) => c.name === column);
  if (!exists) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}

ensureColumn('leads', 'source', "source TEXT DEFAULT 'WhatsApp'");
ensureColumn('leads', 'quoted_at', 'quoted_at TEXT');
// Origen pagado/organico del lead (Google Ads, Organico, Referido, Otro),
// independiente del canal (source). Se separa de "source" porque ese campo
// ya se simplifico para el informe diario (ver migrateSourceV2) y no debe
// volver a mezclarse; este es el dato que necesita el reporte de
// rentabilidad de leads (costo por lead / ROI de Google Ads).
ensureColumn('leads', 'channel_detail', 'channel_detail TEXT');
// Seguimiento post-cotizacion (ver followup.js): cada vez que alguien
// insiste con el cliente sobre una cotizacion enviada, se registra aqui.
ensureColumn('leads', 'last_followup_at', 'last_followup_at TEXT');
ensureColumn('leads', 'followup_count', 'followup_count INTEGER NOT NULL DEFAULT 0');

// Migracion unica: el canal de entrada se simplifica a las 3 categorias que
// usa el informe diario real (WhatsApp/Correo/Llamada) en vez de variantes
// como "WhatsApp - Google Ads"/"WhatsApp - Organico".
function migrateSourceV2() {
  if (getSetting('migrated_source_v2') === 'true') return;
  db.exec("UPDATE leads SET source = 'WhatsApp' WHERE source IN ('WhatsApp - Google Ads', 'WhatsApp - Orgánico') OR source IS NULL");
  setSetting('migrated_source_v2', 'true');
}

// Migracion unica: los estados viejos 'nuevo' y 'en_proceso' pasan a ser
// 'asignado' bajo el nuevo modelo de embudo (asignado/contactado/cotizado/
// cerrado_ganado/cerrado_perdido). Guardada con un flag en settings para
// que nunca se vuelva a ejecutar (idempotente).
function migrateStatusV2() {
  if (getSetting('migrated_status_v2') === 'true') return;
  db.exec("UPDATE leads SET status = 'asignado' WHERE status IN ('nuevo', 'en_proceso')");
  setSetting('migrated_status_v2', 'true');
}

// Migracion unica: corrige el seed original de 4 asesores (Oscar, Roberto,
// Jose, Harold) al roster real de 3 (Harol, Oscar, Roberto). "Harold" se
// renombra a "Harol" (typo); "Jose" no es un asesor real y se pausa
// (active=0) en vez de borrarse, para no romper el historial de leads que
// ya le hayan sido asignados.
function migrateAdvisorsV2() {
  if (getSetting('migrated_advisors_v2') === 'true') return;
  const harold = db.prepare("SELECT id FROM advisors WHERE name = 'Harold'").get();
  if (harold) {
    db.prepare("UPDATE advisors SET name = 'Harol' WHERE id = ?").run(harold.id);
  }
  const jose = db.prepare("SELECT id FROM advisors WHERE name = 'Jose' AND active = 1").get();
  if (jose) {
    db.prepare('UPDATE advisors SET active = 0 WHERE id = ?').run(jose.id);
  }
  setSetting('migrated_advisors_v2', 'true');
}

// Migracion unica: el sistema pasa de una sola clave compartida
// (settings.admin_password_hash) a cuentas individuales (tabla users). Si ya
// habia una clave compartida configurada, se crea un usuario 'admin' que la
// hereda tal cual (mismo hash, mismo formato) para que quien ya la conocia
// pueda seguir entrando sin quedar bloqueado; desde ahi puede crear las
// cuentas del resto del equipo en Ajustes -> Usuarios. Si nunca hubo clave
// (instalacion nueva), no se crea nada y el flujo de "primer uso" de
// auth.js se encarga de crear el primer usuario admin.
function migrateUsersV1() {
  const userCount = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  if (userCount > 0) return;
  const sharedHash = getSetting('admin_password_hash');
  if (!sharedHash) return;
  db.prepare(
    "INSERT INTO users (username, password_hash, role, active) VALUES ('admin', ?, 'admin', 1)"
  ).run(sharedHash);
}

migrateStatusV2();
migrateAdvisorsV2();
migrateSourceV2();
migrateUsersV1();

function seedIfEmpty() {
  const count = db.prepare('SELECT COUNT(*) AS c FROM advisors').get().c;
  if (count > 0) return;

  const insert = db.prepare(
    'INSERT INTO advisors (name, role, active, is_group, priority_order) VALUES (?, ?, 1, 0, ?)'
  );
  const seedTx = db.transaction(() => {
    DEFAULT_ADVISORS.forEach((a, idx) => insert.run(a.name, a.role, idx + 1));
  });
  seedTx();

  setSetting('auto_backup_weekly', 'true');
  setSetting('last_backup_at', '');
}

seedIfEmpty();

module.exports = { db, getSetting, setSetting, DEFAULT_ADVISORS, ensureColumn };
