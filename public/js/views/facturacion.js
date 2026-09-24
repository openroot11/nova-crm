import { escapeHtml, formatMoney, formatCompactMoney } from '../utils.js';
import { openModal } from '../components/modal.js';
import { setButtonLoading } from '../components/button.js';
import { groupedBarChart, destroyChart } from '../components/charts.js';
import { statCard as kpi, chip, tabBarHtml, paintTabBar, mountDateRange, isoDate as iso, DATE_PRESETS, ratioBar } from '../components/ui.js';

// Facturación (ERP): facturas de venta que emite Velara y facturas de
// compra que le llegan de sus proveedores, organizadas por rubro de gasto,
// con el cruce de IVA y un Excel para el contador. Ver
// server/routes/invoices.js y server/einvoice.js (proveedor, hoy simulado).

const TABS = [
  { key: 'resumen', label: 'Resumen', icon: 'insights' },
  { key: 'ventas', label: 'Ventas', icon: 'north_east' },
  { key: 'compras', label: 'Compras y gastos', icon: 'south_west' },
  { key: 'declaraciones', label: 'Para la declaración', icon: 'account_balance' },
];
const PERIOD_LABEL = { bimestral: 'Bimestral', cuatrimestral: 'Cuatrimestral', anual: 'Anual' };
// Qué le interesa al contador según el régimen (orientativo: lo confirma él).
const REGIME_HINT = {
  no_responsable: 'Factura sin IVA. Lo que más importa: ingresos y gastos del año para la declaración de renta.',
  simple: 'Anticipos bimestrales sobre los ingresos brutos y declaración anual del Simple. Si es responsable de IVA, el IVA se declara una vez al año.',
  ordinario: 'Declaración de IVA bimestral o cuatrimestral (según los ingresos del año anterior) y renta anual. Si es agente de retención, además retención en la fuente mensual.',
};
const METHOD_LABEL = { efectivo: 'Efectivo', transferencia: 'Transferencia', tarjeta: 'Tarjeta', nequi: 'Nequi', otro: 'Otro' };
const SOURCE_LABEL = { regla: 'Regla del proveedor', palabra_clave: 'Automática', manual: 'Manual' };

const inputCls = 'w-full p-2.5 border border-outline-variant rounded-md outline-none focus:border-outline bg-surface-container-lowest';
const labelCls = 'block text-[10px] font-label-bold uppercase tracking-wider text-on-surface-variant mb-1';

function fmtDate(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value || '');
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '—';
}
const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
function fmtMonth(ym) {
  const [y, m] = ym.split('-');
  return `${MONTHS[Number(m) - 1]} ${y.slice(2)}`;
}
function statusChips(inv) {
  const out = [];
  if (inv.doc_type === 'nota_credito') out.push(chip('Nota crédito', 'bg-surface-container-high text-on-surface'));
  if (inv.status === 'anulada') out.push(chip('Anulada', 'bg-error-container text-on-error-container'));
  else if (inv.status === 'rechazada') out.push(chip('Rechazada DIAN', 'bg-error-container text-on-error-container'));
  else if (inv.doc_type === 'factura') {
    out.push(inv.payment_status === 'pagada' ? chip('Pagada', 'bg-secondary-container text-on-secondary-container') : chip(inv.direction === 'emitida' ? 'Por cobrar' : 'Por pagar', 'bg-tertiary-container text-on-tertiary-container'));
  }
  return out.join(' ');
}

export async function mount(container, ctx) {
  let tab = TABS.some((t) => t.key === ctx.routeParams.get('tab')) ? ctx.routeParams.get('tab') : 'resumen';
  let [from, to] = DATE_PRESETS.trimestre[1]();
  let categoryFilter = '';
  let search = '';
  // Pestaña "Para la declaración": año, tipo de periodo y cuál (null = el actual).
  let taxYear = new Date().getFullYear();
  let taxType = null;
  let taxN = null;
  let taxPeriod = null;
  let meta = { categories: [], iva_rates: [0, 5, 19], provider: { key: 'simulado', label: '' }, issuer: {} };
  try {
    meta = await ctx.api.get('/api/invoices/meta');
  } catch (err) {
    ctx.toast(err.message, 'error');
  }

  container.innerHTML = `
    <div class="flex justify-between items-end mb-gutter flex-wrap gap-3">
      <div>
        <h2 class="text-headline-lg font-headline-lg text-on-surface">Facturación</h2>
        <p class="text-body-md font-body-md text-on-surface-variant mt-1">Lo que facturas, lo que te facturan y en qué se va la plata.</p>
      </div>
      <div id="fx-actions" class="flex gap-2 flex-wrap"></div>
    </div>
    ${meta.provider.key === 'simulado' ? `
      <div class="mb-gutter flex items-start gap-2 p-3 rounded-lg border border-outline-variant bg-surface-container-low text-body-sm text-on-surface-variant">
        <span class="material-symbols-outlined text-[18px] mt-0.5">science</span>
        <p><b class="text-on-surface">Modo simulación.</b> Las facturas no se envían a la DIAN y no tienen validez fiscal. Las facturas "recibidas" son de proveedores de ejemplo. Cuando Velara tenga RUT y proveedor tecnológico, se conecta el real sin cambiar esta pantalla.</p>
      </div>` : ''}
    ${tabBarHtml(TABS, tab)}
    <div id="fx-range" class="flex flex-wrap items-end gap-3 mb-gutter"></div>
    <div id="fx-body"></div>
  `;

  const bodyEl = container.querySelector('#fx-body');
  const rangeEl = container.querySelector('#fx-range');
  const actionsEl = container.querySelector('#fx-actions');
  let chartCanvas = null;

  function paintTabs() {
    paintTabBar(container, tab);
    const isTax = tab === 'declaraciones';
    // El reporte de declaración usa su propio periodo tributario, no el rango.
    rangeEl.classList.toggle('hidden', isTax);
    actionsEl.innerHTML = `
      ${tab === 'resumen' || tab === 'compras' ? '<button id="fx-sync" class="btn btn-secondary"><span class="material-symbols-outlined">download</span>Descargar facturas recibidas</button>' : ''}
      ${tab === 'resumen' || tab === 'ventas' ? '<button id="fx-new" class="btn btn-primary"><span class="material-symbols-outlined">add</span>Nueva factura</button>' : ''}
      <a id="fx-export" class="btn btn-secondary" href="#"><span class="material-symbols-outlined">table_view</span>Excel para el contador${isTax ? ' (periodo)' : ''}</a>`;
    actionsEl.querySelector('#fx-sync')?.addEventListener('click', syncReceived);
    actionsEl.querySelector('#fx-new')?.addEventListener('click', () => openNewInvoice());
    actionsEl.querySelector('#fx-export').addEventListener('click', (e) => {
      e.preventDefault();
      const [f, t] = isTax && taxPeriod ? [taxPeriod.from, taxPeriod.to] : [from, to];
      window.location.href = `/api/invoices/export/xlsx?from=${f}&to=${t}`;
    });
  }

  function paintRange() {
    mountDateRange(rangeEl, {
      idPrefix: 'fx',
      from,
      to,
      presets: Object.keys(DATE_PRESETS).filter((k) => k !== 'hoy'),
      onChange: (f, t) => {
        [from, to] = [f, t];
        load();
      },
    });
  }

  // ---- Resumen ---------------------------------------------------------------
  async function renderResumen() {
    const s = await ctx.api.get(`/api/invoices/summary?from=${from}&to=${to}`);
    const totalGastos = s.compras.subtotal;
    bodyEl.innerHTML = `
      ${s.sin_clasificar ? `
        <button id="fx-go-unclassified" class="w-full mb-gutter flex items-center justify-between gap-2 p-3 rounded-lg border border-tertiary/40 bg-tertiary-container/40 text-left text-body-sm">
          <span class="flex items-center gap-2"><span class="material-symbols-outlined text-[18px]">label_off</span><b>${s.sin_clasificar}</b> factura(s) de compra sin clasificar en el periodo — clasifícalas para que el resumen de gastos cuadre.</span>
          <span class="material-symbols-outlined text-[18px]">chevron_right</span>
        </button>` : ''}
      <div class="grid grid-cols-2 xl:grid-cols-4 gap-gutter mb-gutter">
        ${kpi('Ventas facturadas', formatMoney(s.ventas.subtotal), `${s.ventas.count} factura(s) · sin IVA`, 'good')}
        ${kpi('Compras y gastos', formatMoney(s.compras.subtotal), `${s.compras.count} factura(s) · sin IVA`)}
        ${kpi('Resultado', formatMoney(s.resultado), 'Ventas − compras con factura', s.resultado < 0 ? 'bad' : 'good')}
        ${kpi('IVA a pagar (estimado)', formatMoney(Math.max(0, s.iva.a_pagar)), `Generado ${formatMoney(s.iva.generado)} − descontable ${formatMoney(s.iva.descontable)}${s.iva.a_pagar < 0 ? ' · saldo a favor' : ''}`)}
      </div>
      <div class="grid grid-cols-2 gap-gutter mb-gutter">
        ${kpi('Por cobrar a clientes', formatMoney(s.por_cobrar.total), `${s.por_cobrar.n} factura(s) de venta sin pagar`)}
        ${kpi('Por pagar a proveedores', formatMoney(s.por_pagar.total), `${s.por_pagar.n} factura(s) de compra sin pagar`)}
      </div>
      <div class="grid grid-cols-1 xl:grid-cols-5 gap-gutter">
        <div class="xl:col-span-3 bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm p-4">
          <p class="text-label-bold font-label-bold text-on-surface mb-3">Ventas vs. gastos por mes</p>
          ${s.por_mes.length ? '<div class="h-64"><canvas id="fx-chart"></canvas></div>' : '<p class="text-body-sm text-on-surface-variant py-8 text-center">Sin facturas en el periodo.</p>'}
        </div>
        <div class="xl:col-span-2 bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm p-4">
          <p class="text-label-bold font-label-bold text-on-surface mb-3">En qué se fue la plata</p>
          ${s.gastos_por_categoria.length ? s.gastos_por_categoria.map((r) => `
            <button data-cat="${escapeHtml(r.name === 'Sin clasificar' ? '__sin__' : r.name)}" class="block w-full text-left mb-2 group">
              <div class="flex justify-between text-body-sm"><span class="text-on-surface truncate group-hover:underline ${r.name === 'Sin clasificar' ? 'italic' : ''}">${escapeHtml(r.name)}</span><span class="text-on-surface-variant shrink-0">${formatMoney(r.total)} · ${totalGastos ? Math.round((r.total / totalGastos) * 100) : 0}%</span></div>
              ${ratioBar(totalGastos ? Math.max(2, Math.round((r.total / totalGastos) * 100)) : 0, r.name === 'Sin clasificar' ? 'bg-outline' : 'bg-on-surface-variant')}
            </button>`).join('') : '<p class="text-body-sm text-on-surface-variant">Sin facturas de compra en el periodo. Usa "Descargar facturas recibidas".</p>'}
        </div>
      </div>`;
    chartCanvas = bodyEl.querySelector('#fx-chart');
    if (chartCanvas) {
      groupedBarChart(chartCanvas, {
        labels: s.por_mes.map((m) => fmtMonth(m.month)),
        series: [
          { label: 'Ventas', data: s.por_mes.map((m) => m.ventas), color: '#1baf7a' },
          { label: 'Gastos', data: s.por_mes.map((m) => m.gastos), color: '#eb6834' },
        ],
        valueFormatter: formatCompactMoney,
      });
    }
    bodyEl.querySelector('#fx-go-unclassified')?.addEventListener('click', () => goCompras('__sin__'));
    bodyEl.querySelectorAll('[data-cat]').forEach((b) => b.addEventListener('click', () => goCompras(b.dataset.cat)));
  }

  function goCompras(category) {
    tab = 'compras';
    categoryFilter = category;
    paintTabs();
    load();
  }

  // ---- Listados --------------------------------------------------------------
  function categorySelect(inv) {
    const opts = meta.categories.map((c) => `<option ${inv.category === c ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('');
    return `<select data-classify="${inv.id}" class="p-1.5 border ${inv.category ? 'border-outline-variant' : 'border-tertiary'} rounded-md text-[12px] bg-surface-container-lowest max-w-[190px]">
      <option value="" ${inv.category ? '' : 'selected'}>— Sin clasificar —</option>${opts}</select>`;
  }

  async function renderList(direction) {
    const qs = new URLSearchParams({ direction, from, to });
    if (direction === 'recibida' && categoryFilter) qs.set('category', categoryFilter);
    if (search) qs.set('q', search);
    const rows = await ctx.api.get(`/api/invoices?${qs}`);
    const sign = (i) => (i.doc_type === 'nota_credito' ? -1 : 1);
    const total = rows.filter((i) => i.status !== 'rechazada').reduce((s, i) => s + sign(i) * i.total, 0);
    const isCompras = direction === 'recibida';
    bodyEl.innerHTML = `
      <div class="flex flex-wrap items-end gap-3 mb-3">
        <div class="flex-1 min-w-[200px]"><label class="${labelCls}">Buscar</label><input id="fx-q" type="search" value="${escapeHtml(search)}" placeholder="${isCompras ? 'Proveedor, NIT o número' : 'Cliente, NIT o número'}" class="${inputCls}" /></div>
        ${isCompras ? `<div><label class="${labelCls}">Rubro</label><select id="fx-cat" class="${inputCls}">
          <option value="">Todos</option><option value="__sin__" ${categoryFilter === '__sin__' ? 'selected' : ''}>Sin clasificar</option>
          ${meta.categories.map((c) => `<option ${categoryFilter === c ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('')}
        </select></div>` : ''}
        <p class="text-body-sm text-on-surface-variant pb-2.5">${rows.length} documento(s) · <b class="text-on-surface">${formatMoney(total)}</b></p>
      </div>
      <div class="bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm overflow-hidden">
        <div class="overflow-x-auto">
          <table class="w-full text-left border-collapse text-body-sm">
            <thead class="bg-surface-container-high border-b border-outline-variant text-[10px] uppercase tracking-wider text-on-surface-variant">
              <tr>
                <th class="p-3">Fecha</th><th class="p-3">Número</th><th class="p-3">${isCompras ? 'Proveedor' : 'Cliente'}</th>
                ${isCompras ? '<th class="p-3">Rubro</th>' : ''}
                <th class="p-3 text-right">Subtotal</th><th class="p-3 text-right">IVA</th><th class="p-3 text-right">Total</th><th class="p-3">Estado</th><th class="p-3"></th>
              </tr>
            </thead>
            <tbody class="divide-y divide-outline-variant">
              ${rows.length ? rows.map((i) => `
                <tr class="hover:bg-surface-container-low ${i.status === 'anulada' ? 'opacity-60' : ''}">
                  <td class="p-3 whitespace-nowrap">${fmtDate(i.issue_date)}</td>
                  <td class="p-3 font-bold whitespace-nowrap">${escapeHtml(i.number)}</td>
                  <td class="p-3"><p class="text-on-surface">${escapeHtml(i.party_name)}</p><p class="text-[11px] text-on-surface-variant">${escapeHtml(i.party_nit || '')}</p></td>
                  ${isCompras ? `<td class="p-3">${categorySelect(i)}${i.category_source && i.category ? `<p class="text-[10px] text-on-surface-variant mt-0.5">${SOURCE_LABEL[i.category_source] || ''}</p>` : ''}</td>` : ''}
                  <td class="p-3 text-right whitespace-nowrap">${formatMoney(sign(i) * i.subtotal)}</td>
                  <td class="p-3 text-right whitespace-nowrap text-on-surface-variant">${formatMoney(sign(i) * i.iva)}</td>
                  <td class="p-3 text-right whitespace-nowrap font-bold">${formatMoney(sign(i) * i.total)}</td>
                  <td class="p-3">${statusChips(i)}</td>
                  <td class="p-3 text-right whitespace-nowrap"><button data-open="${i.id}" class="px-2.5 py-1.5 border border-outline-variant rounded-md text-[12px] font-label-bold hover:bg-surface-container-low">Ver</button></td>
                </tr>`).join('') : `<tr><td colspan="9" class="p-8 text-center text-on-surface-variant">${isCompras ? 'No hay facturas de compra en el periodo. Usa "Descargar facturas recibidas".' : 'No hay facturas de venta en el periodo.'}</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>`;
    let deb;
    bodyEl.querySelector('#fx-q').addEventListener('input', (e) => {
      clearTimeout(deb);
      deb = setTimeout(() => {
        search = e.target.value.trim();
        load().then(() => {
          const q = bodyEl.querySelector('#fx-q');
          q?.focus();
          q?.setSelectionRange(q.value.length, q.value.length);
        });
      }, 300);
    });
    bodyEl.querySelector('#fx-cat')?.addEventListener('change', (e) => {
      categoryFilter = e.target.value;
      load();
    });
    bodyEl.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => openInvoice(Number(b.dataset.open))));
    bodyEl.querySelectorAll('[data-classify]').forEach((sel) =>
      sel.addEventListener('change', async () => {
        try {
          const r = await ctx.api.patch(`/api/invoices/${sel.dataset.classify}`, { category: sel.value || null, apply_to_supplier: true });
          ctx.toast(r.applied ? `Clasificada · también ${r.applied} factura(s) más de este proveedor` : sel.value ? 'Clasificada — las próximas de este proveedor entran solas' : 'Sin clasificar', 'success');
          load();
        } catch (err) {
          ctx.toast(err.message, 'error');
        }
      })
    );
  }

  // ---- Para la declaración -----------------------------------------------------
  async function renderDeclaraciones() {
    const settings = await ctx.api.get('/api/invoices/tax/settings');
    if (!taxType) taxType = settings.iva_period || (settings.regime === 'simple' ? 'bimestral' : settings.regime === 'no_responsable' ? 'anual' : 'bimestral');
    const qs = new URLSearchParams({ year: taxYear, type: taxType });
    if (taxN) qs.set('n', taxN);
    const data = await ctx.api.get(`/api/invoices/tax/report?${qs}`);
    const r = data.report;
    taxPeriod = data.period;
    const regime = settings.regime;
    const showIva = regime !== 'no_responsable';
    const isAdmin = ctx.user?.role === 'admin';
    const thisYear = new Date().getFullYear();

    const rateTable = (rows, emptyMsg) =>
      rows.length
        ? `<table class="w-full text-body-sm"><thead class="text-[10px] uppercase tracking-wider text-on-surface-variant text-left"><tr><th class="py-1">Tarifa</th><th class="py-1 text-right">Base</th><th class="py-1 text-right">IVA</th></tr></thead>
            <tbody class="divide-y divide-outline-variant">${rows.map((x) => `<tr><td class="py-1.5">${x.rate === 0 ? 'Excluido / 0%' : `${x.rate}%`}</td><td class="py-1.5 text-right">${formatMoney(x.base)}</td><td class="py-1.5 text-right">${formatMoney(x.iva)}</td></tr>`).join('')}</tbody></table>`
        : `<p class="text-body-sm text-on-surface-variant">${emptyMsg}</p>`;

    bodyEl.innerHTML = `
      <div class="bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm p-4 mb-gutter">
        <div class="flex flex-wrap items-end gap-3">
          <div class="min-w-[240px] flex-1"><label class="${labelCls}">Régimen de Velara</label>
            <select id="tx-regime" class="${inputCls}" ${isAdmin ? '' : 'disabled'}>
              <option value="" ${regime ? '' : 'selected'}>— Sin definir (pregúntale al contador) —</option>
              ${Object.entries(settings.regimes).map(([k, v]) => `<option value="${k}" ${regime === k ? 'selected' : ''}>${escapeHtml(v)}</option>`).join('')}
            </select></div>
          <div><label class="${labelCls}">Periodo del IVA</label>
            <select id="tx-ivaperiod" class="${inputCls}" ${isAdmin ? '' : 'disabled'}>
              <option value="" ${settings.iva_period ? '' : 'selected'}>— Sin definir —</option>
              ${settings.period_types.map((k) => `<option value="${k}" ${settings.iva_period === k ? 'selected' : ''}>${PERIOD_LABEL[k]}</option>`).join('')}
            </select></div>
        </div>
        <p class="text-[12px] text-on-surface-variant mt-2">${regime ? escapeHtml(REGIME_HINT[regime]) : 'Define el régimen con tu contador: de eso depende qué se declara y cada cuánto.'}${isAdmin ? '' : ' Solo el administrador puede cambiar esto.'}</p>
      </div>

      <div class="flex flex-wrap items-end gap-3 mb-gutter">
        <div><label class="${labelCls}">Año</label>
          <select id="tx-year" class="${inputCls}">${[thisYear, thisYear - 1].map((y) => `<option ${taxYear === y ? 'selected' : ''}>${y}</option>`).join('')}</select></div>
        <div class="flex gap-1.5">${settings.period_types.map((k) => `<button data-ttype="${k}" class="px-3 py-2 border rounded-md text-body-sm ${taxType === k ? 'border-outline bg-surface-container-high font-bold' : 'border-outline-variant hover:bg-surface-container-low'}">${PERIOD_LABEL[k]}</button>`).join('')}</div>
        ${data.periods.length > 1 ? `<div class="flex gap-1.5 flex-wrap">${data.periods.map((p) => `<button data-tn="${p.n}" class="px-3 py-2 border rounded-md text-body-sm capitalize ${p.n === data.period.n ? 'border-outline bg-surface-container-high text-on-surface font-bold' : 'border-outline-variant text-on-surface-variant hover:bg-surface-container-low'}">${escapeHtml(p.label.replace(/ \d{4}$/, ''))}</button>`).join('')}</div>` : ''}
      </div>

      <p class="text-headline-sm font-headline-sm text-on-surface mb-1 capitalize">${escapeHtml(data.period.label)}</p>
      <p class="text-[12px] text-on-surface-variant mb-gutter">Del ${fmtDate(r.from)} al ${fmtDate(r.to)} · según las facturas registradas en Velara</p>

      ${r.compras.sin_clasificar ? `<p class="mb-gutter p-3 rounded-lg border border-tertiary/40 bg-tertiary-container/40 text-body-sm">${r.compras.sin_clasificar} factura(s) de compra sin clasificar en este periodo: clasifícalas en "Compras y gastos" para que los gastos por rubro queden completos.</p>` : ''}

      <div class="grid grid-cols-1 sm:grid-cols-3 gap-gutter mb-gutter">
        ${kpi('Ingresos brutos', formatMoney(r.ingresos.brutos), `${r.ingresos.facturas} factura(s) de venta, sin IVA${regime === 'simple' ? ' · base del anticipo del Simple' : ''}`)}
        ${kpi('Devoluciones y anulaciones', formatMoney(r.ingresos.devoluciones), `${r.ingresos.notas_credito} nota(s) crédito`)}
        ${kpi('Ingresos netos', formatMoney(r.ingresos.netos), 'Brutos − devoluciones', 'good')}
      </div>

      ${showIva ? `
        <div class="grid grid-cols-1 lg:grid-cols-3 gap-gutter mb-gutter">
          <div class="bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm p-4">
            <p class="text-label-bold font-label-bold text-on-surface mb-2">IVA generado (ventas)</p>
            ${rateTable(r.ingresos.por_tarifa, 'Sin ventas en el periodo.')}
          </div>
          <div class="bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm p-4">
            <p class="text-label-bold font-label-bold text-on-surface mb-2">IVA descontable (compras)</p>
            ${rateTable(r.compras.por_tarifa, 'Sin compras con factura en el periodo.')}
          </div>
          <div class="border ${r.iva.saldo > 0 ? 'border-error/40' : 'border-outline-variant'} rounded-xl p-4 bg-surface-container-lowest">
            <p class="text-[10px] font-label-bold text-on-surface-variant uppercase tracking-wider mb-1">${r.iva.saldo >= 0 ? 'IVA a pagar (estimado)' : 'Saldo a favor (estimado)'}</p>
            <p class="text-headline-sm font-headline-sm ${r.iva.saldo > 0 ? 'text-error' : 'text-secondary'}">${formatMoney(Math.abs(r.iva.saldo))}</p>
            <p class="text-[12px] text-on-surface-variant mt-2">Generado ${formatMoney(r.iva.generado)} − descontable ${formatMoney(r.iva.descontable)}.</p>
            ${settings.iva_period && taxType !== settings.iva_period ? `<p class="text-[11px] text-on-surface-variant mt-2">Ojo: Velara declara IVA ${PERIOD_LABEL[settings.iva_period].toLowerCase()}; estás viendo un periodo ${PERIOD_LABEL[taxType].toLowerCase()}.</p>` : ''}
          </div>
        </div>` : `
        <p class="mb-gutter p-3 rounded-lg border border-outline-variant bg-surface-container-low text-body-sm text-on-surface-variant">Como persona natural no responsable de IVA, Velara no cobra ni declara IVA. Si alguna factura salió con IVA, revísala con el contador.</p>`}

      <div class="grid grid-cols-1 xl:grid-cols-5 gap-gutter mb-gutter">
        <div class="xl:col-span-2 bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm p-4">
          <p class="text-label-bold font-label-bold text-on-surface mb-1">Compras y gastos por rubro</p>
          <p class="text-[11px] text-on-surface-variant mb-3">Total ${formatMoney(r.compras.total)} sin IVA · ${r.compras.facturas} factura(s)</p>
          ${r.gastos_por_categoria.length ? r.gastos_por_categoria.map((g) => `<div class="flex justify-between text-body-sm py-1 border-b border-outline-variant last:border-0"><span class="${g.name === 'Sin clasificar' ? 'italic text-on-surface-variant' : ''}">${escapeHtml(g.name)}</span><span>${formatMoney(g.total)}</span></div>`).join('') : '<p class="text-body-sm text-on-surface-variant">Sin compras en el periodo.</p>'}
        </div>
        <div class="xl:col-span-3 bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm overflow-hidden">
          <div class="px-4 pt-4"><p class="text-label-bold font-label-bold text-on-surface mb-1">Terceros</p><p class="text-[11px] text-on-surface-variant mb-2">Con quién se compró y vendió en el periodo (base de la información exógena). El Excel trae la lista completa.</p></div>
          <div class="overflow-x-auto max-h-[380px] overflow-y-auto">
            <table class="w-full text-body-sm"><thead class="bg-surface-container-high text-[10px] uppercase tracking-wider text-on-surface-variant text-left sticky top-0"><tr><th class="p-2">Tercero</th><th class="p-2 text-right">Ventas</th><th class="p-2 text-right">Compras</th></tr></thead>
            <tbody class="divide-y divide-outline-variant">${r.terceros.length ? r.terceros.map((t) => `<tr><td class="p-2"><p>${escapeHtml(t.name)}</p><p class="text-[11px] text-on-surface-variant">${escapeHtml(t.nit || 'Sin NIT')}</p></td><td class="p-2 text-right whitespace-nowrap">${t.ventas ? formatMoney(t.ventas) : '—'}</td><td class="p-2 text-right whitespace-nowrap">${t.compras ? formatMoney(t.compras) : '—'}</td></tr>`).join('') : '<tr><td colspan="3" class="p-6 text-center text-on-surface-variant">Sin movimientos en el periodo.</td></tr>'}</tbody></table>
          </div>
        </div>
      </div>

      <div class="p-3 rounded-lg border border-outline-variant bg-surface-container-low text-[12px] text-on-surface-variant space-y-1">
        <p><b class="text-on-surface">Esto no es la declaración:</b> es la información organizada para que el contador la prepare. Él confirma el régimen, las tarifas y los plazos.</p>
        <p>Todavía no incluye retenciones (en la fuente, de IVA o de ICA) ni gastos sin factura electrónica; los gastos pagados solo en Caja no aparecen aquí.</p>
        ${meta.provider.key === 'simulado' ? '<p>Modo simulación: las cifras salen de facturas de prueba.</p>' : ''}
      </div>`;

    const saveSettings = async (patch) => {
      try {
        await ctx.api.put('/api/invoices/tax/settings', patch);
        ctx.toast('Configuración tributaria guardada', 'success');
        if (patch.iva_period) taxType = patch.iva_period;
        taxN = null;
        load();
      } catch (err) {
        ctx.toast(err.message, 'error');
      }
    };
    bodyEl.querySelector('#tx-regime').addEventListener('change', (e) => saveSettings({ regime: e.target.value || null }));
    bodyEl.querySelector('#tx-ivaperiod').addEventListener('change', (e) => saveSettings({ iva_period: e.target.value || null }));
    bodyEl.querySelector('#tx-year').addEventListener('change', (e) => {
      taxYear = Number(e.target.value);
      taxN = null;
      load();
    });
    bodyEl.querySelectorAll('[data-ttype]').forEach((b) =>
      b.addEventListener('click', () => {
        taxType = b.dataset.ttype;
        taxN = null;
        load();
      })
    );
    bodyEl.querySelectorAll('[data-tn]').forEach((b) =>
      b.addEventListener('click', () => {
        taxN = Number(b.dataset.tn);
        load();
      })
    );
  }

  // ---- Acciones --------------------------------------------------------------
  async function syncReceived() {
    const btn = actionsEl.querySelector('#fx-sync');
    setButtonLoading(btn, true);
    try {
      const r = await ctx.api.post('/api/invoices/sync-received', { from, to });
      ctx.toast(
        r.created
          ? `${r.created} factura(s) nueva(s) · ${r.classified} clasificada(s) solas${r.unclassified ? ` · ${r.unclassified} por clasificar` : ''}`
          : `Sin facturas nuevas (${r.already} ya estaban)`,
        'success'
      );
      load();
    } catch (err) {
      ctx.toast(err.message, 'error');
    } finally {
      setButtonLoading(btn, false);
    }
  }

  function lineRow(l = {}) {
    return `
      <tr data-line>
        <td class="py-1 pr-1"><input data-f="description" value="${escapeHtml(l.description || '')}" placeholder="Descripción" class="${inputCls} !p-2" /></td>
        <td class="py-1 pr-1 w-16"><input data-f="qty" type="number" min="0" step="any" value="${l.qty ?? 1}" class="${inputCls} !p-2 text-right" /></td>
        <td class="py-1 pr-1 w-32"><input data-f="unit_price" type="number" min="0" step="100" value="${l.unit_price ?? ''}" placeholder="0" class="${inputCls} !p-2 text-right" /></td>
        <td class="py-1 pr-1 w-20"><select data-f="iva_rate" class="${inputCls} !p-2">${meta.iva_rates.map((r) => `<option value="${r}" ${Number(l.iva_rate ?? 19) === r ? 'selected' : ''}>${r}%</option>`).join('')}</select></td>
        <td class="py-1 w-8"><button type="button" data-del class="text-on-surface-variant hover:text-error" aria-label="Quitar línea"><span class="material-symbols-outlined text-[18px]">close</span></button></td>
      </tr>`;
  }

  function openNewInvoice() {
    openModal({
      title: 'Nueva factura de venta',
      wide: true,
      render: (body, { close }) => {
        body.innerHTML = `
          <div class="relative mb-4">
            <label class="${labelCls}">Buscar cliente (opcional)</label>
            <input id="nf-search" type="search" autocomplete="off" placeholder="Nombre, teléfono o documento — trae sus datos y su última cotización" class="${inputCls}" />
            <div id="nf-results" class="hidden absolute z-20 mt-1 w-full bg-surface border border-outline-variant rounded-md shadow-lg max-h-60 overflow-y-auto"></div>
            <p id="nf-from-quote" class="hidden text-[11px] text-on-surface-variant mt-1"></p>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
            <div><label class="${labelCls}">Cliente / razón social *</label><input id="nf-name" class="${inputCls}" /></div>
            <div><label class="${labelCls}">NIT o cédula *</label><input id="nf-nit" placeholder="900123456-7" class="${inputCls}" /></div>
            <div><label class="${labelCls}">Correo (se le envía la factura)</label><input id="nf-email" type="email" class="${inputCls}" /></div>
            <div><label class="${labelCls}">Dirección</label><input id="nf-address" class="${inputCls}" /></div>
          </div>
          <div class="overflow-x-auto mb-2"><table class="w-full min-w-[460px]"><thead class="text-[10px] uppercase tracking-wider text-on-surface-variant text-left"><tr><th class="pb-1">Descripción</th><th class="pb-1">Cant.</th><th class="pb-1">Vr. unitario</th><th class="pb-1">IVA</th><th></th></tr></thead><tbody id="nf-lines">${lineRow()}</tbody></table></div>
          <button id="nf-add" type="button" class="text-body-sm font-label-bold text-on-surface-variant hover:text-on-surface inline-flex items-center gap-1 mb-4"><span class="material-symbols-outlined text-[18px]">add</span>Agregar línea</button>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
            <div><label class="${labelCls}">Forma de pago</label><select id="nf-due" class="${inputCls}"><option value="0">Contado</option><option value="15">Crédito 15 días</option><option value="30">Crédito 30 días</option><option value="60">Crédito 60 días</option></select></div>
            <div><label class="${labelCls}">Notas</label><input id="nf-notes" class="${inputCls}" /></div>
          </div>
          <div id="nf-totals" class="text-right text-body-sm mb-4"></div>
          <div class="flex justify-end gap-2">
            <button id="nf-cancel" class="btn btn-secondary">Cancelar</button>
            <button id="nf-emit" class="btn btn-primary"><span class="material-symbols-outlined">send</span>Emitir factura</button>
          </div>`;
        const linesEl = body.querySelector('#nf-lines');
        const totalsEl = body.querySelector('#nf-totals');
        let leadId = null;

        const readLines = () =>
          [...linesEl.querySelectorAll('[data-line]')].map((row) => {
            const v = (f) => row.querySelector(`[data-f="${f}"]`).value;
            return { description: v('description').trim(), qty: Number(v('qty')) || 0, unit_price: Number(v('unit_price')) || 0, iva_rate: Number(v('iva_rate')) };
          });
        function paintTotals() {
          const lines = readLines();
          const sub = lines.reduce((s, l) => s + l.qty * l.unit_price, 0);
          const iva = lines.reduce((s, l) => s + (l.qty * l.unit_price * l.iva_rate) / 100, 0);
          totalsEl.innerHTML = `Subtotal ${formatMoney(sub)} · IVA ${formatMoney(iva)} · <b class="text-headline-sm">Total ${formatMoney(sub + iva)}</b>`;
        }
        function setLines(lines) {
          linesEl.innerHTML = (lines.length ? lines : [{}]).map(lineRow).join('');
          paintTotals();
        }
        linesEl.addEventListener('input', paintTotals);
        linesEl.addEventListener('change', paintTotals);
        linesEl.addEventListener('click', (e) => {
          if (!e.target.closest('[data-del]')) return;
          e.target.closest('[data-line]').remove();
          if (!linesEl.children.length) setLines([]);
          paintTotals();
        });
        body.querySelector('#nf-add').addEventListener('click', () => {
          linesEl.insertAdjacentHTML('beforeend', lineRow());
        });
        paintTotals();

        // Buscador de cliente: precarga datos y líneas de su última cotización.
        const searchEl = body.querySelector('#nf-search');
        const resultsEl = body.querySelector('#nf-results');
        let deb;
        searchEl.addEventListener('input', () => {
          clearTimeout(deb);
          const term = searchEl.value.trim();
          if (term.length < 2) return resultsEl.classList.add('hidden');
          deb = setTimeout(async () => {
            let list = [];
            try {
              list = await ctx.api.get(`/api/leads?q=${encodeURIComponent(term)}&include_manual=1`);
            } catch {
              return;
            }
            resultsEl.innerHTML = list.length
              ? list.slice(0, 15).map((l) => `<button type="button" data-lead="${l.id}" class="w-full text-left px-3 py-2 hover:bg-surface-container-low"><span class="block text-body-sm font-bold">${escapeHtml(l.client_name)}</span><span class="block text-[11px] text-on-surface-variant">${escapeHtml(l.document || l.phone || '')}${l.product ? ' · ' + escapeHtml(l.product) : ''}</span></button>`).join('')
              : '<p class="px-3 py-2 text-[11px] text-on-surface-variant">Sin resultados</p>';
            resultsEl.classList.remove('hidden');
          }, 250);
        });
        resultsEl.addEventListener('click', async (e) => {
          const b = e.target.closest('[data-lead]');
          if (!b) return;
          resultsEl.classList.add('hidden');
          try {
            const p = await ctx.api.get(`/api/invoices/prefill?lead_id=${b.dataset.lead}`);
            leadId = p.lead_id;
            body.querySelector('#nf-name').value = p.party_name || '';
            body.querySelector('#nf-nit').value = p.party_nit || '';
            body.querySelector('#nf-email').value = p.party_email || '';
            body.querySelector('#nf-address').value = p.party_address || '';
            searchEl.value = p.party_name || '';
            const note = body.querySelector('#nf-from-quote');
            note.classList.toggle('hidden', !p.quotation_number);
            note.textContent = p.quotation_number ? `Líneas tomadas de la cotización ${p.quotation_number} — revísalas antes de emitir.` : '';
            if (p.lines.length) setLines(p.lines);
          } catch (err) {
            ctx.toast(err.message, 'error');
          }
        });

        body.querySelector('#nf-cancel').addEventListener('click', close);
        body.querySelector('#nf-emit').addEventListener('click', async (e) => {
          const btn = e.currentTarget;
          setButtonLoading(btn, true);
          try {
            const inv = await ctx.api.post('/api/invoices', {
              lead_id: leadId,
              party_name: body.querySelector('#nf-name').value,
              party_nit: body.querySelector('#nf-nit').value,
              party_email: body.querySelector('#nf-email').value,
              party_address: body.querySelector('#nf-address').value,
              due_days: Number(body.querySelector('#nf-due').value),
              notes: body.querySelector('#nf-notes').value,
              lines: readLines(),
            });
            ctx.toast(`Factura ${inv.number} emitida`, 'success');
            close();
            load();
            openInvoice(inv.id);
          } catch (err) {
            ctx.toast(err.message, 'error');
            setButtonLoading(btn, false);
          }
        });
      },
    });
  }

  async function openInvoice(id) {
    let inv;
    try {
      inv = await ctx.api.get(`/api/invoices/${id}`);
    } catch (err) {
      ctx.toast(err.message, 'error');
      return;
    }
    const isSale = inv.direction === 'emitida';
    const canPay = inv.doc_type === 'factura' && inv.status === 'aceptada' && inv.payment_status === 'pendiente';
    const canVoid = isSale && inv.doc_type === 'factura' && inv.status !== 'anulada';
    openModal({
      title: `${inv.doc_type === 'nota_credito' ? 'Nota crédito' : 'Factura'} ${escapeHtml(inv.number)}`,
      wide: true,
      render: (body, { close }) => {
        body.innerHTML = `
          <div class="flex flex-wrap gap-2 mb-3">${statusChips(inv)}${inv.source === 'simulado' ? chip('Simulada', 'bg-surface-container-high text-on-surface-variant') : ''}</div>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4 text-body-sm">
            <div><p class="${labelCls}">${isSale ? 'Cliente' : 'Proveedor'}</p><p class="font-bold">${escapeHtml(inv.party_name)}</p><p class="text-on-surface-variant">${escapeHtml(inv.party_nit || '')}${inv.party_email ? ' · ' + escapeHtml(inv.party_email) : ''}</p></div>
            <div><p class="${labelCls}">Fechas</p><p>Emitida ${fmtDate(inv.issue_date)}${inv.due_date ? ` · vence ${fmtDate(inv.due_date)}` : ''}</p>${inv.paid_at ? `<p class="text-on-surface-variant">Pagada ${fmtDate(inv.paid_at)}</p>` : ''}</div>
            ${inv.related_number ? `<div><p class="${labelCls}">Anula a</p><p>Factura ${escapeHtml(inv.related_number)}</p></div>` : ''}
            ${inv.credit_note ? `<div><p class="${labelCls}">Anulada con</p><p>Nota crédito ${escapeHtml(inv.credit_note.number)}</p></div>` : ''}
            ${!isSale ? `<div><p class="${labelCls}">Rubro</p><p>${escapeHtml(inv.category || 'Sin clasificar')}</p></div>` : ''}
          </div>
          <div class="overflow-x-auto mb-3">
            <table class="w-full text-body-sm"><thead class="text-[10px] uppercase tracking-wider text-on-surface-variant text-left border-b border-outline-variant"><tr><th class="py-1.5">Descripción</th><th class="py-1.5 text-right">Cant.</th><th class="py-1.5 text-right">Vr. unit.</th><th class="py-1.5 text-right">IVA</th><th class="py-1.5 text-right">Subtotal</th></tr></thead>
            <tbody class="divide-y divide-outline-variant">${inv.lines.map((l) => `<tr><td class="py-1.5">${escapeHtml(l.description)}</td><td class="py-1.5 text-right">${l.qty}</td><td class="py-1.5 text-right">${formatMoney(l.unit_price)}</td><td class="py-1.5 text-right">${l.iva_rate}%</td><td class="py-1.5 text-right">${formatMoney(l.subtotal)}</td></tr>`).join('')}</tbody></table>
          </div>
          <p class="text-right text-body-sm mb-3">Subtotal ${formatMoney(inv.subtotal)} · IVA ${formatMoney(inv.iva)} · <b class="text-headline-sm">Total ${formatMoney(inv.total)}</b></p>
          <p class="${labelCls}">CUFE</p><p class="text-[11px] text-on-surface-variant break-all mb-4 font-mono">${escapeHtml(inv.cufe || '—')}</p>
          ${inv.notes ? `<p class="text-body-sm text-on-surface-variant mb-4">Notas: ${escapeHtml(inv.notes)}</p>` : ''}
          <div id="iv-pay" class="hidden mb-4 p-3 rounded-lg border border-outline-variant">
            <div class="grid grid-cols-2 gap-3">
              <div><label class="${labelCls}">Fecha de pago</label><input id="iv-date" type="date" value="${iso(new Date())}" class="${inputCls}" /></div>
              <div><label class="${labelCls}">Medio</label><select id="iv-method" class="${inputCls}">${Object.entries(METHOD_LABEL).map(([k, v]) => `<option value="${k}" ${k === 'transferencia' ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
            </div>
            ${!isSale ? '<p class="text-[11px] text-on-surface-variant mt-2">El pago queda también como gasto en Caja (Finanzas), en el mismo rubro.</p>' : ''}
            <div class="flex justify-end mt-3"><button id="iv-pay-ok" class="btn btn-primary">Confirmar pago</button></div>
          </div>
          <div class="flex flex-wrap justify-end gap-2">
            <a href="/api/invoices/${inv.id}/pdf" target="_blank" rel="noopener" class="btn btn-secondary"><span class="material-symbols-outlined">picture_as_pdf</span>PDF</a>
            ${canVoid ? '<button id="iv-void" class="btn btn-secondary"><span class="material-symbols-outlined">block</span>Anular con nota crédito</button>' : ''}
            ${canPay ? `<button id="iv-pay-open" class="btn btn-primary"><span class="material-symbols-outlined">payments</span>${isSale ? 'Registrar cobro' : 'Registrar pago'}</button>` : ''}
          </div>`;
        body.querySelector('#iv-pay-open')?.addEventListener('click', () => body.querySelector('#iv-pay').classList.remove('hidden'));
        body.querySelector('#iv-pay-ok')?.addEventListener('click', async (e) => {
          setButtonLoading(e.currentTarget, true);
          try {
            await ctx.api.post(`/api/invoices/${inv.id}/pay`, { date: body.querySelector('#iv-date').value, method: body.querySelector('#iv-method').value });
            ctx.toast(isSale ? 'Cobro registrado' : 'Pago registrado (también en Caja)', 'success');
            close();
            load();
          } catch (err) {
            ctx.toast(err.message, 'error');
            setButtonLoading(e.currentTarget, false);
          }
        });
        body.querySelector('#iv-void')?.addEventListener('click', () => {
          close();
          openVoid(inv);
        });
      },
    });
  }

  function openVoid(inv) {
    openModal({
      title: `Anular factura ${escapeHtml(inv.number)}`,
      render: (body, { close }) => {
        body.innerHTML = `
          <p class="text-body-sm text-on-surface-variant mb-3">Una factura aceptada por la DIAN no se borra: se anula emitiendo una <b>nota crédito</b> por el mismo valor (${formatMoney(inv.total)}), que la referencia.</p>
          <label class="${labelCls}">Motivo</label>
          <input id="vo-reason" placeholder="Ej. error en el valor, el cliente canceló el trabajo" class="${inputCls} mb-4" />
          <div class="flex justify-end gap-2"><button id="vo-cancel" class="btn btn-secondary">Cancelar</button><button id="vo-ok" class="btn btn-primary">Emitir nota crédito</button></div>`;
        body.querySelector('#vo-cancel').addEventListener('click', close);
        body.querySelector('#vo-ok').addEventListener('click', async (e) => {
          setButtonLoading(e.currentTarget, true);
          try {
            const nc = await ctx.api.post(`/api/invoices/${inv.id}/credit-note`, { reason: body.querySelector('#vo-reason').value });
            ctx.toast(`Nota crédito ${nc.number} emitida`, 'success');
            close();
            load();
          } catch (err) {
            ctx.toast(err.message, 'error');
            setButtonLoading(e.currentTarget, false);
          }
        });
      },
    });
  }

  async function load() {
    try {
      if (chartCanvas) destroyChart(chartCanvas);
      chartCanvas = null;
      if (tab === 'resumen') await renderResumen();
      else if (tab === 'declaraciones') await renderDeclaraciones();
      else await renderList(tab === 'ventas' ? 'emitida' : 'recibida');
    } catch (err) {
      bodyEl.innerHTML = `<p class="text-body-sm text-error">${escapeHtml(err.message)}</p>`;
    }
  }

  container.querySelectorAll('[data-tab]').forEach((b) =>
    b.addEventListener('click', () => {
      if (tab === b.dataset.tab) return;
      tab = b.dataset.tab;
      if (tab !== 'compras') categoryFilter = '';
      search = '';
      paintTabs();
      load();
    })
  );

  paintTabs();
  paintRange();
  await load();
  const off = ctx.ws.on('invoices_changed', load);
  return () => {
    off?.();
    if (chartCanvas) destroyChart(chartCanvas);
  };
}
