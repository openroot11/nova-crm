import { escapeHtml } from '../utils.js';
import { ALERT, localToday } from '../components/production.js';

// Programación (sección 19): calendario de entregas y línea de tiempo por
// responsable (de la fecha de inicio a la de entrega), para ver sobrecarga
// y entregas próximas. Solo lectura: las fechas se cambian en la OP.

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const DOW = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'];
// Más de esta cantidad de OP a la vez para una persona = sobrecarga.
const OVERLOAD = 3;

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const parse = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};
const addDays = (s, n) => {
  const d = parse(s);
  d.setDate(d.getDate() + n);
  return iso(d);
};
const dueOf = (o) => o.committed_date || o.requested_date;
const startOf = (o) => o.start_date || (o.started_at ? o.started_at.slice(0, 10) : null) || dueOf(o);

export async function mount(container, ctx) {
  let view = ctx.routeParams.get('vista') === 'timeline' ? 'timeline' : 'calendario';
  const now = new Date();
  let month = new Date(now.getFullYear(), now.getMonth(), 1);
  let tlStart = addDays(localToday(), -3);
  const TL_DAYS = 21;

  container.innerHTML = `
    <div class="flex justify-between items-end mb-margin-desktop flex-wrap gap-3">
      <div>
        <h2 class="text-headline-lg font-headline-lg text-on-surface">Programación</h2>
        <p class="text-body-md font-body-md text-on-surface-variant mt-1">Entregas por día y carga de cada responsable.</p>
      </div>
      <div class="flex gap-1 p-1 rounded-lg border border-outline-variant bg-surface-container-lowest">
        <button data-view="calendario" class="px-3 py-1.5 rounded-md text-body-sm">Calendario</button>
        <button data-view="timeline" class="px-3 py-1.5 rounded-md text-body-sm">Línea de tiempo</button>
      </div>
    </div>
    <div class="flex items-center justify-between gap-3 mb-3 flex-wrap">
      <div class="flex items-center gap-2">
        <button id="pg-prev" class="btn btn-ghost" aria-label="Anterior"><span class="material-symbols-outlined">chevron_left</span></button>
        <p id="pg-label" class="text-headline-sm font-headline-sm text-on-surface min-w-[180px] text-center"></p>
        <button id="pg-next" class="btn btn-ghost" aria-label="Siguiente"><span class="material-symbols-outlined">chevron_right</span></button>
        <button id="pg-today" class="btn btn-secondary text-[12px]">Hoy</button>
      </div>
      <div class="flex gap-3 flex-wrap text-[11px] text-on-surface-variant">
        ${Object.values(ALERT).map((a) => `<span class="inline-flex items-center gap-1"><span class="w-2.5 h-2.5 rounded-sm" style="background:${a.color}"></span>${a.label}</span>`).join('')}
        <span class="inline-flex items-center gap-1"><span class="w-2.5 h-2.5 rounded-sm bg-outline"></span>Entregada</span>
      </div>
    </div>
    <div id="pg-body"></div>`;

  const bodyEl = container.querySelector('#pg-body');
  let ops = [];

  const colorOf = (o) => (['entregada', 'cerrada'].includes(o.status) ? 'var(--c-outline)' : (ALERT[o.alert] || ALERT.en_tiempo).color);

  function paintToggle() {
    container.querySelectorAll('[data-view]').forEach((b) => {
      const on = b.dataset.view === view;
      b.classList.toggle('bg-surface-container-high', on);
      b.classList.toggle('font-bold', on);
      b.classList.toggle('text-on-surface', on);
      b.classList.toggle('text-on-surface-variant', !on);
    });
  }

  function renderCalendar() {
    const first = new Date(month);
    const offset = (first.getDay() + 6) % 7; // lunes primero
    const start = new Date(first);
    start.setDate(1 - offset);
    const today = localToday();
    const cells = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      cells.push(iso(d));
    }
    container.querySelector('#pg-label').textContent = `${MONTHS[month.getMonth()]} ${month.getFullYear()}`;
    bodyEl.innerHTML = `
      <div class="bg-surface-container-lowest border border-outline-variant rounded-xl overflow-x-auto">
       <div class="min-w-[720px]">
        <div class="grid grid-cols-7 border-b border-outline-variant">${DOW.map((d) => `<div class="px-2 py-2 text-[11px] font-label-bold uppercase text-on-surface-variant">${d}</div>`).join('')}</div>
        <div class="grid grid-cols-7">
          ${cells.map((day) => {
            const inMonth = parse(day).getMonth() === month.getMonth();
            const due = ops.filter((o) => dueOf(o) === day);
            const busy = due.filter((o) => !['entregada', 'cerrada'].includes(o.status)).length > OVERLOAD;
            return `
              <div class="min-h-[108px] border-b border-r border-outline-variant p-1.5 ${inMonth ? '' : 'opacity-40'} ${busy ? 'bg-error-container/20' : ''}">
                <div class="flex justify-between items-center mb-1">
                  <span class="text-[12px] ${day === today ? 'w-6 h-6 rounded-full bg-on-surface text-surface flex items-center justify-center font-bold' : 'text-on-surface-variant'}">${parse(day).getDate()}</span>
                  ${busy ? '<span class="text-[10px] font-bold text-error" title="Muchas entregas el mismo día">Sobrecarga</span>' : ''}
                </div>
                <div class="space-y-1">
                  ${due.slice(0, 4).map((o) => `<a href="#/op?id=${o.id}" title="${escapeHtml(`${o.number} · ${o.client_name} · ${o.product_name} · ${o.responsible_name || 'Sin responsable'}`)}" class="block truncate text-[11px] px-1.5 py-0.5 rounded border-l-4 bg-surface-container-low hover:bg-surface-container-high text-on-surface" style="border-color:${colorOf(o)}">${escapeHtml(o.number.slice(-4))} · ${escapeHtml(o.client_name)}</a>`).join('')}
                  ${due.length > 4 ? `<p class="text-[10px] text-on-surface-variant">+${due.length - 4} más</p>` : ''}
                </div>
              </div>`;
          }).join('')}
        </div>
       </div>
      </div>`;
  }

  function renderTimeline() {
    const days = Array.from({ length: TL_DAYS }, (_, i) => addDays(tlStart, i));
    const end = days[days.length - 1];
    const today = localToday();
    container.querySelector('#pg-label').textContent = `${parse(tlStart).getDate()} ${MONTHS[parse(tlStart).getMonth()].slice(0, 3)} – ${parse(end).getDate()} ${MONTHS[parse(end).getMonth()].slice(0, 3)}`;
    const groups = {};
    for (const o of ops.filter((x) => !['entregada', 'cerrada'].includes(x.status))) {
      const k = o.responsible_name || 'Sin responsable';
      (groups[k] = groups[k] || []).push(o);
    }
    const colW = `minmax(34px, 1fr)`;
    const load = (list, day) => list.filter((o) => startOf(o) <= day && dueOf(o) >= day).length;
    bodyEl.innerHTML = `
      <div class="bg-surface-container-lowest border border-outline-variant rounded-xl overflow-x-auto">
        <div class="min-w-[900px]">
          <div class="grid border-b border-outline-variant" style="grid-template-columns: 220px repeat(${TL_DAYS}, ${colW})">
            <div class="px-3 py-2 text-[11px] font-label-bold uppercase text-on-surface-variant">Responsable / OP</div>
            ${days.map((d) => `<div class="py-2 text-center text-[10px] ${d === today ? 'text-on-surface font-bold underline underline-offset-4' : 'text-on-surface-variant'}">${DOW[(parse(d).getDay() + 6) % 7]}<br/>${parse(d).getDate()}</div>`).join('')}
          </div>
          ${Object.entries(groups).sort(([a], [b]) => (a === 'Sin responsable') - (b === 'Sin responsable') || a.localeCompare(b)).map(([name, list]) => `
            <div class="grid border-b border-outline-variant bg-surface-container-low" style="grid-template-columns: 220px repeat(${TL_DAYS}, ${colW})">
              <div class="px-3 py-1.5 text-body-sm font-bold text-on-surface">${escapeHtml(name)} <span class="font-normal text-on-surface-variant">· ${list.length}</span></div>
              ${days.map((d) => {
                const n = load(list, d);
                return `<div class="text-center text-[10px] py-1.5 ${n > OVERLOAD ? 'bg-error-container text-on-error-container font-bold' : n ? 'text-on-surface-variant' : ''}" title="${n} OP en curso">${n || ''}</div>`;
              }).join('')}
            </div>
            ${list.sort((a, b) => dueOf(a).localeCompare(dueOf(b))).map((o) => {
              // Una OP vencida se dibuja hasta hoy (el tramo extra es el
              // retraso); si el inicio quedó después de la entrega, la barra
              // arranca en la entrega.
              const st = startOf(o) > dueOf(o) ? dueOf(o) : startOf(o);
              const en = o.alert === 'vencida' && today > dueOf(o) ? today : dueOf(o);
              const s = st < tlStart ? tlStart : st;
              const e = en > end ? end : en;
              const from = days.indexOf(s);
              const to = days.indexOf(e);
              const visible = from >= 0 && to >= 0 && from <= to;
              return `
                <div class="grid border-b border-outline-variant items-center" style="grid-template-columns: 220px repeat(${TL_DAYS}, ${colW})">
                  <a href="#/op?id=${o.id}" class="px-3 py-1.5 min-w-0 hover:underline">
                    <p class="text-[12px] text-on-surface truncate"><b>${escapeHtml(o.number)}</b> · ${escapeHtml(o.client_name)}</p>
                    <p class="text-[10px] text-on-surface-variant truncate">${escapeHtml(o.product_name)}</p>
                  </a>
                  ${visible ? `<a href="#/op?id=${o.id}" class="h-5 rounded mx-0.5 flex items-center px-1.5 text-[10px] font-bold text-white truncate" style="grid-column:${from + 2} / ${to + 3}; background:${colorOf(o)}" title="${escapeHtml(`${o.number}: ${startOf(o)} → ${dueOf(o)} · ${o.status_label}`)}">${o.blocked ? '⛔ ' : ''}${escapeHtml(o.status_label)}</a>` : `<span class="text-[10px] text-on-surface-variant px-2" style="grid-column: 2 / ${TL_DAYS + 2}">Fuera del rango (${dueOf(o)})</span>`}
                </div>`;
            }).join('')}`).join('') || '<p class="p-6 text-center text-body-sm text-on-surface-variant">No hay OP abiertas con fechas.</p>'}
        </div>
      </div>
      <p class="text-[11px] text-on-surface-variant mt-2">Cada barra va del inicio programado a la entrega comprometida. En la fila de cada responsable se cuentan las OP en curso por día; en rojo, más de ${OVERLOAD} a la vez.</p>`;
  }

  async function load() {
    const from = view === 'calendario' ? iso(new Date(month.getFullYear(), month.getMonth() - 1, 20)) : addDays(tlStart, -30);
    const to = view === 'calendario' ? iso(new Date(month.getFullYear(), month.getMonth() + 1, 12)) : addDays(tlStart, TL_DAYS + 30);
    try {
      const data = await ctx.api.get(`/api/production/schedule?from=${from}&to=${to}`);
      ops = data.ops;
      // Las entregadas no vienen en /schedule (solo abiertas): para el
      // calendario del mes se suman las entregadas recientes.
      if (view === 'calendario') {
        const done = await ctx.api.get('/api/production/ops?status=entregada');
        ops = [...ops, ...done.filter((o) => dueOf(o))];
      }
      view === 'calendario' ? renderCalendar() : renderTimeline();
    } catch (err) {
      ctx.toast(err.message, 'error');
    }
  }

  container.querySelectorAll('[data-view]').forEach((b) =>
    b.addEventListener('click', () => {
      view = b.dataset.view;
      paintToggle();
      load();
    })
  );
  container.querySelector('#pg-prev').addEventListener('click', () => {
    if (view === 'calendario') month = new Date(month.getFullYear(), month.getMonth() - 1, 1);
    else tlStart = addDays(tlStart, -7);
    load();
  });
  container.querySelector('#pg-next').addEventListener('click', () => {
    if (view === 'calendario') month = new Date(month.getFullYear(), month.getMonth() + 1, 1);
    else tlStart = addDays(tlStart, 7);
    load();
  });
  container.querySelector('#pg-today').addEventListener('click', () => {
    month = new Date(now.getFullYear(), now.getMonth(), 1);
    tlStart = addDays(localToday(), -3);
    load();
  });

  paintToggle();
  const off = ctx.ws.on('production_changed', load);
  await load();
  return () => off();
}
