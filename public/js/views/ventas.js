import { escapeHtml, STATUS_OPTIONS } from '../utils.js';
import { COLOMBIA_CITY_NAMES } from '../colombia-cities.js';
import { renderLeadKanban } from '../components/leadKanban.js';
import { mountNotifBell } from '../components/notifBell.js';
import { kpiTile } from '../components/kpiTile.js';

const PRODUCTS = ['Carpas', 'Cortinas', 'Gramas', 'Baby Gym', 'Forros', 'Pisos Vinílicos', 'Banderas', 'Otro'];
const SOURCES = ['WhatsApp', 'Correo', 'Llamada', 'Otro'];
const DEFAULT_SOURCE = 'WhatsApp';

// Fecha LOCAL (no UTC) desplazada `daysAgo` dias -- igual criterio que
// dashboard.js (todayIso): con toISOString() a la noche en Colombia (UTC-5)
// la fecha ya se corre a "mañana" en UTC, y estos cubos de dias quedarian
// mal calculados.
function localDateStr(daysAgo) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// "Pegar datos del cliente": reconoce el bloque tipico que manda un cliente
// potencial -- casi siempre una linea por dato, con o sin emoji al inicio
// ("👤 Nombre o razón social: Juan Pérez"), separados por ":" o por "-"/"–"
// (solo cuentan como separador con espacio a los dos lados: un guion pegado a
// numeros -- direccion "Cra 32#15-72", NIT "900907223-4" -- NUNCA se toma
// como separador, es parte del dato). Tambien reconoce DOS datos en la misma
// linea ("Nit 900907223-4 cel 3135555035") y, si nadie puso "Nombre:", toma
// la primera linea sin ninguna etiqueta conocida como nombre/razón social --
// es lo mas comun cuando, como pasa seguido, "no indican donde va cada cosa".
const PASTE_FIELD_PATTERNS = [
  { field: 'name', re: /nombre(\s*o\s*raz[oó]n\s*social)?|raz[oó]n\s*social/i },
  { field: 'document', re: /nit(\s*o\s*c[eé]dula)?|c[eé]dula|\bcc\b/i },
  { field: 'address', re: /direcci[oó]n/i },
  { field: 'city', re: /ciudad|municipio/i },
  { field: 'phone', re: /tel[eé]fono|celular|whats\s*app|m[oó]vil|\bcel\.?\b|\btel\.?\b/i },
  { field: 'email', re: /correo(\s*electr[oó]nico)?|e-?mail/i },
];

// Lineas de puro saludo/cortesia -- para no tomarlas como "nombre" al buscar
// la primera linea sin etiqueta.
const GREETING_RE = /^(hola|buenas?|buenos?\s*(d[ií]as|tardes|noches)|hi|hello|saludos)[\s,.!¡]*$/i;

// Todas las etiquetas conocidas que aparecen en una linea (no solo la
// primera), en orden de aparicion -- asi se pueden repartir varios datos que
// llegaron pegados en la misma linea.
function findLabelsInLine(line) {
  const found = [];
  for (const { field, re } of PASTE_FIELD_PATTERNS) {
    const m = re.exec(line);
    if (m) found.push({ field, start: m.index, end: m.index + m[0].length });
  }
  return found.sort((a, b) => a.start - b.start);
}

// El valor de una etiqueta va desde donde termina hasta donde empieza la
// siguiente etiqueta en la misma linea (o el final de la linea). Se le quita
// UN solo separador al frente -- ":" (con o sin espacio despues) o "-"/"–"
// con espacio despues -- nunca un guion que sea parte del dato mismo.
function cleanPastedValue(raw) {
  return raw.replace(/^\s*(?::\s*|[-–]\s+)?/, '').trim();
}

// Paso 2 del parser (ver parseClientPaste): cuando una linea NO trae ninguna
// etiqueta -- pasa seguido, el cliente solo tira los datos en bloque, uno por
// linea, sin decir cual es cual -- se adivina el campo por el FORMATO del
// dato en vez de por palabra clave.
function onlyDigitsFromPaste(s) {
  return String(s || '').replace(/\D/g, '');
}
function looksLikeEmailLine(line) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(line);
}
// Celular colombiano: 10 digitos empezando en 3, o el mismo con indicativo +57.
function looksLikePhoneLine(line) {
  if (!/^[\d\s().+-]+$/.test(line)) return false;
  const d = onlyDigitsFromPaste(line);
  return (d.length === 10 && d[0] === '3') || (d.length === 12 && d.startsWith('573'));
}
// Cedula/NIT: puros digitos (permite puntos de miles y el guion del digito de
// verificacion del NIT), 6 a 10 digitos, y que ya se haya descartado que sea
// un celular -- si no, un celular quedaria adivinado dos veces.
function looksLikeDocumentLine(line) {
  if (!/^[\d\s.-]+$/.test(line)) return false;
  const d = onlyDigitsFromPaste(line);
  return d.length >= 6 && d.length <= 10 && !looksLikePhoneLine(line);
}
// Coincidencia EXACTA contra el catalogo (no la busqueda difusa de
// matchCityName, mas abajo, que es para cuando ya se sabe que la linea es la
// ciudad) -- aqui hay que estar seguro antes de adivinar.
function looksLikeCityLine(line) {
  const norm = stripAccents(line.trim().toLowerCase());
  return COLOMBIA_CITY_NAMES.some((c) => stripAccents(c.toLowerCase()) === norm);
}

function parseClientPaste(text) {
  const result = {};
  const lines = String(text || '')
    .split(/\r?\n/)
    // Quita emojis/simbolos sueltos al inicio de la linea (👤, 🏢, 📍, "-", "•"...).
    .map((rawLine) => rawLine.replace(/^[^\p{L}\p{N}]+/u, '').trim())
    .filter(Boolean);

  // Paso 1: lineas CON etiqueta explicita ("Nombre:", "NIT", "Tel"...).
  const unlabeled = [];
  for (const line of lines) {
    const labels = findLabelsInLine(line);
    if (labels.length === 0) {
      unlabeled.push(line);
      continue;
    }
    labels.forEach(({ field, end }, i) => {
      if (field in result) return;
      const stop = i + 1 < labels.length ? labels[i + 1].start : line.length;
      const value = cleanPastedValue(line.slice(end, stop));
      if (value) result[field] = value;
    });
  }

  // Paso 2: lineas SIN etiqueta -- correo (tiene "@"), ciudad (coincide exacto
  // con el catalogo), celular y documento se adivinan por formato.
  const leftover = [];
  for (const line of unlabeled) {
    if (!result.email && looksLikeEmailLine(line)) result.email = line;
    else if (!result.city && looksLikeCityLine(line)) result.city = line;
    else if (!result.phone && looksLikePhoneLine(line)) result.phone = line;
    else if (!result.document && looksLikeDocumentLine(line)) result.document = line;
    else leftover.push(line);
  }

  // Lo que ni tenia etiqueta ni tiene un formato reconocible: la primera
  // linea (que no sea un saludo) se asume nombre/razón social -- el dato que
  // casi siempre llega de primero sin rotular -- y lo que sobre despues de
  // eso se junta como direccion.
  const rest = [];
  for (const line of leftover) {
    if (!result.name && !GREETING_RE.test(line)) result.name = line;
    else rest.push(line);
  }
  if (!result.address && rest.length) result.address = rest.join(', ');

  return result;
}

// Quita tildes para comparar ("bogota" == "Bogotá") -- muy comun que a mano
// (o por WhatsApp) el nombre de la ciudad llegue sin acentos.
const COMBINING_MARKS_RE = new RegExp(String.fromCharCode(0x5b, 0x5c, 0x75, 0x30, 0x33, 0x30, 0x30, 0x2d, 0x5c, 0x75, 0x30, 0x33, 0x36, 0x66, 0x5d), 'g');
function stripAccents(s) {
  return s.normalize('NFD').replace(COMBINING_MARKS_RE, '');
}

// La ciudad va en un <select>, no texto libre -- busca coincidencia exacta
// primero, luego una contenida (ej. "Bogota D.C." -> "Bogotá").
function matchCityName(value) {
  if (!value) return null;
  const norm = stripAccents(value.trim().toLowerCase());
  if (!norm) return null;
  return (
    COLOMBIA_CITY_NAMES.find((c) => stripAccents(c.toLowerCase()) === norm) ||
    COLOMBIA_CITY_NAMES.find((c) => norm.includes(stripAccents(c.toLowerCase())) || stripAccents(c.toLowerCase()).includes(norm)) ||
    null
  );
}

export async function mount(container, ctx) {
  // Un asesor ve la misma pantalla que coordinador/admin (mismo Registro
  // Operativo), solo que sin Alta Rápida -- no puede dar de alta ni asignar
  // leads nuevos, asi que esa columna desaparece y el tablero ocupa todo el
  // ancho (ver xl:col-span-12 mas abajo).
  // Solo coordinador/admin dan de alta y asignan leads nuevos; el backend ya
  // lo exige (POST /api/leads), aquí solo se evita mostrar un formulario que
  // fallaría al enviarse. "Generar informe" (exportar Excel) sigue el mismo
  // criterio: es una herramienta de reporte para quien gestiona el equipo,
  // no algo que un asesor necesite para su propio dia a dia.
  const canCreate = ctx.user?.role !== 'asesor';

  container.innerHTML = `
    <div class="grid grid-cols-1 xl:grid-cols-12 gap-gutter items-start">
      ${canCreate ? `
      <div id="alta-rapida-col" class="hidden xl:col-span-4 bg-surface rounded-xl border border-outline-variant shadow-sm p-5">
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-body-md font-semibold text-on-surface">Nuevo cliente</h3>
          <div class="flex items-center gap-3">
            <button type="button" id="f-paste-toggle" class="text-on-surface-variant hover:text-on-surface transition-colors" title="Pegar datos del cliente">
              <span class="material-symbols-outlined text-[20px]">content_paste</span>
            </button>
            <button type="button" id="alta-rapida-close-btn" class="text-on-surface-variant hover:text-on-surface transition-colors" title="Cerrar">
              <span class="material-symbols-outlined text-[20px]">close</span>
            </button>
          </div>
        </div>
        <form id="alta-form" class="space-y-3">
          <div id="f-paste-wrap" class="hidden">
            <textarea id="f-paste" rows="3" aria-label="Pegar datos del cliente" placeholder="Pega aquí los datos del cliente" class="w-full p-2.5 bg-surface-container-lowest border border-dashed border-outline-variant rounded-md text-body-sm focus:border-outline focus:ring-2 focus:ring-outline/20 outline-none transition-all resize-none"></textarea>
            <div class="text-right">
              <button type="button" id="f-paste-apply" class="text-[11px] font-label-bold text-on-surface-variant hover:text-on-surface">Autocompletar</button>
            </div>
          </div>
          <div class="relative">
            <input id="f-nombre" required type="text" autocomplete="off" aria-label="Nombre del cliente" placeholder="Nombre *" class="w-full p-2.5 bg-surface-container-lowest border border-outline-variant rounded-md text-body-md focus:border-outline focus:ring-2 focus:ring-outline/20 outline-none transition-all" />
            <div id="f-nombre-suggestions" class="hidden absolute z-20 mt-1 w-full bg-surface border border-outline-variant rounded-md shadow-lg max-h-56 overflow-y-auto"></div>
            <p id="f-cliente-hint" class="hidden text-[11px] text-secondary mt-1 flex items-center gap-1"><span class="material-symbols-outlined text-[13px]">check_circle</span>Cliente existente</p>
          </div>
          <div class="grid grid-cols-2 gap-3">
            <input id="f-telefono" required type="tel" aria-label="Teléfono" placeholder="Teléfono *" class="w-full p-2.5 bg-surface-container-lowest border border-outline-variant rounded-md text-body-md focus:border-outline focus:ring-2 focus:ring-outline/20 outline-none transition-all" />
            <input id="f-documento" type="text" aria-label="Documento" placeholder="Documento" class="w-full p-2.5 bg-surface-container-lowest border border-outline-variant rounded-md text-body-md focus:border-outline focus:ring-2 focus:ring-outline/20 outline-none transition-all" />
          </div>
          <div class="grid grid-cols-2 gap-3">
            <input id="f-correo" type="email" aria-label="Correo electrónico" placeholder="Correo" class="w-full p-2.5 bg-surface-container-lowest border border-outline-variant rounded-md text-body-md focus:border-outline focus:ring-2 focus:ring-outline/20 outline-none transition-all" />
            <input id="f-direccion" type="text" aria-label="Dirección" placeholder="Dirección" class="w-full p-2.5 bg-surface-container-lowest border border-outline-variant rounded-md text-body-md focus:border-outline focus:ring-2 focus:ring-outline/20 outline-none transition-all" />
          </div>
          <div>
            <div id="f-asesor-suggestion" class="hidden px-3 py-2 border border-outline-variant rounded-md bg-surface-container-lowest flex items-center justify-between gap-3" title="Asesor sugerido por turno">
              <div class="min-w-0 flex items-baseline gap-2">
                <p id="f-asesor-suggestion-name" class="font-bold text-on-surface truncate">—</p>
                <p id="f-asesor-suggestion-reason" class="text-[11px] text-on-surface-variant truncate"></p>
              </div>
              <button type="button" id="f-asesor-change-btn" class="shrink-0 text-body-sm font-label-bold text-on-surface-variant hover:text-on-surface">Cambiar</button>
            </div>
            <select id="f-asesor" required aria-label="Asesor" title="Asesor" class="w-full p-2.5 bg-surface-container-lowest border border-outline-variant rounded-md text-body-md focus:border-outline focus:ring-2 focus:ring-outline/20 outline-none transition-all appearance-none cursor-pointer">
              <option value="">Cargando asesores…</option>
            </select>
          </div>
          <div class="grid grid-cols-2 gap-3">
            <select id="f-producto" aria-label="Producto" title="Producto" class="w-full p-2.5 bg-surface-container-lowest border border-outline-variant rounded-md text-body-md focus:border-outline focus:ring-2 focus:ring-outline/20 outline-none transition-all appearance-none cursor-pointer">
              ${PRODUCTS.map((p) => `<option value="${p}">${p}</option>`).join('')}
            </select>
            <select id="f-source" aria-label="Canal" title="Canal" class="w-full p-2.5 bg-surface-container-lowest border border-outline-variant rounded-md text-body-md focus:border-outline focus:ring-2 focus:ring-outline/20 outline-none transition-all appearance-none cursor-pointer">
              ${SOURCES.map((s) => `<option value="${s}" ${s === DEFAULT_SOURCE ? 'selected' : ''}>${s}</option>`).join('')}
            </select>
          </div>
          <input id="f-producto-otro" type="text" aria-label="Otro producto" placeholder="¿Qué producto?" class="hidden w-full p-2.5 bg-surface-container-lowest border border-outline-variant rounded-md text-body-md focus:border-outline focus:ring-2 focus:ring-outline/20 outline-none transition-all" />
          <select id="f-ciudad" aria-label="Ciudad" title="Ciudad" class="w-full p-2.5 bg-surface-container-lowest border border-outline-variant rounded-md text-body-md focus:border-outline focus:ring-2 focus:ring-outline/20 outline-none transition-all appearance-none cursor-pointer">
            <option value="">Ciudad</option>
            ${COLOMBIA_CITY_NAMES.map((c) => `<option value="${c}">${c}</option>`).join('')}
          </select>
          <textarea id="f-notas" rows="2" aria-label="Notas" placeholder="Notas" class="w-full p-2.5 bg-surface-container-lowest border border-outline-variant rounded-md text-body-md focus:border-outline focus:ring-2 focus:ring-outline/20 outline-none transition-all resize-none"></textarea>
          <div>
            <button type="button" id="toggle-fecha" class="text-[11px] font-label-bold text-on-surface-variant hover:text-on-surface transition-colors inline-flex items-center gap-1">
              <span class="material-symbols-outlined text-[14px]">event</span> Otra fecha
            </button>
            <div id="fecha-wrap" class="hidden mt-2">
              <input id="f-fecha" type="datetime-local" aria-label="Fecha de registro" title="Fecha de registro" class="w-full p-2.5 bg-surface-container-lowest border border-outline-variant rounded-md text-body-md focus:border-outline focus:ring-2 focus:ring-outline/20 outline-none transition-all" />
            </div>
          </div>
          <button type="submit" class="w-full py-2.5 bg-primary text-on-primary rounded-md font-label-bold text-label-bold hover:bg-on-primary-fixed-variant transition-colors flex items-center justify-center">
            Registrar
          </button>
        </form>
      </div>` : ''}

      <div id="leads-col" class="xl:col-span-12 bg-surface rounded-xl border border-outline-variant shadow-sm flex flex-col overflow-hidden">
        <div class="p-6 border-b border-outline-variant flex items-center justify-between flex-wrap gap-3 bg-surface">
          <div class="flex items-center space-x-3">
            <h3 class="text-headline-md font-headline-md text-on-surface">Leads Registrados</h3>
            <span id="count-badge" class="bg-secondary-container text-on-secondary-container px-2.5 py-0.5 rounded-full text-label-bold font-label-bold flex items-center">0 registros</span>
          </div>
          <div class="flex items-center gap-3">
            ${canCreate ? `
            <button type="button" id="new-client-toggle-btn" class="px-3 py-2 bg-primary text-on-primary rounded-md text-label-bold font-label-bold hover:bg-on-primary-fixed-variant transition-colors flex items-center gap-1.5">
              <span class="material-symbols-outlined text-[18px]">person_add</span> Nuevo Cliente
            </button>` : ''}
            <div class="relative hidden md:block">
              <span class="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant text-[18px]">search</span>
              <input id="ventas-search" type="text" placeholder="Buscar cliente, ID..." class="pl-9 pr-3 py-2 bg-surface-container-low border border-transparent rounded-full text-body-sm font-body-sm outline-none focus:border-outline focus:ring-1 focus:ring-outline w-56 transition-shadow" />
            </div>
            <div id="ventas-notif-mount"></div>
            <button id="refresh-btn" class="p-2 border border-outline-variant rounded-md hover:bg-surface-container-low transition-colors text-on-surface-variant" title="Actualizar">
              <span class="material-symbols-outlined text-[20px]">refresh</span>
            </button>
          </div>
        </div>
        <div class="p-4 border-b border-outline-variant bg-surface-container-low flex flex-wrap gap-3 items-end">
          <div>
            <label class="block text-[10px] font-label-bold text-on-surface-variant mb-1 uppercase tracking-wider">Estado</label>
            <select id="filter-estado" class="p-2 bg-surface-container-lowest border border-outline-variant rounded-md text-body-sm outline-none focus:border-outline">
              <option value="">Todos</option>
              ${STATUS_OPTIONS.map((s) => `<option value="${s.value}">${s.label}</option>`).join('')}
            </select>
          </div>
          ${canCreate ? `
          <div>
            <label class="block text-[10px] font-label-bold text-on-surface-variant mb-1 uppercase tracking-wider">Asesor</label>
            <select id="filter-asesor" class="p-2 bg-surface-container-lowest border border-outline-variant rounded-md text-body-sm outline-none focus:border-outline">
              <option value="">Todos</option>
            </select>
          </div>` : ''}
          <div>
            <label class="block text-[10px] font-label-bold text-on-surface-variant mb-1 uppercase tracking-wider">Producto</label>
            <select id="filter-producto" class="p-2 bg-surface-container-lowest border border-outline-variant rounded-md text-body-sm outline-none focus:border-outline">
              <option value="">Todos</option>
              ${PRODUCTS.map((p) => `<option value="${p}">${p}</option>`).join('')}
            </select>
          </div>
          <div>
            <label class="block text-[10px] font-label-bold text-on-surface-variant mb-1 uppercase tracking-wider">Canal</label>
            <select id="filter-canal" class="p-2 bg-surface-container-lowest border border-outline-variant rounded-md text-body-sm outline-none focus:border-outline">
              <option value="">Todos</option>
              ${SOURCES.map((s) => `<option value="${s}">${s}</option>`).join('')}
            </select>
          </div>
          <div>
            <label id="filter-fecha-label" class="block text-[10px] font-label-bold text-on-surface-variant mb-1 uppercase tracking-wider">Fecha</label>
            <select id="filter-fecha" class="p-2 bg-surface-container-lowest border border-outline-variant rounded-md text-body-sm outline-none focus:border-outline">
              <option value="">Todos</option>
              <option value="hoy">Hoy</option>
              <option value="ayer">Ayer</option>
              <option value="antiguos">Hace más de 3 días</option>
            </select>
          </div>
          <label id="filter-unsynced-wrap" hidden class="flex items-center gap-1.5 text-body-sm text-on-surface-variant pb-2 cursor-pointer">
            <input id="filter-unsynced" type="checkbox" class="rounded border-outline-variant" />
            Solo sin Odoo
          </label>
          <button id="filter-clear" class="px-3 py-2 rounded-md border border-outline-variant text-body-sm font-label-bold text-on-surface-variant hover:bg-surface-container-lowest transition-colors">Limpiar filtros</button>
          ${canCreate ? `
          <button id="export-xlsx-btn" class="ml-auto px-3 py-2 bg-primary text-on-primary rounded-md text-label-bold font-label-bold hover:bg-on-primary-fixed-variant transition-colors flex items-center gap-1.5" title="Descarga en Excel los leads que cumplen los filtros de arriba">
            <span class="material-symbols-outlined text-[18px]">download</span> Generar informe
          </button>` : ''}
        </div>
        <div id="ventas-kpis" class="grid grid-cols-2 lg:grid-cols-4 gap-gutter p-4 border-b border-outline-variant"></div>
        <div id="ventas-board-wrap" class="flex-1 overflow-y-auto p-4"></div>
      </div>
    </div>
  `;

  const form = container.querySelector('#alta-form');
  const countBadge = container.querySelector('#count-badge');
  const altaRapidaCol = container.querySelector('#alta-rapida-col');
  const leadsCol = container.querySelector('#leads-col');

  // Alta Rápida arranca oculta -- ocupa un cuarto de la pantalla para algo
  // que solo hace falta de vez en cuando (dar de alta un cliente nuevo). Se
  // abre con "Nuevo Cliente" y se cierra sola (o con la X) para no estorbarle
  // al tablero, que es lo que se consulta todo el dia.
  function setAltaRapidaVisible(visible) {
    if (!altaRapidaCol) return;
    altaRapidaCol.classList.toggle('hidden', !visible);
    leadsCol.classList.toggle('xl:col-span-8', visible);
    leadsCol.classList.toggle('xl:col-span-12', !visible);
  }
  const asesorSelect = container.querySelector('#f-asesor');
  const asesorSuggestionBox = container.querySelector('#f-asesor-suggestion');
  const asesorSuggestionName = container.querySelector('#f-asesor-suggestion-name');
  const asesorSuggestionReason = container.querySelector('#f-asesor-suggestion-reason');
  const asesorChangeBtn = container.querySelector('#f-asesor-change-btn');
  const productoSelect = container.querySelector('#f-producto');
  const productoOtro = container.querySelector('#f-producto-otro');
  const submitBtn = form ? form.querySelector('button[type="submit"]') : null;
  const nombreInput = container.querySelector('#f-nombre');
  const nombreSuggestions = container.querySelector('#f-nombre-suggestions');
  const clienteHint = container.querySelector('#f-cliente-hint');
  let selectedClientId = null;
  let clienteSearchDebounce;

  if (nombreInput) {
    nombreInput.addEventListener('input', () => {
      selectedClientId = null;
      clienteHint.classList.add('hidden');
      clearTimeout(clienteSearchDebounce);
      const term = nombreInput.value.trim();
      if (term.length < 2) {
        nombreSuggestions.classList.add('hidden');
        return;
      }
      clienteSearchDebounce = setTimeout(async () => {
        let matches = [];
        try {
          matches = await ctx.api.get(`/api/clients?q=${encodeURIComponent(term)}`);
        } catch {
          return;
        }
        if (!matches.length) {
          nombreSuggestions.classList.add('hidden');
          return;
        }
        nombreSuggestions.innerHTML = matches
          .slice(0, 6)
          .map(
            (c) => `
          <button type="button" data-client-id="${c.id}" data-client-name="${escapeHtml(c.name)}" data-client-phone="${escapeHtml(c.phone || '')}" data-client-document="${escapeHtml(c.document || '')}" data-client-address="${escapeHtml(c.address || '')}" data-client-email="${escapeHtml(c.email || '')}" class="w-full text-left px-3 py-2 hover:bg-surface-container-low transition-colors flex items-center justify-between gap-2">
            <span class="text-body-sm font-semibold text-on-surface truncate">${escapeHtml(c.name)}</span>
            <span class="text-[11px] text-on-surface-variant shrink-0">${escapeHtml(c.phone || 'sin teléfono')} · ${c.lead_count} pedido${c.lead_count === 1 ? '' : 's'}</span>
          </button>`
          )
          .join('');
        nombreSuggestions.classList.remove('hidden');
      }, 250);
    });
    nombreSuggestions.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-client-id]');
      if (!btn) return;
      selectedClientId = Number(btn.dataset.clientId);
      nombreInput.value = btn.dataset.clientName;
      // Trae tambien lo que ya se supiera de este cliente -- si ya tiene
      // ficha, no hay por que volver a escribir su documento/direccion/correo.
      if (btn.dataset.clientPhone) container.querySelector('#f-telefono').value = btn.dataset.clientPhone;
      if (btn.dataset.clientDocument) container.querySelector('#f-documento').value = btn.dataset.clientDocument;
      if (btn.dataset.clientAddress) container.querySelector('#f-direccion').value = btn.dataset.clientAddress;
      if (btn.dataset.clientEmail) container.querySelector('#f-correo').value = btn.dataset.clientEmail;
      nombreSuggestions.classList.add('hidden');
      clienteHint.classList.remove('hidden');
    });
    document.addEventListener('click', (e) => {
      if (!nombreInput.contains(e.target) && !nombreSuggestions.contains(e.target)) {
        nombreSuggestions.classList.add('hidden');
      }
    });
  }

  const boardWrap = container.querySelector('#ventas-board-wrap');
  const kpisEl = container.querySelector('#ventas-kpis');

  const filterEstado = container.querySelector('#filter-estado');
  const filterAsesor = container.querySelector('#filter-asesor');
  const filterProducto = container.querySelector('#filter-producto');
  const filterCanal = container.querySelector('#filter-canal');
  const filterFecha = container.querySelector('#filter-fecha');
  const filterFechaLabel = container.querySelector('#filter-fecha-label');
  const filterUnsyncedWrap = container.querySelector('#filter-unsynced-wrap');
  const filterUnsynced = container.querySelector('#filter-unsynced');

  // Estado de Odoo (una sola vez al montar, no por tarjeta): habilita el
  // check "Solo sin Odoo" y el link "Ver en Odoo" de cada tarjeta -- si la
  // integración está apagada, todas las tarjetas darían "sin Odoo" y el
  // filtro no tendría sentido, así que queda oculto.
  let odooEnabled = false;
  let odooUrl = null;
  async function loadOdooState() {
    try {
      const s = await ctx.api.get('/api/odoo/status');
      odooEnabled = !!(s && s.enabled && s.ok !== false);
      odooUrl = (s && s.url) || null;
    } catch {
      odooEnabled = false;
    }
    if (filterUnsyncedWrap) filterUnsyncedWrap.hidden = !odooEnabled;
  }
  const searchInput = container.querySelector('#ventas-search');

  // Vendido/Perdido son ventas ya cerradas: para esos dos estados el rango
  // de fechas debe filtrar por cuando se CERRARON (closed_at), no por
  // cuando entro el lead -- si no, "ventas cerradas de esta semana" te
  // mostraria clientes cerrados hace meses solo porque llegaron esta semana.
  // Para el resto de estados sigue siendo por fecha de registro (created_at).
  function isClosedStatusFilter() {
    return filterEstado.value === 'cerrado_ganado' || filterEstado.value === 'cerrado_perdido';
  }
  function updateDateFilterLabels() {
    filterFechaLabel.textContent = isClosedStatusFilter() ? 'Fecha de cierre' : 'Fecha';
  }
  updateDateFilterLabels();

  if (canCreate) {
    container.querySelector('#new-client-toggle-btn').addEventListener('click', () => setAltaRapidaVisible(true));
    container.querySelector('#alta-rapida-close-btn').addEventListener('click', () => setAltaRapidaVisible(false));

    productoSelect.addEventListener('change', () => {
      productoOtro.classList.toggle('hidden', productoSelect.value !== 'Otro');
    });
    const toggleFechaBtn = container.querySelector('#toggle-fecha');
    const fechaWrap = container.querySelector('#fecha-wrap');
    toggleFechaBtn.addEventListener('click', () => {
      fechaWrap.classList.toggle('hidden');
    });
    // "No, elige otro": descarta la sugerencia y deja el dropdown manual de
    // siempre a la vista, con el sugerido ya preseleccionado como punto de
    // partida.
    asesorChangeBtn.addEventListener('click', () => {
      asesorSuggestionBox.classList.add('hidden');
      asesorSelect.classList.remove('hidden');
    });

    // "Pegar datos del cliente": reparte el texto pegado en los campos de
    // arriba (ver parseClientPaste). Se dispara solo al pegar (evento
    // "paste", con un setTimeout(0) para leer el valor ya pegado) y tambien
    // con el boton "Autocompletar" por si se escribio/edito el texto a mano.
    const pasteInput = container.querySelector('#f-paste');
    const pasteApplyBtn = container.querySelector('#f-paste-apply');
    function applyClientPaste() {
      const parsed = parseClientPaste(pasteInput.value);
      let filled = 0;
      if (parsed.name) {
        nombreInput.value = parsed.name;
        selectedClientId = null;
        // Dispara la busqueda de "cliente existente" como si lo hubiera
        // escrito a mano -- si ya tiene ficha, la sugerencia sigue apareciendo.
        nombreInput.dispatchEvent(new Event('input', { bubbles: true }));
        filled++;
      }
      if (parsed.document) {
        container.querySelector('#f-documento').value = parsed.document;
        filled++;
      }
      if (parsed.phone) {
        container.querySelector('#f-telefono').value = parsed.phone;
        filled++;
      }
      if (parsed.email) {
        container.querySelector('#f-correo').value = parsed.email;
        filled++;
      }
      if (parsed.address) {
        container.querySelector('#f-direccion').value = parsed.address;
        filled++;
      }
      if (parsed.city) {
        const matched = matchCityName(parsed.city);
        if (matched) {
          container.querySelector('#f-ciudad').value = matched;
          filled++;
        } else {
          ctx.toast(`No reconocí la ciudad "${parsed.city}" — selecciónala manualmente`, 'error');
        }
      }
      if (filled === 0) {
        ctx.toast('No se reconoció ningún dato en el texto pegado', 'error');
      } else {
        ctx.toast(`${filled} campo${filled === 1 ? '' : 's'} autocompletado${filled === 1 ? '' : 's'}`, 'success');
      }
    }
    pasteInput.addEventListener('paste', () => setTimeout(applyClientPaste, 0));
    pasteApplyBtn.addEventListener('click', applyClientPaste);
    const pasteWrap = container.querySelector('#f-paste-wrap');
    container.querySelector('#f-paste-toggle').addEventListener('click', () => {
      pasteWrap.classList.toggle('hidden');
      if (!pasteWrap.classList.contains('hidden')) pasteInput.focus();
    });
  }

  // Muestra el turno sugerido (GET /api/advisors/suggest-turn) en vez del
  // dropdown crudo -- "Elegir otro" (mas abajo) revela el dropdown de
  // siempre para anular la sugerencia manualmente. asesorSelect ya trae las
  // opciones cargadas (sin rojo) antes de llamar a esto.
  async function loadSuggestion() {
    let data = null;
    try {
      data = await ctx.api.get('/api/advisors/suggest-turn');
    } catch {
      /* si falla, se queda el dropdown manual visible tal cual */
    }
    const suggested = data?.advisor && asesorSelect.querySelector(`option[value="${data.advisor.id}"]`) ? data.advisor : null;
    if (suggested) {
      asesorSelect.value = String(suggested.id);
      asesorSuggestionName.textContent = suggested.name;
      asesorSuggestionReason.textContent = data.all_red
        ? 'Todos los asesores están en rojo — se asigna igual'
        : data.reason === 'turno reducido (amarillo)'
        ? 'Turno reducido (amarillo)'
        : 'Turno normal';
      asesorSuggestionBox.classList.remove('hidden');
      asesorSelect.classList.add('hidden');
    } else {
      asesorSuggestionBox.classList.add('hidden');
      asesorSelect.classList.remove('hidden');
    }
  }

  // Opciones del filtro "Asesor": TODOS los asesores (incluye inactivos), a
  // diferencia del <select> de Alta Rápida que solo ofrece activos/no-rojo --
  // aquí es para poder ver leads viejos de alguien que ya no está en rotación.
  async function loadAsesorFilterOptions() {
    if (!filterAsesor) return;
    let advisors = [];
    try {
      advisors = (await ctx.api.get('/api/advisors')).filter((a) => !a.is_group);
    } catch {
      return;
    }
    const previousValue = filterAsesor.value;
    filterAsesor.innerHTML =
      '<option value="">Todos</option>' +
      advisors.map((a) => `<option value="${a.id}">${escapeHtml(a.name)}${a.active ? '' : ' (inactivo)'}</option>`).join('');
    if (advisors.some((a) => String(a.id) === previousValue)) filterAsesor.value = previousValue;
  }

  async function loadAdvisorOptions() {
    if (canCreate) {
      let advisors = [];
      try {
        const active = (await ctx.api.get('/api/advisors')).filter((a) => !a.is_group && a.active);
        // Un asesor en rojo (sobrecargado de leads vencidos) no se ofrece
        // como destino ni en la sugerencia ni en el dropdown manual -- salvo
        // que TODOS los activos esten en rojo, caso en el que no se bloquea
        // Alta Rapida por completo (ver server/routes/advisors.js).
        const nonRed = active.filter((a) => a.performance_status !== 'rojo');
        advisors = nonRed.length ? nonRed : active;
      } catch {
        ctx.toast('No se pudo cargar la lista de asesores', 'error');
      }
      const previousValue = asesorSelect.value;
      if (advisors.length === 0) {
        asesorSelect.innerHTML = '<option value="">Sin asesores activos disponibles</option>';
        asesorSuggestionBox.classList.add('hidden');
        asesorSelect.classList.remove('hidden');
        submitBtn.disabled = true;
        submitBtn.classList.add('opacity-50', 'cursor-not-allowed');
      } else {
        asesorSelect.innerHTML =
          '<option value="">Selecciona un asesor…</option>' +
          advisors.map((a) => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join('');
        if (advisors.some((a) => String(a.id) === previousValue)) asesorSelect.value = previousValue;
        submitBtn.disabled = false;
        submitBtn.classList.remove('opacity-50', 'cursor-not-allowed');
        await loadSuggestion();
      }
    }
  }

  let allLeads = [];
  let searchQuery = '';

  function buildQuery() {
    const params = new URLSearchParams();
    if (filterEstado.value) params.set('status', filterEstado.value);
    if (filterAsesor && filterAsesor.value) params.set('advisor_id', filterAsesor.value);
    if (filterProducto.value) params.set('product', filterProducto.value);
    if (filterCanal.value) params.set('source', filterCanal.value);
    if (searchQuery) {
      // Buscar es "encontrar este cliente donde sea": ignora el filtro de
      // fecha (que por defecto es solo el dia de hoy) para no dar falsos
      // "no encontrado" en clientes de dias anteriores.
      params.set('q', searchQuery);
    } else {
      const dateField = isClosedStatusFilter() ? ['closed_from', 'closed_to'] : ['from', 'to'];
      if (filterFecha.value === 'hoy') {
        const d = localDateStr(0);
        params.set(dateField[0], d);
        params.set(dateField[1], d);
      } else if (filterFecha.value === 'ayer') {
        const d = localDateStr(1);
        params.set(dateField[0], d);
        params.set(dateField[1], d);
      } else if (filterFecha.value === 'antiguos') {
        // "Hace mas de 3 dias" = 4+ dias de antiguedad -- sin limite inferior.
        params.set(dateField[1], localDateStr(4));
      }
    }
    const qs = params.toString();
    return qs ? `?${qs}` : '';
  }

  function renderCurrent() {
    // "Solo sin Odoo" es cliente-side (no un query param mas): allLeads ya
    // trae odoo_lead_id de cada uno, no vale la pena un viaje al backend
    // solo para filtrar por eso.
    const visible = odooEnabled && filterUnsynced && filterUnsynced.checked ? allLeads.filter((l) => !l.odoo_lead_id) : allLeads;

    countBadge.textContent = `${visible.length} registro${visible.length === 1 ? '' : 's'}`;

    // KPI de esta pantalla = el embudo de LEADS (asignado/contactado/
    // cotizado), no el resultado de ventas -- eso ya tiene su propia vista
    // (Ventas Cerradas: vendidos, monto, tasa de cierre).
    const total = visible.length;
    const asignados = visible.filter((l) => l.status === 'asignado').length;
    const contactados = visible.filter((l) => l.status === 'contactado').length;
    const cotizados = visible.filter((l) => l.status === 'cotizado').length;
    kpisEl.innerHTML = [
      kpiTile('Total Leads', total, 'En el rango filtrado', 'group'),
      kpiTile('Asignados', asignados, 'Por contactar', 'person_add'),
      kpiTile('Contactados', contactados, 'En seguimiento', 'call'),
      kpiTile('Cotizados', cotizados, 'Esperando respuesta', 'request_quote', 'text-secondary'),
    ].join('');

    renderLeadKanban(boardWrap, visible, ctx, load, { odooEnabled, odooUrl });
  }

  async function load() {
    try {
      allLeads = await ctx.api.get(`/api/leads${buildQuery()}`);
    } catch (err) {
      ctx.toast('No se pudieron cargar los leads', 'error');
      return;
    }
    renderCurrent();
  }

  let searchDebounce;
  searchInput.addEventListener('input', () => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => {
      searchQuery = searchInput.value.trim();
      load();
    }, 300);
  });

  container.querySelector('#refresh-btn').addEventListener('click', load);
  container.querySelector('#export-xlsx-btn')?.addEventListener('click', () => {
    // Mismos filtros que el tablero en pantalla (buildQuery), solo que en vez
    // de pintar tarjetas arma un .xlsx para descargar -- "lo que ves es lo
    // que exportas". Se abre en pestaña nueva porque es una descarga de
    // archivo, no una navegacion dentro de la SPA.
    window.open(`/api/leads/xlsx${buildQuery()}`, '_blank');
  });
  filterEstado.addEventListener('change', updateDateFilterLabels);
  [filterEstado, filterAsesor, filterProducto, filterCanal, filterFecha].forEach((el) => {
    el?.addEventListener('change', load);
  });
  filterUnsynced?.addEventListener('change', renderCurrent);
  container.querySelector('#filter-clear').addEventListener('click', () => {
    filterEstado.value = '';
    if (filterAsesor) filterAsesor.value = '';
    filterProducto.value = '';
    filterCanal.value = '';
    filterFecha.value = '';
    if (filterUnsynced) filterUnsynced.checked = false;
    updateDateFilterLabels();
    load();
  });

  if (form) form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const client_name = container.querySelector('#f-nombre').value.trim();
    const phone = container.querySelector('#f-telefono').value.trim();
    const document_ = container.querySelector('#f-documento').value.trim();
    const email = container.querySelector('#f-correo').value.trim();
    const address = container.querySelector('#f-direccion').value.trim();
    const advisor_id = asesorSelect.value;
    const product = productoSelect.value === 'Otro' ? productoOtro.value.trim() || 'Otro' : productoSelect.value;
    const source = container.querySelector('#f-source').value;
    const city = container.querySelector('#f-ciudad').value;
    const notes = container.querySelector('#f-notas').value.trim();
    const fechaWrap = container.querySelector('#fecha-wrap');
    const created_at = !fechaWrap.classList.contains('hidden') ? container.querySelector('#f-fecha').value : '';
    if (!client_name || !phone) {
      ctx.toast('Nombre y teléfono son obligatorios', 'error');
      return;
    }
    if (!advisor_id) {
      ctx.toast('Selecciona a qué asesor asignar el cliente', 'error');
      return;
    }
    try {
      // Si no se eligio un cliente existente de las sugerencias, se crea uno
      // nuevo con estos mismos datos -- asi todo lead que se registre de
      // ahora en adelante queda vinculado a una ficha en Clientes, sin
      // pedirle un paso extra a quien esta registrando.
      let client_id = selectedClientId;
      if (!client_id) {
        const client = await ctx.api.post('/api/clients', { name: client_name, phone, document: document_, email, address });
        client_id = client.id;
      }
      const lead = await ctx.api.post('/api/leads', { client_name, phone, document: document_, advisor_id, product, source, city, notes, created_at, client_id });
      ctx.toast(`Registrado y asignado a ${lead.advisor_name}`, 'success');
      form.reset();
      productoSelect.value = PRODUCTS[0];
      productoOtro.value = '';
      productoOtro.classList.add('hidden');
      container.querySelector('#f-source').value = DEFAULT_SOURCE;
      container.querySelector('#f-ciudad').value = '';
      fechaWrap.classList.add('hidden');
      selectedClientId = null;
      clienteHint.classList.add('hidden');
      setAltaRapidaVisible(false);
      load();
      loadAdvisorOptions();
    } catch (err) {
      ctx.toast(err.message, 'error');
    }
  });

  const unmountNotif = mountNotifBell(container.querySelector('#ventas-notif-mount'), ctx);

  // El turno sugerido depende tanto de leads (calls_today, vencidos) como de
  // asesores (pausados, semaforo forzado a mano), asi que se recalcula ante
  // cualquiera de los dos eventos, no solo advisors_changed.
  const offLeads = ctx.ws.on('leads_changed', () => {
    load();
    loadAdvisorOptions();
  });
  const offAdvisors = ctx.ws.on('advisors_changed', () => {
    loadAdvisorOptions();
    loadAsesorFilterOptions();
  });
  await Promise.all([load(), loadAdvisorOptions(), loadAsesorFilterOptions(), loadOdooState()]);
  // loadOdooState() puede resolver despues del primer renderCurrent() (ya
  // disparado dentro de load()) -- se vuelve a pintar para que el check "Solo
  // sin Odoo" y el link "Ver en Odoo" de las tarjetas queden bien desde el
  // arranque, no solo tras el siguiente refresco.
  renderCurrent();

  return () => {
    offLeads();
    offAdvisors();
    unmountNotif();
  };
}
