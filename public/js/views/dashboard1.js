import { escapeHtml, formatMoney, formatCompactMoney } from '../utils.js';
import { barChart, destroyChart, CATEGORICAL_COLORS } from '../components/charts.js';

// "Dashboard 1" -- el resumen de gerencia: pocos números, grandes, sin
// tablas largas ni gráficas de detalle. Lo que le importa al dueño: cuánto
// se vendió, el ticket promedio, y el rendimiento por asesor. El detalle
// completo (embudo, rentabilidad de ads, promedios por día, notas por
// asesor) vive en la pestaña "Reporte". Lo ven admin y coordinador.
//
// Se alimenta de GET /api/kpis/funnel (mismo endpoint que ya usa el
// comparativo de asesores en Estadísticas), así que no necesita permisos
// nuevos ni cálculos nuevos en el backend.

function monthRangeDefaults() {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
  return { from, to };
}

function rangeLabel(from, to) {
  const f = new Date(`${from}T00:00:00`);
  const t = new Date(`${to}T00:00:00`);
  const opts = { day: 'numeric', month: 'long' };
  const sameMonth = f.getMonth() === t.getMonth() && f.getFullYear() === t.getFullYear();
  if (sameMonth) {
    const label = f.toLocaleDateString('es-CO', { month: 'long', year: 'numeric' });
    return label.charAt(0).toUpperCase() + label.slice(1);
  }
  return `${f.toLocaleDateString('es-CO', opts)} – ${t.toLocaleDateString('es-CO', opts)}`;
}

function kpiCard(label, value, sub) {
  return `
    <div class="bg-surface-container-lowest border border-outline-variant rounded-xl p-gutter shadow-sm">
      <p class="text-label-bold font-label-bold text-on-surface-variant uppercase tracking-wider mb-2">${label}</p>
      <p class="text-display-kpi font-display-kpi text-on-surface leading-none">${value}</p>
      ${sub ? `<p class="text-body-sm font-body-sm text-on-surface-variant mt-2">${sub}</p>` : ''}
    </div>`;
}

function indicatorTile(label, value, sub, icon) {
  return `
    <div class="border border-outline-variant rounded-xl p-3">
      <div class="flex items-center gap-1.5 mb-1">
        <span class="material-symbols-outlined text-[15px] text-on-surface-variant">${icon}</span>
        <p class="text-[9.5px] font-label-bold text-on-surface-variant uppercase tracking-wider leading-tight">${label}</p>
      </div>
      <p class="text-headline-sm font-headline-sm text-on-surface">${value}</p>
      <p class="text-[11px] text-on-surface-variant mt-0.5">${sub}</p>
    </div>`;
}

export async function mount(container, ctx) {
  const defaults = monthRangeDefaults();
  const canGoToReporte = ctx.user?.role === 'admin';

  container.innerHTML = `
    <div class="flex flex-wrap justify-between items-end gap-4 mb-margin-desktop">
      <div>
        <h2 class="text-headline-lg font-headline-lg text-on-surface">Dashboard 1</h2>
        <p class="text-body-md font-body-md text-on-surface-variant mt-1">Resumen de gerencia — <span id="d1-periodo">—</span></p>
      </div>
      <div class="flex items-end gap-3 flex-wrap">
        <div>
          <label class="block text-[10px] font-label-bold text-on-surface-variant mb-1 uppercase tracking-wider">Desde</label>
          <input id="d1-from" type="date" value="${defaults.from}" class="p-2 bg-surface-container-lowest border border-outline-variant rounded-md text-body-sm outline-none focus:border-outline" />
        </div>
        <div>
          <label class="block text-[10px] font-label-bold text-on-surface-variant mb-1 uppercase tracking-wider">Hasta</label>
          <input id="d1-to" type="date" value="${defaults.to}" class="p-2 bg-surface-container-lowest border border-outline-variant rounded-md text-body-sm outline-none focus:border-outline" />
        </div>
        ${
          canGoToReporte
            ? `<button id="d1-ver-reporte" class="px-3 py-2 border border-outline-variant rounded-md text-label-bold font-label-bold text-on-surface hover:bg-surface-container-low transition-colors flex items-center gap-1.5">
                 <span class="material-symbols-outlined text-[16px]">assessment</span> Ver reporte completo
               </button>`
            : ''
        }
      </div>
    </div>

    <div id="d1-loading" class="p-10 text-center text-on-surface-variant">Cargando…</div>

    <div id="d1-content" class="hidden">
      <div id="d1-kpis" class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-gutter mb-gutter"></div>

      <p class="text-[10px] font-label-bold text-on-surface-variant uppercase tracking-wider mb-2">Indicadores de desempeño</p>
      <div id="d1-indicadores" class="grid grid-cols-2 md:grid-cols-5 gap-3 mb-margin-desktop"></div>

      <div class="grid grid-cols-1 lg:grid-cols-5 gap-gutter">
        <div class="lg:col-span-3 bg-surface-container-lowest border border-outline-variant rounded-xl p-gutter shadow-sm">
          <h3 class="text-headline-md font-headline-md text-on-surface mb-1">Rendimiento por asesor</h3>
          <p class="text-body-sm font-body-sm text-on-surface-variant mb-4">Ordenado por monto vendido en el periodo.</p>
          <div class="overflow-x-auto">
            <table class="w-full text-left border-collapse min-w-[620px]">
              <thead>
                <tr class="bg-surface-container-low border-b border-outline-variant">
                  <th class="p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase tracking-wider text-center">#</th>
                  <th class="p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase tracking-wider">Asesor</th>
                  <th class="p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase tracking-wider text-center">Asignados</th>
                  <th class="p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase tracking-wider text-center">Ventas</th>
                  <th class="p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase tracking-wider text-center">% Cierre</th>
                  <th class="p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase tracking-wider text-right">Ticket</th>
                  <th class="p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase tracking-wider text-right">Monto vendido</th>
                </tr>
              </thead>
              <tbody id="d1-asesores-tbody" class="divide-y divide-outline-variant"></tbody>
              <tfoot><tr id="d1-asesores-total" class="bg-surface-container-low font-bold"></tr></tfoot>
            </table>
          </div>
        </div>

        <div class="lg:col-span-2 bg-surface-container-lowest border border-outline-variant rounded-xl p-gutter shadow-sm flex flex-col">
          <h3 class="text-headline-md font-headline-md text-on-surface mb-1">Monto vendido por asesor</h3>
          <p class="text-body-sm font-body-sm text-on-surface-variant mb-4">Participación en las ventas del periodo.</p>
          <div class="flex-1" style="min-height:240px;"><canvas id="d1-chart"></canvas></div>
        </div>
      </div>
    </div>
  `;

  const fromInput = container.querySelector('#d1-from');
  const toInput = container.querySelector('#d1-to');
  const periodoEl = container.querySelector('#d1-periodo');
  const loadingEl = container.querySelector('#d1-loading');
  const contentEl = container.querySelector('#d1-content');
  const kpisEl = container.querySelector('#d1-kpis');
  const indicadoresEl = container.querySelector('#d1-indicadores');
  const asesoresTbody = container.querySelector('#d1-asesores-tbody');
  const asesoresTotal = container.querySelector('#d1-asesores-total');
  const chartCanvas = container.querySelector('#d1-chart');

  function asesorRow(a, montoTotal) {
    const ticket = a.vendidos ? Math.round(a.monto_vendido / a.vendidos) : 0;
    const participacion = montoTotal ? Math.round((a.monto_vendido / montoTotal) * 1000) / 10 : 0;
    const rankBadge =
      a.rank === 1
        ? '<span class="inline-flex items-center justify-center w-6 h-6 rounded-full bg-secondary text-on-secondary font-bold text-body-sm">1</span>'
        : `<span class="text-on-surface-variant font-bold">${a.rank}</span>`;
    return `
      <tr>
        <td class="p-table-cell-padding text-center">${rankBadge}</td>
        <td class="p-table-cell-padding text-body-md font-semibold text-on-surface">${escapeHtml(a.name)}</td>
        <td class="p-table-cell-padding text-center">${a.asignados}</td>
        <td class="p-table-cell-padding text-center text-secondary font-bold">${a.vendidos}</td>
        <td class="p-table-cell-padding text-center">${a.tasa_cierre}%</td>
        <td class="p-table-cell-padding text-right">${formatMoney(ticket)}</td>
        <td class="p-table-cell-padding text-right font-bold">${formatMoney(a.monto_vendido)}<span class="block text-[10px] font-normal text-on-surface-variant">${participacion}% del total</span></td>
      </tr>`;
  }

  async function load() {
    periodoEl.textContent = rangeLabel(fromInput.value, toInput.value);
    loadingEl.classList.remove('hidden');
    loadingEl.textContent = 'Cargando…';
    contentEl.classList.add('hidden');

    let data;
    try {
      data = await ctx.api.get(`/api/kpis/funnel?from=${fromInput.value}&to=${toInput.value}`);
    } catch (err) {
      loadingEl.textContent = 'No se pudo cargar el resumen.';
      ctx.toast(err.message || 'No se pudo cargar el resumen', 'error');
      return;
    }

    const t = data.totals;
    const ticket = t.vendidos ? Math.round(t.monto_vendido / t.vendidos) : 0;

    kpisEl.innerHTML = [
      kpiCard('Ventas', t.vendidos, `${t.tasa_cierre}% tasa de cierre`),
      kpiCard('Monto vendido', formatMoney(t.monto_vendido), `Prom. ${formatMoney(ticket)} / venta`),
      kpiCard('Ticket de venta', formatMoney(ticket), 'Monto promedio por venta'),
      kpiCard('Leads asignados', t.asignados, `${t.cotizados} cotizados · ${t.cotizados_sobre_asignados}%`),
    ].join('');

    indicadoresEl.innerHTML = [
      indicatorTile('Efectividad Asesores', `${t.efectividad_asesor}%`, `${t.vendidos} de ${t.asignados} asignados`, 'military_tech'),
      indicatorTile('Cotizados / Asignados', `${t.cotizados_sobre_asignados}%`, `${t.cotizados} de ${t.asignados}`, 'request_quote'),
      indicatorTile('Prom. Semanal sin Cotizar', t.prom_semanal_sin_cotizar, 'leads pendientes por semana', 'schedule'),
      indicatorTile('Tasa de Reasignados', `${t.tasa_reasignados}%`, `${t.reasignados} de ${t.asignados}`, 'sync_problem'),
      indicatorTile('Tasa de Cierre', `${t.tasa_cierre}%`, `${t.vendidos} de ${t.cotizados} cotizados`, 'trending_up'),
    ].join('');

    // Solo asesores con movimiento en el periodo -- una fila entera en cero
    // (asesor nuevo o inactivo) es ruido en un resumen.
    const ranked = data.advisors.filter((a) => a.asignados > 0 || a.vendidos > 0).sort((a, b) => a.rank - b.rank);
    asesoresTbody.innerHTML = ranked.length
      ? ranked.map((a) => asesorRow(a, t.monto_vendido)).join('')
      : `<tr><td colspan="7" class="p-table-cell-padding py-8 text-center text-body-sm text-on-surface-variant">No hay asesores activos.</td></tr>`;
    asesoresTotal.innerHTML = `
      <td class="p-table-cell-padding"></td>
      <td class="p-table-cell-padding">Total</td>
      <td class="p-table-cell-padding text-center">${t.asignados}</td>
      <td class="p-table-cell-padding text-center">${t.vendidos}</td>
      <td class="p-table-cell-padding text-center">${t.tasa_cierre}%</td>
      <td class="p-table-cell-padding text-right">${formatMoney(ticket)}</td>
      <td class="p-table-cell-padding text-right">${formatMoney(t.monto_vendido)}</td>`;

    // Mostrar el contenido ANTES de dibujar la gráfica: Chart.js necesita
    // que el canvas ya tenga tamaño en pantalla, si no renderiza vacío.
    loadingEl.classList.add('hidden');
    contentEl.classList.remove('hidden');

    const withSales = ranked.filter((a) => a.monto_vendido > 0);
    const chartRows = withSales.length ? withSales : ranked;
    barChart(chartCanvas, {
      labels: chartRows.map((a) => a.name),
      data: chartRows.map((a) => a.monto_vendido),
      color: chartRows.map((_, i) => CATEGORICAL_COLORS[i % CATEGORICAL_COLORS.length]),
      valueFormatter: formatCompactMoney,
    });
  }

  fromInput.addEventListener('change', load);
  toInput.addEventListener('change', load);
  if (canGoToReporte) {
    container.querySelector('#d1-ver-reporte').addEventListener('click', () => ctx.navigate('reporte'));
  }

  const off = ctx.ws.on('leads_changed', load);
  await load();

  return () => {
    off();
    destroyChart(chartCanvas);
  };
}
