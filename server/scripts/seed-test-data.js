// Llena el CRM con datos de PRUEBA coherentes (clientes, leads, ventas,
// pagos, reasignaciones, seguimiento, inversión en ads e informe de
// canales) para poder probar Ventas, SLA, Seguimiento Activo, Estadísticas,
// Informe y Cotizar sin depender de datos reales.
//
// Uso:  node scripts/seed-test-data.js
//
// Se detiene solo si ya hay leads en la base (para no mezclar datos de
// prueba con datos reales por accidente) -- si de verdad quieres reemplazar
// datos de prueba anteriores, borra la base o usa Ajustes -> Restaurar de
// fábrica primero.
//
// No pasa por la API HTTP (inserta directo en SQLite): es más rápido, pero
// no manda eventos de tiempo real -- si el servidor ya está corriendo,
// recarga la página después de correr esto.

const { db, setSetting, init } = require('../db');
const { SERVICES, findService } = require('../velaraServices');

function pad(n) {
  return String(n).padStart(2, '0');
}
function fmt(date) {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
}
function addMinutes(date, mins) {
  return new Date(date.getTime() + mins * 60000);
}
function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function pick(arr) {
  return arr[randInt(0, arr.length - 1)];
}
function weightedPick(pairs) {
  const total = pairs.reduce((s, [, w]) => s + w, 0);
  let r = Math.random() * total;
  for (const [item, w] of pairs) {
    if (r < w) return item;
    r -= w;
  }
  return pairs[pairs.length - 1][0];
}
function round2(n) {
  return Math.round(n * 100) / 100;
}

const FIRST_NAMES = [
  'Andrea', 'Carlos', 'María', 'Juan', 'Laura', 'Diego', 'Camila', 'Andrés',
  'Valentina', 'Felipe', 'Daniela', 'Santiago', 'Paula', 'Jorge', 'Natalia',
  'Julián', 'Sofía', 'Ricardo', 'Carolina', 'Óscar', 'Alejandra', 'Mauricio',
  'Ximena', 'Hernán', 'Luisa', 'Fabián', 'Tatiana', 'Gustavo', 'Yolanda', 'Iván',
];
const LAST_NAMES = [
  'Rodríguez', 'Gómez', 'García', 'Martínez', 'López', 'Hernández', 'Pérez',
  'Sánchez', 'Ramírez', 'Torres', 'Vargas', 'Castro', 'Ortiz', 'Rojas',
  'Moreno', 'Muñoz', 'Suárez', 'Castañeda', 'Pardo', 'Cárdenas',
];
const COMPANY_NAMES = [
  'Constructora Alameda S.A.S.', 'Colegio San Rafael', 'Restaurante El Corral de Piedra',
  'Eventos Dorado & Cía', 'Fundación Manos Unidas', 'Cultivos La Esperanza S.A.S.',
  'Hotel Costa Azul', 'Gimnasio PowerFit', 'Guardería Los Angelitos',
  'Club Social Los Pinos', 'Ferretería El Tornillo', 'Concesionario AutoValle',
];
// Velara es un taller de Barranquilla -- la mayoría de los leads son de ahí
// y alrededores (Atlántico); el resto son casos sueltos de otras ciudades.
const CITIES = [
  ['Barranquilla', 45], ['Soledad', 10], ['Puerto Colombia', 6], ['Malambo', 5],
  ['Santa Marta', 8], ['Cartagena', 8], ['Bogotá', 6], ['Medellín', 4], ['Sincelejo', 4],
];

// Precio tipico por servicio (COP) -- tapiceria/carpas de taller, tickets
// mucho mas chicos que una fabrica industrial.
const SERVICE_PRICE = {
  'forros-para-carros': [150000, 1500000],
  'tapizado-automotriz': [400000, 3000000],
  'tapizado-de-motos': [120000, 600000],
  'carpas-para-negocio': [1200000, 6000000],
  forros: [120000, 900000],
  otro: [150000, 1200000],
};

const NOTES_BY_SERVICE = {
  'forros-para-carros': 'Quiere forros a la medida, pregunta por tiempo de entrega.',
  'tapizado-automotriz': 'Interior con desgaste, pide revisar en el taller antes de cotizar en firme.',
  'tapizado-de-motos': 'Sillín roto/descosido, necesita repuesto rápido.',
  'carpas-para-negocio': 'Necesita instalación incluida, pregunta por garantía de la lona.',
  forros: 'Quiere proteger muebles nuevos, pregunta por colores disponibles.',
  otro: 'Pide cotización, detalle por confirmar en la llamada.',
};

const CAR_BRANDS = ['Chevrolet', 'Renault', 'Mazda', 'Kia', 'Toyota', 'Ford', 'Nissan', 'Hyundai'];
const CAR_MODELS = ['Onix', 'Sandero', 'CX-30', 'Rio', 'Corolla', 'Fiesta', 'Versa', 'Tucson', 'Duster', 'Spark GT'];
const MOTO_BRANDS = ['AKT', 'Bajaj', 'Yamaha', 'Honda', 'Suzuki'];
const MOTO_MODELS = ['NKD 125', 'Pulsar NS 200', 'FZ 2.0', 'CB 190R', 'GN 125', 'XTZ 125'];

// Genera valores plausibles para los campos propios de cada servicio (ver
// server/velaraServices.js) -- selects toman una opción al azar, los de
// texto usan un dato del rubro (marca/modelo/año de carro o moto, etc.).
function randomServiceFields(slug) {
  const service = findService(slug);
  if (!service) return {};
  const out = {};
  for (const f of service.fields) {
    if (f.type === 'select') {
      out[f.key] = pick(f.options);
      continue;
    }
    if (f.key === 'marca') out[f.key] = slug === 'tapizado-de-motos' ? pick(MOTO_BRANDS) : pick(CAR_BRANDS);
    else if (f.key === 'modelo') out[f.key] = slug === 'tapizado-de-motos' ? pick(MOTO_MODELS) : pick(CAR_MODELS);
    else if (f.key === 'anio') out[f.key] = String(randInt(2008, 2024));
    else if (f.key === 'dimensiones') out[f.key] = `${randInt(2, 6)}m x ${randInt(2, 5)}m`;
    else if (f.key === 'piezas') out[f.key] = `${randInt(1, 5)} piezas`;
    else if (f.key === 'tipo_mueble') out[f.key] = pick(['Juego de sala 3 puestos', 'Comedor 6 sillas', 'Colchón para cuna', 'Silla gerencial', 'Cojines de terraza']);
    else if (f.key === 'ubicacion') out[f.key] = pick(['Fachada del local', 'Terraza segundo piso', 'Patio interior']);
    else if (f.key === 'detalle') out[f.key] = 'Trabajo a medida según lo solicitado por el cliente.';
  }
  return out;
}

function randomName() {
  if (Math.random() < 0.18) return pick(COMPANY_NAMES);
  return `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)} ${pick(LAST_NAMES)}`;
}
function randomPhone() {
  return `3${randInt(0, 2)}${String(randInt(0, 9999999)).padStart(7, '0')}`;
}
function randomDocument() {
  return Math.random() < 0.7 ? String(randInt(1000000000, 1099999999)) : null;
}
function randomEmail(name) {
  const clean = name.toLowerCase().replace(/[^a-z ]/g, '').trim().split(' ')[0];
  return `${clean}${randInt(1, 999)}@gmail.com`;
}

async function main() {
  await init();

  const existing = await db.prepare('SELECT COUNT(*) AS c FROM leads').get();
  if (existing.c > 0) {
    console.log(`Ya hay ${existing.c} lead(s) en la base -- no se corre el seed (para no mezclar con datos reales).`);
    console.log('Si quieres datos de prueba desde cero, usa Ajustes -> Restaurar de fábrica y vuelve a correr este script.');
    process.exit(1);
  }

  const advisors = await db.prepare('SELECT * FROM advisors WHERE active = 1').all();
  if (!advisors.length) throw new Error('No hay asesores activos -- corre esto después de que el servidor haya arrancado una vez.');

  console.log('Creando catálogo de productos (pestaña Cotizar)...');
  // Cada item queda etiquetado con el slug del servicio al que pertenece,
  // para poder armar una cotización nativa coherente con el servicio del
  // lead (ver bloque de cotizaciones más abajo).
  const PRODUCT_CATALOG = [
    { name: 'Forro a la medida - juego delantero', price: 480000, description: 'Cuerina técnica, cierres ocultos.', slug: 'forros-para-carros' },
    { name: 'Forro a la medida - juego completo', price: 890000, description: 'Delanteros + banca trasera, mismo material.', slug: 'forros-para-carros' },
    { name: 'Tapizado de sillas (por unidad)', price: 180000, description: 'Cambio de espuma incluido si se requiere.', slug: 'tapizado-automotriz' },
    { name: 'Tapizado de cielo', price: 650000, description: 'Tela técnica, incluye desmontaje.', slug: 'tapizado-automotriz' },
    { name: 'Tapizado de sillín individual', price: 150000, description: 'Cuerina o cuero sintético.', slug: 'tapizado-de-motos' },
    { name: 'Tapizado de sillín biplaza', price: 220000, description: 'Incluye espuma nueva.', slug: 'tapizado-de-motos' },
    { name: 'Toldo de fachada por m2', price: 320000, description: 'Estructura en aluminio, lona náutica.', slug: 'carpas-para-negocio' },
    { name: 'Carpa para terraza (instalada)', price: 2800000, description: 'Incluye estructura y montaje.', slug: 'carpas-para-negocio' },
    { name: 'Forro para mueble (por puesto)', price: 160000, description: 'Tela impermeable, elástico ajustable.', slug: 'forros' },
    { name: 'Cobertor de equipo a medida', price: 190000, description: 'Lona ligera resistente al agua.', slug: 'forros' },
  ];
  const productIds = [];
  const productIdBySlug = new Map(); // slug -> [ids...] para elegir lineas coherentes con el servicio
  for (const p of PRODUCT_CATALOG) {
    const info = await db.prepare('INSERT INTO products (name, price, description, active) VALUES (?, ?, ?, 1)').run(p.name, p.price, p.description);
    productIds.push(info.lastInsertRowid);
    if (!productIdBySlug.has(p.slug)) productIdBySlug.set(p.slug, []);
    productIdBySlug.get(p.slug).push({ id: info.lastInsertRowid, ...p });
  }

  const DAYS_BACK = 90;
  const LEAD_COUNT = 120;
  const now = new Date();

  console.log(`Generando ${LEAD_COUNT} leads a lo largo de ${DAYS_BACK} días...`);

  // Clientes: se crean primero para poder reutilizar algunos entre varios
  // leads (clientes repetidos), como pasaría en la vida real.
  const clients = [];
  async function getOrCreateClient() {
    if (clients.length > 8 && Math.random() < 0.28) {
      return pick(clients);
    }
    const name = randomName();
    const phone = randomPhone();
    const document = randomDocument();
    const address = Math.random() < 0.5 ? `Calle ${randInt(1, 150)} # ${randInt(1, 99)}-${randInt(1, 99)}` : null;
    const email = Math.random() < 0.4 ? randomEmail(name) : null;
    const info = await db
      .prepare('INSERT INTO clients (name, phone, document, address, email) VALUES (?, ?, ?, ?, ?)')
      .run(name, phone, document, address, email);
    const client = { id: info.lastInsertRowid, name, phone, document };
    clients.push(client);
    return client;
  }

  const dailyRegistered = new Map(); // 'YYYY-MM-DD' -> { whatsapp, correo, llamadas }
  function bumpDaily(dateKey, source) {
    if (!dailyRegistered.has(dateKey)) dailyRegistered.set(dateKey, { whatsapp: 0, correo: 0, llamadas: 0 });
    const d = dailyRegistered.get(dateKey);
    if (source === 'WhatsApp') d.whatsapp++;
    else if (source === 'Correo') d.correo++;
    else if (source === 'Llamada') d.llamadas++;
    else d.whatsapp++; // "Otro" se cuenta como whatsapp para el conteo crudo, la mayoría real llega asi
  }

  let closedCount = 0;
  let quotationsCreated = 0;

  for (let i = 0; i < LEAD_COUNT; i++) {
    const status = weightedPick([
      ['asignado', 12],
      ['contactado', 12],
      ['cotizado', 14],
      ['cerrado_ganado', 42],
      ['cerrado_perdido', 20],
    ]);
    const isOpen = status === 'asignado' || status === 'contactado' || status === 'cotizado';

    // Los leads abiertos son recientes (para que SLA/Seguimiento tengan
    // sentido); los cerrados se reparten por los 90 días completos.
    const createdAt = isOpen
      ? addMinutes(now, -randInt(5, 10 * 24 * 60))
      : addMinutes(now, -randInt(60, DAYS_BACK * 24 * 60));

    const advisor = pick(advisors);
    const service = pick(SERVICES);
    const priceRange = SERVICE_PRICE[service.slug] || SERVICE_PRICE.otro;
    const productName = service.slug === 'otro' ? pick(['Sombrilla para terraza', 'Techo en policarbonato', 'Malla sombra']) : service.title;
    const city = weightedPick(CITIES);
    const source = weightedPick([['WhatsApp', 70], ['Correo', 15], ['Llamada', 10], ['Otro', 5]]);
    const channelDetail = weightedPick([['Google Ads', 75], ['Orgánico', 10], ['Referido', 10], ['Otro', 5]]);
    const client = await getOrCreateClient();

    let contactedAt = null;
    let quotedAt = null;
    let closedAt = null;
    let amount = 0;
    let saleReference = null;
    let lastFollowupAt = null;
    let followupCount = 0;

    if (status !== 'asignado') {
      // La mayoría contacta dentro de SLA (<24h); una parte queda vencida a
      // propósito para que Control SLA tenga casos reales que mostrar.
      const contactMins = Math.random() < 0.75 ? randInt(15, 22 * 60) : randInt(25 * 60, 70 * 60);
      contactedAt = addMinutes(createdAt, contactMins);
    }
    if (status === 'cotizado' || status === 'cerrado_ganado' || status === 'cerrado_perdido') {
      quotedAt = addMinutes(contactedAt, randInt(30, 3 * 24 * 60));
    }
    if (status === 'cerrado_ganado' || status === 'cerrado_perdido') {
      closedAt = addMinutes(quotedAt, randInt(60, 5 * 24 * 60));
    }
    if (status === 'cerrado_ganado') {
      const qty = randInt(1, 3);
      amount = round2(randInt(priceRange[0], priceRange[1]) * (qty > 1 ? 1 + (qty - 1) * 0.85 : 1));
      closedCount++;
    }
    // Seguimiento Activo: una parte de los "cotizado" sin cerrar ya tiene
    // seguimiento registrado (reinicia el reloj de 24h/72h de esa pantalla).
    if (status === 'cotizado' && Math.random() < 0.45) {
      followupCount = randInt(1, 3);
      lastFollowupAt = addMinutes(quotedAt, randInt(60, 48 * 60));
    }

    const info = await db
      .prepare(
        `INSERT INTO leads
           (client_name, phone, document, product, notes, status, assigned_advisor_id, amount,
            created_at, contacted_at, closed_at, source, quoted_at, channel_detail,
            last_followup_at, followup_count, city, client_id, sale_reference)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        client.name,
        client.phone,
        client.document,
        productName,
        NOTES_BY_SERVICE[service.slug] || 'Solicita cotización.',
        status,
        advisor.id,
        amount,
        fmt(createdAt),
        contactedAt ? fmt(contactedAt) : null,
        closedAt ? fmt(closedAt) : null,
        source,
        quotedAt ? fmt(quotedAt) : null,
        channelDetail,
        lastFollowupAt ? fmt(lastFollowupAt) : null,
        followupCount,
        city,
        client.id,
        saleReference
      );
    const leadId = info.lastInsertRowid;

    bumpDaily(fmt(createdAt).slice(0, 10), source);

    // Reasignación ocasional -- deja historial y penalización, como en la vida real.
    if (Math.random() < 0.12 && advisors.length > 1) {
      const other = pick(advisors.filter((a) => a.id !== advisor.id));
      if (other) {
        await db
          .prepare('INSERT INTO reassignments (lead_id, from_advisor_id, to_advisor_id, reason, penalty_points, at) VALUES (?, ?, ?, ?, 5, ?)')
          .run(leadId, advisor.id, other.id, 'Carga de trabajo del asesor original', fmt(addMinutes(createdAt, randInt(30, 600))));
        await db.prepare('UPDATE leads SET assigned_advisor_id = ?, reassigned_count = 1 WHERE id = ?').run(other.id, leadId);
      }
    }

    // Cotización nativa (pestaña "Cotizar") para una parte de los leads
    // cotizados/cerrados -- deja el número de referencia enlazado, con
    // líneas del catálogo del MISMO servicio y sus campos propios llenos
    // (marca/modelo, material, color, etc.).
    if ((status === 'cotizado' || status === 'cerrado_ganado') && Math.random() < 0.35) {
      const catalogForService = productIdBySlug.get(service.slug) || PRODUCT_CATALOG.map((p, i) => ({ id: productIds[i], ...p }));
      const lineCount = randInt(1, Math.min(2, catalogForService.length));
      const lines = [];
      for (let li = 0; li < lineCount; li++) {
        const item = pick(catalogForService);
        const qty = randInt(1, 4);
        lines.push({ product_id: item.id, product_name: item.name, qty, price_unit: item.price, discount_percent: 0 });
      }
      const amount_untaxed = round2(lines.reduce((s, l) => s + l.qty * l.price_unit, 0));
      const amount_tax = round2(amount_untaxed * 0.19);
      const amount_total = round2(amount_untaxed + amount_tax);
      const serviceFields = service.slug !== 'otro' ? JSON.stringify(randomServiceFields(service.slug)) : null;
      const qInfo = await db
        .prepare(
          `INSERT INTO quotations (lead_id, state, validity_days, date_order, validity_date, amount_untaxed, amount_tax, amount_total, service_slug, service_fields)
           VALUES (?, ?, 8, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          leadId,
          status === 'cerrado_ganado' ? 'sale' : 'sent',
          fmt(quotedAt),
          fmt(addMinutes(quotedAt, 8 * 24 * 60)).slice(0, 10),
          amount_untaxed,
          amount_tax,
          amount_total,
          service.slug,
          serviceFields
        );
      const qId = qInfo.lastInsertRowid;
      const number = `COT-${String(qId).padStart(4, '0')}`;
      await db.prepare('UPDATE quotations SET number = ? WHERE id = ?').run(number, qId);
      const insertLine = db.prepare(
        'INSERT INTO quotation_lines (quotation_id, product_id, product_name, qty, price_unit, subtotal, position) VALUES (?, ?, ?, ?, ?, ?, ?)'
      );
      let pos = 0;
      for (const l of lines) {
        await insertLine.run(qId, l.product_id, l.product_name, l.qty, l.price_unit, round2(l.qty * l.price_unit), pos++);
      }
      quotationsCreated++;
      if (status === 'cerrado_ganado') {
        await db.prepare('UPDATE leads SET sale_reference = ? WHERE id = ?').run(number, leadId);
      }
    }

    // Abono parcial para una parte de las ventas cerradas.
    if (status === 'cerrado_ganado' && amount > 0 && Math.random() < 0.3) {
      const paidAmount = round2(amount * (Math.random() < 0.5 ? 0.5 : 1));
      await db
        .prepare('INSERT INTO payments (lead_id, amount, paid_at, notes) VALUES (?, ?, ?, ?)')
        .run(leadId, paidAmount, fmt(addMinutes(closedAt, randInt(0, 2 * 24 * 60))), paidAmount < amount ? 'Anticipo del 50%' : 'Pago completo');
    }
  }

  console.log(`${LEAD_COUNT} leads creados (${closedCount} ventas ganadas, ${quotationsCreated} cotizaciones nativas).`);

  // Informe de canales (Informe diario): mensajes/llamadas CRUDOS del
  // negocio, siempre >= lo que realmente se registró como lead ese día
  // (no todo contacto se convierte en lead registrado).
  console.log('Generando informe de canales de los últimos 90 días...');
  for (let d = 0; d < DAYS_BACK; d++) {
    const day = addMinutes(now, -d * 24 * 60);
    const key = fmt(day).slice(0, 10);
    const registered = dailyRegistered.get(key) || { whatsapp: 0, correo: 0, llamadas: 0 };
    const whatsapp = registered.whatsapp + randInt(0, 3);
    const correo = registered.correo + randInt(0, 1);
    const llamadas = registered.llamadas + randInt(0, 2);
    if (whatsapp || correo || llamadas) {
      await db
        .prepare(
          `INSERT INTO informe_canales (fecha, whatsapp, correo, llamadas) VALUES (?, ?, ?, ?)
           ON CONFLICT(fecha) DO UPDATE SET whatsapp = excluded.whatsapp, correo = excluded.correo, llamadas = excluded.llamadas`
        )
        .run(key, whatsapp, correo, llamadas);
    }
  }

  // Inversión en Google Ads (Estadísticas -> Rentabilidad de Leads), 3 meses.
  console.log('Generando inversión publicitaria (ad_spend) de los últimos 3 meses...');
  for (let m = 0; m < 3; m++) {
    const d = new Date(now.getFullYear(), now.getMonth() - m, 1);
    const month = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
    const amount = randInt(1200000, 2800000);
    await db
      .prepare(
        `INSERT INTO ad_spend (month, amount, source, updated_at) VALUES (?, ?, 'manual', datetime('now'))
         ON CONFLICT(month) DO UPDATE SET amount = excluded.amount, source = 'manual', updated_at = datetime('now')`
      )
      .run(month, amount);
  }

  // Meta de ventas mensual (Dashboard -> gauge).
  await setSetting('monthly_sales_target', String(randInt(25000000, 45000000)));

  console.log('\nListo. Datos de prueba cargados:');
  console.log(`  - ${clients.length} clientes`);
  console.log(`  - ${LEAD_COUNT} leads (${closedCount} ventas cerradas)`);
  console.log(`  - ${quotationsCreated} cotizaciones nativas`);
  console.log(`  - 3 meses de inversión publicitaria`);
  console.log('\nSi el servidor ya estaba corriendo, recarga la página (Ctrl+R) para verlos.');
  process.exit(0);
}

main().catch((err) => {
  console.error('Error generando datos de prueba:', err);
  process.exit(1);
});
