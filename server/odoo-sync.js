// Sincronización Odoo -> Nova CRM del estado del embudo.
//
// El CRM ya empuja los cambios de etapa HACIA Odoo cuando el asesor marca
// contactado/cotizado/cerrado (ver pushOdooStage en routes/leads.js). Este
// módulo hace lo contrario: revisa Odoo cada N segundos y, si el asesor movió
// la tarjeta en el kanban de Odoo, copia ese estado al lead del CRM.
//
// Alcance (decidido con el negocio): reflejar en el CRM el estado real del
// embudo en Odoo -- Asignado, Contactado o Cotizado -- y cerrar como Perdido.
// Reglas:
//   - Espeja en cualquier dirección: si el asesor mueve la tarjeta hacia
//     adelante o hacia atrás en Odoo (ej. de "Contactado" vuelve a
//     "Asignado"), el CRM queda igual. Los sellos de tiempo (contacted_at,
//     quoted_at) nunca se borran aunque el estado retroceda -- quedan como
//     constancia de que sí se llegó a esa etapa alguna vez.
//   - "Ganado" se cierra SIEMPRE desde el CRM (botón "Cerrar venta"), por el
//     monto real de la venta -- una oportunidad Ganado en Odoo no se toca aquí.
//   - Un lead ya cerrado en el CRM (ganado o perdido) no se reabre desde Odoo.
//   - Ciudad: si el lead en el CRM no tiene ciudad pero la oportunidad en Odoo
//     sí (ej. la puso el asesor directo en Odoo), se copia al CRM. Solo
//     rellena el vacío -- nunca pisa una ciudad que ya esté puesta en el CRM.
//   - Cotizaciones: si el asesor arma la cotización directo en Odoo (sale.order
//     ligado a la oportunidad, sin pasar por el botón "Cotizar" del CRM), se
//     enlaza al lead -- referencia (S0...), monto total y estado "cotizado" --
//     para que salga en la vista Cotizaciones igual que las creadas desde acá.
//     El CRM sigue UNA cotización por lead: si hay varias para la misma
//     oportunidad gana la confirmada (pedido de venta) y si no, la más
//     reciente. Solo cuenta las que tienen la oportunidad ligada; una
//     cotización suelta en Odoo (sin opportunity_id) no se puede atribuir a
//     un lead y se queda afuera.
//
// Config en server/.env:
//   ODOO_SYNC_SECONDS=30     intervalo (por defecto 30; 0 = desactivar)

const { db } = require('./db');
const odoo = require('./odoo');
const { broadcast } = require('./realtime');

const INTERVAL_SECONDS = (() => {
  const raw = process.env.ODOO_SYNC_SECONDS;
  if (raw === undefined || raw === '') return 30;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 30;
})();

// Estados del CRM que el sync puede tocar. Un lead ya cerrado (ganado o
// perdido) NO se reabre desde Odoo -- protege el registro de la venta.
const OPEN_STATUSES = ['asignado', 'contactado', 'cotizado'];

let running = false;
let timer = null;

function nowUtc() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

// Oportunidad de Odoo -> estado objetivo en el CRM (o null = no tocar).
// Se mapea por POSICIÓN de la etapa (secuencia), no por nombre exacto: el
// pipeline del equipo tiene ~9 etapas y varias son "post-cotización"
// (seguimiento, cotizado caliente, no responde...). Cualquier etapa >= la
// ancla "cotizado" y que no sea la ganada cuenta como cotizada.
// Anclas configurables en server/.env (ODOO_STAGE_*); "ganado" = is_won.
// `hasQuote`: la oportunidad tiene una cotización ligada en Odoo -> el lead
// está al menos "cotizado" aunque la tarjeta esté más atrás en el kanban.
function targetStatus(opp, anchors, hasQuote) {
  if (opp.active === false) return 'cerrado_perdido';
  const stageId = Array.isArray(opp.stage_id) ? opp.stage_id[0] : null;
  if (stageId && anchors.lostIds.has(stageId)) return 'cerrado_perdido'; // etapa "DECLINADO" y similares
  const st = stageId ? anchors.byId[stageId] : null;
  if (st && st.is_won) return null; // "Ganado" se cierra desde el CRM
  const seq = st ? st.sequence : -Infinity;
  if (seq >= anchors.quotedSeq) return 'cotizado';
  if (hasQuote) return 'cotizado';
  if (seq >= anchors.contactedSeq) return 'contactado';
  return 'asignado';
}

// Estado de la sale.order en Odoo -> prioridad para elegir cuál sigue el CRM
// cuando una oportunidad tiene varias. Confirmada (pedido) > enviada >
// borrador. A igual prioridad gana la más reciente (id mayor). Las canceladas
// se descartan antes de llegar aquí (ver el filtro en syncOnce).
const ORDER_STATE_RANK = { draft: 0, sent: 1, sale: 2, done: 2 };

function betterOrder(current, candidate) {
  if (!current) return candidate;
  const rc = ORDER_STATE_RANK[current.state] ?? 0;
  const rk = ORDER_STATE_RANK[candidate.state] ?? 0;
  if (rk !== rc) return rk > rc ? candidate : current;
  return candidate.id > current.id ? candidate : current;
}

// Enlaza al lead la cotización que armó el asesor directo en Odoo: referencia,
// monto (sin IVA) y sellos de tiempo. No toca el status aquí (eso lo hace
// applyToLead con hasQuote); solo rellena datos. El subtotal del pedido en
// Odoo manda sobre el monto guardado mientras el lead siga abierto -- igual
// que hace POST /:id/quotation al crear desde el CRM. El reporte de ventas
// del CRM se lleva sin impuestos, por eso se usa amount_untaxed y no
// amount_total. Devuelve true si cambió algo.
function applyQuotationToLead(lead, order) {
  const sets = [];
  const vals = [];
  if (lead.odoo_order_id !== order.id) { sets.push('odoo_order_id = ?'); vals.push(order.id); }
  if (lead.sale_reference !== order.name) { sets.push('sale_reference = ?'); vals.push(order.name); }
  if (Math.round(lead.amount || 0) !== Math.round(order.amount_untaxed || 0)) {
    sets.push('amount = ?');
    vals.push(order.amount_untaxed || 0);
  }
  // create_date de Odoo ya viene en UTC ('YYYY-MM-DD HH:MM:SS'): mismo formato
  // que guarda el CRM. Solo se pone si el lead aún no tenía el sello.
  const quotedAt = (order.create_date || nowUtc()).slice(0, 19);
  if (!lead.quoted_at) { sets.push('quoted_at = ?'); vals.push(quotedAt); }
  if (!lead.contacted_at) { sets.push('contacted_at = ?'); vals.push(quotedAt); }
  if (!sets.length) return false;
  vals.push(lead.id);
  db.prepare(`UPDATE leads SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  return true;
}

function applyToLead(lead, target) {
  const now = nowUtc();
  if (target === 'cerrado_perdido') {
    db.prepare("UPDATE leads SET status = 'cerrado_perdido', closed_at = COALESCE(closed_at, ?), amount = 0 WHERE id = ?").run(now, lead.id);
    return true;
  }
  // Espejar el estado (adelante o atrás), sin borrar nunca un sello de
  // tiempo ya puesto -- COALESCE deja el primero que se registró aunque el
  // lead retroceda y vuelva a avanzar despues.
  if (target === lead.status) return false; // ya está igual, nada que hacer
  if (target === 'asignado') {
    db.prepare("UPDATE leads SET status = 'asignado' WHERE id = ?").run(lead.id);
  } else if (target === 'contactado') {
    db.prepare("UPDATE leads SET status = 'contactado', contacted_at = COALESCE(contacted_at, ?) WHERE id = ?").run(now, lead.id);
  } else if (target === 'cotizado') {
    db.prepare(
      "UPDATE leads SET status = 'cotizado', contacted_at = COALESCE(contacted_at, ?), quoted_at = COALESCE(quoted_at, ?) WHERE id = ?"
    ).run(now, now, lead.id);
  } else {
    return false;
  }
  return true;
}

// Rellena la ciudad del lead SOLO si esta vacia en el CRM -- nunca pisa una
// que ya este puesta (el CRM manda una vez que alguien la corrigio a mano).
function applyCityToLead(lead, opp) {
  if (lead.city || !opp.city) return false;
  db.prepare('UPDATE leads SET city = ? WHERE id = ?').run(opp.city, lead.id);
  return true;
}

async function syncOnce() {
  if (!odoo.isEnabled()) return { skipped: 'odoo_off' };
  if (running) return { skipped: 'busy' };
  running = true;
  try {
    const leads = db
      .prepare(
        `SELECT id, status, city, odoo_lead_id, odoo_order_id, sale_reference, amount, quoted_at, contacted_at
           FROM leads
          WHERE odoo_lead_id IS NOT NULL AND status IN (${OPEN_STATUSES.map(() => '?').join(',')})`
      )
      .all(...OPEN_STATUSES);
    if (!leads.length) return { checked: 0, updated: 0 };

    const byOppId = new Map(leads.map((l) => [l.odoo_lead_id, l]));

    const anchors = await odoo.stageAnchors();
    if (!anchors.resolved.contacted || !anchors.resolved.quoted) {
      return { error: `el CRM no reconoce las etapas de Odoo (revisa ODOO_STAGE_CONTACTED / ODOO_STAGE_QUOTED en server/.env)` };
    }

    // active_test:false para ver también las oportunidades archivadas (perdidas).
    const opps = await odoo.callKw('crm.lead', 'read', [[...byOppId.keys()], ['stage_id', 'active', 'city']], {
      context: { active_test: false },
    });

    // Cotizaciones (sale.order) ligadas a estas oportunidades -- las que el
    // asesor armó directo en Odoo. Una lectura batch; se agrupa por
    // oportunidad y se elige la que sigue el CRM (ver betterOrder).
    const orderByOpp = new Map();
    try {
      const orders = await odoo.callKw(
        'sale.order',
        'search_read',
        [[['opportunity_id', 'in', [...byOppId.keys()]], ['state', '!=', 'cancel']]],
        { fields: ['name', 'state', 'amount_untaxed', 'opportunity_id', 'create_date'], order: 'id asc' }
      );
      for (const o of orders) {
        const oppId = Array.isArray(o.opportunity_id) ? o.opportunity_id[0] : null;
        if (!oppId) continue;
        orderByOpp.set(oppId, betterOrder(orderByOpp.get(oppId), o));
      }
    } catch (err) {
      console.error('[odoo-sync] no se pudieron leer las cotizaciones:', err.message);
    }

    let updated = 0;
    const changedLeadIds = [];
    for (const opp of opps) {
      const lead = byOppId.get(opp.id);
      if (!lead) continue;
      let changed = false;
      const order = orderByOpp.get(opp.id) || null;
      if (order && applyQuotationToLead(lead, order)) changed = true;
      const target = targetStatus(opp, anchors, !!order);
      if (target && applyToLead(lead, target)) changed = true;
      if (applyCityToLead(lead, opp)) changed = true;
      if (changed) {
        updated++;
        changedLeadIds.push(lead.id);
      }
    }

    if (updated) {
      broadcast('leads_changed', { reason: 'odoo_sync', ids: changedLeadIds });
      console.log(`[odoo-sync] ${updated} lead(s) actualizados desde Odoo: ${changedLeadIds.join(', ')}`);
    }
    return { checked: leads.length, updated };
  } catch (err) {
    console.error('[odoo-sync] error:', err.message);
    return { error: err.message };
  } finally {
    running = false;
  }
}

function start() {
  if (INTERVAL_SECONDS === 0) {
    console.log('[odoo-sync] desactivado (ODOO_SYNC_SECONDS=0)');
    return;
  }
  if (!odoo.isEnabled()) {
    console.log('[odoo-sync] Odoo no configurado -- sync Odoo->CRM inactivo');
    return;
  }
  console.log(`[odoo-sync] revisando Odoo cada ${INTERVAL_SECONDS}s (espeja Asignado/Contactado/Cotizado en cualquier dirección, enlaza cotizaciones armadas en Odoo, y cierra Perdido)`);
  // Primera pasada a los ~10s de arrancar, luego cada INTERVAL_SECONDS.
  setTimeout(() => {
    syncOnce();
    timer = setInterval(syncOnce, INTERVAL_SECONDS * 1000);
  }, 10000);
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { start, stop, syncOnce };
