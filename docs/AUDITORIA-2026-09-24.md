# Auditoría Velara CRM/ERP — 24-sep-2026

Alcance: `C:\Users\DISEÑO NOVA\Desktop\velara-crm` (rama con Facturación sin commitear). Solo lectura. La base `server/data/nova_crm.db` se consultó en modo `readOnly` (parece contener datos de prueba sembrados: 120 leads, 48 ventas ganadas, 11 OP, 31 facturas recibidas simuladas). `PRAGMA integrity_check` = ok y `foreign_key_check` sin violaciones.

---

## 1. Resumen ejecutivo

- **No hay una fuente única para "cuánto vale una venta" ni para "cuánto se ha cobrado".** Tres bases distintas: `leads.amount` (sin IVA, lo usan Cartera, Clientes y los tableros), `quotations.amount_total` (con IVA), `invoices.total` (con IVA). Pagos: `payments` (abonos) e `invoices.payment_status` no se conocen entre sí. Resultado: "Por cobrar" en Facturación y "Cartera" en Finanzas cuentan la misma deuda dos veces y con montos distintos (±19 %).
- **El IVA está mal configurado para el negocio real:** en la base, el régimen es `no_responsable`, pero las cotizaciones nativas cobran siempre 19 % (`nativeQuotes.js:14`) y las facturas nuevas salen al 19 % por defecto (`facturacion.js`, `invoices.js /prefill`). Si Velara no es responsable de IVA, está cotizando y (en el futuro) facturando un impuesto que no puede cobrar.
- **Seguridad:** hay XSS almacenado confirmado. Un asesor puede ejecutar código en la sesión del admin, porque el nombre del cliente se muestra sin escapar en los modales de Finanzas y Pedidos. Además, el rol `produccion` puede leer y modificar todo el embudo comercial por API (leads, abonos, cierres, clientes, cotizaciones), cualquier asesor puede editar la ficha de cualquier cliente, y el WebSocket emite nombres de clientes sin exigir sesión.
- **Las copias de seguridad están incompletas:** el backup semanal y la exportación solo guardan advisors, leads, reassignments, informe y settings. No incluyen abonos, clientes, cotizaciones, producción, inventario, caja, facturas ni usuarios. En cambio sí incluyen el `session_secret`.
- **Producción, Inventario y Finanzas quedaron desconectados:** ya ninguna ruta crea `work_orders` ni consumos de inventario, así que el stock solo sube, Rentabilidad (Finanzas) solo muestra OT viejas y la garantía antigua #1 no aparece en Garantías. Hay pedidos en producción cuyo lead sigue "cotizado" con monto 0, y esos trabajos no aparecen en Cartera.
- **La vista `leads_visible` (solo "Google Ads") esconde el 30 % de los leads** de Ventas, Seguimiento, Dashboard e Informe. Cerrar una venta sobrescribe el canal a "Google Ads" y eso infla el ROI de pauta. En la base, 13 ventas por $31,9 M no aparecen en los tableros pero sí en Cartera y Clientes.
- **Fechas:** los reportes diarios y mensuales (Informe, embudo, ventas por día, filtros de Ventas y Cotizaciones) cortan el día en UTC, no en hora de Colombia. Todo lo que pasa después de las 7 p.m. cae al día (o mes) siguiente: afecta a 27 de 120 leads creados y a 13 cierres en la base.
- **Borrar un lead y "Restaurar de fábrica" fallan** por llaves foráneas cuando existen cotizaciones, pedidos o facturas. En el caso de borrar un lead, la oportunidad en Odoo ya quedó archivada antes del fallo.

---

## 2. Mapa de arquitectura

```
                    (Odoo opcional: crm.lead / sale.order  <->  leads.odoo_*; odoo-sync cada 30 s)
clients ──1:N── leads (client_name, phone, document, address, email DUPLICADOS; amount; status; sale_reference)
                  │  └─ payments (abonos) ─────────────────────────────┐
                  │  └─ reassignments                                   │ Caja = payments + cash_entries
                  ├─ quotations ──1:N── quotation_lines (IVA fijo 19 %)  │ Cartera = leads.amount − payments
                  │      │                                               │
                  │      └─(from-quotation)→ sales_orders (copia cliente/tel/dirección del lead)
                  │                              └─1:N→ production_orders (OP) → tasks, specs, files, blocks,
                  │                                       reviews, approvals, deliveries, material_requirements
                  │                                       → material_requests (NO mueven stock)
                  │                                       → warranty_claims.production_order_id
                  ├─ work_orders (LEGADO: amount_total, invoice_number/cufe, stock_movements.work_order_id,
                  │               warranty_claims.work_order_id) — ninguna ruta los crea ya
                  └─ invoices (emitida, lead_id opcional; payment_status propio, NO toca payments ni Caja)

suppliers ─1:N─ purchase_orders ─1:N─ purchase_order_lines ──(recibir)→ stock_movements('entrada') → materials.stock
      │                 └─ cash_entries.purchase_order_id (pagos a proveedor)
      └─ invoices (recibida, supplier_id por NIT; pagar ⇒ cash_entries.invoice_id egreso)
```

### Incoherencias de datos y fuentes de verdad duplicadas

| Concepto | Dónde vive | Problema |
|---|---|---|
| Monto de la venta | `leads.amount` (sin IVA, tecleado o precargado con `amount_untaxed`), `quotations.amount_total` (con IVA), `work_orders.amount_total` (Rentabilidad divide ÷1,19), `invoices.total` (con IVA) | No hay vínculo ni validación. En la base, 9 de 10 ventas con cotización tienen `amount` distinto al subtotal y al total de su cotización. Cotizaciones (pantalla) suma `amount_total`; los tableros suman `leads.amount`. |
| Cobro | `payments` (abonos por lead) vs `invoices.payment_status/paid_at` | Sin relación. "Registrar cobro" de una factura de venta no crea abono ni ingreso de Caja. |
| Deuda del cliente | Cartera (`cash.js /receivables`), Ficha de cliente (`clients.js`), Facturación "Por cobrar" | Tres cálculos. Los dos primeros usan la base sin IVA; Facturación usa el total con IVA. |
| Datos del cliente | `clients` y `leads` (nombre, teléfono, documento, dirección, correo), copiados otra vez en `sales_orders` e `invoices.party_*` | Editar el cliente no propaga los cambios. `/prefill` prioriza el lead sobre el cliente. |
| Orden de trabajo | `work_orders` (legado) vs `production_orders` | Rentabilidad, kárdex (`stock_movements.work_order_id`) y garantías viejas siguen colgando de la tabla muerta. |
| Nº de factura | `work_orders.invoice_number/invoice_cufe` vs `invoices` | Campos muertos. |
| Datos de la empresa | `quote_company_*` (editable en Ajustes) vs `einvoice_issuer_*` (no editable; por defecto "VELARA"/NIT 900000000) | La cotización y la factura muestran emisores distintos. |
| Categorías de gasto | Compartidas en `erp.EXPENSE_CATEGORIES` | Bien. Pero no hay regla que distinga "pagado por OC en Caja" de "factura del mismo proveedor": el mismo gasto puede registrarse dos veces. |
| Canal del lead | `leads.channel_detail` | Se fuerza a "Google Ads" al crear y al ganar; los demás canales quedan ocultos por `leads_visible`. |
| Campos Odoo | `leads.odoo_*`, `clients.odoo_partner_id`, `advisors.odoo_*`, ruta `/api/leads/quotations`, `/:id/quotation*` | Flujo paralelo de cotización (Odoo) aún vivo junto al nativo. |

---

## 3. Errores encontrados (por severidad)

### Crítico

**C1. Facturación y los abonos no se conocen (cobro contado doble o nunca contado).** CONFIRMADO.
- Dónde: `server/routes/invoices.js:441-458` (`/pay` solo crea `cash_entries` si `direction==='recibida'`), `routes/cash.js:137-168` (Cartera = `leads.amount − SUM(payments)`), `invoices.js:120-123` (por_cobrar = facturas emitidas pendientes).
- Escenario: venta de $1.000.000 (lead, sin IVA). Se emite la factura desde la cotización: $1.190.000. Entonces:
  - Facturación → Por cobrar: $1,19 M, y además Finanzas → Cartera: $1,0 M. La misma deuda aparece en dos pantallas.
  - Si el cliente paga y se registra el abono en Ventas Cerradas, la factura sigue "por cobrar".
  - Si en cambio se marca "Registrar cobro" en Facturación, Caja no ve el ingreso y Cartera sigue cobrando $1,0 M.
- Impacto: se puede cobrarle dos veces a un cliente o dejar de cobrar. Caja no cuadra con Facturación.
- Arreglo:
  - Añadir `payments.invoice_id` (o `invoices.sales_order_id`/`quotation_id`) y hacer que `/pay` de una factura emitida cree el abono en `payments` dentro de la misma transacción.
  - Calcular "por cobrar" de Facturación como total factura − abonos ligados.
  - Definir una única base de cartera (recomendado: total con impuestos del documento que se le entrega al cliente).
  - Impedir facturar dos veces el mismo lead o pedido.

**C2. IVA del 19 % fijo aunque el régimen configurado es "no responsable".** CONFIRMADO (`settings.tax_regime = 'no_responsable'` en la base).
- Dónde: `server/nativeQuotes.js:14` (`IVA_RATE = 0.19`), `invoices.js:154` (prefill `iva_rate: 19`), `einvoice.js:39` (tasa inválida → 19), `facturacion.js` `lineRow` (`l.iva_rate ?? 19`).
- Escenario: cualquier cotización o factura nueva.
- Impacto: el cliente ve un precio con 19 % de IVA que Velara no puede cobrar (riesgo legal), y los márgenes y los reportes de IVA quedan distorsionados.
- Arreglo: que la tasa de IVA por defecto salga de `tax_regime` (0 % si es `no_responsable`), tanto en cotizaciones como en facturas, y avisar si se emite con IVA en ese régimen.

**C3. Backups incompletos que dan falsa seguridad (y contienen el secreto de sesión).** CONFIRMADO.
- Dónde: `server/backup.js:9-27` (solo advisors, leads, reassignments, informe_*, settings); lo usan también `/api/export` y el backup previo a factory-reset.
- Escenario: se daña el disco y se restaura desde el backup semanal.
- Impacto: se pierden abonos, clientes, cotizaciones, producción, inventario, caja, facturas y usuarios. Además, `settings.session_secret` va en el JSON: quien tenga el archivo puede falsificar cookies de sesión.
- Arreglo: hacer el backup con `VACUUM INTO 'backups/nova-AAAAMMDD.db'` (copia consistente del archivo SQLite, incluso en WAL) y excluir `session_secret` de los dumps.

### Alto

**A1. XSS almacenado: un asesor ejecuta código en la sesión del admin.** CONFIRMADO (recorrido del código).
- Dónde:
  - `public/js/views/finanzas.js:262` (`title: \`Abono · ${name}\``, con `name` sacado de `dataset.name`, que el navegador devuelve ya decodificado).
  - `views/pedidos.js:83` (`${so.client_name}`).
  - `components/modal.js:19` (el título se inserta como HTML).
  - También sin escapar: `compras.js:244,303,378` (proveedor), `inventario.js:173,214,250,289` (material), `operarios.js:57` (operario, editable por rol `produccion`), `ajustes.js:554,673`.
- Escenario: el asesor edita su lead (PATCH `/api/leads/:id` lo permite mientras el lead está activo) y pone de nombre `<img src=x onerror=fetch('/api/users',{method:'POST',...})>`. Al cerrarse la venta con saldo, el admin abre Finanzas → Cartera → "Registrar abono" y el script corre con la sesión del admin, que puede, por ejemplo, crear otro admin. Lo mismo ocurre al abrir el pedido en Pedidos.
- Arreglo: escapar dentro de `openModal`/`confirmModal` (usar `textContent` para el título) o envolver en `escapeHtml` cada título; revisar también `app.js:206` (`err.message`).

**A2. El rol `produccion` tiene acceso total al embudo comercial por API.** CONFIRMADO.
- Dónde: `routes/leads.js:28-31` (`canOperateOn` devuelve `true` para cualquier rol distinto de asesor), `nativeQuotes.js:128`, `clients.js:9`; `/api/leads`, `/api/clients`, `/api/quotations` no tienen `requireRole`.
- Escenario: el jefe de taller hace `POST /api/leads/:id/close`, `POST /:id/payments` o `PATCH /:id`, y lee montos y clientes de todos.
- Impacto: rompe la separación de funciones que promete `apps.js` ("no ve finanzas ni el embudo comercial").
- Arreglo: `router.use(requireRole('admin','coordinador','asesor'))` en leads, clients y quotations, dejando excepciones de solo lectura si Producción las necesita.

**A3. Cualquier asesor puede editar la ficha de cualquier cliente.** CONFIRMADO.
- Dónde: `routes/clients.js:180-203` (PATCH sin `scopedClientIds`; solo GET `/:id` lo verifica).
- Impacto: cambios de teléfono o documento en clientes ajenos, que luego se usan en facturación.
- Arreglo: aplicar el mismo `scopedClientIds` en PATCH.

**A4. `leads_visible` oculta leads y ventas reales; cerrar una venta reescribe el canal.** CONFIRMADO.
- Dónde: `db.js:787` (vista `channel_detail = 'Google Ads'`), `leads.js:1119-1128` (al ganar fuerza `channel_detail='Google Ads'`), `leads.js:686-713` (el asesor puede cambiar el canal a Orgánico/Referido y el lead desaparece de su tablero).
- Evidencia: en la base hay 16 leads abiertos invisibles en Ventas/SLA/Seguimiento y 13 ventas ($31,9 M) fuera de Dashboard/Ventas Cerradas/Informe, pero sí incluidas en Cartera y Clientes.
- Impacto: el ROI de Google Ads queda inflado (toda venta ganada cuenta como pauta), los tableros no cuadran con Finanzas y hay leads que nadie atiende.
- Arreglo: guardar el canal real sin sobrescribirlo y, si se quiere un filtro "solo Ads", que sea un filtro opcional de pantalla y no una vista global.

**A5. Rentabilidad e inventario quedaron atados al módulo legado.** CONFIRMADO.
- Dónde: `cash.js:173-210` (solo `work_orders`), `materials.js:76-101` (solo `entrada`/`ajuste`). Ninguna ruta crea `work_orders` ni movimientos `consumo`/`devolucion`, y `material_requests` "atendida" no descuenta stock (`production.js:299-312`).
- Evidencia: los 19 consumos de la base son de OT legadas.
- Impacto: el stock solo crece hasta el próximo conteo físico, las sugerencias de compra no saltan y Rentabilidad no muestra ningún trabajo nuevo.
- Arreglo: añadir `production_order_id` a `stock_movements`, registrar el consumo al atender la solicitud de material o al cerrar la OP, y reescribir Rentabilidad sobre `production_orders` → `sales_orders` → `leads.amount`.

**A6. Transacciones abiertas durante llamadas externas (riesgo latente, se activa con el proveedor real).** PROBABLE.
- Dónde: `invoices.js:326-351` y `369-379` (`await prov.emit(doc)` dentro de `db.transaction`), `db.js:40-56` (una sola conexión: `BEGIN`… `await`…`COMMIT`).
- Escenario: cuando `emit()` haga HTTP a MATIAS/Plemsi, otra petición que llegue mientras tanto escribe dentro de esa transacción. Si la DIAN rechaza, su trabajo se revierte en silencio; si esa otra petición abre su propia `db.transaction`, falla con "cannot start a transaction within a transaction".
- Arreglo: reservar el número y guardar la factura como `pendiente` en una transacción corta, llamar al proveedor fuera de ella y actualizar el estado y el CUFE en otra transacción. Añadir un guard en `transaction()` que rechace el anidamiento.

**A7. Días y meses cortados en UTC en reportes y filtros.** CONFIRMADO (27/120 leads creados y 13 cierres en la franja 19:00-23:59 de Bogotá).
- Dónde: `routes/informe.js:20-21`, `reporting.js:70-71, 204-205, 317-318, 428-429, 483-484, 540-542, 567, 733-737` (`substr(created_at,1,10)`), `leads.js:313-331`, `quotations.js:56-62`, `clients.js:103-104`. Los timestamps se guardan en UTC (`nowUtc`).
- Impacto: una venta cerrada el 31 a las 8 p.m. cuenta para el mes siguiente; el informe diario y las metas por asesor se desplazan.
- Arreglo: un helper `bogotaDayRangeUtc(from,to)` que convierta a `[from 05:00:00, to+1 04:59:59]` UTC, o comparar con `date(col,'-5 hours')` como ya hace `cash.js:43`.

### Medio

- **M1. Borrar un lead falla si tiene cotización, pedido o factura, y Odoo queda archivado igual.** CONFIRMADO. `leads.js:594-617`: `DELETE FROM leads` choca con las FK de `quotations.lead_id` (NOT NULL), `sales_orders`, `work_orders` e `invoices`. Sale un error 500 y `archiveOpportunity` ya se ejecutó. Arreglo: validar dependencias antes de tocar nada (409 con mensaje claro) o hacer un borrado lógico.
- **M2. "Restaurar de fábrica" siempre falla con datos del ERP.** CONFIRMADO. `routes/system.js:19-50`: borra leads y advisors, pero `quotations`, `sales_orders`, `production_orders`, `users.advisor_id` e `invoices` los referencian (FK activas), así que se hace rollback y responde 500. Tampoco limpia las tablas ERP. Arreglo: definir qué se reinicia y borrar en orden, o retirar la función.
- **M3. Migración que borra columnas en el primer arranque.** CONFIRMADO (lectura del orden en `db.js:997-1000`). `ensureColumn('quotations','service_slug'/'service_fields')` corre antes de `ensureQuotationsStateCheck()`, y esta reconstruye la tabla sin esas columnas. En una base antigua, el primer arranque queda sin `service_slug` y Cotizaciones falla con "no such column" hasta el siguiente reinicio. Arreglo: mover los `ensureColumn` después de la reconstrucción, o que la reconstrucción copie `PRAGMA table_info` como hace `ensureUsersRoleCheck`.
- **M4. Asignar un lead ya cerrado lo reabre.** CONFIRMADO. `leads.js:734-752` pone `status='asignado'` sin validar el estado: una venta ganada desaparece de los reportes y conserva su monto. Arreglo: rechazar la asignación si el estado empieza con `cerrado`.
- **M5. Mandar a producción sin venta cerrada.** CONFIRMADO. `production.js` `/orders/from-quotation` acepta cotizaciones en `aprobada`. En la base, los pedidos 4 y 13 tienen el lead en "cotizado" con monto 0, y los pedidos 1 y 2 son manuales sin lead: ese trabajo no aparece en Cartera. Arreglo: exigir un lead `cerrado_ganado` (o pedir el monto al crear el pedido) y ligar el pedido a su cartera.
- **M6. Doble registro de gastos de compra.** CONFIRMADO por diseño. Una OC pagada por Caja (`cash_entries.purchase_order_id`) y la factura electrónica del mismo proveedor pagada en Facturación generan dos egresos. Además, la factura recibida no se liga a la OC ni al inventario. Arreglo: ligar `invoices.purchase_order_id`; si la OC ya tiene pagos, no crear otro egreso o avisar.
- **M7. Borrar un egreso de Caja ligado a una factura deja la factura "pagada".** CONFIRMADO. `cash.js:124-132` no revierte `invoices.payment_status`. Arreglo: bloquear el borrado o revertir el estado de la factura en la misma transacción.
- **M8. La factura "desde cotización" ignora los descuentos.** CONFIRMADO. `invoices.js:149-155` usa `price_unit` y omite `discount_percent`, así que se factura por encima de lo cotizado. Arreglo: usar `subtotal/qty` o aplicar el descuento.
- **M9. El buscador de clientes de Facturación solo encuentra leads de Google Ads.** CONFIRMADO. `facturacion.js:543` envía `include_manual=1`, pero `leads.js buildLeadFilters` lo ignora y consulta `leads_visible`. Los clientes orgánicos o referidos no se pueden precargar. Arreglo: un endpoint de búsqueda sobre `clients`/`leads` sin la vista.
- **M10. Archivos de OP servidos inline con el MIME que manda el navegador.** CONFIRMADO. `production.js` `/files/:fileId` usa `f.mime`. Un .html/.svg subido por un usuario de producción se abre como página del mismo origen (XSS). Arreglo: lista blanca de MIME, `Content-Disposition: attachment` para lo que no sea imagen o PDF, y `X-Content-Type-Options: nosniff`.
- **M11. WebSocket sin autenticación.** CONFIRMADO. `realtime.js:5-10` acepta cualquier conexión en la LAN y difunde `client_name`/`advisor_name` (lead creado, `sale_closed`). Arreglo: validar la cookie de sesión en el `upgrade`.
- **M12. Garantía legada invisible.** CONFIRMADO. `production.js` `/claims` filtra `production_order_id IS NOT NULL`, así que el reclamo #1 (sobre la OT 9, abierto) no aparece en ninguna pantalla. Arreglo: migrarlo a una OP o mostrar ambos tipos.
- **M13. Sesiones en memoria.** CONFIRMADO. `index.js:50-57` no define `store`, así que se usa MemoryStore: cada reinicio saca a todos (el comentario dice lo contrario) y la memoria crece sin límite. Arreglo: un store en SQLite (por ejemplo `better-sqlite3-session-store` o uno propio sobre `node:sqlite`).
- **M14. Validaciones de dinero flojas.** CONFIRMADO. Se acepta monto de cierre negativo (`leads.js:1127`, `Number(amount)||0`), abonos sobre leads perdidos o no ganados y abonos mayores al saldo. Todo el dinero se guarda como `REAL` con decimales (34 ventas con centavos), y Cartera redondea mientras la ficha de cliente no. Arreglo: pesos enteros (`Math.round`) al guardar, `amount ≥ 0`, abonos solo en `cerrado_ganado` y aviso de sobrepago.

### Bajo

- `leads.js:1334`: PATCH de abono con `notes: null` → `notes.trim()` lanza un 500. CONFIRMADO.
- `invoices.js:434`: PATCH con `notes: null` guarda el texto "null". CONFIRMADO.
- `quotations.js:171-195`: `/aprobar` y `/confirm` reabren una cotización cancelada; `PUT` permite editar líneas en estado `sent` aunque el mensaje de error dice lo contrario. CONFIRMADO.
- `production.js /ops?status=abiertas` no filtra nada (la rama `abiertas` no agrega condición). El frontend no lo usa hoy. CONFIRMADO.
- `production.js /material-requests` (GET) no filtra por asesor; `GET /api/materials` expone costos al asesor. CONFIRMADO.
- `production.js /ops/:id/files`: multer escribe el archivo antes de verificar que la OP exista, lo que deja archivos huérfanos. CONFIRMADO.
- `warrantyUntil` (`production.js:200-206`): `setUTCMonth` desborda (31-ago + 6 meses = 3-mar). CONFIRMADO.
- `ventas.js:429`: `document.addEventListener('click', …)` nunca se quita al desmontar la vista (fuga por cada visita). CONFIRMADO.
- `app.js render()`: si se navega rápido, un `mount` viejo puede terminar después del nuevo y quedar montado (condición de carrera). PROBABLE.
- `einvoice_issuer_*` y `warranty_months` no se pueden editar desde Ajustes (`settings.js PUBLIC_KEYS`). CONFIRMADO.
- Resumen de Facturación: `compras.count` cuenta las notas crédito y `ventas.count` no; para `no_responsable`, "Resultado" usa el subtotal sin IVA aunque ese IVA sea costo. CONFIRMADO.
- Estado `pendiente` de `invoices.status` y campos `work_orders.invoice_*` sin uso (código muerto). CONFIRMADO.

---

## 4. Optimizaciones (por impacto/esfuerzo)

1. **Índices faltantes** (esfuerzo mínimo): `leads(status)`, `leads(assigned_advisor_id)`, `leads(created_at)`, `leads(closed_at)`, `leads(client_id)`, `leads(channel_detail)`, `payments(lead_id)`, `quotations(lead_id)`, `quotation_lines(quotation_id)`, `reassignments(lead_id)`, `invoices(lead_id)`, `invoices(party_nit)`, `cash_entries(purchase_order_id)`, `cash_entries(invoice_id)`, `material_requests(op_id)`, `production_reviews/approvals/deliveries(op_id)`, `warranty_claims(production_order_id)`.
2. **GET `/api/leads` recalcula todo en cada broadcast.** Carga la tabla completa, serializa SLA y seguimiento de cada lead y filtra en JS (`critical_only`, `followup_only`). Cada `leads_changed` (incluido `odoo-sync` cada 30 s) hace que todas las pestañas abiertas lo repitan. Conviene paginar y filtrar en SQL, y que el broadcast lleve el `id` para refrescar solo esa tarjeta.
3. **Carga de tablas enteras en memoria:**
   - `clients.js GET /` trae todos los clientes y filtra `q`, `from`, `to`, asesor y producto en JS: pasarlo a SQL con `JOIN`/`EXISTS` y agregados `GROUP BY`.
   - `kpis.js:19`, `reporting.js:608` y `production.js /reports` (todas las OP) también leen tablas completas.
   - `cash.js /receivables` carga todas las OP en un `Map`: reemplazarlo por un `LEFT JOIN`.
4. **`readOp` hace 12 consultas y se llama 2-3 veces por mutación** (`loadOp` + `transition` → `readOp` al inicio y al final). Devolver solo lo que cambió o reusar la lectura. `OP_LIST_SQL` tiene 7 subconsultas correlacionadas por fila: cambiarlas por `LEFT JOIN` con agregados.
5. **Helpers duplicados:**
   - `nowUtc` (erp, production, leads, odoo-sync) y `todayBogota` (erp, production).
   - `isoDate`/`range` (cash, invoices), `round2` (einvoice, nativeQuotes), `money` (quotations, invoices), `fail()` (materials, purchases, production).
   - La lista de medios de pago está repetida en `leads.js:1231` y `cash.js:19`.
   - Moverlos a `server/lib/{dates,money,http}.js`. Lo más urgente es un helper de rango de fechas Bogotá (ver A7).
6. **Archivos sobredimensionados:**
   - `routes/leads.js` (1354 líneas: Odoo, xlsx, pagos, cotización Odoo): separarlo en leads/payments/exports/odooQuotes.
   - `db.js` (1025 líneas: separar esquema y migraciones versionadas con `PRAGMA user_version` en lugar de "detectar el texto del CHECK").
   - `estadisticas.js` (1120), `cotizar.js` (1029), `reporting.js` (987).
7. **Polling:** `notifBell` (60 s) y `seguimiento` (60 s) piden datos aunque ya exista el WebSocket. Pueden reaccionar a eventos y recalcular solo el reloj en cliente.
8. **Retirar el código legado Odoo y `work_orders`** cuando se confirme que ya no se usa, o aislarlo detrás de un flag. Reduce superficie y confusión.

---

## 5. Plan recomendado (en orden)

1. **Backups completos y seguros:** `VACUUM INTO` del `.db` (semanal + manual + antes de factory-reset) y quitar `session_secret` de los dumps. (C3)
2. **Cerrar los huecos de seguridad:** escapar los títulos de modal (`modal.js`), MIME/`attachment` en los archivos de OP, `requireRole` en leads/clients/quotations para excluir a `produccion`, alcance del asesor en PATCH de clientes y auth en el WebSocket. (A1, A2, A3, M10, M11)
3. **IVA según régimen:** una sola función `ivaRateDefault()` a partir de `tax_regime`, usada en cotizaciones y facturas. Decidir con el contador si `leads.amount` es con o sin IVA y documentarlo. (C2)
4. **Unificar el cobro:**
   - `payments.invoice_id` (o `invoices.sales_order_id`), y que "Registrar cobro" de una factura emitida cree el abono.
   - "Por cobrar" = total − abonos ligados, y una sola Cartera.
   - Bloquear la doble facturación del mismo lead o pedido y el borrado de egresos ligados a facturas. (C1, M7, M8)
5. **Helper de fechas Bogotá** y aplicarlo en informe, reporting, leads, quotations y clients. (A7)
6. **Quitar `leads_visible` como filtro global** y dejar de sobrescribir `channel_detail` al cerrar; el filtro "solo Ads" pasa a ser opcional. (A4)
7. **Reconectar Producción ↔ Inventario ↔ Finanzas:**
   - `stock_movements.production_order_id` y consumo al atender solicitudes.
   - Rentabilidad sobre OP.
   - Exigir venta ganada (o monto) para crear el pedido.
   - Migrar la garantía #1. (A5, M5, M12)
8. **Sacar la llamada al proveedor de e-factura fuera de la transacción** antes de conectar un proveedor real, y prohibir transacciones anidadas en `db.transaction`. (A6)
9. **Robustez de datos:**
   - Borrado de lead con verificación previa.
   - Arreglar o retirar factory-reset.
   - Orden de migraciones de `quotations`.
   - Bloquear asignar leads cerrados.
   - Montos enteros y no negativos.
   - Store de sesiones persistente. (M1-M4, M13, M14)
10. **Índices** y paginar/filtrar en SQL GET `/api/leads` y `/api/clients`; extraer helpers compartidos. (Optimizaciones 1-5)
