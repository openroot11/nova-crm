import { escapeHtml, formatMoney } from '../utils.js';
import { barChart, destroyChart, CATEGORICAL_COLORS } from '../components/charts.js';
import { openQuickSaleModal } from '../components/quickSaleModal.js';

const PAGE_SIZE = 50;

function fechaLabel(sqliteDatetime) {
  if (!sqliteDatetime) return '—';
  const [datePart, timePart = '00:00:00'] = sqliteDatetime.split(' ');
  const [year, month, day] = datePart.split('-').map(Number);
  const [hour, minute] = timePart.split(':').map(Number);
  const d = new Date(year, month - 1, day, hour || 0, minute || 0);
  return d.toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' }) + ' · ' + d.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
}

export async function mount(container, ctx) {
  container.innerHTML = `
    <div class="flex flex-wrap justify-between items-end gap-4 mb-gutter">
      <div>
        <h2 class="text-headline-lg font-headline-lg text-on-surface">Ventas Cerradas</h2>
        <p class="text-body-md font-body-md text-on-surface-variant mt-1">Solo lo concretado — cierres reales, con su tendencia y comparativo por asesor.</p>
      </div>
      <div class="flex items-end gap-3 flex-wrap">
        <div>
          <label class="block text-[10px] font-label-bold text-on-surface-variant mb-1 uppercase tracking-wider">Desde</label>
          <input id="vc-from" type="date" class="p-2 bg-surface-container-lowest border border-outline-variant rounded-md text-body-sm outline-none focus:border-primary" />
        </div>
        <div>
          <label class="block text-[10px] font-label-bold text-on-surface-variant mb-1 uppercase tracking-wider">Hasta</label>
          <input id="vc-to" type="date" class="p-2 bg-surface-container-lowest border border-outline-variant rounded-md text-body-sm outline-none focus:border-primary" />
        </div>
        <button id="btn-quick-sale" class="px-3 py-2 bg-primary text-on-primary rounded-md font-label-bold text-label-bold hover:opacity-90 transition-colors flex items-center gap-1.5">
          <span class="material-symbols-outlined text-[18px]">bolt</span> Registrar venta
        </button>
      </div>
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-3 gap-gutter mb-gutter">
      <div class="lg:col-span-2 bg-surface-container-lowest border border-outline-variant rounded-xl p-gutter shadow-sm flex flex-col">
        <h3 class="text-headline-md font-headline-md text-on-surface mb-1">Tendencia de ventas</h3>
        <p class="text-body-sm font-body-sm text-on-surface-variant mb-6">Monto vendido por día en el rango seleccionado</p>
        <div style="height:260px;"><canvas id="vc-trend-chart"></canvas></div>
      </div>
      <div class="bg-surface-container-lowest border border-outline-variant rounded-xl p-gutter shadow-sm flex flex-col">
        <h3 class="text-headline-md font-headline-md text-on-surface mb-1">Por asesor</h3>
        <p class="text-body-sm font-body-sm text-on-surface-variant mb-6">Monto vendido en el rango</p>
        <div style="height:260px;"><canvas id="vc-advisor-chart"></canvas></div>
      </div>
    </div>

    <div class="bg-surface rounded-xl border border-outline-variant overflow-hidden shadow-sm">
      <div class="p-4 border-b border-outline-variant bg-surface-container-low flex items-center justify-between flex-wrap gap-2">
        <h3 class="text-headline-sm font-headline-sm text-on-surface">Detalle de ventas</h3>
        <span id="vc-count-badge" class="bg-secondary-container text-on-secondary-container px-2.5 py-0.5 rounded-full text-label-bold font-label-bold">0 ventas</span>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full text-left border-collapse">
          <thead class="bg-surface-container-high border-b border-outline-variant">
            <tr>
              <th class="p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase whitespace-nowrap">Cliente</th>
              <th class="p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase whitespace-nowrap">Asesor</th>
              <th class="p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase whitespace-nowrap">Producto</th>
              <th class="p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase whitespace-nowrap text-right">Monto</th>
              <th class="p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase whitespace-nowrap">Fecha de cierre</th>
            </tr>
          </thead>
          <tbody id="vc-tbody" class="text-body-md font-body-md divide-y divide-outline-variant"></tbody>
        </table>
      </div>
      <div id="vc-loadmore-wrap" class="hidden p-4 border-t border-outline-variant text-center">
        <button id="vc-loadmore-btn" class="px-4 py-2 rounded-lg border border-outline-variant text-body-sm font-label-bold text-primary hover:bg-surface-container-low transition-colors">Mostrar más</button>
        <p id="vc-loadmore-info" class="text-[11px] text-on-surface-variant mt-1"></p>
      </div>
    </div>
  `;

  const fromInput = container.querySelector('#vc-from');
  const toInput = container.querySelector('#vc-to');
  const trendCanvas = container.querySelector('#vc-trend-chart');
  const advisorCanvas = container.querySelector('#vc-advisor-chart');
  const tbody = container.querySelector('#vc-tbody');
  const countBadge = container.querySelector('#vc-count-badge');
  const loadmoreWrap = container.querySelector('#vc-loadmore-wrap');
  const loadmoreInfo = container.querySelector('#vc-loadmore-info');
  const loadmoreBtn = container.querySelector('#vc-loadmore-btn');

  let ventas = [];
  let visibleCount = PAGE_SIZE;

  function rangeParams() {
    const params = new URLSearchParams();
    if (fromInput.value) params.set('from', fromInput.value);
    if (toInput.value) params.set('to', toInput.value);
    return params;
  }

  function rowHtml(lead) {
    return `
      <tr class="hover:bg-surface-container-low transition-colors">
        <td class="p-table-cell-padding font-bold">${escapeHtml(lead.client_name)}</td>
        <td class="p-table-cell-padding text-on-surface-variant">${escapeHtml(lead.advisor_name || '—')}</td>
        <td class="p-table-cell-padding text-on-surface-variant">${escapeHtml(lead.product || '—')}</td>
        <td class="p-table-cell-padding text-right font-bold text-secondary">${formatMoney(lead.amount || 0)}</td>
        <td class="p-table-cell-padding text-on-surface-variant">${fechaLabel(lead.closed_at)}</td>
      </tr>`;
  }

  function renderTable() {
    const shown = ventas.slice(0, visibleCount);
    tbody.innerHTML = shown.length
      ? shown.map(rowHtml).join('')
      : `<tr><td colspan="5" class="p-table-cell-padding py-10 text-center text-body-sm text-on-surface-variant">Sin ventas cerradas en este rango.</td></tr>`;
    countBadge.textContent = `${ventas.length} venta${ventas.length === 1 ? '' : 's'}`;
    const remaining = ventas.length - shown.length;
    loadmoreWrap.classList.toggle('hidden', remaining <= 0);
    if (remaining > 0) loadmoreInfo.textContent = `Mostrando ${shown.length} de ${ventas.length} · quedan ${remaining} más`;
  }

  async function loadTrend() {
    let report;
    try {
      report = await ctx.api.get(`/api/kpis/daily-trend?${rangeParams().toString()}`);
    } catch {
      ctx.toast('No se pudo cargar la tendencia de ventas', 'error');
      return;
    }
    if (!fromInput.value) fromInput.value = report.from;
    if (!toInput.value) toInput.value = report.to;
    barChart(trendCanvas, {
      labels: report.trend.map((d) => {
        const [, m, day] = d.fecha.split('-');
        return `${day}/${m}`;
      }),
      data: report.trend.map((d) => d.ventas_monto),
      color: CATEGORICAL_COLORS[0],
      valueFormatter: (v) => formatMoney(v),
    });
  }

  async function loadAdvisorChart() {
    let report;
    try {
      report = await ctx.api.get(`/api/kpis/funnel?${rangeParams().toString()}`);
    } catch {
      ctx.toast('No se pudo cargar el comparativo por asesor', 'error');
      return;
    }
    const rows = report.advisors.filter((a) => a.monto_vendido > 0).sort((a, b) => b.monto_vendido - a.monto_vendido);
    barChart(advisorCanvas, {
      labels: rows.map((a) => a.name),
      data: rows.map((a) => a.monto_vendido),
      color: CATEGORICAL_COLORS[2],
      valueFormatter: (v) => formatMoney(v),
    });
  }

  async function loadTable() {
    visibleCount = PAGE_SIZE;
    const params = new URLSearchParams();
    params.set('status', 'cerrado_ganado');
    // closed_from/closed_to (no from/to): una venta puede cerrarse mucho
    // despues de creado el lead, y lo que importa aqui es cuando se cerro.
    if (fromInput.value) params.set('closed_from', fromInput.value);
    if (toInput.value) params.set('closed_to', toInput.value);
    try {
      ventas = await ctx.api.get(`/api/leads?${params.toString()}`);
    } catch {
      ctx.toast('No se pudo cargar el listado de ventas', 'error');
      return;
    }
    ventas.sort((a, b) => (a.closed_at < b.closed_at ? 1 : -1));
    renderTable();
  }

  async function loadAll() {
    await Promise.all([loadTrend(), loadAdvisorChart(), loadTable()]);
  }

  loadmoreBtn.addEventListener('click', () => {
    visibleCount += PAGE_SIZE;
    renderTable();
  });

  fromInput.addEventListener('change', loadAll);
  toInput.addEventListener('change', loadAll);

  container.querySelector('#btn-quick-sale').addEventListener('click', () => {
    openQuickSaleModal(ctx, () => loadAll());
  });

  const offLeads = ctx.ws.on('leads_changed', loadAll);
  await loadAll();

  return () => {
    offLeads();
    destroyChart(trendCanvas);
    destroyChart(advisorCanvas);
  };
}
