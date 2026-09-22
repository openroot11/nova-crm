import { escapeHtml, formatMoney, initials } from '../utils.js';
import { openCloseModal } from '../components/leadActions.js';

// Pestaña "Cotizar": motor de cotizaciones propio de Nova CRM, sin ninguna
// dependencia de Odoo -- guarda todo en las tablas nativas del CRM
// (server/nativeQuotes.js: quotations/quotation_lines/products) para que
// esta pantalla siga funcionando aunque en algún momento el negocio deje de
// usar Odoo en conjunto con el CRM. El flujo viejo (botón "Cotizar" en
// Ventas/SLA/Kanban, que sí arma un sale.order en Odoo -- ver
// leadActions.js openQuotationModal) sigue existiendo tal cual, aparte; esta
// pestaña es la única que usa el motor nativo por ahora.
//
// Todo en UNA sola pantalla (buscar/crear cliente + armar la cotización),
// sin pasar de una vista de "buscador" a otra de "formulario" -- el
// buscador de cliente es solo el primer campo de este mismo formulario.
// Datos de cliente pensados para una cotización formal (NIT, dirección,
// correo, ciudad), más funciones tipo Salesforce/Odoo CPQ: descripción y
// descuento % por línea, reordenar líneas, duplicar ("Clone") una
// cotización para armar una revisión, historial de cotizaciones del mismo
// lead, y compartir por WhatsApp.

const STATE_STEPS = [
  { key: 'draft', label: 'Borrador', icon: 'edit_note' },
  { key: 'sent', label: 'Enviada', icon: 'send' },
  { key: 'sale', label: 'Confirmada', icon: 'task_alt' },
];

const IVA_RATE = 0.19;

function fmtDate(isoDate) {
  if (!isoDate) return '—';
  const d = new Date(`${String(isoDate).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return isoDate;
  return d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function addDaysIso(days) {
  return new Date(Date.now() + Number(days) * 86400000).toISOString().slice(0, 10);
}

function daysUntil(isoDate) {
  if (!isoDate) return null;
  const target = new Date(`${String(isoDate).slice(0, 10)}T00:00:00`).getTime();
  if (Number.isNaN(target)) return null;
  return Math.ceil((target - Date.now()) / 86400000);
}

const STATE_BADGE = {
  draft: 'bg-surface-container-high text-on-surface-variant',
  sent: 'bg-tertiary-container text-on-tertiary-container',
  sale: 'bg-secondary-container text-on-secondary-container',
  cancel: 'bg-error-container text-on-error-container',
};
const STATE_LABEL = { draft: 'Borrador', sent: 'Enviada', sale: 'Confirmada', cancel: 'Cancelada' };

// Input sin enunciado (el placeholder hace de etiqueta) -- mismo criterio
// minimalista que Alta Rápida en ventas.js.
function input(id, placeholder, value, opts = {}) {
  const { type = 'text', span = '' } = opts;
  return `<input id="${id}" type="${type}" aria-label="${placeholder}" placeholder="${placeholder}" value="${escapeHtml(value || '')}" class="${span} w-full p-2 border border-outline-variant rounded-md outline-none focus:border-outline focus:ring-2 focus:ring-outline/20 text-body-sm bg-surface-container-lowest" />`;
}

// Categorías del catálogo para el panel "Agregar rápido" -- mismas de
// Alta Rápida (ventas.js); al elegir una se abre una línea nueva con la
// búsqueda de productos ya filtrada por esa categoría.
const QUICK_CATEGORIES = [
  { name: 'Carpas', icon: 'camping' },
  { name: 'Cortinas', icon: 'curtains' },
  { name: 'Gramas', icon: 'grass' },
  { name: 'Baby Gym', icon: 'child_care' },
  { name: 'Forros', icon: 'shield' },
  { name: 'Pisos Vinílicos', icon: 'grid_view' },
  { name: 'Banderas', icon: 'flag' },
];

// Mismas columnas para el encabezado y cada línea de la tabla de productos.
const LINE_GRID = 'grid grid-cols-2 gap-2 md:gap-3 md:items-center md:grid-cols-[20px_minmax(0,1.3fr)_minmax(0,1.5fr)_104px_112px_64px_104px_52px]';

const CARD = 'bg-surface rounded-xl border border-outline-variant shadow-sm';

function cardTitle(icon, text, right = '') {
  return `
    <div class="flex items-center justify-between gap-3 mb-4">
      <h3 class="flex items-center gap-2 text-body-md font-bold text-on-surface">
        <span class="material-symbols-outlined text-[20px] text-primary">${icon}</span>${text}
      </h3>
      ${right}
    </div>`;
}

export async function mount(container, ctx) {
  container.innerHTML = `<div id="cz-root"></div>`;
  const root = container.querySelector('#cz-root');

  // ---- estado ---------------------------------------------------------------
  let lead = null; // null = cliente aun no elegido/creado
  let quotation = null; // última cotización nativa leída/creada para el lead
  let history = []; // todas las cotizaciones nativas del lead (para el historial)
  let advisorsCache = [];
  if (ctx.user?.role !== 'asesor') {
    try {
      advisorsCache = (await ctx.api.get('/api/advisors')).filter((a) => !a.is_group && a.active);
    } catch {
      /* si falla, el select de asesor simplemente sale vacio */
    }
  }

  function isEditable() {
    return !quotation || quotation.state === 'draft' || quotation.state === 'sent';
  }

  // Trae el historial de cotizaciones nativas del lead activo y deja
  // `quotation` apuntando a la indicada (o a la última no cancelada).
  async function refreshHistory(preselectId) {
    quotation = null;
    history = [];
    try {
      const data = await ctx.api.get(`/api/leads/${lead.id}/quotations`);
      history = data.quotations || [];
      quotation = preselectId
        ? history.find((q) => q.id === preselectId) || null
        : history.find((q) => q.state !== 'cancel') || null;
    } catch (err) {
      ctx.toast(err.message, 'error');
    }
  }

  function resetAll() {
    lead = null;
    quotation = null;
    history = [];
    render();
  }

  // ---- estado (draft -> sent -> sale), como línea de tiempo ------------------
  function statusStepper() {
    if (quotation && quotation.state === 'cancel') {
      return `<span class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-body-sm font-bold bg-error-container text-on-error-container"><span class="material-symbols-outlined text-[16px]">cancel</span>Cancelada</span>`;
    }
    const currentKey = quotation ? quotation.state : 'draft';
    const currentIdx = Math.max(0, STATE_STEPS.findIndex((s) => s.key === currentKey));
    const expiresIn = quotation ? daysUntil(quotation.validity_date) : null;
    const expired = expiresIn !== null && expiresIn < 0 && currentKey !== 'sale';
    return `
      <div class="relative flex justify-between">
        <div class="absolute left-3 right-3 top-[7px] h-0.5 bg-outline-variant"></div>
        ${STATE_STEPS.map((s, i) => {
          const reached = i <= currentIdx;
          return `
            <div class="relative flex flex-col items-center gap-2 min-w-0">
              <span class="w-4 h-4 rounded-full border-2 ${reached ? 'bg-primary border-primary' : 'bg-surface border-outline-variant'}"></span>
              <span class="text-[12px] ${i === currentIdx ? 'font-bold text-on-surface' : 'text-on-surface-variant'}">${s.label}</span>
            </div>`;
        }).join('')}
      </div>
      ${
        expiresIn !== null && currentKey !== 'sale'
          ? `<p class="mt-4 text-[12px] flex items-center gap-1 ${expired ? 'text-error font-bold' : expiresIn <= 2 ? 'text-tertiary font-bold' : 'text-on-surface-variant'}">
               <span class="material-symbols-outlined text-[15px]">schedule</span>${expired ? 'Vencida' : expiresIn === 0 ? 'Vence hoy' : `Vence en ${expiresIn} días`}
             </p>`
          : ''
      }`;
  }

  // ---- historial de cotizaciones del lead ------------------------------------
  function historyCard() {
    if (history.length < 2) return '';
    return `
      <div class="${CARD} p-5">
        ${cardTitle('history', 'Historial')}
        <div class="space-y-1.5">
          ${history
            .map((q) => {
              const active = quotation && q.id === quotation.id;
              return `<button type="button" data-hist="${q.id}" class="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg border text-body-sm transition-colors ${
                active ? 'border-primary bg-primary-container text-on-primary-container font-bold' : 'border-outline-variant text-on-surface-variant hover:bg-surface-container-low'
              }"><span>${escapeHtml(q.number || '—')}</span><span>${formatMoney(q.amount_total)}</span></button>`;
            })
            .join('')}
        </div>
      </div>`;
  }

  // ---- líneas de producto -----------------------------------------------------
  // Devuelve { gross, discount }: gross = cantidad x precio sin descuento, para
  // poder mostrar el descuento como renglón aparte en el resumen.
  function computeClientTotals(list) {
    let gross = 0;
    let discount = 0;
    list.querySelectorAll('[data-line]').forEach((row) => {
      const qtyEl = row.querySelector('[data-qty]');
      if (!qtyEl) return; // fila de solo lectura (cotización confirmada)
      const qty = Number(qtyEl.value) || 0;
      const priceRaw = row.querySelector('[data-price]').value;
      const price = priceRaw === '' ? Number(row.dataset.listPrice || 0) : Number(priceRaw);
      const d = Math.min(100, Math.max(0, Number(row.querySelector('[data-discount]')?.value) || 0));
      gross += qty * price;
      discount += qty * price * (d / 100);
    });
    return { gross, discount };
  }

  function totalsHtml(gross, discount, iva, total) {
    const row = (label, value) =>
      `<div class="flex justify-between gap-4 text-body-md text-on-surface-variant"><span>${label}</span><span class="text-on-surface">${formatMoney(value)}</span></div>`;
    return `
      <div class="space-y-3">
        ${row('Subtotal', gross)}
        ${row('Descuento', discount)}
        ${row('IVA (19%)', iva)}
      </div>
      <div class="mt-4 px-4 py-3 rounded-lg bg-primary-container text-on-primary-container flex justify-between items-baseline gap-4">
        <span class="text-body-md font-bold">Total</span>
        <span class="text-headline-sm font-headline-sm font-bold">${formatMoney(total)}</span>
      </div>`;
  }

  function renderTotals() {
    const totalsEl = root.querySelector('#cz-totals');
    const list = root.querySelector('#cz-lines');
    if (!totalsEl || !list) return;
    list.querySelectorAll('[data-line]').forEach((row, i) => {
      const idx = row.querySelector('[data-idx]');
      if (idx) idx.textContent = i + 1;
    });
    if (!isEditable()) {
      const gross = quotation.lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.price_unit) || 0), 0);
      const discount = Math.max(0, gross - quotation.amount_untaxed);
      totalsEl.innerHTML = totalsHtml(gross, discount, quotation.amount_tax, quotation.amount_total);
      return;
    }
    const { gross, discount } = computeClientTotals(list);
    const sub = gross - discount;
    const iva = sub * IVA_RATE;
    totalsEl.innerHTML = totalsHtml(gross, discount, iva, sub + iva);
  }

  function moveRow(row, dir) {
    const sibling = dir === 'up' ? row.previousElementSibling : row.nextElementSibling;
    if (!sibling) return;
    if (dir === 'up') row.parentElement.insertBefore(row, sibling);
    else row.parentElement.insertBefore(sibling, row);
    renderTotals();
  }

  function appendLineRow(list, preset, editable) {
    const row = document.createElement('div');
    row.dataset.line = '';
    row.className = `${LINE_GRID} px-4 py-3 border-b border-outline-variant last:border-b-0`;
    if (preset && preset.price_unit != null) row.dataset.listPrice = Math.round(preset.price_unit);

    if (!editable) {
      const discount = Number(preset.discount_percent) || 0;
      row.innerHTML = `
        <span data-idx class="hidden md:block text-body-sm text-on-surface-variant"></span>
        <p class="col-span-2 md:col-span-1 font-bold text-body-sm text-on-surface">${escapeHtml(preset.product_name || '—')}</p>
        <p class="col-span-2 md:col-span-1 text-[12px] text-on-surface-variant">${escapeHtml(preset.description || '—')}</p>
        <p class="text-body-sm text-on-surface md:text-center">${preset.qty}</p>
        <p class="text-body-sm text-on-surface md:text-right">${formatMoney(preset.price_unit)}</p>
        <p class="text-body-sm md:text-center ${discount > 0 ? 'text-error font-bold' : 'text-on-surface-variant'}">${discount}%</p>
        <p class="font-bold text-body-sm text-on-surface md:text-right">${formatMoney(preset.subtotal ?? preset.qty * preset.price_unit)}</p>
        <span></span>
      `;
      list.appendChild(row);
      return;
    }

    row.innerHTML = `
      <span data-idx class="hidden md:block text-body-sm text-on-surface-variant"></span>
      <div class="relative col-span-2 md:col-span-1">
        <input data-prod-search type="text" autocomplete="off" aria-label="Producto" placeholder="Producto" class="w-full p-2 border border-outline-variant rounded-md outline-none focus:border-outline text-body-sm font-bold bg-surface-container-lowest" />
        <input data-prod type="hidden" />
        <div data-prod-results class="hidden fixed z-[9999] bg-surface border border-outline-variant rounded-md shadow-lg max-h-52 overflow-y-auto"></div>
      </div>
      <textarea data-description rows="2" aria-label="Descripción" placeholder="Descripción" class="col-span-2 md:col-span-1 w-full p-2 border border-outline-variant rounded-md outline-none focus:border-outline text-[12px] text-on-surface-variant bg-surface-container-lowest resize-none"></textarea>
      <div class="flex items-center border border-outline-variant rounded-md overflow-hidden w-fit md:mx-auto">
        <button type="button" data-qty-dec class="w-7 h-8 flex items-center justify-center text-on-surface-variant hover:bg-surface-container-low" aria-label="Menos"><span class="material-symbols-outlined text-[16px]">remove</span></button>
        <input data-qty type="number" min="0" step="1" value="1" aria-label="Cantidad" class="w-10 h-8 p-0 border-0 text-center outline-none focus:ring-0 text-body-sm bg-transparent [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" />
        <button type="button" data-qty-inc class="w-7 h-8 flex items-center justify-center text-on-surface-variant hover:bg-surface-container-low" aria-label="Más"><span class="material-symbols-outlined text-[16px]">add</span></button>
      </div>
      <input data-price type="number" min="0" step="1000" aria-label="Precio unitario" placeholder="Precio" class="w-full h-8 px-2 border border-outline-variant rounded-md outline-none focus:border-outline text-body-sm text-right bg-surface-container-lowest" />
      <div class="relative">
        <input data-discount type="number" min="0" max="100" step="1" value="0" aria-label="Descuento %" class="w-full h-8 pl-2 pr-5 border border-outline-variant rounded-md outline-none focus:border-outline text-body-sm text-right bg-surface-container-lowest" />
        <span class="absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-on-surface-variant pointer-events-none">%</span>
      </div>
      <p data-subtotal class="font-bold text-body-sm text-on-surface text-right self-center">${formatMoney(0)}</p>
      <div class="flex items-center justify-end gap-0.5">
        <div class="flex flex-col">
          <button type="button" data-move-up class="rounded text-on-surface-variant hover:bg-surface-container-low leading-none" aria-label="Subir"><span class="material-symbols-outlined text-[16px]">keyboard_arrow_up</span></button>
          <button type="button" data-move-down class="rounded text-on-surface-variant hover:bg-surface-container-low leading-none" aria-label="Bajar"><span class="material-symbols-outlined text-[16px]">keyboard_arrow_down</span></button>
        </div>
        <button type="button" data-del class="p-1 rounded text-on-surface-variant hover:text-error hover:bg-surface-container-low" aria-label="Quitar línea"><span class="material-symbols-outlined text-[18px]">delete</span></button>
      </div>
    `;

    const search = row.querySelector('[data-prod-search]');
    const hidden = row.querySelector('[data-prod]');
    const results = row.querySelector('[data-prod-results]');
    const description = row.querySelector('[data-description]');
    const qty = row.querySelector('[data-qty]');
    const price = row.querySelector('[data-price]');
    const discountInput = row.querySelector('[data-discount]');
    const subtotalCell = row.querySelector('[data-subtotal]');

    function recalcRow() {
      const q = Number(qty.value) || 0;
      const p = price.value === '' ? Number(row.dataset.listPrice || 0) : Number(price.value);
      const d = Math.min(100, Math.max(0, Number(discountInput.value) || 0));
      subtotalCell.textContent = formatMoney(q * p * (1 - d / 100));
      renderTotals();
    }

    function pick(p) {
      hidden.value = p.id;
      search.value = p.name;
      row.dataset.listPrice = p.price || 0;
      price.value = Math.round(p.price || 0) || '';
      if (p.description && !description.value) description.value = p.description;
      results.classList.add('hidden');
      recalcRow();
    }

    // La fila vive en una lista que puede desplazarse en pantallas angostas
    // -- por la regla CSS de que overflow-x/overflow-y quedan atados entre
    // sí, un `position: absolute` que se salga del alto de la fila se
    // recortaría. Con `position: fixed` y coordenadas calculadas a mano el
    // desplegable se pinta sobre el viewport, fuera de ese recorte.
    function showResults() {
      const rect = search.getBoundingClientRect();
      results.style.left = `${rect.left}px`;
      results.style.top = `${rect.bottom + 4}px`;
      results.style.width = `${Math.max(rect.width, 260)}px`;
      results.classList.remove('hidden');
    }

    let deb;
    search.addEventListener('input', () => {
      hidden.value = ''; // cambió el texto -> ya no hay producto del catálogo elegido hasta que pinche uno
      clearTimeout(deb);
      const term = search.value.trim();
      if (term.length < 2) {
        results.classList.add('hidden');
        return;
      }
      deb = setTimeout(async () => {
        let list2 = [];
        try {
          list2 = await ctx.api.get(`/api/products?q=${encodeURIComponent(term)}`);
        } catch {
          return;
        }
        if (!list2.length) {
          results.innerHTML = '<p class="px-3 py-2 text-[11px] text-on-surface-variant">Sin resultados — deja el nombre escrito y pon el precio a mano</p>';
          showResults();
          return;
        }
        results.innerHTML = list2
          .slice(0, 30)
          .map(
            (p) =>
              `<button type="button" data-pid="${p.id}" data-pname="${escapeHtml(p.name)}" data-pprice="${p.price || 0}" data-pdesc="${escapeHtml(p.description || '')}" class="w-full text-left px-3 py-1.5 hover:bg-surface-container-low text-body-sm flex justify-between gap-2"><span class="truncate">${escapeHtml(p.name)}</span>${p.price ? `<span class="shrink-0 text-on-surface-variant">${formatMoney(p.price)}</span>` : ''}</button>`
          )
          .join('');
        showResults();
      }, 250);
    });
    results.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-pid]');
      if (!b) return;
      pick({ id: Number(b.dataset.pid), name: b.dataset.pname, price: Number(b.dataset.pprice), description: b.dataset.pdesc });
    });
    search.addEventListener('blur', () => setTimeout(() => results.classList.add('hidden'), 150));
    qty.addEventListener('input', recalcRow);
    price.addEventListener('input', recalcRow);
    discountInput.addEventListener('input', recalcRow);
    row.querySelector('[data-qty-dec]').addEventListener('click', () => {
      qty.value = Math.max(0, (Number(qty.value) || 0) - 1);
      recalcRow();
    });
    row.querySelector('[data-qty-inc]').addEventListener('click', () => {
      qty.value = (Number(qty.value) || 0) + 1;
      recalcRow();
    });
    row.querySelector('[data-del]').addEventListener('click', () => {
      row.remove();
      renderTotals();
    });
    row.querySelector('[data-move-up]').addEventListener('click', () => moveRow(row, 'up'));
    row.querySelector('[data-move-down]').addEventListener('click', () => moveRow(row, 'down'));

    if (preset) {
      if (preset.product_id) hidden.value = preset.product_id;
      if (preset.product_name) search.value = preset.product_name;
      if (preset.description) description.value = preset.description;
      if (preset.qty != null) qty.value = preset.qty;
      if (preset.price_unit != null) price.value = Math.round(preset.price_unit);
      if (preset.discount_percent) discountInput.value = preset.discount_percent;
    }

    list.appendChild(row);
    recalcRow();
    return row;
  }

  // El nombre del producto es texto libre (no depende de tener un
  // product_id del catálogo): asi una línea puede ser "Instalación" o
  // cualquier cosa que no esté en la lista de precios, con el precio puesto
  // a mano -- mismo criterio de "precios manuales" que ya usa el resto del CRM.
  function readLines(list) {
    return [...list.querySelectorAll('[data-line]')]
      .map((row) => {
        const prodInput = row.querySelector('[data-prod]');
        if (!prodInput) return null;
        const search = row.querySelector('[data-prod-search]');
        const priceRaw = row.querySelector('[data-price]').value;
        const listPrice = Number(row.dataset.listPrice || 0);
        return {
          product_id: Number(prodInput.value) || null,
          product_name: search.value.trim(),
          description: row.querySelector('[data-description]').value.trim() || null,
          qty: Number(row.querySelector('[data-qty]').value) || 0,
          price_unit: priceRaw === '' ? listPrice : Number(priceRaw),
          discount_percent: Math.min(100, Math.max(0, Number(row.querySelector('[data-discount]').value) || 0)),
        };
      })
      .filter((l) => l && l.product_name && l.qty > 0);
  }

  // ---- cliente: buscador + datos de facturación ------------------------------
  // Los inputs (#cz-name, #cz-phone...) siempre existen porque save() los lee;
  // con un cliente ya elegido quedan escondidos tras "Editar" y la tarjeta
  // muestra solo sus datos en limpio.
  function clientInputs() {
    return `
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
        ${input('cz-name', 'Nombre *', lead?.client_name, { span: 'sm:col-span-2' })}
        ${input('cz-phone', 'Teléfono *', lead?.phone, { type: 'tel' })}
        ${input('cz-document', 'NIT / Documento', lead?.document)}
        ${input('cz-email', 'Correo', lead?.email, { type: 'email' })}
        ${input('cz-city', 'Ciudad', lead?.city)}
        ${input('cz-address', 'Dirección', lead?.address, { span: 'sm:col-span-2' })}
        ${input('cz-product', 'Producto de interés', lead?.product, { span: 'sm:col-span-2' })}
      </div>`;
  }

  function clientCard() {
    if (lead) {
      return `
        <div class="${CARD} p-5">
          ${cardTitle(
            'badge',
            'Cliente',
            `<div class="flex items-center gap-3">
               <button type="button" id="cz-edit-client" class="text-body-sm font-label-bold text-on-surface-variant hover:text-on-surface">Editar</button>
               <button type="button" id="cz-change" class="text-body-sm font-label-bold text-primary hover:underline">Cambiar cliente</button>
             </div>`
          )}
          <div id="cz-client-view" class="flex items-start gap-4">
            <span class="w-12 h-12 rounded-lg bg-primary-container text-on-primary-container flex items-center justify-center shrink-0">
              <span class="material-symbols-outlined text-[26px]">apartment</span>
            </span>
            <div class="min-w-0 text-body-sm space-y-0.5">
              <p class="font-bold text-on-surface">${escapeHtml(lead.client_name || '—')}</p>
              ${lead.document ? `<p class="text-on-surface-variant">NIT: ${escapeHtml(lead.document)}</p>` : ''}
              ${lead.email ? `<p class="text-primary truncate">${escapeHtml(lead.email)}</p>` : ''}
              ${lead.phone ? `<p class="text-on-surface-variant">${escapeHtml(lead.phone)}</p>` : ''}
              ${lead.address || lead.city ? `<p class="text-on-surface-variant">${escapeHtml([lead.address, lead.city].filter(Boolean).join(', '))}</p>` : ''}
            </div>
          </div>
          <div id="cz-client-edit" class="hidden">${clientInputs()}</div>
        </div>`;
    }
    const advisorPicker =
      ctx.user?.role !== 'asesor'
        ? `<select id="cz-advisor" aria-label="Asesor" title="Asesor" class="mt-2 w-full p-2 border border-outline-variant rounded-md outline-none focus:border-outline focus:ring-2 focus:ring-outline/20 text-body-sm bg-surface-container-lowest">
             ${advisorsCache.map((a) => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join('')}
           </select>`
        : `<p class="mt-2 flex items-center gap-1.5 text-[11px] text-tertiary"><span class="material-symbols-outlined text-[14px]">info</span>Solo coordinador/admin registra clientes nuevos.</p>`;
    return `
      <div class="${CARD} p-5">
        ${cardTitle('badge', 'Cliente')}
        <div class="relative mb-3">
          <span class="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-on-surface-variant pointer-events-none">search</span>
          <input id="cz-search" type="text" autocomplete="off" aria-label="Buscar cliente" placeholder="Buscar cliente existente…" class="w-full pl-10 pr-3 py-2 border border-outline-variant rounded-md outline-none focus:border-outline focus:ring-2 focus:ring-outline/20 text-body-sm bg-surface-container-lowest" />
          <div id="cz-results" class="hidden absolute z-20 mt-1 w-full bg-surface border border-outline-variant rounded-md shadow-lg max-h-72 overflow-y-auto"></div>
        </div>
        ${clientInputs()}
        ${advisorPicker}
      </div>`;
  }

  function extraCard() {
    const hasQuotation = !!quotation;
    return `
      <div class="${CARD} p-5">
        ${cardTitle('tune', 'Datos adicionales')}
        <div class="space-y-3">
          ${
            !hasQuotation
              ? `<div class="flex items-center gap-2 text-body-sm text-on-surface-variant">
                   <span class="material-symbols-outlined text-[18px]">event</span>
                   <span>Válida por</span>
                   <input id="cz-validity" type="number" min="1" value="8" aria-label="Días de vigencia" class="w-16 p-1.5 border border-outline-variant rounded-md outline-none focus:border-outline text-body-sm text-center bg-surface-container-lowest" />
                   <span>días · vence <span id="cz-validity-date">${fmtDate(addDaysIso(8))}</span></span>
                 </div>
                 <textarea id="cz-note" rows="4" aria-label="Notas" placeholder="Notas / términos (se incluyen en el PDF)" class="w-full p-2.5 border border-outline-variant rounded-md outline-none focus:border-outline focus:ring-2 focus:ring-outline/20 text-body-sm bg-surface-container-lowest resize-none"></textarea>`
              : `<div class="flex items-center gap-2 text-body-sm text-on-surface-variant">
                   <span class="material-symbols-outlined text-[18px]">event_available</span>Válida hasta ${fmtDate(quotation.validity_date)}
                 </div>
                 <div class="p-3 rounded-md bg-surface-container-low text-body-sm ${quotation.note ? 'text-on-surface' : 'text-on-surface-variant'} whitespace-pre-line">${escapeHtml(quotation.note || 'Sin notas')}</div>`
          }
        </div>
      </div>`;
  }

  function infoStrip() {
    if (!lead) return '';
    const item = (icon, label, value, sub = '') => `
      <div class="flex items-start gap-3 min-w-0 p-4">
        <span class="w-9 h-9 rounded-full bg-primary-container text-on-primary-container flex items-center justify-center shrink-0">
          <span class="material-symbols-outlined text-[18px]">${icon}</span>
        </span>
        <div class="min-w-0">
          <p class="text-[11px] text-on-surface-variant">${label}</p>
          <p class="text-body-sm font-bold text-on-surface truncate">${value}</p>
          ${sub ? `<p class="text-[12px] text-on-surface-variant truncate">${sub}</p>` : ''}
        </div>
      </div>`;
    return `
      <div class="${CARD} grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 divide-x divide-outline-variant">
        ${item('apartment', 'Cliente', escapeHtml(lead.client_name || '—'))}
        ${item('call', 'Contacto', escapeHtml(lead.phone || '—'), escapeHtml(lead.email || ''))}
        ${item('support_agent', 'Asesor comercial', escapeHtml(lead.advisor_name || 'Sin asignar'))}
        ${item('calendar_today', 'Fecha de creación', fmtDate(quotation?.date_order || todayIso()))}
        ${item('event', 'Vigencia', quotation ? `${quotation.validity_days} días` : '—')}
      </div>`;
  }

  function quickAddCard() {
    if (!isEditable()) return '';
    const btn = (key, icon, label) => `
      <button type="button" data-quick="${escapeHtml(key)}" class="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border border-outline-variant text-body-sm text-on-surface hover:bg-surface-container-low transition-colors">
        <span class="material-symbols-outlined text-[20px] text-primary">${icon}</span>
        <span class="flex-1 text-left">${label}</span>
        <span class="material-symbols-outlined text-[18px] text-on-surface-variant">chevron_right</span>
      </button>`;
    return `
      <div class="${CARD} p-5">
        ${cardTitle('bolt', 'Agregar rápido')}
        <div class="space-y-2">
          ${QUICK_CATEGORIES.map((c) => btn(c.name, c.icon, c.name)).join('')}
          ${btn('', 'add', 'Línea personalizada')}
        </div>
      </div>`;
  }

  function wireClientSection() {
    root.querySelector('#cz-change')?.addEventListener('click', resetAll);
    root.querySelector('#cz-edit-client')?.addEventListener('click', (e) => {
      const edit = root.querySelector('#cz-client-edit');
      const view = root.querySelector('#cz-client-view');
      const editing = edit.classList.toggle('hidden') === false;
      view.classList.toggle('hidden', editing);
      e.currentTarget.textContent = editing ? 'Ver' : 'Editar';
    });
    const search = root.querySelector('#cz-search');
    const results = root.querySelector('#cz-results');
    if (!search) return;
    let deb;
    search.addEventListener('input', () => {
      clearTimeout(deb);
      const term = search.value.trim();
      if (term.length < 2) {
        results.classList.add('hidden');
        return;
      }
      deb = setTimeout(async () => {
        let list = [];
        try {
          list = await ctx.api.get(`/api/leads?q=${encodeURIComponent(term)}`);
        } catch {
          return;
        }
        if (!list.length) {
          results.innerHTML = '<p class="px-3 py-2 text-[11px] text-on-surface-variant">Sin resultados — llena los datos de abajo para registrarlo</p>';
          results.classList.remove('hidden');
          return;
        }
        results.innerHTML = list
          .slice(0, 20)
          .map(
            (l) => `<button type="button" data-id="${l.id}" class="w-full text-left px-3 py-2 hover:bg-surface-container-low transition-colors flex items-center gap-2.5">
              <span class="w-8 h-8 rounded-full bg-primary-container text-on-primary-container flex items-center justify-center text-[11px] font-bold shrink-0">${escapeHtml(initials(l.client_name))}</span>
              <span class="min-w-0">
                <span class="block text-body-sm font-bold text-on-surface truncate">${escapeHtml(l.client_name)}</span>
                <span class="block text-[11px] text-on-surface-variant truncate">${escapeHtml(l.phone || '')}${l.product ? ' · ' + escapeHtml(l.product) : ''}${l.advisor_name ? ' · ' + escapeHtml(l.advisor_name) : ''}</span>
              </span>
            </button>`
          )
          .join('');
        results.classList.remove('hidden');
      }, 250);
    });
    results.addEventListener('click', async (e) => {
      const btn = e.target.closest('button[data-id]');
      if (!btn) return;
      results.classList.add('hidden');
      try {
        lead = await ctx.api.get(`/api/leads/${btn.dataset.id}`);
      } catch (err) {
        ctx.toast(err.message, 'error');
        return;
      }
      await refreshHistory();
      render();
    });
  }

  // Cierra el desplegable de resultados al hacer clic afuera -- un solo
  // listener en document (no uno por cada render) para no acumularlos; se
  // limpia al desmontar la vista.
  function onDocClick(e) {
    const search = root.querySelector('#cz-search');
    const results = root.querySelector('#cz-results');
    if (!search || !results) return;
    if (!search.contains(e.target) && !results.contains(e.target)) results.classList.add('hidden');
  }
  document.addEventListener('click', onDocClick);

  // ---- pantalla completa (una sola, siempre) ---------------------------------
  function render() {
    const editable = isEditable();
    const hasQuotation = !!quotation;
    const badgeCls = hasQuotation ? STATE_BADGE[quotation.state] || STATE_BADGE.draft : STATE_BADGE.draft;
    const badgeLabel = hasQuotation ? STATE_LABEL[quotation.state] || quotation.state : lead ? 'Nueva' : 'Sin cliente';
    const saveLabel = quotation ? 'Guardar cambios' : lead ? 'Guardar cotización' : 'Registrar y cotizar';

    root.innerHTML = `
      <a href="#/cotizaciones" class="inline-flex items-center gap-1.5 text-body-md text-on-surface hover:text-primary mb-2">
        <span class="material-symbols-outlined text-[20px]">arrow_back</span>Cotizaciones
      </a>
      <div class="flex items-start justify-between flex-wrap gap-3 mb-gutter">
        <div>
          <h2 class="text-headline-lg font-headline-lg text-on-surface">${hasQuotation ? escapeHtml(quotation.number) : 'Nueva cotización'}</h2>
          <span class="inline-block mt-2 px-4 py-1 rounded-full text-body-sm font-bold ${badgeCls}">${badgeLabel}</span>
        </div>
        <div class="flex flex-wrap gap-2" id="cz-actions"></div>
      </div>

      <div class="grid grid-cols-1 xl:grid-cols-12 gap-gutter items-start">
        <div class="xl:col-span-8 space-y-gutter min-w-0">
          ${infoStrip()}

          <div class="grid grid-cols-1 lg:grid-cols-2 gap-gutter">
            ${clientCard()}
            ${extraCard()}
          </div>

          <div class="${CARD} p-5">
            ${cardTitle(
              'inventory_2',
              'Productos / Servicios',
              editable ? `<button type="button" data-quick="" class="btn btn-secondary text-[12px]"><span class="material-symbols-outlined">add</span>Agregar producto</button>` : ''
            )}
            <div class="border border-outline-variant rounded-lg">
              <div class="${LINE_GRID} hidden md:grid px-4 py-2.5 bg-surface-container-low rounded-t-lg border-b border-outline-variant text-[11px] font-label-bold text-on-surface-variant">
                <span>#</span><span>Producto / Servicio</span><span>Descripción</span><span class="text-center">Cant.</span><span class="text-right">Precio unit.</span><span class="text-center">Desc.</span><span class="text-right">Total</span><span></span>
              </div>
              <div id="cz-lines"></div>
            </div>
            ${editable ? `<button type="button" data-quick="" class="btn btn-ghost mt-3 text-[12px]"><span class="material-symbols-outlined">add</span>Agregar producto o concepto</button>` : ''}
          </div>
        </div>

        <div class="xl:col-span-4 space-y-gutter xl:sticky xl:top-4">
          <div class="${CARD} p-5">
            ${cardTitle('calculate', 'Resumen de la cotización')}
            <div id="cz-totals"></div>
          </div>
          <div class="${CARD} p-5">
            ${cardTitle('flag', 'Estado de la cotización')}
            ${statusStepper()}
          </div>
          ${quickAddCard()}
          ${historyCard()}
          ${editable ? `<button type="button" id="cz-save" class="btn btn-primary w-full justify-center py-3"><span class="material-symbols-outlined">save</span>${saveLabel}</button>` : ''}
        </div>
      </div>
    `;

    wireClientSection();
    root.querySelector('#cz-validity')?.addEventListener('input', (e) => {
      const days = Number(e.target.value) || 0;
      const hint = root.querySelector('#cz-validity-date');
      if (hint) hint.textContent = days > 0 ? fmtDate(addDaysIso(days)) : '—';
    });
    root.querySelectorAll('[data-hist]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        await refreshHistory(Number(btn.dataset.hist));
        render();
      });
    });

    const list = root.querySelector('#cz-lines');
    if (hasQuotation) {
      quotation.lines.forEach((l) => appendLineRow(list, l, editable));
    } else {
      appendLineRow(list, null, true);
    }

    // "Agregar producto" y el panel "Agregar rápido": con categoría, la línea
    // nueva arranca con la búsqueda de productos ya filtrada por ella.
    root.querySelectorAll('[data-quick]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const category = btn.dataset.quick;
        const row = appendLineRow(list, null, true);
        const search = row.querySelector('[data-prod-search]');
        search.focus();
        if (category) {
          search.value = category;
          search.dispatchEvent(new Event('input'));
        }
      });
    });
    root.querySelector('#cz-save')?.addEventListener('click', save);

    renderTotals();
    renderActions();
  }

  function renderActions() {
    const actionsEl = root.querySelector('#cz-actions');
    if (!actionsEl) return;
    const buttons = [];
    if (quotation) {
      buttons.push(`<button type="button" id="cz-duplicate" class="btn btn-secondary"><span class="material-symbols-outlined">content_copy</span>Duplicar</button>`);
      buttons.push(
        `<a href="/api/quotations/${quotation.id}/pdf" target="_blank" rel="noopener" class="btn btn-secondary inline-flex"><span class="material-symbols-outlined">picture_as_pdf</span>Generar PDF</a>`
      );
    }
    if (quotation && quotation.state === 'draft') {
      buttons.push(`<button type="button" id="cz-send" class="btn btn-secondary"><span class="material-symbols-outlined">mark_email_read</span>Marcar enviada</button>`);
    }
    if (quotation && quotation.state !== 'sale' && quotation.state !== 'cancel') {
      buttons.push(`<button type="button" id="cz-confirm" class="btn btn-secondary"><span class="material-symbols-outlined">task_alt</span>Confirmar venta</button>`);
    }
    if (quotation) {
      buttons.push(`<button type="button" id="cz-whatsapp" class="btn btn-primary"><span class="material-symbols-outlined">send</span>Enviar al cliente</button>`);
    }
    actionsEl.innerHTML = buttons.join('');

    actionsEl.querySelector('#cz-send')?.addEventListener('click', markSent);
    actionsEl.querySelector('#cz-duplicate')?.addEventListener('click', duplicateQuotation);
    actionsEl.querySelector('#cz-whatsapp')?.addEventListener('click', sendWhatsApp);
    actionsEl.querySelector('#cz-confirm')?.addEventListener('click', () => {
      openCloseModal(lead, ctx, async () => {
        try {
          await ctx.api.post(`/api/quotations/${quotation.id}/confirm`);
        } catch {
          /* el lead ya quedo cerrado en el CRM aunque esto falle; no es bloqueante */
        }
        await refreshHistory(quotation.id);
        render();
      });
    });
  }

  // Abre WhatsApp Web/app con el chat del cliente y un mensaje ya escrito --
  // WhatsApp no deja adjuntar un archivo por URL, así que el mensaje le pide
  // adjuntar el PDF descargado (o compartirlo el asesor manualmente).
  function sendWhatsApp() {
    const digits = (lead.phone || '').replace(/\D/g, '');
    if (!digits) {
      ctx.toast('Este cliente no tiene teléfono registrado', 'error');
      return;
    }
    const phone = digits.length === 10 ? `57${digits}` : digits; // 10 dígitos = celular colombiano sin indicativo
    const text = `Hola ${lead.client_name}, te comparto la cotización ${quotation.number} por ${formatMoney(quotation.amount_total)}. Te adjunto el PDF a continuación.`;
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
  }

  async function duplicateQuotation() {
    const btn = root.querySelector('#cz-duplicate');
    btn.disabled = true;
    try {
      const r = await ctx.api.post(`/api/quotations/${quotation.id}/duplicate`);
      ctx.toast(`Cotización duplicada como ${r.quotation.number}`, 'success');
      await refreshHistory(r.quotation.id);
      render();
    } catch (err) {
      ctx.toast(err.message, 'error');
      btn.disabled = false;
    }
  }

  // Un solo botón hace todo: si el cliente es nuevo lo crea (o actualiza sus
  // datos si ya existía) y crea/actualiza la cotización -- así la búsqueda y
  // el formulario de cotización quedan en una sola pantalla, un solo guardado.
  async function save() {
    const name = root.querySelector('#cz-name').value.trim();
    const phone = root.querySelector('#cz-phone').value.trim();
    if (!name || !phone) {
      ctx.toast('Nombre y teléfono son obligatorios', 'error');
      return;
    }
    const list = root.querySelector('#cz-lines');
    const lines = readLines(list);
    if (!lines.length) {
      ctx.toast('Agrega al menos un producto con cantidad', 'error');
      return;
    }
    const fields = {
      client_name: name,
      phone,
      document: root.querySelector('#cz-document').value.trim(),
      email: root.querySelector('#cz-email').value.trim(),
      address: root.querySelector('#cz-address').value.trim(),
      city: root.querySelector('#cz-city').value.trim(),
      product: root.querySelector('#cz-product').value.trim(),
    };

    const btn = root.querySelector('#cz-save');
    btn.disabled = true;
    btn.setAttribute('data-loading', '');
    try {
      if (!lead) {
        const advisorSelect = root.querySelector('#cz-advisor');
        if (ctx.user?.role !== 'asesor' && !advisorSelect?.value) {
          ctx.toast('Selecciona un asesor', 'error');
          btn.disabled = false;
          btn.removeAttribute('data-loading');
          return;
        }
        lead = await ctx.api.post('/api/leads', { ...fields, advisor_id: advisorSelect?.value });
        ctx.toast('Cliente registrado', 'success');
      } else {
        lead = await ctx.api.patch(`/api/leads/${lead.id}`, fields);
      }

      let r;
      if (quotation) {
        r = await ctx.api.put(`/api/quotations/${quotation.id}`, { lines });
        ctx.toast('Cotización actualizada', 'success');
      } else {
        const validity_days = Number(root.querySelector('#cz-validity')?.value) || 8;
        const note = root.querySelector('#cz-note')?.value.trim() || undefined;
        r = await ctx.api.post(`/api/leads/${lead.id}/quotations`, { lines, validity_days, note });
        ctx.toast('Cotización creada', 'success');
      }
      await refreshHistory(r.quotation.id);
      render();
    } catch (err) {
      ctx.toast(err.message, 'error');
      btn.disabled = false;
      btn.removeAttribute('data-loading');
    }
  }

  async function markSent() {
    const btn = root.querySelector('#cz-send');
    btn.disabled = true;
    btn.setAttribute('data-loading', '');
    try {
      await ctx.api.post(`/api/quotations/${quotation.id}/send`);
      ctx.toast('Cotización marcada como enviada', 'success');
      await refreshHistory(quotation.id);
      render();
    } catch (err) {
      ctx.toast(err.message, 'error');
      btn.disabled = false;
      btn.removeAttribute('data-loading');
    }
  }

  // Deep-link opcional: #/cotizar?lead=123 abre directo esa cotización.
  const presetLeadId = ctx.routeParams.get('lead');
  if (presetLeadId) {
    try {
      lead = await ctx.api.get(`/api/leads/${presetLeadId}`);
      await refreshHistory();
    } catch {
      lead = null;
    }
  }
  render();

  return () => {
    document.removeEventListener('click', onDocClick);
  };
}
