import { escapeHtml, formatMoney, statusBadge } from '../utils.js';
import { openModal } from '../components/modal.js';

const PAGE_SIZE = 50;
// Mismo catalogo que Alta Rapida en ventas.js -- "Otro" se excluye del
// filtro (ahi guarda texto libre, no un valor fijo que se pueda filtrar).
const PRODUCTS = ['Carpas', 'Cortinas', 'Gramas', 'Baby Gym', 'Forros', 'Pisos Vinílicos'];

function fieldHtml(id, label, value, placeholder = '') {
  return `
    <div>
      <label class="block text-[10px] font-label-bold text-on-surface-variant mb-1 uppercase tracking-wider">${label}</label>
      <input id="${id}" type="text" value="${escapeHtml(value || '')}" placeholder="${placeholder}" class="w-full p-2.5 bg-surface-container-lowest border border-outline-variant rounded-md text-body-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" />
    </div>
  `;
}

function kpiMini(label, value) {
  return `
    <div class="border border-outline-variant rounded-xl p-4">
      <p class="text-[10px] font-label-bold text-on-surface-variant uppercase tracking-wider mb-1">${label}</p>
      <p class="text-headline-sm font-headline-sm text-on-surface">${value}</p>
    </div>
  `;
}

export async function mount(container, ctx) {
  container.innerHTML = `
    <div class="flex justify-between items-end mb-margin-desktop flex-wrap gap-3">
      <div>
        <h2 class="text-headline-lg font-headline-lg text-on-surface">Clientes</h2>
        <p class="text-body-md font-body-md text-on-surface-variant mt-1">Ficha por cliente — historial de pedidos y abonos en un solo lugar, sin repetir la misma persona en cada pedido.</p>
      </div>
      <button id="new-client-btn" class="px-4 py-2 bg-primary text-on-primary rounded-md font-label-bold text-label-bold hover:bg-on-primary-fixed-variant transition-colors flex items-center gap-2">
        <span class="material-symbols-outlined text-[18px]">person_add</span> Nuevo cliente
      </button>
    </div>

    <div class="bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm overflow-hidden mb-gutter">
      <div class="p-4 border-b border-outline-variant flex flex-col gap-3 sm:flex-row sm:items-center">
        <div class="min-w-0">
          <p class="text-body-sm text-on-surface-variant">Lista de clientes ordenada por nombre.</p>
        </div>
        <div class="ml-auto flex flex-wrap items-center gap-2">
          <span id="clientes-count" class="inline-flex items-center rounded-full bg-surface-container-high border border-outline-variant px-3 py-1 text-body-sm font-label-medium text-on-surface-variant">0 clientes</span>
          <button id="clientes-refresh-btn" class="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-outline-variant bg-surface text-body-sm font-label-bold text-primary hover:bg-primary-container hover:text-primary transition">
            <span class="material-symbols-outlined text-[18px]">refresh</span>
            Refrescar
          </button>
        </div>
      </div>
      <div class="p-4 border-b border-outline-variant bg-surface-container-low flex flex-wrap gap-3 items-end">
        <div class="min-w-[200px] flex-1">
          <label class="block text-[10px] font-label-bold text-on-surface-variant mb-1 uppercase tracking-wider">Buscar</label>
          <input id="filter-q" type="text" placeholder="Nombre, teléfono o documento..." class="w-full p-2 bg-surface-container-lowest border border-outline-variant rounded-md text-body-sm outline-none focus:border-primary" />
        </div>
        <div id="filter-asesor-wrap">
          <label class="block text-[10px] font-label-bold text-on-surface-variant mb-1 uppercase tracking-wider">Asesor</label>
          <select id="filter-asesor" class="p-2 bg-surface-container-lowest border border-outline-variant rounded-md text-body-sm outline-none focus:border-primary">
            <option value="">Todos</option>
          </select>
        </div>
        <div>
          <label class="block text-[10px] font-label-bold text-on-surface-variant mb-1 uppercase tracking-wider">Producto</label>
          <select id="filter-producto" class="p-2 bg-surface-container-lowest border border-outline-variant rounded-md text-body-sm outline-none focus:border-primary">
            <option value="">Todos</option>
            ${PRODUCTS.map((p) => `<option value="${p}">${p}</option>`).join('')}
          </select>
        </div>
        <div>
          <label class="block text-[10px] font-label-bold text-on-surface-variant mb-1 uppercase tracking-wider">Compras</label>
          <select id="filter-compras" class="p-2 bg-surface-container-lowest border border-outline-variant rounded-md text-body-sm outline-none focus:border-primary">
            <option value="">Todos</option>
            <option value="with">Con compras</option>
            <option value="without">Solo cotizado, sin comprar</option>
          </select>
        </div>
        <div>
          <label class="block text-[10px] font-label-bold text-on-surface-variant mb-1 uppercase tracking-wider">Saldo</label>
          <select id="filter-saldo" class="p-2 bg-surface-container-lowest border border-outline-variant rounded-md text-body-sm outline-none focus:border-primary">
            <option value="">Todos</option>
            <option value="pending">Con saldo pendiente</option>
            <option value="none">Sin saldo pendiente</option>
          </select>
        </div>
        <div>
          <label class="block text-[10px] font-label-bold text-on-surface-variant mb-1 uppercase tracking-wider">Registrado desde</label>
          <input id="filter-from" type="date" class="p-2 bg-surface-container-lowest border border-outline-variant rounded-md text-body-sm outline-none focus:border-primary" />
        </div>
        <div>
          <label class="block text-[10px] font-label-bold text-on-surface-variant mb-1 uppercase tracking-wider">Hasta</label>
          <input id="filter-to" type="date" class="p-2 bg-surface-container-lowest border border-outline-variant rounded-md text-body-sm outline-none focus:border-primary" />
        </div>
        <button id="filter-clear" class="px-3 py-2 rounded-md border border-outline-variant text-body-sm font-label-bold text-on-surface-variant hover:bg-surface-container-lowest transition-colors">Limpiar filtros</button>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full text-left border-collapse min-w-[760px]">
          <thead>
            <tr class="bg-surface-container-low border-b border-outline-variant">
              <th class="p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase tracking-wider">Cliente</th>
              <th class="p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase tracking-wider">Teléfono</th>
              <th class="p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase tracking-wider text-center">Pedidos</th>
              <th class="p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase tracking-wider text-right">Total Comprado</th>
              <th class="p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase tracking-wider text-right">Saldo Pendiente</th>
              <th class="p-table-cell-padding"></th>
            </tr>
          </thead>
          <tbody id="clientes-tbody" class="divide-y divide-outline-variant"></tbody>
        </table>
      </div>
      <div id="clientes-loadmore-wrap" class="hidden p-4 border-t border-outline-variant text-center">
        <button id="clientes-loadmore-btn" class="px-4 py-2 rounded-lg border border-outline-variant text-body-sm font-label-bold text-primary hover:bg-surface-container-low transition-colors">Mostrar más</button>
        <p id="clientes-loadmore-info" class="text-[11px] text-on-surface-variant mt-1"></p>
      </div>
    </div>

    <div id="ficha-cliente" class="hidden border-2 border-primary/30 rounded-xl p-gutter shadow-sm bg-surface"></div>
  `;

  const countEl = container.querySelector('#clientes-count');
  const refreshBtn = container.querySelector('#clientes-refresh-btn');
  const tbody = container.querySelector('#clientes-tbody');
  const loadmoreWrap = container.querySelector('#clientes-loadmore-wrap');
  const loadmoreInfo = container.querySelector('#clientes-loadmore-info');
  const loadmoreBtn = container.querySelector('#clientes-loadmore-btn');
  const fichaRoot = container.querySelector('#ficha-cliente');

  const filterQ = container.querySelector('#filter-q');
  const filterAsesorWrap = container.querySelector('#filter-asesor-wrap');
  const filterAsesor = container.querySelector('#filter-asesor');
  const filterProducto = container.querySelector('#filter-producto');
  const filterCompras = container.querySelector('#filter-compras');
  const filterSaldo = container.querySelector('#filter-saldo');
  const filterFrom = container.querySelector('#filter-from');
  const filterTo = container.querySelector('#filter-to');
  const filterClear = container.querySelector('#filter-clear');

  // Un asesor ya solo ve sus propios clientes (el backend los limita via
  // scopedClientIds), asi que el filtro de asesor no le sirve de nada -- se
  // oculta igual que en ventas.js con canCreate/canReassign.
  if (ctx.user?.role === 'asesor') filterAsesorWrap.classList.add('hidden');

  let allClients = [];
  let visibleCount = PAGE_SIZE;

  async function loadAdvisorFilterOptions() {
    if (ctx.user?.role === 'asesor') return;
    let advisors = [];
    try {
      advisors = (await ctx.api.get('/api/advisors')).filter((a) => !a.is_group);
    } catch {
      return;
    }
    filterAsesor.innerHTML = '<option value="">Todos</option>' + advisors.map((a) => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join('');
  }

  function buildFilterParams() {
    const params = new URLSearchParams();
    if (filterQ.value.trim()) params.set('q', filterQ.value.trim());
    if (filterAsesor.value) params.set('advisor_id', filterAsesor.value);
    if (filterProducto.value) params.set('product', filterProducto.value);
    if (filterCompras.value) params.set('purchases', filterCompras.value);
    if (filterSaldo.value) params.set('balance', filterSaldo.value);
    if (filterFrom.value) params.set('from', filterFrom.value);
    if (filterTo.value) params.set('to', filterTo.value);
    return params;
  }

  function rowHtml(c) {
    return `
      <tr class="hover:bg-surface-container-low/50 transition-colors cursor-pointer" data-open="${c.id}">
        <td class="p-table-cell-padding text-body-md font-semibold text-on-surface">${escapeHtml(c.name)}</td>
        <td class="p-table-cell-padding text-body-md text-on-surface-variant">${escapeHtml(c.phone || '—')}</td>
        <td class="p-table-cell-padding text-center">${c.lead_count}</td>
        <td class="p-table-cell-padding text-right font-bold">${formatMoney(c.total_comprado)}</td>
        <td class="p-table-cell-padding text-right ${c.saldo_pendiente > 0 ? 'text-error font-bold' : 'text-on-surface-variant'}">${formatMoney(c.saldo_pendiente)}</td>
        <td class="p-table-cell-padding text-right">
          <button data-open="${c.id}" class="text-primary hover:text-on-primary-fixed-variant text-body-sm font-label-bold inline-flex items-center gap-1">
            Ver ficha <span class="material-symbols-outlined text-[16px]">chevron_right</span>
          </button>
        </td>
      </tr>
    `;
  }

  function renderTable() {
    const shown = allClients.slice(0, visibleCount);
    const emptyMsg = buildFilterParams().toString() ? 'Ningún cliente coincide con estos filtros.' : 'No hay clientes registrados.';
    tbody.innerHTML = shown.length
      ? shown.map(rowHtml).join('')
      : `<tr><td colspan="6" class="p-table-cell-padding py-10 text-center text-body-sm text-on-surface-variant">${emptyMsg}</td></tr>`;
    countEl.textContent = `${allClients.length} cliente${allClients.length === 1 ? '' : 's'}`;
    const remaining = allClients.length - shown.length;
    loadmoreWrap.classList.toggle('hidden', remaining <= 0);
    if (remaining > 0) loadmoreInfo.textContent = `Mostrando ${shown.length} de ${allClients.length} · quedan ${remaining} más`;
  }

  async function loadList() {
    try {
      refreshBtn.disabled = true;
      refreshBtn.textContent = 'Cargando...';
      allClients = await ctx.api.get(`/api/clients?${buildFilterParams().toString()}`);
    } catch {
      ctx.toast('No se pudo cargar el listado de clientes', 'error');
      return;
    } finally {
      refreshBtn.disabled = false;
      refreshBtn.textContent = 'Actualizar';
    }
    visibleCount = PAGE_SIZE;
    renderTable();
  }

  loadmoreBtn.addEventListener('click', () => {
    visibleCount += PAGE_SIZE;
    renderTable();
  });

  let searchDebounce;
  filterQ.addEventListener('input', () => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(loadList, 300);
  });
  [filterAsesor, filterProducto, filterCompras, filterSaldo, filterFrom, filterTo].forEach((el) => {
    el.addEventListener('change', loadList);
  });
  filterClear.addEventListener('click', () => {
    filterQ.value = '';
    filterAsesor.value = '';
    filterProducto.value = '';
    filterCompras.value = '';
    filterSaldo.value = '';
    filterFrom.value = '';
    filterTo.value = '';
    loadList();
  });

  container.querySelector('#new-client-btn').addEventListener('click', () => {
    openModal({
      title: 'Crear nuevo cliente',
      render: (body, { close }) => {
        body.innerHTML = `
          <div class="space-y-4">
            <div>
              <label class="block text-label-bold font-label-bold text-on-surface-variant mb-1 uppercase tracking-wider">Nombre completo</label>
              <input id="new-client-name" type="text" class="w-full p-2.5 bg-surface-container-lowest border border-outline-variant rounded-md text-body-md outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" />
            </div>
            <div>
              <label class="block text-label-bold font-label-bold text-on-surface-variant mb-1 uppercase tracking-wider">Teléfono</label>
              <input id="new-client-phone" type="tel" class="w-full p-2.5 bg-surface-container-lowest border border-outline-variant rounded-md text-body-md outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" />
            </div>
            <div>
              <label class="block text-label-bold font-label-bold text-on-surface-variant mb-1 uppercase tracking-wider">Documento</label>
              <input id="new-client-document" type="text" class="w-full p-2.5 bg-surface-container-lowest border border-outline-variant rounded-md text-body-md outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" />
            </div>
            <div>
              <label class="block text-label-bold font-label-bold text-on-surface-variant mb-1 uppercase tracking-wider">Notas</label>
              <textarea id="new-client-notes" rows="3" class="w-full p-2.5 bg-surface-container-lowest border border-outline-variant rounded-md text-body-md outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"></textarea>
            </div>
            <p id="new-client-error" class="text-body-sm font-body-sm text-error hidden"></p>
            <div class="flex justify-end gap-2">
              <button id="new-client-cancel" class="px-4 py-2 rounded-lg border border-outline-variant hover:bg-surface-container-low">Cancelar</button>
              <button id="new-client-ok" class="px-4 py-2 bg-primary text-on-primary rounded-lg font-label-bold hover:bg-on-primary-fixed-variant">Crear cliente</button>
            </div>
          </div>
        `;
        const errorEl = body.querySelector('#new-client-error');
        const cancelBtn = body.querySelector('#new-client-cancel');
        const okBtn = body.querySelector('#new-client-ok');

        cancelBtn.addEventListener('click', close);
        okBtn.addEventListener('click', async () => {
          errorEl.classList.add('hidden');
          const name = body.querySelector('#new-client-name').value.trim();
          const phone = body.querySelector('#new-client-phone').value.trim();
          const document = body.querySelector('#new-client-document').value.trim();
          const notes = body.querySelector('#new-client-notes').value.trim();
          if (!name) {
            errorEl.textContent = 'El nombre es obligatorio';
            errorEl.classList.remove('hidden');
            return;
          }
          try {
            okBtn.disabled = true;
            const newClient = await ctx.api.post('/api/clients', { name, phone, document, notes });
            ctx.toast('Cliente creado', 'success');
            close();
            await loadList();
            openFicha(newClient.id);
          } catch (err) {
            errorEl.textContent = err.message;
            errorEl.classList.remove('hidden');
          } finally {
            okBtn.disabled = false;
          }
        });
      },
    });
  });

  // --- Ficha individual -----------------------------------------------
  function leadRowHtml(lead, payments) {
    const b = statusBadge(lead.status);
    const paid = payments.filter((p) => p.lead_id === lead.id).reduce((s, p) => s + p.amount, 0);
    const saldo = (lead.amount || 0) - paid;
    const canPay = lead.status === 'cerrado_ganado' && lead.amount > 0;
    return `
      <tr class="hover:bg-surface-container-low/50 transition-colors">
        <td class="p-2 text-on-surface-variant whitespace-nowrap">${escapeHtml((lead.created_at || '').slice(0, 10))}</td>
        <td class="p-2 text-on-surface">${escapeHtml(lead.product || '—')}</td>
        <td class="p-2 text-on-surface-variant">${escapeHtml(lead.advisor_name || '—')}</td>
        <td class="p-2"><span class="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold ${b.badgeClass}">${b.label}</span></td>
        <td class="p-2 text-right font-bold">${formatMoney(lead.amount)}</td>
        <td class="p-2 text-right ${saldo > 0 ? 'text-error font-bold' : 'text-on-surface-variant'}">${canPay ? formatMoney(saldo) : '—'}</td>
        <td class="p-2 text-right">${canPay ? `<button data-pay="${lead.id}" class="text-primary hover:text-on-primary-fixed-variant text-[11px] font-label-bold border border-outline-variant rounded-md px-2 py-1">Registrar abono</button>` : ''}</td>
      </tr>
    `;
  }

  function paymentRowHtml(p, leadsById) {
    const lead = leadsById.get(p.lead_id);
    return `
      <tr>
        <td class="p-2 text-on-surface-variant whitespace-nowrap">${escapeHtml((p.paid_at || '').slice(0, 16).replace('T', ' '))}</td>
        <td class="p-2 text-on-surface">${escapeHtml(lead ? lead.product || 'Pedido' : 'Pedido')}</td>
        <td class="p-2 text-right font-bold text-secondary">${formatMoney(p.amount)}</td>
        <td class="p-2 text-on-surface-variant">${escapeHtml(p.notes || '—')}</td>
      </tr>
    `;
  }

  function openPaymentModal(client, lead, onDone) {
    openModal({
      title: `Registrar abono · ${escapeHtml(lead.product || 'Pedido')}`,
      render: (body, { close }) => {
        body.innerHTML = `
          <label class="block text-label-bold font-label-bold uppercase tracking-wide text-on-surface-variant mb-1">Monto (COP)</label>
          <input id="pay-amount" type="number" min="1" step="1000" placeholder="0" class="w-full p-2.5 border border-outline-variant rounded-md mb-4 outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" />
          <label class="block text-label-bold font-label-bold uppercase tracking-wide text-on-surface-variant mb-1">Nota (opcional)</label>
          <input id="pay-notes" type="text" placeholder="Ej. Transferencia, efectivo..." class="w-full p-2.5 border border-outline-variant rounded-md mb-4 outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" />
          <div class="flex justify-end gap-2">
            <button id="pay-cancel" class="px-4 py-2 rounded-lg border border-outline-variant hover:bg-surface-container-low">Cancelar</button>
            <button id="pay-ok" class="px-4 py-2 rounded-lg bg-primary text-on-primary font-bold hover:bg-on-primary-fixed-variant">Guardar abono</button>
          </div>
        `;
        body.querySelector('#pay-cancel').addEventListener('click', close);
        body.querySelector('#pay-ok').addEventListener('click', async () => {
          const amount = body.querySelector('#pay-amount').value;
          const notes = body.querySelector('#pay-notes').value.trim();
          if (!amount || Number(amount) <= 0) {
            ctx.toast('Ingresa un monto válido', 'error');
            return;
          }
          try {
            await ctx.api.post(`/api/leads/${lead.id}/payments`, { amount, notes });
            ctx.toast('Abono registrado', 'success');
            close();
            onDone?.();
          } catch (err) {
            ctx.toast(err.message, 'error');
          }
        });
      },
    });
  }

  async function openFicha(id) {
    let client;
    try {
      client = await ctx.api.get(`/api/clients/${id}`);
    } catch (err) {
      ctx.toast('No se pudo cargar la ficha del cliente', 'error');
      return;
    }
    const leadsById = new Map(client.leads.map((l) => [l.id, l]));

    fichaRoot.classList.remove('hidden');
    fichaRoot.innerHTML = `
      <div class="flex flex-wrap items-start justify-between gap-3 mb-5">
        <div>
          <p class="text-[10px] font-label-bold text-primary uppercase tracking-wider mb-0.5">Ficha de cliente</p>
          <h3 class="text-headline-sm font-headline-sm text-on-surface">${escapeHtml(client.name)}</h3>
          <p class="text-body-sm text-on-surface-variant mt-1">Último pedido: ${client.leads.length ? escapeHtml((client.leads[0].created_at || '').slice(0, 10)) : 'N/A'} · Abonos: ${client.payments.length}</p>
        </div>
        <button id="ficha-cerrar" class="p-2 text-on-surface-variant hover:text-primary transition-colors">
          <span class="material-symbols-outlined">close</span>
        </button>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-3 gap-gutter mb-gutter">
        ${fieldHtml('ficha-name', 'Nombre completo', client.name, 'Nombre completo')}
        ${fieldHtml('ficha-phone', 'Teléfono', client.phone, 'Sin dato')}
        ${fieldHtml('ficha-document', 'Documento', client.document, 'Opcional')}
      </div>
      <div class="mb-gutter">
        <label class="block text-[10px] font-label-bold text-on-surface-variant mb-1 uppercase tracking-wider">Notas</label>
        <textarea id="ficha-notes" rows="3" class="w-full p-2.5 bg-surface-container-lowest border border-outline-variant rounded-md text-body-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20">${escapeHtml(client.notes || '')}</textarea>
      </div>
      <button id="ficha-guardar" class="mb-gutter px-4 py-2 border border-outline-variant rounded-md text-label-bold font-label-bold text-primary hover:bg-surface-container-low transition-colors">Guardar datos</button>

      <div class="grid grid-cols-1 md:grid-cols-3 gap-gutter mb-gutter">
        ${kpiMini('Total Comprado', formatMoney(client.total_comprado))}
        ${kpiMini('Total Abonado', formatMoney(client.total_abonado))}
        ${kpiMini('Saldo Pendiente', formatMoney(client.saldo_pendiente))}
      </div>

      <div class="border border-outline-variant rounded-xl p-4 mb-gutter">
        <h4 class="text-body-md font-body-md font-semibold text-on-surface mb-3">Pedidos (${client.leads.length})</h4>
        <div class="overflow-x-auto">
          <table class="w-full text-left border-collapse text-body-sm">
            <thead>
              <tr class="border-b border-outline-variant">
                <th class="p-2 text-label-bold font-label-bold text-on-surface-variant uppercase text-[10px]">Fecha</th>
                <th class="p-2 text-label-bold font-label-bold text-on-surface-variant uppercase text-[10px]">Producto</th>
                <th class="p-2 text-label-bold font-label-bold text-on-surface-variant uppercase text-[10px]">Asesor</th>
                <th class="p-2 text-label-bold font-label-bold text-on-surface-variant uppercase text-[10px]">Estado</th>
                <th class="p-2 text-label-bold font-label-bold text-on-surface-variant uppercase text-[10px] text-right">Monto</th>
                <th class="p-2 text-label-bold font-label-bold text-on-surface-variant uppercase text-[10px] text-right">Saldo</th>
                <th class="p-2"></th>
              </tr>
            </thead>
            <tbody id="ficha-leads-tbody" class="divide-y divide-outline-variant">
              ${client.leads.length ? client.leads.map((l) => leadRowHtml(l, client.payments)).join('') : `<tr><td colspan="7" class="p-4 text-center text-on-surface-variant">Sin pedidos registrados.</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>

      <div class="border border-outline-variant rounded-xl p-4">
        <h4 class="text-body-md font-body-md font-semibold text-on-surface mb-3">Abonos registrados (${client.payments.length})</h4>
        <div class="overflow-x-auto">
          <table class="w-full text-left border-collapse text-body-sm">
            <thead>
              <tr class="border-b border-outline-variant">
                <th class="p-2 text-label-bold font-label-bold text-on-surface-variant uppercase text-[10px]">Fecha</th>
                <th class="p-2 text-label-bold font-label-bold text-on-surface-variant uppercase text-[10px]">Pedido</th>
                <th class="p-2 text-label-bold font-label-bold text-on-surface-variant uppercase text-[10px] text-right">Monto</th>
                <th class="p-2 text-label-bold font-label-bold text-on-surface-variant uppercase text-[10px]">Nota</th>
              </tr>
            </thead>
            <tbody id="ficha-payments-tbody" class="divide-y divide-outline-variant">
              ${client.payments.length ? client.payments.map((p) => paymentRowHtml(p, leadsById)).join('') : `<tr><td colspan="4" class="p-4 text-center text-on-surface-variant">Sin abonos registrados.</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>
    `;

    fichaRoot.querySelector('#ficha-cerrar').addEventListener('click', () => {
      fichaRoot.classList.add('hidden');
      fichaRoot.innerHTML = '';
    });
    fichaRoot.querySelector('#ficha-guardar').addEventListener('click', async () => {
      try {
        await ctx.api.patch(`/api/clients/${id}`, {
          name: fichaRoot.querySelector('#ficha-name').value.trim(),
          phone: fichaRoot.querySelector('#ficha-phone').value.trim(),
          document: fichaRoot.querySelector('#ficha-document').value.trim(),
          notes: fichaRoot.querySelector('#ficha-notes').value.trim(),
        });
        ctx.toast('Datos del cliente actualizados', 'success');
        loadList();
      } catch (err) {
        ctx.toast(err.message, 'error');
      }
    });
    fichaRoot.querySelectorAll('button[data-pay]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const lead = leadsById.get(Number(btn.dataset.pay));
        if (lead) openPaymentModal(client, lead, () => openFicha(id));
      });
    });

    fichaRoot.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  tbody.addEventListener('click', (e) => {
    const trigger = e.target.closest('[data-open]');
    if (!trigger) return;
    openFicha(Number(trigger.dataset.open));
  });

  refreshBtn.addEventListener('click', loadList);
  const offLeads = ctx.ws.on('leads_changed', loadList);
  await Promise.all([loadList(), loadAdvisorFilterOptions()]);

  return () => offLeads();
}
