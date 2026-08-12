import { escapeHtml, formatMoney, statusBadge, slaBadge } from '../utils.js';
import { openReassignModal, openCloseModal, markContacted, markQuoted } from './leadActions.js';

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

function cardHtml(lead, canReassign) {
  const closed = lead.status.startsWith('cerrado');
  const badge = !closed && (lead.sla_status === 'vencido' || lead.sla_status === 'riesgo') ? slaBadge(lead.sla_status) : statusBadge(lead.status);

  const buttons = [];
  if (!closed) {
    if (lead.status === 'asignado') {
      buttons.push(`<button data-action="contact" data-id="${lead.id}" class="px-2 py-1 bg-tertiary-fixed text-on-tertiary-fixed-variant rounded text-[11px] font-label-bold hover:opacity-90 transition-colors">Contactar</button>`);
    }
    if (lead.status === 'asignado' || lead.status === 'contactado') {
      buttons.push(`<button data-action="quote" data-id="${lead.id}" class="px-2 py-1 bg-primary-fixed text-on-primary-fixed-variant rounded text-[11px] font-label-bold hover:opacity-90 transition-colors">Cotizar</button>`);
    }
    buttons.push(`<button data-action="close" data-id="${lead.id}" class="px-2 py-1 bg-secondary text-on-secondary rounded text-[11px] font-label-bold hover:opacity-90 transition-colors">Cerrar</button>`);
    if (canReassign) {
      buttons.push(`<button data-action="reassign" data-id="${lead.id}" class="px-2 py-1 border border-outline-variant text-on-surface-variant rounded text-[11px] font-label-bold hover:bg-surface-container-low transition-colors inline-flex items-center gap-1"><span class="material-symbols-outlined text-[13px]">swap_horiz</span>Reasignar</button>`);
    }
  }

  return `
    <div class="lead-card bg-surface-container-lowest border border-outline-variant rounded-lg p-3 shadow-sm space-y-1.5">
      <div class="flex items-start justify-between gap-2">
        <p class="text-body-sm font-bold text-on-surface truncate">${escapeHtml(lead.client_name)}</p>
        <span class="shrink-0 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold whitespace-nowrap ${badge.badgeClass}">${badge.label}</span>
      </div>
      <p class="text-[11px] text-on-surface-variant truncate">${escapeHtml(lead.product || '—')}${lead.city ? ` · ${escapeHtml(lead.city)}` : ''}</p>
      <div class="flex items-center justify-between gap-2">
        <p class="text-[11px] text-on-surface-variant truncate flex items-center gap-1">
          <span class="material-symbols-outlined text-[13px]">person</span>${escapeHtml(lead.advisor_name || 'Sin asignar')}
        </p>
        <span class="inline-flex items-center px-2 py-1 rounded-full text-[11px] font-bold ${lead.predicted_score >= 70 ? 'bg-secondary-container text-secondary' : lead.predicted_score >= 45 ? 'bg-primary-container text-primary' : 'bg-error-container text-error'}">
          ${lead.predicted_score}%
        </span>
      </div>
      ${closed && lead.amount ? `<p class="text-body-sm font-bold text-primary">${formatMoney(lead.amount)}</p>` : ''}
      ${buttons.length ? `<div class="flex flex-wrap gap-1 pt-1">${buttons.join('')}</div>` : ''}
    </div>
  `;
}

/**
 * Dibuja el tablero dentro de `root`. `leads` ya viene filtrado (mismos
 * filtros que la tabla de Ventas); `onDone` se llama tras cualquier accion
 * que mute un lead, para recargar los datos igual que hace la tabla.
 */
export function renderLeadKanban(root, leads, ctx, onDone) {
  const canReassign = ctx.user?.role !== 'asesor';

  root.innerHTML = `
    <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
      ${COLUMNS.map((col) => {
        const items = leads.filter(col.match);
        return `
        <div class="bg-surface-container-low rounded-xl border border-outline-variant flex flex-col min-h-[200px]">
          <div class="flex items-center justify-between px-3 py-2.5 border-b border-outline-variant">
            <div class="flex items-center gap-1.5 text-on-surface-variant">
              <span class="material-symbols-outlined text-[18px]">${col.icon}</span>
              <span class="text-label-bold font-label-bold uppercase tracking-wider">${col.label}</span>
            </div>
            <span class="text-[11px] font-bold text-on-surface-variant bg-surface-container-lowest border border-outline-variant rounded-full px-2 py-0.5">${items.length}</span>
          </div>
          <div class="p-2.5 space-y-2.5 flex-1 overflow-y-auto max-h-[560px]">
            ${items.length ? items.map((l) => cardHtml(l, canReassign)).join('') : '<p class="text-[11px] text-on-surface-variant text-center py-6">Sin leads aquí</p>'}
          </div>
        </div>`;
      }).join('')}
    </div>
  `;

  root.querySelectorAll('button[data-action]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const lead = leads.find((l) => l.id === Number(btn.dataset.id));
      if (!lead) return;
      if (btn.dataset.action === 'reassign') openReassignModal(lead, ctx, onDone);
      if (btn.dataset.action === 'close') openCloseModal(lead, ctx, onDone);
      if (btn.dataset.action === 'contact') markContacted(lead, ctx, onDone);
      if (btn.dataset.action === 'quote') markQuoted(lead, ctx, onDone);
    });
  });
}
