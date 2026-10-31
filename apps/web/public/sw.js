// GolfScoreHQ service worker: phone notifications, and keeping the app's files
// so it opens on the course with no signal.
//
// Pages: the network first, so the app is always the latest version when
// there's signal; the last copy only when there isn't (or it takes over 4 s).
// /assets/ files have a fingerprint in their names and never change, so a kept
// copy is always right. League data isn't kept here; the app keeps that itself.

const FILES = 'gshq-files-v1';
const PAGE = '/index.html';
const MAX_FILES = 250;
const STATIC = /^\/(assets\/|icon-|favicon|apple-touch-icon|manifest\.webmanifest|splash-poster)/;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil((async () => {
  for (const k of await caches.keys()) if (k.startsWith('gshq-') && k !== FILES) await caches.delete(k);
  await self.clients.claim();
})()));

async function keep(cache, req, res) {
  if (!res || !res.ok || res.status !== 200 || res.type === 'opaque') return;
  await cache.put(req, res);
  const keys = await cache.keys();
  for (const k of keys.slice(0, Math.max(0, keys.length - MAX_FILES))) await cache.delete(k);
}

async function page(req) {
  const cache = await caches.open(FILES);
  const fresh = fetch(req).then(async (res) => {
    if (res.ok && (res.headers.get('content-type') || '').includes('text/html')) await keep(cache, PAGE, res.clone());
    return res;
  });
  const kept = await cache.match(PAGE);
  if (!kept) return fresh;
  const slow = new Promise((resolve) => setTimeout(() => resolve(null), 4000));
  return (await Promise.race([fresh.catch(() => null), slow])) || kept;
}

async function file(req) {
  const cache = await caches.open(FILES);
  const kept = await cache.match(req);
  if (kept) return kept;
  const res = await fetch(req);
  await keep(cache, req, res.clone());
  return res;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.mode === 'navigate') return event.respondWith(page(req));
  if (STATIC.test(url.pathname) && !req.headers.has('range')) event.respondWith(file(req));
});

// The app hands over what it downloaded before this worker was running.
self.addEventListener('message', (event) => {
  if (event.data?.type !== 'keep' || !Array.isArray(event.data.urls)) return;
  event.waitUntil((async () => {
    const cache = await caches.open(FILES);
    for (const u of event.data.urls) {
      const url = new URL(u, self.location.origin);
      if (url.origin !== self.location.origin || !STATIC.test(url.pathname) || (await cache.match(url.href))) continue;
      try { await keep(cache, url.href, await fetch(url.href)); } catch { /* try again next visit */ }
    }
    if (!(await cache.match(PAGE))) {
      try { await keep(cache, PAGE, await fetch('/')); } catch { /* next visit */ }
    }
  })());
});

self.addEventListener('push', (event) => {
  let msg = { title: 'GolfScoreHQ', body: '', url: '/leagues' };
  try { msg = { ...msg, ...event.data.json() }; } catch { /* plain text or empty */ }
  event.waitUntil(self.registration.showNotification(msg.title, {
    body: msg.body,
    icon: '/icon-192.png',
    badge: '/favicon-64.png',
    tag: msg.tag,
    data: { url: msg.url },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || '/leagues', self.location.origin).href;
  event.waitUntil((async () => {
    const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of open) {
      if (new URL(c.url).origin === self.location.origin) {
        await c.focus();
        return c.navigate(url);
      }
    }
    return self.clients.openWindow(url);
  })());
});
