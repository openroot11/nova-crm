const express = require('express');
const crypto = require('crypto');
const { getSetting, setSetting } = require('../db');

const router = express.Router();

const SETTING_KEY = 'admin_password_hash';

// Hash simple con la libreria de crypto que ya trae Node (scrypt), sin
// depender de bcrypt/argon2 (evita agregar otra dependencia con compilacion
// nativa). Formato guardado: "saltHex:hashHex".
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = String(stored || '').split(':');
  if (!salt || !hash) return false;
  const candidate = crypto.scryptSync(password, salt, 64).toString('hex');
  const a = Buffer.from(candidate, 'hex');
  const b = Buffer.from(hash, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

router.get('/session', (req, res) => {
  const hasHash = !!getSetting(SETTING_KEY);
  res.json({ authenticated: !!(req.session && req.session.authenticated), firstRun: !hasHash });
});

router.post('/login', (req, res) => {
  const { password } = req.body || {};
  if (!password || !String(password).trim()) {
    return res.status(400).json({ error: 'La contraseña es requerida' });
  }

  const stored = getSetting(SETTING_KEY);

  if (!stored) {
    // Primer uso: no hay contraseña configurada todavia. Lo que se envie
    // ahora se guarda como la contraseña del equipo y se inicia sesion.
    if (String(password).length < 4) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 4 caracteres' });
    }
    setSetting(SETTING_KEY, hashPassword(String(password)));
    req.session.authenticated = true;
    return res.json({ ok: true, firstRun: true });
  }

  if (!verifyPassword(String(password), stored)) {
    return res.status(401).json({ error: 'Contraseña incorrecta' });
  }
  req.session.authenticated = true;
  res.json({ ok: true, firstRun: false });
});

router.post('/logout', (req, res) => {
  if (req.session) {
    req.session.destroy(() => res.json({ ok: true }));
  } else {
    res.json({ ok: true });
  }
});

module.exports = router;
