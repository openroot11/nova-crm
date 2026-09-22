const express = require('express');
const path = require('path');
const fs = require('fs');
const PDFDocument = require('pdfkit');
const { db, getSetting } = require('../db');
const { broadcast } = require('../realtime');
const nativeQuotes = require('../nativeQuotes');

const router = express.Router();

const money = (n) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(Number(n) || 0);

// DD-MM-AAAA, igual que la plantilla de Odoo que se usaba antes (ver un
// Cotización_S0....pdf viejo del proyecto).
function fmtDateDMY(value) {
  const iso = String(value || '').slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : '—';
}

async function loadOwned(req, res) {
  const id = Number(req.params.id);
  const quotation = await nativeQuotes.readQuotation(id);
  if (!quotation) {
    res.status(404).json({ error: 'Cotización no encontrada' });
    return null;
  }
  if (!(await nativeQuotes.canAccessQuotation(req.user, quotation))) {
    res.status(403).json({ error: 'No tienes permiso sobre esta cotización' });
    return null;
  }
  return quotation;
}

router.get('/:id', async (req, res) => {
  const quotation = await loadOwned(req, res);
  if (!quotation) return;
  res.json({ quotation });
});

// Reescribe las lineas de un borrador (una cotizacion ya enviada o
// confirmada no se toca aqui -- mismo criterio que el flujo de Odoo).
router.put('/:id', async (req, res) => {
  const quotation = await loadOwned(req, res);
  if (!quotation) return;
  if (quotation.state !== 'draft' && quotation.state !== 'sent') {
    return res.status(409).json({ error: 'Esta cotización ya está confirmada; no se pueden cambiar sus líneas' });
  }
  const { lines } = req.body || {};
  const cleanLines = Array.isArray(lines) ? lines.filter((l) => l && l.product_name && Number(l.qty) > 0) : [];
  if (!cleanLines.length) return res.status(400).json({ error: 'Agrega al menos un producto a la cotización' });

  await nativeQuotes.writeLines(quotation.id, cleanLines);
  const updated = await nativeQuotes.readQuotation(quotation.id);
  broadcast('leads_changed', { reason: 'quoted', id: quotation.lead_id });
  res.json({ quotation: updated });
});

router.post('/:id/send', async (req, res) => {
  const quotation = await loadOwned(req, res);
  if (!quotation) return;
  if (quotation.state === 'draft') {
    await db.prepare("UPDATE quotations SET state = 'sent', updated_at = datetime('now') WHERE id = ?").run(quotation.id);
  }
  const updated = await nativeQuotes.readQuotation(quotation.id);
  broadcast('leads_changed', { reason: 'quoted', id: quotation.lead_id });
  res.json({ quotation: updated });
});

// La confirma como "Pedido de venta" (state 'sale'). El cierre real del lead
// (ganado/perdido, monto, fecha) sigue pasando por POST /api/leads/:id/close
// -- el frontend llama a los dos: primero cierra el lead, y si quedó
// "ganado" llama esto para que la cotización quede marcada como confirmada.
router.post('/:id/confirm', async (req, res) => {
  const quotation = await loadOwned(req, res);
  if (!quotation) return;
  if (quotation.state !== 'sale') {
    await db.prepare("UPDATE quotations SET state = 'sale', updated_at = datetime('now') WHERE id = ?").run(quotation.id);
  }
  const updated = await nativeQuotes.readQuotation(quotation.id);
  broadcast('leads_changed', { reason: 'quoted', id: quotation.lead_id });
  res.json({ quotation: updated });
});

// "Clonar" (como el botón Clone de Salesforce): arma una cotización nueva en
// borrador para el mismo lead, copiando las líneas de esta -- útil para
// hacer una revisión sin perder ni tocar la original.
router.post('/:id/duplicate', async (req, res) => {
  const quotation = await loadOwned(req, res);
  if (!quotation) return;
  const copy = await nativeQuotes.duplicateQuotation(quotation.id, req.user.id);
  broadcast('leads_changed', { reason: 'quoted', id: quotation.lead_id });
  res.status(201).json({ quotation: copy });
});

// Mismos colores de marca que ya usa el resto de Nova CRM (ver
// public/index.html -> tailwind.config -> colors: primary/on-surface/
// on-surface-variant/outline-variant/surface-container-low).
const RED = '#981b1e';
const DARK = '#191717';
const GRAY = '#5b5959';
const BORDER = '#dbdcdd';
const BOX_BG = '#f1f0f0';

const PAGE_L = 50;
const PAGE_R = 562; // LETTER (612pt) - 50pt de margen a cada lado
const CONTENT_W = PAGE_R - PAGE_L;

async function quoteSettings() {
  const [name, nit, address, phone, email, payment, terms] = await Promise.all([
    getSetting('quote_company_name', 'Manufacturas y Diseños Nova S.A.S.'),
    getSetting('quote_company_nit', ''),
    getSetting('quote_company_address', ''),
    getSetting('quote_company_phone', ''),
    getSetting('quote_company_email', ''),
    getSetting('quote_payment_details', ''),
    getSetting('quote_terms', ''),
  ]);
  return { name, nit, address, phone, email, payment, terms };
}

// Dibuja la cotización completa sobre un PDFDocument ya creado (sin abrirlo
// ni cerrarlo -- eso lo hace quien llama). Misma plantilla que ya usaba Nova
// con Odoo (logo + datos de la empresa arriba, ficha del cliente + folio a
// la derecha, tabla de líneas con encabezado rojo, totales con el total
// resaltado, caja de datos de pago y políticas al pie) -- ver un
// Cotización_S0....pdf viejo del proyecto como referencia. Aparte del router
// para poder probarla desde un script suelto sin pasar por HTTP/auth.
function drawQuotationPdf(doc, { quotation, lead, client, advisor, cfg }) {
  // ---- encabezado: logo + datos de la empresa -----------------------------
  const logoPath = path.join(__dirname, '..', '..', 'public', 'img', 'logo.png');
  if (fs.existsSync(logoPath)) {
    try {
      doc.image(logoPath, PAGE_L, 45, { width: 90 });
    } catch {
      /* si el logo no se puede leer, se sigue sin el */
    }
  }
  doc.font('Helvetica-Bold').fontSize(11).fillColor(DARK).text(cfg.name, 300, 48, { width: 262, align: 'right' });
  doc.font('Helvetica').fontSize(9).fillColor(GRAY);
  let hy = 62;
  [cfg.nit ? `NIT: ${cfg.nit}` : '', cfg.address, cfg.phone, cfg.email].filter(Boolean).forEach((line) => {
    doc.text(line, 300, hy, { width: 262, align: 'right' });
    hy += 12;
  });

  doc.moveTo(PAGE_L, 130).lineTo(PAGE_R, 130).lineWidth(2).strokeColor(RED).stroke();

  // ---- ficha del cliente (izq.) + folio de la cotizacion (der.) -----------
  const blockTop = 150;
  doc.rect(PAGE_L, blockTop, 3, 62).fill(RED);
  doc.font('Helvetica-Bold').fontSize(8).fillColor(RED).text('INFORMACIÓN DEL CLIENTE', PAGE_L + 10, blockTop);
  doc
    .font('Helvetica-Bold')
    .fontSize(12)
    .fillColor(DARK)
    .text(lead ? lead.client_name : '—', PAGE_L + 10, blockTop + 13, { width: 240 });
  doc.font('Helvetica').fontSize(9).fillColor(GRAY);
  let cy = blockTop + 30;
  if (lead && lead.document) {
    doc.text(`NIT/CC: ${lead.document}`, PAGE_L + 10, cy, { width: 240 });
    cy += 12;
  }
  const address = (lead && lead.address) || (client && client.address);
  if (address) {
    doc.text(`Dirección: ${address}`, PAGE_L + 10, cy, { width: 240 });
    cy += 12;
  }
  if (lead && lead.city) {
    doc.text(`Ciudad: ${lead.city}`, PAGE_L + 10, cy, { width: 240 });
    cy += 12;
  }
  const email = (lead && lead.email) || (client && client.email);
  if (email) {
    doc.text(email, PAGE_L + 10, cy, { width: 240 });
  }

  doc.font('Helvetica-Bold').fontSize(20).fillColor(RED).text('COTIZACIÓN', 300, blockTop, { width: 262, align: 'right' });
  doc
    .font('Helvetica-Bold')
    .fontSize(12)
    .fillColor(DARK)
    .text(`No. ${quotation.number || '—'}`, 300, blockTop + 26, { width: 262, align: 'right' });

  // ---- fila de metadatos: fecha / vencimiento / vendedor -------------------
  const metaTop = 232;
  const metaCol = (label, value, x) => {
    doc.font('Helvetica-Bold').fontSize(8).fillColor(GRAY).text(label, x, metaTop, { width: 160 });
    doc.font('Helvetica').fontSize(9).fillColor(DARK).text(value || '—', x, metaTop + 12, { width: 160 });
  };
  metaCol('FECHA DE COTIZACIÓN', fmtDateDMY(quotation.date_order), PAGE_L);
  metaCol('VENCIMIENTO', fmtDateDMY(quotation.validity_date), PAGE_L + 170);
  metaCol('VENDEDOR', advisor ? advisor.name : 'Sin asignar', PAGE_L + 340);

  // ---- tabla de lineas -------------------------------------------------------
  const cols = {
    desc: { x: PAGE_L + 5, w: 215 },
    qty: { x: PAGE_L + 225, w: 60 },
    price: { x: PAGE_L + 290, w: 95 },
    tax: { x: PAGE_L + 390, w: 50 },
    total: { x: PAGE_L + 445, w: 62 },
  };
  let y = 280;
  const tableHeader = () => {
    doc.rect(PAGE_L, y, CONTENT_W, 20).fill(RED);
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#ffffff');
    doc.text('DESCRIPCIÓN', cols.desc.x, y + 6, { width: cols.desc.w });
    doc.text('CANTIDAD', cols.qty.x, y + 6, { width: cols.qty.w, align: 'right' });
    doc.text('PRECIO UNITARIO', cols.price.x, y + 6, { width: cols.price.w, align: 'right' });
    doc.text('IMPUESTOS', cols.tax.x, y + 6, { width: cols.tax.w, align: 'center' });
    doc.text('IMPORTE', cols.total.x, y + 6, { width: cols.total.w, align: 'right' });
    y += 20;
  };
  tableHeader();

  quotation.lines.forEach((l) => {
    const nameHeight = doc.font('Helvetica-Bold').fontSize(9).heightOfString(l.product_name, { width: cols.desc.w });
    const descHeight = l.description ? doc.font('Helvetica').fontSize(8).heightOfString(l.description, { width: cols.desc.w }) + 3 : 0;
    const rowH = Math.max(nameHeight + descHeight, 12) + 10;
    if (y + rowH > 720) {
      doc.addPage();
      y = 50;
      tableHeader();
    }
    doc.font('Helvetica-Bold').fontSize(9).fillColor(DARK).text(l.product_name, cols.desc.x, y + 5, { width: cols.desc.w });
    if (l.description) {
      doc.font('Helvetica').fontSize(8).fillColor(GRAY).text(l.description, cols.desc.x, y + 5 + nameHeight + 2, { width: cols.desc.w });
    }
    doc.font('Helvetica').fontSize(9).fillColor(DARK).text(`${l.qty} Unidades`, cols.qty.x, y + 5, { width: cols.qty.w, align: 'right' });
    doc.text(money(l.price_unit), cols.price.x, y + 5, { width: cols.price.w, align: 'right' });
    if (l.discount_percent > 0) {
      doc.fontSize(7).fillColor(RED).text(`− ${l.discount_percent}%`, cols.price.x, y + 16, { width: cols.price.w, align: 'right' });
    }
    doc.fontSize(9).fillColor(GRAY).text('19%', cols.tax.x, y + 5, { width: cols.tax.w, align: 'center' });
    doc.fillColor(DARK).text(money(l.subtotal), cols.total.x, y + 5, { width: cols.total.w, align: 'right' });
    y += rowH;
    doc.moveTo(PAGE_L, y).lineTo(PAGE_R, y).lineWidth(0.5).strokeColor(BORDER).stroke();
  });

  // ---- totales ----------------------------------------------------------------
  y += 15;
  if (y > 700) {
    doc.addPage();
    y = 50;
  }
  const totLabelX = PAGE_L + 300;
  const totLabelW = 100;
  const totValX = PAGE_L + 400;
  const totValW = 112;
  doc.font('Helvetica').fontSize(9).fillColor(GRAY).text('Subtotal', totLabelX, y, { width: totLabelW });
  doc.fillColor(DARK).text(money(quotation.amount_untaxed), totValX, y, { width: totValW, align: 'right' });
  y += 16;
  doc.fillColor(GRAY).text('IVA 19%', totLabelX, y, { width: totLabelW });
  doc.fillColor(DARK).text(money(quotation.amount_tax), totValX, y, { width: totValW, align: 'right' });
  y += 18;
  doc.rect(totLabelX - 5, y - 3, PAGE_R - (totLabelX - 5), 22).fill(RED);
  doc.font('Helvetica-Bold').fontSize(11).fillColor('#ffffff').text('Total', totLabelX, y + 3, { width: totLabelW });
  doc.text(money(quotation.amount_total), totValX, y + 3, { width: totValW, align: 'right' });
  y += 35;

  // ---- notas de esta cotizacion (si el asesor escribio alguna) ---------------
  if (quotation.note) {
    doc.font('Helvetica-Bold').fontSize(8).fillColor(GRAY).text('NOTAS', PAGE_L, y);
    y += 12;
    doc.font('Helvetica').fontSize(9).fillColor(DARK).text(quotation.note, PAGE_L, y, { width: CONTENT_W });
    y += doc.heightOfString(quotation.note, { width: CONTENT_W }) + 20;
  }

  // ---- datos de pago (caja gris) -----------------------------------------------
  const paymentLines = (cfg.payment || '').split('\n').filter(Boolean);
  if (paymentLines.length) {
    const boxH = 18 + paymentLines.length * 13;
    if (y + boxH > 730) {
      doc.addPage();
      y = 50;
    }
    doc.rect(PAGE_L, y, CONTENT_W, boxH).fill(BOX_BG);
    doc.font('Helvetica-Bold').fontSize(9).fillColor(DARK).text('DETALLES DE PAGO:', PAGE_L + 10, y + 8);
    doc.font('Helvetica').fontSize(8).fillColor(GRAY);
    let py = y + 22;
    paymentLines.forEach((line) => {
      doc.text(line, PAGE_L + 10, py, { width: CONTENT_W - 20 });
      py += 13;
    });
    y += boxH + 20;
  }

  // ---- politicas y condiciones (pie) -------------------------------------------
  const termLines = (cfg.terms || '').split('\n').filter(Boolean);
  if (termLines.length) {
    if (y > 650) {
      doc.addPage();
      y = 50;
    }
    doc.font('Helvetica-Bold').fontSize(9).fillColor(RED).text('POLÍTICAS Y CONDICIONES', PAGE_L, y);
    y += 14;
    doc.font('Helvetica').fontSize(7).fillColor(GRAY);
    termLines.forEach((line) => {
      const h = doc.heightOfString(`•  ${line}`, { width: CONTENT_W });
      doc.text(`•  ${line}`, PAGE_L, y, { width: CONTENT_W });
      y += h + 2;
    });
  }
}

router.get('/:id/pdf', async (req, res) => {
  const quotation = await loadOwned(req, res);
  if (!quotation) return;
  const lead = await db.prepare('SELECT * FROM leads WHERE id = ?').get(quotation.lead_id);
  const client = lead && lead.client_id ? await db.prepare('SELECT * FROM clients WHERE id = ?').get(lead.client_id) : null;
  const advisor =
    lead && lead.assigned_advisor_id ? await db.prepare('SELECT name FROM advisors WHERE id = ?').get(lead.assigned_advisor_id) : null;
  const cfg = await quoteSettings();

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${quotation.number || 'cotizacion'}.pdf"`);

  const doc = new PDFDocument({ size: 'LETTER', margin: 50 });
  doc.pipe(res);
  drawQuotationPdf(doc, { quotation, lead, client, advisor, cfg });
  doc.end();
});

module.exports = router;
module.exports.drawQuotationPdf = drawQuotationPdf;
module.exports.quoteSettings = quoteSettings;
