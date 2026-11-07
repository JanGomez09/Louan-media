// Service worker: recibe las notificaciones push aunque la app esté cerrada.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }

  event.waitUntil(
    (async () => {
      // Si la app está abierta y a la vista, ya se avisa dentro de ella
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      if (windows.some((w) => w.visibilityState === 'visible')) return;

      await self.registration.showNotification(data.title || 'Louan Uscial Media', {
        body: data.body || 'Tienes un mensaje nuevo',
        tag: data.tag || 'uscial-chat',
        renotify: true, // vuelve a sonar aunque ya haya una notificación con la misma etiqueta
        icon: 'icon-192.png',
        badge: 'badge.png',
        data: { url: data.url || '#/chat' },
      });
    })()
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '#/chat', self.registration.scope).href;

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const w of windows) {
        if (w.url.startsWith(self.registration.scope)) {
          await w.focus();
          if ('navigate' in w) await w.navigate(target).catch(() => {});
          return;
        }
      }
      await self.clients.openWindow(target);
    })()
  );
});
