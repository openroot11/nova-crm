import { api } from './api.js';
import { ws } from './ws.js';
import { escapeHtml, slaBadge } from './utils.js';

const routes = {
  ventas: () => import('./views/ventas.js'),
  sla: () => import('./views/sla.js'),
  informe: () => import('./views/informe.js'),
  estadisticas: () => import('./views/estadisticas.js'),
  asesores: () => import('./views/asesores.js'),
  ajustes: () => import('./views/ajustes.js'),
};

const titles = {
  ventas: 'Registro Operativo',
  sla: 'Control SLA 24h',
  informe: 'Informe Diario',
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
  const hash = location.hash.replace('#/', '') || 'ventas';
  const route = routes[hash] ? hash : 'ventas';

  document.querySelectorAll('.nav-link').forEach((el) => {
    const active = el.dataset.route === route;
    el.classList.toggle('bg-surface-container-high', active);
    el.classList.toggle('text-primary', active);
    el.classList.toggle('font-bold', active);
    el.classList.toggle('text-on-surface-variant', !active);
    el.classList.toggle('border-r-4', active);
    el.classList.toggle('border-primary', active);
  });

  pageTitle.textContent = titles[route];
  document.title = `${titles[route]} · SalesForce CRM`;

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
