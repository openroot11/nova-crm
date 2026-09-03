const express = require('express');
const odoo = require('../odoo');

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

module.exports = router;
