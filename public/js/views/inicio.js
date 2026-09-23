import { escapeHtml } from '../utils.js';
import { visibleApps } from '../apps.js';

// Inicio: las aplicaciones de Velara como íconos (igual que el inicio de
// Odoo). Cada rol ve solo las aplicaciones con pantallas permitidas.

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches';
}

export async function mount(container, ctx) {
  const apps = visibleApps(ctx.allowedRoutes);
  container.innerHTML = `
    <div class="max-w-5xl mx-auto py-6">
      <div class="mb-8">
        <h2 class="text-headline-lg font-headline-lg text-on-surface">${greeting()}, ${escapeHtml(ctx.user?.username || '')}</h2>
        <p class="text-body-md font-body-md text-on-surface-variant mt-1">¿Qué vas a hacer hoy?</p>
      </div>
      <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
        ${apps
          .map(
            (a) => `
          <a href="#/${a.firstRoute}" class="group bg-surface-container-lowest border border-outline-variant rounded-2xl p-5 flex flex-col items-center text-center gap-3 shadow-sm hover:shadow-md hover:border-outline transition-all">
            <span class="w-16 h-16 rounded-2xl flex items-center justify-center transition-transform group-hover:scale-105" style="background:${a.color}1f;color:${a.color}">
              <span class="material-symbols-outlined text-[36px]">${a.icon}</span>
            </span>
            <span>
              <span class="block text-body-md font-bold text-on-surface">${escapeHtml(a.label)}</span>
              <span class="block text-[12px] text-on-surface-variant mt-0.5">${escapeHtml(a.desc)}</span>
            </span>
          </a>`
          )
          .join('')}
      </div>
    </div>
  `;
}
