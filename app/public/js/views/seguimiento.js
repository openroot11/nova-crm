import { escapeHtml } from '../utils.js';
import { registerFollowup, openCloseModal } from '../components/leadActions.js';

const FOLLOWUP_LABELS = {
  pendiente: { label: 'Dar seguimiento', badgeClass: 'bg-tertiary-container text-on-tertiary-container border border-tertiary/20' },
  urgente: { label: 'Se está enfriando', badgeClass: 'bg-tertiary text-on-tertiary' },
};

export async function mount(container, ctx) {
  container.innerHTML = `
    <div class="mb-gutter flex justify-between items-end flex-wrap gap-gutter">
      <div>
        <h2 class="text-headline-lg font-headline-lg text-primary mb-base">Seguimiento Activo</h2>
        <p class="text-body-md font-body-md text-on-surface-variant">Cotizaciones enviadas que llevan tiempo sin respuesta del cliente — para que ningún lead se enfríe por falta de insistencia.</p>
      </div>
      <div class="flex gap-gutter bg-surface p-4 rounded-lg border border-outline-variant shadow-sm">
        <div>
          <p class="text-label-bold font-label-bold text-on-surface-variant uppercase">Se Está Enfriando (&gt;72h)</p>
          <p id="kpi-urgente" class="text-display-kpi font-display-kpi text-error">0</p>
        </div>
        <div class="w-px bg-outline-variant"></div>
        <div>
          <p class="text-label-bold font-label-bold text-on-surface-variant uppercase">Pendientes (&gt;24h)</p>
          <p id="kpi-pendiente" class="text-display-kpi font-display-kpi text-tertiary">0</p>
        </div>
      </div>
    </div>

    <div class="bg-surface rounded-xl border border-outline-variant overflow-hidden shadow-sm">
      <div class="overflow-x-auto">
        <table class="w-full text-left border-collapse">
          <thead class="bg-surface-container-high border-b border-outline-variant">
            <tr>
              <th class="p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase whitespace-nowrap">Cliente</th>
              <th class="p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase whitespace-nowrap">Producto</th>
              <th class="p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase whitespace-nowrap">Asesor</th>
              <th class="p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase whitespace-nowrap">Desde el último toque</th>
              <th class="p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase whitespace-nowrap">Intentos</th>
              <th class="p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase whitespace-nowrap text-right">Acción</th>
            </tr>
          </thead>
          <tbody id="seguimiento-tbody" class="text-body-md font-body-md divide-y divide-outline-variant"></tbody>
        </table>
      </div>
    </div>
  `;

  const tbody = container.querySelector('#seguimiento-tbody');
  const kpiUrgente = container.querySelector('#kpi-urgente');
  const kpiPendiente = container.querySelector('#kpi-pendiente');

  let pending = [];

  function rowHtml(lead) {
    const meta = FOLLOWUP_LABELS[lead.followup_status] || FOLLOWUP_LABELS.pendiente;
    return `
      <tr class="${lead.followup_status === 'urgente' ? 'bg-error/5 hover:bg-error/10' : 'hover:bg-surface-container-low'} transition-colors">
        <td class="p-table-cell-padding font-bold">${escapeHtml(lead.client_name)}</td>
        <td class="p-table-cell-padding">${escapeHtml(lead.product || '—')}</td>
        <td class="p-table-cell-padding text-on-surface-variant">${escapeHtml(lead.advisor_name || 'Sin asignar')}</td>
        <td class="p-table-cell-padding">
          <div class="inline-flex items-center gap-2 px-3 py-1 rounded-full font-bold ${meta.badgeClass}">
            <span class="material-symbols-outlined text-[18px]">schedule</span>
            ${escapeHtml(lead.followup_elapsed_label || '—')}
          </div>
        </td>
        <td class="p-table-cell-padding text-on-surface-variant">${lead.followup_count || 0}</td>
        <td class="p-table-cell-padding text-right">
          <div class="flex justify-end flex-wrap gap-2">
            <button data-action="followup" data-id="${lead.id}" class="bg-surface-container-lowest text-primary hover:bg-primary/10 border border-outline-variant px-3 py-2 rounded-lg font-bold text-body-sm font-body-sm transition-colors">${meta.label}</button>
            <button data-action="close" data-id="${lead.id}" class="bg-secondary text-on-secondary px-3 py-2 rounded-lg font-bold text-body-sm font-body-sm hover:opacity-90 transition-colors">Cerrar</button>
          </div>
        </td>
      </tr>`;
  }

  async function load() {
    try {
      pending = await ctx.api.get('/api/leads?followup_only=1');
    } catch {
      ctx.toast('No se pudo cargar el listado de seguimiento', 'error');
      return;
    }
    pending.sort((a, b) => (a.followup_status === b.followup_status ? 0 : a.followup_status === 'urgente' ? -1 : 1));
    kpiUrgente.textContent = pending.filter((l) => l.followup_status === 'urgente').length;
    kpiPendiente.textContent = pending.filter((l) => l.followup_status === 'pendiente').length;
    tbody.innerHTML = pending.length
      ? pending.map(rowHtml).join('')
      : `<tr><td colspan="6" class="p-table-cell-padding py-10 text-center text-body-sm text-on-surface-variant">Sin cotizaciones pendientes de seguimiento. Todo bajo control.</td></tr>`;
  }

  tbody.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const lead = pending.find((l) => l.id === Number(btn.dataset.id));
    if (!lead) return;
    if (btn.dataset.action === 'followup') registerFollowup(lead, ctx, load);
    if (btn.dataset.action === 'close') openCloseModal(lead, ctx, load);
  });

  const offLeads = ctx.ws.on('leads_changed', load);
  const timer = setInterval(load, 60000); // el reloj de seguimiento avanza aunque nadie toque nada
  await load();

  return () => {
    offLeads();
    clearInterval(timer);
  };
}
