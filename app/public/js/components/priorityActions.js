import { escapeHtml } from '../utils.js';
import { markContacted, markQuoted, registerFollowup, openCloseModal } from './leadActions.js';

// Panel de "lo que necesita atencion ya", combinando los dos listados que ya
// expone el backend (GET /api/leads?critical_only=1 y ?followup_only=1) --
// cero endpoints nuevos, mismas acciones que ya existen en SLA/Seguimiento.
const MAX_ROWS_PER_GROUP = 4;

function funnelActionBtn(lead, ctx, onDone) {
  if (lead.status === 'asignado') {
    return `<button data-action="contact" data-id="${lead.id}" data-kind="sla" class="px-2.5 py-1.5 bg-surface-container-lowest text-primary hover:bg-primary/10 border border-outline-variant rounded-md text-[11px] font-label-bold transition-colors">Contactado</button>`;
  }
  if (lead.status === 'contactado') {
    return `<button data-action="quote" data-id="${lead.id}" data-kind="sla" class="px-2.5 py-1.5 bg-surface-container-lowest text-primary hover:bg-primary/10 border border-outline-variant rounded-md text-[11px] font-label-bold transition-colors">Cotizado</button>`;
  }
  return '';
}

function slaRowHtml(lead, ctx) {
  const vencido = lead.sla_status === 'vencido';
  return `
    <div class="flex items-center justify-between gap-3 px-3 py-2.5 ${vencido ? 'bg-error/5' : ''} rounded-lg">
      <div class="min-w-0 flex items-center gap-2.5">
        <span class="material-symbols-outlined text-[18px] ${vencido ? 'text-error' : 'text-tertiary'}">${vencido ? 'error' : 'warning'}</span>
        <div class="min-w-0">
          <p class="text-body-sm font-bold text-on-surface truncate">${escapeHtml(lead.client_name)}</p>
          <p class="text-[11px] text-on-surface-variant truncate">${vencido ? 'Vencido' : 'En riesgo'} · ${escapeHtml(lead.remaining_label || '')} · ${escapeHtml(lead.advisor_name || 'Sin asignar')}</p>
        </div>
      </div>
      <div class="shrink-0">${funnelActionBtn(lead, ctx)}</div>
    </div>
  `;
}

function followupRowHtml(lead) {
  const urgente = lead.followup_status === 'urgente';
  return `
    <div class="flex items-center justify-between gap-3 px-3 py-2.5 ${urgente ? 'bg-error/5' : ''} rounded-lg">
      <div class="min-w-0 flex items-center gap-2.5">
        <span class="material-symbols-outlined text-[18px] ${urgente ? 'text-error' : 'text-tertiary'}">${urgente ? 'local_fire_department' : 'schedule'}</span>
        <div class="min-w-0">
          <p class="text-body-sm font-bold text-on-surface truncate">${escapeHtml(lead.client_name)}</p>
          <p class="text-[11px] text-on-surface-variant truncate">${urgente ? 'Se está enfriando' : 'Dar seguimiento'} · ${escapeHtml(lead.followup_elapsed_label || '')} · ${escapeHtml(lead.advisor_name || 'Sin asignar')}</p>
        </div>
      </div>
      <div class="shrink-0 flex gap-1.5">
        <button data-action="followup" data-id="${lead.id}" data-kind="followup" class="px-2.5 py-1.5 bg-surface-container-lowest text-primary hover:bg-primary/10 border border-outline-variant rounded-md text-[11px] font-label-bold transition-colors">Seguir</button>
        <button data-action="close" data-id="${lead.id}" data-kind="followup" class="px-2.5 py-1.5 bg-secondary text-on-secondary rounded-md text-[11px] font-label-bold hover:opacity-90 transition-colors">Cerrar</button>
      </div>
    </div>
  `;
}

function groupHtml(title, icon, colorClass, rows, emptyMsg, viewAllRoute, ctx) {
  return `
    <div>
      <div class="flex items-center justify-between mb-1.5">
        <div class="flex items-center gap-1.5">
          <span class="material-symbols-outlined text-[16px] ${colorClass}">${icon}</span>
          <span class="text-label-bold font-label-bold text-on-surface-variant uppercase tracking-wider">${title}</span>
        </div>
        ${viewAllRoute ? `<button data-goto="${viewAllRoute}" class="text-[11px] font-label-bold text-primary hover:underline">Ver todo</button>` : ''}
      </div>
      <div class="space-y-0.5">
        ${rows.length ? rows.join('') : `<p class="text-[11px] text-on-surface-variant text-center py-4">${emptyMsg}</p>`}
      </div>
    </div>
  `;
}

export async function renderPriorityActions(root, ctx, onDone) {
  let critical = [];
  let followups = [];
  try {
    [critical, followups] = await Promise.all([
      ctx.api.get('/api/leads?critical_only=1'),
      ctx.api.get('/api/leads?followup_only=1'),
    ]);
  } catch {
    root.innerHTML = '<p class="text-body-sm text-on-surface-variant text-center py-6">No se pudieron cargar las acciones prioritarias.</p>';
    return;
  }

  critical.sort((a, b) => (a.sla_status === b.sla_status ? 0 : a.sla_status === 'vencido' ? -1 : 1));
  followups.sort((a, b) => (a.followup_status === b.followup_status ? 0 : a.followup_status === 'urgente' ? -1 : 1));

  const leadsByKey = new Map([...critical, ...followups].map((l) => [`${l.id}`, l]));

  root.innerHTML = `
    <div class="space-y-5">
      ${groupHtml(
        'SLA sin contactar',
        'timer',
        'text-error',
        critical.slice(0, MAX_ROWS_PER_GROUP).map((l) => slaRowHtml(l, ctx)),
        'Sin alertas SLA activas.',
        'sla',
        ctx
      )}
      ${groupHtml(
        'Seguimiento enfriándose',
        'campaign',
        'text-error',
        followups.slice(0, MAX_ROWS_PER_GROUP).map((l) => followupRowHtml(l)),
        'Sin cotizaciones pendientes de seguimiento.',
        'seguimiento',
        ctx
      )}
    </div>
  `;

  root.querySelectorAll('button[data-goto]').forEach((btn) => {
    btn.addEventListener('click', () => ctx.navigate(btn.dataset.goto));
  });
  root.querySelectorAll('button[data-action]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const lead = leadsByKey.get(btn.dataset.id);
      if (!lead) return;
      if (btn.dataset.action === 'contact') markContacted(lead, ctx, onDone);
      if (btn.dataset.action === 'quote') markQuoted(lead, ctx, onDone);
      if (btn.dataset.action === 'followup') registerFollowup(lead, ctx, onDone);
      if (btn.dataset.action === 'close') openCloseModal(lead, ctx, onDone);
    });
  });
}
