import { escapeHtml, formatMoney, statusBadge, copyNameBtn, bindCopyButtons, canReassignLead, saleReferenceBadge } from '../utils.js';
import { openReassignModal, openCloseModal, openEditLeadModal, markContacted, markQuoted, openQuotationViewModal, deleteLead } from './leadActions.js';

// Tablero por estado del embudo -- vista alterna a la tabla de Ventas, mismos
// datos (GET /api/leads ya filtrado) y mismas acciones que ya existen en
// leadActions.js. Ganado/Perdido se agrupan en una sola columna "Cerrado"
// (con su propio badge por card) para no tener 5 columnas angostas.
const COLUMNS = [
  { key: 'asignado', label: 'Asignado', icon: 'person_add', match: (l) => l.status === 'asignado' },
  { key: 'contactado', label: 'Contactado', icon: 'call', match: (l) => l.status === 'contactado' },
  { key: 'cotizado', label: 'Cotizado', icon: 'request_quote', match: (l) => l.status === 'cotizado' },
  { key: 'cerrado', label: 'Cerrado', icon: 'task_alt', match: (l) => l.status.startsWith('cerrado') },
];

// La columna Cerrado se puede angostar a una franja delgada para liberar
// espacio (no filtra los leads de ningun lado, solo deja de ocuparles
// pantalla a sus tarjetas) -- se recuerda por navegador, igual que el menu
// lateral.
const CERRADO_COLLAPSED_KEY = 'nova_kanban_cerrado_collapsed';

function cardHtml(lead, ctx, opts = {}) {
  const closed = lead.status.startsWith('cerrado');
  const isPrivileged = ctx.user?.role !== 'asesor';
  const badge = statusBadge(lead.status);
  // Aviso de "sin Odoo": solo si la integracion esta prendida (si no, TODAS
  // las tarjetas darian esto y no significaria nada) y el lead sigue
  // abierto -- uno ya cerrado sin oportunidad no es urgente de revisar.
  const showUnsynced = opts.odooEnabled && !closed && !lead.odoo_lead_id;
  const odooLink =
    lead.odoo_lead_id && opts.odooUrl
      ? `<a href="${opts.odooUrl}/web#id=${lead.odoo_lead_id}&model=crm.lead&view_type=form" target="_blank" rel="noopener" class="px-2 py-1 border border-outline-variant text-on-surface-variant rounded text-[11px] font-label-bold hover:bg-surface-container-low transition-colors inline-flex items-center gap-1 whitespace-nowrap"><span class="material-symbols-outlined text-[13px]">open_in_new</span>Ver en Odoo</a>`
      : '';

  // Igual criterio que la tabla de Ventas (ver ventas.js): acciones de
  // embudo y enlaces secundarios en dos filas separadas, no una sola bolsa
  // flex-wrap -- asi todas las tarjetas alinean sus botones igual sin
  // importar cuantos apliquen a cada una.
  const primary = [];
  const secondary = [];
  if (!closed) {
    if (lead.status === 'asignado') {
      primary.push(`<button data-action="contact" data-id="${lead.id}" class="px-2 py-1 bg-tertiary-fixed text-on-tertiary-fixed-variant rounded text-[11px] font-label-bold hover:opacity-90 transition-colors whitespace-nowrap">Contactar</button>`);
    }
    if (lead.status === 'asignado' || lead.status === 'contactado') {
      primary.push(`<button data-action="mark-quote" data-id="${lead.id}" class="px-2 py-1 bg-primary-fixed text-on-primary-fixed-variant rounded text-[11px] font-label-bold hover:opacity-90 transition-colors whitespace-nowrap">Marcar cotizado</button>`);
    }
    // Lead ya cotizado con sale.order en Odoo: "Ver cotización" (ver/editar/
    // enviar/confirmar). Sin Odoo ya no se ofrece armarla desde aquí.
    if (lead.status === 'cotizado' && lead.odoo_order_id) {
      primary.push(`<button data-action="view-quote" data-id="${lead.id}" class="px-2 py-1 bg-primary-fixed text-on-primary-fixed-variant rounded text-[11px] font-label-bold hover:opacity-90 transition-colors whitespace-nowrap">Ver cotización</button>`);
    }
    primary.push(`<button data-action="close" data-id="${lead.id}" class="px-2 py-1 bg-secondary text-on-secondary rounded text-[11px] font-label-bold hover:opacity-90 transition-colors whitespace-nowrap">Cerrar</button>`);
    // Un asesor tambien puede reasignar, pero solo un lead propio que ya
    // esta vencido (SLA >24h) -- ver canReassignLead. El backend es quien
    // de verdad lo exige.
    if (canReassignLead(ctx, lead)) {
      secondary.push(`<button data-action="reassign" data-id="${lead.id}" class="px-2 py-1 border border-outline-variant text-on-surface-variant rounded text-[11px] font-label-bold hover:bg-surface-container-low transition-colors inline-flex items-center gap-1 whitespace-nowrap"><span class="material-symbols-outlined text-[13px]">swap_horiz</span>Reasignar</button>`);
    }
    // Editar un lead activo ya lo permite el backend para un asesor sobre lo
    // suyo -- una vez cerrado, la edicion completa (incluye monto/fecha de
    // cierre) sigue siendo solo de coordinador/admin (rama `else` de abajo).
    secondary.push(`<button data-action="edit" data-id="${lead.id}" class="px-2 py-1 border border-outline-variant text-on-surface-variant rounded text-[11px] font-label-bold hover:bg-surface-container-low transition-colors inline-flex items-center gap-1 whitespace-nowrap"><span class="material-symbols-outlined text-[13px]">edit</span>Editar</button>`);
    if (odooLink) secondary.push(odooLink);
    if (isPrivileged) {
      secondary.push(`<button data-action="delete" data-id="${lead.id}" class="px-2 py-1 border border-error/40 text-error rounded text-[11px] font-label-bold hover:bg-error/10 transition-colors inline-flex items-center gap-1 whitespace-nowrap"><span class="material-symbols-outlined text-[13px]">delete</span>Eliminar</button>`);
    }
  } else if (isPrivileged) {
    if (lead.odoo_order_id) {
      secondary.push(`<button data-action="view-quote" data-id="${lead.id}" class="px-2 py-1 border border-outline-variant text-on-surface-variant rounded text-[11px] font-label-bold hover:bg-surface-container-low transition-colors inline-flex items-center gap-1 whitespace-nowrap"><span class="material-symbols-outlined text-[13px]">request_quote</span>Ver cotización</button>`);
    }
    secondary.push(`<button data-action="edit" data-id="${lead.id}" class="px-2 py-1 border border-outline-variant text-on-surface-variant rounded text-[11px] font-label-bold hover:bg-surface-container-low transition-colors inline-flex items-center gap-1 whitespace-nowrap"><span class="material-symbols-outlined text-[13px]">edit</span>Editar</button>`);
    if (odooLink) secondary.push(odooLink);
    secondary.push(`<button data-action="delete" data-id="${lead.id}" class="px-2 py-1 border border-error/40 text-error rounded text-[11px] font-label-bold hover:bg-error/10 transition-colors inline-flex items-center gap-1 whitespace-nowrap"><span class="material-symbols-outlined text-[13px]">delete</span>Eliminar</button>`);
  }
  return `
    <div class="lead-card bg-surface-container-lowest border border-outline-variant rounded-lg p-3 shadow-sm space-y-1.5">
      <div class="flex items-start justify-between gap-2">
        <p class="text-body-sm font-bold text-on-surface truncate flex items-center gap-1 min-w-0">${escapeHtml(lead.client_name)}${copyNameBtn(lead.client_name)}</p>
        <span class="shrink-0 flex items-center gap-1">
          ${showUnsynced ? `<span title="Sin oportunidad en Odoo" class="material-symbols-outlined text-[14px] text-error">cloud_off</span>` : ''}
          <span class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold whitespace-nowrap ${badge.badgeClass}">${badge.label}</span>
        </span>
      </div>
      <p class="text-[11px] text-on-surface-variant truncate">${escapeHtml(lead.product || '—')}${lead.city ? ` · ${escapeHtml(lead.city)}` : ''}</p>
      <p class="text-[11px] text-on-surface-variant truncate flex items-center gap-1">
        <span class="material-symbols-outlined text-[13px]">person</span>${escapeHtml(lead.advisor_name || 'Sin asignar')}
      </p>
      ${lead.odoo_order_id && lead.sale_reference ? `<p class="text-[11px] truncate flex items-center gap-1"><span class="material-symbols-outlined text-[13px] text-on-surface-variant">request_quote</span><span class="inline-flex px-1.5 py-0.5 rounded-full font-mono font-bold ${saleReferenceBadge(lead.sale_reference).badgeClass}">${escapeHtml(lead.sale_reference)}</span></p>` : ''}
      ${closed && lead.amount ? `<p class="text-body-sm font-bold text-on-surface">${formatMoney(lead.amount)}</p>` : ''}
      ${primary.length ? `<div class="flex flex-wrap gap-1 pt-1">${primary.join('')}</div>` : ''}
      ${secondary.length ? `<div class="flex flex-wrap gap-1">${secondary.join('')}</div>` : ''}
    </div>
  `;
}

/**
 * Dibuja el tablero dentro de `root`. `leads` ya viene filtrado (mismos
 * filtros que la tabla de Ventas); `onDone` se llama tras cualquier accion
 * que mute un lead, para recargar los datos igual que hace la tabla.
 */
export function renderLeadKanban(root, leads, ctx, onDone, opts = {}) {
  const cerradoCollapsed = localStorage.getItem(CERRADO_COLLAPSED_KEY) === '1';

  root.innerHTML = `
    <div class="grid grid-cols-1 sm:grid-cols-2 ${cerradoCollapsed ? 'xl:grid-cols-[1fr_1fr_1fr_auto]' : 'xl:grid-cols-4'} gap-3">
      ${COLUMNS.map((col) => {
        const items = leads.filter(col.match);
        const isCerrado = col.key === 'cerrado';
        if (isCerrado && cerradoCollapsed) {
          return `
          <div class="bg-surface-container-low rounded-xl border border-outline-variant flex sm:flex-col items-center justify-between sm:justify-start gap-2 p-2.5 sm:w-14">
            <button data-toggle-cerrado title="Mostrar columna Cerrado" class="flex sm:flex-col items-center gap-1 text-on-surface-variant hover:text-on-surface transition-colors">
              <span class="material-symbols-outlined text-[16px]">chevron_left</span>
              <span class="material-symbols-outlined text-[16px]">${col.icon}</span>
            </button>
            <span class="text-[11px] font-bold text-on-surface-variant bg-surface-container-lowest border border-outline-variant rounded-full px-2 py-0.5">${items.length}</span>
          </div>`;
        }
        return `
        <div class="bg-surface-container-low rounded-xl border border-outline-variant flex flex-col min-h-[200px]">
          <div class="flex items-center justify-between px-3 py-2.5 border-b border-outline-variant">
            <div class="flex items-center gap-1.5 text-on-surface-variant">
              <span class="material-symbols-outlined text-[18px]">${col.icon}</span>
              <span class="text-label-bold font-label-bold uppercase tracking-wider">${col.label}</span>
            </div>
            <div class="flex items-center gap-1.5">
              <span class="text-[11px] font-bold text-on-surface-variant bg-surface-container-lowest border border-outline-variant rounded-full px-2 py-0.5">${items.length}</span>
              ${isCerrado ? `<button data-toggle-cerrado title="Ocultar columna Cerrado" class="text-on-surface-variant hover:text-on-surface transition-colors"><span class="material-symbols-outlined text-[18px]">chevron_right</span></button>` : ''}
            </div>
          </div>
          <div class="p-2.5 space-y-2.5 flex-1 overflow-y-auto max-h-[560px]">
            ${items.length ? items.map((l) => cardHtml(l, ctx, opts)).join('') : '<p class="text-[11px] text-on-surface-variant text-center py-6">Sin leads aquí</p>'}
          </div>
        </div>`;
      }).join('')}
    </div>
  `;

  root.querySelector('[data-toggle-cerrado]')?.addEventListener('click', () => {
    localStorage.setItem(CERRADO_COLLAPSED_KEY, cerradoCollapsed ? '0' : '1');
    renderLeadKanban(root, leads, ctx, onDone, opts);
  });

  bindCopyButtons(root, ctx);
  root.querySelectorAll('button[data-action]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const lead = leads.find((l) => l.id === Number(btn.dataset.id));
      if (!lead) return;
      if (btn.dataset.action === 'reassign') openReassignModal(lead, ctx, onDone);
      if (btn.dataset.action === 'close') openCloseModal(lead, ctx, onDone);
      if (btn.dataset.action === 'contact') markContacted(lead, ctx, onDone);
      if (btn.dataset.action === 'mark-quote') markQuoted(lead, ctx, onDone);
      if (btn.dataset.action === 'view-quote') openQuotationViewModal(lead, ctx, onDone);
      if (btn.dataset.action === 'edit') openEditLeadModal(lead, ctx, onDone);
      if (btn.dataset.action === 'delete') deleteLead(lead, ctx, onDone);
    });
  });
}
