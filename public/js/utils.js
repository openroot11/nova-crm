const moneyFormatter = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  maximumFractionDigits: 0,
});

export function formatMoney(value) {
  return moneyFormatter.format(Number(value) || 0);
}

// Reasignar sigue siendo de coordinador/admin en el dia a dia -- salvo un
// lead propio ya vencido (SLA >24h), que el asesor puede pasarle a otro
// companero el mismo en vez de esperar a que coordinador lo note. Refleja el
// mismo criterio que canReassignLead en server/routes/leads.js (el backend
// es quien de verdad lo exige; esto solo evita mostrar un botón que fallaría
// al hacer clic).
export function canReassignLead(ctx, lead) {
  if (ctx.user?.role !== 'asesor') return true;
  return lead.sla_status === 'vencido';
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

// Botón compacto para copiar el nombre del cliente con un clic, reutilizado
// en toda vista que liste leads/clientes (Dashboard, Ventas, SLA,
// Seguimiento, Clientes, Ventas Cerradas). El texto va en data-copy (los
// atributos HTML decodifican las entidades de escapeHtml solos, así que el
// portapapeles recibe el nombre real, no el HTML escapado).
export function copyNameBtn(name) {
  return `<button type="button" data-copy="${escapeHtml(name || '')}" title="Copiar nombre" class="inline-flex items-center justify-center w-5 h-5 rounded text-on-surface-variant/60 hover:text-on-surface hover:bg-surface-container-low transition-colors shrink-0"><span class="material-symbols-outlined text-[14px]">content_copy</span></button>`;
}

// Ata el clic de cada botón data-copy dentro de `root` (llamar de nuevo tras
// cada re-render, ya que innerHTML destruye los listeners previos). Detiene
// la propagación para no disparar el click de la fila/tarjeta que lo
// contiene (abrir ficha, expandir detalle, etc).
export function bindCopyButtons(root, ctx) {
  root.querySelectorAll('[data-copy]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const text = btn.dataset.copy;
      navigator.clipboard
        .writeText(text)
        .then(() => ctx.toast(`"${text}" copiado`, 'success'))
        .catch(() => ctx.toast('No se pudo copiar', 'error'));
    });
  });
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
  ok: { label: 'A tiempo', badgeClass: 'bg-surface-container-highest text-on-surface' },
  riesgo: { label: 'En riesgo', badgeClass: 'bg-tertiary-container text-on-tertiary-container border border-tertiary/20' },
  vencido: { label: 'Vencido', badgeClass: 'bg-error text-on-error pulse-border' },
  cerrado: { label: 'Cerrado', badgeClass: 'bg-surface-variant text-on-surface-variant border border-outline-variant' },
};

export function slaBadge(status) {
  return SLA_LABELS[status] || SLA_LABELS.cerrado;
}

// Semaforo de carga por asesor (ver server/routes/advisors.js): rojo/
// amarillo/verde segun cuantos leads propios ya estan vencidos ahora mismo.
// Mismos tokens de color que el resto de la app (error = critico, tertiary =
// advertencia, secondary = ok).
const PERFORMANCE_STATUS_LABELS = {
  rojo: { label: 'Rojo · sin asignación', dot: 'bg-error', chipClass: 'bg-error-container text-on-error-container' },
  amarillo: { label: 'Amarillo · asignación reducida', dot: 'bg-tertiary', chipClass: 'bg-tertiary-container text-on-tertiary-container' },
  verde: { label: 'Verde · prioridad normal', dot: 'bg-secondary', chipClass: 'bg-secondary-container text-on-secondary-container' },
};

export function performanceBadge(status) {
  return PERFORMANCE_STATUS_LABELS[status] || PERFORMANCE_STATUS_LABELS.verde;
}

// Mismo criterio de dos niveles que slaBadge, aplicado al reloj de
// seguimiento (pendiente/urgente en vez de riesgo/vencido). "urgente" ya no
// se etiqueta como alarma ("Se está enfriando") -- el lead SI fue
// contactado (por eso esta en seguimiento), asi que el badge dice
// "Contactado", con el mismo estilo que el badge de estado CONTACTADO del
// embudo (ver STATUS_LABELS mas abajo) en vez del rojo pulsante de crítico.
const FOLLOWUP_LABELS = {
  pendiente: { label: 'Dar seguimiento', badgeClass: 'bg-tertiary-container text-on-tertiary-container border border-tertiary/20' },
  urgente: { label: 'Contactado', badgeClass: 'bg-tertiary-fixed text-on-tertiary-fixed-variant' },
};

export function followupBadge(status) {
  return FOLLOWUP_LABELS[status] || FOLLOWUP_LABELS.pendiente;
}

const STATUS_LABELS = {
  asignado: { label: 'ASIGNADO', badgeClass: 'bg-surface-container-highest text-on-surface' },
  contactado: { label: 'CONTACTADO', badgeClass: 'bg-tertiary-fixed text-on-tertiary-fixed-variant' },
  cotizado: { label: 'COTIZADO', badgeClass: 'bg-primary-fixed text-on-primary-fixed-variant' },
  cerrado_ganado: { label: 'VENDIDO', badgeClass: 'bg-secondary-container text-on-secondary-container' },
  cerrado_perdido: { label: 'PERDIDO', badgeClass: 'bg-error-container text-on-error-container' },
};

export function statusBadge(status) {
  return STATUS_LABELS[status] || STATUS_LABELS.asignado;
}

// Referencia de venta: al confirmar la cotizacion en Odoo queda como "S0..."
// (cotizacion/pedido sin facturar); solo se vuelve "PED ..." cuando de verdad
// se factura/paga y alguien la actualiza a mano (ver "Editar" en Ventas
// Cerradas, y el filtro paid_only en server/routes/leads.js). El badge marca
// en naranja las que siguen como "S0..." -- todavia sin pasar a PED -- para
// que salte a la vista que falta actualizarlas; mismo criterio de dos
// niveles que slaBadge (tertiary = advertencia, secondary = ok).
export function saleReferenceBadge(saleReference) {
  const ref = (saleReference || '').trim();
  if (!ref) return { label: '—', badgeClass: 'bg-surface-container-highest text-on-surface-variant' };
  if (/^PED/i.test(ref)) return { label: ref, badgeClass: 'bg-secondary-container text-on-secondary-container' };
  return { label: ref, badgeClass: 'bg-tertiary-container text-on-tertiary-container border border-tertiary/20' };
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
