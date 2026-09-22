# Nova CRM — Operativo

Aplicación interna de ventas/operaciones: registro de clientes con asignación manual de asesor, control de SLA (24h), estadísticas de ventas, gestión del equipo y exportación de datos.

Reemplaza los mockups estáticos originales (`code.html` en las carpetas hermanas) por un programa funcional con base de datos real y sincronización en vivo entre dispositivos de la misma red. El diseño visual (colores, tipografía, componentes) se dejó igual al prototipo original de Stitch.

## Requisitos

- **Node.js 22.5 o superior** (se probó con Node 24 LTS). Ya quedó instalado en este equipo durante el desarrollo — si necesitas reinstalarlo en otra PC, descárgalo de https://nodejs.org (elige la versión "LTS").
- **No requiere internet**: la base de datos es un archivo local (`server/data/nova_crm.db`) — el programa funciona sin conexión; solo hace falta red local (WiFi/LAN) para que otros dispositivos del equipo se conecten al mismo servidor.

## Cómo iniciar

**Opción fácil:** haz doble clic en `iniciar.bat`. La primera vez instalará las dependencias automáticamente (puede tardar un minuto); las siguientes veces arranca directo.

**Manual:**
```
cd app/server
npm install     (solo la primera vez)
npm start
```

Al iniciar, la consola muestra algo así:
```
En esta PC:      http://localhost:4000
Otros equipos:   http://192.168.0.157:4000
```

- En la misma PC: abre la primera URL en cualquier navegador.
- Desde otro computador/tablet en la **misma red WiFi/LAN**: abre la segunda URL (la IP puede variar según la red) — todos ven los mismos datos, sincronizados en vivo.

Deja la ventana de la consola abierta mientras el equipo esté usando el sistema — si la cierras, el servidor se apaga y nadie podrá acceder hasta que lo vuelvas a iniciar.

## Estructura

```
app/
  server/     Backend (Node.js + Express + SQLite + WebSocket)
  public/     Frontend (HTML/CSS/JS, sin paso de compilación)
  iniciar.bat Lanzador para Windows
  docs/       Notas del proyecto, tecnologías, diseño (logo/paleta) y referencias
```

La carpeta `documentos-clientes/` (cotizaciones, RUT, informes) es solo local y no se sube al repositorio.

Los backups automáticos/manuales (exportación JSON) se guardan en `server/backups/`.

## Base de datos

Los datos reales viven en `server/data/nova_crm.db`, un archivo SQLite local — se crea solo la primera vez que arranca el servidor. No requiere ninguna configuración ni conexión externa.

Para mover el sistema a otra PC: copia toda la carpeta `server/data/` a la carpeta `server/` del equipo nuevo antes de iniciar por primera vez (si no la copias, arranca con una base de datos vacía).

## Módulos

Ventas (registro operativo + filtros), SLA (Control 24h), Seguimiento Activo (cotizaciones sin respuesta del cliente), Informe (resumen diario para WhatsApp, con datos reales del sistema como referencia), Estadísticas (KPIs, rendimiento por asesor con ranking y SLA, rentabilidad de leads/ROI de Google Ads, historial de reportes archivados), Asesores (equipo y perfiles), Ajustes (exportación, mantenimiento y gestión de usuarios/roles).

**Ventas (Registro Operativo)**: 4 tarjetas KPI arriba (Total Leads, Vendidos, Monto Vendido, Tasa de Cierre — sobre el rango filtrado) y debajo solo tablero Kanban por estado (Asignado/Contactado/Cotizado/Cerrado) — ya no hay vista de tabla, y las tarjetas de lead ya no muestran una etiqueta aparte de "Vencido"/"En riesgo": siempre se ve el estado del embudo (el detalle de SLA sigue disponible en Control SLA). La columna Cerrado se puede angostar a una franja delgada (botón `‹`/`›` en su encabezado) para no quitarle espacio a las demás sin ocultar esos leads del conteo ni de ningún otro lado. Los filtros son Estado, Asesor, Producto, Canal y Fecha (un selector: Hoy / Ayer / Hace más de 3 días) — Asesor solo lo ve Coordinador/Admin (un Asesor ya ve nomás lo suyo). Si Odoo está conectado, hay además un check "Solo sin Odoo" para encontrar leads sin oportunidad ligada allá, y las tarjetas muestran un ícono de aviso (sin Odoo) o un link "Ver en Odoo" (con oportunidad) según el caso. El buscador y la campana de notificaciones (alertas SLA) son propios de esta pantalla, no fijos en el encabezado global — las demás vistas quedan sin ese buscador/campana ahí. Alta Rápida arranca oculta (el tablero ocupa todo el ancho) — se abre con el botón "Nuevo Cliente" y se cierra sola al registrar (o con la X) para no estorbar el resto del tiempo. Un Asesor ve lo mismo que Coordinador/Admin, solo que sin Alta Rápida ni "Generar informe" (exportar Excel).

**Colores**: el rojo de marca (Blood/Lava) queda reservado para el logo y los botones de acción principal (Registrar, Guardar, Cerrar venta...). Todo lo que antes lo usaba de forma ambiental — ítem activo del menú lateral, bordes de foco en inputs, hovers de botones secundarios y enlaces — pasa a tonos neutros (gris/blanco). Los badges de estado del embudo (ej. "Cotizado" en rosa) no cambiaron: ese es un esquema de color por etapa, no un acento decorativo.

**Pegar y autocompletar (Alta Rápida)**: un cuadro de texto arriba del formulario reconoce el bloque de datos que normalmente llega de un cliente potencial (nombre o razón social, NIT/cédula, dirección, ciudad, teléfono, correo — con o sin emoji, con o sin ":" entre la etiqueta y el valor) y reparte cada dato en su campo automáticamente al pegar (o con el botón "Autocompletar" si se pegó/escribió antes). Reconoce variantes cortas de etiqueta ("cel", "tel", "cc", "whatsapp", "móvil"), separa dos datos que llegan en la misma línea ("Nit 900907223-4 cel 3135555035") sin confundir un guion que es parte del dato (NIT, dirección con "15-72") con un separador, y si nadie puso "Nombre:" toma la primera línea sin ninguna etiqueta conocida como nombre/razón social. La ciudad se empareja contra el catálogo aunque venga sin tildes ("bogota" → "Bogotá"); si no la reconoce, avisa para elegirla a mano. Cliente, dirección y correo ahora son campos propios del cliente (antes solo existían nombre/teléfono/documento) — se editan también desde su ficha en Clientes.

## Reportes (rendimiento y rentabilidad)

En Estadísticas, además del comparativo por asesor (ahora con % de cumplimiento SLA, horas promedio de cierre y ranking por monto vendido), hay dos secciones nuevas:

- **Rentabilidad de Leads**: compara los leads recibidos por canal/origen (`channel_detail`) contra la inversión en Google Ads del periodo (se registra el gasto mensual a mano, mes por mes, en la misma sección) — calcula costo por lead, costo por venta y ROI. Solo tiene sentido de costo para el canal "Google Ads"; los demás canales (Orgánico, Referido, Otro) se muestran solo con volumen y conversión.
- **Historial de Reportes**: el botón "Generar y archivar" (en Rendimiento por Asesor o en Rentabilidad de Leads) guarda una foto fija de esos números en ese momento, con quién lo generó y cuándo — queda disponible para descargar en Excel después, sin depender de una carpeta externa. El snapshot no se recalcula solo: si los datos cambian después, el reporte archivado sigue mostrando lo que había el día que se generó (es un registro histórico, no una vista en vivo).

Generar reportes y ver rentabilidad de leads requiere rol Coordinador o Dueño/Admin; borrar un reporte del historial requiere Dueño/Admin.

## Acceso al sistema

Cada persona entra con su propio usuario y contraseña. Hay tres roles:

- **Dueño / Admin**: acceso total — usuarios, configuración, exportación, restaurar de fábrica, reportes financieros completos.
- **Coordinador**: el rol operativo del día a día (quien recibe el primer mensaje del cliente) — registra y asigna leads, reasigna, marca contactado/cotizado en cualquier lead, ve Informe y Estadísticas del equipo completo.
- **Asesor**: ve y avanza únicamente sus propios leads (marcar contactado/cotizado/cerrado) y puede corregir sus datos básicos (nombre, teléfono, producto, referencia, fecha de registro, etc.) mientras sigan activos; también puede reasignar uno de sus propios leads si ya está **vencido** (SLA >24h). No puede registrar leads nuevos, reasignar un lead a tiempo o en riesgo, editar una venta ya cerrada (monto/fecha de cierre quedan bloqueados), exportar a Excel, ni ver reportes del equipo. Su menú es Ventas (Registro Operativo + Control SLA) y Clientes — Seguimiento Activo (alertas de equipo) queda solo para Coordinador/Admin.

**Primer uso**: si nunca se ha creado ninguna cuenta, la pantalla de login pide crear la primera (queda como Dueño/Admin). Desde ahí, en Ajustes → Usuarios y Roles se crean las cuentas del resto del equipo, indicando su rol y, si es Asesor, a qué asesor del roster queda vinculado (así el sistema sabe cuáles son "sus" leads).

**Migración desde la versión de clave compartida**: si el sistema ya se usaba con la contraseña única anterior, al iniciar por primera vez con esta versión se crea automáticamente un usuario `admin` que hereda esa misma contraseña, para no dejar a nadie bloqueado. Desde esa cuenta se crean las demás.

Si se necesita restablecer la contraseña de alguien, un Admin puede hacerlo desde Ajustes → Usuarios y Roles ("Restablecer clave"), sin necesidad de tocar la base de datos directamente.

## Reglas de negocio implementadas

- **Embudo real de ventas**: cada lead pasa por 5 estados: `asignado` → `contactado` → `cotizado` → `cerrado_ganado` / `cerrado_perdido`. "Contactado" y "Cotizado" se marcan explícitamente con botones en Ventas/SLA (ya no se auto-marcan al crear el lead), así que el % de contacto y de cotización reflejan la realidad y no un dato inflado automáticamente.
- **Asesores reales**: el equipo comercial son 3 personas — Harol, Oscar y Roberto.
- **Fuente/canal del lead**: todo cliente que entra registra su canal de entrada (`source`: WhatsApp, Correo, Llamada u Otro) y, por separado, su origen (`channel_detail`: Google Ads, Orgánico, Referido u Otro; "Google Ads" es el valor por defecto porque es la mayoría de los casos). Se guardan como dos campos distintos a propósito: `source` es el canal que usa el informe diario, `channel_detail` es el dato que alimenta el reporte de rentabilidad de leads (costo por lead y ROI de Google Ads).
- **Categorías de producto**: Carpas, Cortinas, Gramas, Baby Gym, Forros, Pisos Vinílicos, Banderas, u "Otro" (con texto libre).
- **Semáforo de carga por asesor**: cada asesor activo tiene un color — 🟢 Verde (0 leads vencidos, prioridad normal), 🟡 Amarillo (1-2 vencidos, asignación reducida a la mitad), 🔴 Rojo (3+ vencidos, no se le asigna nada nuevo). Se calcula solo desde cuántos de sus leads llevan vencidos (>24h sin contactar o sin cotizar, mismo criterio que Control SLA), no desde su histórico de ventas. Un Coordinador/Admin puede forzar el color a mano desde Asesores (queda fijo hasta que lo regrese a "Automático"). Si **todos** los asesores activos caen en rojo a la vez, la exclusión no bloquea la operación por completo — se reparte entre todos igual, con aviso, para no dejar el sistema sin forma de registrar un cliente nuevo.
- **Asignación sugerida por turnos**: en Alta Rápida, el sistema sugiere a qué asesor le toca el siguiente cliente — reparte por turnos entre los que no están en rojo, dándole al Verde el doble de leads que al Amarillo (según cuántos ha recibido cada quien hoy). El Coordinador confirma ese turno o pulsa "Elegir otro" para asignar manualmente como antes. El dropdown manual (aquí y al reasignar) sigue el mismo criterio del semáforo: oculta a los en rojo y a los pausados, salvo que no quede nadie más disponible.
- **SLA**: cada lead tiene 24h para cerrarse. Se marca "en riesgo" cuando faltan 2h o menos, y "vencido" al pasar las 24h. Las alertas se ven en tiempo real en las vistas Ventas y SLA.
- **Seguimiento activo**: un lead en estado "cotizado" que lleva más de 24h sin ningún toque (ni seguimiento registrado, ni cierre) aparece en Seguimiento Activo como "pendiente"; a partir de 72h pasa a "urgente". Registrar un seguimiento reinicia el reloj sin cambiar el estado del embudo. Es un reloj distinto al SLA (que es sobre el primer contacto, no sobre la cotización).
- **Reasignar**: siempre disponible manualmente desde Ventas o SLA para Coordinador/Admin; queda registrado en el historial y afecta el % de cumplimiento SLA del asesor origen. Reasignar NO reinicia el progreso del embudo (si ya estaba contactado/cotizado, el nuevo asesor hereda ese avance). Un Asesor también puede reasignar, pero solo un lead propio que ya está **vencido** (SLA >24h) — para un lead a tiempo o en riesgo, la reasignación la sigue decidiendo Coordinador/Admin.
- **Pausar/Reactivar asesor**: desde Asesores. Un asesor pausado deja de aparecer como opción al registrar un nuevo cliente.
- **Filtros de leads**: en Ventas se puede filtrar el listado por asesor, producto, estado, canal de entrada y rango de fechas.
- **Comparativo por asesor** (`GET /api/kpis/funnel`): en Estadísticas, tabla con Asignados/Contactados/Cotizados/Vendidos/Perdidos y sus tasas de conversión por asesor, en un rango de fechas elegible — este es el reporte real que el encargado usa para comparar el desempeño del equipo ante su jefe.
- **Informe diario**: pestaña separada del registro de Ventas. Asignados/Contactados/Cotizados/Pendientes y las ventas del día se calculan solos, en vivo, desde los leads reales (nadie los vuelve a escribir a mano) — para armar el texto listo para copiar y pegar en WhatsApp (botón "Copiar informe"). Lo único que sigue siendo manual es "Leads del día" (WhatsApp/Correo/Llamadas): son todos los mensajes/llamadas que llegan, incluso los que nunca se registran como lead, así que ese conteo no lo puede saber el sistema solo.
- **Registro con fecha atrasada**: Alta Rápida y las acciones del embudo (marcar contactado/cotizado, cerrar, reasignar) aceptan una fecha/hora real distinta a "ahora" — para meter clientes, ventas o cotizaciones de días anteriores con su fecha verdadera en vez de escribirlos aparte. Así el Informe, Estadísticas y Rentabilidad de esos días cuadran solos, sin doble captura.
- **Exportaciones**: Excel (.xlsx) y JSON desde Ajustes, con datos reales de la base.
- **Restaurar de fábrica**: borra todo (con confirmación escrita) y vuelve a los 3 asesores por defecto (Harol, Oscar, Roberto).

## Solución de problemas

- **"node no se reconoce como comando"**: abre una ventana nueva de CMD/PowerShell (el PATH se actualiza al abrir una nueva ventana después de instalar Node) o reinicia el equipo.
- **Otro equipo no puede conectarse**: confirma que ambos equipos están en la misma red WiFi, y que el Firewall de Windows no está bloqueando Node.js (la primera vez que arrancas el servidor, Windows suele preguntar si permites el acceso — elige "Permitir acceso").
- **Puerto ocupado**: si el 4000 ya está en uso, arranca con otro puerto: `set PORT=4001 && npm start` (o edítalo en `iniciar.bat`).
- **"Falta DATABASE_URL en .env" o error de conexión al arrancar**: falta el archivo `server/.env` o no tiene internet — ver la sección "Base de datos" arriba.
