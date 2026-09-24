import { escapeHtml } from '../utils.js';
import { STATUS, kpiTile, fmtDate, labelCls, localToday } from '../components/production.js';

// Reportes de producción (sección 25): recibidas, programadas, en
// producción, terminadas, entregadas, retrasadas y bloqueadas; producción
// por responsable, tiempo promedio de producción y cumplimiento de fechas.

export async function mount(container, ctx) {
  const d = new Date();
  let from = `${localToday().slice(0, 8)}01`;
  let to = localToday();

  container.innerHTML = `
    <div class="flex justify-between items-end mb-margin-desktop flex-wrap gap-3">
      <div>
        <h2 class="text-headline-lg font-headline-lg text-on-surface">Reportes de producción</h2>
        <p class="text-body-md font-body-md text-on-surface-variant mt-1">Cumplimiento, tiempos y carga por responsable.</p>
      </div>
      <div class="flex items-end gap-2 flex-wrap">
        <div><label class="${labelCls}">Desde</label><input id="rp-from" type="date" value="${from}" class="p-2 bg-surface-container-lowest border border-outline-variant rounded-md text-body-sm outline-none" /></div>
        <div><label class="${labelCls}">Hasta</label><input id="rp-to" type="date" value="${to}" class="p-2 bg-surface-container-lowest border border-outline-variant rounded-md text-body-sm outline-none" /></div>
        <button id="rp-prev" class="px-3 py-2 border border-outline-variant rounded-md text-body-sm hover:bg-surface-container-low">Mes pasado</button>
      </div>
    </div>
    <div id="rp-body"></div>`;

  const bodyEl = container.querySelector('#rp-body');

  async function load() {
    let r;
    try {
      r = await ctx.api.get(`/api/production/reports?from=${from}&to=${to}`);
    } catch (err) {
      ctx.toast(err.message, 'error');
      return;
    }
    const t = r.totals;
    const statusRows = Object.entries(r.by_status).filter(([s]) => s !== 'cancelada');
    const maxStatus = Math.max(1, ...statusRows.map(([, n]) => n));
    bodyEl.innerHTML = `
      <p class="text-[12px] text-on-surface-variant mb-2">Periodo: ${fmtDate(r.from)} a ${fmtDate(r.to)}. "Programadas", "en producción", "retrasadas" y "bloqueadas" son de hoy.</p>
      <div class="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3 mb-gutter">
        ${kpiTile('Recibidas', t.recibidas, { hint: 'OP creadas en el periodo' })}
        ${kpiTile('Programadas', t.programadas)}
        ${kpiTile('En producción', t.en_produccion)}
        ${kpiTile('Terminadas', t.terminadas, { hint: 'Pasaron a control' })}
        ${kpiTile('Entregadas', t.entregadas)}
        ${kpiTile('Retrasadas', t.retrasadas, { tone: t.retrasadas ? 'bad' : '' })}
        ${kpiTile('Bloqueadas', t.bloqueadas, { tone: t.bloqueadas ? 'bad' : '' })}
        ${kpiTile('Cumplimiento', t.cumplimiento === null ? '—' : `${t.cumplimiento}%`, { hint: t.tiempo_promedio_dias === null ? 'Entregas a tiempo' : `Producción promedio: ${t.tiempo_promedio_dias} días` })}
      </div>
      <div class="grid grid-cols-1 xl:grid-cols-2 gap-gutter">
        <div class="bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm p-4">
          <p class="text-label-bold font-label-bold text-on-surface mb-3">OP por estado (hoy)</p>
          ${statusRows.map(([s, n]) => `
            <div class="mb-2">
              <div class="flex justify-between text-body-sm"><span class="text-on-surface">${STATUS[s].label}</span><span class="text-on-surface-variant">${n}</span></div>
              <div class="h-1.5 rounded-full bg-surface-container-high overflow-hidden"><div class="h-full bg-on-surface-variant" style="width:${Math.round((n / maxStatus) * 100)}%"></div></div>
            </div>`).join('')}
        </div>
        <div class="bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm overflow-x-auto">
          <p class="text-label-bold font-label-bold text-on-surface p-4 pb-2">Producción por responsable</p>
          <table class="w-full text-left text-body-sm">
            <thead><tr class="border-b border-outline-variant text-[10px] uppercase tracking-wider text-on-surface-variant"><th class="px-4 py-2">Responsable</th><th class="text-right">Abiertas</th><th class="text-right">Entregadas</th><th class="text-right px-4">Vencidas</th></tr></thead>
            <tbody class="divide-y divide-outline-variant">
              ${r.by_responsible.map((x) => `<tr><td class="px-4 py-2 font-bold text-on-surface">${escapeHtml(x.name)}</td><td class="text-right">${x.abiertas}</td><td class="text-right">${x.entregadas}</td><td class="text-right px-4 ${x.vencidas ? 'text-error font-bold' : ''}">${x.vencidas}</td></tr>`).join('') || '<tr><td colspan="4" class="px-4 py-4 text-on-surface-variant">Sin datos.</td></tr>'}
            </tbody>
          </table>
        </div>
        <div class="xl:col-span-2 bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm overflow-x-auto">
          <p class="text-label-bold font-label-bold text-on-surface p-4 pb-2">Entregas del periodo y cumplimiento de fechas</p>
          <table class="w-full text-left text-body-sm min-w-[600px]">
            <thead><tr class="border-b border-outline-variant text-[10px] uppercase tracking-wider text-on-surface-variant"><th class="px-4 py-2">OP</th><th>Cliente</th><th>Producto</th><th>Comprometida</th><th>Entregada</th><th class="px-4">Resultado</th></tr></thead>
            <tbody class="divide-y divide-outline-variant">
              ${r.delivered.map((x) => `<tr><td class="px-4 py-2"><a href="#/op?id=${x.id}" class="underline font-bold">${escapeHtml(x.number)}</a></td><td>${escapeHtml(x.client_name)}</td><td>${escapeHtml(x.product_name)}</td><td>${fmtDate(x.committed_date)}</td><td>${fmtDate(x.delivered)}</td><td class="px-4 font-bold ${x.on_time ? 'text-secondary' : 'text-error'}">${x.on_time ? 'A tiempo' : 'Tarde'}</td></tr>`).join('') || '<tr><td colspan="6" class="px-4 py-4 text-on-surface-variant">Sin entregas en el periodo.</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>`;
  }

  container.querySelector('#rp-from').addEventListener('change', (e) => { from = e.target.value; load(); });
  container.querySelector('#rp-to').addEventListener('change', (e) => { to = e.target.value; load(); });
  container.querySelector('#rp-prev').addEventListener('click', () => {
    const a = new Date(d.getFullYear(), d.getMonth() - 1, 1);
    const b = new Date(d.getFullYear(), d.getMonth(), 0);
    const f = (x) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
    from = f(a);
    to = f(b);
    container.querySelector('#rp-from').value = from;
    container.querySelector('#rp-to').value = to;
    load();
  });
  const off = ctx.ws.on('production_changed', load);
  await load();
  return () => off();
}
