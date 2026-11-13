/* BodegaControl PWA - service worker, solo archivos locales, sin red externa */
const CACHE = 'bodegacontrol-pwa-v6';
const FILES = ['index.html', 'style.css', 'app.js', 'db.js', 'db-worker.js', 'db-schema.sql',
  'vendor/sqlite3/sqlite3.mjs', 'vendor/sqlite3/sqlite3.wasm', 'vendor/sqlite3/sqlite3-opfs-async-proxy.js',
  'manifest.json', 'icon.svg'];
self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(FILES); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.match(e.request, {ignoreSearch: true}).then(function (r) {
    return r || fetch(e.request).catch(function () { return caches.match('index.html'); });
  }));
});
