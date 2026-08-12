const express = require('express');
const { db, DEFAULT_ADVISORS } = require('../db');
const { broadcast } = require('../realtime');
const { writeBackupFile } = require('../backup');

const router = express.Router();

const CONFIRM_PHRASE = 'RESTAURAR';

router.post('/factory-reset', async (req, res) => {
  const { confirm } = req.body || {};
  if (confirm !== CONFIRM_PHRASE) {
    return res.status(400).json({ error: `Escribe "${CONFIRM_PHRASE}" para confirmar` });
  }

  // Backup de seguridad automatico antes de borrar, por si acaso.
  await writeBackupFile();

  const tx = db.transaction(async () => {
    await db.prepare('DELETE FROM reassignments').run();
    await db.prepare('DELETE FROM leads').run();
    await db.prepare('DELETE FROM informe_stats').run();
    await db.prepare('DELETE FROM informe_ventas').run();
    await db.prepare('DELETE FROM ad_spend').run();
    await db.prepare('DELETE FROM reports').run();
    await db.prepare('DELETE FROM advisors').run();
    // Equivalente Postgres de limpiar sqlite_sequence: reiniciar cada
    // secuencia IDENTITY para que los proximos inserts vuelvan a arrancar
    // en 1 (informe_stats no tiene id propio, su PK es fecha+advisor_id).
    for (const table of ['leads', 'reassignments', 'advisors', 'informe_ventas', 'ad_spend', 'reports']) {
      await db.exec(`ALTER SEQUENCE ${table}_id_seq RESTART WITH 1`);
    }

    const insert = db.prepare(
      'INSERT INTO advisors (name, role, active, is_group, priority_order) VALUES (?, ?, true, false, ?)'
    );
    for (let idx = 0; idx < DEFAULT_ADVISORS.length; idx++) {
      const a = DEFAULT_ADVISORS[idx];
      await insert.run(a.name, a.role, idx + 1);
    }
  });
  await tx();

  broadcast('leads_changed', { reason: 'factory_reset' });
  broadcast('advisors_changed', { reason: 'factory_reset' });
  broadcast('informe_changed', { reason: 'factory_reset' });
  res.json({ ok: true });
});

module.exports = router;
