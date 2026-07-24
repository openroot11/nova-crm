const express = require('express');
const { db, DEFAULT_ADVISORS } = require('../db');
const { broadcast } = require('../realtime');
const { writeBackupFile } = require('../backup');

const router = express.Router();

const CONFIRM_PHRASE = 'RESTAURAR';

router.post('/factory-reset', (req, res) => {
  const { confirm } = req.body || {};
  if (confirm !== CONFIRM_PHRASE) {
    return res.status(400).json({ error: `Escribe "${CONFIRM_PHRASE}" para confirmar` });
  }

  // Backup de seguridad automatico antes de borrar, por si acaso.
  writeBackupFile();

  const tx = db.transaction(() => {
    db.prepare('DELETE FROM reassignments').run();
    db.prepare('DELETE FROM leads').run();
    db.prepare('DELETE FROM informe_stats').run();
    db.prepare('DELETE FROM informe_ventas').run();
    db.prepare('DELETE FROM advisors').run();
    db.prepare("DELETE FROM sqlite_sequence WHERE name IN ('leads','reassignments','advisors','informe_ventas')").run();

    const insert = db.prepare(
      'INSERT INTO advisors (name, role, active, is_group, priority_order) VALUES (?, ?, 1, 0, ?)'
    );
    DEFAULT_ADVISORS.forEach((a, idx) => insert.run(a.name, a.role, idx + 1));
  });
  tx();

  broadcast('leads_changed', { reason: 'factory_reset' });
  broadcast('advisors_changed', { reason: 'factory_reset' });
  broadcast('informe_changed', { reason: 'factory_reset' });
  res.json({ ok: true });
});

module.exports = router;
