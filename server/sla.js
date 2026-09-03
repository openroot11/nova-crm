const SLA_BREACH_HOURS = 24;
const SLA_WARNING_HOURS_REMAINING = 2; // "en riesgo" cuando quedan <= 2h para el limite de 24h

// Las fechas de SQLite (datetime('now')) llegan como 'YYYY-MM-DD HH:MM:SS' en UTC
// sin sufijo de zona horaria. Siempre se debe parsear con este helper (nunca con
// `new Date(str)` directo) porque Node interpretaria ese formato como hora LOCAL.
function parseUtc(sqliteDatetime) {
  return new Date(sqliteDatetime.replace(' ', 'T') + 'Z');
}

function hoursBetween(fromIso, toDate = new Date()) {
  const from = parseUtc(fromIso);
  return (toDate.getTime() - from.getTime()) / 3600000;
}

function formatElapsed(fromIso, toDate = new Date()) {
  const totalMinutes = Math.max(0, Math.floor(hoursBetween(fromIso, toDate) * 60));
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

// Momento contra el cual se mide el reloj de 24h de la Sala 24h (Control SLA):
// mientras el lead no tiene contacto, es su creacion; una vez contactado, la
// alerta pasa a ser "24h sin cotizacion" medida desde el contacto -- o desde
// el ultimo "Aun en contacto" (contact_ack_at) si el asesor ya la pospuso una
// vez, para que el reloj se reinicie en vez de seguir sumando desde el
// contacto original.
function slaReferenceTimestamp(lead) {
  if (lead.status === 'contactado') return lead.contact_ack_at || lead.contacted_at;
  return lead.created_at;
}

/**
 * Estado SLA de un lead abierto para ALERTAS EN VIVO: 'ok' | 'riesgo' | 'vencido' | 'cerrado'.
 * Cubre dos ventanas de 24h seguidas del mismo embudo: "asignado" (sin
 * contacto) y "contactado" (sin cotizacion) -- cada una se resuelve al pasar
 * al siguiente estado (contactado/cotizado), asi que no hay alarma perpetua:
 * una vez el lead esta "cotizado" o cerrado, esta funcion ya no alerta (ver
 * followup.js para el seguimiento post-cotizacion, y firstContactSlaMet para
 * la medicion historica de cumplimiento del primer contacto).
 */
function slaStatus(lead, toDate = new Date()) {
  if (lead.status === 'cerrado_ganado' || lead.status === 'cerrado_perdido') return 'cerrado';
  if (lead.status !== 'asignado' && lead.status !== 'contactado') return 'ok';
  const elapsed = hoursBetween(slaReferenceTimestamp(lead), toDate);
  if (elapsed >= SLA_BREACH_HOURS) return 'vencido';
  if (elapsed >= SLA_BREACH_HOURS - SLA_WARNING_HOURS_REMAINING) return 'riesgo';
  return 'ok';
}

/**
 * Que esta pidiendo la alerta de slaStatus: 'contacto' (aun no hay ni un
 * primer contacto) | 'cotizacion' (ya se contacto pero no se ha enviado
 * cotizacion) | null (no aplica). Se usa en frontend para mostrar el mensaje
 * y los botones correctos segun de que alerta se trata.
 */
function slaReason(lead) {
  if (lead.status === 'asignado') return 'contacto';
  if (lead.status === 'contactado') return 'cotizacion';
  return null;
}

/**
 * Cumplimiento HISTORICO de SLA (distinto de la alerta en vivo de arriba):
 * ¿el primer contacto se hizo dentro de las 24h desde que se asigno? Si ya
 * hubo contacto, se mide contra ese momento real (no contra ahora); si
 * todavia no lo hay, se evalua si ya se vencio el plazo. Usado para el % de
 * cumplimiento SLA en los reportes de Estadisticas -- no debe reemplazarse
 * por slaStatus() porque esa funcion ya no refleja "llego tarde" una vez el
 * lead avanza de estado.
 */
function firstContactSlaMet(lead, toDate = new Date()) {
  if (lead.contacted_at) return hoursBetween(lead.created_at, parseUtc(lead.contacted_at)) <= SLA_BREACH_HOURS;
  return hoursBetween(lead.created_at, toDate) < SLA_BREACH_HOURS;
}

function remainingLabel(lead, toDate = new Date()) {
  const elapsed = hoursBetween(slaReferenceTimestamp(lead), toDate);
  const remaining = SLA_BREACH_HOURS - elapsed;
  if (remaining <= 0) {
    const overHours = Math.abs(elapsed - SLA_BREACH_HOURS);
    const totalMinutes = Math.floor(overHours * 60);
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    return `Vencido +${h}h ${String(m).padStart(2, '0')}m`;
  }
  const totalMinutes = Math.floor(remaining * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${h}h ${String(m).padStart(2, '0')}m rest.`;
}

module.exports = {
  SLA_BREACH_HOURS,
  SLA_WARNING_HOURS_REMAINING,
  parseUtc,
  hoursBetween,
  formatElapsed,
  slaStatus,
  slaReason,
  firstContactSlaMet,
  remainingLabel,
};
