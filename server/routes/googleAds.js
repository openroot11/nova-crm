const express = require('express');
const { db, getSetting } = require('../db');
const googleAds = require('../googleAds');
const googleAdsSync = require('../googleAdsSync');
const { requireRole } = require('../middleware/auth');

const router = express.Router();

// Estado de la conexión -- lo usa Ajustes para mostrar/ocultar el desglose
// por campaña y avisar si no está configurado.
router.get('/status', async (req, res) => {
  if (!googleAds.isEnabled()) {
    return res.json({ enabled: false, reason: 'no_configurado' });
  }
  const last_sync_at = await getSetting('google_ads_last_sync_at', null);
  const last_sync_error = await getSetting('google_ads_last_sync_error', '');
  try {
    const info = await googleAds.ping();
    res.json({ ...info, ok: true, last_sync_at, last_sync_error: last_sync_error || null });
  } catch (err) {
    res.json({ enabled: true, ok: false, error: err.message, last_sync_at, last_sync_error: last_sync_error || null });
  }
});

// Forzar una sincronización ahora mismo (además de la automática).
router.post('/sync', requireRole('admin', 'coordinador'), async (req, res) => {
  if (!googleAds.isEnabled()) return res.status(409).json({ error: 'Google Ads no configurado' });
  const result = await googleAdsSync.syncOnce();
  res.json(result);
});

// GET /api/google-ads/campaigns?from=YYYY-MM-DD&to=YYYY-MM-DD
// Desglose por campaña (costo, clics, conversiones) para el rango -- lo usa
// la sección "Rentabilidad de Leads" de Estadísticas.
router.get('/campaigns', async (req, res) => {
  const { from, to } = req.query;
  if (!from || !to) return res.status(400).json({ error: 'from y to son obligatorios (YYYY-MM-DD)' });
  const rows = await db
    .prepare(
      `SELECT campaign_id, campaign_name,
              SUM(cost) AS cost, SUM(clicks) AS clicks, SUM(impressions) AS impressions,
              SUM(conversions) AS conversions, SUM(conversions_value) AS conversions_value
         FROM google_ads_campaign_stats
        WHERE date >= ? AND date <= ?
        GROUP BY campaign_id
        ORDER BY cost DESC`
    )
    .all(from, to);
  res.json(rows);
});

module.exports = router;
