// Service worker minimo, solo para que Brave/Chrome consideren la app
// "instalable" (uno de sus requisitos es tener un service worker con
// manejador de fetch). NO cachea nada a proposito -- este CRM sincroniza en
// vivo por WebSocket, asi que servir una respuesta vieja desde cache seria
// peor que no tener service worker. Cada fetch se deja pasar tal cual a la
// red (sin event.respondWith, el navegador lo maneja normal).
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', () => {
  /* no-op a proposito: sin cache, todo pasa directo a la red */
});
