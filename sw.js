const CACHE = 'owl-shell-v5';
const SHELL = ['/', '/manifest.json', '/images/icon-192.png', '/images/icon-512.png', '/images/apple-touch-icon.png', '/apple-touch-icon.png'];

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
    body { font-family: -apple-system, 'Segoe UI', Roboto, sans-serif; background-color: #0e1621; color: #ffffff; margin: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; text-align: center; }
    h1 { color: #ff3b30; margin-bottom: 10px; }
    p { color: #7f8991; max-width: 280px; font-size: 15px; line-height: 1.4; }
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
        // Страницы: сначала сеть, при ошибке — кэш, затем заглушка
        event.respondWith(
            fetch(req).then((res) => {
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
