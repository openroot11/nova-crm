const express = require('express');
const { db } = require('../db');

const router = express.Router();

// Un asesor solo ve clientes con al menos un lead suyo -- mismo criterio de
// alcance que ya usa GET /api/leads para el rol asesor.
async function scopedClientIds(user) {
  if (user.role !== 'asesor') return null; // null = sin restriccion
  const rows = await db.prepare('SELECT DISTINCT client_id FROM leads WHERE assigned_advisor_id = ? AND client_id IS NOT NULL').all(user.advisor_id);
  return new Set(rows.map((r) => r.client_id));
}

async function withAggregates(client) {
  const leads = await db.prepare('SELECT id, status, amount FROM leads WHERE client_id = ?').all(client.id);
  const wonLeadIds = leads.filter((l) => l.status === 'cerrado_ganado').map((l) => l.id);
  const total_comprado = leads.filter((l) => l.status === 'cerrado_ganado').reduce((s, l) => s + (l.amount || 0), 0);
  const total_abonado = wonLeadIds.length
    ? (
        await db
          .prepare(`SELECT COALESCE(SUM(amount), 0) AS s FROM payments WHERE lead_id IN (${wonLeadIds.map(() => '?').join(',')})`)
          .get(...wonLeadIds)
      ).s
    : 0;
  return {
    ...client,
    lead_count: leads.length,
    total_comprado,
    total_abonado,
    saldo_pendiente: total_comprado - total_abonado,
  };
}

// Misma agregacion que withAggregates(), pero para TODA una lista de
// clientes en 2 consultas (una de leads, una de payments) en vez de 2 por
// cliente -- con miles de clientes, Promise.all(clients.map(withAggregates))
// pide miles de conexiones simultaneas al pool de Postgres (10 por defecto)
// y el resto de la app empieza a fallar con "timeout exceeded when trying
// to connect". Usado solo en GET '/' (la lista); GET '/:id' sigue usando
// withAggregates() de a uno, que para un solo cliente no tiene ese problema.
async function withAggregatesForList(clients) {
  if (clients.length === 0) return [];
  const clientIds = clients.map((c) => c.id);
  const leadRows = await db
    .prepare(`SELECT id, client_id, status, amount FROM leads WHERE client_id IN (${clientIds.map(() => '?').join(',')})`)
    .all(...clientIds);

  const leadsByClient = new Map();
  for (const l of leadRows) {
    if (!leadsByClient.has(l.client_id)) leadsByClient.set(l.client_id, []);
    leadsByClient.get(l.client_id).push(l);
  }

  const wonLeadIds = leadRows.filter((l) => l.status === 'cerrado_ganado').map((l) => l.id);
  const paidByLead = new Map();
  if (wonLeadIds.length) {
    const paymentRows = await db
      .prepare(`SELECT lead_id, COALESCE(SUM(amount), 0) AS s FROM payments WHERE lead_id IN (${wonLeadIds.map(() => '?').join(',')}) GROUP BY lead_id`)
      .all(...wonLeadIds);
    paymentRows.forEach((r) => paidByLead.set(r.lead_id, r.s));
  }

  return clients.map((client) => {
    const leads = leadsByClient.get(client.id) || [];
    const wonLeads = leads.filter((l) => l.status === 'cerrado_ganado');
    const total_comprado = wonLeads.reduce((s, l) => s + (l.amount || 0), 0);
    const total_abonado = wonLeads.reduce((s, l) => s + (paidByLead.get(l.id) || 0), 0);
    return {
      ...client,
      lead_count: leads.length,
      total_comprado,
      total_abonado,
      saldo_pendiente: total_comprado - total_abonado,
    };
  });
}

async function findClientByValue(field, value, excludeId = null) {
  if (!value) return null;
  const query = `SELECT * FROM clients WHERE ${field} = ?${excludeId ? ' AND id != ?' : ''} LIMIT 1`;
  const params = excludeId ? [value.trim(), excludeId] : [value.trim()];
  return db.prepare(query).get(...params);
}

router.get('/', async (req, res) => {
  const { q, advisor_id, product, balance, purchases, from, to } = req.query;
  const scoped = await scopedClientIds(req.user);
  let clients = await db.prepare('SELECT * FROM clients ORDER BY name ASC').all();
  if (scoped) clients = clients.filter((c) => scoped.has(c.id));
  if (q && q.trim()) {
    const term = q.trim().toLowerCase();
    clients = clients.filter(
      (c) => (c.name || '').toLowerCase().includes(term) || (c.phone || '').toLowerCase().includes(term) || (c.document || '').toLowerCase().includes(term)
    );
  }
  // Rango sobre la fecha de registro del cliente (created_at de clients, no
  // de sus leads) -- "cuando entro a la base", igual criterio que from/to en
  // el resto de la app.
  if (from) clients = clients.filter((c) => c.created_at >= `${from} 00:00:00`);
  if (to) clients = clients.filter((c) => c.created_at <= `${to} 23:59:59`);

  let result = await withAggregatesForList(clients);

  // Asesor/producto no viven en clients directamente (son de sus leads), asi
  // que se filtran por quien tiene al menos un lead que cumpla, igual
  // criterio que ya usa scopedClientIds arriba.
  if (advisor_id) {
    const ids = new Set(
      (await db
        .prepare('SELECT DISTINCT client_id FROM leads WHERE assigned_advisor_id = ? AND client_id IS NOT NULL')
        .all(Number(advisor_id))
      ).map((r) => r.client_id)
    );
    result = result.filter((c) => ids.has(c.id));
  }
  if (product) {
    const ids = new Set(
      (await db.prepare('SELECT DISTINCT client_id FROM leads WHERE product = ? AND client_id IS NOT NULL').all(product)).map((r) => r.client_id)
    );
    result = result.filter((c) => ids.has(c.id));
  }
  if (balance === 'pending') result = result.filter((c) => c.saldo_pendiente > 0);
  if (balance === 'none') result = result.filter((c) => c.saldo_pendiente <= 0);
  if (purchases === 'with') result = result.filter((c) => c.total_comprado > 0);
  if (purchases === 'without') result = result.filter((c) => c.total_comprado === 0);

  res.json(result);
});

router.get('/:id', async (req, res) => {
  const id = Number(req.params.id);
  const client = await db.prepare('SELECT * FROM clients WHERE id = ?').get(id);
  if (!client) return res.status(404).json({ error: 'Cliente no encontrado' });
  const scoped = await scopedClientIds(req.user);
  if (scoped && !scoped.has(id)) return res.status(403).json({ error: 'No tienes permiso para ver este cliente' });

  const leads = await db
    .prepare(
      `SELECT l.*, a.name AS advisor_name FROM leads l
       LEFT JOIN advisors a ON a.id = l.assigned_advisor_id
       WHERE l.client_id = ? ORDER BY l.created_at DESC`
    )
    .all(id);
  const leadIds = leads.map((l) => l.id);
  const payments = leadIds.length
    ? await db
        .prepare(`SELECT * FROM payments WHERE lead_id IN (${leadIds.map(() => '?').join(',')}) ORDER BY paid_at DESC`)
        .all(...leadIds)
    : [];

  res.json({ ...(await withAggregates(client)), leads, payments });
});

router.post('/', async (req, res) => {
  const { name, phone, document, notes } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'El nombre es requerido' });
  const duplicateDoc = document && (await findClientByValue('document', document));
  if (duplicateDoc) return res.status(409).json({ error: 'Ya existe un cliente con ese documento' });
  const duplicatePhone = phone && (await findClientByValue('phone', phone));
  if (duplicatePhone) return res.status(409).json({ error: 'Ya existe un cliente con ese teléfono' });

  const info = await db
    .prepare('INSERT INTO clients (name, phone, document, notes) VALUES (?, ?, ?, ?)')
    .run(name.trim(), (phone && phone.trim()) || null, (document && document.trim()) || null, (notes && notes.trim()) || null);
  const client = await db.prepare('SELECT * FROM clients WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(await withAggregates(client));
});

router.patch('/:id', async (req, res) => {
  const id = Number(req.params.id);
  const client = await db.prepare('SELECT * FROM clients WHERE id = ?').get(id);
  if (!client) return res.status(404).json({ error: 'Cliente no encontrado' });
  const { name, phone, document, notes } = req.body || {};
  if (name !== undefined && !name.trim()) return res.status(400).json({ error: 'El nombre no puede quedar vacío' });
  const targetDoc = document !== undefined ? (document.trim() || null) : client.document;
  const targetPhone = phone !== undefined ? (phone.trim() || null) : client.phone;
  if (targetDoc && (await findClientByValue('document', targetDoc, id))) return res.status(409).json({ error: 'Ya existe otro cliente con ese documento' });
  if (targetPhone && (await findClientByValue('phone', targetPhone, id))) return res.status(409).json({ error: 'Ya existe otro cliente con ese teléfono' });

  await db
    .prepare('UPDATE clients SET name = ?, phone = ?, document = ?, notes = ? WHERE id = ?')
    .run(
      name !== undefined ? name.trim() : client.name,
      phone !== undefined ? (phone.trim() || null) : client.phone,
      document !== undefined ? (document.trim() || null) : client.document,
      notes !== undefined ? (notes.trim() || null) : client.notes,
      id
    );
  res.json(await withAggregates(await db.prepare('SELECT * FROM clients WHERE id = ?').get(id)));
});

module.exports = router;
