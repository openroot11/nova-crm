const path = require('path');
const fs = require('fs');
const cron = require('node-cron');
const { db, getSetting, setSetting } = require('./db');

const BACKUPS_DIR = path.join(__dirname, 'backups');
if (!fs.existsSync(BACKUPS_DIR)) fs.mkdirSync(BACKUPS_DIR, { recursive: true });

async function buildFullDump() {
  const [advisors, leads, reassignments, informe_stats, informe_ventas, settingsRows] = await Promise.all([
    db.prepare('SELECT * FROM advisors ORDER BY priority_order ASC').all(),
    db.prepare('SELECT * FROM leads ORDER BY id ASC').all(),
    db.prepare('SELECT * FROM reassignments ORDER BY id ASC').all(),
    db.prepare('SELECT * FROM informe_stats ORDER BY fecha ASC').all(),
    db.prepare('SELECT * FROM informe_ventas ORDER BY id ASC').all(),
    db.prepare('SELECT key, value FROM settings').all(),
  ]);
  return {
    exported_at: new Date().toISOString(),
    advisors,
    leads,
    reassignments,
    informe_stats,
    informe_ventas,
    settings: Object.fromEntries(settingsRows.map((r) => [r.key, r.value])),
  };
}

async function writeBackupFile() {
  const dump = await buildFullDump();
  const stamp = dump.exported_at.replace(/[:.]/g, '-');
  const filePath = path.join(BACKUPS_DIR, `backup-${stamp}.json`);
  fs.writeFileSync(filePath, JSON.stringify(dump, null, 2), 'utf8');
  await setSetting('last_backup_at', dump.exported_at);
  return filePath;
}

function scheduleWeeklyBackup() {
  // Revisa cada domingo a las 23:50; solo escribe si el toggle esta activo.
  cron.schedule('50 23 * * 0', async () => {
    try {
      if ((await getSetting('auto_backup_weekly', 'true')) === 'true') {
        await writeBackupFile();
      }
    } catch (err) {
      console.error('Error en el backup semanal automatico:', err);
    }
  });
}

module.exports = { buildFullDump, writeBackupFile, scheduleWeeklyBackup, BACKUPS_DIR };

