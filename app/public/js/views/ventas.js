import { escapeHtml, slaBadge, statusBadge, STATUS_OPTIONS } from '../utils.js';
import { openAssignModal, openReassignModal, openCloseModal, markContacted, markQuoted } from '../components/leadActions.js';
import { COLOMBIA_CITY_NAMES } from '../colombia-cities.js';
import { renderLeadKanban } from '../components/leadKanban.js';

const PRODUCTS = ['Carpas', 'Cortinas', 'Gramas', 'Baby Gym', 'Forros', 'Pisos Vinílicos', 'Otro'];
const SOURCES = ['WhatsApp', 'Correo', 'Llamada', 'Otro'];
const DEFAULT_SOURCE = 'WhatsApp';
const CHANNEL_DETAILS = ['Google Ads', 'Orgánico', 'Referido', 'Otro'];
const DEFAULT_CHANNEL_DETAIL = 'Google Ads';

function todayPrefix() {
  return new Date().toISOString().slice(0, 10);
}

function timeLabel(createdAt) {
  const d = new Date(createdAt.replace(' ', 'T') + 'Z');
  return d.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
}

export async function mount(container, ctx) {
  // Solo coordinador/admin dan de alta y asignan leads nuevos; el backend ya
  // lo exige (POST /api/leads), aquí solo se evita mostrar un formulario que
  // fallaría al enviarse.
  const canCreate = ctx.user?.role !== 'asesor';

  container.innerHTML = `
    <div class="grid grid-cols-1 xl:grid-cols-12 gap-gutter items-start">
      ${canCreate ? `
      <div class="xl:col-span-4 bg-surface rounded-xl border border-outline-variant shadow-sm p-6">
        <div class="flex items-center justify-between mb-6">
          <h3 class="text-headline-md font-headline-md text-on-surface">Alta Rápida</h3>
          <span class="material-symbols-outlined text-primary">person_add</span>
        </div>
        <form id="alta-form" class="space-y-5">
          <div class="relative">
            <label class="block text-label-bold font-label-bold text-on-surface-variant mb-1 uppercase tracking-wider">Nombre del Cliente *</label>
            <input id="f-nombre" required type="text" autocomplete="off" placeholder="Ej. Juan Pérez — escribe para buscar clientes existentes" class="w-full p-2.5 bg-surface-container-lowest border border-outline-variant rounded-md text-body-md focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition-all" />
            <div id="f-nombre-suggestions" class="hidden absolute z-20 mt-1 w-full bg-surface border border-outline-variant rounded-md shadow-lg max-h-56 overflow-y-auto"></div>
            <p id="f-cliente-hint" class="hidden text-[11px] text-secondary mt-1 flex items-center gap-1"><span class="material-symbols-outlined text-[13px]">check_circle</span>Cliente existente vinculado — se sumará a su ficha en Clientes.</p>
          </div>
          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="block text-label-bold font-label-bold text-on-surface-variant mb-1 uppercase tracking-wider">Teléfono *</label>
              <input id="f-telefono" required type="tel" placeholder="300 000 0000" class="w-full p-2.5 bg-surface-container-lowest border border-outline-variant rounded-md text-body-md focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition-all" />
            </div>
            <div>
              <label class="block text-label-bold font-label-bold text-on-surface-variant mb-1 uppercase tracking-wider">Documento</label>
              <input id="f-documento" type="text" placeholder="Opcional" class="w-full p-2.5 bg-surface-container-lowest border border-outline-variant rounded-md text-body-md focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition-all" />
            </div>
          </div>
          <div>
            <label class="block text-label-bold font-label-bold text-on-surface-variant mb-1 uppercase tracking-wider">Asignar a Asesor *</label>
            <select id="f-asesor" required class="w-full p-2.5 bg-surface-container-lowest border border-outline-variant rounded-md text-body-md focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition-all appearance-none cursor-pointer">
              <option value="">Cargando asesores…</option>
            </select>
          </div>
          <div>
            <label class="block text-label-bold font-label-bold text-on-surface-variant mb-1 uppercase tracking-wider">Producto de Interés</label>
            <select id="f-producto" class="w-full p-2.5 bg-surface-container-lowest border border-outline-variant rounded-md text-body-md focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition-all appearance-none cursor-pointer">
              ${PRODUCTS.map((p) => `<option value="${p}">${p}</option>`).join('')}
            </select>
            <input id="f-producto-otro" type="text" placeholder="Especifica el producto..." class="hidden mt-2 w-full p-2.5 bg-surface-container-lowest border border-outline-variant rounded-md text-body-md focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition-all" />
          </div>
          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="block text-label-bold font-label-bold text-on-surface-variant mb-1 uppercase tracking-wider">Canal de Entrada</label>
              <select id="f-source" class="w-full p-2.5 bg-surface-container-lowest border border-outline-variant rounded-md text-body-md focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition-all appearance-none cursor-pointer">
                ${SOURCES.map((s) => `<option value="${s}" ${s === DEFAULT_SOURCE ? 'selected' : ''}>${s}</option>`).join('')}
              </select>
            </div>
            <div>
              <label class="block text-label-bold font-label-bold text-on-surface-variant mb-1 uppercase tracking-wider">Origen del Lead</label>
              <select id="f-origen" class="w-full p-2.5 bg-surface-container-lowest border border-outline-variant rounded-md text-body-md focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition-all appearance-none cursor-pointer">
                ${CHANNEL_DETAILS.map((s) => `<option value="${s}" ${s === DEFAULT_CHANNEL_DETAIL ? 'selected' : ''}>${s}</option>`).join('')}
              </select>
            </div>
          </div>
          <div>
            <label class="block text-label-bold font-label-bold text-on-surface-variant mb-1 uppercase tracking-wider">Ciudad</label>
            <select id="f-ciudad" class="w-full p-2.5 bg-surface-container-lowest border border-outline-variant rounded-md text-body-md focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition-all appearance-none cursor-pointer">
              <option value="">Sin especificar</option>
              ${COLOMBIA_CITY_NAMES.map((c) => `<option value="${c}">${c}</option>`).join('')}
            </select>
          </div>
          <div>
            <label class="block text-label-bold font-label-bold text-on-surface-variant mb-1 uppercase tracking-wider">Notas Rápidas</label>
            <textarea id="f-notas" rows="3" placeholder="Detalles de la consulta inicial..." class="w-full p-2.5 bg-surface-container-lowest border border-outline-variant rounded-md text-body-md focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition-all resize-none"></textarea>
          </div>
          <div>
            <button type="button" id="toggle-fecha" class="text-body-sm font-label-bold text-primary hover:text-on-primary-fixed-variant transition-colors inline-flex items-center gap-1">
              <span class="material-symbols-outlined text-[16px]">event</span> ¿Es de un día anterior? Cambia la fecha
            </button>
            <div id="fecha-wrap" class="hidden mt-2">
              <label class="block text-label-bold font-label-bold text-on-surface-variant mb-1 uppercase tracking-wider">Fecha y hora real de registro</label>
              <input id="f-fecha" type="datetime-local" class="w-full p-2.5 bg-surface-container-lowest border border-outline-variant rounded-md text-body-md focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition-all" />
              <p class="text-[11px] text-on-surface-variant mt-1">Úsalo para meter clientes atrasados con su fecha real — así los reportes cuadran.</p>
            </div>
          </div>
          <button type="submit" class="w-full py-3 bg-primary text-on-primary rounded-md font-label-bold text-label-bold hover:bg-on-primary-fixed-variant transition-colors flex items-center justify-center shadow-sm">
            <span class="material-symbols-outlined mr-2 text-[18px]">how_to_reg</span>
            REGISTRAR CLIENTE Y ASIGNAR
          </button>
        </form>
      </div>` : ''}

      <div class="${canCreate ? 'xl:col-span-8' : 'xl:col-span-12'} bg-surface rounded-xl border border-outline-variant shadow-sm flex flex-col overflow-hidden">
        <div class="p-6 border-b border-outline-variant flex items-center justify-between bg-surface">
          <div class="flex items-center space-x-3">
            <h3 class="text-headline-md font-headline-md text-on-surface">Leads Registrados</h3>
            <span id="count-badge" class="bg-secondary-container text-on-secondary-container px-2.5 py-0.5 rounded-full text-label-bold font-label-bold flex items-center">0 registros</span>
          </div>
          <div class="flex items-center gap-2">
            <div class="flex border border-outline-variant rounded-md overflow-hidden">
              <button id="view-table-btn" data-view="table" class="view-toggle-btn p-2 bg-surface-container-lowest transition-colors" title="Vista de tabla">
                <span class="material-symbols-outlined text-[20px]">table_rows</span>
              </button>
              <button id="view-board-btn" data-view="board" class="view-toggle-btn p-2 bg-surface-container-lowest border-l border-outline-variant transition-colors" title="Vista de tablero">
                <span class="material-symbols-outlined text-[20px]">view_kanban</span>
              </button>
            </div>
            <button id="refresh-btn" class="p-2 border border-outline-variant rounded-md hover:bg-surface-container-low transition-colors text-on-surface-variant" title="Actualizar">
              <span class="material-symbols-outlined text-[20px]">refresh</span>
            </button>
          </div>
        </div>
        <div class="p-4 border-b border-outline-variant bg-surface-container-low flex flex-wrap gap-3 items-end">
          <div>
            <label class="block text-[10px] font-label-bold text-on-surface-variant mb-1 uppercase tracking-wider">Asesor</label>
            <select id="filter-asesor" class="p-2 bg-surface-container-lowest border border-outline-variant rounded-md text-body-sm outline-none focus:border-primary">
              <option value="">Todos</option>
            </select>
          </div>
          <div>
            <label class="block text-[10px] font-label-bold text-on-surface-variant mb-1 uppercase tracking-wider">Producto</label>
            <select id="filter-producto" class="p-2 bg-surface-container-lowest border border-outline-variant rounded-md text-body-sm outline-none focus:border-primary">
              <option value="">Todos</option>
              ${PRODUCTS.filter((p) => p !== 'Otro').map((p) => `<option value="${p}">${p}</option>`).join('')}
            </select>
          </div>
          <div>
            <label class="block text-[10px] font-label-bold text-on-surface-variant mb-1 uppercase tracking-wider">Estado</label>
            <select id="filter-estado" class="p-2 bg-surface-container-lowest border border-outline-variant rounded-md text-body-sm outline-none focus:border-primary">
              <option value="">Todos</option>
              ${STATUS_OPTIONS.map((s) => `<option value="${s.value}">${s.label}</option>`).join('')}
            </select>
          </div>
          <div>
            <label class="block text-[10px] font-label-bold text-on-surface-variant mb-1 uppercase tracking-wider">Canal</label>
            <select id="filter-source" class="p-2 bg-surface-container-lowest border border-outline-variant rounded-md text-body-sm outline-none focus:border-primary">
              <option value="">Todos</option>
              ${SOURCES.map((s) => `<option value="${s}">${s}</option>`).join('')}
            </select>
          </div>
          <div>
            <label class="block text-[10px] font-label-bold text-on-surface-variant mb-1 uppercase tracking-wider">Origen</label>
            <select id="filter-origen" class="p-2 bg-surface-container-lowest border border-outline-variant rounded-md text-body-sm outline-none focus:border-primary">
              <option value="">Todos</option>
              ${CHANNEL_DETAILS.map((s) => `<option value="${s}">${s}</option>`).join('')}
            </select>
          </div>
          <div>
            <label class="block text-[10px] font-label-bold text-on-surface-variant mb-1 uppercase tracking-wider">Desde</label>
            <input id="filter-from" type="date" class="p-2 bg-surface-container-lowest border border-outline-variant rounded-md text-body-sm outline-none focus:border-primary" />
          </div>
          <div>
            <label class="block text-[10px] font-label-bold text-on-surface-variant mb-1 uppercase tracking-wider">Hasta</label>
            <input id="filter-to" type="date" class="p-2 bg-surface-container-lowest border border-outline-variant rounded-md text-body-sm outline-none focus:border-primary" />
          </div>
          <button id="filter-clear" class="px-3 py-2 rounded-md border border-outline-variant text-body-sm font-label-bold text-on-surface-variant hover:bg-surface-container-lowest transition-colors">Limpiar filtros</button>
        </div>
        <div id="ventas-table-wrap" class="overflow-x-auto flex-1">
          <table class="w-full text-left border-collapse min-w-[820px]">
            <thead>
              <tr class="bg-surface-container-low border-b border-outline-variant">
                <th class="p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase tracking-wider">Hora</th>
                <th class="p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase tracking-wider">Cliente</th>
                <th class="p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase tracking-wider">Asesor Actual</th>
                <th class="p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase tracking-wider">Predicción</th>
                <th class="p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase tracking-wider">Estado</th>
                <th class="p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase tracking-wider text-right">Acción Operativa</th>
              </tr>
            </thead>
            <tbody id="ventas-tbody" class="divide-y divide-outline-variant"></tbody>
          </table>
        </div>
        <div id="ventas-board-wrap" class="hidden flex-1 overflow-y-auto p-4"></div>
      </div>
    </div>
  `;

  const form = container.querySelector('#alta-form');
  const tbody = container.querySelector('#ventas-tbody');
  const countBadge = container.querySelector('#count-badge');
  const asesorSelect = container.querySelector('#f-asesor');
  const productoSelect = container.querySelector('#f-producto');
  const productoOtro = container.querySelector('#f-producto-otro');
  const submitBtn = form ? form.querySelector('button[type="submit"]') : null;
  const nombreInput = container.querySelector('#f-nombre');
  const nombreSuggestions = container.querySelector('#f-nombre-suggestions');
  const clienteHint = container.querySelector('#f-cliente-hint');
  let selectedClientId = null;
  let clienteSearchDebounce;

  if (nombreInput) {
    nombreInput.addEventListener('input', () => {
      selectedClientId = null;
      clienteHint.classList.add('hidden');
      clearTimeout(clienteSearchDebounce);
      const term = nombreInput.value.trim();
      if (term.length < 2) {
        nombreSuggestions.classList.add('hidden');
        return;
      }
      clienteSearchDebounce = setTimeout(async () => {
        let matches = [];
        try {
          matches = await ctx.api.get(`/api/clients?q=${encodeURIComponent(term)}`);
        } catch {
          return;
        }
        if (!matches.length) {
          nombreSuggestions.classList.add('hidden');
          return;
        }
        nombreSuggestions.innerHTML = matches
          .slice(0, 6)
          .map(
            (c) => `
          <button type="button" data-client-id="${c.id}" data-client-name="${escapeHtml(c.name)}" data-client-phone="${escapeHtml(c.phone || '')}" class="w-full text-left px-3 py-2 hover:bg-surface-container-low transition-colors flex items-center justify-between gap-2">
            <span class="text-body-sm font-semibold text-on-surface truncate">${escapeHtml(c.name)}</span>
            <span class="text-[11px] text-on-surface-variant shrink-0">${escapeHtml(c.phone || 'sin teléfono')} · ${c.lead_count} pedido${c.lead_count === 1 ? '' : 's'}</span>
          </button>`
          )
          .join('');
        nombreSuggestions.classList.remove('hidden');
      }, 250);
    });
    nombreSuggestions.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-client-id]');
      if (!btn) return;
      selectedClientId = Number(btn.dataset.clientId);
      nombreInput.value = btn.dataset.clientName;
      if (btn.dataset.clientPhone && btn.dataset.clientPhone !== 'Sin dato') {
        container.querySelector('#f-telefono').value = btn.dataset.clientPhone;
      }
      nombreSuggestions.classList.add('hidden');
      clienteHint.classList.remove('hidden');
    });
    document.addEventListener('click', (e) => {
      if (!nombreInput.contains(e.target) && !nombreSuggestions.contains(e.target)) {
        nombreSuggestions.classList.add('hidden');
      }
    });
  }

  const tableWrap = container.querySelector('#ventas-table-wrap');
  const boardWrap = container.querySelector('#ventas-board-wrap');
  const viewTableBtn = container.querySelector('#view-table-btn');
  const viewBoardBtn = container.querySelector('#view-board-btn');
  let viewMode = 'table';

  function applyViewMode() {
    tableWrap.classList.toggle('hidden', viewMode !== 'table');
    boardWrap.classList.toggle('hidden', viewMode !== 'board');
    [
      [viewTableBtn, viewMode === 'table'],
      [viewBoardBtn, viewMode === 'board'],
    ].forEach(([btn, active]) => {
      btn.classList.toggle('bg-primary', active);
      btn.classList.toggle('text-on-primary', active);
      btn.classList.toggle('bg-surface-container-lowest', !active);
      btn.classList.toggle('text-on-surface-variant', !active);
      // El hover solo se ofrece al boton inactivo -- en el activo taparia el
      // color de "seleccionado" con el gris de hover.
      btn.classList.toggle('hover:bg-surface-container-low', !active);
    });
  }
  viewTableBtn.addEventListener('click', () => {
    viewMode = 'table';
    applyViewMode();
  });
  viewBoardBtn.addEventListener('click', () => {
    viewMode = 'board';
    applyViewMode();
    renderLeadKanban(boardWrap, allLeads, ctx, load);
  });
  applyViewMode();

  const filterAsesor = container.querySelector('#filter-asesor');
  const filterProducto = container.querySelector('#filter-producto');
  const filterEstado = container.querySelector('#filter-estado');
  const filterSource = container.querySelector('#filter-source');
  const filterOrigen = container.querySelector('#filter-origen');
  const filterFrom = container.querySelector('#filter-from');
  const filterTo = container.querySelector('#filter-to');

  filterFrom.value = '';
  filterTo.value = '';

  if (canCreate) {
    productoSelect.addEventListener('change', () => {
      productoOtro.classList.toggle('hidden', productoSelect.value !== 'Otro');
    });
    const toggleFechaBtn = container.querySelector('#toggle-fecha');
    const fechaWrap = container.querySelector('#fecha-wrap');
    toggleFechaBtn.addEventListener('click', () => {
      fechaWrap.classList.toggle('hidden');
    });
  }

  async function loadAdvisorOptions() {
    if (canCreate) {
      let advisors = [];
      try {
        advisors = (await ctx.api.get('/api/advisors')).filter((a) => !a.is_group && a.active);
      } catch {
        ctx.toast('No se pudo cargar la lista de asesores', 'error');
      }
      const previousValue = asesorSelect.value;
      if (advisors.length === 0) {
        asesorSelect.innerHTML = '<option value="">Sin asesores activos disponibles</option>';
        submitBtn.disabled = true;
        submitBtn.classList.add('opacity-50', 'cursor-not-allowed');
      } else {
        asesorSelect.innerHTML =
          '<option value="">Selecciona un asesor…</option>' +
          advisors.map((a) => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join('');
        if (advisors.some((a) => String(a.id) === previousValue)) asesorSelect.value = previousValue;
        submitBtn.disabled = false;
        submitBtn.classList.remove('opacity-50', 'cursor-not-allowed');
      }
    }

    // Filtro de asesor: incluye tambien a los pausados, para poder ver
    // historico de leads de alguien que ya no esta activo.
    let allAdvisors = [];
    try {
      allAdvisors = await ctx.api.get('/api/advisors');
    } catch {
      /* se mantiene el filtro vacio si falla */
    }
    const prevFilter = filterAsesor.value;
    filterAsesor.innerHTML =
      '<option value="">Todos</option>' +
      allAdvisors.filter((a) => !a.is_group).map((a) => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join('');
    if (allAdvisors.some((a) => String(a.id) === prevFilter)) filterAsesor.value = prevFilter;
  }

  function rowHtml(lead) {
    const closed = lead.status.startsWith('cerrado');
    let statusCell;
    if (closed) {
      const b = statusBadge(lead.status);
      statusCell = `<span class="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold ${b.badgeClass}">${b.label}</span>`;
    } else if (lead.sla_status === 'vencido' || lead.sla_status === 'riesgo') {
      const b = slaBadge(lead.sla_status);
      statusCell = `<span class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-bold ${b.badgeClass}"><span class="w-1.5 h-1.5 rounded-full bg-tertiary"></span>${b.label} · ${escapeHtml(lead.remaining_label || '')}</span>`;
    } else {
      const b = statusBadge(lead.status);
      statusCell = `<span class="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold ${b.badgeClass}">${b.label}</span>`;
    }

    let actionCell;
    if (closed) {
      actionCell = '<span class="text-body-sm text-outline-variant font-label-bold">Sin acciones</span>';
    } else {
      const buttons = [];
      if (lead.status === 'asignado') {
        buttons.push(`<button data-action="contact" data-id="${lead.id}" class="px-3 py-1 bg-tertiary-fixed text-on-tertiary-fixed-variant rounded text-body-sm font-label-bold hover:opacity-90 transition-colors">Marcar contactado</button>`);
      }
      if (lead.status === 'asignado' || lead.status === 'contactado') {
        buttons.push(`<button data-action="quote" data-id="${lead.id}" class="px-3 py-1 bg-primary-fixed text-on-primary-fixed-variant rounded text-body-sm font-label-bold hover:opacity-90 transition-colors">Marcar cotizado</button>`);
      }
      buttons.push(`<button data-action="close" data-id="${lead.id}" class="px-3 py-1 bg-secondary text-on-secondary rounded text-body-sm font-label-bold hover:opacity-90 transition-colors">Cerrar</button>`);
      if (canCreate) {
        buttons.push(`<button data-action="reassign" data-id="${lead.id}" class="inline-flex items-center text-body-sm font-label-bold text-primary hover:text-on-primary-fixed-variant transition-colors"><span class="material-symbols-outlined text-[16px] mr-1">swap_horiz</span>Reasignar</button>`);
      }
      actionCell = `<div class="flex justify-end flex-wrap gap-2">${buttons.join('')}</div>`;
    }

    return `
      <tr class="hover:bg-surface-container-low/50 transition-colors">
        <td class="p-table-cell-padding text-body-md text-on-surface whitespace-nowrap">${timeLabel(lead.created_at)}</td>
        <td class="p-table-cell-padding">
          <div class="text-body-md font-semibold text-on-surface flex items-center gap-1.5">
            ${escapeHtml(lead.client_name)}
            ${lead.is_historical ? '<span class="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-surface-variant text-on-surface-variant border border-outline-variant" title="Importado de un sistema anterior, sin alertas de seguimiento">Histórico</span>' : ''}
          </div>
          <div class="text-body-sm text-on-surface-variant">${escapeHtml(lead.product || '—')} · ${escapeHtml(lead.source || '—')}${lead.channel_detail ? ` · ${escapeHtml(lead.channel_detail)}` : ''}${lead.city ? ` · ${escapeHtml(lead.city)}` : ''}</div>
        </td>
        <td class="p-table-cell-padding text-body-md text-on-surface">${escapeHtml(lead.advisor_name || 'Sin Asignar')}</td>
        <td class="p-table-cell-padding text-right">
          <span class="inline-flex items-center gap-2 px-2 py-1 rounded-full bg-surface-container-low text-body-sm font-bold ${lead.predicted_score >= 70 ? 'text-secondary' : lead.predicted_score >= 45 ? 'text-primary' : 'text-error'}">
            ${lead.predicted_score}%
          </span>
        </td>
        <td class="p-table-cell-padding">${statusCell}</td>
        <td class="p-table-cell-padding text-right">${actionCell}</td>
      </tr>
    `;
  }

  let allLeads = [];
  let searchQuery = '';

  function buildQuery() {
    const params = new URLSearchParams();
    if (filterAsesor.value) params.set('advisor_id', filterAsesor.value);
    if (filterProducto.value) params.set('product', filterProducto.value);
    if (filterEstado.value) params.set('status', filterEstado.value);
    if (filterSource.value) params.set('source', filterSource.value);
    if (filterOrigen.value) params.set('channel_detail', filterOrigen.value);
    if (searchQuery) {
      // Buscar es "encontrar este cliente donde sea": ignora el rango de
      // fechas (que por defecto es solo el dia de hoy) para no dar falsos
      // "no encontrado" en clientes de dias anteriores.
      params.set('q', searchQuery);
    } else {
      if (filterFrom.value) params.set('from', filterFrom.value);
      if (filterTo.value) params.set('to', filterTo.value);
    }
    const qs = params.toString();
    return qs ? `?${qs}` : '';
  }

  async function load() {
    try {
      allLeads = await ctx.api.get(`/api/leads${buildQuery()}`);
    } catch (err) {
      ctx.toast('No se pudieron cargar los leads', 'error');
      return;
    }
    countBadge.textContent = `${allLeads.length} registro${allLeads.length === 1 ? '' : 's'}`;
    tbody.innerHTML = allLeads.length
      ? allLeads.map(rowHtml).join('')
      : `<tr><td colspan="6" class="p-table-cell-padding py-10 text-center text-body-sm text-on-surface-variant">No hay leads que coincidan con los filtros.</td></tr>`;
    if (viewMode === 'board') renderLeadKanban(boardWrap, allLeads, ctx, load);
  }

  tbody.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const lead = allLeads.find((l) => l.id === Number(btn.dataset.id));
    if (!lead) return;
    if (btn.dataset.action === 'assign') openAssignModal(lead, ctx, load);
    if (btn.dataset.action === 'reassign') openReassignModal(lead, ctx, load);
    if (btn.dataset.action === 'close') openCloseModal(lead, ctx, load);
    if (btn.dataset.action === 'contact') markContacted(lead, ctx, load);
    if (btn.dataset.action === 'quote') markQuoted(lead, ctx, load);
  });

  container.querySelector('#refresh-btn').addEventListener('click', load);
  [filterAsesor, filterProducto, filterEstado, filterSource, filterOrigen, filterFrom, filterTo].forEach((el) => {
    el.addEventListener('change', load);
  });
  container.querySelector('#filter-clear').addEventListener('click', () => {
    filterAsesor.value = '';
    filterProducto.value = '';
    filterEstado.value = '';
    filterSource.value = '';
    filterOrigen.value = '';
    filterFrom.value = '';
    filterTo.value = '';
    load();
  });

  if (form) form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const client_name = container.querySelector('#f-nombre').value.trim();
    const phone = container.querySelector('#f-telefono').value.trim();
    const document_ = container.querySelector('#f-documento').value.trim();
    const advisor_id = asesorSelect.value;
    const product = productoSelect.value === 'Otro' ? productoOtro.value.trim() || 'Otro' : productoSelect.value;
    const source = container.querySelector('#f-source').value;
    const channel_detail = container.querySelector('#f-origen').value;
    const city = container.querySelector('#f-ciudad').value;
    const notes = container.querySelector('#f-notas').value.trim();
    const fechaWrap = container.querySelector('#fecha-wrap');
    const created_at = !fechaWrap.classList.contains('hidden') ? container.querySelector('#f-fecha').value : '';
    if (!client_name || !phone) {
      ctx.toast('Nombre y teléfono son obligatorios', 'error');
      return;
    }
    if (!advisor_id) {
      ctx.toast('Selecciona a qué asesor asignar el cliente', 'error');
      return;
    }
    try {
      // Si no se eligio un cliente existente de las sugerencias, se crea uno
      // nuevo con estos mismos datos -- asi todo lead que se registre de
      // ahora en adelante queda vinculado a una ficha en Clientes, sin
      // pedirle un paso extra a quien esta registrando.
      let client_id = selectedClientId;
      if (!client_id) {
        const client = await ctx.api.post('/api/clients', { name: client_name, phone, document: document_ });
        client_id = client.id;
      }
      const lead = await ctx.api.post('/api/leads', { client_name, phone, document: document_, advisor_id, product, source, channel_detail, city, notes, created_at, client_id });
      ctx.toast(`Registrado y asignado a ${lead.advisor_name}`, 'success');
      form.reset();
      productoSelect.value = PRODUCTS[0];
      productoOtro.value = '';
      productoOtro.classList.add('hidden');
      container.querySelector('#f-source').value = DEFAULT_SOURCE;
      container.querySelector('#f-origen').value = DEFAULT_CHANNEL_DETAIL;
      container.querySelector('#f-ciudad').value = '';
      fechaWrap.classList.add('hidden');
      selectedClientId = null;
      clienteHint.classList.add('hidden');
      load();
    } catch (err) {
      ctx.toast(err.message, 'error');
    }
  });

  const offLeads = ctx.ws.on('leads_changed', load);
  const offAdvisors = ctx.ws.on('advisors_changed', loadAdvisorOptions);
  const offSearch = ctx.search.subscribe((q) => {
    searchQuery = q;
    load();
  });
  await Promise.all([load(), loadAdvisorOptions()]);

  return () => {
    offLeads();
    offAdvisors();
    offSearch();
  };
}
