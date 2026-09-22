const express = require('express');
const { db } = require('../db');
const { requireRole } = require('../middleware/auth');

const router = express.Router();

// Lista de precios propia de Nova (ver db.js) -- catálogo nativo para la
// pestaña "Cotizar", sin pasar por Odoo. Cualquier rol puede buscar (lo
// necesita el buscador de líneas de producto); solo admin/coordinador la
// administra (alta/edición/baja), igual criterio que Ajustes.
router.get('/', async (req, res) => {
  const { q, all } = req.query;
  const conditions = [];
  const params = [];
  if (all !== '1') {
    conditions.push('active = 1');
  }
  if (q && q.trim()) {
    conditions.push('name LIKE ?');
    params.push(`%${q.trim()}%`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = await db.prepare(`SELECT * FROM products ${where} ORDER BY name ASC`).all(...params);
  res.json(rows);
});

router.post('/', requireRole('admin', 'coordinador'), async (req, res) => {
  const { name, price, description } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'El nombre es requerido' });
  const info = await db
    .prepare('INSERT INTO products (name, price, description) VALUES (?, ?, ?)')
    .run(name.trim(), Number(price) || 0, (description && description.trim()) || null);
  res.status(201).json(await db.prepare('SELECT * FROM products WHERE id = ?').get(info.lastInsertRowid));
});

router.patch('/:id', requireRole('admin', 'coordinador'), async (req, res) => {
  const id = Number(req.params.id);
  const product = await db.prepare('SELECT * FROM products WHERE id = ?').get(id);
  if (!product) return res.status(404).json({ error: 'Producto no encontrado' });
  const { name, price, active, description } = req.body || {};
  if (name !== undefined && !name.trim()) return res.status(400).json({ error: 'El nombre no puede quedar vacío' });
  await db
    .prepare("UPDATE products SET name = ?, price = ?, active = ?, description = ?, updated_at = datetime('now') WHERE id = ?")
    .run(
      name !== undefined ? name.trim() : product.name,
      price !== undefined ? Number(price) || 0 : product.price,
      active !== undefined ? (active ? 1 : 0) : product.active,
      description !== undefined ? (description.trim() || null) : product.description,
      id
    );
  res.json(await db.prepare('SELECT * FROM products WHERE id = ?').get(id));
});

// Baja logica (active=0): las lineas de cotizaciones ya guardadas conservan
// su product_id y su nombre/precio de ese momento, asi que descontinuar un
// producto no les afecta -- solo deja de salir en el buscador para lineas
// nuevas.
router.delete('/:id', requireRole('admin', 'coordinador'), async (req, res) => {
  const id = Number(req.params.id);
  const product = await db.prepare('SELECT * FROM products WHERE id = ?').get(id);
  if (!product) return res.status(404).json({ error: 'Producto no encontrado' });
  await db.prepare("UPDATE products SET active = 0, updated_at = datetime('now') WHERE id = ?").run(id);
  res.json({ ok: true });
});

module.exports = router;
