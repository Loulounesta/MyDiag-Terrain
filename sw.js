// Service worker MyDiag-DPE — stratégie "cache d'abord, revalidation en arrière-plan".
// L'application s'affiche instantanément depuis le cache (même sur réseau lent en chantier) ;
// chaque ressource est rafraîchie en tâche de fond, et un nouveau service worker (nouveau
// nom de cache) déclenche dans la page le bandeau « Nouvelle version disponible ».
const CACHE = 'mydiag-v9-6';
const ASSETS = [
  './',
  './index.html',
  './css/app.css',
  './js/app.js',
  './apple-touch-icon.png',
  './manifest.json',
  './lib/localforage.min.js',
  './lib/xlsx.full.min.js',
  './lib/jszip.min.js',
  './lib/pdf.min.js',
  './lib/pdf.worker.min.js'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.allSettled(ASSETS.map(a => c.add(a))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// La page interroge le worker pour connaître sa version : le bandeau
// « Nouvelle version disponible » ne s'affiche que si elle diffère de la sienne.
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'VERSION?') {
    const port = e.ports && e.ports[0];
    if (port) port.postMessage({ cache: CACHE });
  }
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const enCache = await cache.match(e.request, { ignoreSearch: true });
    const reseau = fetch(e.request).then(resp => {
      if (resp && resp.ok) cache.put(e.request, resp.clone());
      return resp;
    }).catch(() => null);
    if (enCache) { e.waitUntil(reseau); return enCache; }
    const resp = await reseau;
    return resp || Response.error();
  })());
});
