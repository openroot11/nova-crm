const { db } = require('./db');

function getOrderedAdvisors() {
  return db.prepare('SELECT * FROM advisors ORDER BY priority_order ASC').all();
}

function setPaused(advisorId, paused) {
  db.prepare('UPDATE advisors SET active = ? WHERE id = ?').run(paused ? 0 : 1, advisorId);
}

module.exports = {
  getOrderedAdvisors,
  setPaused,
};
