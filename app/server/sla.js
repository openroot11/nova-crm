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
 * Estado SLA de un lead abierto: 'ok' | 'riesgo' | 'vencido'
 */
function slaStatus(lead, toDate = new Date()) {
  if (lead.status === 'cerrado_ganado' || lead.status === 'cerrado_perdido') return 'cerrado';
  const elapsed = hoursBetween(lead.created_at, toDate);
  if (elapsed >= SLA_BREACH_HOURS) return 'vencido';
  if (elapsed >= SLA_BREACH_HOURS - SLA_WARNING_HOURS_REMAINING) return 'riesgo';
  return 'ok';
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
  remainingLabel,
};
