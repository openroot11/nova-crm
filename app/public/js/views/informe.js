import { escapeHtml, formatMoney } from '../utils.js';
import { openQuickSaleModal } from '../components/quickSaleModal.js';

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function addDays(dateStr, delta) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + delta);
  return d.toISOString().slice(0, 10);
}

function clampToToday(dateStr) {
  return dateStr > todayStr() ? todayStr() : dateStr;
}

function isFutureDate(dateStr) {
  return dateStr > todayStr();
}

function formatDateDisplay(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const txt = d.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  return txt.charAt(0).toUpperCase() + txt.slice(1);
}

function parseSqliteDatetime(value) {
  if (!value) return null;
  const [datePart, timePart = '00:00:00'] = value.split(' ');
  const [year, month, day] = datePart.split('-').map(Number);
  const [hour, minute, second] = timePart.split(':').map(Number);
  return new Date(year, month - 1, day, hour || 0, minute || 0, second || 0);
}

function timeLabel(sqliteDatetime) {
  const d = parseSqliteDatetime(sqliteDatetime);
  if (!d) return '';
  return d.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
}

function pad(str, len) {
  str = String(str);
  return str + ' '.repeat(Math.max(0, len - str.length));
}

function buildReportText(data) {
  const { fecha, asesores, ventas, totales, canales } = data;
  const totalCanales = canales.whatsapp + canales.correo + canales.llamadas;
  const activeAsesores = asesores.filter((a) => a.asignados || a.contactados || a.cotizados || a.pendientes);
  const topAsesor = activeAsesores.slice().sort((a, b) => (b.cotizados - a.cotizados) || (b.contactados - a.contactados) || (b.asignados - a.asignados))[0];
  const topVenta = ventas.slice().sort((a, b) => b.monto - a.monto)[0];

  const lines = [];
  lines.push('🧾 *INFORME DIARIO*');
  lines.push('📅 ' + formatDateDisplay(fecha));
  lines.push('');
  lines.push('*Resumen del día*');
  lines.push(`• Leads: ${totalCanales} (WSP ${canales.whatsapp} · Email ${canales.correo} · Llamadas ${canales.llamadas})`);
  lines.push(`• Ventas cerradas: ${totales.ventas_count}`);
  lines.push(`• Total vendido: ${formatMoney(totales.ventas_total)}`);
  lines.push(`• Declinados: ${totales.declinados_count}`);
  lines.push(`• Pendientes: ${totales.pendientes}`);
  if (topAsesor) {
    lines.push(`• Asesor destacado: ${topAsesor.name} — ${topAsesor.contactados} contactados, ${topAsesor.cotizados} cotizaciones`);
  }
  if (topVenta) {
    lines.push(`• Mayor venta: ${topVenta.advisor_name} — ${formatMoney(topVenta.monto)}${topVenta.cliente ? ' · ' + topVenta.cliente : ''}`);
  }
  lines.push('');
  lines.push('*Detalle por asesor*');
  if (activeAsesores.length) {
    activeAsesores.forEach((a) => {
      lines.push(`• ${a.name}: Asig ${a.asignados} · Cont ${a.contactados} · Cot ${a.cotizados} · Pend ${a.pendientes}`);
    });
  } else {
    lines.push('• No hay asesores activos hoy.');
  }
  lines.push('');
  lines.push('*Ventas destacadas*');
  if (ventas.length === 0) {
    lines.push('• No se registraron ventas hoy.');
  } else {
    ventas.slice(0, 3).forEach((v) => {
      lines.push(`• ${timeLabel(v.created_at)} · ${v.advisor_name} · ${formatMoney(v.monto)}${v.cliente ? ' · ' + v.cliente : ''}`);
    });
    if (ventas.length > 3) {
      lines.push(`• +${ventas.length - 3} ventas adicionales.`);
    }
  }
  lines.push('');
  lines.push('*Observaciones*');
  if (totales.pendientes > 0) {
    lines.push(`• ${totales.pendientes} pendientes por cerrar.`);
  } else {
    lines.push('• No hay pendientes abiertos.');
  }
  const notContacted = totales.asignados - totales.contactados;
  if (notContacted > 0) {
    lines.push(`• ${notContacted} leads aún sin contacto.`);
  }
  lines.push('');
  lines.push('✅ Informe listo para copiar y pegar en WhatsApp');

  return lines.join('\n');
}

export async function mount(container, ctx) {
  let currentDate = todayStr();

  container.innerHTML = `
    <div class="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-gutter">
      <div>
        <h2 class="text-headline-lg font-headline-lg text-on-surface">Informe Diario</h2>
        <p class="text-body-md font-body-md text-on-surface-variant mt-1">Datos reales del sistema, listos para enviar por WhatsApp.</p>
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
          <h3 class="text-headline-md font-headline-md text-on-surface mb-1">Mensajes recibidos</h3>
          <p class="text-body-sm font-body-sm text-on-surface-variant mb-4">Todo lo que llega ese día, sin excepción — este número no lo sabe el sistema solo, se anota a mano.</p>
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
          <p id="canal-save-status" class="text-[11px] font-label-bold text-on-surface-variant mt-3">Los datos de canales se guardan automáticamente.</p>
        </div>

        <div class="bg-surface rounded-xl border border-outline-variant shadow-sm p-6">
          <h3 class="text-headline-md font-headline-md text-on-surface mb-1">Detalle por Asesor</h3>
          <p class="text-body-sm font-body-sm text-on-surface-variant mb-4">Tomados en vivo de Ventas — nadie los escribe a mano.</p>
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
          <div class="flex items-center justify-between mb-1 gap-3 flex-wrap">
            <h3 class="text-headline-md font-headline-md text-on-surface">Ventas del día</h3>
            <button id="btn-quick-sale" class="px-3 py-1.5 bg-primary text-on-primary rounded-md font-label-bold text-label-bold hover:opacity-90 transition-colors flex items-center gap-1.5">
              <span class="material-symbols-outlined text-[18px]">bolt</span> Registrar venta
            </button>
          </div>
          <p class="text-body-sm font-body-sm text-on-surface-variant mb-4">Se registran desde Ventas o SLA (botón "Cerrar"), o al vuelo aquí mismo con "Registrar venta".</p>
          <div id="ventas-list" class="divide-y divide-outline-variant"></div>
          <div id="ventas-empty" class="text-body-sm text-on-surface-variant py-4 text-center hidden">Sin ventas registradas este día.</div>
        </div>

        <div class="bg-surface rounded-xl border border-outline-variant shadow-sm p-6">
          <h3 class="text-headline-md font-headline-md text-on-surface mb-1">Declinados del día</h3>
          <p class="text-body-sm font-body-sm text-on-surface-variant mb-4">Leads cerrados como perdidos ese día — clientes con los que no se llegó a nada.</p>
          <div id="declinados-list" class="divide-y divide-outline-variant"></div>
          <div id="declinados-empty" class="text-body-sm text-on-surface-variant py-4 text-center hidden">Sin declinados este día.</div>
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
  const btnPrev = container.querySelector('#btn-prev');
  const btnNext = container.querySelector('#btn-next');
  const canalWhatsapp = container.querySelector('#canal-whatsapp');
  const canalCorreo = container.querySelector('#canal-correo');
  const canalLlamadas = container.querySelector('#canal-llamadas');
  const canalTotal = container.querySelector('#canal-total');
  const canalSaveStatus = container.querySelector('#canal-save-status');
  const statsTbody = container.querySelector('#stats-tbody');
  const statsTotalesRow = container.querySelector('#stats-totales-row');
  const ventasList = container.querySelector('#ventas-list');
  const ventasEmpty = container.querySelector('#ventas-empty');
  const declinadosList = container.querySelector('#declinados-list');
  const declinadosEmpty = container.querySelector('#declinados-empty');
  const reportBox = container.querySelector('#report-text');

  let currentData = null;

  function statsRowHtml(a) {
    return `
      <tr>
        <td class="p-table-cell-padding text-body-md font-semibold text-on-surface">${escapeHtml(a.name)}</td>
        <td class="p-table-cell-padding text-center text-body-md">${a.asignados}</td>
        <td class="p-table-cell-padding text-center text-body-md">${a.contactados}</td>
        <td class="p-table-cell-padding text-center text-body-md">${a.cotizados}</td>
        <td class="p-table-cell-padding text-center text-body-md">${a.pendientes}</td>
      </tr>
    `;
  }

  function ventaRowHtml(v) {
    return `
      <div class="flex items-center justify-between py-2.5">
        <div>
          <span class="text-body-md font-semibold text-on-surface">${escapeHtml(v.advisor_name)}</span>
          ${v.cliente ? `<span class="text-body-sm text-on-surface-variant"> · ${escapeHtml(v.cliente)}</span>` : ''}
          <span class="text-body-sm text-on-surface-variant"> · ${timeLabel(v.created_at)}</span>
        </div>
        <span class="text-body-md font-bold text-secondary">${formatMoney(v.monto)}</span>
      </div>
    `;
  }

  function declinadoRowHtml(d) {
    return `
      <div class="flex items-center justify-between py-2.5">
        <div>
          <span class="text-body-md font-semibold text-on-surface">${escapeHtml(d.advisor_name)}</span>
          ${d.cliente ? `<span class="text-body-sm text-on-surface-variant"> · ${escapeHtml(d.cliente)}</span>` : ''}
        </div>
        <span class="text-body-sm text-on-surface-variant">${timeLabel(d.created_at)}</span>
      </div>
    `;
  }

  const defaultCanalStatus = 'Los datos de canales se guardan automáticamente.';
  let canalSaveTimer = null;

  function setCanalSaveStatus(text, kind = 'info', duration = 0) {
    if (canalSaveTimer) {
      clearTimeout(canalSaveTimer);
      canalSaveTimer = null;
    }
    canalSaveStatus.textContent = text;
    canalSaveStatus.className = `text-[11px] font-label-bold mt-3 ${
      kind === 'error' ? 'text-error' : kind === 'success' ? 'text-secondary' : 'text-on-surface-variant'
    }`;
    if (duration > 0) {
      canalSaveTimer = setTimeout(() => {
        setCanalSaveStatus(defaultCanalStatus, 'info');
      }, duration);
    }
  }

  function renderCanales() {
    const c = currentData.canales;
    canalWhatsapp.value = c.whatsapp;
    canalCorreo.value = c.correo;
    canalLlamadas.value = c.llamadas;
    canalTotal.textContent = c.whatsapp + c.correo + c.llamadas;
    setCanalSaveStatus(defaultCanalStatus, 'info');
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

  async function updateDateControls() {
    dateInput.max = todayStr();
    btnNext.disabled = isFutureDate(currentDate) || currentDate === todayStr();
  }

  async function load() {
    currentDate = clampToToday(currentDate);
    dateInput.value = currentDate;
    reportBox.textContent = 'Cargando informe...';
    await updateDateControls();
    let data;
    try {
      data = await ctx.api.get(`/api/informe/${currentDate}`);
    } catch (err) {
      ctx.toast('No se pudo cargar el informe de esta fecha', 'error');
      reportBox.textContent = 'Error cargando el informe. Intenta nuevamente.';
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

    declinadosList.innerHTML = data.declinados.map(declinadoRowHtml).join('');
    declinadosEmpty.classList.toggle('hidden', data.declinados.length > 0);

    renderReport();
  }

  async function persistCanales(fecha, patch) {
    try {
      setCanalSaveStatus('Guardando...', 'info');
      await ctx.api.put(`/api/informe/${fecha}/canales`, patch);
      setCanalSaveStatus('Guardado', 'success', 2500);
    } catch (err) {
      setCanalSaveStatus('Error guardando. Intenta nuevamente.', 'error');
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
    setCanalSaveStatus('Preparado para guardar...', 'info');
    scheduleCanalesSave(currentData.canales);
  }

  [canalWhatsapp, canalCorreo, canalLlamadas].forEach((input) => {
    input.addEventListener('input', onCanalInput);
    input.addEventListener('change', () => {
      if (pendingCanalesSave) clearTimeout(pendingCanalesSave.timeoutId);
      pendingCanalesSave = null;
      setCanalSaveStatus('Guardando...', 'info');
      persistCanales(currentDate, readCanalesValues());
    });
  });

  container.querySelector('#btn-quick-sale').addEventListener('click', () => {
    openQuickSaleModal(ctx, () => load());
  });

  container.querySelector('#btn-copy').addEventListener('click', () => {
    const text = currentData ? buildReportText(currentData) : reportBox.textContent;
    navigator.clipboard
      .writeText(text)
      .then(() => ctx.toast('Informe copiado, listo para pegar en WhatsApp', 'success'))
      .catch(() => ctx.toast('No se pudo copiar automáticamente, selecciona y copia el texto manualmente', 'error'));
  });

  function switchDate(newDate) {
    const targetDate = clampToToday(newDate);
    flushPendingCanalesSave();
    currentDate = targetDate;
    load();
  }

  container.querySelector('#btn-prev').addEventListener('click', () => switchDate(addDays(currentDate, -1)));
  container.querySelector('#btn-next').addEventListener('click', () => switchDate(addDays(currentDate, 1)));
  container.querySelector('#btn-today').addEventListener('click', () => switchDate(todayStr()));
  dateInput.addEventListener('change', () => {
    if (!dateInput.value) return;
    switchDate(dateInput.value);
  });

  // Los datos por asesor y las ventas son en vivo: cualquier cambio en Ventas
  // (marcar contactado/cotizado/cerrar, incluso con fecha atrasada) refresca
  // este informe solo. Si el usuario esta escribiendo un canal, se ignora el
  // refresco remoto para no interrumpirlo a mitad de tecleo.
  const offInforme = ctx.ws.on('informe_changed', () => {
    if (document.activeElement && document.activeElement.classList.contains('canal-input')) return;
    load();
  });
  const offLeads = ctx.ws.on('leads_changed', () => {
    if (document.activeElement && document.activeElement.classList.contains('canal-input')) return;
    load();
  });

  await load();

  return () => {
    flushPendingCanalesSave();
    offInforme();
    offLeads();
  };
}
