// Núcleo del módulo Producción (ver Velara_CRM_Produccion_Especificacion_
// Aprobada.md y docs/PLAN-PRODUCCION.md): consecutivos, alertas de fecha,
// máquina de estados con sus validaciones, bloqueos que pausan la OP e
// historial. Todo cambio pasa por aquí para que el historial no se pueda
// saltar. Producción NO toca inventario.

const { db } = require('./db');

const STATUSES = ['por_validar', 'programada', 'en_produccion', 'pausada', 'control', 'lista', 'entregada', 'cerrada', 'cancelada'];
const STATUS_LABEL = {
  por_validar: 'Por validar',
  programada: 'Programada',
  en_produccion: 'En producción',
  pausada: 'Pausada',
  control: 'Control / revisión',
  lista: 'Lista para entregar',
  entregada: 'Entregada',
  cerrada: 'Cerrada',
  cancelada: 'Cancelada',
};
const BLOCK_REASONS = {
  info_incompleta: 'Información incompleta',
  diseno_pendiente: 'Diseño pendiente',
  aprobacion_pendiente: 'Aprobación pendiente',
  material_pendiente: 'Material pendiente',
  problema_produccion: 'Problema de producción',
  otro: 'Otro',
};
const PRIORITIES = ['baja', 'normal', 'alta', 'urgente'];
const DEFAULT_TASKS = ['Cortar material', 'Preparar piezas', 'Coser / ensamblar', 'Revisar', 'Empacar'];

const MANAGER_ROLES = ['admin', 'coordinador', 'produccion'];
const isManager = (user) => MANAGER_ROLES.includes(user?.role);

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

function nowUtc() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function todayBogota(offsetDays = 0) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date(Date.now() + offsetDays * 86400000));
}

// ---- historial ---------------------------------------------------------------

async function log(entity, entityId, userId, action, detail = null) {
  await db
    .prepare('INSERT INTO activity_log (entity, entity_id, user_id, action, detail) VALUES (?, ?, ?, ?, ?)')
    .run(entity, entityId, userId || null, action, detail ? String(detail) : null);
}

// ---- consecutivos ------------------------------------------------------------

// OP-2026-0001: consecutivo por año; UNIQUE(year, seq) evita duplicados.
async function nextOpNumber() {
  const year = Number(todayBogota().slice(0, 4));
  const row = await db.prepare('SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM production_orders WHERE year = ?').get(year);
  return { year, seq: row.n, number: `OP-${year}-${String(row.n).padStart(4, '0')}` };
}

async function nextSalesOrderNumber() {
  const year = todayBogota().slice(0, 4);
  const row = await db
    .prepare("SELECT COALESCE(MAX(CAST(substr(number, 10) AS INTEGER)), 0) + 1 AS n FROM sales_orders WHERE number LIKE ?")
    .get(`PED-${year}-%`);
  return `PED-${year}-${String(row.n).padStart(5, '0')}`;
}

async function nextRequestNumber() {
  const row = await db.prepare("SELECT COALESCE(MAX(CAST(substr(number, 4) AS INTEGER)), 0) + 1 AS n FROM material_requests").get();
  return `SM-${String(row.n).padStart(4, '0')}`;
}

// ---- alertas de fecha (sección 16) -------------------------------------------

// en_tiempo (> 3 días) · proxima (2-3 días) · en_riesgo (hoy o mañana) ·
// vencida (ya pasó). null si ya se entregó, cerró o canceló.
function dateAlert(op) {
  if (['entregada', 'cerrada', 'cancelada'].includes(op.status)) return null;
  const due = op.committed_date || op.requested_date;
  if (!due) return null;
  if (due < todayBogota()) return 'vencida';
  if (due <= todayBogota(1)) return 'en_riesgo';
  if (due <= todayBogota(3)) return 'proxima';
  return 'en_tiempo';
}

// Qué falta para poder programar (sección 4: "¿información completa?").
function missingInfo(op) {
  const missing = [];
  if (!op.product_name) missing.push('Producto');
  if (!(Number(op.quantity) > 0)) missing.push('Cantidad');
  if (!op.committed_date) missing.push('Fecha de entrega comprometida');
  if (!op.responsible_worker_id) missing.push('Responsable de producción');
  return missing;
}

// ---- permisos por OP ---------------------------------------------------------

// Un asesor solo ve las OP de sus clientes (lead asignado a él o asesor de
// la OP); los demás roles con acceso ven todas.
async function canSeeOp(user, op) {
  if (user.role !== 'asesor') return true;
  if (!user.advisor_id) return false;
  if (op.advisor_id === user.advisor_id) return true;
  const so = await db.prepare('SELECT l.assigned_advisor_id FROM sales_orders so LEFT JOIN leads l ON l.id = so.lead_id WHERE so.id = ?').get(op.sales_order_id);
  return !!so && so.assigned_advisor_id === user.advisor_id;
}

async function canSeeSalesOrder(user, so) {
  if (user.role !== 'asesor') return true;
  if (!user.advisor_id) return false;
  if (so.advisor_id === user.advisor_id) return true;
  if (!so.lead_id) return false;
  const lead = await db.prepare('SELECT assigned_advisor_id FROM leads WHERE id = ?').get(so.lead_id);
  return !!lead && lead.assigned_advisor_id === user.advisor_id;
}

// ---- lectura -------------------------------------------------------------------

const OP_LIST_SQL = `
  SELECT op.*, so.number AS sales_order_number, so.client_name, so.contact, so.phone, so.address, so.destination, so.lead_id,
         w.name AS responsible_name, a.name AS advisor_name,
         (SELECT COUNT(*) FROM production_tasks t WHERE t.op_id = op.id AND t.status != 'anulada') AS tasks_total,
         (SELECT COUNT(*) FROM production_tasks t WHERE t.op_id = op.id AND t.status = 'completada') AS tasks_done,
         (SELECT COUNT(*) FROM production_blocks b WHERE b.op_id = op.id AND b.status = 'activo') AS active_blocks,
         (SELECT b.reason FROM production_blocks b WHERE b.op_id = op.id AND b.status = 'activo' ORDER BY b.created_at DESC LIMIT 1) AS block_reason,
         (SELECT COUNT(*) FROM production_files f WHERE f.op_id = op.id AND f.kind = 'diseno' AND f.is_current = 1) AS designs,
         (SELECT COUNT(*) FROM production_approvals ap WHERE ap.op_id = op.id) AS approvals,
         (SELECT COUNT(*) FROM material_requirements r WHERE r.op_id = op.id AND r.status IN ('pendiente', 'solicitado', 'bloqueado')) AS materials_pending
    FROM production_orders op
    JOIN sales_orders so ON so.id = op.sales_order_id
    LEFT JOIN workers w ON w.id = op.responsible_worker_id
    LEFT JOIN advisors a ON a.id = COALESCE(op.advisor_id, so.advisor_id)
`;

function decorate(op) {
  return {
    ...op,
    status_label: STATUS_LABEL[op.status],
    progress: op.tasks_total > 0 ? Math.round((op.tasks_done / op.tasks_total) * 100) : 0,
    alert: dateAlert(op),
    blocked: op.active_blocks > 0,
    block_reason_label: op.block_reason ? BLOCK_REASONS[op.block_reason] : null,
    missing: missingInfo(op),
  };
}

async function listOps(user, where = [], params = []) {
  const clauses = [...where];
  const args = [...params];
  if (user.role === 'asesor') {
    clauses.push('(op.advisor_id = ? OR so.advisor_id = ? OR so.lead_id IN (SELECT id FROM leads WHERE assigned_advisor_id = ?))');
    args.push(user.advisor_id || -1, user.advisor_id || -1, user.advisor_id || -1);
  }
  const rows = await db
    .prepare(`${OP_LIST_SQL} ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''} ORDER BY COALESCE(op.committed_date, op.requested_date, '9999-12-31') ASC, op.id ASC`)
    .all(...args);
  return rows.map(decorate);
}

async function readOp(id) {
  const op = await db.prepare(`${OP_LIST_SQL} WHERE op.id = ?`).get(id);
  if (!op) return null;
  const [specs, files, requirements, requests, tasks, workers, blocks, reviews, approvals, deliveries, activity, claims] = await Promise.all([
    db.prepare('SELECT * FROM production_specs WHERE op_id = ? ORDER BY section, position, id').all(id),
    db.prepare('SELECT f.*, u.username AS uploaded_by_name FROM production_files f LEFT JOIN users u ON u.id = f.uploaded_by WHERE f.op_id = ? ORDER BY f.group_name, f.version DESC').all(id),
    db.prepare("SELECT * FROM material_requirements WHERE op_id = ? AND status != 'anulado' ORDER BY id").all(id),
    db.prepare('SELECT * FROM material_requests WHERE op_id = ? ORDER BY id DESC').all(id),
    db.prepare("SELECT t.*, w.name AS worker_name FROM production_tasks t LEFT JOIN workers w ON w.id = t.worker_id WHERE t.op_id = ? AND t.status != 'anulada' ORDER BY t.position, t.id").all(id),
    db.prepare('SELECT w.* FROM production_workers pw JOIN workers w ON w.id = pw.worker_id WHERE pw.op_id = ? ORDER BY w.name').all(id),
    db.prepare('SELECT b.*, u.username AS created_by_name, r.username AS resolved_by_name FROM production_blocks b LEFT JOIN users u ON u.id = b.created_by LEFT JOIN users r ON r.id = b.resolved_by WHERE b.op_id = ? ORDER BY b.created_at DESC').all(id),
    db.prepare('SELECT rv.*, u.username AS reviewed_by_name FROM production_reviews rv LEFT JOIN users u ON u.id = rv.reviewed_by WHERE rv.op_id = ? ORDER BY rv.created_at DESC').all(id),
    db.prepare('SELECT ap.*, a.name AS advisor_name, u.username AS created_by_name FROM production_approvals ap LEFT JOIN advisors a ON a.id = ap.advisor_id LEFT JOIN users u ON u.id = ap.created_by WHERE ap.op_id = ? ORDER BY ap.created_at DESC').all(id),
    db.prepare('SELECT * FROM production_deliveries WHERE op_id = ? ORDER BY created_at').all(id),
    db.prepare("SELECT l.*, COALESCE(u.username, 'Sistema') AS user_name FROM activity_log l LEFT JOIN users u ON u.id = l.user_id WHERE (l.entity = 'op' AND l.entity_id = ?) OR (l.entity = 'pedido' AND l.entity_id = ?) ORDER BY l.created_at DESC, l.id DESC").all(id, op.sales_order_id),
    db.prepare('SELECT * FROM warranty_claims WHERE production_order_id = ? ORDER BY reported_at DESC').all(id),
  ]);
  return {
    ...decorate(op),
    specs,
    files: files.map((f) => ({ ...f, is_current: !!f.is_current })),
    requirements,
    requests,
    tasks,
    workers,
    blocks: blocks.map((b) => ({ ...b, reason_label: BLOCK_REASONS[b.reason] })),
    reviews: reviews.map((r) => ({ ...r, checklist: r.checklist ? JSON.parse(r.checklist) : {} })),
    approvals: approvals.map((a) => ({ ...a, confirm_features: !!a.confirm_features, confirm_quantities: !!a.confirm_quantities, confirm_design: !!a.confirm_design })),
    deliveries,
    activity,
    claims,
    warranty_until: warrantyUntil(op),
  };
}

function warrantyUntil(op) {
  if (!op.delivered_at || !['entregada', 'cerrada'].includes(op.status)) return null;
  const d = new Date(`${op.delivered_at.replace(' ', 'T')}Z`);
  const local = new Date(d.getTime() - 5 * 3600000);
  local.setUTCMonth(local.getUTCMonth() + (Number(op.warranty_months) || 0));
  return local.toISOString().slice(0, 10);
}

// ---- máquina de estados (sección 4, 5, 20, 21, 24) ----------------------------

// Transiciones permitidas a mano. PAUSADA no se elige: la pone un bloqueo
// activo y la quita resolver el último (ver addBlock/resolveBlock).
const TRANSITIONS = {
  por_validar: ['programada', 'cancelada'],
  programada: ['en_produccion', 'por_validar', 'cancelada'],
  en_produccion: ['control', 'cancelada'],
  pausada: ['cancelada'],
  control: ['lista', 'en_produccion', 'cancelada'],
  lista: ['entregada', 'control'],
  entregada: ['cerrada'],
  cerrada: [],
  cancelada: [],
};

async function transition(opId, to, user, payload = {}) {
  const op = await readOp(opId);
  if (!op) throw httpError(404, 'Orden de producción no encontrada');
  if (!STATUSES.includes(to)) throw httpError(400, 'Estado inválido');
  if (!(TRANSITIONS[op.status] || []).includes(to)) {
    throw httpError(409, `No se puede pasar de "${STATUS_LABEL[op.status]}" a "${STATUS_LABEL[to]}"`);
  }
  const reason = payload.reason ? String(payload.reason).trim() : '';
  const now = nowUtc();
  const sets = { status: to };
  let action = `Estado: ${STATUS_LABEL[op.status]} → ${STATUS_LABEL[to]}`;

  if (to === 'programada' && op.status === 'por_validar') {
    const missing = missingInfo(op);
    if (missing.length) throw httpError(409, `Falta información para programar: ${missing.join(', ')}`);
    if (!op.start_date) sets.start_date = todayBogota();
    action = 'OP validada y programada';
  }
  if (to === 'por_validar') {
    if (!reason) throw httpError(400, 'Indica el motivo para devolver la OP a validación');
  }
  if (to === 'en_produccion') {
    if (op.active_blocks > 0) throw httpError(409, `La OP tiene un bloqueo activo (${op.block_reason_label}). Resuélvelo primero.`);
    if (op.status === 'programada') {
      sets.started_at = op.started_at || now;
      action = 'Producción iniciada';
    } else if (op.status === 'control') {
      if (!reason) throw httpError(400, 'Indica qué hay que corregir');
      action = 'Devuelta a producción para corrección';
    }
  }
  if (to === 'control' && op.status === 'en_produccion') {
    sets.finished_at = now;
    action = 'Producción terminada: pasa a control / revisión';
  }
  if (to === 'lista') {
    const lastReview = op.reviews[0];
    if (!lastReview || lastReview.result !== 'aprobado') throw httpError(409, 'Falta el control / revisión aprobado');
    if (op.requires_approval && op.approvals.length === 0) throw httpError(409, 'Falta la aprobación del asesor comercial');
    const date = payload.date || todayBogota();
    await db
      .prepare('INSERT INTO production_deliveries (op_id, kind, date, responsible, review_done, authorized_by, notes, created_by) VALUES (?, ?, ?, ?, 1, ?, ?, ?)')
      .run(op.id, 'lista', date, payload.responsible || null, payload.authorized_by || null, payload.notes || null, user.id || null);
    action = 'Lista para entregar';
  }
  if (to === 'control' && op.status === 'lista') {
    if (!reason) throw httpError(400, 'Indica por qué vuelve a revisión');
    action = 'Devuelta a control / revisión';
  }
  if (to === 'entregada') {
    if (!payload.responsible) throw httpError(400, 'Indica quién entregó');
    const date = payload.date || todayBogota();
    await db
      .prepare('INSERT INTO production_deliveries (op_id, kind, date, responsible, received_by, notes, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(op.id, 'entregada', date, payload.responsible, payload.received_by || null, payload.notes || null, user.id || null);
    sets.delivered_at = now;
    action = `Entregada${payload.received_by ? ` a ${payload.received_by}` : ''}`;
  }
  if (to === 'cerrada') {
    sets.closed_at = now;
    action = 'OP cerrada';
  }
  if (to === 'cancelada') {
    if (!reason) throw httpError(400, 'Indica el motivo de la cancelación');
    sets.cancel_reason = reason;
    action = 'OP cancelada';
  }

  const keys = Object.keys(sets);
  await db
    .prepare(`UPDATE production_orders SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`)
    .run(...keys.map((k) => sets[k]), op.id);
  await log('op', op.id, user.id, action, reason || payload.notes || null);
  return readOp(op.id);
}

// ---- bloqueos (sección 15) ----------------------------------------------------

const PAUSABLE = ['programada', 'en_produccion', 'control'];

async function addBlock(opId, user, { reason, responsible, notes }) {
  const op = await readOp(opId);
  if (!op) throw httpError(404, 'Orden de producción no encontrada');
  if (!BLOCK_REASONS[reason]) throw httpError(400, 'Motivo de bloqueo inválido');
  if (['entregada', 'cerrada', 'cancelada'].includes(op.status)) throw httpError(409, 'La OP ya está cerrada');
  await db
    .prepare('INSERT INTO production_blocks (op_id, reason, responsible, notes, created_by) VALUES (?, ?, ?, ?, ?)')
    .run(op.id, reason, responsible || null, notes || null, user.id || null);
  let detail = [responsible ? `Responsable: ${responsible}` : '', notes || ''].filter(Boolean).join(' · ');
  if (PAUSABLE.includes(op.status)) {
    await db.prepare("UPDATE production_orders SET status = 'pausada', paused_from = ?, updated_at = datetime('now') WHERE id = ?").run(op.status, op.id);
    detail = `${detail}${detail ? ' · ' : ''}OP pausada`;
  }
  await log('op', op.id, user.id, `Bloqueo: ${BLOCK_REASONS[reason]}`, detail || null);
  return readOp(op.id);
}

async function resolveBlock(blockId, user, { resolution }) {
  const block = await db.prepare('SELECT * FROM production_blocks WHERE id = ?').get(blockId);
  if (!block) throw httpError(404, 'Bloqueo no encontrado');
  if (block.status === 'resuelto') throw httpError(409, 'El bloqueo ya estaba resuelto');
  await db
    .prepare("UPDATE production_blocks SET status = 'resuelto', resolved_by = ?, resolved_at = datetime('now'), resolution = ? WHERE id = ?")
    .run(user.id || null, resolution || null, block.id);
  const op = await db.prepare('SELECT * FROM production_orders WHERE id = ?').get(block.op_id);
  const stillActive = (await db.prepare("SELECT COUNT(*) AS c FROM production_blocks WHERE op_id = ? AND status = 'activo'").get(op.id)).c;
  let detail = resolution || null;
  if (!stillActive && op.status === 'pausada') {
    const back = op.paused_from || 'programada';
    await db.prepare("UPDATE production_orders SET status = ?, paused_from = NULL, updated_at = datetime('now') WHERE id = ?").run(back, op.id);
    detail = `${detail ? `${detail} · ` : ''}Reanudada en "${STATUS_LABEL[back]}"`;
  }
  await log('op', op.id, user.id, `Desbloqueo: ${BLOCK_REASONS[block.reason]}`, detail);
  return readOp(op.id);
}

module.exports = {
  STATUSES,
  STATUS_LABEL,
  BLOCK_REASONS,
  PRIORITIES,
  DEFAULT_TASKS,
  TRANSITIONS,
  isManager,
  httpError,
  nowUtc,
  todayBogota,
  log,
  nextOpNumber,
  nextSalesOrderNumber,
  nextRequestNumber,
  dateAlert,
  missingInfo,
  canSeeOp,
  canSeeSalesOrder,
  listOps,
  readOp,
  transition,
  addBlock,
  resolveBlock,
};
