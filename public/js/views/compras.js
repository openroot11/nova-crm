import { escapeHtml, formatMoney } from '../utils.js';
import { openModal, confirmModal } from '../components/modal.js';

// Compras (ERP): proveedores y órdenes de compra de materiales. Recibir una
// orden sube el inventario solo (con el costo de cada línea); pagarle al
// proveedor registra el egreso en Caja. Ver server/routes/purchases.js.

const STATUS = {
  borrador: { label: 'Borrador', cls: 'bg-surface-container-high text-on-surface-variant' },
  pedida: { label: 'Pedida', cls: 'bg-tertiary-container text-on-tertiary-container' },
  recibida: { label: 'Recibida', cls: 'bg-secondary-container text-on-secondary-container' },
  cancelada: { label: 'Cancelada', cls: 'bg-surface-container-high text-on-surface-variant line-through' },
};
const UNIT_SHORT = { m: 'm', m2: 'm²', und: 'und', kg: 'kg', rollo: 'rollos', lt: 'lt' };
const METHOD_LABEL = { efectivo: 'Efectivo', transferencia: 'Transferencia', tarjeta: 'Tarjeta', nequi: 'Nequi', otro: 'Otro' };

const inputCls = 'w-full p-2.5 border border-outline-variant rounded-md outline-none focus:border-outline bg-surface-container-lowest';
const labelCls = 'block text-[10px] font-label-bold uppercase tracking-wider text-on-surface-variant mb-1';

function fmtDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '—';
}
function localToday(offset = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function statusBadge(s) {
  const b = STATUS[s] || STATUS.borrador;
  return `<span class="inline-flex px-2 py-0.5 rounded text-[11px] font-bold ${b.cls}">${b.label}</span>`;
}

export async function mount(container, ctx) {
  container.innerHTML = `
    <div class="flex justify-between items-end mb-margin-desktop flex-wrap gap-3">
      <div>
        <h2 class="text-headline-lg font-headline-lg text-on-surface">Compras</h2>
        <p class="text-body-md font-body-md text-on-surface-variant mt-1">Proveedores y pedidos de material. Al recibir un pedido, el inventario sube solo.</p>
      </div>
      <div class="flex gap-2 flex-wrap">
        <button id="cp-suppliers" class="btn btn-secondary"><span class="material-symbols-outlined">storefront</span>Proveedores</button>
        <button id="cp-new" class="btn btn-primary"><span class="material-symbols-outlined">add</span>Nueva orden de compra</button>
      </div>
    </div>

    <div id="cp-suggest" class="mb-gutter"></div>
    <div id="cp-kpis" class="grid grid-cols-2 lg:grid-cols-4 gap-gutter mb-gutter"></div>

    <div class="bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm overflow-hidden">
      <div class="p-4 border-b border-outline-variant bg-surface-container-low flex flex-wrap gap-3 items-end">
        <div>
          <label class="${labelCls}">Estado</label>
          <select id="cp-status" class="p-2 bg-surface-container-lowest border border-outline-variant rounded-md text-body-sm outline-none focus:border-outline">
            <option value="">Todas</option>
            ${Object.entries(STATUS).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full text-left border-collapse min-w-[720px]">
          <thead>
            <tr class="border-b border-outline-variant">
              ${['Orden', 'Proveedor', 'Estado', 'Fecha esperada', 'Total', 'Por pagar'].map((h, i) => `<th class="p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase tracking-wider ${i >= 4 ? 'text-right' : ''}">${h}</th>`).join('')}
            </tr>
          </thead>
          <tbody id="cp-tbody" class="divide-y divide-outline-variant"></tbody>
        </table>
      </div>
    </div>
  `;

  const tbody = container.querySelector('#cp-tbody');
  const statusFilter = container.querySelector('#cp-status');
  let orders = [];
  let suppliers = [];
  let materials = [];
  let methods = Object.keys(METHOD_LABEL);

  async function load() {
    try {
      const [o, s, m, sug] = await Promise.all([
        ctx.api.get('/api/purchases/orders'),
        ctx.api.get('/api/purchases/suppliers'),
        ctx.api.get('/api/materials'),
        ctx.api.get('/api/purchases/suggestions'),
      ]);
      orders = o;
      suppliers = s;
      materials = m;
      renderSuggest(sug);
      renderKpis();
      render();
    } catch (err) {
      ctx.toast(err.message || 'No se pudieron cargar las compras', 'error');
    }
  }

  function renderSuggest(sug) {
    const el = container.querySelector('#cp-suggest');
    if (!sug.length) {
      el.innerHTML = '';
      return;
    }
    el.innerHTML = `
      <div class="border border-error/40 bg-error-container/10 rounded-xl p-4 flex items-center justify-between gap-3 flex-wrap">
        <div class="min-w-0">
          <p class="text-body-sm font-bold text-on-surface flex items-center gap-1.5"><span class="material-symbols-outlined text-[18px] text-error">warning</span>${sug.length} material${sug.length === 1 ? '' : 'es'} en stock bajo</p>
          <p class="text-[12px] text-on-surface-variant truncate">${sug.map((s) => escapeHtml(s.material_name)).join(' · ')}</p>
        </div>
        <button id="cp-suggest-btn" class="btn btn-secondary text-[12px]">Armar orden de compra</button>
      </div>`;
    el.querySelector('#cp-suggest-btn').addEventListener('click', () => openOrderEditor(null, sug));
  }

  function renderKpis() {
    const open = orders.filter((o) => o.status === 'pedida');
    const debt = orders.filter((o) => o.status === 'recibida').reduce((s, o) => s + o.balance, 0);
    const month = localToday().slice(0, 7);
    const boughtMonth = orders.filter((o) => o.status === 'recibida' && String(o.received_at || '').slice(0, 7) === month).reduce((s, o) => s + o.total, 0);
    const kpi = (label, v, hint = '') => `
      <div class="border border-outline-variant rounded-xl p-4 bg-surface-container-lowest">
        <p class="text-[10px] font-label-bold text-on-surface-variant uppercase tracking-wider mb-1">${label}</p>
        <p class="text-headline-sm font-headline-sm text-on-surface">${v}</p>
        ${hint ? `<p class="text-[11px] text-on-surface-variant mt-0.5">${hint}</p>` : ''}
      </div>`;
    container.querySelector('#cp-kpis').innerHTML = [
      kpi('Pedidos en camino', open.length, open.length ? `${formatMoney(open.reduce((s, o) => s + o.total, 0))} por recibir` : ''),
      kpi('Por pagar a proveedores', formatMoney(debt), 'De pedidos ya recibidos'),
      kpi('Comprado este mes', formatMoney(boughtMonth)),
      kpi('Proveedores activos', suppliers.length),
    ].join('');
  }

  function render() {
    const list = orders.filter((o) => !statusFilter.value || o.status === statusFilter.value);
    tbody.innerHTML = list.length
      ? list
          .map(
            (o) => `
        <tr data-open="${o.id}" class="cursor-pointer hover:bg-surface-container-low">
          <td class="p-table-cell-padding font-bold text-on-surface">${escapeHtml(o.number)}</td>
          <td class="p-table-cell-padding text-body-sm text-on-surface">${escapeHtml(o.supplier_name)}<span class="block text-[11px] text-on-surface-variant">${o.lines_count} material${o.lines_count === 1 ? '' : 'es'}</span></td>
          <td class="p-table-cell-padding">${statusBadge(o.status)}</td>
          <td class="p-table-cell-padding text-body-sm text-on-surface-variant">${o.status === 'recibida' ? `Recibida ${fmtDate(o.received_at)}` : fmtDate(o.expected_date)}</td>
          <td class="p-table-cell-padding text-right text-body-sm text-on-surface">${formatMoney(o.total)}</td>
          <td class="p-table-cell-padding text-right text-body-sm ${o.balance > 0 && o.status === 'recibida' ? 'font-bold text-error' : 'text-on-surface-variant'}">${o.status === 'cancelada' ? '—' : formatMoney(o.balance)}</td>
        </tr>`
          )
          .join('')
      : `<tr><td colspan="6" class="p-table-cell-padding py-8 text-center text-body-sm text-on-surface-variant">${orders.length ? 'Ninguna orden con ese estado.' : 'Aún no hay órdenes de compra.'}</td></tr>`;
  }

  // ---- crear/editar una orden de compra --------------------------------------
  function openOrderEditor(po = null, preset = null) {
    if (!suppliers.length) {
      ctx.toast('Primero agrega un proveedor', 'error');
      openSuppliers();
      return;
    }
    const initial = po ? po.lines : preset || [];
    openModal({
      title: po ? `Editar ${po.number}` : 'Nueva orden de compra',
      wide: true,
      render: (body, { close }) => {
        body.innerHTML = `
          <div class="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
            <div><label class="${labelCls}">Proveedor</label>
              <select id="po-supplier" ${po ? 'disabled' : ''} class="${inputCls}">${suppliers.map((s) => `<option value="${s.id}" ${po && po.supplier_id === s.id ? 'selected' : ''}>${escapeHtml(s.name)}</option>`).join('')}</select>
            </div>
            <div><label class="${labelCls}">Fecha esperada de llegada</label><input id="po-date" type="date" value="${po ? po.expected_date || '' : localToday(3)}" class="${inputCls}" /></div>
          </div>
          <p class="${labelCls}">Materiales</p>
          <div id="po-lines" class="space-y-2"></div>
          <button id="po-add" class="btn btn-ghost text-[12px] mt-2"><span class="material-symbols-outlined">add</span>Agregar material</button>
          <div class="mt-3"><label class="${labelCls}">Notas</label><input id="po-notes" type="text" value="${escapeHtml(po?.notes || '')}" class="${inputCls}" /></div>
          <div class="flex items-center justify-between mt-4 gap-3">
            <p class="text-body-md text-on-surface">Total: <b id="po-total">${formatMoney(0)}</b></p>
            <div class="flex gap-2"><button id="po-cancel" class="btn btn-ghost">Cancelar</button><button id="po-ok" class="btn btn-primary">${po ? 'Guardar' : 'Crear borrador'}</button></div>
          </div>`;
        const linesEl = body.querySelector('#po-lines');
        const recalc = () => {
          let t = 0;
          linesEl.querySelectorAll('[data-line]').forEach((r) => (t += (Number(r.querySelector('[data-qty]').value) || 0) * (Number(r.querySelector('[data-cost]').value) || 0)));
          body.querySelector('#po-total').textContent = formatMoney(t);
        };
        const addLine = (l = {}) => {
          const row = document.createElement('div');
          row.dataset.line = '';
          row.className = 'grid grid-cols-[minmax(0,1fr)_90px_120px_32px] gap-2 items-center';
          row.innerHTML = `
            <select data-mat class="${inputCls} !p-2 text-body-sm">${materials.map((m) => `<option value="${m.id}" data-cost="${m.cost}" ${m.id === l.material_id ? 'selected' : ''}>${escapeHtml(m.name)} (${UNIT_SHORT[m.unit] || m.unit})</option>`).join('')}</select>
            <input data-qty type="number" min="0" step="0.1" value="${l.qty ?? ''}" placeholder="Cant." class="${inputCls} !p-2 text-body-sm" />
            <input data-cost type="number" min="0" step="100" value="${l.unit_cost ?? (materials[0]?.cost || '')}" placeholder="Costo unit." class="${inputCls} !p-2 text-body-sm" />
            <button data-del class="text-on-surface-variant hover:text-error" aria-label="Quitar"><span class="material-symbols-outlined text-[18px]">delete</span></button>`;
          const sel = row.querySelector('[data-mat]');
          if (!l.material_id) row.querySelector('[data-cost]').value = sel.selectedOptions[0]?.dataset.cost || '';
          sel.addEventListener('change', () => {
            row.querySelector('[data-cost]').value = sel.selectedOptions[0]?.dataset.cost || '';
            recalc();
          });
          row.querySelectorAll('input').forEach((i) => i.addEventListener('input', recalc));
          row.querySelector('[data-del]').addEventListener('click', () => {
            row.remove();
            recalc();
          });
          linesEl.appendChild(row);
        };
        (initial.length ? initial : [{}]).forEach(addLine);
        recalc();
        body.querySelector('#po-add').addEventListener('click', () => addLine());
        body.querySelector('#po-cancel').addEventListener('click', close);
        body.querySelector('#po-ok').addEventListener('click', async () => {
          const lines = [...linesEl.querySelectorAll('[data-line]')].map((r) => ({
            material_id: Number(r.querySelector('[data-mat]').value),
            qty: Number(r.querySelector('[data-qty]').value),
            unit_cost: Number(r.querySelector('[data-cost]').value) || 0,
          }));
          const payload = { lines, expected_date: body.querySelector('#po-date').value, notes: body.querySelector('#po-notes').value };
          try {
            if (po) await ctx.api.put(`/api/purchases/orders/${po.id}`, payload);
            else await ctx.api.post('/api/purchases/orders', { ...payload, supplier_id: Number(body.querySelector('#po-supplier').value) });
            ctx.toast(po ? 'Orden actualizada' : 'Orden de compra creada', 'success');
            close();
            load();
          } catch (err) {
            ctx.toast(err.message, 'error');
          }
        });
      },
    });
  }

  // ---- detalle de una orden de compra ------------------------------------------
  async function openOrder(id) {
    let po;
    try {
      po = await ctx.api.get(`/api/purchases/orders/${id}`);
    } catch (err) {
      ctx.toast(err.message, 'error');
      return;
    }
    openModal({
      title: `${po.number} · ${po.supplier_name}`,
      wide: true,
      render: (body, { close }) => {
        const act = async (path, msg) => {
          try {
            await ctx.api.post(`/api/purchases/orders/${po.id}/${path}`);
            ctx.toast(msg, 'success');
            close();
            load();
          } catch (err) {
            ctx.toast(err.message, 'error');
          }
        };
        body.innerHTML = `
          <div class="flex items-center justify-between gap-3 flex-wrap mb-4">
            <div class="flex items-center gap-2">${statusBadge(po.status)}<span class="text-body-sm text-on-surface-variant">${po.status === 'recibida' ? `Recibida ${fmtDate(po.received_at)}` : `Esperada ${fmtDate(po.expected_date)}`}</span></div>
            <div class="flex gap-2 flex-wrap">
              ${po.status === 'borrador' ? '<button data-a="edit" class="btn btn-ghost text-[12px]"><span class="material-symbols-outlined">edit</span>Editar</button><button data-a="order" class="btn btn-secondary text-[12px]">Marcar como pedida</button>' : ''}
              ${po.status === 'borrador' || po.status === 'pedida' ? '<button data-a="receive" class="btn btn-primary text-[12px]"><span class="material-symbols-outlined">inventory</span>Recibir mercancía</button>' : ''}
              ${po.status === 'recibida' && po.balance > 0 ? '<button data-a="pay" class="btn btn-primary text-[12px]"><span class="material-symbols-outlined">payments</span>Registrar pago</button>' : ''}
            </div>
          </div>
          <div class="border border-outline-variant rounded-lg divide-y divide-outline-variant mb-3">
            ${po.lines.map((l) => `
              <div class="flex items-center justify-between gap-3 px-3 py-2 text-body-sm">
                <span class="min-w-0 truncate text-on-surface">${escapeHtml(l.material_name)}</span>
                <span class="shrink-0 flex gap-4"><span class="text-on-surface-variant">${Number(l.qty).toLocaleString('es-CO')} ${UNIT_SHORT[l.unit] || l.unit} × ${formatMoney(l.unit_cost)}</span><span class="w-28 text-right text-on-surface">${formatMoney(l.qty * l.unit_cost)}</span></span>
              </div>`).join('')}
          </div>
          <div class="flex justify-end gap-6 text-body-sm">
            <span class="text-on-surface-variant">Total: <b class="text-on-surface">${formatMoney(po.total)}</b></span>
            <span class="text-on-surface-variant">Pagado: <b class="text-on-surface">${formatMoney(po.paid)}</b></span>
            <span class="text-on-surface-variant">Saldo: <b class="${po.balance > 0 ? 'text-error' : 'text-on-surface'}">${formatMoney(po.balance)}</b></span>
          </div>
          ${po.notes ? `<p class="text-body-sm text-on-surface-variant mt-3">${escapeHtml(po.notes)}</p>` : ''}
          ${po.status === 'borrador' || po.status === 'pedida' ? '<div class="border-t border-outline-variant pt-3 mt-4 text-right"><button data-a="cancel" class="text-body-sm text-error inline-flex items-center gap-1"><span class="material-symbols-outlined text-[16px]">cancel</span>Cancelar orden</button></div>' : ''}`;
        body.querySelector('[data-a="edit"]')?.addEventListener('click', () => {
          close();
          openOrderEditor(po);
        });
        body.querySelector('[data-a="order"]')?.addEventListener('click', () => act('order', 'Orden marcada como pedida'));
        body.querySelector('[data-a="receive"]')?.addEventListener('click', async () => {
          const ok = await confirmModal({ title: `Recibir ${po.number}`, message: 'Cada material de la orden entra al inventario con su costo. ¿Llegó todo?', confirmLabel: 'Sí, recibir' });
          if (ok) act('receive', 'Mercancía recibida: inventario actualizado');
        });
        body.querySelector('[data-a="cancel"]')?.addEventListener('click', async () => {
          const ok = await confirmModal({ title: `Cancelar ${po.number}`, message: 'La orden queda cancelada y no entra nada al inventario.', confirmLabel: 'Cancelar orden', danger: true });
          if (ok) act('cancel', 'Orden cancelada');
        });
        body.querySelector('[data-a="pay"]')?.addEventListener('click', () => {
          close();
          openPay(po);
        });
      },
    });
  }

  function openPay(po) {
    openModal({
      title: `Pago a ${po.supplier_name} · ${po.number}`,
      render: (body, { close }) => {
        body.innerHTML = `
          <p class="text-body-sm text-on-surface-variant mb-3">Queda registrado como egreso en Caja (Compra de materiales).</p>
          <div class="grid grid-cols-2 gap-3">
            <div><label class="${labelCls}">Valor</label><input id="pp-amount" type="number" min="0" step="1000" value="${po.balance}" class="${inputCls}" /></div>
            <div><label class="${labelCls}">Medio</label><select id="pp-method" class="${inputCls}">${methods.map((m) => `<option value="${m}" ${m === 'transferencia' ? 'selected' : ''}>${METHOD_LABEL[m] || m}</option>`).join('')}</select></div>
          </div>
          <div class="mt-3"><label class="${labelCls}">Fecha</label><input id="pp-date" type="date" value="${localToday()}" class="${inputCls}" /></div>
          <div class="flex justify-end gap-2 mt-4"><button id="pp-cancel" class="btn btn-ghost">Cancelar</button><button id="pp-ok" class="btn btn-primary">Registrar pago</button></div>`;
        body.querySelector('#pp-cancel').addEventListener('click', close);
        body.querySelector('#pp-ok').addEventListener('click', async () => {
          try {
            await ctx.api.post('/api/cash/entries', {
              kind: 'egreso',
              category: 'Compra de materiales',
              amount: Number(body.querySelector('#pp-amount').value),
              method: body.querySelector('#pp-method').value,
              description: po.supplier_name,
              entry_date: body.querySelector('#pp-date').value,
              purchase_order_id: po.id,
            });
            ctx.toast('Pago registrado en Caja', 'success');
            close();
            load();
          } catch (err) {
            ctx.toast(err.message, 'error');
          }
        });
      },
    });
  }

  // ---- proveedores ------------------------------------------------------------------
  function openSuppliers() {
    openModal({
      title: 'Proveedores',
      wide: true,
      render: (body) => {
        async function paint() {
          const all = await ctx.api.get('/api/purchases/suppliers?all=1');
          body.innerHTML = `
            <div class="divide-y divide-outline-variant border border-outline-variant rounded-lg mb-4">
              ${all.length ? all.map((s) => `
                <div class="flex items-center justify-between gap-3 px-3 py-2 ${s.active ? '' : 'opacity-60'}">
                  <div class="min-w-0">
                    <p class="text-body-sm font-bold text-on-surface truncate">${escapeHtml(s.name)}${s.nit ? ` <span class="font-normal text-on-surface-variant">· NIT ${escapeHtml(s.nit)}</span>` : ''}</p>
                    <p class="text-[11px] text-on-surface-variant truncate">${[s.contact, s.phone, s.email].filter(Boolean).map(escapeHtml).join(' · ') || 'Sin datos de contacto'}</p>
                    <p class="text-[11px] text-on-surface-variant">${s.orders_count} orden(es) · comprado ${formatMoney(s.total_bought)}</p>
                  </div>
                  <div class="shrink-0 flex gap-1.5">
                    <button data-edit="${s.id}" class="p-1 border border-outline-variant rounded text-on-surface-variant hover:bg-surface-container-low" aria-label="Editar"><span class="material-symbols-outlined text-[18px]">edit</span></button>
                    <button data-toggle="${s.id}" data-active="${s.active ? 1 : 0}" class="px-3 py-1 border border-outline-variant rounded text-[12px] font-label-bold ${s.active ? 'text-error' : 'text-on-surface'} hover:bg-surface-container-low">${s.active ? 'Desactivar' : 'Reactivar'}</button>
                  </div>
                </div>`).join('') : '<p class="px-3 py-3 text-body-sm text-on-surface-variant">Aún no hay proveedores.</p>'}
            </div>
            <button id="sp-add" class="btn btn-primary text-[12px]"><span class="material-symbols-outlined">add</span>Nuevo proveedor</button>`;
          body.querySelectorAll('[data-toggle]').forEach((b) =>
            b.addEventListener('click', async () => {
              await ctx.api.patch(`/api/purchases/suppliers/${b.dataset.toggle}`, { active: b.dataset.active !== '1' });
              await paint();
              load();
            })
          );
          body.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => supplierForm(all.find((s) => s.id === Number(b.dataset.edit)), paint)));
          body.querySelector('#sp-add').addEventListener('click', () => supplierForm(null, paint));
        }
        paint();
      },
    });
  }

  function supplierForm(s, onDone) {
    const f = (id, label, value, type = 'text') => `<div><label class="${labelCls}">${label}</label><input id="${id}" type="${type}" value="${escapeHtml(value || '')}" class="${inputCls}" /></div>`;
    openModal({
      title: s ? `Editar · ${s.name}` : 'Nuevo proveedor',
      render: (body, { close }) => {
        body.innerHTML = `
          <div class="space-y-3">
            ${f('sf-name', 'Nombre *', s?.name)}
            <div class="grid grid-cols-2 gap-3">${f('sf-nit', 'NIT', s?.nit)}${f('sf-contact', 'Contacto', s?.contact)}</div>
            <div class="grid grid-cols-2 gap-3">${f('sf-phone', 'Teléfono', s?.phone, 'tel')}${f('sf-email', 'Correo', s?.email, 'email')}</div>
            ${f('sf-notes', 'Notas', s?.notes)}
          </div>
          <div class="flex justify-end gap-2 mt-4"><button id="sf-cancel" class="btn btn-ghost">Cancelar</button><button id="sf-ok" class="btn btn-primary">${s ? 'Guardar' : 'Crear'}</button></div>`;
        body.querySelector('#sf-cancel').addEventListener('click', close);
        body.querySelector('#sf-ok').addEventListener('click', async () => {
          const payload = Object.fromEntries(['name', 'nit', 'contact', 'phone', 'email', 'notes'].map((k) => [k, body.querySelector(`#sf-${k}`).value.trim()]));
          if (!payload.name) {
            ctx.toast('El nombre es obligatorio', 'error');
            return;
          }
          try {
            if (s) await ctx.api.patch(`/api/purchases/suppliers/${s.id}`, payload);
            else await ctx.api.post('/api/purchases/suppliers', payload);
            ctx.toast('Proveedor guardado', 'success');
            close();
            await onDone?.();
            load();
          } catch (err) {
            ctx.toast(err.message, 'error');
          }
        });
      },
    });
  }

  tbody.addEventListener('click', (e) => {
    const row = e.target.closest('[data-open]');
    if (row) openOrder(Number(row.dataset.open));
  });
  statusFilter.addEventListener('change', render);
  container.querySelector('#cp-new').addEventListener('click', () => openOrderEditor());
  container.querySelector('#cp-suppliers').addEventListener('click', openSuppliers);

  try {
    methods = (await ctx.api.get('/api/cash/meta')).methods;
  } catch {
    /* se quedan los medios por defecto */
  }
  const off = ctx.ws.on('purchases_changed', load);
  await load();
  return () => off();
}
