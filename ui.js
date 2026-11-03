// Owl: оформление, экран входа, поле ввода, service worker (обычный скрипт в конце <body>, выполняется до app.js)
try {
      (function () {
        const $ = id => document.getElementById(id);
        const get = k => { try { return localStorage.getItem(k); } catch (_) { return null; } };
        const set = (k, v) => { try { localStorage.setItem(k, v); } catch (_) {} };
        const COLORS = ["", "#f5a524", "#e0568a", "#4f8cff", "#2fb67c", "#14b8c4"]; // "" — фирменный фиолетовый Owl
        function applyAccent(c) { [document.documentElement, document.body].forEach(e => c ? e.style.setProperty("--accent", c) : e.style.removeProperty("--accent")); }
        function mark(box, attr, val) { box.querySelectorAll("[" + attr + "]").forEach(el => el.classList.toggle("on", el.getAttribute(attr) === val)); }
        function sync() {
          mark($("st-theme"), "data-v", $("theme-select").value);
          mark($("st-bgs"), "data-v", $("bg-select").value);
          mark($("st-accent"), "data-c", get("owl-accent") || "");
        }
        if (get("owl-accent") && !COLORS.includes(get("owl-accent"))) set("owl-accent", ""); // цвет из старой палитры — возвращаем фирменный
        applyAccent(get("owl-accent") || "");
        COLORS.forEach(c => { const b = document.createElement("button"); b.className = "st-dot"; b.setAttribute("data-c", c); b.style.background = c || "#8b5cf6"; b.title = c ? c : "По умолчанию"; $("st-accent").appendChild(b); });
        $("st-accent").addEventListener("click", e => { const b = e.target.closest("[data-c]"); if (!b) return; const c = b.getAttribute("data-c"); set("owl-accent", c); applyAccent(c); sync(); });
        $("st-theme").addEventListener("click", e => { const b = e.target.closest("[data-v]"); if (!b) return; $("theme-select").value = b.getAttribute("data-v"); $("theme-select").dispatchEvent(new Event("change")); sync(); });
        $("st-bgs").addEventListener("click", e => { const b = e.target.closest("[data-v]"); if (!b) return; const v = b.getAttribute("data-v"); if (v === "custom") { $("custom-bg-btn").click(); return; } $("bg-select").value = v; $("bg-select").dispatchEvent(new Event("change")); sync(); });
        const snd = $("notification-sound"), soundToggle = $("sound-toggle");
        soundToggle.checked = get("owl-sound") !== "off"; snd.muted = !soundToggle.checked;
        soundToggle.addEventListener("change", () => { snd.muted = !soundToggle.checked; set("owl-sound", soundToggle.checked ? "on" : "off"); });
        // Упрощённый режим: класс на <html> (стили — в конце <style>), стекло пересчитывается по событию owl-motion
        const simpleToggle = $("simple-toggle");
        simpleToggle.checked = document.documentElement.classList.contains("owl-simple");
        simpleToggle.addEventListener("change", () => {
          document.documentElement.classList.toggle("owl-simple", simpleToggle.checked);
          set("owl-simple", simpleToggle.checked ? "on" : "off");
          window.dispatchEvent(new Event("owl-motion"));
        });
        $("st-logout").addEventListener("click", () => { $("settings-screen").style.display = "none"; $("logout-btn-header").click(); });
        window.addEventListener("load", sync); $("settings-screen").addEventListener("click", () => setTimeout(sync, 50));
      })();
} catch (e) { console.error("ui.js:", e); }

try {
      (function () {
        const $ = id => document.getElementById(id);
        // Глаз у пароля
        const eye = $("pw-eye"), pw = $("auth-password");
        eye.addEventListener("click", () => {
          const show = pw.type === "password"; pw.type = show ? "text" : "password";
          eye.classList.toggle("on", show); const t = show ? "Скрыть пароль" : "Показать пароль"; eye.title = t; eye.setAttribute("aria-label", t); pw.focus();
          owlMood();
        });
        // Сова на входе: следит глазами за курсором/пальцем, прячет глаза крыльями, пока вводят пароль,
        // подглядывает, если пароль показан, моргает и качает головой при ошибке
        const owl = $("owl-au"), owlPupils = owl ? owl.querySelectorAll(".owl-pupil") : [];
        const calm = window.owlCalm ? window.owlCalm() : matchMedia("(prefers-reduced-motion: reduce)").matches; // режим меняется только после входа, а выход перезагружает страницу
        function owlMood() {
          if (!owl) return;
          const pwFocus = document.activeElement === pw;
          owl.classList.toggle("cover", pwFocus); // при «показать пароль» левое крыло остаётся, правое приоткрыто
          owl.classList.toggle("peek", pwFocus && pw.type === "text");
        }
        function owlLook(x, y) {
          if (!owl || calm || $("auth-screen").style.display === "none") return;
          const r = owl.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height * .5;
          const dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy) || 1, k = Math.min(1, d / 160);
          owlPupils.forEach(p => { p.style.transform = `translate(${(dx / d * 6 * k).toFixed(1)}px, ${(dy / d * 5 * k).toFixed(1)}px)`; });
        }
        document.addEventListener("pointermove", e => owlLook(e.clientX, e.clientY), { passive: true });
        document.addEventListener("pointerdown", e => owlLook(e.clientX, e.clientY), { passive: true });
        // Пока печатают email/ник — смотрит на поле ввода, следуя за текстом
        ["auth-email", "auth-name"].forEach(id => $(id).addEventListener("input", e => {
          const r = e.target.getBoundingClientRect(), len = Math.min(1, e.target.value.length / 28);
          owlLook(r.left + 20 + (r.width - 40) * len, r.top + r.height / 2);
        }));
        ["focusin", "focusout"].forEach(ev => document.addEventListener(ev, () => setTimeout(owlMood, 0)));
        if (owl && !calm) (function blinkLoop() {
          setTimeout(() => { if ($("auth-screen").style.display !== "none" && !owl.classList.contains("cover")) { owl.classList.add("blink"); setTimeout(() => owl.classList.remove("blink"), 140); } blinkLoop(); }, 2400 + Math.random() * 3200);
        })();
        window.owlReact = (kind) => {
          if (!owl) return;
          owl.classList.remove("shake", "happy"); void owl.getBoundingClientRect();
          if (kind === "happy") { document.activeElement && document.activeElement.blur && document.activeElement.blur(); owl.classList.remove("cover", "peek"); }
          owl.classList.add(kind); if (kind === "shake") setTimeout(() => owl.classList.remove("shake"), 550);
        };
        // Закрытие окон: тап по затемнению и Esc
        const CLOSE = "[data-close]"; let downEl = null;
        // Крестики окон: data-close="id окна" (без onclick в разметке — так работает защита от чужих скриптов, CSP)
        document.addEventListener("click", e => { const b = e.target.closest && e.target.closest("[data-close]"); if (b) document.getElementById(b.getAttribute("data-close")).style.display = "none"; });
        document.addEventListener("pointerdown", e => { downEl = e.target; });
        document.addEventListener("click", e => {
          const s = e.target; if (s === downEl && s.classList && s.classList.contains("modal-screen") && s.querySelector(CLOSE)) s.style.display = "none";
        });
        document.addEventListener("keydown", e => {
          if (e.key !== "Escape") return;
          const open = [...document.querySelectorAll(".modal-screen")].filter(s => getComputedStyle(s).display !== "none" && s.querySelector(CLOSE));
          // закрываем верхнее окно (raiseModal поднимает последнее открытое выше), а не последнее по разметке
          const zi = (el) => parseInt(getComputedStyle(el).zIndex, 10) || 0;
          if (open.length) open.reduce((a, b) => zi(b) >= zi(a) ? b : a).style.display = "none";
        });
      })();
} catch (e) { console.error("ui.js:", e); }

try {
      (function () {
        const ta = document.getElementById("message-input");
        const fit = () => {
            // Пока приложение скрыто (экран загрузки/входа), высоту не посчитать — иначе поле сплющится до 0
            if (!ta.offsetParent) { ta.style.height = ""; return; }
            ta.style.height = "auto"; ta.style.height = Math.min(ta.scrollHeight, 140) + "px";
        };
        ta.addEventListener("input", fit);
        ta.addEventListener("owl-fit", fit); // подставили черновик или упоминание
        document.addEventListener("click", () => setTimeout(fit, 0)); // после отправки, смены чата, редактирования
        window.addEventListener("resize", fit); fit();
        // Пересчитываем, когда поле стало видимым или изменило ширину (показ приложения после загрузки, открытие чата)
        if (window.ResizeObserver) { let lastW = -1; new ResizeObserver(() => { const w = ta.clientWidth; if (w !== lastW) { lastW = w; fit(); } }).observe(ta); }

        // Кнопка «Отправить» не забирает фокус у поля — клавиатура остаётся открытой, экран не прыгает
        const send = document.getElementById("send-button");
        // Нельзя отменять touchstart: на iPhone это отменяет и сам «клик» — кнопка срабатывала через раз.
        // Поэтому на касание отвечаем сами: в touchend отменяем смену фокуса и сразу отправляем.
        send.addEventListener("mousedown", e => { if (document.activeElement === ta) e.preventDefault(); });
        send.addEventListener("touchend", e => {
            if (document.activeElement !== ta) return; // поле не в фокусе — обычный клик
            const t = e.changedTouches[0], r = send.getBoundingClientRect(), pad = 16;
            if (t && (t.clientX < r.left - pad || t.clientX > r.right + pad || t.clientY < r.top - pad || t.clientY > r.bottom + pad)) return; // палец увели с кнопки
            e.preventDefault(); // клавиатура не закрывается, лишнего клика не будет
            send.click();
        }, { passive: false });

        // Клавиатура на iPhone. Пока печатаешь — iOS сам поднимает поле ввода, мы не вмешиваемся (только убираем лишний отступ).
        // Баг iOS в режиме «На экран Домой»: после закрытия клавиатуры высота окна остаётся уменьшенной до перезапуска,
        // снизу пустая полоса. Лечится так: на миг скрыть и показать элемент на весь экран — WebKit пересчитывает размер окна.
        // (прокрутка и правка meta viewport не помогают). Если не помогло — полоска закрашена цветом нижней панели.
        const root = document.documentElement, vv = window.visualViewport;
        const iosStandalone = navigator.standalone === true;
        const isLandscape = () => (screen.orientation && screen.orientation.type) ? screen.orientation.type.startsWith("landscape") : Math.abs(window.orientation || 0) === 90;
        const typing = () => { const a = document.activeElement; return !!a && (a.tagName === "TEXTAREA" || (a.tagName === "INPUT" && !["checkbox", "radio", "button", "file", "submit"].includes(a.type)) || a.isContentEditable); };
        // Наибольшая высота окна без клавиатуры — отдельно для портретной и альбомной ориентации
        const maxH = { portrait: 0, landscape: 0 };
        const orient = () => isLandscape() ? "landscape" : "portrait";
        const rememberHeight = () => { if (!typing()) maxH[orient()] = Math.max(maxH[orient()], window.innerHeight); };
        // Окно урезано после клавиатуры (стало меньше, чем было)
        const shrunk = () => maxH[orient()] - window.innerHeight > 4;
        // Цвет «под» приложением = цвет нижней панели: если iOS оставит полоску, она сольётся с панелью
        const themeMeta = document.querySelector('meta[name="theme-color"]');
        function syncCanvasColor() {
            if (!matchMedia("(max-width: 768px)").matches) { root.style.backgroundColor = ""; return; }
            const c = getComputedStyle(document.body).getPropertyValue("--bg-panel").trim();
            if (c && root.style.backgroundColor !== c) { root.style.backgroundColor = c; if (themeMeta) themeMeta.setAttribute("content", c); }
        }

        function healViewport() {
            if (!iosStandalone || typing() || !shrunk()) return;
            const app = document.getElementById("app-container");
            if (!app || app.style.display === "none") return; // экран входа — приложение скрыто, не трогаем
            const keep = ["chat-box", "chat-list"].map(id => { const el = document.getElementById(id); return el ? [el, el.scrollTop] : null; }).filter(Boolean);
            app.style.display = "none";
            void app.offsetHeight; // синхронный пересчёт вёрстки
            app.style.display = "";
            keep.forEach(([el, top]) => { el.scrollTop = top; });
            schedule();
        }

        let timer = 0;
        function applyKeyboardState() {
            timer = 0;
            const kb = typing();
            root.classList.toggle("kb-open", kb);
            if (kb) { root.classList.remove("vp-stuck"); return; }
            rememberHeight();
            syncCanvasColor();
            if (window.scrollY || root.scrollTop || document.body.scrollTop) { window.scrollTo(0, 0); root.scrollTop = 0; document.body.scrollTop = 0; }
            root.classList.toggle("vp-stuck", iosStandalone && shrunk());
        }
        const schedule = () => { if (!timer) timer = setTimeout(applyKeyboardState, 16); };
        document.addEventListener("focusin", schedule);
        document.addEventListener("focusout", () => { setTimeout(schedule, 50); setTimeout(healViewport, 140); setTimeout(healViewport, 600); });
        if (vv) vv.addEventListener("resize", schedule);
        window.addEventListener("resize", schedule);
        window.addEventListener("orientationchange", () => setTimeout(schedule, 700));
        window.addEventListener("pageshow", () => { schedule(); setTimeout(healViewport, 300); });
        document.addEventListener("visibilitychange", () => { schedule(); if (document.visibilityState === "visible") setTimeout(healViewport, 300); });
        applyKeyboardState();
        // При запуске приложение показывается не сразу (экран загрузки) — несколько раз проверяем, не урезано ли окно
        let startupChecks = 0, startupHeals = 0;
        const startup = setInterval(() => {
            schedule();
            const app = document.getElementById("app-container");
            if (startupHeals < 2 && app && app.style.display !== "none" && shrunk()) { startupHeals++; healViewport(); } // не больше двух попыток — без мигания
            if (++startupChecks >= 8) clearInterval(startup);
        }, 1500);
        // Смена темы — сразу перекрашиваем «подложку»
        new MutationObserver(() => setTimeout(syncCanvasColor, 350)).observe(document.body, { attributes: true, attributeFilter: ["data-theme", "style"] });
      })();
} catch (e) { console.error("ui.js:", e); }

try {
      if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
          navigator.serviceWorker.register('/sw.js').then(reg => {
            console.log('Service Worker успешно зарегистрирован!');
          }).catch(err => console.error('Ошибка регистрации Service Worker', err));
        });
      }
} catch (e) { console.error("ui.js:", e); }
