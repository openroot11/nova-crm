const { db } = require('../db');

// Interruptor temporal para desarrollo/demo: con NOVA_DISABLE_AUTH=true no
// se pide login, todo el mundo opera como admin. Nunca debe quedar activo
// en el uso real del equipo (ver aviso en index.js al arrancar).
const AUTH_DISABLED = process.env.NOVA_DISABLE_AUTH === 'true';

function devUser() {
  // Se opera como el primer admin real que exista, para que lo que se haga
  // quede atribuido a una cuenta real; si todavia no hay ninguna, se cae a
  // un usuario admin sintetico (sin id) solo para no bloquear el arranque.
  const real = db.prepare("SELECT * FROM users WHERE role = 'admin' AND active = 1 ORDER BY id ASC LIMIT 1").get();
  return real || { id: null, username: 'dev', role: 'admin', advisor_id: null, active: 1 };
}

// Resuelve el usuario de la peticion actual: si el login esta desactivado,
// siempre hay "usuario" (admin) sin exigir sesion; si no, exige sesion valida.
function resolveUser(req) {
  if (AUTH_DISABLED) return devUser();
  const userId = req.session && req.session.userId;
  if (!userId) return null;
  return db.prepare('SELECT * FROM users WHERE id = ? AND active = 1').get(userId) || null;
}

// Carga el usuario en req.user. Se monta una sola vez, despues de /api/auth
// (login/logout/session quedan siempre accesibles), y antes de cualquier
// otra ruta /api/*.
function loadUser(req, res, next) {
  const user = resolveUser(req);
  if (!user) return res.status(401).json({ error: 'No autenticado' });
  req.user = user;
  next();
}

// Factory de middleware: requireRole('admin', 'coordinador') solo deja pasar
// esos roles. Debe usarse despues de loadUser (req.user ya disponible).
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'No tienes permiso para esta acción' });
    }
    next();
  };
}

module.exports = { loadUser, requireRole, resolveUser, AUTH_DISABLED };
