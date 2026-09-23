import { escapeHtml } from '../utils.js';
import { openModal } from '../components/modal.js';
import { soStatusChip, statusChip, alertChip, fmtDay, fmtDateTime, fmtQty, localToday, inputCls, labelCls, PRIORITY } from '../components/production.js';

// Pedidos (secciones 3 y 4 de la especificación): el pedido comercial es
// distinto de la OP. Llega desde una cotización aprobada ("Enviar a
// producción" en Cotizar) o se registra a mano; producción lo valida
// (o solicita información) y crea una o varias OP.

export async function mount(container, ctx) {
  let meta = { workers: [], advisors: [], services: [], can_manage: false };
  try {
    meta = await ctx.api.get('/api/production/meta');
  } catch {
    /* sin meta */
  }
  const canManage = meta.can_manage;
  let filter = 'pendientes';

  container.innerHTML = `
    <div class="flex justify-between items-end mb-margin-desktop flex-wrap gap-3">
      <div>
        <h2 class="text-headline-lg font-headline-lg text-on-surface">Pedidos</h2>
        <p class="text-body-md font-body-md text-on-surface-variant mt-1">Lo que Comercial pide fabricar. Se valida y se convierte en una o varias órdenes de producción.</p>
      </div>
      ${canManage ? '<button id="pe-new" class="btn btn-primary"><span class="material-symbols-outlined">add</span>Pedido manual</button>' : ''}
    </div>
    <div id="pe-filters" class="flex gap-2 flex-wrap mb-gutter"></div>
    <div class="bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm overflow-x-auto">
      <table class="w-full text-left border-collapse min-w-[760px]">
        <thead><tr class="border-b border-outline-variant">
          ${['Pedido', 'Cliente', 'Producto', 'Entrega solicitada', 'Estado', 'Órdenes de producción'].map((h) => `<th class="p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase tracking-wider">${h}</th>`).join('')}
        </tr></thead>
        <tbody id="pe-tbody" class="divide-y divide-outline-variant"></tbody>
      </table>
    </div>`;

  const tbody = container.querySelector('#pe-tbody');
  let orders = [];

  const FILTERS = [
    ['pendientes', 'Por validar', (o) => ['recibido', 'por_validar', 'info_solicitada'].includes(o.status)],
    ['validados', 'Validados', (o) => o.status === 'validado'],
    ['todos', 'Todos', () => true],
  ];

  function render() {
    container.querySelector('#pe-filters').innerHTML = FILTERS.map(([k, l, fn]) => `<button data-f="${k}" class="px-3 py-1.5 rounded-full border text-body-sm ${filter === k ? 'border-outline bg-surface-container-high text-on-surface font-bold' : 'border-outline-variant text-on-surface-variant hover:bg-surface-container-low'}">${l} (${orders.filter(fn).length})</button>`).join('');
    container.querySelectorAll('[data-f]').forEach((b) => b.addEventListener('click', () => { filter = b.dataset.f; render(); }));
    const fn = FILTERS.find(([k]) => k === filter)[2];
    const list = orders.filter(fn);
    tbody.innerHTML = list.length
      ? list.map((o) => `
        <tr data-open="${o.id}" class="cursor-pointer hover:bg-surface-container-low">
          <td class="p-table-cell-padding"><p class="font-bold text-on-surface">${escapeHtml(o.number)}</p><p class="text-[11px] text-on-surface-variant">${o.quotation_number ? `Cotización ${escapeHtml(o.quotation_number)}` : 'Manual'} · ${fmtDateTime(o.received_at)}</p></td>
          <td class="p-table-cell-padding text-body-sm text-on-surface">${escapeHtml(o.client_name)}<span class="block text-[11px] text-on-surface-variant">${escapeHtml(o.advisor_name || '')}</span></td>
          <td class="p-table-cell-padding text-[12px] text-on-surface-variant max-w-[280px]">${escapeHtml(o.product_summary || '—')}</td>
          <td class="p-table-cell-padding text-body-sm">${fmtDay(o.requested_date)}</td>
          <td class="p-table-cell-padding">${soStatusChip(o.status)}${o.status === 'info_solicitada' && o.info_request ? `<p class="text-[11px] text-on-surface-variant mt-1">${escapeHtml(o.info_request)}</p>` : ''}</td>
          <td class="p-table-cell-padding text-body-sm text-on-surface">${escapeHtml(o.ops_numbers || '—')}</td>
        </tr>`).join('')
      : `<tr><td colspan="6" class="p-table-cell-padding py-8 text-center text-body-sm text-on-surface-variant">${filter === 'pendientes' ? 'No hay pedidos por validar.' : 'Sin pedidos.'}</td></tr>`;
  }

  async function load() {
    try {
      orders = await ctx.api.get('/api/production/orders');
      render();
    } catch (err) {
      ctx.toast(err.message, 'error');
    }
  }

  async function openOrder(soId) {
    let so;
    try {
      so = await ctx.api.get(`/api/production/orders/${soId}`);
    } catch (err) {
      ctx.toast(err.message, 'error');
      return;
    }
    const closeIt = openModal({
      title: `${so.number} · ${so.client_name}`,
      wide: true,
      render: (body, { close }) => {
        const open = !['cancelado'].includes(so.status);
        body.innerHTML = `
          <div class="flex items-center justify-between gap-2 flex-wrap mb-3">
            <div class="flex items-center gap-2">${soStatusChip(so.status)}<span class="text-[12px] text-on-surface-variant">${so.quotation_number ? `Desde la cotización ${escapeHtml(so.quotation_number)}` : 'Registro manual'}</span></div>
            ${canManage && open ? `<div class="flex gap-2 flex-wrap">
              ${so.status !== 'validado' ? '<button id="so-info" class="btn btn-ghost text-[12px]"><span class="material-symbols-outlined">help</span>Solicitar información</button><button id="so-validate" class="btn btn-secondary text-[12px]"><span class="material-symbols-outlined">check</span>Información completa</button>' : ''}
              <button id="so-newop" class="btn btn-primary text-[12px]"><span class="material-symbols-outlined">add</span>Crear OP</button>
            </div>` : ''}
          </div>
          ${so.status === 'info_solicitada' ? `<div class="mb-3 px-3 py-2 rounded-lg border border-error/40 text-body-sm"><b>Información solicitada:</b> ${escapeHtml(so.info_request || '')}</div>` : ''}
          <dl class="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2 text-body-sm mb-4">
            ${[
              ['Cliente', so.client_name], ['Contacto', so.contact], ['Teléfono', so.phone], ['Dirección', so.address], ['Destino', so.destination],
              ['Asesor', so.advisor_name], ['Entrega solicitada', fmtDay(so.requested_date)], ['Recibido', fmtDateTime(so.received_at)],
            ].map(([k, v]) => `<div class="flex justify-between gap-3 border-b border-outline-variant pb-1"><dt class="text-on-surface-variant">${k}</dt><dd class="text-on-surface text-right">${escapeHtml(v || '—')}</dd></div>`).join('')}
          </dl>
          <p class="${labelCls}">Producto solicitado</p>
          <p class="text-body-sm text-on-surface mb-3">${escapeHtml(so.product_summary || '—')}</p>
          ${so.notes ? `<p class="${labelCls}">Notas</p><p class="text-body-sm text-on-surface mb-3 whitespace-pre-line">${escapeHtml(so.notes)}</p>` : ''}
          <p class="${labelCls}">Órdenes de producción</p>
          <div class="border border-outline-variant rounded-lg divide-y divide-outline-variant mb-4">
            ${so.ops.map((o) => `<a href="#/op?id=${o.id}" class="flex items-center justify-between gap-2 px-3 py-2 text-body-sm hover:bg-surface-container-low"><span><b>${escapeHtml(o.number)}</b> · ${escapeHtml(o.product_name)} · ${fmtQty(o.quantity)} ${escapeHtml(o.unit)}</span><span class="flex items-center gap-2">${alertChip(o.alert)}${statusChip(o.status)}</span></a>`).join('') || '<p class="px-3 py-2 text-body-sm text-on-surface-variant">Todavía no tiene OP.</p>'}
          </div>
          <details><summary class="${labelCls} cursor-pointer">Historial del pedido</summary>
            <ul class="mt-2 space-y-1">${so.activity.map((a) => `<li class="text-[12px]"><span class="text-on-surface-variant">${fmtDateTime(a.created_at)} · ${escapeHtml(a.user_name)} —</span> ${escapeHtml(a.action)}${a.detail ? ` <span class="text-on-surface-variant">(${escapeHtml(a.detail)})</span>` : ''}</li>`).join('')}</ul>
          </details>
          ${canManage && open && !so.ops.some((o) => !['cancelada', 'cerrada'].includes(o.status)) ? '<div class="text-right mt-3"><button id="so-cancel" class="text-body-sm text-error inline-flex items-center gap-1"><span class="material-symbols-outlined text-[16px]">cancel</span>Cancelar pedido</button></div>' : ''}`;

        const reason = (title, ph, cb) =>
          openModal({
            title,
            render: (b2, { close: c2 }) => {
              b2.innerHTML = `<textarea id="rz" rows="3" placeholder="${ph}" class="${inputCls} mb-3 resize-none"></textarea><div class="flex justify-end gap-2"><button id="rz-c" class="btn btn-ghost">Cancelar</button><button id="rz-ok" class="btn btn-primary">Confirmar</button></div>`;
              b2.querySelector('#rz-c').addEventListener('click', c2);
              b2.querySelector('#rz-ok').addEventListener('click', async () => {
                const v = b2.querySelector('#rz').value.trim();
                if (!v) return ctx.toast('Completa el campo', 'error');
                try {
                  await cb(v);
                  c2();
                  close();
                  load();
                } catch (err) {
                  ctx.toast(err.message, 'error');
                }
              });
            },
          });
        body.querySelector('#so-info')?.addEventListener('click', () =>
          reason('Solicitar información', '¿Qué información falta? (medidas, diseño, color…)', async (v) => {
            await ctx.api.post(`/api/production/orders/${so.id}/request-info`, { info_request: v });
            ctx.toast('Información solicitada', 'success');
          })
        );
        body.querySelector('#so-cancel')?.addEventListener('click', () =>
          reason('Cancelar pedido', 'Motivo de la cancelación', async (v) => {
            await ctx.api.post(`/api/production/orders/${so.id}/cancel`, { reason: v });
            ctx.toast('Pedido cancelado', 'success');
          })
        );
        body.querySelector('#so-validate')?.addEventListener('click', async () => {
          try {
            await ctx.api.post(`/api/production/orders/${so.id}/validate`, {});
            ctx.toast('Pedido validado', 'success');
            close();
            load();
            openOrder(so.id);
          } catch (err) {
            ctx.toast(err.message, 'error');
          }
        });
        body.querySelector('#so-newop')?.addEventListener('click', () => {
          close();
          openNewOp(so);
        });
      },
    });
    return closeIt;
  }

  function openNewOp(so) {
    const q = so.quotation;
    const svc = q ? meta.services.find((s) => s.slug === q.service_slug) : null;
    const qty = q ? q.lines.reduce((s, l) => s + (Number(l.qty) || 0), 0) || 1 : 1;
    openModal({
      title: `Nueva OP · ${so.number}`,
      wide: true,
      render: (body, { close }) => {
        body.innerHTML = `
          <p class="text-[12px] text-on-surface-variant mb-3">El número de OP se asigna solo. ${q ? 'Las características del producto se copian de la cotización.' : ''} Para programarla necesita producto, cantidad, fecha comprometida y responsable.</p>
          <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div class="md:col-span-2"><label class="${labelCls}">Producto *</label><input id="no-prod" value="${escapeHtml(svc ? svc.title : so.product_summary || '')}" class="${inputCls}" /></div>
            <div><label class="${labelCls}">Código</label><input id="no-code" class="${inputCls}" /></div>
            <div><label class="${labelCls}">Cantidad *</label><input id="no-qty" type="number" min="0" step="1" value="${qty}" class="${inputCls}" /></div>
            <div><label class="${labelCls}">Unidad</label><input id="no-unit" value="und" class="${inputCls}" /></div>
            <div><label class="${labelCls}">Prioridad</label><select id="no-prio" class="${inputCls}">${Object.entries(PRIORITY).map(([k, v]) => `<option value="${k}" ${k === 'normal' ? 'selected' : ''}>${v.label}</option>`).join('')}</select></div>
            <div><label class="${labelCls}">Entrega solicitada</label><input id="no-req" type="date" value="${so.requested_date || ''}" class="${inputCls}" /></div>
            <div><label class="${labelCls}">Entrega comprometida</label><input id="no-com" type="date" value="${so.requested_date || localToday(5)}" class="${inputCls}" /></div>
            <div><label class="${labelCls}">Inicio programado</label><input id="no-start" type="date" value="${localToday(1)}" class="${inputCls}" /></div>
            <div class="md:col-span-3"><label class="${labelCls}">Responsable de producción</label><select id="no-resp" class="${inputCls}"><option value="">Sin responsable (queda por validar)</option>${meta.workers.map((w) => `<option value="${w.id}">${escapeHtml(w.name)}${w.specialty ? ` · ${escapeHtml(w.specialty)}` : ''}</option>`).join('')}</select></div>
            <div class="md:col-span-3"><label class="${labelCls}">Observaciones</label><textarea id="no-obs" rows="2" class="${inputCls} resize-none"></textarea></div>
          </div>
          <div class="flex justify-end gap-2 mt-4"><button id="no-cancel" class="btn btn-ghost">Cancelar</button><button id="no-ok" class="btn btn-primary">Crear OP</button></div>`;
        body.querySelector('#no-cancel').addEventListener('click', close);
        body.querySelector('#no-ok').addEventListener('click', async (e) => {
          const btn = e.currentTarget;
          btn.disabled = true;
          try {
            const op = await ctx.api.post(`/api/production/orders/${so.id}/ops`, {
              product_name: body.querySelector('#no-prod').value,
              product_code: body.querySelector('#no-code').value,
              quantity: Number(body.querySelector('#no-qty').value),
              unit: body.querySelector('#no-unit').value,
              priority: body.querySelector('#no-prio').value,
              requested_date: body.querySelector('#no-req').value,
              committed_date: body.querySelector('#no-com').value,
              start_date: body.querySelector('#no-start').value,
              responsible_worker_id: body.querySelector('#no-resp').value || null,
              observations: body.querySelector('#no-obs').value,
              service_slug: q ? q.service_slug : null,
            });
            ctx.toast(`${op.number} creada`, 'success');
            close();
            location.hash = `#/op?id=${op.id}`;
          } catch (err) {
            ctx.toast(err.message, 'error');
            btn.disabled = false;
          }
        });
      },
    });
  }

  function openManual() {
    openModal({
      title: 'Pedido manual',
      wide: true,
      render: (body, { close }) => {
        const f = (id, label, type = 'text', ph = '') => `<div><label class="${labelCls}">${label}</label><input id="${id}" type="${type}" placeholder="${ph}" class="${inputCls}" /></div>`;
        body.innerHTML = `
          <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
            ${f('pm-client', 'Cliente *')}${f('pm-contact', 'Contacto')}${f('pm-phone', 'Teléfono', 'tel')}${f('pm-address', 'Dirección')}${f('pm-dest', 'Destino', 'text', 'Ciudad o lugar de entrega')}${f('pm-date', 'Entrega solicitada', 'date')}
            <div><label class="${labelCls}">Asesor</label><select id="pm-adv" class="${inputCls}"><option value="">—</option>${meta.advisors.map((a) => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join('')}</select></div>
            <div class="md:col-span-2"><label class="${labelCls}">Producto solicitado</label><input id="pm-prod" placeholder="Ej. Forros para equipos × 12" class="${inputCls}" /></div>
            <div class="md:col-span-2"><label class="${labelCls}">Notas</label><textarea id="pm-notes" rows="2" class="${inputCls} resize-none"></textarea></div>
          </div>
          <div class="flex justify-end gap-2 mt-4"><button id="pm-cancel" class="btn btn-ghost">Cancelar</button><button id="pm-ok" class="btn btn-primary">Registrar pedido</button></div>`;
        body.querySelector('#pm-cancel').addEventListener('click', close);
        body.querySelector('#pm-ok').addEventListener('click', async () => {
          const v = (id) => body.querySelector(`#${id}`).value;
          try {
            const so = await ctx.api.post('/api/production/orders', {
              client_name: v('pm-client'), contact: v('pm-contact'), phone: v('pm-phone'), address: v('pm-address'), destination: v('pm-dest'),
              requested_date: v('pm-date'), advisor_id: v('pm-adv') || null, product_summary: v('pm-prod'), notes: v('pm-notes'),
            });
            ctx.toast(`Pedido ${so.number} registrado`, 'success');
            close();
            await load();
            openOrder(so.id);
          } catch (err) {
            ctx.toast(err.message, 'error');
          }
        });
      },
    });
  }

  tbody.addEventListener('click', (e) => {
    const r = e.target.closest('[data-open]');
    if (r) openOrder(Number(r.dataset.open));
  });
  container.querySelector('#pe-new')?.addEventListener('click', openManual);

  const off = ctx.ws.on('production_changed', load);
  await load();
  const preset = Number(ctx.routeParams.get('id'));
  if (preset) openOrder(preset);
  return () => off();
}
