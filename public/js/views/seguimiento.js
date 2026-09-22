import { escapeHtml, followupBadge, copyNameBtn, bindCopyButtons } from '../utils.js';
import { registerFollowup, openCloseModal } from '../components/leadActions.js';

const PAGE_SIZE = 50;

export async function mount(container, ctx) {
  container.innerHTML = `
    <div class="mb-gutter flex flex-col gap-gutter lg:flex-row lg:justify-between lg:items-end">
      <div class="min-w-0">
        <h2 class="text-headline-lg font-headline-lg text-on-surface mb-base">Seguimiento Activo</h2>
        <p class="text-[13px] lg:text-body-md font-body-md text-on-surface-variant">Cotizaciones enviadas que llevan tiempo sin respuesta del cliente — para que ningún lead se enfríe por falta de insistencia.</p>
      </div>
      <div class="flex flex-wrap gap-x-gutter gap-y-3 bg-surface p-4 rounded-lg border border-outline-variant shadow-sm shrink-0">
        <div class="min-w-[150px]">
          <p class="text-label-bold font-label-bold text-on-surface-variant uppercase">Se Está Enfriando (&gt;72h)</p>
          <p id="kpi-urgente" class="text-4xl lg:text-display-kpi font-display-kpi font-bold text-error leading-tight">0</p>
        </div>
        <div class="hidden sm:block w-px self-stretch bg-outline-variant"></div>
        <div class="min-w-[150px]">
          <p class="text-label-bold font-label-bold text-on-surface-variant uppercase">Pendientes (&gt;24h)</p>
          <p id="kpi-pendiente" class="text-4xl lg:text-display-kpi font-display-kpi font-bold text-tertiary leading-tight">0</p>
        </div>
      </div>
    </div>

    <div id="seguimiento-panel" class="bg-surface rounded-xl border border-outline-variant overflow-hidden shadow-sm">
      <div class="hidden lg:block overflow-x-auto">
        <table class="w-full text-left border-collapse">
          <thead class="bg-surface-container-high border-b border-outline-variant">
            <tr>
              <th class="p-2 xl:p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase">Cliente</th>
              <th class="p-2 xl:p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase">Producto</th>
              <th class="p-2 xl:p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase">Asesor</th>
              <th class="p-2 xl:p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase">Desde el último toque</th>
              <th class="p-2 xl:p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase">Intentos</th>
              <th class="p-2 xl:p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase text-right">Acción</th>
            </tr>
          </thead>
          <tbody id="seguimiento-tbody" class="text-body-md font-body-md divide-y divide-outline-variant"></tbody>
        </table>
      </div>

      <div id="seguimiento-cards" class="lg:hidden divide-y divide-outline-variant"></div>

      <div id="seguimiento-loadmore-wrap" class="hidden p-4 border-t border-outline-variant text-center">
        <button id="seguimiento-loadmore-btn" class="px-4 py-2 rounded-lg border border-outline-variant text-body-sm font-label-bold text-on-surface hover:bg-surface-container-low transition-colors">Mostrar más</button>
        <p id="seguimiento-loadmore-info" class="text-[11px] text-on-surface-variant mt-1"></p>
      </div>
    </div>
  `;

  const panel = container.querySelector('#seguimiento-panel');
  const tbody = container.querySelector('#seguimiento-tbody');
  const cards = container.querySelector('#seguimiento-cards');
  const kpiUrgente = container.querySelector('#kpi-urgente');
  const kpiPendiente = container.querySelector('#kpi-pendiente');
  const loadmoreWrap = container.querySelector('#seguimiento-loadmore-wrap');
  const loadmoreInfo = container.querySelector('#seguimiento-loadmore-info');
  const loadmoreBtn = container.querySelector('#seguimiento-loadmore-btn');

  let pending = [];
  let visibleCount = PAGE_SIZE;

  function actionButtons(lead, meta) {
    return `
      <button data-action="followup" data-id="${lead.id}" class="bg-surface-container-lowest text-on-surface hover:bg-surface-container-low border border-outline-variant px-2.5 py-1.5 xl:px-3 xl:py-2 rounded-lg font-bold text-xs xl:text-body-sm font-body-sm transition-colors">${meta.label}</button>
      <button data-action="close" data-id="${lead.id}" class="bg-secondary text-on-secondary px-2.5 py-1.5 xl:px-3 xl:py-2 rounded-lg font-bold text-xs xl:text-body-sm font-body-sm hover:opacity-90 transition-colors">Cerrar</button>`;
  }

  function rowHtml(lead) {
    const meta = followupBadge(lead.followup_status);
    return `
      <tr class="${lead.followup_status === 'urgente' ? 'bg-error/5 hover:bg-error/10' : 'hover:bg-surface-container-low'} transition-colors">
        <td class="p-2 xl:p-table-cell-padding font-bold break-words"><div class="flex items-center gap-1.5 min-w-0">${escapeHtml(lead.client_name)}${copyNameBtn(lead.client_name)}</div></td>
        <td class="p-2 xl:p-table-cell-padding break-words">${escapeHtml(lead.product || '—')}</td>
        <td class="p-2 xl:p-table-cell-padding text-on-surface-variant break-words">${escapeHtml(lead.advisor_name || 'Sin asignar')}</td>
        <td class="p-2 xl:p-table-cell-padding">
          <div class="inline-flex items-center gap-2 px-3 py-1 rounded-full font-bold whitespace-nowrap ${meta.badgeClass}">
            <span class="material-symbols-outlined text-[18px]">schedule</span>
            ${escapeHtml(lead.followup_elapsed_label || '—')}
          </div>
        </td>
        <td class="p-2 xl:p-table-cell-padding text-on-surface-variant">${lead.followup_count || 0}</td>
        <td class="p-2 xl:p-table-cell-padding text-right">
          <div class="flex justify-end flex-wrap gap-2">${actionButtons(lead, meta)}</div>
        </td>
      </tr>`;
  }

  function cardHtml(lead) {
    const meta = followupBadge(lead.followup_status);
    return `
      <div class="p-3 ${lead.followup_status === 'urgente' ? 'bg-error/5' : ''}">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-1.5 font-bold break-words">${escapeHtml(lead.client_name)}${copyNameBtn(lead.client_name)}</div>
            <p class="text-[13px] text-on-surface-variant break-words mt-0.5">${escapeHtml(lead.product || '—')}</p>
            <p class="text-[13px] text-on-surface-variant break-words">${escapeHtml(lead.advisor_name || 'Sin asignar')} · ${lead.followup_count || 0} intento(s)</p>
          </div>
          <div class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full font-bold text-[12px] whitespace-nowrap shrink-0 ${meta.badgeClass}">
            <span class="material-symbols-outlined text-[14px]">schedule</span>
            ${escapeHtml(lead.followup_elapsed_label || '—')}
          </div>
        </div>
        <div class="flex flex-wrap gap-2 mt-2.5">${actionButtons(lead, meta)}</div>
      </div>`;
  }

  const EMPTY_MSG = 'Sin cotizaciones pendientes de seguimiento. Todo bajo control.';

  function renderTable() {
    const shown = pending.slice(0, visibleCount);
    tbody.innerHTML = shown.length
      ? shown.map(rowHtml).join('')
      : `<tr><td colspan="6" class="p-table-cell-padding py-10 text-center text-body-sm text-on-surface-variant">${EMPTY_MSG}</td></tr>`;
    cards.innerHTML = shown.length
      ? shown.map(cardHtml).join('')
      : `<div class="p-6 text-center text-body-sm text-on-surface-variant">${EMPTY_MSG}</div>`;
    bindCopyButtons(panel, ctx);
    const remaining = pending.length - shown.length;
    loadmoreWrap.classList.toggle('hidden', remaining <= 0);
    if (remaining > 0) loadmoreInfo.textContent = `Mostrando ${shown.length} de ${pending.length} · quedan ${remaining} más`;
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
    renderTable();
  }

  loadmoreBtn.addEventListener('click', () => {
    visibleCount += PAGE_SIZE;
    renderTable();
  });

  panel.addEventListener('click', (e) => {
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
