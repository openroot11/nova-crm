import { api } from './api.js';
import { ws } from './ws.js';
import { escapeHtml } from './utils.js';
import { getCurrentUser, logout } from './auth.js';

const user = getCurrentUser();

// Rutas visibles por rol. Un asesor solo necesita operar su propio dia a
// dia (Ventas/SLA); coordinador suma reportes y equipo; admin ve todo,
// incluyendo Ajustes (que ademas el backend ya protege con requireRole).
const ROUTES_BY_ROLE = {
  admin: ['dashboard', 'ventas', 'sla', 'seguimiento', 'clientes', 'informe', 'ventas-cerradas', 'estadisticas', 'asesores', 'ajustes'],
  coordinador: ['dashboard', 'ventas', 'sla', 'seguimiento', 'clientes', 'informe', 'ventas-cerradas', 'estadisticas', 'asesores'],
  // Seguimiento (cotizaciones sin respuesta del cliente) es seguimiento de
  // EQUIPO, no del dia a dia de un asesor sobre lo suyo -- se le quito del
  // menu para no duplicar la misma alerta que ya ve en Ventas/SLA.
  asesor: ['ventas', 'sla', 'clientes'],
};
const allowedRoutes = ROUTES_BY_ROLE[user?.role] || ROUTES_BY_ROLE.asesor;
// El Dashboard resume datos de todo el equipo (los mismos endpoints de
// Estadisticas, solo accesibles para admin/coordinador), asi que solo esos
// roles aterrizan ahi; un asesor sigue entrando directo a Ventas, su
// pantalla operativa de siempre.
const DEFAULT_ROUTE = allowedRoutes.includes('dashboard') ? 'dashboard' : 'ventas';

document.querySelectorAll('.nav-link').forEach((el) => {
  if (!allowedRoutes.includes(el.dataset.route)) el.closest('li').classList.add('hidden');
});

const ROLE_LABELS = { admin: 'Dueño / Admin', coordinador: 'Coordinador', asesor: 'Asesor' };
const sidebarFoot = document.querySelector('#sidebar > div:last-child');
if (sidebarFoot && user) {
  sidebarFoot.innerHTML = `
    <div class="w-10 h-10 rounded-full bg-surface-container-highest flex items-center justify-center font-bold text-on-surface-variant shrink-0">${escapeHtml((user.username || '?').slice(0, 1).toUpperCase())}</div>
    <div class="min-w-0 flex-1">
      <p class="text-label-bold font-label-bold truncate">${escapeHtml(user.username)}</p>
      <p class="text-body-sm font-body-sm text-on-surface-variant truncate">${escapeHtml(ROLE_LABELS[user.role] || user.role)}</p>
    </div>
    <button id="logout-btn" class="p-2 text-on-surface-variant hover:text-error transition-colors shrink-0" title="Cerrar sesión">
      <span class="material-symbols-outlined text-[20px]">logout</span>
    </button>
  `;
  sidebarFoot.querySelector('#logout-btn').addEventListener('click', logout);
}

// Menu lateral ocultable: libera espacio horizontal en pantallas chicas o
// cuando simplemente estorba. Se recuerda en localStorage (por navegador,
// no por usuario) para que quede como lo dejaste al recargar o cambiar de
// pestaña.
const SIDEBAR_COLLAPSED_KEY = 'nova_sidebar_collapsed';
const sidebarEl = document.getElementById('sidebar');
const mainColEl = document.getElementById('main-col');
const sidebarToggleBtn = document.getElementById('sidebar-toggle-btn');

function applySidebarCollapsed(collapsed) {
  sidebarEl.classList.toggle('-translate-x-full', collapsed);
  mainColEl.classList.toggle('ml-[240px]', !collapsed);
  mainColEl.classList.toggle('ml-0', collapsed);
}

let sidebarCollapsed = localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1';
applySidebarCollapsed(sidebarCollapsed);
sidebarToggleBtn.addEventListener('click', () => {
  sidebarCollapsed = !sidebarCollapsed;
  localStorage.setItem(SIDEBAR_COLLAPSED_KEY, sidebarCollapsed ? '1' : '0');
  applySidebarCollapsed(sidebarCollapsed);
});

const routes = {
  dashboard: () => import('./views/dashboard.js'),
  ventas: () => import('./views/ventas.js'),
  sla: () => import('./views/sla.js'),
  seguimiento: () => import('./views/seguimiento.js'),
  clientes: () => import('./views/clientes.js'),
  informe: () => import('./views/informe.js'),
  'ventas-cerradas': () => import('./views/ventasCerradas.js'),
  estadisticas: () => import('./views/estadisticas.js'),
  asesores: () => import('./views/asesores.js'),
  ajustes: () => import('./views/ajustes.js'),
};

const titles = {
  dashboard: 'Dashboard',
  ventas: 'Registro Operativo',
  sla: 'Control SLA 24h',
  seguimiento: 'Seguimiento Activo',
  clientes: 'Clientes',
  informe: 'Informe Diario',
  'ventas-cerradas': 'Ventas Cerradas',
  estadisticas: 'Rendimiento Comercial',
  asesores: 'Gestión del Equipo',
  ajustes: 'Configuración y Exportación',
};

const viewRoot = document.getElementById('view-root');
const pageTitle = document.getElementById('page-title');
const toastRoot = document.getElementById('toast-root');

function toast(message, kind = 'info') {
  const kindClasses = {
    info: 'bg-inverse-surface text-inverse-on-surface',
    success: 'bg-secondary text-on-secondary',
    error: 'bg-error text-on-error',
  };
  const el = document.createElement('div');
  el.className = `px-4 py-3 rounded-lg shadow-lg text-sm font-semibold max-w-xs ${kindClasses[kind] || kindClasses.info}`;
  el.textContent = message;
  toastRoot.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

const ctx = {
  api,
  ws,
  toast,
  user,
  navigate: (route, params) => {
    const qs = params ? `?${new URLSearchParams(params).toString()}` : '';
    location.hash = `#/${route}${qs}`;
  },
  routeParams: new URLSearchParams(),
};

let currentUnmount = null;

async function render() {
  const rawHash = location.hash.replace('#/', '') || DEFAULT_ROUTE;
  const [hashRoute, hashQuery = ''] = rawHash.split('?');
  const route = routes[hashRoute] && allowedRoutes.includes(hashRoute) ? hashRoute : DEFAULT_ROUTE;
  ctx.routeParams = new URLSearchParams(route === hashRoute ? hashQuery : '');

  document.querySelectorAll('.nav-link').forEach((el) => {
    const active = el.dataset.route === route;
    el.classList.toggle('bg-surface-container-high', active);
    el.classList.toggle('text-on-surface', active);
    el.classList.toggle('font-bold', active);
    el.classList.toggle('text-on-surface-variant', !active);
    el.classList.toggle('border-r-4', active);
    el.classList.toggle('border-outline', active);
  });

  // Grupos colapsables del sidebar (hoy solo "Ventas"): se abren solos y
  // resaltan el encabezado cuando la ruta activa es una de sus hijas, sin
  // forzar el cierre si el usuario los abrio manualmente en otra ruta.
  document.querySelectorAll('details[data-group]').forEach((details) => {
    const childActive = [...details.querySelectorAll('.nav-link')].some((el) => el.dataset.route === route);
    if (childActive) details.open = true;
    const summary = details.querySelector('summary');
    summary.classList.toggle('text-on-surface', childActive);
    summary.classList.toggle('font-bold', childActive);
  });

  pageTitle.textContent = titles[route];
  document.title = `${titles[route]} · Nova CRM`;

  if (typeof currentUnmount === 'function') {
    try {
      currentUnmount();
    } catch {
      /* la vista ya no existe, se ignora */
    }
    currentUnmount = null;
  }

  viewRoot.innerHTML = '<div class="p-10 text-center text-on-surface-variant">Cargando…</div>';
  try {
    const mod = await routes[route]();
    viewRoot.innerHTML = '';
    currentUnmount = await mod.mount(viewRoot, ctx);
  } catch (err) {
    console.error(err);
    viewRoot.innerHTML = `<div class="p-10 text-center text-error">Error cargando la vista: ${err.message || err}</div>`;
  }
}

window.addEventListener('hashchange', render);
render();

// Indicador de conexion en vivo (WebSocket)
const connDot = document.getElementById('conn-dot');
ws.on('__status', (status) => {
  if (status === 'online') {
    connDot.className = 'w-2 h-2 rounded-full bg-secondary ml-1';
    connDot.title = 'En vivo';
  } else {
    connDot.className = 'w-2 h-2 rounded-full bg-error ml-1';
    connDot.title = 'Reconectando…';
  }
});

// Badge global de leads criticos (SLA > 24h)
const slaBtn = document.getElementById('sla-badge-btn');
const slaCount = document.getElementById('sla-badge-count');
async function refreshSlaBadge() {
  try {
    const kpis = await api.get('/api/kpis');
    slaBtn.classList.toggle('hidden', kpis.critical_leads_count <= 0);
    slaCount.textContent = kpis.critical_leads_count;
  } catch {
    /* si falla, se reintenta en el siguiente ciclo */
  }
}
slaBtn.addEventListener('click', () => ctx.navigate('sla'));
ws.on('leads_changed', refreshSlaBadge);
refreshSlaBadge();
setInterval(refreshSlaBadge, 60000);
