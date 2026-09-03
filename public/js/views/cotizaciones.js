import { escapeHtml, formatMoney, copyNameBtn, bindCopyButtons } from '../utils.js';
import { openQuotationViewModal } from '../components/leadActions.js';

// Todas las cotizaciones/pedidos que viven en Odoo, con su estado en vivo.
// Fuente: GET /api/leads/quotations (une los leads que tienen odoo_order_id
// con una lectura batch de sale.order en Odoo).

// Estado del pedido en Odoo -> color del badge (mismo criterio de la app:
// borrador neutro, enviada = advertencia suave, pedido = ok/verde).
const ORDER_STATE_BADGE = {
  draft: 'bg-surface-container-highest text-on-surface',
  sent: 'bg-tertiary-container text-on-tertiary-container border border-tertiary/20',
  sale: 'bg-secondary-container text-on-secondary-container',
  done: 'bg-secondary-container text-on-secondary-container',
  cancel: 'bg-error-container text-on-error-container',
};

export async function mount(container, ctx) {
  container.innerHTML = `
    <div class="mb-gutter flex justify-between items-end flex-wrap gap-gutter">
      <div>
        <h2 class="text-headline-lg font-headline-lg text-on-surface mb-base">Cotizaciones y Ventas</h2>
        <p class="text-body-md font-body-md text-on-surface-variant">Cotizaciones armadas en Odoo desde el CRM y su estado: borrador, enviada al cliente o confirmada como pedido de venta.</p>
      </div>
      <button id="cot-refresh" class="p-2 border border-outline-variant rounded-md hover:bg-surface-container-low transition-colors text-on-surface-variant" title="Actualizar">
        <span class="material-symbols-outlined text-[20px]">refresh</span>
      </button>
    </div>

    <div id="cot-banner" class="hidden mb-gutter p-3 rounded-lg bg-tertiary-container text-on-tertiary-container text-body-sm flex items-center gap-2">
      <span class="material-symbols-outlined text-[18px]">cloud_off</span>
      <span id="cot-banner-text"></span>
    </div>

    <div id="cot-kpis" class="grid grid-cols-2 lg:grid-cols-4 gap-gutter mb-gutter"></div>

    <div class="bg-surface rounded-xl border border-outline-variant overflow-hidden shadow-sm">
      <div class="overflow-x-auto">
        <table class="w-full text-left border-collapse">
          <thead class="bg-surface-container-high border-b border-outline-variant">
            <tr>
              <th class="p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase whitespace-nowrap">Cliente</th>
              <th class="p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase whitespace-nowrap">Asesor</th>
              <th class="p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase whitespace-nowrap">Referencia</th>
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
  const banner = container.querySelector('#cot-banner');
  const bannerText = container.querySelector('#cot-banner-text');

  let rows = [];

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
    const total = rows.length;
    const borrador = rows.filter((r) => r.order_state === 'draft').length;
    const enviadas = rows.filter((r) => r.order_state === 'sent').length;
    const pedidos = rows.filter((r) => r.order_state === 'sale' || r.order_state === 'done');
    const montoPedidos = pedidos.reduce((s, r) => s + (r.amount_total || 0), 0);
    kpisEl.innerHTML = [
      kpiTile('Cotizaciones', total, 'request_quote'),
      kpiTile('En borrador', borrador, 'edit_note'),
      kpiTile('Enviadas', enviadas, 'send'),
      kpiTile('Pedidos confirmados', `${pedidos.length} · ${formatMoney(montoPedidos)}`, 'task_alt'),
    ].join('');
  }

  function rowHtml(r) {
    const badgeClass = ORDER_STATE_BADGE[r.order_state] || 'bg-surface-container-highest text-on-surface';
    const stateLabel = r.order_state_label || 'Sin estado (Odoo no responde)';
    return `
      <tr class="hover:bg-surface-container-low transition-colors">
        <td class="p-table-cell-padding font-bold"><div class="flex items-center gap-1.5">${escapeHtml(r.client_name)}${copyNameBtn(r.client_name)}</div>
          <span class="text-[11px] text-on-surface-variant font-normal">${escapeHtml(r.product || '—')}</span>
        </td>
        <td class="p-table-cell-padding text-on-surface-variant">${escapeHtml(r.advisor_name || 'Sin asignar')}</td>
        <td class="p-table-cell-padding font-mono text-[12px]">${escapeHtml(r.sale_reference || '—')}</td>
        <td class="p-table-cell-padding"><span class="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold ${badgeClass}">${escapeHtml(stateLabel)}</span></td>
        <td class="p-table-cell-padding text-right font-bold">${formatMoney(r.amount_total)}</td>
        <td class="p-table-cell-padding text-right">
          <div class="flex justify-end gap-2">
            <a href="/api/leads/${r.lead_id}/quotation/pdf" target="_blank" rel="noopener" class="px-2.5 py-1.5 border border-outline-variant rounded-md text-[11px] font-label-bold text-on-surface-variant hover:bg-surface-container-low transition-colors inline-flex items-center gap-1"><span class="material-symbols-outlined text-[13px]">picture_as_pdf</span>PDF</a>
            <button data-lead="${r.lead_id}" class="cot-open px-2.5 py-1.5 bg-primary-fixed text-on-primary-fixed-variant rounded-md text-[11px] font-label-bold hover:opacity-90 transition-colors">Abrir</button>
          </div>
        </td>
      </tr>`;
  }

  function renderTable() {
    tbody.innerHTML = rows.length
      ? rows.map(rowHtml).join('')
      : `<tr><td colspan="6" class="p-table-cell-padding py-10 text-center text-body-sm text-on-surface-variant">Todavía no hay cotizaciones creadas en Odoo. Usa "Cotizar" desde un lead en Ventas.</td></tr>`;
    bindCopyButtons(tbody, ctx);
  }

  async function load() {
    let data;
    try {
      data = await ctx.api.get('/api/leads/quotations');
    } catch (err) {
      ctx.toast(err.message || 'No se pudo cargar el listado de cotizaciones', 'error');
      return;
    }
    rows = data.quotations || [];
    if (data.odoo_error) {
      banner.classList.remove('hidden');
      bannerText.textContent = `No se pudo leer el estado en vivo desde Odoo (${data.odoo_error}). Se muestra lo último guardado en el CRM.`;
    } else {
      banner.classList.add('hidden');
    }
    renderKpis();
    renderTable();
  }

  tbody.addEventListener('click', (e) => {
    const btn = e.target.closest('.cot-open');
    if (!btn) return;
    const r = rows.find((x) => x.lead_id === Number(btn.dataset.lead));
    if (!r) return;
    openQuotationViewModal(
      { id: r.lead_id, client_name: r.client_name, odoo_order_id: r.odoo_order_id, sale_reference: r.sale_reference },
      ctx,
      load
    );
  });

  container.querySelector('#cot-refresh').addEventListener('click', load);

  const offLeads = ctx.ws.on('leads_changed', load);
  await load();

  return () => {
    offLeads();
  };
}
