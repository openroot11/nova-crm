const express = require('express');
const XLSX = require('xlsx');
const { db } = require('../db');
const reporting = require('../reporting');
const { requireRole } = require('../middleware/auth');

const router = express.Router();

async function serializeMeta(row) {
  const user = row.generated_by ? await db.prepare('SELECT username FROM users WHERE id = ?').get(row.generated_by) : null;
  const advisor = row.advisor_id ? await db.prepare('SELECT name FROM advisors WHERE id = ?').get(row.advisor_id) : null;
  return {
    id: row.id,
    type: row.type,
    period_from: row.period_from,
    period_to: row.period_to,
    advisor_id: row.advisor_id,
    advisor_name: advisor ? advisor.name : null,
    generated_at: row.generated_at,
    generated_by: user ? user.username : null,
  };
}

router.get('/', async (req, res) => {
  const { type, advisor_id } = req.query;
  const conditions = [];
  const params = [];
  if (type) {
    conditions.push('type = ?');
    params.push(type);
  }
  if (advisor_id) {
    conditions.push('advisor_id = ?');
    params.push(Number(advisor_id));
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = await db.prepare(`SELECT * FROM reports ${where} ORDER BY generated_at DESC`).all(...params);
  res.json(await Promise.all(rows.map(serializeMeta)));
});

router.get('/:id', async (req, res) => {
  const row = await db.prepare('SELECT * FROM reports WHERE id = ?').get(Number(req.params.id));
  if (!row) return res.status(404).json({ error: 'Reporte no encontrado' });
  res.json({ ...(await serializeMeta(row)), data: JSON.parse(row.data) });
});

// Genera un snapshot con los datos ACTUALES del rango pedido y lo archiva.
// Queda fijo desde ese momento (no se recalcula despues), a proposito: es el
// registro historico que reemplaza la carpeta manual.
router.post('/', async (req, res) => {
  const { type, from, to, advisor_id } = req.body || {};
  if (!['rendimiento', 'rentabilidad', 'asesor'].includes(type)) {
    return res.status(400).json({ error: 'type debe ser "rendimiento", "rentabilidad" o "asesor"' });
  }

  let data;
  let advisorId = null;
  if (type === 'rendimiento') {
    data = await reporting.computeFunnelReport(from, to);
  } else if (type === 'rentabilidad') {
    data = await reporting.computeProfitabilityReport(from, to);
  } else {
    if (!advisor_id) return res.status(400).json({ error: 'advisor_id es requerido para type "asesor"' });
    data = await reporting.computeAdvisorReport(advisor_id, from, to);
    if (!data) return res.status(404).json({ error: 'Asesor no encontrado' });
    advisorId = data.advisor.id;
  }

  const info = await db
    .prepare('INSERT INTO reports (type, period_from, period_to, advisor_id, generated_by, data) VALUES (?, ?, ?, ?, ?, ?)')
    .run(type, data.from, data.to, advisorId, req.user.id, JSON.stringify(data));

  const row = await db.prepare('SELECT * FROM reports WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ ...(await serializeMeta(row)), data });
});

router.delete('/:id', requireRole('admin'), async (req, res) => {
  const id = Number(req.params.id);
  const row = await db.prepare('SELECT id FROM reports WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'Reporte no encontrado' });
  await db.prepare('DELETE FROM reports WHERE id = ?').run(id);
  res.json({ ok: true });
});

router.get('/:id/xlsx', async (req, res) => {
  const row = await db.prepare('SELECT * FROM reports WHERE id = ?').get(Number(req.params.id));
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
        'Pendientes por cotizar': a.pendientes_por_cotizar,
        Reasignados: a.reasignados,
        '% Efectividad': a.efectividad_asesor,
        '% Cotizados/Asignados': a.cotizados_sobre_asignados,
        '% Reasignados': a.tasa_reasignados,
        'Prom. semanal sin cotizar': a.prom_semanal_sin_cotizar,
        '% Contacto': a.tasa_contacto,
        '% Cotización': a.tasa_cotizacion,
        '% Cierre': a.tasa_cierre,
        '% Cumplimiento SLA': a.sla_cumplimiento,
        'Horas promedio de cierre': a.tiempo_promedio_cierre_h,
        'Monto vendido': a.monto_vendido,
      }))
    );
    XLSX.utils.book_append_sheet(wb, sheet, 'Rendimiento por asesor');
  } else if (row.type === 'rentabilidad') {
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
    const crudoSheet = XLSX.utils.json_to_sheet([
      {
        Total_Leads_Crudos: data.crudo.total_leads,
        Total_Ventas: data.crudo.total_ventas,
        Ingresos: data.crudo.ingresos,
        Inversión: data.crudo.inversion,
        Costo_por_lead: data.crudo.costo_por_lead,
        Costo_por_venta: data.crudo.costo_por_venta,
        'ROI_%': data.crudo.roi_pct,
      },
    ]);
    XLSX.utils.book_append_sheet(wb, crudoSheet, 'Resumen Crudo (todo canal)');
  } else if (row.type === 'asesor') {
    const m = data.metrics || {};
    const resumenSheet = XLSX.utils.json_to_sheet([
      {
        Asesor: data.advisor.name,
        Rol: data.advisor.role,
        Periodo_Desde: data.from,
        Periodo_Hasta: data.to,
        Ranking_Equipo: m.rank,
        Tamaño_Equipo: data.team_size,
        Asignados: m.asignados,
        Contactados: m.contactados,
        Cotizados: m.cotizados,
        Vendidos: m.vendidos,
        Perdidos: m.perdidos,
        Pendientes_por_cotizar: m.pendientes_por_cotizar,
        Reasignados: m.reasignados,
        '% Efectividad': m.efectividad_asesor,
        '% Cotizados/Asignados': m.cotizados_sobre_asignados,
        '% Reasignados': m.tasa_reasignados,
        '% Contacto': m.tasa_contacto,
        '% Cotización': m.tasa_cotizacion,
        '% Cierre': m.tasa_cierre,
        '% Cumplimiento SLA': m.sla_cumplimiento,
        Horas_promedio_respuesta: data.velocidad_respuesta_horas,
        Horas_promedio_cierre: m.tiempo_promedio_cierre_h,
        Monto_vendido: m.monto_vendido,
        '% Cierre_equipo_(promedio)': data.team_totals.tasa_cierre,
        'Monto_vendido_equipo_(total)': data.team_totals.monto_vendido,
      },
    ]);
    XLSX.utils.book_append_sheet(wb, resumenSheet, 'Resumen');

    const prodSheet = XLSX.utils.json_to_sheet(
      data.por_producto.map((p) => ({ Producto: p.producto, Leads: p.leads, Vendidos: p.ganados, '% Cierre': p.tasa_cierre, Monto: p.monto }))
    );
    XLSX.utils.book_append_sheet(wb, prodSheet, 'Por producto');

    const canalSheet = XLSX.utils.json_to_sheet(
      data.por_canal.map((c) => ({ Canal: c.canal, Leads: c.leads, Vendidos: c.ganados, '% Conversión': c.tasa_conversion }))
    );
    XLSX.utils.book_append_sheet(wb, canalSheet, 'Por canal');

    const tendSheet = XLSX.utils.json_to_sheet(
      data.tendencia_mensual.map((t) => ({ Mes: t.mes, Asignados: t.asignados, Vendidos: t.vendidos, Monto: t.monto }))
    );
    XLSX.utils.book_append_sheet(wb, tendSheet, 'Tendencia mensual');

    const reasigSheet = XLSX.utils.json_to_sheet(
      data.reasignaciones_detalle.length
        ? data.reasignaciones_detalle.map((r) => ({ Fecha: r.at, Cliente: r.client_name, Motivo: r.reason, Nuevo_asesor: r.to_advisor_name }))
        : [{ Fecha: '', Cliente: 'Sin reasignaciones en el periodo', Motivo: '', Nuevo_asesor: '' }]
    );
    XLSX.utils.book_append_sheet(wb, reasigSheet, 'Reasignaciones');
  }

  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const stamp = row.generated_at.replace(/[:\s]/g, '-');
  res.setHeader('Content-Disposition', `attachment; filename="reporte-${row.type}-${stamp}.xlsx"`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buffer);
});

module.exports = router;
