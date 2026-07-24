import { confirmFactoryReset } from '../components/leadActions.js';

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

  await load();
}
