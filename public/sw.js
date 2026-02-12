self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => {
  const data = e.data ? e.data.json() : {};
  e.waitUntil(
    self.registration.showNotification(data.title || 'oncall', {
      body: data.body || '',
      icon: 'icon.svg',
      tag: data.tag || data.messageId || undefined,
      data: { url: data.url || '/', messageId: data.messageId }
    })
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = e.notification.data?.url || '/';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const c of clients) {
        if (c.url === new URL(url, self.location.origin).href && 'focus' in c) {
          return c.focus();
        }
      }
      return self.clients.openWindow(url);
    })
  );
});
