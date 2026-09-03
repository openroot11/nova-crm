const express = require('express');
const odoo = require('../odoo');
const odooSync = require('../odoo-sync');
const { requireRole } = require('../middleware/auth');

const router = express.Router();

// Estado de la conexion con Odoo -- lo usa el frontend para mostrar/ocultar
// los botones de cotizacion y avisar si no esta configurado.
router.get('/status', async (req, res) => {
  if (!odoo.isEnabled()) {
    return res.json({ enabled: false, reason: 'no_configurado' });
  }
  try {
    const info = await odoo.ping();
    res.json({ ...info, ok: true });
  } catch (err) {
    res.json({ enabled: true, ok: false, error: err.message });
  }
});

// Catalogo de productos de Odoo para armar las lineas de una cotizacion.
router.get('/products', async (req, res) => {
  if (!odoo.isEnabled()) return res.status(409).json({ error: 'Odoo no configurado' });
  try {
    const products = await odoo.listProducts(req.query.q || '');
    res.json(
      products.map((p) => ({
        id: p.id,
        name: p.display_name,
        code: p.default_code || null,
        price: p.list_price || 0,
        uom: Array.isArray(p.uom_id) ? p.uom_id[1] : null,
      }))
    );
  } catch (err) {
    res.status(502).json({ error: `Odoo: ${err.message}` });
  }
});

// Etapas del pipeline de Odoo + qué nombre espera Nova CRM para cada paso del
// embudo. Sirve para revisar en Ajustes que el mapeo esté bien (sobre todo al
// apuntar a un Odoo nuevo con nombres distintos).
router.get('/stages', async (req, res) => {
  if (!odoo.isEnabled()) return res.status(409).json({ error: 'Odoo no configurado' });
  try {
    const stages = await odoo.callKw('crm.stage', 'search_read', [[]], {
      fields: ['name', 'sequence', 'is_won'],
      order: 'sequence',
    });
    const names = odoo.stageNames();
    const norm = (s) => String(s || '').trim().toLowerCase();
    const known = new Set([names.assigned, names.contacted, names.quoted, names.won].map(norm));
    res.json({
      expected: names,
      stages: stages.map((s) => ({
        name: s.name,
        is_won: s.is_won,
        maps_to: s.is_won
          ? 'ganado'
          : norm(s.name) === norm(names.quoted)
          ? 'cotizado'
          : norm(s.name) === norm(names.contacted)
          ? 'contactado'
          : norm(s.name) === norm(names.assigned)
          ? 'asignado'
          : null,
      })),
      // true si el CRM reconoce al menos "contactado" y "cotizado" en el pipeline
      mapping_ok: [names.contacted, names.quoted].every((n) => stages.some((s) => norm(s.name) === norm(n))),
      unknown_present: stages.some((s) => !s.is_won && !known.has(norm(s.name))),
    });
  } catch (err) {
    res.status(502).json({ error: `Odoo: ${err.message}` });
  }
});

// Forzar una pasada de sincronización Odoo -> CRM ahora mismo (además de la
// automática cada ~30s). Lo usa el botón "Sincronizar estados" de Ajustes.
router.post('/sync', requireRole('admin', 'coordinador'), async (req, res) => {
  if (!odoo.isEnabled()) return res.status(409).json({ error: 'Odoo no configurado' });
  const result = await odooSync.syncOnce();
  res.json(result);
});

module.exports = router;
