const express = require('express');
const { db } = require('../db');
const { broadcast } = require('../realtime');

const router = express.Router();

const PUBLIC_KEYS = ['auto_backup_weekly', 'last_backup_at'];

router.get('/', (req, res) => {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const out = {};
  for (const row of rows) {
    if (PUBLIC_KEYS.includes(row.key)) out[row.key] = row.value;
  }
  res.json(out);
});

router.put('/', (req, res) => {
  const body = req.body || {};
  const upsert = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  );
  const tx = db.transaction(() => {
    for (const key of PUBLIC_KEYS) {
      if (key === 'last_backup_at') continue; // solo lectura, lo gestiona el backend
      if (Object.prototype.hasOwnProperty.call(body, key)) {
        upsert.run(key, String(body[key]));
      }
    }
  });
  tx();
  broadcast('settings_changed', {});
  res.json({ ok: true });
});

module.exports = router;
