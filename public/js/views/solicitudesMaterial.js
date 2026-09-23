import { escapeHtml } from '../utils.js';
import { confirmModal } from '../components/modal.js';
import { fmtDateTime, fmtQty } from '../components/production.js';

// Solicitudes de material (sección 12): lo que Producción pide para cada
// OP. Es la bandeja que atenderá el futuro módulo de Inventario -- marcar
// "atendida" aquí es solo un estado: NO descuenta existencias.

const STATUS = {
  pendiente: { label: 'Pendiente', cls: 'bg-tertiary-container text-on-tertiary-container' },
  atendida: { label: 'Atendida', cls: 'bg-secondary-container text-on-secondary-container' },
  cancelada: { label: 'Cancelada', cls: 'bg-surface-container-high text-on-surface-variant line-through' },
};

export async function mount(container, ctx) {
  let canManage = false;
  try {
    canManage = (await ctx.api.get('/api/production/meta')).can_manage;
  } catch {
    /* solo lectura */
  }
  let filter = 'pendiente';

  container.innerHTML = `
    <div class="mb-margin-desktop">
      <h2 class="text-headline-lg font-headline-lg text-on-surface">Solicitudes de material</h2>
      <p class="text-body-md font-body-md text-on-surface-variant mt-1">Lo que Producción necesita para cada orden. Se crean desde la pestaña Materiales de la OP.</p>
    </div>
    <div class="px-4 py-2.5 mb-gutter rounded-lg border border-outline-variant bg-surface-container-low text-[12px] text-on-surface-variant">Estas solicitudes <b>no mueven inventario</b>. Marcarlas como atendidas deja el material de la OP como "disponible", nada más.</div>
    <div id="sm-filters" class="flex gap-2 flex-wrap mb-gutter"></div>
    <div class="bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm overflow-x-auto">
      <table class="w-full text-left border-collapse min-w-[760px]">
        <thead><tr class="border-b border-outline-variant">${['Solicitud', 'OP', 'Material', 'Cantidad', 'Motivo', 'Estado', ''].map((h) => `<th class="p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase tracking-wider">${h}</th>`).join('')}</tr></thead>
        <tbody id="sm-tbody" class="divide-y divide-outline-variant"></tbody>
      </table>
    </div>`;

  let rows = [];
  const tbody = container.querySelector('#sm-tbody');

  function render() {
    const opts = [['pendiente', 'Pendientes'], ['atendida', 'Atendidas'], ['cancelada', 'Canceladas'], ['', 'Todas']];
    container.querySelector('#sm-filters').innerHTML = opts
      .map(([k, l]) => `<button data-f="${k}" class="px-3 py-1.5 rounded-full border text-body-sm ${filter === k ? 'border-outline bg-surface-container-high text-on-surface font-bold' : 'border-outline-variant text-on-surface-variant hover:bg-surface-container-low'}">${l} (${k ? rows.filter((r) => r.status === k).length : rows.length})</button>`)
      .join('');
    container.querySelectorAll('[data-f]').forEach((b) => b.addEventListener('click', () => { filter = b.dataset.f; render(); }));
    const list = rows.filter((r) => !filter || r.status === filter);
    tbody.innerHTML = list.length
      ? list.map((r) => `
        <tr>
          <td class="p-table-cell-padding"><p class="font-bold text-on-surface">${escapeHtml(r.number)}</p><p class="text-[11px] text-on-surface-variant">${fmtDateTime(r.created_at)} · ${escapeHtml(r.requested_by_name || 'Sistema')}</p></td>
          <td class="p-table-cell-padding text-body-sm"><a href="#/op?id=${r.op_id}&tab=materiales" class="underline text-on-surface">${escapeHtml(r.op_number)}</a><span class="block text-[11px] text-on-surface-variant">${escapeHtml(r.client_name)}</span></td>
          <td class="p-table-cell-padding text-body-sm font-bold text-on-surface">${escapeHtml(r.material)}</td>
          <td class="p-table-cell-padding text-body-sm">${fmtQty(r.qty)} ${escapeHtml(r.unit)}</td>
          <td class="p-table-cell-padding text-body-sm text-on-surface-variant">${escapeHtml(r.reason)}</td>
          <td class="p-table-cell-padding"><span class="inline-flex px-2 py-0.5 rounded-full text-[11px] font-bold ${STATUS[r.status].cls}">${STATUS[r.status].label}</span></td>
          <td class="p-table-cell-padding text-right whitespace-nowrap">
            ${canManage && r.status === 'pendiente' ? `<button data-set="atendida" data-id="${r.id}" class="px-2 py-1 border border-outline-variant rounded text-[11px] font-bold text-on-surface hover:bg-surface-container-low">Marcar atendida</button>
              <button data-set="cancelada" data-id="${r.id}" class="px-2 py-1 text-[11px] text-error">Cancelar</button>` : ''}
          </td>
        </tr>`).join('')
      : '<tr><td colspan="7" class="p-table-cell-padding py-8 text-center text-body-sm text-on-surface-variant">No hay solicitudes.</td></tr>';
  }

  async function load() {
    try {
      rows = await ctx.api.get('/api/production/material-requests');
      render();
    } catch (err) {
      ctx.toast(err.message, 'error');
    }
  }

  tbody.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-set]');
    if (!b) return;
    if (b.dataset.set === 'cancelada' && !(await confirmModal({ title: 'Cancelar solicitud', message: 'El material de la OP vuelve a quedar pendiente.', confirmLabel: 'Cancelar solicitud', danger: true }))) return;
    try {
      await ctx.api.patch(`/api/production/material-requests/${b.dataset.id}`, { status: b.dataset.set });
      ctx.toast(b.dataset.set === 'atendida' ? 'Solicitud atendida' : 'Solicitud cancelada', 'success');
      load();
    } catch (err) {
      ctx.toast(err.message, 'error');
    }
  });

  const off = ctx.ws.on('production_changed', load);
  await load();
  return () => off();
}
