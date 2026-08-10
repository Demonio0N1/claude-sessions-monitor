// Service worker de CSM: carga instantánea sin quedarse pegado en versiones viejas.
// - /assets/* llevan hash en el nombre (inmutables): caché primero, red si falta.
// - index.html y demás: red primero (siempre la última versión), caché de respaldo
//   para abrir la app sin conexión.
// - API/WS/binarios: nunca se tocan.
const CACHE = 'csm-v1';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    (async () => {
      for (const k of await caches.keys()) {
        if (k !== CACHE) await caches.delete(k);
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  const p = url.pathname;
  if (p.startsWith('/api') || p.startsWith('/ws') || p.startsWith('/bin') || p === '/install.sh') return;

  if (p.startsWith('/assets/')) {
    e.respondWith(
      caches.open(CACHE).then(async (c) => {
        const hit = await c.match(e.request);
        if (hit) return hit;
        const res = await fetch(e.request);
        if (res.ok) c.put(e.request, res.clone());
        return res;
      }),
    );
  } else {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(e.request, copy));
          }
          return res;
        })
        .catch(async () => (await caches.match(e.request)) ?? Response.error()),
    );
  }
});
