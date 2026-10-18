/* ASF service worker: shows message / call notifications even when the app is closed. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch (e) { d = { title: 'ASF', body: event.data ? event.data.text() : 'New message' }; }
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    // If the app is open in front, it already shows its own in-app alert and plays the tone.
    if (wins.some((w) => w.visibilityState === 'visible' && w.focused)) return;
    const isCall = d.kind === 'call';
    await self.registration.showNotification(d.title || 'ASF', {
      body: d.body || 'New message',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-96.png',
      tag: d.tag || 'asf',
      renotify: true,
      requireInteraction: isCall,
      vibrate: isCall ? [600, 300, 600, 300, 600, 300, 600] : [200, 100, 200],
      data: { url: d.url || '/', chatId: d.chatId || null, kind: d.kind || 'message' },
    });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) {
      if ('focus' in w) { await w.focus(); w.postMessage({ type: 'notification-click', data: event.notification.data }); return; }
    }
    if (self.clients.openWindow) await self.clients.openWindow(url);
  })());
});
