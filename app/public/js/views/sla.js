import { escapeHtml, slaBadge } from '../utils.js';
import { openReassignModal, markContacted, markQuoted } from '../components/leadActions.js';

const PAGE_SIZE = 50;

export async function mount(container, ctx) {
  const canReassign = ctx.user?.role !== 'asesor';

  container.innerHTML = `
    <div class="mb-gutter flex justify-between items-end flex-wrap gap-gutter">
      <div>
        <h2 class="text-headline-lg font-headline-lg text-primary mb-base">Control SLA 24h</h2>
        <p class="text-body-md font-body-md text-on-surface-variant">Listado de clientes críticos pendientes de contacto.</p>
      </div>
      <div class="flex gap-gutter bg-surface p-4 rounded-lg border border-outline-variant shadow-sm">
        <div>
          <p class="text-label-bold font-label-bold text-on-surface-variant uppercase">SLA Vencido (&gt;24h)</p>
          <p id="kpi-vencidos" class="text-display-kpi font-display-kpi text-error">0</p>
        </div>
        <div class="w-px bg-outline-variant"></div>
        <div>
          <p class="text-label-bold font-label-bold text-on-surface-variant uppercase">En Riesgo (&lt;2h)</p>
          <p id="kpi-riesgo" class="text-display-kpi font-display-kpi text-tertiary">0</p>
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
              <th class="p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase whitespace-nowrap">Asesor Actual</th>
              <th class="p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase whitespace-nowrap">Tiempo Transcurrido</th>
              <th class="p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase whitespace-nowrap text-right">Acción Requerida</th>
            </tr>
          </thead>
          <tbody id="sla-tbody" class="text-body-md font-body-md divide-y divide-outline-variant"></tbody>
        </table>
      </div>
      <div id="sla-loadmore-wrap" class="hidden p-4 border-t border-outline-variant text-center">
        <button id="sla-loadmore-btn" class="px-4 py-2 rounded-lg border border-outline-variant text-body-sm font-label-bold text-primary hover:bg-surface-container-low transition-colors">Mostrar más</button>
        <p id="sla-loadmore-info" class="text-[11px] text-on-surface-variant mt-1"></p>
      </div>
    </div>
  `;

  const tbody = container.querySelector('#sla-tbody');
  const kpiVencidos = container.querySelector('#kpi-vencidos');
  const kpiRiesgo = container.querySelector('#kpi-riesgo');
  const loadmoreWrap = container.querySelector('#sla-loadmore-wrap');
  const loadmoreInfo = container.querySelector('#sla-loadmore-info');
  const loadmoreBtn = container.querySelector('#sla-loadmore-btn');

  let critical = [];
  let visibleCount = PAGE_SIZE;

  function funnelButtons(lead) {
    const buttons = [];
    if (lead.status === 'asignado') {
      buttons.push(`<button data-id="${lead.id}" class="contact-btn bg-surface-container-lowest text-primary hover:bg-primary/10 border border-outline-variant px-3 py-2 rounded-lg font-bold text-body-sm font-body-sm transition-colors">Contactado</button>`);
    }
    if (lead.status === 'asignado' || lead.status === 'contactado') {
      buttons.push(`<button data-id="${lead.id}" class="quote-btn bg-surface-container-lowest text-primary hover:bg-primary/10 border border-outline-variant px-3 py-2 rounded-lg font-bold text-body-sm font-body-sm transition-colors">Cotizado</button>`);
    }
    return buttons.join('');
  }

  function rowHtml(lead) {
    const vencido = lead.sla_status === 'vencido';
    const badge = slaBadge(lead.sla_status);
    return `
      <tr class="${vencido ? 'bg-error/5 hover:bg-error/10' : 'hover:bg-surface-container-low'} transition-colors">
        <td class="p-table-cell-padding font-bold">${escapeHtml(lead.client_name)}</td>
        <td class="p-table-cell-padding">${escapeHtml(lead.product || '—')}</td>
        <td class="p-table-cell-padding text-on-surface-variant">${escapeHtml(lead.advisor_name || 'Pendiente asignación')}</td>
        <td class="p-table-cell-padding">
          <div class="inline-flex items-center gap-2 px-3 py-1 rounded-full font-bold ${badge.badgeClass}">
            <span class="material-symbols-outlined text-[18px]">${vencido ? 'timer' : 'warning'}</span>
            ${escapeHtml(lead.remaining_label)}
          </div>
        </td>
        <td class="p-table-cell-padding text-right">
          <div class="flex justify-end flex-wrap gap-2">
            ${funnelButtons(lead)}
            ${canReassign ? `<button data-id="${lead.id}" class="reassign-btn ${vencido ? 'bg-error text-on-error hover:bg-error/90 shadow-sm' : 'bg-surface-container-highest text-primary hover:bg-primary/10 border border-outline-variant'} px-4 py-2 rounded-lg font-bold text-body-sm font-body-sm transition-colors inline-flex justify-center items-center gap-2">
              <span class="material-symbols-outlined text-[18px]">swap_horiz</span>
              ${vencido ? 'Reasignar Inmediato' : 'Reasignar'}
            </button>` : ''}
          </div>
        </td>
      </tr>`;
  }

  function renderTable() {
    const shown = critical.slice(0, visibleCount);
    tbody.innerHTML = shown.length
      ? shown.map(rowHtml).join('')
      : `<tr><td colspan="5" class="p-table-cell-padding py-10 text-center text-body-sm text-on-surface-variant">Sin alertas SLA activas. Todo bajo control.</td></tr>`;
    const remaining = critical.length - shown.length;
    loadmoreWrap.classList.toggle('hidden', remaining <= 0);
    if (remaining > 0) loadmoreInfo.textContent = `Mostrando ${shown.length} de ${critical.length} · quedan ${remaining} más urgentes`;
  }

  async function load() {
    try {
      critical = await ctx.api.get('/api/leads?critical_only=1');
    } catch {
      ctx.toast('No se pudo cargar el listado SLA', 'error');
      return;
    }
    critical.sort((a, b) => (a.sla_status === b.sla_status ? 0 : a.sla_status === 'vencido' ? -1 : 1));
    kpiVencidos.textContent = critical.filter((l) => l.sla_status === 'vencido').length;
    kpiRiesgo.textContent = critical.filter((l) => l.sla_status === 'riesgo').length;
    renderTable();
  }

  loadmoreBtn.addEventListener('click', () => {
    visibleCount += PAGE_SIZE;
    renderTable();
  });

  tbody.addEventListener('click', (e) => {
    const reassignBtn = e.target.closest('.reassign-btn');
    if (reassignBtn) {
      const lead = critical.find((l) => l.id === Number(reassignBtn.dataset.id));
      if (lead) openReassignModal(lead, ctx, load);
      return;
    }
    const contactBtn = e.target.closest('.contact-btn');
    if (contactBtn) {
      const lead = critical.find((l) => l.id === Number(contactBtn.dataset.id));
      if (lead) markContacted(lead, ctx, load);
      return;
    }
    const quoteBtn = e.target.closest('.quote-btn');
    if (quoteBtn) {
      const lead = critical.find((l) => l.id === Number(quoteBtn.dataset.id));
      if (lead) markQuoted(lead, ctx, load);
    }
  });

  const offLeads = ctx.ws.on('leads_changed', load);
  const timer = setInterval(load, 60000); // el reloj SLA avanza aunque nadie toque nada
  await load();

  return () => {
    offLeads();
    clearInterval(timer);
  };
}
