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

-- Costo/clics/conversiones por campaña y día, traídos de la API de Google
-- Ads (ver server/googleAds.js + server/googleAdsSync.js). Es el detalle
-- fino que alimenta tanto el desglose "por campaña" de Rentabilidad de
-- Leads como los totales mensuales de ad_spend (la sync los suma y
-- actualiza ad_spend solo, sin necesidad de teclearlos a mano).
CREATE TABLE IF NOT EXISTS google_ads_campaign_stats (
  date TEXT NOT NULL,
  campaign_id TEXT NOT NULL,
  campaign_name TEXT NOT NULL,
  cost REAL NOT NULL DEFAULT 0,
  clicks INTEGER NOT NULL DEFAULT 0,
  impressions INTEGER NOT NULL DEFAULT 0,
  conversions REAL NOT NULL DEFAULT 0,
  conversions_value REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (date, campaign_id)
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

-- Lista de precios propia del CRM (pestaña "Cotizar"): a diferencia del
-- catálogo de productos de Odoo, esta vive 100% en Nova y no depende de esa
-- integración -- la idea es que, cuando el negocio deje de usar Odoo en
-- conjunto con el CRM, cotizar siga funcionando igual. "active=0" = producto
-- descontinuado (no aparece en el buscador de nuevas líneas, pero se
-- conserva para no romper cotizaciones viejas que ya lo referencian).
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  price REAL NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Cotizaciones nativas del CRM (pestaña "Cotizar"), independientes de Odoo.
-- "number" es el consecutivo mostrado (COT-0001...), armado a partir del id
-- tras el INSERT. "state" imita las mismas 4 etapas que ya se usaban con
-- Odoo (draft/sent/sale/cancel) para no rediseñar la barra de estado de la
-- pantalla -- pero aquí nada de esto toca sale.order.
CREATE TABLE IF NOT EXISTS quotations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER NOT NULL REFERENCES leads(id),
  -- NULL brevemente entre el INSERT y el UPDATE que le pone el consecutivo
  -- (necesita el id, que solo se conoce tras insertar) -- UNIQUE en SQLite
  -- no choca entre varios NULL, asi que no hace falta un valor de relleno.
  number TEXT UNIQUE,
  state TEXT NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'sent', 'seguimiento', 'aprobada', 'sale', 'cancel')),
  note TEXT,
  validity_days INTEGER NOT NULL DEFAULT 8,
  date_order TEXT NOT NULL DEFAULT (datetime('now')),
  validity_date TEXT,
  amount_untaxed REAL NOT NULL DEFAULT 0,
  amount_tax REAL NOT NULL DEFAULT 0,
  amount_total REAL NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS quotation_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  quotation_id INTEGER NOT NULL REFERENCES quotations(id),
  product_id INTEGER REFERENCES products(id),
  product_name TEXT NOT NULL,
  qty REAL NOT NULL DEFAULT 1,
  price_unit REAL NOT NULL DEFAULT 0,
  subtotal REAL NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0
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

// El CHECK de una columna no se puede alterar con ALTER TABLE: para ampliar
// los tipos de reporte permitidos (se agrego 'mensual', el reporte de
// gerencia) hay que reconstruir la tabla. Procedimiento oficial de SQLite
// para redefinir una tabla (foreign_keys OFF + transaccion + rename).
function ensureReportsTypeCheck() {
  const row = conn.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'reports'").get();
  if (!row || row.sql.includes("'mensual'")) return;

  exec('PRAGMA foreign_keys = OFF');
  exec('BEGIN');
  try {
    exec(`
      CREATE TABLE reports_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL CHECK (type IN ('rendimiento', 'rentabilidad', 'asesor', 'mensual')),
        period_from TEXT NOT NULL,
        period_to TEXT NOT NULL,
        advisor_id INTEGER REFERENCES advisors(id),
        generated_by INTEGER REFERENCES users(id),
        generated_at TEXT NOT NULL DEFAULT (datetime('now')),
        data TEXT NOT NULL
      );
    `);
    exec(
      'INSERT INTO reports_new (id, type, period_from, period_to, advisor_id, generated_by, generated_at, data) ' +
        'SELECT id, type, period_from, period_to, advisor_id, generated_by, generated_at, data FROM reports'
    );
    exec('DROP TABLE reports');
    exec('ALTER TABLE reports_new RENAME TO reports');
    exec('COMMIT');
  } catch (err) {
    exec('ROLLBACK');
    exec('PRAGMA foreign_keys = ON');
    throw err;
  }
  exec('PRAGMA foreign_keys = ON');
}

// Igual que ensureReportsTypeCheck() de arriba, pero para quotations: se
// agregan los estados intermedios 'seguimiento' y 'aprobada' (cotización en
// seguimiento con el cliente / ya aprobada por el cliente, antes de
// convertirse en venta) al rediseño de Cotizaciones sobre el concepto de
// Velara.
function ensureQuotationsStateCheck() {
  const row = conn.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'quotations'").get();
  if (!row || row.sql.includes("'seguimiento'")) return;

  exec('PRAGMA foreign_keys = OFF');
  exec('BEGIN');
  try {
    exec(`
      CREATE TABLE quotations_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        lead_id INTEGER NOT NULL REFERENCES leads(id),
        number TEXT UNIQUE,
        state TEXT NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'sent', 'seguimiento', 'aprobada', 'sale', 'cancel')),
        note TEXT,
        validity_days INTEGER NOT NULL DEFAULT 8,
        date_order TEXT NOT NULL DEFAULT (datetime('now')),
        validity_date TEXT,
        amount_untaxed REAL NOT NULL DEFAULT 0,
        amount_tax REAL NOT NULL DEFAULT 0,
        amount_total REAL NOT NULL DEFAULT 0,
        created_by INTEGER REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    exec(
      'INSERT INTO quotations_new (id, lead_id, number, state, note, validity_days, date_order, validity_date, amount_untaxed, amount_tax, amount_total, created_by, created_at, updated_at) ' +
        'SELECT id, lead_id, number, state, note, validity_days, date_order, validity_date, amount_untaxed, amount_tax, amount_total, created_by, created_at, updated_at FROM quotations'
    );
    exec('DROP TABLE quotations');
    exec('ALTER TABLE quotations_new RENAME TO quotations');
    exec('COMMIT');
  } catch (err) {
    exec('ROLLBACK');
    exec('PRAGMA foreign_keys = ON');
    throw err;
  }
  exec('PRAGMA foreign_keys = ON');
}

// Pone un valor por defecto SOLO si esa llave todavia no existe -- a
// diferencia de seedIfEmpty() (que solo corre en una base recien creada,
// vacia de advisors), esto corre siempre y no pisa un valor que el usuario
// ya haya editado desde Ajustes.
async function ensureDefaultSetting(key, value) {
  const current = await getSetting(key, null);
  if (current === null) await setSetting(key, value);
}

// Datos de la empresa para el PDF de cotización nativo (pestaña "Cotizar",
// ver server/routes/quotations.js). Datos reales de Velara Taller S.A.S.
// (ver Velara/notas/proyecto-velara.md) donde ya se conocen; NIT y cuenta de
// pago se dejan en blanco a propósito -- no hay uno real confirmado todavía,
// y no tiene sentido inventar un número bancario en un documento real.
// Editables desde Ajustes -> "Datos de la empresa (cotizaciones)".
async function seedQuoteDefaults() {
  await ensureDefaultSetting('quote_company_name', 'Velara Taller S.A.S.');
  await ensureDefaultSetting('quote_company_nit', '');
  await ensureDefaultSetting('quote_company_address', 'Calle 56 # 12C-02, Local 3, Barranquilla, Atlántico');
  await ensureDefaultSetting('quote_company_phone', '3225640747');
  await ensureDefaultSetting('quote_company_email', 'velarataller@gmail.com');
  await ensureDefaultSetting('quote_payment_details', '');
  await ensureDefaultSetting(
    'quote_terms',
    'Tiempo estimado de entrega: 1 a 3 días hábiles (puede variar según la carga del taller y la complejidad del trabajo).\n' +
      'Garantía de 6 meses por defectos de costura y cierres.\n' +
      'El valor puede variar según el estado real del vehículo/mueble y las personalizaciones solicitadas al momento de recibirlo.\n' +
      'Para iniciar el trabajo se confirma disponibilidad y se coordina el ingreso del vehículo o los muebles al taller.\n' +
      'Esta cotización no representa una reserva de cupo.'
  );
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
  // Dirección y correo directo en el lead (igual que ya vivía "document") --
  // para que la pestaña "Cotizar" pueda pedir los datos de una cotización
  // formal (NIT, dirección, correo) sin depender de que el lead tenga un
  // cliente vinculado en la tabla clients (ver ensureColumn('clients',
  // 'address'...) más abajo, que es el otro lugar donde ya vivían estos dos
  // campos para "Alta Rápida").
  ensureColumn('leads', 'address', 'TEXT');
  ensureColumn('leads', 'email', 'TEXT');
  ensureColumn('clients', 'odoo_partner_id', 'INTEGER');
  // Emparejamiento explicito asesor del CRM <-> usuario y equipo de ventas en
  // Odoo. El Odoo del equipo tiene nombres distintos ("HAROLD SAN JUAN LECHUGA",
  // equipo "HAROL SAN JUAN") a los del CRM ("Harol"), asi que adivinar por
  // nombre no sirve -- se guardan los ids resueltos (ver scripts/odoo-setup.js
  // y routes/advisors.js). NULL = caer al emparejamiento por nombre.
  ensureColumn('advisors', 'odoo_user_id', 'INTEGER');
  ensureColumn('advisors', 'odoo_team_id', 'INTEGER');
  // Descripción larga y descuento por línea de cotización (pestaña
  // "Cotizar", motor nativo) -- se agregan aparte de CREATE TABLE porque
  // quotation_lines ya puede tener filas de antes de este cambio.
  ensureColumn('quotation_lines', 'description', 'TEXT');
  ensureColumn('quotation_lines', 'discount_percent', 'REAL NOT NULL DEFAULT 0');
  // Descripción del producto en el catálogo propio -- se copia como valor
  // por defecto a la línea al elegirlo (el asesor la puede editar o borrar
  // ahí, sin afectar la ficha del producto).
  ensureColumn('products', 'description', 'TEXT');
  // Integración con Google Ads (ver server/googleAds.js): de dónde vino
  // cada mes de ad_spend ('manual' = lo tecleó alguien en Ajustes,
  // 'google_ads_api' = lo llenó la sincronización sola) -- la sync nunca
  // pisa un mes marcado 'manual', para no perder una corrección a mano.
  // gclid/google_ads_conversion_sent_at: para reportar la venta cerrada
  // como conversión offline a Google Ads (solo aplica a un lead que haya
  // llegado con ese parámetro; hoy nada en el CRM lo captura todavía --
  // queda listo para cuando exista esa fuente, ej. una landing page).
  ensureColumn('ad_spend', 'source', "TEXT NOT NULL DEFAULT 'manual'");
  ensureColumn('leads', 'gclid', 'TEXT');
  ensureColumn('leads', 'google_ads_conversion_sent_at', 'TEXT');
  // Rediseño de Cotizaciones sobre el concepto de Velara: cada cotización
  // queda ligada a un servicio (server/velaraServices.js) y guarda sus
  // campos propios (marca/modelo/año del vehículo, material, color, etc.)
  // como JSON -- son distintos por servicio, no tiene sentido una columna
  // por campo. Ver también ensureQuotationsStateCheck() arriba (estados
  // 'seguimiento'/'aprobada' nuevos).
  ensureColumn('quotations', 'service_slug', 'TEXT');
  ensureColumn('quotations', 'service_fields', 'TEXT');
  ensureReportsTypeCheck();
  ensureQuotationsStateCheck();
  await seedIfEmpty();
  await seedQuoteDefaults();
}

module.exports = { db, getSetting, setSetting, DEFAULT_ADVISORS, init };
