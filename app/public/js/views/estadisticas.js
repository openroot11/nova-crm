import { escapeHtml, formatMoney, formatCompactMoney, LEAD_STATUS_COLORS, deltaBadge } from '../utils.js';
import { barChart, donutChart, groupedBarChart, sankeyChart, destroyChart, CATEGORICAL_COLORS } from '../components/charts.js';
import { PRODUCT_COLORS } from '../components/colombiaMap.js';

const now = new Date();
const MONTH_NAME = now.toLocaleDateString('es-CO', { month: 'long', year: 'numeric' });

// Colores del diagrama "Flujo de Leads": productos reusan exactamente
// PRODUCT_COLORS (mismo mapeo que la leyenda del mapa de Colombia -- un
// producto es siempre el mismo color en toda la app). Canales y resultado
// son columnas distintas del mismo diagrama, con su propia identidad fija;
// el resultado usa la escala de estado (verde=ganado, rojo=perdido) igual
// que el resto de la app, no la paleta categorica.
const FLOW_FALLBACK_COLOR = '#8a8578';
const CHANNEL_COLORS = { 'Google Ads': CATEGORICAL_COLORS[0], Orgánico: CATEGORICAL_COLORS[2], Referido: CATEGORICAL_COLORS[3], Otro: CATEGORICAL_COLORS[6] };
const OUTCOME_COLORS = { Ganado: LEAD_STATUS_COLORS.cerrado_ganado, Perdido: LEAD_STATUS_COLORS.cerrado_perdido, 'En curso': FLOW_FALLBACK_COLOR };

function flowNodeColor(nodeId, labels) {
  const label = labels[nodeId] || nodeId;
  if (nodeId.startsWith('channel:')) return CHANNEL_COLORS[label] || FLOW_FALLBACK_COLOR;
  if (nodeId.startsWith('product:')) return PRODUCT_COLORS[label] || FLOW_FALLBACK_COLOR;
  if (nodeId.startsWith('outcome:')) return OUTCOME_COLORS[label] || FLOW_FALLBACK_COLOR;
  return FLOW_FALLBACK_COLOR;
}

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
        <div style="height:256px;"><canvas id="ventas-asesor-chart"></canvas></div>
      </div>

      <div class="bg-surface-container-lowest border border-outline-variant rounded-xl p-gutter shadow-sm flex flex-col">
        <h3 class="text-headline-md font-headline-md text-on-surface mb-1">Estado Leads</h3>
        <p class="text-body-sm font-body-sm text-on-surface-variant mb-6">Distribución actual del pipeline</p>
        <div class="flex-1 flex flex-col items-center justify-center">
          <div class="relative w-48 h-48">
            <canvas id="donut-chart"></canvas>
            <div class="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <span id="donut-total" class="text-headline-lg font-headline-lg text-on-surface font-bold">0</span>
              <span class="text-label-bold font-label-bold text-on-surface-variant">Total Leads</span>
            </div>
          </div>
          <div id="donut-legend" class="w-full mt-8 space-y-2"></div>
        </div>
      </div>
    </div>

    <div id="dashboard-card" class="bg-surface-container-lowest border border-outline-variant rounded-xl p-gutter shadow-sm mt-gutter">
      <div class="flex flex-wrap items-end justify-between gap-4 mb-6">
        <div>
          <h3 class="text-headline-md font-headline-md text-on-surface">Rendimiento por Asesor</h3>
          <p class="text-body-sm font-body-sm text-on-surface-variant" id="dashboard-subtitle">Embudo, cumplimiento de SLA y ranking, por rango de fechas — el reporte para comparar al equipo</p>
        </div>
        <div class="flex items-end gap-3 flex-wrap no-print">
          <div>
            <label class="block text-[10px] font-label-bold text-on-surface-variant mb-1 uppercase tracking-wider">Asesor</label>
            <select id="asesor-filter" class="p-2 bg-surface-container-lowest border border-outline-variant rounded-md text-body-sm outline-none focus:border-primary">
              <option value="">General</option>
            </select>
          </div>
          <div>
            <label class="block text-[10px] font-label-bold text-on-surface-variant mb-1 uppercase tracking-wider">Desde</label>
            <input id="funnel-from" type="date" class="p-2 bg-surface-container-lowest border border-outline-variant rounded-md text-body-sm outline-none focus:border-primary" />
          </div>
          <div>
            <label class="block text-[10px] font-label-bold text-on-surface-variant mb-1 uppercase tracking-wider">Hasta</label>
            <input id="funnel-to" type="date" class="p-2 bg-surface-container-lowest border border-outline-variant rounded-md text-body-sm outline-none focus:border-primary" />
          </div>
          <label class="flex items-center gap-2 px-3 py-2 border border-outline-variant rounded-md text-label-bold font-label-bold text-on-surface-variant cursor-pointer hover:bg-surface-container-lowest transition-colors">
            <input id="compare-toggle" type="checkbox" class="rounded" />
            Comparar con periodo anterior
          </label>
          <div id="compare-dates" class="hidden flex items-end gap-3">
            <div>
              <label class="block text-[10px] font-label-bold text-on-surface-variant mb-1 uppercase tracking-wider">Comparar desde</label>
              <input id="compare-from" type="date" class="p-2 bg-surface-container-lowest border border-outline-variant rounded-md text-body-sm outline-none focus:border-primary" />
            </div>
            <div>
              <label class="block text-[10px] font-label-bold text-on-surface-variant mb-1 uppercase tracking-wider">Comparar hasta</label>
              <input id="compare-to" type="date" class="p-2 bg-surface-container-lowest border border-outline-variant rounded-md text-body-sm outline-none focus:border-primary" />
            </div>
          </div>
          <button id="hide-amount-btn" class="px-3 py-2 border border-outline-variant rounded-md text-label-bold font-label-bold text-on-surface-variant hover:bg-surface-container-lowest transition-colors flex items-center gap-1.5">
            <span class="material-symbols-outlined text-[16px]">visibility_off</span> Ocultar monto
          </button>
          <button id="download-pdf-btn" class="px-3 py-2 bg-on-surface text-surface rounded-md text-label-bold font-label-bold hover:opacity-90 transition-colors flex items-center gap-1.5">
            <span class="material-symbols-outlined text-[16px]">picture_as_pdf</span> Descargar PDF
          </button>
          <button id="archive-rendimiento-btn" class="px-3 py-2 bg-primary text-on-primary rounded-md text-label-bold font-label-bold hover:bg-on-primary-fixed-variant transition-colors flex items-center gap-1.5">
            <span class="material-symbols-outlined text-[16px]">archive</span> Generar y archivar
          </button>
        </div>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-gutter mb-gutter">
        <div class="border border-outline-variant rounded-xl p-4">
          <div class="flex items-center gap-2 mb-1">
            <p class="text-label-bold font-label-bold text-on-surface-variant uppercase tracking-wider">Total Ventas</p>
            <span id="res-ventas-delta"></span>
          </div>
          <p id="res-ventas" class="text-headline-lg font-headline-lg text-on-surface">0</p>
          <p id="res-tasa-cierre" class="text-body-sm font-body-sm text-secondary mt-1">0% tasa de cierre</p>
        </div>
        <div class="border border-outline-variant rounded-xl p-4">
          <div class="flex items-center gap-2 mb-1">
            <p class="text-label-bold font-label-bold text-on-surface-variant uppercase tracking-wider">Monto Total</p>
            <span id="res-monto-delta"></span>
          </div>
          <p id="res-monto" class="text-headline-lg font-headline-lg text-on-surface">$0</p>
          <p id="res-prom-venta" class="text-body-sm font-body-sm text-on-surface-variant mt-1">Prom. $0 / venta</p>
        </div>
      </div>

      <p class="text-[10px] font-label-bold text-on-surface-variant uppercase tracking-wider mb-2">Indicadores de desempeño</p>
      <div id="indicadores-grid" class="grid grid-cols-2 md:grid-cols-5 gap-3 mb-gutter"></div>

      <div class="border border-outline-variant rounded-xl p-4 mb-gutter">
        <div class="flex items-center justify-between mb-1">
          <h4 class="text-body-md font-body-md font-semibold text-on-surface">Leads Asignados por Asesor</h4>
          <span id="asignados-total" class="text-body-sm font-body-sm text-on-surface-variant">0 total</span>
        </div>
        <div id="asignados-bars" class="space-y-3 mt-3"></div>
      </div>

      <div class="border border-outline-variant rounded-xl p-4 mb-gutter">
        <div class="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h4 class="text-body-md font-body-md font-semibold text-on-surface">Comparativo por Asesor</h4>
          <div class="flex items-center gap-2 no-print">
            <div id="metric-tabs" class="flex bg-surface-container-low rounded-md p-1 text-body-sm font-label-bold"></div>
            <div id="chart-type-tabs" class="flex bg-surface-container-low rounded-md p-1 text-body-sm font-label-bold">
              <button data-chart="bar" class="chart-type-btn px-3 py-1 rounded">Barras</button>
              <button data-chart="donut" class="chart-type-btn px-3 py-1 rounded">Torta</button>
            </div>
          </div>
        </div>
        <div id="comparativo-chart" style="height:280px;"><canvas id="comparativo-canvas"></canvas></div>
      </div>

      <div id="ficha-asesor" class="hidden border-2 border-primary/30 rounded-xl p-4 mb-gutter bg-surface">
        <div class="flex flex-wrap items-center justify-between gap-3 mb-5">
          <div>
            <p class="text-[10px] font-label-bold text-primary uppercase tracking-wider mb-0.5">Ficha individual</p>
            <h4 id="ficha-nombre" class="text-headline-sm font-headline-sm text-on-surface">—</h4>
          </div>
          <div class="flex items-center gap-2 no-print">
            <button id="ficha-pdf-btn" class="px-3 py-2 bg-on-surface text-surface rounded-md text-label-bold font-label-bold hover:opacity-90 transition-colors flex items-center gap-1.5">
              <span class="material-symbols-outlined text-[16px]">picture_as_pdf</span> PDF de esta ficha
            </button>
            <button id="ficha-archive-btn" class="px-3 py-2 bg-primary text-on-primary rounded-md text-label-bold font-label-bold hover:bg-on-primary-fixed-variant transition-colors flex items-center gap-1.5">
              <span class="material-symbols-outlined text-[16px]">archive</span> Generar y archivar
            </button>
          </div>
        </div>

        <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-gutter">
          <div class="border border-outline-variant rounded-lg p-3">
            <p class="text-[10px] font-label-bold text-on-surface-variant uppercase tracking-wider mb-1">Ranking en el equipo</p>
            <p id="ficha-ranking" class="text-headline-sm font-headline-sm text-on-surface">—</p>
          </div>
          <div class="border border-outline-variant rounded-lg p-3">
            <p class="text-[10px] font-label-bold text-on-surface-variant uppercase tracking-wider mb-1">Velocidad de respuesta</p>
            <p id="ficha-velocidad" class="text-headline-sm font-headline-sm text-on-surface">—</p>
          </div>
          <div class="border border-outline-variant rounded-lg p-3">
            <p class="text-[10px] font-label-bold text-on-surface-variant uppercase tracking-wider mb-1">Cotizaciones con seguimiento</p>
            <p id="ficha-seguimiento" class="text-headline-sm font-headline-sm text-on-surface">—</p>
          </div>
          <div class="border border-outline-variant rounded-lg p-3">
            <p class="text-[10px] font-label-bold text-on-surface-variant uppercase tracking-wider mb-1">Cotizaciones sin ningún seguimiento</p>
            <p id="ficha-sin-seguimiento" class="text-headline-sm font-headline-sm text-error">—</p>
          </div>
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-2 gap-gutter mb-gutter">
          <div class="border border-outline-variant rounded-xl p-4">
            <h5 class="text-body-md font-body-md font-semibold text-on-surface mb-3">Por producto</h5>
            <div class="overflow-x-auto">
              <table class="w-full text-left border-collapse text-body-sm">
                <thead>
                  <tr class="border-b border-outline-variant">
                    <th class="p-2 text-label-bold font-label-bold text-on-surface-variant uppercase text-[10px]">Producto</th>
                    <th class="p-2 text-label-bold font-label-bold text-on-surface-variant uppercase text-[10px] text-center">Leads</th>
                    <th class="p-2 text-label-bold font-label-bold text-on-surface-variant uppercase text-[10px] text-center">% Cierre</th>
                    <th class="p-2 text-label-bold font-label-bold text-on-surface-variant uppercase text-[10px] text-right">Monto</th>
                  </tr>
                </thead>
                <tbody id="ficha-producto-tbody" class="divide-y divide-outline-variant"></tbody>
              </table>
            </div>
          </div>
          <div class="border border-outline-variant rounded-xl p-4">
            <h5 class="text-body-md font-body-md font-semibold text-on-surface mb-3">Por canal / origen</h5>
            <div class="overflow-x-auto">
              <table class="w-full text-left border-collapse text-body-sm">
                <thead>
                  <tr class="border-b border-outline-variant">
                    <th class="p-2 text-label-bold font-label-bold text-on-surface-variant uppercase text-[10px]">Canal</th>
                    <th class="p-2 text-label-bold font-label-bold text-on-surface-variant uppercase text-[10px] text-center">Leads</th>
                    <th class="p-2 text-label-bold font-label-bold text-on-surface-variant uppercase text-[10px] text-center">% Conversión</th>
                  </tr>
                </thead>
                <tbody id="ficha-canal-tbody" class="divide-y divide-outline-variant"></tbody>
              </table>
            </div>
          </div>
        </div>

        <div class="border border-outline-variant rounded-xl p-4 mb-gutter">
          <h5 class="text-body-md font-body-md font-semibold text-on-surface mb-3">Tendencia — últimos 6 meses</h5>
          <div style="height:160px;"><canvas id="ficha-tendencia-chart"></canvas></div>
        </div>

        <div class="border border-outline-variant rounded-xl p-4">
          <h5 class="text-body-md font-body-md font-semibold text-on-surface mb-3">Reasignaciones en el periodo</h5>
          <div class="overflow-x-auto">
            <table class="w-full text-left border-collapse text-body-sm">
              <thead>
                <tr class="border-b border-outline-variant">
                  <th class="p-2 text-label-bold font-label-bold text-on-surface-variant uppercase text-[10px]">Fecha</th>
                  <th class="p-2 text-label-bold font-label-bold text-on-surface-variant uppercase text-[10px]">Cliente</th>
                  <th class="p-2 text-label-bold font-label-bold text-on-surface-variant uppercase text-[10px]">Motivo</th>
                  <th class="p-2 text-label-bold font-label-bold text-on-surface-variant uppercase text-[10px]">Nuevo asesor</th>
                </tr>
              </thead>
              <tbody id="ficha-reasignaciones-tbody" class="divide-y divide-outline-variant"></tbody>
            </table>
          </div>
        </div>
      </div>

      <details class="border border-outline-variant rounded-xl p-4">
        <summary class="text-body-md font-body-md font-semibold text-on-surface cursor-pointer">Detalle completo por asesor</summary>
        <div class="overflow-x-auto mt-4">
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
      </details>
    </div>

    <div class="bg-surface-container-lowest border border-outline-variant rounded-xl p-gutter shadow-sm mt-gutter">
      <h3 class="text-headline-md font-headline-md text-on-surface mb-1">Flujo de Leads</h3>
      <p class="text-body-sm font-body-sm text-on-surface-variant mb-4">Canal de origen → producto → resultado, mismo rango de fechas que Rentabilidad de Leads (abajo).</p>
      <div style="height:380px;"><canvas id="flow-chart"></canvas></div>
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

  if (!document.getElementById('print-style')) {
    const style = document.createElement('style');
    style.id = 'print-style';
    style.media = 'print';
    style.textContent = `
      #sidebar, #topbar, .no-print { display: none !important; }
      #main-col { margin-left: 0 !important; }
      body { background: #fff !important; }
      body.printing-ficha *:not(#ficha-asesor):not(#ficha-asesor *) { visibility: hidden !important; }
      body.printing-ficha #ficha-asesor, body.printing-ficha #ficha-asesor * { visibility: visible !important; }
      body.printing-ficha #ficha-asesor { position: absolute; left: 0; top: 0; width: 100%; border: none !important; }
    `;
    document.head.appendChild(style);
  }

  let hideAmounts = false;
  const showMoney = (v) => (hideAmounts ? '•••••' : formatMoney(v));

  const kpiGrid = container.querySelector('#kpi-grid');
  const ventasAsesorCanvas = container.querySelector('#ventas-asesor-chart');
  const donutCanvas = container.querySelector('#donut-chart');
  const donutTotal = container.querySelector('#donut-total');
  const donutLegend = container.querySelector('#donut-legend');
  const funnelTbody = container.querySelector('#funnel-tbody');
  const funnelTotalesRow = container.querySelector('#funnel-totales-row');
  const asesorFilter = container.querySelector('#asesor-filter');
  const dashboardSubtitle = container.querySelector('#dashboard-subtitle');
  const resVentas = container.querySelector('#res-ventas');
  const resVentasDelta = container.querySelector('#res-ventas-delta');
  const resTasaCierre = container.querySelector('#res-tasa-cierre');
  const resMonto = container.querySelector('#res-monto');
  const resMontoDelta = container.querySelector('#res-monto-delta');
  const resPromVenta = container.querySelector('#res-prom-venta');
  const indicadoresGrid = container.querySelector('#indicadores-grid');
  const asignadosBars = container.querySelector('#asignados-bars');
  const asignadosTotal = container.querySelector('#asignados-total');
  const metricTabs = container.querySelector('#metric-tabs');
  const chartTypeTabs = container.querySelector('#chart-type-tabs');
  const comparativoCanvas = container.querySelector('#comparativo-canvas');
  const fichaAsesor = container.querySelector('#ficha-asesor');
  const fichaNombre = container.querySelector('#ficha-nombre');
  const fichaRanking = container.querySelector('#ficha-ranking');
  const fichaVelocidad = container.querySelector('#ficha-velocidad');
  const fichaSeguimiento = container.querySelector('#ficha-seguimiento');
  const fichaSinSeguimiento = container.querySelector('#ficha-sin-seguimiento');
  const fichaProductoTbody = container.querySelector('#ficha-producto-tbody');
  const fichaCanalTbody = container.querySelector('#ficha-canal-tbody');
  const fichaTendenciaCanvas = container.querySelector('#ficha-tendencia-chart');
  const fichaReasignacionesTbody = container.querySelector('#ficha-reasignaciones-tbody');
  const funnelFrom = container.querySelector('#funnel-from');
  const funnelTo = container.querySelector('#funnel-to');
  const compareToggle = container.querySelector('#compare-toggle');
  const compareDates = container.querySelector('#compare-dates');
  const compareFrom = container.querySelector('#compare-from');
  const compareTo = container.querySelector('#compare-to');
  const profitFrom = container.querySelector('#profit-from');
  const profitTo = container.querySelector('#profit-to');
  const flowCanvas = container.querySelector('#flow-chart');
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

    groupedBarChart(ventasAsesorCanvas, {
      labels: k.sales_by_advisor.map((a) => a.name),
      series: [
        { label: 'Mes Actual', data: k.sales_by_advisor.map((a) => a.this_month), color: '#0f7a5c' },
        { label: 'Mes Anterior', data: k.sales_by_advisor.map((a) => a.prev_month), color: '#a7d9c7' },
      ],
      valueFormatter: formatCompactMoney,
    });

    const total = k.total_leads || 0;
    const dist = k.lead_status_distribution.filter((d) => d.count > 0);
    donutTotal.textContent = total;
    donutChart(donutCanvas, {
      labels: dist.map((d) => d.label),
      data: dist.map((d) => d.count),
      colors: dist.map((d) => LEAD_STATUS_COLORS[d.status] || '#8a8578'),
      showLegend: false,
    });

    donutLegend.innerHTML = k.lead_status_distribution
      .map((d) => {
        const pct = total > 0 ? Math.round((d.count / total) * 1000) / 10 : 0;
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
        <td class="p-table-cell-padding text-right font-bold">${showMoney(r.monto_vendido)}</td>
      </tr>
    `;
  }

  function renderTotalsRow(t) {
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
      <td class="p-table-cell-padding text-right">${showMoney(t.monto_vendido)}</td>
    `;
  }

  // Pill de delta reutilizado en Resultados e Indicadores. `invert` es para
  // metricas donde subir es malo (reasignos, pendientes sin cotizar) -- el
  // signo/flecha sigue siendo matematicamente correcto, solo cambia el color
  // bueno/malo.
  function deltaSpanHtml(current, previous, invert = false) {
    const d = deltaBadge(current, previous);
    if (!d) return '';
    const good = invert ? !d.positive : d.positive;
    return `<span class="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold ${good ? 'bg-secondary-container text-on-secondary-container' : 'bg-error-container text-on-error-container'}"><span class="material-symbols-outlined text-[11px]">${d.positive ? 'trending_up' : 'trending_down'}</span>${d.text}</span>`;
  }

  function renderResultados(row, compareRow) {
    resVentas.textContent = row.vendidos;
    resTasaCierre.textContent = `${row.tasa_cierre}% tasa de cierre`;
    resMonto.textContent = showMoney(row.monto_vendido);
    const promVenta = row.vendidos ? Math.round(row.monto_vendido / row.vendidos) : 0;
    resPromVenta.textContent = `Prom. ${showMoney(promVenta)} / venta`;
    resVentasDelta.innerHTML = compareRow ? deltaSpanHtml(row.vendidos, compareRow.vendidos) : '';
    resMontoDelta.innerHTML = compareRow ? deltaSpanHtml(row.monto_vendido, compareRow.monto_vendido) : '';
  }

  function indicatorTile(label, value, sub, icon, deltaHtml = '') {
    return `
      <div class="border border-outline-variant rounded-xl p-3">
        <div class="flex items-center gap-1.5 mb-1">
          <span class="material-symbols-outlined text-[15px] text-primary">${icon}</span>
          <p class="text-[9.5px] font-label-bold text-on-surface-variant uppercase tracking-wider leading-tight">${label}</p>
        </div>
        <div class="flex items-center gap-1.5">
          <p class="text-headline-sm font-headline-sm text-on-surface">${value}</p>
          ${deltaHtml}
        </div>
        <p class="text-[11px] text-on-surface-variant mt-0.5">${sub}</p>
      </div>
    `;
  }

  function renderIndicadores(row, compareRow) {
    indicadoresGrid.innerHTML = [
      indicatorTile('Efectividad Asesores', `${row.efectividad_asesor}%`, `${row.vendidos} ventas de ${row.asignados} asignados`, 'military_tech', compareRow ? deltaSpanHtml(row.efectividad_asesor, compareRow.efectividad_asesor) : ''),
      indicatorTile('Cotizados/Asignados', `${row.cotizados_sobre_asignados}%`, `${row.cotizados} cotizados de ${row.asignados}`, 'request_quote', compareRow ? deltaSpanHtml(row.cotizados_sobre_asignados, compareRow.cotizados_sobre_asignados) : ''),
      indicatorTile('Prom. Semanal sin Cotizar', row.prom_semanal_sin_cotizar, 'leads pendientes por semana', 'schedule', compareRow ? deltaSpanHtml(row.prom_semanal_sin_cotizar, compareRow.prom_semanal_sin_cotizar, true) : ''),
      indicatorTile('Tasa de Reasignados', `${row.tasa_reasignados}%`, `${row.reasignados} reasignados de ${row.asignados}`, 'sync_problem', compareRow ? deltaSpanHtml(row.tasa_reasignados, compareRow.tasa_reasignados, true) : ''),
      indicatorTile('Tasa de Cierre', `${row.tasa_cierre}%`, `${row.vendidos} ventas de ${row.cotizados} cotizados`, 'trending_up', compareRow ? deltaSpanHtml(row.tasa_cierre, compareRow.tasa_cierre) : ''),
    ].join('');
  }

  function renderAsignadosBars(advisors, selectedId) {
    const total = advisors.reduce((s, a) => s + a.asignados, 0);
    asignadosTotal.textContent = `${total} total`;
    const sorted = [...advisors].sort((a, b) => b.asignados - a.asignados);
    asignadosBars.innerHTML = sorted
      .map((a) => {
        const pct = total ? Math.round((a.asignados / total) * 1000) / 10 : 0;
        const selected = selectedId && a.advisor_id === selectedId;
        return `
        <div class="${selected ? 'bg-secondary-container rounded-lg p-2 -mx-2' : ''}">
          <div class="flex justify-between text-body-sm mb-1">
            <span class="font-semibold ${selected ? 'text-on-secondary-container' : 'text-on-surface'}">${escapeHtml(a.name)}</span>
            <span class="${selected ? 'text-on-secondary-container' : 'text-on-surface-variant'}">${a.asignados} · ${pct}%</span>
          </div>
          <div class="h-2 bg-surface-container-low rounded-full overflow-hidden">
            <div class="h-full ${selected ? 'bg-secondary' : 'bg-primary'} rounded-full" style="width:${Math.max(2, pct)}%"></div>
          </div>
        </div>`;
      })
      .join('');
  }

  const METRICS = [
    { key: 'cotizados', label: 'Cotizados' },
    { key: 'pendientes_por_cotizar', label: 'Por Cotizar' },
    { key: 'reasignados', label: 'Reasignados' },
    { key: 'vendidos', label: 'Ventas' },
  ];
  let activeMetric = 'cotizados';
  let activeChartType = 'bar';
  let lastFunnelData = null;
  let lastFunnelDataCompare = null;

  function renderTabs() {
    metricTabs.innerHTML = METRICS.map(
      (m) =>
        `<button data-metric="${m.key}" class="metric-btn px-3 py-1 rounded transition-colors ${m.key === activeMetric ? 'bg-surface text-primary shadow-sm font-bold' : 'text-on-surface-variant'}">${m.label}</button>`
    ).join('');
    chartTypeTabs.querySelectorAll('.chart-type-btn').forEach((btn) => {
      const active = btn.dataset.chart === activeChartType;
      btn.classList.toggle('bg-surface', active);
      btn.classList.toggle('text-primary', active);
      btn.classList.toggle('shadow-sm', active);
      btn.classList.toggle('font-bold', active);
      btn.classList.toggle('text-on-surface-variant', !active);
    });
  }

  function renderComparativo() {
    if (!lastFunnelData) return;
    const advisors = lastFunnelData.advisors;

    if (advisors.length === 0) {
      destroyChart(comparativoCanvas);
      return;
    }

    const colors = advisors.map((_, i) => CATEGORICAL_COLORS[i % CATEGORICAL_COLORS.length]);
    if (activeChartType === 'bar') {
      barChart(comparativoCanvas, {
        labels: advisors.map((a) => a.name),
        data: advisors.map((a) => a[activeMetric] || 0),
        color: colors,
      });
    } else {
      donutChart(comparativoCanvas, {
        labels: advisors.map((a) => a.name),
        data: advisors.map((a) => a[activeMetric] || 0),
        colors,
      });
    }
  }

  function selectedRow() {
    if (!lastFunnelData) return null;
    const id = asesorFilter.value ? Number(asesorFilter.value) : null;
    if (!id) return lastFunnelData.totals;
    return lastFunnelData.advisors.find((a) => a.advisor_id === id) || lastFunnelData.totals;
  }

  function selectedCompareRow() {
    if (!lastFunnelDataCompare) return null;
    const id = asesorFilter.value ? Number(asesorFilter.value) : null;
    if (!id) return lastFunnelDataCompare.totals;
    return lastFunnelDataCompare.advisors.find((a) => a.advisor_id === id) || lastFunnelDataCompare.totals;
  }

  function renderAll() {
    if (!lastFunnelData) return;
    const data = lastFunnelData;
    funnelTbody.innerHTML = data.advisors.length
      ? data.advisors.map(funnelRowHtml).join('')
      : `<tr><td colspan="13" class="p-table-cell-padding py-8 text-center text-body-sm text-on-surface-variant">No hay asesores activos.</td></tr>`;
    renderTotalsRow(data.totals);

    const selectedId = asesorFilter.value ? Number(asesorFilter.value) : null;
    const row = selectedRow();
    const compareRow = selectedCompareRow();
    dashboardSubtitle.textContent = selectedId
      ? `Mostrando datos de ${row.name.toUpperCase()}`
      : 'Embudo, cumplimiento de SLA y ranking, por rango de fechas — el reporte para comparar al equipo';
    renderResultados(row, compareRow);
    renderIndicadores(row, compareRow);
    renderAsignadosBars(data.advisors, selectedId);
    renderComparativo();
    updateFicha(selectedId);
  }

  // --- Ficha individual de asesor -----------------------------------------
  function fichaProductoRow(p) {
    return `<tr>
      <td class="p-2 font-semibold text-on-surface">${escapeHtml(p.producto)}</td>
      <td class="p-2 text-center">${p.leads}</td>
      <td class="p-2 text-center">${p.tasa_cierre}%</td>
      <td class="p-2 text-right font-bold">${showMoney(p.monto)}</td>
    </tr>`;
  }

  function fichaCanalRow(c) {
    return `<tr>
      <td class="p-2 font-semibold text-on-surface">${escapeHtml(c.canal)}</td>
      <td class="p-2 text-center">${c.leads}</td>
      <td class="p-2 text-center">${c.tasa_conversion}%</td>
    </tr>`;
  }

  function fichaReasignacionRow(r) {
    return `<tr>
      <td class="p-2 text-on-surface-variant whitespace-nowrap">${escapeHtml((r.at || '').slice(0, 16))}</td>
      <td class="p-2 text-on-surface">${escapeHtml(r.client_name)}</td>
      <td class="p-2 text-on-surface-variant">${escapeHtml(r.reason || '—')}</td>
      <td class="p-2 text-on-surface-variant">${escapeHtml(r.to_advisor_name || '—')}</td>
    </tr>`;
  }

  function renderFichaTendencia(tendencia) {
    const labels = tendencia.map((t) => {
      const [y, m] = t.mes.split('-');
      return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('es-CO', { month: 'short' }).replace('.', '');
    });
    barChart(fichaTendenciaCanvas, {
      labels,
      data: tendencia.map((t) => t.monto),
      color: '#0f7a5c',
      valueFormatter: formatCompactMoney,
    });
  }

  async function loadFicha(advisorId) {
    const params = new URLSearchParams();
    if (funnelFrom.value) params.set('from', funnelFrom.value);
    if (funnelTo.value) params.set('to', funnelTo.value);
    let data;
    try {
      data = await ctx.api.get(`/api/kpis/advisor/${advisorId}?${params.toString()}`);
    } catch {
      ctx.toast('No se pudo cargar la ficha del asesor', 'error');
      return;
    }
    const m = data.metrics || {};
    fichaNombre.textContent = data.advisor.name;
    fichaRanking.textContent = m.rank ? `#${m.rank} de ${data.team_size}` : '—';
    fichaVelocidad.textContent = data.velocidad_respuesta_horas != null ? `${data.velocidad_respuesta_horas} h` : '—';
    fichaSeguimiento.textContent = `${data.seguimiento.con_seguimiento} de ${data.seguimiento.cotizados}`;
    fichaSinSeguimiento.textContent = data.seguimiento.sin_ningun_seguimiento;

    fichaProductoTbody.innerHTML = data.por_producto.length
      ? data.por_producto.map(fichaProductoRow).join('')
      : `<tr><td colspan="4" class="p-2 text-center text-on-surface-variant">Sin leads en este rango.</td></tr>`;
    fichaCanalTbody.innerHTML = data.por_canal.length
      ? data.por_canal.map(fichaCanalRow).join('')
      : `<tr><td colspan="3" class="p-2 text-center text-on-surface-variant">Sin leads en este rango.</td></tr>`;
    fichaReasignacionesTbody.innerHTML = data.reasignaciones_detalle.length
      ? data.reasignaciones_detalle.map(fichaReasignacionRow).join('')
      : `<tr><td colspan="4" class="p-2 text-center text-on-surface-variant">Sin reasignaciones en el periodo.</td></tr>`;
    renderFichaTendencia(data.tendencia_mensual);
  }

  function updateFicha(selectedId) {
    if (!selectedId) {
      fichaAsesor.classList.add('hidden');
      return;
    }
    fichaAsesor.classList.remove('hidden');
    loadFicha(selectedId);
  }

  container.querySelector('#ficha-archive-btn').addEventListener('click', async () => {
    const selectedId = asesorFilter.value ? Number(asesorFilter.value) : null;
    if (!selectedId) return;
    try {
      await ctx.api.post('/api/reports', { type: 'asesor', advisor_id: selectedId, from: funnelFrom.value, to: funnelTo.value });
      ctx.toast('Ficha archivada', 'success');
      loadReports();
    } catch (err) {
      ctx.toast(err.message, 'error');
    }
  });

  container.querySelector('#ficha-pdf-btn').addEventListener('click', () => {
    document.body.classList.add('printing-ficha');
    window.print();
  });
  const onAfterPrint = () => document.body.classList.remove('printing-ficha');
  window.addEventListener('afterprint', onAfterPrint);

  // Precarga el rango de comparacion con el periodo inmediatamente anterior,
  // de la misma duracion que el rango activo -- punto de partida razonable,
  // editable a mano si se quiere comparar contra otra cosa.
  function defaultCompareRange() {
    const from = new Date(`${funnelFrom.value}T00:00:00Z`);
    const to = new Date(`${funnelTo.value}T00:00:00Z`);
    const days = Math.max(1, Math.round((to - from) / 86400000) + 1);
    const newTo = new Date(from.getTime() - 86400000);
    const newFrom = new Date(newTo.getTime() - (days - 1) * 86400000);
    return { from: newFrom.toISOString().slice(0, 10), to: newTo.toISOString().slice(0, 10) };
  }

  async function loadFunnel() {
    const params = new URLSearchParams();
    if (funnelFrom.value) params.set('from', funnelFrom.value);
    if (funnelTo.value) params.set('to', funnelTo.value);

    const requests = [ctx.api.get(`/api/kpis/funnel?${params.toString()}`)];
    if (compareToggle.checked && compareFrom.value && compareTo.value) {
      const compareParams = new URLSearchParams({ from: compareFrom.value, to: compareTo.value });
      requests.push(ctx.api.get(`/api/kpis/funnel?${compareParams.toString()}`));
    }

    let data;
    let dataCompare = null;
    try {
      [data, dataCompare] = await Promise.all(requests);
    } catch {
      ctx.toast('No se pudo cargar el comparativo por asesor', 'error');
      return;
    }
    if (!funnelFrom.value) funnelFrom.value = data.from;
    if (!funnelTo.value) funnelTo.value = data.to;
    lastFunnelData = data;
    lastFunnelDataCompare = compareToggle.checked ? dataCompare || null : null;

    const prevSelected = asesorFilter.value;
    asesorFilter.innerHTML = '<option value="">General</option>' + data.advisors.map((a) => `<option value="${a.advisor_id}">${escapeHtml(a.name)}</option>`).join('');
    if (data.advisors.some((a) => String(a.advisor_id) === prevSelected)) asesorFilter.value = prevSelected;

    renderAll();
  }

  renderTabs();
  asesorFilter.addEventListener('change', renderAll);
  compareToggle.addEventListener('change', () => {
    compareDates.classList.toggle('hidden', !compareToggle.checked);
    if (compareToggle.checked && !compareFrom.value && !compareTo.value) {
      const def = defaultCompareRange();
      compareFrom.value = def.from;
      compareTo.value = def.to;
    }
    loadFunnel();
  });
  compareFrom.addEventListener('change', loadFunnel);
  compareTo.addEventListener('change', loadFunnel);
  metricTabs.addEventListener('click', (e) => {
    const btn = e.target.closest('.metric-btn');
    if (!btn) return;
    activeMetric = btn.dataset.metric;
    renderTabs();
    renderComparativo();
  });
  chartTypeTabs.addEventListener('click', (e) => {
    const btn = e.target.closest('.chart-type-btn');
    if (!btn) return;
    activeChartType = btn.dataset.chart;
    renderTabs();
    renderComparativo();
  });
  container.querySelector('#hide-amount-btn').addEventListener('click', (e) => {
    hideAmounts = !hideAmounts;
    e.currentTarget.innerHTML = hideAmounts
      ? '<span class="material-symbols-outlined text-[16px]">visibility</span> Mostrar monto'
      : '<span class="material-symbols-outlined text-[16px]">visibility_off</span> Ocultar monto';
    renderAll();
  });
  container.querySelector('#download-pdf-btn').addEventListener('click', () => window.print());

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
    const crudo = data.crudo;
    profitKpis.innerHTML = `
      <p class="col-span-2 md:col-span-4 text-[10px] font-label-bold text-on-surface-variant uppercase tracking-wider -mb-1">Solo canal Google Ads (preciso)</p>
      ${[
        kpiTile('Inversión', formatMoney(ga.inversion), 'payments'),
        kpiTile('Costo por Lead', ga.costo_por_lead != null ? formatMoney(ga.costo_por_lead) : '—', 'person_search'),
        kpiTile('Costo por Venta', ga.costo_por_venta != null ? formatMoney(ga.costo_por_venta) : '—', 'sell'),
        kpiTile('ROI', ga.roi_pct != null ? `${ga.roi_pct}%` : '—', 'trending_up'),
      ].join('')}
      <p class="col-span-2 md:col-span-4 text-[10px] font-label-bold text-on-surface-variant uppercase tracking-wider mt-2 -mb-1">Contra el total de leads crudos (${crudo.total_leads} mensajes/llamadas del periodo)</p>
      ${[
        kpiTile('Inversión', formatMoney(crudo.inversion), 'payments'),
        kpiTile('Costo por Lead', crudo.costo_por_lead != null ? formatMoney(crudo.costo_por_lead) : '—', 'person_search'),
        kpiTile('Costo por Venta', crudo.costo_por_venta != null ? formatMoney(crudo.costo_por_venta) : '—', 'sell'),
        kpiTile('ROI', crudo.roi_pct != null ? `${crudo.roi_pct}%` : '—', 'trending_up'),
      ].join('')}
    `;

    channelsTbody.innerHTML = data.channels.length
      ? data.channels.map(channelRowHtml).join('')
      : `<tr><td colspan="5" class="p-table-cell-padding py-8 text-center text-body-sm text-on-surface-variant">Sin leads en este rango.</td></tr>`;

    loadFlow(profitFrom.value, profitTo.value);
  }

  // Mismo rango de fechas que Rentabilidad de Leads (arriba) -- son el
  // mismo tipo de dato (canal/producto/resultado), no hace falta un tercer
  // par de inputs de fecha solo para este diagrama.
  async function loadFlow(from, to) {
    let flow;
    try {
      flow = await ctx.api.get(`/api/kpis/flow?from=${from}&to=${to}`);
    } catch {
      ctx.toast('No se pudo cargar el flujo de leads', 'error');
      return;
    }
    if (!flow.links.length) {
      destroyChart(flowCanvas);
      return;
    }
    sankeyChart(flowCanvas, {
      links: flow.links.map((l) => ({ from: l.source, to: l.target, flow: l.value })),
      labels: flow.labels,
      nodeColor: (id) => flowNodeColor(id, flow.labels),
    });
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
  const REPORT_TYPE_LABELS = { rendimiento: 'Rendimiento por asesor', rentabilidad: 'Rentabilidad de leads', asesor: 'Ficha individual' };

  function reportRowHtml(r) {
    const label = r.type === 'asesor' && r.advisor_name ? `Ficha · ${r.advisor_name}` : REPORT_TYPE_LABELS[r.type] || r.type;
    return `
      <tr>
        <td class="p-table-cell-padding text-on-surface">${escapeHtml(label)}</td>
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

  return () => {
    off();
    window.removeEventListener('afterprint', onAfterPrint);
    document.body.classList.remove('printing-ficha');
    destroyChart(ventasAsesorCanvas);
    destroyChart(donutCanvas);
    destroyChart(comparativoCanvas);
    destroyChart(fichaTendenciaCanvas);
    destroyChart(flowCanvas);
  };
}
