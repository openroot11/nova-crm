// Sincronización Google Ads -> Nova CRM del gasto e inversión publicitaria.
//
// Reemplaza la captura manual mensual (Ajustes -> Estadísticas ->
// "Inversión Google Ads"): cada N horas trae de la API el costo/clics/
// conversiones por campaña y día de los últimos ~35 días (suficiente para
// cubrir revisiones tardías de Google y el mes en curso), los guarda en
// google_ads_campaign_stats, y con eso recalcula el total de cada mes en
// ad_spend.
//
// Reglas:
//   - Un mes marcado ad_spend.source='manual' (alguien lo tecleó en
//     Ajustes) NUNCA se pisa automáticamente -- gana siempre la corrección
//     a mano. Solo se auto-llenan los meses que la sync trajo ella misma la
//     vez anterior (source='google_ads_api') o que todavía no existían.
//   - google_ads_campaign_stats sí se sobreescribe fila por fila (mismo
//     día+campaña): así una revisión tardía de Google (el costo de ayer
//     puede ajustarse un poco durante 1-2 días) queda reflejada.
//
// Config en server/.env:
//   GOOGLE_ADS_SYNC_HOURS=6     intervalo (por defecto 6; 0 = desactivar)

const { db, getSetting, setSetting } = require('./db');
const googleAds = require('./googleAds');
const { broadcast } = require('./realtime');

const INTERVAL_HOURS = (() => {
  const raw = process.env.GOOGLE_ADS_SYNC_HOURS;
  if (raw === undefined || raw === '') return 6;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 6;
})();

const LOOKBACK_DAYS = 35;

let running = false;
let timer = null;

function nowUtc() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function toDateOnly(d) {
  return d.toISOString().slice(0, 10);
}

async function upsertCampaignStats(rows) {
  const stmt = db.prepare(`
    INSERT INTO google_ads_campaign_stats
      (date, campaign_id, campaign_name, cost, clicks, impressions, conversions, conversions_value, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(date, campaign_id) DO UPDATE SET
      campaign_name = excluded.campaign_name,
      cost = excluded.cost,
      clicks = excluded.clicks,
      impressions = excluded.impressions,
      conversions = excluded.conversions,
      conversions_value = excluded.conversions_value,
      updated_at = excluded.updated_at
  `);
  for (const r of rows) {
    await stmt.run(r.date, r.campaign_id, r.campaign_name, r.cost, r.clicks, r.impressions, r.conversions, r.conversions_value);
  }
}

// Suma el costo de google_ads_campaign_stats por mes (YYYY-MM) y lo pasa a
// ad_spend, salvo en un mes que alguien haya corregido a mano.
async function refreshMonthlyAdSpend(fromDate, toDate) {
  const fromMonth = toDateOnly(fromDate).slice(0, 7);
  const toMonth = toDateOnly(toDate).slice(0, 7);
  const months = await db
    .prepare(
      `SELECT substr(date, 1, 7) AS month, SUM(cost) AS total
         FROM google_ads_campaign_stats
        WHERE substr(date, 1, 7) >= ? AND substr(date, 1, 7) <= ?
        GROUP BY month`
    )
    .all(fromMonth, toMonth);

  let updated = 0;
  for (const m of months) {
    const current = await db.prepare('SELECT source FROM ad_spend WHERE month = ?').get(m.month);
    if (current && current.source === 'manual') continue; // gana la corrección a mano
    await db
      .prepare(
        `INSERT INTO ad_spend (month, amount, source, updated_at) VALUES (?, ?, 'google_ads_api', datetime('now'))
         ON CONFLICT(month) DO UPDATE SET amount = excluded.amount, source = 'google_ads_api', updated_at = excluded.updated_at`
      )
      .run(m.month, Math.round(m.total * 100) / 100);
    updated++;
  }
  return updated;
}

async function syncOnce() {
  if (!googleAds.isEnabled()) return { skipped: 'google_ads_off' };
  if (running) return { skipped: 'busy' };
  running = true;
  try {
    const to = new Date();
    const from = new Date(to.getTime() - LOOKBACK_DAYS * 86400000);
    const rows = await googleAds.fetchCampaignStats(from, to);
    await upsertCampaignStats(rows);
    const monthsUpdated = await refreshMonthlyAdSpend(from, to);

    await setSetting('google_ads_last_sync_at', nowUtc());
    await setSetting('google_ads_last_sync_error', '');
    if (monthsUpdated) broadcast('ad_spend_changed', { reason: 'google_ads_sync' });
    console.log(`[google-ads-sync] ${rows.length} fila(s) de campaña, ${monthsUpdated} mes(es) de ad_spend actualizados`);
    return { rows: rows.length, months_updated: monthsUpdated };
  } catch (err) {
    console.error('[google-ads-sync] error:', err.message);
    await setSetting('google_ads_last_sync_error', err.message);
    return { error: err.message };
  } finally {
    running = false;
  }
}

function start() {
  if (INTERVAL_HOURS === 0) {
    console.log('[google-ads-sync] desactivado (GOOGLE_ADS_SYNC_HOURS=0)');
    return;
  }
  if (!googleAds.isEnabled()) {
    console.log('[google-ads-sync] Google Ads no configurado -- la inversión sigue siendo manual (Ajustes -> Estadísticas)');
    return;
  }
  console.log(`[google-ads-sync] revisando Google Ads cada ${INTERVAL_HOURS}h (gasto por campaña -> ad_spend)`);
  setTimeout(() => {
    syncOnce();
    timer = setInterval(syncOnce, INTERVAL_HOURS * 3600 * 1000);
  }, 15000);
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { start, stop, syncOnce };
