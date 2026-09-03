const { WebSocketServer } = require('ws');

let wss = null;

function attach(server) {
  wss = new WebSocketServer({ server, path: '/ws' });
  wss.on('connection', (socket) => {
    socket.send(JSON.stringify({ type: 'hello', payload: { at: new Date().toISOString() } }));
  });
}

/**
 * Notifica a todos los clientes conectados (Ventas, SLA, Turnos, Monitor, etc).
 * type: 'leads_changed' | 'advisors_changed' | 'settings_changed'
 */
function broadcast(type, payload = {}) {
  if (!wss) return;
  const message = JSON.stringify({ type, payload });
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(message);
  }
}

module.exports = { attach, broadcast };
