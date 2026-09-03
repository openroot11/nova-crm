import { escapeHtml, formatMoney, statusBadge, LEAD_STATUS_COLORS, copyNameBtn, bindCopyButtons } from '../utils.js';
import { renderPriorityActions } from '../components/priorityActions.js';
import { donutChart, destroyChart } from '../components/charts.js';

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

// Fecha LOCAL de hoy (no UTC): con toISOString() a las 8pm en Bogota (UTC-5)
// ya seria "manana" en UTC, y el panel "Hoy" mostraria el informe equivocado.
function todayIso() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function todayLabel() {
  const label = new Date().toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function canalChip(icon, label, value) {
  return `<span class="inline-flex items-center gap-1 text-body-sm font-body-sm text-on-surface-variant"><span class="material-symbols-outlined text-[15px]">${icon}</span>${label}: <b class="text-on-surface font-semibold">${value}</b></span>`;
}

function asesorRowHtml(a) {
  return `
    <tr class="hover:bg-surface-container-low/50 transition-colors">
      <td class="p-table-cell-padding text-body-md font-semibold text-on-surface">${escapeHtml(a.name)}</td>
      <td class="p-table-cell-padding text-body-md text-on-surface-variant text-right">${a.asignados}</td>
      <td class="p-table-cell-padding text-body-md text-on-surface-variant text-right">${a.contactados}</td>
      <td class="p-table-cell-padding text-body-md text-on-surface-variant text-right">${a.cotizados}</td>
      <td class="p-table-cell-padding text-body-md text-on-surface-variant text-right">${a.pendientes}</td>
      <td class="p-table-cell-padding text-body-md text-on-surface-variant text-right">${a.seguimientos}</td>
    </tr>`;
}

// Mismo criterio de agrupacion que usa el texto de WhatsApp del Informe: una
// linea por asesor con cuantas vendio y por cuanto, no la lista de ventas
// individuales (eso ya esta en la tabla de Leads Recientes de mas abajo).
function groupVentasByAdvisor(ventas) {
  const byAdvisor = new Map();
  for (const v of ventas) {
    const key = v.advisor_name || 'Sin asignar';
    if (!byAdvisor.has(key)) byAdvisor.set(key, { name: key, count: 0, monto: 0 });
    const bucket = byAdvisor.get(key);
    bucket.count += 1;
    bucket.monto += v.monto || 0;
  }
  return [...byAdvisor.values()].sort((x, y) => y.monto - x.monto);
}

export async function mount(container, ctx) {
  const defaults = monthRangeDefaults();

  container.innerHTML = `
    <div class="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-margin-desktop">
      <div>
        <h2 class="text-headline-lg font-headline-lg text-on-surface">Dashboard</h2>
        <p class="text-body-md font-body-md text-on-surface-variant mt-1">Un vistazo rápido al negocio — para el detalle completo, ve a Estadísticas.</p>
      </div>
      <div class="flex items-end gap-3">
        <div>
          <label class="block text-[10px] font-label-bold text-on-surface-variant mb-1 uppercase tracking-wider">Desde</label>
          <input id="dash-from" type="date" value="${defaults.from}" class="p-2 bg-surface-container-lowest border border-outline-variant rounded-md text-body-sm outline-none focus:border-outline" />
        </div>
        <div>
          <label class="block text-[10px] font-label-bold text-on-surface-variant mb-1 uppercase tracking-wider">Hasta</label>
          <input id="dash-to" type="date" value="${defaults.to}" class="p-2 bg-surface-container-lowest border border-outline-variant rounded-md text-body-sm outline-none focus:border-outline" />
        </div>
        <button id="dash-ver-estadisticas" class="px-3 py-2 border border-outline-variant rounded-md text-label-bold font-label-bold text-on-surface hover:bg-surface-container-lowest transition-colors">Ver Estadísticas completas</button>
      </div>
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-3 gap-gutter mb-gutter">
      <div class="lg:col-span-2 bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm overflow-hidden">
        <div class="px-gutter pt-gutter pb-3 flex items-center justify-between flex-wrap gap-3">
          <div class="flex items-center gap-2.5">
            <span class="relative flex h-2 w-2 shrink-0">
              <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-60"></span>
              <span class="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
            </span>
            <h3 class="text-headline-md font-headline-md text-on-surface">Informe del Día</h3>
            <span class="text-body-sm font-body-sm text-on-surface-variant">${todayLabel()}</span>
          </div>
          <div class="flex items-center gap-4 flex-wrap">
            <div id="dash-canales" class="flex items-center gap-3"></div>
            <button id="dash-ver-informe" class="text-[11px] font-label-bold text-on-surface hover:underline whitespace-nowrap">Ver informe completo</button>
          </div>
        </div>

        <div class="overflow-x-auto border-t border-outline-variant">
          <table class="w-full text-left border-collapse min-w-[480px]">
            <thead>
              <tr class="bg-surface-container-low border-b border-outline-variant">
                <th class="p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase tracking-wider">Asesor</th>
                <th class="p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase tracking-wider text-right">Asignados</th>
                <th class="p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase tracking-wider text-right">Contactados</th>
                <th class="p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase tracking-wider text-right">Cotizados</th>
                <th class="p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase tracking-wider text-right">Pendientes</th>
                <th class="p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase tracking-wider text-right">Seguimientos</th>
              </tr>
            </thead>
            <tbody id="dash-informe-tbody" class="divide-y divide-outline-variant"></tbody>
          </table>
        </div>

        <div id="dash-informe-footer" class="px-gutter py-3.5 border-t border-outline-variant bg-surface-container-low flex flex-wrap items-center justify-between gap-3"></div>
      </div>

      <div class="bg-surface-container-lowest border border-outline-variant rounded-xl p-gutter shadow-sm flex flex-col">
        <h3 class="text-headline-md font-headline-md text-on-surface mb-1">Estado de Leads</h3>
        <p class="text-body-sm font-body-sm text-on-surface-variant mb-4">Leads agregados hoy en Registro Operativo</p>
        <div class="flex-1 flex flex-col items-center justify-center">
          <div class="relative w-40 h-40">
            <canvas id="dash-donut-chart"></canvas>
            <div class="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <span id="dash-donut-total" class="text-headline-lg font-headline-lg text-on-surface font-bold">0</span>
              <span class="text-label-bold font-label-bold text-on-surface-variant">Leads Hoy</span>
            </div>
          </div>
          <div id="dash-donut-legend" class="w-full mt-6 space-y-2"></div>
        </div>
      </div>
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-3 gap-gutter mb-gutter">
      <div class="lg:col-span-2 bg-surface-container-lowest border border-outline-variant rounded-xl p-gutter shadow-sm">
        <h3 class="text-headline-md font-headline-md text-on-surface mb-1">Acciones Prioritarias</h3>
        <p class="text-body-sm font-body-sm text-on-surface-variant mb-3">Lo que necesita atención ya.</p>
        <div id="dash-priority"></div>
      </div>

      <div class="bg-surface-container-lowest border border-outline-variant rounded-xl p-gutter shadow-sm">
        <div class="flex items-center justify-between mb-1">
          <h3 class="text-headline-md font-headline-md text-on-surface">Equipo</h3>
          <span id="dash-asignados-total" class="text-body-sm font-body-sm text-on-surface-variant">0 total</span>
        </div>
        <p class="text-body-sm font-body-sm text-on-surface-variant mb-4">Leads asignados por asesor en el periodo</p>
        <div id="dash-asignados-bars" class="space-y-3"></div>
      </div>
    </div>

    <div class="bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm overflow-hidden">
      <div class="p-gutter border-b border-outline-variant flex items-center justify-between">
        <h3 class="text-headline-md font-headline-md text-on-surface">Leads Recientes</h3>
        <button id="dash-ver-ventas" class="text-[11px] font-label-bold text-on-surface hover:underline">Ver todos en Ventas</button>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full text-left border-collapse min-w-[760px]">
          <thead>
            <tr class="bg-surface-container-low border-b border-outline-variant">
              <th class="p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase tracking-wider">Fecha</th>
              <th class="p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase tracking-wider">Cliente</th>
              <th class="p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase tracking-wider">Producto</th>
              <th class="p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase tracking-wider">Asesor</th>
              <th class="p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase tracking-wider">Estado</th>
            </tr>
          </thead>
          <tbody id="dash-recent-tbody" class="divide-y divide-outline-variant"></tbody>
        </table>
      </div>
    </div>
  `;

  const asignadosBars = container.querySelector('#dash-asignados-bars');
  const asignadosTotal = container.querySelector('#dash-asignados-total');
  const priorityRoot = container.querySelector('#dash-priority');
  const recentTbody = container.querySelector('#dash-recent-tbody');
  const fromInput = container.querySelector('#dash-from');
  const toInput = container.querySelector('#dash-to');
  const informeTbody = container.querySelector('#dash-informe-tbody');
  const informeFooter = container.querySelector('#dash-informe-footer');
  const canalesEl = container.querySelector('#dash-canales');
  const donutCanvas = container.querySelector('#dash-donut-chart');
  const donutTotal = container.querySelector('#dash-donut-total');
  const donutLegend = container.querySelector('#dash-donut-legend');

  // "Equipo": leads asignados por asesor en el rango de fechas elegido
  // arriba (por defecto el mes en curso) -- distinto de "Informe del Dia"
  // (loadHoy), que siempre es HOY sin importar ese rango.
  async function loadEquipo() {
    let funnel;
    try {
      funnel = await ctx.api.get(`/api/kpis/funnel?from=${fromInput.value}&to=${toInput.value}`);
    } catch (err) {
      console.error('Dashboard: error cargando el equipo', err);
      ctx.toast('No se pudo cargar el resumen del equipo', 'error');
      return;
    }

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
  }

  // "Informe del Dia": mismos datos que la pestaña Informe (GET
  // /api/informe/:fecha, ya calculados en vivo desde los leads reales) --
  // mismo desglose por asesor y ventas del texto que se copia para WhatsApp,
  // resumido aqui para no obligar a salir del Dashboard a ver que paso hoy.
  async function loadHoy() {
    let informe;
    try {
      informe = await ctx.api.get(`/api/informe/${todayIso()}`);
    } catch (err) {
      console.error('Dashboard: error cargando el informe de hoy', err);
      return;
    }

    canalesEl.innerHTML = [
      canalChip('forum', 'WhatsApp', informe.canales.whatsapp),
      canalChip('mail', 'Correo', informe.canales.correo),
      canalChip('call', 'Llamadas', informe.canales.llamadas),
    ].join('');

    informeTbody.innerHTML = informe.asesores.length
      ? informe.asesores.map(asesorRowHtml).join('') +
        `<tr class="bg-surface-container-low font-bold">
          <td class="p-table-cell-padding text-on-surface">Total</td>
          <td class="p-table-cell-padding text-on-surface text-right">${informe.totales.asignados}</td>
          <td class="p-table-cell-padding text-on-surface text-right">${informe.totales.contactados}</td>
          <td class="p-table-cell-padding text-on-surface text-right">${informe.totales.cotizados}</td>
          <td class="p-table-cell-padding text-on-surface text-right">${informe.totales.pendientes}</td>
          <td class="p-table-cell-padding text-on-surface text-right">${informe.totales.seguimientos}</td>
        </tr>`
      : `<tr><td colspan="6" class="p-table-cell-padding py-6 text-center text-body-sm text-on-surface-variant">No hay asesores activos.</td></tr>`;

    const porAsesor = groupVentasByAdvisor(informe.ventas);
    const ventasChips = porAsesor.length
      ? porAsesor
          .map(
            (v) =>
              `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-surface text-body-sm font-body-sm border border-outline-variant"><b class="text-on-surface">${escapeHtml(v.name)}</b><span class="text-on-surface-variant">${v.count} · ${formatMoney(v.monto)}</span></span>`
          )
          .join('')
      : `<span class="text-body-sm font-body-sm text-on-surface-variant">Sin ventas registradas hoy.</span>`;

    informeFooter.innerHTML = `
      <div class="flex items-center gap-1.5 text-body-sm font-body-sm text-on-surface-variant">
        <span class="material-symbols-outlined text-[16px]">swap_horiz</span>
        Reasignados: <b class="text-on-surface">${informe.reasignados.count}</b>
      </div>
      <div class="flex items-center gap-2 flex-wrap">
        ${ventasChips}
        ${
          informe.totales.ventas_count > 0
            ? `<span class="flex items-center gap-1.5 pl-3 ml-1 border-l border-outline-variant">
                <span class="material-symbols-outlined text-[18px] text-on-surface">paid</span>
                <span class="text-headline-sm font-headline-sm text-on-surface">${formatMoney(informe.totales.ventas_total)}</span>
              </span>`
            : ''
        }
      </div>
    `;

    // "Estado de Leads": mismo componente (dona + leyenda) que "Estado
    // Leads" de Estadisticas, pero acotado a los leads agregados HOY en
    // Registro Operativo -- no el pipeline historico completo.
    const totalHoy = informe.total_leads_hoy || 0;
    const distHoy = informe.lead_status_distribution.filter((d) => d.count > 0);
    donutTotal.textContent = totalHoy;
    donutChart(donutCanvas, {
      labels: distHoy.map((d) => d.label),
      data: distHoy.map((d) => d.count),
      colors: distHoy.map((d) => LEAD_STATUS_COLORS[d.status] || '#8a8578'),
      showLegend: false,
    });
    donutLegend.innerHTML = informe.lead_status_distribution
      .map((d) => {
        const pct = totalHoy > 0 ? Math.round((d.count / totalHoy) * 1000) / 10 : 0;
        return `
        <div class="flex justify-between items-center text-body-sm font-body-sm">
          <div class="flex items-center space-x-2">
            <div class="w-3 h-3 rounded-sm" style="background:${LEAD_STATUS_COLORS[d.status] || '#8a8578'}"></div>
            <span class="text-on-surface">${escapeHtml(d.label)}</span>
          </div>
          <span class="font-bold text-on-surface">${pct}% (${d.count})</span>
        </div>`;
      })
      .join('');
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
            <td class="p-table-cell-padding text-body-md font-semibold text-on-surface">
              <div class="flex items-center gap-1.5">
                <span>${escapeHtml(l.client_name)}</span>
                ${copyNameBtn(l.client_name)}
              </div>
            </td>
            <td class="p-table-cell-padding text-body-md text-on-surface-variant">${escapeHtml(l.product || '—')}</td>
            <td class="p-table-cell-padding text-body-md text-on-surface">${escapeHtml(l.advisor_name || 'Sin asignar')}</td>
            <td class="p-table-cell-padding"><span class="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold ${b.badgeClass}">${b.label}</span></td>
          </tr>`;
          })
          .join('')
      : `<tr><td colspan="5" class="p-table-cell-padding py-8 text-center text-body-sm text-on-surface-variant">Sin leads en este rango.</td></tr>`;
    bindCopyButtons(recentTbody, ctx);
  }

  function loadAll() {
    loadEquipo();
    loadHoy();
    loadRecentLeads();
    renderPriorityActions(priorityRoot, ctx, loadAll);
  }

  fromInput.addEventListener('change', loadAll);
  toInput.addEventListener('change', loadAll);
  container.querySelector('#dash-ver-estadisticas').addEventListener('click', () => ctx.navigate('estadisticas'));
  container.querySelector('#dash-ver-ventas').addEventListener('click', () => ctx.navigate('ventas'));
  container.querySelector('#dash-ver-informe').addEventListener('click', () => ctx.navigate('informe'));

  const off = ctx.ws.on('leads_changed', loadAll);
  await loadAll();

  return () => {
    off();
    destroyChart(donutCanvas);
  };
}
