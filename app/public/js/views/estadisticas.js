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
          <h3 class="text-headline-md font-headline-md text-on-surface">Comparativo por Asesor</h3>
          <p class="text-body-sm font-body-sm text-on-surface-variant">Embudo asignado → contactado → cotizado → vendido, por rango de fechas</p>
        </div>
        <div class="flex items-end gap-3">
          <div>
            <label class="block text-[10px] font-label-bold text-on-surface-variant mb-1 uppercase tracking-wider">Desde</label>
            <input id="funnel-from" type="date" class="p-2 bg-surface-container-lowest border border-outline-variant rounded-md text-body-sm outline-none focus:border-primary" />
          </div>
          <div>
            <label class="block text-[10px] font-label-bold text-on-surface-variant mb-1 uppercase tracking-wider">Hasta</label>
            <input id="funnel-to" type="date" class="p-2 bg-surface-container-lowest border border-outline-variant rounded-md text-body-sm outline-none focus:border-primary" />
          </div>
        </div>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full text-left border-collapse min-w-[820px]">
          <thead>
            <tr class="bg-surface-container-low border-b border-outline-variant">
              <th class="p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase tracking-wider">Asesor</th>
              <th class="p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase tracking-wider text-center">Asignados</th>
              <th class="p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase tracking-wider text-center">Contactados</th>
              <th class="p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase tracking-wider text-center">Cotizados</th>
              <th class="p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase tracking-wider text-center">Vendidos</th>
              <th class="p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase tracking-wider text-center">Perdidos</th>
              <th class="p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase tracking-wider text-center">% Contacto</th>
              <th class="p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase tracking-wider text-center">% Cotización</th>
              <th class="p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase tracking-wider text-center">% Cierre</th>
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
  `;

  const kpiGrid = container.querySelector('#kpi-grid');
  const barChart = container.querySelector('#bar-chart');
  const donut = container.querySelector('#donut');
  const donutLegend = container.querySelector('#donut-legend');
  const funnelTbody = container.querySelector('#funnel-tbody');
  const funnelTotalesRow = container.querySelector('#funnel-totales-row');
  const funnelFrom = container.querySelector('#funnel-from');
  const funnelTo = container.querySelector('#funnel-to');

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
    return `
      <tr>
        <td class="p-table-cell-padding text-body-md font-semibold text-on-surface">${escapeHtml(r.name)}</td>
        <td class="p-table-cell-padding text-center">${r.asignados}</td>
        <td class="p-table-cell-padding text-center">${r.contactados}</td>
        <td class="p-table-cell-padding text-center">${r.cotizados}</td>
        <td class="p-table-cell-padding text-center text-secondary font-bold">${r.vendidos}</td>
        <td class="p-table-cell-padding text-center text-error">${r.perdidos}</td>
        <td class="p-table-cell-padding text-center">${r.tasa_contacto}%</td>
        <td class="p-table-cell-padding text-center">${r.tasa_cotizacion}%</td>
        <td class="p-table-cell-padding text-center">${r.tasa_cierre}%</td>
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
      : `<tr><td colspan="10" class="p-table-cell-padding py-8 text-center text-body-sm text-on-surface-variant">No hay asesores activos.</td></tr>`;
    const t = data.totals;
    funnelTotalesRow.innerHTML = `
      <td class="p-table-cell-padding">Total</td>
      <td class="p-table-cell-padding text-center">${t.asignados}</td>
      <td class="p-table-cell-padding text-center">${t.contactados}</td>
      <td class="p-table-cell-padding text-center">${t.cotizados}</td>
      <td class="p-table-cell-padding text-center">${t.vendidos}</td>
      <td class="p-table-cell-padding text-center">${t.perdidos}</td>
      <td class="p-table-cell-padding text-center">${t.tasa_contacto}%</td>
      <td class="p-table-cell-padding text-center">${t.tasa_cotizacion}%</td>
      <td class="p-table-cell-padding text-center">${t.tasa_cierre}%</td>
      <td class="p-table-cell-padding text-right">${formatMoney(t.monto_vendido)}</td>
    `;
  }

  funnelFrom.addEventListener('change', loadFunnel);
  funnelTo.addEventListener('change', loadFunnel);

  const off = ctx.ws.on('leads_changed', () => {
    load();
    loadFunnel();
  });
  await Promise.all([load(), loadFunnel()]);

  return () => off();
}
