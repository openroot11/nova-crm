const path = require('path');
const os = require('os');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');

const { getSetting, setSetting } = require('./db'); // asegura schema + seed antes de levantar rutas
const realtime = require('./realtime');
const { scheduleWeeklyBackup } = require('./backup');
const { loadUser, requireRole } = require('./middleware/auth');

const PORT = process.env.PORT || 4000;

const app = express();
app.use(express.json());

// Sesion en memoria (suficiente para una herramienta de LAN de 4 personas).
// El secreto se genera una sola vez y se guarda en settings, para que
// reiniciar el servidor (ej. al reabrir iniciar.bat) no obligue a todo el
// equipo a volver a iniciar sesion.
let sessionSecret = getSetting('session_secret');
if (!sessionSecret) {
  sessionSecret = crypto.randomBytes(32).toString('hex');
  setSetting('session_secret', sessionSecret);
}

app.use(
  session({
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 24 * 30 }, // 30 dias
  })
);

app.use('/api/auth', require('./routes/auth'));

// Todo el resto de /api/* requiere sesion iniciada; loadUser ademas deja el
// usuario (con su rol) disponible en req.user para los gates de cada ruta.
app.use('/api', loadUser);

app.use(express.static(path.join(__dirname, '..', 'public')));

app.use('/api/leads', require('./routes/leads'));
app.use('/api/advisors', require('./routes/advisors'));
app.use('/api/kpis', requireRole('admin', 'coordinador'), require('./routes/kpis'));
app.use('/api/marketing', requireRole('admin', 'coordinador'), require('./routes/marketing'));
app.use('/api/reports', requireRole('admin', 'coordinador'), require('./routes/reports'));
app.use('/api/settings', requireRole('admin'), require('./routes/settings'));
app.use('/api/export', requireRole('admin'), require('./routes/exports'));
app.use('/api/system', requireRole('admin'), require('./routes/system'));
app.use('/api/informe', requireRole('admin', 'coordinador'), require('./routes/informe'));
app.use('/api/users', requireRole('admin'), require('./routes/users'));

app.get('/api/health', (req, res) => res.json({ ok: true, at: new Date().toISOString() }));

const server = http.createServer(app);
realtime.attach(server);
scheduleWeeklyBackup();

function lanAddresses() {
  const nets = os.networkInterfaces();
  const addresses = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) addresses.push(net.address);
    }
  }
  return addresses;
}

server.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('=========================================');
  console.log('  SalesForce CRM - servidor iniciado');
  console.log('=========================================');
  console.log(`  En esta PC:      http://localhost:${PORT}`);
  for (const ip of lanAddresses()) {
    console.log(`  Otros equipos:   http://${ip}:${PORT}`);
  }
  console.log('=========================================');
  console.log('');
});
