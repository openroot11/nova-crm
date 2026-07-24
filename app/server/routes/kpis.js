const express = require('express');
const { db } = require('../db');
const sla = require('../sla');

const router = express.Router();

function monthPrefix(offsetMonths = 0) {
  const d = new Date();
  d.setMonth(d.getMonth() + offsetMonths, 1);
  return d.toISOString().slice(0, 7); // YYYY-MM
}

router.get('/', (req, res) => {
  const thisMonth = monthPrefix(0);
  const prevMonth = monthPrefix(-1);

  const allLeads = db.prepare('SELECT * FROM leads').all();
  const allAdvisors = db.prepare('SELECT * FROM advisors WHERE is_group = 0 ORDER BY priority_order ASC').all();
  const advisors = allAdvisors.filter((a) => a.active);

  const wonThisMonth = allLeads.filter((l) => l.status === 'cerrado_ganado' && l.closed_at && l.closed_at.startsWith(thisMonth));
  const wonPrevMonth = allLeads.filter((l) => l.status === 'cerrado_ganado' && l.closed_at && l.closed_at.startsWith(prevMonth));
  const totalSalesMonth = wonThisMonth.reduce((sum, l) => sum + (l.amount || 0), 0);
  const totalSalesPrevMonth = wonPrevMonth.reduce((sum, l) => sum + (l.amount || 0), 0);
  const salesGrowthPct = totalSalesPrevMonth > 0
    ? Math.round(((totalSalesMonth - totalSalesPrevMonth) / totalSalesPrevMonth) * 1000) / 10
    : (totalSalesMonth > 0 ? 100 : 0);

  const leadsThisMonth = allLeads.filter((l) => l.created_at.startsWith(thisMonth));
  const contactedWithinSla = leadsThisMonth.filter((l) => {
    if (!l.contacted_at) return false;
    const hours = sla.hoursBetween(l.created_at, sla.parseUtc(l.contacted_at));
    return hours <= 2;
  });
  const slaContactRate = leadsThisMonth.length
    ? Math.round((contactedWithinSla.length / leadsThisMonth.length) * 1000) / 10
    : 100;

  const openLeads = allLeads.filter((l) => ['asignado', 'contactado', 'cotizado'].includes(l.status));
  const criticalLeads = openLeads.filter((l) => sla.slaStatus(l) === 'vencido');
  const criticalAdvisorNames = [
    ...new Set(
      criticalLeads
        .map((l) => allAdvisors.find((a) => a.id === l.assigned_advisor_id))
        .filter(Boolean)
        .map((a) => a.name)
    ),
  ];

  const salesByAdvisor = advisors.map((advisor) => {
    const won = allLeads.filter((l) => l.assigned_advisor_id === advisor.id && l.status === 'cerrado_ganado');
    const thisMonthTotal = won.filter((l) => l.closed_at && l.closed_at.startsWith(thisMonth)).reduce((s, l) => s + (l.amount || 0), 0);
    const prevMonthTotal = won.filter((l) => l.closed_at && l.closed_at.startsWith(prevMonth)).reduce((s, l) => s + (l.amount || 0), 0);
    return { advisor_id: advisor.id, name: advisor.name, this_month: thisMonthTotal, prev_month: prevMonthTotal };
  });

  const statusLabels = {
    asignado: 'Asignado',
    contactado: 'Contactado',
    cotizado: 'Cotizado',
    cerrado_ganado: 'Cerrado Ganado',
    cerrado_perdido: 'Perdido',
  };
  const distribution = {};
  for (const key of Object.keys(statusLabels)) distribution[key] = 0;
  for (const lead of allLeads) distribution[lead.status] = (distribution[lead.status] || 0) + 1;

  res.json({
    total_sales_month: totalSalesMonth,
    total_sales_growth_pct: salesGrowthPct,
    sla_contact_rate: slaContactRate,
    sla_contact_sample: leadsThisMonth.length,
    critical_leads_count: criticalLeads.length,
    critical_leads_advisors: criticalAdvisorNames,
    sales_by_advisor: salesByAdvisor,
    lead_status_distribution: Object.entries(distribution).map(([key, count]) => ({
      status: key,
      label: statusLabels[key],
      count,
    })),
    total_leads: allLeads.length,
  });
});

function monthRangeDefaults() {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
  return { from, to };
}

function pct(numerator, denominator) {
  if (!denominator) return 0;
  return Math.round((numerator / denominator) * 1000) / 10;
}

/**
 * GET /api/kpis/funnel?from=YYYY-MM-DD&to=YYYY-MM-DD&advisor_id=1
 * Comparativo asignado -> contactado -> cotizado -> vendido/perdido por
 * asesor, en un rango de fechas (por defecto el mes calendario actual).
 */
router.get('/funnel', (req, res) => {
  const defaults = monthRangeDefaults();
  const from = req.query.from || defaults.from;
  const to = req.query.to || defaults.to;
  const fromTs = `${from} 00:00:00`;
  const toTs = `${to} 23:59:59`;

  let advisors = db.prepare('SELECT * FROM advisors WHERE is_group = 0 AND active = 1 ORDER BY priority_order ASC').all();
  if (req.query.advisor_id) {
    // Si se pide explicitamente un asesor puntual, se respeta aunque este
    // pausado (p.ej. para revisar el historico de alguien que ya no esta activo).
    advisors = db.prepare('SELECT * FROM advisors WHERE id = ?').all(Number(req.query.advisor_id));
  }

  const asignadosStmt = db.prepare(
    'SELECT COUNT(*) AS c FROM leads WHERE assigned_advisor_id = ? AND created_at >= ? AND created_at <= ?'
  );
  const contactadosStmt = db.prepare(
    'SELECT COUNT(*) AS c FROM leads WHERE assigned_advisor_id = ? AND contacted_at IS NOT NULL AND contacted_at >= ? AND contacted_at <= ?'
  );
  const cotizadosStmt = db.prepare(
    'SELECT COUNT(*) AS c FROM leads WHERE assigned_advisor_id = ? AND quoted_at IS NOT NULL AND quoted_at >= ? AND quoted_at <= ?'
  );
  const vendidosStmt = db.prepare(
    "SELECT COUNT(*) AS c, COALESCE(SUM(amount), 0) AS monto FROM leads WHERE assigned_advisor_id = ? AND status = 'cerrado_ganado' AND closed_at >= ? AND closed_at <= ?"
  );
  const perdidosStmt = db.prepare(
    "SELECT COUNT(*) AS c FROM leads WHERE assigned_advisor_id = ? AND status = 'cerrado_perdido' AND closed_at >= ? AND closed_at <= ?"
  );

  const rows = advisors.map((advisor) => {
    const asignados = asignadosStmt.get(advisor.id, fromTs, toTs).c;
    const contactados = contactadosStmt.get(advisor.id, fromTs, toTs).c;
    const cotizados = cotizadosStmt.get(advisor.id, fromTs, toTs).c;
    const vendidoRow = vendidosStmt.get(advisor.id, fromTs, toTs);
    const vendidos = vendidoRow.c;
    const monto_vendido = vendidoRow.monto;
    const perdidos = perdidosStmt.get(advisor.id, fromTs, toTs).c;

    return {
      advisor_id: advisor.id,
      name: advisor.name,
      asignados,
      contactados,
      cotizados,
      vendidos,
      perdidos,
      monto_vendido,
      tasa_contacto: pct(contactados, asignados),
      tasa_cotizacion: pct(cotizados, contactados),
      tasa_cierre: pct(vendidos, cotizados),
    };
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

  res.json({ from, to, advisors: rows, totals });
});

module.exports = router;
