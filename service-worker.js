// service-worker.js — Canopeo offline support (app-shell cache-first).
//
// Strategy:
//   install  → pre-cache every static asset the app needs
//   activate → delete any old cache versions left by previous installs
//   fetch    → serve from cache first; fall back to network if not cached
//
// Bump CACHE_VERSION whenever you deploy a new build so users get fresh files.

const CACHE_VERSION = 'canopeo-v1';

const PRECACHE_URLS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.webmanifest',
  './vendor/exif.js',
  './vendor/jszip.min.js',
  './vendor/FileSaver.js',
  './icons/icon-192.png',
  './icons/icon-256.png',
  './icons/icon-512.png',
  './icons/favicon-32.png',
  './icons/favicon-16.png',
  './demo/demo_1.jpg',
  './demo/demo_2.jpg',
  './demo/demo_3.jpg',
];

// ── Install: pre-cache all shell assets ──────────────────────────────────────

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting()) // activate immediately without waiting for old SW to die
  );
});

// ── Activate: prune stale caches ─────────────────────────────────────────────

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_VERSION)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim()) // take control of already-open pages
  );
});

// ── Fetch: cache-first, then network ─────────────────────────────────────────

self.addEventListener('fetch', (event) => {
  // Only intercept same-origin GET requests.  Cross-origin requests (e.g.
  // Google Analytics in the old Drag&Drop version) pass through untouched.
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;

      // Not in cache — fetch from network and cache the response for next time.
      return fetch(event.request)
        .then((response) => {
          // Only cache valid, non-opaque responses.
          if (!response || response.status !== 200 || response.type !== 'basic') {
            return response;
          }
          const clone = response.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(event.request, clone));
          return response;
        })
        .catch(() => {
          // Network failed and we have no cached copy — for navigation requests
          // return the cached index.html shell so the app at least loads.
          if (event.request.mode === 'navigate') {
            return caches.match('./index.html');
          }
        });
    })
  );
});
