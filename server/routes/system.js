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
    // Orden obligatorio por las llaves foraneas: payments y reassignments
    // referencian leads (hay que borrarlos antes o la base rechaza el
    // DELETE FROM leads); leads referencia clients y advisors (se borra
    // antes de esos dos). Antes esta funcion no borraba payments ni
    // clients: si alguna vez existia un abono registrado, "Restaurar de
    // fabrica" fallaba a mitad de camino por la llave foranea; y si no
    // fallaba, los clientes viejos seguian apareciendo en Clientes
    // despues de "eliminar todos los datos", y un lead nuevo podia
    // heredar por accidente los abonos de un cliente ya borrado al
    // reiniciar los IDs desde 1.
    await db.prepare('DELETE FROM payments').run();
    await db.prepare('DELETE FROM reassignments').run();
    await db.prepare('DELETE FROM leads').run();
    await db.prepare('DELETE FROM clients').run();
    await db.prepare('DELETE FROM informe_stats').run();
    await db.prepare('DELETE FROM informe_ventas').run();
    await db.prepare('DELETE FROM ad_spend').run();
    await db.prepare('DELETE FROM reports').run();
    await db.prepare('DELETE FROM advisors').run();
    // Borra el contador AUTOINCREMENT rastreado de cada tabla para que los
    // proximos inserts vuelvan a arrancar en 1 (informe_stats no tiene id
    // propio, su PK es fecha+advisor_id).
    for (const table of ['leads', 'clients', 'payments', 'reassignments', 'advisors', 'informe_ventas', 'ad_spend', 'reports']) {
      await db.prepare('DELETE FROM sqlite_sequence WHERE name = ?').run(table);
    }

    const insert = db.prepare(
      'INSERT INTO advisors (name, role, active, is_group, priority_order) VALUES (?, ?, 1, 0, ?)'
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
