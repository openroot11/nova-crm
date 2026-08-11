// Tarjeta KPI reutilizable (valor grande + icono + subtitulo de tendencia).
// Extraida de dashboard.js para poder reusarla tal cual en otras vistas
// (Estadisticas la reemplazara mas adelante en su propia fase).
export function kpiTile(label, value, sub, icon, accent = 'text-primary') {
  return `
    <div class="bg-surface-container-lowest border border-outline-variant rounded-xl p-gutter shadow-sm relative overflow-hidden">
      <div class="absolute top-0 right-0 p-4 opacity-10"><span class="material-symbols-outlined text-6xl ${accent}">${icon}</span></div>
      <p class="text-label-bold font-label-bold text-on-surface-variant uppercase tracking-wider mb-2">${label}</p>
      <h3 class="text-display-kpi font-display-kpi text-on-surface">${value}</h3>
      <p class="text-body-sm font-body-sm text-on-surface-variant mt-2">${sub}</p>
    </div>
  `;
}
