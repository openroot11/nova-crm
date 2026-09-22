import { escapeHtml, slaBadge } from '../utils.js';

// Campana de notificaciones: lista los leads en riesgo/vencidos de SLA, con
// detalle util para actuar directo desde el dropdown en vez de solo un
// contador. Antes vivia fija en el topbar global (todas las vistas); ahora
// se monta donde la pida cada vista (hoy solo Ventas, ver ventas.js) para
// no ensuciar el encabezado de pantallas que no la usan.
//
// Devuelve una funcion de limpieza -- quien la monte debe llamarla al
// desmontarse, para no dejar el listener de click/keydown del documento ni
// el intervalo de refresco corriendo de fondo despues de salir de la vista.
export function mountNotifBell(container, ctx) {
  container.innerHTML = `
    <div class="relative">
      <button id="notif-btn" class="p-2 text-on-surface-variant hover:text-on-surface transition-colors relative" title="Notificaciones">
        <span class="material-symbols-outlined">notifications</span>
        <span id="notif-badge" class="hidden absolute -top-0.5 -right-0.5 bg-error text-on-error text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center">0</span>
      </button>
      <div id="notif-panel" class="hidden absolute right-0 mt-2 w-80 bg-surface border border-outline-variant rounded-lg shadow-xl z-50 max-h-96 overflow-y-auto"></div>
    </div>
  `;

  const notifBtn = container.querySelector('#notif-btn');
  const notifBadge = container.querySelector('#notif-badge');
  const notifPanel = container.querySelector('#notif-panel');
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
      notifLeads = await ctx.api.get('/api/leads?critical_only=1');
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

  function onDocClick(e) {
    if (notifOpen && !notifPanel.contains(e.target) && !notifBtn.contains(e.target)) setNotifOpen(false);
  }
  function onKeydown(e) {
    if (e.key === 'Escape' && notifOpen) setNotifOpen(false);
  }

  notifBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    setNotifOpen(!notifOpen);
  });
  notifPanel.addEventListener('click', (e) => {
    const btn = e.target.closest('.notif-item');
    if (!btn) return;
    setNotifOpen(false);
    ctx.navigate('ventas');
  });
  document.addEventListener('click', onDocClick);
  document.addEventListener('keydown', onKeydown);

  const offWs = ctx.ws.on('leads_changed', refreshNotifications);
  refreshNotifications();
  const intervalId = setInterval(refreshNotifications, 60000);

  return () => {
    document.removeEventListener('click', onDocClick);
    document.removeEventListener('keydown', onKeydown);
    offWs();
    clearInterval(intervalId);
  };
}
