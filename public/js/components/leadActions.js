import { openModal, confirmModal } from './modal.js';
import { escapeHtml } from '../utils.js';
import { COLOMBIA_CITY_NAMES } from '../colombia-cities.js';

const EDIT_PRODUCTS = ['Carpas', 'Cortinas', 'Gramas', 'Baby Gym', 'Forros', 'Pisos Vinílicos', 'Banderas', 'Otro'];
const EDIT_SOURCES = ['WhatsApp', 'Correo', 'Llamada', 'Otro'];
const EDIT_CHANNEL_DETAILS = ['Google Ads', 'Orgánico', 'Referido', 'Otro'];

// Valor por defecto para los campos de fecha/hora "atrasada": el momento
// actual en hora local del navegador (se asume Colombia, igual que el
// resto de la app). El usuario solo lo cambia si esta registrando algo
// que paso antes (un cliente de dias anteriores, una venta vieja, etc.).
function nowLocalInputValue() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Convierte un datetime UTC ya guardado (formato 'YYYY-MM-DD HH:MM:SS' de la
// base) al valor que espera un <input type="datetime-local"> en hora
// Colombia (UTC-5 fijo) -- usa getters UTC sobre el timestamp ya desplazado
// en vez de los getters locales del navegador, para no depender de que el
// navegador este configurado en esa zona horaria (a diferencia de
// nowLocalInputValue(), que si asume eso, pero solo para "ahora mismo").
function sqlUtcToColombiaInputValue(sqlDatetime) {
  if (!sqlDatetime) return nowLocalInputValue();
  const utcMs = new Date(sqlDatetime.replace(' ', 'T') + 'Z').getTime();
  const d = new Date(utcMs - 5 * 60 * 60 * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

export function dateFieldHtml(id, label = 'Fecha y hora real', initialValue = null) {
  return `
    <label class="block text-label-bold font-label-bold uppercase tracking-wide text-on-surface-variant mb-1">${label}</label>
    <input id="${id}" type="datetime-local" value="${initialValue || nowLocalInputValue()}" class="w-full p-2.5 border border-outline-variant rounded-md mb-4 outline-none focus:border-outline focus:ring-2 focus:ring-outline/20" />
    <p class="text-[11px] text-on-surface-variant -mt-3 mb-4">¿Es de un día anterior? Cambia la fecha — así el registro y los reportes quedan con la fecha real, no con hoy.</p>
  `;
}

export async function openAssignModal(lead, ctx, onDone) {
  let advisors = [];
  try {
    advisors = (await ctx.api.get('/api/advisors')).filter((a) => !a.is_group && a.active);
  } catch (err) {
    ctx.toast('No se pudo cargar la lista de asesores', 'error');
    return;
  }
  if (advisors.length === 0) {
    ctx.toast('No hay asesores activos en rotación', 'error');
    return;
  }

  openModal({
    title: `Asignar manualmente · ${escapeHtml(lead.client_name)}`,
    render: (body, { close }) => {
      body.innerHTML = `
        <label class="block text-label-bold font-label-bold uppercase tracking-wide text-on-surface-variant mb-1">Asesor</label>
        <select id="assign-advisor" class="w-full p-2.5 border border-outline-variant rounded-md mb-4 outline-none focus:border-outline focus:ring-2 focus:ring-outline/20">
          ${advisors.map((a) => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join('')}
        </select>
        <div class="flex justify-end gap-2">
          <button id="assign-cancel" class="px-4 py-2 rounded-lg border border-outline-variant hover:bg-surface-container-low">Cancelar</button>
          <button id="assign-ok" class="px-4 py-2 rounded-lg bg-primary text-on-primary font-bold hover:bg-on-primary-fixed-variant">Asignar</button>
        </div>
      `;
      body.querySelector('#assign-cancel').addEventListener('click', close);
      body.querySelector('#assign-ok').addEventListener('click', async () => {
        const advisorId = body.querySelector('#assign-advisor').value;
        try {
          await ctx.api.post(`/api/leads/${lead.id}/assign`, { advisor_id: advisorId });
          ctx.toast('Lead asignado');
          close();
          onDone?.();
        } catch (err) {
          ctx.toast(err.message, 'error');
        }
      });
    },
  });
}

export async function openReassignModal(lead, ctx, onDone) {
  let advisors = [];
  try {
    // Un asesor en rojo (sobrecargado de vencidos) no recibe leads nuevos ni
    // por reasignacion -- mismo criterio que Alta Rapida (ver ventas.js) --
    // salvo que TODOS los demas activos tambien esten en rojo, caso en el
    // que no se bloquea la reasignacion por completo.
    const others = (await ctx.api.get('/api/advisors')).filter(
      (a) => !a.is_group && a.active && a.id !== lead.assigned_advisor_id
    );
    const nonRed = others.filter((a) => a.performance_status !== 'rojo');
    advisors = nonRed.length ? nonRed : others;
  } catch {
    ctx.toast('No se pudo cargar la lista de asesores', 'error');
    return;
  }
  if (advisors.length === 0) {
    ctx.toast('No hay otro asesor activo disponible', 'error');
    return;
  }

  openModal({
    title: `Reasignar · ${escapeHtml(lead.client_name)}`,
    render: (body, { close }) => {
      body.innerHTML = `
        <div class="mb-4 p-3 rounded-lg bg-tertiary-fixed text-on-tertiary-fixed-variant text-body-sm font-body-sm flex gap-2">
          <span class="material-symbols-outlined text-[18px]">warning</span>
          <span>Reasignar este cliente penaliza al asesor actual (${escapeHtml(lead.advisor_name || 'sin asignar')}).</span>
        </div>
        <label class="block text-label-bold font-label-bold uppercase tracking-wide text-on-surface-variant mb-1">Nuevo asesor</label>
        <select id="reassign-advisor" class="w-full p-2.5 border border-outline-variant rounded-md mb-3 outline-none focus:border-outline focus:ring-2 focus:ring-outline/20">
          ${advisors.map((a) => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join('')}
        </select>
        <label class="block text-label-bold font-label-bold uppercase tracking-wide text-on-surface-variant mb-1">Motivo</label>
        <input id="reassign-reason" type="text" placeholder="Ej. Sin respuesta, ausencia..." class="w-full p-2.5 border border-outline-variant rounded-md mb-4 outline-none focus:border-outline focus:ring-2 focus:ring-outline/20" />
        ${dateFieldHtml('reassign-at')}
        <div class="flex justify-end gap-2">
          <button id="reassign-cancel" class="px-4 py-2 rounded-lg border border-outline-variant hover:bg-surface-container-low">Cancelar</button>
          <button id="reassign-ok" class="px-4 py-2 rounded-lg bg-primary text-on-primary font-bold hover:bg-on-primary-fixed-variant">Reasignar</button>
        </div>
      `;
      body.querySelector('#reassign-cancel').addEventListener('click', close);
      body.querySelector('#reassign-ok').addEventListener('click', async () => {
        const advisorId = body.querySelector('#reassign-advisor').value;
        const reason = body.querySelector('#reassign-reason').value.trim();
        const at = body.querySelector('#reassign-at').value;
        try {
          await ctx.api.post(`/api/leads/${lead.id}/reassign`, { to_advisor_id: advisorId, reason, at });
          ctx.toast('Lead reasignado');
          close();
          onDone?.();
        } catch (err) {
          ctx.toast(err.message, 'error');
        }
      });
    },
  });
}

// Marcar contactado/cotizado abren un modal chico (con la fecha/hora ya
// prellenada a "ahora") en vez de disparar directo: asi se puede registrar
// algo de hoy con un clic extra minimo, o cambiar la fecha para algo
// atrasado, sin necesitar dos flujos distintos.
export function markContacted(lead, ctx, onDone) {
  openModal({
    title: `Marcar contactado · ${escapeHtml(lead.client_name)}`,
    render: (body, { close }) => {
      body.innerHTML = `
        ${dateFieldHtml('contact-at', 'Fecha y hora del contacto')}
        <div class="flex justify-end gap-2">
          <button id="contact-cancel" class="px-4 py-2 rounded-lg border border-outline-variant hover:bg-surface-container-low">Cancelar</button>
          <button id="contact-ok" class="px-4 py-2 rounded-lg bg-primary text-on-primary font-bold hover:bg-on-primary-fixed-variant">Confirmar</button>
        </div>
      `;
      body.querySelector('#contact-cancel').addEventListener('click', close);
      body.querySelector('#contact-ok').addEventListener('click', async () => {
        const at = body.querySelector('#contact-at').value;
        try {
          await ctx.api.patch(`/api/leads/${lead.id}/contact`, { at });
          ctx.toast('Lead marcado como contactado', 'success');
          close();
          onDone?.();
        } catch (err) {
          ctx.toast(err.message, 'error');
        }
      });
    },
  });
}

export function markQuoted(lead, ctx, onDone) {
  openModal({
    title: `Marcar cotizado · ${escapeHtml(lead.client_name)}`,
    render: (body, { close }) => {
      body.innerHTML = `
        ${dateFieldHtml('quote-at', 'Fecha y hora de la cotización')}
        <div class="flex justify-end gap-2">
          <button id="quote-cancel" class="px-4 py-2 rounded-lg border border-outline-variant hover:bg-surface-container-low">Cancelar</button>
          <button id="quote-ok" class="px-4 py-2 rounded-lg bg-primary text-on-primary font-bold hover:bg-on-primary-fixed-variant">Confirmar</button>
        </div>
      `;
      body.querySelector('#quote-cancel').addEventListener('click', close);
      body.querySelector('#quote-ok').addEventListener('click', async () => {
        const at = body.querySelector('#quote-at').value;
        try {
          await ctx.api.patch(`/api/leads/${lead.id}/quote`, { at });
          ctx.toast('Lead marcado como cotizado', 'success');
          close();
          onDone?.();
        } catch (err) {
          ctx.toast(err.message, 'error');
        }
      });
    },
  });
}

// ===========================================================================
//  Cotización → Venta (motor: Odoo)
// ===========================================================================
// Flujo completo, sin salir de Nova CRM:
//   1. openQuotationModal   -> arma el sale.order en Odoo (líneas, IVA, total, PDF)
//   2. openQuotationViewModal -> ver / editar / enviar una cotización ya creada
//   3. "Confirmar venta"    -> abre openCloseModal; al cerrar "ganado" el
//      backend confirma el pedido en Odoo (state 'sale').
// Si Odoo no está configurado o no responde, openQuotationModal cae al modal
// simple de "marcar cotizado con fecha" de siempre (markQuoted).

const money = (n) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(Number(n) || 0);

async function fetchOdooStatus(ctx) {
  try {
    return await ctx.api.get('/api/odoo/status');
  } catch {
    return { enabled: false };
  }
}

// Editor reutilizable de líneas de producto (crear cotización / editar borrador).
// El catálogo de Odoo puede tener cientos de productos, así que cada línea tiene
// un buscador que consulta /api/odoo/products?q= en vivo.
// `initialLines`: [{ product_id, product_name, qty, price_unit }].
function mountQuotationLineEditor(host, ctx, initialLines, opts = {}) {
  host.innerHTML = `
    <div data-lines class="space-y-2 mb-2"></div>
    <button type="button" data-add class="btn btn-secondary text-[12px] mb-4">
      <span class="material-symbols-outlined">add</span> Agregar producto
    </button>
    <div class="flex items-end gap-4 mb-4">
      <div class="${opts.hideValidity ? 'hidden' : ''}">
        <label class="block text-label-bold font-label-bold uppercase tracking-wide text-on-surface-variant mb-1">Validez (días)</label>
        <input data-validity type="number" min="1" value="8" class="w-24 p-2.5 border border-outline-variant rounded-md outline-none focus:border-outline focus:ring-2 focus:ring-outline/20" />
      </div>
      <div class="flex-1 text-right">
        <p class="text-body-sm text-on-surface-variant">Subtotal estimado (sin IVA)</p>
        <p data-subtotal class="text-headline-sm font-headline-sm font-bold text-on-surface">$ 0</p>
      </div>
    </div>
  `;
  const linesEl = host.querySelector('[data-lines]');
  const subtotalEl = host.querySelector('[data-subtotal]');

  function readRaw() {
    return [...linesEl.querySelectorAll('[data-line]')].map((row) => {
      const priceRaw = row.querySelector('[data-price]').value;
      return {
        product_id: Number(row.querySelector('[data-prod]').value) || 0,
        qty: Number(row.querySelector('[data-qty]').value) || 0,
        price_unit: priceRaw === '' ? undefined : Number(priceRaw),
        _listPrice: Number(row.dataset.listPrice || 0),
      };
    });
  }
  function recalc() {
    const sub = readRaw().reduce((s, l) => s + l.qty * (l.price_unit ?? l._listPrice), 0);
    subtotalEl.textContent = money(sub);
  }
  function lineRow(preset) {
    const row = document.createElement('div');
    row.dataset.line = '';
    if (preset && preset.price_unit != null) row.dataset.listPrice = Math.round(preset.price_unit);
    row.className = 'grid grid-cols-[1fr_4.5rem_8rem_auto] gap-2 items-start';
    row.innerHTML = `
      <div class="relative">
        <input data-prod-search type="text" autocomplete="off" placeholder="Buscar producto…" class="w-full p-2 border border-outline-variant rounded-md outline-none focus:border-outline text-body-sm" />
        <input data-prod type="hidden" />
        <div data-prod-results class="hidden absolute z-30 mt-1 w-full bg-surface border border-outline-variant rounded-md shadow-lg max-h-52 overflow-y-auto"></div>
      </div>
      <input data-qty class="p-2 border border-outline-variant rounded-md outline-none focus:border-outline text-body-sm" type="number" min="0" step="1" value="1" />
      <input data-price class="p-2 border border-outline-variant rounded-md outline-none focus:border-outline text-body-sm" type="number" min="0" step="1000" placeholder="precio lista" />
      <button type="button" data-del class="btn btn-icon" aria-label="Quitar"><span class="material-symbols-outlined">delete</span></button>
    `;
    const search = row.querySelector('[data-prod-search]');
    const hidden = row.querySelector('[data-prod]');
    const results = row.querySelector('[data-prod-results]');
    const qty = row.querySelector('[data-qty]');
    const price = row.querySelector('[data-price]');

    function pick(p) {
      hidden.value = p.id;
      search.value = p.name;
      row.dataset.listPrice = p.price || 0;
      price.placeholder = p.price ? Number(p.price).toLocaleString('es-CO') : 'precio lista';
      results.classList.add('hidden');
      recalc();
    }

    let deb;
    search.addEventListener('input', () => {
      hidden.value = ''; // cambió el texto -> ya no hay producto elegido hasta que pinche uno
      clearTimeout(deb);
      const term = search.value.trim();
      if (term.length < 2) {
        results.classList.add('hidden');
        return;
      }
      deb = setTimeout(async () => {
        let list = [];
        try {
          list = await ctx.api.get(`/api/odoo/products?q=${encodeURIComponent(term)}`);
        } catch {
          return;
        }
        if (!list.length) {
          results.innerHTML = '<p class="px-3 py-2 text-[11px] text-on-surface-variant">Sin resultados</p>';
          results.classList.remove('hidden');
          return;
        }
        results.innerHTML = list
          .slice(0, 30)
          .map(
            (p) =>
              `<button type="button" data-pid="${p.id}" data-pname="${escapeHtml(p.name)}" data-pprice="${p.price || 0}" class="w-full text-left px-3 py-1.5 hover:bg-surface-container-low text-body-sm flex justify-between gap-2"><span class="truncate">${escapeHtml(p.name)}</span>${p.price ? `<span class="shrink-0 text-on-surface-variant">${money(p.price)}</span>` : ''}</button>`
          )
          .join('');
        results.classList.remove('hidden');
      }, 250);
    });
    results.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-pid]');
      if (!b) return;
      pick({ id: Number(b.dataset.pid), name: b.dataset.pname, price: Number(b.dataset.pprice) });
    });
    search.addEventListener('blur', () => setTimeout(() => results.classList.add('hidden'), 150));
    qty.addEventListener('input', recalc);
    price.addEventListener('input', recalc);
    row.querySelector('[data-del]').addEventListener('click', () => { row.remove(); recalc(); });

    if (preset) {
      if (preset.product_id) hidden.value = preset.product_id;
      if (preset.product_name) search.value = preset.product_name;
      if (preset.qty != null) qty.value = preset.qty;
      if (preset.price_unit != null) price.value = Math.round(preset.price_unit);
    }
    linesEl.appendChild(row);
    recalc();
  }

  host.querySelector('[data-add]').addEventListener('click', () => lineRow());
  if (Array.isArray(initialLines) && initialLines.length) initialLines.forEach((l) => lineRow(l));
  else lineRow();

  return {
    readLines: () => readRaw().filter((l) => l.product_id && l.qty > 0).map(({ _listPrice, ...l }) => l),
    validityDays: () => Number(host.querySelector('[data-validity]')?.value) || 8,
  };
}

// Panel de resultado tras crear/enviar/actualizar una cotización.
function renderQuotationResult(body, lead, quotation, ctx, { close, onDone }) {
  body.innerHTML = `
    <div class="mb-4 p-4 rounded-lg bg-secondary-container text-on-secondary-container">
      <div class="flex items-center justify-between gap-2 mb-1">
        <p class="font-bold text-body-md">${escapeHtml(quotation.name)}</p>
        <span class="px-2 py-0.5 rounded text-[11px] font-bold bg-surface text-on-surface">${escapeHtml(quotation.state_label || '')}</span>
      </div>
      <p class="text-body-sm">Subtotal: ${money(quotation.amount_untaxed)} · IVA: ${money(quotation.amount_tax)}</p>
      <p class="text-headline-sm font-headline-sm font-bold mt-1">Total: ${money(quotation.amount_total)}</p>
    </div>
    <div class="flex flex-wrap gap-2">
      <a href="/api/leads/${lead.id}/quotation/pdf" target="_blank" rel="noopener" class="btn btn-secondary inline-flex">
        <span class="material-symbols-outlined">picture_as_pdf</span> Ver / descargar PDF
      </a>
      ${quotation.state === 'draft' ? `<button type="button" data-send class="btn btn-secondary">Marcar como enviada</button>` : ''}
      ${!quotation.is_confirmed ? `<button type="button" data-confirm class="btn btn-primary">Confirmar venta</button>` : ''}
    </div>
    <div class="flex justify-end mt-4">
      <button type="button" data-done class="btn btn-secondary">Cerrar</button>
    </div>
  `;
  body.querySelector('[data-done]').addEventListener('click', () => { close(); onDone?.(); });
  body.querySelector('[data-send]')?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      const { quotation: updated } = await ctx.api.post(`/api/leads/${lead.id}/quotation/send`);
      ctx.toast('Cotización marcada como enviada', 'success');
      renderQuotationResult(body, lead, updated, ctx, { close, onDone });
      onDone?.();
    } catch (err) {
      ctx.toast(err.message, 'error');
      e.target.disabled = false;
    }
  });
  body.querySelector('[data-confirm]')?.addEventListener('click', () => {
    close();
    // Sin IVA: el monto que se reporta en el CRM es el subtotal, no el total con impuestos.
    openCloseModal({ ...lead, odoo_order_id: quotation.id, sale_reference: quotation.name, amount: quotation.amount_untaxed }, ctx, onDone);
  });
}

export async function openQuotationModal(lead, ctx, onDone) {
  const status = await fetchOdooStatus(ctx);
  if (!status || !status.enabled || status.ok === false) {
    if (status && status.enabled && status.ok === false) {
      ctx.toast(`Odoo no responde (${status.error || 'error'}). Se cotiza solo en el CRM.`, 'error');
    }
    return markQuoted(lead, ctx, onDone);
  }

  // Si el lead ya tiene una cotización en Odoo, no crear otra: abrir la vista.
  if (lead.odoo_order_id) return openQuotationViewModal(lead, ctx, onDone);

  openModal({
    title: `Cotización en Odoo · ${escapeHtml(lead.client_name)}`,
    wide: true,
    render: (body, { close }) => {
      body.innerHTML = `
        <div data-editor></div>
        <div class="flex justify-end gap-2">
          <button type="button" data-cancel class="btn btn-secondary">Cancelar</button>
          <button type="button" data-ok class="btn btn-primary">Crear cotización</button>
        </div>
      `;
      const editor = mountQuotationLineEditor(body.querySelector('[data-editor]'), ctx);
      body.querySelector('[data-cancel]').addEventListener('click', close);
      const okBtn = body.querySelector('[data-ok]');
      okBtn.addEventListener('click', async () => {
        const lines = editor.readLines();
        if (!lines.length) {
          ctx.toast('Agrega al menos un producto con cantidad', 'error');
          return;
        }
        okBtn.disabled = true;
        try {
          const { quotation } = await ctx.api.post(`/api/leads/${lead.id}/quotation`, {
            lines,
            validity_days: editor.validityDays(),
          });
          ctx.toast('Cotización creada en Odoo', 'success');
          renderQuotationResult(body, lead, quotation, ctx, { close, onDone });
          onDone?.();
        } catch (err) {
          ctx.toast(err.message, 'error');
          okBtn.disabled = false;
        }
      });
    },
  });
}

// Ver / editar / enviar / confirmar una cotización que YA existe en Odoo.
export async function openQuotationViewModal(lead, ctx, onDone) {
  let data;
  try {
    data = await ctx.api.get(`/api/leads/${lead.id}/quotation`);
  } catch (err) {
    ctx.toast(err.message, 'error');
    return;
  }

  openModal({
    title: `Cotización ${escapeHtml(data.quotation.name)} · ${escapeHtml(lead.client_name)}`,
    wide: true,
    render: (body, { close }) => {
      function showView(q) {
        body.innerHTML = `
          <div class="mb-4 overflow-x-auto">
            <table class="w-full text-body-sm border-collapse">
              <thead><tr class="text-left text-on-surface-variant border-b border-outline-variant">
                <th class="py-1.5 pr-2">Producto</th>
                <th class="py-1.5 px-2 text-right">Cant.</th>
                <th class="py-1.5 px-2 text-right">Precio</th>
                <th class="py-1.5 pl-2 text-right">Subtotal</th>
              </tr></thead>
              <tbody>
                ${q.lines.map((l) => `<tr class="border-b border-outline-variant/50">
                  <td class="py-1.5 pr-2">${escapeHtml(Array.isArray(l.product_id) ? l.product_id[1] : (l.name || '—'))}</td>
                  <td class="py-1.5 px-2 text-right">${l.product_uom_qty}</td>
                  <td class="py-1.5 px-2 text-right">${money(l.price_unit)}</td>
                  <td class="py-1.5 pl-2 text-right">${money(l.price_subtotal)}</td>
                </tr>`).join('')}
              </tbody>
            </table>
          </div>
          <div class="flex items-center justify-between mb-4 gap-3">
            <span class="px-2 py-0.5 rounded text-[11px] font-bold bg-surface-container-high text-on-surface shrink-0">${escapeHtml(q.state_label || '')}</span>
            <div class="text-right">
              <p class="text-body-sm text-on-surface-variant">Subtotal ${money(q.amount_untaxed)} · IVA ${money(q.amount_tax)}</p>
              <p class="text-headline-sm font-headline-sm font-bold">Total: ${money(q.amount_total)}</p>
            </div>
          </div>
          <div class="flex flex-wrap gap-2">
            <a href="/api/leads/${lead.id}/quotation/pdf" target="_blank" rel="noopener" class="btn btn-secondary inline-flex">
              <span class="material-symbols-outlined">picture_as_pdf</span> Ver / descargar PDF
            </a>
            ${q.state === 'draft' ? `<button type="button" data-send class="btn btn-secondary">Marcar como enviada</button>` : ''}
            ${!q.is_confirmed ? `<button type="button" data-edit class="btn btn-secondary">Editar líneas</button>` : ''}
            ${!q.is_confirmed ? `<button type="button" data-confirm class="btn btn-primary">Confirmar venta</button>` : ''}
          </div>
          <div class="flex justify-end mt-4"><button type="button" data-close class="btn btn-secondary">Cerrar</button></div>
        `;
        body.querySelector('[data-close]').addEventListener('click', close);
        body.querySelector('[data-send]')?.addEventListener('click', async (e) => {
          e.target.disabled = true;
          try {
            const r = await ctx.api.post(`/api/leads/${lead.id}/quotation/send`);
            ctx.toast('Cotización marcada como enviada', 'success');
            showView(r.quotation);
            onDone?.();
          } catch (err) {
            ctx.toast(err.message, 'error');
            e.target.disabled = false;
          }
        });
        body.querySelector('[data-confirm]')?.addEventListener('click', () => {
          close();
          // Sin IVA: el monto que se reporta en el CRM es el subtotal, no el total con impuestos.
          openCloseModal({ ...lead, odoo_order_id: q.id, sale_reference: q.name, amount: q.amount_untaxed }, ctx, onDone);
        });
        body.querySelector('[data-edit]')?.addEventListener('click', () => {
          const initial = q.lines.map((l) => ({
            product_id: Array.isArray(l.product_id) ? l.product_id[0] : null,
            product_name: Array.isArray(l.product_id) ? l.product_id[1] : l.name,
            qty: l.product_uom_qty,
            price_unit: l.price_unit,
          }));
          body.innerHTML = `
            <div data-editor></div>
            <div class="flex justify-end gap-2">
              <button type="button" data-cancel-edit class="btn btn-secondary">Cancelar</button>
              <button type="button" data-save-edit class="btn btn-primary">Guardar líneas</button>
            </div>
          `;
          const editor = mountQuotationLineEditor(body.querySelector('[data-editor]'), ctx, initial, { hideValidity: true });
          body.querySelector('[data-cancel-edit]').addEventListener('click', () => showView(q));
          const saveBtn = body.querySelector('[data-save-edit]');
          saveBtn.addEventListener('click', async () => {
            const lines = editor.readLines();
            if (!lines.length) {
              ctx.toast('Agrega al menos un producto con cantidad', 'error');
              return;
            }
            saveBtn.disabled = true;
            try {
              const r = await ctx.api.put(`/api/leads/${lead.id}/quotation`, { lines });
              ctx.toast('Cotización actualizada', 'success');
              showView(r.quotation);
              onDone?.();
            } catch (err) {
              ctx.toast(err.message, 'error');
              saveBtn.disabled = false;
            }
          });
        });
      }
      showView(data.quotation);
    },
  });
}

// Pospone 24h la alerta de "sin cotización" de la Sala 24h (Control SLA):
// accion directa, sin modal, igual que registerFollowup -- es un "todavía
// sigo en esto", no un hito que necesite fecha/hora propia.
export async function markStillInContact(lead, ctx, onDone) {
  try {
    await ctx.api.patch(`/api/leads/${lead.id}/contact-ack`);
    ctx.toast('Recordatorio pospuesto 24h', 'success');
    onDone?.();
  } catch (err) {
    ctx.toast(err.message, 'error');
  }
}

export async function registerFollowup(lead, ctx, onDone) {
  try {
    await ctx.api.post(`/api/leads/${lead.id}/followup`);
    ctx.toast('Seguimiento registrado', 'success');
    onDone?.();
  } catch (err) {
    ctx.toast(err.message, 'error');
  }
}

export function openCloseModal(lead, ctx, onDone) {
  openModal({
    title: `Cerrar venta · ${escapeHtml(lead.client_name)}`,
    render: (body, { close }) => {
      body.innerHTML = `
        <div class="flex gap-2 mb-4">
          <button data-result="ganado" class="close-result-btn flex-1 py-3 rounded-lg border-2 border-secondary text-secondary font-bold hover:bg-secondary-container transition-colors">
            Ganado
          </button>
          <button data-result="perdido" class="close-result-btn flex-1 py-3 rounded-lg border-2 border-outline-variant text-on-surface-variant font-bold hover:bg-surface-container-low transition-colors">
            Perdido
          </button>
        </div>
        <div id="amount-field">
          <label class="block text-label-bold font-label-bold uppercase tracking-wide text-on-surface-variant mb-1">Monto de la venta (COP)</label>
          <input id="close-amount" type="number" min="0" step="1000" placeholder="0" value="${lead.odoo_order_id && lead.amount ? Math.round(lead.amount) : ''}" class="w-full p-2.5 border border-outline-variant rounded-md mb-2 outline-none focus:border-outline focus:ring-2 focus:ring-outline/20" />
          ${
            lead.odoo_order_id
              ? `<p class="text-[11px] text-on-surface-variant mb-4 flex items-start gap-1"><span class="material-symbols-outlined text-[13px]">info</span>Se confirmará la cotización ${escapeHtml(lead.sale_reference || '')} como Pedido de venta en Odoo. El monto de la venta en el CRM (sin IVA) es el que registres aquí.</p>`
              : '<div class="mb-4"></div>'
          }
        </div>
        ${dateFieldHtml('close-at', 'Fecha y hora del cierre')}
        <div class="flex justify-end gap-2">
          <button id="close-cancel" class="px-4 py-2 rounded-lg border border-outline-variant hover:bg-surface-container-low">Cancelar</button>
          <button id="close-ok" class="px-4 py-2 rounded-lg bg-primary text-on-primary font-bold hover:bg-on-primary-fixed-variant">Confirmar cierre</button>
        </div>
      `;
      let result = 'ganado';
      const amountField = body.querySelector('#amount-field');
      body.querySelectorAll('.close-result-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          result = btn.dataset.result;
          amountField.classList.toggle('hidden', result === 'perdido');
        });
      });
      body.querySelector('#close-cancel').addEventListener('click', close);
      const okBtn = body.querySelector('#close-ok');
      okBtn.addEventListener('click', async () => {
        const amount = body.querySelector('#close-amount').value || 0;
        const at = body.querySelector('#close-at').value;
        okBtn.disabled = true;
        try {
          const closed = await ctx.api.post(`/api/leads/${lead.id}/close`, { result, amount, at });
          ctx.toast(result === 'ganado' ? '¡Venta cerrada como ganada!' : 'Lead cerrado como perdido', 'success');
          if (closed && closed.odoo_warning) ctx.toast(closed.odoo_warning, 'error');
          close();
          onDone?.();
        } catch (err) {
          ctx.toast(err.message, 'error');
          okBtn.disabled = false;
        }
      });
    },
  });
}

// Editar los datos basicos de un lead ya creado (nombre, telefono,
// documento, producto, canal, origen/ads, referencia de venta, ciudad,
// notas, fecha de registro) -- antes no habia forma de corregir un error de
// tipeo salvo tocando la base de datos directamente. La fecha de registro
// es clave cuando un lead entro tarde al sistema pero en realidad es de
// dias atras: sin poder corregirla, la fecha de cierre (mas abajo) siempre
// se rechazaba por "anterior al registro" aunque fuera la fecha real.
// Sobre un lead ya cerrado como venta (cerrado_ganado) tambien deja editar
// el monto y la fecha/hora de cierre, para que Ventas Cerradas tenga un
// solo lugar donde corregir todo el registro. No toca estado del embudo ni
// asesor -- eso ya tiene sus propios flujos (reasignar, marcar contactado/
// cotizado, cerrar).
export function openEditLeadModal(lead, ctx, onDone) {
  const isOtherProduct = !!lead.product && !EDIT_PRODUCTS.slice(0, -1).includes(lead.product);
  const isClosedSale = lead.status === 'cerrado_ganado';

  openModal({
    title: `Editar datos · ${escapeHtml(lead.client_name)}`,
    render: (body, { close }) => {
      body.innerHTML = `
        <label class="block text-label-bold font-label-bold uppercase tracking-wide text-on-surface-variant mb-1">Nombre del cliente</label>
        <input id="edit-nombre" type="text" value="${escapeHtml(lead.client_name || '')}" class="w-full p-2.5 border border-outline-variant rounded-md mb-4 outline-none focus:border-outline focus:ring-2 focus:ring-outline/20" />
        <div class="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label class="block text-label-bold font-label-bold uppercase tracking-wide text-on-surface-variant mb-1">Teléfono</label>
            <input id="edit-telefono" type="tel" value="${escapeHtml(lead.phone || '')}" class="w-full p-2.5 border border-outline-variant rounded-md outline-none focus:border-outline focus:ring-2 focus:ring-outline/20" />
          </div>
          <div>
            <label class="block text-label-bold font-label-bold uppercase tracking-wide text-on-surface-variant mb-1">Documento</label>
            <input id="edit-documento" type="text" value="${escapeHtml(lead.document || '')}" class="w-full p-2.5 border border-outline-variant rounded-md outline-none focus:border-outline focus:ring-2 focus:ring-outline/20" />
          </div>
        </div>
        <label class="block text-label-bold font-label-bold uppercase tracking-wide text-on-surface-variant mb-1">Producto de interés</label>
        <select id="edit-producto" class="w-full p-2.5 border border-outline-variant rounded-md mb-2 outline-none focus:border-outline focus:ring-2 focus:ring-outline/20">
          ${EDIT_PRODUCTS.map((p) => `<option value="${p}" ${p === (isOtherProduct ? 'Otro' : lead.product) ? 'selected' : ''}>${p}</option>`).join('')}
        </select>
        <input id="edit-producto-otro" type="text" value="${isOtherProduct ? escapeHtml(lead.product) : ''}" placeholder="Especifica el producto..." class="w-full p-2.5 border border-outline-variant rounded-md mb-4 outline-none focus:border-outline focus:ring-2 focus:ring-outline/20 ${isOtherProduct ? '' : 'hidden'}" />
        <div class="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label class="block text-label-bold font-label-bold uppercase tracking-wide text-on-surface-variant mb-1">Canal de entrada</label>
            <select id="edit-canal" class="w-full p-2.5 border border-outline-variant rounded-md outline-none focus:border-outline focus:ring-2 focus:ring-outline/20">
              ${EDIT_SOURCES.map((s) => `<option value="${s}" ${s === lead.source ? 'selected' : ''}>${s}</option>`).join('')}
            </select>
          </div>
          <div>
            <label class="block text-label-bold font-label-bold uppercase tracking-wide text-on-surface-variant mb-1">Ciudad</label>
            <select id="edit-ciudad" class="w-full p-2.5 border border-outline-variant rounded-md outline-none focus:border-outline focus:ring-2 focus:ring-outline/20">
              <option value="">Sin especificar</option>
              ${COLOMBIA_CITY_NAMES.map((c) => `<option value="${c}" ${c === lead.city ? 'selected' : ''}>${c}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label class="block text-label-bold font-label-bold uppercase tracking-wide text-on-surface-variant mb-1">Origen (¿es de Ads?)</label>
            <select id="edit-origen" class="w-full p-2.5 border border-outline-variant rounded-md outline-none focus:border-outline focus:ring-2 focus:ring-outline/20">
              ${EDIT_CHANNEL_DETAILS.map((c) => `<option value="${c}" ${c === lead.channel_detail ? 'selected' : ''}>${c}</option>`).join('')}
            </select>
          </div>
          <div>
            <label class="block text-label-bold font-label-bold uppercase tracking-wide text-on-surface-variant mb-1">Referencia de venta</label>
            <input id="edit-referencia" type="text" value="${escapeHtml(lead.sale_reference || '')}" placeholder="Ej. S02224" class="w-full p-2.5 border border-outline-variant rounded-md outline-none focus:border-outline focus:ring-2 focus:ring-outline/20 mb-1.5" />
            <div class="flex items-center gap-1.5">
              <button type="button" id="ref-toggle-odoo" class="px-2 py-1 rounded-full text-[11px] font-bold border transition-colors">Odoo (S0...)</button>
              <button type="button" id="ref-toggle-ped" class="px-2 py-1 rounded-full text-[11px] font-bold border transition-colors">PED (pagado)</button>
            </div>
          </div>
        </div>
        ${dateFieldHtml('edit-fecha-registro', 'Fecha y hora de registro del lead', sqlUtcToColombiaInputValue(lead.created_at))}
        ${
          isClosedSale
            ? `<label class="block text-label-bold font-label-bold uppercase tracking-wide text-on-surface-variant mb-1">Monto de la venta (COP)</label>
               <input id="edit-monto" type="number" min="0" step="1000" value="${lead.amount || 0}" class="w-full p-2.5 border border-outline-variant rounded-md mb-4 outline-none focus:border-outline focus:ring-2 focus:ring-outline/20" />
               ${dateFieldHtml('edit-fecha-venta', 'Fecha y hora de la venta', sqlUtcToColombiaInputValue(lead.closed_at))}`
            : ''
        }
        <label class="block text-label-bold font-label-bold uppercase tracking-wide text-on-surface-variant mb-1">Notas</label>
        <textarea id="edit-notas" rows="3" class="w-full p-2.5 border border-outline-variant rounded-md mb-4 outline-none focus:border-outline focus:ring-2 focus:ring-outline/20">${escapeHtml(lead.notes || '')}</textarea>
        <div class="flex justify-end gap-2">
          <button id="edit-cancel" class="px-4 py-2 rounded-lg border border-outline-variant hover:bg-surface-container-low">Cancelar</button>
          <button id="edit-ok" class="px-4 py-2 rounded-lg bg-primary text-on-primary font-bold hover:bg-on-primary-fixed-variant">Guardar cambios</button>
        </div>
      `;
      const productoSelect = body.querySelector('#edit-producto');
      const productoOtro = body.querySelector('#edit-producto-otro');
      productoSelect.addEventListener('change', () => {
        productoOtro.classList.toggle('hidden', productoSelect.value !== 'Otro');
      });

      // Atajo Odoo/PED: en vez de retipear la referencia completa, un click
      // pasa de la cotizacion de Odoo (S0...) a PED (facturado/pagado) o
      // viceversa, conservando el numero. El input sigue siendo texto libre
      // por si la referencia real no calza con ninguno de los dos formatos.
      const refInput = body.querySelector('#edit-referencia');
      const refOdooBtn = body.querySelector('#ref-toggle-odoo');
      const refPedBtn = body.querySelector('#ref-toggle-ped');
      const REF_BTN_BASE = 'px-2 py-1 rounded-full text-[11px] font-bold border transition-colors';
      const REF_BTN_OFF = 'border-outline-variant text-on-surface-variant hover:bg-surface-container-low';
      function refDigits(value) {
        return (value || '').match(/\d+/)?.[0] || '';
      }
      function paintRefToggle() {
        // Mismo criterio de color que el badge de Ventas Cerradas (ver saleReferenceBadge).
        const isPed = /^PED/i.test((refInput.value || '').trim());
        const hasValue = !!(refInput.value || '').trim();
        refOdooBtn.className = `${REF_BTN_BASE} ${hasValue && !isPed ? 'border-tertiary bg-tertiary-container text-on-tertiary-container' : REF_BTN_OFF}`;
        refPedBtn.className = `${REF_BTN_BASE} ${hasValue && isPed ? 'border-secondary bg-secondary-container text-on-secondary-container' : REF_BTN_OFF}`;
      }
      refOdooBtn.addEventListener('click', () => {
        const digits = refDigits(refInput.value);
        refInput.value = `S0${digits}`;
        paintRefToggle();
      });
      refPedBtn.addEventListener('click', () => {
        const digits = refDigits(refInput.value);
        refInput.value = `PED ${digits}`.trim();
        paintRefToggle();
      });
      refInput.addEventListener('input', paintRefToggle);
      paintRefToggle();

      body.querySelector('#edit-cancel').addEventListener('click', close);
      body.querySelector('#edit-ok').addEventListener('click', async () => {
        const client_name = body.querySelector('#edit-nombre').value.trim();
        const phone = body.querySelector('#edit-telefono').value.trim();
        if (!client_name || !phone) {
          ctx.toast('Nombre y teléfono son obligatorios', 'error');
          return;
        }
        const montoInput = body.querySelector('#edit-monto');
        if (montoInput && (montoInput.value === '' || Number(montoInput.value) < 0)) {
          ctx.toast('Ingresa un monto válido', 'error');
          return;
        }
        const product = productoSelect.value === 'Otro' ? productoOtro.value.trim() || 'Otro' : productoSelect.value;
        try {
          await ctx.api.patch(`/api/leads/${lead.id}`, {
            client_name,
            phone,
            document: body.querySelector('#edit-documento').value.trim(),
            product,
            source: body.querySelector('#edit-canal').value,
            city: body.querySelector('#edit-ciudad').value,
            channel_detail: body.querySelector('#edit-origen').value,
            sale_reference: body.querySelector('#edit-referencia').value.trim(),
            notes: body.querySelector('#edit-notas').value.trim(),
          });
          // La fecha de registro va ANTES que la de cierre a proposito: si se
          // estan corrigiendo las dos a la vez (un lead que entro tarde al
          // sistema pero en realidad es de dias atras), /closed-at valida
          // contra el created_at que haya en ese momento en la base -- si se
          // mandara al reves, seguiria viendo el created_at viejo (tardio) y
          // rechazaria la fecha real de la venta por "anterior al registro".
          const fechaRegistroInput = body.querySelector('#edit-fecha-registro');
          await ctx.api.patch(`/api/leads/${lead.id}/created-at`, { at: fechaRegistroInput.value });
          if (montoInput) {
            await ctx.api.patch(`/api/leads/${lead.id}/amount`, { amount: montoInput.value });
            const fechaVentaInput = body.querySelector('#edit-fecha-venta');
            await ctx.api.patch(`/api/leads/${lead.id}/closed-at`, { at: fechaVentaInput.value });
          }
          ctx.toast('Datos del lead actualizados', 'success');
          close();
          onDone?.();
        } catch (err) {
          ctx.toast(err.message, 'error');
        }
      });
    },
  });
}

// Elimina un lead por completo (registro de prueba, duplicado, error de
// captura). Distinto a "Cerrar como perdido": esto borra el registro, no
// solo lo cierra -- por eso pide confirmación explícita y no se puede
// deshacer desde la UI.
export async function deleteLead(lead, ctx, onDone) {
  const ok = await confirmModal({
    title: `Eliminar lead · ${escapeHtml(lead.client_name)}`,
    message: 'Esto borra el lead por completo (datos, abonos, historial de reasignaciones) y, si tenía oportunidad en Odoo, la archiva allá también. No se puede deshacer.',
    confirmLabel: 'Eliminar',
    danger: true,
  });
  if (!ok) return;
  try {
    const result = await ctx.api.del(`/api/leads/${lead.id}`);
    ctx.toast('Lead eliminado', 'success');
    if (result && result.odoo_warning) ctx.toast(result.odoo_warning, 'error');
    onDone?.();
  } catch (err) {
    ctx.toast(err.message, 'error');
  }
}

export async function confirmFactoryReset(ctx) {
  return confirmModal({
    title: 'Restaurar de fábrica',
    message: 'Esto eliminará todos los leads, ventas, clientes, abonos e historial de reasignaciones, y restaurará los asesores por defecto. Esta acción no se puede deshacer.',
    confirmLabel: 'Restaurar sistema',
    danger: true,
    requirePhrase: 'RESTAURAR',
  });
}
