/* ═══════════════════════════════════════════
   service-worker.js — TPL PWA
   Stratégie : cache-first pour les fichiers locaux,
   cache-at-runtime pour le CDN Tabler.
══════════════════════════════════════════════ */

const CACHE_NAME  = 'tpl-v29';
const TABLER_URL  = 'https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@3.19.0/dist/tabler-icons.min.css';

const PRECACHE_URLS = [
  './',
  './index.html',
  './style.css',
  './firebase.js',
  './app.js',
  './data.js',
  './auth.js',
  './calendar.js',
  './member.js',
  './admin.js',
  './onboarding.js',
  './install-guide.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable.png',
];

/* ── Install : précache les fichiers locaux ── */
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        // Précache local (doit réussir)
        const localPromise = cache.addAll(PRECACHE_URLS);
        // Précache CDN (optionnel — échec silencieux si hors ligne)
        const cdnPromise   = fetch(TABLER_URL, { mode: 'cors' })
          .then(res => cache.put(TABLER_URL, res))
          .catch(() => {});
        return Promise.all([localPromise, cdnPromise]);
      })
      .then(() => self.skipWaiting())
  );
});

/* ── Activate : supprime les anciens caches ── */
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

/* ── Fetch : cache-first avec fallback réseau ── */
self.addEventListener('fetch', event => {
  // Ignorer les requêtes non-GET et les extensions navigateur
  if (event.request.method !== 'GET') return;
  if (event.request.url.startsWith('chrome-extension://')) return;

  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;

      // Pas en cache → réseau, puis mise en cache
      return fetch(event.request)
        .then(response => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME)
              .then(cache => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => {
          // Hors ligne + non en cache : retourner index.html pour la navigation
          if (event.request.mode === 'navigate') {
            return caches.match('./index.html');
          }
        });
    })
  );
});
