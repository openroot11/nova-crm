# SalesForce CRM — Operativo

Aplicación interna de ventas/operaciones: registro de clientes con asignación manual de asesor, control de SLA (24h), estadísticas de ventas, gestión del equipo y exportación de datos.

Reemplaza los mockups estáticos originales (`code.html` en las carpetas hermanas) por un programa funcional con base de datos real y sincronización en vivo entre dispositivos de la misma red. El diseño visual (colores, tipografía, componentes) se dejó igual al prototipo original de Stitch.

## Requisitos

- **Node.js 22.5 o superior** (se probó con Node 24 LTS). Ya quedó instalado en este equipo durante el desarrollo — si necesitas reinstalarlo en otra PC, descárgalo de https://nodejs.org (elige la versión "LTS").
- No necesita internet para funcionar (solo la primera vez, para `npm install` y para cargar la fuente Inter/íconos de Google Fonts — si la oficina no tiene internet, todo lo demás sigue funcionando, solo cambia la tipografía/íconos por la alternativa del sistema).

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
  server/     Backend (Node.js + Express + SQLite integrado + WebSocket)
  public/     Frontend (HTML/CSS/JS, sin paso de compilación)
  iniciar.bat Lanzador para Windows
```

La base de datos vive en `server/data/nova_crm.db` (se crea sola la primera vez). Los backups automáticos/manuales se guardan en `server/backups/`.

## Módulos

Ventas (registro operativo + filtros), SLA (Control 24h), Seguimiento Activo (cotizaciones sin respuesta del cliente), Informe (resumen diario para WhatsApp, con datos reales del sistema como referencia), Estadísticas (KPIs, rendimiento por asesor con ranking y SLA, rentabilidad de leads/ROI de Google Ads, historial de reportes archivados), Asesores (equipo y perfiles), Ajustes (exportación, mantenimiento y gestión de usuarios/roles).

## Reportes (rendimiento y rentabilidad)

En Estadísticas, además del comparativo por asesor (ahora con % de cumplimiento SLA, horas promedio de cierre y ranking por monto vendido), hay dos secciones nuevas:

- **Rentabilidad de Leads**: compara los leads recibidos por canal/origen (`channel_detail`) contra la inversión en Google Ads del periodo (se registra el gasto mensual a mano, mes por mes, en la misma sección) — calcula costo por lead, costo por venta y ROI. Solo tiene sentido de costo para el canal "Google Ads"; los demás canales (Orgánico, Referido, Otro) se muestran solo con volumen y conversión.
- **Historial de Reportes**: el botón "Generar y archivar" (en Rendimiento por Asesor o en Rentabilidad de Leads) guarda una foto fija de esos números en ese momento, con quién lo generó y cuándo — queda disponible para descargar en Excel después, sin depender de una carpeta externa. El snapshot no se recalcula solo: si los datos cambian después, el reporte archivado sigue mostrando lo que había el día que se generó (es un registro histórico, no una vista en vivo).

Generar reportes y ver rentabilidad de leads requiere rol Coordinador o Dueño/Admin; borrar un reporte del historial requiere Dueño/Admin.

## Acceso al sistema

Cada persona entra con su propio usuario y contraseña. Hay tres roles:

- **Dueño / Admin**: acceso total — usuarios, configuración, exportación, restaurar de fábrica, reportes financieros completos.
- **Coordinador**: el rol operativo del día a día (quien recibe el primer mensaje del cliente) — registra y asigna leads, reasigna, marca contactado/cotizado en cualquier lead, ve Informe y Estadísticas del equipo completo.
- **Asesor**: ve y avanza únicamente sus propios leads (marcar contactado/cotizado/cerrado); no puede registrar leads nuevos, reasignar, ni ver reportes del equipo.

**Primer uso**: si nunca se ha creado ninguna cuenta, la pantalla de login pide crear la primera (queda como Dueño/Admin). Desde ahí, en Ajustes → Usuarios y Roles se crean las cuentas del resto del equipo, indicando su rol y, si es Asesor, a qué asesor del roster queda vinculado (así el sistema sabe cuáles son "sus" leads).

**Migración desde la versión de clave compartida**: si el sistema ya se usaba con la contraseña única anterior, al iniciar por primera vez con esta versión se crea automáticamente un usuario `admin` que hereda esa misma contraseña, para no dejar a nadie bloqueado. Desde esa cuenta se crean las demás.

Si se necesita restablecer la contraseña de alguien, un Admin puede hacerlo desde Ajustes → Usuarios y Roles ("Restablecer clave"), sin necesidad de tocar la base de datos directamente.

## Reglas de negocio implementadas

- **Embudo real de ventas**: cada lead pasa por 5 estados: `asignado` → `contactado` → `cotizado` → `cerrado_ganado` / `cerrado_perdido`. "Contactado" y "Cotizado" se marcan explícitamente con botones en Ventas/SLA (ya no se auto-marcan al crear el lead), así que el % de contacto y de cotización reflejan la realidad y no un dato inflado automáticamente.
- **Asesores reales**: el equipo comercial son 3 personas — Harol, Oscar y Roberto.
- **Fuente/canal del lead**: todo cliente que entra registra su canal de entrada (`source`: WhatsApp, Correo, Llamada u Otro) y, por separado, su origen (`channel_detail`: Google Ads, Orgánico, Referido u Otro; "Google Ads" es el valor por defecto porque es la mayoría de los casos). Se guardan como dos campos distintos a propósito: `source` es el canal que usa el informe diario, `channel_detail` es el dato que alimenta el reporte de rentabilidad de leads (costo por lead y ROI de Google Ads).
- **Categorías de producto**: Carpas, Cortinas, Gramas, Baby Gym, Forros, Pisos Vinílicos, u "Otro" (con texto libre).
- **Asignación manual**: al registrar un cliente en Alta Rápida, se elige explícitamente a qué asesor activo se le asigna (no hay rotación automática). El selector solo muestra asesores no pausados.
- **SLA**: cada lead tiene 24h para cerrarse. Se marca "en riesgo" cuando faltan 2h o menos, y "vencido" al pasar las 24h. Las alertas se ven en tiempo real en las vistas Ventas y SLA.
- **Seguimiento activo**: un lead en estado "cotizado" que lleva más de 24h sin ningún toque (ni seguimiento registrado, ni cierre) aparece en Seguimiento Activo como "pendiente"; a partir de 72h pasa a "urgente". Registrar un seguimiento reinicia el reloj sin cambiar el estado del embudo. Es un reloj distinto al SLA (que es sobre el primer contacto, no sobre la cotización).
- **Reasignar**: siempre disponible manualmente desde Ventas o SLA; queda registrado en el historial y afecta el % de cumplimiento SLA del asesor origen. Reasignar NO reinicia el progreso del embudo (si ya estaba contactado/cotizado, el nuevo asesor hereda ese avance).
- **Pausar/Reactivar asesor**: desde Asesores. Un asesor pausado deja de aparecer como opción al registrar un nuevo cliente.
- **Filtros de leads**: en Ventas se puede filtrar el listado por asesor, producto, estado, canal de entrada y rango de fechas.
- **Comparativo por asesor** (`GET /api/kpis/funnel`): en Estadísticas, tabla con Asignados/Contactados/Cotizados/Vendidos/Perdidos y sus tasas de conversión por asesor, en un rango de fechas elegible — este es el reporte real que el encargado usa para comparar el desempeño del equipo ante su jefe.
- **Informe diario**: pestaña separada del registro de Ventas. Muestra primero los "Datos reales del sistema" (calculados automáticamente desde los leads de ese día, solo lectura) y debajo la tabla manual editable de Asignados/Contactados/Cotizados/Pendientes + registro de ventas del día, para armar el texto listo para copiar y pegar en WhatsApp (botón "Copiar informe"). Los datos reales sirven de referencia; el guardado manual sigue existiendo por si se necesita ajustar algo a mano.
- **Exportaciones**: Excel (.xlsx) y JSON desde Ajustes, con datos reales de la base.
- **Restaurar de fábrica**: borra todo (con confirmación escrita) y vuelve a los 3 asesores por defecto (Harol, Oscar, Roberto).

## Solución de problemas

- **"node no se reconoce como comando"**: abre una ventana nueva de CMD/PowerShell (el PATH se actualiza al abrir una nueva ventana después de instalar Node) o reinicia el equipo.
- **Otro equipo no puede conectarse**: confirma que ambos equipos están en la misma red WiFi, y que el Firewall de Windows no está bloqueando Node.js (la primera vez que arrancas el servidor, Windows suele preguntar si permites el acceso — elige "Permitir acceso").
- **Puerto ocupado**: si el 4000 ya está en uso, arranca con otro puerto: `set PORT=4001 && npm start` (o edítalo en `iniciar.bat`).
