const CACHE = 'fcm-v1';
const STATIC = [
  '/',
  '/index.html',
  '/matches.html',
  '/stats.html',
  '/roster.html',
  '/player.html',
  '/team.html',
  '/teams.html',
  '/rankings.html',
  '/style.css',
  '/script.js',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(STATIC))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Never intercept Google Sheets — let sessionStorage handle those
  if (url.hostname.includes('google') || url.hostname.includes('googleapis')) return;

  // HTML: stale-while-revalidate (instant load, update in background)
  if (e.request.destination === 'document') {
    e.respondWith(
      caches.open(CACHE).then(async cache => {
        const cached = await cache.match(e.request);
        const fetchPromise = fetch(e.request)
          .then(res => { cache.put(e.request, res.clone()); return res; })
          .catch(() => cached);
        return cached || fetchPromise;
      })
    );
    return;
  }

  // CSS/JS: cache-first
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
