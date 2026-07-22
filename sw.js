const CACHE_NAME = 'hva-mohoua-v1';
const urlsToCache = [
    '/',
    '/index.html',
    '/images/icon.png'
];

// Installation du Service Worker et mise en cache des fichiers essentiels
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                return cache.addAll(urlsToCache);
            })
    );
});

// Interception des requêtes réseau pour servir le cache si besoin
self.addEventListener('fetch', event => {
    event.respondWith(
        caches.match(event.request)
            .then(response => {
                return response || fetch(event.request);
            })
    );
});
