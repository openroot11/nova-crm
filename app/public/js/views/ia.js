import { escapeHtml, formatMoney } from '../utils.js';
import { barChart, donutChart, destroyChart } from '../components/charts.js';

const PERIOD_LABELS = { day: 'Por Día', week: 'Por Semana', month: 'Por Mes' };

export async function mount(container, ctx) {
  container.innerHTML = `
    <div class="flex flex-col md:flex-row md:items-end justify-between gap-3 mb-margin-desktop">
      <div>
        <h2 class="text-headline-lg font-headline-lg text-on-surface">Predicción IA</h2>
        <p class="text-body-md font-body-md text-on-surface-variant mt-1">Demuestra tu próximo paso: forecast de leads y ventas basado en el historial real del CRM.</p>
      </div>
      <div class="flex items-center gap-3 flex-wrap">
        <label class="block text-[10px] font-label-bold text-on-surface-variant uppercase tracking-wider">Horizonte</label>
        <select id="forecast-horizon" class="p-2 bg-surface-container-lowest border border-outline-variant rounded-md text-body-sm outline-none focus:border-primary">
          <option value="7">7 días</option>
          <option value="15" selected>15 días</option>
          <option value="30">30 días</option>
        </select>
        <label class="block text-[10px] font-label-bold text-on-surface-variant uppercase tracking-wider">Granularidad</label>
        <select id="forecast-interval" class="p-2 bg-surface-container-lowest border border-outline-variant rounded-md text-body-sm outline-none focus:border-primary">
          <option value="day">Diario</option>
          <option value="week">Semanal</option>
          <option value="month">Mensual</option>
        </select>
        <button id="forecast-refresh" class="px-4 py-2 bg-primary text-on-primary rounded-md text-label-bold font-label-bold hover:bg-on-primary-fixed-variant transition-colors">Actualizar</button>
      </div>
    </div>

    <div class="grid grid-cols-1 xl:grid-cols-3 gap-gutter mb-gutter">
      <div class="bg-surface-container-lowest border border-outline-variant rounded-xl p-gutter shadow-sm">
        <p class="text-label-bold font-label-bold text-on-surface-variant uppercase tracking-wider mb-2">Pronóstico de Leads</p>
        <h3 id="forecast-leads" class="text-headline-lg font-headline-lg text-on-surface">0</h3>
        <p id="forecast-leads-detail" class="text-body-sm text-on-surface-variant mt-2">Promedio diario esperado para el período seleccionado.</p>
      </div>
      <div class="bg-surface-container-lowest border border-outline-variant rounded-xl p-gutter shadow-sm">
        <p class="text-label-bold font-label-bold text-on-surface-variant uppercase tracking-wider mb-2">Pronóstico de Ventas</p>
        <h3 id="forecast-sales" class="text-headline-lg font-headline-lg text-on-surface">0</h3>
        <p id="forecast-sales-detail" class="text-body-sm text-on-surface-variant mt-2">Ingresos esperados de las ventas pronosticadas.</p>
      </div>
      <div class="bg-surface-container-lowest border border-outline-variant rounded-xl p-gutter shadow-sm">
        <p class="text-label-bold font-label-bold text-on-surface-variant uppercase tracking-wider mb-2">Crecimiento Estimado</p>
        <h3 id="forecast-growth" class="text-headline-lg font-headline-lg text-on-surface">0%</h3>
        <p id="forecast-growth-detail" class="text-body-sm text-on-surface-variant mt-2">Comparado con el promedio histórico reciente.</p>
      </div>
    </div>

    <div class="grid grid-cols-1 xl:grid-cols-2 gap-gutter">
      <div class="bg-surface-container-lowest border border-outline-variant rounded-xl p-gutter shadow-sm">
        <div class="flex items-center justify-between mb-4">
          <div>
            <h3 class="text-headline-md font-headline-md text-on-surface">Histórico + Pronóstico</h3>
            <p class="text-body-sm text-on-surface-variant">Datos reales y valores proyectados para leads y ventas.</p>
          </div>
        </div>
        <div style="height:320px;"><canvas id="forecast-history-chart"></canvas></div>
      </div>
      <div class="bg-surface-container-lowest border border-outline-variant rounded-xl p-gutter shadow-sm">
        <div class="flex items-center justify-between mb-4">
          <div>
            <h3 class="text-headline-md font-headline-md text-on-surface">Proyecciones por producto</h3>
            <p class="text-body-sm text-on-surface-variant">Leads esperados por categoría de producto.</p>
          </div>
        </div>
        <div style="height:320px;"><canvas id="forecast-product-chart"></canvas></div>
      </div>
    </div>

    <div class="bg-surface-container-lowest border border-outline-variant rounded-xl p-gutter shadow-sm mt-gutter">
      <h3 class="text-headline-md font-headline-md text-on-surface mb-3">Qué representa este módulo</h3>
      <p class="text-body-md text-on-surface-variant leading-relaxed">Esta vista presenta el siguiente paso de Nova CRM: un módulo de inteligencia artificial que transforma el historial de leads en una proyección de demanda. Usa la información de los días anteriores para anticipar cuántos leads y cuántas ventas esperar, y apoya la presentación de tu clase como una función nueva y estratégica.</p>
    </div>
  `;

  const forecastLeads = container.querySelector('#forecast-leads');
  const forecastSales = container.querySelector('#forecast-sales');
  const forecastGrowth = container.querySelector('#forecast-growth');
  const forecastLeadsDetail = container.querySelector('#forecast-leads-detail');
  const forecastSalesDetail = container.querySelector('#forecast-sales-detail');
  const forecastHistoryCanvas = container.querySelector('#forecast-history-chart');
  const forecastProductCanvas = container.querySelector('#forecast-product-chart');
  const horizonInput = container.querySelector('#forecast-horizon');
  const intervalInput = container.querySelector('#forecast-interval');
  const refreshBtn = container.querySelector('#forecast-refresh');

  let lastChartData = null;

  async function loadForecast() {
    const params = new URLSearchParams({
      horizon: horizonInput.value,
      interval: intervalInput.value,
    });
    let data;
    try {
      data = await ctx.api.get(`/api/kpis/forecast?${params.toString()}`);
    } catch (err) {
      ctx.toast('No se pudo cargar la predicción IA', 'error');
      return;
    }

    forecastLeads.textContent = data.total_predicted_leads;
    forecastSales.textContent = formatMoney(data.total_predicted_revenu);
    forecastGrowth.textContent = `${data.growth_pct >= 0 ? '+' : ''}${data.growth_pct}%`;
    forecastLeadsDetail.textContent = `Promedio ${PERIOD_LABELS[data.interval]} esperado: ${data.average_leads} leads`;
    forecastSalesDetail.textContent = `Promedio ${PERIOD_LABELS[data.interval]} estimado: ${formatMoney(data.average_revenue)}`;

    lastChartData = data;
    renderCharts(data);
  }

  function renderCharts(data) {
    destroyChart(forecastHistoryCanvas);
    destroyChart(forecastProductCanvas);

    const labels = data.history.map((item) => item.label);
    const leadsData = data.history.map((item) => item.leads);
    const salesData = data.history.map((item) => item.revenue);
    barChart(forecastHistoryCanvas, {
      labels,
      data: leadsData,
      color: '#2a78d6',
      valueFormatter: (v) => v,
    });

    donutChart(forecastProductCanvas, {
      labels: data.by_product.map((item) => item.product),
      data: data.by_product.map((item) => item.leads),
      colors: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'],
    });
  }

  refreshBtn.addEventListener('click', loadForecast);
  await loadForecast();

  return () => {
    destroyChart(forecastHistoryCanvas);
    destroyChart(forecastProductCanvas);
  };
}
