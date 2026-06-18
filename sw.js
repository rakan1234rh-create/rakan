/* ATHAR — Web Push (يعمل عند إغلاق التطبيق إن كان مثبتاً على الشاشة الرئيسية) */
const ATHAR_PUSH_BRAND = 'ATHAR';

function formatAtharPushDisplay(msgTitle, msgBody) {
  const headline = String(msgTitle || 'تنبيه').trim();
  const detail = String(msgBody || '').trim();
  if (detail) return { title: ATHAR_PUSH_BRAND, body: `${headline}\n${detail}` };
  return { title: ATHAR_PUSH_BRAND, body: headline };
}

self.addEventListener('push', (event) => {
  let payload = { title: 'تنبيه', body: 'تنبيه جديد', url: './index.html' };
  try {
    if (event.data) payload = { ...payload, ...event.data.json() };
  } catch (_) { /* noop */ }

  const display = formatAtharPushDisplay(payload.title, payload.body);
  const options = {
    body: display.body,
    icon: './icons/athar-pwa-192-v393.png',
    badge: './icons/athar-pwa-192-v393.png',
    tag: payload.tag || payload.ticketId || 'athar-notif',
    renotify: true,
    dir: 'rtl',
    lang: 'ar',
    data: {
      url: payload.url || './index.html',
      ticketId: payload.ticketId || '',
      broadcastId: payload.broadcastId || ''
    }
  };

  event.waitUntil(self.registration.showNotification(display.title, options));
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
