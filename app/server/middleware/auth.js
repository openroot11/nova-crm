const { db } = require('../db');

// Carga el usuario de la sesion en req.user. Se monta una sola vez, despues
// de /api/auth (login/logout/session quedan siempre accesibles), y antes de
// cualquier otra ruta /api/*.
function loadUser(req, res, next) {
  const userId = req.session && req.session.userId;
  if (!userId) return res.status(401).json({ error: 'No autenticado' });
  const user = db.prepare('SELECT * FROM users WHERE id = ? AND active = 1').get(userId);
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

module.exports = { loadUser, requireRole };
