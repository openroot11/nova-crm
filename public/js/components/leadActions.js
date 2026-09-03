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

function dateFieldHtml(id, label = 'Fecha y hora real', initialValue = null) {
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

// Armar la cotización. Si Odoo está configurado (ver server/.env), abre el
// editor de líneas de producto -> crea el sale.order en Odoo (IVA y total
// calculados) -> deja ver / descargar el PDF. Si Odoo NO está configurado,
// cae al modal simple de "marcar cotizado con fecha" de siempre (markQuoted).
const money = (n) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(Number(n) || 0);

export async function openQuotationModal(lead, ctx, onDone) {
  let status;
  try {
    status = await ctx.api.get('/api/odoo/status');
  } catch {
    status = { enabled: false };
  }
  if (!status || !status.enabled || status.ok === false) {
    if (status && status.enabled && status.ok === false) {
      ctx.toast(`Odoo no responde (${status.error || 'error'}). Se cotiza solo en el CRM.`, 'error');
    }
    return markQuoted(lead, ctx, onDone);
  }

  let products = [];
  try {
    products = await ctx.api.get('/api/odoo/products');
  } catch (err) {
    ctx.toast(`No se pudo cargar el catálogo de Odoo: ${err.message}`, 'error');
    return;
  }
  if (!products.length) {
    ctx.toast('Odoo no tiene productos vendibles cargados', 'error');
    return;
  }

  const optionsHtml = products
    .map((p) => `<option value="${p.id}" data-price="${p.price}">${escapeHtml(p.name)}</option>`)
    .join('');

  openModal({
    title: `Cotización en Odoo · ${escapeHtml(lead.client_name)}`,
    wide: true,
    render: (body, { close }) => {
      body.innerHTML = `
        <div id="q-lines" class="space-y-2 mb-2"></div>
        <button id="q-add" type="button" class="btn btn-secondary text-[12px] mb-4">
          <span class="material-symbols-outlined">add</span> Agregar producto
        </button>

        <div class="flex items-end gap-4 mb-4">
          <div>
            <label class="block text-label-bold font-label-bold uppercase tracking-wide text-on-surface-variant mb-1">Validez (días)</label>
            <input id="q-validity" type="number" min="1" value="8" class="w-24 p-2.5 border border-outline-variant rounded-md outline-none focus:border-outline focus:ring-2 focus:ring-outline/20" />
          </div>
          <div class="flex-1 text-right">
            <p class="text-body-sm text-on-surface-variant">Subtotal estimado (sin IVA)</p>
            <p id="q-subtotal" class="text-headline-sm font-headline-sm font-bold text-on-surface">$ 0</p>
          </div>
        </div>

        <div id="q-result" class="hidden mb-4 p-4 rounded-lg bg-secondary-container text-on-secondary-container"></div>

        <div class="flex justify-end gap-2">
          <button id="q-cancel" type="button" class="btn btn-secondary">Cancelar</button>
          <button id="q-ok" type="button" class="btn btn-primary">Crear cotización</button>
        </div>
      `;

      const linesEl = body.querySelector('#q-lines');
      const subtotalEl = body.querySelector('#q-subtotal');

      function lineRow() {
        const row = document.createElement('div');
        row.className = 'q-line grid grid-cols-[1fr_5rem_8rem_auto] gap-2 items-center';
        row.innerHTML = `
          <select class="q-prod p-2 border border-outline-variant rounded-md outline-none focus:border-outline text-body-sm">${optionsHtml}</select>
          <input class="q-qty p-2 border border-outline-variant rounded-md outline-none focus:border-outline text-body-sm" type="number" min="0" step="1" value="1" />
          <input class="q-price p-2 border border-outline-variant rounded-md outline-none focus:border-outline text-body-sm" type="number" min="0" step="1000" placeholder="precio lista" />
          <button type="button" class="q-del btn btn-icon" aria-label="Quitar"><span class="material-symbols-outlined">delete</span></button>
        `;
        const prod = row.querySelector('.q-prod');
        const price = row.querySelector('.q-price');
        const syncPlaceholder = () => {
          const opt = prod.selectedOptions[0];
          price.placeholder = opt ? Number(opt.dataset.price || 0).toLocaleString('es-CO') : 'precio lista';
        };
        prod.addEventListener('change', () => { syncPlaceholder(); recalc(); });
        row.querySelector('.q-qty').addEventListener('input', recalc);
        price.addEventListener('input', recalc);
        row.querySelector('.q-del').addEventListener('click', () => { row.remove(); recalc(); });
        syncPlaceholder();
        linesEl.appendChild(row);
        recalc();
      }

      function readLines() {
        return [...linesEl.querySelectorAll('.q-line')].map((row) => {
          const opt = row.querySelector('.q-prod').selectedOptions[0];
          const priceRaw = row.querySelector('.q-price').value;
          return {
            product_id: Number(row.querySelector('.q-prod').value),
            qty: Number(row.querySelector('.q-qty').value) || 0,
            price_unit: priceRaw === '' ? undefined : Number(priceRaw),
            _listPrice: Number(opt?.dataset.price || 0),
          };
        });
      }

      function recalc() {
        const sub = readLines().reduce((s, l) => s + l.qty * (l.price_unit ?? l._listPrice), 0);
        subtotalEl.textContent = money(sub);
      }

      body.querySelector('#q-add').addEventListener('click', lineRow);
      body.querySelector('#q-cancel').addEventListener('click', close);
      lineRow();

      const okBtn = body.querySelector('#q-ok');
      const resultEl = body.querySelector('#q-result');
      okBtn.addEventListener('click', async () => {
        const lines = readLines().filter((l) => l.product_id && l.qty > 0).map(({ _listPrice, ...l }) => l);
        if (!lines.length) {
          ctx.toast('Agrega al menos un producto con cantidad', 'error');
          return;
        }
        okBtn.dataset.loading = '';
        try {
          const { quotation } = await ctx.api.post(`/api/leads/${lead.id}/quotation`, {
            lines,
            validity_days: Number(body.querySelector('#q-validity').value) || 8,
          });
          resultEl.classList.remove('hidden');
          resultEl.innerHTML = `
            <p class="font-bold text-body-md mb-1">Cotización ${escapeHtml(quotation.name)} creada en Odoo</p>
            <p class="text-body-sm">Subtotal: ${money(quotation.amount_untaxed)} · IVA: ${money(quotation.amount_tax)}</p>
            <p class="text-headline-sm font-headline-sm font-bold mt-1">Total: ${money(quotation.amount_total)}</p>
            <a href="/api/leads/${lead.id}/quotation/pdf" target="_blank" rel="noopener" class="btn btn-primary mt-3 inline-flex">
              <span class="material-symbols-outlined">picture_as_pdf</span> Ver / descargar PDF
            </a>
          `;
          okBtn.textContent = 'Listo';
          okBtn.disabled = true;
          ctx.toast('Cotización creada en Odoo', 'success');
          onDone?.();
        } catch (err) {
          ctx.toast(err.message, 'error');
        } finally {
          delete okBtn.dataset.loading;
        }
      });
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
          <input id="close-amount" type="number" min="0" step="1000" placeholder="0" class="w-full p-2.5 border border-outline-variant rounded-md mb-4 outline-none focus:border-outline focus:ring-2 focus:ring-outline/20" />
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
      body.querySelector('#close-ok').addEventListener('click', async () => {
        const amount = body.querySelector('#close-amount').value || 0;
        const at = body.querySelector('#close-at').value;
        try {
          await ctx.api.post(`/api/leads/${lead.id}/close`, { result, amount, at });
          ctx.toast(result === 'ganado' ? '¡Venta cerrada como ganada!' : 'Lead cerrado como perdido', 'success');
          close();
          onDone?.();
        } catch (err) {
          ctx.toast(err.message, 'error');
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
            <input id="edit-referencia" type="text" value="${escapeHtml(lead.sale_reference || '')}" placeholder="Ej. S02224" class="w-full p-2.5 border border-outline-variant rounded-md outline-none focus:border-outline focus:ring-2 focus:ring-outline/20" />
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

export async function confirmFactoryReset(ctx) {
  return confirmModal({
    title: 'Restaurar de fábrica',
    message: 'Esto eliminará todos los leads, ventas, clientes, abonos e historial de reasignaciones, y restaurará los asesores por defecto. Esta acción no se puede deshacer.',
    confirmLabel: 'Restaurar sistema',
    danger: true,
    requirePhrase: 'RESTAURAR',
  });
}
