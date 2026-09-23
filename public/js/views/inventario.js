import { escapeHtml, formatMoney } from '../utils.js';
import { openModal } from '../components/modal.js';

// Inventario (ERP): materiales del taller y sus existencias. El stock solo
// cambia por movimientos (entrada = compra, ajuste = conteo físico; los
// consumos y devoluciones salen de cada orden en Taller), así que cada
// material tiene su historial ("kárdex"). Ver server/routes/materials.js.

const UNITS = [
  { value: 'm', label: 'metros (m)' },
  { value: 'm2', label: 'metros cuadrados (m²)' },
  { value: 'und', label: 'unidades' },
  { value: 'kg', label: 'kilos' },
  { value: 'rollo', label: 'rollos' },
  { value: 'lt', label: 'litros' },
];
const UNIT_SHORT = { m: 'm', m2: 'm²', und: 'und', kg: 'kg', rollo: 'rollos', lt: 'lt' };
const MOVE_LABEL = { entrada: 'Entrada', consumo: 'Consumo', devolucion: 'Devolución', ajuste: 'Ajuste' };

function fmtQty(n) {
  return Number(n).toLocaleString('es-CO', { maximumFractionDigits: 3 });
}
function stripAccents(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}
function fmtDateTime(utc) {
  if (!utc) return '—';
  const d = new Date(`${utc.replace(' ', 'T')}Z`);
  return d.toLocaleString('es-CO', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

const inputCls = 'w-full p-2.5 border border-outline-variant rounded-md outline-none focus:border-outline bg-surface-container-lowest';
const labelCls = 'block text-[10px] font-label-bold uppercase tracking-wider text-on-surface-variant mb-1';

export async function mount(container, ctx) {
  const canManage = ctx.user?.role === 'admin' || ctx.user?.role === 'coordinador';

  container.innerHTML = `
    <div class="flex justify-between items-end mb-margin-desktop flex-wrap gap-3">
      <div>
        <h2 class="text-headline-lg font-headline-lg text-on-surface">Inventario</h2>
        <p class="text-body-md font-body-md text-on-surface-variant mt-1">Materiales del taller: cuánto hay, cuánto vale y cuándo hay que comprar.</p>
      </div>
      ${canManage ? '<button id="iv-new" class="btn btn-primary"><span class="material-symbols-outlined">add</span>Nuevo material</button>' : ''}
    </div>

    <div id="iv-kpis" class="grid grid-cols-2 lg:grid-cols-4 gap-gutter mb-gutter"></div>

    <div class="bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm overflow-hidden">
      <div class="p-4 border-b border-outline-variant bg-surface-container-low flex flex-wrap gap-3 items-end">
        <div class="min-w-[220px] flex-1">
          <label class="${labelCls}">Buscar</label>
          <input id="iv-q" type="text" placeholder="Cuero, espuma, hilo…" class="w-full p-2 bg-surface-container-lowest border border-outline-variant rounded-md text-body-sm outline-none focus:border-outline" />
        </div>
        <label class="flex items-center gap-1.5 text-body-sm text-on-surface-variant pb-2 cursor-pointer">
          <input id="iv-low" type="checkbox" class="rounded border-outline-variant" />
          Solo stock bajo
        </label>
        <label class="flex items-center gap-1.5 text-body-sm text-on-surface-variant pb-2 cursor-pointer">
          <input id="iv-inactive" type="checkbox" class="rounded border-outline-variant" />
          Mostrar inactivos
        </label>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full text-left border-collapse min-w-[720px]">
          <thead>
            <tr class="border-b border-outline-variant">
              <th class="p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase tracking-wider">Material</th>
              <th class="p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase tracking-wider text-right">Existencia</th>
              <th class="p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase tracking-wider text-right">Mínimo</th>
              <th class="p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase tracking-wider text-right">Costo unit.</th>
              <th class="p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase tracking-wider text-right">Valor</th>
              <th class="p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase tracking-wider text-right">Acciones</th>
            </tr>
          </thead>
          <tbody id="iv-tbody" class="divide-y divide-outline-variant"></tbody>
        </table>
      </div>
    </div>
  `;

  const tbody = container.querySelector('#iv-tbody');
  const qInput = container.querySelector('#iv-q');
  const lowCheck = container.querySelector('#iv-low');
  const inactiveCheck = container.querySelector('#iv-inactive');
  let materials = [];

  function renderKpis() {
    const active = materials.filter((m) => m.active);
    const low = active.filter((m) => m.low_stock);
    const value = active.reduce((s, m) => s + (m.value || 0), 0);
    const kpi = (label, v, hint = '', alert = false) => `
      <div class="border ${alert ? 'border-error/40' : 'border-outline-variant'} rounded-xl p-4 bg-surface-container-lowest">
        <p class="text-[10px] font-label-bold text-on-surface-variant uppercase tracking-wider mb-1">${label}</p>
        <p class="text-headline-sm font-headline-sm ${alert ? 'text-error' : 'text-on-surface'}">${v}</p>
        ${hint ? `<p class="text-[11px] text-on-surface-variant mt-0.5">${hint}</p>` : ''}
      </div>`;
    container.querySelector('#iv-kpis').innerHTML = [
      kpi('Materiales', active.length),
      kpi('Stock bajo', low.length, low.length ? 'Hay que comprar' : 'Todo en orden', low.length > 0),
      kpi('Valor del inventario', formatMoney(value), 'Existencia × costo'),
      kpi('Sin existencia', active.filter((m) => !(Number(m.stock) > 0)).length),
    ].join('');
  }

  function rowHtml(m) {
    const u = UNIT_SHORT[m.unit] || m.unit;
    return `
      <tr class="${m.active ? '' : 'opacity-60'}">
        <td class="p-table-cell-padding">
          <p class="font-semibold text-on-surface">${escapeHtml(m.name)}</p>
          ${m.low_stock ? '<span class="inline-flex mt-0.5 px-2 py-0.5 rounded text-[10px] font-bold bg-error-container text-on-error-container">Stock bajo</span>' : ''}
          ${m.active ? '' : '<span class="inline-flex mt-0.5 px-2 py-0.5 rounded text-[10px] font-bold bg-surface-container-high text-on-surface-variant">Inactivo</span>'}
        </td>
        <td class="p-table-cell-padding text-right font-bold ${m.low_stock ? 'text-error' : 'text-on-surface'}">${fmtQty(m.stock)} ${u}</td>
        <td class="p-table-cell-padding text-right text-body-sm text-on-surface-variant">${fmtQty(m.min_stock)} ${u}</td>
        <td class="p-table-cell-padding text-right text-body-sm text-on-surface">${formatMoney(m.cost)}</td>
        <td class="p-table-cell-padding text-right text-body-sm text-on-surface">${formatMoney(m.value)}</td>
        <td class="p-table-cell-padding text-right">
          <div class="flex justify-end gap-1.5">
            ${canManage && m.active ? `<button data-act="entrada" data-id="${m.id}" class="px-2.5 py-1 border border-outline-variant rounded text-[12px] font-label-bold text-on-surface hover:bg-surface-container-low" title="Registrar compra o recepción">+ Entrada</button>` : ''}
            ${canManage && m.active ? `<button data-act="ajuste" data-id="${m.id}" class="px-2.5 py-1 border border-outline-variant rounded text-[12px] font-label-bold text-on-surface hover:bg-surface-container-low" title="Corregir con un conteo físico">Ajustar</button>` : ''}
            <button data-act="historial" data-id="${m.id}" class="p-1 border border-outline-variant rounded text-on-surface-variant hover:bg-surface-container-low" title="Historial de movimientos"><span class="material-symbols-outlined text-[18px]">history</span></button>
            ${canManage ? `<button data-act="editar" data-id="${m.id}" class="p-1 border border-outline-variant rounded text-on-surface-variant hover:bg-surface-container-low" title="Editar material"><span class="material-symbols-outlined text-[18px]">edit</span></button>` : ''}
          </div>
        </td>
      </tr>`;
  }

  function render() {
    const terms = stripAccents(qInput.value).split(/\s+/).filter(Boolean);
    const list = materials.filter((m) => {
      if (!inactiveCheck.checked && !m.active) return false;
      if (lowCheck.checked && !m.low_stock) return false;
      const hay = stripAccents(m.name);
      return terms.every((t) => hay.includes(t));
    });
    tbody.innerHTML = list.length
      ? list.map(rowHtml).join('')
      : `<tr><td colspan="6" class="p-table-cell-padding py-8 text-center text-body-sm text-on-surface-variant">${materials.length ? 'Ningún material coincide con los filtros.' : 'Aún no hay materiales. Agrega el primero con "Nuevo material".'}</td></tr>`;
  }

  async function load() {
    try {
      materials = await ctx.api.get('/api/materials?all=1');
      renderKpis();
      render();
    } catch (err) {
      ctx.toast(err.message || 'No se pudo cargar el inventario', 'error');
    }
  }

  function materialForm(m = null) {
    return `
      <div class="space-y-3">
        <div><label class="${labelCls}">Nombre *</label><input id="mf-name" type="text" value="${escapeHtml(m?.name || '')}" placeholder="Ej. Cuero sintético premium negro" class="${inputCls}" /></div>
        <div class="grid grid-cols-2 gap-3">
          <div><label class="${labelCls}">Unidad</label>
            <select id="mf-unit" class="${inputCls}">${UNITS.map((u) => `<option value="${u.value}" ${(m?.unit || 'm') === u.value ? 'selected' : ''}>${u.label}</option>`).join('')}</select>
          </div>
          <div><label class="${labelCls}">Stock mínimo</label><input id="mf-min" type="number" min="0" step="0.1" value="${m ? m.min_stock : ''}" placeholder="Avisar cuando baje de…" class="${inputCls}" /></div>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div><label class="${labelCls}">Costo por unidad</label><input id="mf-cost" type="number" min="0" step="100" value="${m ? m.cost : ''}" placeholder="0" class="${inputCls}" /></div>
          ${m ? '' : `<div><label class="${labelCls}">Existencia inicial</label><input id="mf-stock" type="number" min="0" step="0.1" placeholder="0" class="${inputCls}" /></div>`}
        </div>
        ${m ? `<label class="flex items-center gap-2 text-body-sm text-on-surface-variant"><input id="mf-active" type="checkbox" ${m.active ? 'checked' : ''} class="rounded border-outline-variant" />Activo (se puede usar en órdenes)</label>` : ''}
      </div>`;
  }

  function openMaterialModal(m = null) {
    openModal({
      title: m ? `Editar · ${m.name}` : 'Nuevo material',
      render: (body, { close }) => {
        body.innerHTML = `${materialForm(m)}
          <div class="flex justify-end gap-2 mt-4">
            <button id="mf-cancel" class="btn btn-ghost">Cancelar</button>
            <button id="mf-ok" class="btn btn-primary">${m ? 'Guardar' : 'Crear'}</button>
          </div>`;
        body.querySelector('#mf-cancel').addEventListener('click', close);
        body.querySelector('#mf-ok').addEventListener('click', async () => {
          const payload = {
            name: body.querySelector('#mf-name').value.trim(),
            unit: body.querySelector('#mf-unit').value,
            min_stock: Number(body.querySelector('#mf-min').value) || 0,
            cost: Number(body.querySelector('#mf-cost').value) || 0,
          };
          if (!payload.name) {
            ctx.toast('El nombre es obligatorio', 'error');
            return;
          }
          try {
            if (m) {
              payload.active = body.querySelector('#mf-active').checked;
              await ctx.api.patch(`/api/materials/${m.id}`, payload);
            } else {
              payload.stock = Number(body.querySelector('#mf-stock').value) || 0;
              await ctx.api.post('/api/materials', payload);
            }
            ctx.toast(m ? 'Material actualizado' : 'Material creado', 'success');
            close();
            load();
          } catch (err) {
            ctx.toast(err.message, 'error');
          }
        });
      },
    });
  }

  function openEntrada(m) {
    const u = UNIT_SHORT[m.unit] || m.unit;
    openModal({
      title: `Entrada · ${m.name}`,
      render: (body, { close }) => {
        body.innerHTML = `
          <p class="text-body-sm text-on-surface-variant mb-3">Compra o mercancía recibida. Hay ${fmtQty(m.stock)} ${u} hoy.</p>
          <div class="grid grid-cols-2 gap-3">
            <div><label class="${labelCls}">Cantidad que entra (${u})</label><input id="en-qty" type="number" min="0" step="0.1" class="${inputCls}" /></div>
            <div><label class="${labelCls}">Costo por ${u}</label><input id="en-cost" type="number" min="0" step="100" value="${m.cost || ''}" class="${inputCls}" /></div>
          </div>
          <div class="mt-3"><label class="${labelCls}">Nota</label><input id="en-note" type="text" placeholder="Proveedor, factura…" class="${inputCls}" /></div>
          <div class="flex justify-end gap-2 mt-4">
            <button id="en-cancel" class="btn btn-ghost">Cancelar</button>
            <button id="en-ok" class="btn btn-primary">Registrar entrada</button>
          </div>`;
        body.querySelector('#en-cancel').addEventListener('click', close);
        body.querySelector('#en-ok').addEventListener('click', async () => {
          try {
            await ctx.api.post(`/api/materials/${m.id}/movements`, {
              type: 'entrada',
              qty: Number(body.querySelector('#en-qty').value),
              unit_cost: Number(body.querySelector('#en-cost').value) || 0,
              note: body.querySelector('#en-note').value.trim(),
            });
            ctx.toast('Entrada registrada', 'success');
            close();
            load();
          } catch (err) {
            ctx.toast(err.message, 'error');
          }
        });
      },
    });
  }

  function openAjuste(m) {
    const u = UNIT_SHORT[m.unit] || m.unit;
    openModal({
      title: `Ajuste por conteo · ${m.name}`,
      render: (body, { close }) => {
        body.innerHTML = `
          <p class="text-body-sm text-on-surface-variant mb-3">El sistema dice que hay <b>${fmtQty(m.stock)} ${u}</b>. Escribe lo que contaste de verdad y la diferencia queda registrada.</p>
          <div><label class="${labelCls}">Cantidad contada (${u})</label><input id="aj-count" type="number" min="0" step="0.1" value="${m.stock}" class="${inputCls}" /></div>
          <div class="mt-3"><label class="${labelCls}">Motivo</label><input id="aj-note" type="text" placeholder="Conteo mensual, retazo dañado…" class="${inputCls}" /></div>
          <div class="flex justify-end gap-2 mt-4">
            <button id="aj-cancel" class="btn btn-ghost">Cancelar</button>
            <button id="aj-ok" class="btn btn-primary">Ajustar</button>
          </div>`;
        body.querySelector('#aj-cancel').addEventListener('click', close);
        body.querySelector('#aj-ok').addEventListener('click', async () => {
          try {
            await ctx.api.post(`/api/materials/${m.id}/movements`, {
              type: 'ajuste',
              counted: Number(body.querySelector('#aj-count').value),
              note: body.querySelector('#aj-note').value.trim(),
            });
            ctx.toast('Inventario ajustado', 'success');
            close();
            load();
          } catch (err) {
            ctx.toast(err.message, 'error');
          }
        });
      },
    });
  }

  async function openHistorial(m) {
    let rows;
    try {
      rows = await ctx.api.get(`/api/materials/${m.id}/movements`);
    } catch (err) {
      ctx.toast(err.message, 'error');
      return;
    }
    const u = UNIT_SHORT[m.unit] || m.unit;
    openModal({
      title: `Historial · ${m.name}`,
      wide: true,
      render: (body) => {
        body.innerHTML = rows.length
          ? `<div class="divide-y divide-outline-variant border border-outline-variant rounded-lg">
              ${rows.map((r) => `
                <div class="flex items-center justify-between gap-3 px-3 py-2 text-body-sm">
                  <div class="min-w-0">
                    <p class="text-on-surface"><span class="font-bold">${MOVE_LABEL[r.type]}</span>${r.work_order_number ? ` · <a href="#/taller?orden=${r.work_order_id}" class="underline">${escapeHtml(r.work_order_number)}</a>` : ''}</p>
                    <p class="text-[11px] text-on-surface-variant truncate">${fmtDateTime(r.created_at)}${r.note ? ` · ${escapeHtml(r.note)}` : ''}${r.created_by_name ? ` · ${escapeHtml(r.created_by_name)}` : ''}</p>
                  </div>
                  <span class="shrink-0 font-bold ${r.qty > 0 ? 'text-secondary' : 'text-error'}">${r.qty > 0 ? '+' : ''}${fmtQty(r.qty)} ${u}</span>
                </div>`).join('')}
            </div>`
          : '<p class="text-body-sm text-on-surface-variant">Sin movimientos todavía.</p>';
      },
    });
  }

  tbody.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const m = materials.find((x) => x.id === Number(b.dataset.id));
    if (!m) return;
    if (b.dataset.act === 'entrada') openEntrada(m);
    else if (b.dataset.act === 'ajuste') openAjuste(m);
    else if (b.dataset.act === 'historial') openHistorial(m);
    else if (b.dataset.act === 'editar') openMaterialModal(m);
  });
  let searchDebounce;
  qInput.addEventListener('input', () => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(render, 150);
  });
  lowCheck.addEventListener('change', render);
  inactiveCheck.addEventListener('change', render);
  container.querySelector('#iv-new')?.addEventListener('click', () => openMaterialModal());

  const off = ctx.ws.on('materials_changed', load);
  await load();
  return () => off();
}
