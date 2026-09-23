# Plan técnico: módulo de Producción (Velara CRM)

Respuesta a `Velara_CRM_Produccion_Especificacion_Aprobada.md`, sección 29 ("primero presentar un plan técnico basado en el proyecto real"). **Aprobado el 23-09-2026 e implementado** (ver secciones 8 y 9). La propuesta de la sección 1 sobre Inventario y Compras quedó reemplazada por la decisión 2 de la sección 8: se conservan como aplicaciones aparte.

---

## 1. Qué hay hoy en el proyecto (análisis, fase 1)

**Stack:** Node.js + Express, SQLite local (`node:sqlite`, `server/data/nova_crm.db`) y frontend en JavaScript sin paso de compilación (módulos ES en `public/js/views`, Tailwind). El tiempo real va por WebSocket (`broadcast(...)`), los PDF se hacen con `pdfkit` y el login es por sesión, con tres roles: `admin`, `coordinador` y `asesor`.

**Entidades que se reutilizan (principio 27.2):**

| Existe | Uso en Producción |
|---|---|
| `clients` y `leads` | Cliente, contacto, teléfono, dirección y asesor comercial (`assigned_advisor_id`). No se duplican: la OP las referencia a través del Pedido. |
| `quotations` y `quotation_lines` (estados borrador → enviada → seguimiento → **aprobada** → venta) | Origen del Pedido. Una cotización aprobada se "envía a producción". |
| `velaraServices` (campos por servicio: marca, modelo, año, material, color…) | Producto de la OP y primeras especificaciones técnicas. |
| `workers` (operarios, creado en `erp-taller`) | Responsable de la OP y operarios de las tareas. |
| `users` | Autor de cada evento del historial y de cada aprobación. |
| `warranty_claims` y el acta de entrega PDF | Siguen existiendo; pasan a colgar de la OP entregada. |
| Patrón de PDF de Velara (logo, colores, tipografías) | Orden de Producción, ficha de producción y documento de fabricación. |

**Conflicto con lo construido hoy en la rama `erp-taller`:**
- Inventario (kárdex, stock, ajustes) y **Compras** (recibir un pedido suma stock) están fuera del alcance de esta fase (secciones 2 y 30).
- Las órdenes de trabajo actuales **descuentan stock**, y la especificación lo prohíbe.
- **Rentabilidad** (Finanzas) se calcula con el costo del material consumido, así que depende del inventario.

Propuesta: sacar de la aplicación **Inventario, Compras, la pestaña Rentabilidad y el consumo de material de las órdenes**, y conservar ese código en una rama aparte (`erp-inventario`) para cuando se apruebe la fase de Inventario. Se quedan **Caja y Cartera** (no son inventario) y **Garantías**. Las "Órdenes de trabajo" actuales se **reemplazan** por la Orden de Producción. Sus datos son de ejemplo, así que no hay nada real que migrar.

---

## 2. Entidades y relaciones

```
clients / leads ──< quotations
        │
        └──< sales_orders (Pedido, PED-2026-00001) ──< production_orders (OP-2026-0001)
                                                            ├──< production_specs          (clave/valor por sección)
                                                            ├──< production_files          (archivos y versiones de diseño)
                                                            ├──< material_requirements ──< material_requests (SM-0001)
                                                            ├──< production_tasks          (con operario)
                                                            ├──< production_workers        (operarios asignados a la OP)
                                                            ├──< production_blocks
                                                            ├──< production_reviews        (control / revisión)
                                                            ├──< production_approvals      (confirmación del asesor + firma)
                                                            ├──< production_deliveries     (lista para entregar / entregada)
                                                            ├──< warranty_claims           (ya existe; cambia la llave a la OP)
                                                            └──< activity_log              (historial, también para el pedido)
```

### Tablas nuevas (campos principales)

- **`sales_orders`** (Pedido comercial): `number` (PED-AAAA-NNNNN, automático), `quotation_id` (opcional), `lead_id`, `client_id`, `contact`, `phone`, `address`, `destination`, `advisor_id`, `requested_date`, `received_at`, `status` (`recibido`, `por_validar`, `info_solicitada`, `validado`, `cancelado`), `info_request` (qué información falta), `notes`.
- **`production_orders`** (OP): `number` (OP-AAAA-NNNN, automático, único y reiniciado cada año), `sales_order_id`, `product_name`, `product_code`, `service_slug`, `quantity`, `unit`, `received_at`, `requested_date`, `committed_date`, `start_date` (programación), `priority` (`baja`, `normal`, `alta`, `urgente`), `responsible_worker_id`, `advisor_id`, `status`, `paused_from` (estado al que vuelve cuando se levanta el bloqueo), `observations`, `closed_at`, `cancel_reason`, `created_by`, `created_at`, `updated_at`. Cliente, contacto y dirección **no se copian**: se leen del pedido (principio 27.1).
- **`production_specs`**: `op_id`, `section` (`producto` o `tecnica`), `label`, `value` y `position`. Es clave/valor para que se puedan agregar campos sin rediseñar la OP (sección 10). Se prellena con los campos del servicio de la cotización.
- **`production_files`**: `op_id`, `kind` (`diseno`, `plano`, `ficha`, `foto`, `pdf`, `otro`), `group_name` (ej. "Diseño principal"), `version`, `is_current`, `original_name`, `stored_path`, `mime`, `size`, `note`, `uploaded_by`, `uploaded_at`. Nunca se borra un archivo: una versión nueva solo marca la anterior como no vigente (sección 11).
- **`material_requirements`**: `op_id`, `material`, `code`, `qty`, `unit`, `notes`, `status` (`pendiente`, `solicitado`, `disponible`, `bloqueado`).
- **`material_requests`**: `number` (SM-0001), `op_id`, `requirement_id`, `material`, `qty`, `unit`, `reason`, `status` (`pendiente`, `atendida`, `cancelada`), `requested_by` y `created_at`. **No toca ningún stock**; es la "bandeja" que leerá el futuro módulo de Inventario.
- **`production_tasks`**: `op_id`, `name`, `worker_id`, `planned_date`, `started_at`, `finished_at`, `status` (`pendiente`, `en_proceso`, `completada`, `bloqueada`), `notes` y `position`. **Progreso de la OP** = tareas completadas ÷ total.
- **`production_workers`**: `op_id` y `worker_id` (operarios asignados a la OP, sección 14).
- **`production_blocks`**: `op_id`, `reason` (`info_incompleta`, `diseno_pendiente`, `aprobacion_pendiente`, `material_pendiente`, `problema_produccion`, `otro`), `responsible` (persona o área, ej. "Compras"), `notes`, `status` (`activo` o `resuelto`), `created_by`, `created_at`, `resolved_by`, `resolved_at` y `resolution`.
- **`production_reviews`**: `op_id`, `result` (`aprobado` o `correccion`), `checklist` (JSON: producto terminado, cantidad, medidas, características, acabados y diseño correcto, cada uno ok/no), `notes`, `reviewed_by` y `created_at`.
- **`production_approvals`**: `op_id`, `advisor_id`, `confirm_features`, `confirm_quantities`, `confirm_design`, `signature_path` (firma dibujada en pantalla y guardada como imagen), `signed_name`, `created_by` y `created_at`.
- **`production_deliveries`**: `op_id`, `kind` (`lista` o `entregada`), `date`, `responsible`, `review_done`, `authorized_by`, `notes` y `created_by`.
- **`activity_log`**: `entity` (`op` o `pedido`), `entity_id`, `user_id`, `action`, `detail` y `created_at`. Se escribe **desde el servidor** en cada operación, nunca desde la pantalla, para que no se pueda saltar.

**Borrado:** ninguna de estas tablas tiene "eliminar" físico (principio 27.6). OP, pedidos y solicitudes se **cancelan** con motivo; tareas y requerimientos pasan a estado anulado.

---

## 3. Estados y transiciones (fase 3)

La máquina de estados vive en el servidor. Cada cambio exige usuario, guarda fecha y hora, pide motivo cuando corresponde y queda en el historial.

| Desde | Hacia | Condición / validación |
|---|---|---|
| (crear) | **Por validar** | Al crear la OP desde un pedido |
| Por validar | **Programada** | Información completa: producto, cantidad, fecha comprometida y responsable. Si falta algo, "Solicitar información" (queda en el historial y la OP sigue en Por validar) |
| Programada | **En producción** | Sin bloqueos activos |
| Programada / En producción | **Pausada** | Automático al registrar un bloqueo activo (se guarda `paused_from`) |
| Pausada | estado anterior | Automático al resolver el último bloqueo activo |
| En producción | **Control / revisión** | — |
| Control | **En producción** (corrección) | Revisión con resultado "requiere corrección" y motivo obligatorio |
| Control | **Lista para entregar** | Revisión **aprobada** + aprobación del asesor registrada (sección 21) |
| Lista | **Entregada** | Fecha, responsable y observaciones |
| Entregada | **Cerrada** | — |
| Cualquiera antes de Entregada | **Cancelada** | Motivo obligatorio |

**Alertas de fecha** (sección 16), contra la fecha comprometida:

| Estado | Cuándo |
|---|---|
| 🟢 En tiempo | Más de 3 días |
| 🟡 Próxima | 2 o 3 días |
| 🟠 En riesgo | Hoy o mañana |
| 🔴 Vencida | Ya pasó y la OP no está entregada |

Los umbrales se podrán cambiar desde Ajustes.

---

## 4. Pantallas y rutas

La sección **"Taller"** del menú pasa a llamarse **"Producción"**:

| Pantalla | Contenido | Especificación |
|---|---|---|
| **Tablero** (`#/produccion`) | 8 indicadores, Kanban de 6 columnas, búsqueda, filtros y los 9 filtros rápidos | 17 y 18 |
| **Pedidos** (`#/pedidos`) | Pedidos recibidos y por validar, validación, "solicitar información" y crear una o varias OP | 3 y 4 |
| **Programación** (`#/programacion`) | Calendario mensual y línea de tiempo por responsable, con alerta de sobrecarga | 19 |
| **Detalle de OP** (`#/op?id=…`) | Página completa con pestañas: Resumen · Producto · Especificaciones · Diseños y archivos · Materiales · Tareas · Control y aprobaciones · Bloqueos · Entrega · Historial | 8 a 24 |
| **Solicitudes de material** (`#/solicitudes-material`) | Bandeja de solicitudes (solo registro, sin inventario) | 12 |
| **Garantías** | La que ya existe, ligada a la OP | — |
| **Reportes de producción** | Fase 10 | 25 |

**Entradas al flujo:**
- Desde **Cotizar**: una cotización aprobada tiene el botón **"Enviar a producción"**, que crea el Pedido con los datos de la cotización.
- Desde **Pedidos**: un pedido manual, para trabajos que no pasaron por cotización.

**Documentos PDF** (sección 22), con la identidad de Velara:

| Documento | Para qué | Contenido |
|---|---|---|
| **Orden de Producción** | Documento oficial | Formato de la sección 22, con firmas de asesor y producción |
| **Ficha de producción** | Técnica | Especificaciones, requerimientos de material y diseño vigente (miniatura si es imagen) |
| **Documento de fabricación** | Para el piso del taller | Lista de tareas con casillas, responsables y fechas, para imprimir y marcar |

**Archivos:** se guardan en `server/data/uploads/op/<id>/` (dentro de la carpeta de datos, así entran en los respaldos) y se sirven por una ruta que exige sesión. El límite propuesto es de 20 MB por archivo. Para recibirlos se agrega la librería `multer`, que es la estándar de Express.

---

## 5. Permisos

Se propone un **rol nuevo: `produccion`** (jefe de producción o taller).

| Acción | admin | coordinador | produccion | asesor |
|---|:-:|:-:|:-:|:-:|
| Ver tablero, OP y programación | ✅ | ✅ | ✅ | ✅ solo OP de sus clientes |
| Crear pedido desde cotización | ✅ | ✅ | — | ✅ sus cotizaciones |
| Validar pedido / crear OP | ✅ | ✅ | ✅ | — |
| Cambiar estados, tareas, bloqueos, archivos, requerimientos | ✅ | ✅ | ✅ | — |
| Registrar control / revisión | ✅ | ✅ | ✅ | — |
| Aprobación comercial (confirmaciones + firma) | ✅ | ✅ | — | ✅ sus clientes |
| Cancelar OP | ✅ | ✅ | ✅ con motivo | — |
| Operarios, umbrales de alerta | ✅ | ✅ | ✅ | — |

Los **operarios no inician sesión** (no son usuarios). El responsable o jefe de producción marca las tareas por ellos. Dar acceso a los operarios se puede evaluar después.

---

## 6. Migraciones

1. Tablas nuevas con `CREATE TABLE IF NOT EXISTS`, igual que el resto de `db.js`.
2. `users.role`: la restricción CHECK no se puede cambiar con `ALTER`, así que se reconstruye la tabla para aceptar `produccion`, con el mismo procedimiento que ya usan `ensureQuotationsStateCheck` y `ensureReportsTypeCheck`.
3. `warranty_claims`: se agrega `production_order_id`.
4. Se retiran las tablas del ERP de ejemplo que dependen de inventario (`work_orders`, `materials`, `stock_movements`, `purchase_orders`, `purchase_order_lines`, `suppliers`) de esta rama. Su código queda en `erp-inventario`. `cash_entries` (Caja) se conserva.
5. `scripts/seed-produccion.js` crea datos de ejemplo: pedidos, OP en todos los estados, tareas, un bloqueo, archivos de muestra y solicitudes de material.

---

## 7. Fases de implementación

Se sigue el orden de la sección 28. Cada fase se prueba antes de pasar a la siguiente.

| Fase | Entrega |
|---|---|
| 1. Arquitectura | Este documento, aprobado |
| 2. OP | Pedidos, OP con consecutivo, cliente, producto, fechas y responsable; enviar a producción desde Cotizar |
| 3. Flujo | Estados, transiciones con validaciones e historial (`activity_log`) |
| 4. Tablero | Indicadores, Kanban, alertas, búsqueda y filtros rápidos |
| 5. Tareas | Tareas, operarios, responsables y % de progreso |
| 6. Diseños y documentos | Archivos con versiones y los 3 PDF |
| 7. Materiales | Requerimientos y solicitudes de material, sin inventario |
| 8. Aprobaciones | Confirmaciones del asesor, firma y bloqueo del paso a "Lista" |
| 9. Bloqueos | Motivos, responsables, pausa automática, alertas e historial |
| 10. Reportes | Recibidas, programadas, en producción, entregadas, retrasadas, bloqueadas, por responsable, por período, tiempos y cumplimiento |

---

## 8. Decisiones aprobadas (23-09-2026)

1. **Navegación por aplicaciones, como Odoo** (ver `inicio.png`): la pantalla **Inicio** muestra íconos de aplicaciones: Comercial, Producción, Inventario, Compras, Finanzas, Tableros, Reportes y Configuración. Al entrar a una aplicación, el menú lateral muestra solo sus pantallas.
2. **Producción es una aplicación propia** y **no toca el inventario**: no descuenta stock y solo genera Solicitudes de material. **Inventario y Compras no se borran**: quedan como aplicaciones aparte, separadas de Producción (sección 2 de la especificación). La pestaña **Rentabilidad** de Finanzas se oculta mientras Producción no consuma material, porque sin consumo no tiene datos.
3. **Rol nuevo `produccion`**: sí.
4. **El Pedido nace de la cotización aprobada** ("Enviar a producción") **o de un registro manual**.
5. **"Taller" pasa a llamarse "Producción".** La OP reemplaza a la "Orden de trabajo" de ejemplo, y las garantías pasan a colgar de la OP.

---

## 9. Estado de la implementación (23-09-2026)

Las fases 1 a 10 están construidas en la rama `erp-taller`, **sin commit**, con **datos de ejemplo** (`server/scripts/seed-produccion.js`).

| Pieza | Dónde |
|---|---|
| Inicio con aplicaciones (como Odoo) | `public/js/apps.js`, `views/inicio.js`, `app.js` |
| Esquema, rol `produccion` y migraciones | `server/db.js` (`PRODUCTION_SCHEMA_SQL`, `ensureUsersRoleCheck`, `ensureWarrantyClaimsNullable`) |
| Reglas: estados, validaciones, bloqueos que pausan la OP, historial | `server/production.js` |
| API | `server/routes/production.js` (`/api/production/...`) |
| Documentos PDF: orden, ficha, fabricación y acta | `server/productionPdf.js` |
| Pantallas | `views/produccion.js` (tablero), `pedidos.js`, `programacion.js`, `op.js` (detalle con 10 pestañas), `solicitudesMaterial.js`, `reportesProduccion.js`, `garantias.js`, `operarios.js` |
| Entrada desde Comercial | Cotizar → botón "Enviar a producción" (cotización aprobada o vendida) |

**Pendiente o por decidir:**
- **Datos reales:** operarios, materiales y proveedores.
- **Umbrales de alerta editables desde Ajustes:** hoy son fijos. En tiempo es más de 3 días; Próxima, 2 a 3; En riesgo, hoy o mañana.
- **Lado de Inventario de las solicitudes de material:** es una fase futura. Hoy "atendida" es solo un estado.
- **Rentabilidad en Finanzas:** está oculta hasta que Producción e Inventario se conecten.
