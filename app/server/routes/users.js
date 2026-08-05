const express = require('express');
const { db } = require('../db');
const { hashPassword } = require('../auth-utils');
const { broadcast } = require('../realtime');

const router = express.Router();

const ROLES = ['admin', 'coordinador', 'asesor'];

function serialize(user) {
  const advisor = user.advisor_id ? db.prepare('SELECT name FROM advisors WHERE id = ?').get(user.advisor_id) : null;
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    advisor_id: user.advisor_id,
    advisor_name: advisor ? advisor.name : null,
    active: user.active,
    created_at: user.created_at,
  };
}

router.get('/', (req, res) => {
  const users = db.prepare('SELECT * FROM users ORDER BY created_at ASC').all();
  res.json(users.map(serialize));
});

router.post('/', (req, res) => {
  const { username, password, role, advisor_id } = req.body || {};
  const cleanUsername = String(username || '').trim();
  if (!cleanUsername) return res.status(400).json({ error: 'El usuario es requerido' });
  if (!password || String(password).length < 4) {
    return res.status(400).json({ error: 'La contraseña debe tener al menos 4 caracteres' });
  }
  if (!ROLES.includes(role)) return res.status(400).json({ error: 'Rol inválido' });
  if (advisor_id) {
    const advisor = db.prepare('SELECT id FROM advisors WHERE id = ?').get(Number(advisor_id));
    if (!advisor) return res.status(400).json({ error: 'Asesor inválido' });
  }
  const existing = db.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE').get(cleanUsername);
  if (existing) return res.status(409).json({ error: 'Ya existe un usuario con ese nombre' });

  const info = db
    .prepare('INSERT INTO users (username, password_hash, role, advisor_id, active) VALUES (?, ?, ?, ?, 1)')
    .run(cleanUsername, hashPassword(String(password)), role, advisor_id ? Number(advisor_id) : null);

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
  broadcast('users_changed', { reason: 'created', id: user.id });
  res.status(201).json(serialize(user));
});

router.patch('/:id', (req, res) => {
  const id = Number(req.params.id);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

  const { role, advisor_id, active } = req.body || {};
  if (role !== undefined && !ROLES.includes(role)) return res.status(400).json({ error: 'Rol inválido' });
  if (advisor_id) {
    const advisor = db.prepare('SELECT id FROM advisors WHERE id = ?').get(Number(advisor_id));
    if (!advisor) return res.status(400).json({ error: 'Asesor inválido' });
  }
  if (active === false && id === req.user.id) {
    return res.status(400).json({ error: 'No puedes desactivar tu propia cuenta' });
  }
  if (role !== undefined && role !== 'admin' && id === req.user.id) {
    return res.status(400).json({ error: 'No puedes quitarte a ti mismo el rol de administrador' });
  }

  db.prepare(
    'UPDATE users SET role = COALESCE(?, role), advisor_id = ?, active = COALESCE(?, active) WHERE id = ?'
  ).run(
    role ?? null,
    advisor_id !== undefined ? (advisor_id ? Number(advisor_id) : null) : user.advisor_id,
    active === undefined ? null : (active ? 1 : 0),
    id
  );

  broadcast('users_changed', { reason: 'updated', id });
  res.json(serialize(db.prepare('SELECT * FROM users WHERE id = ?').get(id)));
});

router.post('/:id/reset-password', (req, res) => {
  const id = Number(req.params.id);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
  const { password } = req.body || {};
  if (!password || String(password).length < 4) {
    return res.status(400).json({ error: 'La contraseña debe tener al menos 4 caracteres' });
  }
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(String(password)), id);
  res.json({ ok: true });
});

module.exports = router;
