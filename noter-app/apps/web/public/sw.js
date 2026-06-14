// Noter service worker.
//
// IMPORTANT — why this is network-first for navigations/code:
// A previous version served the page HTML stale-while-revalidate. That meant the
// browser kept loading an OLD HTML document, which pinned OLD hashed JS bundles,
// so users ran stale code for many visits after every deploy — folders leaked
// into notes, the CalDAV picker was empty, i18n keys showed, the timeout banner
// fired. All four were the SAME root cause: stale cached code. This SW now always
// fetches fresh HTML (and therefore fresh JS) when online, and only falls back to
// cache when offline. Bump CACHE_NAME on any cache-shape change to purge old data.
const CACHE_NAME = 'noter-cache-v4';
const STATIC_ASSETS = [
  '/app/favicon.ico',
  '/app/manifest.json',
  '/app/file-text.svg',
  '/app/globe.svg'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS).catch(() => {}))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => Promise.all(
        cacheNames.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name))
      ))
      .then(() => self.clients.claim())
  );
});

// Allow the page to tell a waiting SW to take over immediately.
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

const isHashedStatic = (pathname) =>
  pathname.startsWith('/_next/static/') ||
  pathname.startsWith('/app/_next/static/') ||
  /\.(png|jpg|jpeg|svg|gif|webp|woff2?)$/.test(pathname);

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.pathname.includes('socket.io')) return;

  // API: always network, never cache; synthesise an offline marker on failure so
  // the client's own offline handling kicks in.
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request).catch(() =>
        new Response(JSON.stringify({ offline: true, message: 'You are offline' }), {
          headers: { 'Content-Type': 'application/json' },
        })
      )
    );
    return;
  }

  // Hashed immutable static assets: cache-first is safe — the URL changes when the
  // content changes, so a cached hit is always the right bytes.
  if (isHashedStatic(url.pathname)) {
    event.respondWith(
      caches.match(request).then((cached) =>
        cached || fetch(request).then((response) => {
          if (response && response.status === 200) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        })
      )
    );
    return;
  }

  // Navigations & everything else (HTML documents, non-hashed assets): NETWORK
  // FIRST so fresh code always wins when online; fall back to cache only offline.
  const isNavigation = request.mode === 'navigate' ||
    (request.headers.get('accept') || '').includes('text/html');

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response && response.status === 200 && (isNavigation || response.type === 'basic')) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request).then((cached) => cached || Response.error()))
  );
});
