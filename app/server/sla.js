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

/**
 * Estado SLA de un lead abierto para ALERTAS EN VIVO: 'ok' | 'riesgo' | 'vencido' | 'cerrado'.
 * Solo aplica mientras el lead sigue sin ningun contacto (asignado) -- una
 * vez hay contacted_at, la pregunta "¿se respondio a tiempo?" ya quedo
 * resuelta (ver firstContactSlaMet para esa medicion historica) y no tiene
 * sentido seguir alertando en vivo sobre un lead que ya avanzo en el
 * embudo. Asi funciona el SLA de "tiempo a primer contacto" en CRMs reales
 * (HubSpot/Salesforce): es una metrica de un punto en el tiempo, no una
 * alarma perpetua.
 */
function slaStatus(lead, toDate = new Date()) {
  if (lead.status === 'cerrado_ganado' || lead.status === 'cerrado_perdido') return 'cerrado';
  if (lead.status !== 'asignado') return 'ok';
  const elapsed = hoursBetween(lead.created_at, toDate);
  if (elapsed >= SLA_BREACH_HOURS) return 'vencido';
  if (elapsed >= SLA_BREACH_HOURS - SLA_WARNING_HOURS_REMAINING) return 'riesgo';
  return 'ok';
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
  const elapsed = hoursBetween(lead.created_at, toDate);
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
  firstContactSlaMet,
  remainingLabel,
};
