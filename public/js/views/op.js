import { escapeHtml } from '../utils.js';
import { openModal, confirmModal } from '../components/modal.js';
import {
  STATUS, PRIORITY, statusChip, alertChip, blockChip, progressBar, fmtDay, fmtDate, fmtDateTime, fmtQty, localToday, inputCls, labelCls,
} from '../components/production.js';

// Detalle de una Orden de Producción (secciones 8 a 24 de la
// especificación), en pestañas. Los botones de estado solo ofrecen las
// transiciones permitidas; el servidor vuelve a validar todo (información
// completa, bloqueos, control aprobado, aprobación del asesor, motivos).
// Un asesor ve la OP de sus clientes en solo lectura, salvo firmar la
// aprobación comercial y registrar reclamos de garantía.

const TABS = [
  ['resumen', 'Resumen', 'dashboard'],
  ['producto', 'Producto', 'chair'],
  ['specs', 'Especificaciones', 'straighten'],
  ['archivos', 'Diseños y archivos', 'draw'],
  ['materiales', 'Materiales', 'inventory_2'],
  ['tareas', 'Tareas', 'checklist'],
  ['control', 'Control y aprobaciones', 'verified'],
  ['bloqueos', 'Bloqueos', 'block'],
  ['entrega', 'Entrega', 'local_shipping'],
  ['historial', 'Historial', 'history'],
];
const TASK_STATUS = { pendiente: 'Pendiente', en_proceso: 'En proceso', completada: 'Completada', bloqueada: 'Bloqueada' };
const REQ_STATUS = { pendiente: 'Pendiente', solicitado: 'Solicitado', disponible: 'Disponible', bloqueado: 'Bloqueado' };
const FILE_KIND = { diseno: 'Diseño', plano: 'Plano', ficha: 'Ficha técnica', foto: 'Fotografía', pdf: 'PDF', otro: 'Otro' };
const CHECKS = [
  ['producto', 'Producto terminado'],
  ['cantidad', 'Cantidad'],
  ['medidas', 'Medidas'],
  ['caracteristicas', 'Características'],
  ['acabados', 'Acabados'],
  ['diseno', 'Diseño correcto'],
];
const CLAIM_LABEL = { abierto: 'Abierto', en_revision: 'En revisión', resuelto: 'Resuelto', rechazado: 'Rechazado' };

// Botón de cada transición manual: texto, estilo y qué pide.
const ACTIONS = {
  programada: { label: 'Validar y programar', icon: 'event_available', primary: true },
  en_produccion: { label: 'Iniciar producción', icon: 'play_arrow', primary: true },
  control: { label: 'Terminar: pasar a control', icon: 'rule', primary: true },
  lista: { label: 'Lista para entregar', icon: 'inventory', primary: true, form: 'lista' },
  entregada: { label: 'Registrar entrega', icon: 'local_shipping', primary: true, form: 'entregada' },
  cerrada: { label: 'Cerrar OP', icon: 'lock', primary: true },
  por_validar: { label: 'Devolver a validación', icon: 'undo', reason: 'Motivo para devolver a validación' },
  cancelada: { label: 'Cancelar OP', icon: 'cancel', reason: 'Motivo de la cancelación', danger: true },
};

const card = (inner, extra = '') => `<div class="bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm p-4 ${extra}">${inner}</div>`;
const sectionTitle = (t, right = '') => `<div class="flex items-center justify-between gap-2 mb-3"><p class="text-label-bold font-label-bold text-on-surface">${t}</p>${right}</div>`;

export async function mount(container, ctx) {
  const id = Number(ctx.routeParams.get('id'));
  let tab = TABS.some(([k]) => k === ctx.routeParams.get('tab')) ? ctx.routeParams.get('tab') : 'resumen';
  let op = null;
  let meta = { workers: [], block_reasons: [], priorities: [] };

  async function fetchOp() {
    op = await ctx.api.get(`/api/production/ops/${id}`);
  }

  try {
    [meta] = await Promise.all([ctx.api.get('/api/production/meta'), fetchOp()]);
  } catch (err) {
    container.innerHTML = `<div class="p-10 text-center text-error">${escapeHtml(err.message)}</div>`;
    return;
  }
  const canManage = op.can_manage;
  const editable = () => canManage && !['cerrada', 'cancelada'].includes(op.status);

  // Ejecuta un cambio; si falla muestra el error y devuelve false (quien
  // llama solo recarga y avisa éxito cuando salió bien).
  async function act(promise) {
    try {
      await promise;
      return true;
    } catch (err) {
      ctx.toast(err.message, 'error');
      return false;
    }
  }
  // Relee la OP completa (con allowed_next/can_manage) y repinta.
  async function refresh(okMsg) {
    await fetchOp();
    if (okMsg) ctx.toast(okMsg, 'success');
    render();
  }

  function askReason(title, placeholder) {
    return new Promise((resolve) => {
      let done = false;
      const close = openModal({
        title,
        render: (body) => {
          body.innerHTML = `
            <textarea id="rs-text" rows="3" placeholder="${escapeHtml(placeholder || '')}" class="${inputCls} mb-4 resize-none"></textarea>
            <div class="flex justify-end gap-2"><button id="rs-cancel" class="btn btn-ghost">Cancelar</button><button id="rs-ok" class="btn btn-primary">Confirmar</button></div>`;
          body.querySelector('#rs-cancel').addEventListener('click', () => close());
          body.querySelector('#rs-ok').addEventListener('click', () => {
            const v = body.querySelector('#rs-text').value.trim();
            if (!v) return ctx.toast('Escribe el motivo', 'error');
            done = true;
            resolve(v);
            close();
          });
        },
      });
      // si se cierra sin confirmar
      const obs = new MutationObserver(() => {
        if (!document.getElementById('rs-text')) {
          obs.disconnect();
          if (!done) resolve(null);
        }
      });
      obs.observe(document.body, { childList: true, subtree: true });
    });
  }

  async function doTransition(to) {
    const a = ACTIONS[to];
    let payload = { to };
    if (a.reason) {
      const reason = await askReason(a.label, a.reason);
      if (!reason) return;
      payload.reason = reason;
    }
    if (a.form === 'lista' || a.form === 'entregada') {
      payload = await deliveryForm(to);
      if (!payload) return;
    }
    if (await act(ctx.api.post(`/api/production/ops/${id}/transition`, payload))) await refresh(`OP en "${STATUS[to].label}"`);
  }

  function deliveryForm(to) {
    return new Promise((resolve) => {
      let resolved = false;
      const close = openModal({
        title: to === 'lista' ? 'Lista para entregar' : 'Registrar entrega',
        render: (body) => {
          body.innerHTML = `
            <div class="space-y-3">
              <div class="grid grid-cols-2 gap-3">
                <div><label class="${labelCls}">${to === 'lista' ? 'Fecha de finalización' : 'Fecha de entrega'}</label><input id="dv-date" type="date" value="${localToday()}" class="${inputCls}" /></div>
                <div><label class="${labelCls}">${to === 'lista' ? 'Responsable' : 'Entregó *'}</label><input id="dv-resp" type="text" value="${escapeHtml(op.responsible_name || '')}" class="${inputCls}" /></div>
              </div>
              ${to === 'lista'
                ? `<div><label class="${labelCls}">Autorizó</label><input id="dv-auth" type="text" placeholder="Quién autoriza la entrega" class="${inputCls}" /></div>`
                : `<div><label class="${labelCls}">Recibió (cliente)</label><input id="dv-recv" type="text" placeholder="Nombre de quien recibe" class="${inputCls}" /></div>`}
              <div><label class="${labelCls}">Observaciones</label><textarea id="dv-notes" rows="2" class="${inputCls} resize-none"></textarea></div>
            </div>
            <div class="flex justify-end gap-2 mt-4"><button id="dv-cancel" class="btn btn-ghost">Cancelar</button><button id="dv-ok" class="btn btn-primary">Confirmar</button></div>`;
          body.querySelector('#dv-cancel').addEventListener('click', () => {
            resolve(null);
            resolved = true;
            close();
          });
          body.querySelector('#dv-ok').addEventListener('click', () => {
            const payload = {
              to,
              date: body.querySelector('#dv-date').value,
              responsible: body.querySelector('#dv-resp').value.trim(),
              notes: body.querySelector('#dv-notes').value.trim(),
            };
            if (to === 'lista') payload.authorized_by = body.querySelector('#dv-auth').value.trim();
            else payload.received_by = body.querySelector('#dv-recv').value.trim();
            if (to === 'entregada' && !payload.responsible) return ctx.toast('Indica quién entregó', 'error');
            resolved = true;
            resolve(payload);
            close();
          });
        },
      });
      const obs = new MutationObserver(() => {
        if (!document.getElementById('dv-date')) {
          obs.disconnect();
          if (!resolved) resolve(null);
        }
      });
      obs.observe(document.body, { childList: true, subtree: true });
    });
  }

  // ---- cabecera (siempre visible) ------------------------------------------------
  function headerHtml() {
    const next = (op.allowed_next || []).filter((s) => ACTIONS[s] && !(op.status === 'control' && s === 'en_produccion'));
    const primary = next.filter((s) => ACTIONS[s].primary);
    const secondary = next.filter((s) => !ACTIONS[s].primary);
    return `
      <a href="#/produccion" class="inline-flex items-center gap-1.5 text-body-sm text-on-surface-variant hover:text-on-surface mb-2"><span class="material-symbols-outlined text-[18px]">arrow_back</span>Tablero de producción</a>
      <div class="flex items-start justify-between gap-4 flex-wrap mb-3">
        <div class="min-w-0">
          <div class="flex items-center gap-2 flex-wrap">
            <h2 class="text-headline-lg font-headline-lg text-on-surface">${escapeHtml(op.number)}</h2>
            ${statusChip(op.status)} ${alertChip(op.alert)} ${blockChip(op)}
          </div>
          <p class="text-body-md text-on-surface mt-1"><b>${escapeHtml(op.client_name)}</b> · ${escapeHtml(op.product_name)} · ${fmtQty(op.quantity)} ${escapeHtml(op.unit)}</p>
          <p class="text-[12px] text-on-surface-variant">Pedido <a href="#/pedidos?id=${op.sales_order_id}" class="underline">${escapeHtml(op.sales_order_number)}</a> · Entrega ${fmtDay(op.committed_date || op.requested_date)} · ${escapeHtml(op.responsible_name || 'Sin responsable')}</p>
        </div>
        <div class="flex gap-2 flex-wrap items-center">
          <div class="relative">
            <button id="op-docs" class="btn btn-ghost"><span class="material-symbols-outlined">description</span>Documentos</button>
            <div id="op-docs-menu" class="hidden absolute right-0 mt-1 z-20 w-60 bg-surface border border-outline-variant rounded-lg shadow-lg py-1">
              <a target="_blank" rel="noopener" href="/api/production/ops/${op.id}/pdf/orden" class="block px-3 py-2 text-body-sm hover:bg-surface-container-low">Orden de Producción (PDF)</a>
              <a target="_blank" rel="noopener" href="/api/production/ops/${op.id}/pdf/ficha" class="block px-3 py-2 text-body-sm hover:bg-surface-container-low">Ficha de producción (PDF)</a>
              <a target="_blank" rel="noopener" href="/api/production/ops/${op.id}/pdf/fabricacion" class="block px-3 py-2 text-body-sm hover:bg-surface-container-low">Documento de fabricación (PDF)</a>
              ${['entregada', 'cerrada'].includes(op.status) ? `<a target="_blank" rel="noopener" href="/api/production/ops/${op.id}/pdf/acta" class="block px-3 py-2 text-body-sm hover:bg-surface-container-low">Acta de entrega y garantía (PDF)</a>` : ''}
            </div>
          </div>
          ${canManage ? secondary.map((s) => `<button data-to="${s}" class="btn ${ACTIONS[s].danger ? 'btn-ghost text-error' : 'btn-secondary'}"><span class="material-symbols-outlined">${ACTIONS[s].icon}</span>${ACTIONS[s].label}</button>`).join('') : ''}
          ${canManage ? primary.map((s) => `<button data-to="${s}" class="btn btn-primary"><span class="material-symbols-outlined">${ACTIONS[s].icon}</span>${ACTIONS[s].label}</button>`).join('') : ''}
        </div>
      </div>
      ${op.status === 'por_validar' && op.missing.length ? `<div class="mb-3 px-4 py-2.5 rounded-lg border border-tertiary/50 bg-tertiary-container/30 text-body-sm text-on-surface"><b>Falta para programar:</b> ${escapeHtml(op.missing.join(', '))}</div>` : ''}
      ${op.blocked ? `<div class="mb-3 px-4 py-2.5 rounded-lg border border-error/50 bg-error-container/30 text-body-sm text-on-surface"><b>🔴 OP bloqueada:</b> ${escapeHtml(op.block_reason_label)} — ve a la pestaña <button data-go="bloqueos" class="underline">Bloqueos</button>.</div>` : ''}
      <div class="flex gap-1 border-b border-outline-variant mb-gutter overflow-x-auto" role="tablist">
        ${TABS.map(([k, label, icon]) => `<button data-tab="${k}" role="tab" aria-selected="${k === tab}" class="px-3 py-2.5 -mb-px border-b-2 text-body-sm whitespace-nowrap inline-flex items-center gap-1.5 ${k === tab ? 'border-primary text-on-surface font-bold' : 'border-transparent text-on-surface-variant hover:text-on-surface'}"><span class="material-symbols-outlined text-[17px]">${icon}</span>${label}${badgeFor(k)}</button>`).join('')}
      </div>`;
  }

  function badgeFor(k) {
    const n =
      k === 'bloqueos' ? op.blocks.filter((b) => b.status === 'activo').length
      : k === 'tareas' ? op.tasks.length
      : k === 'archivos' ? op.files.filter((f) => f.is_current).length
      : k === 'materiales' ? op.requirements.length
      : 0;
    if (!n) return '';
    return `<span class="ml-0.5 text-[10px] px-1.5 rounded-full ${k === 'bloqueos' ? 'bg-error text-on-error' : 'bg-surface-container-high text-on-surface-variant'}">${n}</span>`;
  }

  // ---- pestañas ---------------------------------------------------------------------
  function tabResumen() {
    const w = (name) => escapeHtml(name || '—');
    const pr = PRIORITY[op.priority];
    const assigned = new Set(op.workers.map((x) => x.id));
    const info = [
      ['Número OP', op.number],
      ['Pedido relacionado', op.sales_order_number],
      ['Cliente', op.client_name],
      ['Contacto', op.contact || op.client_name],
      ['Teléfono', op.phone || '—'],
      ['Dirección / destino', [op.address, op.destination].filter(Boolean).join(' · ') || '—'],
      ['Asesor comercial', op.advisor_name || '—'],
      ['Fecha de recepción', fmtDateTime(op.received_at)],
      ['Creada', fmtDateTime(op.created_at)],
      ['Última actualización', fmtDateTime(op.updated_at)],
    ];
    const ed = editable();
    return `
      <div class="grid grid-cols-1 xl:grid-cols-3 gap-gutter">
        <div class="xl:col-span-2 space-y-gutter">
          ${card(`
            ${sectionTitle('Progreso', `<span class="text-body-sm text-on-surface-variant">${op.tasks_done}/${op.tasks_total} tareas · ${op.progress}%</span>`)}
            ${progressBar(op.progress)}
            <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4 text-body-sm">
              <div><p class="${labelCls}">Estado</p>${statusChip(op.status)}</div>
              <div><p class="${labelCls}">Entrega</p><p class="text-on-surface">${fmtDay(op.committed_date || op.requested_date)} ${alertChip(op.alert, false)}</p></div>
              <div><p class="${labelCls}">Prioridad</p><p class="${pr.cls}">${pr.label}</p></div>
              <div><p class="${labelCls}">Bloqueos activos</p><p class="${op.blocked ? 'text-error font-bold' : 'text-on-surface'}">${op.blocks.filter((b) => b.status === 'activo').length}</p></div>
            </div>`)}
          ${card(`
            ${sectionTitle('Planificación y responsables', ed ? '<button id="op-save-main" class="btn btn-primary text-[12px]"><span class="material-symbols-outlined">save</span>Guardar</button>' : '')}
            <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div class="md:col-span-2"><label class="${labelCls}">Producto</label><input id="f-product" ${ed ? '' : 'disabled'} value="${escapeHtml(op.product_name)}" class="${inputCls}" /></div>
              <div><label class="${labelCls}">Código</label><input id="f-code" ${ed ? '' : 'disabled'} value="${escapeHtml(op.product_code || '')}" class="${inputCls}" /></div>
              <div><label class="${labelCls}">Cantidad</label><input id="f-qty" type="number" min="0" step="1" ${ed ? '' : 'disabled'} value="${op.quantity}" class="${inputCls}" /></div>
              <div><label class="${labelCls}">Unidad</label><input id="f-unit" ${ed ? '' : 'disabled'} value="${escapeHtml(op.unit)}" class="${inputCls}" /></div>
              <div><label class="${labelCls}">Prioridad</label><select id="f-prio" ${ed ? '' : 'disabled'} class="${inputCls}">${Object.entries(PRIORITY).map(([k, v]) => `<option value="${k}" ${k === op.priority ? 'selected' : ''}>${v.label}</option>`).join('')}</select></div>
              <div><label class="${labelCls}">Entrega solicitada</label><input id="f-req" type="date" ${ed ? '' : 'disabled'} value="${op.requested_date || ''}" class="${inputCls}" /></div>
              <div><label class="${labelCls}">Entrega comprometida</label><input id="f-com" type="date" ${ed ? '' : 'disabled'} value="${op.committed_date || ''}" class="${inputCls}" /></div>
              <div><label class="${labelCls}">Inicio programado</label><input id="f-start" type="date" ${ed ? '' : 'disabled'} value="${op.start_date || ''}" class="${inputCls}" /></div>
              <div class="md:col-span-2"><label class="${labelCls}">Responsable de producción</label>
                <select id="f-resp" ${ed ? '' : 'disabled'} class="${inputCls}"><option value="">Sin responsable</option>${meta.workers.map((x) => `<option value="${x.id}" ${x.id === op.responsible_worker_id ? 'selected' : ''}>${escapeHtml(x.name)}${x.specialty ? ` · ${escapeHtml(x.specialty)}` : ''}</option>`).join('')}</select>
              </div>
              <label class="flex items-end gap-2 pb-2 text-body-sm text-on-surface-variant"><input id="f-appr" type="checkbox" ${ed ? '' : 'disabled'} ${op.requires_approval ? 'checked' : ''} class="rounded border-outline-variant" />Exige aprobación del asesor</label>
              <div class="md:col-span-3"><label class="${labelCls}">Observaciones</label><textarea id="f-obs" rows="2" ${ed ? '' : 'disabled'} class="${inputCls} resize-none">${escapeHtml(op.observations || '')}</textarea></div>
            </div>
            <div class="mt-4">
              <p class="${labelCls}">Operarios asignados</p>
              <div class="flex flex-wrap gap-2">
                ${meta.workers.map((x) => `<label class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-outline-variant text-body-sm ${ed ? 'cursor-pointer' : ''}"><input type="checkbox" data-worker="${x.id}" ${assigned.has(x.id) ? 'checked' : ''} ${ed ? '' : 'disabled'} class="rounded border-outline-variant" />${escapeHtml(x.name)}</label>`).join('') || '<span class="text-body-sm text-on-surface-variant">No hay operarios. Agrégalos en Configuración › Operarios.</span>'}
              </div>
            </div>`)}
        </div>
        <div class="space-y-gutter">
          ${card(`${sectionTitle('Datos del pedido')}
            <dl class="space-y-2 text-body-sm">${info.map(([k, v]) => `<div class="flex justify-between gap-3"><dt class="text-on-surface-variant shrink-0">${k}</dt><dd class="text-on-surface text-right">${w(v)}</dd></div>`).join('')}</dl>`)}
          ${card(`${sectionTitle('Alertas')}
            <ul class="space-y-1.5 text-body-sm">
              ${[
                op.alert && op.alert !== 'en_tiempo' ? alertChip(op.alert) + ` <span class="text-on-surface-variant">— entrega ${fmtDay(op.committed_date || op.requested_date)}</span>` : '',
                op.blocked ? `🔴 Bloqueada: ${escapeHtml(op.block_reason_label)}` : '',
                !op.responsible_worker_id ? 'Sin responsable asignado' : '',
                !op.designs ? 'Sin diseño cargado' : '',
                op.requires_approval && !op.approvals.length ? 'Falta la aprobación del asesor' : '',
                op.materials_pending ? `${op.materials_pending} material(es) pendiente(s)` : '',
              ].filter(Boolean).map((a) => `<li>${a}</li>`).join('') || '<li class="text-on-surface-variant">Sin alertas.</li>'}
            </ul>`)}
        </div>
      </div>`;
  }

  function specEditor(section, title, hint) {
    const items = op.specs.filter((s) => s.section === section);
    const ed = editable();
    return card(`
      ${sectionTitle(title, ed ? `<button data-save-specs="${section}" class="btn btn-primary text-[12px]"><span class="material-symbols-outlined">save</span>Guardar</button>` : '')}
      <p class="text-[12px] text-on-surface-variant -mt-2 mb-3">${hint}</p>
      <div data-specs="${section}" class="space-y-2">
        ${(items.length ? items : ed ? [{ label: '', value: '' }] : []).map((s) => specRow(s, ed)).join('') || '<p class="text-body-sm text-on-surface-variant">Sin registrar.</p>'}
      </div>
      ${ed ? `<button data-add-spec="${section}" class="btn btn-ghost text-[12px] mt-2"><span class="material-symbols-outlined">add</span>Agregar campo</button>` : ''}`);
  }
  function specRow(s, ed) {
    return `<div data-spec class="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)_32px] gap-2 items-start">
      <input data-l ${ed ? '' : 'disabled'} value="${escapeHtml(s.label || '')}" placeholder="Campo (ej. Medidas)" class="${inputCls}" />
      <textarea data-v rows="1" ${ed ? '' : 'disabled'} placeholder="Valor" class="${inputCls} resize-y">${escapeHtml(s.value || '')}</textarea>
      ${ed ? '<button data-del-spec class="p-2 text-on-surface-variant hover:text-error" aria-label="Quitar"><span class="material-symbols-outlined text-[18px]">close</span></button>' : '<span></span>'}
    </div>`;
  }

  function tabProducto() {
    return specEditor('producto', 'Producto', 'Medidas, color, acabado, características y observaciones del producto. Si la OP viene de una cotización, ya trae los datos del servicio.');
  }
  function tabSpecs() {
    return specEditor('tecnica', 'Especificaciones técnicas', 'Medidas, materiales, detalles técnicos e instrucciones especiales de fabricación. Agrega los campos que necesites.');
  }

  function tabArchivos() {
    const groups = {};
    for (const f of op.files) (groups[f.group_name] = groups[f.group_name] || []).push(f);
    const ed = editable();
    const isImg = (f) => /^image\//.test(f.mime || '');
    return `
      <div class="grid grid-cols-1 xl:grid-cols-3 gap-gutter">
        <div class="xl:col-span-2 space-y-gutter">
          ${Object.keys(groups).length ? Object.entries(groups).map(([g, list]) => {
            const cur = list.find((f) => f.is_current) || list[0];
            return card(`
              ${sectionTitle(`${escapeHtml(g)} <span class="font-normal text-on-surface-variant">· ${FILE_KIND[cur.kind]}</span>`)}
              <div class="flex gap-4 flex-wrap">
                ${isImg(cur) ? `<a href="/api/production/files/${cur.id}" target="_blank" rel="noopener" class="block w-48 h-32 rounded-lg overflow-hidden border border-outline-variant bg-surface-container-low shrink-0"><img src="/api/production/files/${cur.id}" alt="" class="w-full h-full object-cover" /></a>` : ''}
                <ul class="flex-1 min-w-[220px] divide-y divide-outline-variant border border-outline-variant rounded-lg">
                  ${list.map((f) => `
                    <li class="px-3 py-2 flex items-center justify-between gap-2 text-body-sm">
                      <div class="min-w-0">
                        <p class="text-on-surface truncate"><b>v${f.version}</b> ${f.is_current ? '<span class="ml-1 text-[10px] px-1.5 py-0.5 rounded bg-secondary-container text-on-secondary-container font-bold">VIGENTE</span>' : ''} · ${escapeHtml(f.original_name)}</p>
                        <p class="text-[11px] text-on-surface-variant">${fmtDateTime(f.uploaded_at)} · ${escapeHtml(f.uploaded_by_name || 'Sistema')}${f.note ? ` · ${escapeHtml(f.note)}` : ''}</p>
                      </div>
                      <div class="shrink-0 flex gap-1">
                        <a href="/api/production/files/${f.id}" target="_blank" rel="noopener" class="p-1 text-on-surface-variant hover:text-on-surface" title="Abrir"><span class="material-symbols-outlined text-[18px]">open_in_new</span></a>
                        ${ed && !f.is_current ? `<button data-current="${f.id}" class="px-2 py-0.5 border border-outline-variant rounded text-[11px] text-on-surface hover:bg-surface-container-low">Marcar vigente</button>` : ''}
                      </div>
                    </li>`).join('')}
                </ul>
              </div>`);
          }).join('') : card('<p class="text-body-sm text-on-surface-variant">Aún no hay diseños ni archivos.</p>')}
        </div>
        <div>
          ${ed ? card(`
            ${sectionTitle('Cargar archivo')}
            <div class="space-y-3">
              <div><label class="${labelCls}">Archivo (máx. 20 MB)</label><input id="up-file" type="file" class="block w-full text-body-sm" /></div>
              <div><label class="${labelCls}">Tipo</label><select id="up-kind" class="${inputCls}">${Object.entries(FILE_KIND).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
              <div><label class="${labelCls}">Grupo (para versiones)</label>
                <input id="up-group" list="up-groups" placeholder="Ej. Diseño principal" class="${inputCls}" />
                <datalist id="up-groups">${Object.keys(groups).map((g) => `<option value="${escapeHtml(g)}"></option>`).join('')}</datalist>
                <p class="text-[11px] text-on-surface-variant mt-1">Si el grupo ya existe, se guarda como versión nueva y la anterior queda en el historial.</p>
              </div>
              <div><label class="${labelCls}">Observación</label><input id="up-note" class="${inputCls}" /></div>
              <button id="up-send" class="btn btn-primary w-full justify-center"><span class="material-symbols-outlined">upload</span>Cargar</button>
            </div>`) : ''}
        </div>
      </div>`;
  }

  function tabMateriales() {
    const ed = editable();
    return `
      <div class="px-4 py-2.5 mb-gutter rounded-lg border border-outline-variant bg-surface-container-low text-[12px] text-on-surface-variant">Esto <b>no es inventario</b>: registra lo que necesita la OP. "Solicitar" crea una Solicitud de Material (SM) para el área de inventario; no descuenta existencias.</div>
      ${card(`
        ${sectionTitle('Materiales requeridos')}
        <div class="overflow-x-auto">
          <table class="w-full text-left text-body-sm min-w-[640px]">
            <thead><tr class="border-b border-outline-variant text-[10px] uppercase tracking-wider text-on-surface-variant"><th class="py-2">Material</th><th>Código</th><th class="text-right">Cantidad</th><th class="pl-4">Estado</th><th>Observaciones</th><th></th></tr></thead>
            <tbody class="divide-y divide-outline-variant">
              ${op.requirements.map((r) => `
                <tr>
                  <td class="py-2 font-bold text-on-surface">${escapeHtml(r.material)}</td>
                  <td class="text-on-surface-variant">${escapeHtml(r.code || '')}</td>
                  <td class="text-right">${fmtQty(r.qty)} ${escapeHtml(r.unit)}</td>
                  <td class="pl-4">${ed ? `<select data-req-status="${r.id}" class="p-1 border border-outline-variant rounded bg-surface-container-lowest text-[12px]">${Object.entries(REQ_STATUS).map(([k, v]) => `<option value="${k}" ${k === r.status ? 'selected' : ''}>${v}</option>`).join('')}</select>` : REQ_STATUS[r.status]}</td>
                  <td class="text-[12px] text-on-surface-variant">${escapeHtml(r.notes || '')}</td>
                  <td class="text-right whitespace-nowrap">
                    ${ed && r.status !== 'solicitado' && r.status !== 'disponible' ? `<button data-request="${r.id}" class="px-2 py-1 border border-outline-variant rounded text-[11px] font-bold text-on-surface hover:bg-surface-container-low">Solicitar</button>` : ''}
                    ${ed ? `<button data-req-del="${r.id}" class="p-1 text-on-surface-variant hover:text-error" title="Anular"><span class="material-symbols-outlined text-[16px]">close</span></button>` : ''}
                  </td>
                </tr>`).join('') || '<tr><td colspan="6" class="py-4 text-on-surface-variant">Sin materiales registrados.</td></tr>'}
            </tbody>
          </table>
        </div>
        ${ed ? `
          <div class="grid grid-cols-2 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_100px_90px_minmax(0,2fr)_auto] gap-2 mt-3 items-end">
            <input id="rq-mat" placeholder="Material *" class="${inputCls}" />
            <input id="rq-code" placeholder="Código" class="${inputCls}" />
            <input id="rq-qty" type="number" min="0" step="0.1" placeholder="Cant. *" class="${inputCls}" />
            <input id="rq-unit" placeholder="Unidad" value="m" class="${inputCls}" />
            <input id="rq-notes" placeholder="Observaciones" class="${inputCls}" />
            <button id="rq-add" class="btn btn-secondary"><span class="material-symbols-outlined">add</span>Agregar</button>
          </div>` : ''}`)}
      <div class="mt-gutter">${card(`
        ${sectionTitle('Solicitudes de material de esta OP', '<a href="#/solicitudes-material" class="text-[12px] underline text-on-surface-variant">Ver todas</a>')}
        <ul class="divide-y divide-outline-variant text-body-sm">
          ${op.requests.map((r) => `<li class="py-2 flex justify-between gap-3"><span><b>${escapeHtml(r.number)}</b> · ${escapeHtml(r.material)} · ${fmtQty(r.qty)} ${escapeHtml(r.unit)}</span><span class="text-on-surface-variant">${r.status === 'pendiente' ? 'Pendiente' : r.status === 'atendida' ? 'Atendida' : 'Cancelada'} · ${fmtDateTime(r.created_at)}</span></li>`).join('') || '<li class="py-2 text-on-surface-variant">Ninguna.</li>'}
        </ul>`)}</div>`;
  }

  function tabTareas() {
    const ed = editable();
    return card(`
      ${sectionTitle(`Tareas <span class="font-normal text-on-surface-variant">· ${op.progress}% completado</span>`, ed && !op.tasks.length ? '<button id="tk-template" class="btn btn-secondary text-[12px]"><span class="material-symbols-outlined">playlist_add</span>Agregar tareas estándar</button>' : '')}
      ${progressBar(op.progress)}
      <div class="mt-3 divide-y divide-outline-variant border border-outline-variant rounded-lg">
        ${op.tasks.map((t) => `
          <div class="px-3 py-2.5 grid grid-cols-1 md:grid-cols-[28px_minmax(0,2fr)_minmax(0,1.3fr)_130px_130px_32px] gap-2 items-center text-body-sm">
            <span class="material-symbols-outlined ${t.status === 'completada' ? 'text-secondary' : t.status === 'bloqueada' ? 'text-error' : 'text-on-surface-variant'}">${t.status === 'completada' ? 'check_box' : t.status === 'en_proceso' ? 'indeterminate_check_box' : t.status === 'bloqueada' ? 'block' : 'check_box_outline_blank'}</span>
            <div class="min-w-0"><p class="font-bold text-on-surface ${t.status === 'completada' ? 'line-through opacity-70' : ''}">${escapeHtml(t.name)}</p>
              <p class="text-[11px] text-on-surface-variant">${t.started_at ? `Inició ${fmtDateTime(t.started_at)}` : 'Sin iniciar'}${t.finished_at ? ` · Terminó ${fmtDateTime(t.finished_at)}` : ''}${t.notes ? ` · ${escapeHtml(t.notes)}` : ''}</p></div>
            ${ed ? `<select data-task-worker="${t.id}" class="p-1.5 border border-outline-variant rounded bg-surface-container-lowest"><option value="">Sin operario</option>${meta.workers.map((x) => `<option value="${x.id}" ${x.id === t.worker_id ? 'selected' : ''}>${escapeHtml(x.name)}</option>`).join('')}</select>` : `<span>${escapeHtml(t.worker_name || '—')}</span>`}
            ${ed ? `<input data-task-date="${t.id}" type="date" value="${t.planned_date || ''}" class="p-1.5 border border-outline-variant rounded bg-surface-container-lowest" />` : `<span>${fmtDate(t.planned_date)}</span>`}
            ${ed ? `<select data-task-status="${t.id}" class="p-1.5 border border-outline-variant rounded bg-surface-container-lowest">${Object.entries(TASK_STATUS).map(([k, v]) => `<option value="${k}" ${k === t.status ? 'selected' : ''}>${v}</option>`).join('')}</select>` : `<span>${TASK_STATUS[t.status]}</span>`}
            ${ed ? `<button data-task-del="${t.id}" class="p-1 text-on-surface-variant hover:text-error" title="Anular tarea"><span class="material-symbols-outlined text-[16px]">close</span></button>` : '<span></span>'}
          </div>`).join('') || '<p class="px-3 py-4 text-body-sm text-on-surface-variant">Sin tareas. El progreso de la OP se calcula con las tareas completadas.</p>'}
      </div>
      ${ed ? `
        <div class="grid grid-cols-1 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_150px_auto] gap-2 mt-3">
          <input id="tk-name" placeholder="Nueva tarea (ej. Tapizar sillín)" class="${inputCls}" />
          <select id="tk-worker" class="${inputCls}"><option value="">Operario</option>${meta.workers.map((x) => `<option value="${x.id}">${escapeHtml(x.name)}</option>`).join('')}</select>
          <input id="tk-date" type="date" class="${inputCls}" />
          <button id="tk-add" class="btn btn-secondary"><span class="material-symbols-outlined">add</span>Agregar</button>
        </div>` : ''}`);
  }

  function tabControl() {
    const inControl = op.status === 'control';
    const canApprove = canManage || ctx.user?.role === 'asesor';
    return `
      <div class="grid grid-cols-1 xl:grid-cols-2 gap-gutter">
        <div class="space-y-gutter">
          ${canManage && inControl ? card(`
            ${sectionTitle('Registrar control / revisión')}
            <div class="grid grid-cols-2 gap-2 mb-3">${CHECKS.map(([k, l]) => `<label class="flex items-center gap-2 text-body-sm"><input type="checkbox" data-check="${k}" class="rounded border-outline-variant" />${l}</label>`).join('')}</div>
            <label class="${labelCls}">Observaciones</label>
            <textarea id="rv-notes" rows="2" class="${inputCls} resize-none mb-3" placeholder="Obligatorio si requiere corrección"></textarea>
            <div class="flex gap-2 flex-wrap">
              <button data-review="aprobado" class="btn btn-primary"><span class="material-symbols-outlined">check</span>Aprobado</button>
              <button data-review="correccion" class="btn btn-secondary"><span class="material-symbols-outlined">build</span>Requiere corrección</button>
            </div>`) : card(`<p class="text-body-sm text-on-surface-variant">${inControl ? 'La revisión la registra producción.' : 'El control / revisión se registra cuando la OP está en "Control / revisión".'}</p>`)}
          ${card(`
            ${sectionTitle('Revisiones')}
            <ul class="space-y-2">${op.reviews.map((r) => `
              <li class="border border-outline-variant rounded-lg px-3 py-2 text-body-sm">
                <p class="font-bold ${r.result === 'aprobado' ? 'text-secondary' : 'text-error'}">${r.result === 'aprobado' ? 'Aprobado' : 'Requiere corrección'}</p>
                <p class="text-[11px] text-on-surface-variant">${fmtDateTime(r.created_at)} · ${escapeHtml(r.reviewed_by_name || 'Sistema')}</p>
                <p class="text-[12px] text-on-surface-variant mt-1">${CHECKS.map(([k, l]) => `${r.checklist[k] ? '✓' : '✗'} ${l}`).join(' · ')}</p>
                ${r.notes ? `<p class="text-[12px] mt-1">${escapeHtml(r.notes)}</p>` : ''}
              </li>`).join('') || '<li class="text-body-sm text-on-surface-variant">Sin revisiones.</li>'}</ul>`)}
        </div>
        <div class="space-y-gutter">
          ${card(`
            ${sectionTitle('Aprobación del asesor comercial', op.requires_approval ? '<span class="text-[11px] text-on-surface-variant">Obligatoria para "Lista para entregar"</span>' : '<span class="text-[11px] text-on-surface-variant">No obligatoria en esta OP</span>')}
            <ul class="space-y-2 mb-3">${op.approvals.map((a) => `
              <li class="border border-outline-variant rounded-lg px-3 py-2 text-body-sm flex gap-3 items-center">
                ${a.signature_path ? `<img src="/api/production/approvals/${a.id}/signature" alt="Firma" class="h-12 w-28 object-contain bg-white rounded border border-outline-variant" />` : ''}
                <div><p class="font-bold text-on-surface">${escapeHtml(a.signed_name)}</p>
                <p class="text-[11px] text-on-surface-variant">${fmtDateTime(a.created_at)} · ✓ características · ✓ cantidades · ✓ diseño</p>
                ${a.notes ? `<p class="text-[12px]">${escapeHtml(a.notes)}</p>` : ''}</div>
              </li>`).join('') || '<li class="text-body-sm text-on-surface-variant">Sin aprobación registrada.</li>'}</ul>
            ${canApprove && !['cerrada', 'cancelada'].includes(op.status) ? '<button id="ap-new" class="btn btn-secondary"><span class="material-symbols-outlined">draw</span>Registrar aprobación y firma</button>' : ''}`)}
        </div>
      </div>`;
  }

  function tabBloqueos() {
    const ed = editable();
    const active = op.blocks.filter((b) => b.status === 'activo');
    const past = op.blocks.filter((b) => b.status !== 'activo');
    const item = (b) => `
      <li class="border ${b.status === 'activo' ? 'border-error/50' : 'border-outline-variant'} rounded-lg px-3 py-2.5 text-body-sm">
        <div class="flex justify-between gap-3">
          <div>
            <p class="font-bold ${b.status === 'activo' ? 'text-error' : 'text-on-surface'}">${b.status === 'activo' ? '🔴 ' : ''}${escapeHtml(b.reason_label)}</p>
            <p class="text-[11px] text-on-surface-variant">Desde ${fmtDateTime(b.created_at)} · Responsable: ${escapeHtml(b.responsible || '—')} · Registró ${escapeHtml(b.created_by_name || 'Sistema')}</p>
            ${b.notes ? `<p class="text-[12px] mt-1">${escapeHtml(b.notes)}</p>` : ''}
            ${b.status === 'resuelto' ? `<p class="text-[12px] mt-1 text-secondary">Resuelto ${fmtDateTime(b.resolved_at)}${b.resolution ? ` · ${escapeHtml(b.resolution)}` : ''}</p>` : ''}
          </div>
          ${ed && b.status === 'activo' ? `<button data-resolve="${b.id}" class="shrink-0 btn btn-secondary text-[12px]">Resolver</button>` : ''}
        </div>
      </li>`;
    return `
      <div class="grid grid-cols-1 xl:grid-cols-3 gap-gutter">
        <div class="xl:col-span-2 space-y-gutter">
          ${card(`${sectionTitle('Bloqueos activos')}<ul class="space-y-2">${active.map(item).join('') || '<li class="text-body-sm text-on-surface-variant">Ninguno. 🟢</li>'}</ul>`)}
          ${card(`${sectionTitle('Historial de bloqueos')}<ul class="space-y-2">${past.map(item).join('') || '<li class="text-body-sm text-on-surface-variant">Sin bloqueos anteriores.</li>'}</ul>`)}
        </div>
        ${ed ? card(`
          ${sectionTitle('Registrar bloqueo')}
          <p class="text-[12px] text-on-surface-variant -mt-2 mb-3">Si la OP está programada, en producción o en control, queda <b>pausada</b> hasta resolver el bloqueo.</p>
          <div class="space-y-3">
            <div><label class="${labelCls}">Motivo</label><select id="bk-reason" class="${inputCls}">${meta.block_reasons.map((r) => `<option value="${r.key}">${r.label}</option>`).join('')}</select></div>
            <div><label class="${labelCls}">Responsable</label><input id="bk-resp" placeholder="Persona o área (ej. Compras)" class="${inputCls}" /></div>
            <div><label class="${labelCls}">Observación</label><textarea id="bk-notes" rows="2" class="${inputCls} resize-none"></textarea></div>
            <button id="bk-add" class="btn btn-primary w-full justify-center"><span class="material-symbols-outlined">block</span>Registrar bloqueo</button>
          </div>`) : ''}
      </div>`;
  }

  function tabEntrega() {
    const lista = op.deliveries.filter((d) => d.kind === 'lista');
    const entregada = op.deliveries.filter((d) => d.kind === 'entregada');
    const delivered = ['entregada', 'cerrada'].includes(op.status);
    const row = (d) => `<li class="border border-outline-variant rounded-lg px-3 py-2 text-body-sm">
        <p class="font-bold text-on-surface">${d.kind === 'lista' ? 'Lista para entregar' : 'Entregada'} · ${fmtDate(d.date)}</p>
        <p class="text-[11px] text-on-surface-variant">Responsable: ${escapeHtml(d.responsible || '—')}${d.authorized_by ? ` · Autorizó: ${escapeHtml(d.authorized_by)}` : ''}${d.received_by ? ` · Recibió: ${escapeHtml(d.received_by)}` : ''}${d.review_done ? ' · Revisión realizada' : ''}</p>
        ${d.notes ? `<p class="text-[12px] mt-1">${escapeHtml(d.notes)}</p>` : ''}
      </li>`;
    return `
      <div class="grid grid-cols-1 xl:grid-cols-2 gap-gutter">
        <div class="space-y-gutter">
          ${card(`${sectionTitle('Registros de entrega')}<ul class="space-y-2">${[...lista, ...entregada].map(row).join('') || '<li class="text-body-sm text-on-surface-variant">Todavía no está lista ni entregada. Se registra con los botones de arriba.</li>'}</ul>
            ${op.closed_at ? `<p class="text-body-sm mt-3">🔒 OP cerrada ${fmtDateTime(op.closed_at)}</p>` : ''}`)}
          ${delivered ? card(`${sectionTitle('Garantía', `<a target="_blank" rel="noopener" href="/api/production/ops/${op.id}/pdf/acta" class="btn btn-secondary text-[12px] inline-flex"><span class="material-symbols-outlined">picture_as_pdf</span>Acta de entrega</a>`)}
            <p class="text-body-sm">Garantía de <b>${op.warranty_months} meses</b>, hasta el <b>${fmtDate(op.warranty_until)}</b>.</p>`) : ''}
        </div>
        ${delivered ? card(`
          ${sectionTitle('Reclamos de garantía', '<a href="#/garantias" class="text-[12px] underline text-on-surface-variant">Gestionar</a>')}
          <ul class="space-y-2 mb-3">${op.claims.map((c) => `<li class="border border-outline-variant rounded-lg px-3 py-2 text-body-sm"><p>${escapeHtml(c.description)}</p><p class="text-[11px] text-on-surface-variant">${fmtDateTime(c.reported_at)} · ${CLAIM_LABEL[c.status]}${c.resolution ? ` · ${escapeHtml(c.resolution)}` : ''}</p></li>`).join('') || '<li class="text-body-sm text-on-surface-variant">Sin reclamos.</li>'}</ul>
          <div class="flex gap-2"><input id="cl-desc" placeholder="¿Qué problema reporta el cliente?" class="${inputCls}" /><button id="cl-add" class="btn btn-secondary shrink-0">Registrar</button></div>`) : ''}
      </div>`;
  }

  function tabHistorial() {
    return card(`
      ${sectionTitle('Historial / auditoría', '<span class="text-[11px] text-on-surface-variant">Incluye los eventos del pedido</span>')}
      <ol class="relative border-l border-outline-variant ml-2 space-y-3">
        ${op.activity.map((a) => `
          <li class="ml-4">
            <span class="absolute -left-[5px] mt-1.5 w-2.5 h-2.5 rounded-full ${a.entity === 'pedido' ? 'bg-outline' : 'bg-primary'}"></span>
            <p class="text-[11px] text-on-surface-variant">${fmtDateTime(a.created_at)} · ${escapeHtml(a.user_name)}${a.entity === 'pedido' ? ' · Pedido' : ''}</p>
            <p class="text-body-sm text-on-surface font-bold">${escapeHtml(a.action)}</p>
            ${a.detail ? `<p class="text-[12px] text-on-surface-variant">${escapeHtml(a.detail)}</p>` : ''}
          </li>`).join('')}
      </ol>`);
  }

  const RENDER = { resumen: tabResumen, producto: tabProducto, specs: tabSpecs, archivos: tabArchivos, materiales: tabMateriales, tareas: tabTareas, control: tabControl, bloqueos: tabBloqueos, entrega: tabEntrega, historial: tabHistorial };

  // ---- pintar y conectar -------------------------------------------------------------
  function render() {
    container.innerHTML = headerHtml() + `<div id="op-tab">${RENDER[tab]()}</div>`;
    wire();
  }

  function wire() {
    const $ = (s) => container.querySelector(s);
    const $$ = (s) => container.querySelectorAll(s);
    const P = `/api/production`;

    $$('[data-tab]').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tab; render(); }));
    $$('[data-go]').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.go; render(); }));
    $$('[data-to]').forEach((b) => b.addEventListener('click', () => doTransition(b.dataset.to)));
    $('#op-docs')?.addEventListener('click', (e) => {
      e.stopPropagation();
      $('#op-docs-menu').classList.toggle('hidden');
    });

    // Resumen: datos + operarios
    $('#op-save-main')?.addEventListener('click', async () => {
      const ok = await act(ctx.api.patch(`${P}/ops/${id}`, {
        product_name: $('#f-product').value, product_code: $('#f-code').value, quantity: Number($('#f-qty').value), unit: $('#f-unit').value,
        priority: $('#f-prio').value, requested_date: $('#f-req').value, committed_date: $('#f-com').value, start_date: $('#f-start').value,
        responsible_worker_id: $('#f-resp').value || null, requires_approval: $('#f-appr').checked, observations: $('#f-obs').value,
      }));
      if (!ok) return;
      const ids = [...$$('[data-worker]')].filter((c) => c.checked).map((c) => Number(c.dataset.worker));
      const before = op.workers.map((w) => w.id).sort().join();
      if (ids.sort().join() !== before && !(await act(ctx.api.put(`${P}/ops/${id}/workers`, { worker_ids: ids })))) return;
      await refresh('OP actualizada');
    });

    // Producto / especificaciones
    $$('[data-add-spec]').forEach((b) => b.addEventListener('click', () => {
      container.querySelector(`[data-specs="${b.dataset.addSpec}"]`).insertAdjacentHTML('beforeend', specRow({}, true));
      wireSpecDel();
    }));
    function wireSpecDel() {
      $$('[data-del-spec]').forEach((b) => (b.onclick = () => b.closest('[data-spec]').remove()));
    }
    wireSpecDel();
    $$('[data-save-specs]').forEach((b) => b.addEventListener('click', async () => {
      const section = b.dataset.saveSpecs;
      const items = [...container.querySelectorAll(`[data-specs="${section}"] [data-spec]`)].map((r) => ({ label: r.querySelector('[data-l]').value, value: r.querySelector('[data-v]').value }));
      if (await act(ctx.api.put(`${P}/ops/${id}/specs`, { section, items }))) await refresh('Guardado');
    }));

    // Archivos
    $('#up-send')?.addEventListener('click', async () => {
      const file = $('#up-file').files[0];
      if (!file) return ctx.toast('Elige un archivo', 'error');
      const fd = new FormData();
      fd.append('file', file);
      fd.append('kind', $('#up-kind').value);
      fd.append('group_name', $('#up-group').value);
      fd.append('note', $('#up-note').value);
      const btn = $('#up-send');
      btn.disabled = true;
      try {
        const res = await fetch(`${P}/ops/${id}/files`, { method: 'POST', body: fd });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
        await refresh('Archivo cargado');
      } catch (err) {
        ctx.toast(err.message, 'error');
        btn.disabled = false;
      }
    });
    $$('[data-current]').forEach((b) => b.addEventListener('click', async () => {
      if (await act(ctx.api.post(`${P}/files/${b.dataset.current}/current`))) await refresh('Versión vigente actualizada');
    }));

    // Materiales
    $('#rq-add')?.addEventListener('click', async () => {
      if (await act(ctx.api.post(`${P}/ops/${id}/requirements`, { material: $('#rq-mat').value, code: $('#rq-code').value, qty: Number($('#rq-qty').value), unit: $('#rq-unit').value, notes: $('#rq-notes').value }))) await refresh();
    });
    $$('[data-req-status]').forEach((s) => s.addEventListener('change', async () => {
      if (await act(ctx.api.patch(`${P}/requirements/${s.dataset.reqStatus}`, { status: s.value }))) await refresh('Estado actualizado');
    }));
    $$('[data-request]').forEach((b) => b.addEventListener('click', async () => {
      if (await act(ctx.api.post(`${P}/requirements/${b.dataset.request}/request`, {}))) await refresh('Solicitud de material creada');
    }));
    $$('[data-req-del]').forEach((b) => b.addEventListener('click', async () => {
      if (!(await confirmModal({ title: 'Anular material', message: 'Queda anulado (no se borra del historial).', confirmLabel: 'Anular', danger: true }))) return;
      if (await act(ctx.api.patch(`${P}/requirements/${b.dataset.reqDel}`, { status: 'anulado' }))) await refresh();
    }));

    // Tareas
    $('#tk-template')?.addEventListener('click', async () => {
      if (await act(ctx.api.post(`${P}/ops/${id}/tasks`, { template: true }))) await refresh('Tareas estándar agregadas');
    });
    $('#tk-add')?.addEventListener('click', async () => {
      if (!$('#tk-name').value.trim()) return ctx.toast('Escribe el nombre de la tarea', 'error');
      if (await act(ctx.api.post(`${P}/ops/${id}/tasks`, { name: $('#tk-name').value, worker_id: $('#tk-worker').value || null, planned_date: $('#tk-date').value }))) await refresh();
    });
    const patchTask = async (tid, body, msg) => {
      if (await act(ctx.api.patch(`${P}/tasks/${tid}`, body))) await refresh(msg);
    };
    $$('[data-task-status]').forEach((s) => s.addEventListener('change', () => patchTask(s.dataset.taskStatus, { status: s.value }, 'Tarea actualizada')));
    $$('[data-task-worker]').forEach((s) => s.addEventListener('change', () => patchTask(s.dataset.taskWorker, { worker_id: s.value || null })));
    $$('[data-task-date]').forEach((s) => s.addEventListener('change', () => patchTask(s.dataset.taskDate, { planned_date: s.value })));
    $$('[data-task-del]').forEach((b) => b.addEventListener('click', async () => {
      if (!(await confirmModal({ title: 'Anular tarea', message: 'La tarea queda anulada y deja de contar en el progreso.', confirmLabel: 'Anular', danger: true }))) return;
      patchTask(b.dataset.taskDel, { status: 'anulada' });
    }));

    // Control / revisión
    $$('[data-review]').forEach((b) => b.addEventListener('click', async () => {
      const checklist = Object.fromEntries([...$$('[data-check]')].map((c) => [c.dataset.check, c.checked]));
      if (await act(ctx.api.post(`${P}/ops/${id}/reviews`, { result: b.dataset.review, checklist, notes: $('#rv-notes').value }))) await refresh(b.dataset.review === 'aprobado' ? 'Revisión aprobada' : 'Devuelta a producción para corrección');
    }));
    $('#ap-new')?.addEventListener('click', openApproval);

    // Bloqueos
    $('#bk-add')?.addEventListener('click', async () => {
      if (await act(ctx.api.post(`${P}/ops/${id}/blocks`, { reason: $('#bk-reason').value, responsible: $('#bk-resp').value, notes: $('#bk-notes').value }))) await refresh('Bloqueo registrado');
    });
    $$('[data-resolve]').forEach((b) => b.addEventListener('click', async () => {
      const resolution = await askReason('Resolver bloqueo', '¿Cómo se resolvió?');
      if (!resolution) return;
      if (await act(ctx.api.post(`${P}/blocks/${b.dataset.resolve}/resolve`, { resolution }))) await refresh('Bloqueo resuelto');
    }));

    // Garantía
    $('#cl-add')?.addEventListener('click', async () => {
      if (await act(ctx.api.post(`${P}/ops/${id}/claims`, { description: $('#cl-desc').value }))) await refresh('Reclamo registrado');
    });
  }

  // Aprobación con firma dibujada en un lienzo.
  function openApproval() {
    openModal({
      title: 'Aprobación del asesor comercial',
      render: (body, { close }) => {
        body.innerHTML = `
          <div class="space-y-3">
            <div><label class="${labelCls}">Nombre de quien aprueba *</label><input id="apv-name" value="${escapeHtml(ctx.user?.username || '')}" class="${inputCls}" /></div>
            <div class="space-y-1.5 text-body-sm">
              <label class="flex items-center gap-2"><input id="apv-f" type="checkbox" class="rounded border-outline-variant" />Confirmo las características</label>
              <label class="flex items-center gap-2"><input id="apv-q" type="checkbox" class="rounded border-outline-variant" />Confirmo las cantidades</label>
              <label class="flex items-center gap-2"><input id="apv-d" type="checkbox" class="rounded border-outline-variant" />Confirmo el diseño</label>
            </div>
            <div>
              <div class="flex justify-between items-end"><label class="${labelCls}">Firma *</label><button id="apv-clear" class="text-[11px] underline text-on-surface-variant">Borrar</button></div>
              <canvas id="apv-sig" width="400" height="140" class="w-full h-[140px] bg-white border border-outline-variant rounded-md touch-none cursor-crosshair"></canvas>
            </div>
            <div><label class="${labelCls}">Observación</label><input id="apv-notes" class="${inputCls}" /></div>
          </div>
          <div class="flex justify-end gap-2 mt-4"><button id="apv-cancel" class="btn btn-ghost">Cancelar</button><button id="apv-ok" class="btn btn-primary">Registrar aprobación</button></div>`;
        const cv = body.querySelector('#apv-sig');
        const g = cv.getContext('2d');
        g.lineWidth = 2.2;
        g.lineCap = 'round';
        g.strokeStyle = '#1B1B1B';
        let drawing = false;
        let dirty = false;
        const pos = (e) => {
          const r = cv.getBoundingClientRect();
          return [((e.clientX - r.left) * cv.width) / r.width, ((e.clientY - r.top) * cv.height) / r.height];
        };
        cv.addEventListener('pointerdown', (e) => {
          drawing = true;
          dirty = true;
          cv.setPointerCapture(e.pointerId);
          g.beginPath();
          g.moveTo(...pos(e));
        });
        cv.addEventListener('pointermove', (e) => {
          if (!drawing) return;
          g.lineTo(...pos(e));
          g.stroke();
        });
        cv.addEventListener('pointerup', () => (drawing = false));
        body.querySelector('#apv-clear').addEventListener('click', () => {
          g.clearRect(0, 0, cv.width, cv.height);
          dirty = false;
        });
        body.querySelector('#apv-cancel').addEventListener('click', close);
        body.querySelector('#apv-ok').addEventListener('click', async () => {
          if (!dirty) return ctx.toast('Falta la firma', 'error');
          try {
            await ctx.api.post(`/api/production/ops/${id}/approvals`, {
              signed_name: body.querySelector('#apv-name').value,
              confirm_features: body.querySelector('#apv-f').checked,
              confirm_quantities: body.querySelector('#apv-q').checked,
              confirm_design: body.querySelector('#apv-d').checked,
              signature: cv.toDataURL('image/png'),
              notes: body.querySelector('#apv-notes').value,
            });
            close();
            await refresh('Aprobación registrada');
          } catch (err) {
            ctx.toast(err.message, 'error');
          }
        });
      },
    });
  }

  const closeMenu = () => container.querySelector('#op-docs-menu')?.classList.add('hidden');
  document.addEventListener('click', closeMenu);
  const off = ctx.ws.on('production_changed', (p) => {
    // Otro usuario cambió esta OP: se relee sin perder la pestaña.
    if (p && p.id === id && !document.querySelector('[role=dialog]')) refresh();
  });
  render();
  return () => {
    off();
    document.removeEventListener('click', closeMenu);
  };
}
