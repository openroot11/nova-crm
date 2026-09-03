# Rediseño visual — progreso y continuación

Estado del rediseño de Nova CRM (inspirado en la plantilla "Pulse CRM" de Jidi.studio, ver imágenes `nuevo diseño*.png` en la raíz del proyecto). Este archivo es para retomar el trabajo en otra sesión/equipo sin perder contexto.

## Hecho

**Fase 1 — Sistema de diseño + Dashboard + Ventas**
- Paleta teal-verde nueva en `app/public/index.html` (`tailwind.config.colors`). `error` = rojo crítico, `tertiary` = naranja advertencia (antes eran casi el mismo rojo, poco distinguibles).
- Chart.js vía CDN, agregado en `app/public/index.html`.
- Sidebar reagrupado: "Ventas" agrupa Registro Operativo / SLA / Seguimiento en un `<details>` colapsable (`app/public/js/app.js` tiene la lógica de resaltado del grupo).
- Componentes nuevos reutilizables en `app/public/js/components/`: `charts.js` (barChart/groupedBarChart/donutChart/gaugeChart/sankeyChart + `destroyChart()` para limpiar al desmontar), `kpiTile.js`, `priorityActions.js`, `leadKanban.js`.
- `dashboard.js` reescrito: KPIs, tendencia de ventas, mapa de Colombia (ya existía, solo reestilizado), distribución del embudo, Meta de Ventas (gauge nuevo — requiere `monthly_sales_target` en `settings`, editable solo Admin), Acciones Prioritarias (nuevo, combina SLA + seguimiento), leads recientes.
- `ventas.js`: toggle Tabla/Tablero (Kanban) agregado; formulario y tabla de siempre intactos.
- Backend aditivo: `computeMonthlyTrend()` en `reporting.js`, `monthly_sales_target` en `routes/settings.js` + expuesto de solo lectura en `GET /api/kpis`.

**Fase 2 — SLA + Seguimiento**
- Consolidados a los helpers compartidos `slaBadge()` / `followupBadge()` de `utils.js` (antes cada vista duplicaba sus propios estilos — causó que "vencido" y "en riesgo" quedaran del mismo color naranja tras el cambio de paleta; ya corregido).
- Paginación "Mostrar más" (con datos reales la página se rompía: cientos de filas sin paginar).

**Fase 3 — Estadísticas**
- Las 3 gráficas hechas a mano (`conic-gradient` + divs con `style="width:X%"`) reemplazadas por Chart.js.
- Comparativo de periodos: checkbox "Comparar con periodo anterior" con deltas ▲/▼ en Resultados e Indicadores de desempeño.
- Nuevo: tarjeta "Flujo de Leads" (diagrama Sankey Canal → Producto → Resultado), usa `chartjs-chart-sankey` vía CDN + endpoint nuevo `GET /api/kpis/flow` (`computeChannelProductFlow` en `reporting.js`).
- Se corrigió una fuga de memoria: los charts de Chart.js no se destruían al cambiar de vista (Dashboard y Estadísticas ya los destruyen en el cleanup de `mount()`).

## Pendiente

**Fase 4 — Asesores + Informe + Ajustes** (no empezada)
- Es la más liviana: ya heredan la paleta nueva automáticamente (mismos tokens de Tailwind compartidos), no tienen gráficas que reemplazar, y no quedaron funciones nuevas planeadas ahí.
- Sugerido al retomar: revisar consistencia visual (cards, botones, espaciados) contra el resto de la app ya rediseñada. El widget "Mensajes recibidos" de Informe se puede comparar contra `datos leads.png` (captura de cómo se veía antes del rediseño, en la raíz del proyecto).

## Notas importantes

- **Paleta categórica** (productos, series de datos): vive en `CATEGORICAL_COLORS` (`components/charts.js`) y `PRODUCT_COLORS` (`components/colombiaMap.js`) — mismo orden fijo en toda la app, validado con la skill `dataviz`. **No reordenar ni reasignar** sin volver a correr el validador.
- **Colores de estado** (bueno/advertencia/crítico): `LEAD_STATUS_COLORS` en `utils.js` + tokens Tailwind `error` / `tertiary` / `status-*`.
- **Dependencias nuevas vía CDN** (`app/public/index.html`): Chart.js 4.4.4, `chartjs-chart-sankey` 0.14.0. Requieren internet la primera vez que carga esa pantalla (igual que Tailwind CDN, ya aceptado desde antes en el proyecto).
- **Incidente de datos (2026-08-11)**: se restauró de fábrica la base real (741 leads → 0), confirmado como intencional por el usuario en esa sesión. El backup automático completo de seguridad sigue en `app/server/backups/` (nunca se sube a git, está en `.gitignore`) por si se necesita.
- **Imágenes de referencia** en la raíz (`nuevo diseño*.png`): plantilla "Pulse CRM". La pantalla "AI Assistant" (funciones de IA) **no aplica** a Nova CRM — se descartó a propósito, no es un pendiente.
