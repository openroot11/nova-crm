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

Ventas (registro operativo + filtros), SLA (Control 24h), Informe (resumen diario para WhatsApp, con datos reales del sistema como referencia), Estadísticas (KPIs, gráficas y comparativo por asesor), Asesores (equipo y perfiles), Ajustes (exportación y mantenimiento).

## Acceso al sistema

La aplicación pide una contraseña compartida por todo el equipo (no hay cuentas individuales, es una sola clave para las 3-4 personas que la usan).

**Primer uso**: la primera vez que alguien abre el sistema, la pantalla de login pide "crear contraseña" en vez de "iniciar sesión" — lo que se escriba ahí (con su confirmación) queda guardado como la contraseña del equipo desde ese momento. No hay contraseña por defecto: la define quien primero use el sistema. Después de ese primer registro, todos los demás usan esa misma contraseña para entrar.

Si se necesita cambiar la contraseña más adelante, hay que borrar la clave `admin_password_hash` de la tabla `settings` en la base de datos (o restaurar de fábrica) para volver a activar el flujo de "primer uso".

## Reglas de negocio implementadas

- **Embudo real de ventas**: cada lead pasa por 5 estados: `asignado` → `contactado` → `cotizado` → `cerrado_ganado` / `cerrado_perdido`. "Contactado" y "Cotizado" se marcan explícitamente con botones en Ventas/SLA (ya no se auto-marcan al crear el lead), así que el % de contacto y de cotización reflejan la realidad y no un dato inflado automáticamente.
- **Asesores reales**: el equipo comercial son 3 personas — Harol, Oscar y Roberto.
- **Fuente/canal del lead**: todo cliente que entra registra su canal de origen (`source`), con "WhatsApp - Google Ads" como valor por defecto (la mayoría de los casos), y también "WhatsApp - Orgánico", "Referido" u "Otro".
- **Categorías de producto**: Carpas, Cortinas, Gramas, Baby Gym, Forros, Pisos Vinílicos, u "Otro" (con texto libre).
- **Asignación manual**: al registrar un cliente en Alta Rápida, se elige explícitamente a qué asesor activo se le asigna (no hay rotación automática). El selector solo muestra asesores no pausados.
- **SLA**: cada lead tiene 24h para cerrarse. Se marca "en riesgo" cuando faltan 2h o menos, y "vencido" al pasar las 24h. Las alertas se ven en tiempo real en las vistas Ventas y SLA.
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
