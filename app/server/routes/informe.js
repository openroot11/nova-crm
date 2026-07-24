const express = require('express');
const { db } = require('../db');
const { broadcast } = require('../realtime');

const router = express.Router();

function isValidFecha(fecha) {
  return typeof fecha === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(fecha);
}

router.get('/:fecha', (req, res) => {
  const { fecha } = req.params;
  if (!isValidFecha(fecha)) return res.status(400).json({ error: 'Fecha invalida (usa YYYY-MM-DD)' });

  const advisors = db.prepare('SELECT id, name FROM advisors WHERE is_group = 0 AND active = 1 ORDER BY priority_order ASC').all();
  const statsRows = db.prepare('SELECT * FROM informe_stats WHERE fecha = ?').all(fecha);
  const statsByAdvisor = Object.fromEntries(statsRows.map((r) => [r.advisor_id, r]));

  const asesores = advisors.map((a) => {
    const s = statsByAdvisor[a.id];
    return {
      advisor_id: a.id,
      name: a.name,
      asignados: s ? s.asignados : 0,
      contactados: s ? s.contactados : 0,
      cotizados: s ? s.cotizados : 0,
      pendientes: s ? s.pendientes : 0,
    };
  });

  const ventas = db
    .prepare('SELECT * FROM informe_ventas WHERE fecha = ? ORDER BY created_at ASC')
    .all(fecha)
    .map((v) => {
      const advisor = db.prepare('SELECT name FROM advisors WHERE id = ?').get(v.advisor_id);
      return { ...v, advisor_name: advisor ? advisor.name : 'Sin asesor' };
    });

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

router.put('/:fecha/stats', (req, res) => {
  const { fecha } = req.params;
  if (!isValidFecha(fecha)) return res.status(400).json({ error: 'Fecha invalida (usa YYYY-MM-DD)' });
  const { advisor_id, asignados, contactados, cotizados, pendientes } = req.body || {};
  const advisor = db.prepare('SELECT id FROM advisors WHERE id = ?').get(Number(advisor_id));
  if (!advisor) return res.status(400).json({ error: 'Asesor invalido' });

  const toInt = (v) => Math.max(0, Math.trunc(Number(v)) || 0);
  db.prepare(
    `INSERT INTO informe_stats (fecha, advisor_id, asignados, contactados, cotizados, pendientes)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(fecha, advisor_id) DO UPDATE SET
       asignados = excluded.asignados,
       contactados = excluded.contactados,
       cotizados = excluded.cotizados,
       pendientes = excluded.pendientes`
  ).run(fecha, advisor.id, toInt(asignados), toInt(contactados), toInt(cotizados), toInt(pendientes));

  broadcast('informe_changed', { fecha });
  res.json({ ok: true });
});

router.post('/:fecha/ventas', (req, res) => {
  const { fecha } = req.params;
  if (!isValidFecha(fecha)) return res.status(400).json({ error: 'Fecha invalida (usa YYYY-MM-DD)' });
  const { advisor_id, cliente, monto } = req.body || {};
  const advisor = db.prepare('SELECT id, name FROM advisors WHERE id = ?').get(Number(advisor_id));
  if (!advisor) return res.status(400).json({ error: 'Selecciona un asesor' });
  const montoNum = Number(monto);
  if (!montoNum || montoNum <= 0) return res.status(400).json({ error: 'El monto de la venta debe ser mayor a 0' });

  const info = db
    .prepare('INSERT INTO informe_ventas (fecha, advisor_id, cliente, monto) VALUES (?, ?, ?, ?)')
    .run(fecha, advisor.id, (cliente || '').trim() || null, montoNum);

  broadcast('informe_changed', { fecha });
  res.status(201).json({ id: info.lastInsertRowid, fecha, advisor_id: advisor.id, advisor_name: advisor.name, cliente: cliente || null, monto: montoNum });
});

router.delete('/ventas/:id', (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare('SELECT fecha FROM informe_ventas WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'Venta no encontrada' });
  db.prepare('DELETE FROM informe_ventas WHERE id = ?').run(id);
  broadcast('informe_changed', { fecha: row.fecha });
  res.json({ ok: true });
});

module.exports = router;
