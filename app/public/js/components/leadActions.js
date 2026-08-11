import { openModal, confirmModal } from './modal.js';
import { escapeHtml } from '../utils.js';

// Valor por defecto para los campos de fecha/hora "atrasada": el momento
// actual en hora local del navegador (se asume Colombia, igual que el
// resto de la app). El usuario solo lo cambia si esta registrando algo
// que paso antes (un cliente de dias anteriores, una venta vieja, etc.).
function nowLocalInputValue() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function dateFieldHtml(id, label = 'Fecha y hora real') {
  return `
    <label class="block text-label-bold font-label-bold uppercase tracking-wide text-on-surface-variant mb-1">${label}</label>
    <input id="${id}" type="datetime-local" value="${nowLocalInputValue()}" class="w-full p-2.5 border border-outline-variant rounded-md mb-4 outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" />
    <p class="text-[11px] text-on-surface-variant -mt-3 mb-4">¿Es de un día anterior? Cambia la fecha — así el registro y los reportes quedan con la fecha real, no con hoy.</p>
  `;
}

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
        ${dateFieldHtml('reassign-at')}
        <div class="flex justify-end gap-2">
          <button id="reassign-cancel" class="px-4 py-2 rounded-lg border border-outline-variant hover:bg-surface-container-low">Cancelar</button>
          <button id="reassign-ok" class="px-4 py-2 rounded-lg bg-primary text-on-primary font-bold hover:bg-on-primary-fixed-variant">Reasignar</button>
        </div>
      `;
      body.querySelector('#reassign-cancel').addEventListener('click', close);
      body.querySelector('#reassign-ok').addEventListener('click', async () => {
        const advisorId = body.querySelector('#reassign-advisor').value;
        const reason = body.querySelector('#reassign-reason').value.trim();
        const at = body.querySelector('#reassign-at').value;
        try {
          await ctx.api.post(`/api/leads/${lead.id}/reassign`, { to_advisor_id: advisorId, reason, at });
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

// Marcar contactado/cotizado abren un modal chico (con la fecha/hora ya
// prellenada a "ahora") en vez de disparar directo: asi se puede registrar
// algo de hoy con un clic extra minimo, o cambiar la fecha para algo
// atrasado, sin necesitar dos flujos distintos.
export function markContacted(lead, ctx, onDone) {
  openModal({
    title: `Marcar contactado · ${escapeHtml(lead.client_name)}`,
    render: (body, { close }) => {
      body.innerHTML = `
        ${dateFieldHtml('contact-at', 'Fecha y hora del contacto')}
        <div class="flex justify-end gap-2">
          <button id="contact-cancel" class="px-4 py-2 rounded-lg border border-outline-variant hover:bg-surface-container-low">Cancelar</button>
          <button id="contact-ok" class="px-4 py-2 rounded-lg bg-primary text-on-primary font-bold hover:bg-on-primary-fixed-variant">Confirmar</button>
        </div>
      `;
      body.querySelector('#contact-cancel').addEventListener('click', close);
      body.querySelector('#contact-ok').addEventListener('click', async () => {
        const at = body.querySelector('#contact-at').value;
        try {
          await ctx.api.patch(`/api/leads/${lead.id}/contact`, { at });
          ctx.toast('Lead marcado como contactado', 'success');
          close();
          onDone?.();
        } catch (err) {
          ctx.toast(err.message, 'error');
        }
      });
    },
  });
}

export function markQuoted(lead, ctx, onDone) {
  openModal({
    title: `Marcar cotizado · ${escapeHtml(lead.client_name)}`,
    render: (body, { close }) => {
      body.innerHTML = `
        ${dateFieldHtml('quote-at', 'Fecha y hora de la cotización')}
        <div class="flex justify-end gap-2">
          <button id="quote-cancel" class="px-4 py-2 rounded-lg border border-outline-variant hover:bg-surface-container-low">Cancelar</button>
          <button id="quote-ok" class="px-4 py-2 rounded-lg bg-primary text-on-primary font-bold hover:bg-on-primary-fixed-variant">Confirmar</button>
        </div>
      `;
      body.querySelector('#quote-cancel').addEventListener('click', close);
      body.querySelector('#quote-ok').addEventListener('click', async () => {
        const at = body.querySelector('#quote-at').value;
        try {
          await ctx.api.patch(`/api/leads/${lead.id}/quote`, { at });
          ctx.toast('Lead marcado como cotizado', 'success');
          close();
          onDone?.();
        } catch (err) {
          ctx.toast(err.message, 'error');
        }
      });
    },
  });
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
        ${dateFieldHtml('close-at', 'Fecha y hora del cierre')}
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
        const at = body.querySelector('#close-at').value;
        try {
          await ctx.api.post(`/api/leads/${lead.id}/close`, { result, amount, at });
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
