const { parseUtc, hoursBetween, formatElapsed } = require('./sla');

// Seguimiento post-cotizacion: un lead "cotizado" que no ha tenido ningun
// toque (ni cierre) en un tiempo empieza a aparecer como pendiente de
// seguimiento, y luego urgente. No es el SLA de 24h de primer contacto (eso
// ya lo cubre sla.js) sino el recordatorio de "insistirle al cliente por la
// cotizacion" para que un lead cotizado no se enfrie por falta de seguimiento.
const FOLLOWUP_WARNING_HOURS = 24;
const FOLLOWUP_URGENT_HOURS = 72;

function lastTouch(lead) {
  return lead.last_followup_at || lead.quoted_at;
}

/**
 * Estado de seguimiento de un lead: 'ok' | 'pendiente' | 'urgente' | null
 * (null = no aplica: el lead no esta en estado "cotizado" a la espera de respuesta)
 */
function followupStatus(lead, toDate = new Date()) {
  if (lead.is_historical) return null; // historial importado, no cola de tareas de hoy
  if (lead.status !== 'cotizado') return null;
  const touch = lastTouch(lead);
  if (!touch) return null;
  const elapsed = hoursBetween(touch, toDate);
  if (elapsed >= FOLLOWUP_URGENT_HOURS) return 'urgente';
  if (elapsed >= FOLLOWUP_WARNING_HOURS) return 'pendiente';
  return 'ok';
}

function followupElapsedLabel(lead, toDate = new Date()) {
  const touch = lastTouch(lead);
  if (!touch) return null;
  return formatElapsed(touch, toDate);
}

module.exports = {
  FOLLOWUP_WARNING_HOURS,
  FOLLOWUP_URGENT_HOURS,
  parseUtc,
  followupStatus,
  followupElapsedLabel,
};
