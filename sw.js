const CACHE = 'fcm-cache-v2';
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
    caches.open(CACHE)
      .then(c => c.addAll(STATIC))
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

async function networkFirst(request, cache) {
  try {
    const res = await fetch(request);
    if (res.ok) cache.put(request, res.clone());
    return res;
  } catch {
    return cache.match(request);
  }
}

async function staleWhileRevalidate(request, cache) {
  const cached = await cache.match(request);
  const fetchPromise = fetch(request)
    .then(res => {
      if (res.ok) cache.put(request, res.clone());
      return res;
    })
    .catch(() => cached);
  return cached || fetchPromise;
}

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Never intercept Google Sheets — let sessionStorage handle those
  if (url.hostname.includes('google') || url.hostname.includes('googleapis')) return;

  // HTML: stale-while-revalidate (instant load, update in background)
  if (e.request.destination === 'document') {
    e.respondWith(
      caches.open(CACHE).then(cache => staleWhileRevalidate(e.request, cache))
    );
    return;
  }

  // Images & fonts: cache-first
  if (e.request.destination === 'image' || e.request.destination === 'font') {
    e.respondWith(
      caches.match(e.request).then(cached => cached || fetch(e.request))
    );
    return;
  }

  // script.js, style.css, and other same-origin assets: network-first
  e.respondWith(
    caches.open(CACHE).then(cache => networkFirst(e.request, cache))
  );
});
