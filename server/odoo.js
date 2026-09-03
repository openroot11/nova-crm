// Cliente de Odoo para Nova CRM.
//
// Habla con Odoo por su API web (/web/session/authenticate + /web/dataset/
// call_kw) usando fetch nativo (Node 22+). SIN dependencias nuevas.
//
// Configuracion en server/.env :
//   ODOO_URL=http://localhost:8069          (o https://tuempresa.odoo.com)
//   ODOO_DB=nova
//   ODOO_USER=usuario@correo.com
//   ODOO_PASSWORD=...                        (o ODOO_API_KEY=...)
//
// Si falta ODOO_URL/ODOO_DB/ODOO_USER/secreto, la integracion queda
// DESACTIVADA y el CRM sigue funcionando igual que antes (isEnabled()===false).

const BASE = (process.env.ODOO_URL || '').replace(/\/+$/, '');
const DB = process.env.ODOO_DB || '';
const USER = process.env.ODOO_USER || '';
const SECRET = process.env.ODOO_PASSWORD || process.env.ODOO_API_KEY || '';

function isEnabled() {
  return Boolean(BASE && DB && USER && SECRET);
}

// Estado de sesion en memoria (una sola conexion, herramienta de LAN chica).
let session = { cookie: null, uid: null };

function onlyDigits(s) {
  return String(s || '').replace(/\D/g, '');
}

async function jsonRpc(path, params) {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(session.cookie ? { Cookie: session.cookie } : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'call', params, id: Date.now() }),
  });

  const setCookie = res.headers.get('set-cookie');
  if (setCookie) {
    const m = /session_id=[^;]+/.exec(setCookie);
    if (m) session.cookie = m[0];
  }

  let data;
  try {
    data = await res.json();
  } catch {
    throw new Error(`Odoo respondio algo que no es JSON (HTTP ${res.status}). ¿La URL de ODOO_URL es correcta?`);
  }

  if (data.error) {
    const e = data.error;
    const detail = e.data || {};
    const msg = detail.message || e.message || 'Error de Odoo';
    const err = new Error(msg.trim());
    err.odoo = detail;
    err.odooName = detail.name || '';
    throw err;
  }
  return data.result;
}

async function authenticate() {
  session = { cookie: null, uid: null };
  const result = await jsonRpc('/web/session/authenticate', {
    db: DB,
    login: USER,
    password: SECRET,
  });
  if (!result || !result.uid) {
    throw new Error('Odoo rechazo las credenciales (revisa ODOO_DB / ODOO_USER / ODOO_PASSWORD en server/.env)');
  }
  session.uid = result.uid;
  return result.uid;
}

/**
 * Llama a un metodo del ORM de Odoo. Reautentica una vez si la sesion caduco.
 *   callKw('res.partner', 'search_read', [[['is_company','=',true]]], { fields:['name'], limit:5 })
 */
async function callKw(model, method, args = [], kwargs = {}) {
  if (!isEnabled()) throw new Error('La integracion con Odoo no esta configurada (server/.env)');
  if (!session.uid) await authenticate();

  const params = { model, method, args, kwargs };
  try {
    return await jsonRpc('/web/dataset/call_kw', params);
  } catch (err) {
    if (/session expired|session_expired|not authenticated|SessionExpired/i.test(err.message + (err.odooName || ''))) {
      await authenticate();
      return await jsonRpc('/web/dataset/call_kw', params);
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
//  Salud / diagnostico
// ---------------------------------------------------------------------------
async function ping() {
  if (!isEnabled()) return { enabled: false };
  const uid = await authenticate();
  const [user] = await callKw('res.users', 'read', [[uid], ['name', 'login']]);
  const [company] = await callKw('res.company', 'search_read', [[]], { fields: ['name'], limit: 1 });
  return {
    enabled: true,
    url: BASE,
    db: DB,
    uid,
    user: user && user.name,
    login: user && user.login,
    company: company && company.name,
  };
}

// ---------------------------------------------------------------------------
//  Contactos: dedup por correo / NIT / telefono, o crear
// ---------------------------------------------------------------------------
async function findOrCreatePartner({ name, phone, email, vat, city, street }) {
  const candidates = [];
  if (email) candidates.push([['email', '=ilike', String(email).trim()]]);
  if (vat) candidates.push([['vat', '=', String(vat).trim()]]);
  const ph = onlyDigits(phone);
  if (ph.length >= 7) {
    // Odoo 19 unifico phone/mobile en 'phone'. Se compara por los ultimos
    // 7 digitos porque Odoo suele guardarlo con prefijo/formato.
    candidates.push([['phone', 'ilike', ph.slice(-7)]]);
  }

  for (const domain of candidates) {
    const ids = await callKw('res.partner', 'search', [domain], { limit: 1 });
    if (ids.length) {
      const [p] = await callKw('res.partner', 'read', [[ids[0]], ['name', 'email', 'phone', 'vat']]);
      return { id: ids[0], created: false, partner: p };
    }
  }

  const vals = { name: (name || 'Sin nombre').trim(), company_type: 'person' };
  if (phone) vals.phone = String(phone).trim();
  if (email) vals.email = String(email).trim();
  if (vat) vals.vat = String(vat).trim();
  if (city) vals.city = String(city).trim();
  if (street) vals.street = String(street).trim();
  const id = await callKw('res.partner', 'create', [vals]);
  return { id, created: true, partner: { id, ...vals } };
}

// ---------------------------------------------------------------------------
//  Asesores: emparejar un asesor del CRM con un usuario de Odoo (por nombre
//  o login). Se cachea para no consultar Odoo en cada lead.
// ---------------------------------------------------------------------------
const _userCache = new Map();

async function resolveSalesperson(advisorName) {
  const key = String(advisorName || '').trim().toLowerCase();
  if (!key) return null;
  if (_userCache.has(key)) return _userCache.get(key);

  const firstWord = key.split(/\s+/)[0];
  const ids = await callKw(
    'res.users',
    'search',
    [['|', ['name', '=ilike', advisorName.trim()], ['login', '=ilike', firstWord]]],
    { limit: 1 }
  );
  const uid = ids.length ? ids[0] : null;
  _userCache.set(key, uid);
  return uid;
}

// ---------------------------------------------------------------------------
//  Leads / oportunidades
// ---------------------------------------------------------------------------
async function createLead({ name, partner_id, contact_name, phone, email, description, city, user_id, team_id }) {
  const vals = {
    name: (name || `Oportunidad ${contact_name || ''}`).trim(),
    type: 'opportunity',
  };
  if (partner_id) vals.partner_id = partner_id;
  if (contact_name) vals.contact_name = contact_name;
  if (phone) vals.phone = String(phone).trim();
  if (email) vals.email_from = String(email).trim();
  if (description) vals.description = description;
  if (city) vals.city = city;
  if (user_id) vals.user_id = user_id;
  if (team_id) vals.team_id = team_id;
  return callKw('crm.lead', 'create', [vals]);
}

// ---------------------------------------------------------------------------
//  Productos (para armar la cotizacion en el frontend)
// ---------------------------------------------------------------------------
async function listProducts(query) {
  const domain = [['sale_ok', '=', true]];
  if (query && query.trim()) domain.push(['name', 'ilike', query.trim()]);
  return callKw('product.product', 'search_read', [domain], {
    fields: ['id', 'display_name', 'list_price', 'uom_id', 'default_code'],
    limit: 100,
    order: 'name',
  });
}

// ---------------------------------------------------------------------------
//  Cotizacion (sale.order)
// ---------------------------------------------------------------------------

// Convierte las lineas que manda el frontend ({ product_id | product_name,
// qty, price_unit?, name? }) a comandos ORM [0, 0, {...}] para order_line.
// Se usa al crear la cotizacion y al reescribir sus lineas (editar borrador).
async function buildOrderLineCommands(lines) {
  const orderLine = [];
  for (const ln of lines) {
    let productId = ln.product_id;
    if (!productId && ln.product_name) {
      const found = await callKw('product.product', 'search', [[['name', '=ilike', ln.product_name]]], { limit: 1 });
      if (found.length) productId = found[0];
    }
    if (!productId) throw new Error(`Producto no encontrado: ${ln.product_name || ln.product_id}`);
    const cmd = { product_id: productId, product_uom_qty: Number(ln.qty) || 1 };
    if (ln.price_unit !== undefined && ln.price_unit !== null && ln.price_unit !== '') {
      cmd.price_unit = Number(ln.price_unit);
    }
    if (ln.name) cmd.name = ln.name;
    orderLine.push([0, 0, cmd]);
  }
  return orderLine;
}

async function createQuotation({ partner_id, opportunity_id, lines, validity_days, note }) {
  if (!partner_id) throw new Error('Falta el contacto (partner_id) para la cotizacion');
  if (!Array.isArray(lines) || lines.length === 0) throw new Error('La cotizacion necesita al menos una linea');

  const orderLine = await buildOrderLineCommands(lines);

  const vals = { partner_id, order_line: orderLine };
  if (opportunity_id) vals.opportunity_id = opportunity_id;
  if (note) vals.note = note;
  if (validity_days) {
    vals.validity_date = new Date(Date.now() + Number(validity_days) * 86400000)
      .toISOString()
      .slice(0, 10);
  }

  const id = await callKw('sale.order', 'create', [vals]);
  return readQuotation(id);
}

// Estados de sale.order -> etiqueta legible para el CRM.
const ORDER_STATE_LABELS = {
  draft: 'Borrador',
  sent: 'Enviada',
  sale: 'Pedido de venta',
  done: 'Bloqueada',
  cancel: 'Cancelada',
};

async function readQuotation(id) {
  const [order] = await callKw('sale.order', 'read', [
    [id],
    [
      'name', 'state', 'amount_untaxed', 'amount_tax', 'amount_total', 'validity_date',
      'currency_id', 'partner_id', 'invoice_status', 'date_order',
    ],
  ]);
  if (!order) throw new Error(`La cotizacion ${id} ya no existe en Odoo`);
  const lines = await callKw('sale.order.line', 'search_read', [[['order_id', '=', id], ['display_type', '=', false]]], {
    fields: ['name', 'product_id', 'product_uom_qty', 'price_unit', 'price_subtotal', 'price_tax', 'price_total'],
  });
  return {
    id,
    ...order,
    state_label: ORDER_STATE_LABELS[order.state] || order.state,
    is_confirmed: order.state === 'sale' || order.state === 'done',
    lines,
  };
}

// Alias semantico: una vez confirmada, la misma sale.order deja de ser
// "cotizacion" y pasa a ser "pedido de venta" -- el CRM la lee igual.
const readOrder = readQuotation;

// Confirma la cotizacion -> pasa a Pedido de venta (state 'sale'). Idempotente:
// si ya estaba confirmada, no es un error, solo devuelve el estado actual.
async function confirmOrder(id) {
  const current = await readQuotation(id);
  if (current.is_confirmed) return current;
  await callKw('sale.order', 'action_confirm', [[id]]);
  return readQuotation(id);
}

// Reescribe TODAS las lineas de una cotizacion en borrador (editar cotizacion
// desde el CRM). Falla si ya esta confirmada -- ahi ya no se tocan las lineas.
async function updateQuotationLines(id, lines) {
  if (!Array.isArray(lines) || lines.length === 0) throw new Error('La cotizacion necesita al menos una linea');
  const current = await readQuotation(id);
  if (current.is_confirmed) throw new Error('La cotizacion ya está confirmada como pedido de venta; no se pueden cambiar sus líneas');
  const orderLine = [[5, 0, 0], ...(await buildOrderLineCommands(lines))];
  await callKw('sale.order', 'write', [[id], { order_line: orderLine }]);
  return readQuotation(id);
}

// ---------------------------------------------------------------------------
//  Etapas del pipeline (crm.stage) -- mantener Odoo al dia con el embudo Nova
// ---------------------------------------------------------------------------
const _stageCache = new Map(); // nombre(lower) -> id

async function _stageIdByName(name) {
  const key = String(name || '').trim().toLowerCase();
  if (!key) return null;
  if (_stageCache.has(key)) return _stageCache.get(key);
  const ids = await callKw('crm.stage', 'search', [[['name', '=ilike', name.trim()]]], { limit: 1 });
  const id = ids.length ? ids[0] : null;
  _stageCache.set(key, id);
  return id;
}

// Mueve la oportunidad a una etapa por nombre ('Asignado' | 'Contactado' |
// 'Cotizado' | 'Ganado'). Best-effort: si la etapa no existe o el id es
// invalido, no lanza -- el CRM sigue siendo la fuente de verdad del embudo.
async function moveOpportunityStage(opportunityId, stageName) {
  if (!opportunityId) return { moved: false };
  const stageId = await _stageIdByName(stageName);
  if (!stageId) return { moved: false, reason: `etapa "${stageName}" no encontrada` };
  await callKw('crm.lead', 'write', [[opportunityId], { stage_id: stageId }]);
  return { moved: true, stage_id: stageId };
}

async function markQuotationSent(id) {
  try {
    await callKw('sale.order', 'action_quotation_sent', [[id]]);
  } catch {
    // si ya estaba enviada / confirmada, no es un error para nosotros
  }
  return readQuotation(id);
}

/**
 * PDF de la cotizacion (Buffer). Usa la ruta HTTP de informes de Odoo, que
 * necesita la cookie de sesion.
 */
async function quotationPdf(id) {
  if (!isEnabled()) throw new Error('Odoo no configurado');
  if (!session.uid) await authenticate();
  const url = `${BASE}/report/pdf/sale.report_saleorder/${id}`;
  let res = await fetch(url, { headers: { Cookie: session.cookie } });
  if (res.status === 401 || res.status === 403) {
    await authenticate();
    res = await fetch(url, { headers: { Cookie: session.cookie } });
  }
  if (!res.ok) throw new Error(`Odoo no pudo generar el PDF (HTTP ${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}

module.exports = {
  isEnabled,
  ping,
  callKw,
  resolveSalesperson,
  findOrCreatePartner,
  createLead,
  listProducts,
  createQuotation,
  readQuotation,
  readOrder,
  confirmOrder,
  updateQuotationLines,
  moveOpportunityStage,
  markQuotationSent,
  quotationPdf,
  ORDER_STATE_LABELS,
};
