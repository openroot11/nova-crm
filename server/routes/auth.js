const express = require('express');
const { db } = require('../db');
const { hashPassword, verifyPassword } = require('../auth-utils');
const { resolveUser, AUTH_DISABLED } = require('../middleware/auth');

const router = express.Router();

async function serializeUser(user) {
  const advisor = user.advisor_id ? await db.prepare('SELECT name FROM advisors WHERE id = ?').get(user.advisor_id) : null;
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    advisor_id: user.advisor_id,
    advisor_name: advisor ? advisor.name : null,
  };
}

router.get('/session', async (req, res) => {
  const userCount = (await db.prepare('SELECT COUNT(*) AS c FROM users').get()).c;
  const user = await resolveUser(req);
  res.json({
    authenticated: !!user,
    firstRun: !AUTH_DISABLED && userCount === 0,
    user: user ? await serializeUser(user) : null,
  });
});

router.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!password || !String(password).trim()) {
    return res.status(400).json({ error: 'La contraseña es requerida' });
  }

  const userCount = (await db.prepare('SELECT COUNT(*) AS c FROM users').get()).c;

  if (userCount === 0) {
    // Primer uso real: nadie ha creado ninguna cuenta todavia. Lo que se
    // envie ahora se guarda como el primer usuario, con rol admin.
    const cleanUsername = String(username || '').trim();
    if (!cleanUsername) return res.status(400).json({ error: 'El usuario es requerido' });
    if (String(password).length < 4) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 4 caracteres' });
    }
    const info = await db
      .prepare("INSERT INTO users (username, password_hash, role, active) VALUES (?, ?, 'admin', true)")
      .run(cleanUsername, hashPassword(String(password)));
    req.session.userId = info.lastInsertRowid;
    const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
    return res.json({ ok: true, firstRun: true, user: await serializeUser(user) });
  }

  const cleanUsername = String(username || '').trim();
  const user = cleanUsername
    ? await db.prepare('SELECT * FROM users WHERE lower(username) = lower(?) AND active = true').get(cleanUsername)
    : null;
  if (!user || !verifyPassword(String(password), user.password_hash)) {
    return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
  }
  req.session.userId = user.id;
  res.json({ ok: true, firstRun: false, user: await serializeUser(user) });
});

router.post('/logout', (req, res) => {
  if (req.session) {
    req.session.destroy(() => res.json({ ok: true }));
  } else {
    res.json({ ok: true });
  }
});

module.exports = router;
