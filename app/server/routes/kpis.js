const express = require('express');
const { db } = require('../db');
const sla = require('../sla');
const reporting = require('../reporting');

const router = express.Router();

function monthPrefix(offsetMonths = 0) {
  const d = new Date();
  d.setMonth(d.getMonth() + offsetMonths, 1);
  return d.toISOString().slice(0, 7); // YYYY-MM
}

router.get('/', async (req, res) => {
  const thisMonth = monthPrefix(0);
  const prevMonth = monthPrefix(-1);

  const allLeads = await db.prepare('SELECT * FROM leads').all();
  const allAdvisors = await db.prepare('SELECT * FROM advisors WHERE is_group = false ORDER BY priority_order ASC').all();
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

  const targetRow = await db.prepare("SELECT value FROM settings WHERE key = 'monthly_sales_target'").get();

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
    monthly_trend: await reporting.computeMonthlyTrend(6),
    monthly_sales_target: targetRow ? Number(targetRow.value) : null,
  });
});

/**
 * GET /api/kpis/funnel?from=YYYY-MM-DD&to=YYYY-MM-DD&advisor_id=1
 * Comparativo asignado -> contactado -> cotizado -> vendido/perdido por
 * asesor, en un rango de fechas (por defecto el mes calendario actual), con
 * cumplimiento de SLA, tiempo promedio de cierre y ranking por monto vendido.
 */
router.get('/funnel', async (req, res) => {
  const report = await reporting.computeFunnelReport(req.query.from, req.query.to, req.query.advisor_id);
  res.json(report);
});

/**
 * GET /api/kpis/profitability?from=YYYY-MM-DD&to=YYYY-MM-DD
 * Rentabilidad de leads por canal/origen contra la inversion de Google Ads
 * registrada en Ajustes -> Inversión Publicitaria (ver routes/marketing.js).
 */
router.get('/profitability', async (req, res) => {
  const report = await reporting.computeProfitabilityReport(req.query.from, req.query.to);
  res.json(report);
});

/**
 * GET /api/kpis/advisor/:id?from=YYYY-MM-DD&to=YYYY-MM-DD
 * Ficha individual de un asesor: metricas propias, comparativo con el
 * equipo, desglose por producto/canal, velocidad de respuesta, seguimiento
 * y tendencia mensual. Pensado para generar un reporte entregable por persona.
 */
router.get('/advisor/:id', async (req, res) => {
  const report = await reporting.computeAdvisorReport(req.params.id, req.query.from, req.query.to);
  if (!report) return res.status(404).json({ error: 'Asesor no encontrado' });
  res.json(report);
});

/**
 * GET /api/kpis/geo?from=YYYY-MM-DD&to=YYYY-MM-DD
 * Leads por ciudad en el rango, con el producto que mas se vende en cada
 * una -- para el mapa de Colombia del Dashboard.
 */
router.get('/geo', async (req, res) => {
  const report = await reporting.computeGeoReport(req.query.from, req.query.to);
  res.json(report);
});

/**
 * GET /api/kpis/flow?from=YYYY-MM-DD&to=YYYY-MM-DD
 * Flujo canal -> producto -> resultado en el rango, para el diagrama
 * "Flujo de Leads" de Estadisticas (junto a Rentabilidad de Leads).
 */
router.get('/flow', async (req, res) => {
  const report = await reporting.computeChannelProductFlow(req.query.from, req.query.to);
  res.json(report);
});

/**
 * GET /api/kpis/daily-trend?from=YYYY-MM-DD&to=YYYY-MM-DD
 * Ventas cerradas dia por dia en el rango (por defecto ultimos 30 dias),
 * para la grafica de tendencia de "Ventas Cerradas".
 */
router.get('/daily-trend', async (req, res) => {
  const report = await reporting.computeDailySalesTrend(req.query.from, req.query.to);
  res.json(report);
});

router.get('/forecast', async (req, res) => {
  const report = await reporting.computeForecast(req.query.horizon, req.query.interval);
  res.json(report);
});

module.exports = router;
