import { escapeHtml, formatMoney } from '../utils.js';
import { openModal, confirmModal } from '../components/modal.js';
import { findService } from '../data/velaraServices.js';

// Finanzas (ERP): Caja (lo que entra y sale en el periodo), Cartera (quién
// debe) y Rentabilidad (cuánto deja cada trabajo entregado). Los ingresos
// por ventas son los abonos de clientes que ya registra el CRM; aquí se
// agregan los gastos y otros ingresos. Ver server/routes/cash.js.

const METHOD_LABEL = { efectivo: 'Efectivo', transferencia: 'Transferencia', tarjeta: 'Tarjeta', nequi: 'Nequi', otro: 'Otro', 'sin dato': 'Sin dato' };
const OP_STATUS_LABEL = { por_validar: 'Por validar', programada: 'Programada', en_produccion: 'En producción', pausada: 'Pausada', control: 'Control / revisión', lista: 'Lista para entregar', entregada: 'Entregada', cerrada: 'Cerrada' };
const TABS = [
  { key: 'caja', label: 'Caja', icon: 'account_balance_wallet' },
  { key: 'cartera', label: 'Cartera', icon: 'request_quote' },
  // Rentabilidad (vendido - material consumido) queda oculta mientras
  // Producción no consuma inventario (ver docs/PLAN-PRODUCCION.md).
];

const inputCls = 'w-full p-2.5 border border-outline-variant rounded-md outline-none focus:border-outline bg-surface-container-lowest';
const labelCls = 'block text-[10px] font-label-bold uppercase tracking-wider text-on-surface-variant mb-1';

function iso(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function fmtDate(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value || '');
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '—';
}
const PRESETS = {
  hoy: () => {
    const t = iso(new Date());
    return [t, t];
  },
  mes: () => {
    const d = new Date();
    return [iso(new Date(d.getFullYear(), d.getMonth(), 1)), iso(d)];
  },
  mes_pasado: () => {
    const d = new Date();
    return [iso(new Date(d.getFullYear(), d.getMonth() - 1, 1)), iso(new Date(d.getFullYear(), d.getMonth(), 0))];
  },
};

function kpi(label, value, hint = '', tone = '') {
  return `
    <div class="border ${tone === 'bad' ? 'border-error/40' : 'border-outline-variant'} rounded-xl p-4 bg-surface-container-lowest">
      <p class="text-[10px] font-label-bold text-on-surface-variant uppercase tracking-wider mb-1">${label}</p>
      <p class="text-headline-sm font-headline-sm ${tone === 'bad' ? 'text-error' : tone === 'good' ? 'text-secondary' : 'text-on-surface'}">${value}</p>
      ${hint ? `<p class="text-[11px] text-on-surface-variant mt-0.5">${hint}</p>` : ''}
    </div>`;
}

function bars(list, total) {
  if (!list.length) return '<p class="text-body-sm text-on-surface-variant">Sin datos en el periodo.</p>';
  return list
    .map(
      (r) => `
      <div class="mb-2">
        <div class="flex justify-between text-body-sm"><span class="text-on-surface truncate">${escapeHtml(METHOD_LABEL[r.name] || r.name)}</span><span class="text-on-surface-variant shrink-0">${formatMoney(r.total)}</span></div>
        <div class="h-1.5 rounded-full bg-surface-container-high overflow-hidden"><div class="h-full bg-primary" style="width:${total ? Math.max(2, Math.round((r.total / total) * 100)) : 0}%"></div></div>
      </div>`
    )
    .join('');
}

export async function mount(container, ctx) {
  const isAdmin = ctx.user?.role === 'admin';
  let tab = TABS.some((t) => t.key === ctx.routeParams.get('tab')) ? ctx.routeParams.get('tab') : 'caja';
  let [from, to] = PRESETS.mes();
  let meta = { categories: { egreso: [], ingreso: [] }, methods: ['efectivo', 'transferencia', 'tarjeta', 'nequi', 'otro'] };

  container.innerHTML = `
    <div class="flex justify-between items-end mb-margin-desktop flex-wrap gap-3">
      <div>
        <h2 class="text-headline-lg font-headline-lg text-on-surface">Finanzas</h2>
        <p class="text-body-md font-body-md text-on-surface-variant mt-1">Plata que entra y sale, y quién debe.</p>
      </div>
      <div id="fn-actions" class="flex gap-2 flex-wrap"></div>
    </div>
    <div class="flex gap-1 border-b border-outline-variant mb-gutter overflow-x-auto" role="tablist">
      ${TABS.map((t) => `<button data-tab="${t.key}" role="tab" class="px-4 py-2.5 -mb-px border-b-2 text-body-sm font-label-bold inline-flex items-center gap-1.5 whitespace-nowrap"><span class="material-symbols-outlined text-[18px]">${t.icon}</span>${t.label}</button>`).join('')}
    </div>
    <div id="fn-range" class="flex flex-wrap items-end gap-3 mb-gutter"></div>
    <div id="fn-body"></div>
  `;

  const bodyEl = container.querySelector('#fn-body');
  const rangeEl = container.querySelector('#fn-range');
  const actionsEl = container.querySelector('#fn-actions');

  function paintTabs() {
    container.querySelectorAll('[data-tab]').forEach((b) => {
      const on = b.dataset.tab === tab;
      b.classList.toggle('border-primary', on);
      b.classList.toggle('text-on-surface', on);
      b.classList.toggle('border-transparent', !on);
      b.classList.toggle('text-on-surface-variant', !on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    // Cartera no depende de fechas (es lo que se debe hoy).
    rangeEl.classList.toggle('hidden', tab === 'cartera');
    actionsEl.innerHTML =
      tab === 'caja'
        ? '<button data-new="egreso" class="btn btn-primary"><span class="material-symbols-outlined">remove</span>Registrar gasto</button><button data-new="ingreso" class="btn btn-secondary"><span class="material-symbols-outlined">add</span>Otro ingreso</button>'
        : '';
    actionsEl.querySelectorAll('[data-new]').forEach((b) => b.addEventListener('click', () => openEntry(b.dataset.new)));
  }

  function paintRange() {
    rangeEl.innerHTML = `
      <div><label class="${labelCls}">Desde</label><input id="fn-from" type="date" value="${from}" class="p-2 bg-surface-container-lowest border border-outline-variant rounded-md text-body-sm outline-none focus:border-outline" /></div>
      <div><label class="${labelCls}">Hasta</label><input id="fn-to" type="date" value="${to}" class="p-2 bg-surface-container-lowest border border-outline-variant rounded-md text-body-sm outline-none focus:border-outline" /></div>
      <div class="flex gap-1.5">
        <button data-preset="hoy" class="px-3 py-2 border border-outline-variant rounded-md text-body-sm hover:bg-surface-container-low">Hoy</button>
        <button data-preset="mes" class="px-3 py-2 border border-outline-variant rounded-md text-body-sm hover:bg-surface-container-low">Este mes</button>
        <button data-preset="mes_pasado" class="px-3 py-2 border border-outline-variant rounded-md text-body-sm hover:bg-surface-container-low">Mes pasado</button>
      </div>`;
    rangeEl.querySelector('#fn-from').addEventListener('change', (e) => {
      from = e.target.value;
      load();
    });
    rangeEl.querySelector('#fn-to').addEventListener('change', (e) => {
      to = e.target.value;
      load();
    });
    rangeEl.querySelectorAll('[data-preset]').forEach((b) =>
      b.addEventListener('click', () => {
        [from, to] = PRESETS[b.dataset.preset]();
        paintRange();
        load();
      })
    );
  }

  // ---- Caja ---------------------------------------------------------------------
  async function renderCaja() {
    const data = await ctx.api.get(`/api/cash/entries?from=${from}&to=${to}`);
    const t = data.totals;
    bodyEl.innerHTML = `
      <div class="grid grid-cols-2 lg:grid-cols-3 gap-gutter mb-gutter">
        ${kpi('Entró', formatMoney(t.ingresos), 'Abonos de clientes y otros ingresos', 'good')}
        ${kpi('Salió', formatMoney(t.egresos), 'Gastos y pagos a proveedores')}
        ${kpi('Resultado del periodo', formatMoney(t.neto), t.neto < 0 ? 'Salió más de lo que entró' : 'Entró más de lo que salió', t.neto < 0 ? 'bad' : 'good')}
      </div>
      <div class="grid grid-cols-1 xl:grid-cols-3 gap-gutter">
        <div class="xl:col-span-2 bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm overflow-hidden">
          <div class="px-4 py-3 border-b border-outline-variant text-label-bold font-label-bold text-on-surface">Movimientos (${data.rows.length})</div>
          <div class="divide-y divide-outline-variant max-h-[560px] overflow-y-auto">
            ${data.rows.length ? data.rows.map((r) => `
              <div class="flex items-center justify-between gap-3 px-4 py-2.5">
                <div class="min-w-0">
                  <p class="text-body-sm text-on-surface"><span class="font-bold">${escapeHtml(r.category)}</span>${r.description ? ` · ${escapeHtml(r.description)}` : ''}</p>
                  <p class="text-[11px] text-on-surface-variant">${fmtDate(r.entry_date)} · ${escapeHtml(METHOD_LABEL[r.method] || r.method)}</p>
                </div>
                <div class="shrink-0 flex items-center gap-2">
                  <span class="font-bold text-body-sm ${r.kind === 'ingreso' ? 'text-secondary' : 'text-error'}">${r.kind === 'ingreso' ? '+' : '−'}${formatMoney(r.amount)}</span>
                  ${isAdmin && r.source === 'caja' ? `<button data-del="${r.id}" class="text-on-surface-variant hover:text-error" aria-label="Borrar movimiento"><span class="material-symbols-outlined text-[16px]">delete</span></button>` : ''}
                </div>
              </div>`).join('') : '<p class="px-4 py-8 text-center text-body-sm text-on-surface-variant">Sin movimientos en el periodo.</p>'}
          </div>
        </div>
        <div class="space-y-gutter">
          <div class="bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm p-4">
            <p class="text-label-bold font-label-bold text-on-surface mb-3">En qué se fue la plata</p>
            ${bars(data.egresos_por_categoria, t.egresos)}
          </div>
          <div class="bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm p-4">
            <p class="text-label-bold font-label-bold text-on-surface mb-3">Cómo entró</p>
            ${bars(data.ingresos_por_medio, t.ingresos)}
          </div>
        </div>
      </div>`;
    bodyEl.querySelectorAll('[data-del]').forEach((b) =>
      b.addEventListener('click', async () => {
        const ok = await confirmModal({ title: 'Borrar movimiento', message: 'Se borra este movimiento de Caja. Úsalo solo para corregir un error.', confirmLabel: 'Borrar', danger: true });
        if (!ok) return;
        try {
          await ctx.api.del(`/api/cash/entries/${b.dataset.del}`);
          ctx.toast('Movimiento borrado', 'success');
          load();
        } catch (err) {
          ctx.toast(err.message, 'error');
        }
      })
    );
  }

  function openEntry(kind) {
    const cats = meta.categories[kind] || [];
    openModal({
      title: kind === 'egreso' ? 'Registrar gasto' : 'Registrar otro ingreso',
      render: (body, { close }) => {
        body.innerHTML = `
          ${kind === 'ingreso' ? '<p class="text-[12px] text-on-surface-variant mb-3">Los abonos de clientes no van aquí: se registran en la venta (Ventas Cerradas o Cartera).</p>' : ''}
          <div class="space-y-3">
            <div><label class="${labelCls}">Categoría</label><select id="ce-cat" class="${inputCls}">${cats.map((c) => `<option>${escapeHtml(c)}</option>`).join('')}</select></div>
            <div class="grid grid-cols-2 gap-3">
              <div><label class="${labelCls}">Valor</label><input id="ce-amount" type="number" min="0" step="1000" class="${inputCls}" /></div>
              <div><label class="${labelCls}">Medio</label><select id="ce-method" class="${inputCls}">${meta.methods.map((m) => `<option value="${m}">${METHOD_LABEL[m] || m}</option>`).join('')}</select></div>
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div><label class="${labelCls}">Fecha</label><input id="ce-date" type="date" value="${iso(new Date())}" class="${inputCls}" /></div>
              <div><label class="${labelCls}">Descripción</label><input id="ce-desc" type="text" placeholder="Ej. factura de energía" class="${inputCls}" /></div>
            </div>
          </div>
          <div class="flex justify-end gap-2 mt-4"><button id="ce-cancel" class="btn btn-ghost">Cancelar</button><button id="ce-ok" class="btn btn-primary">Registrar</button></div>`;
        body.querySelector('#ce-cancel').addEventListener('click', close);
        body.querySelector('#ce-ok').addEventListener('click', async () => {
          try {
            await ctx.api.post('/api/cash/entries', {
              kind,
              category: body.querySelector('#ce-cat').value,
              amount: Number(body.querySelector('#ce-amount').value),
              method: body.querySelector('#ce-method').value,
              entry_date: body.querySelector('#ce-date').value,
              description: body.querySelector('#ce-desc').value,
            });
            ctx.toast(kind === 'egreso' ? 'Gasto registrado' : 'Ingreso registrado', 'success');
            close();
            load();
          } catch (err) {
            ctx.toast(err.message, 'error');
          }
        });
      },
    });
  }

  // ---- Cartera ------------------------------------------------------------------
  async function renderCartera() {
    const data = await ctx.api.get('/api/cash/receivables');
    const delivered = data.rows.filter((r) => r.delivered);
    bodyEl.innerHTML = `
      <div class="grid grid-cols-2 lg:grid-cols-3 gap-gutter mb-gutter">
        ${kpi('Por cobrar', formatMoney(data.total), `${data.rows.length} venta(s) con saldo`, data.total > 0 ? 'bad' : '')}
        ${kpi('Entregado y sin pagar', formatMoney(delivered.reduce((s, r) => s + r.balance, 0)), delivered.length ? `${delivered.length} trabajo(s) — cobrar ya` : 'Ninguno', delivered.length ? 'bad' : '')}
        ${kpi('Aún en el taller', formatMoney(data.rows.filter((r) => r.op_status && !r.delivered).reduce((s, r) => s + r.balance, 0)), 'Se cobra el saldo al entregar')}
      </div>
      <div class="bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm overflow-x-auto">
        <table class="w-full text-left border-collapse min-w-[720px]">
          <thead><tr class="border-b border-outline-variant">
            ${['Cliente', 'Producción', 'Vendido', 'Abonado', 'Saldo', ''].map((h, i) => `<th class="p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase tracking-wider ${i >= 2 && i <= 4 ? 'text-right' : ''}">${h}</th>`).join('')}
          </tr></thead>
          <tbody class="divide-y divide-outline-variant">
            ${data.rows.length ? data.rows.map((r) => `
              <tr>
                <td class="p-table-cell-padding"><p class="font-bold text-on-surface">${escapeHtml(r.client_name)}</p><p class="text-[11px] text-on-surface-variant">${escapeHtml(r.phone || '')} · vendido ${fmtDate(r.closed_at)}</p></td>
                <td class="p-table-cell-padding text-body-sm">${r.op_number ? `<a href="#/op?id=${r.op_id}" class="underline text-on-surface">${escapeHtml(r.op_number)}</a><span class="block text-[11px] ${r.delivered ? 'text-error font-bold' : 'text-on-surface-variant'}">${OP_STATUS_LABEL[r.op_status] || ''}</span>` : '<span class="text-on-surface-variant">Sin OP</span>'}</td>
                <td class="p-table-cell-padding text-right text-body-sm text-on-surface">${formatMoney(r.amount)}</td>
                <td class="p-table-cell-padding text-right text-body-sm text-on-surface-variant">${formatMoney(r.paid)}</td>
                <td class="p-table-cell-padding text-right font-bold text-error">${formatMoney(r.balance)}</td>
                <td class="p-table-cell-padding text-right"><button data-pay="${r.lead_id}" data-balance="${r.balance}" data-name="${escapeHtml(r.client_name)}" class="px-3 py-1 border border-outline-variant rounded text-[12px] font-label-bold text-on-surface hover:bg-surface-container-low">Registrar abono</button></td>
              </tr>`).join('') : '<tr><td colspan="6" class="p-table-cell-padding py-8 text-center text-body-sm text-on-surface-variant">Nadie debe nada. 🎉</td></tr>'}
          </tbody>
        </table>
      </div>`;
    bodyEl.querySelectorAll('[data-pay]').forEach((b) => b.addEventListener('click', () => openAbono(Number(b.dataset.pay), Number(b.dataset.balance), b.dataset.name)));
  }

  function openAbono(leadId, balance, name) {
    openModal({
      title: `Abono · ${name}`,
      render: (body, { close }) => {
        body.innerHTML = `
          <p class="text-body-sm text-on-surface-variant mb-3">Saldo pendiente: <b class="text-on-surface">${formatMoney(balance)}</b></p>
          <div class="grid grid-cols-2 gap-3">
            <div><label class="${labelCls}">Valor</label><input id="ab-amount" type="number" min="0" step="1000" value="${balance}" class="${inputCls}" /></div>
            <div><label class="${labelCls}">Medio</label><select id="ab-method" class="${inputCls}">${meta.methods.map((m) => `<option value="${m}">${METHOD_LABEL[m] || m}</option>`).join('')}</select></div>
          </div>
          <div class="mt-3"><label class="${labelCls}">Nota</label><input id="ab-notes" type="text" placeholder="Ej. saldo contra entrega" class="${inputCls}" /></div>
          <div class="flex justify-end gap-2 mt-4"><button id="ab-cancel" class="btn btn-ghost">Cancelar</button><button id="ab-ok" class="btn btn-primary">Registrar abono</button></div>`;
        body.querySelector('#ab-cancel').addEventListener('click', close);
        body.querySelector('#ab-ok').addEventListener('click', async () => {
          try {
            await ctx.api.post(`/api/leads/${leadId}/payments`, {
              amount: Number(body.querySelector('#ab-amount').value),
              method: body.querySelector('#ab-method').value,
              notes: body.querySelector('#ab-notes').value,
            });
            ctx.toast('Abono registrado', 'success');
            close();
            load();
          } catch (err) {
            ctx.toast(err.message, 'error');
          }
        });
      },
    });
  }

  // ---- Rentabilidad -----------------------------------------------------------------
  async function renderRentabilidad() {
    const data = await ctx.api.get(`/api/cash/profitability?from=${from}&to=${to}`);
    const t = data.totals;
    const pct = t.revenue ? Math.round((t.margin / t.revenue) * 100) : 0;
    bodyEl.innerHTML = `
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-gutter mb-gutter">
        ${kpi('Trabajos entregados', data.rows.length)}
        ${kpi('Vendido (sin IVA)', formatMoney(t.revenue))}
        ${kpi('Costo de materiales', formatMoney(t.materials_cost))}
        ${kpi('Queda después de material', formatMoney(t.margin), `${pct}% de lo vendido · sin contar mano de obra ni gastos fijos`, 'good')}
      </div>
      <div class="grid grid-cols-1 xl:grid-cols-5 gap-gutter">
        <div class="xl:col-span-2 bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm p-4">
          <p class="text-label-bold font-label-bold text-on-surface mb-3">Por servicio</p>
          ${data.by_service.length ? data.by_service.map((s) => `
            <div class="py-2 border-b border-outline-variant last:border-b-0">
              <div class="flex justify-between text-body-sm"><span class="font-bold text-on-surface">${escapeHtml(findService(s.service_slug)?.title || 'Otro')}</span><span class="text-on-surface">${formatMoney(s.margin)}</span></div>
              <p class="text-[11px] text-on-surface-variant">${s.jobs} trabajo(s) · vendido ${formatMoney(s.revenue)} · material ${formatMoney(s.materials_cost)} · ${s.revenue ? Math.round((s.margin / s.revenue) * 100) : 0}%</p>
            </div>`).join('') : '<p class="text-body-sm text-on-surface-variant">Sin trabajos entregados en el periodo.</p>'}
        </div>
        <div class="xl:col-span-3 bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm overflow-x-auto">
          <table class="w-full text-left border-collapse min-w-[560px]">
            <thead><tr class="border-b border-outline-variant">
              ${['Orden', 'Cliente', 'Vendido', 'Material', 'Queda'].map((h, i) => `<th class="p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase tracking-wider ${i >= 2 ? 'text-right' : ''}">${h}</th>`).join('')}
            </tr></thead>
            <tbody class="divide-y divide-outline-variant">
              ${data.rows.map((r) => `
                <tr>
                  <td class="p-table-cell-padding text-body-sm"><a href="#/taller?orden=${r.id}" class="underline text-on-surface">${escapeHtml(r.number)}</a><span class="block text-[11px] text-on-surface-variant">${fmtDate(r.delivered_at)}</span></td>
                  <td class="p-table-cell-padding text-body-sm text-on-surface">${escapeHtml(r.client_name)}<span class="block text-[11px] text-on-surface-variant">${escapeHtml(findService(r.service_slug)?.title || 'Otro')}</span></td>
                  <td class="p-table-cell-padding text-right text-body-sm text-on-surface">${formatMoney(r.revenue)}</td>
                  <td class="p-table-cell-padding text-right text-body-sm text-on-surface-variant">${formatMoney(r.materials_cost)}</td>
                  <td class="p-table-cell-padding text-right text-body-sm font-bold ${r.margin < 0 ? 'text-error' : 'text-on-surface'}">${formatMoney(r.margin)}${r.margin_pct !== null ? `<span class="block text-[11px] font-normal text-on-surface-variant">${r.margin_pct}%</span>` : ''}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>`;
  }

  async function load() {
    try {
      if (tab === 'caja') await renderCaja();
      else if (tab === 'cartera') await renderCartera();
      else await renderRentabilidad();
    } catch (err) {
      ctx.toast(err.message || 'No se pudieron cargar las finanzas', 'error');
    }
  }

  container.querySelectorAll('[data-tab]').forEach((b) =>
    b.addEventListener('click', () => {
      tab = b.dataset.tab;
      paintTabs();
      load();
    })
  );

  try {
    meta = await ctx.api.get('/api/cash/meta');
  } catch {
    /* categorías vacías: el formulario de gasto mostrará lista vacía */
  }
  paintTabs();
  paintRange();
  const offs = ['cash_changed', 'leads_changed', 'purchases_changed', 'production_changed'].map((ev) => ctx.ws.on(ev, load));
  await load();
  return () => offs.forEach((off) => off());
}
