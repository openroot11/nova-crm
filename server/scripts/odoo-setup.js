// Configuracion de Odoo para Nova CRM (se corre a mano):
//
//   cd server
//   node scripts/odoo-setup.js --check    # SOLO inspecciona, no cambia nada
//   node scripts/odoo-setup.js --dry-run  # muestra que cambiaria
//   node scripts/odoo-setup.js            # aplica los cambios
//
// Deja el Odoo que apunte server/.env listo para el CRM:
//   - Moneda de la compania -> COP (solo si no lo esta ya).
//   - Impuesto de venta a 19% (solo si no lo esta ya -- NO renombra nada si ya
//     esta en 19).
//   - Empareja cada asesor del CRM con su usuario y su equipo de ventas en
//     Odoo (ADVISOR_MAP abajo) y guarda esos ids en la tabla advisors del CRM.
//
// Es idempotente. NO importa la lista de precios. Con --check no escribe NADA.

require('dotenv').config();
const odoo = require('../odoo');
const { db, init } = require('../db');

const CHECK_ONLY = process.argv.includes('--check');
const RESET_LINKS = process.argv.includes('--reset-links');
const DRY_RUN = process.argv.includes('--dry-run') || CHECK_ONLY;
const TARGET_CURRENCY = 'COP';
const TARGET_TAX_AMOUNT = 19;

// Asesor en Nova CRM  ->  su cuenta y su equipo en Odoo.
// (confirmado con el usuario 2026-09-03 para la base "manofactura")
const ADVISOR_MAP = [
  { nova: 'Harol', odooLogin: 'harold.sanjuan@ferreplasticosnova.com', odooTeam: 'HAROL SAN JUAN' },
  { nova: 'Oscar', odooLogin: 'oscar.bedoya@manufacturasnova.com', odooTeam: 'OSCAR BEDOYA' },
  { nova: 'Roberto', odooLogin: 'roberto.alvarez@manufacturasnova.com', odooTeam: 'ROBERTO RAMIREZ' },
];

const log = (...a) => console.log(...a);
const step = (t) => console.log(`\n=== ${t} ===`);
const wouldOrDid = () => (DRY_RUN ? 'SE HARIA' : 'HECHO');

async function ensureCurrencyCOP() {
  step('Moneda de la compania');
  const [cur] = await odoo.callKw('res.currency', 'search_read', [[['name', '=', TARGET_CURRENCY]]], {
    fields: ['id', 'name', 'active'],
    context: { active_test: false },
  });
  if (!cur) {
    log(`! No existe la moneda ${TARGET_CURRENCY} en Odoo.`);
    return;
  }
  if (!cur.active) {
    log(`- ${TARGET_CURRENCY} inactiva -> activar`);
    if (!DRY_RUN) await odoo.callKw('res.currency', 'write', [[cur.id], { active: true }]);
    log(`  ${wouldOrDid()}: ${TARGET_CURRENCY} activada`);
  }

  const [co] = await odoo.callKw('res.company', 'search_read', [[]], { fields: ['id', 'name', 'currency_id'] });
  if (co.currency_id && co.currency_id[1] === TARGET_CURRENCY) {
    log(`- La compañía "${co.name}" ya usa ${TARGET_CURRENCY} — nada que hacer`);
  } else {
    log(`- Compañía "${co.name}" en ${co.currency_id ? co.currency_id[1] : '—'} -> ${TARGET_CURRENCY}`);
    if (!DRY_RUN) {
      try {
        await odoo.callKw('res.company', 'write', [[co.id], { currency_id: cur.id }]);
        log(`  HECHO`);
      } catch (err) {
        log(`  ! Odoo no dejó: ${err.message}. Cámbiala a mano en Ajustes > Empresas.`);
      }
    }
  }

  const badLists = await odoo.callKw('product.pricelist', 'search_read', [[['currency_id', '!=', cur.id]]], {
    fields: ['id', 'name', 'currency_id'],
    context: { active_test: false },
  });
  if (badLists.length) {
    log(`- ${badLists.length} tarifa(s) en otra moneda: ${badLists.map((l) => `${l.name} (${l.currency_id[1]})`).join(', ')} -> ${TARGET_CURRENCY}`);
    if (!DRY_RUN) await odoo.callKw('product.pricelist', 'write', [badLists.map((l) => l.id), { currency_id: cur.id }]);
    log(`  ${wouldOrDid()}`);
  } else {
    log(`- Las tarifas ya están en ${TARGET_CURRENCY}`);
  }
}

async function ensureSaleTax() {
  step(`Impuesto de venta (${TARGET_TAX_AMOUNT}%)`);
  const [co] = await odoo.callKw('res.company', 'search_read', [[]], { fields: ['id', 'account_sale_tax_id'] });
  let taxId = co.account_sale_tax_id && co.account_sale_tax_id[0];
  if (!taxId) {
    const found = await odoo.callKw('account.tax', 'search', [[['type_tax_use', '=', 'sale'], ['amount_type', '=', 'percent']]], {
      limit: 1,
      order: 'amount desc',
    });
    taxId = found[0];
  }
  if (!taxId) {
    log('! No hay impuesto de venta configurado. Créalo a mano en Contabilidad > Impuestos.');
    return;
  }
  const [tax] = await odoo.callKw('account.tax', 'read', [[taxId], ['name', 'amount']]);
  if (tax.amount === TARGET_TAX_AMOUNT) {
    // Ya está en 19% -> NO se toca (no se renombra; en el Odoo real el nombre
    // "19%" ya lo usan plantillas y reportes).
    log(`- El impuesto de venta por defecto ya es "${tax.name}" (${tax.amount}%) — nada que hacer`);
    return;
  }
  log(`- Impuesto de venta actual: "${tax.name}" (${tax.amount}%) -> ${TARGET_TAX_AMOUNT}%`);
  if (!DRY_RUN) await odoo.callKw('account.tax', 'write', [[taxId], { amount: TARGET_TAX_AMOUNT }]);
  log(`  ${wouldOrDid()}: impuesto ajustado a ${TARGET_TAX_AMOUNT}% (sin renombrar)`);
}

async function linkAdvisors() {
  step('Emparejar asesores del CRM con Odoo (usuario + equipo)');
  for (const m of ADVISOR_MAP) {
    const advisorRow = db.prepare('SELECT id, name, odoo_user_id, odoo_team_id FROM advisors WHERE name = ? COLLATE NOCASE').get(m.nova);
    if (!advisorRow) {
      log(`  ! "${m.nova}": no existe ese asesor en el CRM -> se omite`);
      continue;
    }
    const [user] = await odoo.callKw('res.users', 'search_read', [[['login', '=', m.odooLogin]]], { fields: ['id', 'name'] });
    const [team] = await odoo.callKw('crm.team', 'search_read', [[['name', '=', m.odooTeam]]], { fields: ['id', 'name', 'member_ids'] });
    if (!user) {
      log(`  ! "${m.nova}": no encuentro el usuario ${m.odooLogin} en Odoo -> se omite`);
      continue;
    }
    if (!team) {
      log(`  ! "${m.nova}": no encuentro el equipo "${m.odooTeam}" en Odoo -> se omite`);
      continue;
    }
    // El usuario debe ser miembro de su equipo en Odoo (para "Mi pipeline").
    if (!(team.member_ids || []).includes(user.id)) {
      log(`  - ${m.nova}: agregar ${user.name} como miembro del equipo "${team.name}"`);
      if (!DRY_RUN) await odoo.callKw('crm.team', 'write', [[team.id], { member_ids: [[4, user.id]] }]);
    }
    // Guardar los ids en la fila del asesor del CRM.
    if (advisorRow.odoo_user_id === user.id && advisorRow.odoo_team_id === team.id) {
      log(`  - ${m.nova} -> ${user.name} / equipo "${team.name}"  (ya emparejado)`);
    } else {
      if (!DRY_RUN) db.prepare('UPDATE advisors SET odoo_user_id = ?, odoo_team_id = ? WHERE id = ?').run(user.id, team.id, advisorRow.id);
      log(`  - ${m.nova} -> ${user.name} / equipo "${team.name}"   ${wouldOrDid()}`);
    }
  }
}

// Inventario de solo lectura.
async function inspect() {
  const [co] = await odoo.callKw('res.company', 'search_read', [[]], { fields: ['name', 'currency_id', 'country_id', 'account_sale_tax_id'] });
  step('Compañía');
  log(`  ${co.name} · país ${co.country_id ? co.country_id[1] : '—'} · moneda ${co.currency_id ? co.currency_id[1] : '—'}`);
  log(`  IVA de venta por defecto: ${co.account_sale_tax_id ? co.account_sale_tax_id[1] : '—'}`);

  step('Módulos');
  const mods = await odoo.callKw('ir.module.module', 'search_read',
    [[['name', 'in', ['crm', 'sale', 'sale_management', 'account', 'l10n_co', 'l10n_co_edi']]]], { fields: ['name', 'state'] });
  log('  ' + mods.map((m) => `${m.name}=${m.state}`).join(', '));

  step('Etapas del CRM (crm.stage)  <- para ODOO_STAGE_* en .env');
  const stages = await odoo.callKw('crm.stage', 'search_read', [[]], { fields: ['name', 'sequence', 'is_won'], order: 'sequence' });
  stages.forEach((s) => log(`  seq ${String(s.sequence).padStart(3)}  ${s.name}${s.is_won ? '   (GANADO/is_won)' : ''}`));

  step('Equipos de ventas (crm.team)');
  const teams = await odoo.callKw('crm.team', 'search_read', [[]], { fields: ['name', 'user_id'] });
  teams.forEach((t) => log(`  ${t.name}${t.user_id ? `  (líder: ${t.user_id[1]})` : ''}`));

  step('Usuarios internos');
  const users = await odoo.callKw('res.users', 'search_read', [[['share', '=', false]]], { fields: ['name', 'login'] });
  users.forEach((u) => log(`  ${u.name}  <${u.login}>`));

  step('Impuestos de venta');
  const taxes = await odoo.callKw('account.tax', 'search_read', [[['type_tax_use', '=', 'sale']]], { fields: ['name', 'amount'], context: { active_test: false } });
  taxes.forEach((t) => log(`  ${t.name}  (${t.amount}%)`));

  step('Productos vendibles');
  log(`  ${await odoo.callKw('product.product', 'search_count', [[['sale_ok', '=', true]]])} producto(s)`);

  log('\n--- Fin de la inspección. No se cambió nada. ---');
}

async function main() {
  if (!odoo.isEnabled()) {
    console.error('Odoo no está configurado (server/.env: ODOO_URL, ODOO_DB, ODOO_USER, ODOO_API_KEY/ODOO_PASSWORD).');
    process.exit(1);
  }
  await init(); // asegura el esquema del CRM (columnas advisors.odoo_user_id, etc.)

  if (RESET_LINKS) {
    // Al cambiar de servidor Odoo (ej. local -> hospedado) los ids guardados
    // (odoo_lead_id, odoo_partner_id, odoo_order_id) apuntan al Odoo viejo y no
    // sirven. Se limpian para que cada lead se vuelva a sincronizar de cero.
    step('Limpiar enlaces a Odoo (cambio de servidor)');
    const n1 = db.prepare('SELECT COUNT(*) c FROM leads WHERE odoo_lead_id IS NOT NULL OR odoo_partner_id IS NOT NULL OR odoo_order_id IS NOT NULL').get().c;
    const n2 = db.prepare('SELECT COUNT(*) c FROM clients WHERE odoo_partner_id IS NOT NULL').get().c;
    if (!DRY_RUN) {
      db.prepare('UPDATE leads SET odoo_lead_id = NULL, odoo_partner_id = NULL, odoo_order_id = NULL').run();
      db.prepare('UPDATE clients SET odoo_partner_id = NULL').run();
      db.prepare('UPDATE advisors SET odoo_user_id = NULL, odoo_team_id = NULL').run();
    }
    log(`  ${wouldOrDid()}: limpiar ${n1} lead(s) y ${n2} cliente(s). Los asesores se re-emparejan abajo.`);
  }

  const info = await odoo.ping();
  log(`Conectado a ${info.url} · base ${info.db} · ${info.company} · usuario ${info.user}`);

  if (CHECK_ONLY) {
    log('\n*** MODO INSPECCIÓN (--check): NO se escribe nada ***');
    await inspect();
    return;
  }

  log(DRY_RUN ? '\n*** MODO SIMULACIÓN (--dry-run): no se escribe nada ***' : '\n*** Aplicando cambios ***');
  await ensureCurrencyCOP();
  await ensureSaleTax();
  await linkAdvisors();

  step('Resumen');
  const rows = db.prepare('SELECT name, odoo_user_id, odoo_team_id FROM advisors WHERE odoo_user_id IS NOT NULL').all();
  rows.forEach((r) => log(`  ${r.name}: usuario Odoo #${r.odoo_user_id}, equipo Odoo #${r.odoo_team_id}`));
  log('\nListo. Falta ajustar ODOO_STAGE_* en server/.env con los nombres de arriba y reiniciar el CRM.');
}

main().catch((err) => {
  console.error('\nFALLÓ:', err.message, err.odoo || '');
  process.exit(1);
});
