import { confirmFactoryReset } from '../components/leadActions.js';
import { openModal } from '../components/modal.js';
import { escapeHtml } from '../utils.js';

const ROLES = [
  { value: 'admin', label: 'Dueño / Admin' },
  { value: 'coordinador', label: 'Coordinador' },
  { value: 'asesor', label: 'Asesor' },
];
const ROLE_LABELS = Object.fromEntries(ROLES.map((r) => [r.value, r.label]));

function download(url) {
  const a = document.createElement('a');
  a.href = url;
  a.click();
}

function toggleHtml(id, checked, title, desc) {
  return `
    <div class="flex items-center justify-between p-4 bg-surface-container rounded-lg border border-outline-variant">
      <div class="pr-4">
        <h4 class="text-body-md font-body-md font-semibold text-on-surface">${title}</h4>
        <p class="text-body-sm font-body-sm text-on-surface-variant">${desc}</p>
      </div>
      <label class="relative inline-flex items-center cursor-pointer shrink-0">
        <input id="${id}" type="checkbox" class="sr-only peer" ${checked ? 'checked' : ''} />
        <div class="w-11 h-6 bg-outline-variant peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
      </label>
    </div>
  `;
}

export async function mount(container, ctx) {
  container.innerHTML = `
    <div class="max-w-4xl mx-auto">
      <header class="mb-8">
        <h2 class="text-headline-lg font-headline-lg text-on-surface mb-2">Configuración y Exportación</h2>
        <p class="text-body-md font-body-md text-on-surface-variant">Administra las exportaciones de datos y opciones críticas del sistema CRM.</p>
      </header>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-gutter">
        <section class="bg-surface-container-lowest border border-outline-variant rounded-xl p-gutter shadow-sm col-span-1">
          <div class="flex items-center gap-3 mb-6 border-b border-outline-variant pb-3">
            <span class="material-symbols-outlined text-primary text-2xl">download</span>
            <h3 class="text-headline-md font-headline-md text-on-surface">Exportar Datos</h3>
          </div>
          <div class="space-y-6">
            <div class="flex items-start justify-between group">
              <div class="flex-1 pr-4">
                <h4 class="text-body-md font-body-md font-semibold text-on-surface mb-1">Exportar a Excel</h4>
                <p class="text-body-sm font-body-sm text-on-surface-variant">Descarga leads, ventas, asesores y SLA en formato .xlsx.</p>
              </div>
              <button id="export-xlsx" class="flex-shrink-0 bg-surface-container hover:bg-surface-container-high text-primary px-4 py-2 rounded-lg text-label-bold font-label-bold border border-outline-variant transition-colors flex items-center gap-2">
                <span class="material-symbols-outlined text-sm">table_view</span> XLSX
              </button>
            </div>
            <div class="flex items-start justify-between group">
              <div class="flex-1 pr-4">
                <h4 class="text-body-md font-body-md font-semibold text-on-surface mb-1">Backup de Sistema (JSON)</h4>
                <p class="text-body-sm font-body-sm text-on-surface-variant">Genera un volcado completo de la base de datos actual en formato JSON.</p>
              </div>
              <button id="export-json" class="flex-shrink-0 bg-surface-container hover:bg-surface-container-high text-primary px-4 py-2 rounded-lg text-label-bold font-label-bold border border-outline-variant transition-colors flex items-center gap-2">
                <span class="material-symbols-outlined text-sm">data_object</span> JSON
              </button>
            </div>
            <p id="last-backup-label" class="text-body-sm font-body-sm text-on-surface-variant"></p>
          </div>
        </section>

        <section class="bg-error-container/10 border border-error/20 rounded-xl p-gutter col-span-1 flex flex-col justify-between">
          <div>
            <div class="flex items-center gap-3 mb-6 border-b border-error/20 pb-3">
              <span class="material-symbols-outlined text-error text-2xl">warning</span>
              <h3 class="text-headline-md font-headline-md text-error">Zona Peligrosa</h3>
            </div>
            <h4 class="text-body-md font-body-md font-semibold text-on-surface mb-2">Restaurar de Fábrica</h4>
            <p class="text-body-sm font-body-sm text-on-surface-variant">Esta acción eliminará <strong class="text-error">todos</strong> los datos de ventas, historiales de SLA, configuraciones de asesores y métricas. El sistema volverá a su estado inicial. Esta acción no se puede deshacer.</p>
          </div>
          <button id="factory-reset-btn" class="mt-6 w-full bg-error text-on-error hover:bg-error/90 px-4 py-3 rounded-lg text-label-bold font-label-bold transition-colors flex items-center justify-center gap-2">
            <span class="material-symbols-outlined text-sm">delete_forever</span> RESTAURAR SISTEMA
          </button>
        </section>

        <section class="bg-surface-container-lowest border border-outline-variant rounded-xl p-gutter shadow-sm col-span-1 md:col-span-2 mt-4">
          <div class="flex items-center gap-3 mb-6 border-b border-outline-variant pb-3">
            <span class="material-symbols-outlined text-on-surface-variant text-2xl">tune</span>
            <h3 class="text-headline-md font-headline-md text-on-surface">Ajustes Generales</h3>
          </div>
          <div id="toggles" class="grid grid-cols-1 md:grid-cols-2 gap-6"></div>
        </section>

        <section class="bg-surface-container-lowest border border-outline-variant rounded-xl p-gutter shadow-sm col-span-1 md:col-span-2 mt-4">
          <div class="flex items-center justify-between gap-3 mb-6 border-b border-outline-variant pb-3">
            <div class="flex items-center gap-3">
              <span class="material-symbols-outlined text-on-surface-variant text-2xl">manage_accounts</span>
              <h3 class="text-headline-md font-headline-md text-on-surface">Usuarios y Roles</h3>
            </div>
            <button id="add-user-btn" class="px-4 py-2 bg-primary text-on-primary text-label-bold font-label-bold rounded-lg hover:bg-on-primary-fixed-variant transition-colors flex items-center gap-2 shadow-sm">
              <span class="material-symbols-outlined text-[18px]">person_add</span> Nuevo usuario
            </button>
          </div>
          <div class="overflow-x-auto">
            <table class="w-full text-left border-collapse min-w-[640px]">
              <thead>
                <tr class="bg-surface-container-low border-b border-outline-variant">
                  <th class="p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase tracking-wider">Usuario</th>
                  <th class="p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase tracking-wider">Rol</th>
                  <th class="p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase tracking-wider">Asesor vinculado</th>
                  <th class="p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase tracking-wider">Estado</th>
                  <th class="p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase tracking-wider text-right">Acciones</th>
                </tr>
              </thead>
              <tbody id="users-tbody" class="divide-y divide-outline-variant"></tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  `;

  container.querySelector('#export-xlsx').addEventListener('click', () => download('/api/export/xlsx'));
  container.querySelector('#export-json').addEventListener('click', () => download('/api/export/json'));

  container.querySelector('#factory-reset-btn').addEventListener('click', async () => {
    const ok = await confirmFactoryReset(ctx);
    if (!ok) return;
    try {
      await ctx.api.post('/api/system/factory-reset', { confirm: 'RESTAURAR' });
      ctx.toast('Sistema restaurado a valores de fábrica', 'success');
    } catch (err) {
      ctx.toast(err.message, 'error');
    }
  });

  const togglesEl = container.querySelector('#toggles');
  const lastBackupLabel = container.querySelector('#last-backup-label');

  async function load() {
    let settings;
    try {
      settings = await ctx.api.get('/api/settings');
    } catch {
      ctx.toast('No se pudo cargar la configuración', 'error');
      return;
    }
    togglesEl.innerHTML = toggleHtml(
      'toggle-backup',
      settings.auto_backup_weekly === 'true',
      'Auto-Backup Semanal',
      'Generar backup JSON automáticamente cada domingo.'
    );

    lastBackupLabel.textContent = settings.last_backup_at
      ? `Último backup automático: ${settings.last_backup_at.replace('T', ' ').slice(0, 16)} UTC`
      : 'Aún no se ha generado un backup automático.';

    togglesEl.querySelector('#toggle-backup').addEventListener('change', (e) => {
      ctx.api.put('/api/settings', { auto_backup_weekly: e.target.checked }).catch((err) => ctx.toast(err.message, 'error'));
    });
  }

  // --- Usuarios y Roles -----------------------------------------------
  const usersTbody = container.querySelector('#users-tbody');
  let advisorsCache = [];

  function userRowHtml(u) {
    const roleOptions = ROLES.map(
      (r) => `<option value="${r.value}" ${r.value === u.role ? 'selected' : ''}>${r.label}</option>`
    ).join('');
    const advisorOptions =
      '<option value="">— Sin vincular —</option>' +
      advisorsCache.map((a) => `<option value="${a.id}" ${a.id === u.advisor_id ? 'selected' : ''}>${escapeHtml(a.name)}</option>`).join('');
    return `
      <tr>
        <td class="p-table-cell-padding font-semibold text-on-surface">${escapeHtml(u.username)}</td>
        <td class="p-table-cell-padding">
          <select data-user="${u.id}" class="user-role-select p-1.5 bg-surface-container-lowest border border-outline-variant rounded-md text-body-sm outline-none focus:border-primary">
            ${roleOptions}
          </select>
        </td>
        <td class="p-table-cell-padding">
          <select data-user="${u.id}" class="user-advisor-select p-1.5 bg-surface-container-lowest border border-outline-variant rounded-md text-body-sm outline-none focus:border-primary">
            ${advisorOptions}
          </select>
        </td>
        <td class="p-table-cell-padding">
          <span class="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold ${u.active ? 'bg-secondary-container text-on-secondary-container' : 'bg-surface-container-high text-on-surface-variant'}">
            ${u.active ? 'Activo' : 'Desactivado'}
          </span>
        </td>
        <td class="p-table-cell-padding text-right">
          <div class="flex justify-end flex-wrap gap-2">
            <button data-action="reset" data-id="${u.id}" data-username="${escapeHtml(u.username)}" class="px-3 py-1 border border-outline-variant rounded text-body-sm font-label-bold text-on-surface-variant hover:bg-surface-container-low transition-colors">Restablecer clave</button>
            <button data-action="toggle" data-id="${u.id}" data-active="${u.active ? '1' : '0'}" class="px-3 py-1 border border-outline-variant rounded text-body-sm font-label-bold ${u.active ? 'text-error hover:bg-error-container/20' : 'text-secondary hover:bg-secondary-container/20'} transition-colors">${u.active ? 'Desactivar' : 'Reactivar'}</button>
          </div>
        </td>
      </tr>
    `;
  }

  async function loadUsers() {
    try {
      const [users, advisors] = await Promise.all([ctx.api.get('/api/users'), ctx.api.get('/api/advisors')]);
      advisorsCache = advisors.filter((a) => !a.is_group);
      usersTbody.innerHTML = users.length
        ? users.map(userRowHtml).join('')
        : `<tr><td colspan="5" class="p-table-cell-padding py-6 text-center text-body-sm text-on-surface-variant">Sin usuarios registrados.</td></tr>`;
    } catch (err) {
      ctx.toast(err.message || 'No se pudo cargar la lista de usuarios', 'error');
    }
  }

  usersTbody.addEventListener('change', async (e) => {
    const roleSelect = e.target.closest('.user-role-select');
    const advisorSelect = e.target.closest('.user-advisor-select');
    if (roleSelect) {
      try {
        await ctx.api.patch(`/api/users/${roleSelect.dataset.user}`, { role: roleSelect.value });
        ctx.toast('Rol actualizado', 'success');
        loadUsers();
      } catch (err) {
        ctx.toast(err.message, 'error');
        loadUsers();
      }
    }
    if (advisorSelect) {
      try {
        await ctx.api.patch(`/api/users/${advisorSelect.dataset.user}`, { advisor_id: advisorSelect.value || null });
        ctx.toast('Asesor vinculado actualizado', 'success');
      } catch (err) {
        ctx.toast(err.message, 'error');
        loadUsers();
      }
    }
  });

  usersTbody.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    if (btn.dataset.action === 'toggle') {
      const active = btn.dataset.active === '1';
      try {
        await ctx.api.patch(`/api/users/${btn.dataset.id}`, { active: !active });
        ctx.toast(active ? 'Usuario desactivado' : 'Usuario reactivado', 'success');
        loadUsers();
      } catch (err) {
        ctx.toast(err.message, 'error');
      }
    }
    if (btn.dataset.action === 'reset') {
      openModal({
        title: `Restablecer clave · ${btn.dataset.username}`,
        render: (body, { close }) => {
          body.innerHTML = `
            <label class="block text-label-bold font-label-bold uppercase tracking-wide text-on-surface-variant mb-1">Nueva contraseña</label>
            <input id="reset-password" type="password" minlength="4" class="w-full p-2.5 border border-outline-variant rounded-md mb-4 outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" />
            <div class="flex justify-end gap-2">
              <button id="reset-cancel" class="px-4 py-2 rounded-lg border border-outline-variant hover:bg-surface-container-low">Cancelar</button>
              <button id="reset-ok" class="px-4 py-2 rounded-lg bg-primary text-on-primary font-bold hover:bg-on-primary-fixed-variant">Guardar</button>
            </div>
          `;
          body.querySelector('#reset-cancel').addEventListener('click', close);
          body.querySelector('#reset-ok').addEventListener('click', async () => {
            const password = body.querySelector('#reset-password').value;
            if (!password || password.length < 4) {
              ctx.toast('La contraseña debe tener al menos 4 caracteres', 'error');
              return;
            }
            try {
              await ctx.api.post(`/api/users/${btn.dataset.id}/reset-password`, { password });
              ctx.toast('Contraseña actualizada', 'success');
              close();
            } catch (err) {
              ctx.toast(err.message, 'error');
            }
          });
        },
      });
    }
  });

  container.querySelector('#add-user-btn').addEventListener('click', () => {
    openModal({
      title: 'Nuevo usuario',
      render: (body, { close }) => {
        body.innerHTML = `
          <label class="block text-label-bold font-label-bold uppercase tracking-wide text-on-surface-variant mb-1">Usuario *</label>
          <input id="new-username" type="text" class="w-full p-2.5 border border-outline-variant rounded-md mb-4 outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" />
          <label class="block text-label-bold font-label-bold uppercase tracking-wide text-on-surface-variant mb-1">Contraseña *</label>
          <input id="new-password" type="password" minlength="4" class="w-full p-2.5 border border-outline-variant rounded-md mb-4 outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" />
          <label class="block text-label-bold font-label-bold uppercase tracking-wide text-on-surface-variant mb-1">Rol *</label>
          <select id="new-role" class="w-full p-2.5 border border-outline-variant rounded-md mb-4 outline-none focus:border-primary focus:ring-2 focus:ring-primary/20">
            ${ROLES.map((r) => `<option value="${r.value}">${r.label}</option>`).join('')}
          </select>
          <label class="block text-label-bold font-label-bold uppercase tracking-wide text-on-surface-variant mb-1">Asesor vinculado (opcional)</label>
          <select id="new-advisor" class="w-full p-2.5 border border-outline-variant rounded-md mb-4 outline-none focus:border-primary focus:ring-2 focus:ring-primary/20">
            <option value="">— Sin vincular —</option>
            ${advisorsCache.map((a) => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join('')}
          </select>
          <div class="flex justify-end gap-2">
            <button id="new-cancel" class="px-4 py-2 rounded-lg border border-outline-variant hover:bg-surface-container-low">Cancelar</button>
            <button id="new-ok" class="px-4 py-2 rounded-lg bg-primary text-on-primary font-bold hover:bg-on-primary-fixed-variant">Crear</button>
          </div>
        `;
        body.querySelector('#new-cancel').addEventListener('click', close);
        body.querySelector('#new-ok').addEventListener('click', async () => {
          const username = body.querySelector('#new-username').value.trim();
          const password = body.querySelector('#new-password').value;
          const role = body.querySelector('#new-role').value;
          const advisor_id = body.querySelector('#new-advisor').value || null;
          if (!username || !password) {
            ctx.toast('Usuario y contraseña son obligatorios', 'error');
            return;
          }
          try {
            await ctx.api.post('/api/users', { username, password, role, advisor_id });
            ctx.toast('Usuario creado', 'success');
            close();
            loadUsers();
          } catch (err) {
            ctx.toast(err.message, 'error');
          }
        });
      },
    });
  });

  await Promise.all([load(), loadUsers()]);
}
