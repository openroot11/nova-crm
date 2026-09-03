const crypto = require('crypto');

// Hash simple con la libreria de crypto que ya trae Node (scrypt), sin
// depender de bcrypt/argon2 (evita agregar otra dependencia con compilacion
// nativa). Formato guardado: "saltHex:hashHex". Compartido entre auth.js y
// users.js (y usado por db.js para migrar la contraseña compartida al
// primer usuario admin).
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

module.exports = { hashPassword, verifyPassword };
