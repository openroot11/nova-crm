import { escapeHtml } from '../utils.js';

// Piezas compartidas de las pantallas de Producción (tablero, pedidos,
// programación, detalle de OP...). Colores sobrios, sin saturar (sección 16
// de la especificación): los estados usan los contenedores suaves del tema y
// las alertas un punto de color.

export const STATUS = {
  por_validar: { label: 'Por validar', cls: 'bg-surface-container-high text-on-surface' },
  programada: { label: 'Programada', cls: 'bg-secondary-container text-on-secondary-container' },
  en_produccion: { label: 'En producción', cls: 'bg-primary-container text-on-primary-container' },
  pausada: { label: 'Pausada', cls: 'bg-error-container text-on-error-container' },
  control: { label: 'Control / revisión', cls: 'bg-tertiary-container text-on-tertiary-container' },
  lista: { label: 'Lista para entregar', cls: 'bg-secondary-container text-on-secondary-container' },
  entregada: { label: 'Entregada', cls: 'bg-surface-container-high text-on-surface-variant' },
  cerrada: { label: 'Cerrada', cls: 'bg-surface-container-high text-on-surface-variant' },
  cancelada: { label: 'Cancelada', cls: 'bg-surface-container-high text-on-surface-variant line-through' },
};

export const ALERT = {
  en_tiempo: { label: 'En tiempo', color: 'var(--c-status-good)' },
  proxima: { label: 'Próxima', color: 'var(--c-status-warning)' },
  en_riesgo: { label: 'En riesgo', color: 'var(--c-status-serious)' },
  vencida: { label: 'Vencida', color: 'var(--c-status-critical)' },
};

export const PRIORITY = {
  baja: { label: 'Baja', cls: 'text-on-surface-variant' },
  normal: { label: 'Normal', cls: 'text-on-surface-variant' },
  alta: { label: 'Alta', cls: 'text-on-surface font-bold' },
  urgente: { label: 'Urgente', cls: 'text-error font-bold' },
};

export const SO_STATUS = {
  recibido: { label: 'Recibido', cls: 'bg-surface-container-high text-on-surface' },
  por_validar: { label: 'Por validar', cls: 'bg-tertiary-container text-on-tertiary-container' },
  info_solicitada: { label: 'Información solicitada', cls: 'bg-error-container text-on-error-container' },
  validado: { label: 'Validado', cls: 'bg-secondary-container text-on-secondary-container' },
  cancelado: { label: 'Cancelado', cls: 'bg-surface-container-high text-on-surface-variant line-through' },
};

export function statusChip(status) {
  const s = STATUS[status] || STATUS.por_validar;
  return `<span class="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold whitespace-nowrap ${s.cls}">${s.label}</span>`;
}

export function soStatusChip(status) {
  const s = SO_STATUS[status] || SO_STATUS.recibido;
  return `<span class="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold whitespace-nowrap ${s.cls}">${s.label}</span>`;
}

export function alertChip(alert, withLabel = true) {
  const a = ALERT[alert];
  if (!a) return '';
  return `<span class="inline-flex items-center gap-1 text-[11px] font-bold whitespace-nowrap text-on-surface-variant" title="${a.label}"><span class="w-2 h-2 rounded-full" style="background:${a.color}"></span>${withLabel ? a.label : ''}</span>`;
}

export function blockChip(op) {
  if (!op.blocked) return '';
  return `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-error-container text-on-error-container whitespace-nowrap" title="OP bloqueada"><span class="material-symbols-outlined text-[13px]">block</span>${escapeHtml(op.block_reason_label || 'Bloqueada')}</span>`;
}

export function progressBar(pct) {
  return `<div class="h-1.5 rounded-full bg-surface-container-high overflow-hidden" title="${pct}% de las tareas"><div class="h-full bg-on-surface-variant" style="width:${Math.max(0, Math.min(100, pct))}%"></div></div>`;
}

const WEEKDAYS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

// "vie 26 sep" a partir de AAAA-MM-DD (fecha sin hora).
export function fmtDay(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  if (!m) return '—';
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

export function fmtDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '—';
}

// Fecha y hora guardadas en UTC ("2026-09-23 19:26:11") -> hora local.
export function fmtDateTime(utc) {
  if (!utc) return '—';
  const d = new Date(`${String(utc).replace(' ', 'T')}Z`);
  return d.toLocaleString('es-CO', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

export function localToday(offset = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function fmtQty(n) {
  return Number(n).toLocaleString('es-CO', { maximumFractionDigits: 3 });
}

export const inputCls = 'w-full p-2.5 border border-outline-variant rounded-md outline-none focus:border-outline bg-surface-container-lowest text-body-sm';
export const labelCls = 'block text-[10px] font-label-bold uppercase tracking-wider text-on-surface-variant mb-1';

export function kpiTile(label, value, { hint = '', tone = '', filter = '' } = {}) {
  const border = tone === 'bad' ? 'border-error/40' : tone === 'warn' ? 'border-tertiary/50' : 'border-outline-variant';
  const color = tone === 'bad' ? 'text-error' : 'text-on-surface';
  const tag = filter ? 'button' : 'div';
  return `
    <${tag} ${filter ? `data-kpi="${filter}"` : ''} class="text-left border ${border} rounded-xl p-3.5 bg-surface-container-lowest ${filter ? 'hover:border-outline transition-colors' : ''}">
      <p class="text-[10px] font-label-bold text-on-surface-variant uppercase tracking-wider mb-1">${label}</p>
      <p class="text-headline-sm font-headline-sm ${color}">${value}</p>
      ${hint ? `<p class="text-[11px] text-on-surface-variant mt-0.5">${hint}</p>` : ''}
    </${tag}>`;
}
