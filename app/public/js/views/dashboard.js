import { escapeHtml, formatMoney, formatCompactMoney, statusBadge, LEAD_STATUS_COLORS } from '../utils.js';
import { renderColombiaMap } from '../components/colombiaMap.js';
import { kpiTile } from '../components/kpiTile.js';
import { barChart, donutChart, gaugeChart, destroyChart } from '../components/charts.js';
import { renderPriorityActions } from '../components/priorityActions.js';
import { openModal } from '../components/modal.js';

const MONTH_LABELS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

function monthRangeDefaults() {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
  return { from, to };
}

function timeLabel(sqlDatetime) {
  const d = new Date(sqlDatetime.replace(' ', 'T') + 'Z');
  return d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short' });
}

export async function mount(container, ctx) {
  const defaults = monthRangeDefaults();
  const canEditTarget = ctx.user?.role === 'admin';

  container.innerHTML = `
    <div class="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-margin-desktop">
      <div>
        <h2 class="text-headline-lg font-headline-lg text-on-surface">Dashboard</h2>
        <p class="text-body-md font-body-md text-on-surface-variant mt-1">Un vistazo rápido al negocio — para el detalle completo, ve a Estadísticas.</p>
      </div>
      <div class="flex items-end gap-3">
        <div>
          <label class="block text-[10px] font-label-bold text-on-surface-variant mb-1 uppercase tracking-wider">Desde</label>
          <input id="dash-from" type="date" value="${defaults.from}" class="p-2 bg-surface-container-lowest border border-outline-variant rounded-md text-body-sm outline-none focus:border-primary" />
        </div>
        <div>
          <label class="block text-[10px] font-label-bold text-on-surface-variant mb-1 uppercase tracking-wider">Hasta</label>
          <input id="dash-to" type="date" value="${defaults.to}" class="p-2 bg-surface-container-lowest border border-outline-variant rounded-md text-body-sm outline-none focus:border-primary" />
        </div>
        <button id="dash-ver-estadisticas" class="px-3 py-2 border border-outline-variant rounded-md text-label-bold font-label-bold text-primary hover:bg-surface-container-lowest transition-colors">Ver Estadísticas completas</button>
      </div>
    </div>

    <div id="dash-kpi-grid" class="grid grid-cols-1 md:grid-cols-4 gap-gutter mb-gutter"></div>

    <div class="grid grid-cols-1 lg:grid-cols-3 gap-gutter mb-gutter">
      <div class="lg:col-span-2 bg-surface-container-lowest border border-outline-variant rounded-xl p-gutter shadow-sm">
        <h3 class="text-headline-md font-headline-md text-on-surface mb-1">Rendimiento de Ventas</h3>
        <p class="text-body-sm font-body-sm text-on-surface-variant mb-3">Monto vendido por mes, últimos 6 meses.</p>
        <div style="height:220px;"><canvas id="dash-trend-chart"></canvas></div>
      </div>
      <div class="bg-surface-container-lowest border border-outline-variant rounded-xl p-gutter shadow-sm">
        <h3 class="text-headline-md font-headline-md text-on-surface mb-1">Distribución del Embudo</h3>
        <p class="text-body-sm font-body-sm text-on-surface-variant mb-3">Leads por estado (histórico total).</p>
        <div style="height:220px;"><canvas id="dash-status-donut"></canvas></div>
      </div>
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-3 gap-gutter mb-gutter">
      <div class="lg:col-span-2 bg-surface-container-lowest border border-outline-variant rounded-xl p-gutter shadow-sm">
        <div class="flex items-center justify-between mb-1">
          <div>
            <h3 class="text-headline-md font-headline-md text-on-surface">Leads por Ciudad</h3>
            <p class="text-body-sm font-body-sm text-on-surface-variant">Tamaño = volumen de leads · Color = producto más vendido en esa ciudad</p>
          </div>
        </div>
        <div id="dash-map" class="mt-4"></div>
      </div>

      <div class="bg-surface-container-lowest border border-outline-variant rounded-xl p-gutter shadow-sm flex flex-col">
        <div class="flex items-center justify-between mb-1">
          <h3 class="text-headline-md font-headline-md text-on-surface">Meta de Ventas</h3>
          ${canEditTarget ? `<button id="dash-edit-target" class="text-[11px] font-label-bold text-primary hover:underline">Editar</button>` : ''}
        </div>
        <p class="text-body-sm font-body-sm text-on-surface-variant mb-2">Mes en curso</p>
        <div id="dash-target-body" class="flex-1 flex flex-col items-center justify-center"></div>
      </div>
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-3 gap-gutter mb-gutter">
      <div class="lg:col-span-2 bg-surface-container-lowest border border-outline-variant rounded-xl p-gutter shadow-sm">
        <div class="flex items-center justify-between mb-1">
          <h3 class="text-headline-md font-headline-md text-on-surface">Equipo</h3>
          <span id="dash-asignados-total" class="text-body-sm font-body-sm text-on-surface-variant">0 total</span>
        </div>
        <p class="text-body-sm font-body-sm text-on-surface-variant mb-4">Leads asignados por asesor en el periodo</p>
        <div id="dash-asignados-bars" class="space-y-3"></div>
      </div>

      <div class="bg-surface-container-lowest border border-outline-variant rounded-xl p-gutter shadow-sm">
        <h3 class="text-headline-md font-headline-md text-on-surface mb-1">Acciones Prioritarias</h3>
        <p class="text-body-sm font-body-sm text-on-surface-variant mb-3">Lo que necesita atención ya.</p>
        <div id="dash-priority"></div>
      </div>
    </div>

    <div class="bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm overflow-hidden">
      <div class="p-gutter border-b border-outline-variant flex items-center justify-between">
        <h3 class="text-headline-md font-headline-md text-on-surface">Leads Recientes</h3>
        <button id="dash-ver-ventas" class="text-[11px] font-label-bold text-primary hover:underline">Ver todos en Ventas</button>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full text-left border-collapse min-w-[640px]">
          <thead>
            <tr class="bg-surface-container-low border-b border-outline-variant">
              <th class="p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase tracking-wider">Fecha</th>
              <th class="p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase tracking-wider">Cliente</th>
              <th class="p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase tracking-wider">Asesor</th>
              <th class="p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase tracking-wider">Estado</th>
            </tr>
          </thead>
          <tbody id="dash-recent-tbody" class="divide-y divide-outline-variant"></tbody>
        </table>
      </div>
    </div>
  `;

  const kpiGrid = container.querySelector('#dash-kpi-grid');
  const dashMap = container.querySelector('#dash-map');
  const asignadosBars = container.querySelector('#dash-asignados-bars');
  const asignadosTotal = container.querySelector('#dash-asignados-total');
  const priorityRoot = container.querySelector('#dash-priority');
  const targetBody = container.querySelector('#dash-target-body');
  const recentTbody = container.querySelector('#dash-recent-tbody');
  const fromInput = container.querySelector('#dash-from');
  const toInput = container.querySelector('#dash-to');

  let lastOverview = null;

  function renderTargetBody(overview) {
    const target = overview.monthly_sales_target;
    const current = overview.total_sales_month;
    if (!target) {
      targetBody.innerHTML = `
        <span class="material-symbols-outlined text-4xl text-on-surface-variant opacity-40 mb-2">track_changes</span>
        <p class="text-body-sm text-on-surface-variant text-center">${canEditTarget ? 'Aún no hay una meta configurada.' : 'Meta mensual no configurada.'}</p>
      `;
      return;
    }
    const pct = Math.min(100, Math.round((current / target) * 1000) / 10);
    targetBody.innerHTML = `
      <div class="relative w-[140px] h-[140px]">
        <canvas id="dash-target-gauge"></canvas>
        <div class="absolute inset-0 flex flex-col items-center justify-center">
          <span class="text-headline-md font-headline-md font-extrabold text-on-surface">${pct}%</span>
          <span class="text-[10px] text-on-surface-variant">completado</span>
        </div>
      </div>
      <p class="text-body-sm font-bold text-on-surface mt-3">${formatMoney(current)}</p>
      <p class="text-[11px] text-on-surface-variant">de ${formatMoney(target)} meta</p>
    `;
    gaugeChart(targetBody.querySelector('#dash-target-gauge'), { value: current, max: target, color: '#0f7a5c' });
  }

  function openEditTargetModal() {
    openModal({
      title: 'Meta de ventas mensual',
      render: (body, { close }) => {
        body.innerHTML = `
          <label class="block text-label-bold font-label-bold uppercase tracking-wide text-on-surface-variant mb-1">Meta del mes (COP)</label>
          <input id="target-amount" type="number" min="0" step="100000" value="${lastOverview?.monthly_sales_target || ''}" placeholder="Ej. 50000000" class="w-full p-2.5 border border-outline-variant rounded-md mb-4 outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" />
          <div class="flex justify-end gap-2">
            <button id="target-cancel" class="px-4 py-2 rounded-lg border border-outline-variant hover:bg-surface-container-low">Cancelar</button>
            <button id="target-ok" class="px-4 py-2 rounded-lg bg-primary text-on-primary font-bold hover:bg-on-primary-fixed-variant">Guardar</button>
          </div>
        `;
        body.querySelector('#target-cancel').addEventListener('click', close);
        body.querySelector('#target-ok').addEventListener('click', async () => {
          const amount = body.querySelector('#target-amount').value;
          try {
            await ctx.api.put('/api/settings', { monthly_sales_target: amount });
            ctx.toast('Meta actualizada', 'success');
            close();
            loadKpis();
          } catch (err) {
            ctx.toast(err.message, 'error');
          }
        });
      },
    });
  }

  async function loadKpis() {
    let overview;
    let funnel;
    try {
      [overview, funnel] = await Promise.all([
        ctx.api.get('/api/kpis'),
        ctx.api.get(`/api/kpis/funnel?from=${fromInput.value}&to=${toInput.value}`),
      ]);
    } catch (err) {
      console.error('Dashboard: error cargando KPIs', err);
      ctx.toast('No se pudieron cargar los indicadores', 'error');
      return;
    }
    lastOverview = overview;

    kpiGrid.innerHTML = [
      kpiTile(
        'Total Ventas (mes actual)',
        `<span title="${formatMoney(overview.total_sales_month)}">${formatCompactMoney(overview.total_sales_month)}</span>`,
        `${overview.total_sales_growth_pct >= 0 ? '+' : ''}${overview.total_sales_growth_pct}% vs. mes anterior`,
        'attach_money',
        'text-primary'
      ),
      kpiTile('Tasa de Cierre (periodo)', `${funnel.totals.tasa_cierre}%`, `${funnel.totals.vendidos} ventas de ${funnel.totals.cotizados} cotizados`, 'trending_up', 'text-secondary'),
      kpiTile('Leads Críticos SLA', overview.critical_leads_count, overview.critical_leads_advisors.length ? escapeHtml(overview.critical_leads_advisors.join(', ')) : 'Todo bajo control', 'assignment_late', 'text-error'),
      kpiTile('Asignados (periodo)', funnel.totals.asignados, `${funnel.totals.pendientes_por_cotizar} sin cotizar aún`, 'group', 'text-tertiary'),
    ].join('');

    const total = funnel.advisors.reduce((s, a) => s + a.asignados, 0);
    asignadosTotal.textContent = `${total} total`;
    const sorted = [...funnel.advisors].sort((a, b) => b.asignados - a.asignados);
    asignadosBars.innerHTML = sorted.length
      ? sorted
          .map((a) => {
            const pct = total ? Math.round((a.asignados / total) * 1000) / 10 : 0;
            return `
          <div>
            <div class="flex justify-between text-body-sm mb-1">
              <span class="font-semibold text-on-surface">${escapeHtml(a.name)}</span>
              <span class="text-on-surface-variant">${a.asignados} · ${pct}%</span>
            </div>
            <div class="h-2 bg-surface-container-low rounded-full overflow-hidden">
              <div class="h-full bg-primary rounded-full" style="width:${Math.max(2, pct)}%"></div>
            </div>
          </div>`;
          })
          .join('')
      : `<p class="text-body-sm text-on-surface-variant text-center py-6">No hay asesores activos.</p>`;

    barChart(container.querySelector('#dash-trend-chart'), {
      labels: overview.monthly_trend.map((m) => MONTH_LABELS[Number(m.mes.slice(5, 7)) - 1]),
      data: overview.monthly_trend.map((m) => m.ventas_monto),
      color: '#0f7a5c',
      valueFormatter: formatCompactMoney,
    });

    const dist = overview.lead_status_distribution.filter((d) => d.count > 0);
    donutChart(container.querySelector('#dash-status-donut'), {
      labels: dist.map((d) => d.label),
      data: dist.map((d) => d.count),
      colors: dist.map((d) => LEAD_STATUS_COLORS[d.status] || '#8a8578'),
    });

    renderTargetBody(overview);
  }

  async function loadMap() {
    let geo;
    try {
      geo = await ctx.api.get(`/api/kpis/geo?from=${fromInput.value}&to=${toInput.value}`);
    } catch (err) {
      console.error('Dashboard: error cargando el mapa', err);
      ctx.toast('No se pudo cargar el mapa de leads', 'error');
      return;
    }
    renderColombiaMap(dashMap, geo.cities);
  }

  async function loadRecentLeads() {
    let leads;
    try {
      leads = await ctx.api.get(`/api/leads?from=${fromInput.value}&to=${toInput.value}`);
    } catch (err) {
      console.error('Dashboard: error cargando leads recientes', err);
      return;
    }
    const recent = [...leads].sort((a, b) => (a.created_at < b.created_at ? 1 : -1)).slice(0, 8);
    recentTbody.innerHTML = recent.length
      ? recent
          .map((l) => {
            const b = statusBadge(l.status);
            return `
          <tr class="hover:bg-surface-container-low/50 transition-colors">
            <td class="p-table-cell-padding text-body-sm text-on-surface-variant whitespace-nowrap">${timeLabel(l.created_at)}</td>
            <td class="p-table-cell-padding text-body-md font-semibold text-on-surface">${escapeHtml(l.client_name)}</td>
            <td class="p-table-cell-padding text-body-md text-on-surface">${escapeHtml(l.advisor_name || 'Sin asignar')}</td>
            <td class="p-table-cell-padding"><span class="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold ${b.badgeClass}">${b.label}</span></td>
          </tr>`;
          })
          .join('')
      : `<tr><td colspan="4" class="p-table-cell-padding py-8 text-center text-body-sm text-on-surface-variant">Sin leads en este rango.</td></tr>`;
  }

  function loadAll() {
    loadKpis();
    loadMap();
    loadRecentLeads();
    renderPriorityActions(priorityRoot, ctx, loadAll);
  }

  fromInput.addEventListener('change', loadAll);
  toInput.addEventListener('change', loadAll);
  container.querySelector('#dash-ver-estadisticas').addEventListener('click', () => ctx.navigate('estadisticas'));
  container.querySelector('#dash-ver-ventas').addEventListener('click', () => ctx.navigate('ventas'));
  if (canEditTarget) {
    container.querySelector('#dash-edit-target').addEventListener('click', openEditTargetModal);
  }

  const off = ctx.ws.on('leads_changed', loadAll);
  await loadAll();

  return () => {
    off();
    destroyChart(container.querySelector('#dash-trend-chart'));
    destroyChart(container.querySelector('#dash-status-donut'));
    destroyChart(container.querySelector('#dash-target-gauge'));
  };
}
