const moneyFormatter = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  maximumFractionDigits: 0,
});

export function formatMoney(value) {
  return moneyFormatter.format(Number(value) || 0);
}

export function formatCompactMoney(value) {
  const n = Number(value) || 0;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n}`;
}

export function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[c]);
}

export function initials(name) {
  return String(name || '?')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() || '')
    .join('');
}

const SLA_LABELS = {
  ok: { label: 'A tiempo', badgeClass: 'bg-surface-container-highest text-primary' },
  riesgo: { label: 'En riesgo', badgeClass: 'bg-tertiary-fixed text-on-tertiary-fixed-variant border border-tertiary-fixed-dim pulse-border' },
  vencido: { label: 'Vencido', badgeClass: 'bg-tertiary text-on-tertiary pulse-border' },
  cerrado: { label: 'Cerrado', badgeClass: 'bg-surface-variant text-on-surface-variant border border-outline-variant' },
};

export function slaBadge(status) {
  return SLA_LABELS[status] || SLA_LABELS.cerrado;
}

const STATUS_LABELS = {
  asignado: { label: 'ASIGNADO', badgeClass: 'bg-surface-container-highest text-primary' },
  contactado: { label: 'CONTACTADO', badgeClass: 'bg-tertiary-fixed text-on-tertiary-fixed-variant' },
  cotizado: { label: 'COTIZADO', badgeClass: 'bg-primary-fixed text-on-primary-fixed-variant' },
  cerrado_ganado: { label: 'VENDIDO', badgeClass: 'bg-secondary-container text-on-secondary-container' },
  cerrado_perdido: { label: 'PERDIDO', badgeClass: 'bg-error-container text-on-error-container' },
};

export function statusBadge(status) {
  return STATUS_LABELS[status] || STATUS_LABELS.asignado;
}

export const STATUS_OPTIONS = [
  { value: 'asignado', label: 'Asignado' },
  { value: 'contactado', label: 'Contactado' },
  { value: 'cotizado', label: 'Cotizado' },
  { value: 'cerrado_ganado', label: 'Vendido' },
  { value: 'cerrado_perdido', label: 'Perdido' },
];
