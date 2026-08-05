import { escapeHtml, formatMoney, formatCompactMoney } from '../utils.js';

const DIST_COLORS = {
  asignado: '#d5e3fc',
  contactado: '#ffb4ab',
  cotizado: '#003d9b',
  cerrado_ganado: '#006e2d',
  cerrado_perdido: '#ffdad6',
};

const now = new Date();
const MONTH_NAME = now.toLocaleDateString('es-CO', { month: 'long', year: 'numeric' });

export async function mount(container, ctx) {
  container.innerHTML = `
    <div class="flex justify-between items-end mb-margin-desktop flex-wrap gap-3">
      <div>
        <h2 class="text-headline-lg font-headline-lg text-on-surface">Rendimiento Comercial</h2>
        <p class="text-body-md font-body-md text-on-surface-variant mt-1">Análisis detallado de ventas y cumplimiento de SLAs — ${escapeHtml(MONTH_NAME)}</p>
      </div>
    </div>

    <div id="kpi-grid" class="grid grid-cols-1 md:grid-cols-3 gap-gutter mb-gutter"></div>

    <div class="grid grid-cols-1 lg:grid-cols-3 gap-gutter">
      <div class="lg:col-span-2 bg-surface-container-lowest border border-outline-variant rounded-xl p-gutter shadow-sm flex flex-col">
        <div class="flex justify-between items-center mb-6">
          <div>
            <h3 class="text-headline-md font-headline-md text-on-surface">Ventas por Asesor</h3>
            <p class="text-body-sm font-body-sm text-on-surface-variant">Comparativo mensual (mes actual vs anterior)</p>
          </div>
        </div>
        <div id="bar-chart" class="flex-1 flex items-end gap-6 h-64 mt-auto pt-4 border-b border-outline-variant"></div>
        <div class="flex justify-center space-x-6 mt-4">
          <div class="flex items-center space-x-2"><div class="w-3 h-3 bg-primary rounded-sm"></div><span class="text-body-sm font-body-sm text-on-surface-variant">Mes Actual</span></div>
          <div class="flex items-center space-x-2"><div class="w-3 h-3 bg-primary-container opacity-60 rounded-sm"></div><span class="text-body-sm font-body-sm text-on-surface-variant">Mes Anterior</span></div>
        </div>
      </div>

      <div class="bg-surface-container-lowest border border-outline-variant rounded-xl p-gutter shadow-sm flex flex-col">
        <h3 class="text-headline-md font-headline-md text-on-surface mb-1">Estado Leads</h3>
        <p class="text-body-sm font-body-sm text-on-surface-variant mb-6">Distribución actual del pipeline</p>
        <div class="flex-1 flex flex-col items-center justify-center">
          <div id="donut" class="relative w-48 h-48 rounded-full flex items-center justify-center"></div>
          <div id="donut-legend" class="w-full mt-8 space-y-2"></div>
        </div>
      </div>
    </div>

    <div class="bg-surface-container-lowest border border-outline-variant rounded-xl p-gutter shadow-sm mt-gutter">
      <div class="flex flex-wrap items-end justify-between gap-4 mb-6">
        <div>
          <h3 class="text-headline-md font-headline-md text-on-surface">Rendimiento por Asesor</h3>
          <p class="text-body-sm font-body-sm text-on-surface-variant">Embudo, cumplimiento de SLA y ranking, por rango de fechas — el reporte para comparar al equipo</p>
        </div>
        <div class="flex items-end gap-3 flex-wrap">
          <div>
            <label class="block text-[10px] font-label-bold text-on-surface-variant mb-1 uppercase tracking-wider">Desde</label>
            <input id="funnel-from" type="date" class="p-2 bg-surface-container-lowest border border-outline-variant rounded-md text-body-sm outline-none focus:border-primary" />
          </div>
          <div>
            <label class="block text-[10px] font-label-bold text-on-surface-variant mb-1 uppercase tracking-wider">Hasta</label>
            <input id="funnel-to" type="date" class="p-2 bg-surface-container-lowest border border-outline-variant rounded-md text-body-sm outline-none focus:border-primary" />
          </div>
          <button id="archive-rendimiento-btn" class="px-3 py-2 bg-primary text-on-primary rounded-md text-label-bold font-label-bold hover:bg-on-primary-fixed-variant transition-colors flex items-center gap-1.5">
            <span class="material-symbols-outlined text-[16px]">archive</span> Generar y archivar
          </button>
        </div>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full text-left border-collapse min-w-[980px]">
          <thead>
            <tr class="bg-surface-container-low border-b border-outline-variant">
              <th class="p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase tracking-wider text-center">#</th>
              <th class="p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase tracking-wider">Asesor</th>
              <th class="p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase tracking-wider text-center">Asignados</th>
              <th class="p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase tracking-wider text-center">Contactados</th>
              <th class="p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase tracking-wider text-center">Cotizados</th>
              <th class="p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase tracking-wider text-center">Vendidos</th>
              <th class="p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase tracking-wider text-center">Perdidos</th>
              <th class="p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase tracking-wider text-center">% Contacto</th>
              <th class="p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase tracking-wider text-center">% Cotización</th>
              <th class="p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase tracking-wider text-center">% Cierre</th>
              <th class="p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase tracking-wider text-center">% SLA</th>
              <th class="p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase tracking-wider text-center">Hrs. Prom. Cierre</th>
              <th class="p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase tracking-wider text-right">Monto Vendido</th>
            </tr>
          </thead>
          <tbody id="funnel-tbody" class="divide-y divide-outline-variant"></tbody>
          <tfoot>
            <tr id="funnel-totales-row" class="bg-surface-container-low font-bold"></tr>
          </tfoot>
        </table>
      </div>
    </div>

    <div class="bg-surface-container-lowest border border-outline-variant rounded-xl p-gutter shadow-sm mt-gutter">
      <div class="flex flex-wrap items-end justify-between gap-4 mb-6">
        <div>
          <h3 class="text-headline-md font-headline-md text-on-surface">Rentabilidad de Leads</h3>
          <p class="text-body-sm font-body-sm text-on-surface-variant">Leads por canal contra la inversión en Google Ads del periodo</p>
        </div>
        <div class="flex items-end gap-3 flex-wrap">
          <div>
            <label class="block text-[10px] font-label-bold text-on-surface-variant mb-1 uppercase tracking-wider">Desde</label>
            <input id="profit-from" type="date" class="p-2 bg-surface-container-lowest border border-outline-variant rounded-md text-body-sm outline-none focus:border-primary" />
          </div>
          <div>
            <label class="block text-[10px] font-label-bold text-on-surface-variant mb-1 uppercase tracking-wider">Hasta</label>
            <input id="profit-to" type="date" class="p-2 bg-surface-container-lowest border border-outline-variant rounded-md text-body-sm outline-none focus:border-primary" />
          </div>
          <button id="archive-rentabilidad-btn" class="px-3 py-2 bg-primary text-on-primary rounded-md text-label-bold font-label-bold hover:bg-on-primary-fixed-variant transition-colors flex items-center gap-1.5">
            <span class="material-symbols-outlined text-[16px]">archive</span> Generar y archivar
          </button>
        </div>
      </div>

      <div class="flex flex-wrap items-end gap-3 mb-6 p-4 bg-surface-container-low rounded-lg border border-outline-variant">
        <div>
          <label class="block text-[10px] font-label-bold text-on-surface-variant mb-1 uppercase tracking-wider">Mes</label>
          <input id="spend-month" type="month" class="p-2 bg-surface-container-lowest border border-outline-variant rounded-md text-body-sm outline-none focus:border-primary" />
        </div>
        <div>
          <label class="block text-[10px] font-label-bold text-on-surface-variant mb-1 uppercase tracking-wider">Inversión Google Ads (COP)</label>
          <input id="spend-amount" type="number" min="0" step="1000" placeholder="0" class="p-2 bg-surface-container-lowest border border-outline-variant rounded-md text-body-sm outline-none focus:border-primary w-40" />
        </div>
        <button id="spend-save-btn" class="px-3 py-2 border border-outline-variant rounded-md text-label-bold font-label-bold text-primary hover:bg-surface-container-lowest transition-colors">Guardar inversión</button>
      </div>

      <div id="profit-kpis" class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6"></div>

      <div class="overflow-x-auto">
        <table class="w-full text-left border-collapse min-w-[560px]">
          <thead>
            <tr class="bg-surface-container-low border-b border-outline-variant">
              <th class="p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase tracking-wider">Canal / Origen</th>
              <th class="p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase tracking-wider text-center">Leads</th>
              <th class="p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase tracking-wider text-center">Vendidos</th>
              <th class="p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase tracking-wider text-center">% Conversión</th>
              <th class="p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase tracking-wider text-right">Ingresos</th>
            </tr>
          </thead>
          <tbody id="channels-tbody" class="divide-y divide-outline-variant"></tbody>
        </table>
      </div>
    </div>

    <div class="bg-surface-container-lowest border border-outline-variant rounded-xl p-gutter shadow-sm mt-gutter">
      <div class="flex items-center gap-3 mb-6 border-b border-outline-variant pb-3">
        <span class="material-symbols-outlined text-on-surface-variant text-2xl">history</span>
        <h3 class="text-headline-md font-headline-md text-on-surface">Historial de Reportes</h3>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full text-left border-collapse min-w-[560px]">
          <thead>
            <tr class="bg-surface-container-low border-b border-outline-variant">
              <th class="p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase tracking-wider">Tipo</th>
              <th class="p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase tracking-wider">Periodo</th>
              <th class="p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase tracking-wider">Generado</th>
              <th class="p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase tracking-wider">Por</th>
              <th class="p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase tracking-wider text-right">Exportar</th>
            </tr>
          </thead>
          <tbody id="reports-tbody" class="divide-y divide-outline-variant"></tbody>
        </table>
      </div>
    </div>
  `;

  const kpiGrid = container.querySelector('#kpi-grid');
  const barChart = container.querySelector('#bar-chart');
  const donut = container.querySelector('#donut');
  const donutLegend = container.querySelector('#donut-legend');
  const funnelTbody = container.querySelector('#funnel-tbody');
  const funnelTotalesRow = container.querySelector('#funnel-totales-row');
  const funnelFrom = container.querySelector('#funnel-from');
  const funnelTo = container.querySelector('#funnel-to');
  const profitFrom = container.querySelector('#profit-from');
  const profitTo = container.querySelector('#profit-to');
  const profitKpis = container.querySelector('#profit-kpis');
  const channelsTbody = container.querySelector('#channels-tbody');
  const spendMonth = container.querySelector('#spend-month');
  const spendAmount = container.querySelector('#spend-amount');
  const reportsTbody = container.querySelector('#reports-tbody');

  async function load() {
    let k;
    try {
      k = await ctx.api.get('/api/kpis');
    } catch {
      ctx.toast('No se pudieron cargar las estadísticas', 'error');
      return;
    }

    const growthPositive = k.total_sales_growth_pct >= 0;
    kpiGrid.innerHTML = `
      <div class="bg-surface-container-lowest border border-outline-variant rounded-xl p-gutter shadow-sm relative overflow-hidden">
        <div class="absolute top-0 right-0 p-4 opacity-10"><span class="material-symbols-outlined text-6xl text-primary">attach_money</span></div>
        <p class="text-label-bold font-label-bold text-on-surface-variant uppercase tracking-wider mb-2">Total Ventas Mes</p>
        <h3 class="text-display-kpi font-display-kpi text-on-surface">${formatMoney(k.total_sales_month)}</h3>
        <div class="flex items-center mt-2 space-x-2">
          <span class="px-2 py-0.5 rounded ${growthPositive ? 'bg-secondary-container text-on-secondary-container' : 'bg-error-container text-on-error-container'} text-label-bold font-label-bold flex items-center">
            <span class="material-symbols-outlined text-[10px] mr-1">${growthPositive ? 'trending_up' : 'trending_down'}</span> ${growthPositive ? '+' : ''}${k.total_sales_growth_pct}%
          </span>
          <span class="text-body-sm font-body-sm text-on-surface-variant">vs mes anterior</span>
        </div>
      </div>
      <div class="bg-surface-container-lowest border border-outline-variant rounded-xl p-gutter shadow-sm relative overflow-hidden">
        <div class="absolute top-0 right-0 p-4 opacity-10"><span class="material-symbols-outlined text-6xl text-secondary">speed</span></div>
        <p class="text-label-bold font-label-bold text-on-surface-variant uppercase tracking-wider mb-2">Tasa Contacto SLA (&lt; 2h)</p>
        <h3 class="text-display-kpi font-display-kpi text-on-surface">${k.sla_contact_rate}%</h3>
        <div class="flex items-center mt-2 space-x-2">
          <span class="px-2 py-0.5 rounded bg-secondary-container text-on-secondary-container text-label-bold font-label-bold flex items-center">
            <span class="material-symbols-outlined text-[10px] mr-1">check_circle</span> Meta: 90%
          </span>
          <span class="text-body-sm font-body-sm text-on-surface-variant">${k.sla_contact_sample} leads contactados</span>
        </div>
      </div>
      <div class="bg-surface-container-lowest border border-outline-variant rounded-xl p-gutter shadow-sm relative overflow-hidden">
        <div class="absolute top-0 right-0 p-4 opacity-10"><span class="material-symbols-outlined text-6xl text-error">assignment_late</span></div>
        <p class="text-label-bold font-label-bold text-on-surface-variant uppercase tracking-wider mb-2">Leads Críticos (&gt; 24h)</p>
        <h3 class="text-display-kpi font-display-kpi text-error">${k.critical_leads_count}</h3>
        <div class="flex items-center mt-2 space-x-2">
          <span class="px-2 py-0.5 rounded bg-error-container text-on-error-container text-label-bold font-label-bold flex items-center">
            <span class="material-symbols-outlined text-[10px] mr-1">warning</span> ${k.critical_leads_advisors.length ? escapeHtml(k.critical_leads_advisors.join(', ')) : 'Requiere atención'}
          </span>
        </div>
      </div>
    `;

    const maxVal = Math.max(1, ...k.sales_by_advisor.flatMap((a) => [a.this_month, a.prev_month]));
    barChart.innerHTML = k.sales_by_advisor.length
      ? `<div class="flex-1 flex justify-around items-end h-full pb-1">${k.sales_by_advisor
          .map(
            (a) => `
        <div class="flex flex-col items-center w-16 group">
          <div class="w-full flex justify-center space-x-1 items-end h-full">
            <div class="w-6 bg-primary rounded-t" style="height:${Math.max(2, (a.this_month / maxVal) * 100)}%" title="Mes actual: ${formatMoney(a.this_month)}"></div>
            <div class="w-6 bg-primary-container rounded-t opacity-60" style="height:${Math.max(2, (a.prev_month / maxVal) * 100)}%" title="Mes anterior: ${formatMoney(a.prev_month)}"></div>
          </div>
          <span class="text-label-bold font-label-bold mt-2 text-on-surface">${escapeHtml(a.name)}</span>
          <span class="text-[10px] text-on-surface-variant">${formatCompactMoney(a.this_month)}</span>
        </div>`
          )
          .join('')}</div>`
      : `<p class="w-full text-center text-body-sm text-on-surface-variant">Aún no hay asesores registrados.</p>`;

    const total = k.total_leads || 0;
    let cumulative = 0;
    const stops = k.lead_status_distribution
      .filter((d) => d.count > 0)
      .map((d) => {
        const start = (cumulative / Math.max(1, total)) * 100;
        cumulative += d.count;
        const end = (cumulative / Math.max(1, total)) * 100;
        return `${DIST_COLORS[d.status]} ${start}% ${end}%`;
      });
    donut.style.background = total > 0 ? `conic-gradient(${stops.join(', ')})` : '#d5e3fc';
    donut.innerHTML = `
      <div class="w-32 h-32 bg-surface-container-lowest rounded-full flex flex-col items-center justify-center shadow-inner">
        <span class="text-headline-lg font-headline-lg text-on-surface font-bold">${total}</span>
        <span class="text-label-bold font-label-bold text-on-surface-variant">Total Leads</span>
      </div>
    `;

    const statusDotColors = {
      asignado: 'bg-surface-container-highest',
      contactado: 'bg-tertiary-fixed',
      cotizado: 'bg-primary',
      cerrado_ganado: 'bg-secondary',
      cerrado_perdido: 'bg-tertiary-fixed-dim',
    };
    donutLegend.innerHTML = k.lead_status_distribution
      .map((d) => {
        const pct = total > 0 ? Math.round((d.count / total) * 1000) / 10 : 0;
        return `
        <div class="flex justify-between items-center text-body-sm font-body-sm">
          <div class="flex items-center space-x-2">
            <div class="w-3 h-3 rounded-sm ${statusDotColors[d.status]}"></div>
            <span class="text-on-surface">${escapeHtml(d.label)}</span>
          </div>
          <span class="font-bold text-on-surface">${pct}% (${d.count})</span>
        </div>`;
      })
      .join('');
  }

  function funnelRowHtml(r) {
    const rankBadge =
      r.rank === 1
        ? '<span class="inline-flex items-center justify-center w-6 h-6 rounded-full bg-secondary text-on-secondary font-bold text-body-sm">1</span>'
        : `<span class="text-on-surface-variant font-bold">${r.rank}</span>`;
    return `
      <tr>
        <td class="p-table-cell-padding text-center">${rankBadge}</td>
        <td class="p-table-cell-padding text-body-md font-semibold text-on-surface">${escapeHtml(r.name)}</td>
        <td class="p-table-cell-padding text-center">${r.asignados}</td>
        <td class="p-table-cell-padding text-center">${r.contactados}</td>
        <td class="p-table-cell-padding text-center">${r.cotizados}</td>
        <td class="p-table-cell-padding text-center text-secondary font-bold">${r.vendidos}</td>
        <td class="p-table-cell-padding text-center text-error">${r.perdidos}</td>
        <td class="p-table-cell-padding text-center">${r.tasa_contacto}%</td>
        <td class="p-table-cell-padding text-center">${r.tasa_cotizacion}%</td>
        <td class="p-table-cell-padding text-center">${r.tasa_cierre}%</td>
        <td class="p-table-cell-padding text-center ${r.sla_cumplimiento < 85 ? 'text-error font-bold' : ''}">${r.sla_cumplimiento}%</td>
        <td class="p-table-cell-padding text-center">${r.tiempo_promedio_cierre_h ?? '—'}</td>
        <td class="p-table-cell-padding text-right font-bold">${formatMoney(r.monto_vendido)}</td>
      </tr>
    `;
  }

  async function loadFunnel() {
    const params = new URLSearchParams();
    if (funnelFrom.value) params.set('from', funnelFrom.value);
    if (funnelTo.value) params.set('to', funnelTo.value);
    let data;
    try {
      data = await ctx.api.get(`/api/kpis/funnel?${params.toString()}`);
    } catch {
      ctx.toast('No se pudo cargar el comparativo por asesor', 'error');
      return;
    }
    if (!funnelFrom.value) funnelFrom.value = data.from;
    if (!funnelTo.value) funnelTo.value = data.to;
    funnelTbody.innerHTML = data.advisors.length
      ? data.advisors.map(funnelRowHtml).join('')
      : `<tr><td colspan="13" class="p-table-cell-padding py-8 text-center text-body-sm text-on-surface-variant">No hay asesores activos.</td></tr>`;
    const t = data.totals;
    funnelTotalesRow.innerHTML = `
      <td class="p-table-cell-padding"></td>
      <td class="p-table-cell-padding">Total</td>
      <td class="p-table-cell-padding text-center">${t.asignados}</td>
      <td class="p-table-cell-padding text-center">${t.contactados}</td>
      <td class="p-table-cell-padding text-center">${t.cotizados}</td>
      <td class="p-table-cell-padding text-center">${t.vendidos}</td>
      <td class="p-table-cell-padding text-center">${t.perdidos}</td>
      <td class="p-table-cell-padding text-center">${t.tasa_contacto}%</td>
      <td class="p-table-cell-padding text-center">${t.tasa_cotizacion}%</td>
      <td class="p-table-cell-padding text-center">${t.tasa_cierre}%</td>
      <td class="p-table-cell-padding text-center">—</td>
      <td class="p-table-cell-padding text-center">—</td>
      <td class="p-table-cell-padding text-right">${formatMoney(t.monto_vendido)}</td>
    `;
  }

  // --- Rentabilidad de Leads --------------------------------------------
  function channelRowHtml(c) {
    return `
      <tr>
        <td class="p-table-cell-padding font-semibold text-on-surface">${escapeHtml(c.channel)}</td>
        <td class="p-table-cell-padding text-center">${c.leads}</td>
        <td class="p-table-cell-padding text-center text-secondary font-bold">${c.ganados}</td>
        <td class="p-table-cell-padding text-center">${c.tasa_conversion}%</td>
        <td class="p-table-cell-padding text-right font-bold">${formatMoney(c.ingresos)}</td>
      </tr>
    `;
  }

  function kpiTile(label, value, icon) {
    return `
      <div class="bg-surface-container-lowest border border-outline-variant rounded-lg p-4">
        <div class="flex items-center gap-2 mb-1">
          <span class="material-symbols-outlined text-[16px] text-on-surface-variant">${icon}</span>
          <p class="text-[10px] font-label-bold text-on-surface-variant uppercase tracking-wider">${label}</p>
        </div>
        <p class="text-headline-md font-headline-md text-on-surface">${value}</p>
      </div>
    `;
  }

  async function loadProfitability() {
    const params = new URLSearchParams();
    if (profitFrom.value) params.set('from', profitFrom.value);
    if (profitTo.value) params.set('to', profitTo.value);
    let data;
    try {
      data = await ctx.api.get(`/api/kpis/profitability?${params.toString()}`);
    } catch {
      ctx.toast('No se pudo cargar la rentabilidad de leads', 'error');
      return;
    }
    if (!profitFrom.value) profitFrom.value = data.from;
    if (!profitTo.value) profitTo.value = data.to;
    if (!spendMonth.value) spendMonth.value = data.to.slice(0, 7);

    const ga = data.google_ads;
    profitKpis.innerHTML = [
      kpiTile('Inversión Google Ads', formatMoney(ga.inversion), 'payments'),
      kpiTile('Costo por Lead', ga.costo_por_lead != null ? formatMoney(ga.costo_por_lead) : '—', 'person_search'),
      kpiTile('Costo por Venta', ga.costo_por_venta != null ? formatMoney(ga.costo_por_venta) : '—', 'sell'),
      kpiTile('ROI', ga.roi_pct != null ? `${ga.roi_pct}%` : '—', 'trending_up'),
    ].join('');

    channelsTbody.innerHTML = data.channels.length
      ? data.channels.map(channelRowHtml).join('')
      : `<tr><td colspan="5" class="p-table-cell-padding py-8 text-center text-body-sm text-on-surface-variant">Sin leads en este rango.</td></tr>`;
  }

  profitFrom.addEventListener('change', loadProfitability);
  profitTo.addEventListener('change', loadProfitability);

  container.querySelector('#spend-save-btn').addEventListener('click', async () => {
    if (!spendMonth.value) {
      ctx.toast('Selecciona el mes', 'error');
      return;
    }
    try {
      await ctx.api.put(`/api/marketing/ad-spend/${spendMonth.value}`, { amount: spendAmount.value || 0 });
      ctx.toast('Inversión guardada', 'success');
      loadProfitability();
    } catch (err) {
      ctx.toast(err.message, 'error');
    }
  });

  // --- Historial de Reportes ---------------------------------------------
  const REPORT_TYPE_LABELS = { rendimiento: 'Rendimiento por asesor', rentabilidad: 'Rentabilidad de leads' };

  function reportRowHtml(r) {
    return `
      <tr>
        <td class="p-table-cell-padding text-on-surface">${REPORT_TYPE_LABELS[r.type] || r.type}</td>
        <td class="p-table-cell-padding text-on-surface-variant">${escapeHtml(r.period_from)} → ${escapeHtml(r.period_to)}</td>
        <td class="p-table-cell-padding text-on-surface-variant">${escapeHtml((r.generated_at || '').replace('T', ' ').slice(0, 16))}</td>
        <td class="p-table-cell-padding text-on-surface-variant">${escapeHtml(r.generated_by || '—')}</td>
        <td class="p-table-cell-padding text-right">
          <a href="/api/reports/${r.id}/xlsx" class="inline-flex items-center gap-1 text-primary hover:text-on-primary-fixed-variant text-body-sm font-label-bold">
            <span class="material-symbols-outlined text-[16px]">download</span> Excel
          </a>
        </td>
      </tr>
    `;
  }

  async function loadReports() {
    let reports;
    try {
      reports = await ctx.api.get('/api/reports');
    } catch {
      ctx.toast('No se pudo cargar el historial de reportes', 'error');
      return;
    }
    reportsTbody.innerHTML = reports.length
      ? reports.map(reportRowHtml).join('')
      : `<tr><td colspan="5" class="p-table-cell-padding py-8 text-center text-body-sm text-on-surface-variant">Aún no se ha generado ningún reporte.</td></tr>`;
  }

  container.querySelector('#archive-rendimiento-btn').addEventListener('click', async () => {
    try {
      await ctx.api.post('/api/reports', { type: 'rendimiento', from: funnelFrom.value, to: funnelTo.value });
      ctx.toast('Reporte de rendimiento archivado', 'success');
      loadReports();
    } catch (err) {
      ctx.toast(err.message, 'error');
    }
  });

  container.querySelector('#archive-rentabilidad-btn').addEventListener('click', async () => {
    try {
      await ctx.api.post('/api/reports', { type: 'rentabilidad', from: profitFrom.value, to: profitTo.value });
      ctx.toast('Reporte de rentabilidad archivado', 'success');
      loadReports();
    } catch (err) {
      ctx.toast(err.message, 'error');
    }
  });

  funnelFrom.addEventListener('change', loadFunnel);
  funnelTo.addEventListener('change', loadFunnel);

  const off = ctx.ws.on('leads_changed', () => {
    load();
    loadFunnel();
    loadProfitability();
  });
  await Promise.all([load(), loadFunnel(), loadProfitability(), loadReports()]);

  return () => off();
}
