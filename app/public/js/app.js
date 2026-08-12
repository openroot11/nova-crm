import { api } from './api.js';
import { ws } from './ws.js';
import { escapeHtml, slaBadge } from './utils.js';
import { getCurrentUser, logout } from './auth.js';

const user = getCurrentUser();

// Rutas visibles por rol. Un asesor solo necesita operar su propio dia a
// dia (Ventas/SLA); coordinador suma reportes y equipo; admin ve todo,
// incluyendo Ajustes (que ademas el backend ya protege con requireRole).
const ROUTES_BY_ROLE = {
  admin: ['dashboard', 'ventas', 'sla', 'seguimiento', 'clientes', 'informe', 'ventas-cerradas', 'estadisticas', 'ia', 'asesores', 'ajustes'],
  coordinador: ['dashboard', 'ventas', 'sla', 'seguimiento', 'clientes', 'informe', 'ventas-cerradas', 'estadisticas', 'ia', 'asesores'],
  asesor: ['ventas', 'sla', 'seguimiento', 'clientes'],
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

const routes = {
  dashboard: () => import('./views/dashboard.js'),
  ventas: () => import('./views/ventas.js'),
  sla: () => import('./views/sla.js'),
  seguimiento: () => import('./views/seguimiento.js'),
  clientes: () => import('./views/clientes.js'),
  informe: () => import('./views/informe.js'),
  'ventas-cerradas': () => import('./views/ventasCerradas.js'),
  estadisticas: () => import('./views/estadisticas.js'),
  ia: () => import('./views/ia.js'),
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
  ia: 'Predicción IA',
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

// Barra de busqueda global del topbar: vive fuera de las vistas, asi que se
// expone como un mini pub-sub via ctx.search para que la vista activa (hoy
// solo Ventas) pueda suscribirse a lo que se escribe ahi.
const searchBus = (() => {
  let value = '';
  const listeners = new Set();
  return {
    get value() {
      return value;
    },
    set(v) {
      value = v;
      listeners.forEach((fn) => fn(value));
    },
    subscribe(fn) {
      listeners.add(fn);
      fn(value);
      return () => listeners.delete(fn);
    },
  };
})();

const ctx = {
  api,
  ws,
  toast,
  user,
  search: searchBus,
  navigate: (route) => {
    location.hash = `#/${route}`;
  },
};

const globalSearchInput = document.getElementById('global-search');
let searchDebounceId;
globalSearchInput.addEventListener('input', () => {
  clearTimeout(searchDebounceId);
  searchDebounceId = setTimeout(() => searchBus.set(globalSearchInput.value.trim()), 300);
});

let currentUnmount = null;

async function render() {
  const hash = location.hash.replace('#/', '') || DEFAULT_ROUTE;
  const route = routes[hash] && allowedRoutes.includes(hash) ? hash : DEFAULT_ROUTE;

  document.querySelectorAll('.nav-link').forEach((el) => {
    const active = el.dataset.route === route;
    el.classList.toggle('bg-surface-container-high', active);
    el.classList.toggle('text-primary', active);
    el.classList.toggle('font-bold', active);
    el.classList.toggle('text-on-surface-variant', !active);
    el.classList.toggle('border-r-4', active);
    el.classList.toggle('border-primary', active);
  });

  // Grupos colapsables del sidebar (hoy solo "Ventas"): se abren solos y
  // resaltan el encabezado cuando la ruta activa es una de sus hijas, sin
  // forzar el cierre si el usuario los abrio manualmente en otra ruta.
  document.querySelectorAll('details[data-group]').forEach((details) => {
    const childActive = [...details.querySelectorAll('.nav-link')].some((el) => el.dataset.route === route);
    if (childActive) details.open = true;
    const summary = details.querySelector('summary');
    summary.classList.toggle('text-primary', childActive);
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

  // La busqueda global es contextual a la vista donde se abrio: al cambiar
  // de pestaña se limpia, para no dejar un filtro "fantasma" aplicado a una
  // vista que ya no la esta escuchando.
  globalSearchInput.value = '';
  searchBus.set('');

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

// Campana de notificaciones: lista los leads en riesgo/vencidos de SLA (los
// mismos datos que alimentan el badge de arriba, pero con detalle util para
// actuar directo desde el dropdown en vez de solo un contador).
const notifBtn = document.getElementById('notif-btn');
const notifBadge = document.getElementById('notif-badge');
const notifPanel = document.getElementById('notif-panel');
let notifLeads = [];
let notifOpen = false;

function renderNotifPanel() {
  if (notifLeads.length === 0) {
    notifPanel.innerHTML = '<div class="p-4 text-body-sm font-body-sm text-on-surface-variant text-center">Sin alertas pendientes.</div>';
    return;
  }
  notifPanel.innerHTML = notifLeads
    .slice(0, 8)
    .map((l) => {
      const b = slaBadge(l.sla_status);
      return `
        <button data-id="${l.id}" class="notif-item w-full text-left px-4 py-3 hover:bg-surface-container-low border-b border-outline-variant last:border-0 transition-colors">
          <div class="flex items-center justify-between gap-2">
            <span class="text-body-sm font-semibold text-on-surface truncate">${escapeHtml(l.client_name)}</span>
            <span class="text-[10px] font-bold px-1.5 py-0.5 rounded ${b.badgeClass}">${b.label}</span>
          </div>
          <div class="text-body-sm text-on-surface-variant truncate">${escapeHtml(l.advisor_name || 'Sin asignar')} · ${escapeHtml(l.remaining_label || l.elapsed_label || '')}</div>
        </button>
      `;
    })
    .join('');
}

async function refreshNotifications() {
  try {
    notifLeads = await api.get('/api/leads?critical_only=1');
  } catch {
    notifLeads = [];
  }
  notifBadge.classList.toggle('hidden', notifLeads.length === 0);
  notifBadge.textContent = notifLeads.length;
  renderNotifPanel();
}

function setNotifOpen(open) {
  notifOpen = open;
  notifPanel.classList.toggle('hidden', !open);
}

notifBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  setNotifOpen(!notifOpen);
});
notifPanel.addEventListener('click', (e) => {
  const btn = e.target.closest('.notif-item');
  if (!btn) return;
  setNotifOpen(false);
  ctx.navigate('sla');
});
document.addEventListener('click', (e) => {
  if (notifOpen && !notifPanel.contains(e.target) && !notifBtn.contains(e.target)) setNotifOpen(false);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && notifOpen) setNotifOpen(false);
});
ws.on('leads_changed', refreshNotifications);
refreshNotifications();
setInterval(refreshNotifications, 60000);
