// Facturación electrónica de Velara: el único punto que habla con el
// proveedor tecnológico (el que firma, envía a la DIAN y devuelve el CUFE).
//
// Hoy corre en modo SIMULADO: Velara todavía no tiene RUT ni habilitación
// ante la DIAN, así que "emitir" arma la factura, le calcula un CUFE con la
// misma fórmula que usa la DIAN (SHA-384 de los datos del documento) y la da
// por aceptada, y "descargar recibidas" genera facturas de proveedores de
// ejemplo, como las que llegarían al correo de facturación o se bajarían de
// la DIAN. Nada de esto tiene validez fiscal.
//
// Cuando se contrate un proveedor real (MATIAS API, Plemsi, Factus...) solo
// hay que escribir otro objeto con las mismas dos funciones -- emit() y
// fetchReceived() -- y elegirlo en PROVIDERS; las rutas y las pantallas no
// cambian.

const crypto = require('crypto');
const { db, getSetting, setSetting } = require('./db');
const { EXPENSE_CATEGORIES, todayBogota } = require('./erp');

const IVA_RATES = [0, 5, 19];

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

// Dígito de verificación de un NIT (algoritmo oficial de la DIAN).
function nitDv(nit) {
  const primes = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71];
  const digits = String(nit).replace(/\D/g, '').split('').reverse();
  const sum = digits.reduce((s, d, i) => s + Number(d) * primes[i], 0);
  const r = sum % 11;
  return r > 1 ? 11 - r : r;
}

function computeLines(lines) {
  return lines.map((l, i) => {
    const qty = Number(l.qty) || 0;
    const unit_price = Number(l.unit_price) || 0;
    const iva_rate = IVA_RATES.includes(Number(l.iva_rate)) ? Number(l.iva_rate) : 19;
    const subtotal = round2(qty * unit_price);
    return { description: String(l.description).trim(), qty, unit_price, iva_rate, subtotal, iva: round2((subtotal * iva_rate) / 100), position: i };
  });
}

function totalsOf(lines) {
  const subtotal = round2(lines.reduce((s, l) => s + l.subtotal, 0));
  const iva = round2(lines.reduce((s, l) => s + l.iva, 0));
  return { subtotal, iva, total: round2(subtotal + iva) };
}

// CUFE: SHA-384 de NumFac + FecFac + HorFac + ValFac + 01 + ValIVA + 04 + 0 +
// 03 + 0 + ValTot + NitOFE + NumAdq + ClTec + TipoAmbiente (Anexo Técnico
// de la DIAN). En simulación la clave técnica es inventada y el ambiente es
// "2" (pruebas).
function computeCufe({ number, date, time, subtotal, iva, total, issuerNit, buyerNit }) {
  const f = (n) => Number(n).toFixed(2);
  const raw = `${number}${date}${time}${f(subtotal)}01${f(iva)}040.00030.00${f(total)}${issuerNit}${buyerNit || '222222222222'}CLAVE-TECNICA-SIMULADA2`;
  return crypto.createHash('sha384').update(raw).digest('hex');
}

// ---- Datos de Velara como facturador -----------------------------------------
async function issuer() {
  return {
    name: await getSetting('einvoice_issuer_name', 'VELARA'),
    nit: await getSetting('einvoice_issuer_nit', '900000000'),
    prefix: await getSetting('einvoice_prefix', 'SETP'),
    // Rango de pruebas que da la DIAN en la habilitación (SETP990000000...).
    range_from: 990000001,
    range_to: 995000000,
  };
}

// ---- Clasificación de facturas recibidas -------------------------------------
const KEYWORDS = [
  ['Compra de materiales', ['lona', 'cuero', 'espuma', 'tela', 'vinilo', 'hilo', 'herraje', 'cremallera', 'pegante', 'material']],
  ['Arriendo', ['arriendo', 'inmobiliaria', 'canon']],
  ['Servicios públicos', ['energía', 'energia', 'acueducto', 'agua', 'aseo', 'gas natural', 'internet', 'telefon']],
  ['Transporte y domicilios', ['transporte', 'flete', 'envío', 'envio', 'domicilio', 'mensajer']],
  ['Herramientas y mantenimiento', ['ferreter', 'herramienta', 'mantenimiento', 'repuesto', 'máquina', 'maquina']],
  ['Publicidad', ['publicidad', 'pauta', 'volante', 'marketing']],
  ['Impuestos', ['impuesto', 'industria y comercio', 'predial']],
];

// Primero la regla aprendida para ese NIT (alguien ya clasificó a ese
// proveedor), después palabras clave en el nombre y las líneas. Si nada
// aplica queda sin clasificar para que una persona decida.
async function classify(invoice, lines) {
  if (invoice.party_nit) {
    const rule = await db.prepare('SELECT category FROM invoice_category_rules WHERE party_nit = ?').get(invoice.party_nit);
    if (rule && EXPENSE_CATEGORIES.includes(rule.category)) return { category: rule.category, category_source: 'regla' };
  }
  const text = [invoice.party_name, ...lines.map((l) => l.description)].join(' ').toLowerCase();
  for (const [category, words] of KEYWORDS) {
    if (words.some((w) => text.includes(w))) return { category, category_source: 'palabra_clave' };
  }
  return { category: null, category_source: null };
}

// ---- Proveedor simulado ------------------------------------------------------
// Proveedores de ejemplo (nombres y NIT inventados).
const SAMPLE_SUPPLIERS = [
  { key: 'lonas', name: 'Lonas y Telas del Caribe SAS', nit: '901234567', email: 'facturacion@lonascaribe.example', items: [['Lona impermeable 16 oz', 'm', 18000, 45000], ['Tela náutica', 'm', 32000, 55000], ['Vinilo marino', 'm', 28000, 40000]], iva: 19 },
  { key: 'espumas', name: 'Espumas Barranquilla SAS', nit: '900876543', email: 'fe@espumasbaq.example', items: [['Espuma alta densidad 2"', 'lámina', 85000, 140000], ['Espuma laminada 1/2"', 'lámina', 30000, 52000]], iva: 19 },
  { key: 'cueros', name: 'Cueros Sintéticos La 30 SAS', nit: '901555888', email: 'facturas@cueros30.example', items: [['Cuero sintético automotriz', 'm', 38000, 65000], ['Cuero sintético perforado', 'm', 42000, 70000]], iva: 19 },
  { key: 'hilos', name: 'Hilos y Herrajes del Norte SAS', nit: '900333222', email: 'fe@hilosnorte.example', items: [['Hilo nylon calibre 40', 'cono', 22000, 35000], ['Cremallera plástica #10', 'm', 3500, 6000], ['Pegante de contacto galón', 'und', 48000, 65000]], iva: 19 },
  { key: 'energia', name: 'Empresa de Energía de la Costa SA ESP', nit: '900111444', email: 'facturaelectronica@energiacosta.example', monthly: 'Servicio de energía eléctrica', range: [380000, 620000], iva: 0 },
  { key: 'agua', name: 'Acueducto Metropolitano SA ESP', nit: '800222999', email: 'fe@acueductometro.example', monthly: 'Servicio de acueducto, alcantarillado y aseo', range: [95000, 160000], iva: 0 },
  { key: 'internet', name: 'Conexión Digital SAS', nit: '901777000', email: 'facturacion@conexiondigital.example', monthly: 'Plan internet empresarial 300 Mbps', range: [119000, 119000], iva: 19 },
  { key: 'arriendo', name: 'Inmobiliaria El Prado SAS', nit: '890100200', email: 'fe@inmoprado.example', monthly: 'Canon de arriendo local comercial', range: [2200000, 2200000], iva: 19, day: 1 },
  { key: 'transporte', name: 'Transportes Rápidos del Norte SAS', nit: '900444111', email: 'fe@transnorte.example', items: [['Flete entrega de carpas', 'viaje', 90000, 180000], ['Envío de materiales', 'viaje', 45000, 80000]], iva: 0 },
  { key: 'ferreteria', name: 'Ferretería La Paz SAS', nit: '901010101', email: 'facturas@ferrelapaz.example', items: [['Juego de brocas', 'und', 35000, 60000], ['Mantenimiento máquina de coser', 'servicio', 120000, 180000], ['Tubo galvanizado 1"', 'und', 42000, 58000]], iva: 19 },
  { key: 'publicidad', name: 'Impresos y Publicidad Caribe SAS', nit: '900999777', email: 'fe@impresoscaribe.example', items: [['Impresión de volantes x1000', 'und', 180000, 180000], ['Pendón publicitario 1x2 m', 'und', 95000, 95000]], iva: 19 },
  { key: 'papeleria', name: 'Papelería Central Ltda', nit: '800765432', email: 'fe@papeleriacentral.example', items: [['Resma papel carta', 'und', 21000, 24000], ['Cartuchos de tinta', 'und', 65000, 85000]], iva: 19 },
];

// PRNG determinístico por mes: bajar dos veces el mismo mes produce las
// mismas facturas (mismo CUFE), así que la segunda descarga no duplica nada.
function seeded(seedText) {
  let h = 2166136261;
  for (const c of seedText) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

function sampleMonth(ym, supplierNitVelara) {
  const rnd = seeded(`velara-${ym}`);
  const between = (a, b) => Math.round((a + rnd() * (b - a)) / 100) * 100;
  const [y, m] = ym.split('-').map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  const day = (d) => `${ym}-${String(Math.min(d, lastDay)).padStart(2, '0')}`;
  const out = [];
  let seq = 0;
  const push = (sup, date, rawLines) => {
    const lines = computeLines(rawLines.map((l) => ({ ...l, iva_rate: sup.iva })));
    const t = totalsOf(lines);
    const number = `FE${sup.nit.slice(-3)}-${ym.replace('-', '')}${String(++seq).padStart(2, '0')}`;
    const cufe = computeCufe({ number, date, time: '10:00:00-05:00', ...t, issuerNit: sup.nit, buyerNit: supplierNitVelara });
    out.push({ number, cufe, issue_date: date, due_date: date, party_name: sup.name, party_nit: `${sup.nit}-${nitDv(sup.nit)}`, party_email: sup.email, lines, ...t });
  };
  for (const sup of SAMPLE_SUPPLIERS) {
    if (sup.monthly) {
      push(sup, day(sup.day || 3 + Math.floor(rnd() * 20)), [{ description: sup.monthly, qty: 1, unit_price: between(...sup.range) }]);
      continue;
    }
    const times = sup.key === 'lonas' || sup.key === 'cueros' ? 1 + Math.floor(rnd() * 3) : rnd() < 0.55 ? 1 : 0;
    for (let i = 0; i < times; i++) {
      const picks = sup.items.filter(() => rnd() < 0.7);
      const items = picks.length ? picks : [sup.items[0]];
      push(
        sup,
        day(1 + Math.floor(rnd() * 28)),
        items.map(([description, unit, lo, hi]) => ({
          description: `${description} (${unit})`,
          qty: unit === 'm' ? 3 + Math.floor(rnd() * 18) : 1 + Math.floor(rnd() * 4),
          unit_price: between(lo, hi),
        }))
      );
    }
  }
  return out;
}

const simulatedProvider = {
  key: 'simulado',
  label: 'Simulación (sin validez ante la DIAN)',
  async emit(doc) {
    // Aquí un proveedor real firmaría el XML UBL 2.1 y lo mandaría a la DIAN.
    const cufe = computeCufe({ number: doc.number, date: doc.issue_date, time: '12:00:00-05:00', ...doc.totals, issuerNit: doc.issuer.nit, buyerNit: doc.party_nit });
    return { status: 'aceptada', cufe, message: 'Documento validado (simulado)' };
  },
  async fetchReceived({ from, to }) {
    const today = todayBogota();
    const end = to < today ? to : today;
    const { nit } = await issuer();
    const months = [];
    for (let d = new Date(`${from.slice(0, 7)}-01T00:00:00`); d <= new Date(`${end}T00:00:00`); d.setMonth(d.getMonth() + 1)) {
      months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }
    return months.flatMap((ym) => sampleMonth(ym, nit)).filter((i) => i.issue_date >= from && i.issue_date <= end);
  },
};

const PROVIDERS = { simulado: simulatedProvider };

async function provider() {
  return PROVIDERS[await getSetting('einvoice_provider', 'simulado')] || simulatedProvider;
}

// Siguiente número: facturas con el prefijo y rango de la resolución;
// notas crédito con su propio consecutivo (NC1, NC2...). Corre dentro de la
// transacción de quien emite, así dos documentos nunca comparten número.
async function nextNumber(docType = 'factura') {
  if (docType === 'nota_credito') {
    const n = Number(await getSetting('einvoice_next_credit_note', 1));
    await setSetting('einvoice_next_credit_note', n + 1);
    return `NC${n}`;
  }
  const iss = await issuer();
  const current = Number(await getSetting('einvoice_next_number', iss.range_from));
  if (current > iss.range_to) throw Object.assign(new Error('Se agotó el rango de numeración autorizado'), { status: 409 });
  await setSetting('einvoice_next_number', current + 1);
  return `${iss.prefix}${current}`;
}

module.exports = { IVA_RATES, round2, nitDv, computeLines, totalsOf, classify, issuer, provider, nextNumber };
