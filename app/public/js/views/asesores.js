import { escapeHtml, initials } from '../utils.js';
import { openModal } from '../components/modal.js';

export async function mount(container, ctx) {
  container.innerHTML = `
    <div class="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-gutter">
      <div>
        <h1 class="text-headline-lg font-headline-lg text-on-surface tracking-tight">Gestión del Equipo</h1>
        <p class="text-body-md font-body-md text-on-surface-variant mt-1">Monitorea rendimiento y administra la prioridad en rotación de leads.</p>
      </div>
      <button id="add-advisor-btn" class="px-4 py-2 bg-primary text-on-primary text-label-bold font-label-bold rounded-lg hover:bg-on-primary-fixed-variant transition-colors flex items-center gap-2 shadow-sm">
        <span class="material-symbols-outlined text-[18px]">person_add</span> Añadir Asesor
      </button>
    </div>
    <div id="advisor-grid" class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-gutter"></div>
  `;

  const grid = container.querySelector('#advisor-grid');

  function cardHtml(a) {
    const paused = !a.active;
    const slaLow = a.sla_rate < 85;
    return `
      <div class="bg-surface-container-lowest border border-outline-variant rounded-xl p-gutter flex flex-col gap-4 relative group hover:border-primary-container transition-colors shadow-sm ${paused ? 'opacity-80' : ''}">
        <div class="flex items-center gap-3">
          <div class="w-12 h-12 rounded-full overflow-hidden border-2 ${paused ? 'border-outline-variant grayscale' : 'border-secondary-container'} shrink-0 flex items-center justify-center bg-primary-container text-on-primary-container font-bold">
            ${initials(a.name)}
          </div>
          <div>
            <h3 class="text-headline-md font-headline-md text-on-surface leading-tight">${escapeHtml(a.name)}</h3>
            <div class="flex items-center gap-1.5 mt-1">
              <div class="w-2 h-2 rounded-full ${paused ? 'bg-outline' : 'bg-secondary'}"></div>
              <span class="text-label-bold font-label-bold ${paused ? 'text-outline' : 'text-secondary'} uppercase tracking-wider">${paused ? 'Inactivo (Pausa)' : 'Activo en Rotación'}</span>
            </div>
          </div>
        </div>
        <p class="text-body-sm font-body-sm text-on-surface-variant -mt-2">${escapeHtml(a.role || '')}</p>
        <div class="grid grid-cols-2 gap-2 mt-2">
          <div class="${paused ? 'bg-surface border-surface-variant' : 'bg-surface-container-low border-surface-container-high'} p-3 rounded-lg border">
            <span class="text-body-sm font-body-sm ${paused ? 'text-outline' : 'text-on-surface-variant'} block mb-1">Cierre de Ventas</span>
            <span class="text-headline-md font-headline-md ${paused ? 'text-on-surface-variant' : 'text-on-surface'}">${a.close_rate}%</span>
          </div>
          <div class="${slaLow ? 'bg-error-container border-tertiary-fixed-dim' : paused ? 'bg-surface border-surface-variant' : 'bg-surface-container-low border-surface-container-high'} p-3 rounded-lg border">
            <span class="text-body-sm font-body-sm ${slaLow ? 'text-on-error-container' : paused ? 'text-outline' : 'text-on-surface-variant'} block mb-1">SLA Cumplimiento</span>
            <span class="text-headline-md font-headline-md ${slaLow ? 'text-error' : paused ? 'text-on-surface-variant' : 'text-secondary'}">${a.sla_rate}%</span>
          </div>
        </div>
        <div class="mt-auto pt-4 border-t border-surface-variant flex justify-between items-center">
          <span class="text-body-sm font-body-sm ${paused ? 'text-outline' : 'text-on-surface-variant'} flex items-center gap-1">
            <span class="material-symbols-outlined text-[16px]">call</span> ${a.calls_today} hoy
          </span>
          <button data-action="${paused ? 'resume' : 'pause'}" data-id="${a.id}" class="text-label-bold font-label-bold text-primary hover:text-on-primary-fixed-variant transition-colors">
            ${paused ? 'Reactivar' : 'Pausar'}
          </button>
        </div>
      </div>
    `;
  }

  async function load() {
    let advisors;
    try {
      advisors = (await ctx.api.get('/api/advisors')).filter((a) => !a.is_group);
    } catch {
      ctx.toast('No se pudo cargar el equipo', 'error');
      return;
    }
    grid.innerHTML = advisors.length
      ? advisors.map(cardHtml).join('')
      : `<p class="col-span-full text-center text-body-sm text-on-surface-variant py-10">Aún no hay asesores registrados.</p>`;
  }

  grid.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    try {
      await ctx.api.post(`/api/advisors/${btn.dataset.id}/${btn.dataset.action}`);
      load();
    } catch (err) {
      ctx.toast(err.message, 'error');
    }
  });

  container.querySelector('#add-advisor-btn').addEventListener('click', () => {
    openModal({
      title: 'Añadir asesor',
      render: (body, { close }) => {
        body.innerHTML = `
          <label class="block text-label-bold font-label-bold uppercase tracking-wide text-on-surface-variant mb-1">Nombre *</label>
          <input id="new-name" type="text" class="w-full p-2.5 border border-outline-variant rounded-md mb-4 outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" />
          <label class="block text-label-bold font-label-bold uppercase tracking-wide text-on-surface-variant mb-1">Rol</label>
          <input id="new-role" type="text" placeholder="Asesor Comercial" class="w-full p-2.5 border border-outline-variant rounded-md mb-4 outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" />
          <div class="flex justify-end gap-2">
            <button id="new-cancel" class="px-4 py-2 rounded-lg border border-outline-variant hover:bg-surface-container-low">Cancelar</button>
            <button id="new-ok" class="px-4 py-2 rounded-lg bg-primary text-on-primary font-bold hover:bg-on-primary-fixed-variant">Añadir</button>
          </div>
        `;
        body.querySelector('#new-cancel').addEventListener('click', close);
        body.querySelector('#new-ok').addEventListener('click', async () => {
          const name = body.querySelector('#new-name').value.trim();
          const role = body.querySelector('#new-role').value.trim();
          if (!name) {
            ctx.toast('El nombre es obligatorio', 'error');
            return;
          }
          try {
            await ctx.api.post('/api/advisors', { name, role });
            ctx.toast('Asesor añadido');
            close();
            load();
          } catch (err) {
            ctx.toast(err.message, 'error');
          }
        });
      },
    });
  });

  const off = ctx.ws.on('advisors_changed', load);
  const offLeads = ctx.ws.on('leads_changed', load);
  await load();

  return () => {
    off();
    offLeads();
  };
}
