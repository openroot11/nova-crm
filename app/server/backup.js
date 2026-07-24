const path = require('path');
const fs = require('fs');
const cron = require('node-cron');
const { db, getSetting, setSetting } = require('./db');

const BACKUPS_DIR = path.join(__dirname, 'backups');
if (!fs.existsSync(BACKUPS_DIR)) fs.mkdirSync(BACKUPS_DIR, { recursive: true });

function buildFullDump() {
  return {
    exported_at: new Date().toISOString(),
    advisors: db.prepare('SELECT * FROM advisors ORDER BY priority_order ASC').all(),
    leads: db.prepare('SELECT * FROM leads ORDER BY id ASC').all(),
    reassignments: db.prepare('SELECT * FROM reassignments ORDER BY id ASC').all(),
    informe_stats: db.prepare('SELECT * FROM informe_stats ORDER BY fecha ASC').all(),
    informe_ventas: db.prepare('SELECT * FROM informe_ventas ORDER BY id ASC').all(),
    settings: Object.fromEntries(
      db.prepare('SELECT key, value FROM settings').all().map((r) => [r.key, r.value])
    ),
  };
}

function writeBackupFile() {
  const dump = buildFullDump();
  const stamp = dump.exported_at.replace(/[:.]/g, '-');
  const filePath = path.join(BACKUPS_DIR, `backup-${stamp}.json`);
  fs.writeFileSync(filePath, JSON.stringify(dump, null, 2), 'utf8');
  setSetting('last_backup_at', dump.exported_at);
  return filePath;
}

function scheduleWeeklyBackup() {
  // Revisa cada domingo a las 23:50; solo escribe si el toggle esta activo.
  cron.schedule('50 23 * * 0', () => {
    if (getSetting('auto_backup_weekly', 'true') === 'true') {
      writeBackupFile();
    }
  });
}

module.exports = { buildFullDump, writeBackupFile, scheduleWeeklyBackup, BACKUPS_DIR };
