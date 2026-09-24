import { escapeHtml, formatMoney, formatCompactMoney } from '../utils.js';
import { barChart, donutChart, destroyChart, CATEGORICAL_COLORS } from '../components/charts.js';
import { confirmModal } from '../components/modal.js';

// "Reporte de Servicio al Cliente" -- el tablero mensual de gerencia. Replica
// el reporte que antes se armaba a mano en diapositivas: resultados
// generales, embudo, rentabilidad de ads, resultados por asesor, comparativo
// y promedios por dia de la semana. Todo sale de GET /api/kpis/monthly (ver
// server/reporting.js computeMonthlyReport). Solo lo ve admin.

function monthRangeFromInput(monthValue) {
  const [y, m] = monthValue.split('-').map(Number);
  const from = `${monthValue}-01`;
  const to = new Date(y, m, 0).toISOString().slice(0, 10); // ultimo dia del mes
  return { from, to };
}

// Por defecto arranca en el MES ANTERIOR completo, no el mes en curso: este
// reporte se arma cuando el mes ya cerró, y comparar un mes a medias contra
// el mes anterior completo da variaciones engañosas.
function defaultMonthValue() {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(monthValue) {
  const [y, m] = monthValue.split('-').map(Number);
  const label = new Date(y, m - 1, 1).toLocaleDateString('es-CO', { month: 'long', year: 'numeric' });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

// Pildora de variacion contra el periodo anterior. `delta` ya viene en la
// unidad final (puntos porcentuales o conteo). `invert` = subir es malo
// (reasignados, represamiento). Se oculta si el cambio es despreciable.
function deltaPill(delta, { invert = false, suffix = ' pp', money = false } = {}) {
  if (delta == null) return '';
  const threshold = money ? 1 : 0.05;
  if (Math.abs(delta) < threshold) return '';
  const up = delta > 0;
  const good = invert ? !up : up;
  const text = money ? `${up ? '+' : '−'}${formatCompactMoney(Math.abs(delta))}` : `${up ? '+' : '−'}${Math.abs(delta)}${suffix}`;
  return `<span class="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold ${
    good ? 'bg-secondary-container text-on-secondary-container' : 'bg-error-container text-on-error-container'
  }"><span class="material-symbols-outlined text-[11px]">${up ? 'trending_up' : 'trending_down'}</span>${text}</span>`;
}

function statTile(label, value, sub = '', icon = '') {
  return `
    <div class="border border-outline-variant rounded-xl p-3">
      <div class="flex items-center gap-1.5 mb-1">
        ${icon ? `<span class="material-symbols-outlined text-[15px] text-on-surface-variant">${icon}</span>` : ''}
        <p class="text-[9.5px] font-label-bold text-on-surface-variant uppercase tracking-wider leading-tight">${label}</p>
      </div>
      <p class="text-headline-sm font-headline-sm text-on-surface">${value}</p>
      ${sub ? `<p class="text-[11px] text-on-surface-variant mt-0.5">${sub}</p>` : ''}
    </div>`;
}

function indicatorTiles(ind, deltas, hideDelta) {
  const d = hideDelta ? {} : deltas || {};
  return [
    ['Efectividad Asesores', `${ind.efectividad_asesor}%`, 'military_tech', deltaPill(d.efectividad_asesor)],
    ['Cotizados / Asignados', `${ind.cotizados_sobre_asignados}%`, 'request_quote', deltaPill(d.cotizados_sobre_asignados)],
    ['Prom. Semanal sin Cotizar', ind.prom_semanal_sin_cotizar, 'schedule', deltaPill(d.prom_semanal_sin_cotizar, { invert: true, suffix: '' })],
    ['Tasa de Reasignados', `${ind.tasa_reasignados}%`, 'sync_problem', deltaPill(d.tasa_reasignados, { invert: true })],
    ['Tasa de Cierre', `${ind.tasa_cierre}%`, 'trending_up', deltaPill(d.tasa_cierre)],
  ]
    .map(
      ([label, value, icon, pill]) => `
      <div class="border border-outline-variant rounded-xl p-3">
        <div class="flex items-center gap-1.5 mb-1">
          <span class="material-symbols-outlined text-[15px] text-on-surface-variant">${icon}</span>
          <p class="text-[9.5px] font-label-bold text-on-surface-variant uppercase tracking-wider leading-tight">${label}</p>
        </div>
        <div class="flex items-center gap-1.5">
          <p class="text-headline-sm font-headline-sm text-on-surface">${value}</p>
          ${pill}
        </div>
      </div>`
    )
    .join('');
}

export async function mount(container, ctx) {
  const printStyleId = 'reporte-print-style';
  if (!document.getElementById(printStyleId)) {
    const style = document.createElement('style');
    style.id = printStyleId;
    style.media = 'print';
    style.textContent = `
      #sidebar, #topbar, .no-print { display: none !important; }
      #main-col { margin-left: 0 !important; }
      body { background: #fff !important; }
      #reporte-root .break-page { break-before: page; }
      #reporte-root section { break-inside: avoid; }
    `;
    document.head.appendChild(style);
  }

  container.innerHTML = `
    <div id="reporte-root">
      <div class="flex flex-wrap justify-between items-end gap-4 mb-margin-desktop">
        <div>
          <h2 class="text-headline-lg font-headline-lg text-on-surface">Reporte de Servicio al Cliente</h2>
          <p class="text-body-md font-body-md text-on-surface-variant mt-1" id="reporte-subtitle">Resultados del mes — <span id="reporte-periodo">—</span></p>
        </div>
        <div class="flex items-end gap-3 flex-wrap no-print">
          <div>
            <label class="block text-[10px] font-label-bold text-on-surface-variant mb-1 uppercase tracking-wider">Mes</label>
            <input id="reporte-month" type="month" class="p-2 bg-surface-container-lowest border border-outline-variant rounded-md text-body-sm outline-none focus:border-outline" />
          </div>
          <button id="reporte-pdf" class="px-3 py-2 border border-outline-variant rounded-md text-label-bold font-label-bold text-on-surface hover:bg-surface-container-low transition-colors flex items-center gap-1.5">
            <span class="material-symbols-outlined text-[16px]">picture_as_pdf</span> Descargar PDF
          </button>
          <button id="reporte-archivar" class="btn btn-primary">
            <span class="material-symbols-outlined text-[16px]">archive</span> Generar y archivar
          </button>
        </div>
      </div>

      <div id="reporte-loading" class="p-10 text-center text-on-surface-variant">Cargando reporte…</div>

      <div id="reporte-content" class="hidden space-y-margin-desktop">
        <!-- 1. Resultados generales -->
        <section>
          <h3 class="text-headline-md font-headline-md text-on-surface mb-1">Resultados generales</h3>
          <p class="text-body-sm font-body-sm text-on-surface-variant mb-4" id="reporte-compara-nota"></p>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-gutter mb-gutter">
            <div class="bg-surface-container-lowest border border-outline-variant rounded-xl p-gutter shadow-sm">
              <div class="flex items-center gap-2 mb-1">
                <p class="text-label-bold font-label-bold text-on-surface-variant uppercase tracking-wider">Total Ventas</p>
                <span id="g-ventas-delta"></span>
              </div>
              <p id="g-ventas" class="text-display-kpi font-display-kpi text-on-surface leading-none">0</p>
              <p id="g-tasa-cierre" class="text-body-sm font-body-sm text-secondary mt-2">0% tasa de cierre</p>
            </div>
            <div class="bg-surface-container-lowest border border-outline-variant rounded-xl p-gutter shadow-sm">
              <div class="flex items-center gap-2 mb-1">
                <p class="text-label-bold font-label-bold text-on-surface-variant uppercase tracking-wider">Monto Total</p>
                <span id="g-monto-delta"></span>
              </div>
              <p id="g-monto" class="text-headline-lg font-headline-lg text-on-surface">$0</p>
              <p id="g-ticket" class="text-body-sm font-body-sm text-on-surface-variant mt-2">Ticket de venta $0</p>
            </div>
          </div>
          <p class="text-[10px] font-label-bold text-on-surface-variant uppercase tracking-wider mb-2">Indicadores de desempeño</p>
          <div id="g-indicadores" class="grid grid-cols-2 md:grid-cols-5 gap-3"></div>
        </section>

        <!-- 2. Embudo de conversión -->
        <section>
          <h3 class="text-headline-md font-headline-md text-on-surface mb-1">Embudo de conversión</h3>
          <p class="text-body-sm font-body-sm text-on-surface-variant mb-4">De todo lo que entra al negocio (mensajes y llamadas) a lo que se cotiza.</p>
          <div id="embudo-cards" class="grid grid-cols-1 md:grid-cols-3 gap-gutter"></div>
        </section>

        <!-- 3. Rentabilidad de la inversión publicitaria -->
        <section>
          <h3 class="text-headline-md font-headline-md text-on-surface mb-1">Rentabilidad de la inversión publicitaria</h3>
          <p class="text-body-sm font-body-sm text-on-surface-variant mb-4">Inversión en Google Ads del periodo contra todo lo que entra y todo lo que se vende.</p>
          <div id="rent-cards" class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4"></div>
          <div class="flex flex-wrap items-center gap-3">
            <p id="rent-frase" class="text-body-md font-body-md text-on-surface"></p>
            <span id="rent-ticket" class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-secondary-container text-on-secondary-container text-body-sm font-semibold"></span>
          </div>
        </section>

        <!-- 4. Resultados individuales -->
        <section>
          <h3 class="text-headline-md font-headline-md text-on-surface mb-1">Resultados individuales</h3>
          <p class="text-body-sm font-body-sm text-on-surface-variant mb-4">Rendimiento por asesor. Las apreciaciones y observaciones se sugieren solas y se pueden editar antes de archivar.</p>
          <div id="asesores-list" class="space-y-gutter"></div>
        </section>

        <!-- 5. Comparativo por asesor -->
        <section class="bg-surface-container-lowest border border-outline-variant rounded-xl p-gutter shadow-sm">
          <div class="flex flex-wrap items-center justify-between gap-3 mb-4">
            <h3 class="text-headline-md font-headline-md text-on-surface">Comparativo por asesor</h3>
            <div id="comp-tabs" class="flex bg-surface-container-low rounded-md p-1 text-body-sm font-label-bold no-print"></div>
          </div>
          <div class="grid grid-cols-1 lg:grid-cols-2 gap-gutter items-center">
            <div style="height:260px;"><canvas id="comp-donut"></canvas></div>
            <div style="height:260px;"><canvas id="comp-bars"></canvas></div>
          </div>
        </section>

        <!-- 6. Promedios por día -->
        <section class="bg-surface-container-lowest border border-outline-variant rounded-xl p-gutter shadow-sm">
          <h3 class="text-headline-md font-headline-md text-on-surface mb-1">Promedios por día</h3>
          <p class="text-body-sm font-body-sm text-on-surface-variant mb-4">Promedio por día de la semana en el periodo.</p>
          <div class="grid grid-cols-1 md:grid-cols-3 gap-gutter">
            <div>
              <p class="text-label-bold font-label-bold text-on-surface-variant uppercase tracking-wider mb-2 text-center">Leads ingresados</p>
              <div style="height:200px;"><canvas id="dia-ingresados"></canvas></div>
            </div>
            <div>
              <p class="text-label-bold font-label-bold text-on-surface-variant uppercase tracking-wider mb-2 text-center">Leads asignados</p>
              <div style="height:200px;"><canvas id="dia-asignados"></canvas></div>
            </div>
            <div>
              <p class="text-label-bold font-label-bold text-on-surface-variant uppercase tracking-wider mb-2 text-center">Ventas</p>
              <div style="height:200px;"><canvas id="dia-ventas"></canvas></div>
            </div>
          </div>
        </section>

        <!-- Historial -->
        <section class="bg-surface-container-lowest border border-outline-variant rounded-xl p-gutter shadow-sm no-print">
          <div class="flex items-center gap-3 mb-4 border-b border-outline-variant pb-3">
            <span class="material-symbols-outlined text-on-surface-variant">history</span>
            <h3 class="text-headline-md font-headline-md text-on-surface">Reportes archivados</h3>
          </div>
          <div class="overflow-x-auto">
            <table class="w-full text-left border-collapse min-w-[520px]">
              <thead>
                <tr class="bg-surface-container-low border-b border-outline-variant">
                  <th class="p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase tracking-wider">Periodo</th>
                  <th class="p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase tracking-wider">Generado</th>
                  <th class="p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase tracking-wider">Por</th>
                  <th class="p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase tracking-wider text-right">Exportar</th>
                </tr>
              </thead>
              <tbody id="historial-tbody" class="divide-y divide-outline-variant"></tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  `;

  const monthInput = container.querySelector('#reporte-month');
  const periodoEl = container.querySelector('#reporte-periodo');
  const loadingEl = container.querySelector('#reporte-loading');
  const contentEl = container.querySelector('#reporte-content');
  const comparaNota = container.querySelector('#reporte-compara-nota');
  const gVentas = container.querySelector('#g-ventas');
  const gVentasDelta = container.querySelector('#g-ventas-delta');
  const gTasaCierre = container.querySelector('#g-tasa-cierre');
  const gMonto = container.querySelector('#g-monto');
  const gMontoDelta = container.querySelector('#g-monto-delta');
  const gTicket = container.querySelector('#g-ticket');
  const gIndicadores = container.querySelector('#g-indicadores');
  const embudoCards = container.querySelector('#embudo-cards');
  const rentCards = container.querySelector('#rent-cards');
  const rentFrase = container.querySelector('#rent-frase');
  const rentTicket = container.querySelector('#rent-ticket');
  const asesoresList = container.querySelector('#asesores-list');
  const compTabs = container.querySelector('#comp-tabs');
  const compDonut = container.querySelector('#comp-donut');
  const compBars = container.querySelector('#comp-bars');
  const diaIngresados = container.querySelector('#dia-ingresados');
  const diaAsignados = container.querySelector('#dia-asignados');
  const diaVentas = container.querySelector('#dia-ventas');
  const historialTbody = container.querySelector('#historial-tbody');

  monthInput.value = defaultMonthValue();

  let report = null;
  // Notas editadas por gerencia, por advisor_id: { apreciaciones:[], observaciones:[] }.
  // Se siembra con las sugerencias del backend y se manda tal cual al archivar.
  let notas = {};

  const COMP_METRICS = [
    { key: 'cotizados', label: 'Cotizados' },
    { key: 'pendientes_por_cotizar', label: 'Por cotizar' },
    { key: 'reasignados', label: 'Reasignados' },
    { key: 'vendidos', label: 'Ventas' },
  ];
  let activeComp = 'cotizados';

  async function load() {
    const { from, to } = monthRangeFromInput(monthInput.value);
    periodoEl.textContent = monthLabel(monthInput.value);
    loadingEl.classList.remove('hidden');
    loadingEl.textContent = 'Cargando reporte…';
    contentEl.classList.add('hidden');

    try {
      report = await ctx.api.get(`/api/kpis/monthly?from=${from}&to=${to}`);
    } catch (err) {
      loadingEl.textContent = 'No se pudo cargar el reporte.';
      ctx.toast(err.message || 'No se pudo cargar el reporte', 'error');
      return;
    }

    notas = {};
    for (const a of report.asesores) {
      notas[a.advisor_id] = {
        apreciaciones: [...(a.apreciaciones || [])],
        observaciones: [...(a.observaciones || [])],
      };
    }

    loadingEl.classList.add('hidden');
    contentEl.classList.remove('hidden');
    renderGenerales();
    renderEmbudo();
    renderRentabilidad();
    renderAsesores();
    renderComparativoTabs();
    renderComparativo();
    renderPromedios();
  }

  function renderGenerales() {
    const g = report.generales;
    const hideDelta = !report.comparado_con.comparable;
    comparaNota.textContent = hideDelta
      ? `Comparado con ${report.comparado_con.from} a ${report.comparado_con.to} — sin datos suficientes en ese periodo para mostrar variaciones.`
      : `Variación contra el periodo anterior (${report.comparado_con.from} a ${report.comparado_con.to}).`;

    gVentas.textContent = g.total_ventas;
    gTasaCierre.textContent = `${g.tasa_cierre}% tasa de cierre`;
    gVentasDelta.innerHTML = hideDelta ? '' : deltaPill(g.deltas.total_ventas, { suffix: '' });
    gMonto.textContent = formatMoney(g.monto_total);
    gMontoDelta.innerHTML = hideDelta ? '' : deltaPill(g.deltas.monto_total, { money: true });
    gTicket.textContent = `Ticket de venta ${formatMoney(g.ticket_venta)}`;
    gIndicadores.innerHTML = indicatorTiles(g.indicadores, g.deltas, hideDelta);
  }

  function embudoCard(titulo, valor, nota, ancho) {
    return `
      <div class="bg-surface-container-lowest border border-outline-variant rounded-xl p-gutter shadow-sm">
        <p class="text-label-bold font-label-bold text-on-surface-variant uppercase tracking-wider mb-2">${titulo}</p>
        <p class="text-display-kpi font-display-kpi text-on-surface leading-none">${valor}</p>
        <div class="h-1.5 bg-surface-container-high rounded-full mt-4 overflow-hidden">
          <div class="h-full bg-on-surface-variant/60 rounded-full" style="width:${ancho}%"></div>
        </div>
        <p class="text-body-sm font-body-sm text-on-surface-variant mt-2">${nota}</p>
      </div>`;
  }

  function renderEmbudo() {
    const e = report.embudo;
    embudoCards.innerHTML = [
      embudoCard('Total leads', e.total_leads_crudos, 'Todos los mensajes y llamadas que llegan al negocio.', 100),
      embudoCard('Total asignados', e.asignados, `Representan el <b class="text-on-surface">${e.asignados_pct}%</b> de todos los leads que ingresan.`, e.total_leads_crudos ? (e.asignados / e.total_leads_crudos) * 100 : 0),
      embudoCard('Total cotizados', e.cotizados, `Representan el <b class="text-on-surface">${e.cotizados_pct}%</b> de todos los leads que ingresan.`, e.total_leads_crudos ? (e.cotizados / e.total_leads_crudos) * 100 : 0),
    ].join('');
  }

  function renderRentabilidad() {
    const r = report.rentabilidad;
    rentCards.innerHTML = [
      statTile('Inversión en ads', formatMoney(r.inversion), 'Google Ads del periodo', 'payments'),
      statTile('Costo por lead', r.costo_por_lead != null ? formatMoney(r.costo_por_lead) : '—', 'Inversión / total de leads', 'person_search'),
      statTile('Costo por venta', r.costo_por_venta != null ? formatMoney(r.costo_por_venta) : '—', 'Inversión / total de ventas', 'sell'),
      statTile('ROI', r.roi_veces != null ? `${r.roi_veces}×` : '—', r.roi_pct != null ? `${r.roi_pct}% de retorno` : '', 'trending_up'),
    ].join('');
    rentFrase.innerHTML =
      r.ads_pct_of_sales != null
        ? `El costo en ads representa solo el <b>${r.ads_pct_of_sales}%</b> de las ventas que genera.`
        : 'Sin inversión registrada en el periodo.';
    rentTicket.innerHTML = `<span class="material-symbols-outlined text-[16px]">confirmation_number</span> Ticket de venta: ${formatMoney(r.ticket_venta)}`;
  }

  function noteChips(advisorId, kind) {
    const list = notas[advisorId][kind];
    const color = kind === 'apreciaciones' ? 'bg-secondary-container text-on-secondary-container' : 'bg-tertiary-container text-on-tertiary-container';
    const chips = list
      .map(
        (txt, i) => `
        <span class="inline-flex items-center gap-1 pl-2.5 pr-1 py-1 rounded-full text-body-sm ${color}">
          ${escapeHtml(txt)}
          <button type="button" data-note-remove data-advisor="${advisorId}" data-kind="${kind}" data-idx="${i}" class="w-4 h-4 inline-flex items-center justify-center rounded-full hover:bg-on-surface/10 no-print">
            <span class="material-symbols-outlined text-[13px]">close</span>
          </button>
        </span>`
      )
      .join('');
    return `
      <div class="flex flex-wrap gap-1.5 mb-2" data-note-chips data-advisor="${advisorId}" data-kind="${kind}">
        ${chips || `<span class="text-body-sm text-on-surface-variant italic">Sin ${kind === 'apreciaciones' ? 'apreciaciones' : 'observaciones'}.</span>`}
      </div>
      <div class="flex gap-2 no-print">
        <input type="text" data-note-input data-advisor="${advisorId}" data-kind="${kind}" placeholder="Agregar…" class="flex-1 p-1.5 bg-surface-container-lowest border border-outline-variant rounded-md text-body-sm outline-none focus:border-outline" />
        <button type="button" data-note-add data-advisor="${advisorId}" data-kind="${kind}" class="px-2.5 py-1.5 border border-outline-variant rounded-md text-label-bold font-label-bold text-on-surface hover:bg-surface-container-low transition-colors">Agregar</button>
      </div>`;
  }

  function asesorCard(a, idx) {
    const hideDelta = !report.comparado_con.comparable;
    const pctBar = Math.max(2, Math.min(100, a.asignados_pct_equipo));
    return `
      <div class="bg-surface-container-lowest border border-outline-variant rounded-xl p-gutter shadow-sm ${idx > 0 ? 'break-page' : ''}">
        <div class="flex flex-wrap items-start justify-between gap-4 mb-5">
          <div class="flex items-center gap-3 min-w-[220px] flex-1">
            <div class="w-11 h-11 rounded-full bg-surface-container-highest flex items-center justify-center font-bold text-on-surface-variant shrink-0">${escapeHtml(a.inicial)}</div>
            <div class="flex-1">
              <p class="text-headline-sm font-headline-sm text-on-surface">${escapeHtml(a.name)}</p>
              <p class="text-body-sm font-body-sm text-on-surface-variant">${a.asignados_pct_equipo}% del total · ${a.asignados} leads · ranking #${a.rank}</p>
              <div class="h-1.5 bg-surface-container-high rounded-full mt-1.5 overflow-hidden max-w-[220px]">
                <div class="h-full bg-on-surface-variant/60 rounded-full" style="width:${pctBar}%"></div>
              </div>
            </div>
          </div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-gutter mb-gutter">
          <div class="border border-outline-variant rounded-xl p-4">
            <p class="text-label-bold font-label-bold text-secondary uppercase tracking-wider mb-2">Apreciaciones positivas</p>
            ${noteChips(a.advisor_id, 'apreciaciones')}
          </div>
          <div class="border border-outline-variant rounded-xl p-4">
            <p class="text-label-bold font-label-bold text-on-tertiary-container uppercase tracking-wider mb-2">Observaciones</p>
            ${noteChips(a.advisor_id, 'observaciones')}
          </div>
        </div>

        <div class="grid grid-cols-2 md:grid-cols-5 gap-3 mb-gutter">
          ${statTile('Total cotizados', a.cotizados, `${a.cotizados_pct_crudo}% del total`)}
          ${statTile('Por cotizar', a.pendientes_por_cotizar, `al ${report.to}`)}
          ${statTile('Reasignados', a.reasignados, 'leads transferidos')}
          ${statTile('Total ventas', a.vendidos, `${a.tasa_cierre}% tasa de cierre`)}
          ${statTile('Monto total', formatMoney(a.monto_vendido), `Prom. ${formatMoney(a.ticket_venta)} / venta`)}
        </div>

        <p class="text-[10px] font-label-bold text-on-surface-variant uppercase tracking-wider mb-2">Indicadores de desempeño</p>
        <div class="grid grid-cols-2 md:grid-cols-5 gap-3 mb-gutter">
          ${indicatorTiles(a.indicadores, a.deltas, hideDelta)}
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-gutter">
          ${statTile('Ticket de venta', formatMoney(a.ticket_venta), 'El monto promedio de sus ventas')}
          ${statTile('Ventas por día', a.ventas_por_dia_texto, 'Promedio por día hábil')}
        </div>
        <p class="text-body-md font-body-md text-on-surface mt-4">
          La participación en ventas del asesor representa el <b>${a.participacion_ventas_pct}%</b> de las ventas por ADS.
        </p>
      </div>`;
  }

  function renderAsesores() {
    // Solo asesores con actividad en el periodo -- una ficha entera en cero
    // (asesor nuevo o inactivo ese mes) es ruido. Igual aparecen en el
    // comparativo de abajo.
    const activos = report.asesores.filter((a) => a.asignados >= 5 || a.vendidos > 0);
    asesoresList.innerHTML = activos.length
      ? activos.map((a, i) => asesorCard(a, i)).join('')
      : `<p class="text-body-sm text-on-surface-variant text-center py-8 border border-outline-variant rounded-xl">Sin asesores con leads asignados en el periodo.</p>`;
  }

  function renderComparativoTabs() {
    compTabs.innerHTML = COMP_METRICS.map(
      (m) =>
        `<button data-comp="${m.key}" class="comp-btn px-3 py-1 rounded transition-colors ${
          m.key === activeComp ? 'bg-surface text-on-surface shadow-sm font-bold' : 'text-on-surface-variant'
        }">${m.label}</button>`
    ).join('');
  }

  function renderComparativo() {
    const asesores = report.asesores;
    const values = asesores.map((a) => a[activeComp] || 0);
    const labels = asesores.map((a) => a.name);
    const colors = asesores.map((_, i) => CATEGORICAL_COLORS[i % CATEGORICAL_COLORS.length]);
    const total = values.reduce((s, v) => s + v, 0);

    donutChart(compDonut, { labels: labels.map((l, i) => `${l} (${total ? Math.round((values[i] / total) * 100) : 0}%)`), data: values, colors });
    barChart(compBars, { labels, data: values, color: colors });
  }

  function weekdayChart(canvas, data, key, color) {
    // Lunes a sábado, como el reporte original (el domingo no opera).
    const rows = data.filter((d) => d.weekday <= 6);
    barChart(canvas, {
      labels: rows.map((d) => d.label.slice(0, 3)),
      data: rows.map((d) => d[key]),
      color,
    });
  }

  function renderPromedios() {
    weekdayChart(diaIngresados, report.promedios_por_dia, 'ingresados', CATEGORICAL_COLORS[0]);
    weekdayChart(diaAsignados, report.promedios_por_dia, 'asignados', CATEGORICAL_COLORS[2]);
    weekdayChart(diaVentas, report.promedios_por_dia, 'ventas', '#981b1e');
  }

  // --- edición de notas -------------------------------------------------
  asesoresList.addEventListener('click', (e) => {
    const remove = e.target.closest('[data-note-remove]');
    if (remove) {
      const { advisor, kind, idx } = remove.dataset;
      notas[advisor][kind].splice(Number(idx), 1);
      renderAsesores();
      return;
    }
    const add = e.target.closest('[data-note-add]');
    if (add) {
      const { advisor, kind } = add.dataset;
      const input = asesoresList.querySelector(`[data-note-input][data-advisor="${advisor}"][data-kind="${kind}"]`);
      const val = input.value.trim();
      if (!val) return;
      notas[advisor][kind].push(val);
      renderAsesores();
    }
  });
  asesoresList.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const input = e.target.closest('[data-note-input]');
    if (!input) return;
    e.preventDefault();
    const { advisor, kind } = input.dataset;
    const val = input.value.trim();
    if (!val) return;
    notas[advisor][kind].push(val);
    renderAsesores();
  });

  compTabs.addEventListener('click', (e) => {
    const btn = e.target.closest('.comp-btn');
    if (!btn) return;
    activeComp = btn.dataset.comp;
    renderComparativoTabs();
    renderComparativo();
  });

  // --- historial ------------------------------------------------------
  const canDelete = ctx.user?.role === 'admin';
  function historialRow(r) {
    return `
      <tr>
        <td class="p-table-cell-padding text-on-surface">${escapeHtml(r.period_from)} → ${escapeHtml(r.period_to)}</td>
        <td class="p-table-cell-padding text-on-surface-variant">${escapeHtml((r.generated_at || '').replace('T', ' ').slice(0, 16))}</td>
        <td class="p-table-cell-padding text-on-surface-variant">${escapeHtml(r.generated_by || '—')}</td>
        <td class="p-table-cell-padding text-right">
          <div class="flex items-center justify-end gap-3">
            <a href="/api/reports/${r.id}/xlsx" class="inline-flex items-center gap-1 text-on-surface hover:text-on-primary-fixed-variant text-body-sm font-label-bold">
              <span class="material-symbols-outlined text-[16px]">download</span> Excel
            </a>
            ${canDelete ? `<button data-del-report="${r.id}" class="inline-flex items-center gap-1 text-error hover:opacity-80 text-body-sm font-label-bold"><span class="material-symbols-outlined text-[16px]">delete</span> Borrar</button>` : ''}
          </div>
        </td>
      </tr>`;
  }

  async function loadHistorial() {
    let rows;
    try {
      rows = await ctx.api.get('/api/reports?type=mensual');
    } catch {
      return;
    }
    historialTbody.innerHTML = rows.length
      ? rows.map(historialRow).join('')
      : `<tr><td colspan="4" class="p-table-cell-padding py-8 text-center text-body-sm text-on-surface-variant">Aún no se ha archivado ningún reporte.</td></tr>`;
  }

  historialTbody.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-del-report]');
    if (!btn) return;
    const ok = await confirmModal({
      title: 'Borrar reporte archivado',
      message: 'Esta foto fija del reporte mensual se eliminará del historial. No se puede deshacer.',
      confirmLabel: 'Borrar reporte',
      danger: true,
    });
    if (!ok) return;
    try {
      await ctx.api.del(`/api/reports/${btn.dataset.delReport}`);
      ctx.toast('Reporte eliminado', 'success');
      loadHistorial();
    } catch (err) {
      ctx.toast(err.message, 'error');
    }
  });

  // --- acciones -----------------------------------------------------
  monthInput.addEventListener('change', load);
  container.querySelector('#reporte-pdf').addEventListener('click', () => window.print());
  container.querySelector('#reporte-archivar').addEventListener('click', async (e) => {
    if (!report) return;
    e.currentTarget.disabled = true;
    try {
      await ctx.api.post('/api/reports', { type: 'mensual', from: report.from, to: report.to, notas });
      ctx.toast('Reporte de gerencia archivado', 'success');
      loadHistorial();
    } catch (err) {
      ctx.toast(err.message || 'No se pudo archivar el reporte', 'error');
    } finally {
      e.currentTarget.disabled = false;
    }
  });

  const off = ctx.ws.on('leads_changed', load);
  await Promise.all([load(), loadHistorial()]);

  return () => {
    off();
    [compDonut, compBars, diaIngresados, diaAsignados, diaVentas].forEach(destroyChart);
  };
}
