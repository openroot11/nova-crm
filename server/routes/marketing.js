const express = require('express');
const { db } = require('../db');
const { broadcast } = require('../realtime');

const router = express.Router();

function isValidMonth(month) {
  return typeof month === 'string' && /^\d{4}-\d{2}$/.test(month);
}

// GET /api/marketing/ad-spend?from=YYYY-MM&to=YYYY-MM
router.get('/ad-spend', async (req, res) => {
  const { from, to } = req.query;
  let rows;
  if (from && to) {
    rows = await db.prepare('SELECT * FROM ad_spend WHERE month >= ? AND month <= ? ORDER BY month ASC').all(from, to);
  } else {
    rows = await db.prepare('SELECT * FROM ad_spend ORDER BY month DESC LIMIT 24').all();
  }
  res.json(rows);
});

// PUT /api/marketing/ad-spend/:month  { amount }
router.put('/ad-spend/:month', async (req, res) => {
  const { month } = req.params;
  if (!isValidMonth(month)) return res.status(400).json({ error: 'Mes inválido (usa YYYY-MM)' });
  const amount = Number((req.body || {}).amount);
  if (!Number.isFinite(amount) || amount < 0) return res.status(400).json({ error: 'El monto debe ser un número mayor o igual a 0' });

  await db
    .prepare(
      `INSERT INTO ad_spend (month, amount, updated_at) VALUES (?, ?, now_utc_text())
       ON CONFLICT(month) DO UPDATE SET amount = excluded.amount, updated_at = now_utc_text()`
    )
    .run(month, amount);

  broadcast('ad_spend_changed', { month });
  res.json({ ok: true, month, amount });
});

module.exports = router;
