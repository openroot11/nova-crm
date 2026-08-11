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

// Dos niveles de severidad, consistentes en toda la app: tertiary (naranja)
// = advertencia, error (rojo) = critico/vencido -- solo el nivel critico
// pulsa (pulse-border), para que la animacion tambien escale con la
// severidad y no compita visualmente con el estado de advertencia.
const SLA_LABELS = {
  ok: { label: 'A tiempo', badgeClass: 'bg-surface-container-highest text-primary' },
  riesgo: { label: 'En riesgo', badgeClass: 'bg-tertiary-container text-on-tertiary-container border border-tertiary/20' },
  vencido: { label: 'Vencido', badgeClass: 'bg-error text-on-error pulse-border' },
  cerrado: { label: 'Cerrado', badgeClass: 'bg-surface-variant text-on-surface-variant border border-outline-variant' },
};

export function slaBadge(status) {
  return SLA_LABELS[status] || SLA_LABELS.cerrado;
}

// Mismo criterio de dos niveles que slaBadge, aplicado al reloj de
// seguimiento (pendiente/urgente en vez de riesgo/vencido).
const FOLLOWUP_LABELS = {
  pendiente: { label: 'Dar seguimiento', badgeClass: 'bg-tertiary-container text-on-tertiary-container border border-tertiary/20' },
  urgente: { label: 'Se está enfriando', badgeClass: 'bg-error text-on-error pulse-border' },
};

export function followupBadge(status) {
  return FOLLOWUP_LABELS[status] || FOLLOWUP_LABELS.pendiente;
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

// Colores del embudo para graficas de distribucion (Dashboard y
// Estadisticas): asignado/contactado/cotizado son etapas de una misma
// progresion (identidad, no distinta) -> rampa ordinal de un solo hue
// (azul). cerrado_ganado/cerrado_perdido SI son un desenlace bueno/malo ->
// usan la escala de estado fija, no la rampa. Mezcla deliberada: el embudo
// bifurca al final en dos resultados opuestos, no es puramente ordinal.
export const LEAD_STATUS_COLORS = {
  asignado: '#86b6ef',
  contactado: '#3987e5',
  cotizado: '#1c5cab',
  cerrado_ganado: '#0ca30c',
  cerrado_perdido: '#d03b3b',
};

// Delta porcentual entre dos valores, para comparativos de periodos. Null
// cuando no hay base valida contra la cual comparar (evita un "+Infinity%"
// o un "-100%" enganoso cuando el periodo anterior esta en cero).
export function deltaBadge(current, previous) {
  const c = Number(current) || 0;
  const p = Number(previous) || 0;
  if (!p) return null;
  const pct = Math.round(((c - p) / p) * 1000) / 10;
  const positive = pct >= 0;
  return { text: `${positive ? '+' : ''}${pct}%`, positive };
}
