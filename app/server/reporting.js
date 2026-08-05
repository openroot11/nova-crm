const { db } = require('./db');
const sla = require('./sla');

function pct(numerator, denominator) {
  if (!denominator) return 0;
  return Math.round((numerator / denominator) * 1000) / 10;
}

function monthRangeDefaults() {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
  return { from, to };
}

/**
 * Reporte de rendimiento por asesor: embudo, tasas de conversion, cumplimiento
 * de SLA y tiempo promedio de cierre, con ranking por monto vendido. Es el
 * reporte que reemplaza la comparacion manual que se armaba en la carpeta de
 * estadisticas.
 */
function computeFunnelReport(fromInput, toInput, advisorIdFilter) {
  const defaults = monthRangeDefaults();
  const from = fromInput || defaults.from;
  const to = toInput || defaults.to;
  const fromTs = `${from} 00:00:00`;
  const toTs = `${to} 23:59:59`;

  let advisors = db.prepare('SELECT * FROM advisors WHERE is_group = 0 AND active = 1 ORDER BY priority_order ASC').all();
  if (advisorIdFilter) {
    advisors = db.prepare('SELECT * FROM advisors WHERE id = ?').all(Number(advisorIdFilter));
  }

  // Cada metrica se cuenta contra SU PROPIA fecha (cuando paso, no cuando se
  // creo el lead) - asi un lead creado el mes pasado pero cotizado este mes
  // cuenta como "cotizado" de este mes. Es el mismo criterio que ya usaba
  // este reporte antes de sumarle SLA/tiempo de cierre/ranking.
  const asignadosStmt = db.prepare('SELECT * FROM leads WHERE assigned_advisor_id = ? AND created_at >= ? AND created_at <= ?');
  const contactadosStmt = db.prepare(
    'SELECT COUNT(*) AS c FROM leads WHERE assigned_advisor_id = ? AND contacted_at IS NOT NULL AND contacted_at >= ? AND contacted_at <= ?'
  );
  const cotizadosStmt = db.prepare(
    'SELECT COUNT(*) AS c FROM leads WHERE assigned_advisor_id = ? AND quoted_at IS NOT NULL AND quoted_at >= ? AND quoted_at <= ?'
  );
  const vendidosStmt = db.prepare(
    "SELECT * FROM leads WHERE assigned_advisor_id = ? AND status = 'cerrado_ganado' AND closed_at >= ? AND closed_at <= ?"
  );
  const perdidosStmt = db.prepare(
    "SELECT COUNT(*) AS c FROM leads WHERE assigned_advisor_id = ? AND status = 'cerrado_perdido' AND closed_at >= ? AND closed_at <= ?"
  );

  const rows = advisors.map((advisor) => {
    const asignadosLeads = asignadosStmt.all(advisor.id, fromTs, toTs);
    const asignados = asignadosLeads.length;
    const contactados = contactadosStmt.get(advisor.id, fromTs, toTs).c;
    const cotizados = cotizadosStmt.get(advisor.id, fromTs, toTs).c;
    const ganados = vendidosStmt.all(advisor.id, fromTs, toTs);
    const monto_vendido = ganados.reduce((s, l) => s + (l.amount || 0), 0);
    const perdidos = perdidosStmt.get(advisor.id, fromTs, toTs).c;

    const slaOk = asignadosLeads.filter((l) => sla.slaStatus(l) !== 'vencido').length;
    const sla_cumplimiento = pct(slaOk, asignados);

    const closeHours = ganados
      .filter((l) => l.closed_at)
      .map((l) => sla.hoursBetween(l.created_at, sla.parseUtc(l.closed_at)));
    const tiempo_promedio_cierre_h = closeHours.length
      ? Math.round((closeHours.reduce((s, h) => s + h, 0) / closeHours.length) * 10) / 10
      : null;

    return {
      advisor_id: advisor.id,
      name: advisor.name,
      asignados,
      contactados,
      cotizados,
      vendidos: ganados.length,
      perdidos,
      monto_vendido,
      tasa_contacto: pct(contactados, asignados),
      tasa_cotizacion: pct(cotizados, contactados),
      tasa_cierre: pct(ganados.length, cotizados),
      sla_cumplimiento,
      tiempo_promedio_cierre_h,
    };
  });

  // Ranking por monto vendido (el criterio que de verdad le importa al
  // dueño al comparar el equipo); en empate, por tasa de cierre.
  const ranked = [...rows].sort((a, b) => b.monto_vendido - a.monto_vendido || b.tasa_cierre - a.tasa_cierre);
  const rankById = new Map(ranked.map((r, idx) => [r.advisor_id, idx + 1]));
  rows.forEach((r) => {
    r.rank = rankById.get(r.advisor_id);
  });

  const totals = rows.reduce(
    (acc, r) => {
      acc.asignados += r.asignados;
      acc.contactados += r.contactados;
      acc.cotizados += r.cotizados;
      acc.vendidos += r.vendidos;
      acc.perdidos += r.perdidos;
      acc.monto_vendido += r.monto_vendido;
      return acc;
    },
    { advisor_id: null, name: 'Total', asignados: 0, contactados: 0, cotizados: 0, vendidos: 0, perdidos: 0, monto_vendido: 0 }
  );
  totals.tasa_contacto = pct(totals.contactados, totals.asignados);
  totals.tasa_cotizacion = pct(totals.cotizados, totals.contactados);
  totals.tasa_cierre = pct(totals.vendidos, totals.cotizados);

  return { from, to, advisors: rows, totals };
}

/**
 * Reporte de rentabilidad de leads: leads por canal/origen, tasa de
 * conversion, y contra la inversion de Google Ads registrada en el rango
 * (ad_spend), costo por lead / costo por venta / ROI. Los canales sin
 * inversion registrada (organico, referido, otro) muestran solo volumen y
 * conversion, sin costo (no aplica).
 */
function computeProfitabilityReport(fromInput, toInput) {
  const defaults = monthRangeDefaults();
  const from = fromInput || defaults.from;
  const to = toInput || defaults.to;
  const fromTs = `${from} 00:00:00`;
  const toTs = `${to} 23:59:59`;

  const leads = db.prepare('SELECT * FROM leads WHERE created_at >= ? AND created_at <= ?').all(fromTs, toTs);

  const byChannel = new Map();
  for (const lead of leads) {
    const key = lead.channel_detail || 'Sin origen';
    if (!byChannel.has(key)) byChannel.set(key, { channel: key, leads: 0, ganados: 0, ingresos: 0 });
    const bucket = byChannel.get(key);
    bucket.leads += 1;
    if (lead.status === 'cerrado_ganado') {
      bucket.ganados += 1;
      bucket.ingresos += lead.amount || 0;
    }
  }

  // Inversion en el rango: suma de los meses (YYYY-MM) que el rango de
  // fechas toca. Se guarda por mes porque asi es como llega la factura de
  // Google Ads.
  const fromMonth = from.slice(0, 7);
  const toMonth = to.slice(0, 7);
  const spendRows = db
    .prepare('SELECT month, amount FROM ad_spend WHERE month >= ? AND month <= ? ORDER BY month ASC')
    .all(fromMonth, toMonth);
  const totalSpend = spendRows.reduce((s, r) => s + r.amount, 0);

  const channels = [...byChannel.values()]
    .map((c) => ({
      ...c,
      tasa_conversion: pct(c.ganados, c.leads),
    }))
    .sort((a, b) => b.leads - a.leads);

  const googleAds = channels.find((c) => c.channel === 'Google Ads') || { leads: 0, ganados: 0, ingresos: 0 };
  const costo_por_lead = googleAds.leads ? Math.round((totalSpend / googleAds.leads) * 100) / 100 : null;
  const costo_por_venta = googleAds.ganados ? Math.round((totalSpend / googleAds.ganados) * 100) / 100 : null;
  const roi_pct = totalSpend ? Math.round(((googleAds.ingresos - totalSpend) / totalSpend) * 1000) / 10 : null;

  return {
    from,
    to,
    channels,
    google_ads: {
      leads: googleAds.leads,
      ganados: googleAds.ganados,
      ingresos: googleAds.ingresos,
      inversion: totalSpend,
      costo_por_lead,
      costo_por_venta,
      roi_pct,
    },
    spend_by_month: spendRows,
  };
}

module.exports = { computeFunnelReport, computeProfitabilityReport, monthRangeDefaults, pct };
