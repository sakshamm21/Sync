/*
 * Sync's service worker. It does two small things:
 *  - shows Web Push notifications (reminders, waitlist moves, announcements,
 *    cancellations) even when the app is closed, and opens the event on tap;
 *  - exists at all, which is what lets browsers offer "Install app".
 * It deliberately caches nothing: every page and API call goes to the network.
 */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data;
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'Sync', body: event.data ? event.data.text() : '' };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'Sync', {
      body: data.body || '',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: data.tag,
      data: { url: data.url || '/notifications' },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || '/', self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      const open = windows.find((w) => w.url === url);
      if (open) return open.focus();
      return self.clients.openWindow(url);
    })
  );
});
