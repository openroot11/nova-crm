const express = require('express');
const { db } = require('../db');
const { broadcast } = require('../realtime');

const router = express.Router();

function isValidFecha(fecha) {
  return typeof fecha === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(fecha);
}

// Asignados/Contactados/Cotizados/Pendientes/Ventas del dia ya NO se
// escriben a mano: se calculan de los leads reales que registra Ventas
// (cada uno contra su propia fecha: creado, contactado, cotizado o
// cerrado ese dia especifico). Solo "Leads del dia" (canales) sigue siendo
// manual, porque son TODOS los mensajes/llamadas que llegan, incluyendo
// los que nunca se registran como lead en el sistema.
router.get('/:fecha', (req, res) => {
  const { fecha } = req.params;
  if (!isValidFecha(fecha)) return res.status(400).json({ error: 'Fecha invalida (usa YYYY-MM-DD)' });
  const from = `${fecha} 00:00:00`;
  const to = `${fecha} 23:59:59`;

  const advisors = db.prepare('SELECT id, name FROM advisors WHERE is_group = 0 AND active = 1 ORDER BY priority_order ASC').all();

  const asignadosStmt = db.prepare('SELECT COUNT(*) AS c FROM leads WHERE assigned_advisor_id = ? AND created_at >= ? AND created_at <= ?');
  const contactadosStmt = db.prepare(
    'SELECT COUNT(*) AS c FROM leads WHERE assigned_advisor_id = ? AND contacted_at IS NOT NULL AND contacted_at >= ? AND contacted_at <= ?'
  );
  const cotizadosStmt = db.prepare(
    'SELECT COUNT(*) AS c FROM leads WHERE assigned_advisor_id = ? AND quoted_at IS NOT NULL AND quoted_at >= ? AND quoted_at <= ?'
  );
  const pendientesStmt = db.prepare(
    "SELECT COUNT(*) AS c FROM leads WHERE assigned_advisor_id = ? AND created_at >= ? AND created_at <= ? AND quoted_at IS NULL AND status NOT LIKE 'cerrado%'"
  );
  const ventasStmt = db.prepare(
    "SELECT * FROM leads WHERE assigned_advisor_id = ? AND status = 'cerrado_ganado' AND closed_at >= ? AND closed_at <= ? ORDER BY closed_at ASC"
  );

  const asesores = advisors.map((a) => ({
    advisor_id: a.id,
    name: a.name,
    asignados: asignadosStmt.get(a.id, from, to).c,
    contactados: contactadosStmt.get(a.id, from, to).c,
    cotizados: cotizadosStmt.get(a.id, from, to).c,
    pendientes: pendientesStmt.get(a.id, from, to).c,
  }));

  const ventas = advisors.flatMap((a) =>
    ventasStmt.all(a.id, from, to).map((l) => ({
      id: l.id,
      fecha,
      advisor_id: a.id,
      advisor_name: a.name,
      cliente: l.client_name,
      monto: l.amount || 0,
      created_at: l.closed_at,
    }))
  );

  const totales = asesores.reduce(
    (acc, a) => {
      acc.asignados += a.asignados;
      acc.contactados += a.contactados;
      acc.cotizados += a.cotizados;
      acc.pendientes += a.pendientes;
      return acc;
    },
    { asignados: 0, contactados: 0, cotizados: 0, pendientes: 0 }
  );
  totales.ventas_count = ventas.length;
  totales.ventas_total = ventas.reduce((s, v) => s + (v.monto || 0), 0);

  const canalesRow = db.prepare('SELECT whatsapp, correo, llamadas FROM informe_canales WHERE fecha = ?').get(fecha);
  const canales = canalesRow || { whatsapp: 0, correo: 0, llamadas: 0 };

  res.json({ fecha, asesores, ventas, totales, canales });
});

router.put('/:fecha/canales', (req, res) => {
  const { fecha } = req.params;
  if (!isValidFecha(fecha)) return res.status(400).json({ error: 'Fecha invalida (usa YYYY-MM-DD)' });
  const { whatsapp, correo, llamadas } = req.body || {};
  const toInt = (v) => Math.max(0, Math.trunc(Number(v)) || 0);

  db.prepare(
    `INSERT INTO informe_canales (fecha, whatsapp, correo, llamadas)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(fecha) DO UPDATE SET
       whatsapp = excluded.whatsapp,
       correo = excluded.correo,
       llamadas = excluded.llamadas`
  ).run(fecha, toInt(whatsapp), toInt(correo), toInt(llamadas));

  broadcast('informe_changed', { fecha });
  res.json({ ok: true });
});

module.exports = router;
