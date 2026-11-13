/* BodegaControl PWA - service worker, solo archivos locales, sin red externa */
const CACHE = 'bodegacontrol-pwa-v16';
/* vendor/ NO va en la precache: el wasm (688 KB) tardaba minutos en bajar
   con conexion lenta y el service worker nuevo no tomaba el control hasta
   terminar, dejando la pagina nueva con los archivos viejos. vendor/ se
   guarda en cache la primera vez que se usa (ver el fetch de abajo). */
const FILES = ['index.html', 'style.css', 'app.js', 'db.js', 'db-worker.js', 'db-schema.sql', 'respaldo.js',
  'manifest.json', 'icon.svg', 'icono-bodegacontrol.webp', 'icon-192.png', 'icon-512.png'];
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
  var url = new URL(e.request.url);
  /* vendor/: archivos grandes que casi nunca cambian -> de la cache, y si
     no estan, de la red guardandolos para la proxima (asi funcionan sin
     internet despues del primer uso). */
  if (url.pathname.indexOf('/vendor/') !== -1) {
    e.respondWith(caches.match(e.request, {ignoreSearch: true}).then(function (r) {
      if (r) return r;
      return fetch(e.request).then(function (resp) {
        var copy = resp.clone();
        caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
        return resp;
      });
    }));
    return;
  }
  /* App shell (html/css/js/sql): red primero, cache como respaldo.
     Asi una actualizacion nunca deja la pagina nueva con los archivos
     viejos: con cache-primero el documento llegaba nuevo de la red
     mientras el service worker viejo servia el css/js viejos de su
     cache (eso paso con el menu lateral en v12). Sin red, la cache
     sirve la ultima generacion completa, que es coherente. */
  e.respondWith(fetch(e.request).then(function (resp) {
    var copy = resp.clone();
    caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
    return resp;
  }).catch(function () {
    return caches.match(e.request, {ignoreSearch: true}).then(function (r) {
      return r || caches.match('index.html');
    });
  }));
});
