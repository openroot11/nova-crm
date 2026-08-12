import { escapeHtml } from '../utils.js';
import { openModal } from './modal.js';

// Venta rapida: para cuando no hay tiempo de pasar por el flujo completo de
// Ventas. Busca un cliente existente (mismo autocompletado que Alta Rapida
// en ventas.js) -- si tiene una cotizacion abierta, se relaciona y se cierra
// esa; si no tiene ninguna, se crea una venta nueva para el. Si se escribe
// un nombre que no coincide con ningun cliente, se crea uno nuevo solo con
// ese nombre (sin pedir telefono). Reutilizable desde Informe Diario y
// Ventas Cerradas -- siempre guarda de verdad (lead cerrado_ganado real).
function findOpenLead(leads) {
  const open = (leads || []).filter((l) => !l.status.startsWith('cerrado'));
  if (!open.length) return null;
  return open.slice().sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0];
}

export function openQuickSaleModal(ctx, onDone) {
  openModal({
    title: 'Registrar venta',
    render: (body, { close }) => {
      body.innerHTML = `
        <form id="qs-form" class="space-y-5">
          <div class="relative">
            <label class="block text-label-bold font-label-bold text-on-surface-variant mb-1 uppercase tracking-wider">Cliente *</label>
            <input id="qs-cliente" required type="text" autocomplete="off" placeholder="Escribe para buscar o crear un cliente nuevo" class="w-full p-2.5 bg-surface-container-lowest border border-outline-variant rounded-md text-body-md focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition-all" />
            <div id="qs-suggestions" class="hidden absolute z-20 mt-1 w-full bg-surface border border-outline-variant rounded-md shadow-lg max-h-56 overflow-y-auto"></div>
            <p id="qs-hint-open" class="hidden text-[11px] text-secondary mt-1 flex items-center gap-1"><span class="material-symbols-outlined text-[13px]">check_circle</span></p>
            <p id="qs-hint-existing" class="hidden text-[11px] text-on-surface-variant mt-1 flex items-center gap-1"><span class="material-symbols-outlined text-[13px]">info</span>Cliente existente sin cotización abierta — se registrará una venta nueva.</p>
            <p id="qs-hint-new" class="hidden text-[11px] text-on-surface-variant mt-1 flex items-center gap-1"><span class="material-symbols-outlined text-[13px]">person_add</span>Cliente nuevo — se creará solo con este nombre.</p>
          </div>
          <div id="qs-asesor-wrap">
            <label class="block text-label-bold font-label-bold text-on-surface-variant mb-1 uppercase tracking-wider">Asesor *</label>
            <select id="qs-asesor" required class="w-full p-2.5 bg-surface-container-lowest border border-outline-variant rounded-md text-body-md focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition-all appearance-none cursor-pointer">
              <option value="">Cargando asesores…</option>
            </select>
          </div>
          <div>
            <label class="block text-label-bold font-label-bold text-on-surface-variant mb-1 uppercase tracking-wider">Monto vendido *</label>
            <input id="qs-monto" required type="number" min="1" step="1" placeholder="Ej. 850000" class="w-full p-2.5 bg-surface-container-lowest border border-outline-variant rounded-md text-body-md focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition-all" />
          </div>
          <div class="flex justify-end gap-2 pt-2">
            <button type="button" id="qs-cancel" class="px-4 py-2 rounded-lg border border-outline-variant text-on-surface hover:bg-surface-container-low">Cancelar</button>
            <button type="submit" id="qs-submit" class="px-4 py-2 rounded-lg bg-primary text-on-primary font-bold hover:opacity-90 transition-colors flex items-center gap-2">
              <span class="material-symbols-outlined text-[18px]">bolt</span> Registrar venta
            </button>
          </div>
        </form>
      `;

      const form = body.querySelector('#qs-form');
      const clienteInput = body.querySelector('#qs-cliente');
      const suggestions = body.querySelector('#qs-suggestions');
      const hintOpen = body.querySelector('#qs-hint-open');
      const hintExisting = body.querySelector('#qs-hint-existing');
      const hintNew = body.querySelector('#qs-hint-new');
      const asesorWrap = body.querySelector('#qs-asesor-wrap');
      const asesorSelect = body.querySelector('#qs-asesor');
      const montoInput = body.querySelector('#qs-monto');
      const submitBtn = body.querySelector('#qs-submit');

      let advisors = [];
      let selectedClient = null; // ficha completa (con .leads) una vez elegido de las sugerencias
      let selectedOpenLead = null;
      let searchDebounce;

      (async () => {
        try {
          advisors = (await ctx.api.get('/api/advisors')).filter((a) => !a.is_group && a.active);
        } catch {
          ctx.toast('No se pudo cargar la lista de asesores', 'error');
        }
        asesorSelect.innerHTML = advisors.length
          ? '<option value="">Selecciona un asesor…</option>' + advisors.map((a) => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join('')
          : '<option value="">Sin asesores activos disponibles</option>';
      })();

      function hideHints() {
        hintOpen.classList.add('hidden');
        hintExisting.classList.add('hidden');
        hintNew.classList.add('hidden');
        asesorWrap.classList.remove('hidden');
        asesorSelect.required = true;
      }

      function resetSelection() {
        selectedClient = null;
        selectedOpenLead = null;
        hideHints();
      }

      clienteInput.addEventListener('input', () => {
        resetSelection();
        clearTimeout(searchDebounce);
        const term = clienteInput.value.trim();
        if (term.length < 2) {
          suggestions.classList.add('hidden');
          return;
        }
        searchDebounce = setTimeout(async () => {
          let matches = [];
          try {
            matches = await ctx.api.get(`/api/clients?q=${encodeURIComponent(term)}`);
          } catch {
            return;
          }
          if (!matches.length) {
            suggestions.classList.add('hidden');
            return;
          }
          suggestions.innerHTML = matches
            .slice(0, 6)
            .map(
              (c) => `
            <button type="button" data-client-id="${c.id}" class="w-full text-left px-3 py-2 hover:bg-surface-container-low transition-colors flex items-center justify-between gap-2">
              <span class="text-body-sm font-semibold text-on-surface truncate">${escapeHtml(c.name)}</span>
              <span class="text-[11px] text-on-surface-variant shrink-0">${escapeHtml(c.phone || 'sin teléfono')} · ${c.lead_count} pedido${c.lead_count === 1 ? '' : 's'}</span>
            </button>`
            )
            .join('');
          suggestions.classList.remove('hidden');
        }, 250);
      });

      suggestions.addEventListener('click', async (e) => {
        const btn = e.target.closest('button[data-client-id]');
        if (!btn) return;
        suggestions.classList.add('hidden');
        const id = Number(btn.dataset.clientId);
        try {
          selectedClient = await ctx.api.get(`/api/clients/${id}`);
        } catch (err) {
          ctx.toast('No se pudo cargar el cliente', 'error');
          return;
        }
        clienteInput.value = selectedClient.name;
        selectedOpenLead = findOpenLead(selectedClient.leads);
        hideHints();
        if (selectedOpenLead) {
          hintOpen.innerHTML = `<span class="material-symbols-outlined text-[13px]">check_circle</span>Se cerrará su cotización abierta más reciente (${escapeHtml(selectedOpenLead.advisor_name || 'sin asesor')}${selectedOpenLead.product ? ' · ' + escapeHtml(selectedOpenLead.product) : ''}).`;
          hintOpen.classList.remove('hidden');
          asesorWrap.classList.add('hidden');
          asesorSelect.required = false;
        } else {
          hintExisting.classList.remove('hidden');
        }
      });

      // Se ata al overlay del modal (no a document): así el listener muere
      // junto con el modal al cerrarse, en vez de acumularse en document en
      // cada apertura -- este modal se abre muchas veces por sesión (ese es
      // justamente el punto de una venta "rápida").
      body.closest('.fixed')?.addEventListener('click', (e) => {
        if (!clienteInput.contains(e.target) && !suggestions.contains(e.target)) {
          suggestions.classList.add('hidden');
        }
      });

      body.querySelector('#qs-cancel').addEventListener('click', () => close());

      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = clienteInput.value.trim();
        const amount = Number(montoInput.value);
        if (!name) {
          ctx.toast('Escribe el nombre del cliente', 'error');
          return;
        }
        if (!amount || amount <= 0) {
          ctx.toast('Ingresa el monto vendido', 'error');
          return;
        }
        if (!selectedOpenLead && !asesorSelect.value) {
          ctx.toast('Selecciona a qué asesor asignar la venta', 'error');
          return;
        }

        submitBtn.disabled = true;
        submitBtn.classList.add('opacity-60', 'cursor-not-allowed');
        try {
          let closedLead;
          if (selectedOpenLead) {
            closedLead = await ctx.api.post(`/api/leads/${selectedOpenLead.id}/close`, { result: 'ganado', amount });
          } else {
            const client = selectedClient || (await ctx.api.post('/api/clients', { name }));
            const newLead = await ctx.api.post('/api/leads', {
              client_name: client.name,
              phone: client.phone || 'Sin dato',
              advisor_id: asesorSelect.value,
              client_id: client.id,
            });
            closedLead = await ctx.api.post(`/api/leads/${newLead.id}/close`, { result: 'ganado', amount });
          }
          ctx.toast(`Venta registrada — ${closedLead.client_name}`, 'success');
          close();
          if (onDone) onDone();
        } catch (err) {
          ctx.toast(err.message, 'error');
        } finally {
          submitBtn.disabled = false;
          submitBtn.classList.remove('opacity-60', 'cursor-not-allowed');
        }
      });
    },
  });
}
