import { escapeHtml } from '../utils.js';
import { openModal } from '../components/modal.js';
import { inputCls, labelCls } from '../components/production.js';

// Operarios del taller (Configuración): quienes cortan, cosen e instalan.
// No inician sesión; se asignan como responsables de OP y a tareas.

export async function mount(container, ctx) {
  const canManage = ['admin', 'coordinador', 'produccion'].includes(ctx.user?.role);
  container.innerHTML = `
    <div class="flex justify-between items-end mb-margin-desktop flex-wrap gap-3">
      <div>
        <h2 class="text-headline-lg font-headline-lg text-on-surface">Operarios</h2>
        <p class="text-body-md font-body-md text-on-surface-variant mt-1">Personal del taller. Se asignan como responsables de las órdenes de producción y a sus tareas.</p>
      </div>
      ${canManage ? '<button id="wk-new" class="btn btn-primary"><span class="material-symbols-outlined">person_add</span>Nuevo operario</button>' : ''}
    </div>
    <div id="wk-list" class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-gutter"></div>`;

  const listEl = container.querySelector('#wk-list');
  let workers = [];

  function render() {
    listEl.innerHTML = workers.length
      ? workers.map((w) => `
        <div class="bg-surface-container-lowest border border-outline-variant rounded-xl p-4 shadow-sm ${w.active ? '' : 'opacity-60'}">
          <div class="flex items-start justify-between gap-2">
            <div class="flex items-center gap-3 min-w-0">
              <span class="w-10 h-10 rounded-full bg-surface-container-high flex items-center justify-center font-bold text-on-surface shrink-0">${escapeHtml(w.name.slice(0, 1).toUpperCase())}</span>
              <div class="min-w-0"><p class="font-bold text-on-surface truncate">${escapeHtml(w.name)}</p><p class="text-[12px] text-on-surface-variant truncate">${escapeHtml(w.specialty || 'Sin especialidad')}</p></div>
            </div>
            ${w.active ? '' : '<span class="text-[10px] font-bold px-2 py-0.5 rounded bg-surface-container-high text-on-surface-variant">Inactivo</span>'}
          </div>
          <div class="flex gap-4 mt-3 text-body-sm">
            <a href="#/produccion" class="text-on-surface"><b>${w.open_orders}</b> <span class="text-on-surface-variant">OP a cargo</span></a>
            <span class="text-on-surface"><b>${w.open_tasks}</b> <span class="text-on-surface-variant">tareas pendientes</span></span>
          </div>
          ${canManage ? `<div class="flex gap-2 mt-3">
            <button data-edit="${w.id}" class="px-3 py-1 border border-outline-variant rounded text-[12px] font-label-bold text-on-surface hover:bg-surface-container-low">Editar</button>
            <button data-toggle="${w.id}" class="px-3 py-1 border border-outline-variant rounded text-[12px] font-label-bold ${w.active ? 'text-error' : 'text-on-surface'} hover:bg-surface-container-low">${w.active ? 'Desactivar' : 'Reactivar'}</button>
          </div>` : ''}
        </div>`).join('')
      : '<p class="text-body-sm text-on-surface-variant">Aún no hay operarios.</p>';
  }

  async function load() {
    try {
      workers = await ctx.api.get('/api/workers?all=1');
      render();
    } catch (err) {
      ctx.toast(err.message, 'error');
    }
  }

  function form(w = null) {
    openModal({
      title: w ? `Editar · ${w.name}` : 'Nuevo operario',
      render: (body, { close }) => {
        body.innerHTML = `
          <div class="space-y-3">
            <div><label class="${labelCls}">Nombre *</label><input id="wf-name" value="${escapeHtml(w?.name || '')}" class="${inputCls}" /></div>
            <div><label class="${labelCls}">Especialidad</label><input id="wf-spec" value="${escapeHtml(w?.specialty || '')}" placeholder="Ej. Costura, corte, instalación" class="${inputCls}" /></div>
          </div>
          <div class="flex justify-end gap-2 mt-4"><button id="wf-cancel" class="btn btn-ghost">Cancelar</button><button id="wf-ok" class="btn btn-primary">${w ? 'Guardar' : 'Crear'}</button></div>`;
        body.querySelector('#wf-cancel').addEventListener('click', close);
        body.querySelector('#wf-ok').addEventListener('click', async () => {
          const payload = { name: body.querySelector('#wf-name').value.trim(), specialty: body.querySelector('#wf-spec').value.trim() };
          if (!payload.name) return ctx.toast('El nombre es obligatorio', 'error');
          try {
            if (w) await ctx.api.patch(`/api/workers/${w.id}`, payload);
            else await ctx.api.post('/api/workers', payload);
            ctx.toast('Operario guardado', 'success');
            close();
            load();
          } catch (err) {
            ctx.toast(err.message, 'error');
          }
        });
      },
    });
  }

  listEl.addEventListener('click', async (e) => {
    const ed = e.target.closest('[data-edit]');
    if (ed) return form(workers.find((w) => w.id === Number(ed.dataset.edit)));
    const tg = e.target.closest('[data-toggle]');
    if (tg) {
      const w = workers.find((x) => x.id === Number(tg.dataset.toggle));
      try {
        await ctx.api.patch(`/api/workers/${w.id}`, { active: !w.active });
        load();
      } catch (err) {
        ctx.toast(err.message, 'error');
      }
    }
  });
  container.querySelector('#wk-new')?.addEventListener('click', () => form());
  const off = ctx.ws.on('production_changed', load);
  await load();
  return () => off();
}
