// Configuracion inicial de Odoo para Nova CRM (se corre UNA vez, a mano):
//
//   cd server
//   node scripts/odoo-setup.js            # aplica los cambios
//   node scripts/odoo-setup.js --dry-run  # solo muestra que cambiaria
//
// Deja el Odoo local listo para emitir cotizaciones correctas desde Nova CRM:
//   - Moneda de la compania -> COP (para que el PDF salga en pesos).
//   - Impuesto de venta -> IVA 19% (Colombia), aplicado a los productos.
//   - Equipo de ventas "Ventas Nova" con los 3 asesores como miembros.
//
// Es idempotente: si algo ya esta como debe, lo deja igual y lo reporta.
// NO importa la lista de precios ni toca la contabilidad (no hay facturas).

require('dotenv').config();
const odoo = require('../odoo');

const DRY_RUN = process.argv.includes('--dry-run');
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

async function ensureSalesTeam() {
  step(`Equipo de ventas "${SALES_TEAM_NAME}"`);
  const [team] = await odoo.callKw(
    'crm.team', 'search_read',
    [[['name', '=', SALES_TEAM_NAME]]],
    { fields: ['id', 'name', 'member_ids'] }
  );
  if (!team) {
    log(`! No existe el equipo "${SALES_TEAM_NAME}". Créalo en CRM > Configuración > Equipos de ventas.`);
    return;
  }
  const users = await odoo.callKw(
    'res.users', 'search_read',
    [['|', ['name', 'in', ADVISOR_LOGINS_OR_NAMES], ['login', 'in', ADVISOR_LOGINS_OR_NAMES.map((s) => s.toLowerCase())]]],
    { fields: ['id', 'name'] }
  );
  const want = new Set(users.map((u) => u.id));
  const have = new Set(team.member_ids || []);
  const toAdd = [...want].filter((id) => !have.has(id));
  if (!toAdd.length) {
    log(`- El equipo ya tiene a los asesores: ${users.map((u) => u.name).join(', ')}`);
    return;
  }
  const addNames = users.filter((u) => toAdd.includes(u.id)).map((u) => u.name).join(', ');
  log(`- Faltan en el equipo: ${addNames}`);
  if (!DRY_RUN) {
    await odoo.callKw('crm.team', 'write', [[team.id], { member_ids: toAdd.map((id) => [4, id]) }]);
  }
  log(`  ${wouldOrDid()}: agregados al equipo "${SALES_TEAM_NAME}"`);
}

async function main() {
  if (!odoo.isEnabled()) {
    console.error('Odoo no está configurado (revisa server/.env: ODOO_URL, ODOO_DB, ODOO_USER, ODOO_PASSWORD).');
    process.exit(1);
  }
  log(DRY_RUN ? '*** MODO SIMULACIÓN (--dry-run): no se escribe nada en Odoo ***' : '*** Aplicando cambios en Odoo ***');
  const info = await odoo.ping();
  log(`Conectado a ${info.url} · base ${info.db} · ${info.company} · usuario ${info.user}`);

  await ensureCurrencyCOP();
  await ensureSaleTax19();
  await ensureSalesTeam();

  step('Resumen');
  const [co] = await odoo.callKw('res.company', 'search_read', [[]], { fields: ['name', 'currency_id', 'account_sale_tax_id'] });
  log(`Compañía:  ${co.name}`);
  log(`Moneda:    ${co.currency_id ? co.currency_id[1] : '—'}`);
  log(`IVA venta: ${co.account_sale_tax_id ? co.account_sale_tax_id[1] : '—'}`);
  log('\nListo. Genera una cotización de prueba desde Nova CRM y revisa que el PDF salga en COP con IVA 19%.');
}

main().catch((err) => {
  console.error('\nFALLÓ:', err.message, err.odoo || '');
  process.exit(1);
});
