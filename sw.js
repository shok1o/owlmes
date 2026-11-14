const CACHE = 'owl-shell-v94';
// Приложение — index.html + boot.js/app.js/ui.js (?v= — как CACHE): кладём их сразу, иначе без сети после обновления не запустится
const SHELL = ['/', '/boot.js?v=94', '/app.js?v=94', '/ui.js?v=94', '/i18n-en.js?v=94', '/i18n-de.js?v=94', '/i18n-pl.js?v=94',
    '/e2e.js?v=94', '/manifest.json', '/icon-192.png', '/icon-512.png', '/apple-touch-icon.png'];
// Ядро шифрования (globalThis.OwlE2E) — для расшифровки текста в push. Номер ?v= — тот же, что у CACHE и SHELL.
// Без try: не загрузилось — новый service worker не ставится, остаётся прежний, браузер повторит позже.
importScripts('/e2e.js?v=94');
// Служебные отметки приложения (Cache Storage, не файлы сайта): при обновлении service worker не стираются.
// /__owl/gc-busy — «это устройство в групповом звонке до T» (app.js gcSwMark, обновляется раз в 30 с)
const STATE = 'owl-state';
function gcBusy() {
    return caches.open(STATE).then((c) => c.match('/__owl/gc-busy')).then((r) => (r ? r.text() : '')).then((x) => +x > Date.now()).catch(() => false);
}

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE)
            // e2e.js — без «.catch»: без него приложение офлайн не расшифрует сообщения, лучше остаться на прежней версии
            .then((c) => Promise.all(SHELL.map((u) => u.indexOf('/e2e.js?') === 0 ? c.add(u) : c.add(u).catch(() => {}))))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== STATE).map((k) => caches.delete(k))))
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
    // Проверка новой версии приложения (index.html читает sw.js) — всегда из сети, мимо кэша
    if (url.pathname === '/sw.js') return;
    // Страница из писем (сброс пароля, подтверждение почты) — только из сети: одноразовый код из адреса не должен лечь в кэш
    if (url.pathname === '/action.html') return;

    if (req.mode === 'navigate') {
        // Страницы: сначала сеть, при ошибке — кэш, затем заглушка.
        // cache: 'no-cache' — всегда сверяемся с сервером (GitHub Pages разрешает кэшировать 10 минут,
        // из-за этого приложение с экрана «Домой» показывало старую версию)
        event.respondWith(
            fetch(req, { cache: 'no-cache' }).then((res) => {
                // в кэш — без ?add=…/?chat=… в адресе (одна копия страницы, без следов ссылок)
                if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(url.origin + url.pathname, copy)); }
                return res;
            }).catch(() => caches.match(url.origin + url.pathname).then((r) => r || caches.match('/')).then((r) => r || new Response(offlineHtml, {
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

// Клик по уведомлению о сообщении — открываем приложение и нужный чат.
// Групповой звонок (open: 'gcall', chatId — беседа): тоже просто открываем беседу. Войти сразу нельзя — микрофону и звуку
// на iPhone нужно касание внутри приложения; в беседе уже висит плашка «Идёт звонок · N · Присоединиться»
self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const chatId = event.notification.data && event.notification.data.chatId;
    const guard = !!(event.notification.data && event.notification.data.open === 'guard'); // «Сова на страже»
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
            const client = list.find((c) => new URL(c.url).origin === self.location.origin);
            if (client) {
                if (guard) client.postMessage({ type: 'open-guard' });
                else if (chatId) client.postMessage({ type: 'open-chat', chatId: chatId });
                return client.focus();
            }
            return clients.openWindow(guard ? '/?guard=1' : chatId ? '/?chat=' + encodeURIComponent(chatId) : '/');
        })
    );
});

// Push с сервера owl-push — показываем уведомление, даже когда приложение закрыто
self.addEventListener('push', (event) => {
    let d = {};
    try { d = event.data ? event.data.json() : {}; } catch (_) { d = { body: event.data ? event.data.text() : '' }; }
    if (!d || typeof d !== 'object') d = {};
    const tag = d.tag || 'owl';
    const opts = {
        body: d.body || 'Новое сообщение',
        icon: '/icon-192.png', badge: '/icon-192.png',
        tag: tag, renotify: true,
        data: { chatId: d.chatId || null, open: d.open || null, call: d.call || null }
    };
    // «Сова на страже»: тревога и напоминания — громко, с вибрацией и не исчезают сами
    if (d.loud) { opts.requireInteraction = true; opts.silent = false; opts.vibrate = [400, 150, 400, 150, 800]; }
    const title = d.title || 'Owl Messenger';
    // Групповой звонок: такое же уведомление (тот же tag) уже могло показать само приложение из фоновой вкладки — тогда заменяем молча
    const gcTag = tag.indexOf('owl-gcall-') === 0;
    event.waitUntil(
        // Список окон не получили — считаем, что приложение закрыто: уведомление показать нужно в любом случае
        Promise.all([
            clients.matchAll({ type: 'window', includeUncontrolled: true }).catch(() => []),
            d.call ? gcBusy() : false,
            gcTag ? self.registration.getNotifications({ tag: tag }).then((ns) => ns.length > 0).catch(() => false) : false
        ]).then(([list, busy, shown]) => {
            // Личный звонок, а это устройство сейчас в групповом звонке (и приложение может быть в фоне): тут не звоним поверх
            // разговора — уведомление тихое, без вибрации и не «висит» (другие устройства звонят как обычно; вопрос 7, вариант «а»).
            // Окон приложения нет — группового звонка здесь быть не может (отметка осталась от закрытой вкладки): звоним как обычно
            const app = list.some((c) => { try { const p = new URL(c.url).pathname; return p === '/' || p === '/index.html'; } catch (_) { return false; } });
            if (busy && app) { opts.silent = true; delete opts.requireInteraction; delete opts.vibrate; }
            if (shown) opts.renotify = false;
            // Owl открыт на экране — уведомление покажет само приложение.
            // Safari требует показывать уведомление на каждый push, поэтому показываем и сразу убираем.
            // Входящий звонок при открытом приложении показывает экран звонка — уведомление тоже убираем.
            const inApp = (!d.loud || d.call) && list.some((c) => c.visibilityState === 'visible' && c.focused);
            // Зашифрованное сообщение (d.e): пробуем расшифровать превью ключом с этого устройства — не дольше 1,5 с.
            // Только текущим закреплённым ключом собеседника (прежний или незакреплённый ключ, в т.ч. e.pk из push, — null, см. e2e.js trustedPub).
            // Любая ошибка или тайм-аут → null → остаётся запасной текст Worker'а («🔒 Новое сообщение» на языке получателя).
            // Уведомление показываем ВСЕГДА (iOS отзывает подписку после нескольких push без уведомления).
            let timer = null;
            const dec = (!inApp && d.e && typeof d.e === 'object' && typeof d.chatId === 'string' && self.OwlE2E)
                ? Promise.race([
                    Promise.resolve().then(() => self.OwlE2E.pushPreview(d.e, d.chatId)).catch(() => null),
                    new Promise((r) => { timer = setTimeout(() => r(null), 1500); })
                ]).then((txt) => { clearTimeout(timer); return txt; })
                : Promise.resolve(null);
            return dec
                .then((txt) => {
                    if (typeof txt === 'string' && txt) opts.body = txt;   // расшифрованное — только в тексте, не в data
                    return self.registration.showNotification(title, opts);
                })
                // Не показалось (например, браузер не принял параметры) — показываем простое, с запасным текстом
                .catch(() => self.registration.showNotification(title, { body: d.body || 'Новое сообщение', tag: tag, data: opts.data }))
                .then(() => {
                    if (inApp) return self.registration.getNotifications({ tag: tag }).then((ns) => ns.forEach((n) => n.close()));
                })
                .then(() => {
                    // Пришло сообщение в этот чат (например, «Пропущенный звонок») — убираем устаревшее «звонит»
                    if (d.call || !d.chatId) return;
                    return self.registration.getNotifications().then((ns) => ns.forEach((n) => {
                        if (n.tag && n.tag.indexOf('owl-call-') === 0 && n.data && n.data.chatId === d.chatId) n.close();
                    }));
                });
        })
    );
});
