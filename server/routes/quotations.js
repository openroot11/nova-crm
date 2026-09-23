const express = require('express');
const path = require('path');
const fs = require('fs');
const PDFDocument = require('pdfkit');
const { db, getSetting } = require('../db');
const { broadcast } = require('../realtime');
const nativeQuotes = require('../nativeQuotes');
const velaraServices = require('../velaraServices');

const LOGO_MARK_PATH = path.join(__dirname, '..', '..', 'public', 'img', 'logo-mark.png');

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

// GET /api/quotations?q=&state=&service=&advisor_id=&from=&to=
// Lista TODAS las cotizaciones nativas (no las de Odoo -- esas siguen en
// GET /api/leads/quotations, para la pantalla vieja) con filtros de
// búsqueda -- alimenta la pantalla "Cotizaciones". Un asesor solo ve las de
// sus propios leads, igual que en el resto del CRM.
router.get('/', async (req, res) => {
  const { q, state, service, advisor_id, from, to } = req.query;
  const conditions = [];
  const params = [];
  if (state) {
    conditions.push('quo.state = ?');
    params.push(state);
  }
  if (service) {
    conditions.push('quo.service_slug = ?');
    params.push(service);
  }
  if (from) {
    conditions.push('quo.date_order >= ?');
    params.push(from);
  }
  if (to) {
    conditions.push('quo.date_order <= ?');
    params.push(`${to} 23:59:59`);
  }
  if (req.user.role === 'asesor') {
    conditions.push('l.assigned_advisor_id = ?');
    params.push(req.user.advisor_id);
  } else if (advisor_id) {
    conditions.push('l.assigned_advisor_id = ?');
    params.push(Number(advisor_id));
  }
  if (q && q.trim()) {
    const like = `%${q.trim()}%`;
    conditions.push('(l.client_name LIKE ? OR l.phone LIKE ? OR l.document LIKE ? OR quo.number LIKE ?)');
    params.push(like, like, like, like);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = await db
    .prepare(
      `SELECT quo.*, l.client_name, l.phone, l.document, l.city, l.assigned_advisor_id
         FROM quotations quo
         JOIN leads l ON l.id = quo.lead_id
         ${where}
        ORDER BY quo.date_order DESC, quo.id DESC
        LIMIT 300`
    )
    .all(...params);
  const advisorsById = new Map((await db.prepare('SELECT id, name FROM advisors').all()).map((a) => [a.id, a]));
  const quotations = rows.map((r) => ({
    id: r.id,
    number: r.number,
    state: r.state,
    date_order: r.date_order,
    validity_date: r.validity_date,
    amount_total: r.amount_total,
    service_slug: r.service_slug,
    service_title: r.service_slug ? velaraServices.findService(r.service_slug)?.title || r.service_slug : null,
    lead_id: r.lead_id,
    client_name: r.client_name,
    phone: r.phone,
    city: r.city,
    advisor_name: r.assigned_advisor_id ? advisorsById.get(r.assigned_advisor_id)?.name || null : null,
  }));
  res.json({ quotations });
});

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
  const { lines, service_slug, service_fields, note } = req.body || {};
  const cleanLines = Array.isArray(lines) ? lines.filter((l) => l && l.product_name && Number(l.qty) > 0) : [];
  if (!cleanLines.length) return res.status(400).json({ error: 'Agrega al menos un producto a la cotización' });

  if (service_slug !== undefined) {
    if (service_slug) {
      const check = velaraServices.validateServiceFields(service_slug, service_fields);
      if (!check.ok) return res.status(400).json({ error: check.error });
      await db
        .prepare("UPDATE quotations SET service_slug = ?, service_fields = ?, updated_at = datetime('now') WHERE id = ?")
        .run(service_slug, Object.keys(check.fields).length ? JSON.stringify(check.fields) : null, quotation.id);
    } else {
      await db.prepare("UPDATE quotations SET service_slug = NULL, service_fields = NULL, updated_at = datetime('now') WHERE id = ?").run(quotation.id);
    }
  }
  if (note !== undefined) {
    await db.prepare("UPDATE quotations SET note = ?, updated_at = datetime('now') WHERE id = ?").run((note && note.trim()) || null, quotation.id);
  }

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

// Estados intermedios entre "Enviada" y "Aprobada": se marcan a mano, igual
// que el resto del embudo en este CRM (nada se auto-avanza solo). "En
// seguimiento" = ya se le está insistiendo al cliente; "Aprobada" = el
// cliente dio el visto bueno, falta solo convertirla en venta.
router.post('/:id/seguimiento', async (req, res) => {
  const quotation = await loadOwned(req, res);
  if (!quotation) return;
  if (quotation.state === 'sent' || quotation.state === 'draft') {
    await db.prepare("UPDATE quotations SET state = 'seguimiento', updated_at = datetime('now') WHERE id = ?").run(quotation.id);
  }
  const updated = await nativeQuotes.readQuotation(quotation.id);
  broadcast('leads_changed', { reason: 'quoted', id: quotation.lead_id });
  res.json({ quotation: updated });
});

router.post('/:id/aprobar', async (req, res) => {
  const quotation = await loadOwned(req, res);
  if (!quotation) return;
  if (quotation.state !== 'sale') {
    await db.prepare("UPDATE quotations SET state = 'aprobada', updated_at = datetime('now') WHERE id = ?").run(quotation.id);
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

// Cancela la cotización (state 'cancel') -- disponible desde cualquier
// estado salvo ya confirmada como venta.
router.post('/:id/cancel', async (req, res) => {
  const quotation = await loadOwned(req, res);
  if (!quotation) return;
  if (quotation.state === 'sale') return res.status(409).json({ error: 'Ya está confirmada como venta; no se puede cancelar' });
  await db.prepare("UPDATE quotations SET state = 'cancel', updated_at = datetime('now') WHERE id = ?").run(quotation.id);
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

// Identidad visual de Velara Taller S.A.S. (ver Velara/notas/identidad-
// visual.md -- fuente de verdad en Velara/sitio/tailwind.config.js). El
// acento naranja se usa como acento nomás (títulos pequeños, la caja del
// total, el botón de WhatsApp) -- nunca como color dominante de página,
// misma regla que en el sitio.
const INK = '#1B1B1B';
const SMOKE = '#6E6E6E';
const SMOKE_LINE = '#E2E0DB';
const ACCENT = '#FF5A1F';
const ACCENT_DEEP = '#C7420E';
const ACCENT_PALE = '#FFE7DA';
const BOX_BG = '#FAF9F7';

const PAGE_L = 50;
const PAGE_R = 562; // LETTER (612pt) - 50pt de margen a cada lado
const CONTENT_W = PAGE_R - PAGE_L;

async function quoteSettings() {
  const [name, nit, address, phone, email, payment, terms] = await Promise.all([
    getSetting('quote_company_name', 'Velara Taller S.A.S.'),
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
// ni cerrarlo -- eso lo hace quien llama). Plantilla de Velara Taller S.A.S.
// (ver Velara/notas/identidad-visual.md): wordmark + acento naranja arriba,
// título editorial, ficha de cliente/servicio/notas en 3 columnas, tabla de
// líneas, total resaltado en tono suave (nunca un bloque naranja sólido --
// "el acento nunca domina"), condiciones y CTA de WhatsApp al pie. Aparte
// del router para poder probarla desde un script suelto sin pasar por
// HTTP/auth.
function drawQuotationPdf(doc, { quotation, lead, client, advisor, cfg }) {
  const service = quotation.service_slug ? velaraServices.findService(quotation.service_slug) : null;

  // ---- encabezado: logo + wordmark + tagline -------------------------------
  const TEXT_X = PAGE_L; // se corre a la derecha del logo solo si el logo cargó
  let textX = TEXT_X;
  if (fs.existsSync(LOGO_MARK_PATH)) {
    try {
      doc.image(LOGO_MARK_PATH, PAGE_L, 40, { height: 46 });
      textX = PAGE_L + 56;
    } catch {
      /* si el logo no se puede leer, se sigue solo con el wordmark en texto */
    }
  }
  doc.font('Times-Bold').fontSize(26).fillColor(INK).text('VELARA', textX, 45);
  doc.font('Helvetica').fontSize(8).fillColor(SMOKE).text('TALLER S.A.S.', textX, 74, { characterSpacing: 1.5 });
  doc.moveTo(textX, 92).lineTo(textX + 40, 92).lineWidth(2).strokeColor(ACCENT).stroke();
  doc.font('Helvetica').fontSize(8).fillColor(SMOKE).text('TAPICERÍA QUE TE ACOMPAÑA', textX, 98, { characterSpacing: 1 });

  doc
    .font('Helvetica')
    .fontSize(8)
    .fillColor(SMOKE)
    .text('TAPICERÍA AUTOMOTRIZ Y DE MOTOS\nCARPAS Y FORROS A LA MEDIDA', 300, 55, { width: 262, align: 'right' });

  doc.moveTo(PAGE_L, 122).lineTo(PAGE_R, 122).lineWidth(1).strokeColor(SMOKE_LINE).stroke();

  // ---- título + folio -------------------------------------------------------
  const blockTop = 145;
  doc.font('Times-Bold').fontSize(28).fillColor(INK).text('Cotización', PAGE_L, blockTop);
  doc.font('Helvetica').fontSize(9).fillColor(SMOKE).text(`Gracias por confiar en ${cfg.name}`, PAGE_L, blockTop + 48);

  const metaRow = (label, value, y) => {
    doc.font('Helvetica').fontSize(8).fillColor(SMOKE).text(label, 300, y, { width: 140 });
    doc.font('Helvetica-Bold').fontSize(9).fillColor(INK).text(value || '—', 300, y, { width: 262, align: 'right' });
  };
  metaRow('N.º de cotización', quotation.number, blockTop);
  metaRow('Fecha de emisión', fmtDateDMY(quotation.date_order), blockTop + 16);
  metaRow('Válida hasta', fmtDateDMY(quotation.validity_date), blockTop + 32);

  // ---- 3 columnas: cliente / servicio / notas -------------------------------
  const colTop = blockTop + 65;
  const colW = (CONTENT_W - 32) / 3;
  const col1X = PAGE_L;
  const col2X = PAGE_L + colW + 16;
  const col3X = PAGE_L + (colW + 16) * 2;

  function columnHeading(x, text) {
    doc.font('Helvetica-Bold').fontSize(8).fillColor(ACCENT_DEEP).text(text.toUpperCase(), x, colTop, { width: colW, characterSpacing: 0.4 });
  }
  function fieldRow(x, y, label, value) {
    doc.font('Helvetica').fontSize(7.5).fillColor(SMOKE).text(label, x, y, { width: colW });
    const text = value || '—';
    doc.font('Helvetica-Bold').fontSize(9).fillColor(INK);
    const h = doc.heightOfString(text, { width: colW });
    doc.text(text, x, y + 10, { width: colW });
    return y + 10 + h + 8;
  }

  columnHeading(col1X, 'Datos del cliente');
  let y1 = colTop + 16;
  y1 = fieldRow(col1X, y1, 'Nombre', lead ? lead.client_name : client ? client.name : '—');
  if ((lead && lead.document) || (client && client.document)) y1 = fieldRow(col1X, y1, 'Documento', (lead && lead.document) || client.document);
  y1 = fieldRow(col1X, y1, 'Teléfono', (lead && lead.phone) || (client && client.phone));
  const clientEmail = (lead && lead.email) || (client && client.email);
  if (clientEmail) y1 = fieldRow(col1X, y1, 'Correo', clientEmail);
  if (lead && lead.city) y1 = fieldRow(col1X, y1, 'Ciudad', lead.city);

  columnHeading(col2X, service ? service.title : 'Detalles del servicio');
  let y2 = colTop + 16;
  if (service && quotation.service_fields && Object.keys(quotation.service_fields).length) {
    for (const f of service.fields) {
      const value = quotation.service_fields[f.key];
      if (value) y2 = fieldRow(col2X, y2, f.label, value);
    }
  } else {
    doc.font('Helvetica').fontSize(9).fillColor(SMOKE).text('Sin detalles adicionales del servicio.', col2X, y2, { width: colW });
  }

  columnHeading(col3X, 'Información adicional');
  let y3 = colTop + 16;
  y3 = fieldRow(col3X, y3, 'Servicio', service ? service.title : lead ? lead.product : '—');
  const notes = quotation.note || (lead && lead.notes);
  if (notes) {
    doc.font('Helvetica').fontSize(7.5).fillColor(SMOKE).text('Observaciones', col3X, y3, { width: colW });
    doc.font('Helvetica').fontSize(8.5).fillColor(INK).text(notes, col3X, y3 + 10, { width: colW });
    y3 += 10 + doc.heightOfString(notes, { width: colW }) + 10;
  }

  // ---- tabla de lineas -------------------------------------------------------
  const cols = {
    desc: { x: PAGE_L + 5, w: 215 },
    qty: { x: PAGE_L + 225, w: 60 },
    price: { x: PAGE_L + 290, w: 95 },
    tax: { x: PAGE_L + 390, w: 50 },
    total: { x: PAGE_L + 445, w: 62 },
  };
  let y = Math.max(y1, y2, y3) + 12;
  const tableHeader = () => {
    doc.rect(PAGE_L, y, CONTENT_W, 20).fill(BOX_BG);
    doc.font('Helvetica-Bold').fontSize(8).fillColor(INK);
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
    doc.font('Helvetica-Bold').fontSize(9).fillColor(INK).text(l.product_name, cols.desc.x, y + 5, { width: cols.desc.w });
    if (l.description) {
      doc.font('Helvetica').fontSize(8).fillColor(SMOKE).text(l.description, cols.desc.x, y + 5 + nameHeight + 2, { width: cols.desc.w });
    }
    doc.font('Helvetica').fontSize(9).fillColor(INK).text(`${l.qty} Unidades`, cols.qty.x, y + 5, { width: cols.qty.w, align: 'right' });
    doc.text(money(l.price_unit), cols.price.x, y + 5, { width: cols.price.w, align: 'right' });
    if (l.discount_percent > 0) {
      doc.fontSize(7).fillColor(ACCENT_DEEP).text(`− ${l.discount_percent}%`, cols.price.x, y + 16, { width: cols.price.w, align: 'right' });
    }
    doc.fontSize(9).fillColor(SMOKE).text('19%', cols.tax.x, y + 5, { width: cols.tax.w, align: 'center' });
    doc.fillColor(INK).text(money(l.subtotal), cols.total.x, y + 5, { width: cols.total.w, align: 'right' });
    y += rowH;
    doc.moveTo(PAGE_L, y).lineTo(PAGE_R, y).lineWidth(0.5).strokeColor(SMOKE_LINE).stroke();
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
  doc.font('Helvetica').fontSize(9).fillColor(SMOKE).text('Subtotal', totLabelX, y, { width: totLabelW });
  doc.fillColor(INK).text(money(quotation.amount_untaxed), totValX, y, { width: totValW, align: 'right' });
  y += 16;
  doc.fillColor(SMOKE).text('IVA 19%', totLabelX, y, { width: totLabelW });
  doc.fillColor(INK).text(money(quotation.amount_tax), totValX, y, { width: totValW, align: 'right' });
  y += 18;
  doc.rect(totLabelX - 10, y - 4, PAGE_R - (totLabelX - 10), 26).fill(ACCENT_PALE);
  doc.font('Helvetica-Bold').fontSize(12).fillColor(INK).text('Total', totLabelX, y + 4, { width: totLabelW });
  doc.text(money(quotation.amount_total), totValX, y + 4, { width: totValW, align: 'right' });
  y += 40;

  // ---- condiciones y notas (izq.) + CTA de WhatsApp (der.) -------------------
  const termLines = (cfg.terms || '').split('\n').filter(Boolean);
  const halfW = (CONTENT_W - 24) / 2;
  const ctaX = PAGE_L + halfW + 24;
  const sectionTop = y;
  if (termLines.length) {
    if (sectionTop > 620) {
      doc.addPage();
      y = 50;
    }
    doc.font('Helvetica-Bold').fontSize(9).fillColor(ACCENT_DEEP).text('CONDICIONES Y NOTAS', PAGE_L, y);
    y += 14;
    doc.font('Helvetica').fontSize(7.5).fillColor(SMOKE);
    termLines.forEach((line) => {
      const h = doc.heightOfString(`•  ${line}`, { width: halfW });
      doc.text(`•  ${line}`, PAGE_L, y, { width: halfW });
      y += h + 2;
    });
  }

  if (cfg.phone) {
    doc.font('Helvetica-Bold').fontSize(9).fillColor(ACCENT_DEEP).text('¿LISTO PARA CONTINUAR?', ctaX, sectionTop, { width: halfW });
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor(SMOKE)
      .text('Para confirmar, resolver dudas o ajustar la cotización, escríbanos directamente por WhatsApp.', ctaX, sectionTop + 14, {
        width: halfW,
      });
    const btnY = sectionTop + 48;
    doc.roundedRect(ctaX, btnY, halfW, 26, 4).fill(ACCENT);
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#FFFFFF').text(`Cotizar por WhatsApp   ${cfg.phone}`, ctaX, btnY + 8, { width: halfW, align: 'center' });
    y = Math.max(y, btnY + 26 + 10);
  }

  // ---- datos de pago (caja clara), si hay algo puesto en Ajustes -------------
  const paymentLines = (cfg.payment || '').split('\n').filter(Boolean);
  if (paymentLines.length) {
    y += 15;
    const boxH = 18 + paymentLines.length * 13;
    if (y + boxH > 730) {
      doc.addPage();
      y = 50;
    }
    doc.rect(PAGE_L, y, CONTENT_W, boxH).fill(BOX_BG);
    doc.font('Helvetica-Bold').fontSize(9).fillColor(INK).text('DETALLES DE PAGO:', PAGE_L + 10, y + 8);
    doc.font('Helvetica').fontSize(8).fillColor(SMOKE);
    let py = y + 22;
    paymentLines.forEach((line) => {
      doc.text(line, PAGE_L + 10, py, { width: CONTENT_W - 20 });
      py += 13;
    });
    y += boxH + 15;
  }

  // ---- pie de página: contacto + empresa -------------------------------------
  let footerY = y + 20;
  if (footerY > 700) {
    doc.addPage();
    footerY = 50;
  }
  doc.moveTo(PAGE_L, footerY).lineTo(PAGE_R, footerY).lineWidth(1.5).strokeColor(ACCENT).stroke();
  doc
    .font('Helvetica')
    .fontSize(7.5)
    .fillColor(SMOKE)
    .text([cfg.phone, cfg.email, cfg.address].filter(Boolean).join('   ·   '), PAGE_L, footerY + 8, { width: CONTENT_W - 180 });
  doc
    .font('Helvetica-Bold')
    .fontSize(7.5)
    .fillColor(INK)
    .text([cfg.name, cfg.nit ? `NIT. ${cfg.nit}` : null].filter(Boolean).join('   ·   '), PAGE_L, footerY + 8, { width: CONTENT_W, align: 'right' });
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
