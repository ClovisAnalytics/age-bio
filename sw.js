// Âge bio — service worker : l'app s'ouvre hors ligne après la première visite (cache d'abord).
// À chaque livraison : incrémenter N dans CACHE et APP_VERSION dans calc.js.
const CACHE = 'agebio-v4';
const FILES = [
  './', 'index.html', 'style.css', 'app.js', 'calc.js',
  'sql-wasm.js', 'sql-wasm.wasm', 'manifest.webmanifest',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(FILES.map(f => new Request(f, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  // ignoreSearch : « index.html?demo » est servi par la page en cache.
  event.respondWith(caches.match(request, { ignoreSearch: true }).then(hit => hit ?? fetch(request)));
});
