const { db } = require('./db');

async function getOrderedAdvisors() {
  return db.prepare('SELECT * FROM advisors ORDER BY priority_order ASC').all();
}

async function setPaused(advisorId, paused) {
  await db.prepare('UPDATE advisors SET active = ? WHERE id = ?').run(!paused, advisorId);
}

module.exports = {
  getOrderedAdvisors,
  setPaused,
};
