# Integración con Google Ads — guía de activación

El código ya está listo (ver `server/googleAds.js`, `server/googleAdsSync.js`,
`server/routes/googleAds.js`) pero queda **apagado** hasta que exista lo que
se describe aquí — mientras tanto el CRM sigue funcionando exactamente igual
que antes (inversión manual en Estadísticas).

## Qué hace, en 3 partes

1. **Gasto automático**: cada ~6h trae de la API el costo por campaña y día
   de los últimos 35 días, y con eso rellena `ad_spend` (lo que antes se
   tecleaba a mano en Estadísticas → Rentabilidad de Leads). Si algún mes
   ya lo corrigió alguien a mano, la sync nunca lo pisa.
2. **Desglose por campaña**: la tabla `google_ads_campaign_stats` queda
   disponible para Estadísticas → Rentabilidad de Leads (costo, clics,
   conversiones por campaña, no solo el total).
3. **Reportar ventas cerradas como conversión**: cuando se cierra un lead
   como "Ganado", si tiene un `gclid` guardado, el CRM sube esa venta a
   Google Ads como conversión offline. **Esta parte por ahora no tiene
   datos reales**: nada en el CRM captura el `gclid` todavía (el campo del
   lead ya existe, pero nadie lo llena) — ver la sección "Sobre la parte 3"
   más abajo antes de asumir que esto ya está funcionando.

## Prerrequisito

Una cuenta de Google Ads con campañas activas (con método de pago
cargado). Sin esto no hay nada que traer — la API no da datos de una cuenta
vacía. Créala en https://ads.google.com si todavía no existe.

## Paso 1 — Developer Token

1. Entra a https://ads.google.com con la cuenta de Google Ads.
2. Herramientas → Configuración → **Centro de API** (API Center).
3. Solicita un token. Para empezar alcanza con **acceso Básico** (Basic
   Access) — deja probar la integración con datos reales de esta cuenta sin
   esperar la aprobación de acceso Estándar. Google puede tardar de horas a
   un par de días en aprobarlo.
4. Copia el token → `GOOGLE_ADS_DEVELOPER_TOKEN`.

## Paso 2 — Proyecto de Google Cloud + credenciales OAuth

1. https://console.cloud.google.com → crea un proyecto (o usa uno existente).
2. **APIs y servicios → Biblioteca** → busca "Google Ads API" → Habilitar.
3. **APIs y servicios → Credenciales → Crear credenciales → ID de cliente
   de OAuth**. Tipo de aplicación: "Aplicación de escritorio" (Desktop app)
   — es la forma más simple de generar el refresh token a mano.
4. Copia el **Client ID** y **Client Secret** → `GOOGLE_ADS_CLIENT_ID` /
   `GOOGLE_ADS_CLIENT_SECRET`.

## Paso 3 — Refresh token

La forma más rápida es con el [OAuth 2.0 Playground](https://developers.google.com/oauthplayground):

1. Ícono de engranaje (arriba a la derecha) → marca "Use your own OAuth
   credentials" → pega el Client ID y Client Secret del paso 2.
2. En el panel izquierdo, en el campo de scope escribe:
   `https://www.googleapis.com/auth/adwords` → Authorize APIs.
3. Inicia sesión con la cuenta de Google que tiene acceso a Google Ads.
4. Click "Exchange authorization code for tokens" → copia el **Refresh
   token** → `GOOGLE_ADS_REFRESH_TOKEN`.

## Paso 4 — Customer ID

En https://ads.google.com, el número de 10 dígitos arriba a la derecha
(ej. "123-456-7890"). Ponlo sin guiones en `GOOGLE_ADS_CUSTOMER_ID`.

Si se entra a través de una cuenta administradora/MCC (una cuenta que
administra la cuenta real de Nova), pon el ID de la MCC en
`GOOGLE_ADS_LOGIN_CUSTOMER_ID` y el ID de la cuenta real (donde están las
campañas) en `GOOGLE_ADS_CUSTOMER_ID`.

## Paso 5 — Llenar `server/.env` y reiniciar

Copia los 5 valores a `server/.env` (ver `server/.env.example`), guarda, y
reinicia el servidor (`iniciar.bat` o `npm start`). En la consola debería
aparecer:

```
[google-ads-sync] revisando Google Ads cada 6h (gasto por campaña -> ad_spend)
```

En Ajustes → "Conexión con Google Ads" debe verse "Conectado" con el nombre
de la cuenta. Si no, el mensaje de error indica qué falta.

## Sobre la parte 3 (reportar conversiones)

Esto solo tiene efecto real si el lead llega al CRM con un `gclid` (el
parámetro que Google agrega a la URL cuando alguien hace clic en un
anuncio). Hoy los leads entran manualmente (Alta Rápida, pegando datos de
WhatsApp) — no hay ningún paso que capture ese parámetro.

Para que esta parte tenga datos reales, hace falta **una de estas dos
cosas**, según cómo estén armadas las campañas (avísame cuando las tengas
listas para decidir cuál aplica y conectarlo):

- Si los anuncios llevan a una **landing page con formulario**: esa página
  debe leer `gclid` de la URL y mandarlo junto con los demás datos cuando
  el lead llega al CRM (`POST /api/leads` ya acepta un campo `gclid`
  opcional).
- Si son anuncios de **"Clic para WhatsApp"**: el gclid no llega igual;
  ahí lo normal es que Google ya cuente el clic al WhatsApp como
  conversión por su cuenta, sin necesidad de que el CRM reporte nada de
  vuelta.

Además, para que el reporte de ventas funcione hace falta crear en Google
Ads una **acción de conversión** de tipo "Importar → desde otras fuentes de
datos o CRM → Realizar un seguimiento manual de conversiones utilizando
llamadas a la API" y poner su ID en `GOOGLE_ADS_CONVERSION_ACTION_ID`.
