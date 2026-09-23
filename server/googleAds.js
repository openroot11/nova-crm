// Cliente de la API de Google Ads para Nova CRM.
//
// Habla con la API REST de Google Ads (googleads.googleapis.com) usando
// fetch nativo (Node 22+), sin dependencias nuevas -- mismo enfoque que
// server/odoo.js.
//
// Configuracion en server/.env :
//   GOOGLE_ADS_CLIENT_ID=...
//   GOOGLE_ADS_CLIENT_SECRET=...
//   GOOGLE_ADS_REFRESH_TOKEN=...
//   GOOGLE_ADS_DEVELOPER_TOKEN=...
//   GOOGLE_ADS_CUSTOMER_ID=1234567890        (solo dígitos, sin guiones)
//   GOOGLE_ADS_LOGIN_CUSTOMER_ID=...         (opcional, si se entra vía una
//                                              cuenta administradora/MCC)
//   GOOGLE_ADS_CONVERSION_ACTION_ID=...      (opcional, solo para reportar
//                                              ventas cerradas como conversión)
//
// Ver docs/GOOGLE_ADS_SETUP.md para los pasos de cómo conseguir cada uno de
// estos valores (cuenta de Google Ads, proyecto de Google Cloud, Developer
// Token, refresh token).
//
// Si falta cualquiera de los primeros 5, la integracion queda DESACTIVADA y
// el CRM sigue funcionando igual que antes (isEnabled()===false): la
// inversión de Ajustes -> Estadísticas se sigue registrando a mano.

const API_VERSION = process.env.GOOGLE_ADS_API_VERSION || 'v17';
const CLIENT_ID = process.env.GOOGLE_ADS_CLIENT_ID || '';
const CLIENT_SECRET = process.env.GOOGLE_ADS_CLIENT_SECRET || '';
const REFRESH_TOKEN = process.env.GOOGLE_ADS_REFRESH_TOKEN || '';
const DEVELOPER_TOKEN = process.env.GOOGLE_ADS_DEVELOPER_TOKEN || '';
const CUSTOMER_ID = onlyDigits(process.env.GOOGLE_ADS_CUSTOMER_ID || '');
const LOGIN_CUSTOMER_ID = onlyDigits(process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || '');
const CONVERSION_ACTION_ID = process.env.GOOGLE_ADS_CONVERSION_ACTION_ID || '';

function onlyDigits(s) {
  return String(s || '').replace(/\D/g, '');
}

function isEnabled() {
  return Boolean(CLIENT_ID && CLIENT_SECRET && REFRESH_TOKEN && DEVELOPER_TOKEN && CUSTOMER_ID);
}

function canReportConversions() {
  return isEnabled() && Boolean(CONVERSION_ACTION_ID);
}

// Token de acceso en memoria (se refresca solo cuando falta o va a
// expirar). Una sola cuenta, herramienta de LAN chica -- igual que la
// sesión de Odoo.
let tokenCache = { accessToken: null, expiresAt: 0 };

async function getAccessToken() {
  if (tokenCache.accessToken && Date.now() < tokenCache.expiresAt - 60000) {
    return tokenCache.accessToken;
  }
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new Error(data.error_description || data.error || `Google no autorizó el token (HTTP ${res.status})`);
  }
  tokenCache = {
    accessToken: data.access_token,
    expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
  };
  return tokenCache.accessToken;
}

async function headers() {
  const token = await getAccessToken();
  const h = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
    'developer-token': DEVELOPER_TOKEN,
  };
  if (LOGIN_CUSTOMER_ID) h['login-customer-id'] = LOGIN_CUSTOMER_ID;
  return h;
}

function apiError(status, body) {
  const detail = body && body.error;
  const msg = (detail && (detail.message || (detail.details && detail.details[0] && detail.details[0].errors && detail.details[0].errors[0] && detail.details[0].errors[0].message))) || `HTTP ${status}`;
  return new Error(`Google Ads: ${msg}`);
}

// Ejecuta una consulta GAQL y devuelve TODAS las filas (sigue nextPageToken).
async function search(query) {
  if (!isEnabled()) throw new Error('La integración con Google Ads no está configurada (server/.env)');
  const rows = [];
  let pageToken = null;
  do {
    const res = await fetch(`https://googleads.googleapis.com/${API_VERSION}/customers/${CUSTOMER_ID}/googleAds:search`, {
      method: 'POST',
      headers: await headers(),
      body: JSON.stringify({ query, pageToken: pageToken || undefined }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw apiError(res.status, data);
    if (Array.isArray(data.results)) rows.push(...data.results);
    pageToken = data.nextPageToken || null;
  } while (pageToken);
  return rows;
}

// ---------------------------------------------------------------------------
//  Salud / diagnostico
// ---------------------------------------------------------------------------
async function ping() {
  if (!isEnabled()) return { enabled: false };
  const rows = await search('SELECT customer.descriptive_name, customer.currency_code, customer.time_zone FROM customer LIMIT 1');
  const c = rows[0] && rows[0].customer;
  return {
    enabled: true,
    customer_id: CUSTOMER_ID,
    name: c && c.descriptiveName,
    currency: c && c.currencyCode,
    time_zone: c && c.timeZone,
    can_report_conversions: canReportConversions(),
  };
}

// ---------------------------------------------------------------------------
//  Costo/clics/conversiones por campaña y día
// ---------------------------------------------------------------------------

// Formatea Date/`YYYY-MM-DD` -> 'YYYY-MM-DD' (GAQL no acepta hora).
function toGaqlDate(d) {
  return String(d).slice(0, 10);
}

async function fetchCampaignStats(fromDate, toDate) {
  const query = `
    SELECT
      segments.date,
      campaign.id,
      campaign.name,
      metrics.cost_micros,
      metrics.clicks,
      metrics.impressions,
      metrics.conversions,
      metrics.conversions_value
    FROM campaign
    WHERE segments.date BETWEEN '${toGaqlDate(fromDate)}' AND '${toGaqlDate(toDate)}'
    ORDER BY segments.date ASC
  `;
  const rows = await search(query);
  return rows.map((r) => ({
    date: r.segments.date,
    campaign_id: String(r.campaign.id),
    campaign_name: r.campaign.name,
    cost: Number(r.metrics.costMicros || 0) / 1e6,
    clicks: Number(r.metrics.clicks || 0),
    impressions: Number(r.metrics.impressions || 0),
    conversions: Number(r.metrics.conversions || 0),
    conversions_value: Number(r.metrics.conversionsValue || 0),
  }));
}

// ---------------------------------------------------------------------------
//  Conversión offline (venta cerrada en el CRM -> Google Ads)
// ---------------------------------------------------------------------------
// Requiere que el lead haya llegado con un gclid (el parámetro que Google
// pone en la URL cuando alguien llega desde un anuncio) -- hoy nada en el
// CRM lo captura todavía; ver docs/GOOGLE_ADS_SETUP.md. Best-effort: quien
// llama a esto decide qué hacer si falla (ver routes/leads.js), no revierte
// el cierre de la venta en el CRM.
async function uploadClickConversion({ gclid, conversionDateTime, conversionValue, currencyCode }) {
  if (!isEnabled()) throw new Error('La integración con Google Ads no está configurada (server/.env)');
  if (!CONVERSION_ACTION_ID) throw new Error('Falta GOOGLE_ADS_CONVERSION_ACTION_ID en server/.env (la acción de conversión "Venta cerrada")');
  if (!gclid) throw new Error('El lead no tiene gclid (no se puede reportar sin saber de qué clic vino)');

  const body = {
    conversions: [
      {
        gclid,
        conversionAction: `customers/${CUSTOMER_ID}/conversionActions/${CONVERSION_ACTION_ID}`,
        conversionDateTime,
        conversionValue: Number(conversionValue) || 0,
        currencyCode: currencyCode || 'COP',
      },
    ],
    partialFailure: true,
  };

  const res = await fetch(`https://googleads.googleapis.com/${API_VERSION}/customers/${CUSTOMER_ID}:uploadClickConversions`, {
    method: 'POST',
    headers: await headers(),
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw apiError(res.status, data);
  if (data.partialFailureError) throw new Error(`Google Ads: ${data.partialFailureError.message}`);
  return data;
}

module.exports = {
  isEnabled,
  canReportConversions,
  ping,
  search,
  fetchCampaignStats,
  uploadClickConversion,
};
