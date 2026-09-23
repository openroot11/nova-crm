import { escapeHtml } from '../utils.js';
import { openModal } from '../components/modal.js';
import { findService } from '../data/velaraServices.js';

// Garantías (ERP): reclamos de clientes sobre trabajos ya entregados. Se
// registran desde la OP (pestaña Entrega) y aquí se les hace seguimiento
// hasta resolverlos. Ver server/routes/production.js (/claims).

const STATUS = {
  abierto: { label: 'Abierto', cls: 'bg-error-container text-on-error-container' },
  en_revision: { label: 'En revisión', cls: 'bg-tertiary-container text-on-tertiary-container' },
  resuelto: { label: 'Resuelto', cls: 'bg-secondary-container text-on-secondary-container' },
  rechazado: { label: 'Rechazado', cls: 'bg-surface-container-high text-on-surface-variant' },
};

function fmtDate(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value || '');
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '—';
}

// ¿El reclamo entró dentro de la garantía? (fecha del reclamo <= entrega + meses)
function withinWarranty(c) {
  if (!c.delivered_at) return null;
  const end = new Date(`${c.delivered_at.replace(' ', 'T')}Z`);
  end.setUTCMonth(end.getUTCMonth() + (Number(c.warranty_months) || 0));
  return new Date(`${c.reported_at.replace(' ', 'T')}Z`) <= end;
}

export async function mount(container, ctx) {
  container.innerHTML = `
    <div class="flex justify-between items-end mb-margin-desktop flex-wrap gap-3">
      <div>
        <h2 class="text-headline-lg font-headline-lg text-on-surface">Garantías</h2>
        <p class="text-body-md font-body-md text-on-surface-variant mt-1">Reclamos de clientes sobre trabajos entregados. Se registran desde la OP, pestaña Entrega.</p>
      </div>
    </div>
    <div class="flex gap-2 flex-wrap mb-gutter" id="gt-filters"></div>
    <div id="gt-list" class="space-y-3"></div>
  `;
  const listEl = container.querySelector('#gt-list');
  const filtersEl = container.querySelector('#gt-filters');
  let claims = [];
  let filter = 'pendientes';

  function paintFilters() {
    const count = (fn) => claims.filter(fn).length;
    const opts = [
      ['pendientes', 'Pendientes', count((c) => c.status === 'abierto' || c.status === 'en_revision')],
      ['cerrados', 'Cerrados', count((c) => c.status === 'resuelto' || c.status === 'rechazado')],
      ['todos', 'Todos', claims.length],
    ];
    filtersEl.innerHTML = opts
      .map(([k, label, n]) => `<button data-f="${k}" class="px-3 py-1.5 rounded-full border text-body-sm ${filter === k ? 'border-outline bg-surface-container-high text-on-surface font-bold' : 'border-outline-variant text-on-surface-variant hover:bg-surface-container-low'}">${label} (${n})</button>`)
      .join('');
    filtersEl.querySelectorAll('[data-f]').forEach((b) =>
      b.addEventListener('click', () => {
        filter = b.dataset.f;
        paintFilters();
        render();
      })
    );
  }

  function render() {
    const list = claims.filter((c) =>
      filter === 'todos' ? true : filter === 'pendientes' ? c.status === 'abierto' || c.status === 'en_revision' : c.status === 'resuelto' || c.status === 'rechazado'
    );
    listEl.innerHTML = list.length
      ? list
          .map((c) => {
            const s = STATUS[c.status];
            const inW = withinWarranty(c);
            return `
          <div class="bg-surface-container-lowest border border-outline-variant rounded-xl p-4 shadow-sm flex items-start justify-between gap-4 flex-wrap">
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2 flex-wrap mb-1">
                <span class="inline-flex px-2 py-0.5 rounded text-[11px] font-bold ${s.cls}">${s.label}</span>
                <a href="#/op?id=${c.op_id}&tab=entrega" class="text-body-sm font-bold text-on-surface underline">${escapeHtml(c.number)}</a>
                <span class="text-body-sm text-on-surface">${escapeHtml(c.client_name)}</span>
                ${inW === false ? '<span class="inline-flex px-2 py-0.5 rounded text-[10px] font-bold bg-surface-container-high text-on-surface-variant">Fuera de garantía</span>' : ''}
              </div>
              <p class="text-body-sm text-on-surface">${escapeHtml(c.description)}</p>
              <p class="text-[11px] text-on-surface-variant mt-1">${escapeHtml(c.product_name || findService(c.service_slug)?.title || 'Trabajo')} · entregado ${fmtDate(c.delivered_at)} · reportado ${fmtDate(c.reported_at)}${c.phone ? ` · ${escapeHtml(c.phone)}` : ''}</p>
              ${c.resolution ? `<p class="text-[12px] text-on-surface-variant mt-1"><b>Solución:</b> ${escapeHtml(c.resolution)}</p>` : ''}
            </div>
            ${ctx.user?.role === 'asesor' ? '' : `<button data-edit="${c.id}" class="shrink-0 px-3 py-1.5 border border-outline-variant rounded text-[12px] font-label-bold text-on-surface hover:bg-surface-container-low">Actualizar</button>`}
          </div>`;
          })
          .join('')
      : `<p class="text-body-sm text-on-surface-variant py-8 text-center">${filter === 'pendientes' ? 'No hay reclamos pendientes.' : 'Sin reclamos.'}</p>`;
    listEl.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => openEdit(claims.find((c) => c.id === Number(b.dataset.edit)))));
  }

  function openEdit(c) {
    openModal({
      title: `Reclamo · ${c.number}`,
      render: (body, { close }) => {
        body.innerHTML = `
          <p class="text-body-sm text-on-surface mb-3">${escapeHtml(c.description)}</p>
          <label class="block text-[10px] font-label-bold uppercase tracking-wider text-on-surface-variant mb-1">Estado</label>
          <select id="cl-status" class="w-full p-2.5 border border-outline-variant rounded-md mb-3 outline-none focus:border-outline bg-surface-container-lowest">
            ${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${k === c.status ? 'selected' : ''}>${v.label}</option>`).join('')}
          </select>
          <label class="block text-[10px] font-label-bold uppercase tracking-wider text-on-surface-variant mb-1">Qué se hizo / por qué se rechazó</label>
          <textarea id="cl-res" rows="3" class="w-full p-2.5 border border-outline-variant rounded-md mb-4 outline-none focus:border-outline bg-surface-container-lowest resize-none">${escapeHtml(c.resolution || '')}</textarea>
          <div class="flex justify-end gap-2"><button id="cl-cancel" class="btn btn-ghost">Cancelar</button><button id="cl-ok" class="btn btn-primary">Guardar</button></div>`;
        body.querySelector('#cl-cancel').addEventListener('click', close);
        body.querySelector('#cl-ok').addEventListener('click', async () => {
          try {
            await ctx.api.patch(`/api/production/claims/${c.id}`, { status: body.querySelector('#cl-status').value, resolution: body.querySelector('#cl-res').value });
            ctx.toast('Reclamo actualizado', 'success');
            close();
            load();
          } catch (err) {
            ctx.toast(err.message, 'error');
          }
        });
      },
    });
  }

  async function load() {
    try {
      claims = await ctx.api.get('/api/production/claims');
      paintFilters();
      render();
    } catch (err) {
      ctx.toast(err.message || 'No se pudieron cargar las garantías', 'error');
    }
  }

  const off = ctx.ws.on('production_changed', load);
  await load();
  return () => off();
}
