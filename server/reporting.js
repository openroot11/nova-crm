const { db } = require('./db');
const sla = require('./sla');
const holidays = require('./holidays');

// Todo lo que se calcula aqui alimenta pantallas del programa (Estadisticas,
// Dashboard, Informe archivado) -- lee de "leads_visible" (solo Google Ads,
// ver db.js) en vez de "leads" directo, para que el lote historico
// importado de Odoo (y cualquier lead futuro que no sea de Ads) no infle
// estos numeros. La ficha de un cliente puntual (routes/clients.js) sigue
// usando "leads" sin filtrar, a proposito.

function pct(numerator, denominator) {
  if (!denominator) return 0;
  return Math.round((numerator / denominator) * 1000) / 10;
}

// Igual que pct() pero con 2 decimales -- para las cifras del embudo y del
// "% que representa la inversión sobre las ventas", que el reporte de
// gerencia muestra con 2 decimales (26,70% / 21,42% / 11,43%).
function pct2(numerator, denominator) {
  if (!denominator) return 0;
  return Math.round((numerator / denominator) * 10000) / 100;
}

const round1 = (n) => Math.round(n * 10) / 10;

function monthRangeDefaults() {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
  return { from, to };
}

// Promedio semanal de leads que llevan sin cotizar (creados en esa semana,
// sin quoted_at, y sin cerrar) dentro del rango. Se parte el rango en
// bloques de 7 dias desde "from" y se promedia el conteo entre esos
// bloques. advisorId null = agregado de todo el equipo.
async function computeWeeklyPendingAvg(from, to, advisorId) {
  const fromD = new Date(`${from}T00:00:00Z`);
  const toD = new Date(`${to}T00:00:00Z`);
  const totalDays = Math.max(1, Math.round((toD - fromD) / 86400000) + 1);
  const weeks = Math.max(1, Math.ceil(totalDays / 7));
  const stmt = advisorId
    ? db.prepare("SELECT COUNT(*) AS c FROM leads_visible WHERE assigned_advisor_id = ? AND created_at >= ? AND created_at <= ? AND quoted_at IS NULL AND status NOT LIKE 'cerrado%'")
    : db.prepare("SELECT COUNT(*) AS c FROM leads_visible WHERE created_at >= ? AND created_at <= ? AND quoted_at IS NULL AND status NOT LIKE 'cerrado%'");

  let sum = 0;
  for (let w = 0; w < weeks; w++) {
    const weekStart = new Date(fromD.getTime() + w * 7 * 86400000);
    const weekEndCandidate = new Date(weekStart.getTime() + 6 * 86400000);
    const weekEnd = weekEndCandidate > toD ? toD : weekEndCandidate;
    const wf = `${weekStart.toISOString().slice(0, 10)} 00:00:00`;
    const wt = `${weekEnd.toISOString().slice(0, 10)} 23:59:59`;
    const row = advisorId ? await stmt.get(advisorId, wf, wt) : await stmt.get(wf, wt);
    sum += row.c;
  }
  return Math.round((sum / weeks) * 10) / 10;
}

/**
 * Reporte de rendimiento por asesor: embudo, tasas de conversion, cumplimiento
 * de SLA y tiempo promedio de cierre, con ranking por monto vendido. Es el
 * reporte que reemplaza la comparacion manual que se armaba en la carpeta de
 * estadisticas.
 */
async function computeFunnelReport(fromInput, toInput, advisorIdFilter) {
  const defaults = monthRangeDefaults();
  const from = fromInput || defaults.from;
  const to = toInput || defaults.to;
  const fromTs = `${from} 00:00:00`;
  const toTs = `${to} 23:59:59`;

  let advisors = await db.prepare('SELECT * FROM advisors WHERE is_group = false AND active = true ORDER BY priority_order ASC').all();
  if (advisorIdFilter) {
    advisors = await db.prepare('SELECT * FROM advisors WHERE id = ?').all(Number(advisorIdFilter));
  }

  // Cada metrica se cuenta contra SU PROPIA fecha (cuando paso, no cuando se
  // creo el lead) - asi un lead creado el mes pasado pero cotizado este mes
  // cuenta como "cotizado" de este mes. Es el mismo criterio que ya usaba
  // este reporte antes de sumarle SLA/tiempo de cierre/ranking.
  const asignadosStmt = db.prepare('SELECT * FROM leads_visible WHERE assigned_advisor_id = ? AND created_at >= ? AND created_at <= ?');
  const contactadosStmt = db.prepare(
    'SELECT COUNT(*) AS c FROM leads_visible WHERE assigned_advisor_id = ? AND contacted_at IS NOT NULL AND contacted_at >= ? AND contacted_at <= ?'
  );
  const cotizadosStmt = db.prepare(
    'SELECT COUNT(*) AS c FROM leads_visible WHERE assigned_advisor_id = ? AND quoted_at IS NOT NULL AND quoted_at >= ? AND quoted_at <= ?'
  );
  const vendidosStmt = db.prepare(
    "SELECT * FROM leads_visible WHERE assigned_advisor_id = ? AND status = 'cerrado_ganado' AND closed_at >= ? AND closed_at <= ?"
  );
  const perdidosStmt = db.prepare(
    "SELECT COUNT(*) AS c FROM leads_visible WHERE assigned_advisor_id = ? AND status = 'cerrado_perdido' AND closed_at >= ? AND closed_at <= ?"
  );
  const pendientesStmt = db.prepare(
    "SELECT COUNT(*) AS c FROM leads_visible WHERE assigned_advisor_id = ? AND created_at >= ? AND created_at <= ? AND quoted_at IS NULL AND status NOT LIKE 'cerrado%'"
  );
  const reasignadosStmt = db.prepare('SELECT COUNT(*) AS c FROM reassignments WHERE from_advisor_id = ? AND at >= ? AND at <= ?');

  const rows = await Promise.all(
    advisors.map(async (advisor) => {
      const asignadosLeads = await asignadosStmt.all(advisor.id, fromTs, toTs);
      const asignados = asignadosLeads.length;
      const contactados = (await contactadosStmt.get(advisor.id, fromTs, toTs)).c;
      const cotizados = (await cotizadosStmt.get(advisor.id, fromTs, toTs)).c;
      const ganados = await vendidosStmt.all(advisor.id, fromTs, toTs);
      const monto_vendido = ganados.reduce((s, l) => s + (l.amount || 0), 0);
      const perdidos = (await perdidosStmt.get(advisor.id, fromTs, toTs)).c;
      const pendientes_por_cotizar = (await pendientesStmt.get(advisor.id, fromTs, toTs)).c;
      const reasignados = (await reasignadosStmt.get(advisor.id, fromTs, toTs)).c;

      const slaOk = asignadosLeads.filter((l) => sla.firstContactSlaMet(l)).length;
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
        pendientes_por_cotizar,
        reasignados,
        monto_vendido,
        tasa_contacto: pct(contactados, asignados),
        tasa_cotizacion: pct(cotizados, contactados),
        // Indicadores fijos del tablero (mismas etiquetas que el reporte
        // original en Bolt): efectividad y cotizados van sobre "asignados",
        // no sobre "contactados" - son numeros distintos a proposito.
        efectividad_asesor: pct(ganados.length, asignados),
        cotizados_sobre_asignados: pct(cotizados, asignados),
        tasa_reasignados: pct(reasignados, asignados),
        prom_semanal_sin_cotizar: await computeWeeklyPendingAvg(from, to, advisor.id),
        tasa_cierre: pct(ganados.length, cotizados),
        sla_cumplimiento,
        tiempo_promedio_cierre_h,
      };
    })
  );

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
      acc.pendientes_por_cotizar += r.pendientes_por_cotizar;
      acc.reasignados += r.reasignados;
      acc.monto_vendido += r.monto_vendido;
      return acc;
    },
    {
      advisor_id: null,
      name: 'Total',
      asignados: 0,
      contactados: 0,
      cotizados: 0,
      vendidos: 0,
      perdidos: 0,
      pendientes_por_cotizar: 0,
      reasignados: 0,
      monto_vendido: 0,
    }
  );
  totals.tasa_contacto = pct(totals.contactados, totals.asignados);
  totals.tasa_cotizacion = pct(totals.cotizados, totals.contactados);
  totals.efectividad_asesor = pct(totals.vendidos, totals.asignados);
  totals.cotizados_sobre_asignados = pct(totals.cotizados, totals.asignados);
  totals.tasa_reasignados = pct(totals.reasignados, totals.asignados);
  totals.prom_semanal_sin_cotizar = await computeWeeklyPendingAvg(from, to, null);
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
async function computeProfitabilityReport(fromInput, toInput) {
  const defaults = monthRangeDefaults();
  const from = fromInput || defaults.from;
  const to = toInput || defaults.to;
  const fromTs = `${from} 00:00:00`;
  const toTs = `${to} 23:59:59`;

  const leads = await db.prepare('SELECT * FROM leads_visible WHERE created_at >= ? AND created_at <= ?').all(fromTs, toTs);

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
  const spendRows = await db
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

  // Version "cruda", igual al reporte original en Bolt: la inversion se
  // divide entre TODOS los mensajes/llamadas del periodo (informe_canales,
  // lo que se anota a mano en Informe), no solo los de Google Ads. Mide
  // "que tan caro me sale cada contacto que llega al negocio", distinto de
  // costo_por_lead (que mide especificamente el canal pagado).
  const rawLeadsRow = await db
    .prepare('SELECT COALESCE(SUM(whatsapp + correo + llamadas), 0) AS c FROM informe_canales WHERE fecha >= ? AND fecha <= ?')
    .get(from, to);
  const rawLeadsTotal = rawLeadsRow.c;
  const totalVentasRow = await db
    .prepare("SELECT COUNT(*) AS c, COALESCE(SUM(amount), 0) AS ingresos FROM leads_visible WHERE status = 'cerrado_ganado' AND closed_at >= ? AND closed_at <= ?")
    .get(fromTs, toTs);
  const costo_por_lead_crudo = rawLeadsTotal ? Math.round((totalSpend / rawLeadsTotal) * 100) / 100 : null;
  const costo_por_venta_crudo = totalVentasRow.c ? Math.round((totalSpend / totalVentasRow.c) * 100) / 100 : null;
  const roi_crudo_pct = totalSpend ? Math.round(((totalVentasRow.ingresos - totalSpend) / totalSpend) * 1000) / 10 : null;

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
    crudo: {
      total_leads: rawLeadsTotal,
      total_ventas: totalVentasRow.c,
      ingresos: totalVentasRow.ingresos,
      inversion: totalSpend,
      costo_por_lead: costo_por_lead_crudo,
      costo_por_venta: costo_por_venta_crudo,
      roi_pct: roi_crudo_pct,
    },
    spend_by_month: spendRows,
  };
}

/**
 * Ficha individual de un asesor: todo lo del comparativo de equipo (para dar
 * contexto: ranking, promedio del equipo) mas el detalle propio de esa
 * persona - por producto, por canal, velocidad de respuesta real, cuanto
 * insiste en sus cotizaciones, el detalle de sus reasignaciones (no solo el
 * numero) y su tendencia mes a mes. Es el reporte pensado para entregarse
 * a un asesor puntual, no para comparar al equipo.
 */
async function computeAdvisorReport(advisorId, fromInput, toInput) {
  const advisor = await db.prepare('SELECT * FROM advisors WHERE id = ?').get(Number(advisorId));
  if (!advisor) return null;

  const team = await computeFunnelReport(fromInput, toInput);
  const own = team.advisors.find((a) => a.advisor_id === advisor.id);
  const from = team.from;
  const to = team.to;
  const fromTs = `${from} 00:00:00`;
  const toTs = `${to} 23:59:59`;

  // Propio: leads asignados a esta persona en el rango (mismo criterio de
  // "asignados" que el resto de los reportes).
  const ownLeads = await db
    .prepare('SELECT * FROM leads_visible WHERE assigned_advisor_id = ? AND created_at >= ? AND created_at <= ?')
    .all(advisor.id, fromTs, toTs);

  const porProducto = new Map();
  const porCanal = new Map();
  for (const lead of ownLeads) {
    const prod = lead.product || 'Sin producto';
    if (!porProducto.has(prod)) porProducto.set(prod, { producto: prod, leads: 0, ganados: 0, monto: 0 });
    const pBucket = porProducto.get(prod);
    pBucket.leads += 1;
    if (lead.status === 'cerrado_ganado') {
      pBucket.ganados += 1;
      pBucket.monto += lead.amount || 0;
    }

    const canal = lead.channel_detail || 'Sin origen';
    if (!porCanal.has(canal)) porCanal.set(canal, { canal, leads: 0, ganados: 0 });
    const cBucket = porCanal.get(canal);
    cBucket.leads += 1;
    if (lead.status === 'cerrado_ganado') cBucket.ganados += 1;
  }
  const por_producto = [...porProducto.values()]
    .map((p) => ({ ...p, tasa_cierre: pct(p.ganados, p.leads) }))
    .sort((a, b) => b.leads - a.leads);
  const por_canal = [...porCanal.values()]
    .map((c) => ({ ...c, tasa_conversion: pct(c.ganados, c.leads) }))
    .sort((a, b) => b.leads - a.leads);

  // Velocidad de respuesta real: horas promedio hasta el primer contacto
  // (distinto de "tiempo promedio de cierre", que ya se reporta en el
  // comparativo de equipo).
  const contactedLeads = ownLeads.filter((l) => l.contacted_at);
  const responseHours = contactedLeads.map((l) => sla.hoursBetween(l.created_at, sla.parseUtc(l.contacted_at)));
  const velocidad_respuesta_horas = responseHours.length
    ? Math.round((responseHours.reduce((s, h) => s + h, 0) / responseHours.length) * 10) / 10
    : null;

  // Seguimiento: de los leads que llegaron a cotizarse, cuanto insistio (y
  // cuantos se le quedaron enfriando sin ningun seguimiento).
  const quotedLeads = ownLeads.filter((l) => l.quoted_at);
  const seguimiento = {
    cotizados: quotedLeads.length,
    con_seguimiento: quotedLeads.filter((l) => l.followup_count > 0).length,
    sin_ningun_seguimiento: quotedLeads.filter((l) => l.followup_count === 0 && !l.status.startsWith('cerrado')).length,
    total_intentos: quotedLeads.reduce((s, l) => s + (l.followup_count || 0), 0),
  };

  const reasignaciones_detalle = await db
    .prepare(
      `SELECT r.at, r.reason, l.client_name, ta.name AS to_advisor_name
       FROM reassignments r
       JOIN leads l ON l.id = r.lead_id
       LEFT JOIN advisors ta ON ta.id = r.to_advisor_id
       WHERE r.from_advisor_id = ? AND r.at >= ? AND r.at <= ?
       ORDER BY r.at DESC`
    )
    .all(advisor.id, fromTs, toTs);

  // Tendencia: los ultimos 6 meses calendario hasta el mes de "to" (o menos
  // si el asesor no lleva tanto tiempo), para ver si mejora o empeora.
  const toDate = new Date(`${to}T00:00:00Z`);
  const tendencia_mensual = [];
  for (let i = 5; i >= 0; i--) {
    const monthDate = new Date(Date.UTC(toDate.getUTCFullYear(), toDate.getUTCMonth() - i, 1));
    const monthStart = monthDate.toISOString().slice(0, 10);
    const monthEndDate = new Date(Date.UTC(monthDate.getUTCFullYear(), monthDate.getUTCMonth() + 1, 0));
    const monthEnd = monthEndDate.toISOString().slice(0, 10);
    const row = await db
      .prepare(
        "SELECT COUNT(*) AS asignados, SUM(CASE WHEN status = 'cerrado_ganado' THEN 1 ELSE 0 END) AS vendidos, COALESCE(SUM(CASE WHEN status = 'cerrado_ganado' THEN amount ELSE 0 END), 0) AS monto FROM leads_visible WHERE assigned_advisor_id = ? AND created_at >= ? AND created_at <= ?"
      )
      .get(advisor.id, `${monthStart} 00:00:00`, `${monthEnd} 23:59:59`);
    tendencia_mensual.push({
      mes: monthStart.slice(0, 7),
      asignados: row.asignados,
      vendidos: row.vendidos || 0,
      monto: row.monto,
    });
  }

  return {
    from,
    to,
    advisor: { id: advisor.id, name: advisor.name, role: advisor.role },
    metrics: own || null,
    team_totals: team.totals,
    team_size: team.advisors.length,
    por_producto,
    por_canal,
    velocidad_respuesta_horas,
    seguimiento,
    reasignaciones_detalle,
    tendencia_mensual,
  };
}

/**
 * Reporte geografico: leads por ciudad en el rango, con el producto que mas
 * se vende en cada una (para el mapa del Dashboard). Solo cuenta leads que
 * tienen ciudad registrada -- los que no, no aparecen en el mapa.
 */
async function computeGeoReport(fromInput, toInput) {
  const defaults = monthRangeDefaults();
  const from = fromInput || defaults.from;
  const to = toInput || defaults.to;
  const fromTs = `${from} 00:00:00`;
  const toTs = `${to} 23:59:59`;

  const leads = await db
    .prepare("SELECT city, product, status, amount FROM leads_visible WHERE city IS NOT NULL AND city != '' AND created_at >= ? AND created_at <= ?")
    .all(fromTs, toTs);

  const byCity = new Map();
  for (const lead of leads) {
    if (!byCity.has(lead.city)) byCity.set(lead.city, { city: lead.city, leads: 0, ganados: 0, monto: 0, productos: new Map() });
    const bucket = byCity.get(lead.city);
    bucket.leads += 1;
    if (lead.status === 'cerrado_ganado') {
      bucket.ganados += 1;
      bucket.monto += lead.amount || 0;
    }
    const prod = lead.product || 'Otro';
    const prodCount = bucket.productos.get(prod) || { producto: prod, leads: 0, ganados: 0 };
    prodCount.leads += 1;
    if (lead.status === 'cerrado_ganado') prodCount.ganados += 1;
    bucket.productos.set(prod, prodCount);
  }

  const cities = [...byCity.values()].map((b) => {
    // "Producto mas vendido": el de mas ganados; si nadie ha cerrado
    // todavia en esa ciudad, se usa el de mas leads como mejor estimado.
    const productos = [...b.productos.values()].sort((a, c) => c.ganados - a.ganados || c.leads - a.leads);
    return {
      city: b.city,
      leads: b.leads,
      ganados: b.ganados,
      monto: b.monto,
      tasa_conversion: pct(b.ganados, b.leads),
      producto_top: productos[0] ? productos[0].producto : null,
    };
  });
  cities.sort((a, b) => b.leads - a.leads);

  return { from, to, cities };
}

const OUTCOME_LABELS = { cerrado_ganado: 'Ganado', cerrado_perdido: 'Perdido', en_curso: 'En curso' };

/**
 * Flujo de leads canal -> producto -> resultado (para el diagrama "Flujo de
 * Leads" en Estadisticas, junto a Rentabilidad de Leads -- mismos campos que
 * ya agrupa computeProfitabilityReport por canal, pero cruzados tambien con
 * producto y resultado). Los IDs de nodo se prefijan (channel:/product:/
 * outcome:) porque "Otro" es un valor valido tanto en canal como en
 * producto y no deben colisionar en el mismo diagrama.
 */
async function computeChannelProductFlow(fromInput, toInput) {
  const defaults = monthRangeDefaults();
  const from = fromInput || defaults.from;
  const to = toInput || defaults.to;
  const fromTs = `${from} 00:00:00`;
  const toTs = `${to} 23:59:59`;

  const leads = await db
    .prepare('SELECT channel_detail, product, status FROM leads_visible WHERE created_at >= ? AND created_at <= ?')
    .all(fromTs, toTs);

  const labels = {};
  const links = new Map(); // key `${source}|${target}` -> value

  function addLink(source, target, sourceLabel, targetLabel) {
    labels[source] = sourceLabel;
    labels[target] = targetLabel;
    const key = `${source}|${target}`;
    links.set(key, (links.get(key) || 0) + 1);
  }

  for (const lead of leads) {
    const channel = lead.channel_detail || 'Sin origen';
    const product = lead.product || 'Otro';
    const outcomeKey = lead.status === 'cerrado_ganado' || lead.status === 'cerrado_perdido' ? lead.status : 'en_curso';

    const channelNode = `channel:${channel}`;
    const productNode = `product:${product}`;
    const outcomeNode = `outcome:${outcomeKey}`;

    addLink(channelNode, productNode, channel, product);
    addLink(productNode, outcomeNode, product, OUTCOME_LABELS[outcomeKey]);
  }

  return {
    from,
    to,
    links: [...links.entries()].map(([key, value]) => {
      const [source, target] = key.split('|');
      return { source, target, value };
    }),
    labels,
  };
}

/**
 * Tendencia mensual de ventas de todo el equipo (para el grafico "Sales
 * Performance" del Dashboard). Mismo patron de iteracion mensual que
 * tendencia_mensual en computeAdvisorReport, pero agregando todo el equipo
 * en vez de filtrar por un asesor.
 */
async function computeMonthlyTrend(months = 6) {
  const now = new Date();
  const trend = [];
  for (let i = months - 1; i >= 0; i--) {
    const monthDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const monthStart = monthDate.toISOString().slice(0, 10);
    const monthEndDate = new Date(Date.UTC(monthDate.getUTCFullYear(), monthDate.getUTCMonth() + 1, 0));
    const monthEnd = monthEndDate.toISOString().slice(0, 10);
    const row = await db
      .prepare(
        "SELECT COUNT(*) AS ventas_count, COALESCE(SUM(amount), 0) AS ventas_monto FROM leads_visible WHERE status = 'cerrado_ganado' AND closed_at >= ? AND closed_at <= ?"
      )
      .get(`${monthStart} 00:00:00`, `${monthEnd} 23:59:59`);
    trend.push({
      mes: monthStart.slice(0, 7),
      ventas_monto: row.ventas_monto,
      ventas_count: row.ventas_count,
    });
  }
  return trend;
}

/**
 * Ventas cerradas dia por dia dentro de un rango (por defecto, ultimos 30
 * dias) -- para la grafica de tendencia de la pestaña "Ventas Cerradas".
 * Zero-fill: los dias sin ventas igual aparecen en 0, para que la grafica no
 * tenga huecos.
 */
async function computeDailySalesTrend(fromInput, toInput, advisorIdFilter, channelDetailFilter) {
  const to = toInput || new Date().toISOString().slice(0, 10);
  const from = fromInput || (() => {
    const d = new Date(`${to}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 29);
    return d.toISOString().slice(0, 10);
  })();

  const conditions = [`status = 'cerrado_ganado'`, 'closed_at >= ?', 'closed_at <= ?'];
  const params = [`${from} 00:00:00`, `${to} 23:59:59`];
  if (advisorIdFilter) {
    conditions.push('assigned_advisor_id = ?');
    params.push(Number(advisorIdFilter));
  }
  if (channelDetailFilter) {
    conditions.push('channel_detail = ?');
    params.push(channelDetailFilter);
  }

  const rows = await db
    .prepare(
      `SELECT substr(closed_at, 1, 10) AS fecha, COUNT(*) AS ventas_count, COALESCE(SUM(amount), 0) AS ventas_monto
       FROM leads_visible
       WHERE ${conditions.join(' AND ')}
       GROUP BY fecha`
    )
    .all(...params);
  const byDate = new Map(rows.map((r) => [r.fecha, r]));

  const fromD = new Date(`${from}T00:00:00Z`);
  const toD = new Date(`${to}T00:00:00Z`);
  const totalDays = Math.max(1, Math.round((toD - fromD) / 86400000) + 1);

  const trend = [];
  for (let i = 0; i < totalDays; i++) {
    const day = new Date(fromD.getTime() + i * 86400000);
    const key = day.toISOString().slice(0, 10);
    const row = byDate.get(key);
    trend.push({
      fecha: key,
      ventas_monto: row ? row.ventas_monto : 0,
      ventas_count: row ? row.ventas_count : 0,
    });
  }
  return { from, to, trend };
}

async function computeForecast(horizonInput, intervalInput) {
  const horizon = Number(horizonInput) || 15;
  const interval = ['day', 'week', 'month'].includes(intervalInput) ? intervalInput : 'day';
  const allLeads = await db.prepare('SELECT created_at, status, amount, product FROM leads_visible').all();
  const today = new Date();
  const startDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const historyDays = 45;
  const historyStart = new Date(startDate.getTime() - (historyDays - 1) * 86400000);
  const dailyCounts = new Map();
  const dailyRevenues = new Map();
  const productBuckets = new Map();

  for (let i = 0; i < historyDays; i++) {
    const day = new Date(historyStart.getTime() + i * 86400000);
    const key = day.toISOString().slice(0, 10);
    dailyCounts.set(key, 0);
    dailyRevenues.set(key, 0);
  }

  for (const lead of allLeads) {
    const dateKey = lead.created_at.slice(0, 10);
    if (!dailyCounts.has(dateKey)) continue;
    dailyCounts.set(dateKey, dailyCounts.get(dateKey) + 1);
    if (lead.status === 'cerrado_ganado') {
      dailyRevenues.set(dateKey, dailyRevenues.get(dateKey) + (lead.amount || 0));
    }
    const product = lead.product || 'Sin producto';
    if (!productBuckets.has(product)) productBuckets.set(product, { leads: 0, revenue: 0 });
    productBuckets.get(product).leads += 1;
    if (lead.status === 'cerrado_ganado') productBuckets.get(product).revenue += lead.amount || 0;
  }

  const history = [];
  for (let i = 0; i < historyDays; i++) {
    const day = new Date(historyStart.getTime() + i * 86400000);
    const label = day.toLocaleDateString('es-CO', { day: '2-digit', month: 'short' });
    const key = day.toISOString().slice(0, 10);
    history.push({ label, leads: dailyCounts.get(key) || 0, revenue: dailyRevenues.get(key) || 0 });
  }

  const weeklySums = [];
  for (let i = 0; i < Math.ceil(historyDays / 7); i++) {
    const weekStart = i * 7;
    const weekSlice = history.slice(weekStart, weekStart + 7);
    const weekLabel = `Semana ${i + 1}`;
    weeklySums.push({ label: weekLabel, leads: weekSlice.reduce((sum, item) => sum + item.leads, 0), revenue: weekSlice.reduce((sum, item) => sum + item.revenue, 0) });
  }

  const monthlySums = [];
  const monthMap = new Map();
  for (const item of history) {
    const monthKey = item.label.slice(-4);
    if (!monthMap.has(monthKey)) monthMap.set(monthKey, { leads: 0, revenue: 0, label: monthKey });
    const bucket = monthMap.get(monthKey);
    bucket.leads += item.leads;
    bucket.revenue += item.revenue;
  }
  monthMap.forEach((value) => monthlySums.push(value));

  const sourceSeries = interval === 'week' ? weeklySums : interval === 'month' ? monthlySums : history;
  const lastAverage = sourceSeries.length ? Math.round(sourceSeries.reduce((sum, item) => sum + item.leads, 0) / sourceSeries.length) : 0;
  const trendFactor = history.slice(-7).reduce((sum, item) => sum + item.leads, 0) / 7 || 1;
  const prediction = [];
  for (let i = 1; i <= horizon; i++) {
    const factor = 1 + (i / horizon) * 0.12;
    const predictedLeads = Math.max(0, Math.round(lastAverage * factor));
    prediction.push({ label: interval === 'week' ? `Próx. S${i}` : interval === 'month' ? `Próx. M${i}` : `Día +${i}`, leads: predictedLeads, revenue: Math.round(predictedLeads * 120000) });
  }

  const byProduct = [...productBuckets.entries()]
    .sort((a, b) => b[1].leads - a[1].leads)
    .slice(0, 6)
    .map(([product, data]) => ({ product, leads: data.leads, revenue: data.revenue }));

  const totalPredictedLeads = prediction.reduce((sum, item) => sum + item.leads, 0);
  const totalPredictedRevenue = prediction.reduce((sum, item) => sum + item.revenue, 0);
  const averageLeads = sourceSeries.length ? Math.round(lastAverage) : 0;
  const averageRevenue = sourceSeries.length ? Math.round(sourceSeries.reduce((sum, item) => sum + item.revenue, 0) / sourceSeries.length) : 0;
  const lastIntervalTotal = sourceSeries.length ? sourceSeries[sourceSeries.length - 1].leads : 0;
  const growthPct = lastIntervalTotal ? Math.round(((averageLeads - lastIntervalTotal) / lastIntervalTotal) * 1000) / 10 : 0;

  return {
    horizon,
    interval,
    history: interval === 'week' ? weeklySums : interval === 'month' ? monthlySums : history,
    forecast: prediction,
    by_product: byProduct,
    total_predicted_leads: totalPredictedLeads,
    total_predicted_revenu: totalPredictedRevenue,
    average_leads: averageLeads,
    average_revenue: averageRevenue,
    growth_pct: growthPct,
  };
}

/**
 * Promedios por día de la semana dentro del rango, para las 3 gráficas de
 * barras "Promedios por día" del reporte de gerencia:
 *  - Leads INGRESADOS  = mensajes/llamadas anotados a mano en Informe
 *    (informe_canales) -- el total "crudo" que entra al negocio.
 *  - Leads ASIGNADOS   = leads reales creados en el CRM (solo Google Ads).
 *  - VENTAS            = leads cerrados ganados.
 *
 * "Ingresados" se promedia solo entre los días de ese día-de-semana que
 * tienen registro en Informe (un lunes sin registrar no cuenta ni como 0 ni
 * como dato); "asignados" y "ventas" se promedian entre TODAS las
 * ocurrencias del día en el rango, porque un día sin leads es un 0 real que
 * el CRM sí conoce.
 */
async function computeWeekdayAverages(fromInput, toInput) {
  const defaults = monthRangeDefaults();
  const from = fromInput || defaults.from;
  const to = toInput || defaults.to;

  const fromD = new Date(`${from}T00:00:00Z`);
  const toD = new Date(`${to}T00:00:00Z`);
  // Índice 0 = lunes ... 6 = domingo.
  const weekdayIdx = (dateLike) => (new Date(dateLike).getUTCDay() + 6) % 7;

  const occ = [0, 0, 0, 0, 0, 0, 0];
  for (let d = new Date(fromD); d <= toD; d = new Date(d.getTime() + 86400000)) {
    occ[weekdayIdx(d)] += 1;
  }

  const canalesRows = await db
    .prepare('SELECT fecha, (whatsapp + correo + llamadas) AS total FROM informe_canales WHERE fecha >= ? AND fecha <= ?')
    .all(from, to);
  const asignadosRows = await db
    .prepare("SELECT substr(created_at, 1, 10) AS fecha, COUNT(*) AS total FROM leads_visible WHERE created_at >= ? AND created_at <= ? GROUP BY fecha")
    .all(`${from} 00:00:00`, `${to} 23:59:59`);
  const ventasRows = await db
    .prepare("SELECT substr(closed_at, 1, 10) AS fecha, COUNT(*) AS total FROM leads_visible WHERE status = 'cerrado_ganado' AND closed_at >= ? AND closed_at <= ? GROUP BY fecha")
    .all(`${from} 00:00:00`, `${to} 23:59:59`);

  const sumIngresados = [0, 0, 0, 0, 0, 0, 0];
  const diasConRegistro = [0, 0, 0, 0, 0, 0, 0];
  const sumAsignados = [0, 0, 0, 0, 0, 0, 0];
  const sumVentas = [0, 0, 0, 0, 0, 0, 0];

  for (const r of canalesRows) {
    const wi = weekdayIdx(`${r.fecha}T00:00:00Z`);
    sumIngresados[wi] += r.total;
    diasConRegistro[wi] += 1;
  }
  for (const r of asignadosRows) sumAsignados[weekdayIdx(`${r.fecha}T00:00:00Z`)] += r.total;
  for (const r of ventasRows) sumVentas[weekdayIdx(`${r.fecha}T00:00:00Z`)] += r.total;

  const LABELS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
  const avg = (sum, n) => (n ? Math.round((sum / n) * 10) / 10 : 0);

  return LABELS.map((label, i) => ({
    weekday: i + 1,
    label,
    ocurrencias: occ[i],
    ingresados: avg(sumIngresados[i], diasConRegistro[i]),
    asignados: avg(sumAsignados[i], occ[i]),
    ventas: avg(sumVentas[i], occ[i]),
  }));
}

// Apreciaciones (positivas) y observaciones (a mejorar) sugeridas para un
// asesor, comparando sus métricas del periodo contra el periodo anterior.
// Son SUGERENCIAS: el reporte de gerencia las deja editar antes de archivar.
function buildAdvisorNotes(cur, prev) {
  const apreciaciones = [];
  const observaciones = [];

  // Con muy pocos leads en el periodo cualquier variación es ruido (un solo
  // lead mueve las tasas 100 puntos): mejor no sugerir nada y dejar que
  // gerencia lo escriba a mano.
  if ((cur.asignados || 0) < 5) return { apreciaciones, observaciones };

  if (!prev) {
    if (cur.tasa_cierre >= 12) apreciaciones.push('Buena tasa de cierre en el periodo');
    if (cur.sla_cumplimiento >= 85) apreciaciones.push('Cumplió el SLA de primer contacto');
    if (cur.asignados >= 40 && cur.tasa_contacto >= 60) apreciaciones.push('Buena administración de un gran flujo de leads');
    if (cur.pendientes_por_cotizar > cur.cotizados) observaciones.push('Varios leads quedaron sin cotizar');
    if (cur.tasa_reasignados >= 15) observaciones.push('Tasa de reasignación alta');
    return { apreciaciones: apreciaciones.slice(0, 4), observaciones: observaciones.slice(0, 4) };
  }

  const PP = 1.5; // umbral en puntos porcentuales para tratar un cambio como real
  const delta = (key) => (cur[key] || 0) - (prev[key] || 0);

  if (delta('tasa_contacto') >= PP) apreciaciones.push('AUMENTÓ la tasa de respuesta');
  else if (delta('tasa_contacto') <= -PP) observaciones.push('BAJÓ la tasa de respuesta');

  if (delta('tasa_cierre') >= PP) apreciaciones.push('SUBIÓ la tasa de cierre');
  else if (delta('tasa_cierre') <= -PP) observaciones.push('BAJÓ la tasa de cierre');

  if (delta('tasa_reasignados') >= PP) observaciones.push('AUMENTÓ la reasignación de leads');
  else if (delta('tasa_reasignados') <= -PP) apreciaciones.push('BAJÓ la reasignación de leads');

  if (delta('cotizados_sobre_asignados') >= PP) apreciaciones.push('Cotizó una mayor parte de sus leads');
  else if (delta('cotizados_sobre_asignados') <= -PP) observaciones.push('Cotizó una menor parte de sus leads');

  if (delta('prom_semanal_sin_cotizar') >= 1) observaciones.push('AUMENTÓ el represamiento de leads sin cotizar');
  else if (delta('prom_semanal_sin_cotizar') <= -1) apreciaciones.push('BAJÓ el represamiento de leads sin cotizar');

  const ticketCur = cur.vendidos ? cur.monto_vendido / cur.vendidos : 0;
  const ticketPrev = prev.vendidos ? prev.monto_vendido / prev.vendidos : 0;
  if (ticketPrev && ticketCur >= ticketPrev * 1.1) apreciaciones.push('SUBIÓ el ticket promedio de venta');
  else if (ticketPrev && ticketCur > 0 && ticketCur <= ticketPrev * 0.9) observaciones.push('BAJÓ el ticket promedio de venta');

  if (cur.monto_vendido > prev.monto_vendido) apreciaciones.push('CRECIÓ el monto vendido');
  else if (prev.monto_vendido > 0 && cur.monto_vendido < prev.monto_vendido) observaciones.push('CAYÓ el monto vendido');

  if (cur.asignados >= 40 && cur.tasa_contacto >= 60) apreciaciones.push('Buena administración de un gran flujo de leads');

  return {
    apreciaciones: [...new Set(apreciaciones)].slice(0, 4),
    observaciones: [...new Set(observaciones)].slice(0, 4),
  };
}

/**
 * Reporte de gerencia ("Reporte de Servicio al Cliente"): la foto mensual que
 * antes se armaba a mano en diapositivas. Reúne en una sola respuesta:
 *  1. Resultados generales   -- ventas, monto, ticket, 5 indicadores + delta vs. periodo anterior
 *  2. Embudo de conversión   -- leads crudos -> asignados -> cotizados, con %
 *  3. Rentabilidad de ads    -- costo por lead/venta, ROI, % de la inversión sobre ventas
 *  4. Resultados por asesor  -- lo mismo por persona + ticket, ventas/día hábil, participación y notas
 *  5. Promedios por día      -- ingresados / asignados / ventas por día de la semana
 *
 * El "periodo anterior" es el bloque de días inmediatamente anterior, de la
 * misma duración que el rango pedido (para las flechas de comparación).
 */
async function computeMonthlyReport(fromInput, toInput) {
  const defaults = monthRangeDefaults();
  const from = fromInput || defaults.from;
  const to = toInput || defaults.to;

  const fromD = new Date(`${from}T00:00:00Z`);
  const toD = new Date(`${to}T00:00:00Z`);
  const days = Math.max(1, Math.round((toD - fromD) / 86400000) + 1);
  const prevToD = new Date(fromD.getTime() - 86400000);
  const prevFromD = new Date(prevToD.getTime() - (days - 1) * 86400000);
  const prevFrom = prevFromD.toISOString().slice(0, 10);
  const prevTo = prevToD.toISOString().slice(0, 10);

  const [funnel, funnelPrev, profitability, promedios_por_dia] = await Promise.all([
    computeFunnelReport(from, to),
    computeFunnelReport(prevFrom, prevTo),
    computeProfitabilityReport(from, to),
    computeWeekdayAverages(from, to),
  ]);

  const dias_habiles = holidays.businessDaysBetween(from, to);
  const totalLeadsCrudos = profitability.crudo.total_leads;
  const t = funnel.totals;
  const tp = funnelPrev.totals;

  // ¿El periodo anterior sirve para comparar? Se exige volumen mínimo y un
  // embudo sano (no se cierra más de lo que se cotiza). El CRM empezó a
  // usarse en serio en agosto de 2026: los meses previos son backfill y
  // comparar contra eso da deltas y notas absurdas.
  const comparable = tp.asignados >= 15 && tp.vendidos <= tp.cotizados;

  const monto_total = t.monto_vendido;
  const ticket_venta = t.vendidos ? Math.round(monto_total / t.vendidos) : 0;

  // Rentabilidad en base "cruda" (igual que el reporte original): la inversión
  // se compara contra TODO lo que entra al negocio y todo lo que se vende, no
  // solo el canal pagado. google_ads queda como referencia del canal puro.
  const inversion = profitability.crudo.inversion;
  const roi_pct = profitability.crudo.roi_pct;
  const roi_veces = roi_pct != null ? Math.round(roi_pct) / 100 : null;
  const ads_pct_of_sales = monto_total ? pct2(inversion, monto_total) : null;

  const prevByAdvisor = new Map(funnelPrev.advisors.map((a) => [a.advisor_id, a]));

  const asesores = funnel.advisors.map((a) => {
    const prevRaw = prevByAdvisor.get(a.advisor_id) || null;
    // Las notas y deltas solo se calculan si el periodo anterior es comparable.
    const prev = comparable ? prevRaw : null;
    const ticket = a.vendidos ? Math.round(a.monto_vendido / a.vendidos) : 0;
    const ventasPorDia = a.vendidos && dias_habiles ? dias_habiles / a.vendidos : null;
    const cadaNDias = ventasPorDia ? Math.max(1, Math.round(ventasPorDia)) : null;

    return {
      advisor_id: a.advisor_id,
      name: a.name,
      inicial: (a.name || '?').trim().charAt(0).toUpperCase(),
      rank: a.rank,
      asignados: a.asignados,
      asignados_pct_equipo: pct(a.asignados, t.asignados),
      cotizados: a.cotizados,
      cotizados_pct_crudo: pct(a.cotizados, totalLeadsCrudos),
      pendientes_por_cotizar: a.pendientes_por_cotizar,
      reasignados: a.reasignados,
      vendidos: a.vendidos,
      monto_vendido: a.monto_vendido,
      ticket_venta: ticket,
      tasa_cierre: a.tasa_cierre,
      participacion_ventas_pct: pct2(a.monto_vendido, monto_total),
      ventas_por_dia: ventasPorDia ? round1(ventasPorDia) : null,
      ventas_por_dia_texto: cadaNDias ? `1 venta cada ${cadaNDias} día${cadaNDias === 1 ? '' : 's'} hábil${cadaNDias === 1 ? '' : 'es'} aprox` : 'Sin ventas en el periodo',
      indicadores: {
        efectividad_asesor: a.efectividad_asesor,
        cotizados_sobre_asignados: a.cotizados_sobre_asignados,
        prom_semanal_sin_cotizar: a.prom_semanal_sin_cotizar,
        tasa_reasignados: a.tasa_reasignados,
        tasa_cierre: a.tasa_cierre,
      },
      deltas: prev
        ? {
            vendidos: a.vendidos - prev.vendidos,
            monto_vendido: a.monto_vendido - prev.monto_vendido,
            efectividad_asesor: round1(a.efectividad_asesor - prev.efectividad_asesor),
            cotizados_sobre_asignados: round1(a.cotizados_sobre_asignados - prev.cotizados_sobre_asignados),
            prom_semanal_sin_cotizar: round1(a.prom_semanal_sin_cotizar - prev.prom_semanal_sin_cotizar),
            tasa_reasignados: round1(a.tasa_reasignados - prev.tasa_reasignados),
            tasa_cierre: round1(a.tasa_cierre - prev.tasa_cierre),
          }
        : null,
      ...buildAdvisorNotes(a, prev),
    };
  });

  return {
    from,
    to,
    comparado_con: { from: prevFrom, to: prevTo, asignados: tp.asignados, comparable },
    dias_habiles,
    generales: {
      total_ventas: t.vendidos,
      tasa_cierre: t.tasa_cierre,
      monto_total,
      ticket_venta,
      indicadores: {
        efectividad_asesor: t.efectividad_asesor,
        cotizados_sobre_asignados: t.cotizados_sobre_asignados,
        prom_semanal_sin_cotizar: t.prom_semanal_sin_cotizar,
        tasa_reasignados: t.tasa_reasignados,
        tasa_cierre: t.tasa_cierre,
      },
      deltas: {
        total_ventas: t.vendidos - tp.vendidos,
        monto_total: monto_total - tp.monto_vendido,
        tasa_cierre: round1(t.tasa_cierre - tp.tasa_cierre),
        efectividad_asesor: round1(t.efectividad_asesor - tp.efectividad_asesor),
        cotizados_sobre_asignados: round1(t.cotizados_sobre_asignados - tp.cotizados_sobre_asignados),
        prom_semanal_sin_cotizar: round1(t.prom_semanal_sin_cotizar - tp.prom_semanal_sin_cotizar),
        tasa_reasignados: round1(t.tasa_reasignados - tp.tasa_reasignados),
      },
    },
    embudo: {
      total_leads_crudos: totalLeadsCrudos,
      asignados: t.asignados,
      asignados_pct: pct2(t.asignados, totalLeadsCrudos),
      cotizados: t.cotizados,
      cotizados_pct: pct2(t.cotizados, totalLeadsCrudos),
    },
    rentabilidad: {
      inversion,
      costo_por_lead: profitability.crudo.costo_por_lead,
      costo_por_venta: profitability.crudo.costo_por_venta,
      roi_pct,
      roi_veces,
      ads_pct_of_sales,
      ticket_venta,
      google_ads: profitability.google_ads,
    },
    asesores,
    promedios_por_dia,
  };
}

module.exports = {
  computeFunnelReport,
  computeProfitabilityReport,
  computeAdvisorReport,
  computeGeoReport,
  computeMonthlyTrend,
  computeDailySalesTrend,
  computeChannelProductFlow,
  computeForecast,
  computeWeekdayAverages,
  computeMonthlyReport,
  buildAdvisorNotes,
  monthRangeDefaults,
  pct,
};
