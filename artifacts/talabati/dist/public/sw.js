/* Mizu — Web Push Service Worker */

self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: 'Mizu', body: event.data.text(), url: '/driver-dashboard' };
  }

  const title = payload.title ?? 'Mizu';
  const options = {
    body:    payload.body  ?? 'طلب جديد في منطقتك!',
    icon:    '/favicon.svg',
    badge:   '/favicon.svg',
    dir:     'rtl',
    lang:    'ar',
    vibrate: [100, 50, 100],
    data:    { url: payload.url ?? '/driver-dashboard' },
    actions: [
      { action: 'open', title: 'عرض الطلبات' },
      { action: 'close', title: 'إغلاق' },
    ],
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'close') return;

  const targetUrl = event.notification.data?.url ?? '/driver-dashboard';
  const origin    = self.location.origin;
  const fullUrl   = origin + targetUrl;

  event.waitUntil(
    clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((windowClients) => {
        // Focus an existing tab that already has the app open
        for (const client of windowClients) {
          if (client.url.startsWith(origin) && 'focus' in client) {
            client.navigate(fullUrl);
            return client.focus();
          }
        }
        // Otherwise open a new tab
        if (clients.openWindow) {
          return clients.openWindow(fullUrl);
        }
      })
  );
});
