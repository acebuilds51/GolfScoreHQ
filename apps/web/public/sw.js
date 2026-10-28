// GolfScoreHQ phone notifications. This worker only shows notifications and
// opens the app when one is tapped; it doesn't cache pages, so the app is
// always the latest version.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

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
