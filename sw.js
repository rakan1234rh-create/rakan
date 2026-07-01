/* ATHAR — Web Push (يعمل عند إغلاق التطبيق إن كان مثبتاً على الشاشة الرئيسية) */
self.addEventListener('push', (event) => {
  let payload = { title: 'تنبيه', body: 'تنبيه جديد', url: './index.html' };
  try {
    if (event.data) payload = { ...payload, ...event.data.json() };
  } catch (_) { /* noop */ }

  const title = payload.title || 'تنبيه';
  const options = {
    body: payload.body || '',
    icon: './icons/athar-pwa-192-v393.png',
    badge: './icons/athar-pwa-192-v393.png',
    tag: payload.tag || payload.ticketId || 'athar-notif',
    renotify: !!(payload.broadcastId),
    dir: 'rtl',
    lang: 'ar',
    data: {
      url: payload.url || './index.html',
      ticketId: payload.ticketId || '',
      broadcastId: payload.broadcastId || ''
    }
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  let target = data.url || './index.html';
  if (data.broadcastId && !/broadcast=/.test(target)) {
    const sep = target.includes('?') ? '&' : '?';
    target = `${target}${sep}broadcast=${encodeURIComponent(data.broadcastId)}`;
  } else if (data.ticketId) {
    const sep = target.includes('?') ? '&' : '?';
    target = `${target}${sep}ticket=${encodeURIComponent(data.ticketId)}`;
  }

  event.waitUntil((async () => {
    const all = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of all) {
      if ('focus' in client) {
        await client.focus();
        if ('navigate' in client) {
          try { await client.navigate(target); } catch (_) { /* noop */ }
        }
        return;
      }
    }
    if (clients.openWindow) await clients.openWindow(target);
  })());
});
