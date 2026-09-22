// Festivos nacionales de Colombia, CALCULADOS (no hardcodeados) para que el
// reporte siga siendo correcto cualquier año. Reglas:
//  - Festivos de fecha fija: se celebran ese mismo día.
//  - "Ley Emiliani" (Ley 51 de 1983): se trasladan al lunes siguiente si no
//    caen ya en lunes.
//  - Festivos móviles ligados a la Pascua: Jueves y Viernes Santo se celebran
//    en su fecha; Ascensión, Corpus Christi y Sagrado Corazón se trasladan al
//    lunes siguiente.
//
// Se usa para contar "días hábiles" del periodo en el reporte mensual (p. ej.
// "1 venta cada N días hábiles"): abril con Semana Santa tiene 20 días
// hábiles, no 22, y ese detalle cambia el número que ve la gerencia.

function easterSunday(year) {
  // Algoritmo anónimo gregoriano (Meeus/Jones/Butcher) para el Domingo de
  // Pascua. Devuelve una fecha a medianoche UTC.
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 3 = marzo, 4 = abril
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

function addDays(date, days) {
  return new Date(date.getTime() + days * 86400000);
}

// Traslada al lunes siguiente si la fecha no cae ya en lunes.
function toMonday(date) {
  const dow = date.getUTCDay(); // 0 = domingo, 1 = lunes
  if (dow === 1) return date;
  const delta = dow === 0 ? 1 : 8 - dow;
  return addDays(date, delta);
}

function iso(date) {
  return date.toISOString().slice(0, 10);
}

// El set de festivos de un año no cambia: se calcula una vez y se cachea.
const cache = new Map();

function holidaySet(year) {
  if (cache.has(year)) return cache.get(year);

  const fijos = [
    [0, 1], // Año Nuevo
    [4, 1], // Día del Trabajo
    [6, 20], // Grito de Independencia
    [7, 7], // Batalla de Boyacá
    [11, 8], // Inmaculada Concepción
    [11, 25], // Navidad
  ];
  const emiliani = [
    [0, 6], // Reyes Magos
    [2, 19], // San José
    [5, 29], // San Pedro y San Pablo
    [7, 15], // Asunción de la Virgen
    [9, 12], // Día de la Raza
    [10, 1], // Todos los Santos
    [10, 11], // Independencia de Cartagena
  ];

  const set = new Set();
  for (const [mo, d] of fijos) set.add(iso(new Date(Date.UTC(year, mo, d))));
  for (const [mo, d] of emiliani) set.add(iso(toMonday(new Date(Date.UTC(year, mo, d)))));

  const easter = easterSunday(year);
  set.add(iso(addDays(easter, -3))); // Jueves Santo
  set.add(iso(addDays(easter, -2))); // Viernes Santo
  set.add(iso(toMonday(addDays(easter, 39)))); // Ascensión del Señor
  set.add(iso(toMonday(addDays(easter, 60)))); // Corpus Christi
  set.add(iso(toMonday(addDays(easter, 68)))); // Sagrado Corazón de Jesús

  cache.set(year, set);
  return set;
}

function isHoliday(date) {
  return holidaySet(date.getUTCFullYear()).has(iso(date));
}

// Días hábiles (lunes a viernes, sin festivos nacionales) en [fromIso, toIso],
// ambos extremos incluidos. Entrada en formato 'YYYY-MM-DD'.
function businessDaysBetween(fromIso, toIso) {
  const from = new Date(`${fromIso}T00:00:00Z`);
  const to = new Date(`${toIso}T00:00:00Z`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to < from) return 0;

  let count = 0;
  for (let d = new Date(from); d <= to; d = addDays(d, 1)) {
    const dow = d.getUTCDay();
    if (dow === 0 || dow === 6) continue; // domingo / sábado
    if (isHoliday(d)) continue;
    count += 1;
  }
  return count;
}

module.exports = { easterSunday, isHoliday, holidaySet, businessDaysBetween };
