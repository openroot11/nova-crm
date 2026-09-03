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
router.get('/:fecha', async (req, res) => {
  const { fecha } = req.params;
  if (!isValidFecha(fecha)) return res.status(400).json({ error: 'Fecha invalida (usa YYYY-MM-DD)' });
  const from = `${fecha} 00:00:00`;
  const to = `${fecha} 23:59:59`;

  const advisors = await db.prepare('SELECT id, name FROM advisors WHERE is_group = false AND active = true ORDER BY priority_order ASC').all();

  // Estado de Leads del Dashboard: mismo desglose por status que "Estado
  // Leads" de Estadisticas (ver kpis.js), pero acotado a los leads creados
  // ESE dia especifico -- no el pipeline completo historico. El status es
  // el ACTUAL de cada lead (un lead de hoy ya puede estar cotizado o
  // cerrado hoy mismo), no una foto del momento en que se creo.
  const leadsHoy = await db.prepare('SELECT status FROM leads_visible WHERE created_at >= ? AND created_at <= ?').all(from, to);
  const statusLabels = {
    asignado: 'Asignado',
    contactado: 'Contactado',
    cotizado: 'Cotizado',
    cerrado_ganado: 'Cerrado Ganado',
    cerrado_perdido: 'Perdido',
  };
  const distributionHoy = {};
  for (const key of Object.keys(statusLabels)) distributionHoy[key] = 0;
  for (const lead of leadsHoy) distributionHoy[lead.status] = (distributionHoy[lead.status] || 0) + 1;
  const lead_status_distribution = Object.entries(distributionHoy).map(([key, count]) => ({
    status: key,
    label: statusLabels[key],
    count,
  }));

  const asignadosStmt = db.prepare('SELECT COUNT(*) AS c FROM leads_visible WHERE assigned_advisor_id = ? AND created_at >= ? AND created_at <= ?');
  // Un lead cotizado ese dia cuenta tambien como contactado ese dia, aunque
  // el contacto real (contacted_at) haya quedado registrado un dia anterior:
  // no tiene sentido que el informe diga "cotizo 1, contacto 0".
  const contactadosStmt = db.prepare(
    `SELECT COUNT(*) AS c FROM leads_visible WHERE assigned_advisor_id = ? AND (
       (contacted_at IS NOT NULL AND contacted_at >= ? AND contacted_at <= ?)
       OR (quoted_at IS NOT NULL AND quoted_at >= ? AND quoted_at <= ?)
     )`
  );
  const cotizadosStmt = db.prepare(
    'SELECT COUNT(*) AS c FROM leads_visible WHERE assigned_advisor_id = ? AND quoted_at IS NOT NULL AND quoted_at >= ? AND quoted_at <= ?'
  );
  const pendientesStmt = db.prepare(
    "SELECT COUNT(*) AS c FROM leads_visible WHERE assigned_advisor_id = ? AND created_at >= ? AND created_at <= ? AND quoted_at IS NULL AND status NOT LIKE 'cerrado%'"
  );
  const ventasStmt = db.prepare(
    "SELECT * FROM leads_visible WHERE assigned_advisor_id = ? AND status = 'cerrado_ganado' AND closed_at >= ? AND closed_at <= ? ORDER BY closed_at ASC"
  );
  const declinadosStmt = db.prepare(
    "SELECT * FROM leads_visible WHERE assigned_advisor_id = ? AND status = 'cerrado_perdido' AND closed_at >= ? AND closed_at <= ? ORDER BY closed_at ASC"
  );
  // Seguimientos registrados ese dia (boton "Dar seguimiento" en la pantalla
  // de Seguimiento): last_followup_at solo guarda el ULTIMO toque, igual que
  // quoted_at para "cotizados" arriba -- si un lead recibio mas de un
  // seguimiento el mismo dia, cuenta una sola vez (el mas reciente), no una
  // fila por cada clic.
  const seguimientosStmt = db.prepare(
    'SELECT COUNT(*) AS c FROM leads_visible WHERE assigned_advisor_id = ? AND last_followup_at IS NOT NULL AND last_followup_at >= ? AND last_followup_at <= ?'
  );
  const seguimientosDetalleStmt = db.prepare(
    'SELECT * FROM leads_visible WHERE assigned_advisor_id = ? AND last_followup_at IS NOT NULL AND last_followup_at >= ? AND last_followup_at <= ? ORDER BY last_followup_at ASC'
  );

  const asesores = await Promise.all(
    advisors.map(async (a) => ({
      advisor_id: a.id,
      name: a.name,
      asignados: (await asignadosStmt.get(a.id, from, to)).c,
      contactados: (await contactadosStmt.get(a.id, from, to, from, to)).c,
      cotizados: (await cotizadosStmt.get(a.id, from, to)).c,
      pendientes: (await pendientesStmt.get(a.id, from, to)).c,
      seguimientos: (await seguimientosStmt.get(a.id, from, to)).c,
    }))
  );

  const ventasByAdvisor = await Promise.all(advisors.map((a) => ventasStmt.all(a.id, from, to)));
  const ventas = advisors.flatMap((a, idx) =>
    ventasByAdvisor[idx].map((l) => ({
      id: l.id,
      fecha,
      advisor_id: a.id,
      advisor_name: a.name,
      cliente: l.client_name,
      monto: l.amount || 0,
      created_at: l.closed_at,
    }))
  );

  const declinadosByAdvisor = await Promise.all(advisors.map((a) => declinadosStmt.all(a.id, from, to)));
  const declinados = advisors.flatMap((a, idx) =>
    declinadosByAdvisor[idx].map((l) => ({
      id: l.id,
      fecha,
      advisor_id: a.id,
      advisor_name: a.name,
      cliente: l.client_name,
      created_at: l.closed_at,
    }))
  );

  const seguimientosByAdvisor = await Promise.all(advisors.map((a) => seguimientosDetalleStmt.all(a.id, from, to)));
  const seguimientos = advisors.flatMap((a, idx) =>
    seguimientosByAdvisor[idx].map((l) => ({
      id: l.id,
      fecha,
      advisor_id: a.id,
      advisor_name: a.name,
      cliente: l.client_name,
      followup_count: l.followup_count,
      created_at: l.last_followup_at,
    }))
  );

  const totales = asesores.reduce(
    (acc, a) => {
      acc.asignados += a.asignados;
      acc.contactados += a.contactados;
      acc.cotizados += a.cotizados;
      acc.pendientes += a.pendientes;
      acc.seguimientos += a.seguimientos;
      return acc;
    },
    { asignados: 0, contactados: 0, cotizados: 0, pendientes: 0, seguimientos: 0 }
  );
  totales.ventas_count = ventas.length;
  totales.ventas_total = ventas.reduce((s, v) => s + (v.monto || 0), 0);
  totales.declinados_count = declinados.length;

  const canalesRow = await db.prepare('SELECT whatsapp, correo, llamadas FROM informe_canales WHERE fecha = ?').get(fecha);
  const canales = canalesRow || { whatsapp: 0, correo: 0, llamadas: 0 };

  const reasignadosRows = await db
    .prepare(
      `SELECT r.at, l.client_name, fa.name AS from_advisor_name, ta.name AS to_advisor_name
       FROM reassignments r
       JOIN leads l ON l.id = r.lead_id
       LEFT JOIN advisors fa ON fa.id = r.from_advisor_id
       LEFT JOIN advisors ta ON ta.id = r.to_advisor_id
       WHERE r.at >= ? AND r.at <= ?
       ORDER BY r.at ASC`
    )
    .all(from, to);
  const reasignados = { count: reasignadosRows.length, detalle: reasignadosRows };

  res.json({
    fecha,
    asesores,
    ventas,
    declinados,
    seguimientos,
    totales,
    canales,
    reasignados,
    total_leads_hoy: leadsHoy.length,
    lead_status_distribution,
  });
});

router.put('/:fecha/canales', async (req, res) => {
  const { fecha } = req.params;
  if (!isValidFecha(fecha)) return res.status(400).json({ error: 'Fecha invalida (usa YYYY-MM-DD)' });
  const { whatsapp, correo, llamadas } = req.body || {};
  const toInt = (v) => Math.max(0, Math.trunc(Number(v)) || 0);

  await db
    .prepare(
      `INSERT INTO informe_canales (fecha, whatsapp, correo, llamadas)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(fecha) DO UPDATE SET
         whatsapp = excluded.whatsapp,
         correo = excluded.correo,
         llamadas = excluded.llamadas`
    )
    .run(fecha, toInt(whatsapp), toInt(correo), toInt(llamadas));

  broadcast('informe_changed', { fecha });
  res.json({ ok: true });
});

module.exports = router;
