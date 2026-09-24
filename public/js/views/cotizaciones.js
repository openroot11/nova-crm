import { escapeHtml, formatMoney, copyNameBtn, bindCopyButtons } from '../utils.js';
import { SERVICES } from '../data/velaraServices.js';

// Todas las cotizaciones NATIVAS (motor propio de Velara CRM, tablas
// quotations/quotation_lines -- ver server/nativeQuotes.js), con
// buscador y filtros. Las cotizaciones/pedidos armados en Odoo (si esa
// integración llegara a usarse) siguen aparte, en GET /api/leads/quotations
// -- esta pantalla es la que de verdad se usa hoy, sin Odoo de por medio.

const STATE_OPTIONS = [
  ['', 'Todos los estados'],
  ['draft', 'Borrador'],
  ['sent', 'Enviada'],
  ['seguimiento', 'En seguimiento'],
  ['aprobada', 'Aprobada'],
  ['sale', 'Venta'],
  ['cancel', 'Cancelada'],
];
const STATE_LABEL = Object.fromEntries(STATE_OPTIONS.filter(([k]) => k));
const STATE_BADGE = {
  draft: 'bg-surface-container-high text-on-surface-variant',
  sent: 'bg-tertiary-container text-on-tertiary-container',
  seguimiento: 'bg-tertiary-container text-on-tertiary-container',
  aprobada: 'bg-secondary-container text-on-secondary-container',
  sale: 'bg-primary-container text-on-primary-container',
  cancel: 'bg-error-container text-on-error-container',
};

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

function fmtDate(sqliteDate) {
  if (!sqliteDate) return '—';
  const iso = String(sqliteDate).slice(0, 10);
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return sqliteDate;
  return d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });
}

export async function mount(container, ctx) {
  const canFilterByAdvisor = ctx.user?.role !== 'asesor';

  container.innerHTML = `
    <div class="mb-gutter flex justify-between items-end flex-wrap gap-gutter">
      <div>
        <h2 class="text-headline-lg font-headline-lg text-on-surface mb-base">Cotizaciones</h2>
        <p class="text-body-md font-body-md text-on-surface-variant">Todas las cotizaciones armadas en Velara CRM y su estado, de borrador a venta.</p>
      </div>
      <button id="cot-refresh" class="p-2 border border-outline-variant rounded-md hover:bg-surface-container-low transition-colors text-on-surface-variant" title="Actualizar">
        <span class="material-symbols-outlined text-[20px]">refresh</span>
      </button>
    </div>

    <div class="bg-surface-container-lowest border border-outline-variant rounded-xl p-4 mb-gutter flex items-end gap-3 flex-wrap">
      <div class="relative">
        <label class="block text-[10px] font-label-bold text-on-surface-variant mb-1 uppercase tracking-wider">Buscar</label>
        <span class="material-symbols-outlined absolute left-2.5 bottom-2.5 text-on-surface-variant text-[18px]">search</span>
        <input id="cot-q" type="text" placeholder="Cliente, teléfono, documento, número..." class="pl-8 pr-3 py-2 bg-surface border border-outline-variant rounded-md text-body-sm outline-none focus:border-outline w-64" />
      </div>
      <div>
        <label class="block text-[10px] font-label-bold text-on-surface-variant mb-1 uppercase tracking-wider">Estado</label>
        <select id="cot-state" class="p-2 bg-surface border border-outline-variant rounded-md text-body-sm outline-none focus:border-outline">
          ${STATE_OPTIONS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}
        </select>
      </div>
      <div>
        <label class="block text-[10px] font-label-bold text-on-surface-variant mb-1 uppercase tracking-wider">Servicio</label>
        <select id="cot-service" class="p-2 bg-surface border border-outline-variant rounded-md text-body-sm outline-none focus:border-outline">
          <option value="">Todos los servicios</option>
          ${SERVICES.map((s) => `<option value="${s.slug}">${escapeHtml(s.title)}</option>`).join('')}
        </select>
      </div>
      ${
        canFilterByAdvisor
          ? `<div>
               <label class="block text-[10px] font-label-bold text-on-surface-variant mb-1 uppercase tracking-wider">Asesor</label>
               <select id="cot-advisor" class="p-2 bg-surface border border-outline-variant rounded-md text-body-sm outline-none focus:border-outline">
                 <option value="">Todos</option>
               </select>
             </div>`
          : ''
      }
      <div>
        <label class="block text-[10px] font-label-bold text-on-surface-variant mb-1 uppercase tracking-wider">Desde</label>
        <input id="cot-from" type="date" class="p-2 bg-surface border border-outline-variant rounded-md text-body-sm outline-none focus:border-outline" />
      </div>
      <div>
        <label class="block text-[10px] font-label-bold text-on-surface-variant mb-1 uppercase tracking-wider">Hasta</label>
        <input id="cot-to" type="date" class="p-2 bg-surface border border-outline-variant rounded-md text-body-sm outline-none focus:border-outline" />
      </div>
      <button id="cot-clear" class="px-3 py-2 rounded-md border border-outline-variant text-body-sm font-label-bold text-on-surface-variant hover:bg-surface-container-lowest transition-colors">Limpiar filtros</button>
    </div>

    <div id="cot-kpis" class="grid grid-cols-2 lg:grid-cols-4 gap-gutter mb-gutter"></div>

    <div class="bg-surface rounded-xl border border-outline-variant overflow-hidden shadow-sm">
      <div class="p-4 border-b border-outline-variant bg-surface-container-low flex items-center justify-between flex-wrap gap-2">
        <h3 class="text-headline-sm font-headline-sm text-on-surface">Detalle</h3>
        <span id="cot-count-badge" class="bg-secondary-container text-on-secondary-container px-2.5 py-0.5 rounded-full text-label-bold font-label-bold">0 cotizaciones</span>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full text-left border-collapse">
          <thead class="bg-surface-container-high border-b border-outline-variant">
            <tr>
              <th class="p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase whitespace-nowrap">N.º</th>
              <th class="p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase whitespace-nowrap">Cliente</th>
              <th class="p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase whitespace-nowrap">Servicio</th>
              <th class="p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase whitespace-nowrap">Asesor</th>
              <th class="p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase whitespace-nowrap">Fecha</th>
              <th class="p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase whitespace-nowrap">Estado</th>
              <th class="p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase whitespace-nowrap text-right">Total</th>
              <th class="p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase whitespace-nowrap text-right">Acciones</th>
            </tr>
          </thead>
          <tbody id="cot-tbody" class="text-body-md font-body-md divide-y divide-outline-variant"></tbody>
        </table>
      </div>
    </div>
  `;

  const tbody = container.querySelector('#cot-tbody');
  const kpisEl = container.querySelector('#cot-kpis');
  const countBadge = container.querySelector('#cot-count-badge');
  const qInput = container.querySelector('#cot-q');
  const stateInput = container.querySelector('#cot-state');
  const serviceInput = container.querySelector('#cot-service');
  const advisorInput = container.querySelector('#cot-advisor');
  const fromInput = container.querySelector('#cot-from');
  const toInput = container.querySelector('#cot-to');

  let rows = [];

  if (advisorInput) {
    try {
      const advisors = (await ctx.api.get('/api/advisors')).filter((a) => !a.is_group);
      advisorInput.innerHTML += advisors.map((a) => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join('');
    } catch {
      /* si falla, el filtro de asesor simplemente sale vacio */
    }
  }

  function kpiTile(label, value, icon) {
    return `
      <div class="bg-surface rounded-xl border border-outline-variant p-4 shadow-sm">
        <div class="flex items-center gap-1.5 text-on-surface-variant mb-1">
          <span class="material-symbols-outlined text-[16px]">${icon}</span>
          <span class="text-label-bold font-label-bold uppercase tracking-wider">${label}</span>
        </div>
        <p class="text-headline-md font-headline-md font-bold text-on-surface">${value}</p>
      </div>`;
  }

  function renderKpis() {
    const activas = rows.filter((r) => r.state !== 'cancel' && r.state !== 'sale');
    const seguimiento = rows.filter((r) => r.state === 'seguimiento' || r.state === 'aprobada');
    const ventas = rows.filter((r) => r.state === 'sale');
    const montoVentas = ventas.reduce((s, r) => s + (r.amount_total || 0), 0);
    kpisEl.innerHTML = [
      kpiTile('Cotizaciones', rows.length, 'request_quote'),
      kpiTile('Activas', activas.length, 'edit_note'),
      kpiTile('En seguimiento/aprobadas', seguimiento.length, 'schedule'),
      kpiTile('Convertidas en venta', `${ventas.length} · ${formatMoney(montoVentas)}`, 'task_alt'),
    ].join('');
  }

  function rowHtml(r) {
    const badgeClass = STATE_BADGE[r.state] || STATE_BADGE.draft;
    const stateLabel = STATE_LABEL[r.state] || r.state;
    return `
      <tr class="hover:bg-surface-container-low transition-colors">
        <td class="p-table-cell-padding font-mono text-[12px]">${escapeHtml(r.number || '—')}</td>
        <td class="p-table-cell-padding font-bold"><div class="flex items-center gap-1.5">${escapeHtml(r.client_name)}${copyNameBtn(r.client_name)}</div>
          <span class="text-[11px] text-on-surface-variant font-normal">${escapeHtml(r.phone || '')}</span>
        </td>
        <td class="p-table-cell-padding text-on-surface-variant">${escapeHtml(r.service_title || '—')}</td>
        <td class="p-table-cell-padding text-on-surface-variant">${escapeHtml(r.advisor_name || 'Sin asignar')}</td>
        <td class="p-table-cell-padding text-on-surface-variant whitespace-nowrap">${fmtDate(r.date_order)}</td>
        <td class="p-table-cell-padding"><span class="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold ${badgeClass}">${escapeHtml(stateLabel)}</span></td>
        <td class="p-table-cell-padding text-right font-bold">${formatMoney(r.amount_total)}</td>
        <td class="p-table-cell-padding text-right">
          <div class="flex justify-end gap-2">
            <a href="/api/quotations/${r.id}/pdf" target="_blank" rel="noopener" class="px-2.5 py-1.5 border border-outline-variant rounded-md text-[11px] font-label-bold text-on-surface-variant hover:bg-surface-container-low transition-colors inline-flex items-center gap-1"><span class="material-symbols-outlined text-[13px]">picture_as_pdf</span>PDF</a>
            <button data-lead="${r.lead_id}" data-quotation="${r.id}" class="cot-open btn btn-secondary px-2.5 py-1.5">Abrir</button>
          </div>
        </td>
      </tr>`;
  }

  function renderTable() {
    countBadge.textContent = `${rows.length} cotizaci${rows.length === 1 ? 'ón' : 'ones'}`;
    tbody.innerHTML = rows.length
      ? rows.map(rowHtml).join('')
      : `<tr><td colspan="8" class="p-table-cell-padding py-10 text-center text-body-sm text-on-surface-variant">Sin cotizaciones con estos filtros. Usa "Cotizar" para crear una nueva.</td></tr>`;
    bindCopyButtons(tbody, ctx);
  }

  async function load() {
    const params = new URLSearchParams();
    if (qInput.value.trim()) params.set('q', qInput.value.trim());
    if (stateInput.value) params.set('state', stateInput.value);
    if (serviceInput.value) params.set('service', serviceInput.value);
    if (advisorInput?.value) params.set('advisor_id', advisorInput.value);
    if (fromInput.value) params.set('from', fromInput.value);
    if (toInput.value) params.set('to', toInput.value);
    let data;
    try {
      data = await ctx.api.get(`/api/quotations?${params.toString()}`);
    } catch (err) {
      ctx.toast(err.message || 'No se pudo cargar el listado de cotizaciones', 'error');
      return;
    }
    rows = data.quotations || [];
    renderKpis();
    renderTable();
  }

  const debouncedLoad = debounce(load, 300);
  qInput.addEventListener('input', debouncedLoad);
  stateInput.addEventListener('change', load);
  serviceInput.addEventListener('change', load);
  advisorInput?.addEventListener('change', load);
  fromInput.addEventListener('change', load);
  toInput.addEventListener('change', load);
  container.querySelector('#cot-clear').addEventListener('click', () => {
    qInput.value = '';
    stateInput.value = '';
    serviceInput.value = '';
    if (advisorInput) advisorInput.value = '';
    fromInput.value = '';
    toInput.value = '';
    load();
  });
  container.querySelector('#cot-refresh').addEventListener('click', load);

  tbody.addEventListener('click', (e) => {
    const btn = e.target.closest('.cot-open');
    if (!btn) return;
    ctx.navigate('cotizar', { lead: btn.dataset.lead, quotation: btn.dataset.quotation });
  });

  const offLeads = ctx.ws.on('leads_changed', load);
  await load();

  return () => {
    offLeads();
  };
}
