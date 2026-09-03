// Configuracion inicial de Odoo para Nova CRM (se corre a mano):
//
//   cd server
//   node scripts/odoo-setup.js --check    # SOLO inspecciona, no cambia nada
//   node scripts/odoo-setup.js --dry-run  # muestra que cambiaria
//   node scripts/odoo-setup.js            # aplica los cambios
//
// Deja el Odoo (el que apunte server/.env) listo para el CRM:
//   - Moneda de la compania -> COP (para que el PDF salga en pesos).
//   - Impuesto de venta -> IVA 19% (Colombia), aplicado a los productos.
//   - Un equipo de ventas por asesor (Harol/Oscar/Roberto); "Ventas Nova" general.
//
// Es idempotente. NO importa la lista de precios ni toca la contabilidad.
// Con --check no escribe NADA -- sirve para revisar un Odoo nuevo (ej. el
// hospedado) antes de decidir que ajustar.

require('dotenv').config();
const odoo = require('../odoo');

const CHECK_ONLY = process.argv.includes('--check');
const DRY_RUN = process.argv.includes('--dry-run') || CHECK_ONLY;
const TARGET_CURRENCY = 'COP';
const TARGET_TAX_NAME = 'IVA 19%';
const TARGET_TAX_AMOUNT = 19;
const SALES_TEAM_NAME = 'Ventas Nova';
// Nombres de los asesores del CRM tal como aparecen como usuarios en Odoo.
const ADVISOR_LOGINS_OR_NAMES = ['Harol', 'Oscar', 'Roberto'];

const log = (...a) => console.log(...a);
const step = (t) => console.log(`\n=== ${t} ===`);
const wouldOrDid = () => (DRY_RUN ? 'SE HARIA' : 'HECHO');

async function ensureCurrencyCOP() {
  step('Moneda de la compania');
  const [cur] = await odoo.callKw(
    'res.currency', 'search_read',
    [[['name', '=', TARGET_CURRENCY]]],
    { fields: ['id', 'name', 'active'], context: { active_test: false } }
  );
  if (!cur) {
    log(`! No existe la moneda ${TARGET_CURRENCY} en Odoo. Actívala en Contabilidad > Configuración > Monedas.`);
    return;
  }
  if (!cur.active) {
    log(`- ${TARGET_CURRENCY} está inactiva -> activar`);
    if (!DRY_RUN) await odoo.callKw('res.currency', 'write', [[cur.id], { active: true }]);
    log(`  ${wouldOrDid()}: ${TARGET_CURRENCY} activada`);
  } else {
    log(`- ${TARGET_CURRENCY} ya está activa`);
  }

  const [co] = await odoo.callKw('res.company', 'search_read', [[]], { fields: ['id', 'name', 'currency_id'] });
  if (co.currency_id && co.currency_id[1] === TARGET_CURRENCY) {
    log(`- La compañía "${co.name}" ya usa ${TARGET_CURRENCY}`);
  } else {
    log(`- Compañía "${co.name}" está en ${co.currency_id ? co.currency_id[1] : '—'} -> ${TARGET_CURRENCY}`);
    if (DRY_RUN) {
      log(`  SE HARIA: res.company(${co.id}).currency_id = ${cur.id}`);
    } else {
      try {
        await odoo.callKw('res.company', 'write', [[co.id], { currency_id: cur.id }]);
        log(`  HECHO: moneda de la compañía = ${TARGET_CURRENCY}`);
      } catch (err) {
        log(`  ! Odoo no dejó cambiar la moneda automáticamente: ${err.message}`);
        log(`    Cámbiala a mano en: Ajustes > Usuarios y Empresas > Empresas > ${co.name} > Divisa.`);
      }
    }
  }

  // La divisa de una cotización sale del pricelist, no de la compañía: si hay
  // un pricelist "Predeterminado" en otra moneda, todas las cotizaciones salen
  // en esa moneda aunque la compañía ya sea COP. Se alinea al TARGET.
  const badLists = await odoo.callKw(
    'product.pricelist', 'search_read',
    [[['currency_id', '!=', cur.id]]],
    { fields: ['id', 'name', 'currency_id'], context: { active_test: false } }
  );
  if (!badLists.length) {
    log(`- Las tarifas (pricelists) ya están en ${TARGET_CURRENCY}`);
  } else {
    log(`- ${badLists.length} tarifa(s) en otra moneda: ${badLists.map((l) => `${l.name} (${l.currency_id[1]})`).join(', ')} -> ${TARGET_CURRENCY}`);
    if (!DRY_RUN) {
      await odoo.callKw('product.pricelist', 'write', [badLists.map((l) => l.id), { currency_id: cur.id }]);
    }
    log(`  ${wouldOrDid()}: tarifas convertidas a ${TARGET_CURRENCY}`);
  }
}

async function ensureSaleTax19() {
  step('Impuesto de venta (IVA 19%)');
  // Reutiliza el impuesto de venta que ya está enganchado a la compañía y a los
  // productos (originalmente "15%") en vez de crear uno nuevo: así no hay que
  // re-mapear productos ni pelear con campos obligatorios de un impuesto nuevo.
  const [co] = await odoo.callKw('res.company', 'search_read', [[]], { fields: ['id', 'account_sale_tax_id'] });
  let taxId = co.account_sale_tax_id && co.account_sale_tax_id[0];

  if (!taxId) {
    const found = await odoo.callKw(
      'account.tax', 'search',
      [[['type_tax_use', '=', 'sale'], ['amount_type', '=', 'percent']]],
      { limit: 1, order: 'amount desc' }
    );
    taxId = found[0];
  }
  if (!taxId) {
    log('! No hay ningún impuesto de venta configurado. Créalo a mano en Contabilidad > Impuestos.');
    return null;
  }

  const [tax] = await odoo.callKw('account.tax', 'read', [[taxId], ['name', 'amount', 'tax_group_id']]);
  if (tax.name === TARGET_TAX_NAME && tax.amount === TARGET_TAX_AMOUNT) {
    log(`- El impuesto de venta ya es "${TARGET_TAX_NAME}" (${TARGET_TAX_AMOUNT}%)`);
  } else {
    log(`- Impuesto de venta actual: "${tax.name}" (${tax.amount}%) -> "${TARGET_TAX_NAME}" (${TARGET_TAX_AMOUNT}%)`);
    if (!DRY_RUN) {
      await odoo.callKw('account.tax', 'write', [[taxId], { name: TARGET_TAX_NAME, amount: TARGET_TAX_AMOUNT }]);
      if (tax.tax_group_id) {
        await odoo.callKw('account.tax.group', 'write', [[tax.tax_group_id[0]], { name: TARGET_TAX_NAME }]);
      }
    }
    log(`  ${wouldOrDid()}: impuesto renombrado y ajustado a ${TARGET_TAX_AMOUNT}%`);
  }

  // Asegura que la compañía y los productos vendibles lo usen.
  if (!co.account_sale_tax_id) {
    log('- Compañía sin impuesto de venta por defecto -> asignar');
    if (!DRY_RUN) await odoo.callKw('res.company', 'write', [[co.id], { account_sale_tax_id: taxId }]);
    log(`  ${wouldOrDid()}: impuesto de venta por defecto de la compañía`);
  }

  const prods = await odoo.callKw(
    'product.product', 'search_read',
    [[['sale_ok', '=', true]]],
    { fields: ['id', 'display_name', 'taxes_id'] }
  );
  const missing = prods.filter((p) => !(p.taxes_id || []).includes(taxId));
  if (!missing.length) {
    log(`- Los ${prods.length} productos vendibles ya tienen el impuesto`);
  } else {
    log(`- ${missing.length} producto(s) sin el impuesto: ${missing.map((p) => p.display_name).join(', ')}`);
    if (!DRY_RUN) {
      for (const p of missing) {
        await odoo.callKw('product.template', 'write', [[p.id], { taxes_id: [[4, taxId]] }]).catch(async () => {
          // product.product vs product.template: si el id no coincide, resolver el template
          const [pp] = await odoo.callKw('product.product', 'read', [[p.id], ['product_tmpl_id']]);
          await odoo.callKw('product.template', 'write', [[pp.product_tmpl_id[0]], { taxes_id: [[4, taxId]] }]);
        });
      }
    }
    log(`  ${wouldOrDid()}: impuesto agregado a los productos`);
  }
  return taxId;
}

async function ensureSalesTeams() {
  step('Equipos de ventas (uno por asesor)');

  // El asesor <-> su usuario de Odoo.
  const users = await odoo.callKw(
    'res.users', 'search_read',
    [['|', ['name', 'in', ADVISOR_LOGINS_OR_NAMES], ['login', 'in', ADVISOR_LOGINS_OR_NAMES.map((s) => s.toLowerCase())]]],
    { fields: ['id', 'name', 'login'] }
  );
  const userByAdvisor = (name) =>
    users.find((u) => u.name.toLowerCase() === name.toLowerCase() || u.login.toLowerCase() === name.toLowerCase());

  // "Ventas Nova" se conserva como equipo general (no se le quitan miembros).
  const [general] = await odoo.callKw('crm.team', 'search_read', [[['name', '=', SALES_TEAM_NAME]]], { fields: ['id'] });
  log(general ? `- Equipo general "${SALES_TEAM_NAME}" conservado` : `! No existe "${SALES_TEAM_NAME}" (no es obligatorio)`);

  for (const advisorName of ADVISOR_LOGINS_OR_NAMES) {
    const user = userByAdvisor(advisorName);
    if (!user) {
      log(`  ! ${advisorName}: no tiene usuario en Odoo -> se omite su equipo`);
      continue;
    }
    // Buscar un equipo que ya sea "de" este asesor: por nombre, o del que ya
    // sea líder (cubre el equipo "harold" preexistente para "Harol").
    const existing = await odoo.callKw(
      'crm.team', 'search_read',
      [['|', ['name', '=ilike', advisorName], ['user_id', '=', user.id]]],
      { fields: ['id', 'name', 'user_id', 'member_ids'] }
    );
    const team = existing[0];
    if (!team) {
      log(`  - ${advisorName}: crear equipo`);
      if (!DRY_RUN) {
        await odoo.callKw('crm.team', 'create', [{ name: advisorName, user_id: user.id, member_ids: [[4, user.id]] }]);
      }
      log(`    ${wouldOrDid()}: equipo "${advisorName}" (líder y miembro: ${user.name})`);
      continue;
    }
    const patch = {};
    if (team.name !== advisorName) patch.name = advisorName;
    if (!team.user_id || team.user_id[0] !== user.id) patch.user_id = user.id;
    if (!(team.member_ids || []).includes(user.id)) patch.member_ids = [[4, user.id]];
    if (!Object.keys(patch).length) {
      log(`  - ${advisorName}: equipo ya OK (id ${team.id})`);
    } else {
      log(`  - ${advisorName}: ajustar equipo id ${team.id} (${team.name})`);
      if (!DRY_RUN) await odoo.callKw('crm.team', 'write', [[team.id], patch]);
      log(`    ${wouldOrDid()}: ${Object.keys(patch).join(', ')}`);
    }
  }
}

// Inventario de solo lectura del Odoo conectado -- para revisar un servidor
// nuevo antes de tocar nada.
async function inspect() {
  const [co] = await odoo.callKw('res.company', 'search_read', [[]], { fields: ['name', 'currency_id', 'country_id', 'account_sale_tax_id'] });
  step('Compañía');
  log(`  ${co.name} · país ${co.country_id ? co.country_id[1] : '—'} · moneda ${co.currency_id ? co.currency_id[1] : '—'}`);
  log(`  IVA de venta por defecto: ${co.account_sale_tax_id ? co.account_sale_tax_id[1] : '—'}`);

  step('Módulos (crm / sale / account / l10n_co)');
  const mods = await odoo.callKw('ir.module.module', 'search_read',
    [[['name', 'in', ['crm', 'sale', 'sale_management', 'account', 'l10n_co', 'l10n_co_edi']]]], { fields: ['name', 'state'] });
  log('  ' + mods.map((m) => `${m.name}=${m.state}`).join(', '));

  step('Etapas del CRM (crm.stage)  <- clave para el sync');
  const stages = await odoo.callKw('crm.stage', 'search_read', [[]], { fields: ['name', 'sequence', 'is_won'], order: 'sequence' });
  stages.forEach((s) => log(`  seq ${String(s.sequence).padStart(3)}  ${s.name}${s.is_won ? '   (GANADO/is_won)' : ''}`));

  step('Equipos de ventas (crm.team)');
  const teams = await odoo.callKw('crm.team', 'search_read', [[]], { fields: ['name', 'user_id'] });
  teams.forEach((t) => log(`  ${t.name}${t.user_id ? `  (líder: ${t.user_id[1]})` : ''}`));

  step('Usuarios internos (posibles asesores)');
  const users = await odoo.callKw('res.users', 'search_read', [[['share', '=', false]]], { fields: ['name', 'login'] });
  users.forEach((u) => log(`  ${u.name}  <${u.login}>`));

  step('Impuestos de venta');
  const taxes = await odoo.callKw('account.tax', 'search_read', [[['type_tax_use', '=', 'sale']]], { fields: ['name', 'amount'], context: { active_test: false } });
  taxes.forEach((t) => log(`  ${t.name}  (${t.amount}%)`));

  step('Productos vendibles');
  const pc = await odoo.callKw('product.product', 'search_count', [[['sale_ok', '=', true]]]);
  log(`  ${pc} producto(s) con "puede venderse"`);

  step('Tarifas / listas de precios (product.pricelist)');
  const pls = await odoo.callKw('product.pricelist', 'search_read', [[]], { fields: ['name', 'currency_id'], context: { active_test: false } });
  pls.forEach((p) => log(`  ${p.name}  (${p.currency_id ? p.currency_id[1] : '—'})`));

  log('\n--- Fin de la inspección. No se cambió nada. ---');
  log('Pásale esta salida a Claude para ajustar la sincronización.');
}

async function main() {
  if (!odoo.isEnabled()) {
    console.error('Odoo no está configurado (revisa server/.env: ODOO_URL, ODOO_DB, ODOO_USER, ODOO_PASSWORD/ODOO_API_KEY).');
    process.exit(1);
  }
  const info = await odoo.ping();
  log(`Conectado a ${info.url} · base ${info.db} · ${info.company} · usuario ${info.user}`);

  if (CHECK_ONLY) {
    log('\n*** MODO INSPECCIÓN (--check): NO se escribe nada ***');
    await inspect();
    return;
  }

  log(DRY_RUN ? '\n*** MODO SIMULACIÓN (--dry-run): no se escribe nada en Odoo ***' : '\n*** Aplicando cambios en Odoo ***');
  await ensureCurrencyCOP();
  await ensureSaleTax19();
  await ensureSalesTeams();

  step('Resumen');
  const [co] = await odoo.callKw('res.company', 'search_read', [[]], { fields: ['name', 'currency_id', 'account_sale_tax_id'] });
  const teams = await odoo.callKw('crm.team', 'search_read', [[]], { fields: ['name'], order: 'name' });
  log(`Compañía:  ${co.name}`);
  log(`Moneda:    ${co.currency_id ? co.currency_id[1] : '—'}`);
  log(`IVA venta: ${co.account_sale_tax_id ? co.account_sale_tax_id[1] : '—'}`);
  log(`Equipos:   ${teams.map((t) => t.name).join(', ')}`);
  log('\nListo. Genera una cotización de prueba desde Nova CRM y revisa que el PDF salga en COP con IVA 19%.');
}

main().catch((err) => {
  console.error('\nFALLÓ:', err.message, err.odoo || '');
  process.exit(1);
});
