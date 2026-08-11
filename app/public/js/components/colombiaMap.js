import { COLOMBIA_BOUNDS, COLOMBIA_OUTLINE, findCity } from '../colombia-cities.js';
import { escapeHtml, formatMoney } from '../utils.js';

// Mismo orden categorico que usa el selector de Producto en Alta Rapida, con
// la paleta de 7 colores distinguibles (cada categoria siempre el mismo
// color, en el mismo orden, para que el mapa y el resto de la app hablen el
// mismo idioma visual).
export const PRODUCTS = ['Carpas', 'Cortinas', 'Gramas', 'Baby Gym', 'Forros', 'Pisos Vinílicos', 'Otro'];
export const PRODUCT_COLORS = {
  Carpas: '#2a78d6',
  Cortinas: '#eb6834',
  Gramas: '#1baf7a',
  'Baby Gym': '#eda100',
  Forros: '#e87ba4',
  'Pisos Vinílicos': '#008300',
  Otro: '#4a3aa7',
};
const FALLBACK_COLOR = '#8a8578';

function project(lat, lng, w, h) {
  const { latMin, latMax, lngMin, lngMax } = COLOMBIA_BOUNDS;
  const x = ((lng - lngMin) / (lngMax - lngMin)) * w;
  const y = ((latMax - lat) / (latMax - latMin)) * h;
  return { x, y };
}

/**
 * Dibuja el mapa de leads por ciudad dentro de `root`. `cities` es el array
 * que devuelve GET /api/kpis/geo: [{ city, leads, ganados, monto,
 * tasa_conversion, producto_top }]. El tamaño del punto es el volumen de
 * leads; el color es la categoria que mas se vende en esa ciudad.
 */
export function renderColombiaMap(root, cities) {
  const W = 420;
  const H = 520;
  const plotted = cities.filter((c) => findCity(c.city));
  const maxLeads = Math.max(1, ...plotted.map((c) => c.leads));
  const MIN_R = 7;
  const MAX_R = 26;

  const outlinePoints = COLOMBIA_OUTLINE.map(([lat, lng]) => {
    const { x, y } = project(lat, lng, W, H);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' L ');
  const outlinePath = `M ${outlinePoints} Z`;

  const markers = plotted
    .map((c) => {
      const coords = findCity(c.city);
      const { x, y } = project(coords.lat, coords.lng, W, H);
      const r = MIN_R + Math.sqrt(c.leads / maxLeads) * (MAX_R - MIN_R);
      const color = PRODUCT_COLORS[c.producto_top] || FALLBACK_COLOR;
      return `
      <g class="city-marker" data-city="${escapeHtml(c.city)}" data-leads="${c.leads}" data-ventas="${c.ganados}" data-tasa="${c.tasa_conversion}" data-monto="${c.monto}" data-producto="${escapeHtml(c.producto_top || 'Sin datos')}" style="cursor:pointer;">
        <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(1)}" fill="${color}" fill-opacity="0.78" stroke="${color}" stroke-width="1.5" />
        <text x="${x.toFixed(1)}" y="${(y + r + 12).toFixed(1)}" text-anchor="middle" font-size="10" fill="#5B6368" font-family="ui-sans-serif, system-ui, sans-serif">${escapeHtml(c.city)}</text>
      </g>`;
    })
    .join('');

  const emptyMsg =
    plotted.length === 0
      ? `<text x="${W / 2}" y="${H / 2}" text-anchor="middle" font-size="13" fill="#8B9095">Aún no hay leads con ciudad registrada en este rango</text>`
      : '';

  root.innerHTML = `
    <div class="relative" style="height:480px;">
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" style="display:block;width:100%;height:100%;background:#eaf1fb;border-radius:12px;">
        <rect x="0" y="0" width="${W}" height="${H}" fill="#eaf1fb" />
        <path d="${outlinePath}" fill="#e3ecdc" stroke="#a9bb9c" stroke-width="1.5" stroke-linejoin="round" />
        ${markers}
        ${emptyMsg}
      </svg>
      <div id="map-tooltip" class="hidden absolute pointer-events-none bg-on-surface text-surface text-body-sm rounded-md px-3 py-2 shadow-lg z-10" style="transform:translate(-50%,-115%);"></div>
    </div>
    <div class="flex flex-wrap gap-x-4 gap-y-1.5 mt-4">
      ${PRODUCTS.map((p) => `<div class="flex items-center gap-1.5 text-body-sm text-on-surface-variant"><span class="w-2.5 h-2.5 rounded-full inline-block flex-shrink-0" style="background:${PRODUCT_COLORS[p]}"></span>${escapeHtml(p)}</div>`).join('')}
    </div>
  `;

  const svg = root.querySelector('svg');
  const tooltip = root.querySelector('#map-tooltip');
  svg.querySelectorAll('.city-marker').forEach((g) => {
    g.addEventListener('mouseenter', () => {
      const d = g.dataset;
      tooltip.innerHTML = `<b>${escapeHtml(d.city)}</b><br>${d.leads} leads · ${d.ventas} ventas (${d.tasa}%)<br>Más vendido: ${escapeHtml(d.producto)}${Number(d.monto) > 0 ? `<br>${formatMoney(d.monto)}` : ''}`;
      tooltip.classList.remove('hidden');
    });
    g.addEventListener('mousemove', (e) => {
      const rect = svg.getBoundingClientRect();
      tooltip.style.left = `${e.clientX - rect.left}px`;
      tooltip.style.top = `${e.clientY - rect.top}px`;
    });
    g.addEventListener('mouseleave', () => tooltip.classList.add('hidden'));
  });
}
