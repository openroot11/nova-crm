import { escapeHtml } from '../utils.js';
import { statusChip, alertChip, blockChip, progressBar, fmtDay, fmtQty, localToday, kpiTile, PRIORITY, labelCls } from '../components/production.js';

// Tablero de Producción (secciones 17 y 18 de la especificación): 8
// indicadores, filtros rápidos, búsqueda/filtros y Kanban por estado. Una
// OP pausada (bloqueada) se muestra en la columna donde estaba, con su
// bloqueo a la vista.

const COLUMNS = [
  { key: 'por_validar', label: 'Por validar', icon: 'fact_check' },
  { key: 'programada', label: 'Programadas', icon: 'event' },
  { key: 'en_produccion', label: 'En producción', icon: 'precision_manufacturing' },
  { key: 'control', label: 'Control', icon: 'rule' },
  { key: 'lista', label: 'Listas', icon: 'inventory' },
  { key: 'entregada', label: 'Entregadas', icon: 'local_shipping' },
];

// Filtros rápidos (sección 18).
const QUICK = [
  ['hoy', 'Entrega hoy', (o) => (o.committed_date || o.requested_date) === localToday() && open(o)],
  ['manana', 'Entrega mañana', (o) => (o.committed_date || o.requested_date) === localToday(1) && open(o)],
  ['proximas', 'Entregas próximas', (o) => o.alert === 'proxima'],
  ['vencidas', 'Vencidas', (o) => o.alert === 'vencida'],
  ['riesgo', 'En riesgo', (o) => o.alert === 'en_riesgo'],
  ['bloqueadas', 'Bloqueadas', (o) => o.blocked],
  ['sin_responsable', 'Sin responsable', (o) => !o.responsible_worker_id && open(o)],
  ['sin_diseno', 'Sin diseño', (o) => !o.designs && open(o)],
  ['sin_aprobacion', 'Sin aprobación', (o) => o.requires_approval && !o.approvals && open(o)],
  ['material', 'Material pendiente', (o) => o.materials_pending > 0 && open(o)],
];
function open(o) {
  return !['entregada', 'cerrada', 'cancelada'].includes(o.status);
}
// Columna donde va cada OP (la pausada, donde estaba antes del bloqueo).
function columnOf(o) {
  if (o.status === 'pausada') return o.paused_from || 'en_produccion';
  return o.status;
}

export async function mount(container, ctx) {
  let meta = { workers: [], can_manage: false };
  try {
    meta = await ctx.api.get('/api/production/meta');
  } catch {
    /* sin meta: filtros de responsable vacíos */
  }
  let quick = ctx.routeParams.get('filtro') || '';

  container.innerHTML = `
    <div class="flex justify-between items-end mb-margin-desktop flex-wrap gap-3">
      <div>
        <h2 class="text-headline-lg font-headline-lg text-on-surface">Producción</h2>
        <p class="text-body-md font-body-md text-on-surface-variant mt-1">Qué se fabrica, para quién, quién lo hace y para cuándo.</p>
      </div>
      <div class="flex gap-2 flex-wrap">
        <a href="#/programacion" class="btn btn-secondary inline-flex"><span class="material-symbols-outlined">calendar_month</span>Programación</a>
        <a href="#/pedidos" class="btn btn-primary inline-flex"><span class="material-symbols-outlined">add</span>${meta.can_manage ? 'Nuevo pedido / OP' : 'Pedidos'}</a>
      </div>
    </div>

    <div id="pd-kpis" class="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-3 mb-gutter"></div>

    <div class="bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm mb-gutter">
      <div class="p-4 flex flex-wrap gap-3 items-end border-b border-outline-variant">
        <div class="min-w-[220px] flex-1">
          <label class="${labelCls}">Buscar</label>
          <input id="pd-q" type="text" placeholder="OP, pedido, cliente, producto, código, responsable…" class="w-full p-2 bg-surface-container-lowest border border-outline-variant rounded-md text-body-sm outline-none focus:border-outline" />
        </div>
        <div><label class="${labelCls}">Responsable</label>
          <select id="pd-resp" class="p-2 bg-surface-container-lowest border border-outline-variant rounded-md text-body-sm outline-none focus:border-outline">
            <option value="">Todos</option>${meta.workers.map((w) => `<option value="${w.id}">${escapeHtml(w.name)}</option>`).join('')}
          </select>
        </div>
        <div><label class="${labelCls}">Prioridad</label>
          <select id="pd-prio" class="p-2 bg-surface-container-lowest border border-outline-variant rounded-md text-body-sm outline-none focus:border-outline">
            <option value="">Todas</option>${Object.entries(PRIORITY).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('')}
          </select>
        </div>
        <div><label class="${labelCls}">Entrega desde</label><input id="pd-from" type="date" class="p-2 bg-surface-container-lowest border border-outline-variant rounded-md text-body-sm outline-none focus:border-outline" /></div>
        <div><label class="${labelCls}">hasta</label><input id="pd-to" type="date" class="p-2 bg-surface-container-lowest border border-outline-variant rounded-md text-body-sm outline-none focus:border-outline" /></div>
      </div>
      <div id="pd-quick" class="px-4 py-3 flex gap-2 flex-wrap"></div>
    </div>

    <div id="pd-board"></div>
  `;

  const board = container.querySelector('#pd-board');
  const q = container.querySelector('#pd-q');
  const resp = container.querySelector('#pd-resp');
  const prio = container.querySelector('#pd-prio');
  const from = container.querySelector('#pd-from');
  const to = container.querySelector('#pd-to');
  let ops = [];

  function filtered() {
    const terms = q.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const qf = QUICK.find(([k]) => k === quick);
    return ops.filter((o) => {
      if (resp.value && String(o.responsible_worker_id) !== resp.value) return false;
      if (prio.value && o.priority !== prio.value) return false;
      const due = o.committed_date || o.requested_date || '';
      if (from.value && (!due || due < from.value)) return false;
      if (to.value && (!due || due > to.value)) return false;
      if (qf && !qf[2](o)) return false;
      if (!terms.length) return true;
      const hay = `${o.number} ${o.sales_order_number} ${o.client_name} ${o.product_name} ${o.product_code || ''} ${o.responsible_name || ''}`.toLowerCase();
      return terms.every((t) => hay.includes(t));
    });
  }

  function renderKpis() {
    const count = (fn) => ops.filter(fn).length;
    const risk = count((o) => o.alert === 'en_riesgo' || o.alert === 'vencida');
    const blocked = count((o) => o.blocked);
    container.querySelector('#pd-kpis').innerHTML = [
      kpiTile('Por validar', count((o) => o.status === 'por_validar')),
      kpiTile('Programadas', count((o) => o.status === 'programada')),
      kpiTile('En producción', count((o) => o.status === 'en_produccion')),
      kpiTile('En control', count((o) => o.status === 'control')),
      kpiTile('Listas para entregar', count((o) => o.status === 'lista')),
      kpiTile('Entregadas', count((o) => o.status === 'entregada')),
      kpiTile('En riesgo', risk, { hint: `${count((o) => o.alert === 'vencida')} vencidas`, tone: risk ? 'warn' : '', filter: 'riesgo' }),
      kpiTile('Bloqueadas', blocked, { tone: blocked ? 'bad' : '', filter: 'bloqueadas' }),
    ].join('');
    container.querySelectorAll('[data-kpi]').forEach((b) =>
      b.addEventListener('click', () => {
        quick = quick === b.dataset.kpi ? '' : b.dataset.kpi;
        renderQuick();
        renderBoard();
      })
    );
  }

  function renderQuick() {
    const el = container.querySelector('#pd-quick');
    el.innerHTML = QUICK.map(([k, label, fn]) => {
      const n = ops.filter(fn).length;
      const on = quick === k;
      return `<button data-q="${k}" class="px-3 py-1 rounded-full border text-[12px] ${on ? 'border-outline bg-surface-container-high text-on-surface font-bold' : 'border-outline-variant text-on-surface-variant hover:bg-surface-container-low'}">${label} <span class="${n ? '' : 'opacity-50'}">${n}</span></button>`;
    }).join('') + (quick ? '<button data-q="" class="px-3 py-1 text-[12px] text-on-surface-variant underline">Quitar filtro</button>' : '');
    el.querySelectorAll('[data-q]').forEach((b) =>
      b.addEventListener('click', () => {
        quick = quick === b.dataset.q ? '' : b.dataset.q;
        renderQuick();
        renderBoard();
      })
    );
  }

  function card(o) {
    const p = PRIORITY[o.priority];
    return `
      <a href="#/op?id=${o.id}" class="block bg-surface-container-lowest border ${o.blocked ? 'border-error/50' : 'border-outline-variant'} rounded-lg p-3 shadow-sm space-y-1.5 hover:border-outline transition-colors">
        <div class="flex items-start justify-between gap-2">
          <p class="text-[11px] font-label-bold text-on-surface-variant">${escapeHtml(o.number)}</p>
          ${alertChip(o.alert)}
        </div>
        <p class="text-body-sm font-bold text-on-surface truncate">${escapeHtml(o.client_name)}</p>
        <p class="text-[12px] text-on-surface truncate">${escapeHtml(o.product_name)} · <span class="text-on-surface-variant">${fmtQty(o.quantity)} ${escapeHtml(o.unit)}</span></p>
        ${o.status === 'pausada' ? statusChip('pausada') : ''}
        ${blockChip(o)}
        ${o.tasks_total ? progressBar(o.progress) : ''}
        <div class="flex items-center justify-between gap-2 text-[11px] text-on-surface-variant pt-0.5">
          <span class="inline-flex items-center gap-1 truncate ${o.responsible_name ? '' : 'text-error'}"><span class="material-symbols-outlined text-[14px]">engineering</span>${escapeHtml(o.responsible_name || 'Sin responsable')}</span>
          <span class="inline-flex items-center gap-1 shrink-0"><span class="material-symbols-outlined text-[14px]">event</span>${fmtDay(o.committed_date || o.requested_date)}</span>
        </div>
        ${o.priority === 'alta' || o.priority === 'urgente' ? `<p class="text-[11px] ${p.cls}">Prioridad ${p.label.toLowerCase()}</p>` : ''}
      </a>`;
  }

  function renderBoard() {
    const list = filtered();
    board.innerHTML = `
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6 gap-3">
        ${COLUMNS.map((col) => {
          const items = list.filter((o) => columnOf(o) === col.key);
          return `
            <div class="bg-surface-container-low rounded-xl border border-outline-variant flex flex-col min-h-[180px]">
              <div class="flex items-center justify-between px-3 py-2.5 border-b border-outline-variant">
                <span class="flex items-center gap-1.5 text-label-bold font-label-bold text-on-surface"><span class="material-symbols-outlined text-[18px] text-on-surface-variant">${col.icon}</span>${col.label}</span>
                <span class="text-[11px] font-bold text-on-surface-variant bg-surface-container-lowest border border-outline-variant rounded-full px-2 py-0.5">${items.length}</span>
              </div>
              <div class="p-2 space-y-2 flex-1">
                ${items.length ? items.map(card).join('') : '<p class="text-[12px] text-on-surface-variant text-center py-6">—</p>'}
              </div>
            </div>`;
        }).join('')}
      </div>`;
  }

  async function load() {
    try {
      ops = await ctx.api.get('/api/production/ops');
      renderKpis();
      renderQuick();
      renderBoard();
    } catch (err) {
      ctx.toast(err.message || 'No se pudo cargar Producción', 'error');
    }
  }

  let t;
  q.addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(renderBoard, 150);
  });
  [resp, prio, from, to].forEach((el) => el.addEventListener('change', renderBoard));

  const off = ctx.ws.on('production_changed', load);
  await load();
  return () => off();
}
