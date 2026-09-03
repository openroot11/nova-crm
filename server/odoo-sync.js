// Sincronización Odoo -> Nova CRM del estado del embudo.
//
// El CRM ya empuja los cambios de etapa HACIA Odoo cuando el asesor marca
// contactado/cotizado/cerrado (ver pushOdooStage en routes/leads.js). Este
// módulo hace lo contrario: revisa Odoo cada N segundos y, si el asesor movió
// la tarjeta en el kanban de Odoo, copia ese estado al lead del CRM.
//
// Alcance (decidido con el negocio): avanzar el embudo a Contactado o Cotizado,
// y cerrar como Perdido. Reglas:
//   - Solo AVANZA: si en Odoo la tarjeta está más atrás que en el CRM, no se
//     toca el CRM (evita pisar el estado real cuando Odoo va atrasado, p.ej.
//     una oportunidad recién creada en su primera etapa).
//   - "Ganado" se cierra SIEMPRE desde el CRM (botón "Cerrar venta"), por el
//     monto real de la venta -- una oportunidad Ganado en Odoo no se toca aquí.
//   - Un lead ya cerrado en el CRM no se reabre desde Odoo.
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
// Orden del embudo: el sync solo mueve hacia adelante (rank mayor).
const RANK = { asignado: 0, contactado: 1, cotizado: 2 };

let running = false;
let timer = null;

function nowUtc() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

// Oportunidad de Odoo -> estado objetivo en el CRM (o null = no tocar).
function targetStatus(opp, stageInfo, thresholds) {
  if (opp.active === false) return 'cerrado_perdido';
  const st = Array.isArray(opp.stage_id) ? stageInfo[opp.stage_id[0]] : null;
  if (st && st.is_won) return null; // "Ganado" se cierra desde el CRM
  const seq = st ? st.sequence : 0;
  if (seq >= thresholds.quoteSeq) return 'cotizado';
  if (seq >= thresholds.contactSeq) return 'contactado';
  return 'asignado';
}

function applyToLead(lead, target) {
  const now = nowUtc();
  if (target === 'cerrado_perdido') {
    db.prepare("UPDATE leads SET status = 'cerrado_perdido', closed_at = COALESCE(closed_at, ?), amount = 0 WHERE id = ?").run(now, lead.id);
    return true;
  }
  // Solo avanzar el embudo, nunca retroceder ni borrar sellos de tiempo.
  if (!(target in RANK) || RANK[target] <= RANK[lead.status]) return false;
  if (target === 'contactado') {
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

async function syncOnce() {
  if (!odoo.isEnabled()) return { skipped: 'odoo_off' };
  if (running) return { skipped: 'busy' };
  running = true;
  try {
    const leads = db
      .prepare(
        `SELECT id, status, odoo_lead_id
           FROM leads
          WHERE odoo_lead_id IS NOT NULL AND status IN (${OPEN_STATUSES.map(() => '?').join(',')})`
      )
      .all(...OPEN_STATUSES);
    if (!leads.length) return { checked: 0, updated: 0 };

    const byOppId = new Map(leads.map((l) => [l.odoo_lead_id, l]));

    // active_test:false para ver también las oportunidades archivadas (perdidas).
    const opps = await odoo.callKw('crm.lead', 'read', [[...byOppId.keys()], ['stage_id', 'active']], {
      context: { active_test: false },
    });

    // Una sola lectura de las etapas involucradas (secuencia + is_won).
    const stageIds = [...new Set(opps.filter((o) => Array.isArray(o.stage_id)).map((o) => o.stage_id[0]))];
    const stageInfo = {};
    if (stageIds.length) {
      const stages = await odoo.callKw('crm.stage', 'read', [stageIds, ['name', 'sequence', 'is_won']]);
      for (const s of stages) stageInfo[s.id] = s;
    }
    // Umbrales por nombre de etapa (por si alguien las renombró/reordenó).
    let contactSeq = 2;
    let quoteSeq = 3;
    for (const s of Object.values(stageInfo)) {
      if (/cotiz|quot/i.test(s.name)) quoteSeq = s.sequence;
      else if (/contact/i.test(s.name)) contactSeq = s.sequence;
    }
    const thresholds = { contactSeq, quoteSeq };

    let updated = 0;
    const changedLeadIds = [];
    for (const opp of opps) {
      const lead = byOppId.get(opp.id);
      if (!lead) continue;
      const target = targetStatus(opp, stageInfo, thresholds);
      if (!target) continue;
      if (applyToLead(lead, target)) {
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
  console.log(`[odoo-sync] revisando Odoo cada ${INTERVAL_SECONDS}s (avanza el embudo a Contactado/Cotizado/Perdido)`);
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
