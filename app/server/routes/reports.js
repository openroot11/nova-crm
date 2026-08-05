const express = require('express');
const XLSX = require('xlsx');
const { db } = require('../db');
const reporting = require('../reporting');
const { requireRole } = require('../middleware/auth');

const router = express.Router();

function serializeMeta(row) {
  const user = row.generated_by ? db.prepare('SELECT username FROM users WHERE id = ?').get(row.generated_by) : null;
  return {
    id: row.id,
    type: row.type,
    period_from: row.period_from,
    period_to: row.period_to,
    generated_at: row.generated_at,
    generated_by: user ? user.username : null,
  };
}

router.get('/', (req, res) => {
  const { type } = req.query;
  const rows = type
    ? db.prepare('SELECT * FROM reports WHERE type = ? ORDER BY generated_at DESC').all(type)
    : db.prepare('SELECT * FROM reports ORDER BY generated_at DESC').all();
  res.json(rows.map(serializeMeta));
});

router.get('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM reports WHERE id = ?').get(Number(req.params.id));
  if (!row) return res.status(404).json({ error: 'Reporte no encontrado' });
  res.json({ ...serializeMeta(row), data: JSON.parse(row.data) });
});

// Genera un snapshot con los datos ACTUALES del rango pedido y lo archiva.
// Queda fijo desde ese momento (no se recalcula despues), a proposito: es el
// registro historico que reemplaza la carpeta manual.
router.post('/', (req, res) => {
  const { type, from, to } = req.body || {};
  if (!['rendimiento', 'rentabilidad'].includes(type)) {
    return res.status(400).json({ error: 'type debe ser "rendimiento" o "rentabilidad"' });
  }
  const data = type === 'rendimiento' ? reporting.computeFunnelReport(from, to) : reporting.computeProfitabilityReport(from, to);

  const info = db
    .prepare('INSERT INTO reports (type, period_from, period_to, generated_by, data) VALUES (?, ?, ?, ?, ?)')
    .run(type, data.from, data.to, req.user.id, JSON.stringify(data));

  const row = db.prepare('SELECT * FROM reports WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ ...serializeMeta(row), data });
});

router.delete('/:id', requireRole('admin'), (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare('SELECT id FROM reports WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'Reporte no encontrado' });
  db.prepare('DELETE FROM reports WHERE id = ?').run(id);
  res.json({ ok: true });
});

router.get('/:id/xlsx', (req, res) => {
  const row = db.prepare('SELECT * FROM reports WHERE id = ?').get(Number(req.params.id));
  if (!row) return res.status(404).json({ error: 'Reporte no encontrado' });
  const data = JSON.parse(row.data);
  const wb = XLSX.utils.book_new();

  if (row.type === 'rendimiento') {
    const sheet = XLSX.utils.json_to_sheet(
      data.advisors.map((a) => ({
        Asesor: a.name,
        Ranking: a.rank,
        Asignados: a.asignados,
        Contactados: a.contactados,
        Cotizados: a.cotizados,
        Vendidos: a.vendidos,
        Perdidos: a.perdidos,
        '% Contacto': a.tasa_contacto,
        '% Cotización': a.tasa_cotizacion,
        '% Cierre': a.tasa_cierre,
        '% Cumplimiento SLA': a.sla_cumplimiento,
        'Horas promedio de cierre': a.tiempo_promedio_cierre_h,
        'Monto vendido': a.monto_vendido,
      }))
    );
    XLSX.utils.book_append_sheet(wb, sheet, 'Rendimiento por asesor');
  } else {
    const sheet = XLSX.utils.json_to_sheet(
      data.channels.map((c) => ({
        Canal: c.channel,
        Leads: c.leads,
        Vendidos: c.ganados,
        '% Conversión': c.tasa_conversion,
        Ingresos: c.ingresos,
      }))
    );
    XLSX.utils.book_append_sheet(wb, sheet, 'Rentabilidad por canal');
    const gaSheet = XLSX.utils.json_to_sheet([
      {
        Leads_Google_Ads: data.google_ads.leads,
        Vendidos_Google_Ads: data.google_ads.ganados,
        Ingresos_Google_Ads: data.google_ads.ingresos,
        Inversión: data.google_ads.inversion,
        Costo_por_lead: data.google_ads.costo_por_lead,
        Costo_por_venta: data.google_ads.costo_por_venta,
        'ROI_%': data.google_ads.roi_pct,
      },
    ]);
    XLSX.utils.book_append_sheet(wb, gaSheet, 'Resumen Google Ads');
  }

  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const stamp = row.generated_at.replace(/[:\s]/g, '-');
  res.setHeader('Content-Disposition', `attachment; filename="reporte-${row.type}-${stamp}.xlsx"`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buffer);
});

module.exports = router;
