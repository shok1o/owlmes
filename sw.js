const CACHE = 'owl-shell-v98';
// Приложение — index.html + boot.js/app.js/ui.js (?v= — как CACHE): кладём их сразу, иначе без сети после обновления не запустится
const SHELL = ['/', '/boot.js?v=98', '/app.js?v=98', '/ui.js?v=98', '/i18n-en.js?v=98', '/i18n-de.js?v=98', '/i18n-pl.js?v=98',
    '/e2e.js?v=98', '/manifest.json', '/icon-192.png', '/icon-512.png', '/apple-touch-icon.png'];
// Когда запустился этот service worker — до загрузки ядра: у push, разбудившего его «с нуля», 10 с WebKit идут уже отсюда
// (сроки диагностики считаем от SW_T0, если service worker моложе SW_COLD_MS; age в журнале — тоже от него)
const SW_T0 = Date.now();
// Ядро шифрования (globalThis.OwlE2E) — для расшифровки текста в push. Номер ?v= — тот же, что у CACHE и SHELL.
// Без try: не загрузилось — новый service worker не ставится, остаётся прежний, браузер повторит позже.
importScripts('/e2e.js?v=98');
// Служебные отметки приложения (Cache Storage, не файлы сайта): при обновлении service worker не стираются.
// /__owl/gc-busy — «это устройство в групповом звонке до T» (app.js gcSwMark, обновляется раз в 30 с)
const STATE = 'owl-state';
// Не дольше GC_BUSY_MS (v1.121.4): медленный Cache Storage не задерживает звонок — не успели прочитать, считаем, что группового звонка
// здесь нет (звоним как обычно). Promise.resolve().then — синхронная ошибка (например, caches нет) тоже даёт «нет», а не сбой обработчика
const GC_BUSY_MS = 1000;
function gcBusy() {
    let tm = null;
    return Promise.race([
        Promise.resolve().then(() => caches.open(STATE)).then((c) => c.match('/__owl/gc-busy')).then((r) => (r ? r.text() : '')).then((x) => +x > Date.now()),
        new Promise((r) => { tm = setTimeout(() => r(false), GC_BUSY_MS); })
    ]).catch(() => false).then((v) => { clearTimeout(tm); return v === true; });
}
// Диагностика push лички с шифрованием (v1.121.4) — только пока её включил админ в «Панели разработчика → Копия» на ЭТОМ устройстве:
// /__owl/push-diag-on = «до T» (24 ч; стирается при выходе из аккаунта). Пишем только коды и миллисекунды: ни текста, ни ключей, ни uid/chatId/kid.
// /__owl/push-diag — последние DIAG_MAX записей (их показывает панель); маленький age (от SW_T0) = push разбудил service worker «с нуля».
// Флаг читаем без caches.open (не создаём owl-state у тех, у кого его нет) и не дольше DIAG_FLAG_MS
const DIAG_ON = '/__owl/push-diag-on', DIAG_LOG = '/__owl/push-diag', DIAG_MAX = 20;
// Сроки обработки push. Флаг выключен — как в v1.121.1: расшифровка не дольше RACE_MS (шаг IndexedDB — 1,2 с, PUSH_IDB_MS в e2e.js).
// Включён — расшифровка до RACE_DIAG_MS (шаг до 5 с), чтобы отличить «медленно» от «зависло». Общий сторож: уведомление (хотя бы
// запасное) — не позже WD_MS от начала обработки (флаг включён — WD_DIAG_MS): WebKit даёт событию push 10 с, а без уведомления iOS
// после трёх таких push отзывает подписку. Журнал — после показа: расшифровку, проигравшую гонку, ждём до DIAG_FIN_MS, запись — до
// DIAG_SAVE_MS, но не позже DIAG_END_MS (не меньше 150 мс). При флаге событие укладывается примерно в 8 с от запуска service worker
// (холодный старт) или от начала обработки, если сам показ не завис
const RACE_MS = 1500, RACE_DIAG_MS = 6000, WD_MS = 5000, WD_DIAG_MS = 7000;
const DIAG_FLAG_MS = 300, DIAG_FIN_MS = 7500, DIAG_SAVE_MS = 500, DIAG_END_MS = 8000, SW_COLD_MS = 3000;
const DM_ID = /^[A-Za-z0-9]{1,128}_[A-Za-z0-9]{1,128}$/;   // личка или Гнездо (uid_uid)
// Promise.resolve().then: даже синхронная ошибка доступа к caches не должна помешать показать уведомление
function diagOn() {
    return Promise.resolve().then(() => caches.match(DIAG_ON, { cacheName: STATE })).then((r) => (r ? r.text() : '')).then((x) => +x > Date.now()).catch(() => false);
}
// Флаг перечитываем перед записью: пока шёл push, его могли снять («Выйти», «Выключить», стирание) — тогда журнал не пишем и не создаём заново
function diagSave(rec) {
    return diagOn().then((on) => on && caches.open(STATE).then((c) => c.match(DIAG_LOG).then((r) => (r ? r.json() : [])).catch(() => [])
        .then((list) => c.put(DIAG_LOG, new Response(JSON.stringify((Array.isArray(list) ? list : []).concat([rec]).slice(-DIAG_MAX)),
            { headers: { 'Content-Type': 'application/json' } })))))
        .catch(() => {});
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
    const t0 = Date.now();
    // Отсчёт сроков диагностики: service worker запущен только что (вероятно, этим push) — от его запуска, иначе — от начала обработки
    const tb = t0 - SW_T0 < SW_COLD_MS ? SW_T0 : t0;
    let d = {};
    try { d = event.data ? event.data.json() : {}; } catch (_) { d = { body: event.data ? event.data.text() : '' }; }
    if (!d || typeof d !== 'object') d = {};
    const tag = d.tag || 'owl';
    const body0 = d.body || 'Новое сообщение';   // запасной текст Worker'а (у зашифрованного — «🔒 Новое сообщение» на языке получателя)
    const opts = {
        body: body0,
        icon: '/icon-192.png', badge: '/icon-192.png',
        tag: tag, renotify: true,
        data: { chatId: d.chatId || null, open: d.open || null, call: d.call || null }
    };
    // «Сова на страже»: тревога и напоминания — громко, с вибрацией и не исчезают сами
    if (d.loud) { opts.requireInteraction = true; opts.silent = false; opts.vibrate = [400, 150, 400, 150, 800]; }
    const title = d.title || 'Owl Messenger';
    // Групповой звонок: такое же уведомление (тот же tag) уже могло показать само приложение из фоновой вкладки — тогда заменяем молча
    const gcTag = typeof tag === 'string' && tag.indexOf('owl-gcall-') === 0;
    const eOk = !!(d.e && typeof d.e === 'object');
    // Диагностика (только при флаге) — push без данных (покажется «Новое сообщение» без 🔒) и push лички с шифрованием:
    // с превью e или с запасным текстом «🔒 …» (тогда Worker превью не приложил). Звонки, беседы, «Сова» — без неё
    const noData = !d.body;
    const diagIt = noData || (typeof d.chatId === 'string' && DM_ID.test(d.chatId) && !d.call && (eOk || (typeof d.body === 'string' && d.body.indexOf('🔒') === 0)));
    const diag = {};   // заполняет pushPreview (только при флаге): коды и миллисекунды, см. e2e.js
    let dOn = false, inApp = false, app = false, list = [], late = null, raced = false, decOk = false, showErr = false, wdFired = false, code = '';
    // Код причины для диагностики — только из белого списка (здесь и в e2e.js), без данных
    const codeNow = (wd) => wd ? 'wd-' + (late ? diag.at || 'start' : 'pre')
        : noData ? 'nodata' : inApp ? 'inapp' : !eOk ? 'noe' : !self.OwlE2E ? 'nolib' : raced ? 'race-' + (diag.at || 'start') : String(diag.c || 'x');

    // Показ — ровно один: основной путь или сторож, кто раньше; повторный вызов отдаёт тот же промис (поздняя расшифровка текст не меняет)
    let showP = null, wdTimer = null, shownAt = null;
    const shownP = new Promise((r) => { shownAt = r; });
    const show = () => {
        if (showP) return showP;
        clearTimeout(wdTimer);
        const body = opts.body;
        showP = Promise.resolve().then(() => self.registration.showNotification(title, opts))
            // Не показалось (например, браузер не принял параметры) — показываем простое с тем же готовым текстом (расшифрованным
            // или запасным); расшифрованное — по-прежнему только в тексте, не в data
            .catch(() => { showErr = true; return self.registration.showNotification(title, { body: body, tag: tag, data: opts.data }); });
        showP.then(() => shownAt(Date.now() - t0), () => shownAt(-1));
        return showP;
    };
    // Общий сторож: если что-то до показа зависло (список окон, Cache Storage, IndexedDB), запасное уведомление — не позже WD_MS
    // от начала обработки (флаг включён — WD_DIAG_MS от tb)
    let wdHit = null;
    const wdP = new Promise((r) => { wdHit = r; });
    const wdArm = (ms, base) => {
        clearTimeout(wdTimer);
        if (showP) return;
        wdTimer = setTimeout(() => {
            if (showP) return;
            wdFired = true;
            if (dOn) { code = codeNow(true); opts.body = body0 + ' · ' + code; }
            wdHit(show().then(() => {}, () => {}));
        }, Math.max(0, base + ms - Date.now()));
    };
    wdArm(WD_MS, t0);
    // Флаг диагностики — параллельно со списком окон и не дольше DIAG_FLAG_MS: не успели прочитать — считаем выключенным
    let flagTimer = null;
    const flagP = !diagIt ? false : Promise.race([diagOn(), new Promise((r) => { flagTimer = setTimeout(() => r(false), DIAG_FLAG_MS); })])
        .then((on) => {
            clearTimeout(flagTimer);
            dOn = on === true && !showP;
            if (dOn) wdArm(WD_DIAG_MS, tb);
        });

    // Каждый вызов — через Promise.resolve().then: синхронная ошибка (нет clients/getNotifications) не обрывает обработчик до event.waitUntil
    const flowP = Promise.all([
        // Список окон не получили — считаем, что приложение закрыто: уведомление показать нужно в любом случае
        Promise.resolve().then(() => clients.matchAll({ type: 'window', includeUncontrolled: true })).catch(() => []),
        d.call ? gcBusy() : false,
        gcTag ? Promise.resolve().then(() => self.registration.getNotifications({ tag: tag })).then((ns) => ns.length > 0).catch(() => false) : false,
        flagP
    ]).then(([wins, busy, shown]) => {
        list = Array.isArray(wins) ? wins : [];
        // Личный звонок, а это устройство сейчас в групповом звонке (и приложение может быть в фоне): тут не звоним поверх
        // разговора — уведомление тихое, без вибрации и не «висит» (другие устройства звонят как обычно; вопрос 7, вариант «а»).
        // Окон приложения нет — группового звонка здесь быть не может (отметка осталась от закрытой вкладки): звоним как обычно
        app = list.some((c) => { try { const p = new URL(c.url).pathname; return p === '/' || p === '/index.html'; } catch (_) { return false; } });
        if (busy && app) { opts.silent = true; delete opts.requireInteraction; delete opts.vibrate; }
        if (shown) opts.renotify = false;
        // Owl открыт на экране — уведомление покажет само приложение.
        // Safari требует показывать уведомление на каждый push, поэтому показываем и сразу убираем.
        // Входящий звонок при открытом приложении показывает экран звонка — уведомление тоже убираем.
        inApp = (!d.loud || d.call) && list.some((c) => c.visibilityState === 'visible' && c.focused);
        // Зашифрованное сообщение (d.e): пробуем расшифровать превью ключом с этого устройства — не дольше RACE_MS (при диагностике — RACE_DIAG_MS).
        // Только текущим закреплённым и признанным («Понятно») ключом собеседника (прежний, незакреплённый или ещё не признанный ключ,
        // в т.ч. e.pk из push, — null, см. e2e.js trustedPub). Любая ошибка или тайм-аут → null → остаётся запасной текст Worker'а.
        // Уведомление показываем ВСЕГДА (iOS отзывает подписку после нескольких push без уведомления).
        // Без диагностики pushPreview зовём ровно с двумя аргументами, как раньше; с ней — (e, chatId, undefined, diag)
        let timer = null;
        const dec = (!inApp && eOk && typeof d.chatId === 'string' && self.OwlE2E)
            ? Promise.race([
                (late = Promise.resolve().then(() => dOn ? self.OwlE2E.pushPreview(d.e, d.chatId, undefined, diag) : self.OwlE2E.pushPreview(d.e, d.chatId)).catch(() => null)),
                new Promise((r) => { timer = setTimeout(() => { raced = true; r(null); }, dOn ? RACE_DIAG_MS : RACE_MS); })
            ]).then((txt) => { clearTimeout(timer); return txt; })
            : Promise.resolve(null);
        return dec
            .then((txt) => {
                if (showP) return;   // сторож уже показал запасное
                if (typeof txt === 'string' && txt) { opts.body = txt; decOk = true; if (dOn) code = 'ok'; }   // расшифрованное — только в тексте, не в data
                else if (dOn) { code = codeNow(false); opts.body = body0 + ' · ' + code; }   // диагностика: код причины — к запасному тексту
            })
            .then(show, show)
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
    }).catch(() => show());   // сбой до показа — сразу запасное (после показа show() вернёт тот же промис)

    // Журнал (только при флаге) — после показа. Расшифровка, проигравшая гонку, ещё может идти: ждём её до DIAG_FIN_MS от tb,
    // чтобы записать, чем бы она кончилась и за сколько (fin, ms). Повторно ничего не показываем
    const diagWrite = () => {
        if (!dOn) return undefined;
        let tm = null, shownMs = null;
        const until = new Promise((r) => { tm = setTimeout(r, Math.max(0, tb + DIAG_FIN_MS - Date.now())); });
        // показ завис (showNotification не ответил) — запись всё равно будет, shown: null
        return Promise.race([shownP.then((ms) => { shownMs = ms; return Promise.race([late || null, until]); }), until]).then(() => {
            clearTimeout(tm);
            const rec = {
                t: t0, v: CACHE, c: code || codeNow(false), fin: typeof diag.c === 'string' ? diag.c : null,
                ms: typeof diag.ms === 'number' ? diag.ms : null, s: Array.isArray(diag.s) ? diag.s.slice(0, 12) : [],
                shown: shownMs, tot: Date.now() - t0, age: t0 - SW_T0, dec: decOk, showErr, wd: wdFired,
                idb: typeof diag.idb === 'string' ? diag.idb : typeof self.indexedDB, me: typeof diag.me === 'string' ? diag.me : null,
                pk: !!(eOk && d.e.pk), cl: list.length, vis: list.some((c) => c && c.visibilityState === 'visible'), app, inApp
            };
            let st = null;
            const saveMs = Math.max(150, Math.min(DIAG_SAVE_MS, tb + DIAG_END_MS - Date.now()));
            return Promise.race([diagSave(rec), new Promise((r) => { st = setTimeout(r, saveMs); })]).then(() => clearTimeout(st));
        });
    };
    // Событие кончается, когда показали (основной путь или сторож) и записали журнал; ошибки здесь уже ничего не меняют
    event.waitUntil(Promise.race([flowP, wdP]).then(diagWrite, diagWrite).catch(() => {}));
});
