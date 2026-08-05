import { openModal, confirmModal } from './modal.js';
import { escapeHtml } from '../utils.js';

export async function openAssignModal(lead, ctx, onDone) {
  let advisors = [];
  try {
    advisors = (await ctx.api.get('/api/advisors')).filter((a) => !a.is_group && a.active);
  } catch (err) {
    ctx.toast('No se pudo cargar la lista de asesores', 'error');
    return;
  }
  if (advisors.length === 0) {
    ctx.toast('No hay asesores activos en rotación', 'error');
    return;
  }

  openModal({
    title: `Asignar manualmente · ${escapeHtml(lead.client_name)}`,
    render: (body, { close }) => {
      body.innerHTML = `
        <label class="block text-label-bold font-label-bold uppercase tracking-wide text-on-surface-variant mb-1">Asesor</label>
        <select id="assign-advisor" class="w-full p-2.5 border border-outline-variant rounded-md mb-4 outline-none focus:border-primary focus:ring-2 focus:ring-primary/20">
          ${advisors.map((a) => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join('')}
        </select>
        <div class="flex justify-end gap-2">
          <button id="assign-cancel" class="px-4 py-2 rounded-lg border border-outline-variant hover:bg-surface-container-low">Cancelar</button>
          <button id="assign-ok" class="px-4 py-2 rounded-lg bg-primary text-on-primary font-bold hover:bg-on-primary-fixed-variant">Asignar</button>
        </div>
      `;
      body.querySelector('#assign-cancel').addEventListener('click', close);
      body.querySelector('#assign-ok').addEventListener('click', async () => {
        const advisorId = body.querySelector('#assign-advisor').value;
        try {
          await ctx.api.post(`/api/leads/${lead.id}/assign`, { advisor_id: advisorId });
          ctx.toast('Lead asignado');
          close();
          onDone?.();
        } catch (err) {
          ctx.toast(err.message, 'error');
        }
      });
    },
  });
}

export async function openReassignModal(lead, ctx, onDone) {
  let advisors = [];
  try {
    advisors = (await ctx.api.get('/api/advisors')).filter((a) => !a.is_group && a.active && a.id !== lead.assigned_advisor_id);
  } catch {
    ctx.toast('No se pudo cargar la lista de asesores', 'error');
    return;
  }
  if (advisors.length === 0) {
    ctx.toast('No hay otro asesor activo disponible', 'error');
    return;
  }

  openModal({
    title: `Reasignar · ${escapeHtml(lead.client_name)}`,
    render: (body, { close }) => {
      body.innerHTML = `
        <div class="mb-4 p-3 rounded-lg bg-tertiary-fixed text-on-tertiary-fixed-variant text-body-sm font-body-sm flex gap-2">
          <span class="material-symbols-outlined text-[18px]">warning</span>
          <span>Reasignar este cliente penaliza al asesor actual (${escapeHtml(lead.advisor_name || 'sin asignar')}).</span>
        </div>
        <label class="block text-label-bold font-label-bold uppercase tracking-wide text-on-surface-variant mb-1">Nuevo asesor</label>
        <select id="reassign-advisor" class="w-full p-2.5 border border-outline-variant rounded-md mb-3 outline-none focus:border-primary focus:ring-2 focus:ring-primary/20">
          ${advisors.map((a) => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join('')}
        </select>
        <label class="block text-label-bold font-label-bold uppercase tracking-wide text-on-surface-variant mb-1">Motivo</label>
        <input id="reassign-reason" type="text" placeholder="Ej. Sin respuesta, ausencia..." class="w-full p-2.5 border border-outline-variant rounded-md mb-4 outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" />
        <div class="flex justify-end gap-2">
          <button id="reassign-cancel" class="px-4 py-2 rounded-lg border border-outline-variant hover:bg-surface-container-low">Cancelar</button>
          <button id="reassign-ok" class="px-4 py-2 rounded-lg bg-primary text-on-primary font-bold hover:bg-on-primary-fixed-variant">Reasignar</button>
        </div>
      `;
      body.querySelector('#reassign-cancel').addEventListener('click', close);
      body.querySelector('#reassign-ok').addEventListener('click', async () => {
        const advisorId = body.querySelector('#reassign-advisor').value;
        const reason = body.querySelector('#reassign-reason').value.trim();
        try {
          await ctx.api.post(`/api/leads/${lead.id}/reassign`, { to_advisor_id: advisorId, reason });
          ctx.toast('Lead reasignado');
          close();
          onDone?.();
        } catch (err) {
          ctx.toast(err.message, 'error');
        }
      });
    },
  });
}

// Marcar contactado/cotizado son cambios de un solo paso (no requieren
// datos adicionales del usuario), asi que no abren modal: solo llaman al
// endpoint y refrescan, igual que el resto de acciones operativas.
export async function markContacted(lead, ctx, onDone) {
  try {
    await ctx.api.patch(`/api/leads/${lead.id}/contact`);
    ctx.toast('Lead marcado como contactado', 'success');
    onDone?.();
  } catch (err) {
    ctx.toast(err.message, 'error');
  }
}

export async function markQuoted(lead, ctx, onDone) {
  try {
    await ctx.api.patch(`/api/leads/${lead.id}/quote`);
    ctx.toast('Lead marcado como cotizado', 'success');
    onDone?.();
  } catch (err) {
    ctx.toast(err.message, 'error');
  }
}

export async function registerFollowup(lead, ctx, onDone) {
  try {
    await ctx.api.post(`/api/leads/${lead.id}/followup`);
    ctx.toast('Seguimiento registrado', 'success');
    onDone?.();
  } catch (err) {
    ctx.toast(err.message, 'error');
  }
}

export function openCloseModal(lead, ctx, onDone) {
  openModal({
    title: `Cerrar venta · ${escapeHtml(lead.client_name)}`,
    render: (body, { close }) => {
      body.innerHTML = `
        <div class="flex gap-2 mb-4">
          <button data-result="ganado" class="close-result-btn flex-1 py-3 rounded-lg border-2 border-secondary text-secondary font-bold hover:bg-secondary-container transition-colors">
            Ganado
          </button>
          <button data-result="perdido" class="close-result-btn flex-1 py-3 rounded-lg border-2 border-outline-variant text-on-surface-variant font-bold hover:bg-surface-container-low transition-colors">
            Perdido
          </button>
        </div>
        <div id="amount-field">
          <label class="block text-label-bold font-label-bold uppercase tracking-wide text-on-surface-variant mb-1">Monto de la venta (COP)</label>
          <input id="close-amount" type="number" min="0" step="1000" placeholder="0" class="w-full p-2.5 border border-outline-variant rounded-md mb-4 outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" />
        </div>
        <div class="flex justify-end gap-2">
          <button id="close-cancel" class="px-4 py-2 rounded-lg border border-outline-variant hover:bg-surface-container-low">Cancelar</button>
          <button id="close-ok" class="px-4 py-2 rounded-lg bg-primary text-on-primary font-bold hover:bg-on-primary-fixed-variant">Confirmar cierre</button>
        </div>
      `;
      let result = 'ganado';
      const amountField = body.querySelector('#amount-field');
      body.querySelectorAll('.close-result-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          result = btn.dataset.result;
          amountField.classList.toggle('hidden', result === 'perdido');
        });
      });
      body.querySelector('#close-cancel').addEventListener('click', close);
      body.querySelector('#close-ok').addEventListener('click', async () => {
        const amount = body.querySelector('#close-amount').value || 0;
        try {
          await ctx.api.post(`/api/leads/${lead.id}/close`, { result, amount });
          ctx.toast(result === 'ganado' ? '¡Venta cerrada como ganada!' : 'Lead cerrado como perdido', 'success');
          close();
          onDone?.();
        } catch (err) {
          ctx.toast(err.message, 'error');
        }
      });
    },
  });
}

export async function confirmFactoryReset(ctx) {
  return confirmModal({
    title: 'Restaurar de fábrica',
    message: 'Esto eliminará todos los leads, ventas e historial de reasignaciones, y restaurará los asesores por defecto. Esta acción no se puede deshacer.',
    confirmLabel: 'Restaurar sistema',
    danger: true,
    requirePhrase: 'RESTAURAR',
  });
}
