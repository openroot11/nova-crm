import { escapeHtml, formatMoney, copyNameBtn, bindCopyButtons } from '../utils.js';
import { barChart, destroyChart, CATEGORICAL_COLORS } from '../components/charts.js';
import { openQuickSaleModal } from '../components/quickSaleModal.js';
import { openEditLeadModal } from '../components/leadActions.js';
import { kpiTile } from '../components/kpiTile.js';

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
        <div class="relative">
          <label class="block text-[10px] font-label-bold text-on-surface-variant mb-1 uppercase tracking-wider">Buscar</label>
          <span class="material-symbols-outlined absolute left-2.5 bottom-2.5 text-on-surface-variant text-[18px]">search</span>
          <input id="vc-search" type="text" placeholder="Cliente, producto, asesor, referencia..." class="pl-8 pr-3 py-2 bg-surface-container-lowest border border-outline-variant rounded-md text-body-sm outline-none focus:border-outline w-56" />
        </div>
        <div>
          <label class="block text-[10px] font-label-bold text-on-surface-variant mb-1 uppercase tracking-wider">Asesor</label>
          <select id="vc-asesor" class="p-2 bg-surface-container-lowest border border-outline-variant rounded-md text-body-sm outline-none focus:border-outline">
            <option value="">Todos</option>
          </select>
        </div>
        <div>
          <label class="block text-[10px] font-label-bold text-on-surface-variant mb-1 uppercase tracking-wider">Desde</label>
          <input id="vc-from" type="date" class="p-2 bg-surface-container-lowest border border-outline-variant rounded-md text-body-sm outline-none focus:border-outline" />
        </div>
        <div>
          <label class="block text-[10px] font-label-bold text-on-surface-variant mb-1 uppercase tracking-wider">Hasta</label>
          <input id="vc-to" type="date" class="p-2 bg-surface-container-lowest border border-outline-variant rounded-md text-body-sm outline-none focus:border-outline" />
        </div>
        <label class="flex items-center gap-2 px-3 py-2 border border-outline-variant rounded-md text-label-bold font-label-bold text-on-surface-variant cursor-pointer hover:bg-surface-container-lowest transition-colors" title="Solo ventas con referencia PED (pedido ya facturado/pagado) -- excluye las que aún solo tienen la referencia de cotización (S0...), que se cerraron en el sistema pero todavía no entran como pedido real.">
          <input id="vc-paid-only" type="checkbox" class="rounded" />
          Solo pagadas (PED)
        </label>
        <button id="vc-filter-clear" class="px-3 py-2 rounded-md border border-outline-variant text-body-sm font-label-bold text-on-surface-variant hover:bg-surface-container-lowest transition-colors">Limpiar filtros</button>
        <p id="vc-search-hint" class="hidden w-full text-[11px] text-secondary flex items-center gap-1"><span class="material-symbols-outlined text-[13px]">info</span>Buscando en todas las ventas cerradas — Asesor, rango de fechas y "Solo pagadas (PED)" no aplican mientras haya texto en el buscador (la búsqueda ya incluye la referencia de venta).</p>
        <button id="vc-export-btn" class="px-3 py-2 rounded-md border border-outline-variant text-body-sm font-label-bold text-on-surface-variant hover:bg-surface-container-lowest transition-colors flex items-center gap-1.5" title="Descarga en Excel las ventas cerradas que cumplen los filtros de arriba: cliente, referencia de venta y total">
          <span class="material-symbols-outlined text-[18px]">download</span> Exportar Excel
        </button>
        <button id="btn-quick-sale" class="px-3 py-2 bg-primary text-on-primary rounded-md font-label-bold text-label-bold hover:opacity-90 transition-colors flex items-center gap-1.5">
          <span class="material-symbols-outlined text-[18px]">bolt</span> Registrar venta
        </button>
      </div>
    </div>

    <div id="vc-kpis" class="grid grid-cols-1 sm:grid-cols-2 gap-gutter mb-gutter"></div>

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
              <th class="p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase whitespace-nowrap">Origen</th>
              <th class="p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase whitespace-nowrap">Referencia</th>
              <th class="p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase whitespace-nowrap text-right">Monto</th>
              <th class="p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase whitespace-nowrap">Fecha de cierre</th>
              <th class="p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase whitespace-nowrap text-right">Acciones</th>
            </tr>
          </thead>
          <tbody id="vc-tbody" class="text-body-md font-body-md divide-y divide-outline-variant"></tbody>
        </table>
      </div>
      <div id="vc-loadmore-wrap" class="hidden p-4 border-t border-outline-variant text-center">
        <button id="vc-loadmore-btn" class="px-4 py-2 rounded-lg border border-outline-variant text-body-sm font-label-bold text-on-surface hover:bg-surface-container-low transition-colors">Mostrar más</button>
        <p id="vc-loadmore-info" class="text-[11px] text-on-surface-variant mt-1"></p>
      </div>
    </div>
  `;

  const searchInput = container.querySelector('#vc-search');
  const asesorInput = container.querySelector('#vc-asesor');
  const fromInput = container.querySelector('#vc-from');
  const toInput = container.querySelector('#vc-to');
  const paidOnlyInput = container.querySelector('#vc-paid-only');
  const searchHint = container.querySelector('#vc-search-hint');
  const kpisEl = container.querySelector('#vc-kpis');
  const trendCanvas = container.querySelector('#vc-trend-chart');
  const advisorCanvas = container.querySelector('#vc-advisor-chart');
  const tbody = container.querySelector('#vc-tbody');
  const countBadge = container.querySelector('#vc-count-badge');
  const loadmoreWrap = container.querySelector('#vc-loadmore-wrap');
  const loadmoreInfo = container.querySelector('#vc-loadmore-info');
  const loadmoreBtn = container.querySelector('#vc-loadmore-btn');

  let ventas = [];
  let visibleCount = PAGE_SIZE;
  let searchQuery = '';

  // Busqueda local sobre lo ya cargado (ventas, acotado por asesor/rango):
  // no pega al backend, asi que tambien puede filtrar por producto/asesor/
  // referencia ademas de cliente, que es mas de lo que cubre el "q" del
  // backend (solo client_name/phone/document).
  function visibleVentas() {
    if (!searchQuery) return ventas;
    const term = searchQuery.toLowerCase();
    return ventas.filter((l) =>
      (l.client_name || '').toLowerCase().includes(term) ||
      (l.product || '').toLowerCase().includes(term) ||
      (l.advisor_name || '').toLowerCase().includes(term) ||
      (l.sale_reference || '').toLowerCase().includes(term)
    );
  }

  // Filtros compartidos por la tabla y los dos graficos: asesor y "solo
  // pagadas" (PED). Asi los tres siempre muestran el mismo recorte de datos.
  // No hay filtro de canal aqui: todo lo que llega a esta pantalla ya es
  // Google Ads (ver leads_visible en server/db.js), asi que filtrar por
  // channel_detail no cambiaria nada.
  function extraFilterParams(params) {
    if (asesorInput.value) params.set('advisor_id', asesorInput.value);
    if (paidOnlyInput.checked) params.set('paid_only', '1');
    return params;
  }

  function rangeParams() {
    const params = new URLSearchParams();
    if (fromInput.value) params.set('from', fromInput.value);
    if (toInput.value) params.set('to', toInput.value);
    return extraFilterParams(params);
  }

  async function loadAdvisorOptions() {
    // Incluye tambien asesores pausados, para poder filtrar el historico de
    // ventas de alguien que ya no esta activo (igual criterio que en Ventas).
    let advisors = [];
    try {
      advisors = await ctx.api.get('/api/advisors');
    } catch {
      return;
    }
    const prev = asesorInput.value;
    asesorInput.innerHTML =
      '<option value="">Todos</option>' +
      advisors.filter((a) => !a.is_group).map((a) => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join('');
    if (advisors.some((a) => String(a.id) === prev)) asesorInput.value = prev;
  }

  function clientCellHtml(lead) {
    if (!lead.client_id) return `<div class="flex items-center gap-1.5">${escapeHtml(lead.client_name)}${copyNameBtn(lead.client_name)}</div>`;
    return `
      <div class="flex items-center gap-1.5">
        <button data-action="open-client" data-client-id="${lead.client_id}" class="hover:text-on-surface hover:underline transition-colors text-left">
          ${escapeHtml(lead.client_name)}
        </button>
        ${copyNameBtn(lead.client_name)}
      </div>`;
  }

  // Badge informativo, no editable desde aqui: esta pantalla solo trae leads
  // con channel_detail = 'Google Ads' (ver leads_visible en server/db.js),
  // asi que en la practica siempre va a decir "Google Ads". Cambiar el
  // origen a otra cosa (desde "editar") sigue siendo posible, pero desde
  // ahi -- y esa venta desaparece de Ventas Cerradas en el siguiente
  // refresco (ya no pasa el filtro), aunque sigue intacta en la base y
  // visible en la ficha del cliente.
  function origenCellHtml(lead) {
    const isAds = lead.channel_detail === 'Google Ads';
    return `<span class="px-2 py-0.5 rounded-full text-[11px] font-label-bold ${isAds ? 'bg-primary-container text-on-primary-container' : 'bg-surface-container-high text-on-surface-variant'}">${escapeHtml(lead.channel_detail || 'Sin definir')}</span>`;
  }

  function rowHtml(lead) {
    return `
      <tr class="hover:bg-surface-container-low transition-colors">
        <td class="p-table-cell-padding font-bold">${clientCellHtml(lead)}</td>
        <td class="p-table-cell-padding text-on-surface-variant">${escapeHtml(lead.advisor_name || '—')}</td>
        <td class="p-table-cell-padding text-on-surface-variant">${escapeHtml(lead.product || '—')}</td>
        <td class="p-table-cell-padding">${origenCellHtml(lead)}</td>
        <td class="p-table-cell-padding text-on-surface-variant font-mono text-[12px]">${escapeHtml(lead.sale_reference || '—')}</td>
        <td class="p-table-cell-padding text-right font-bold text-secondary">${formatMoney(lead.amount || 0)}</td>
        <td class="p-table-cell-padding text-on-surface-variant">${fechaLabel(lead.closed_at)}</td>
        <td class="p-table-cell-padding text-right">
          <button data-action="edit-sale" data-id="${lead.id}" class="text-on-surface-variant hover:text-on-surface p-1" title="Editar venta">
            <span class="material-symbols-outlined text-[18px]">edit</span>
          </button>
        </td>
      </tr>`;
  }

  function renderTable() {
    const filtered = visibleVentas();
    const shown = filtered.slice(0, visibleCount);
    tbody.innerHTML = shown.length
      ? shown.map(rowHtml).join('')
      : `<tr><td colspan="8" class="p-table-cell-padding py-10 text-center text-body-sm text-on-surface-variant">${searchQuery ? 'Sin ventas que coincidan con la búsqueda.' : 'Sin ventas cerradas en este rango.'}</td></tr>`;
    bindCopyButtons(tbody, ctx);
    countBadge.textContent = `${filtered.length} venta${filtered.length === 1 ? '' : 's'}`;
    const remaining = filtered.length - shown.length;
    loadmoreWrap.classList.toggle('hidden', remaining <= 0);
    if (remaining > 0) loadmoreInfo.textContent = `Mostrando ${shown.length} de ${filtered.length} · quedan ${remaining} más`;
  }

  function renderKpis() {
    const filtered = visibleVentas();
    const total = filtered.reduce((s, l) => s + (l.amount || 0), 0);
    const promedio = filtered.length ? total / filtered.length : 0;
    kpisEl.innerHTML = [
      kpiTile('Total vendido', formatMoney(total), `${filtered.length} venta${filtered.length === 1 ? '' : 's'} en el rango`, 'payments', 'text-secondary'),
      kpiTile('Ticket promedio', formatMoney(promedio), 'Monto promedio por venta', 'receipt_long'),
    ].join('');
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

  // Se calcula a partir de `ventas` (ya filtrado por asesor/ads/rango vía
  // loadTable) en vez de pedirle al backend el comparativo completo por
  // asesor (/api/kpis/funnel): así el gráfico siempre coincide exactamente
  // con lo que muestra la tabla de abajo, sin duplicar filtros en el server.
  function renderAdvisorChart() {
    const totals = new Map();
    for (const lead of visibleVentas()) {
      const name = lead.advisor_name || 'Sin asignar';
      totals.set(name, (totals.get(name) || 0) + (lead.amount || 0));
    }
    const rows = [...totals.entries()].filter(([, monto]) => monto > 0).sort((a, b) => b[1] - a[1]);
    barChart(advisorCanvas, {
      labels: rows.map(([name]) => name),
      data: rows.map(([, monto]) => monto),
      color: CATEGORICAL_COLORS[2],
      valueFormatter: (v) => formatMoney(v),
    });
  }

  async function loadTable() {
    visibleCount = PAGE_SIZE;
    const params = new URLSearchParams();
    params.set('status', 'cerrado_ganado');
    // Mientras se busca, Asesor/rango de fechas/"Solo pagadas" se ignoran a
    // proposito: sin esto, buscar un cliente que cerro fuera del rango (o
    // con otro asesor, o sin PED) lo hacia "desaparecer" sin ninguna pista
    // de por que, y ni cambiando el texto de busqueda volvia a aparecer --
    // quedaba atrapado por un filtro que el usuario ya habia olvidado que
    // tenia puesto. searchHint (abajo) avisa que estan pausados mientras se
    // busca.
    if (!searchQuery) {
      // closed_from/closed_to (no from/to): una venta puede cerrarse mucho
      // despues de creado el lead, y lo que importa aqui es cuando se cerro.
      if (fromInput.value) params.set('closed_from', fromInput.value);
      if (toInput.value) params.set('closed_to', toInput.value);
      extraFilterParams(params);
    }
    try {
      ventas = await ctx.api.get(`/api/leads?${params.toString()}`);
    } catch {
      ctx.toast('No se pudo cargar el listado de ventas', 'error');
      return;
    }
    ventas.sort((a, b) => (a.closed_at < b.closed_at ? 1 : -1));
    renderTable();
    renderKpis();
  }

  async function loadAll() {
    await Promise.all([loadTrend(), loadTable()]);
    renderAdvisorChart();
  }

  loadmoreBtn.addEventListener('click', () => {
    visibleCount += PAGE_SIZE;
    renderTable();
  });

  asesorInput.addEventListener('change', loadAll);
  fromInput.addEventListener('change', loadAll);
  toInput.addEventListener('change', loadAll);
  paidOnlyInput.addEventListener('change', loadAll);
  container.querySelector('#vc-filter-clear').addEventListener('click', () => {
    asesorInput.value = '';
    fromInput.value = '';
    toInput.value = '';
    paidOnlyInput.checked = false;
    loadAll();
  });

  tbody.addEventListener('click', (e) => {
    const clientBtn = e.target.closest('button[data-action="open-client"]');
    if (clientBtn) {
      // Se manda a la ficha del cliente (Clientes) en vez de abrir un modal
      // aqui: ahi es donde ya existe la edicion de datos/montos y el
      // historial de abonos, no hace falta duplicarlo en esta vista.
      ctx.navigate('clientes', { open: clientBtn.dataset.clientId });
      return;
    }
    const editBtn = e.target.closest('button[data-action="edit-sale"]');
    if (editBtn) {
      const lead = ventas.find((l) => l.id === Number(editBtn.dataset.id));
      if (lead) openEditLeadModal(lead, ctx, loadAll);
    }
  });

  container.querySelector('#btn-quick-sale').addEventListener('click', () => {
    openQuickSaleModal(ctx, () => loadAll());
  });

  // Lo que ves es lo que exportas. Mientras se busca, Asesor/rango/"Solo
  // pagadas" estan deshabilitados y no reflejan lo que muestra la tabla (ver
  // applySearch abajo) -- por eso en ese caso se manda la lista exacta de
  // IDs ya filtrados en pantalla en vez de esos filtros, para no exportar un
  // recorte distinto al que se esta viendo. Se abre en pestaña nueva porque
  // es una descarga de archivo, no una navegacion dentro de la app.
  container.querySelector('#vc-export-btn').addEventListener('click', () => {
    const params = new URLSearchParams();
    if (searchQuery) {
      params.set('ids', visibleVentas().map((l) => l.id).join(','));
    } else {
      if (fromInput.value) params.set('closed_from', fromInput.value);
      if (toInput.value) params.set('closed_to', toInput.value);
      extraFilterParams(params);
    }
    window.open(`/api/leads/xlsx-cerradas?${params.toString()}`, '_blank');
  });

  const offLeads = ctx.ws.on('leads_changed', loadAll);
  const offAdvisors = ctx.ws.on('advisors_changed', loadAdvisorOptions);

  // Buscador propio de esta pantalla (antes era la barra global del topbar):
  // al entrar o salir de una busqueda cambia el alcance de lo que trae
  // loadTable (ver nota en visibleVentas), asi que hace falta volver a
  // pedirlo -- no alcanza con re-filtrar en el cliente lo que ya estaba
  // cargado.
  async function applySearch(q) {
    searchQuery = q;
    searchHint.classList.toggle('hidden', !q);
    // Deshabilitados (no solo el hint de texto) para que quede obvio que
    // estos no estan aplicando -- si no, cambiar el asesor mientras se busca
    // moveria el grafico de tendencia (que si respeta el rango/asesor) sin
    // mover la tabla, que es mas confuso que simplemente no dejarlos tocar.
    [asesorInput, fromInput, toInput, paidOnlyInput].forEach((el) => {
      el.disabled = !!q;
      // El checkbox se ve/deshabilita a traves de su <label> (el padding
      // clicable es del label, no del input) -- los demas son el elemento
      // mismo.
      const isCheckbox = el === paidOnlyInput;
      const target = isCheckbox ? el.closest('label') : el;
      target.classList.toggle('opacity-50', !!q);
      target.classList.toggle('cursor-not-allowed', !!q);
      if (isCheckbox) target.classList.toggle('cursor-pointer', !q);
    });
    await loadTable();
    renderAdvisorChart();
  }

  let searchDebounce;
  searchInput.addEventListener('input', () => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => applySearch(searchInput.value.trim()), 300);
  });

  await Promise.all([loadAdvisorOptions(), loadAll()]);

  return () => {
    offLeads();
    offAdvisors();
    destroyChart(trendCanvas);
    destroyChart(advisorCanvas);
  };
}
