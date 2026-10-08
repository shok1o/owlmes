const CACHE = 'owl-shell-v22';
const SHELL = ['/', '/manifest.json', '/icon-192.png', '/icon-512.png', '/apple-touch-icon.png'];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE)
            .then((c) => Promise.all(SHELL.map((u) => c.add(u).catch(() => {}))))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
            .then(() => clients.claim())
    );
});

// Заглушка, если нет сети и страницы нет в кэше
const offlineHtml = `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Owl | Нет сети</title>
  <style>
    body { font-family: -apple-system, 'Segoe UI', Roboto, sans-serif; background-color: #0b0913; color: #ffffff; margin: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; text-align: center; }
    h1 { color: #ff3b30; margin-bottom: 10px; }
    p { color: #8c86a6; max-width: 280px; font-size: 15px; line-height: 1.4; }
    .icon { font-size: 60px; margin-bottom: 15px; opacity: 0.8; }
  </style>
</head>
<body>
  <div class="icon">📡</div>
  <h1>Нет интернета</h1>
  <p>Приложение восстановит работу автоматически, как только появится связь.</p>
</body>
</html>`;

self.addEventListener('fetch', (event) => {
    const req = event.request;
    const url = new URL(req.url);
    // Firebase, Cloudflare и прочие внешние запросы не трогаем
    if (req.method !== 'GET' || url.origin !== self.location.origin) return;

    if (req.mode === 'navigate') {
        // Страницы: сначала сеть, при ошибке — кэш, затем заглушка.
        // cache: 'no-cache' — всегда сверяемся с сервером (GitHub Pages разрешает кэшировать 10 минут,
        // из-за этого приложение с экрана «Домой» показывало старую версию)
        event.respondWith(
            fetch(req, { cache: 'no-cache' }).then((res) => {
                if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
                return res;
            }).catch(() => caches.match(req).then((r) => r || caches.match('/')).then((r) => r || new Response(offlineHtml, {
                headers: { 'Content-Type': 'text/html; charset=utf-8' }
            })))
        );
        return;
    }
    // Статика: из кэша, обновляем в фоне
    event.respondWith(
        caches.match(req).then((cached) => {
            const net = fetch(req).then((res) => {
                if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
                return res;
            }).catch(() => cached);
            return cached || net;
        })
    );
});

// Клик по уведомлению о сообщении — открываем приложение и нужный чат
self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const chatId = event.notification.data && event.notification.data.chatId;
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
            const client = list.find((c) => new URL(c.url).origin === self.location.origin);
            if (client) {
                if (chatId) client.postMessage({ type: 'open-chat', chatId: chatId });
                return client.focus();
            }
            return clients.openWindow(chatId ? '/?chat=' + encodeURIComponent(chatId) : '/');
        })
    );
});

// Push с сервера owl-push — показываем уведомление, даже когда приложение закрыто
self.addEventListener('push', (event) => {
    let d = {};
    try { d = event.data ? event.data.json() : {}; } catch (_) { d = { body: event.data ? event.data.text() : '' }; }
    const tag = d.tag || 'owl';
    const opts = {
        body: d.body || 'Новое сообщение',
        icon: '/icon-192.png', badge: '/icon-192.png',
        tag: tag, renotify: true,
        data: { chatId: d.chatId || null }
    };
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
            // Owl открыт на экране — уведомление покажет само приложение.
            // Safari требует показывать уведомление на каждый push, поэтому показываем и сразу убираем.
            const inApp = list.some((c) => c.visibilityState === 'visible' && c.focused);
            return self.registration.showNotification(d.title || 'Owl Messenger', opts).then(() => {
                if (inApp) return self.registration.getNotifications({ tag: tag }).then((ns) => ns.forEach((n) => n.close()));
            });
        })
    );
});
