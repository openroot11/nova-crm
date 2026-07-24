import { escapeHtml, formatMoney } from '../utils.js';

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function addDays(dateStr, delta) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + delta);
  return d.toISOString().slice(0, 10);
}

function formatDateDisplay(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const txt = d.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  return txt.charAt(0).toUpperCase() + txt.slice(1);
}

function pad(str, len) {
  str = String(str);
  return str + ' '.repeat(Math.max(0, len - str.length));
}

function buildReportText(data) {
  const { fecha, asesores, ventas, totales, canales } = data;
  const DIV = '─────────────────────';
  const maxNameLen = Math.max(6, ...asesores.map((a) => a.name.length));

  const lines = [];
  lines.push('🧾 *INFORME DIARIO*');
  lines.push('📅 ' + formatDateDisplay(fecha));
  lines.push('');
  if (canales) {
    const totalCanales = canales.whatsapp + canales.correo + canales.llamadas;
    lines.push(DIV);
    lines.push('📨 LEADS DEL DIA: ' + totalCanales);
    lines.push(DIV);
    lines.push('💬 WhatsApp: ' + canales.whatsapp);
    lines.push('📧 Correo: ' + canales.correo);
    lines.push('📞 Llamadas: ' + canales.llamadas);
    lines.push('');
  }
  lines.push(DIV);
  lines.push('📊 *RESUMEN DEL DIA*');
  lines.push(DIV);
  lines.push('```');
  lines.push(pad('ASESOR', maxNameLen) + '  ASIG  CONT  COT  PEND');
  asesores.forEach((a) => {
    lines.push(
      pad(a.name.toUpperCase(), maxNameLen) +
        '  ' +
        pad(String(a.asignados), 4) +
        '  ' +
        pad(String(a.contactados), 4) +
        '  ' +
        pad(String(a.cotizados), 3) +
        '  ' +
        pad(String(a.pendientes), 4)
    );
  });
  lines.push(
    pad('TOTAL', maxNameLen) +
      '  ' +
      pad(String(totales.asignados), 4) +
      '  ' +
      pad(String(totales.contactados), 4) +
      '  ' +
      pad(String(totales.cotizados), 3) +
      '  ' +
      pad(String(totales.pendientes), 4)
  );
  lines.push('```');
  lines.push('');
  lines.push(DIV);
  lines.push('💰 *VENTAS: ' + totales.ventas_count + '*');
  lines.push(DIV);
  if (ventas.length === 0) {
    lines.push('Sin ventas registradas hoy.');
  } else {
    const porAsesor = {};
    ventas.forEach((v) => {
      if (!porAsesor[v.advisor_name]) porAsesor[v.advisor_name] = { cantidad: 0, valor: 0 };
      porAsesor[v.advisor_name].cantidad++;
      porAsesor[v.advisor_name].valor += v.monto;
    });
    Object.keys(porAsesor)
      .sort()
      .forEach((nombre) => {
        const v = porAsesor[nombre];
        lines.push('• ' + nombre.toUpperCase() + ': ' + v.cantidad + ' venta' + (v.cantidad > 1 ? 's' : '') + ' — ' + formatMoney(v.valor));
      });
  }
  lines.push('');
  lines.push('✅ *TOTAL VENDIDO: ' + formatMoney(totales.ventas_total) + '*');

  return lines.join('\n');
}

export async function mount(container, ctx) {
  let currentDate = todayStr();

  container.innerHTML = `
    <div class="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-gutter">
      <div>
        <h2 class="text-headline-lg font-headline-lg text-on-surface">Informe Diario</h2>
        <p class="text-body-md font-body-md text-on-surface-variant mt-1">Carga los datos del día y genera el resumen para enviar por WhatsApp.</p>
      </div>
      <div class="flex items-center gap-2 bg-surface border border-outline-variant rounded-lg p-1.5">
        <button id="btn-prev" class="p-1.5 rounded hover:bg-surface-container-low text-on-surface-variant" title="Día anterior">
          <span class="material-symbols-outlined text-[20px]">chevron_left</span>
        </button>
        <input id="date-input" type="date" class="text-body-sm font-body-sm border-0 focus:ring-0 outline-none bg-transparent" />
        <button id="btn-next" class="p-1.5 rounded hover:bg-surface-container-low text-on-surface-variant" title="Día siguiente">
          <span class="material-symbols-outlined text-[20px]">chevron_right</span>
        </button>
        <button id="btn-today" class="px-3 py-1.5 rounded text-label-bold font-label-bold text-primary hover:bg-surface-container-low">Hoy</button>
      </div>
    </div>

    <div class="grid grid-cols-1 xl:grid-cols-12 gap-gutter items-start">
      <div class="xl:col-span-7 space-y-gutter">
        <div class="bg-surface rounded-xl border border-outline-variant shadow-sm p-6">
          <h3 class="text-headline-md font-headline-md text-on-surface mb-4">Mensajes recibidos</h3>
          <div class="flex flex-wrap items-end gap-4">
            <div class="flex-1 min-w-[140px]">
              <label class="block text-label-bold font-label-bold text-on-surface-variant mb-1">💬 WhatsApp</label>
              <input id="canal-whatsapp" type="number" min="0" value="0" class="canal-input w-full p-2.5 bg-surface-container-lowest border border-outline-variant rounded-md text-body-md focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none" />
            </div>
            <div class="flex-1 min-w-[140px]">
              <label class="block text-label-bold font-label-bold text-on-surface-variant mb-1">📧 Correo</label>
              <input id="canal-correo" type="number" min="0" value="0" class="canal-input w-full p-2.5 bg-surface-container-lowest border border-outline-variant rounded-md text-body-md focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none" />
            </div>
            <div class="flex-1 min-w-[140px]">
              <label class="block text-label-bold font-label-bold text-on-surface-variant mb-1">📞 Llamadas</label>
              <input id="canal-llamadas" type="number" min="0" value="0" class="canal-input w-full p-2.5 bg-surface-container-lowest border border-outline-variant rounded-md text-body-md focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none" />
            </div>
            <div class="bg-primary-container text-on-primary-container rounded-lg px-5 py-2.5 text-center">
              <div id="canal-total" class="text-headline-md font-headline-md leading-none">0</div>
              <div class="text-label-bold font-label-bold uppercase tracking-wider mt-1">Total</div>
            </div>
          </div>
        </div>

        <div class="bg-surface rounded-xl border border-outline-variant shadow-sm overflow-hidden">
          <div class="p-6 border-b border-outline-variant">
            <h3 class="text-headline-md font-headline-md text-on-surface">Datos del día por asesor (manual)</h3>
            <p class="text-body-sm font-body-sm text-on-surface-variant mt-1">Escribe los números y se guardan solos.</p>
          </div>
          <div class="overflow-x-auto">
            <table class="w-full text-left border-collapse min-w-[520px]">
              <thead>
                <tr class="bg-surface-container-low border-b border-outline-variant">
                  <th class="p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase tracking-wider">Asesor</th>
                  <th class="p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase tracking-wider text-center">Asignados</th>
                  <th class="p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase tracking-wider text-center">Contactados</th>
                  <th class="p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase tracking-wider text-center">Cotizados</th>
                  <th class="p-table-cell-padding text-label-bold font-label-bold text-on-surface-variant uppercase tracking-wider text-center">Pendientes</th>
                </tr>
              </thead>
              <tbody id="stats-tbody" class="divide-y divide-outline-variant"></tbody>
              <tfoot>
                <tr id="stats-totales-row" class="bg-surface-container-low font-bold"></tr>
              </tfoot>
            </table>
          </div>
        </div>

        <div class="bg-surface rounded-xl border border-outline-variant shadow-sm p-6">
          <h3 class="text-headline-md font-headline-md text-on-surface mb-4">Ventas del día</h3>
          <form id="venta-form" class="grid grid-cols-1 sm:grid-cols-[1fr_1fr_120px_auto] gap-3 mb-4">
            <select id="v-asesor" required class="p-2.5 bg-surface-container-lowest border border-outline-variant rounded-md text-body-md focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none">
              <option value="">Asesor…</option>
            </select>
            <input id="v-cliente" type="text" placeholder="Cliente (opcional)" class="p-2.5 bg-surface-container-lowest border border-outline-variant rounded-md text-body-md focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none" />
            <input id="v-monto" type="number" min="0" step="1" required placeholder="Monto" class="p-2.5 bg-surface-container-lowest border border-outline-variant rounded-md text-body-md focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none" />
            <button type="submit" class="px-4 py-2 bg-primary text-on-primary rounded-md font-label-bold text-label-bold hover:bg-on-primary-fixed-variant transition-colors whitespace-nowrap">Agregar</button>
          </form>
          <div id="ventas-list" class="divide-y divide-outline-variant"></div>
          <div id="ventas-empty" class="text-body-sm text-on-surface-variant py-4 text-center hidden">Sin ventas registradas hoy.</div>
        </div>
      </div>

      <div class="xl:col-span-5">
        <div class="bg-surface rounded-xl border border-outline-variant shadow-sm p-6 sticky top-20">
          <div class="flex items-center justify-between mb-4">
            <h3 class="text-headline-md font-headline-md text-on-surface">Informe para WhatsApp</h3>
            <button id="btn-copy" class="px-4 py-2 bg-secondary text-on-secondary rounded-md font-label-bold text-label-bold hover:opacity-90 transition-colors flex items-center gap-2">
              <span class="material-symbols-outlined text-[18px]">content_copy</span> Copiar informe
            </button>
          </div>
          <pre id="report-text" class="whitespace-pre-wrap text-body-sm font-body-sm bg-surface-container-low border border-outline-variant rounded-lg p-4 leading-relaxed"></pre>
        </div>
      </div>
    </div>
  `;

  const dateInput = container.querySelector('#date-input');
  const canalWhatsapp = container.querySelector('#canal-whatsapp');
  const canalCorreo = container.querySelector('#canal-correo');
  const canalLlamadas = container.querySelector('#canal-llamadas');
  const canalTotal = container.querySelector('#canal-total');
  const statsTbody = container.querySelector('#stats-tbody');
  const statsTotalesRow = container.querySelector('#stats-totales-row');
  const ventaForm = container.querySelector('#venta-form');
  const vAsesorSelect = container.querySelector('#v-asesor');
  const ventasList = container.querySelector('#ventas-list');
  const ventasEmpty = container.querySelector('#ventas-empty');
  const reportBox = container.querySelector('#report-text');

  let currentData = null;

  function statsRowHtml(a) {
    return `
      <tr data-advisor-id="${a.advisor_id}">
        <td class="p-table-cell-padding text-body-md font-semibold text-on-surface">${escapeHtml(a.name)}</td>
        <td class="p-table-cell-padding text-center"><input type="number" min="0" class="stat-input w-20 text-center p-1.5 border border-outline-variant rounded-md" data-field="asignados" value="${a.asignados}" /></td>
        <td class="p-table-cell-padding text-center"><input type="number" min="0" class="stat-input w-20 text-center p-1.5 border border-outline-variant rounded-md" data-field="contactados" value="${a.contactados}" /></td>
        <td class="p-table-cell-padding text-center"><input type="number" min="0" class="stat-input w-20 text-center p-1.5 border border-outline-variant rounded-md" data-field="cotizados" value="${a.cotizados}" /></td>
        <td class="p-table-cell-padding text-center"><input type="number" min="0" class="stat-input w-20 text-center p-1.5 border border-outline-variant rounded-md" data-field="pendientes" value="${a.pendientes}" /></td>
      </tr>
    `;
  }

  function ventaRowHtml(v) {
    return `
      <div class="flex items-center justify-between py-2.5" data-id="${v.id}">
        <div>
          <span class="text-body-md font-semibold text-on-surface">${escapeHtml(v.advisor_name)}</span>
          ${v.cliente ? `<span class="text-body-sm text-on-surface-variant"> · ${escapeHtml(v.cliente)}</span>` : ''}
        </div>
        <div class="flex items-center gap-3">
          <span class="text-body-md font-bold text-secondary">${formatMoney(v.monto)}</span>
          <button data-action="delete-venta" data-id="${v.id}" class="text-on-surface-variant hover:text-error" title="Eliminar">
            <span class="material-symbols-outlined text-[18px]">delete</span>
          </button>
        </div>
      </div>
    `;
  }

  function renderCanales() {
    const c = currentData.canales;
    canalWhatsapp.value = c.whatsapp;
    canalCorreo.value = c.correo;
    canalLlamadas.value = c.llamadas;
    canalTotal.textContent = c.whatsapp + c.correo + c.llamadas;
  }

  async function loadAdvisorOptions() {
    let advisors = [];
    try {
      advisors = (await ctx.api.get('/api/advisors')).filter((a) => !a.is_group && a.active);
    } catch {
      /* se reintenta en el siguiente render */
    }
    vAsesorSelect.innerHTML = '<option value="">Asesor…</option>' + advisors.map((a) => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join('');
  }

  function recomputeTotales() {
    const t = { asignados: 0, contactados: 0, cotizados: 0, pendientes: 0 };
    currentData.asesores.forEach((a) => {
      t.asignados += a.asignados;
      t.contactados += a.contactados;
      t.cotizados += a.cotizados;
      t.pendientes += a.pendientes;
    });
    t.ventas_count = currentData.ventas.length;
    t.ventas_total = currentData.ventas.reduce((s, v) => s + v.monto, 0);
    currentData.totales = t;
  }

  function renderTotalsRow() {
    const t = currentData.totales;
    statsTotalesRow.innerHTML = `
      <td class="p-table-cell-padding text-body-md">Total</td>
      <td class="p-table-cell-padding text-center">${t.asignados}</td>
      <td class="p-table-cell-padding text-center">${t.contactados}</td>
      <td class="p-table-cell-padding text-center">${t.cotizados}</td>
      <td class="p-table-cell-padding text-center">${t.pendientes}</td>
    `;
  }

  function renderReport() {
    reportBox.textContent = buildReportText(currentData);
  }

  // load() reconstruye TODA la tabla de inputs — solo se usa al cambiar de fecha,
  // al montar la vista, o cuando cambian los asesores. NUNCA se debe llamar como
  // reaccion a guardar un solo campo: reemplazar el HTML mientras el usuario sigue
  // escribiendo en el campo siguiente de la misma fila borraria lo que aun no ha
  // confirmado (ver saveStatRow, que actualiza en memoria en su lugar).
  async function load() {
    dateInput.value = currentDate;
    let data;
    try {
      data = await ctx.api.get(`/api/informe/${currentDate}`);
    } catch (err) {
      ctx.toast('No se pudo cargar el informe de esta fecha', 'error');
      return;
    }
    currentData = data;

    statsTbody.innerHTML = data.asesores.length
      ? data.asesores.map(statsRowHtml).join('')
      : `<tr><td colspan="5" class="p-table-cell-padding py-8 text-center text-body-sm text-on-surface-variant">No hay asesores activos.</td></tr>`;

    renderTotalsRow();
    renderCanales();

    ventasList.innerHTML = data.ventas.map(ventaRowHtml).join('');
    ventasEmpty.classList.toggle('hidden', data.ventas.length > 0);

    renderReport();
  }

  function readRowValues(row) {
    const get = (field) => Number(row.querySelector(`[data-field="${field}"]`).value) || 0;
    return {
      asignados: get('asignados'),
      contactados: get('contactados'),
      cotizados: get('cotizados'),
      pendientes: get('pendientes'),
    };
  }

  // Refleja el cambio en memoria (totales + informe) al instante, sin esperar
  // la respuesta del servidor — asi el informe siempre muestra exactamente lo
  // que hay escrito en la tabla, tecla por tecla.
  function applyStatPatchLocally(advisorId, patch) {
    const a = currentData.asesores.find((x) => x.advisor_id === advisorId);
    if (a) Object.assign(a, patch);
    recomputeTotales();
    renderTotalsRow();
    renderReport();
  }

  async function persistStatRow(fecha, advisorId, patch) {
    try {
      await ctx.api.put(`/api/informe/${fecha}/stats`, { advisor_id: advisorId, ...patch });
    } catch (err) {
      ctx.toast(err.message, 'error');
    }
  }

  // El guardado en el servidor se demora un poco (debounce) para no disparar
  // una peticion por cada tecla, pero el informe/los totales se actualizan
  // de inmediato via applyStatPatchLocally en el listener de "input". Se
  // guarda fecha+patch junto al timer (no solo el id) para poder "volcar"
  // los guardados pendientes de inmediato al cambiar de fecha o al salir
  // de la vista, sin que se disparen despues contra la fecha equivocada.
  const pendingSaves = new Map(); // advisorId -> { timeoutId, fecha, patch }
  function scheduleSave(advisorId, patch) {
    const existing = pendingSaves.get(advisorId);
    if (existing) clearTimeout(existing.timeoutId);
    const fecha = currentDate;
    const timeoutId = setTimeout(() => {
      pendingSaves.delete(advisorId);
      persistStatRow(fecha, advisorId, patch);
    }, 500);
    pendingSaves.set(advisorId, { timeoutId, fecha, patch });
  }

  function flushPendingSaves() {
    pendingSaves.forEach(({ timeoutId, fecha, patch }, advisorId) => {
      clearTimeout(timeoutId);
      persistStatRow(fecha, advisorId, patch);
    });
    pendingSaves.clear();
    flushPendingCanalesSave();
  }

  async function persistCanales(fecha, patch) {
    try {
      await ctx.api.put(`/api/informe/${fecha}/canales`, patch);
    } catch (err) {
      ctx.toast(err.message, 'error');
    }
  }

  let pendingCanalesSave = null; // { timeoutId, fecha, patch }
  function scheduleCanalesSave(patch) {
    if (pendingCanalesSave) clearTimeout(pendingCanalesSave.timeoutId);
    const fecha = currentDate;
    const timeoutId = setTimeout(() => {
      pendingCanalesSave = null;
      persistCanales(fecha, patch);
    }, 500);
    pendingCanalesSave = { timeoutId, fecha, patch };
  }

  function flushPendingCanalesSave() {
    if (!pendingCanalesSave) return;
    const { timeoutId, fecha, patch } = pendingCanalesSave;
    clearTimeout(timeoutId);
    pendingCanalesSave = null;
    persistCanales(fecha, patch);
  }

  function readCanalesValues() {
    return {
      whatsapp: Number(canalWhatsapp.value) || 0,
      correo: Number(canalCorreo.value) || 0,
      llamadas: Number(canalLlamadas.value) || 0,
    };
  }

  function onCanalInput() {
    currentData.canales = readCanalesValues();
    canalTotal.textContent = currentData.canales.whatsapp + currentData.canales.correo + currentData.canales.llamadas;
    renderReport();
    scheduleCanalesSave(currentData.canales);
  }

  [canalWhatsapp, canalCorreo, canalLlamadas].forEach((input) => {
    input.addEventListener('input', onCanalInput);
    input.addEventListener('change', () => {
      if (pendingCanalesSave) clearTimeout(pendingCanalesSave.timeoutId);
      pendingCanalesSave = null;
      persistCanales(currentDate, readCanalesValues());
    });
  });

  statsTbody.addEventListener('input', (e) => {
    if (!e.target.classList.contains('stat-input')) return;
    const row = e.target.closest('tr');
    const advisorId = Number(row.dataset.advisorId);
    const patch = readRowValues(row);
    applyStatPatchLocally(advisorId, patch);
    scheduleSave(advisorId, patch);
  });

  statsTbody.addEventListener('change', (e) => {
    // Al salir del campo (blur) o confirmar con Enter: guarda ya mismo en vez
    // de esperar el debounce de 500ms.
    if (!e.target.classList.contains('stat-input')) return;
    const row = e.target.closest('tr');
    const advisorId = Number(row.dataset.advisorId);
    const pending = pendingSaves.get(advisorId);
    if (pending) clearTimeout(pending.timeoutId);
    pendingSaves.delete(advisorId);
    persistStatRow(currentDate, advisorId, readRowValues(row));
  });

  // Solo refresca ventas + totales + informe; nunca reconstruye la tabla de
  // asesores, para no pisar una edicion de stats en curso en otra fila.
  async function refreshVentas() {
    let data;
    try {
      data = await ctx.api.get(`/api/informe/${currentDate}`);
    } catch (err) {
      ctx.toast('No se pudo actualizar las ventas', 'error');
      return;
    }
    currentData.ventas = data.ventas;
    recomputeTotales();
    renderTotalsRow();
    ventasList.innerHTML = data.ventas.map(ventaRowHtml).join('');
    ventasEmpty.classList.toggle('hidden', data.ventas.length > 0);
    renderReport();
  }

  ventaForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const advisor_id = vAsesorSelect.value;
    const cliente = container.querySelector('#v-cliente').value.trim();
    const monto = container.querySelector('#v-monto').value;
    if (!advisor_id) {
      ctx.toast('Selecciona un asesor', 'error');
      return;
    }
    try {
      await ctx.api.post(`/api/informe/${currentDate}/ventas`, { advisor_id, cliente, monto });
      ventaForm.reset();
      refreshVentas();
    } catch (err) {
      ctx.toast(err.message, 'error');
    }
  });

  ventasList.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action="delete-venta"]');
    if (!btn) return;
    try {
      await ctx.api.del(`/api/informe/ventas/${btn.dataset.id}`);
      refreshVentas();
    } catch (err) {
      ctx.toast(err.message, 'error');
    }
  });

  container.querySelector('#btn-copy').addEventListener('click', () => {
    const text = currentData ? buildReportText(currentData) : reportBox.textContent;
    navigator.clipboard
      .writeText(text)
      .then(() => ctx.toast('Informe copiado, listo para pegar en WhatsApp', 'success'))
      .catch(() => ctx.toast('No se pudo copiar automáticamente, selecciona y copia el texto manualmente', 'error'));
  });

  function switchDate(newDate) {
    flushPendingSaves();
    currentDate = newDate;
    load();
  }

  container.querySelector('#btn-prev').addEventListener('click', () => switchDate(addDays(currentDate, -1)));
  container.querySelector('#btn-next').addEventListener('click', () => switchDate(addDays(currentDate, 1)));
  container.querySelector('#btn-today').addEventListener('click', () => switchDate(todayStr()));
  dateInput.addEventListener('change', () => switchDate(dateInput.value));

  // El propio guardado ya se refleja al instante (saveStatRow actualiza en memoria),
  // asi que este evento solo importa para cambios desde OTRA pestaña/dispositivo.
  // Si el usuario esta con el foco en un campo de la tabla, se ignora el refresco
  // remoto para no interrumpirlo a mitad de tecleo.
  const offInforme = ctx.ws.on('informe_changed', () => {
    if (document.activeElement && document.activeElement.classList.contains('stat-input')) return;
    load();
  });
  const offAdvisors = ctx.ws.on('advisors_changed', () => {
    loadAdvisorOptions();
    load();
  });

  await Promise.all([loadAdvisorOptions(), load()]);

  return () => {
    flushPendingSaves();
    offInforme();
    offAdvisors();
  };
}
