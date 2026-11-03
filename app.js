// Owl Messenger — приложение (модуль). Подключён в index.html как app.js?v=NN, NN = OWL_SHELL = CACHE в sw.js
      import { initializeApp } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-app.js";
      // ВАЖНО: Добавлены deleteField и getDoc для отмены реакций
      import { getFirestore, enableIndexedDbPersistence, serverTimestamp, collection, addDoc, onSnapshot as fsOnSnapshot, query, where, getDocs as fsGetDocs, deleteDoc, doc, setDoc, updateDoc, arrayUnion, arrayRemove, writeBatch, increment, orderBy, limit, deleteField, getDoc as fsGetDoc, runTransaction, documentId, terminate, clearIndexedDbPersistence, waitForPendingWrites } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-firestore.js";
      import { initializeAppCheck, ReCaptchaEnterpriseProvider, getToken as getAppCheckToken } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-app-check.js";
      import { initializeAuth, indexedDBLocalPersistence, browserLocalPersistence, browserSessionPersistence, createUserWithEmailAndPassword, signInWithEmailAndPassword, updateProfile, onAuthStateChanged, signOut, sendPasswordResetEmail, deleteUser, EmailAuthProvider, reauthenticateWithCredential, sendEmailVerification, getMultiFactorResolver, multiFactor, TotpMultiFactorGenerator } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-auth.js";

      // Пользователь просит меньше движения (настройка «Уменьшение движения» в iPhone) — анимации из кода не запускаем
      const reduceMotion = () => window.owlCalm ? window.owlCalm() : matchMedia("(prefers-reduced-motion: reduce)").matches; // + упрощённый режим
      const simpleMode = () => document.documentElement.classList.contains("owl-simple"); // только наш переключатель, без системной настройки

      // ===== ЯЗЫКИ ИНТЕРФЕЙСА =====
      // Ключ перевода — сам русский текст: t("Войти") → «Sign in». Чего нет в словаре — показывается по-русски (ничего не ломается).
      // Словари лежат отдельно (i18n-en.js, i18n-de.js, i18n-pl.js) и грузятся только для выбранного языка. ?v=NN — как у app.js: новый словарь сразу, а не со второго запуска
      // Сообщения людей НЕ переводятся — только интерфейс.
      const LANGS = { ru: { name: "Русский", flag: "🇷🇺" }, en: { name: "English", flag: "🇬🇧" }, de: { name: "Deutsch", flag: "🇩🇪" }, pl: { name: "Polski", flag: "🇵🇱" } };
      function detectLang() {
          try {
              const saved = localStorage.getItem("owl-lang"); if (LANGS[saved]) return saved;
              // Кто уже пользовался Owl до появления языков — остаётся на русском (даже если телефон на английском)
              if (["owl-night-sync", "owl-night-intro", "owl-push", "owl_theme", "owl_bg", "owl-admin-mig"].some(k => localStorage.getItem(k) !== null)) return "ru";
          } catch (_) {}
          for (const l of (navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || ""])) {
              const c = String(l).slice(0, 2).toLowerCase();
              if (c === "ru" || c === "be" || c === "kk") return "ru";
              if (LANGS[c]) return c;
          }
          return "en";
      }
      const LANG = detectLang();
      let DICT = {};
      if (LANG !== "ru") { try { DICT = (await import(`./i18n-${LANG}.js?v=82`)).default || {}; } catch (e) { console.log("Перевод не загрузился:", e); } }
      document.documentElement.lang = LANG;
      const i18nNorm = (s) => String(s).replace(/\s+/g, " ").trim();
      // t("Новых: {n}", { n: 3 }) — перевод с подстановкой
      function t(ru, vars) {
          let s = DICT[ru] || ru;
          if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? vars[k] : m));
          return s;
      }
      // tp(5, "сообщение|сообщения|сообщений") → «5 сообщений» / «5 messages» (в словаре — формы своего языка через «|»)
      const pluralRules = new Intl.PluralRules(LANG);
      function tp(n, forms, withNumber = true) {
          const f = t(forms).split("|"), cat = pluralRules.select(n);
          const word = f.length === 1 ? f[0] : f[{ one: 0, two: 1, few: 1, many: 2, other: f.length - 1 }[cat]] || f[f.length - 1];
          return withNumber ? `${n} ${word}` : word;
      }
      // Статичная разметка страницы: текст и подсказки (placeholder / title / aria-label) — один раз при запуске
      function translateDom(root) {
          if (LANG === "ru") return;
          const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
              acceptNode: (n) => n.nodeType === 1 && (["SCRIPT", "STYLE", "TEXTAREA"].includes(n.tagName) || n.hasAttribute("data-no-i18n")) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
          });
          for (let n = walker.nextNode(); n; n = walker.nextNode()) {
              if (n.nodeType === 3) {
                  const k = i18nNorm(n.nodeValue);
                  if (k && DICT[k]) { const m = n.nodeValue.match(/^(\s*)[\s\S]*?(\s*)$/); n.nodeValue = m[1] + DICT[k] + m[2]; }
              } else for (const a of ["placeholder", "title", "aria-label"]) {
                  const v = n.getAttribute(a); if (v && DICT[i18nNorm(v)]) n.setAttribute(a, DICT[i18nNorm(v)]);
              }
          }
          if (DICT[document.title]) document.title = DICT[document.title];
      }
      translateDom(document.body);
      // Окна (.modal-screen) лежат на одном «этаже» z-index — без этого верхним было то, что ниже в разметке,
      // и, например, профиль подписчика открывался ПОД окном списка подписчиков. Теперь последнее открытое — всегда сверху.
      // Окна со своим повышенным этажом (знакомство, вход) не трогаем.
      (() => {
          const screens = [...document.querySelectorAll(".modal-screen")];
          const base = new Map(screens.map(el => [el, parseInt(getComputedStyle(el).zIndex, 10) || 1000]));
          const shown = (el) => el.style.display && el.style.display !== "none";
          let seq = 0;
          const mo = new MutationObserver((muts) => {
              for (const m of muts) {
                  const el = m.target;
                  if (base.get(el) > 1000) continue;
                  const wasShown = m.oldValue && /display:\s*(flex|block|grid)/.test(m.oldValue);
                  if (shown(el) && !wasShown) el.style.zIndex = String(1000 + (++seq));
              }
              if (!screens.some(el => base.get(el) <= 1000 && shown(el))) seq = 0;
          });
          screens.forEach(el => mo.observe(el, { attributes: true, attributeFilter: ["style"], attributeOldValue: true }));
          // Плавное закрытие: код по всему приложению пишет style.display = "none" — перехватываем это у каждого окна,
          // проигрываем анимацию (.closing) и только потом действительно прячем. Чтение style.display сразу отдаёт "none",
          // поэтому остальной код считает окно закрытым. Если окно снова открыли во время анимации — закрытие отменяется.
          screens.forEach(el => {
              const st = el.style; let logical = st.display, timer = null;
              try {
                  Object.defineProperty(st, "display", {
                      configurable: true,
                      get() { return logical; },
                      set(v) {
                          el.__dispHooked = true;
                          logical = v; clearTimeout(timer);
                          const visible = st.getPropertyValue("display") && st.getPropertyValue("display") !== "none";
                          if (v === "none" && visible && !reduceMotion()) {
                              el.classList.add("closing");
                              timer = setTimeout(() => { el.classList.remove("closing"); st.setProperty("display", "none"); }, 200);
                          } else { el.classList.remove("closing"); if (v) st.setProperty("display", v); else st.removeProperty("display"); }
                      }
                  });
                  // проверка, что браузер действительно отдаёт запись в наш перехватчик; иначе — как раньше, без анимации закрытия
                  st.display = logical;
                  if (!el.__dispHooked) delete st.display;
              } catch (_) { try { delete st.display; } catch (__) {} }
          });
          // Поднять уже открытое окно наверх (повторное открытие не меняет display — наблюдатель его не заметит)
          window.raiseModal = (el) => { if (el && base.get(el) <= 1000) el.style.zIndex = String(1000 + (++seq)); };
      })();
      // «Политика» и «Соглашение» — на языке интерфейса
      if (LANG !== "ru") document.querySelectorAll('a[href="/privacy.html"], a[href="/terms.html"]').forEach(a => a.setAttribute("href", a.getAttribute("href").replace(".html", "-" + LANG + ".html")));
      function setLang(code) {
          if (!LANGS[code] || code === LANG) return;
          try { localStorage.setItem("owl-lang", code); } catch (_) {}
          location.reload(); // проще и надёжнее, чем перерисовывать всё на лету
      }
      window.__setLang = setLang;
      // Кнопка языка на экране входа и список в настройках
      (() => {
          const btn = document.getElementById("lang-btn"), menu = document.getElementById("lang-menu"), sel = document.getElementById("lang-select");
          document.getElementById("lang-cur").textContent = LANGS[LANG].name;
          menu.innerHTML = Object.entries(LANGS).map(([c, l]) => `<button type="button" role="menuitem" data-lang="${c}"${c === LANG ? ' class="cur"' : ""}><span>${l.flag}</span>${l.name}</button>`).join("");
          sel.innerHTML = Object.entries(LANGS).map(([c, l]) => `<option value="${c}"${c === LANG ? " selected" : ""}>${l.flag} ${l.name}</option>`).join("");
          btn.addEventListener("click", (e) => { e.stopPropagation(); const on = menu.classList.toggle("on"); btn.setAttribute("aria-expanded", on); });
          menu.addEventListener("click", (e) => { const b = e.target.closest("[data-lang]"); if (b) setLang(b.getAttribute("data-lang")); });
          document.addEventListener("click", () => { menu.classList.remove("on"); btn.setAttribute("aria-expanded", "false"); });
          sel.addEventListener("change", () => setLang(sel.value));
      })();

      const firebaseConfig = {
        apiKey: "AIzaSyCYeKCL1hqaDwmNp6bRuSZ4MPjMvMikqbY",
        authDomain: "mymessenger-12ec5.firebaseapp.com",
        projectId: "mymessenger-12ec5",
        storageBucket: "mymessenger-12ec5.firebasestorage.app",
        messagingSenderId: "334096138410",
        appId: "1:334096138410:web:c9cd4112c71ca79b91d0d3"
      };

      if (window.owlFramed) throw new Error("Owl открыт в чужой рамке — не запускаемся"); // boot.js уже спрятал страницу
      const app = initializeApp(firebaseConfig);
      // App Check: невидимая проверка Fraud Defense (reCAPTCHA Enterprise) — запросы к базе идут с «пропуском»
      // настоящего сайта owlmes.ru. Ключ работает только на owlmes.ru / www.owlmes.ru (на localhost пропуска не будет).
      const RECAPTCHA_ENTERPRISE_SITE_KEY = "6LciOuQtAAAAACzfAsHZMSxZ13E4hyN9kYvXcVK3";
      let appCheck = null;
      try { appCheck = initializeAppCheck(app, { provider: new ReCaptchaEnterpriseProvider(RECAPTCHA_ENTERPRISE_SITE_KEY), isTokenAutoRefreshEnabled: true }); }
      catch (e) { console.log("App Check:", e.message || e); }
      const db = getFirestore(app);
      // Вход только по почте и паролю: без getAuth, который на iPhone заранее грузит скрипт Google и скрытую страницу firebaseapp.com
      // (для входа через Google — не нужны). Хранилище входа то же, что у getAuth, — никого не разлогинит
      const auth = initializeAuth(app, { persistence: [indexedDBLocalPersistence, browserLocalPersistence, browserSessionPersistence] }); 
      
      // Включаем локальное кэширование базы данных (Offline Persistence)
      enableIndexedDbPersistence(db).catch((err) => {
          console.log("Кэширование не удалось: ", err.code);
      });
      
      const ADMIN_EMAIL = "jst@shok1o.ru"; 

      // ===== СЧЁТЧИК ЧТЕНИЙ (примерно, только это устройство) =====
      // Бесплатно — 50 000 чтений базы в сутки на весь проект. Считаем, что пришло с сервера (не из кэша), по источникам;
      // админ видит итог в панели разработчика → «Статистика». Чтения при «прогреве» кэша считаются не все — это оценка снизу
      const readDay = () => { const d = new Date(Date.now() - 7 * 3600e3); return d.toISOString().slice(0, 10); }; // сутки квоты: с ~10:00 МСК
      let readStats = { day: readDay(), total: 0, by: {} };
      try { const r = JSON.parse(localStorage.getItem("owl-reads") || "null"); if (r && r.day === readStats.day && r.by) readStats = r; } catch (_) {}
      let readSaveTimer = null;
      function countReads(label, n) {
          if (!n) return;
          if (readStats.day !== readDay()) readStats = { day: readDay(), total: 0, by: {} };
          readStats.total += n; readStats.by[label] = (readStats.by[label] || 0) + n;
          if (!readSaveTimer) readSaveTimer = setTimeout(() => { readSaveTimer = null; try { localStorage.setItem("owl-reads", JSON.stringify(readStats)); } catch (_) {} }, 3000);
      }
      function refLabel(ref) {
          try {
              if (ref.type === "document") return ref.parent.id + "/{id}";
              if (ref.type === "collection") return ref.id + " (все)";
              const segs = ref._query && ref._query.path && ref._query.path.segments;
              return (segs ? segs[segs.length - 1] : "запрос") + " (выборка)";
          } catch (_) { return "?"; }
      }
      const fromServer = (snap) => snap && snap.metadata && !snap.metadata.fromCache;
      function onSnapshot(ref, ...args) {
          const label = refLabel(ref), i = args.findIndex(a => typeof a === "function");
          if (i >= 0) { const cb = args[i]; args[i] = (snap) => {
              if (fromServer(snap) && !snap.metadata.hasPendingWrites) countReads(label, typeof snap.docChanges === "function" ? snap.docChanges().length : 1);
              return cb(snap);
          }; }
          return fsOnSnapshot(ref, ...args);
      }
      async function getDocs(q) { const snap = await fsGetDocs(q); if (fromServer(snap)) countReads(refLabel(q), Math.max(1, snap.size)); return snap; }
      async function getDoc(ref) { const snap = await fsGetDoc(ref); if (fromServer(snap)) countReads(refLabel(ref), 1); return snap; }

      let currentUser = null;
      let isAdmin = false;
      let currentChatId = 'global';
      let activeListener = null;
      let currentFilter = 'all'; 
      let editingMsgId = null;
      let currentEditingGroupId = null; 

      let turnstileToken = null;
      // URL вашего Cloudflare Worker (см. turnstile-verify-worker.js). Пусто = серверная проверка выключена.
      const TURNSTILE_VERIFY_URL = "";
      // Если капча Cloudflare недоступна (например, заблокирована провайдером), через 10 с разрешаем регистрацию без неё.
      // Не действует, когда включена серверная проверка (TURNSTILE_VERIFY_URL).
      let turnstileWaiting = false, turnstileLoaded = false;
      function loadTurnstile() {
        if (turnstileLoaded) return; turnstileLoaded = true; turnstileWaiting = true;
        const giveUp = () => { turnstileWaiting = false; };
        setTimeout(() => { if (!turnstileToken) giveUp(); }, 10000);
        const s = document.createElement("script");
        s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"; s.async = true;
        s.onerror = giveUp;
        s.onload = () => { try { window.turnstile.render("#turnstile-widget", { sitekey: "0x4AAAAAAFLdsFzARCmUv_ps", theme: "dark", callback: (t) => { turnstileToken = t; turnstileWaiting = false; }, "error-callback": giveUp, "expired-callback": () => { turnstileToken = null; } }); } catch (_) { giveUp(); } };
        document.head.appendChild(s);
      }
      window.onTurnstileSuccess = (token) => {
        turnstileToken = token;
      };

      const sendIconSVG = `<svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" style="transform: translateX(-1px);"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>`;
      const tickOneSVG = `<svg viewBox="0 0 16 11" width="16" height="11" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="1.5 6 4.5 9 10.5 2"></polyline></svg>`;
      const tickClockSVG = `<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6.2"></circle><polyline points="8 4.6 8 8 10.4 9.4"></polyline></svg>`;
      const tickState = (m) => m._pending ? "pending" : (m.read ? "read" : "sent");
      const TICK_VIEW = { pending: [t("Отправляется…"), tickClockSVG], sent: [t("Отправлено"), null], read: [t("Прочитано"), null] };
      function ticksHtmlFor(m) {
          const st = tickState(m);
          const svg = st === "pending" ? tickClockSVG : st === "read" ? tickTwoSVG : tickOneSVG;
          return `<span class="msg-ticks ${st}" data-state="${st}" title="${TICK_VIEW[st][0]}">${svg}</span>`;
      }
      const tickTwoSVG = `<svg viewBox="0 0 16 11" width="16" height="11" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="1.5 6 4.5 9 10.5 2"></polyline><polyline points="7.5 8 8.5 9 14.5 2"></polyline></svg>`;
      const replyIconSVG = `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 17 4 12 9 7"></polyline><path d="M20 18v-2a4 4 0 0 0-4-4H4"></path></svg>`;
      const checkIconSVG = `<svg viewBox="0 0 24 24" width="22" height="22" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
      const micIconSVG = `<svg viewBox="0 0 24 24" width="22" height="22" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>`;
      const stopIconSVG = `<svg viewBox="0 0 24 24" width="22" height="22" stroke="currentColor" stroke-width="2" fill="currentColor" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="6" width="12" height="12" rx="2" ry="2"></rect></svg>`;
      const editIconSVG = `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>`;
      const deleteIconSVG = `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>`;
      const groupIconSVG = `<svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="currentColor" stroke-linecap="round" stroke-linejoin="round" style="margin-right:4px; opacity:0.8;"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>`;
      const pinOutlineSVG = `<svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none"><line x1="12" y1="17" x2="12" y2="22"></line><path d="M5 17h14v-1.5l-3.2-3.2V5a1.8 1.8 0 0 0-1.8-1.8H10A1.8 1.8 0 0 0 8.2 5v7.3L5 15.5V17z"></path></svg>`;
      const pinFilledSVG = `<svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="currentColor"><line x1="12" y1="17" x2="12" y2="22"></line><path d="M5 17h14v-1.5l-3.2-3.2V5a1.8 1.8 0 0 0-1.8-1.8H10A1.8 1.8 0 0 0 8.2 5v7.3L5 15.5V17z"></path></svg>`;

      document.body.addEventListener("click", (e) => {
        let target = e.target.closest("[data-profile-target]");
        if (target) {
          e.stopPropagation(); let uid = target.getAttribute("data-profile-target");
          if (uid && uid !== "null" && uid !== "global" && uid !== "admin-settings") openPublicProfile(uid);
        }
      });

      // Набор иконок интерфейса (в стиле остальных SVG приложения)
      const ICONS = {
          sticker: '<path d="M15.5 3H6a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3h7l8-8V6a3 3 0 0 0-3-3h-2.5z"></path><path d="M13 21v-5a3 3 0 0 1 3-3h5"></path>',
          bell: '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path>',
          check: '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline>',
          error: '<circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line>',
          alert: '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line>',
          info: '<circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line>',
          image: '<rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline>',
          camera: '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle>',
          phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"></path>',
          mic: '<path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line>',
          pencil: '<path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path>',
          users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path>',
          trash: '<polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>',
          crown: '<path d="M2 18h20"></path><path d="M3 7l4.5 4L12 4l4.5 7L21 7l-2 11H5L3 7z"></path>',
          logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line>',
          pin: '<line x1="12" y1="17" x2="12" y2="22"></line><path d="M5 17h14v-1.5l-3.2-3.2V5a1.8 1.8 0 0 0-1.8-1.8H10A1.8 1.8 0 0 0 8.2 5v7.3L5 15.5V17z"></path>',
          block: '<circle cx="12" cy="12" r="10"></circle><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"></line>',
          copy: '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>',
          forward: '<polyline points="15 17 20 12 15 7"></polyline><path d="M4 18v-2a4 4 0 0 1 4-4h12"></path>',
          poll: '<line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line>',
          search: '<circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line>',
          up: '<polyline points="18 15 12 9 6 15"></polyline>',
          down: '<polyline points="6 9 12 15 18 9"></polyline>',
          x: '<line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>',
          flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"></path><line x1="4" y1="22" x2="4" y2="15"></line>',
          shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>',
          mail: '<path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path><polyline points="22,6 12,13 2,6"></polyline>',
          clock: '<circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline>',
          offline: '<line x1="1" y1="1" x2="23" y2="23"></line><path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"></path><path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"></path><path d="M10.71 5.05A16 16 0 0 1 22.58 9"></path><path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"></path><path d="M8.53 16.11a6 6 0 0 1 6.95 0"></path><line x1="12" y1="20" x2="12.01" y2="20"></line>',
          megaphone: '<path d="M3 11v2a1 1 0 0 0 1 1h3l5 4V6L7 10H4a1 1 0 0 0-1 1z"></path><path d="M16 8.5a5 5 0 0 1 0 7"></path><path d="M19 5.5a9 9 0 0 1 0 13"></path>',
          eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle>',
          moon: '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>',
          sun: '<circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>'
      };
      function icon(name, size = 18) {
          return `<svg class="ui-icon" viewBox="0 0 24 24" width="${size}" height="${size}" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ICONS.info}</svg>`;
      }
      // В базе превью хранятся с эмодзи-префиксом (📷/🎤/✏️) — при показе меняем его на иконку
      const PREVIEW_ICONS = [["📷 ", "camera"], ["🎤 ", "mic"], ["✏️ ", "pencil"], ["📊 ", "poll"], ["🦉 ", "sticker"], ["⚠️ ", "alert"], ["⚠ ", "alert"], ["✅ ", "check"], ["📞 ", "phone"]];
      // Превью в базе хранятся по-русски («📷 Фотография») — переводим служебные слова при показе
      const PREVIEW_WORDS = [["📷 ", "Фотография"], ["🎤 ", "Голосовое сообщение"], ["🦉 ", "Стикер"], ["📊 ", "Опрос:"], ["⚠️ ", "Сова на страже"], ["✅ ", "Всё в порядке"], ["📞 ", "Пропущенный звонок"], ["📞 ", "Отклонённый звонок"], ["📞 ", "Звонок не удался"], ["📞 ", "Звонок"]];
      function trPreview(text) {
          if (LANG === "ru") return text;
          for (const [emoji, w] of PREVIEW_WORDS) text = text.split(emoji + w).join(emoji + t(w));
          return text;
      }
      // ===== СВОИ ИКОНКИ ВМЕСТО ЭМОДЗИ =====
      // В интерфейсе (всплывашки, плашки, кнопки, служебные сообщения) системные эмодзи меняем на иконки Owl —
      // одинаковые на iPhone, Android и компьютере. Тексты в базе и словарях остаются с эмодзи (их же видят push и старые версии).
      // Реакции и эмодзи, которые пишут люди, не трогаем — это содержимое сообщений. Иконка: [цвет, рисунок 24×24];
      // «подложка» (class f) — заливка тем же цветом с прозрачностью, обводка — currentColor
      const EMOJI_ICONS = {
          "🦉": ["#a78bfa", '<path class="f" d="M5 4.5 8 6.6Q12 5.2 16 6.6L19 4.5V12c0 4.7-3.1 7.8-7 9.5C8.1 19.8 5 16.7 5 12z"/><circle cx="9.3" cy="11.6" r="2.1"/><circle cx="14.7" cy="11.6" r="2.1"/><path d="M11.2 15h1.6L12 16.3z" fill="currentColor"/>'],
          "🌙": ["#f5b942", '<path class="f" d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/><path d="M17.5 3.5v3M16 5h3"/>'],
          "⚡": ["#f5b942", '<path class="f" d="M13 2.5 5 13.5h6l-1 8 8-11h-6z"/>'],
          "🪺": ["#e0a35a", '<path class="f" d="M3 12.5h18c-.8 4.5-4.4 7.5-9 7.5s-8.2-3-9-7.5z"/><path d="M6 16h12"/><ellipse cx="9.4" cy="9.6" rx="2.2" ry="2.7"/><ellipse cx="14.6" cy="9.6" rx="2.2" ry="2.7"/>'],
          "💜": ["#c084fc", '<path class="f" d="M12 20.5s-8-4.6-8-10.4A4.4 4.4 0 0 1 12 7.6a4.4 4.4 0 0 1 8 2.5c0 5.8-8 10.4-8 10.4z"/>'],
          "🔔": ["#a78bfa", '<path class="f" d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 1.5h-15z"/><path d="M10 21h4"/>'],
          "🔕": ["#8c86a6", '<path class="f" d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 1.5h-15z"/><path d="M10 21h4M3.5 3.5l17 17"/>'],
          "🌐": ["#7dd3fc", '<circle class="f" cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.6 2.6 3.8 5.6 3.8 9s-1.2 6.4-3.8 9c-2.6-2.6-3.8-5.6-3.8-9S9.4 5.6 12 3z"/>'],
          "👀": ["#5eead4", '<ellipse class="f" cx="7.5" cy="12" rx="4.5" ry="5.5"/><ellipse class="f" cx="16.5" cy="12" rx="4.5" ry="5.5"/><circle cx="8.6" cy="13" r="1.6" fill="currentColor"/><circle cx="17.6" cy="13" r="1.6" fill="currentColor"/>'],
          "✅": ["#2fb36d", '<circle class="f" cx="12" cy="12" r="9"/><path d="m8 12.3 2.8 2.8 5.4-5.6"/>'],
          "✓": ["#2fb36d", '<path d="m5 12.5 4.5 4.5L19 7.5"/>'],
          "❌": ["#ff453a", '<circle class="f" cx="12" cy="12" r="9"/><path d="m9 9 6 6M15 9l-6 6"/>'],
          "✗": ["#ff453a", '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>'],
          "⚠": ["#ff9f0a", '<path class="f" d="M12 3.5 21.5 20h-19z"/><path d="M12 10v4.4M12 17.2v.3"/>'],
      };
      const EMOJI_RE = new RegExp("(" + Object.keys(EMOJI_ICONS).join("|") + ")\uFE0F?", "gu");
      function emojiIcon(e, size = "1.15em") {
          const it = EMOJI_ICONS[String(e).replace(/\uFE0F/g, "")]; if (!it) return e;
          return `<svg class="ei" viewBox="0 0 24 24" width="${size}" height="${size}" style="color:${it[0]}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${it[1]}</svg>`;
      }
      // html — уже экранированный текст: эмодзи интерфейса → иконки
      const iconizeEmoji = (html) => String(html).replace(EMOJI_RE, (m, e) => emojiIcon(e));
      // Эмодзи в статичных подсказках (текст уже переведён translateDom) — тоже на свои иконки
      document.querySelectorAll(".night-how, #night-urgent-btn").forEach(root => {
          const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), nodes = [], has = new RegExp(EMOJI_RE.source, "u");
          for (let n = w.nextNode(); n; n = w.nextNode()) if (has.test(n.nodeValue)) nodes.push(n);
          nodes.forEach(n => { const sp = document.createElement("span"); sp.innerHTML = iconizeEmoji(escapeHTML(n.nodeValue)); n.replaceWith(...sp.childNodes); });
      });
      function iconizePreview(html) {
          html = trPreview(html);
          for (const [emoji, name] of PREVIEW_ICONS) html = html.split(emoji).join(`<span class="inline-icon">${icon(name, 14)}</span>`);
          return html;
      }

      // Всплывающие уведомления: смахнуть в сторону или вверх — закрыть, нажать — закрыть (или открыть, если есть действие),
      // пока палец на уведомлении — оно не исчезает. Когда их несколько — кнопка «Скрыть все».
      const TOAST_MAX = 4;
      function showToast(message, icon_ = "bell", opts = {}) {
        const container = document.getElementById("toast-container"); if(!container) return;
        const toast = document.createElement("div"); toast.className = "toast";
        let msg = String(message == null ? "" : message); if (msg.length > 140) msg = msg.slice(0, 137).trimEnd() + "…";
        const ic = document.createElement("span"); ic.className = "toast-icon"; ic.innerHTML = icon(ICONS[icon_] ? icon_ : "info", 18);
        const tx = document.createElement("span"); tx.innerHTML = iconizeEmoji(escapeHTML(msg));
        toast.append(ic, tx);
        container.insertBefore(toast, document.getElementById("toast-clear"));
        const live = [...container.querySelectorAll(".toast:not(.gone)")];
        if (live.length > TOAST_MAX) live.slice(0, live.length - TOAST_MAX).forEach(t => dismissToast(t, "up"));
        let left = msg.length > 60 ? 6000 : 4000, started = Date.now(), timer = null;
        const arm = () => { started = Date.now(); timer = setTimeout(() => dismissToast(toast, "up"), left); };
        const hold = () => { clearTimeout(timer); left = Math.max(1200, left - (Date.now() - started)); };
        arm();
        // Жест: тянем за пальцем, отпустили далеко или резко — улетает, иначе пружинит назад
        let x0 = 0, y0 = 0, dx = 0, dy = 0, t0 = 0, drag = false;
        toast.addEventListener("pointerdown", (e) => { drag = true; x0 = e.clientX; y0 = e.clientY; dx = dy = 0; t0 = Date.now(); hold(); toast.classList.add("drag"); try { toast.setPointerCapture(e.pointerId); } catch (_) {} });
        toast.addEventListener("pointermove", (e) => {
          if (!drag) return;
          dx = e.clientX - x0; dy = Math.min(0, e.clientY - y0);
          const up = Math.abs(dy) > Math.abs(dx);
          toast.style.transform = up ? `translateY(${dy}px)` : `translateX(${dx}px) rotate(${dx / 40}deg)`;
          toast.style.opacity = String(Math.max(.15, 1 - (up ? -dy / 90 : Math.abs(dx) / 220)));
        });
        const end = () => {
          if (!drag) return; drag = false; toast.classList.remove("drag");
          const dt = Math.max(1, Date.now() - t0), vx = dx / dt, vy = dy / dt, moved = Math.abs(dx) > 6 || dy < -6;
          if (Math.abs(dx) > 80 || Math.abs(vx) > .6) return dismissToast(toast, dx > 0 ? "right" : "left");
          if (dy < -40 || vy < -.5) return dismissToast(toast, "up");
          toast.style.transform = ""; toast.style.opacity = "";
          if (!moved) { if (opts.onClick) opts.onClick(); return dismissToast(toast, "up"); }
          arm();
        };
        toast.addEventListener("pointerup", end); toast.addEventListener("pointercancel", end);
        toast.addEventListener("mouseenter", hold); toast.addEventListener("mouseleave", () => { if (!drag && !toast.classList.contains("gone")) arm(); });
        toast._stop = () => clearTimeout(timer);
        syncToastClear();
        return toast;
      }
      function dismissToast(toast, dir = "up") {
        if (!toast || toast.classList.contains("gone")) return;
        toast.classList.add("gone"); if (toast._stop) toast._stop();
        if (simpleMode()) { toast.remove(); syncToastClear(); return; } // без анимаций — сразу, без «пустого места»
        const h = toast.offsetHeight;
        toast.style.transition = "transform .32s cubic-bezier(.3,.7,.4,1), opacity .25s";
        toast.style.transform = dir === "left" ? "translateX(-120%) rotate(-6deg)" : dir === "right" ? "translateX(120%) rotate(6deg)" : "translateY(-26px) scale(.94)";
        toast.style.opacity = "0";
        // Освободившееся место схлопываем плавно — соседние уведомления подъезжают, а не прыгают
        toast.style.height = h + "px";
        setTimeout(() => { toast.style.transition += ", height .28s ease, margin .28s ease, padding .28s ease"; toast.style.height = "0px"; toast.style.marginBottom = "0px"; toast.style.paddingTop = toast.style.paddingBottom = "0px"; }, 170);
        setTimeout(() => { toast.remove(); syncToastClear(); }, 480);
        syncToastClear();
      }
      function syncToastClear() {
        const container = document.getElementById("toast-container"); if (!container) return;
        let btn = document.getElementById("toast-clear");
        const n = container.querySelectorAll(".toast:not(.gone)").length;
        if (!btn) { btn = document.createElement("button"); btn.id = "toast-clear"; btn.type = "button"; btn.addEventListener("click", () => container.querySelectorAll(".toast:not(.gone)").forEach((t, i) => setTimeout(() => dismissToast(t, i % 2 ? "right" : "left"), i * 60))); container.appendChild(btn); }
        btn.textContent = t("Скрыть все") + " · " + n;
        btn.classList.toggle("on", n >= 2);
      }

      // Последнее сообщение чата моё? (по uid; старые записи — по имени)
      const isMyMeta = (meta) => meta.lastMessageSenderUid ? meta.lastMessageSenderUid === currentUser.uid : meta.lastMessageSender === currentUser.displayName;

      // ===== ГОЛОСОВЫЕ 2.0: свой плеер с волной и скоростью =====
      const VP_BARS = 34;
      // Фото и голосовые в сообщениях — только встроенные (data:): чужой адрес выдал бы IP и время прочтения
      const isDataUrl = (v, kind) => typeof v === "string" && v.startsWith("data:" + kind + "/");
      const voicePeaks = Object.create(null), voiceDur = Object.create(null); // без прототипа: номер «constructor» не сломает чат
      const VP_PLAY = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg>';
      const VP_PAUSE = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><rect x="6.5" y="5" width="4" height="14" rx="1.2"/><rect x="13.5" y="5" width="4" height="14" rx="1.2"/></svg>';
      const VP_SPEEDS = [1, 1.5, 2];
      let voiceSpeed = (() => { try { const v = parseFloat(localStorage.getItem("owl-voice-speed")); return VP_SPEEDS.includes(v) ? v : 1; } catch (_) { return 1; } })();
      const speedLabel = () => (voiceSpeed === 1.5 ? "1.5" : voiceSpeed) + "×";
      const fmtDur = (t) => { if (!isFinite(t) || t <= 0) return "0:00"; t = Math.round(t); return Math.floor(t / 60) + ":" + String(t % 60).padStart(2, "0"); };
      function seededBars(id) { let h = 7; for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return Array.from({ length: VP_BARS }, () => { h = (h * 1103515245 + 12345) >>> 0; return .25 + ((h >>> 16) % 1000) / 1000 * .55; }); }
      function voicePlayerHtml(id, src) {
          const bars = (voicePeaks[id] || seededBars(id)).map(v => `<i style="height:${Math.round(v * 100)}%"></i>`).join("");
          return `<div class="vp" data-vp="${escapeHTML(id)}"><button class="vp-play" aria-label="${t("Воспроизвести")}">${VP_PLAY}</button><div class="vp-wave">${bars}</div><div class="vp-side"><span class="vp-time">${fmtDur(voiceDur[id])}</span><button class="vp-speed" aria-label="${t("Скорость")}">${speedLabel()}</button></div><audio preload="metadata" src="${escapeHTML(src)}"></audio></div>`;
      }
      // Настоящая «волна» и длительность — расшифровываем звук, когда плеер появился на экране
      const vpObserver = "IntersectionObserver" in window ? new IntersectionObserver((entries) => entries.forEach(en => { if (en.isIntersecting) { vpObserver.unobserve(en.target); decodeVoice(en.target); } }), { rootMargin: "200px" }) : null;
      function observeVoices(root) { root.querySelectorAll(".vp:not([data-obs])").forEach(el => { el.setAttribute("data-obs", "1"); if (vpObserver) vpObserver.observe(el); else decodeVoice(el); }); }
      async function decodeVoice(el) {
          const id = el.getAttribute("data-vp"), audio = el.querySelector("audio");
          if (!audio || voicePeaks[id]) return applyVoiceMeta(el);
          try {
              const buf = await (await fetch(audio.src)).arrayBuffer();
              const ctx = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(1, 44100, 44100);
              const ab = await new Promise((res, rej) => { const p = ctx.decodeAudioData(buf, res, rej); if (p && p.then) p.then(res, rej); });
              const data = ab.getChannelData(0), step = Math.max(1, Math.floor(data.length / VP_BARS)), peaks = [];
              for (let b = 0; b < VP_BARS; b++) { let m = 0; for (let i = b * step, e = Math.min(data.length, i + step); i < e; i += 8) { const v = Math.abs(data[i]); if (v > m) m = v; } peaks.push(m); }
              const max = Math.max(...peaks, 0.01);
              voicePeaks[id] = peaks.map(v => Math.max(.12, Math.sqrt(v / max)));
              voiceDur[id] = ab.duration;
          } catch (e) { voiceDur[id] = voiceDur[id] || (isFinite(audio.duration) ? audio.duration : 0); }
          applyVoiceMeta(el);
      }
      function applyVoiceMeta(el) {
          const id = el.getAttribute("data-vp");
          if (voicePeaks[id]) el.querySelectorAll(".vp-wave i").forEach((b, i) => { b.style.height = Math.round(voicePeaks[id][i] * 100) + "%"; });
          const audio = el.querySelector("audio");
          if (audio && audio.paused && !audio.currentTime) el.querySelector(".vp-time").textContent = fmtDur(voiceDur[id]);
      }
      const vpDuration = (el, audio) => voiceDur[el.getAttribute("data-vp")] || (isFinite(audio.duration) ? audio.duration : 0);
      function vpProgress(el, audio) {
          const d = vpDuration(el, audio), p = d ? Math.min(1, audio.currentTime / d) : 0, k = Math.round(p * VP_BARS);
          el.querySelectorAll(".vp-wave i").forEach((b, i) => b.classList.toggle("on", i < k));
          el.querySelector(".vp-time").textContent = fmtDur(audio.paused && !audio.currentTime ? d : audio.currentTime);
      }
      function vpClick(e) {
          const el = e.target.closest(".vp"); if (!el) return false;
          const audio = el.querySelector("audio");
          if (e.target.closest(".vp-speed")) {
              voiceSpeed = VP_SPEEDS[(VP_SPEEDS.indexOf(voiceSpeed) + 1) % VP_SPEEDS.length];
              try { localStorage.setItem("owl-voice-speed", String(voiceSpeed)); } catch (_) {}
              document.querySelectorAll(".vp-speed").forEach(b => b.textContent = speedLabel());
              document.querySelectorAll(".vp audio").forEach(a => a.playbackRate = voiceSpeed);
          } else if (e.target.closest(".vp-wave")) {
              const r = el.querySelector(".vp-wave").getBoundingClientRect(), d = vpDuration(el, audio);
              if (d) { audio.currentTime = Math.max(0, Math.min(.999, (e.clientX - r.left) / r.width)) * d; vpProgress(el, audio); if (audio.paused) { setAudioSession("playback"); audio.playbackRate = voiceSpeed; audio.play().catch(() => {}); } }
          } else {
              if (audio.paused) {
                  document.querySelectorAll(".vp audio").forEach(a => { if (a !== audio) a.pause(); });
                  // iPhone: звуковой режим переключаем ДО старта, прямо в нажатии — иначе iOS играет «без звука» до перемотки
                  setAudioSession("playback");
                  audio.dataset.nudge = "1";
                  audio.playbackRate = voiceSpeed;
                  audio.play().catch(err => showToast(t("Не удалось воспроизвести голосовое"), "error"));
              }
              else audio.pause();
          }
          return true;
      }
      ["play", "pause", "ended", "timeupdate"].forEach(ev => document.addEventListener(ev, (e) => {
          const a = e.target; if (!a || a.tagName !== "AUDIO") return;
          const el = a.closest(".vp"); if (!el) return;
          if (ev === "play") el.querySelector(".vp-play").innerHTML = VP_PAUSE;
          // Подстраховка для iPhone: микро-перемотка на то же место в первый момент воспроизведения «будит» звук
          if (ev === "timeupdate" && a.dataset.nudge && a.currentTime > 0) { delete a.dataset.nudge; if (isIOS()) { try { a.currentTime = a.currentTime; } catch (_) {} } }
          if (ev === "pause" || ev === "ended") el.querySelector(".vp-play").innerHTML = VP_PLAY;
          if (ev === "ended") { a.currentTime = 0; }
          vpProgress(el, a);
      }, true));

      // ===== ОПРОСЫ =====
      // msg.poll = { q, options[] }, msg.votes = { uid: номер варианта }. Голос можно снять повторным нажатием.
      function pollInner(m) {
          const votes = m.votes || {}, opts = m.poll.options || [], my = votes[currentUser.uid];
          const counts = opts.map((_, i) => Object.values(votes).filter(v => v === i).length), total = counts.reduce((a, b) => a + b, 0);
          const voted = my !== undefined;
          return `<div class="poll-q">${escapeHTML(m.poll.q)}</div><div class="poll-sub">${t("Опрос")} · ${tp(total, "голос|голоса|голосов")}${voted ? " · " + t("нажмите свой ответ, чтобы отменить") : ""}</div>` +
              opts.map((o, i) => {
                  const pc = total ? Math.round(counts[i] / total * 100) : 0;
                  return `<button class="poll-opt${my === i ? " mine" : ""}" data-vote="${i}">${voted ? `<i class="fill" style="width:${pc}%"></i>` : ""}<span class="t">${my === i ? emojiIcon("✓") + " " : ""}${escapeHTML(o)}</span>${voted ? `<span class="pc">${pc}%</span>` : ""}</button>`;
              }).join("");
      }
      async function votePoll(msgId, idx) {
          const m = loadedMsgs[msgId]; if (!m || !m.poll) return;
          const mine = (m.votes || {})[currentUser.uid];
          try { await updateDoc(doc(db, "messages", msgId), { [`votes.${currentUser.uid}`]: mine === idx ? deleteField() : idx }); }
          catch (e) { console.error(e); showToast(e.code === "permission-denied" ? t("Голосование пока недоступно — нужно обновить правила базы") : t("Не удалось проголосовать"), "error"); }
      }
      function renderPollOptions(values) {
          document.getElementById("poll-opts").innerHTML = values.map((v, i) => `<div class="poll-opt-row"><input type="text" maxlength="100" placeholder="${t("Вариант {n}", { n: i + 1 })}" value="${escapeHTML(v)}">${values.length > 2 ? `<button class="icon-btn" data-del-opt="${i}" title="${t("Убрать")}">${icon("x", 18)}</button>` : ""}</div>`).join("");
          document.getElementById("poll-add").style.display = values.length >= 10 ? "none" : "";
      }
      const pollValues = () => [...document.querySelectorAll("#poll-opts input")].map(i => i.value);
      function openPollEditor() {
          document.getElementById("poll-q").value = ""; renderPollOptions(["", ""]);
          document.getElementById("poll-screen").style.display = "flex";
          setTimeout(() => document.getElementById("poll-q").focus(), 50);
      }
      document.getElementById("poll-close").addEventListener("click", () => document.getElementById("poll-screen").style.display = "none");
      document.getElementById("poll-add").addEventListener("click", () => { const v = pollValues(); if (v.length < 10) { v.push(""); renderPollOptions(v); document.querySelector("#poll-opts .poll-opt-row:last-child input").focus(); } });
      document.getElementById("poll-opts").addEventListener("click", (e) => { const b = e.target.closest("[data-del-opt]"); if (!b) return; const v = pollValues(); v.splice(+b.getAttribute("data-del-opt"), 1); renderPollOptions(v); });
      document.getElementById("poll-send").addEventListener("click", async () => {
          const q = document.getElementById("poll-q").value.trim(), options = pollValues().map(v => v.trim()).filter(Boolean);
          if (!q) return showToast(t("Напишите вопрос"), "alert");
          if (options.length < 2) return showToast(t("Нужно хотя бы два варианта"), "alert");
          if (new Set(options.map(o => o.toLowerCase())).size !== options.length) return showToast(t("Варианты не должны повторяться"), "alert");
          const chatId = currentChatId; if (!chatId || !currentUser || iAmBanned) return;
          const peer = dmPeer(chatId); if (peer && (iBlocked(peer) || blockedMe(peer))) return showToast(t("Нельзя отправить в этот чат"), "block");
          document.getElementById("poll-screen").style.display = "none";
          const data = { chatId, sender: currentUser.displayName, uid: currentUser.uid, timestamp: new Date(), read: false, poll: { q: q.slice(0, 200), options: options.slice(0, 10).map(o => o.slice(0, 100)) } };
          try { await postMessage(chatId, data, "📊 Опрос: " + q.slice(0, 80)); } catch (err) { showToast(sendErrorText(err), "error"); }
      });

      // ===== МЕНЮ СКРЕПКИ =====
      function toggleAttachMenu(force) {
          const menu = document.getElementById("attach-menu"), btn = document.getElementById("attach-btn"), main = document.getElementById("main-chat");
          const on = force !== undefined ? force : !menu.classList.contains("on");
          if (on) {
              menu.querySelector('[data-attach="photo"]').innerHTML = icon("image", 20) + t("Фото");
              menu.querySelector('[data-attach="poll"]').innerHTML = icon("poll", 20) + t("Опрос");
              const clip = menu.querySelector('[data-attach="clip"]');
              clip.innerHTML = icon("copy", 20) + t("Из буфера обмена");
              clip.style.display = navigator.clipboard && navigator.clipboard.read ? "" : "none"; // старые браузеры не умеют читать картинки из буфера
              const mr = main.getBoundingClientRect(), br = btn.getBoundingClientRect();
              menu.style.left = Math.max(8, br.left - mr.left) + "px";
              menu.style.bottom = (mr.bottom - br.top + 8) + "px";
          }
          menu.classList.toggle("on", on);
      }
      document.getElementById("attach-menu").addEventListener("click", (e) => {
          const b = e.target.closest("[data-attach]"); if (!b) return;
          toggleAttachMenu(false);
          const kind = b.getAttribute("data-attach");
          if (kind === "photo") document.getElementById("image-input").click(); else if (kind === "clip") pasteFromClipboard(); else openPollEditor();
      });
      document.addEventListener("click", (e) => { if (!e.target.closest("#attach-menu, #attach-btn")) toggleAttachMenu(false); }, true);

      // ===== СТИКЕРЫ «Плюшевый совёнок» =====
      // Файлы sticker-<id>.png лежат рядом с index.html. Список совпадает с правилами базы (там разрешены только эти id)
      const STICKERS = [["hi", t("Привет")], ["love", t("Люблю")], ["haha", t("Ха-ха")], ["thanks", t("Спасибо")], ["ok", t("Ок")], ["think", t("Думаю")], ["wait", t("Жду")], ["party", t("Поздравляю")],
                        ["sad", t("Обидно")], ["angry", t("Злюсь")], ["shock", t("В шоке")], ["coffee", t("Кофе")], ["work", t("Работаю")], ["night", t("Спокойной ночи")], ["secret", t("Секрет")], ["bye", t("Пока")]];
      const STICKER_IDS = new Set(STICKERS.map(s => s[0]));
      function toggleStickerPanel(force) {
          const panel = document.getElementById("sticker-panel"), btn = document.getElementById("sticker-btn"), main = document.getElementById("main-chat");
          const on = force !== undefined ? force : !panel.classList.contains("on");
          if (on) {
              const grid = document.getElementById("sp-grid");
              if (!grid.children.length) grid.innerHTML = STICKERS.map(([id, name]) => `<button type="button" data-sticker="${id}" title="${name}"><img src="sticker-${id}.png" alt="${name}" loading="lazy" draggable="false"></button>`).join("");
              const mr = main.getBoundingClientRect(), ir = document.querySelector(".input-area").getBoundingClientRect();
              panel.style.bottom = (mr.bottom - ir.top + 8) + "px";
              toggleAttachMenu(false);
          }
          panel.classList.toggle("on", on); btn.classList.toggle("on", on);
      }
      document.getElementById("sticker-btn").addEventListener("click", (e) => { e.preventDefault(); toggleStickerPanel(); });
      document.getElementById("sticker-btn").addEventListener("mousedown", (e) => e.preventDefault()); // не забираем фокус у поля
      document.querySelector("#sticker-panel .sp-close").addEventListener("click", () => toggleStickerPanel(false));
      document.getElementById("sp-grid").addEventListener("click", (e) => {
          const b = e.target.closest("[data-sticker]"); if (!b || !currentChatId) return;
          b.style.transform = "scale(.85)"; setTimeout(() => { b.style.transform = ""; }, 160);
          toggleStickerPanel(false);
          sendMessage(null, null, null, null, b.getAttribute("data-sticker"));
      });
      document.addEventListener("click", (e) => { if (!e.target.closest("#sticker-panel, #sticker-btn")) toggleStickerPanel(false); }, true);

      // ===== ПРЕВЬЮ ССЫЛОК (карточку собирает наш сервер owl-push) =====
      const LP_KEY = "owl-lp-v3"; let lpCache = {};
      try { localStorage.removeItem("owl-lp-v1"); localStorage.removeItem("owl-lp-v2"); } catch (_) {}
      try { lpCache = JSON.parse(localStorage.getItem(LP_KEY) || "{}"); } catch (_) {}
      const lpPending = {};
      function firstExternalLink(text) {
          for (const m of String(text).matchAll(LINK_RE)) {
              let url = m[0].replace(/[.,!?:;)\]}»…]+$/, ""), prev = text[m.index - 1];
              if (prev && /[\w@.\/-]/.test(prev)) continue;
              const href = /^https?:\/\//i.test(url) ? url : "https://" + url;
              try { const h = new URL(href).hostname.toLowerCase(); if (h === "owlmes.ru" || h === "www.owlmes.ru") continue; } catch (_) { continue; }
              return href;
          }
          return null;
      }
      function fetchLinkPreview(url) {
          const c0 = lpCache[url];
          if (c0 && !(c0.none && Date.now() - (c0.at || 0) > 3600e3)) return Promise.resolve(c0); // неудачу пробуем снова через час
          if (lpPending[url]) return lpPending[url];
          return lpPending[url] = pushPost("/preview", { url }).then(r => r.ok ? r.json() : null).then(d => {
              const card = d && (d.title || d.description) ? { t: d.title || "", d: d.description || "", i: d.image || "", s: d.site || "" } : { none: 1, at: Date.now() };
              lpCache[url] = card;
              const keys = Object.keys(lpCache); if (keys.length > 300) keys.slice(0, keys.length - 300).forEach(k => delete lpCache[k]);
              try { localStorage.setItem(LP_KEY, JSON.stringify(lpCache)); } catch (_) {}
              return card;
          }).catch(() => ({ none: 1, at: Date.now() })).finally(() => { delete lpPending[url]; });
      }
      function loadLinkPreviews(root) {
          root.querySelectorAll(".lp[data-lp-url]:not([data-done])").forEach(el => {
              el.setAttribute("data-done", "1");
              fetchLinkPreview(el.getAttribute("data-lp-url")).then(c => {
                  if (!c || c.none) { el.remove(); return; }
                  const box = document.getElementById("chat-box"), stick = box.scrollHeight - box.clientHeight - box.scrollTop < 60;
                  const img = c.i && /^https:\/\//.test(c.i) ? `<img src="${escapeHTML(c.i)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : "";
                  el.innerHTML = `${img}<div>${c.s ? `<div class="s">${escapeHTML(c.s)}</div>` : ""}${c.t ? `<div class="h">${escapeHTML(c.t)}</div>` : ""}${c.d ? `<div class="d">${escapeHTML(c.d)}</div>` : ""}</div>`;
                  el.querySelector("img")?.addEventListener("error", (e) => e.target.remove()); // картинка сайта не загрузилась — без «битой» рамки
                  if (stick) { box.scrollTop = box.scrollHeight; el.querySelector("img")?.addEventListener("load", () => { box.scrollTop = box.scrollHeight; }); }
              });
          });
      }

      // Проба защиты от чужих скриптов (CSP) — кнопка в «Панели разработчика» → «Копия» (в приложении с экрана «Домой» нет адресной строки для ?csp=on)
      function renderCspBox() {
          const on = !!window.owlCspCanary, log = window.owlCspLog || [];
          document.getElementById("csp-toggle").textContent = on ? "Выключить пробу" : "Включить пробу";
          document.getElementById("csp-status").textContent = (on ? "Проба включена. " : "Проба выключена. ") + (log.length ? "Заблокировано: " + log.join(" · ") : "Блокировок нет.");
      }
      document.getElementById("csp-toggle").addEventListener("click", () => {
          try { if (window.owlCspCanary) localStorage.removeItem("owl-csp-canary"); else localStorage.setItem("owl-csp-canary", String(Date.now())); } catch (_) {}
          location.reload();
      });

      // ===== ПОИСК ПО ЧАТУ =====
      let chatSearchQuery = "", chatSearchHits = [], chatSearchPos = -1;
      function openChatSearch() {
          const bar = document.getElementById("chat-search");
          document.getElementById("chat-search-up").innerHTML = icon("up", 20);
          document.getElementById("chat-search-down").innerHTML = icon("down", 20);
          document.getElementById("chat-search-close").innerHTML = icon("x", 20);
          bar.classList.add("on"); const inp = document.getElementById("chat-search-input"); inp.focus(); inp.select();
      }
      function closeChatSearch() {
          document.getElementById("chat-search").classList.remove("on");
          document.getElementById("chat-search-input").value = ""; chatSearchQuery = ""; chatSearchHits = []; chatSearchPos = -1;
          document.getElementById("chat-search-cnt").textContent = ""; document.getElementById("chat-search-more").style.display = "none";
      }
      const msgSearchText = (m) => [m.text, m.poll && m.poll.q, ...(m.poll ? m.poll.options : [])].filter(Boolean).join(" ").toLowerCase();
      function runChatSearch(jump = true) {
          const q = chatSearchQuery.toLowerCase();
          chatSearchHits = q ? Object.values(loadedMsgs).filter(m => m.chatId === currentChatId && msgSearchText(m).includes(q)).sort((a, b) => getTime(a.timestamp) - getTime(b.timestamp)).map(m => m.id) : [];
          if (jump) chatSearchPos = chatSearchHits.length - 1; else chatSearchPos = Math.min(chatSearchPos, chatSearchHits.length - 1);
          document.getElementById("chat-search-cnt").textContent = q ? (chatSearchHits.length ? t("{a} из {b}", { a: chatSearchPos + 1, b: chatSearchHits.length }) : t("не найдено")) : "";
          document.getElementById("chat-search-more").style.display = q && hasMoreMsgs ? "" : "none";
          if (jump && chatSearchPos >= 0) showSearchHit();
      }
      function showSearchHit() {
          const row = document.getElementById("msg-" + chatSearchHits[chatSearchPos]); if (!row) return;
          row.scrollIntoView({ behavior: reduceMotion() ? "auto" : "smooth", block: "center" });
          row.classList.remove("msg-flash"); void row.offsetWidth; row.classList.add("msg-flash");
          document.getElementById("chat-search-cnt").textContent = t("{a} из {b}", { a: chatSearchPos + 1, b: chatSearchHits.length });
      }
      let chatSearchTimer = null;
      document.getElementById("chat-search-btn").addEventListener("click", openChatSearch);
      document.getElementById("chat-search-close").addEventListener("click", closeChatSearch);
      document.getElementById("chat-search-input").addEventListener("input", (e) => { clearTimeout(chatSearchTimer); chatSearchTimer = setTimeout(() => { chatSearchQuery = e.target.value.trim(); runChatSearch(true); }, 250); });
      document.getElementById("chat-search-input").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); if (chatSearchHits.length) { chatSearchPos = (chatSearchPos - 1 + chatSearchHits.length) % chatSearchHits.length; showSearchHit(); } } else if (e.key === "Escape") closeChatSearch(); });
      document.getElementById("chat-search-up").addEventListener("click", () => { if (!chatSearchHits.length) return; chatSearchPos = Math.max(0, chatSearchPos - 1); showSearchHit(); });
      document.getElementById("chat-search-down").addEventListener("click", () => { if (!chatSearchHits.length) return; chatSearchPos = Math.min(chatSearchHits.length - 1, chatSearchPos + 1); showSearchHit(); });
      document.getElementById("chat-search-more").addEventListener("click", () => { if (hasMoreMsgs && !loadingOlder) { showToast(t("Загружаем более старые сообщения…"), "clock"); loadOlderMessages(); } });

      // ===== ЧЕРНОВИКИ: недописанный текст хранится для каждого чата на этом устройстве =====
      const draftKey = (chatId) => currentUser ? "owl-draft-" + currentUser.uid + "-" + chatId : null;
      const getDraft = (chatId) => { try { return (chatId && localStorage.getItem(draftKey(chatId))) || ""; } catch (_) { return ""; } };
      function setDraft(chatId, text) {
          if (!chatId || !currentUser) return;
          try { if (text && text.trim()) localStorage.setItem(draftKey(chatId), text.slice(0, 4000)); else localStorage.removeItem(draftKey(chatId)); } catch (_) {}
      }

      // ===== @УПОМИНАНИЯ в беседах и глобальном чате =====
      function mentionCandidates(chatId) {
          if (!currentUser || !chatId || chatId.includes("_")) return [];
          let uids;
          if (groupsCache[chatId]) uids = groupsCache[chatId].members || [];
          else { uids = [...new Set([...Object.values(loadedMsgs).map(m => m.uid), ...(usersCache[currentUser.uid]?.following || [])])]; }
          return uids.filter(u => u && u !== currentUser.uid && usersCache[u]?.name && !bansCache[u]).map(u => ({ uid: u, name: usersCache[u].name }));
      }
      function mentionsIn(text, chatId) {
          if (!text || !text.includes("@")) return [];
          const low = text.toLowerCase();
          return mentionCandidates(chatId).filter(c => low.includes("@" + c.name.toLowerCase())).map(c => c.uid);
      }
      function highlightMentions(html, msg) {
          if (!Array.isArray(msg.mentions) || !msg.mentions.length) return html;
          msg.mentions.map(u => ({ u, n: usersCache[u]?.name })).filter(x => x.n).sort((a, b) => b.n.length - a.n.length).forEach(({ u, n }) => {
              const needle = "@" + escapeHTML(n), mark = `<span class="mention" data-profile-target="${escapeHTML(u)}">${needle}</span>`;
              // внутри ссылок (<a …>…</a>) не трогаем: иначе «@имя» в адресе ломает ссылку
              html = html.split(/(<a\b[^>]*>[\s\S]*?<\/a>)/).map((part, i) => i % 2 ? part : part.split(needle).join(mark)).join("");
          });
          return html;
      }
      let mentionSel = 0, mentionList = [];
      function mentionQuery() {
          const ta = document.getElementById("message-input");
          const before = ta.value.slice(0, ta.selectionStart || 0);
          const m = before.match(/(^|\s)@([^\s@]{0,32})$/);
          return m ? { q: m[2], start: before.length - m[2].length - 1 } : null;
      }
      function updateMentionBox() {
          const box = document.getElementById("mention-box"), mq = mentionQuery();
          const cands = mq ? mentionCandidates(currentChatId) : [];
          mentionList = mq ? cands.filter(c => c.name.toLowerCase().startsWith(mq.q.toLowerCase())).concat(cands.filter(c => !c.name.toLowerCase().startsWith(mq.q.toLowerCase()) && c.name.toLowerCase().includes(mq.q.toLowerCase()))).slice(0, 6) : [];
          if (!mentionList.length) { box.classList.remove("on"); return; }
          mentionSel = Math.min(mentionSel, mentionList.length - 1);
          box.innerHTML = mentionList.map((c, i) => `<button data-mention="${escapeHTML(c.uid)}" class="${i === mentionSel ? "sel" : ""}"><img src="${getAvatar(c.uid, c.name)}" alt="">${escapeHTML(c.name)}</button>`).join("");
          const input = document.querySelector(".input-area"), main = document.getElementById("main-chat");
          box.style.bottom = (main.getBoundingClientRect().bottom - input.getBoundingClientRect().top + 6) + "px";
          box.classList.add("on");
      }
      function insertMention(uid) {
          const c = mentionList.find(x => x.uid === uid), mq = mentionQuery(), ta = document.getElementById("message-input");
          if (!c || !mq) return;
          const after = ta.value.slice(ta.selectionStart);
          const head = ta.value.slice(0, mq.start) + "@" + c.name + " ";
          ta.value = head + after; ta.focus(); ta.setSelectionRange(head.length, head.length);
          document.getElementById("mention-box").classList.remove("on");
          ta.dispatchEvent(new Event("owl-fit"));
          setDraft(currentChatId, ta.value);
      }
      document.getElementById("mention-box").addEventListener("mousedown", (e) => e.preventDefault()); // не забирать фокус у поля
      document.getElementById("mention-box").addEventListener("click", (e) => { const b = e.target.closest("[data-mention]"); if (b) insertMention(b.getAttribute("data-mention")); });

      // ===== РАЗДЕЛИТЕЛИ ПО ДАТАМ =====
      function dayLabel(ts) {
          const d = new Date(ts), today = new Date(), y = new Date(); y.setDate(today.getDate() - 1);
          if (d.toDateString() === today.toDateString()) return t("Сегодня");
          if (d.toDateString() === y.toDateString()) return t("Вчера");
          return d.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: d.getFullYear() === today.getFullYear() ? undefined : "numeric" });
      }
      function placeDaySeparators(box) {
          let lastDay = null;
          for (const row of Array.from(box.children)) {
              if (!row.classList.contains("message-row")) continue;
              const ts = Number(row.getAttribute("data-ts")) || 0; if (!ts) continue;
              const day = new Date(ts).toDateString();
              if (day !== lastDay) {
                  const sep = document.createElement("div"); sep.className = "day-sep"; sep.textContent = dayLabel(ts);
                  box.insertBefore(sep, row); lastDay = day;
              }
          }
      }

      // ===== КНОПКА «ВНИЗ» =====
      let newBelow = 0;
      function updateToBottom() {
          const box = document.getElementById("chat-box"), btn = document.getElementById("to-bottom-btn");
          if (!box || !btn) return;
          const far = box.scrollHeight - box.clientHeight - box.scrollTop > 300;
          if (!far) newBelow = 0;
          btn.style.bottom = (box.parentElement.getBoundingClientRect().bottom - box.getBoundingClientRect().bottom + 14) + "px";
          btn.classList.toggle("show", far);
          const c = document.getElementById("to-bottom-count");
          c.textContent = newBelow > 99 ? "99+" : String(newBelow); c.classList.toggle("on", newBelow > 0);
      }
      document.getElementById("chat-box").addEventListener("scroll", updateToBottom, { passive: true });
      window.addEventListener("resize", updateToBottom);
      document.getElementById("to-bottom-btn").addEventListener("click", () => {
          const box = document.getElementById("chat-box"); newBelow = 0;
          box.scrollTo({ top: box.scrollHeight, behavior: reduceMotion() ? "auto" : "smooth" });
      });

      // ===== ПРОСМОТР ФОТО =====
      // from — картинка в сообщении: фото «вырастает» из неё на весь экран
      function openPhoto(src, caption, from) {
          const img = document.getElementById("pv-img");
          img.src = src;
          document.getElementById("pv-caption").textContent = caption || "";
          document.getElementById("photo-viewer").classList.add("on");
          if (!from || reduceMotion() || !img.animate) return;
          const a = from.getBoundingClientRect();
          const t0 = Date.now();
          (img.decode ? img.decode() : Promise.resolve()).catch(() => {}).then(() => {
              if (Date.now() - t0 > 150) return; // фото грузилось долго и уже на экране — без «прыжка» назад
              const b = img.getBoundingClientRect(); if (!b.width || !a.width) return;
              const sx = a.width / b.width, sy = a.height / b.height, dx = (a.left + a.width / 2) - (b.left + b.width / 2), dy = (a.top + a.height / 2) - (b.top + b.height / 2);
              img.animate([{ transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`, borderRadius: "14px" }, { transform: "none", borderRadius: "8px" }], { duration: 300, easing: "cubic-bezier(.2,.85,.25,1)" });
          });
      }
      const closePhoto = () => { document.getElementById("photo-viewer").classList.remove("on"); document.getElementById("pv-img").removeAttribute("src"); };
      document.getElementById("pv-close").addEventListener("click", (e) => { e.stopPropagation(); closePhoto(); });
      document.getElementById("photo-viewer").addEventListener("click", (e) => { if (e.target.id === "photo-viewer") closePhoto(); });
      document.addEventListener("keydown", (e) => { if (e.key === "Escape" && document.getElementById("photo-viewer").classList.contains("on")) closePhoto(); });
      document.getElementById("pv-save").addEventListener("click", async (e) => {
          e.stopPropagation();
          const src = document.getElementById("pv-img").src; if (!src) return;
          try {
              const blob = await (await fetch(src)).blob();
              const ext = (blob.type.split("/")[1] || "jpg").replace("jpeg", "jpg"), file = new File([blob], "owl-photo." + ext, { type: blob.type || "image/jpeg" });
              if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file] }); return; }
              const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = file.name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
          } catch (err) { if (err && err.name !== "AbortError") showToast(t("Не удалось сохранить фото"), "error"); }
      });

      // ===== ССЫЛКИ В СООБЩЕНИЯХ =====
      // Находим https://…, www.… и «голые» адреса вида site.ru/… и делаем их кликабельными.
      // Текст экранируется по кусочкам, поэтому HTML из сообщения по-прежнему не выполняется.
      const LINK_RE = /(?:https?:\/\/|www\.)[^\s<>"']+|(?:[a-zа-яё0-9-]+\.)+(?:ru|рф|com|org|net|io|me|app|dev|su|info|tv|gg|by|kz|ua|online|site|store|pro|xyz|live|link)(?::\d+)?(?:\/[^\s<>"']*)?/gi;
      function linkify(raw) {
          raw = String(raw || ""); let out = "", last = 0;
          for (const m of raw.matchAll(LINK_RE)) {
              let url = m[0]; const i = m.index; const prev = raw[i - 1];
              if (prev && /[\w@.\/-]/.test(prev)) continue; // часть e-mail или слова
              let trail = "";
              while (/[.,!?:;)\]}»…]$/.test(url)) {
                  if (url.endsWith(")") && url.split("(").length > url.split(")").length - 1) break; // скобка из самой ссылки (Википедия)
                  trail = url.slice(-1) + trail; url = url.slice(0, -1);
              }
              const href = /^https?:\/\//i.test(url) ? url : "https://" + url;
              let host;
              try { host = new URL(href).hostname.toLowerCase(); } catch (_) { continue; }
              const internal = host === "owlmes.ru" || host === "www.owlmes.ru";
              out += escapeHTML(raw.slice(last, i)) +
                  `<a class="msg-link" href="${escapeHTML(href)}" target="_blank" rel="noopener noreferrer nofollow"${internal ? " data-owl-link" : ""}>${escapeHTML(url)}</a>` + escapeHTML(trail);
              last = i + m[0].length;
          }
          return out + escapeHTML(raw.slice(last));
      }
      function escapeHTML(str) {
        if (!str) return "";
        return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
      }

      function generateAvatarSVG(name, isGroup = false) {
          let safeName = String(name || (isGroup ? "Group" : "User")).trim();
          if (safeName === "undefined" || safeName === "null" || safeName === "") safeName = isGroup ? "G" : "U";
          let initials = safeName.replace(/[^a-zA-Zа-яА-Я0-9]/g, "").substring(0, 2).toUpperCase() || "U";

          let hash = 0;
          for (let i = 0; i < safeName.length; i++) { hash = safeName.charCodeAt(i) + ((hash << 5) - hash); }
          let h = Math.abs(hash) % 360;
          let color = `hsl(${h}, ${isGroup ? '50%' : '70%'}, ${isGroup ? '45%' : '55%'})`;

          let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">
              <rect width="100" height="100" fill="${color}" rx="${isGroup ? '25' : '50'}"/>
              <text x="50" y="55" font-family="Arial, sans-serif" font-size="40" font-weight="bold" fill="#ffffff" text-anchor="middle" dominant-baseline="middle">${initials}</text>
          </svg>`;
          return 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)));
      }

      // Аватарка заблокированного пользователя — мёртвая сова
      const DEAD_OWL_AVATAR = "data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22%3E%3Crect width=%22100%22 height=%22100%22 fill=%22%232a2f37%22/%3E%3Cellipse cx=%2250%22 cy=%2213%22 rx=%2217%22 ry=%224.5%22 fill=%22none%22 stroke=%22%23e8c35a%22 stroke-width=%223%22 opacity=%22.9%22/%3E%3Cpath d=%22M27 34 L31 16 L42 29 Z M73 34 L69 16 L58 29 Z%22 fill=%22%236f7680%22/%3E%3Cellipse cx=%2250%22 cy=%2260%22 rx=%2231%22 ry=%2233%22 fill=%22%236f7680%22/%3E%3Cellipse cx=%2250%22 cy=%2247%22 rx=%2225%22 ry=%2218%22 fill=%22%238d949d%22/%3E%3Ccircle cx=%2239%22 cy=%2246%22 r=%229.5%22 fill=%22%23dfe3e8%22/%3E%3Ccircle cx=%2261%22 cy=%2246%22 r=%229.5%22 fill=%22%23dfe3e8%22/%3E%3Cpath d=%22M34 41 L44 51 M44 41 L34 51 M56 41 L66 51 M66 41 L56 51%22 stroke=%22%232a2f37%22 stroke-width=%223.2%22 stroke-linecap=%22round%22/%3E%3Cpath d=%22M46 55 L54 55 L50 63 Z%22 fill=%22%23b8963a%22/%3E%3Cpath d=%22M50 63 q3 5 0 8 q-2 -3 0 -8%22 fill=%22%23c96a7a%22/%3E%3Cellipse cx=%2250%22 cy=%2280%22 rx=%2217%22 ry=%2212%22 fill=%22%238d949d%22/%3E%3Cpath d=%22M42 77 q4 4 8 0 q4 4 8 0 M44 84 q3 3 6 0 q3 3 6 0%22 fill=%22none%22 stroke=%22%236f7680%22 stroke-width=%222%22 stroke-linecap=%22round%22/%3E%3C/svg%3E";
      // Ссылка на картинку из базы попадает в разметку (src="…") — пропускаем только настоящие картинки:
      // data:image/…;base64 или https-адрес без кавычек, пробелов и угловых скобок. Иначе — null (будет аватар-заглушка)
      function safeImg(url) {
        if (typeof url !== "string" || url.length > 3000000) return null;
        if (/^data:image\/(png|jpeg|jpg|webp|gif|svg\+xml);base64,[A-Za-z0-9+\/=]+$/.test(url)) return url;
        // аватары по ссылке (https) больше не грузим: каждый, кто видит такой аватар, выдал бы владельцу ссылки свой IP — вместо них рисуем букву
        return null;
      }
      function getAvatar(uid, fallbackName) {
        if (uid && bansCache[uid]) return DEAD_OWL_AVATAR;
        let cached = usersCache[uid];
        const photo = cached && safeImg(cached.photoURL);
        if (photo && allowedBy(cached, "photo")) {
            return photo;
        }
        return generateAvatarSVG(fallbackName || (cached ? cached.name : "User"));
      }

      function getTime(ts) {
        if (!ts) return 0;
        if (typeof ts.toMillis === 'function') return ts.toMillis();
        if (ts.seconds) return ts.seconds * 1000;
        if (ts instanceof Date) return ts.getTime();
        return new Date(ts).getTime() || 0;
      }

      let usersCache = {};
      let groupsCache = {};
      let chatsMetaCache = {}; 
      
      let usersListener = null;
      let groupsListener = null;
      let metaListener = null;
      let globalMetaListener = null, newsMetaListener = null, groupMetaListeners = {};
      let userWatchers = {}, privateListener = null; const privateEmails = {}, privateDocs = {}; // users_private всех — только у админа
      const emailOf = (u) => (u && (privateEmails[u.uid] || u.email)) || "";
      // ЛИЧНОЕ И ПОДПИСКИ (этап 2 защиты). Личные настройки — в закрытой users_private/{я}, подписки — отдельными
      // записями follows/{кто}_{на кого}. В публичном профиле остаются только счётчики followersCount/followingCount.
      // Старые поля (following/followers/pinnedChats/…) в профиле ещё могут быть до миграции — их учитываем.
      const PRIVATE_PREFS = ["pinnedChats", "quickReaction", "onboarded", "invitedByNick"];
      const LEGACY_FIELDS = ["followers", "following", ...PRIVATE_PREFS];
      let myPrivate = null, myFollowsOut = null, myFollowsIn = null, myRawProfile = null, ownListeners = [], myFollowersAt = {};
      let healedFollowing = -1, privMigrating = false;
      // Наложить личные данные на мой профиль в кэше (остальной код читает usersCache[я].following / pinnedChats / …)
      function overlayMe(u) {
          if (!u || !currentUser || u.uid !== currentUser.uid) return;
          if (myPrivate) PRIVATE_PREFS.forEach(k => { if (myPrivate[k] !== undefined) u[k] = myPrivate[k]; });
          const legacy = (myRawProfile && Array.isArray(myRawProfile.following)) ? myRawProfile.following : [];
          if (myFollowsOut) u.following = [...new Set([...legacy, ...myFollowsOut])];
      }
      // Подписаться / отписаться: запись-подписка + счётчики (правила базы проверяют, что счётчик меняется ровно на 1)
      async function setFollow(targetUid, on) {
          const uid = currentUser.uid; if (!targetUid || targetUid === uid) return;
          const edge = doc(db, "follows", uid + "_" + targetUid);
          if (on) {
              const b = writeBatch(db);
              b.set(edge, { from: uid, to: targetUid, createdAt: new Date() });
              b.update(doc(db, "users", targetUid), { followersCount: increment(1) });
              b.update(doc(db, "users", uid), { followingCount: increment(1) });
              await b.commit();
              // Одно уведомление на пару «кто → кого»: повторная подписка попадает в тот же документ, а менять его
              // может только получатель — правила базы отклонят запись, и второго уведомления не будет
              setDoc(doc(db, "notifications", `follow_${uid}_${targetUid}`), { fromUid: uid, toUid: targetUid, text: `${currentUser.displayName} подписался на вас!`, timestamp: new Date(), read: false, type: "follow" }).catch(e => console.log("Уведомление о подписке:", e.code));
              return;
          }
          if (myFollowsOut && myFollowsOut.has(targetUid)) {
              const b = writeBatch(db);
              b.delete(edge);
              b.update(doc(db, "users", targetUid), { followersCount: increment(-1) });
              b.update(doc(db, "users", uid), { followingCount: increment(-1) });
              await b.commit();
          }
          // Подписка старого образца (ещё не перенесена) — убираем из массивов
          if (myRawProfile && (myRawProfile.following || []).includes(targetUid)) {
              await setDoc(doc(db, "users", uid), { following: arrayRemove(targetUid) }, { merge: true });
              await setDoc(doc(db, "users", targetUid), { followers: arrayRemove(uid) }, { merge: true }).catch(e => console.log("followers:", e.code));
          }
      }
      // ПРИГЛАШЕНИЯ В БЕСЕДЫ (этап 3а): group_invites/{беседа}_{кого}. В беседу человек попадает, только приняв
      // приглашение; правила базы проверяют его настройку «Кто может добавлять в беседы».
      let myInvites = [];
      async function sendGroupInvites(gid, groupName, uids) {
          let sent = 0;
          await Promise.all(uids.map(async (to) => {
              try {
                  await setDoc(doc(db, "group_invites", gid + "_" + to), { gid, groupName: String(groupName || "Беседа").slice(0, 100), toUid: to, fromUid: currentUser.uid, fromName: (currentUser.displayName || "").slice(0, 64), createdAt: new Date() });
                  sent++;
                  addDoc(collection(db, "notifications"), { fromUid: currentUser.uid, toUid: to, text: `${currentUser.displayName} приглашает вас в беседу «${groupName}»`, timestamp: new Date(), read: false, type: "invite", chatId: gid }).catch(() => {});
              } catch (e) { console.log("Приглашение " + to + ":", e.code || e); }
          }));
          return sent;
      }
      function renderGroupInvites() {
          const box = document.getElementById("group-invites");
          box.innerHTML = myInvites.filter(i => !bansCache[i.fromUid] && !iBlocked(i.fromUid)).map(i => `<div class="gi-card" data-gi="${escapeHTML(i.id)}">
              <p>${t("{name} приглашает вас в беседу «{group}»", { name: `<b>${escapeHTML(i.fromName || t("Пользователь"))}</b>`, group: `<b>${escapeHTML(i.groupName || t("Беседа"))}</b>` })}</p>
              <div class="gi-actions"><button class="gi-no" data-gi-act="no">${t("Отклонить")}</button><button class="gi-ok" data-gi-act="ok">${t("Вступить")}</button></div></div>`).join("");
      }
      document.getElementById("group-invites").addEventListener("click", async (e) => {
          const btn = e.target.closest("[data-gi-act]"); if (!btn) return;
          const id = btn.closest("[data-gi]").getAttribute("data-gi"), inv = myInvites.find(i => i.id === id); if (!inv) return;
          btn.disabled = true;
          try {
              if (btn.getAttribute("data-gi-act") === "ok") {
                  const b = writeBatch(db);
                  b.update(doc(db, "groups", inv.gid), { members: arrayUnion(currentUser.uid) });
                  b.delete(doc(db, "group_invites", id));
                  await b.commit();
                  showToast(t("Вы вступили в беседу «{group}»", { group: inv.groupName || t("Беседа") }), "users");
                  window.loadChat(inv.gid, inv.groupName || t("Беседа"), inv.gid, true);
              } else {
                  await deleteDoc(doc(db, "group_invites", id));
                  showToast(t("Приглашение отклонено"), "info");
              }
          } catch (err) {
              console.error(err); btn.disabled = false;
              // беседу удалили или приглашение отозвали — просто убираем карточку
              if (err.code === "not-found" || err.code === "permission-denied") { deleteDoc(doc(db, "group_invites", id)).catch(() => {}); showToast(t("Приглашение больше не действует"), "alert"); }
              else showToast(t("Не удалось ответить на приглашение"), "error");
          }
      });
      // Число подписчиков/подписок из публичного профиля (старые профили — по длине массива)
      const followCount = (u, key) => {
          if (currentUser && u.uid === currentUser.uid) {
              if (key === "following") return (u.following || []).length;
              if (myFollowsIn) return new Set([...myFollowsIn, ...((myRawProfile && myRawProfile.followers) || [])]).size;
          }
          const c = Math.max(0, Number(u[key + "Count"]) || 0);
          return Array.isArray(u[key]) ? Math.max(c, u[key].length) : c;
      };
      // ФОТО, «О СЕБЕ», «БЫЛ В СЕТИ» С ОГРАНИЧЕННОЙ АУДИТОРИЕЙ (этап 2в). При настройке «Все» поле лежит в публичном
      // профиле; при «Мои подписки»/«Никто» — в закрытом документе restricted/{uid}_{photo|bio|lastSeen},
      // который база отдаёт только владельцу, админу и тем, кому разрешено (правила проверяют подписку).
      const R_FIELDS = { photo: ["photoURL"], bio: ["bio"], lastSeen: ["online", "lastSeen"] };
      const rawProfiles = {}, restrictedData = {}, rWatchers = {}, rDenied = new Set();
      const isRestricted = (u, key) => privacyOf(u, key) !== "all";
      function applyRestricted(u) {
          Object.keys(R_FIELDS).forEach(key => {
              const r = restrictedData[u.uid + "_" + key];
              if (r && isRestricted(u, key)) R_FIELDS[key].forEach(f => { if (r[f] !== undefined) u[f] = r[f]; });
          });
      }
      // Подписаться на закрытые поля человека, если они ограничены и мне их видно; лишние подписки снять
      function ensureRestrictedWatch(u) {
          if (!u || !u.uid || !currentUser) return;
          Object.keys(R_FIELDS).forEach(key => {
              const id = u.uid + "_" + key, p = privacyOf(u, key);
              const need = p !== "all" && (isAdmin || u.uid === currentUser.uid || (p === "following" && followsMe(u))) && !(key === "lastSeen" && p === "nobody");
              if (need && !rWatchers[id] && !rDenied.has(id)) {
                  rWatchers[id] = onSnapshot(doc(db, "restricted", id), (d) => {
                      restrictedData[id] = d.exists() ? d.data() : null;
                      reingestUser(u.uid);
                  }, (e) => { console.log("restricted/" + id + ":", e.code); rDenied.add(id); if (rWatchers[id]) rWatchers[id](); delete rWatchers[id]; delete restrictedData[id]; reingestUser(u.uid); });
              } else if (!need && rWatchers[id]) { rWatchers[id](); delete rWatchers[id]; delete restrictedData[id]; }
          });
      }
      const reingestUser = (uid) => { if (rawProfiles[uid] && window.__ingestUser) { window.__ingestUser({ ...rawProfiles[uid] }, true); usersChanged(); } };
      // Записать своё поле туда, где ему место по моей настройке
      async function writeMyField(key, data) {
          const uid = currentUser.uid;
          if (myPrivacy(key) === "all") return setDoc(doc(db, "users", uid), data, { merge: true });
          const me = usersCache[uid]; if (me) Object.assign(me, data);
          await setDoc(doc(db, "restricted", uid + "_" + key), { uid, ...data }, { merge: true });
      }
      // Значение поля для переноса: Date для времени визита, остальное как есть
      const pickFields = (u, key) => { const o = {}; R_FIELDS[key].forEach(f => { if (u[f] !== undefined && u[f] !== null) o[f] = u[f]; }); return o; };
      // Перенести поля профиля uid по его настройкам: ограниченные — из users в restricted (используют и клиент, и админ)
      async function moveRestrictedFields(raw) {
          const del = {}; let moved = 0;
          for (const key of Object.keys(R_FIELDS)) {
              const p = privacyOf(raw, key);
              if (p === "all") continue;
              const vals = pickFields(raw, key);
              const dirty = key === "lastSeen" ? (raw.lastSeen !== undefined || raw.online === true) : Object.keys(vals).length > 0;
              if (!dirty) continue;
              if (!(key === "lastSeen" && p === "nobody") && Object.keys(vals).length) {
                  if (key === "lastSeen") vals.online = false;
                  await setDoc(doc(db, "restricted", raw.uid + "_" + key), { uid: raw.uid, ...vals }, { merge: true });
              }
              R_FIELDS[key].forEach(f => { del[f] = deleteField(); });
              if (key === "lastSeen") del.online = false;
              moved++;
          }
          if (moved) await setDoc(doc(db, "users", raw.uid), del, { merge: true });
          return moved;
      }
      const MAX_USER_WATCHERS = 400;
      // После изменения профилей: перерисовать всё, что от них зависит (склеиваем частые изменения)
      let usersChangedTimer = null;
      function usersChangedNow() {
          clearTimeout(usersChangedTimer); usersChangedTimer = null;
          renderChatList(document.getElementById("search-input").value);
          updatePinIcon(); refreshHeaderStatus(); applyBlockState(); renderDevPanel();
          if (window.__pendingChat && Object.keys(chatsMetaCache).length) { const id = window.__pendingChat; window.__pendingChat = null; window.openChatById(id); }
          if (presenceTimer && !presenceInit && currentUser && usersCache[currentUser.uid]) { presenceInit = true; writePresence(document.visibilityState === "visible"); }
          if (currentUser && usersCache[currentUser.uid]) { maybeShowOnboarding(); if (window.__pendingAdd) openPendingInvite(); }
          if (call) callPeerHeader(); // профиль собеседника подгрузился во время звонка — имя и аватар вместо «Собеседник»
      }
      const usersChanged = () => { if (!usersChangedTimer) usersChangedTimer = setTimeout(usersChangedNow, 60); };
      // Подписаться на профиль одного человека (не админ — админ и так слушает всех)
      function watchUser(uid) {
          if (!uid || !currentUser || isAdmin || uid === "global" || userWatchers[uid]) return;
          if (Object.keys(userWatchers).length >= MAX_USER_WATCHERS) return;
          userWatchers[uid] = onSnapshot(doc(db, "users", uid), (d) => {
              if (!d.exists()) { delete usersCache[uid]; usersChanged(); return; }
              if (window.__ingestUser) window.__ingestUser(d.data(), true);
              usersChanged();
          }, (e) => { console.log("users/" + uid + ":", e.code); });
      }
      // Мои люди: подписки, заблокированные, собеседники по личкам, участники бесед
      function watchContacts() {
          if (!currentUser || isAdmin) return;
          const me = usersCache[currentUser.uid] || {};
          (me.following || []).forEach(watchUser);
          myBlockedSet.forEach(watchUser);
          Object.keys(chatsMetaCache).forEach(id => { const p = dmPeer(id); if (p) watchUser(p); });
          Object.values(groupsCache).forEach(g => (g.members || []).forEach(watchUser));
      }

      // ===== ЗВУК УВЕДОМЛЕНИЙ (не прерывает музыку) =====
      // <audio> телефон считает «медиа» и ставит музыку на паузу. Поэтому короткий сигнал синтезируем через Web Audio,
      // а на iOS включаем режим ambient — звук смешивается с музыкой (и уважает беззвучный режим).
      const audioSession = navigator.audioSession;
      const setAudioSession = (type) => { if (audioSession) try { audioSession.type = type; } catch (_) {} };
      setAudioSession("ambient");
      // Вернуться в «фоновый» режим, когда ничего не играет и не пишется (в ambient iOS запрещает запись с микрофона!)
      function restoreAmbient() {
          if (isRecording || call) return; // идёт звонок — микрофон нужен
          if (![...document.querySelectorAll("audio")].some(a => !a.paused)) setAudioSession("ambient");
      }
      // Голосовые сообщения — полноценное воспроизведение, на это время переключаемся в playback
      // (кроме звонка: там звук собеседника идёт через <audio>, а режим должен остаться «запись + воспроизведение»)
      document.addEventListener("play", (e) => { if (audioSession && e.target.tagName === "AUDIO" && !call) try { audioSession.type = "playback"; } catch (_) {} }, true);
      ["pause", "ended"].forEach(ev => document.addEventListener(ev, (e) => {
          if (!audioSession || e.target.tagName !== "AUDIO") return;
          restoreAmbient();
      }, true));

      let notifyCtx = null;
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      function getNotifyCtx() {
          if (!AudioCtx) return null;
          if (!notifyCtx) { try { notifyCtx = new AudioCtx(); } catch (_) { return null; } }
          return notifyCtx;
      }
      // iOS разрешает звук только после касания — «разблокируем» контекст на первом жесте
      ["pointerdown", "touchend", "keydown"].forEach(ev => document.addEventListener(ev, () => { const c = getNotifyCtx(); if (c && c.state !== "running") c.resume().catch(() => {}); }, { passive: true })); // iOS бывает и «interrupted»

      let lastSoundAt = 0;
      function playNotifySound() {
          const el = document.getElementById("notification-sound");
          if (el && el.muted) return; // выключено в настройках
          if (Date.now() - lastSoundAt < 700) return; lastSoundAt = Date.now(); // пачка сообщений — один сигнал
          const ctx = getNotifyCtx();
          if (!ctx || ctx.state !== "running") return;
          // Короткий «тынь-дынь» в духе мессенджеров: два стеклянных щелчка вверх (маримба: основной тон + обертон)
          const t0 = ctx.currentTime;
          [[1046.5, 0], [1568, 0.075]].forEach(([freq, delay]) => {
              [[1, 0.2, 0.16], [3.9, 0.05, 0.05]].forEach(([mult, vol, dur]) => {
                  const osc = ctx.createOscillator(), gain = ctx.createGain();
                  osc.type = "sine"; osc.frequency.value = freq * mult;
                  gain.gain.setValueAtTime(0.0001, t0 + delay);
                  gain.gain.exponentialRampToValueAtTime(vol, t0 + delay + 0.004);
                  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + delay + dur);
                  osc.connect(gain).connect(ctx.destination);
                  osc.start(t0 + delay); osc.stop(t0 + delay + dur + 0.03);
              });
          });
      }

      // ===== СЧЁТЧИК НЕПРОЧИТАННЫХ И СИСТЕМНЫЕ УВЕДОМЛЕНИЯ =====
      const BASE_TITLE = document.title;
      function updateUnreadIndicators(total) {
          document.title = total > 0 ? `(${total > 99 ? "99+" : total}) ${BASE_TITLE}` : BASE_TITLE;
          // Бейдж на иконке установленного приложения (ПК, macOS, iPhone с iOS 16.4+ на экране «Домой»)
          try {
              if (total > 0 && navigator.setAppBadge) navigator.setAppBadge(total).catch(() => {});
              else if (navigator.clearAppBadge) navigator.clearAppBadge().catch(() => {});
          } catch (_) {}
      }
      const pushEnabled = () => { try { return "Notification" in window && Notification.permission === "granted" && localStorage.getItem("owl-push") !== "off"; } catch (_) { return false; } };
      function totalUnread() {
          let total = 0;
          for (const [chatId, meta] of Object.entries(chatsMetaCache)) {
              if (!meta || !meta.unreadCount || chatId === currentChatId || !isMyChat(chatId) || isMyMeta(meta) || iBlocked(dmPeer(chatId))) continue;
              total += meta.unreadCount;
          }
          return total;
      }
      function isMyChat(chatId) {
          if (!currentUser || chatId === "global") return false;
          if (chatId.includes("_")) return chatId.split("_").includes(currentUser.uid);
          return !!(groupsCache[chatId] && groupsCache[chatId].members && groupsCache[chatId].members.includes(currentUser.uid));
      }
      function chatTitle(chatId, meta) {
          if (groupsCache[chatId]) return groupsCache[chatId].name || t("Беседа");
          if (chatId === NEWS_ID) return "Owl Messenger";
          // Имя — только из профиля: lastMessageSender пишет сам отправитель, там может быть «Owl Messenger» или чужое имя
          const other = chatId.split("_").find(id => id !== currentUser.uid);
          return usersCache[other]?.name || t("Пользователь");
      }
      async function showSystemNotification(chatId, meta) {
          if (!pushEnabled()) return;
          const count = meta.unreadCount || 1;
          let text = trPreview(String(meta.lastMessageText || t("Новое сообщение")));
          { const who = groupsCache[chatId] && usersCache[meta.lastMessageSenderUid]?.name; if (who) text = who + ": " + text; }
          const total = totalUnread();
          const opts = {
              body: (count > 1 ? t("{n} новых", { n: count }) + " · " : "") + text + (total > count ? "\n" + t("Всего непрочитанных: {n}", { n: total }) : ""),
              icon: "/icon-192.png", badge: "/icon-192.png",
              tag: "chat-" + chatId, renotify: true, data: { chatId: chatId }
          };
          try {
              const reg = await navigator.serviceWorker?.getRegistration();
              if (reg) await reg.showNotification(chatTitle(chatId, meta), opts);
              else new Notification(chatTitle(chatId, meta), opts);
          } catch (e) { console.log("Уведомление не показано:", e); }
      }
      async function closeChatNotifications(chatId) {
          try { const reg = await navigator.serviceWorker?.getRegistration(); if (!reg) return; (await reg.getNotifications({ tag: "chat-" + chatId })).forEach(n => n.close()); } catch (_) {}
      }
      // Открыть чат по id (из уведомления)
      window.openChatById = (chatId) => {
          if (!chatId || !currentUser) return;
          if (isNest(chatId)) return window.loadChat(chatId, t("Гнездо"), null, false);
          if (chatId === NEWS_ID) return window.loadChat(NEWS_ID, t("Новости Owl"), null, false);
          if (groupsCache[chatId]) return window.loadChat(chatId, groupsCache[chatId].name, null, true); // экранирует сам loadChat
          const other = chatId.split("_").find(id => id !== currentUser.uid);
          if (other && usersCache[other]) window.loadChat(chatId, usersCache[other].name, other, false);
      };
      if (navigator.serviceWorker) navigator.serviceWorker.addEventListener("message", (e) => { if (e.data && e.data.type === "open-chat") window.openChatById(e.data.chatId); });
      try { const pending = new URLSearchParams(location.search).get("chat"); if (pending) window.__pendingChat = pending; } catch (_) {}

      // Реакция на новое сообщение в любом из моих чатов (по метаданным чатов)
      function onChatMetaChanged(chatId, meta, prev) {
          if (!isMyChat(chatId) || isMyMeta(meta)) return;
          if (iBlocked(meta.lastMessageSenderUid) || iBlocked(dmPeer(chatId))) return;
          if (!((meta.unreadCount || 0) > ((prev && prev.unreadCount) || 0))) return; // правка/сброс — не новое сообщение
          const visible = document.visibilityState === "visible";
          if (chatId === currentChatId && chatIsOnScreen()) return; // открытый чат сам проиграет звук
          if (visible) playNotifySound();
          else if (!iAmAsleep()) showSystemNotification(chatId, meta); // у меня ночь — «Сова не будит»
      }

      // ===== PUSH-УВЕДОМЛЕНИЯ ЧЕРЕЗ СЕРВЕР (приходят, даже когда Owl закрыт) =====
      // Сервер — Cloudflare Worker owl-push (код в push-server/worker.js)
      const PUSH_SERVER = "https://push.owlmes.ru";
      const b64uToBytes = (str) => { str = str.replace(/-/g, "+").replace(/_/g, "/"); while (str.length % 4) str += "="; const bin = atob(str); return Uint8Array.from(bin, c => c.charCodeAt(0)); };
      const bytesToB64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      const serverPushSupported = () => "PushManager" in window && !!navigator.serviceWorker;
      async function pushPost(path, data) {
          const token = await currentUser.getIdToken();
          // Пропуск App Check — сервер пушей читает базу от имени пользователя и предъявляет его
          let ac = null; if (appCheck) try { ac = (await getAppCheckToken(appCheck)).token; } catch (e) { console.log("App Check токен:", e.code || e.message || e); }
          // text/plain — без лишнего CORS-запроса; сервер всё равно разбирает JSON
          return fetch(PUSH_SERVER + path, { method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify({ ...data, token, ...(ac ? { appCheck: ac } : {}) }), keepalive: true });
      }
      async function serverPushSubscribe() {
          if (!currentUser || !serverPushSupported()) return false;
          try {
              const reg = await navigator.serviceWorker.ready;
              const { key } = await fetch(PUSH_SERVER + "/vapid").then(r => r.json());
              let sub = await reg.pushManager.getSubscription();
              const oldKey = sub && sub.options && sub.options.applicationServerKey;
              if (sub && oldKey && bytesToB64u(oldKey) !== key) { await sub.unsubscribe().catch(() => {}); sub = null; }
              if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uToBytes(key) });
              return (await pushPost("/subscribe", { subscription: sub.toJSON() })).ok;
          } catch (e) { console.log("Push-подписка не удалась:", e); return false; }
      }
      async function serverPushUnsubscribe() {
          try {
              const reg = await navigator.serviceWorker?.getRegistration(); if (!reg || !reg.pushManager) return;
              const sub = await reg.pushManager.getSubscription(); if (!sub) return;
              if (currentUser) await pushPost("/unsubscribe", { endpoint: sub.endpoint }).catch(() => {});
              await sub.unsubscribe().catch(() => {});
          } catch (_) {}
      }
      function notifyPushServer(messageId) {
          if (!currentUser || !messageId) return;
          pushPost("/notify", { messageId }).catch(() => {});
      }
      // Выход из аккаунта: отвязываем устройство, чтобы чужие сообщения сюда не приходили
      async function logoutEverywhere(sendOffline = true) {
          stopPresence(sendOffline);
          await Promise.race([serverPushUnsubscribe(), new Promise(r => setTimeout(r, 2500))]);
          clearPersonalData();
          signOut(auth);
      }
      // После выхода на устройстве не остаётся личного: черновики, «Сова на страже», прочитанное, карточки ссылок из чатов
      function clearPersonalData() {
          try {
              Object.keys(localStorage).filter(k => /^owl-(draft-|guard|seen-followers-|otp-sent-|active-)/.test(k) || ["owl-reads", "owl-lp-v3", "owl-invite", "owl_custom_bg_data"].includes(k)).forEach(k => localStorage.removeItem(k));
              sessionStorage.clear();
          } catch (_) {}
      }

      // Капля под вкладками «Все / Подписки» — её ведёт и код стекла (по смене вкладки), и свайп по списку (hold — пока палец на экране)
      const lgTabs = { hold: false, place: () => {}, ind: null };
      // ===== LIQUID GLASS (Owl v2): стили — в конце <style>. Здесь — фильтр преломления, блик за курсором, капля вкладок =====
      (() => {
          const root = document.documentElement;
          // Слабое устройство, «Уменьшение движения» или упрощённый режим — облегчённое стекло (без преломления и блика).
          // Пересчитываем при переключении режима в настройках (событие owl-motion) и смене системной настройки
          const weak = !!((navigator.deviceMemory && navigator.deviceMemory <= 2) || (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 2));
          // Преломление умеет рисовать только Chrome (SVG-фильтр в backdrop-filter); navigator.userAgentData есть только у него
          const canRefract = !!navigator.userAgentData && CSS.supports("backdrop-filter", "url(#lg-refract) blur(1px)");
          let refractSvg = false;
          const applyGlass = () => {
              const lite = weak || reduceMotion();
              root.classList.toggle("lg-lite", lite);
              if (!lite && canRefract && !refractSvg) { refractSvg = true; document.body.insertAdjacentHTML("beforeend", REFRACT_SVG); }
              root.classList.toggle("lg-refract", !lite && canRefract);
          };
          const REFRACT_SVG = '<svg width="0" height="0" style="position:absolute" aria-hidden="true"><filter id="lg-refract" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB"><feTurbulence type="fractalNoise" baseFrequency="0.011 0.017" numOctaves="2" seed="7" result="n"/><feGaussianBlur in="n" stdDeviation="2.2" result="nb"/><feDisplacementMap in="SourceGraphic" in2="nb" scale="22" xChannelSelector="R" yChannelSelector="G"/></filter></svg>';
          applyGlass();
          // Блик, который следует за курсором (только мышь/трекпад)
          const SPEC = ".modal-box, .toast, .sph-pill, #guard-bar, #attach-menu, .chat-header";
          const markSpec = (el) => el.classList.add("lg-spec");
          document.querySelectorAll(SPEC).forEach(markSpec);
          new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) if (n.nodeType === 1 && n.matches(SPEC)) markSpec(n); })
              .observe(document.getElementById("toast-container") || document.body, { childList: true });
          if (!weak && matchMedia("(pointer: fine)").matches) {
              let el = null, ev = null, raf = 0;
              document.addEventListener("pointermove", (e) => {
                  if (root.classList.contains("lg-lite")) return; // облегчённое стекло — без блика
                  ev = e; if (raf) return;
                  raf = requestAnimationFrame(() => {
                      raf = 0;
                      const tg = ev.target && ev.target.closest ? ev.target.closest(".lg-spec") : null;
                      if (el && el !== tg) { el.style.removeProperty("--lx"); el.style.removeProperty("--ly"); }
                      el = tg; if (!tg) return;
                      const r = tg.getBoundingClientRect();
                      tg.style.setProperty("--lx", Math.round(ev.clientX - r.left) + "px"); tg.style.setProperty("--ly", Math.round(ev.clientY - r.top) + "px");
                  });
              }, { passive: true });
          }
          // Вкладки «Все / Подписки»: под выбранной — стеклянная капля, которая перетекает к новой вкладке
          const box = document.querySelector("#sidebar .tabs-container");
          if (box) {
              box.classList.add("lg-tabs");
              const ind = document.createElement("i"); ind.className = "lg-ind"; ind.setAttribute("aria-hidden", "true"); box.prepend(ind);
              // Место и размер пересчитываем при смене вкладки И при любом изменении её ширины: догрузился шрифт,
              // на значке стало «36» вместо «0» (раньше капля оставалась старого размера — шире или уже вкладки)
              const place = (instant) => {
                  if (lgTabs.hold) return;
                  const a = box.querySelector(".tab.active"); if (!a || !a.offsetWidth) return;
                  if (instant === true) ind.style.transition = "none";
                  ind.style.width = a.offsetWidth + "px"; ind.style.height = a.offsetHeight + "px";
                  ind.style.transform = `translate(${a.offsetLeft}px, ${a.offsetTop}px)`;
                  if (instant === true) { void ind.offsetWidth; ind.style.transition = ""; }
              };
              lgTabs.place = place; lgTabs.ind = ind;
              new MutationObserver(() => place()).observe(box, { attributes: true, subtree: true, attributeFilter: ["class"] });
              if (window.ResizeObserver) { const ro = new ResizeObserver(() => place()); ro.observe(box); box.querySelectorAll(".tab").forEach(t => ro.observe(t)); }
              if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => place(true));
              requestAnimationFrame(() => place(true));
          }
          // Упрощённый режим включили/выключили в настройках или поменялась системная настройка движения
          const onMotion = () => { applyGlass(); if (lgTabs.place) lgTabs.place(true); };
          window.addEventListener("owl-motion", onMotion);
          const mq = matchMedia("(prefers-reduced-motion: reduce)");
          if (mq.addEventListener) mq.addEventListener("change", onMotion); else if (mq.addListener) mq.addListener(onMotion);
      })();

      // ===== «СОВА НА СТРАЖЕ»: таймер безопасности (сервер — guard* в push-server/worker.js) =====
      // Пишете, куда идёте, ставите срок и 1–3 близких. Не нажали «Я в порядке» к сроку — сервер напишет близким в личку
      // и пришлёт им громкий push (в обход «Сова не будит»). Таймер живёт на сервере — сработает, даже если телефон сел.
      // Геолокации нет. Напоминания за 10, 5 и 1 минуту присылает сервер; пока Owl открыт — ещё и само приложение
      const GUARD_REMIND = [10, 5, 1];
      // белая галочка в кружке для зелёной кнопки (эмодзи ✅ на зелёном фоне сливался)
      const GUARD_OK_ICO = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9.5" fill="rgba(255,255,255,.2)"/><path d="m7.8 12.3 2.8 2.8 5.6-5.8"/></svg>';
      const GUARD_MIN = 15, GUARD_MAX = 12 * 60, GUARD_FRIENDS = 3;
      let guard = null;                 // { due, text, friends, fired } — как ответил сервер
      let guardMin = 30, guardCustom = false, guardBusy = false, guardPick = null, guardFor = "", guardSyncAt = 0;
      let guardReminded = new Set(), guardLateCheck = 0;
      const guardDm = (uid) => currentUser.uid < uid ? currentUser.uid + "_" + uid : uid + "_" + currentUser.uid;
      const guardHm = (ms) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      function guardMsgText(msg) {
          const g = msg.guard || {}, name = String(g.name || msg.sender || ""), text = String(g.text || "");
          if (g.kind === "ok") return t("✅ {name} отметился(ась): всё в порядке", { name });
          const due = Number(g.due);
          return t("⚠️ {name} не отметился(ась): „{text}“, срок был {time}", { name, text, time: Number.isFinite(due) ? guardHm(due) : "" }) + "\n" +
              t("Это автоматическое сообщение «Совы на страже»: срок вышел, а отметки «Я в порядке» нет. Попробуйте связаться.");
      }
      function guardSet(g) {
          guard = g && Number.isFinite(g.due) && typeof g.text === "string" && Array.isArray(g.friends) ? g : null;
          try { if (guard) localStorage.setItem("owl-guard", JSON.stringify({ uid: currentUser.uid, g: guard })); else localStorage.removeItem("owl-guard"); } catch (_) {}
          renderGuard();
      }
      async function guardCall(path, data = {}) {
          const r = await pushPost(path, data);
          const j = await r.json().catch(() => ({}));
          if (!r.ok) throw Object.assign(new Error(j.error || String(r.status)), { info: j });
          return j;
      }
      async function guardSync() {
          if (!currentUser) return;
          guardSyncAt = Date.now();
          try { const j = await guardCall("/guard/status"); guardSet(j.guard); } catch (e) { console.log("Сова на страже:", e.message); }
      }
      // При входе: показываем таймер из памяти устройства и сверяемся с сервером (таймер могли поставить с другого устройства)
      function guardInit() {
          if (!currentUser || guardFor === currentUser.uid) return;
          guardFor = currentUser.uid; guardPick = null;
          let saved = null; try { const x = JSON.parse(localStorage.getItem("owl-guard") || "null"); if (x && x.uid === currentUser.uid) saved = x.g; } catch (_) {}
          guard = null; guardSet(saved); guardSync();
          if (window.__pendingGuard) { window.__pendingGuard = false; openGuard(); }
      }
      // Выбрать можно тех, с кем есть переписка, — сервер проверяет то же самое
      // Предупредить можно только того, кто подписан на вас (так требует сервер: незнакомца тревогой не разбудить)
      function guardContacts() {
          const ts = (u) => getTime(chatsMetaCache[guardDm(u.uid)]?.timestamp);
          return Object.values(usersCache).filter(u => u && u.uid && u.name && u.uid !== currentUser.uid && myFollowsIn && myFollowsIn.has(u.uid) && !bansCache[u.uid] && !iBlocked(u.uid))
              .sort((a, b) => ts(b) - ts(a));
      }
      function guardMinutes() {
          if (!guardCustom) return guardMin;
          const v = document.getElementById("guard-time").value;
          if (!/^\d\d:\d\d$/.test(v)) return null;
          const [h, m] = v.split(":").map(Number), now = new Date(), at = new Date(now);
          at.setHours(h, m, 0, 0);
          if (at <= now) at.setDate(at.getDate() + 1); // время уже прошло — значит, завтра
          return Math.ceil((at - now) / 60000);
      }
      function guardFormState() {
          const min = guardMinutes(), text = document.getElementById("guard-text").value.trim();
          const okMin = min !== null && min >= GUARD_MIN && min <= GUARD_MAX;
          document.getElementById("guard-hint").textContent = min === null ? "" : okMin ? t("Отметиться нужно до {time}", { time: guardHm(Math.ceil((Date.now() + min * 60000) / 60000) * 60000) }) : t("Срок — от 15 минут до 12 часов");
          document.getElementById("guard-start").disabled = guardBusy || !text || !guardPick.size || !okMin;
      }
      function renderGuardForm() {
          const people = guardContacts();
          if (!guardPick) { let saved = []; try { saved = JSON.parse(localStorage.getItem("owl-guard-friends") || "[]"); } catch (_) {} guardPick = new Set(Array.isArray(saved) ? saved : []); }
          for (const id of [...guardPick]) if (!people.some(u => u.uid === id)) guardPick.delete(id);
          const full = guardPick.size >= GUARD_FRIENDS;
          document.getElementById("guard-friends").innerHTML = people.length ? people.map(u => {
              const on = guardPick.has(u.uid), dis = full && !on;
              return `<label class="guard-friend${dis ? " dis" : ""}"><img src="${getAvatar(u.uid, u.name)}" alt=""><span>${escapeHTML(u.name)}</span><input type="checkbox" data-gf="${escapeHTML(u.uid)}"${on ? " checked" : ""}${dis ? " disabled" : ""}></label>`;
          }).join("") : `<div class="guard-empty">${t("Здесь появятся люди, которые подписаны на вас. Попросите близкого человека подписаться на ваш профиль.")}</div>`;
          document.querySelectorAll("#guard-chips [data-min]").forEach(b => b.classList.toggle("on", !guardCustom && +b.dataset.min === guardMin));
          document.getElementById("guard-custom").classList.toggle("on", guardCustom);
          document.getElementById("guard-time").hidden = !guardCustom;
          guardFormState();
      }
      const guardLeft = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = s % 60, p = (n) => String(n).padStart(2, "0"); return (h ? h + ":" + p(m) : p(m)) + ":" + p(x); };
      function renderGuard() {
          const on = !!guard, scr = document.getElementById("guard-screen");
          document.getElementById("guard-btn").classList.toggle("on", on);
          const art = document.getElementById("guard-art"); art.classList.toggle("on", on && !guard.fired); art.classList.toggle("fired", on && !!guard.fired);
          document.getElementById("guard-bar").classList.toggle("on", on);
          document.getElementById("guard-form").hidden = on;
          document.getElementById("guard-active").hidden = !on;
          if (!on) { if (scr.style.display !== "none" && currentUser) renderGuardForm(); return; }
          const names = guard.friends.map(id => usersCache[id]?.name || "…").join(", ");
          document.getElementById("guard-what").textContent = "„" + guard.text + "“";
          document.getElementById("guard-who").textContent = t("Срок — {time}. Предупредим: {names}", { time: guardHm(guard.due), names });
          const fired = document.getElementById("guard-fired");
          fired.hidden = !guard.fired;
          if (guard.fired) fired.textContent = t("Срок вышел — Сова предупредила близких. Если вы в порядке, нажмите кнопку: они получат сообщение, что всё хорошо.");
          document.getElementById("guard-ok").innerHTML = GUARD_OK_ICO + escapeHTML(guard.fired ? t("Я в порядке — сообщить близким") : t("Я в порядке"));
          document.getElementById("guard-ok").disabled = guardBusy;
          document.getElementById("guard-ext").hidden = !!guard.fired;
          document.querySelectorAll("#guard-ext button").forEach(b => { b.disabled = guardBusy; });
          guardTickUi();
      }
      // Раз в секунду: обратный отсчёт, плашка над чатами и напоминания, пока Owl открыт
      function guardTickUi() {
          if (!guard) return;
          const left = guard.due - Date.now(), late = !!guard.fired || left <= 10 * 60000;
          const clock = document.getElementById("guard-clock");
          clock.textContent = guard.fired ? "00:00" : guardLeft(left); clock.classList.toggle("late", late);
          document.getElementById("guard-bar").classList.toggle("late", late);
          document.getElementById("guard-bar-text").innerHTML = guard.fired ? `<b>${t("Близкие предупреждены")}</b>` : `${t("Сова на страже")} · <b>${guardLeft(left)}</b>`;
          if (guard.fired) return;
          for (const m of GUARD_REMIND) {
              if (left > m * 60000 || left <= (m - 1) * 60000 || guardReminded.has(guard.due + ":" + m)) continue;
              guardReminded.add(guard.due + ":" + m);
              showToast(t("До срока {n} мин. Вы в порядке? Нажмите «Я в порядке»", { n: m }), "shield", { onClick: openGuard });
              playNotifySound(); try { navigator.vibrate && navigator.vibrate([300, 150, 300]); } catch (_) {}
          }
          // Срок прошёл — через минуту-другую сервер пошлёт тревогу; узнаём об этом
          if (left < -75000 && Date.now() - guardLateCheck > 60000) { guardLateCheck = Date.now(); guardSync(); }
      }
      setInterval(() => { if (guard && document.visibilityState === "visible") guardTickUi(); }, 1000);
      document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && guard && currentUser && Date.now() - guardSyncAt > 30000) guardSync(); });
      function guardErr(e) {
          const i = e.info || {}, who = i.uid && usersCache[i.uid]?.name;
          if (i.error === "not contact") return t("С {name} нет переписки — Сова не сможет предупредить. Сначала напишите в личку", { name: who || "…" });
          if (i.error === "blocked" && i.reason === "not follower") return t("{name} не подписан(а) на вас — Сова не сможет предупредить", { name: who || "…" });
          if (i.error === "blocked" && i.reason === "recent alarm") return t("{name} уже получал(а) от вас тревогу за последние 12 часов", { name: who || "…" });
          if (i.error === "blocked") return t("{name} не сможет получить предупреждение — выберите другого человека", { name: who || "…" });
          if (i.error === "fired") return t("Тревога уже ушла близким — сначала нажмите «Я в порядке»");
          if (i.error === "banned") return t("Аккаунт заблокирован");
          if (i.error === "too many") return t("Слишком часто. Попробуйте чуть позже");
          if (i.error === "email not verified") return t("Сначала подтвердите почту");
          return t("Нет связи с сервером — таймер не поставлен. Попробуйте ещё раз");
      }
      async function guardStart() {
          const min = guardMinutes(), text = document.getElementById("guard-text").value.trim();
          if (guardBusy || !text || !guardPick.size || !(min >= GUARD_MIN && min <= GUARD_MAX)) return;
          guardBusy = true; guardFormState();
          try {
              const j = await guardCall("/guard/start", { text, minutes: min, friends: [...guardPick], tz: tzOffset() });
              try { localStorage.setItem("owl-guard-friends", JSON.stringify([...guardPick])); } catch (_) {}
              guardBusy = false; guardSet(j.guard);
              document.getElementById("guard-text").value = "";
              showToast(t("Сова на страже до {time}", { time: guardHm(j.guard.due) }), "shield");
              if (!pushEnabled()) setTimeout(() => showToast(t("Уведомления выключены — напоминания придут, только пока Owl открыт. Включите их в настройках"), "bell"), 1200);
          } catch (e) { showToast(guardErr(e), "error"); }
          guardBusy = false; renderGuard();
      }
      async function guardOk() {
          if (!guard || guardBusy) return;
          const wasFired = !!guard.fired;
          guardBusy = true; renderGuard();
          try { await guardCall("/guard/cancel"); guardBusy = false; guardSet(null); showToast(wasFired ? t("Близким отправлено, что вы в порядке") : t("Отлично! Сова снята с поста"), "check"); }
          catch (e) { showToast(t("Не получилось связаться с сервером — таймер всё ещё идёт. Попробуйте ещё раз"), "error"); }
          guardBusy = false; renderGuard();
      }
      async function guardExtend(min) {
          if (!guard || guardBusy) return;
          guardBusy = true; renderGuard();
          try { const j = await guardCall("/guard/extend", { minutes: min }); guardBusy = false; guardSet(j.guard); showToast(t("Срок продлён до {time}", { time: guardHm(j.guard.due) }), "clock"); }
          catch (e) { showToast(e.info && e.info.error === "no timer" ? t("Таймер уже не идёт") : t("Не получилось продлить — попробуйте ещё раз"), "error"); if (e.info && e.info.error === "no timer") guardSync(); }
          guardBusy = false; renderGuard();
      }
      function openGuard() {
          if (!currentUser) return;
          const scr = document.getElementById("guard-screen");
          scr.style.display = "flex"; renderGuard();
          if (!guard) setTimeout(() => { if (scr.style.display !== "none" && !matchMedia("(prefers-reduced-motion: reduce)").matches) document.getElementById("guard-text").focus({ preventScroll: true }); }, 50); // фокус — не анимация: упрощённый режим его не отключает
          if (Date.now() - guardSyncAt > 15000) guardSync();
      }
      document.getElementById("guard-btn").addEventListener("click", (e) => { e.stopPropagation(); openGuard(); });
      document.getElementById("guard-close").addEventListener("click", () => { document.getElementById("guard-screen").style.display = "none"; });
      document.getElementById("guard-screen").addEventListener("click", (e) => { if (e.target.id === "guard-screen") e.target.style.display = "none"; });
      document.getElementById("guard-bar").addEventListener("click", (e) => { if (!e.target.closest("#guard-bar-ok")) openGuard(); });
      document.getElementById("guard-bar").addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.id === "guard-bar") openGuard(); });
      document.getElementById("guard-bar-ok").addEventListener("click", guardOk);
      document.getElementById("guard-ok").addEventListener("click", guardOk);
      document.getElementById("guard-start").addEventListener("click", guardStart);
      document.getElementById("guard-text").addEventListener("input", guardFormState);
      document.getElementById("guard-text").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); guardStart(); } });
      document.getElementById("guard-time").addEventListener("input", guardFormState);
      document.getElementById("guard-chips").addEventListener("click", (e) => {
          const b = e.target.closest(".guard-chip"); if (!b) return;
          if (b.id === "guard-custom") {
              guardCustom = true;
              const tm = document.getElementById("guard-time");
              if (!tm.value) { const d = new Date(Date.now() + 60 * 60000); tm.value = String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"); }
          } else { guardCustom = false; guardMin = +b.dataset.min; }
          renderGuardForm();
      });
      document.getElementById("guard-friends").addEventListener("change", (e) => {
          const id = e.target.dataset && e.target.dataset.gf; if (!id) return;
          if (e.target.checked && guardPick.size < GUARD_FRIENDS) guardPick.add(id); else guardPick.delete(id);
          renderGuardForm();
      });
      document.getElementById("guard-ext").addEventListener("click", (e) => { const b = e.target.closest("[data-ext]"); if (b) guardExtend(+b.dataset.ext); });
      if (navigator.serviceWorker) navigator.serviceWorker.addEventListener("message", (e) => { if (e.data && e.data.type === "open-guard") openGuard(); });
      try { if (new URLSearchParams(location.search).get("guard")) window.__pendingGuard = true; } catch (_) {}

      // ===== ГОЛОСОВЫЕ ЗВОНКИ (v1.106, надёжность — v1.110) =====
      // WebRTC, только звук и только в личке. «Рукопожатие» идёт через запись calls/{id}: звонящий кладёт описание
      // соединения (offer), собеседник отвечает (answer). Адреса соединения собираем целиком до записи (без trickle ICE) —
      // так звонок стоит базе ~10 чтений. Серверы связи (TURN Cloudflare) выдаёт owl-push: голос идёт через них
      // зашифрованным (DTLS-SRTP), а собеседник не видит наш IP. Не соединилось через сервер — один раз пробуем напрямую.
      // После звонка звонящий пишет в переписку отметку («Звонок · 3:12» / «Пропущенный звонок») и удаляет запись звонка.
      const CALL_RING_MS = 45000, CALL_STALE_MS = 3 * 60000, CALL_GATHER_MS = 3500, CALL_CONNECT_MS = 15000, CALL_DROP_MS = 25000;
      const STUN_ONLY = { iceServers: [{ urls: "stun:stun.cloudflare.com:3478" }], relay: false, at: 0 };
      let call = null;          // текущий звонок (один на устройство)
      let callsListener = null; // входящие: calls где to == я и status == ringing
      let callIce = null;       // серверы связи: пароли TURN живут 4 часа, берём заново раз в час
      let callIceReq = null;    // запрос серверов, который уже идёт (общий для «заранее» и «Принять»)
      const callsSupported = () => !!(window.RTCPeerConnection && navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
      const callDur = (s) => Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
      const canCallTo = (uid) => allowedBy(usersCache[uid], "canCall");

      // Серверы связи — не дольше 4 с: если сервер медленный (в России бывает), звоним без него, а не висим минуту.
      // Запоминаем только полноценный ответ с TURN: случайный «только STUN» не должен на час открыть собеседнику наш IP
      function callIceServers() {
          if (callIce && Date.now() - callIce.at < 3600000) return Promise.resolve(callIce);
          if (callIceReq) return callIceReq;
          const req = pushPost("/call/ice", {}).then(r => r.json()).then(j => {
              // ответ с сервером связи запоминаем, даже если он опоздал к этому звонку — пригодится следующему
              if (j && Array.isArray(j.iceServers) && j.iceServers.length && j.relay) callIce = { iceServers: j.iceServers, relay: true, at: Date.now() };
              return j;
          }).catch(e => { console.log("Звонок, серверы связи:", e.message); return null; });
          const late = new Promise(res => setTimeout(() => res(null), 4000));
          return (callIceReq = Promise.race([req, late]).then(j => {
              callIceReq = null;
              if (!j || !Array.isArray(j.iceServers) || !j.iceServers.length) return callIce && Date.now() - callIce.at < 3600000 ? callIce : STUN_ONLY; // опоздавший ответ мог уже лечь в callIce
              return callIce && j.relay ? callIce : { iceServers: j.iceServers, relay: !!j.relay, at: Date.now() };
          }));
      }
      // Микрофон: сначала с шумо- и эхоподавлением; если устройство не дало (не отказ человека) — ещё раз попроще.
      // Звук мелодии перед этим выключаем полностью: на iPhone занятое аудио мешает включить микрофон
      async function getMic() {
          releaseTone();
          setAudioSession("play-and-record"); // в режиме ambient (для звуков уведомлений) iOS не даёт микрофон — InvalidStateError
          try { return await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false }); }
          catch (e) {
              if (e.name === "NotAllowedError" || e.name === "SecurityError") throw e;
              console.log("Микрофон, повтор без настроек:", e.name, e.message);
              return navigator.mediaDevices.getUserMedia({ audio: true });
          }
      }
      // «Микрофон выкл.» могли нажать ещё до того, как микрофон открылся — применяем к пришедшему потоку
      const callApplyMute = (c) => { if (c.stream) c.stream.getAudioTracks().forEach(tr => { tr.enabled = !c.muted; }); };
      // Ошибка звонка для всплывашки: на каком шаге и что именно (чтобы по скриншоту было понятно, где сломалось)
      const errName = (e) => String(e && (e.name !== "Error" && e.name || e.code || e.message) || "?").slice(0, 40);
      const callErr = (c, e) => " (" + (c.step || "?") + ": " + errName(e) + ")";
      // Тихий отчёт о сбое — только в журнал сервера: шаг, тип ошибки, версия, платформа. Без имён, текстов и адресов
      const callOs = () => { const u = navigator.userAgent; return /iPhone|iPad/.test(u) || (/Macintosh/.test(u) && navigator.maxTouchPoints > 1) ? "ios" : /Android/.test(u) ? "android" : /Mac/.test(u) ? "mac" : /Win/.test(u) ? "windows" : "other"; };
      function callReport(c, step, e) {
          if (!currentUser) return;
          pushPost("/call/log", { step: step || c.step || "?", err: errName(e), role: c.role, ver: "v" + OWL_SHELL + (isStandalone() ? " pwa" : ""), os: callOs(), relay: !!c.relay }).catch(() => {});
      }

      // Ждём, пока соберутся адреса: всё собрано, или есть нужный адрес и прошло ещё немного, или 3,5 с в любом случае.
      // Через сервер связи ждём 1,5 с после первого relay-адреса (медленные TCP/443 нужны там, где режут UDP);
      // напрямую — 0,7 с после первого «внешнего» (srflx): без него собеседник из другой сети нас не найдёт
      function callGather(pc, relay) {
          return new Promise((res) => {
              let soon = null;
              const done = () => { clearTimeout(tm); clearTimeout(soon); pc.removeEventListener("icegatheringstatechange", chk); pc.removeEventListener("icecandidate", cand); res(); };
              const chk = () => { if (pc.iceGatheringState === "complete") done(); };
              const cand = (e) => { if (e.candidate && !soon && (relay ? / typ relay/ : / typ srflx/).test(e.candidate.candidate)) soon = setTimeout(done, relay ? 1500 : 700); };
              const tm = setTimeout(done, CALL_GATHER_MS);
              pc.addEventListener("icegatheringstatechange", chk); pc.addEventListener("icecandidate", cand);
              chk();
          });
      }
      function callPc(c) {
          const pc = new RTCPeerConnection({ iceServers: c.ice.iceServers, iceTransportPolicy: c.relay ? "relay" : "all" });
          c.stream.getTracks().forEach(tr => pc.addTrack(tr, c.stream));
          // Видео (премиум): канал под камеру/экран закладываем сразу — потом только подменяем дорожку, без нового «рукопожатия».
          // streams: [c.stream] обязательно: у старых версий Owl ontrack кладёт в звук поток пришедшей дорожки — с общим потоком звук не пропадёт
          if (c.role === "caller" && c.wantVideo) { c.vtx = pc.addTransceiver("video", { direction: "sendrecv", streams: [c.stream] }); callCtlChannel(c, pc); }
          pc.ontrack = (e) => {
              if (e.track.kind === "video") { c.rvTrack = e.track; e.track.onmute = e.track.onunmute = e.track.onended = () => callVideoUi(c); callVideoUi(c); return; }
              // При видеоканале звук — отдельным потоком только со звуком: Safari иначе может ждать первый видеокадр и молчать
              const hasVideo = pc.getTransceivers().some(x => x.receiver && x.receiver.track && x.receiver.track.kind === "video");
              c.remote = hasVideo ? new MediaStream([e.track]) : (e.streams[0] || new MediaStream([e.track])); callPlayRemote(c);
          };
          // Одно событие, а не два: иначе на «failed» сбой обрабатывался дважды (и сразу обрывал звонок)
          const st = () => callConnState(c);
          if ("connectionState" in pc) pc.addEventListener("connectionstatechange", st); else pc.addEventListener("iceconnectionstatechange", st);
          return pc;
      }

      // ----- громкая связь -----
      // Safari на iPhone с iOS 26+ после включения микрофона показывает выходы «у уха» (Receiver) и «громкий» (Speaker)
      // и даёт выбрать их только вскоре после касания (setSinkId). Но звук собеседника, который играет прямо из WebRTC,
      // всё равно идёт громко — ошибка WebKit 320087 (исправление ещё не вышло ни в одной iOS). Обход, проверенный 03.11
      // на iPhone с iOS 27.2: «у уха» звук собеседника идёт через Web Audio-«ретранслятор» (MediaStreamDestination
      // в тот же <audio>) — у него выбор выхода работает. Громко — напрямую, как раньше. Звонок начинаем у уха,
      // кнопка «Динамик» — громкая связь. На iOS 17/18, Android и компьютере кнопки нет: звук выбирает система
      let relayCtx = null;   // движок ретранслятора: один на страницу, между звонками «спит»
      let sinkDirty = false; // после звонка «у уха» выход надо вернуть системный (получится по касанию)
      const canPickOutput = () => callOs() === "ios" && !!AudioCtx && "setSinkId" in HTMLMediaElement.prototype;
      // Движок запускаем, только когда выбор выхода реально есть; пока идёт запись с микрофона, iOS разрешает это и без касания
      function callRelayCtx() {
          if (!canPickOutput()) return null;
          try {
              if (!relayCtx || relayCtx.state === "closed") { relayCtx = new AudioCtx(); relayCtx.onstatechange = () => callWakeRelay(); }
              if (relayCtx.state !== "running") relayCtx.resume().catch(() => {});
          } catch (_) { relayCtx = null; }
          return relayCtx;
      }
      // Касание, которое iOS считает «нажатием» (для пальца — когда его отпустили, не когда коснулись)
      const TAP_EVENTS = ["touchend", "click", "keydown"];
      function onNextTap(fn) {
          const go = (e) => { if (fn(e) !== false) TAP_EVENTS.forEach(ev => document.removeEventListener(ev, go, true)); };
          TAP_EVENTS.forEach(ev => document.addEventListener(ev, go, true));
      }
      async function callOutputs(c) {
          if (c.outs) return c.outs;
          c.outNames = "";
          if (!canPickOutput() || !navigator.mediaDevices.enumerateDevices) return null;
          try {
              const all = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === "audiooutput");
              const outs = all.filter(d => d.deviceId && d.deviceId !== "default"), def = all.find(d => d.deviceId === "default");
              const rx = outs.find(d => /receiver|earpiece|handset|трубк|разговорн|hörer|słuchawka/i.test(d.label));
              const sp = outs.find(d => d !== rx && /speaker|динамик|громк|lautsprecher|głośnik/i.test(d.label));
              // Сейчас звук идёт в наушники (AirPods, гарнитура, машина)? Тогда к уху сами не уводим — решает система
              if (rx && sp) c.outs = { rx: rx.deviceId, sp: sp.deviceId, headset: !!(def && def.label && !def.label.includes(rx.label) && !def.label.includes(sp.label)) };
              // Не распознали «у уха» / «громкий»: названия покажем самому человеку (по скриншоту подстроим распознавание),
              // а в журнал сервера — только «сколько выходов и что узнали»: в названиях Bluetooth бывают имена владельцев
              else if (outs.length) { c.outNames = outs.map(d => d.label || "?").join(" | "); if (!c.outsReported) { c.outsReported = true; callReport(c, "outs", { name: outs.length + " rx" + (rx ? 1 : 0) + " sp" + (sp ? 1 : 0) }); } }
          } catch (_) {}
          return c.outs || null;
      }
      // Звук собеседника: «у уха» — через ретранслятор, громко — напрямую (так он надёжнее работает в фоне).
      // Можно вызывать сколько угодно раз: если источник уже верный, он не меняется
      function callPlayRemote(c) {
          if (call !== c || !c.remote) return;
          const a = $c("call-audio");
          const ear = c.speaker === false && relayCtx && relayCtx.state === "running";
          if (ear && c.relayFor !== c.remote) {
              try { if (c.relayIn) c.relayIn.disconnect(); } catch (_) {}
              try { const src = relayCtx.createMediaStreamSource(c.remote), dst = relayCtx.createMediaStreamDestination(); src.connect(dst); c.relayIn = src; c.relayOut = dst.stream; c.relayFor = c.remote; }
              catch (e) { console.log("Ретранслятор:", e.name, e.message); c.relayFor = null; }
          }
          const want = ear && c.relayFor === c.remote ? c.relayOut : c.remote;
          if (a.srcObject !== want) a.srcObject = want;
          a.play().catch(e => callNeedTap(c, e));
      }
      // Safari не дал включить звук (окно разрешения микрофона «съедает» касание) — включаем на следующем касании
      function callNeedTap(c, e) {
          if (call !== c || !e || e.name !== "NotAllowedError" || c.needTap) return;
          c.needTap = true; c.hint = t("Коснитесь экрана, чтобы включить звук");
          $c("call-note").textContent = c.hint; // только надпись: кнопки под пальцем не перерисовываем
          onNextTap(() => {
              if (call !== c) return;
              c.needTap = false; c.hint = null; callRelayCtx(); callPlayRemote(c);
              setTimeout(() => { if (call === c) callUi(); }, 0);
          });
      }
      // on: true — громко, false — у уха. auto — выбор при начале звонка (с наушниками к уху сами не уводим)
      async function callSetSpeaker(c, on, auto) {
          const outs = await callOutputs(c);
          if (!outs || call !== c) return false;
          if (auto && outs.headset) { if (call === c) callUi(); return false; }
          const a = $c("call-audio");
          if (!on) {
              callRelayCtx();
              if (relayCtx && relayCtx.state !== "running") await Promise.race([relayCtx.resume().catch(() => {}), new Promise(r => setTimeout(r, 1000))]);
              if (call !== c) return false;
          }
          const ear = !on && relayCtx && relayCtx.state === "running"; // без ретранслятора «у уха» не получится
          try {
              await a.setSinkId(ear ? outs.rx : outs.sp);
              if (call !== c) return false;
              c.speaker = !ear; sinkDirty = ear;
              callPlayRemote(c);
              callUi();
              return ear || on;
          } catch (e) {
              // Не успели после касания — звонок идёт громко, кнопка «Динамик» это и покажет: нажатие переключит к уху
              console.log("Динамик:", e.name, e.message);
              if (call === c && c.speaker === undefined) { c.speaker = true; callUi(); }
              return e.name === "NotAllowedError";
          }
      }
      // Ретранслятор «уснул» (iOS приостанавливает звук в фоне, при Siri, будильнике) или проснулся.
      // Проснулся — звук снова у уха. Не проснулся на виду за 1,5 с — честно громко, но звук не пропадает
      function callWakeRelay() {
          const c = call;
          if (!c || c.speaker !== false || !relayCtx) return;
          if (relayCtx.state === "running") return callPlayRemote(c);
          relayCtx.resume().catch(() => {});
          setTimeout(() => {
              if (call !== c || c.speaker !== false || !relayCtx) return;
              if (relayCtx.state === "running") return callPlayRemote(c);
              if (document.visibilityState !== "visible") return; // в фоне ждём возвращения — там решим
              c.speaker = true; callPlayRemote(c); callUi();
              if (c.outs) $c("call-audio").setSinkId(c.outs.sp).catch(() => {});
          }, 1500);
      }
      document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") callWakeRelay(); });
      // После звонка «у уха» возвращаем выход системный — на ближайшем касании (без касания iOS не даёт)
      TAP_EVENTS.forEach(ev => document.addEventListener(ev, () => { if (sinkDirty && !call) $c("call-audio").setSinkId("").then(() => { sinkDirty = false; }).catch(() => {}); }, true));

      // ----- видео (премиум): камера и показ экрана в звонке -----
      // Только если премиум хотя бы у одного из двоих: тогда в звонок сразу закладывается видеоканал, а камера/экран подставляются
      // в него (replaceTrack) — без повторного «рукопожатия» и паузы в разговоре. У остальных звонок прежний: только голос.
      // Канал «ctl» (данные внутри самого соединения, мимо базы) — чтобы собеседник сразу узнал «камера выкл.» / «показываю экран».
      // Видео идёт тем же защищённым путём, что и голос (DTLS-SRTP, через сервер связи)
      const CAM_KBPS = 500, SCREEN_KBPS = 1000; // потолок скорости: дешевле для сервера связи и мобильного интернета
      const callVideoOk = (peer) => !!currentUser && (isPremium(currentUser.uid) || isPremium(peer));
      const VIDEO_MIN_OWLV = 82; // с этой версии (v1.115, OWL_SHELL 82) Owl умеет видео в звонке
      const peerHasVideo = (peer) => (usersCache[peer]?.owlv || 0) >= VIDEO_MIN_OWLV;
      const isMobileCam = () => /iPhone|iPad|Android/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
      // Показ экрана — только на компьютере (телефонные браузеры его пока не умеют)
      const canShareScreen = () => !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia) && !isMobileCam();
      function callCtlChannel(c, pc) {
          try { c.dc = pc.createDataChannel("ctl", { negotiated: true, id: 0 }); } catch (_) { return; }
          c.dc.onopen = () => { if (c.vtrack) callCtl(c, { cam: c.vsrc === "cam", screen: c.vsrc === "screen" }); };
          c.dc.onmessage = (e) => {
              let m; try { m = JSON.parse(String(e.data).slice(0, 200)); } catch (_) { return; }
              if (!m || typeof m !== "object") return;
              c.peerCam = !!(m.cam || m.screen); c.peerScreen = !!m.screen; callVideoUi(c);
          };
      }
      function callCtl(c, m) { if (c.dc && c.dc.readyState === "open") try { c.dc.send(JSON.stringify(m)); } catch (_) {} }
      // Принимающий: видеоканал есть в предложении звонящего — берём его, если видео можно (премиум у кого-то из двоих); иначе отключаем
      function callTakeVideo(c, pc) {
          const vt = pc.getTransceivers().find(x => x.receiver && x.receiver.track && x.receiver.track.kind === "video");
          if (!vt) return;
          if (!callVideoOk(c.peer)) { try { vt.direction = "inactive"; } catch (_) {} return; }
          vt.direction = "sendrecv";
          c.vtx = vt;
          if (/\nm=application /.test(c.offer)) callCtlChannel(c, pc);
          callUi();
      }
      // Видео собеседника: на весь экран звонка, когда оно реально идёт; показ экрана — целиком (contain), камера — с обрезкой (cover)
      function callVideoUi(c) {
          if (call !== c) return;
          const v = $c("call-video"), tr = c.rvTrack;
          // есть канал ctl — верим только явному «камера вкл.»; без него (не должно быть) — по самой дорожке
          const peerOn = c.dc ? c.peerCam === true : c.peerCam !== false;
          c.peerVideo = !!(tr && tr.readyState === "live" && !tr.muted && peerOn && callVideoOk(c.peer));
          // видео того, на кого не подписан, сначала скрыто — покажется по кнопке «Показать видео»
          if (c.peerVideo && c.hideVideo === undefined) c.hideVideo = !callTrusts(c);
          const on = c.peerVideo && !c.hideVideo;
          if (on) { if (!v.srcObject || v.srcObject.getVideoTracks()[0] !== tr) v.srcObject = new MediaStream([tr]); v.play().catch(() => {}); }
          else if (v.srcObject) v.srcObject = null;
          v.classList.toggle("screen", !!c.peerScreen);
          const scr = $c("call-screen"), was = scr.classList.contains("vid");
          scr.classList.toggle("vid", on);
          if (was !== on || c.vidBtn !== c.peerVideo) { c.vidBtn = c.peerVideo; callUi(); }
      }
      function callBitrate(c, kbps) {
          try {
              const p = c.vtx.sender.getParameters();
              if (!p.encodings || !p.encodings.length) p.encodings = [{}];
              p.encodings[0].maxBitrate = kbps * 1000;
              c.vtx.sender.setParameters(p).catch(() => {});
          } catch (_) {}
      }
      // Своё видео — маленьким окошком в углу; фронтальная камера — зеркально, как в зеркале
      function callShowSelf(c) {
          const s = $c("call-self");
          if (!c.vtrack) { s.srcObject = null; $c("call-screen").classList.remove("self"); return; }
          s.srcObject = new MediaStream([c.vtrack]); s.play().catch(() => {});
          s.classList.toggle("mirror", c.vsrc === "cam" && (c.facing || "user") === "user");
          $c("call-screen").classList.add("self");
      }
      function callStopLocalVideo(c) {
          if (c.vtrack) { c.vtrack.onended = null; try { c.vtrack.stop(); } catch (_) {} }
          c.vtrack = null; c.vsrc = null;
          const s = $c("call-self"); if (s) s.srcObject = null;
          $c("call-screen").classList.remove("self");
      }
      // Видео выключить: своё окошко и дорожку — сразу, собеседнику — «камера выкл.»
      async function callVideoOff(c) {
          callStopLocalVideo(c);
          if (c.vtx) await c.vtx.sender.replaceTrack(null).catch(() => {});
          callCtl(c, { cam: false, screen: false }); callUi();
      }
      // Камера: каждое нажатие получает свой номер (c.vreq) — ответ на старое нажатие (окно разрешения, медленный запуск) уже не применяется.
      // flip — повернуть: сначала отпускаем текущую камеру (многие Android не открывают две сразу), не вышло — возвращаем прежнюю
      async function callCamera(c, on, flip) {
          if (!c.vtx || call !== c) return;
          const my = c.vreq = (c.vreq || 0) + 1;
          c.camLost = false;
          if (!on) { c.vpending = null; return callVideoOff(c); }
          const prevFacing = c.facing || "user";
          if (flip) { c.facing = prevFacing === "environment" ? "user" : "environment"; c.flipping = true; callStopLocalVideo(c); }
          c.vpending = "cam"; callUi();
          try {
              const st = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: c.facing || "user", width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 24, max: 30 } } });
              const tr = st.getVideoTracks()[0];
              if (call !== c || my !== c.vreq || !c.vtx || !tr) return st.getTracks().forEach(x => x.stop());
              c.vpending = null; c.flipping = false;
              callStopLocalVideo(c); c.vtrack = tr; c.vsrc = "cam";
              // камера погасла сама: в фоне на iPhone — включим снова по возвращении; иначе (отключили камеру) — просто выкл.
              tr.onended = () => { if (call === c && c.vtrack === tr) { const bg = document.visibilityState === "hidden"; callVideoOff(c); c.camLost = bg; } };
              await c.vtx.sender.replaceTrack(tr);
              if (call !== c || my !== c.vreq) return; // пока подставляли — выключили камеру или видео убрали
              callBitrate(c, CAM_KBPS);
              callShowSelf(c); callCtl(c, { cam: true, screen: false }); callUi();
              // видеозвонок держат перед собой: «у уха» тихо — переключаем на громкую связь (iPhone даёт выбрать выход только вскоре после касания)
              if (c.outs && c.speaker === false) callSetSpeaker(c, true);
          } catch (e) {
              if (my !== c.vreq) return;
              c.vpending = null; c.flipping = false;
              if (c.vtrack) callStopLocalVideo(c); // дорожка открылась, но не подставилась — гасим камеру
              console.log("Камера:", e.name, e.message);
              if (call !== c) return;
              if (flip) { c.facing = prevFacing; callCamera(c, true); return; } // другая камера не открылась — возвращаем прежнюю
              callUi();
              showToast(e.name === "NotAllowedError" ? t("Нет доступа к камере — разрешите её в настройках браузера") : t("Не удалось включить камеру") + " (" + errName(e) + ")", "error");
          }
      }
      async function callScreen(c, on) {
          if (!c.vtx || call !== c) return;
          const my = c.vreq = (c.vreq || 0) + 1;
          c.camLost = false;
          if (!on) { c.vpending = null; if (c.vsrc === "screen") return callVideoOff(c); return callUi(); }
          c.vpending = "screen"; callUi();
          try {
              const st = await navigator.mediaDevices.getDisplayMedia({ audio: false, video: { frameRate: { ideal: 12, max: 15 } } });
              const tr = st.getVideoTracks()[0];
              if (call !== c || my !== c.vreq || !c.vtx || !tr) return st.getTracks().forEach(x => x.stop());
              c.vpending = null;
              try { tr.contentHint = "detail"; } catch (_) {} // текст на экране — чётко, а не плавно
              callStopLocalVideo(c); c.vtrack = tr; c.vsrc = "screen";
              tr.onended = () => { if (call === c && c.vtrack === tr) callVideoOff(c); }; // «Остановить показ» в самом браузере
              await c.vtx.sender.replaceTrack(tr);
              if (call !== c || my !== c.vreq) return;
              callBitrate(c, SCREEN_KBPS);
              callShowSelf(c); callCtl(c, { cam: false, screen: true }); callUi();
          } catch (e) {
              if (my !== c.vreq) return;
              c.vpending = null;
              if (c.vtrack) callStopLocalVideo(c);
              console.log("Показ экрана:", e.name, e.message);
              if (call !== c) return;
              callUi();
              if (e.name !== "NotAllowedError" && e.name !== "AbortError") showToast(t("Не удалось показать экран") + " (" + errName(e) + ")", "error");
          }
      }
      // iPhone гасит камеру, когда Owl уходит в фон, — вернулись в звонок: включаем снова (только если гасла именно в фоне)
      document.addEventListener("visibilitychange", () => { const c = call; if (document.visibilityState === "visible" && c && c.vtx && c.camLost && !c.vtrack) { c.camLost = false; callCamera(c, true); } });

      // ----- звуки: гудки у звонящего и мелодия входящего (синтез, без файлов) -----
      // Рингтон Owl «Бульк» — своя мелодия (в духе игровых мессенджеров, но не копия чужого звука), её синтезирует само
      // приложение — никаких чужих записей и прав. Голос «блип»: нота начинается чуть ниже и за ~25 мс подтягивается вверх
      // («пузырёк»), короткая и округлая; на сильные доли — мягкий низкий «тук», сверху лёгкое эхо.
      // Образец для прослушивания: «Канал и группа/Рингтон/Рингтон Т — Бульк.wav». [шаг 1/16 такта, нота] при 132 BPM
      const RING_STEP = 60 / 132 / 4, RING_CYCLE = 16 * RING_STEP + .9;
      const RING_SCORE = [[0, "F5"], [2, "A5"], [3, "C6"], [6, "A5"], [8, "G5"], [10, "C6"], [11, "D6"], [12, "C6"]];
      const BACK_SCORE = [[0, "C6"], [1.4, "A5"]]; // гудки у звонящего: два тихих «буль»
      const NOTE_HZ = { F5: 698.46, G5: 783.99, A5: 880, C6: 1046.5, D6: 1174.66 };
      let blipWave = null;
      function blipNote(ctx, out, at, f, vol) {
          // округлый тон: основной + 2-я и 3-я гармоники
          if (!blipWave) blipWave = ctx.createPeriodicWave(new Float32Array([0, 0, 0, 0]), new Float32Array([0, 1, .25, .08]));
          const o = ctx.createOscillator(), g = ctx.createGain();
          o.setPeriodicWave(blipWave);
          o.frequency.setValueAtTime(f * .84, at); o.frequency.setTargetAtTime(f, at, .012);
          g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(vol, at + .003); g.gain.setTargetAtTime(0, at + .003, .14);
          o.connect(g).connect(out); o.start(at); o.stop(at + .7);
      }
      function thumpNote(ctx, out, at, vol) {
          const o = ctx.createOscillator(), g = ctx.createGain();
          o.frequency.setValueAtTime(120, at); o.frequency.setTargetAtTime(60, at, .02);
          g.gain.setValueAtTime(vol, at); g.gain.setTargetAtTime(0, at, .08);
          o.connect(g).connect(out); o.start(at); o.stop(at + .25);
      }
      let toneCtx = null, toneTimer = null, toneOut = null;
      function playTone(kind) {
          stopTone();
          try {
              // Тот же звуковой движок, что у сигналов сообщений: iOS «разблокирует» его на первом касании экрана,
              // поэтому входящий зазвонит, даже если человек давно не трогал телефон (отдельный движок молчал бы)
              const ctx = toneCtx = getNotifyCtx(); if (!ctx) return;
              ctx.resume().catch(() => {});
              const ring = kind === "ring";
              // общий выход: сухой звук + эхо (задержка 0,17 с с затухающими повторами)
              const out = toneOut = ctx.createGain(); out.gain.value = ring ? .45 : .16;
              const delay = ctx.createDelay(1), fb = ctx.createGain(), wet = ctx.createGain();
              delay.delayTime.value = .17; fb.gain.value = .25; wet.gain.value = .07;
              out.connect(ctx.destination); out.connect(delay); delay.connect(fb); fb.connect(delay); delay.connect(wet); wet.connect(ctx.destination);
              out._fx = [delay, fb, wet];
              const play = () => {
                  if (toneOut !== out) return;
                  const t0 = ctx.currentTime + .05;
                  if (ring) {
                      RING_SCORE.forEach(([st, n]) => blipNote(ctx, out, t0 + st * RING_STEP, NOTE_HZ[n], .45));
                      thumpNote(ctx, out, t0, .35); thumpNote(ctx, out, t0 + 8 * RING_STEP, .25);
                      if (navigator.vibrate) navigator.vibrate([300, 150, 300]);
                  } else BACK_SCORE.forEach(([st, n]) => blipNote(ctx, out, t0 + st * RING_STEP, NOTE_HZ[n], .45));
              };
              play(); toneTimer = setInterval(play, (ring ? RING_CYCLE : 3) * 1000);
          } catch (_) {}
      }
      function stopTone() {
          clearInterval(toneTimer); toneTimer = null;
          if (toneOut) { try { toneOut.disconnect(); (toneOut._fx || []).forEach(n => n.disconnect()); } catch (_) {} toneOut = null; } // уже запланированные ноты и эхо замолкают
          if (navigator.vibrate) try { navigator.vibrate(0); } catch (_) {}
      }
      function releaseTone() { stopTone(); } // движок общий со звуком сообщений — не закрываем

      // ----- экран звонка -----
      const CALL_SVG = {
          accept: '<svg viewBox="0 0 24 24" width="30" height="30" fill="currentColor"><path d="M20 15.5c-1.2 0-2.4-.2-3.6-.6a1 1 0 0 0-1 .25l-2.2 2.2a15 15 0 0 1-6.6-6.6l2.2-2.2a1 1 0 0 0 .25-1A11.4 11.4 0 0 1 8.5 4a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1 17 17 0 0 0 17 17 1 1 0 0 0 1-1v-3.5a1 1 0 0 0-1-1z"/></svg>',
          hang: '<svg viewBox="0 0 24 24" width="30" height="30" fill="currentColor" style="transform:rotate(135deg)"><path d="M20 15.5c-1.2 0-2.4-.2-3.6-.6a1 1 0 0 0-1 .25l-2.2 2.2a15 15 0 0 1-6.6-6.6l2.2-2.2a1 1 0 0 0 .25-1A11.4 11.4 0 0 1 8.5 4a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1 17 17 0 0 0 17 17 1 1 0 0 0 1-1v-3.5a1 1 0 0 0-1-1z"/></svg>',
          mic: '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v3"/></svg>',
          micOff: '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 9v3a3 3 0 0 0 5.1 2.1M15 9.3V5a3 3 0 0 0-5.9-.7"/><path d="M17 16.9A7 7 0 0 1 5 12v-2m14 0v2c0 .8-.1 1.5-.4 2.2M12 19v3M2 2l20 20"/></svg>',
          speaker: '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4z" fill="currentColor" fill-opacity=".15"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/></svg>',
          min: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>',
          cam: '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="6.5" width="13" height="11" rx="2.5"/><path d="M15.5 10.5 21 7.5v9l-5.5-3z"/></svg>',
          flip: '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9a8 8 0 0 1 14-3l2 2M20 15a8 8 0 0 1-14 3l-2-2"/><path d="M20 4v4h-4M4 20v-4h4"/></svg>',
          eye: '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
          eyeOff: '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.9 5.2A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-2.6 3.5M6.6 6.6C3.9 8.3 2 12 2 12s3.6 7 10 7a9.6 9.6 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2M2 2l20 20"/></svg>',
          screen: '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="4" width="19" height="13" rx="2"/><path d="M8 21h8M12 17v4M9 10.5l3-3 3 3M12 7.5V14"/></svg>',
      };
      const $c = (id) => document.getElementById(id);
      // Шапка экрана звонка (имя, аватар) — отдельно от кнопок: профиль собеседника может подгрузиться уже во время звонка
      function callPeerHeader() {
          const c = call; if (!c) return;
          // Имя — только из профиля: поле name в записи звонка пишет сам звонящий
          const u = usersCache[c.peer], name = (u && u.name) || t("Собеседник"), av = getAvatar(c.peer, name);
          if (!u) watchUser(c.peer);
          if ($c("call-name").textContent !== name) $c("call-name").textContent = name;
          if ($c("call-av").getAttribute("src") !== av) { $c("call-av").src = av; $c("call-bg-img").src = av; }
          const st = $c("call-status").textContent; if (st) $c("call-pill-text").textContent = name + " · " + st;
      }
      // Видео незнакомца (на кого не подписан) — не сразу на весь экран, а по кнопке «Показать видео»
      const callTrusts = (c) => (usersCache[currentUser.uid]?.following || []).includes(c.peer);
      function callUi() {
          const c = call, scr = $c("call-screen");
          if (!c) return;
          callPeerHeader();
          scr.classList.toggle("ringing", c.role === "callee" && !c.accepting);
          const acts = c.role === "callee" && !c.accepting
              ? [["decline", "red", CALL_SVG.hang, t("Отклонить")], ["accept", "green", CALL_SVG.accept, t("Принять")]]
              : [["mute", c.muted ? "on" : "", c.muted ? CALL_SVG.micOff : CALL_SVG.mic, c.muted ? t("Микрофон выкл.") : t("Микрофон")],
                 // «Динамик» — только если телефон дал выбрать выход звука (на iPhone из браузера пока нельзя: звук выбирает iOS)
                 ...(c.outs ? [["speaker", c.speaker ? "on" : "", CALL_SVG.speaker, t("Динамик")]] : []),
                 ...(c.vtx ? [["cam", c.vsrc === "cam" || c.vpending === "cam" ? "on" : "", CALL_SVG.cam, t("Камера")]] : []),
                 ...(c.vtx && (c.vsrc === "cam" || c.flipping) && isMobileCam() ? [["flip", "", CALL_SVG.flip, t("Повернуть")]] : []),
                 ...(c.vtx && canShareScreen() ? [["screen", c.vsrc === "screen" || c.vpending === "screen" ? "on" : "", CALL_SVG.screen, t("Экран")]] : []),
                 ...(c.peerVideo ? [["vid", c.hideVideo ? "" : "on", c.hideVideo ? CALL_SVG.eye : CALL_SVG.eyeOff, c.hideVideo ? t("Показать видео") : t("Скрыть видео")]] : []),
                 ["hang", "red", CALL_SVG.hang, t("Завершить")]];
          const box = $c("call-acts"), html = acts.map(([a, cls, svg, label]) => `<button type="button" class="call-act ${cls}" data-call-act="${a}"><span class="b">${svg}</span><span>${escapeHTML(label)}</span></button>`).join("");
          // перерисовываем, только если что-то поменялось: на iPhone касание кнопки, которую подменили посреди нажатия, теряется
          if (box._html !== html) { box._html = html; box.classList.toggle("many", acts.length > 3); box.innerHTML = html; }
          if (!$c("call-min").firstChild) { $c("call-min").title = t("Свернуть"); $c("call-min").innerHTML = CALL_SVG.min; }
          $c("call-note").textContent = c.hint || (!c.ice || $c("call-screen").classList.contains("vid") ? "" : c.relay ? t("Голос зашифрован и идёт через защищённый сервер — собеседник не видит ваш IP-адрес") : t("Голос зашифрован и идёт напрямую между устройствами"));
      }
      function setCallStatus(text) {
          $c("call-status").textContent = text;
          if (call) { const u = usersCache[call.peer]; $c("call-pill-text").textContent = ((u && u.name) || t("Собеседник")) + " · " + text; }
      }
      function showCallScreen() {
          const scr = $c("call-screen"); scr.classList.remove("out"); scr.classList.add("on");
          $c("call-pill").classList.remove("on"); callUi();
      }
      function minimizeCall() { if (!call) return; $c("call-screen").classList.remove("on"); $c("call-pill").classList.add("on"); }
      function hideCallScreen() {
          const scr = $c("call-screen"); $c("call-pill").classList.remove("on");
          if (!scr.classList.contains("on")) return;
          if (reduceMotion()) { scr.classList.remove("on"); return; }
          scr.classList.add("out"); setTimeout(() => { if (!call) scr.classList.remove("on", "out", "ringing"); }, 300);
      }
      function closeCallNotifs(id) {
          if (!id || !navigator.serviceWorker) return;
          navigator.serviceWorker.ready.then(r => r.getNotifications({ tag: "owl-call-" + id })).then(ns => ns.forEach(n => n.close())).catch(() => {});
      }
      function callTick(c) { if (call === c && c.connectedAt && !c.dropTimer) setCallStatus(callDur(Math.round((Date.now() - c.connectedAt) / 1000))); }
      // Ошибка слушателя записи звонка (например, её удалили) — звонок закончен, а не «висит» до таймера
      const callListenErr = (c) => (e) => { console.log("call:", e.code); if (call === c) endCall(null, true); };

      // ----- исходящий -----
      async function startCall(peer) {
          if (call && call.pending) endCall(null, true); // «призрак» из кэша не мешает позвонить
          if (call) return showCallScreen();
          if (!currentUser || !peer || peer === currentUser.uid) return;
          if (!callsSupported()) return showToast(t("Этот браузер не поддерживает звонки"), "error");
          if (iBlocked(peer) || blockedMe(peer)) return showToast(t("Нельзя позвонить этому человеку"), "block");
          if (!canCallTo(peer)) return showToast(t("Этот человек принимает звонки только от своих подписок"), "info");
          if (!chatsMetaCache[guardDm(peer)]) return showToast(t("Чтобы позвонить, сначала напишите этому человеку"), "info");
          const me = currentUser.uid, c = call = { role: "caller", peer, chatId: guardDm(peer), name: usersCache[peer]?.name || "", relay: false, wantVideo: callVideoOk(peer) && peerHasVideo(peer) };
          showCallScreen(); setCallStatus(t("Вызов…"));
          try {
              c.step = "mic";
              // к уху — сразу, как открылся микрофон: iOS разрешает переключать звук только вскоре после касания
              const [stream, ice] = await Promise.all([getMic().then(st => { if (call === c) callSetSpeaker(c, false, true); return st; }), callIceServers()]);
              c.stream = stream; callApplyMute(c);
              if (call !== c) return stream.getTracks().forEach(tr => tr.stop()); // положили трубку, пока спрашивали микрофон
              // Без сервера связи напрямую наш IP увидел бы собеседник. С незнакомцем (не подписаны) так не соединяемся: ещё раз просим сервер
              let use = ice;
              if (!ice.relay && !callTrusts(c)) {
                  use = await callIceServers();
                  if (call !== c) return;
                  if (!use.relay) { callReport(c, "relay-refused", { name: "stun-only" }); showToast(t("Не удалось соединиться через защищённый сервер — попробуйте ещё раз"), "error"); c.id = null; return endCall("fail", true); }
              }
              c.ice = use; c.relay = use.relay; callUi();
              c.step = "rtc";
              const pc = c.pc = callPc(c);
              if (c.vtx) callUi();
              await pc.setLocalDescription(await pc.createOffer());
              await callGather(pc, c.relay);
              if (call !== c) return;
              c.step = "db";
              const ref = doc(collection(db, "calls")); c.id = ref.id;
              // Без сети запись «повисает» навсегда — ждём не больше 12 с. Если она дойдёт позже, удаление уйдёт следом и её погасит
              const offline = new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error("offline"), { code: "offline" })), 12000));
              await Promise.race([setDoc(ref, { from: me, to: peer, chatId: c.chatId, status: "ringing", offer: pc.localDescription.sdp, name: String(currentUser.displayName || "").slice(0, 64), created: serverTimestamp() }), offline]);
              if (call !== c) { deleteDoc(ref).catch(() => {}); return; }
              c.step = "ring";
              c.unsub = onSnapshot(ref, (snap) => onCallDoc(c, snap), callListenErr(c));
              // Сервер скажет, дошло ли уведомление: нет — подсказываем на экране звонка, почему собеседник может не ответить
              pushPost("/call/ring", { callId: ref.id }).then(r => r.json()).then(j => {
                  if (call !== c || c.answered || !j) return;
                  if (j.quiet) c.hint = t("У собеседника сейчас ночной режим — звонок его не разбудит");
                  else if (j.ok && j.sent === 0) c.hint = t("Уведомление не дошло: у собеседника выключены уведомления. Он увидит звонок, только если Owl открыт");
                  if (c.hint) callUi();
              }).catch(() => {});
              playTone("back"); setCallStatus(t("Звоним…"));
              c.ringTimer = setTimeout(() => { if (call === c && !c.answered) endCall("missed"); }, CALL_RING_MS);
          } catch (e) {
              if (call !== c) return;
              console.log("Звонок:", e.name, e.code, e.message);
              const denied = e.code === "permission-denied";
              if (e.code === "offline") { deleteDoc(doc(db, "calls", c.id)).catch(() => {}); showToast(t("Нет связи с интернетом — звонок не начался"), "error"); }
              else showToast(e.name === "NotAllowedError" ? t("Нет доступа к микрофону — разрешите его в настройках браузера") : denied ? t("Этот человек не принимает звонки от вас") : t("Не удалось позвонить") + callErr(c, e), "error");
              if (!denied && e.name !== "NotAllowedError") callReport(c, null, e);
              c.id = null; endCall(null, true);
          }
      }

      // ----- входящий -----
      // cached — запись пришла из кэша на устройстве (приложение только открыли): звоним, только когда сервер подтвердит,
      // что звонок ещё идёт (иначе «звонок-призрак» от уже закончившегося)
      function incomingCall(id, d, cached) {
          const c = call = { role: "callee", id, peer: d.from, chatId: d.chatId, offer: d.offer, name: String(d.name || "").slice(0, 64), relay: false, pending: !!cached };
          // includeMetadataChanges — чтобы пришло и подтверждение сервера, даже если сама запись не менялась
          c.unsub = onSnapshot(doc(db, "calls", id), { includeMetadataChanges: true }, (snap) => onCallDoc(c, snap), callListenErr(c));
          if (!c.pending) callRing(c);
          else setTimeout(() => { if (call === c && c.pending) endCall(null, true); }, 8000); // сервер так и не подтвердил — не ждём вечно
      }
      function callRing(c) {
          c.pending = false;
          showCallScreen(); setCallStatus(t("Входящий звонок"));
          playTone("ring");
          callIceServers(); // заранее, чтобы после «Принять» соединиться быстрее
          // Звонящий сам отметит «нет ответа»; это страховка, если он пропал
          c.ringTimer = setTimeout(() => { if (call === c && !c.accepting) endCall(null, true); }, CALL_RING_MS + 10000);
      }
      async function acceptCall() {
          const c = call; if (!c || c.role !== "callee" || c.accepting || c.pending) return;
          c.accepting = true; c.lockUntil = Date.now() + 900; // второе касание «Принять» не должно попасть в «Завершить»
          clearTimeout(c.ringTimer); stopTone(); callUi(); setCallStatus(t("Соединение…"));
          try {
              c.step = "mic";
              const [stream, ice] = await Promise.all([getMic().then(st => { if (call === c) callSetSpeaker(c, false, true); return st; }), callIceServers()]);
              c.stream = stream; callApplyMute(c);
              if (call !== c) return stream.getTracks().forEach(tr => tr.stop());
              // Сервер связи не ответил — напрямую наш IP увидел бы звонящий. С незнакомцем (не подписаны) так не соединяемся: ещё раз просим сервер
              let use = ice;
              if (!ice.relay && !callTrusts(c)) {
                  use = await callIceServers();
                  if (call !== c) return;
                  if (!use.relay) { callReport(c, "relay-refused", { name: "stun-only" }); showToast(t("Не удалось соединиться через защищённый сервер — попробуйте ещё раз"), "error"); c.failWhy = "relay"; return endCall("fail"); }
              }
              c.ice = use; c.relay = use.relay; callUi();
              c.step = "rtc";
              const pc = c.pc = callPc(c);
              c.step = "sdp";
              await pc.setRemoteDescription({ type: "offer", sdp: c.offer });
              callTakeVideo(c, pc);
              await pc.setLocalDescription(await pc.createAnswer());
              await callGather(pc, c.relay);
              if (call !== c) return;
              c.step = "db";
              const ref = doc(db, "calls", c.id);
              await updateDoc(ref, { status: "accepted", answer: pc.localDescription.sdp, by: currentUser.uid });
              // Положили трубку, пока «принятие» летело на сервер: оно уже записано — закрываем звонок как положено
              if (call !== c) { updateDoc(ref, { status: "ended", by: currentUser.uid }).catch(() => {}); return; }
              c.answered = true; armConnectTimer(c);
              callAnswerOffer2(c);
          } catch (e) {
              if (call !== c) return;
              console.log("Звонок (ответ):", e.name, e.code, e.message);
              if (e.code === "permission-denied") { showToast(t("Звонок уже принят на другом устройстве или отменён"), "info"); return endCall(null, true); }
              showToast(e.name === "NotAllowedError" ? t("Нет доступа к микрофону — разрешите его в настройках браузера") : t("Не удалось ответить на звонок") + callErr(c, e), "error");
              callReport(c, null, e);
              c.failWhy = ((c.step || "?") + ": " + errName(e)).slice(0, 40); // звонящий увидит причину, а не «отклонён»
              endCall("fail");
          }
      }

      // Изменения записи звонка — у обоих участников. offer2/answer2 — повторное соединение (через сервер не вышло,
      // или во время разговора сменилась сеть): звонящий шлёт новое предложение, собеседник отвечает; каждое — один раз
      async function onCallDoc(c, snap) {
          if (call !== c) return;
          if (!snap.exists()) return endCall(null, true);
          const d = snap.data(), me = currentUser.uid;
          if (c.pending) {
              if (snap.metadata.fromCache) return;            // ждём ответа сервера
              if (d.status !== "ringing") return endCall(null, true);
              callRing(c);
          }
          try {
              if (c.role === "caller") {
                  if (d.status === "accepted" && !c.answered) {
                      c.answered = true; c.hint = null; callUi(); clearTimeout(c.ringTimer); stopTone(); setCallStatus(t("Соединение…"));
                      await c.pc.setRemoteDescription({ type: "answer", sdp: d.answer }); armConnectTimer(c);
                      // Собеседник не принял видео (старая версия Owl или видео ему недоступно) — убираем камеру, чтобы не гнать видео впустую
                      if (c.vtx && c.vtx.currentDirection !== "sendrecv") { const had = !!(c.vtrack || c.vpending); c.vreq = (c.vreq || 0) + 1; c.vpending = null; callStopLocalVideo(c); c.vtx.sender.replaceTrack(null).catch(() => {}); c.vtx = null; callUi(); if (had) showToast(t("Собеседник не может принять видео"), "info"); }
                  }
                  if (d.answer2 && d.answer2 !== c.lastAnswer2 && c.pc.signalingState === "have-local-offer") {
                      c.lastAnswer2 = d.answer2; await c.pc.setRemoteDescription({ type: "answer", sdp: d.answer2 });
                  }
                  if (d.status === "declined" || d.status === "busy") return endCall(d.status, true);
                  if (d.status === "failed") { c.failWhy = d.why || ""; return endCall("fail", true); }
                  if (d.status === "ended" && d.answer) c.answered = true; // «принял» и «положил» пришли одним снимком — это не «пропущенный»
              } else {
                  if (d.offer2) { c.wantOffer2 = d.offer2; callAnswerOffer2(c); }
                  if (!c.accepting && d.status === "accepted") return endCall("elsewhere", true); // ответили с другого устройства
                  if (!c.accepting && d.status !== "ringing") return endCall(null, true);
              }
              if (d.status === "ended" && d.by !== me) return endCall(null, true);
          } catch (e) { if (call !== c) return; console.log("Звонок (соединение):", e.name, e.message); callReport(c, "sdp2", e); endCall("fail"); }
      }

      // Собеседник отвечает на повторные предложения строго по одному; пришло новое, пока отвечали на старое, —
      // старый ответ не отправляем, сразу отвечаем на новое (иначе соединение «путается» и звонок рвётся)
      async function callAnswerOffer2(c) {
          if (c.answering2 || !c.answered || !c.pc) return;
          c.answering2 = true;
          try {
              while (call === c && c.wantOffer2 && c.wantOffer2 !== c.lastOffer2) {
                  const sdp = c.lastOffer2 = c.wantOffer2;
                  // До соединения звонящий переходит «напрямую» — тогда и мы собираем прямые адреса. Но прямые адреса выдают наш IP:
                  // открываем их только тому, на кого подписаны сами; остальным отвечаем через сервер (так часто тоже соединяется)
                  if (!c.connectedAt && c.relay && (usersCache[currentUser.uid]?.following || []).includes(c.peer)) { c.relay = false; callUi(); c.pc.setConfiguration({ iceServers: c.ice.iceServers, iceTransportPolicy: "all" }); }
                  setCallStatus(c.connectedAt ? t("Связь прервалась, восстанавливаем…") : c.relay ? t("Соединение…") : t("Соединяем напрямую…"));
                  await c.pc.setRemoteDescription({ type: "offer", sdp });
                  await c.pc.setLocalDescription(await c.pc.createAnswer());
                  await callGather(c.pc, c.relay);
                  if (call !== c) return;
                  if (c.wantOffer2 !== sdp) continue;
                  await updateDoc(doc(db, "calls", c.id), { answer2: c.pc.localDescription.sdp, by: currentUser.uid });
                  if (!c.connectedAt) armConnectTimer(c);
              }
          } catch (e) { if (call !== c) return; console.log("Звонок (повторное соединение):", e.name, e.message); callReport(c, "sdp2", e); endCall("fail"); }
          finally { c.answering2 = false; }
      }
      function armConnectTimer(c) {
          clearTimeout(c.connTimer);
          c.connTimer = setTimeout(() => { if (call === c && !c.connectedAt) callFailed(c); }, CALL_CONNECT_MS);
      }
      // Не соединились за 15 с. Звонящий один раз пробует напрямую, собеседник ждёт этой попытки; дальше — «не удалось»
      function callFailed(c) {
          if (call !== c) return;
          // «напрямую» откроет собеседнику наш IP — пробуем так только с тем, на кого подписаны
          if (c.role === "caller" && c.relay && !c.retried && callTrusts(c)) { c.retried = true; return callRestart(c, true); }
          if (c.role === "callee" && !c.waited) { c.waited = true; return armConnectTimer(c); } // ждём попытку звонящего «напрямую»
          callReport(c, "connect", { name: c.relay ? "relay" : "direct" });
          endCall("fail");
      }
      // Повторное соединение (ICE restart): direct — уйти с сервера связи на прямое соединение
      async function callRestart(c, direct) {
          // по одному: пока не пришёл ответ на прошлое предложение (signalingState не stable), новое не шлём
          if (c.restarting || c.role !== "caller" || !c.pc || c.pc.signalingState !== "stable") return;
          c.restarting = true;
          try {
              if (direct) { c.relay = false; callUi(); setCallStatus(t("Соединяем напрямую…")); c.pc.setConfiguration({ iceServers: c.ice.iceServers, iceTransportPolicy: "all" }); }
              await c.pc.setLocalDescription(await c.pc.createOffer({ iceRestart: true }));
              await callGather(c.pc, c.relay);
              if (call !== c) return;
              await updateDoc(doc(db, "calls", c.id), { offer2: c.pc.localDescription.sdp, by: currentUser.uid });
              if (!c.connectedAt) armConnectTimer(c);
          } catch (e) { if (call !== c) return; console.log("Звонок (переподключение):", e.message); callReport(c, "restart", e); endCall("fail"); }
          finally { c.restarting = false; }
      }
      function callConnState(c) {
          if (call !== c || !c.pc) return;
          const st = c.pc.connectionState || c.pc.iceConnectionState;
          if (st === "connected" || st === "completed") {
              clearTimeout(c.connTimer); clearTimeout(c.dropTimer); clearTimeout(c.reTimer); c.dropTimer = c.reTimer = null;
              if (!c.connectedAt) { c.connectedAt = Date.now(); stopTone(); c.tick = setInterval(() => callTick(c), 1000); }
              callTick(c);
          } else if ((st === "disconnected" || st === "failed") && c.connectedAt) {
              // Сменилась сеть (Wi-Fi ↔ мобильный) или пропала связь: звонящий переподключает, оба ждут до 25 с
              setCallStatus(t("Связь прервалась, восстанавливаем…"));
              if (c.role === "caller" && !c.reTimer) c.reTimer = setTimeout(() => { c.reTimer = null; if (call === c && c.pc.connectionState !== "connected") callRestart(c, false); }, st === "failed" ? 0 : 2500);
              if (!c.dropTimer) c.dropTimer = setTimeout(() => { if (call === c) { callReport(c, "drop", { name: "lost" }); endCall(); } }, CALL_DROP_MS);
          } else if (st === "failed") { clearTimeout(c.connTimer); callFailed(c); }
      }

      // Положить трубку / звонок закончился. why — итог для звонящего (missed / declined / busy / fail),
      // remote — запись звонка уже изменил собеседник (или её нет), писать в неё не нужно
      const CALL_TEXT = { ok: "📞 Звонок", missed: "📞 Пропущенный звонок", busy: "📞 Пропущенный звонок", declined: "📞 Отклонённый звонок", fail: "📞 Звонок не удался" };
      async function endCall(why = null, remote = false) {
          const c = call; if (!c || c.ending) return;
          c.ending = true; call = null;
          [c.ringTimer, c.connTimer, c.dropTimer, c.reTimer].forEach(clearTimeout); clearInterval(c.tick); stopTone();
          if (c.unsub) c.unsub();
          try { if (c.pc) c.pc.close(); } catch (_) {}
          if (c.stream) c.stream.getTracks().forEach(tr => tr.stop());
          callStopLocalVideo(c); { const v = $c("call-video"); v.srcObject = null; $c("call-screen").classList.remove("vid", "self"); }
          const a = $c("call-audio"); a.srcObject = null;
          try { if (c.relayIn) c.relayIn.disconnect(); } catch (_) {}
          if (relayCtx && relayCtx.state !== "closed") relayCtx.suspend().catch(() => {}); // между звонками движок спит
          if (sinkDirty) a.setSinkId("").then(() => { sinkDirty = false; }).catch(() => {}); // по касанию «Завершить» — сразу
          restoreAmbient(); // звонок закончился — звук снова «фоновый», не прерывает музыку
          closeCallNotifs(c.id);
          if (c.pending) { hideCallScreen(); return; } // «призрак» из кэша — экран не показывали (на всякий случай прячем)
          const dur = c.connectedAt ? Math.max(1, Math.round((Date.now() - c.connectedAt) / 1000)) : 0;
          const s = dur ? "ok" : why || (c.answered ? "fail" : "missed");
          const peerFail = s === "fail" && c.role === "caller" && remote && c.failWhy !== undefined;
          const ended = { ok: t("Звонок завершён"), missed: c.role === "caller" ? t("Нет ответа") : t("Звонок отменён"), declined: t("Звонок отклонён"), busy: t("Занято"), fail: peerFail ? t("У собеседника не получилось ответить") : t("Не удалось соединиться"), elsewhere: t("Принят на другом устройстве") }[s];
          setCallStatus(dur ? ended + " · " + callDur(dur) : ended + (peerFail && c.failWhy ? " (" + c.failWhy + ")" : ""));
          $c("call-acts").innerHTML = ""; $c("call-acts")._html = ""; $c("call-screen").classList.remove("ringing");
          const shown = $c("call-screen").classList.contains("on");
          if (!shown && c.connectedAt) showToast(dur ? ended + " · " + callDur(dur) : ended, "info");
          setTimeout(() => { if (!call) hideCallScreen(); }, shown ? (peerFail ? 2600 : 1300) : 0);
          if (!c.id || !currentUser) return;
          const me = currentUser.uid, ref = doc(db, "calls", c.id);
          if (!remote) {
              const upd = c.answered ? { status: "ended" } : c.role === "caller" ? { status: "missed" } : c.failWhy ? { status: "failed", why: c.failWhy } : { status: "declined" };
              await updateDoc(ref, { ...upd, by: me }).catch(e => console.log("Звонок (итог):", e.code));
          }
          if (c.role !== "caller") { if (c.answered) setTimeout(() => deleteDoc(ref).catch(() => {}), 3000); return; }
          // Отметка в переписке — от звонящего. Push — только о пропущенном (об остальном собеседник и так знает)
          const text = CALL_TEXT[s] + (s === "ok" ? " · " + callDur(dur) : "");
          postMessage(c.chatId, { chatId: c.chatId, sender: currentUser.displayName, uid: me, timestamp: new Date(), read: false, text, call: { s, d: dur } }, text, { noPush: s !== "missed" && s !== "busy" })
              .catch(e => console.log("Звонок (отметка):", e.code || e.message));
          setTimeout(() => deleteDoc(ref).catch(() => {}), 1500); // собеседник успеет увидеть итог
      }

      function startCallsListener() {
          if (callsListener) { callsListener(); callsListener = null; }
          if (!currentUser || !callsSupported()) return;
          const me = currentUser.uid;
          callsListener = onSnapshot(query(collection(db, "calls"), where("to", "==", me), where("status", "==", "ringing")), (snap) => {
              snap.docChanges().forEach((ch) => {
                  if (ch.type !== "added") return;
                  const d = ch.doc.data(), id = ch.doc.id, age = d.created ? Date.now() - getTime(d.created) : Infinity;
                  // Старый «звонок» (звонящий пропал, не отменив): не звоним; совсем старый — убираем, чтобы не читать при каждом входе.
                  // Запас в минутах — на случай, если часы телефона спешат
                  if (age > CALL_STALE_MS) { if (age > 10 * 60000) deleteDoc(ch.doc.ref).catch(() => {}); return; }
                  if (iBlocked(d.from) || bansCache[d.from]) { updateDoc(ch.doc.ref, { status: "declined", by: me }).catch(() => {}); return; }
                  if (call && call.pending && call.id !== id) endCall(null, true); // новый звонок важнее непроверенного «призрака»
                  if (call) { if (call.id !== id) updateDoc(ch.doc.ref, { status: "busy", by: me }).catch(() => {}); return; }
                  incomingCall(id, d, ch.doc.metadata.fromCache);
              });
          }, (e) => console.log("calls:", e.code));
      }
      function updateCallBtn() {
          const btn = $c("call-btn"); if (!btn) return;
          const peer = currentUser && dmPeer(currentChatId);
          btn.style.display = peer && peer !== currentUser.uid && callsSupported() && !iBlocked(peer) && !blockedMe(peer) ? "flex" : "none";
      }
      $c("call-btn").addEventListener("click", () => startCall(dmPeer(currentChatId)));
      $c("call-min").addEventListener("click", minimizeCall);
      $c("call-pill").addEventListener("click", showCallScreen);
      $c("call-acts").addEventListener("click", async (e) => {
          const b = e.target.closest("[data-call-act]"); if (!b || !call) return;
          const a = b.dataset.callAct, c = call;
          if (a !== "accept" && c.lockUntil && Date.now() < c.lockUntil) return; // защита от двойного касания после «Принять»
          if (a === "accept") acceptCall();
          else if (a === "decline") endCall();
          else if (a === "hang") endCall(c.role === "caller" && !c.answered ? "missed" : null);
          else if (a === "mute") { c.muted = !c.muted; callApplyMute(c); callUi(); }
          else if (a === "cam") callCamera(c, !(c.vsrc === "cam" || c.vpending === "cam"));
          else if (a === "flip") { if (!c.vpending) callCamera(c, true, true); }
          else if (a === "screen") callScreen(c, !(c.vsrc === "screen" || c.vpending === "screen"));
          else if (a === "vid") { c.hideVideo = !c.hideVideo; callVideoUi(c); callUi(); }
          else if (a === "speaker") { callRelayCtx(); if (!(await callSetSpeaker(c, !c.speaker))) showToast(t("Звук на этом устройстве выбирает система") + (c.outNames ? " (" + c.outNames + ")" : ""), "info"); }
      });
      document.addEventListener("keydown", (e) => { if (e.key === "Escape" && call && $c("call-screen").classList.contains("on") && !(call.role === "callee" && !call.accepting)) minimizeCall(); });
      // Закрыли вкладку посреди звонка — сообщаем собеседнику (как получится)
      window.addEventListener("pagehide", () => { if (call && call.id && !call.pending) updateDoc(doc(db, "calls", call.id), { status: call.answered ? "ended" : call.role === "caller" ? "missed" : "declined", by: currentUser.uid }).catch(() => {}); });

      // Отметка о звонке в переписке: нажать — позвонить снова
      const CALL_LABELS = { ok: ["Исходящий звонок", "Входящий звонок"], missed: ["Звонок без ответа", "Пропущенный звонок"], busy: ["Звонок без ответа", "Пропущенный звонок"], declined: ["Звонок отклонён", "Отклонённый звонок"], fail: ["Звонок не удался", "Звонок не удался"] };
      function callNoteHtml(msg, mine) {
          const c = msg.call || {}, l = CALL_LABELS[c.s] || CALL_LABELS.fail, bad = !mine && (c.s === "missed" || c.s === "busy");
          const arrow = mine ? '<path d="M15 3h6v6M21 3l-7 7" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>' : '<path d="M21 3l-7 7M14 4v6h6" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>';
          const ic = `<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><path d="M20 15.5c-1.2 0-2.4-.2-3.6-.6a1 1 0 0 0-1 .25l-2.2 2.2a15 15 0 0 1-6.6-6.6l2.2-2.2a1 1 0 0 0 .25-1A11.4 11.4 0 0 1 8.5 4a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1 17 17 0 0 0 17 17 1 1 0 0 0 1-1v-3.5a1 1 0 0 0-1-1z" fill="currentColor"/>${arrow}</svg>`;
          const sub = c.s === "ok" && c.d ? callDur(c.d) : t("Позвонить снова");
          return `<button type="button" class="call-note${bad ? " bad" : ""}" title="${escapeHTML(t("Позвонить"))}"><span class="call-ic">${ic}</span><span><b>${escapeHTML(t(l[mine ? 0 : 1]))}</b><small>${escapeHTML(sub)}</small></span></button>`;
      }
      document.getElementById("chat-box").addEventListener("click", (e) => { if (e.target.closest(".call-note")) startCall(dmPeer(currentChatId)); });

      // ===== ПОДСКАЗКА «ВКЛЮЧИ УВЕДОМЛЕНИЯ» =====
      // Без уведомлений человек не узнает о звонке, пока Owl закрыт. Раз в 3 дня, через 20 с после входа, мягко напоминаем.
      // На iPhone в Safari (не с экрана «Домой») уведомлений нет вовсе — тогда подсказываем, как установить Owl
      function pushNudge() {
          if (!currentUser || pushEnabled()) return;
          try { if (Date.now() - (+localStorage.getItem("owl-push-nudge") || 0) < 3 * 86400000 || localStorage.getItem("owl-push") === "off") return; localStorage.setItem("owl-push-nudge", String(Date.now())); } catch (_) { return; }
          const iosTab = /iPhone|iPad/.test(navigator.userAgent) && !isStandalone();
          if (iosTab || !("Notification" in window)) return showToast(t("Этот браузер не поддерживает уведомления. На iPhone добавьте Owl на экран «Домой» (iOS 16.4+)."), "bell");
          if (Notification.permission === "denied") return;
          showToast(t("Включите уведомления, чтобы не пропускать звонки и сообщения — нажмите сюда"), "bell", { onClick: () => {
              const tg = document.getElementById("push-toggle"); tg.checked = true; tg.dispatchEvent(new Event("change"));
          } });
      }

      // ===== АВТООБНОВЛЕНИЕ =====
      // Owl с экрана «Домой» может днями жить в фоне со старым кодом (так у друзей не работали звонки после исправления).
      // Когда человек возвращается в приложение (не чаще раза в 5 минут), сверяем номер версии в sw.js на сайте со своим:
      // вышла новая — тихо перезагружаемся. Не трогаем, пока идёт звонок, пишется голосовое или человек набирает текст;
      // после возвращения ждём 5 с (вдруг это нажали уведомление о звонке) и не перезагружаемся дважды ради одной версии
      const OWL_SHELL = 82; // = номер из CACHE в sw.js (owl-shell-vNN) — поднимать вместе с ним при каждой выкладке
      let updCheckAt = 0, updTarget = 0, updTimer = null;
      async function checkAppUpdate() {
          if (updTarget || Date.now() - updCheckAt < 5 * 60000) return;
          updCheckAt = Date.now();
          try {
              const txt = await (await fetch("/sw.js?u=" + Date.now(), { cache: "no-store" })).text();
              const m = txt.match(/owl-shell-v(\d+)/);
              if (m && +m[1] > OWL_SHELL) { updTarget = +m[1]; tryApplyUpdate(); }
          } catch (_) {}
      }
      const updBusy = () => {
          const inp = document.getElementById("message-input");
          return !!call || isRecording || document.visibilityState !== "visible" || (inp && document.activeElement === inp && inp.value.trim());
      };
      function tryApplyUpdate() {
          if (!updTarget || updBusy()) return;
          try { if (sessionStorage.getItem("owl-upd") === String(updTarget)) return; } catch (_) {}
          const go = () => {
              if (updBusy()) return; // пока обновлялись — пришёл звонок или начали печатать
              try { sessionStorage.setItem("owl-upd", String(updTarget)); } catch (_) {}
              location.reload();
          };
          (navigator.serviceWorker ? navigator.serviceWorker.getRegistration().then(r => r && r.update()).catch(() => {}) : Promise.resolve()).then(go, go);
      }
      document.addEventListener("visibilitychange", () => {
          clearTimeout(updTimer);
          if (document.visibilityState === "visible") updTimer = setTimeout(() => { if (updTarget) tryApplyUpdate(); else checkAppUpdate(); }, 5000);
      });
      setTimeout(checkAppUpdate, 60000);

      document.getElementById("push-toggle").addEventListener("change", async (e) => {
          const hint = document.getElementById("push-hint");
          if (!("Notification" in window)) { e.target.checked = false; hint.innerText = t("Этот браузер не поддерживает уведомления. На iPhone добавьте Owl на экран «Домой» (iOS 16.4+)."); return; }
          if (e.target.checked) {
              let perm = Notification.permission;
              if (perm === "default") perm = await Notification.requestPermission();
              if (perm !== "granted") { e.target.checked = false; hint.innerText = t("Уведомления запрещены в настройках браузера — разрешите их для этого сайта."); return; }
              try { localStorage.setItem("owl-push", "on"); } catch (_) {}
              hint.innerText = t("Подключаем уведомления…");
              updateUnreadIndicators(totalUnread());
              const ok = await serverPushSubscribe();
              hint.innerText = ok ? t("Готово! Сообщения будут приходить, даже когда Owl закрыт.")
                  : serverPushSupported() ? t("Уведомления включены, пока Owl открыт. Сервер уведомлений недоступен — попробуйте позже.")
                  : t("Уведомления включены, пока Owl открыт. Чтобы получать их при закрытом приложении, установите Owl на экран «Домой».");
          } else {
              try { localStorage.setItem("owl-push", "off"); } catch (_) {}
              hint.innerText = t("Уведомления выключены.");
              serverPushUnsubscribe();
          }
      });
      document.getElementById("push-toggle").checked = pushEnabled();

      // Диагностика: отправить тестовый push себе и показать ответ сервиса доставки
      document.getElementById("push-test-btn").addEventListener("click", async (e) => {
          const out = document.getElementById("push-test-result"), btn = e.currentTarget;
          const ua = navigator.userAgent, standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
          const lines = [];
          lines.push(t("Разрешение:") + " " + ("Notification" in window ? ({ granted: t("есть"), denied: t("запрещено в настройках браузера/телефона"), default: t("ещё не спрашивали") }[Notification.permission] || Notification.permission) : t("браузер не поддерживает уведомления")));
          lines.push(t("Push в этом браузере:") + " " + (serverPushSupported() ? t("поддерживается") : t("не поддерживается") + (/iPhone|iPad/.test(ua) && !standalone ? " — " + t("установите Owl на экран «Домой»") : "")));
          if (!currentUser || !serverPushSupported() || !("Notification" in window) || Notification.permission !== "granted") { out.textContent = lines.join("\n"); return; }
          btn.disabled = true; out.textContent = lines.join("\n") + "\n" + t("Отправляем тест…");
          try {
              const ok = await serverPushSubscribe(); // заодно обновим подписку этого устройства
              lines.push(t("Подписка этого устройства:") + " " + (ok ? t("сохранена на сервере") : t("не удалось сохранить")));
              const r = await (await pushPost("/test", { lang: LANG })).json();
              if (!r.devices || !r.devices.length) lines.push(t("На сервере нет ни одного вашего устройства."));
              (r.devices || []).forEach((d, i) => {
                  const who = /google/.test(d.host) ? "Android/Chrome (Google)" : /apple/.test(d.host) ? "iPhone/Mac (Apple)" : /mozilla/.test(d.host) ? "Firefox (Mozilla)" : /windows|notify\.windows/.test(d.host) ? "Windows" : d.host;
                  const verdict = d.status >= 200 && d.status < 300 ? "✓ " + t("принято, уведомление должно прийти") : d.status === 404 || d.status === 410 ? "✗ " + t("подписка устарела — удалена, выключите и включите уведомления") : d.status === 403 ? "✗ " + t("сервис отклонил ключ (403)") : "✗ " + t("ошибка") + " " + d.status;
                  lines.push(`${t("Устройство {n}", { n: i + 1 })}: ${who} — ${verdict}${d.text ? " (" + d.text + ")" : ""}`);
              });
              lines.push(t("Если сервис «принял», а уведомления нет — дело в настройках телефона: уведомления для Chrome/Owl, режим «Не беспокоить», экономия батареи."));
          } catch (err) { lines.push(t("Сервер уведомлений недоступен:") + " " + (err.message || err)); }
          out.innerHTML = iconizeEmoji(escapeHTML(lines.join("\n"))); btn.disabled = false;
      });

      // ===== ОНЛАЙН-СТАТУС =====
      const ONLINE_TTL = 5 * 60 * 1000;     // считаем онлайн, если пульс был не позже 5 мин назад
      const HEARTBEAT_MS = 4 * 60 * 1000; // каждый пульс — это чтение у каждого, кто слушает профиль (у админа — всех), поэтому редко
      let presenceTimer = null; let presenceInit = false;
      const myHideOnline = () => !!(currentUser && usersCache[currentUser.uid]?.hideOnline);

      function writePresence(online) {
          if (!currentUser) return;
          let me = usersCache[currentUser.uid]; if (!me) return; // ждём свой профиль, чтобы знать про hideOnline
          if (me.hideOnline && !me.online && !me.lastSeen) return; // статус скрыт и уже чистый — лишних записей не делаем
          if (myHideOnline()) { setDoc(doc(db, "users", currentUser.uid), { online: false, lastSeen: deleteField() }, { merge: true }).catch(e => console.log(e)); return; }
          writeMyField("lastSeen", { online: online, lastSeen: new Date() }).catch(e => console.log("Онлайн-статус:", e.code || e));
      }
      function startPresence() {
          stopPresence(false);
          presenceTimer = setInterval(() => { if (document.visibilityState === "visible") writePresence(true); }, HEARTBEAT_MS);
      }
      function stopPresence(sendOffline = true) {
          if (presenceTimer) { clearInterval(presenceTimer); presenceTimer = null; }
          if (sendOffline) writePresence(false);
          presenceInit = false;
      }
      document.addEventListener("visibilitychange", () => { if (presenceTimer) writePresence(document.visibilityState === "visible"); });
      window.addEventListener("pagehide", () => { if (presenceTimer) writePresence(false); });

      function isUserOnline(u) {
          if (!u || bansCache[u.uid] || u.hideOnline || !u.online || !u.lastSeen || !allowedBy(u, "lastSeen")) return false;
          return Date.now() - getTime(u.lastSeen) < ONLINE_TTL;
      }
      function formatLastSeen(u) {
          if (!u) return t("Личные сообщения");
          if (bansCache[u.uid]) return t("пользователь заблокирован");
          if (u.hideOnline || !u.lastSeen || !allowedBy(u, "lastSeen")) return t("был(а) недавно");
          if (isUserOnline(u)) return t("в сети");
          let ts = getTime(u.lastSeen); let diff = Date.now() - ts; let d = new Date(ts);
          if (diff < 60 * 1000) return t("был(а) только что");
          if (diff < 60 * 60 * 1000) return t("был(а) {n} мин. назад", { n: Math.floor(diff / 60000) });
          let hm = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          let today = new Date(); let y = new Date(); y.setDate(today.getDate() - 1);
          if (d.toDateString() === today.toDateString()) return t("был(а) сегодня в {time}", { time: hm });
          if (d.toDateString() === y.toDateString()) return t("был(а) вчера в {time}", { time: hm });
          return t("был(а) {date}", { date: d.toLocaleDateString([], { day: 'numeric', month: 'short' }) });
      }

      // ===== «СОВА НЕ БУДИТ» =====
      // Мои настройки — users_private/{я}.night { on, f, t, u, show } (f/t — минуты местного времени), по умолчанию 23:00–08:00.
      // Сервер уведомлений хранит ночные часы (POST /quiet) и ночью не шлёт push, а утром присылает одну сводку.
      // Собеседникам — users/{я}.night { f, t, z, u } (z — смещение пояса): у них в личке плашка «у собеседника ночь» и кнопка «Срочно»
      const NIGHT_DEFAULT = { on: true, f: 23 * 60, t: 8 * 60, u: true, show: true };
      const nightPrefs = () => ({ ...NIGHT_DEFAULT, ...((myPrivate && myPrivate.night) || {}) });
      const tzOffset = () => -new Date().getTimezoneOffset();
      const minToHM = (m) => String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");
      const hmToMin = (s) => { const [h, m] = String(s || "").split(":").map(Number); return Number.isInteger(h) && Number.isInteger(m) && h >= 0 && h < 24 && m >= 0 && m < 60 ? h * 60 + m : null; };
      const okMin = (v) => Number.isInteger(v) && v >= 0 && v < 1440;
      // Чужие данные из базы — проверяем, прежде чем считать
      function cleanNight(n) {
          if (!n || typeof n !== "object" || !okMin(n.f) || !okMin(n.t) || n.f === n.t || !Number.isInteger(n.z) || Math.abs(n.z) > 840) return null;
          return { f: n.f, t: n.t, z: n.z, u: n.u !== false };
      }
      const sameNight = (a, b) => (!a && !b) || (!!a && !!b && a.f === b.f && a.t === b.t && a.z === b.z && a.u === b.u);
      const nightLocalMin = (n, now = Date.now()) => (((Math.floor(now / 60000) + n.z) % 1440) + 1440) % 1440;
      function isNightFor(n, now) { const m = nightLocalMin(n, now); return n.f < n.t ? (m >= n.f && m < n.t) : (m >= n.f || m < n.t); }
      // Ночь у собеседника прямо сейчас → его ночные часы, иначе null
      function peerNight(uid) { const n = uid && usersCache[uid] && cleanNight(usersCache[uid].night); return n && isNightFor(n) ? n : null; }
      function iAmAsleep() { const p = nightPrefs(); return !!(currentUser && p.on && okMin(p.f) && okMin(p.t) && p.f !== p.t && isNightFor({ f: p.f, t: p.t, z: tzOffset() })); }

      // Публичное поле и сервер уведомлений — по текущим настройкам и поясу (переезд, переход на летнее время)
      let nightSyncing = false, nightPubFailed = false, nightSrvTried = "";
      async function syncNight() {
          if (!currentUser || !myPrivate || !myRawProfile || nightSyncing) return;
          const p = nightPrefs(), uid = currentUser.uid;
          const quiet = p.on ? cleanNight({ f: p.f, t: p.t, z: tzOffset(), u: p.u }) : null;
          const pub = quiet && p.show ? quiet : null;
          const pubSame = sameNight(cleanNight(myRawProfile.night), pub) && (pub || myRawProfile.night === undefined);
          const srvKey = JSON.stringify([uid, quiet]);
          let srvSame = srvKey === nightSrvTried;
          try { srvSame = srvSame || localStorage.getItem("owl-night-sync") === srvKey; } catch (_) {}
          if ((pubSame || nightPubFailed) && srvSame) return;
          nightSyncing = true;
          try {
              if (!pubSame && !nightPubFailed) {
                  try { await setDoc(doc(db, "users", uid), { night: pub || deleteField() }, { merge: true }); }
                  catch (e) { nightPubFailed = true; console.log("Ночь в профиле:", e.code || e); } // не повторяем до перезапуска
              }
              if (!srvSame) {
                  nightSrvTried = srvKey;
                  const r = await pushPost("/quiet", { quiet }).catch(() => null);
                  if (r && r.ok) try { localStorage.setItem("owl-night-sync", srvKey); } catch (_) {}
              }
          } finally { nightSyncing = false; }
      }
      setInterval(() => { if (document.visibilityState === "visible") syncNight(); }, 10 * 60 * 1000);
      // Сервер уведомлений должен знать язык — на нём придут push и письма (русский — по умолчанию)
      let langSyncTried = "";
      async function syncLang() {
          if (!currentUser) return;
          const key = currentUser.uid + ":" + LANG;
          let done = LANG === "ru"; // по умолчанию сервер и так считает язык русским
          try { const saved = localStorage.getItem("owl-lang-sync"); if (saved !== null) done = saved === key; } catch (_) {}
          if (done || langSyncTried === key) return;
          langSyncTried = key;
          const r = await pushPost("/lang", { lang: LANG }).catch(() => null);
          if (r && r.ok) try { localStorage.setItem("owl-lang-sync", key); } catch (_) {}
      }
      // Один раз рассказываем о новой функции тем, кто её ещё не настраивал
      function nightIntro() {
          if (!myPrivate || myPrivate.night !== undefined) return;
          try { if (localStorage.getItem("owl-night-intro")) return; localStorage.setItem("owl-night-intro", "1"); } catch (_) { return; }
          setTimeout(() => showToast(t("Новое — «Сова не будит»: с 23:00 до 08:00 уведомления молчат, утром придёт сводка. Настроить — кнопка 🌙 вверху"), "moon"), 2500);
      }

      function renderNightSettings() {
          const tog = document.getElementById("night-toggle"); if (!tog || !currentUser) return;
          const p = nightPrefs();
          tog.checked = !!p.on;
          document.getElementById("night-from").value = minToHM(okMin(p.f) ? p.f : NIGHT_DEFAULT.f);
          document.getElementById("night-to").value = minToHM(okMin(p.t) ? p.t : NIGHT_DEFAULT.t);
          document.getElementById("night-urgent").checked = p.u !== false;
          document.getElementById("night-show").checked = p.show !== false;
          document.getElementById("night-opts").classList.toggle("off", !p.on);
          // Пункт в настройках, луна в шапке и статус на экране
          const asleep = iAmAsleep(), from = minToHM(p.f), to = minToHM(p.t);
          document.getElementById("night-sum").textContent = p.on ? (asleep ? t("Сейчас ночь · тихо до {to}", { to }) : t("Тихо с {from} до {to}", { from, to })) : t("Выключено");
          const btn = document.getElementById("night-btn"), entry = document.getElementById("night-open");
          btn.classList.toggle("on", !!p.on); btn.classList.toggle("off", !p.on);
          entry.classList.toggle("on", !!p.on); entry.classList.toggle("off", !p.on);
          document.getElementById("night-art").classList.toggle("sleep", !!p.on); // сова спит, только когда функция включена
          btn.title = t("Сова не будит") + " — " + (p.on ? (asleep ? t("тихо до {to}", { to }) : t("тихо с {from} до {to}", { from, to })) : t("выключено"));
          const st = document.getElementById("night-status");
          st.textContent = !p.on ? t("Сова не спит — уведомления приходят круглосуточно") : asleep ? t("Сейчас ночь — тихо до {to}", { to }) : t("Сейчас день — тишина начнётся в {from}", { from });
          st.classList.toggle("asleep", asleep);
      }
      setInterval(renderNightSettings, 60 * 1000);
      const openNight = () => { renderNightSettings(); document.getElementById("night-screen").style.display = "flex"; };
      document.getElementById("night-btn").addEventListener("click", (e) => { e.stopPropagation(); openNight(); });
      document.getElementById("night-open").addEventListener("click", openNight);
      document.getElementById("night-close").addEventListener("click", () => { document.getElementById("night-screen").style.display = "none"; });
      document.getElementById("night-screen").addEventListener("click", (e) => { if (e.target.id === "night-screen") e.target.style.display = "none"; });
      async function saveNight(patch) {
          if (!currentUser) return;
          const next = { ...nightPrefs(), ...patch };
          if (!okMin(next.f) || !okMin(next.t) || next.f === next.t) { showToast(t("Начало и конец ночи не должны совпадать"), "error"); renderNightSettings(); return; }
          try {
              await setDoc(doc(db, "users_private", currentUser.uid), { night: next }, { merge: true });
              myPrivate = { ...(myPrivate || {}), night: next };
              nightPubFailed = false; renderNightSettings(); syncNight();
              showToast(next.on ? t("Сова не будит") + `: ${minToHM(next.f)}–${minToHM(next.t)}` : t("Тихая ночь выключена"), "moon");
          } catch (e) { console.error(e); showToast(t("Не удалось сохранить"), "error"); renderNightSettings(); }
      }
      document.getElementById("night-toggle").addEventListener("change", (e) => {
          document.getElementById("night-art").classList.toggle("sleep", e.target.checked); // засыпает/просыпается сразу, не дожидаясь базы
          saveNight({ on: e.target.checked });
      });
      document.getElementById("night-urgent").addEventListener("change", (e) => saveNight({ u: e.target.checked }));
      document.getElementById("night-show").addEventListener("change", (e) => saveNight({ show: e.target.checked }));
      ["night-from", "night-to"].forEach(id => document.getElementById(id).addEventListener("change", (e) => {
          const v = hmToMin(e.target.value);
          if (v === null) return renderNightSettings();
          saveNight(id === "night-from" ? { f: v } : { t: v });
      }));

      // Плашка в личке: у собеседника ночь — уведомление придёт утром; «Срочно» разбудит (если он разрешил)
      let nightUrgent = false, nightBarChat = null;
      function refreshNightBar() {
          const bar = document.getElementById("night-bar"); if (!bar) return;
          if (nightBarChat !== currentChatId) { nightUrgent = false; nightBarChat = currentChatId; }
          const peer = currentChatTargetUid, input = document.querySelector(".input-area");
          const n = peer && !bansCache[peer] && input && input.style.display !== "none" ? peerNight(peer) : null;
          bar.classList.toggle("on", !!n);
          if (!n) { nightUrgent = false; return; }
          if (!n.u) nightUrgent = false;
          const btn = document.getElementById("night-urgent-btn");
          btn.style.display = n.u ? "" : "none";
          btn.classList.toggle("active", nightUrgent);
          btn.innerHTML = iconizeEmoji(escapeHTML(nightUrgent ? t("⚡ Срочно") + " ✓" : t("⚡ Срочно")));
          document.getElementById("night-bar-text").textContent = nightUrgent
              ? t("Следующее сообщение придёт со звуком и разбудит собеседника")
              : t("У собеседника ночь ({time}). Сова не будит — уведомление придёт утром", { time: minToHM(nightLocalMin(n)) });
      }
      document.getElementById("night-urgent-btn").addEventListener("click", () => {
          nightUrgent = !nightUrgent; refreshNightBar();
          if (nightUrgent) showToast(t("Следующее сообщение разбудит собеседника"), "bell");
      });

      // Текст в шапке открытого чата (для личек — онлайн-статус)
      let currentHeaderStatus = ""; let currentChatTargetUid = null; let currentTypers = [];
      function refreshHeaderStatus() {
          let el = document.getElementById("current-chat-status"); if (!el) return;
          if (currentTypers.length > 0) { el.innerHTML = escapeHTML(t("{name} печатает", { name: currentTypers[0] })) + '<span class="typing-dots" aria-hidden="true"><i></i><i></i><i></i></span>'; el.style.color = "var(--accent)"; return; }
          let text = currentHeaderStatus; let color = "var(--text-muted)";
          if (currentChatTargetUid) { let u = usersCache[currentChatTargetUid]; text = formatLastSeen(u); if (isUserOnline(u)) color = "var(--accent)"; if (bansCache[currentChatTargetUid]) color = "#ff3b30"; else if (peerNight(currentChatTargetUid)) text += " · 🌙 " + t("ночь"); }
          el.innerHTML = iconizeEmoji(escapeHTML(text)); el.style.color = color;
          refreshNightBar();
      }
      setInterval(() => { refreshHeaderStatus(); renderDevPanel(); }, 30 * 1000);

      // ===== НИКНЕЙМЫ: один ник — один человек =====
      // Занятые ники лежат в коллекции usernames/{ник в нижнем регистре} = { uid }. Занимаем транзакцией, чтобы двое не взяли один ник одновременно.
      const normalizeNick = (n) => String(n || "").trim().replace(/\s+/g, " ");
      const nickKey = (n) => normalizeNick(n).toLowerCase();
      function validateNick(n) {
          n = normalizeNick(n);
          if (n.length < 3) return t("Минимум 3 символа");
          if (n.length > 24) return t("Максимум 24 символа");
          if (!/^[\p{L}\p{N}_.\- ]+$/u.test(n)) return t("Только буквы, цифры, пробел, _ . -");
          if (!/[\p{L}\p{N}]/u.test(n)) return t("Ник должен содержать букву или цифру");
          return null;
      }
      const nickTakenError = () => Object.assign(new Error(t("Этот никнейм уже занят")), { code: "nick-taken" });
      function nickTakenLocally(n, myUid) {
          const key = nickKey(n);
          return Object.values(usersCache).some(u => u && u.uid !== myUid && u.name && (u.nameKey || nickKey(u.name)) === key);
      }
      async function claimNickname(uid, newName, extra = {}) {
          newName = normalizeNick(newName); const key = nickKey(newName);
          const oldKey = usersCache[uid]?.nameKey || null;
          try {
              await runTransaction(db, async (tx) => {
                  const ref = doc(db, "usernames", key);
                  const snap = await tx.get(ref);
                  if (snap.exists() && snap.data().uid !== uid) throw nickTakenError();
                  const oldRef = (oldKey && oldKey !== key) ? doc(db, "usernames", oldKey) : null;
                  const oldSnap = oldRef ? await tx.get(oldRef) : null;
                  tx.set(ref, { uid: uid, name: newName, updatedAt: new Date() });
                  if (oldSnap && oldSnap.exists() && oldSnap.data().uid === uid) tx.delete(oldRef);
                  tx.set(doc(db, "users", uid), { name: newName, nameLower: key, nameKey: key, ...extra }, { merge: true });
              });
          } catch (e) {
              if (e.code !== "permission-denied") throw e;
              // Правила Firestore ещё не пускают в usernames — проверяем хотя бы по профилям, чтобы регистрация не ломалась
              console.warn("Нет доступа к коллекции usernames — добавьте правило. Проверяю ник по users.", e);
              const dup = await getDocs(query(collection(db, "users"), where("nameLower", "==", key), limit(5)));
              if (dup.docs.some(d => d.id !== uid)) throw nickTakenError();
              await setDoc(doc(db, "users", uid), { name: newName, nameLower: key, ...extra }, { merge: true });
          }
          return newName;
      }
      // Первый вход после подтверждения почты: создаём профиль и занимаем ник (до этого в базе нет ничего публичного —
      // правила тоже не пускают создать профиль или ник без подтверждённой почты). Ник ждал в displayName аккаунта
      async function createProfileAfterVerify(user) {
          if (!user.displayName || (await getDoc(doc(db, "users", user.uid))).exists()) return;
          const extra = { uid: user.uid, followersCount: 0, followingCount: 0, bio: "", createdAt: new Date(user.metadata && user.metadata.creationTime || Date.now()) };
          let name = user.displayName;
          for (let tries = 0; ; tries++) {
              try { name = await claimNickname(user.uid, name, extra); break; }
              catch (e) {
                  if (e.code !== "nick-taken" || tries > 5) throw e;
                  // ник успели занять, пока человек подтверждал почту — просим другой (отмена = ник с цифрами)
                  const fallback = normalizeNick(name).slice(0, 18) + Math.floor(100 + Math.random() * 900);
                  let next = prompt(t("Никнейм «{name}» уже занят, выберите другой", { name }), fallback);
                  next = normalizeNick(next || fallback);
                  const err = validateNick(next);
                  if (err) { alert(t("Никнейм: {error}", { error: t(err) })); continue; }
                  name = next;
              }
          }
          if (name !== user.displayName) await updateProfile(user, { displayName: name }).catch(() => {});
          try { const inv = localStorage.getItem("owl-invite"); if (inv) { await setDoc(doc(db, "users_private", user.uid), { uid: user.uid, invitedByNick: inv }, { merge: true }); localStorage.removeItem("owl-invite"); } } catch (_) {}
      }
      // Для старых аккаунтов: занимаем их текущий ник и проставляем дату регистрации
      async function ensureProfileMigrated(user) {
          try {
              const snap = await getDoc(doc(db, "users", user.uid)); const data = snap.exists() ? snap.data() : {};
              if (!data.createdAt && user.metadata && user.metadata.creationTime) {
                  await setDoc(doc(db, "users", user.uid), { createdAt: new Date(user.metadata.creationTime) }, { merge: true });
              }
              const name = data.name || user.displayName;
              if (!data.nameKey && name && name !== "Загрузка...") await claimNickname(user.uid, name);
          } catch (e) {
              if (e.code === "nick-taken") showToast(t("Ник «{name}» уже занят другим пользователем — смените его в профиле", { name: user.displayName }), "alert");
              else console.log(e);
          }
      }

      // ===== СЕРАЯ ГАЛОЧКА ДОВЕРЕННЫХ ПОЛЬЗОВАТЕЛЕЙ =====
      // verified/{uid} — выдаёт и снимает только разработчик; у официального аккаунта своя синяя галочка
      let verifiedCache = {}, verifiedListener = null;
      const VERIFIED_CHECK = (size) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
      const isVerified = (uid) => !!verifiedCache[uid] && usersCache[uid]?.email !== ADMIN_EMAIL;
      // Бейдж всегда выводится с data-verified-uid — потом его можно показать/скрыть без перерисовки
      function verifiedBadge(uid, size = 14) {
          if (!uid || usersCache[uid]?.email === ADMIN_EMAIL) return "";
          return `<span class="verified-badge" data-verified-uid="${escapeHTML(uid)}" title="${t("Подтверждённый пользователь")}" style="${isVerified(uid) ? '' : 'display:none;'}">${VERIFIED_CHECK(size)}</span>`;
      }
      function syncVerifiedBadges() {
          document.querySelectorAll("[data-verified-uid]").forEach(el => { el.style.display = isVerified(el.getAttribute("data-verified-uid")) ? "" : "none"; });
      }
      async function toggleVerified(uid, btn) {
          if (!isAdmin || !uid) return;
          const name = usersCache[uid]?.name || t("пользователя");
          btn.disabled = true;
          try {
              if (verifiedCache[uid]) {
                  if (!confirm(`Снять серую галочку у ${name}?`)) { btn.disabled = false; return; }
                  await deleteDoc(doc(db, "verified", uid));
                  showToast(`Галочка снята: ${name}`, "check");
              } else {
                  await setDoc(doc(db, "verified", uid), { uid: uid, grantedBy: currentUser.uid, grantedAt: new Date() });
                  showToast(`${name} получил(а) галочку`, "check");
              }
          } catch (e) {
              console.error(e);
              showToast(e.code === "permission-denied" ? "Нет прав — добавьте правило для коллекции verified в Firestore" : "Ошибка: " + e.message, "error");
          }
          btn.disabled = false;
      }

      // ===== ПРЕМИУМ: «ПЕРО» =====
      // Поле premium в users/{uid} ставит только админ (правила), цвет пера featherColor выбирает сам человек с премиумом.
      // Перо — один набор путей в общем <svg><defs> (геометрию считает scratchpad/feather/geo.mjs), каждое перо — несколько <use>.
      // Анимация (покачивание, блик, искорка) — CSS; в «Упрощённом режиме» и при «Уменьшении движения» её нет
      const FEATHER_COLORS = {"gold":["Золото","#5a3300","#c48a0c","#f5c63c","#fff0b0"],"rose":["Розовое золото","#5e2418","#c0705a","#f3a98f","#ffe4d8"],"silver":["Серебро","#323a45","#88929f","#d6dce4","#ffffff"],"emerald":["Изумруд","#023a28","#07905f","#3fe0a2","#d4ffec"],"sapphire":["Сапфир","#0a1d5c","#1f4fd6","#6fa0ff","#e2edff"],"amethyst":["Аметист","#2f0e5c","#7a38d6","#bd8cff","#f2e6ff"],"ruby":["Рубин","#4a0414","#c00f33","#ff5574","#ffe0e6"],"flame":["Пламя","#6a0f00","#e8430a","#ffa21f","#fff1a8"],"ice":["Лёд","#1f4d66","#4fb0dc","#b8ecff","#ffffff"]};
      const FEATHER_GEO = {"v":"M10.2 37.6L12.1 36.7L12.9 36.1L13.6 35.5L14.2 35L14.8 34.5L15.2 34.1L16.2 33.5L16.5 33.1L17 32.7L17.8 32.2L18.2 31.7L18.7 31.3L19.5 30.9L20 30.4L20.5 30L21.1 29.6L21.6 29.2L22.3 28.8L22.6 28.5L23.2 28.1L23.9 27.7L24.5 27.3L24.7 27L25.6 26.6L26 26.2L26.8 25.9L27.3 25.5L27.6 25.2L28.1 24.9L28.7 24.5L29 24.2L29.3 23.9L29.7 23.6L30.2 23.3L29.9 23L27.5 22.8L25.3 22.6L28.1 22.2L30.7 21.8L31.9 21.5L32.4 21.1L32.8 20.8L33 20.5L33.7 20.2L33.8 19.9L34.2 19.6L34.6 19.3L34.6 19L35 18.7L35.5 18.4L35.8 18.1L36 17.8L36.2 17.5L36.9 17.2L36.8 16.9L37.3 16.6L37.6 16.3L38 16L38.5 15.7L38.6 15.4L38.7 15.1L39.1 14.8L39.3 14.5L39.7 14.2L40 13.9L40.2 13.5L40.6 13.2L39.5 12.7L38.5 12.2L40.8 12.2L41.6 11.9L42.1 11.6L42.2 11.3L42.5 11L42.7 10.6L42.9 10.3L43.2 10L43.6 9.6L43.5 9.2L43.9 8.9L43.8 8.5L44.2 8.2L44.2 7.8L44.3 7.4L44.4 7L44.7 6.7L44.5 6.2L44.4 5.8L44 5.3L42.5 4.5L42.5 4.5L42.4 3.5L42 3.3L41.6 3.2L41.1 3.3L40.7 3.1L40.2 3.2L39.7 3.4L39.2 3.4L38.8 3.3L38.2 3.7L37.7 3.9L37.3 4L36.8 3.9L36.3 4.1L35.8 4.5L35.3 4.6L34.9 4.6L34.4 4.7L33.9 4.9L33.4 5.2L32.9 5.4L32.4 6L32 5.8L31.5 6.2L30.9 6.7L30.5 6.5L30 7.2L29.5 7.5L29.1 7.5L28.6 7.7L28.1 7.9L27.6 8.5L27 10.6L26.5 11.8L26.2 10.8L25.8 9.6L25.3 9.9L24.9 10L24.5 10.4L24 10.5L23.6 11.2L23.1 11.2L22.7 12L22.2 11.9L21.8 12.4L21.4 12.6L21 13.4L20.6 13.5L20.2 14.1L19.7 14.1L19.3 14.7L18.9 15.2L18.5 15.3L18.1 16L17.7 16.2L17.4 16.7L17 17L16.6 17.7L16.2 17.9L15.9 18.7L15.6 19.1L15.2 19.5L14.9 20.1L14.6 20.6L14.2 20.9L13.9 21.5L13.6 22.1L13.3 22.6L13 23.2L12.8 23.8L12.6 24.8L12.3 25.2L12.1 25.8L11.9 26.6L11.6 27L11.5 27.8L11.2 28L11.1 29.1L10.9 29.6L10.7 30.2L10.6 30.9L10.3 31.3L10.3 32.2L10.1 32.5L10 33.3L9.9 34L9.8 34.7L9.8 35.4L9.8 36.2L10.2 37.6Z","b":"M10.3 37.3Q10.7 37.9 11.7 36.9M10.3 37.3Q9.7 37.7 9.8 36.5M10.7 36.4Q11.9 36.8 13.5 35.6M10.7 36.4Q9.9 36.3 9.8 34.7M11.1 35.4Q12.8 35.7 14.9 34.4M11.1 35.4Q10.1 35 10 33.2M11.6 34.5Q13.7 34.7 16.2 33.4M11.6 34.5Q10.5 33.8 10.3 31.8M12 33.6Q14.6 33.7 17.5 32.3M12 33.6Q10.9 32.6 10.6 30.3M12.5 32.6Q15.5 32.7 18.7 31.4M12.5 32.6Q11.3 31.4 11 28.9M13 31.7Q16.4 31.8 20 30.4M13 31.7Q11.7 30.2 11.5 27.5M13.5 30.8Q17.3 30.9 21.2 29.5M13.5 30.8Q12.2 29 12 26.2M14.1 29.9Q18.2 29.9 22.5 28.6M14.1 29.9Q12.7 27.9 12.5 24.8M14.7 29Q19.2 29.1 23.8 27.7M14.7 29Q13.3 26.7 13.1 23.5M15.3 28.1Q20.1 28.2 25 26.9M15.3 28.1Q13.9 25.6 13.7 22.1M15.9 27.2Q21.1 27.3 26.3 26.1M15.9 27.2Q14.5 24.4 14.4 20.8M16.5 26.3Q22 26.5 27.6 25.3M16.5 26.3Q15.2 23.3 15.1 19.5M17.2 25.5Q22.8 25.7 28.5 24.6M17.2 25.5Q15.9 22.3 15.9 18.5M17.8 24.6Q23.5 25 29.1 24.1M17.8 24.6Q16.6 21.4 16.7 17.5M18.5 23.7Q24.2 24.2 29.9 23.3M18.5 23.7Q17.4 20.5 17.5 16.5M19.3 22.9Q24.8 23.4 30.4 22.7M19.3 22.9Q18.2 19.6 18.4 15.6M20 22Q25.8 22.5 31.6 21.6M20 22Q19 18.7 19.3 14.7M20.8 21.2Q26.7 21.7 32.7 20.9M20.8 21.2Q19.9 17.8 20.2 13.8M21.5 20.4Q27.4 21 33.3 20.4M21.5 20.4Q20.7 17 21.2 13M22.3 19.5Q28.1 20.3 34 19.7M22.3 19.5Q21.6 16.1 22.1 12.2M23.2 18.7Q28.9 19.5 34.8 19.1M23.2 18.7Q22.5 15.3 23.1 11.4M24 17.9Q29.7 18.8 35.5 18.4M24 17.9Q23.4 14.5 24.1 10.7M24.9 17.1Q30.5 18 36.2 17.7M24.9 17.1Q24.2 13.9 24.8 10.2M25.8 16.3Q31.2 17.3 36.9 17M25.8 16.3Q25.1 13.2 25.8 9.7M26.7 15.5Q32 16.5 37.6 16.3M26.7 15.5Q26.4 12.3 27.4 8.6M27.6 14.7Q32.8 15.8 38.3 15.6M27.6 14.7Q27.4 11.5 28.5 7.8M28.6 13.9Q33.6 15 39 15M28.6 13.9Q28.3 10.9 29.3 7.4M29.6 13.1Q34.4 14.3 39.6 14.3M29.6 13.1Q29.3 10.2 30.4 6.8M30.6 12.3Q35.1 13.7 40.1 13.7M30.6 12.3Q30.3 9.5 31.4 6.2M31.6 11.6Q35.7 12.9 40.5 13M31.6 11.6Q31.4 8.9 32.5 5.7M32.6 10.8Q36.9 11.9 41.7 11.9M32.6 10.8Q32.4 8.3 33.6 5.3M33.7 10.1Q37.6 11.3 42.1 11.4M33.7 10.1Q33.5 7.7 34.7 4.8M34.8 9.3Q38.4 10.5 42.7 10.6M34.8 9.3Q34.6 7.1 35.8 4.4M35.9 8.6Q39.1 9.8 43.2 9.8M35.9 8.6Q35.7 6.6 36.9 4M37 7.8Q39.9 9 43.7 9.1M37 7.8Q36.8 6.1 38 3.7M38.1 7.1Q40.6 8.2 44.1 8.3M38.1 7.1Q37.9 5.6 39.1 3.4M39.3 6.4Q41.3 7.4 44.4 7.4M39.3 6.4Q39 5.1 40.2 3.3M40.5 5.7Q41.9 6.6 44.5 6.5M40.5 5.7Q40.1 4.8 41.2 3.2M41.7 5Q42.3 5.7 44.2 5.5M41.7 5Q41.2 4.6 42.2 3.4","b2":"M10.5 36.9Q11.4 37.3 12.7 36.2M10.5 36.9Q9.8 37 9.8 35.6M10.9 35.9Q12.4 36.2 14.2 35M10.9 35.9Q10 35.7 9.9 34M11.3 35Q13.3 35.2 15.6 33.9M11.3 35Q10.3 34.4 10.2 32.5M11.8 34Q14.2 34.2 16.8 32.9M11.8 34Q10.7 33.2 10.5 31.1M12.3 33.1Q15.1 33.2 18.1 31.8M12.3 33.1Q11.1 32 10.8 29.6M12.8 32.2Q15.9 32.3 19.4 30.9M12.8 32.2Q11.5 30.8 11.2 28.2M13.3 31.3Q16.9 31.3 20.6 29.9M13.3 31.3Q12 29.6 11.7 26.9M13.8 30.4Q17.8 30.4 21.9 29M13.8 30.4Q12.5 28.5 12.2 25.5M14.4 29.5Q18.7 29.5 23.1 28.1M14.4 29.5Q13 27.3 12.8 24.1M15 28.6Q19.6 28.6 24.4 27.3M15 28.6Q13.6 26.1 13.4 22.8M15.6 27.7Q20.6 27.8 25.7 26.5M15.6 27.7Q14.2 25 14 21.5M16.2 26.8Q21.6 26.9 26.9 25.7M16.2 26.8Q14.8 23.9 14.7 20.2M16.8 25.9Q22.5 26.1 28.1 24.9M16.8 25.9Q15.5 22.8 15.5 19M17.5 25Q23.2 25.3 28.9 24.2M17.5 25Q16.3 21.9 16.3 18M18.2 24.2Q23.8 24.6 29.5 23.7M18.2 24.2Q17 20.9 17.1 17M18.9 23.3Q24.4 23.8 30 23M18.9 23.3Q17.8 20 18 16M19.6 22.5Q25.4 22.8 31.2 21.9M19.6 22.5Q18.6 19.1 18.8 15.1M20.4 21.6Q26.4 22.1 32.3 21.2M20.4 21.6Q19.4 18.2 19.8 14.3M21.1 20.8Q27 21.4 32.9 20.7M21.1 20.8Q20.3 17.4 20.7 13.4M21.9 19.9Q27.8 20.7 33.7 20.1M21.9 19.9Q21.2 16.5 21.6 12.6M22.8 19.1Q28.5 19.9 34.4 19.4M22.8 19.1Q22 15.7 22.6 11.8M23.6 18.3Q29.3 19.2 35.1 18.7M23.6 18.3Q22.9 14.9 23.6 11M24.5 17.5Q30.1 18.4 35.9 18M24.5 17.5Q23.9 14.2 24.6 10.3M25.3 16.7Q30.9 17.7 36.6 17.4M25.3 16.7Q24.7 13.5 25.3 9.8M26.2 15.9Q31.6 16.9 37.3 16.7M26.2 15.9Q25.6 12.9 26.3 9.3M27.2 15.1Q32.4 16.2 38 16M27.2 15.1Q26.9 11.9 28 8.3M28.1 14.3Q33.2 15.4 38.6 15.3M28.1 14.3Q27.9 11.1 29 7.5M29.1 13.5Q34 14.7 39.3 14.6M29.1 13.5Q28.8 10.5 29.8 7.1M30.1 12.7Q34.8 13.9 40 13.9M30.1 12.7Q29.8 9.9 30.9 6.5M31.1 12Q35.5 13.3 40.4 13.4M31.1 12Q30.8 9.2 32 6M32.1 11.2Q36.3 12.3 41.1 12.2M32.1 11.2Q31.9 8.6 33.1 5.5M33.1 10.4Q37.3 11.6 42 11.5M33.1 10.4Q33 8 34.2 5M34.2 9.7Q38 10.9 42.4 11M34.2 9.7Q34 7.4 35.3 4.6M35.3 8.9Q38.8 10.2 42.9 10.2M35.3 8.9Q35.1 6.8 36.4 4.2M36.4 8.2Q39.5 9.4 43.4 9.5M36.4 8.2Q36.2 6.3 37.5 3.9M37.6 7.5Q40.3 8.6 43.9 8.7M37.6 7.5Q37.3 5.8 38.6 3.6M38.7 6.7Q41 7.8 44.2 7.8M38.7 6.7Q38.5 5.3 39.6 3.3M39.9 6Q41.6 7 44.5 7M39.9 6Q39.6 4.9 40.7 3.2M41.1 5.3Q42.2 6.2 44.4 6M41.1 5.3Q40.7 4.6 41.7 3.3","bs":"M10.3 37.3Q10.9 37.6 11.7 36.9M12 33.7Q14.7 33.4 17.3 32.4M12 33.7Q11 32.4 10.6 30.5M14 30.1Q18.3 29.8 22.2 28.8M14 30.1Q12.8 27.8 12.4 25.1M16.3 26.6Q22 26.4 27.2 25.5M16.3 26.6Q15.2 23.3 14.9 19.9M19 23.2Q24.7 23.5 30.1 22.9M19 23.2Q18.1 19.6 18 16M21.9 19.9Q28 20.4 33.7 20.1M21.9 19.9Q21.4 16.3 21.6 12.6M25.2 16.8Q31.1 17.5 36.5 17.4M25.2 16.8Q24.9 13.3 25.2 9.9M28.9 13.7Q34.2 14.6 39.2 14.7M28.9 13.7Q28.9 10.4 29.6 7.2M32.8 10.7Q37.4 11.6 41.8 11.7M32.8 10.7Q33 7.9 33.8 5.2M37.1 7.8Q40.3 8.7 43.7 9M37.1 7.8Q37.2 5.8 38.1 3.7M41.7 5Q42.7 5.5 44.2 5.5M11.1 35.5Q12.9 35.4 14.8 34.5M11.1 35.5Q10.3 34.7 10 33.3M12.9 31.9Q16.5 31.6 19.8 30.5M12.9 31.9Q11.8 30 11.4 27.8M15.1 28.3Q20.1 28.1 24.7 27.1M15.1 28.3Q14 25.5 13.5 22.5M17.6 24.9Q23.6 24.9 29 24.1M17.6 24.9Q16.6 21.4 16.4 17.8M20.4 21.6Q26.7 21.7 32.4 21.2M20.4 21.6Q19.7 17.9 19.8 14.2M23.6 18.3Q29.5 18.9 35.1 18.7M23.6 18.3Q23.2 14.7 23.5 11.1M27 15.2Q32.6 16 37.9 16.1M27 15.2Q27.1 11.8 27.8 8.4M30.8 12.2Q35.6 13.2 40.3 13.6M30.8 12.2Q30.9 9.1 31.7 6.1M34.9 9.2Q38.8 10.2 42.8 10.5M34.9 9.2Q35.1 6.8 36 4.3M39.4 6.4Q41.7 7.2 44.4 7.4M39.4 6.4Q39.4 4.9 40.2 3.3","d":"M8.6 42.2c1.1 0.9 1.1 2.6 1.8 3.6M8.6 42.2c-1.7 -0.6 -3.3 1.1 -4.5 1.1M8.7 41.8c0.3 1.8 2.4 2.8 2.6 4.4M8.7 41.8c-1.2 0.8 -2.8 -0.2 -3.7 0.6M8.9 41.3c0.5 1.4 2.1 2.2 2.5 3.5M8.9 41.3c-0.6 1.1 -2.1 1.2 -2.6 2.3M9 40.9c0.5 1 1.6 1.6 2 2.7M9 40.9c-1.2 0.4 -2.5 0.8 -3.3 1.4M9.1 40.5c0.1 1.3 1.4 2.3 1.5 3.5M9.1 40.5c-1 -0.2 -2.1 -0.1 -2.8 0.1M9.3 40.1c1.4 0.7 2.4 2.3 3.4 3.2M9.3 40.1c-1.3 0.2 -2.8 0.1 -3.7 0.6M9.4 39.7c1 1.4 3 1.7 3.8 3M9.4 39.7c-1.4 0.6 -2.6 2 -3.6 2.8M9.5 39.3c-0.2 1 0.8 1.9 0.7 2.9M9.5 39.3c-1.5 -0.2 -2.6 1.4 -3.7 1.6M9.7 38.9c1.3 0 1.6 1.6 2.5 2M9.7 38.9c-0.8 0.8 -1.6 -0.6 -2.2 0.2M9.8 38.5c1.4 1.3 1.6 3.5 2.5 4.7M9.8 38.5c-0.9 -0.4 -1.9 0.1 -2.5 0.2M10 38.1c0.3 1.6 2.4 1.6 2.7 3M10 38.1c-1.4 -0.3 -2.7 0.8 -3.7 1","q":"M5.7 46.9Q7.6 44.7 8.7 41.7","s":"M9 43.3L9.4 41.8L9.9 40.3L10.4 38.9L10.9 37.4L11.5 36L12.1 34.6L12.8 33.2L13.6 31.8L14.4 30.4L15.2 29L16.1 27.7L17.1 26.3L18.1 25L19.1 23.7L20.2 22.4L21.3 21.1L22.5 19.9L23.8 18.6L25.1 17.4L26.4 16.1L27.8 14.9L29.2 13.7L30.7 12.5L32.3 11.3L33.9 10.2L35.5 9L37.2 7.9L38.9 6.8L40.7 5.7L42.6 4.6L42.4 4.4L40.6 5.5L38.8 6.5L37 7.6L35.3 8.7L33.6 9.8L32 11L30.4 12.1L28.9 13.3L27.4 14.5L26 15.7L24.6 16.9L23.3 18.1L22 19.4L20.8 20.6L19.6 21.9L18.5 23.2L17.4 24.5L16.3 25.8L15.4 27.1L14.4 28.5L13.5 29.9L12.7 31.3L11.9 32.7L11.1 34.1L10.4 35.5L9.8 37L9.2 38.4L8.6 39.9L8.1 41.4L7.7 42.9Z","sh":"M9 41.8L12.4 33.3L17.9 24.9L25.2 17.1L34.5 9.8"};
      function ensureFeatherDefs() {
          if (document.getElementById("owl-fdefs")) return;
          const g = FEATHER_GEO, grad = Object.entries(FEATHER_COLORS).map(([k, [, d, b, l, h]]) =>
              `<linearGradient id="owl-fg-${k}" gradientUnits="userSpaceOnUse" x1="14" y1="12" x2="33" y2="30"><stop offset="0" stop-color="${b}"/><stop offset=".22" stop-color="${l}"/><stop offset=".38" stop-color="${h}"/><stop offset=".5" stop-color="${l}"/><stop offset=".72" stop-color="${b}"/><stop offset="1" stop-color="${d}"/></linearGradient>`
              + `<linearGradient id="owl-fs-${k}" gradientUnits="userSpaceOnUse" x1="8" y1="44" x2="42" y2="5"><stop offset="0" stop-color="${l}"/><stop offset=".5" stop-color="${h}"/><stop offset="1" stop-color="${l}"/></linearGradient>`).join("");
          document.body.insertAdjacentHTML("beforeend", `<svg id="owl-fdefs" width="0" height="0" style="position:absolute" aria-hidden="true"><defs>`
              + `<path id="owl-fv" d="${g.v}"/><path id="owl-fb" d="${g.b}"/><path id="owl-fb2" d="${g.b2}"/><path id="owl-fbs" d="${g.bs}"/><path id="owl-fd" d="${g.d}"/><path id="owl-fq" d="${g.q}"/><path id="owl-fst" d="${g.s}"/><path id="owl-fsth" d="${g.sh}"/>`
              + `<clipPath id="owl-fclip"><use href="#owl-fv"/></clipPath>`
              + `<linearGradient id="owl-fshine" gradientUnits="userSpaceOnUse" x1="7" y1="45" x2="42" y2="5"><stop offset=".4" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".85"/><stop offset=".6" stop-color="#fff" stop-opacity="0"/></linearGradient>`
              + `<linearGradient id="owl-fshade" gradientUnits="userSpaceOnUse" x1="8" y1="44" x2="40" y2="6"><stop offset="0" stop-color="#000" stop-opacity=".38"/><stop offset=".45" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#fff" stop-opacity=".22"/></linearGradient>`
              + grad + `</defs></svg>`);
      }
      const isFeatherColor = (k) => typeof k === "string" && Object.prototype.hasOwnProperty.call(FEATHER_COLORS, k); // не «constructor» и прочее из прототипа
      const featherColorOf = (u) => u && isFeatherColor(u.featherColor) ? u.featherColor : "gold";
      // size ≤ 20 — упрощённое перо (крупные бородки, без пушка); anim — покачивание, блик и искорка
      function featherSVG(size, color = "gold", anim = false) {
          ensureFeatherDefs();
          if (!isFeatherColor(color)) color = "gold";
          const small = size <= 20, [, d, , l, h] = FEATHER_COLORS[color];
          return `<svg class="owl-feather${anim ? " anim" : ""}" viewBox="0 0 48 48" width="${size}" height="${size}" aria-hidden="true"><g class="fw">`
              + (small ? "" : `<use href="#owl-fd" fill="none" stroke="${h}" stroke-opacity=".45" stroke-width=".3" stroke-linecap="round"/>`)
              + `<use href="#owl-fq" fill="none" stroke="${h}" stroke-opacity=".85" stroke-width="${small ? 2 : 1.6}" stroke-linecap="round"/>`
              + `<use href="#owl-fv" fill="url(#owl-fg-${color})"/><use href="#owl-fv" fill="url(#owl-fshade)"/>`
              + `<use href="#owl-fst" fill="none" stroke="${d}" stroke-opacity=".22" stroke-width="${small ? 2.4 : 1.8}" clip-path="url(#owl-fclip)"/>`
              + (small ? `<use href="#owl-fbs" fill="none" stroke="${d}" stroke-opacity=".3" stroke-width=".6" clip-path="url(#owl-fclip)"/>`
                  : `<use href="#owl-fb" fill="none" stroke="${d}" stroke-opacity=".34" stroke-width=".2" clip-path="url(#owl-fclip)"/><use href="#owl-fb2" fill="none" stroke="${d}" stroke-opacity=".2" stroke-width=".18" clip-path="url(#owl-fclip)"/><use href="#owl-fb" fill="none" stroke="${h}" stroke-opacity=".3" stroke-width=".13" transform="translate(.18 -.16)" clip-path="url(#owl-fclip)"/>`)
              + `<use href="#owl-fv" fill="none" stroke="${d}" stroke-opacity=".22" stroke-width="${small ? .5 : .25}"/>`
              + (anim ? `<g clip-path="url(#owl-fclip)"><rect class="fsh" x="-40" y="-40" width="128" height="128" fill="url(#owl-fshine)"/></g>` : "")
              + `<use href="#owl-fst" fill="url(#owl-fs-${color})" stroke="${d}" stroke-opacity=".4" stroke-width=".2"/>`
              + (small ? "" : `<use href="#owl-fsth" fill="none" stroke="#fff" stroke-opacity=".7" stroke-width=".25" stroke-linecap="round"/>`)
              + `</g>` + (anim && !small ? `<path class="fsp" d="M42.5 1.2999999999999998L43.2 3.8L45.7 4.5L43.2 5.2L42.5 7.7L41.8 5.2L39.3 4.5L41.8 3.8Z" fill="#fff"/>` : "") + `</svg>`;
      }
      const isPremium = (uid) => usersCache[uid]?.premium === true;
      // Перо у имени. data-premium-uid — чтобы показать или перекрасить без перерисовки, когда профиль подгрузится позже
      function premiumBadge(uid, size = 14, anim = false) {
          if (!uid) return "";
          const on = isPremium(uid), c = featherColorOf(usersCache[uid]);
          return `<span class="premium-badge" data-premium-uid="${escapeHTML(uid)}" data-psize="${size}"${anim ? ' data-panim="1"' : ""}${on ? ` data-pc="${c}"` : ""} title="${t("Премиум")}" style="${on ? "" : "display:none;"}">${on ? featherSVG(size, c, anim) : ""}</span>`;
      }
      function syncPremiumBadges(uid) {
          document.querySelectorAll(uid ? `[data-premium-uid="${CSS.escape(uid)}"]` : "[data-premium-uid]").forEach(el => {
              const id = el.getAttribute("data-premium-uid"), c = featherColorOf(usersCache[id]);
              if (!isPremium(id)) { el.style.display = "none"; el.innerHTML = ""; el.removeAttribute("data-pc"); return; }
              if (el.getAttribute("data-pc") !== c || !el.firstChild) { el.innerHTML = featherSVG(+el.getAttribute("data-psize") || 14, c, el.hasAttribute("data-panim")); el.setAttribute("data-pc", c); }
              el.style.display = "";
          });
      }

      // Настройки → «Премиум»: выбор цвета пера (видно только с премиумом). Названия цветов — в FEATHER_COLORS[k][0]
      function renderPremiumSettings() {
          const me = currentUser && usersCache[currentUser.uid], box = document.getElementById("st-premium");
          if (!me || !isPremium(currentUser.uid)) { box.style.display = "none"; return; }
          box.style.display = "";
          const cur = featherColorOf(me);
          document.getElementById("st-feathers").innerHTML = Object.entries(FEATHER_COLORS).map(([k, [name]]) =>
              `<button type="button" data-feather="${k}" class="${k === cur ? "on" : ""}" aria-pressed="${k === cur}">${featherSVG(34, k, k === cur)}<span>${escapeHTML(t(name))}</span></button>`).join("");
      }
      document.getElementById("st-feathers").addEventListener("click", async (e) => {
          const b = e.target.closest("[data-feather]"); if (!b || !currentUser || !isPremium(currentUser.uid)) return;
          const k = b.getAttribute("data-feather"), me = usersCache[currentUser.uid];
          if (!isFeatherColor(k) || featherColorOf(me) === k) return;
          const was = me.featherColor; me.featherColor = k; renderPremiumSettings(); syncPremiumBadges(currentUser.uid);
          try { await updateDoc(doc(db, "users", currentUser.uid), { featherColor: k }); }
          catch (err) { console.log("Цвет пера:", err.code); me.featherColor = was; renderPremiumSettings(); syncPremiumBadges(currentUser.uid); showToast(t("Не удалось сохранить"), "error"); }
      });

      // Что даёт премиум — список для окна. Видеозвонки добавятся сюда, когда выйдут
      const PALETTE_ICON = '<svg viewBox="0 0 24 24" width="22" height="22"><circle cx="8" cy="9" r="3.2" fill="#f5c63c"/><circle cx="15.5" cy="7.5" r="3.2" fill="#6fa0ff"/><circle cx="17" cy="15" r="3.2" fill="#ff5574"/><circle cx="9.5" cy="16" r="3.2" fill="#3fe0a2"/></svg>';
      function premiumPerks(c) {
          return [
              [featherSVG(26, c), t("Перо у имени"), t("Его видят все: в переписках, в беседах и в профиле")],
              [PALETTE_ICON, t("9 цветов пера"), t("Золото, сапфир, пламя, лёд и другие — меняйте когда угодно")],
              [CALL_SVG.cam.replace(/width="28" height="28"/, 'width="22" height="22"'), t("Видео в звонках"), t("Включайте камеру прямо во время звонка — даже если у собеседника нет премиума")],
              [CALL_SVG.screen.replace(/width="28" height="28"/, 'width="22" height="22"'), t("Показ экрана"), t("С компьютера — прямо во время звонка")],
          ];
      }
      // welcome — «Добро пожаловать» (себе, после выдачи); иначе — рассказ о премиуме по нажатию на перо (uid — чьё перо)
      function showPremiumWelcome(welcome, uid) {
          if (!currentUser) return;
          const who = uid || currentUser.uid, c = featherColorOf(usersCache[who]), mine = who === currentUser.uid;
          const hero = document.getElementById("prem-hero");
          hero.innerHTML = featherSVG(124, c, true) + "<i></i><i></i><i></i><i></i>";
          hero.style.setProperty("--pg", FEATHER_COLORS[c][3]);
          document.getElementById("prem-title").textContent = welcome ? t("Добро пожаловать в Премиум") : t("Премиум Owl");
          document.getElementById("prem-sub").textContent = welcome ? t("Спасибо, что вы с Owl! Вот что теперь доступно:")
              : mine ? t("У вас премиум. Вот что он даёт:") : t("Перо у имени — знак премиума Owl. Вот что он даёт:");
          document.getElementById("prem-list").innerHTML = premiumPerks(c).map(([ic, title, sub]) => `<li><div class="ic">${ic}</div><div><b>${escapeHTML(title)}</b><span>${escapeHTML(sub)}</span></div></li>`).join("");
          document.getElementById("prem-color-btn").style.display = mine && isPremium(currentUser.uid) ? "" : "none";
          document.getElementById("premium-screen").style.display = "flex";
          startPremSpin(hero);
      }
      // Перо в окне премиума крутится само (≈70°/с) и пальцем: потянул — повернул, бросил — крутится по инерции и плавно
      // возвращается к обычной скорости (в ту же сторону). Без лишнего движения (упрощённый режим) — только пальцем
      let premSpin = null;
      function startPremSpin(hero) {
          if (premSpin) premSpin.stop();
          const svg = hero.querySelector(".owl-feather"), scr = document.getElementById("premium-screen"), calm = reduceMotion(), BASE = calm ? 0 : 70;
          let ay = 0, ax = 0, v = BASE, drag = null, raf = 0, last = performance.now();
          const t0 = last;
          const frame = (now) => {
              if (scr.style.display === "none" || !svg.isConnected) return stop();
              const dt = Math.min(.05, (now - last) / 1000); last = now;
              if (!drag) { ay += v * dt; v += ((v < 0 ? -BASE : BASE) - v) * Math.min(1, dt * 1.4); ax *= Math.pow(.05, dt); }
              const fl = calm ? 0 : Math.sin((now - t0) / 650) * 5;
              svg.style.transform = `translateY(${fl.toFixed(1)}px) rotateX(${ax.toFixed(1)}deg) rotateY(${(ay % 360).toFixed(1)}deg)`;
              raf = requestAnimationFrame(frame);
          };
          const down = (e) => { drag = { x: e.clientX, y: e.clientY, t: e.timeStamp }; v = 0; hero.classList.add("grab"); try { hero.setPointerCapture(e.pointerId); } catch (_) {} };
          const move = (e) => {
              if (!drag) return;
              const dx = e.clientX - drag.x, dy = e.clientY - drag.y, dt = Math.max(8, e.timeStamp - drag.t) / 1000;
              ay += dx * .9; ax = Math.max(-35, Math.min(35, ax - dy * .5));
              v = v * .4 + (dx * .9 / dt) * .6;
              drag = { x: e.clientX, y: e.clientY, t: e.timeStamp };
          };
          const up = (e) => {
              if (!drag) return;
              if (e.timeStamp - drag.t > 90) v = 0; // задержал палец перед отпусканием — без броска
              drag = null; hero.classList.remove("grab");
              v = Math.max(-1400, Math.min(1400, v));
          };
          const evs = [["pointerdown", down], ["pointermove", move], ["pointerup", up], ["pointercancel", up]];
          evs.forEach(([n, f]) => hero.addEventListener(n, f));
          const stop = () => { cancelAnimationFrame(raf); evs.forEach(([n, f]) => hero.removeEventListener(n, f)); if (premSpin && premSpin.stop === stop) premSpin = null; };
          premSpin = { stop };
          raf = requestAnimationFrame(frame);
      }
      // Окно «Добро пожаловать» — один раз на устройстве; сняли премиум — отметку стираем (выдадут снова — покажем снова)
      function checkPremiumWelcome() {
          if (!currentUser) return;
          const k = "owl-prem-hi-" + currentUser.uid;
          try {
              if (!isPremium(currentUser.uid)) { localStorage.removeItem(k); return; }
              if (localStorage.getItem(k)) return;
              localStorage.setItem(k, "1");
          } catch (_) { return; }
          setTimeout(() => showPremiumWelcome(true), 700);
      }
      document.getElementById("prem-color-btn").addEventListener("click", () => {
          document.getElementById("premium-screen").style.display = "none";
          document.getElementById("open-settings-btn").click(); // как обычное открытие настроек (поля заполняются там)
          setTimeout(() => document.getElementById("st-premium").scrollIntoView({ behavior: reduceMotion() ? "auto" : "smooth", block: "center" }), 250);
      });
      ["public-premium-badge", "settings-premium-badge"].forEach(id => document.getElementById(id).addEventListener("click", (e) => {
          e.stopPropagation(); showPremiumWelcome(false, e.currentTarget.getAttribute("data-premium-uid"));
      }));

      // Выдать или снять премиум — только админ (правила разрешают поле premium только ему)
      async function togglePremium(uid, btn) {
          if (!isAdmin || !uid) return;
          const name = usersCache[uid]?.name || "пользователя", on = isPremium(uid);
          if (on && !confirm(`Снять премиум у ${name}?`)) return;
          btn.disabled = true;
          try {
              await updateDoc(doc(db, "users", uid), on ? { premium: deleteField(), featherColor: deleteField() } : { premium: true });
              if (usersCache[uid]) { usersCache[uid].premium = !on || undefined; if (on) delete usersCache[uid].featherColor; }
              syncPremiumBadges(uid); renderDevPanel();
              showToast(on ? `Премиум снят: ${name}` : `${name} получил(а) премиум`, "check");
          } catch (e) {
              console.error(e);
              showToast(e.code === "permission-denied" ? "Нет прав (нужен вход с кодом)" : "Ошибка: " + e.message, "error");
          }
          btn.disabled = false;
      }

      // ===== БАНЫ =====
      // bans/{uid} = { uid, bannedAt } — только факт бана, его читают все (для мёртвой совы и надписи).
      // ban_reasons/{uid} = { reason, name, email, bannedBy, bannedAt } — причина, читает и пишет только админ.
      // Профиль пользователь может менять сам, поэтому бан хранится не в нём (см. правила Firestore).
      let bansCache = {};          // все баны (uid → { uid, bannedAt })
      let banReasons = {};         // только у админа: uid → причина и подробности
      let appeals = {};            // только у админа: uid → обращение в поддержку
      let reportsCache = {}, reportsListener = null, reportsFirstSnap = true; // только у админа: жалобы
      let bansListener = null, myBanListener = null, reasonsListener = null, iAmBanned = false;
      let myReasonListener = null, myAppealListener = null, appealsListener = null, appealsFirstSnap = true, myDeletedListener = null;
      const isBanned = (uid) => !!bansCache[uid];
      function startBanListeners() {
          stopBanListeners(false);
          if (!currentUser) return;
          // Аккаунт удалили, пока человек в приложении
          myDeletedListener = onSnapshot(doc(db, "deleted_accounts", currentUser.uid), (snap) => { if (snap.exists() && !isAdmin) showDeletedScreen(); }, () => {});
          // Свой бан — слушаем всегда, чтобы заблокировать сразу, даже посреди переписки
          myBanListener = onSnapshot(doc(db, "bans", currentUser.uid), (snap) => {
              const wasBanned = iAmBanned;
              iAmBanned = snap.exists() && !isAdmin;
              const scr = document.getElementById("banned-screen");
              if (iAmBanned) {
                  scr.style.display = "flex";
                  stopPresence();
                  if (activeListener) { activeListener(); activeListener = null; }
                  if (!myReasonListener) myReasonListener = onSnapshot(doc(db, "ban_reasons", currentUser.uid), (r) => {
                      const why = r.exists() ? (r.data().reason || "") : "";
                      document.getElementById("banned-reason").style.display = why ? "block" : "none";
                      document.getElementById("banned-reason-text").innerText = why;
                  }, (e) => console.log("ban_reasons (своя):", e.code));
                  if (!myAppealListener) myAppealListener = onSnapshot(doc(db, "appeals", currentUser.uid), (a) => {
                      const st = document.getElementById("appeal-status");
                      if (a.exists()) {
                          const d = a.data(); st.className = "ok";
                          st.innerText = t("Обращение отправлено {date}. Администратор рассмотрит его. Можно дополнить и отправить снова.", { date: formatRegDate(getTime(d.updatedAt)) });
                          const ta = document.getElementById("appeal-text"); if (!ta.value) ta.value = d.text || "";
                      } else { st.className = ""; st.innerText = ""; }
                  }, (e) => console.log("appeals (своё):", e.code));
              } else if (wasBanned) {
                  scr.style.display = "none"; location.reload(); // разбанили — перезапускаем приложение начисто
              }
          }, (e) => console.log("bans:", e.code));
          // Все баны — чтобы всем показывать мёртвую сову и «Пользователь заблокирован»
          verifiedListener = onSnapshot(collection(db, "verified"), (snap) => {
              verifiedCache = {}; snap.forEach(d => { verifiedCache[d.id] = d.data(); });
              syncVerifiedBadges(); renderChatList(document.getElementById("search-input").value); renderDevPanel();
          }, (e) => console.log("verified:", e.code));
          bansListener = onSnapshot(collection(db, "bans"), (snap) => {
              const changed = new Set(Object.keys(bansCache));
              bansCache = {}; snap.forEach(d => { bansCache[d.id] = d.data(); changed.add(d.id); });
              if (isAdmin) migrateOldBanReasons(snap);
              // Обновляем аватарки, уже нарисованные в переписке и профиле
              changed.forEach(uid => document.querySelectorAll(`img[data-profile-target="${CSS.escape(uid)}"]`).forEach(img => { img.src = getAvatar(uid, usersCache[uid]?.name); }));
              const pub = document.getElementById("public-profile-screen");
              if (pub && pub.style.display === "flex") { const fb = document.getElementById("public-follow-btn").getAttribute("data-action-uid"); if (fb && changed.has(fb)) openPublicProfile(fb); }
              renderChatList(document.getElementById("search-input").value);
              refreshHeaderStatus(); renderDevPanel();
          }, (e) => console.log("bans:", e.code));
          if (isAdmin) {
              appealsFirstSnap = true;
              appealsListener = onSnapshot(collection(db, "appeals"), (snap) => {
                  if (!appealsFirstSnap) snap.docChanges().forEach(ch => { if (ch.type !== "removed") { const d = ch.doc.data(); showToast(`Обращение по бану от ${d.name || "пользователя"}`, "mail"); } });
                  appealsFirstSnap = false;
                  appeals = {}; snap.forEach(d => { appeals[d.id] = d.data(); });
                  renderDevPanel();
              }, (e) => console.log("appeals:", e.code));
              reportsFirstSnap = true;
              reportsListener = onSnapshot(collection(db, "reports"), (snap) => {
                  if (!reportsFirstSnap) snap.docChanges().forEach(ch => { if (ch.type === "added") { const d = ch.doc.data(); showToast(`Жалоба на ${d.targetName || "пользователя"}: ${d.reason}`, "flag"); } });
                  reportsFirstSnap = false;
                  reportsCache = {}; snap.forEach(d => { reportsCache[d.id] = d.data(); });
                  renderDevPanel();
              }, (e) => console.log("reports:", e.code));
              reasonsListener = onSnapshot(collection(db, "ban_reasons"), (snap) => {
                  banReasons = {}; snap.forEach(d => { banReasons[d.id] = d.data(); });
                  renderDevPanel();
              }, (e) => console.log("ban_reasons:", e.code));
          }
      }
      function stopBanListeners(resetState = true) {
          if (bansListener) { bansListener(); bansListener = null; }
          if (myBanListener) { myBanListener(); myBanListener = null; }
          if (reasonsListener) { reasonsListener(); reasonsListener = null; }
          if (verifiedListener) { verifiedListener(); verifiedListener = null; }
          if (myReasonListener) { myReasonListener(); myReasonListener = null; }
          if (myAppealListener) { myAppealListener(); myAppealListener = null; }
          if (appealsListener) { appealsListener(); appealsListener = null; }
          if (reportsListener) { reportsListener(); reportsListener = null; }
          if (myDeletedListener) { myDeletedListener(); myDeletedListener = null; }
          if (!resetState) return;
          bansCache = {}; banReasons = {}; appeals = {}; reportsCache = {}; iAmBanned = false;
          document.getElementById("banned-screen").style.display = "none";
      }
      // Старые баны хранили причину прямо в публичной записи — переносим её в ban_reasons и вычищаем
      const migratedBans = new Set();
      function migrateOldBanReasons(snap) {
          snap.forEach(d => {
              const b = d.data();
              if (migratedBans.has(d.id) || !("reason" in b || "name" in b || "email" in b || "bannedBy" in b)) return;
              migratedBans.add(d.id);
              const batch = writeBatch(db);
              batch.set(doc(db, "ban_reasons", d.id), { uid: d.id, reason: b.reason || "", name: b.name || "", email: b.email || "", bannedBy: b.bannedBy || "", bannedAt: b.bannedAt || new Date() }, { merge: true });
              batch.update(d.ref, { reason: deleteField(), name: deleteField(), email: deleteField(), bannedBy: deleteField() });
              batch.commit().catch(e => { migratedBans.delete(d.id); console.log("Перенос причины бана:", e.code); });
          });
      }
      document.getElementById("banned-logout-btn").addEventListener("click", () => logoutEverywhere(false));
      document.getElementById("appeal-send-btn").addEventListener("click", async () => {
          if (!currentUser || !iAmBanned) return;
          const ta = document.getElementById("appeal-text"), btn = document.getElementById("appeal-send-btn"), st = document.getElementById("appeal-status");
          const text = ta.value.trim().slice(0, 1000);
          if (text.length < 5) { st.className = ""; st.innerText = t("Опишите ситуацию хотя бы парой слов."); return; }
          btn.disabled = true;
          try {
              const me = usersCache[currentUser.uid] || {};
              await setDoc(doc(db, "appeals", currentUser.uid), { uid: currentUser.uid, name: me.name || currentUser.displayName || "", email: currentUser.email || "", text: text, updatedAt: new Date() });
          } catch (e) {
              console.error(e); st.className = ""; st.innerText = t("Не удалось отправить обращение. Попробуйте ещё раз чуть позже.");
          }
          btn.disabled = false;
      });

      // ===== УДАЛЕНИЕ АККАУНТА (разработчик) =====
      // Учётную запись входа (email+пароль) из браузера удалить нельзя — это умеет только сервер (Cloud Functions).
      // Поэтому: стираем все данные и ставим метку deleted_accounts/{uid}, по которой вход навсегда блокируется.
      function showDeletedScreen() {
          stopPresence(false);
          document.getElementById("global-loader").style.display = "none";
          document.getElementById("deleted-screen").style.display = "flex";
      }
      document.getElementById("deleted-ok-btn").addEventListener("click", () => {
          document.getElementById("deleted-screen").style.display = "none";
          signOut(auth);
      });
      async function deleteRefsInChunks(refs) {
          for (let i = 0; i < refs.length; i += 400) {
              const batch = writeBatch(db);
              refs.slice(i, i + 400).forEach(r => batch.delete(r));
              await batch.commit();
          }
      }
      async function deleteUserAccount(uid, btn) {
          if (!isAdmin || !uid || uid === currentUser.uid) return;
          const u = usersCache[uid] || {}; const name = u.name || "";
          if (u.email === ADMIN_EMAIL) return showToast("Нельзя удалить администратора", "alert");
          const typed = prompt(`Удалить аккаунт «${name}» навсегда?\n\nБудут удалены профиль, ник, личные чаты и уведомления, а войти в аккаунт будет нельзя. Отменить это невозможно.\n\nДля подтверждения введите ник пользователя:`, "");
          if (typed === null) return;
          if (nickKey(typed) !== nickKey(name)) return showToast("Ник введён неверно — аккаунт не удалён", "alert");
          const wipeMessages = confirm(`Удалить также ВСЕ сообщения «${name}» — в личных чатах, беседах и глобальном чате?\n\nОК — удалить сообщения\nОтмена — оставить их`);

          btn.disabled = true; showToast(`Удаляем аккаунт «${name}»...`, "trash");
          const failed = [];
          const step = async (label, fn) => { try { await fn(); } catch (e) { console.error("Удаление аккаунта, шаг «" + label + "»:", e); failed.push(label); } };

          // 1. Сначала блокируем вход — даже если дальше что-то не удалится, пользователь уже не войдёт
          await step("блокировка входа", () => setDoc(doc(db, "deleted_accounts", uid), { uid: uid, name: name, email: emailOf(u), deletedBy: currentUser.uid, deletedAt: new Date() }));
          if (failed.length) { btn.disabled = false; return showToast("Нет прав на удаление — добавьте правила Firestore (deleted_accounts)", "error"); }
          // Вход в Firebase отключает сервер (у него ключ сервисного аккаунта): удалённый не войдёт даже в обход приложения, а его сеансы закроются
          await step("отключение входа", async () => { const r = await pushPost("/admin/disable", { uid }); if (!r.ok) throw new Error("HTTP " + r.status); });

          if (wipeMessages) await step("сообщения", async () => {
              const snap = await getDocs(query(collection(db, "messages"), where("uid", "==", uid)));
              await deleteRefsInChunks(snap.docs.map(d => d.ref));
          });
          await step("личные чаты", async () => {
              const snap = await getDocs(query(collection(db, "chats_metadata"), where("members", "array-contains", uid)));
              await deleteRefsInChunks(snap.docs.map(d => d.ref));
          });
          await step("уведомления", async () => {
              const snap = await getDocs(query(collection(db, "notifications"), where("toUid", "==", uid)));
              await deleteRefsInChunks(snap.docs.map(d => d.ref));
          });
          await step("беседы", async () => {
              const snap = await getDocs(query(collection(db, "groups"), where("members", "array-contains", uid)));
              await Promise.all(snap.docs.map(d => updateDoc(d.ref, { members: arrayRemove(uid) })));
          });
          await step("ник", async () => {
              const key = u.nameKey || nickKey(name); if (!key) return;
              const ref = doc(db, "usernames", key); const snap = await getDoc(ref);
              if (snap.exists() && snap.data().uid === uid) await deleteDoc(ref);
          });
          await step("подписки", () => deleteFollowEdges(uid));
          await step("бан и обращения", () => deleteRefsInChunks(["bans", "ban_reasons", "appeals", "verified", "users_private"].map(c => doc(db, c, uid))));
          await step("профиль", () => deleteDoc(doc(db, "users", uid)));
          delete usersCache[uid];

          btn.disabled = false;
          renderDevPanel(); renderChatList(document.getElementById("search-input").value);
          if (failed.length) showToast(`Аккаунт заблокирован, но удалено не всё: ${failed.join(", ")}. Проверьте правила Firestore.`, "alert");
          else showToast(`Аккаунт «${name}» удалён`, "trash");
      }

      async function toggleBan(uid, btn) {
          if (!isAdmin || !uid || uid === currentUser.uid) return;
          const u = usersCache[uid] || {}; const name = u.name || "пользователя";
          if (u.email === ADMIN_EMAIL) return showToast("Нельзя забанить администратора", "alert");
          btn.disabled = true;
          try {
              if (isBanned(uid)) {
                  if (!confirm(`Разбанить ${name}?`)) { btn.disabled = false; return; }
                  const batch = writeBatch(db);
                  batch.delete(doc(db, "bans", uid)); batch.delete(doc(db, "ban_reasons", uid)); batch.delete(doc(db, "appeals", uid));
                  await batch.commit();
                  showToast(`${name} разбанен(а)`, "check");
              } else {
                  const reason = prompt(`Забанить ${name}?\n\nПользователь сразу потеряет доступ к приложению.\nПричина (необязательно, её увидит пользователь и разработчики):`, "");
                  if (reason === null) { btn.disabled = false; return; } // «Отмена»
                  const now = new Date(); const batch = writeBatch(db);
                  batch.set(doc(db, "bans", uid), { uid: uid, bannedAt: now }); // публично — только факт бана
                  batch.set(doc(db, "ban_reasons", uid), { uid: uid, reason: reason.trim().slice(0, 300), name: u.name || "", email: emailOf(u), bannedBy: currentUser.uid, bannedAt: now });
                  await batch.commit();
                  showToast(`${name} забанен(а)`, "shield");
              }
          } catch (e) {
              console.error(e);
              showToast(e.code === "permission-denied" ? "Нет прав — добавьте правила для коллекций bans и ban_reasons в Firestore" : "Ошибка: " + e.message, "error");
          }
          btn.disabled = false;
      }

      // ===== ПАНЕЛЬ РАЗРАБОТЧИКА =====
      const DAY_MS = 24 * 60 * 60 * 1000;
      let devFilter = "online";
      const createdAtOf = (u) => u && u.createdAt ? getTime(u.createdAt) : 0;
      function formatRegDate(ts) {
          if (!ts) return t("дата неизвестна");
          let d = new Date(ts); let hm = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          let today = new Date(); let y = new Date(); y.setDate(today.getDate() - 1);
          if (d.toDateString() === today.toDateString()) return t("сегодня в {time}", { time: hm });
          if (d.toDateString() === y.toDateString()) return t("вчера в {time}", { time: hm });
          return d.toLocaleDateString([], { day: 'numeric', month: 'short', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
      }
      const BAN_ICON = '<svg viewBox="0 0 24 24" width="15" height="15" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"></line></svg>';
      function renderDevPanel() {
          // блок резервной копии живёт в «Настройках (Админ)»; на вкладке «Копия» переносим его в панель и возвращаем обратно
          { const bk = document.getElementById("bk-box"), home = document.getElementById("bk-home"); if (bk && home && devFilter !== "backup" && bk.parentElement !== home) home.appendChild(bk); }
          const screen = document.getElementById("dev-panel-screen");
          const ac = document.getElementById("dev-appeal-count"), nAppeals = Object.keys(appeals).filter(uid => bansCache[uid]).length;
          if (ac) { ac.style.display = nAppeals ? "inline" : "none"; ac.innerText = nAppeals; }
          const rc = document.getElementById("dev-report-count"), nReports = Object.keys(reportsCache).length;
          if (rc) { rc.style.display = nReports ? "inline" : "none"; rc.innerText = nReports; }
          if (!isAdmin || !screen || screen.style.display === "none") return;
          const now = Date.now();
          const all = Object.values(usersCache).filter(u => u && u.uid && u.name && String(u.name) !== "undefined");
          const isNew = (u, ms) => now - createdAtOf(u) < ms;
          document.getElementById("dev-total").innerText = all.length;
          document.getElementById("dev-online").innerText = all.filter(isUserOnline).length;
          document.getElementById("dev-new24").innerText = all.filter(u => isNew(u, DAY_MS)).length;
          document.getElementById("dev-new7").innerText = all.filter(u => isNew(u, 7 * DAY_MS)).length;

          if (devFilter === "reports") return renderReports();
          if (devFilter === "stats") return renderStats();
          if (devFilter === "backup") { const bk = document.getElementById("bk-box"), box = document.getElementById("dev-list"); if (bk.parentElement !== box) { box.innerHTML = ""; box.appendChild(bk); } renderCspBox(); return; }
          let list;
          if (devFilter === "online") list = all.filter(isUserOnline).sort((a, b) => createdAtOf(b) - createdAtOf(a)); // свежие регистрации — сверху
          else if (devFilter === "new") list = all.filter(u => isNew(u, 7 * DAY_MS)).sort((a, b) => createdAtOf(b) - createdAtOf(a));
          else if (devFilter === "banned") list = all.filter(u => isBanned(u.uid)).sort((a, b) => (!!appeals[b.uid] - !!appeals[a.uid]) || (getTime(bansCache[b.uid].bannedAt) - getTime(bansCache[a.uid].bannedAt))); // с обращениями — сверху
          else list = all.slice().sort((a, b) => createdAtOf(b) - createdAtOf(a));
          const q = document.getElementById("dev-search").value.trim().toLowerCase();
          if (q) list = list.filter(u => String(u.name).toLowerCase().includes(q) || emailOf(u).toLowerCase().includes(q));

          const box = document.getElementById("dev-list");
          if (!list.length) {
              box.innerHTML = `<div class="dev-empty">${q ? "Никого не найдено" : devFilter === "online" ? "Сейчас на сайте никого нет" : devFilter === "new" ? "За неделю новых пользователей нет" : devFilter === "banned" ? "Забаненных пользователей нет" : "Пользователей пока нет"}</div>`;
              return;
          }
          box.innerHTML = list.map(u => {
              const online = isUserOnline(u);
              const banned = isBanned(u.uid), ban = bansCache[u.uid];
              const canBan = u.uid !== currentUser.uid && u.email !== ADMIN_EMAIL;
              // Премиум можно выдать и себе (своя строка — без бана и удаления)
              const premBtn = `<button class="dev-ban-btn dev-prem-btn${isPremium(u.uid) ? ' on' : ''}" data-prem-uid="${escapeHTML(u.uid)}" title="${isPremium(u.uid) ? 'Снять премиум' : 'Выдать премиум'}">${featherSVG(15, "gold")}<span>${isPremium(u.uid) ? 'Снять' : 'Премиум'}</span></button>`;
              const banBtn = !canBan ? `<div class="dev-actions">${premBtn}</div>` : `<div class="dev-actions"><button class="dev-ban-btn${banned ? ' unban' : ''}" data-ban-uid="${escapeHTML(u.uid)}" title="${banned ? 'Разбанить' : 'Забанить'}">${BAN_ICON}<span>${banned ? 'Разбанить' : 'Забанить'}</span></button><button class="dev-ban-btn dev-verify-btn${verifiedCache[u.uid] ? ' on' : ''}" data-verify-uid="${escapeHTML(u.uid)}" title="${verifiedCache[u.uid] ? 'Снять серую галочку' : 'Выдать серую галочку'}">${VERIFIED_CHECK(14)}<span>${verifiedCache[u.uid] ? 'Снять' : 'Галочка'}</span></button>${premBtn}<button class="dev-ban-btn dev-del-btn" data-del-uid="${escapeHTML(u.uid)}" title="Удалить аккаунт"><svg viewBox="0 0 24 24" width="15" height="15" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg><span>Удалить</span></button></div>`;
              const why = banned ? (banReasons[u.uid]?.reason || ban.reason || "") : "";
              const sub = banned ? `Бан ${formatRegDate(getTime(ban.bannedAt))}${why ? ' · ' + escapeHTML(why) : ''}` : escapeHTML(emailOf(u));
              return `<div class="dev-row${banned ? ' banned' : ''}" data-dev-uid="${escapeHTML(u.uid)}">
                  <span class="av-wrap"><img src="${getAvatar(u.uid, u.name)}">${online ? '<i class="online-dot"></i>' : ''}</span>
                  <div class="dev-main">
                    <span class="dev-name">${escapeHTML(u.name)}${verifiedBadge(u.uid, 13)}${premiumBadge(u.uid, 13)}${banned ? '<span class="ban-badge">БАН</span>' : isNew(u, DAY_MS) ? '<span class="new-badge">NEW</span>' : ''}</span>
                    <span class="dev-sub">${sub}</span>
                    ${banned && appeals[u.uid] ? `<span class="dev-appeal"><b>Обращение:</b> ${escapeHTML(appeals[u.uid].text || "")}</span>` : ''}
                  </div>
                  <div class="dev-side">
                    <span class="${online ? 'on' : ''}">${escapeHTML(formatLastSeen(u))}</span>
                    <span class="dev-reg">рег.: ${formatRegDate(createdAtOf(u))}</span>
                  </div>
                  ${banBtn}
                </div>`;
          }).join("");
      }
      function renderReports() {
          const box = document.getElementById("dev-list");
          const q = document.getElementById("dev-search").value.trim().toLowerCase();
          // Жалобы на одно и то же сообщение/человека собираем в одну карточку
          const groups = {};
          Object.entries(reportsCache).forEach(([id, r]) => {
              const key = r.messageId ? "m_" + r.messageId : "u_" + r.targetUid;
              (groups[key] = groups[key] || { id, r, list: [] }).list.push(r);
          });
          let cards = Object.values(groups).sort((a, b) => Math.max(...b.list.map(x => getTime(x.createdAt))) - Math.max(...a.list.map(x => getTime(x.createdAt))));
          if (q) cards = cards.filter(c => [c.r.targetName, c.r.messageText, ...c.list.map(x => x.fromName + " " + x.reason + " " + (x.comment || ""))].join(" ").toLowerCase().includes(q));
          if (!cards.length) { box.innerHTML = `<div class="dev-empty">${q ? "Ничего не найдено" : "Жалоб нет — всё спокойно"}</div>`; return; }
          box.innerHTML = cards.map(({ id, r, list }) => {
              const u = usersCache[r.targetUid] || { uid: r.targetUid, name: r.targetName };
              const banned = isBanned(r.targetUid);
              const who = list.map(x => `<b>${escapeHTML(x.reason)}</b> — ${escapeHTML(x.fromName || "пользователь")}${x.comment ? ": " + escapeHTML(x.comment) : ""}`).join("<br>");
              return `<div class="dev-row${banned ? ' banned' : ''}" data-dev-uid="${escapeHTML(r.targetUid)}">
                  <span class="av-wrap"><img src="${getAvatar(r.targetUid, u.name)}"></span>
                  <div class="dev-main">
                    <span class="dev-name">${escapeHTML(u.name || r.targetName || "Пользователь")}${banned ? '<span class="ban-badge">БАН</span>' : ''}${list.length > 1 ? `<span class="new-badge" style="background:#ff9f0a;">×${list.length}</span>` : ''}</span>
                    <span class="dev-sub">${r.messageId ? "Жалоба на сообщение" : "Жалоба на пользователя"} · ${formatRegDate(getTime(r.createdAt))}</span>
                    ${r.messageText ? `<span class="dev-appeal">${iconizePreview(escapeHTML(r.messageText))}</span>` : ''}
                    <span class="dev-report">${who}</span>
                  </div>
                  <div class="dev-actions">
                    ${r.targetUid !== currentUser.uid && u.email !== ADMIN_EMAIL ? `<button class="dev-ban-btn${banned ? ' unban' : ''}" data-ban-uid="${escapeHTML(r.targetUid)}" title="${banned ? 'Разбанить' : 'Забанить'}">${BAN_ICON}<span>${banned ? 'Разбанить' : 'Забанить'}</span></button>` : ''}
                    ${r.messageId ? `<button class="dev-ban-btn dev-del-btn" data-report-act="delmsg" data-report-id="${escapeHTML(id)}" title="Удалить сообщение">${icon("trash", 15)}<span>Удалить</span></button>` : ''}
                    <button class="dev-ban-btn dev-ok-btn" data-report-act="close" data-report-id="${escapeHTML(id)}" title="Закрыть жалобу">${icon("check", 15)}<span>Закрыть</span></button>
                  </div>
                </div>`;
          }).join("");
      }
      function openDevPanel() {
          if (!isAdmin) return;
          document.getElementById("admin-global-screen").style.display = "none";
          document.getElementById("dev-panel-screen").style.display = "flex";
          renderDevPanel();
      }
      document.getElementById("dev-panel-btn").addEventListener("click", (e) => { e.stopPropagation(); openDevPanel(); });
      document.getElementById("open-dev-panel-btn").addEventListener("click", openDevPanel);
      document.getElementById("dev-tabs").addEventListener("click", (e) => {
          const t = e.target.closest("[data-f]"); if (!t) return;
          devFilter = t.getAttribute("data-f");
          document.querySelector("#dev-panel-screen .dev-search").style.display = devFilter === "stats" || devFilter === "backup" ? "none" : "";
          if (devFilter === "stats") statsDocs = null; // при каждом открытии — свежие цифры
          document.querySelectorAll("#dev-tabs .tab").forEach(el => el.classList.toggle("active", el === t));
          renderDevPanel();
      });
      document.getElementById("dev-search").addEventListener("input", renderDevPanel);
      document.getElementById("dev-list").addEventListener("click", (e) => {
          const banBtn = e.target.closest("[data-ban-uid]");
          if (banBtn) { e.stopPropagation(); toggleBan(banBtn.getAttribute("data-ban-uid"), banBtn); return; }
          const repBtn = e.target.closest("[data-report-act]");
          if (repBtn) { e.stopPropagation(); resolveReport(repBtn.getAttribute("data-report-id"), repBtn.getAttribute("data-report-act"), repBtn); return; }
          const premBtn = e.target.closest("[data-prem-uid]");
          if (premBtn) { e.stopPropagation(); togglePremium(premBtn.getAttribute("data-prem-uid"), premBtn); return; }
          const verBtn = e.target.closest("[data-verify-uid]");
          if (verBtn) { e.stopPropagation(); toggleVerified(verBtn.getAttribute("data-verify-uid"), verBtn); return; }
          const delBtn = e.target.closest("[data-del-uid]");
          if (delBtn) { e.stopPropagation(); deleteUserAccount(delBtn.getAttribute("data-del-uid"), delBtn); return; }
          const row = e.target.closest("[data-dev-uid]"); if (!row) return;
          document.getElementById("dev-panel-screen").style.display = "none";
          openPublicProfile(row.getAttribute("data-dev-uid"));
      });

      // Мои закрытые данные: users_private/{я}, мои подписки и мои подписчики
      function startOwnListeners() {
          ownListeners.forEach(f => f()); ownListeners = [];
          myPrivate = myFollowsOut = myFollowsIn = null; healedFollowing = -1;
          const uid = currentUser.uid;
          const changed = () => {
              const me = usersCache[uid];
              if (me) { overlayMe(me); renderQuickReactionSetting(); migrateMyPrivate(); healFollowingCount(); migrateMyRestricted(); renderMyStats(); renderNightSettings(); syncNight(); nightIntro(); syncLang(); guardInit(); }
              Object.values(usersCache).forEach(ensureRestrictedWatch);
              watchContacts(); usersChanged();
          };
          ownListeners.push(onSnapshot(query(collection(db, "group_invites"), where("toUid", "==", uid)), (s) => { myInvites = s.docs.map(d => ({ ...d.data(), id: d.id })); renderGroupInvites(); },
              (e) => { console.log("group_invites:", e.code); }));
          ownListeners.push(onSnapshot(doc(db, "users_private", uid), (d) => { myPrivate = d.exists() ? d.data() : {}; changed(); },
              (e) => { console.log("users_private/я:", e.code); myPrivate = myPrivate || {}; changed(); }));
          ownListeners.push(onSnapshot(query(collection(db, "follows"), where("from", "==", uid)), (s) => { myFollowsOut = new Set(s.docs.map(d => d.data().to)); changed(); },
              (e) => { console.log("follows (мои подписки):", e.code); }));
          ownListeners.push(onSnapshot(query(collection(db, "follows"), where("to", "==", uid)), (s) => { myFollowsIn = new Set(s.docs.map(d => d.data().from)); myFollowersAt = {}; s.docs.forEach(d => { myFollowersAt[d.data().from] = getTime(d.data().createdAt); }); rDenied.clear(); changed(); renderMyStats(); },
              (e) => { console.log("follows (мои подписчики):", e.code); }));
      }
      // Мои личные настройки из публичного профиля → users_private (уже сохранённые там значения важнее)
      async function migrateMyPrivate() {
          if (privMigrating || !myPrivate || !myRawProfile) return;
          const found = PRIVATE_PREFS.filter(k => myRawProfile[k] !== undefined);
          if (!found.length) return;
          privMigrating = true;
          try {
              const priv = { uid: currentUser.uid }, del = {};
              found.forEach(k => { if (myPrivate[k] === undefined) priv[k] = myRawProfile[k]; del[k] = deleteField(); });
              await setDoc(doc(db, "users_private", currentUser.uid), priv, { merge: true });
              await setDoc(doc(db, "users", currentUser.uid), del, { merge: true });
          } catch (e) { console.log("Перенос личных настроек:", e.code || e); }
          finally { privMigrating = false; }
      }
      let rMigrating = false, rMigrateFailed = false; // при ошибке не повторяем до перезапуска (иначе запись → откат → снова запись)
      async function migrateMyRestricted() {
          if (rMigrating || rMigrateFailed || !myRawProfile) return;
          rMigrating = true;
          try { await moveRestrictedFields(myRawProfile); } catch (e) { rMigrateFailed = true; console.log("Перенос закрытых полей:", e.code || e); }
          finally { rMigrating = false; }
      }
      // Счётчик моих подписок в профиле сверяем с реальными записями (после переноса старых подписок)
      function healFollowingCount() {
          const me = usersCache[currentUser.uid];
          if (!me || !myFollowsOut || !myRawProfile || Array.isArray(myRawProfile.following)) return;
          const n = myFollowsOut.size;
          if (me.followingCount === n || healedFollowing === n) return;
          healedFollowing = n;
          setDoc(doc(db, "users", currentUser.uid), { followingCount: n }, { merge: true }).catch(e => console.log("followingCount:", e.code));
      }

      function startDatabaseListeners() {
          if (usersListener) usersListener();
          if (groupsListener) groupsListener();
          if (metaListener) metaListener();
          if (globalMetaListener) globalMetaListener();
          if (newsMetaListener) newsMetaListener();
          Object.values(groupMetaListeners).forEach(u => u()); groupMetaListeners = {};
          chatsMetaCache = {};

          let usersFirstSnap = true;
          Object.values(userWatchers).forEach(u => u()); userWatchers = {};
          if (privateListener) { privateListener(); privateListener = null; }
          // ПРОФИЛИ. Админ (панель разработчика) слушает всех; остальные — только себя и своих собеседников
          // (watchUser). Раньше каждый скачивал профили всех пользователей.
          window.__ingestUser = (u, quiet) => {
              ingestUser(u, quiet);
              if (u && currentUser && u.uid === currentUser.uid) { watchContacts(); migrateMyPrivate(); migrateMyRestricted(); renderMyStats(); if (Array.isArray(u.blocked)) migrateBlockedList(u).catch(e => console.log("Перенос блокировок:", e.code || e)); }
          };
          startOwnListeners();
          if (!isAdmin) { usersListener = null; watchUser(currentUser.uid); }
          else usersListener = onSnapshot(collection(db, "users"), (snapshot) => {
            snapshot.docChanges().forEach(change => {
              if (change.type === "removed") { delete usersCache[change.doc.id]; return; } // профиль удалён
              ingestUser(change.doc.data(), usersFirstSnap);
            });
            usersChangedNow();
            usersFirstSnap = false;
          });
          if (isAdmin) {
              privateListener = onSnapshot(collection(db, "users_private"), (snap) => {
                  snap.forEach(d => { privateDocs[d.id] = d.data(); privateEmails[d.id] = d.data().email || ""; });
                  renderDevPanel();
              }, (e) => console.log("users_private:", e.code));
          }
          function ingestUser(u, quiet) {
              if(u && u.uid) {
                  // Админу — уведомление о свежей регистрации (ник появляется чуть позже самого профиля)
                  let prev = usersCache[u.uid];
                  if (isAdmin && !quiet && u.name && u.name !== "Загрузка..." && (!prev || !prev.name || prev.name === "Загрузка...") && Date.now() - createdAtOf(u) < 10 * 60 * 1000) showToast("Новый пользователь: " + u.name, "users");
                  rawProfiles[u.uid] = { ...u };
                  if (currentUser && u.uid === currentUser.uid) { myRawProfile = rawProfiles[u.uid]; overlayMe(u); }
                  applyRestricted(u);
                  usersCache[u.uid] = u;
                  ensureRestrictedWatch(u);
              } else return;
              
              // Профиль подгрузился уже после отрисовки (в чатах аватарки и значки рисуются сразу, по имени) — обновляем
              const sel = CSS.escape(u.uid);
              document.querySelectorAll(`img[data-uid="${sel}"], #chat-box img[data-profile-target="${sel}"]`).forEach(img => { const a = getAvatar(u.uid, u.name); if (img.getAttribute("src") !== a) img.src = a; });
              document.querySelectorAll(`.official-slot[data-official-uid="${sel}"]`).forEach(el => {
                  const off = u.email === ADMIN_EMAIL;
                  if (off && !el.firstChild) { el.innerHTML = OFFICIAL_BADGE_13; el.parentElement.querySelectorAll(".verified-badge").forEach(v => v.remove()); }
              });
              syncPremiumBadges(u.uid); // премиум выдали или сняли, сменили цвет пера
              if (currentUser && u.uid === currentUser.uid) { renderPremiumSettings(); checkPremiumWelcome(); }
              
              if (currentUser && u.uid === currentUser.uid) {
                let displayN = u.name || currentUser.displayName || t("Пользователь");
                let displayAv = getAvatar(u.uid, displayN);
                
                document.getElementById("my-name").innerText = displayN;
                document.getElementById("my-avatar").src = displayAv;
                document.getElementById("my-email-display").innerText = currentUser.email || "";
                
                document.getElementById("settings-avatar").src = displayAv;
                document.getElementById("settings-bio").value = u.bio || "";
                document.getElementById("settings-name").innerText = displayN;
                document.getElementById("settings-email").innerText = currentUser.email || "";
                document.getElementById("hide-online-toggle").checked = !!u.hideOnline;
                renderQuickReactionSetting();
                renderPrivacySettings();
              }
          }

          groupsListener = onSnapshot(query(collection(db, "groups"), where("members", "array-contains", currentUser.uid)), (snapshot) => {
            snapshot.docChanges().forEach(change => {
                let g = change.doc.data();
                let docId = change.doc.id; 
                if(change.type === 'removed') delete groupsCache[docId];
                else if (SAFE_ID.test(docId)) groupsCache[docId] = { ...g, id: docId }; // беседу с «хитрым» номером не показываем; поле id внутри записи не подменит номер
            });
            syncGroupMetaListeners();
            watchContacts();
            renderChatList(document.getElementById("search-input").value);
          });

          // ПРЕВЬЮ ЧАТОВ: загружаем только свои — личные (members содержит меня), свои беседы и глобальный чат.
          // Раньше грузилась вся коллекция, т.е. превью чужих личных переписок.
          const metaChanged = () => {
            watchContacts();
            updateUnreadIndicators(totalUnread());
            if (window.__pendingChat && Object.keys(usersCache).length) { const id = window.__pendingChat; window.__pendingChat = null; window.openChatById(id); }
            renderChatList(document.getElementById("search-input").value);
          };
          const applyMeta = (id, meta, quiet) => {
            const prev = chatsMetaCache[id];
            if (meta) chatsMetaCache[id] = meta; else delete chatsMetaCache[id];
            if (!quiet && meta) onChatMetaChanged(id, meta, prev);
          };
          let dmFirst = true;
          metaListener = onSnapshot(query(collection(db, "chats_metadata"), where("members", "array-contains", currentUser.uid)), (snapshot) => {
            snapshot.docChanges().forEach(change => applyMeta(change.doc.id, change.type === "removed" ? null : change.doc.data(), dmFirst));
            dmFirst = false; metaChanged();
          }, (e) => console.log("chats_metadata (личные):", e.code));
          let globalFirst = true;
          if (isAdmin) globalMetaListener = onSnapshot(doc(db, "chats_metadata", "global"), (d) => {
            applyMeta("global", d.exists() ? d.data() : null, globalFirst); globalFirst = false; metaChanged();
          }, (e) => console.log("chats_metadata (global):", e.code));
          let newsFirst = true;
          newsMetaListener = onSnapshot(doc(db, "chats_metadata", NEWS_ID), (d) => {
            applyMeta(NEWS_ID, d.exists() ? d.data() : null, newsFirst); newsFirst = false; metaChanged();
          }, (e) => console.log("chats_metadata (news):", e.code));
          function syncGroupMetaListeners() {
            for (const gid of Object.keys(groupMetaListeners)) if (!groupsCache[gid]) { groupMetaListeners[gid](); delete groupMetaListeners[gid]; delete chatsMetaCache[gid]; }
            for (const gid of Object.keys(groupsCache)) {
              if (groupMetaListeners[gid]) continue;
              let first = true;
              groupMetaListeners[gid] = onSnapshot(doc(db, "chats_metadata", gid), (d) => {
                applyMeta(gid, d.exists() ? d.data() : null, first); first = false; metaChanged();
              }, (e) => console.log("chats_metadata (беседа):", e.code));
            }
          }
          // Разовые миграции давно прошли, а migrateMetaMembers читает ВСЕ превью чатов — запускаем не чаще раза в месяц
          let migAt = 0; try { migAt = +localStorage.getItem("owl-admin-mig") || 0; } catch (_) {}
          if (isAdmin && Date.now() - migAt > 30 * 864e5) {
              try { localStorage.setItem("owl-admin-mig", String(Date.now())); } catch (_) {}
              migrateMetaMembers(); setTimeout(migrateEmails, 4000); setTimeout(migrateFollows, 8000); setTimeout(migrateAllRestricted, 11000);
          }
      }
      // Удаление аккаунта: убрать его подписки (со счётчиками у тех, на кого он подписан) и подписки на него
      async function deleteFollowEdges(uid) {
          const out = await getDocs(query(collection(db, "follows"), where("from", "==", uid)));
          for (const d of out.docs) {
              const b = writeBatch(db); b.delete(d.ref);
              b.update(doc(db, "users", d.data().to), { followersCount: increment(-1) });
              await b.commit().catch(() => deleteDoc(d.ref));
          }
          const inc = await getDocs(query(collection(db, "follows"), where("to", "==", uid)));
          for (const d of inc.docs) {
              const b = writeBatch(db); b.delete(d.ref);
              if (isAdmin) b.update(doc(db, "users", d.data().from), { followingCount: increment(-1) }); // себе подписчики пересчитают сами
              await b.commit().catch(() => deleteDoc(d.ref));
          }
      }
      // Разовая миграция (запускает админ при входе): подписки из массивов following/followers → записи follows,
      // пересчёт счётчиков, личные настройки → users_private, старые поля из публичных профилей удаляются
      async function migrateFollows() {
          const users = Object.values(usersCache).filter(u => u && u.uid);
          const raw = (u) => (currentUser && u.uid === currentUser.uid && myRawProfile) ? myRawProfile : u; // свой профиль в кэше дополнен личным
          const legacy = users.filter(u => LEGACY_FIELDS.some(k => raw(u)[k] !== undefined));
          if (!legacy.length) return;
          const exists = new Set(users.map(u => u.uid));
          let edges;
          try { edges = new Set((await getDocs(collection(db, "follows"))).docs.map(d => d.id)); }
          catch (e) { console.log("Миграция подписок: нет доступа к follows —", e.code); return; }
          const want = [];
          legacy.forEach(u0 => { const u = raw(u0);
              (Array.isArray(u.following) ? u.following : []).forEach(t => want.push([u.uid, t]));
              (Array.isArray(u.followers) ? u.followers : []).forEach(f => want.push([f, u.uid]));
          });
          const todo = [...new Map(want.filter(([a, b]) => a && b && a !== b && exists.has(a) && exists.has(b) && !edges.has(a + "_" + b)).map(p => [p[0] + "_" + p[1], p])).values()];
          // По одной записи: если какая-то не пройдёт, остальные всё равно перенесутся
          const fails = [];
          for (let i = 0; i < todo.length; i += 20) {
              await Promise.all(todo.slice(i, i + 20).map(async ([a, t]) => {
                  try { await setDoc(doc(db, "follows", a + "_" + t), { from: a, to: t, createdAt: new Date() }); edges.add(a + "_" + t); }
                  catch (e) { fails.push(a + "_" + t + ": " + (e.code || e.message || e)); }
              }));
          }
          if (fails.length) {
              console.log("Миграция подписок, не перенесены:", fails);
              showToast(`Не перенесено подписок: ${fails.length} из ${todo.length} (${fails[0].split(": ").pop()}). Старые поля пока не трогаем`, "error");
              return;
          }
          const fin = {}, fout = {};
          edges.forEach(id => { const [a, t] = id.split("_"); fout[a] = (fout[a] || 0) + 1; fin[t] = (fin[t] || 0) + 1; });
          let moved = 0;
          for (const u0 of users) {
              const u = raw(u0), upd = {}, priv = {};
              if (u0.followersCount !== (fin[u.uid] || 0)) upd.followersCount = fin[u.uid] || 0;
              if (u0.followingCount !== (fout[u.uid] || 0)) upd.followingCount = fout[u.uid] || 0;
              LEGACY_FIELDS.forEach(k => { if (u[k] !== undefined) { upd[k] = deleteField(); if (PRIVATE_PREFS.includes(k) && (privateDocs[u.uid] || {})[k] === undefined) priv[k] = u[k]; } });
              if (!Object.keys(upd).length) continue;
              try {
                  if (Object.keys(priv).length) await setDoc(doc(db, "users_private", u.uid), { uid: u.uid, ...priv }, { merge: true });
                  await setDoc(doc(db, "users", u.uid), upd, { merge: true });
                  moved++;
              } catch (e) { console.log("Миграция профиля " + u.uid + ":", e.code || e); }
          }
          showToast(`Подписки перенесены: ${todo.length} записей, профилей обновлено: ${moved}`, "shield");
      }
      // Разовая миграция (админ): фото/«о себе»/время визита с ограниченной аудиторией → restricted
      async function migrateAllRestricted() {
          let moved = 0, failed = 0;
          for (const raw of Object.values(rawProfiles)) {
              if (!raw || !raw.uid) continue;
              try { if (await moveRestrictedFields(raw)) moved++; } catch (e) { failed++; console.log("Закрытые поля " + raw.uid + ":", e.code || e); }
          }
          if (moved || failed) showToast(failed ? `Закрытые поля: перенесено ${moved}, ошибок ${failed}` : `Закрытые поля перенесены: ${moved} профилей`, failed ? "error" : "shield");
      }
      // Разовая миграция (запускает админ): email из публичных профилей → users_private; ник в нижнем регистре для поиска
      async function migrateEmails() {
          const todo = Object.values(usersCache).filter(u => u && u.uid && ((u.email && u.email !== ADMIN_EMAIL) || (u.name && !u.nameLower) || Array.isArray(u.blocked)));
          let moved = 0;
          for (const u of todo) {
              try {
                  const upd = {};
                  if (u.email && u.email !== ADMIN_EMAIL) {
                      await setDoc(doc(db, "users_private", u.uid), { uid: u.uid, email: u.email }, { merge: true });
                      privateEmails[u.uid] = u.email; upd.email = deleteField();
                  }
                  if (u.name && !u.nameLower) upd.nameLower = nickKey(u.name);
                  if (Array.isArray(u.blocked)) await migrateBlockedList(u);
                  await setDoc(doc(db, "users", u.uid), upd, { merge: true });
                  moved++;
              } catch (e) { console.log("Перенос профиля " + u.uid + ":", e.code || e); }
          }
          if (moved) showToast("Профили обновлены: " + moved, "shield");
      }
      // Разовая миграция (запускает админ): старым превью личных чатов дописываем members,
      // без этого они не попадут в выборку «мои чаты»
      async function migrateMetaMembers() {
          try {
              const snap = await getDocs(collection(db, "chats_metadata"));
              const todo = snap.docs.filter(d => d.id.includes("_") && !Array.isArray(d.data().members));
              for (let i = 0; i < todo.length; i += 400) {
                  const batch = writeBatch(db);
                  todo.slice(i, i + 400).forEach(d => batch.update(d.ref, { members: d.id.split("_") }));
                  await batch.commit();
              }
              if (todo.length) showToast("Превью чатов обновлены: " + todo.length, "check");
          } catch (e) { console.log("Миграция превью:", e.code || e); }
      }

      let notificationsListener = null;
      // От кого уведомление: официальные — «Owl Messenger» с синей галочкой, остальные — ник отправителя
      // Текст уведомления: для «подписался» и «удалил переписку» собираем сами из типа и имени отправителя —
      // присланный текст не показываем (его можно было бы подделать). Остальное — как есть (упоминание цитирует сообщение)
      function notifText(n) {
          const who = (n.fromUid && usersCache[n.fromUid]?.name) || t("Пользователь");
          if (n.type === "follow") return t("{name} подписался(ась) на вас!", { name: who });
          if (n.type === "chat_deleted") return t("{name} удалил(а) вашу переписку", { name: who });
          const txt = String(n.text || "");
          if (LANG !== "ru" && n.type === "invite") { const g = txt.match(/«(.*)»/); return t("{name} приглашает вас в беседу «{group}»", { name: who, group: g ? g[1] : t("Беседа") }); }
          if (LANG !== "ru" && n.type === "mention") {
              const i = txt.indexOf(": "), snippet = i >= 0 ? txt.slice(i + 2) : "";
              return n.chatId === "global" ? t("{name} упомянул(а) вас в глобальном чате: {text}", { name: who, text: snippet })
                  : t("{name} упомянул(а) вас в беседе «{group}»: {text}", { name: who, group: groupsCache[n.chatId]?.name || t("Беседа"), text: snippet });
          }
          return txt;
      }
      // ===== МЕНЮ УВЕДОМЛЕНИЙ =====
      let lastNotifs = [], lastUnread = 0, nfFresh = new Set();
      function ringBell() {
          const btn = document.getElementById("notif-btn"), badge = document.getElementById("notif-badge");
          btn.classList.remove("ring"); badge.classList.remove("pop"); void btn.offsetWidth; // перезапуск анимации
          btn.classList.add("ring"); badge.classList.add("pop");
          setTimeout(() => btn.classList.remove("ring"), 1100);
      }
      // Вид уведомления: значок-бейдж на аватаре и куда ведёт нажатие
      function notifKind(n) {
          const official = n.type === "broadcast" || (n.fromUid && usersCache[n.fromUid]?.email === ADMIN_EMAIL);
          if (official) return { cls: "official", ic: "megaphone" };
          if (n.type === "follow") return { cls: "follow", ic: "users" };
          if (n.type === "invite") return { cls: "invite", ic: "mail" };
          if (n.type === "mention") return { cls: "ment", ic: "" };
          if (n.type === "chat_deleted") return { cls: "deleted", ic: "trash" };
          return { cls: "other", ic: "bell" };
      }
      function notifWhen(ts) {
          const d = new Date(ts), diff = Date.now() - ts;
          if (diff < 60 * 1000) return t("только что");
          if (diff < 60 * 60 * 1000) return t("{n} мин. назад", { n: Math.floor(diff / 60000) });
          const hm = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
          if (new Date().toDateString() === d.toDateString()) return hm;
          return `${d.toLocaleDateString([], { day: "numeric", month: "short" })}, ${hm}`;
      }
      function notifDay(ts) {
          const d = new Date(ts), today = new Date(), y = new Date(); y.setDate(today.getDate() - 1);
          if (d.toDateString() === today.toDateString()) return t("Сегодня");
          if (d.toDateString() === y.toDateString()) return t("Вчера");
          return Date.now() - ts < 7 * 864e5 ? t("На этой неделе") : t("Ранее");
      }
      function renderNotifs() {
          const list = document.getElementById("notifs-list"); if (!list) return;
          const unread = lastNotifs.filter(n => !n.read || nfFresh.has(n.id)).length;
          document.getElementById("nf-sub").textContent = !lastNotifs.length ? t("Пока пусто") : unread ? t("Новых: {n}", { n: unread }) : t("Всё прочитано");
          if (!lastNotifs.length) {
              list.innerHTML = `<div class="nf-empty"><svg viewBox="0 0 64 28" width="74" height="32" aria-hidden="true"><circle cx="16" cy="14" r="12" fill="none" stroke="currentColor" stroke-width="3"/><circle cx="48" cy="14" r="12" fill="none" stroke="currentColor" stroke-width="3"/><circle cx="16" cy="14" r="5" fill="currentColor"/><circle cx="48" cy="14" r="5" fill="currentColor"/></svg><b>${t("Тишина в дупле")}</b>${t("Здесь появятся новые подписчики, упоминания и приглашения в беседы")}</div>`;
              return;
          }
          let html = "", day = "", k = 0;
          lastNotifs.forEach(n => {
              const ts = getTime(n.timestamp), dl = notifDay(ts);
              if (dl !== day) { day = dl; html += `<div class="nf-day">${dl}</div>`; }
              const kind = notifKind(n), official = kind.cls === "official";
              if (n.fromUid && !official) watchUser(n.fromUid);
              const who = official ? "Owl Messenger" : (n.fromUid && usersCache[n.fromUid]?.name) || t("Пользователь");
              const ava = official ? "icon-192.png" : getAvatar(n.fromUid, who);
              const link = (n.type === "follow" && n.fromUid) || ((n.type === "mention" || n.type === "invite") && n.chatId) ? " link" : "";
              const fresh = !n.read || nfFresh.has(n.id) ? " fresh" : "";
              html += `<div class="nf-item${link}${fresh}" data-nid="${escapeHTML(n.id)}" style="animation-delay:${Math.min(k++, 12) * 35}ms">
                  <div class="nf-ava"><img src="${escapeHTML(ava)}" alt=""><span class="nf-type ${kind.cls}">${kind.ic ? icon(kind.ic, 11) : "@"}</span></div>
                  <div class="nf-body"><div class="nf-text">${escapeHTML(notifText(n))}</div>
                  <div class="nf-meta">${official ? `<span class="off">Owl Messenger ${OFFICIAL_SVG(12)}</span> · ` : ""}${notifWhen(ts)}</div></div></div>`;
          });
          list.innerHTML = html;
      }
      // Нажатие на уведомление: подписка → профиль, упоминание → чат, приглашение → карточка приглашения в списке чатов
      document.getElementById("notifs-list").addEventListener("click", (e) => {
          const it = e.target.closest(".nf-item.link"); if (!it) return;
          const n = lastNotifs.find(x => x.id === it.getAttribute("data-nid")); if (!n) return;
          document.getElementById("notifs-screen").style.display = "none";
          if (n.type === "follow") window.openPublicProfile(n.fromUid);
          else if (n.type === "mention") window.openChatById(n.chatId);
          else if (n.type === "invite") { const inv = document.getElementById("group-invites"); if (groupsCache[n.chatId]) window.openChatById(n.chatId); else if (inv) inv.scrollIntoView({ behavior: reduceMotion() ? "auto" : "smooth", block: "start" }); }
      });
      document.getElementById("notifs-close").addEventListener("click", () => { document.getElementById("notifs-screen").style.display = "none"; });
      document.getElementById("notifs-screen").addEventListener("click", (e) => { if (e.target.id === "notifs-screen") e.target.style.display = "none"; });

      function startNotificationsListener() {
        if(notificationsListener) notificationsListener();
        // Только последние 20 уведомлений (раньше грузились все за всё время — с каждой рассылкой дороже).
        // Нужен составной индекс notifications: toUid ↑ + timestamp ↓; пока его нет — старый запрос.
        const qLatest = query(collection(db, "notifications"), where("toUid", "==", currentUser.uid), orderBy("timestamp", "desc"), limit(20));
        const qAll = query(collection(db, "notifications"), where("toUid", "==", currentUser.uid));
        const handleNotifs = (snapshot) => {
          let unreadCount = 0; let notifs = [];
          snapshot.forEach(docSnap => notifs.push({ ...docSnap.data(), id: docSnap.id }));
          notifs.sort((a,b) => getTime(b.timestamp) - getTime(a.timestamp)); 
          // Старые повторы «подписался на вас» от одного человека — показываем только самое свежее
          const seenFollow = new Set();
          notifs = notifs.filter(n => n.type !== "follow" || !n.fromUid || (!seenFollow.has(n.fromUid) && seenFollow.add(n.fromUid)));

          notifs.forEach(n => { if (!n.read) unreadCount++; });
          lastNotifs = notifs; renderNotifs();

          const b = document.getElementById("notif-badge");
          if (unreadCount > 0) { b.style.display = "block"; b.innerText = unreadCount > 99 ? '99+' : unreadCount; }
          else b.style.display = "none";
          document.getElementById("notif-btn").classList.toggle("has-unread", unreadCount > 0);
          if (unreadCount > lastUnread) ringBell(); // пришло новое — колокольчик качнётся
          lastUnread = unreadCount;

          // Новые непоказанные уведомления. Если их сразу много (например, при входе) — одно общее, а не стопка
          const fresh = snapshot.docChanges().filter(c => c.type === "added" && !c.doc.data().read && !c.doc.data().toasted);
          if (fresh.length > 2) {
              showToast(t("Новых уведомлений: {n}. Нажмите, чтобы посмотреть", { n: fresh.length }), "bell", { onClick: () => document.getElementById("notif-btn").click() });
              playNotifySound();
          } else fresh.forEach(c => { showToast(notifText(c.doc.data()), "bell", { onClick: () => document.getElementById("notif-btn").click() }); playNotifySound(); });
          fresh.forEach(c => updateDoc(doc(db, "notifications", c.doc.id), { toasted: true }).catch(e=>{}));
        };
        notificationsListener = onSnapshot(qLatest, handleNotifs, (err) => {
            console.warn("Уведомления: нет индекса, загружаю по-старому —", err.code, err.message);
            notificationsListener = onSnapshot(qAll, handleNotifs);
        });
      }

      function openNotifsMenu() {
         let scr = document.getElementById("notifs-screen");
         nfFresh = new Set(lastNotifs.filter(n => !n.read).map(n => n.id)); // подсветка новых сохраняется, пока меню открыто
         renderNotifs();
         if (scr) scr.style.display = "flex";
         getDocs(query(collection(db, "notifications"), where("toUid", "==", currentUser.uid), where("read", "==", false))).then(snap => {
             if(snap.empty) return;
             let batch = writeBatch(db);
             snap.forEach(d => batch.update(d.ref, {read: true}));
             batch.commit().catch(e=>console.log(e));
         }).catch(e=>console.log(e));
      }

      let nBtn = document.getElementById("notif-btn");
      if (nBtn) nBtn.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); openNotifsMenu(); });

      const savedTheme = localStorage.getItem('owl_theme') || 'dark';
      const savedBg = localStorage.getItem('owl_bg') || 'default';
      const savedCustomBg = localStorage.getItem('owl_custom_bg_data');
      
      document.body.setAttribute('data-theme', savedTheme);
      document.body.setAttribute('data-bg', savedBg);
      if (savedCustomBg) { document.documentElement.style.setProperty('--custom-bg-url', `url(${savedCustomBg})`); }
      
      document.getElementById('theme-select').value = savedTheme;
      document.getElementById('bg-select').value = savedBg === 'custom' ? 'default' : savedBg;

      document.getElementById('theme-select').addEventListener('change', (e) => { 
          const apply = () => { document.body.setAttribute('data-theme', e.target.value); localStorage.setItem('owl_theme', e.target.value); };
          if (document.startViewTransition && !reduceMotion()) document.startViewTransition(apply); else apply(); // мягкое перетекание цветов 
      });
      
      document.getElementById('bg-select').addEventListener('change', (e) => { 
          document.body.setAttribute('data-bg', e.target.value); localStorage.setItem('owl_bg', e.target.value); 
      });

      document.getElementById('custom-bg-btn').addEventListener('click', () => { document.getElementById('custom-bg-input').click(); });

      document.getElementById('custom-bg-input').addEventListener('change', (e) => {
          let file = e.target.files[0];
          if (!file) return;
          let reader = new FileReader();
          reader.onload = function(evt) {
              let img = new Image();
              img.onload = function() {
                  let canvas = document.createElement('canvas'); let ctx = canvas.getContext('2d');
                  let maxW = 1080; let maxH = 1920; let w = img.width; let h = img.height;
                  if (w > maxW || h > maxH) { let ratio = Math.min(maxW/w, maxH/h); w *= ratio; h *= ratio; }
                  canvas.width = w; canvas.height = h; ctx.drawImage(img, 0, 0, w, h);
                  let base64 = canvas.toDataURL('image/jpeg', 0.6);
                  try {
                      localStorage.setItem('owl_custom_bg_data', base64);
                      localStorage.setItem('owl_bg', 'custom');
                      document.documentElement.style.setProperty('--custom-bg-url', `url(${base64})`);
                      document.body.setAttribute('data-bg', 'custom');
                      document.getElementById('bg-select').value = 'default';
                      showToast(t("Свой фон установлен!"), "image");
                  } catch(err) { alert(t("Файл слишком большой. Выберите картинку поменьше.")); }
              }; img.src = evt.target.result;
          }; reader.readAsDataURL(file); e.target.value = "";
      });

      document.getElementById("open-settings-btn").addEventListener("click", (e) => {
        if (e.target.closest('#logout-btn-header') || e.target.closest('#open-create-group-btn') || e.target.closest('#notif-btn') || e.target.closest('#dev-panel-btn')) return; 
        document.getElementById("edit-name-row").style.display = "none";
        if (currentUser) {
            // при каждом открытии счётчики «докручиваются» с нуля — и заодно гарантированно актуальны
            ["my-followers-n", "my-following-n"].forEach(id => { const el = document.getElementById(id); el.dataset.n = 0; el.textContent = "0"; });
            setTimeout(renderMyStats, 120);
            let u = usersCache[currentUser.uid];
            let displayN = u ? u.name : (currentUser.displayName || t("Пользователь"));
            document.getElementById("settings-avatar").src = getAvatar(currentUser.uid, displayN);
            document.getElementById("settings-name").innerText = displayN;
            document.getElementById("settings-email").innerText = currentUser.email;
            document.getElementById("settings-bio").value = u && u.bio ? u.bio : "";
            
            let sAdminBadge = document.getElementById("settings-admin-badge");
            if (sAdminBadge) sAdminBadge.style.display = isAdmin ? "inline-flex" : "none";
            renderPremiumSettings();
        }
        document.getElementById("settings-screen").style.display = "flex";
      });

      document.getElementById("logout-btn-header").addEventListener("click", (e) => {
        e.preventDefault(); e.stopPropagation(); 
        if(confirm(t("Вы уверены, что хотите выйти из аккаунта?"))) logoutEverywhere();
      });

      // Смена никнейма
      (function () {
          const row = document.getElementById("edit-name-row"), input = document.getElementById("edit-name-input"), hint = document.getElementById("edit-name-hint"), saveBtn = document.getElementById("edit-name-save");
          const setHint = (text, cls) => { hint.className = "nick-hint" + (cls ? " " + cls : ""); hint.innerHTML = text; };
          const myName = () => usersCache[currentUser.uid]?.name || currentUser.displayName || "";
          function check() {
              const v = normalizeNick(input.value);
              if (nickKey(v) === nickKey(myName())) { setHint(v === myName() ? t("Это ваш текущий ник") : t("Изменится только регистр букв"), v === myName() ? "" : "ok"); return v !== myName(); }
              const err = validateNick(v); if (err) { setHint(err, "bad"); return false; }
              if (nickTakenLocally(v, currentUser.uid)) { setHint(icon("error", 14) + t("Этот ник уже занят"), "bad"); return false; }
              setHint(icon("check", 14) + t("Ник свободен"), "ok"); return true;
          }
          document.getElementById("edit-name-btn").addEventListener("click", () => {
              row.style.display = row.style.display === "block" ? "none" : "block";
              if (row.style.display === "block") { input.value = myName(); check(); input.focus(); input.select(); }
          });
          document.getElementById("edit-name-cancel").addEventListener("click", () => { row.style.display = "none"; });
          input.addEventListener("input", check);
          input.addEventListener("keydown", (e) => { if (e.key === "Enter") saveBtn.click(); if (e.key === "Escape") { e.stopPropagation(); row.style.display = "none"; } });
          saveBtn.addEventListener("click", async () => {
              if (!currentUser || !check()) return;
              saveBtn.disabled = true; const orig = saveBtn.innerText; saveBtn.innerText = t("Сохраняем...");
              try {
                  const name = await claimNickname(currentUser.uid, input.value);
                  await updateProfile(currentUser, { displayName: name });
                  document.getElementById("settings-name").innerText = name; document.getElementById("my-name").innerText = name;
                  row.style.display = "none"; showToast(t("Никнейм изменён на «{name}»", { name }), "check");
              } catch (e) {
                  if (e.code === "nick-taken") { setHint(icon("error", 14) + t("Этот ник только что заняли"), "bad"); }
                  else { console.error(e); showToast(t("Не удалось сменить ник: ") + e.message, "error"); }
              }
              saveBtn.disabled = false; saveBtn.innerText = orig;
          });
      })();

      document.getElementById("save-bio-btn").addEventListener("click", async () => {
        let bio = document.getElementById("settings-bio").value.trim();
        try { await writeMyField("bio", { bio: bio }); showToast(t("Профиль сохранен!"), "check"); }
        catch (e) { console.error(e); showToast(t("Не удалось сохранить"), "error"); }
      });

      // СОХРАНЕНИЕ АВАТАРКИ В BASE64 (БЕСПЛАТНО, БЕЗ СТОРЕДЖА)
      document.getElementById("change-avatar-btn").addEventListener("click", () => document.getElementById("avatar-input").click());
      document.getElementById("avatar-input").addEventListener("change", function(e) {
        let file = e.target.files[0]; if(!file) return;
        let prevSrc = document.getElementById("settings-avatar").src;
        document.getElementById("settings-avatar").style.opacity = "0.5";

        let reader = new FileReader();
        reader.onload = function(evt) {
          let img = new Image();
          img.onload = async function() {
            let canvas = document.createElement("canvas"); let ctx = canvas.getContext("2d");
            let size = 250; let min = Math.min(img.width, img.height);
            canvas.width = size; canvas.height = size;
            ctx.drawImage(img, (img.width - min)/2, (img.height - min)/2, min, min, 0, 0, size, size);
            let base64 = canvas.toDataURL("image/jpeg", 0.7);
            
            try {
              await writeMyField("photo", { photoURL: base64 });
              showToast(t("Аватарка успешно обновлена!"), "camera");
              document.getElementById("settings-avatar").style.opacity = "1";
            } catch (err) {
              console.error(err); 
              document.getElementById("settings-avatar").src = prevSrc; document.getElementById("settings-avatar").style.opacity = "1";
              alert(t("Ошибка: ") + err.message);
            }
          }; img.src = evt.target.result;
        }; reader.readAsDataURL(file); e.target.value = ""; 
      });

      document.getElementById("open-create-group-btn").addEventListener("click", (e) => {
          e.preventDefault(); e.stopPropagation();
          let listEl = document.getElementById("create-group-friends-list"); listEl.innerHTML = "";
          let myFollowing = usersCache[currentUser.uid]?.following || [];
          let friendsAdded = false;

          Object.values(usersCache).forEach(u => {
              if (u.uid !== currentUser.uid && myFollowing.includes(u.uid) && canAddToGroup(u.uid)) {
                  friendsAdded = true;
                  let av = getAvatar(u.uid, u.name);
                  listEl.innerHTML += `<label class="friend-checkbox-item"><input type="checkbox" value="${u.uid}" class="group-friend-check"><img src="${av}"><span style="font-size:14px; font-weight:bold;">${escapeHTML(u.name)}</span></label>`;
              }
          });
          if (!friendsAdded) listEl.innerHTML = `<p style="color:var(--text-muted); font-size:13px; text-align:center;">${t("У вас пока нет подписок. Подпишитесь на кого-то, чтобы пригласить в беседу.")}</p>`;
          document.getElementById("new-group-name").value = "";
          document.getElementById("create-group-screen").style.display = "flex";
      });

      document.getElementById("create-group-submit-btn").addEventListener("click", async () => {
          // кавычки и апострофы — на типографские (база не принимает " ' < > ` в названиях)
          let name = document.getElementById("new-group-name").value.trim().replace(/"/g, "”").replace(/'/g, "’").replace(/[<>`]/g, "").slice(0, 40);
          if(!name) return alert(t("Введите название беседы!"));
          let selected = []; document.querySelectorAll('.group-friend-check:checked').forEach(cb => selected.push(cb.value));
          if(selected.length === 0) { if(!confirm(t("Вы не выбрали ни одного участника. Создать пустую беседу?"))) return; }

          try {
              // Участников не добавляем сразу — каждому уходит приглашение, в беседу он попадёт, только приняв его
              const docRef = await addDoc(collection(db, "groups"), { name: name, members: [currentUser.uid], adminUid: currentUser.uid, photoURL: generateAvatarSVG(name, true), createdAt: new Date() });
              const sent = await sendGroupInvites(docRef.id, name, selected);
              document.getElementById("create-group-screen").style.display = "none";
              showToast(selected.length ? t("Беседа создана. Приглашений отправлено: {n}", { n: sent }) : t("Беседа успешно создана!"), "users");
              window.loadChat(docRef.id, name, docRef.id, true);
          } catch(e) { console.error(e); alert(t("Ошибка при создании беседы.")); }
      });

      document.getElementById("clear-global-btn").addEventListener("click", async () => {
          if(confirm("Вы уверены, что хотите УДАЛИТЬ ВСЕ сообщения в Глобальном чате? Это необратимо!")) {
              try {
                  const q = query(collection(db, "messages"), where("chatId", "==", "global"));
                  const snap = await getDocs(q); await Promise.all(snap.docs.map(d => deleteDoc(d.ref)));
                  await deleteDoc(doc(db, "chats_metadata", "global")).catch(e => console.log(e)); // убираем и превью последнего сообщения
                  showToast("Глобальный чат полностью очищен!", "trash"); document.getElementById("admin-global-screen").style.display = "none";
              } catch(e) { console.error(e); }
          }
      });

      window.makeGroupAdmin = async (groupId, newAdminUid) => {
          if(confirm(t("Передать права администратора? Вы больше не сможете управлять этой беседой."))) {
              try { await updateDoc(doc(db, "groups", groupId), { adminUid: newAdminUid }); showToast(t("Права администратора переданы!"), "crown"); openPublicProfile(groupId); } catch(e) { console.error(e); }
          }
      };

      window.removeGroupMember = async (groupId, targetUid) => {
          if(confirm(t("Точно хотите исключить этого участника из беседы?"))) {
              try { await setDoc(doc(db, "groups", groupId), { members: arrayRemove(targetUid) }, { merge: true }); deleteDoc(doc(db, "group_invites", groupId + "_" + targetUid)).catch(() => {}); showToast(t("Участник исключен"), "logout"); openPublicProfile(groupId); } catch(e) { console.error(e); }
          }
      };
      // Кнопки «Сделать админом» / «Исключить» в списке участников (обработчик один на список — без onclick в разметке)
      document.getElementById("group-members-list").addEventListener("click", (e) => {
          const b = e.target.closest("[data-gm]"), gid = e.currentTarget.getAttribute("data-gid"); if (!b || !gid) return;
          if (b.getAttribute("data-gm") === "admin") window.makeGroupAdmin(gid, b.getAttribute("data-uid")); else window.removeGroupMember(gid, b.getAttribute("data-uid"));
      });

      // ЗАГРУЗКА АВАТАРКИ ГРУППЫ В BASE64
      document.getElementById("group-avatar-input").addEventListener("change", function(e) {
            let file = e.target.files[0]; if(!file) return;
            let prevSrc = document.getElementById("group-avatar-display").src;
            document.getElementById("group-avatar-display").style.opacity = "0.5";

            let reader = new FileReader();
            reader.onload = function(evt) {
              let img = new Image();
              img.onload = async function() {
                let canvas = document.createElement("canvas"); let ctx = canvas.getContext("2d");
                let size = 250; let min = Math.min(img.width, img.height);
                canvas.width = size; canvas.height = size; ctx.drawImage(img, (img.width - min)/2, (img.height - min)/2, min, min, 0, 0, size, size);
                let base64 = canvas.toDataURL("image/jpeg", 0.7);
                
                try {
                  await updateDoc(doc(db, "groups", currentEditingGroupId), { photoURL: base64 });
                  showToast(t("Аватарка беседы обновлена!"), "camera");
                  document.getElementById("group-avatar-display").src = base64; document.getElementById("group-avatar-display").style.opacity = "1";
                } catch (err) { 
                  document.getElementById("group-avatar-display").src = prevSrc; document.getElementById("group-avatar-display").style.opacity = "1"; 
                  alert(t("Ошибка: ") + err.message); 
                }
              }; img.src = evt.target.result;
            }; reader.readAsDataURL(file); e.target.value = ""; 
      });

      window.openPublicProfile = (uid) => {
        watchUser(uid);
        if(!uid || uid === 'global' || uid === 'admin-settings') return;
        
        if (groupsCache[uid]) {
            let g = groupsCache[uid]; currentEditingGroupId = g.id; 
            document.getElementById("group-avatar-display").src = safeImg(g.photoURL) || generateAvatarSVG(g.name, true);
            document.getElementById("group-name-display").innerText = g.name;
            document.getElementById("group-members-count").innerText = g.members ? g.members.length : 0;
            
            let isGroupAdmin = (g.adminUid === currentUser.uid);
            let overlay = document.getElementById("group-avatar-overlay");
            if(isGroupAdmin) { overlay.style.display = "flex"; document.getElementById("group-avatar-wrapper").onclick = () => document.getElementById("group-avatar-input").click(); document.getElementById("group-avatar-wrapper").style.cursor = "pointer"; } 
            else { overlay.style.display = "none"; document.getElementById("group-avatar-wrapper").onclick = null; document.getElementById("group-avatar-wrapper").style.cursor = "default"; }
            
            let mList = document.getElementById("group-members-list"); mList.innerHTML = ""; mList.setAttribute("data-gid", g.id);
            if (g.members) {
                g.members.forEach(mUid => {
                    let u = usersCache[mUid];
                    if (u) {
                        let av = getAvatar(u.uid, u.name);
                        let adminLabel = (g.adminUid === u.uid) ? `<span style="font-size:10px; background:var(--accent); color:white; padding:2px 5px; border-radius:5px; margin-left:5px;">${t("Админ")}</span>` : "";
                        if (!SAFE_ID.test(g.id) || !SAFE_ID.test(mUid)) return;
                        let makeAdminBtn = (isGroupAdmin && mUid !== currentUser.uid) ? `<button data-gm="admin" data-uid="${mUid}" style="margin-left:auto; background:var(--input-bg); border:none; color:var(--text-main); font-size:11px; padding:4px 8px; border-radius:8px; cursor:pointer;">${t("Сделать админом")}</button>` : "";
                        let removeUserBtn = (isGroupAdmin && mUid !== currentUser.uid) ? `<button data-gm="remove" data-uid="${mUid}" style="margin-left:5px; background:#ff3b30; border:none; color:white; font-size:11px; padding:4px 8px; border-radius:8px; cursor:pointer;">${t("Исключить")}</button>` : "";
                        mList.innerHTML += `<div style="display:flex; align-items:center; padding:8px 0; border-bottom:1px solid var(--border-color);"><img src="${av}" style="width:30px; height:30px; border-radius:50%; margin-right:10px; object-fit:cover;"><span style="font-size:14px; color:var(--text-main); font-weight:bold;">${escapeHTML(u.name)} ${adminLabel}</span><div style="margin-left:auto; display:flex; gap:5px;">${makeAdminBtn}${removeUserBtn}</div></div>`;
                    }
                });
            }
            if (isGroupAdmin) {
                document.getElementById("delete-group-btn").style.display = "block"; document.getElementById("leave-group-btn").style.display = "none"; document.getElementById("add-members-block").style.display = "block";
                let addListEl = document.getElementById("add-group-friends-list"); addListEl.innerHTML = "";
                let myFollowing = usersCache[currentUser.uid]?.following || []; let canAdd = false;
                Object.values(usersCache).forEach(u => {
                    if (u.uid !== currentUser.uid && myFollowing.includes(u.uid) && canAddToGroup(u.uid) && (!g.members || !g.members.includes(u.uid))) {
                        canAdd = true; let av = getAvatar(u.uid, u.name);
                        addListEl.innerHTML += `<label class="friend-checkbox-item"><input type="checkbox" value="${u.uid}" class="add-group-friend-check"><img src="${av}"><span style="font-size:14px; font-weight:bold;">${escapeHTML(u.name)}</span></label>`;
                    }
                });
                if (!canAdd) addListEl.innerHTML = `<p style="color:var(--text-muted); font-size:13px; text-align:center;">${t("Все ваши подписки уже в этой беседе или приглашены.")}</p>`;
                document.getElementById("add-members-submit-btn").onclick = async () => {
                    let selected = []; document.querySelectorAll('.add-group-friend-check:checked').forEach(cb => selected.push(cb.value));
                    if(selected.length > 0) { const sent = await sendGroupInvites(g.id, g.name, selected); showToast(sent ? t("Приглашений отправлено: {n}", { n: sent }) : t("Не удалось отправить приглашения"), sent ? "check" : "error"); openPublicProfile(g.id); }
                };
                document.getElementById("delete-group-btn").onclick = async () => {
                    if(confirm(t("ВЫ УВЕРЕНЫ? Это навсегда удалит беседу и всю переписку в ней для всех участников!"))) {
                        const q = query(collection(db, "messages"), where("chatId", "==", g.id)); const snap = await getDocs(q); await Promise.all(snap.docs.map(d => deleteDoc(d.ref))); await deleteDoc(doc(db, "groups", g.id)); // сначала сообщения, потом группа (так требуют правила)
                        document.getElementById("group-info-screen").style.display = "none"; window.loadChat(NEWS_ID, t("Новости Owl"), null, false);
                    }
                };
            } else { document.getElementById("delete-group-btn").style.display = "none"; document.getElementById("leave-group-btn").style.display = "block"; document.getElementById("add-members-block").style.display = "none"; }
            let leaveBtn = document.getElementById("leave-group-btn");
            leaveBtn.onclick = async () => { if(confirm(t("Точно хотите покинуть беседу?"))) { await setDoc(doc(db, "groups", g.id), { members: arrayRemove(currentUser.uid) }, { merge: true }); document.getElementById("group-info-screen").style.display = "none"; window.loadChat(NEWS_ID, t("Новости Owl"), null, false); } };
            document.getElementById("group-info-screen").style.display = "flex"; return;
        }

        let u = usersCache[uid]; if(!u) return;

        document.getElementById("public-avatar").src = getAvatar(uid, u.name);
        document.getElementById("public-name").innerText = u.name;
        document.getElementById("public-banned").style.display = bansCache[uid] ? "block" : "none";
        
        let pAdminBadge = document.getElementById("public-admin-badge");
        if (pAdminBadge) pAdminBadge.style.display = (u.email === ADMIN_EMAIL) ? "inline-flex" : "none";
        document.getElementById("public-verified-badge").setAttribute("data-verified-uid", uid); syncVerifiedBadges();
        document.getElementById("public-premium-badge").setAttribute("data-premium-uid", uid); syncPremiumBadges(uid);

        let emailEl = document.getElementById("public-email");
        const shownEmail = uid === currentUser.uid ? currentUser.email : (isAdmin ? emailOf(u) : "");
        if (shownEmail) { emailEl.style.display = "block"; emailEl.innerText = shownEmail; } else { emailEl.style.display = "none"; }
        document.getElementById("public-bio").innerText = !allowedBy(u, "bio") ? t("Статус скрыт") : (u.bio ? u.bio : t("Статус не указан"));
        window.__profileUid = uid;
        const cnt = isAdmin || uid === currentUser.uid || privacyOf(u, "showCounts");
        const setStat = (id, v) => { const el = document.getElementById(id); if (v === "—") { el.textContent = "—"; el.dataset.n = 0; } else { if (window.__statUid !== uid) el.dataset.n = 0; countTo(el, v); } };
        setStat("public-followers", cnt || allowedBy(u, "showFollowers") ? followCount(u, "followers") : "—");
        setStat("public-following", cnt || allowedBy(u, "showFollowing") ? followCount(u, "following") : "—");
        window.__statUid = uid;

        let followBtn = document.getElementById("public-follow-btn"); let msgBtn = document.getElementById("public-msg-btn");
        const blkBtn = document.getElementById("public-block-btn");
        blkBtn.style.display = (uid === currentUser.uid || u.email === ADMIN_EMAIL) ? "none" : "inline-flex";
        blkBtn.innerHTML = icon("block", 14) + (iBlocked(uid) ? t("Разблокировать") : t("Заблокировать")); blkBtn.setAttribute("data-action-uid", uid);
        const repBtn = document.getElementById("public-report-btn");
        repBtn.style.display = (uid === currentUser.uid || isAdmin || u.email === ADMIN_EMAIL) ? "none" : "inline-flex";
        repBtn.innerHTML = icon("flag", 14) + t("Пожаловаться"); repBtn.setAttribute("data-action-uid", uid);
        if (uid === currentUser.uid) { followBtn.style.display = "none"; msgBtn.style.display = "none"; } else {
          followBtn.style.display = "block"; msgBtn.style.display = "block"; followBtn.setAttribute("data-action-uid", uid); msgBtn.setAttribute("data-action-uid", uid);
          let myFollowing = usersCache[currentUser.uid]?.following || [];
          if (myFollowing.includes(uid)) { followBtn.innerText = t("Отписаться"); followBtn.style.background = "var(--input-bg)"; followBtn.style.color = "var(--text-main)"; } else { followBtn.innerText = t("Подписаться"); followBtn.style.background = "var(--accent)"; followBtn.style.color = "white"; }
        }
        document.getElementById("public-profile-screen").style.display = "flex"; window.raiseModal(document.getElementById("public-profile-screen"));
      };

      document.getElementById("public-msg-btn").addEventListener("click", (e) => {
        let targetUid = e.target.getAttribute("data-action-uid"); document.getElementById("public-profile-screen").style.display = "none";
        let u = usersCache[targetUid]; let chatId = currentUser.uid < u.uid ? currentUser.uid+"_"+u.uid : u.uid+"_"+currentUser.uid;
        loadChat(chatId, u.name, targetUid);
      });

      document.getElementById("public-follow-btn").addEventListener("click", async (e) => {
        let targetUid = e.target.getAttribute("data-action-uid"); let myFollowing = usersCache[currentUser.uid]?.following || []; let isFollowing = myFollowing.includes(targetUid);
        try {
          if (isFollowing) { await setFollow(targetUid, false); showToast(t("Вы отписались"), "info"); }
          else { await setFollow(targetUid, true); burstAt(e.target); showToast(t("Вы подписались!"), "check"); }
          openPublicProfile(targetUid); 
        } catch (err) { console.error("Ошибка подписки", err); showToast(t("Не удалось изменить подписку"), "error"); }
      });

      document.getElementById("chat-header-info").addEventListener("click", (e) => {
        if(e.target.closest('#mobile-back-btn') || e.target.closest('#pin-chat-btn') || e.target.closest('#clear-chat-btn')) return;
        let trigger = e.target.closest("#header-profile-trigger");
        if(trigger) { let uid = trigger.getAttribute("data-profile-target"); if (uid === 'admin-settings') { document.getElementById("admin-global-screen").style.display = "flex"; } else if(uid) { openPublicProfile(uid); } }
      });

      document.getElementById("tab-all").addEventListener("click", (e) => { document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active')); e.currentTarget.classList.add('active'); currentFilter = 'all'; renderChatList(document.getElementById("search-input").value); });
      document.getElementById("tab-friends").addEventListener("click", (e) => { document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active')); e.currentTarget.classList.add('active'); currentFilter = 'friends'; renderChatList(document.getElementById("search-input").value); });
      // Поиск людей: ищем в базе по началу ника (раньше искали в скачанном списке всех пользователей)
      let searchTimer = null, searchSeq = 0;
      document.getElementById("search-input").addEventListener("input", (e) => {
          renderChatList(e.target.value);
          clearTimeout(searchTimer);
          const v = nickKey(e.target.value);
          if (isAdmin || v.length < 2) return;
          searchTimer = setTimeout(async () => {
              const seq = ++searchSeq;
              try {
                  const snap = await getDocs(query(collection(db, "users"), where("nameLower", ">=", v), where("nameLower", "<=", v + "\uf8ff"), limit(15)));
                  if (seq !== searchSeq) return;
                  snap.forEach(d => { const u = d.data(); if (u && u.uid && !usersCache[u.uid] && privacyOf(u, "searchable")) window.__ingestUser(u, true); });
                  renderChatList(document.getElementById("search-input").value);
              } catch (err) { console.log("Поиск:", err.code || err); }
          }, 300);
      });

      document.getElementById("chat-list").addEventListener("click", (e) => {
        if (e.target.closest("[data-profile-target]")) return; 
        let item = e.target.closest(".chat-item");
        if (item) {
          let chatId = item.getAttribute("data-chat-id"); let chatName = item.getAttribute("data-chat-name"); let targetUid = item.getAttribute("data-target-uid"); let isGroup = item.getAttribute("data-is-group") === "true";
          if (targetUid === "global" || targetUid === "nest" || targetUid === "news") targetUid = null;
          window.loadChat(chatId, chatName, targetUid, isGroup);
        }
      });

      let pinBtn = document.getElementById("pin-chat-btn");
      if(pinBtn) {
          pinBtn.addEventListener("click", async () => {
             if(!currentUser || !currentChatId) return;
             let myPinned = usersCache[currentUser.uid]?.pinnedChats || [];
             try {
                 if (myPinned.includes(currentChatId)) { await setDoc(doc(db, "users_private", currentUser.uid), { pinnedChats: arrayRemove(currentChatId) }, { merge: true }); showToast(t("Чат откреплен"), "pin"); } 
                 else { await setDoc(doc(db, "users_private", currentUser.uid), { pinnedChats: arrayUnion(currentChatId) }, { merge: true }); showToast(t("Чат закреплен"), "pin"); }
             } catch(e) { console.error(e); }
          });
      }

      // Удаление всей личной переписки — у обоих участников
      document.getElementById("clear-chat-btn").addEventListener("click", async () => {
          if (!currentUser || !currentChatId || !currentChatId.includes("_")) return;
          const chatId = currentChatId;
          const otherUid = chatId.split("_").find(id => id !== currentUser.uid);
          const otherName = usersCache[otherUid]?.name || t("собеседника");
          const nest = isNest(chatId);
          if (nest ? !confirm(t("Очистить Гнездо? Все заметки и сохранённое удалятся навсегда.")) : !confirm(t("Удалить всю переписку с {name}?", { name: otherName }) + "\n\n" + t("Сообщения исчезнут у вас обоих. Это действие нельзя отменить."))) return;
          const btn = document.getElementById("clear-chat-btn"); btn.disabled = true;
          try {
              const snap = await getDocs(query(collection(db, "messages"), where("chatId", "==", chatId)));
              const docs = snap.docs;
              for (let i = 0; i < docs.length; i += 400) {
                  const batch = writeBatch(db);
                  docs.slice(i, i + 400).forEach(d => batch.delete(d.ref));
                  await batch.commit();
              }
              // Превью в списке чатов очищаем (удалить документ правила могут не разрешить — тогда просто обнуляем поля)
              await deleteDoc(doc(db, "chats_metadata", chatId)).catch(() =>
                  setDoc(doc(db, "chats_metadata", chatId), { members: chatId.split("_"), lastMessageText: deleteField(), lastMessageSender: deleteField(), lastMessageSenderUid: deleteField(), unreadCount: 0 }, { merge: true }));
              delete chatsMetaCache[chatId];
              if (!nest) addDoc(collection(db, "notifications"), { fromUid: currentUser.uid, toUid: otherUid, text: `${currentUser.displayName} удалил(а) вашу переписку`, type: "chat_deleted", chatId, timestamp: new Date(), read: false }).catch(() => {});
              loadedMsgs = {}; document.getElementById("chat-box").innerHTML = "";
              renderChatList(document.getElementById("search-input").value);
              showToast(nest ? t("Гнездо очищено") : t("Переписка удалена"), "trash");
          } catch (e) {
              console.error(e);
              if (e.code === "permission-denied") showToast(t("Нет прав удалить сообщения собеседника — нужно обновить правила Firestore"), "error");
              else showToast(t("Не удалось удалить переписку: ") + e.message, "error");
          }
          btn.disabled = false;
      });

      function updatePinIcon() {
         let btn = document.getElementById("pin-chat-btn"); 
         if (!btn || !currentUser || !currentChatId) return;
         // Удалить переписку можно только в личном чате (у обоих участников)
         let clearBtn = document.getElementById("clear-chat-btn");
         if (clearBtn) clearBtn.style.display = (currentChatId.includes("_") && currentChatId.split("_").includes(currentUser.uid)) ? "flex" : "none";
         btn.style.display = isNest(currentChatId) ? "none" : "flex"; // Гнездо и так всегда первое
         updateCallBtn();
         if (clearBtn && isNest(currentChatId)) clearBtn.title = t("Очистить Гнездо");
         let myPinned = usersCache[currentUser.uid]?.pinnedChats || [];
         if (myPinned.includes(currentChatId)) { btn.innerHTML = pinFilledSVG; btn.style.opacity = "1"; btn.style.color = "var(--accent)"; } 
         else { btn.innerHTML = pinOutlineSVG; btn.style.opacity = "0.7"; btn.style.color = "var(--text-main)"; }
      }

      // Превью «Имя: текст» для общих чатов; от заблокированных — скрываем
      function sharedPreview(meta) {
          let sUid = meta.lastMessageSenderUid;
          if (!sUid && meta.lastMessageSender) sUid = Object.values(usersCache).find(u => u && u.name === meta.lastMessageSender)?.uid; // старые превью без uid
          if (sUid && sUid !== currentUser.uid && iBlocked(sUid)) return `<i>${t("Сообщение скрыто")}</i>`;
          const who = (meta.lastMessageSenderUid && usersCache[meta.lastMessageSenderUid]?.name) || meta.lastMessageSender; // имя из профиля, а не из превью
          return iconizePreview(escapeHTML(who + ": " + meta.lastMessageText));
      }
      // filter/list — для ленты вкладок: соседнюю вкладку рисуем в #chat-list-peek, не трогая основной список
      function renderChatList(searchQuery = "", filter = currentFilter, list = document.getElementById("chat-list")) {
        if (!currentUser) return; 
        try {
            let val = String(searchQuery).toLowerCase().trim(); let isSearching = val.length > 0;
            let html = "";
            let allCount = 1; let friendCount = 0; let myFollowing = usersCache[currentUser.uid]?.following || [];
            let myPinned = usersCache[currentUser.uid]?.pinnedChats || [];

            Object.values(usersCache).forEach(u => { if(!u || !u.uid || !u.name || String(u.name) === "undefined" || String(u.name) === "null" || u.uid === currentUser.uid) return; let isFriend = myFollowing.includes(u.uid); if (isFriend) friendCount++; if (isAdmin || isFriend) allCount++; });
            Object.values(groupsCache).forEach(g => { if (g && g.members && g.members.includes(currentUser.uid)) { allCount++; friendCount++; } });
            
            document.getElementById("badge-all").innerText = allCount; document.getElementById("badge-friends").innerText = friendCount;

            let chatItemsArray = [];

            let globalMeta = chatsMetaCache['global'];
            let globalPreview = globalMeta && globalMeta.lastMessageText ? sharedPreview(globalMeta) : "Закрыт — архив виден только админу";
            let globalTime = globalMeta && globalMeta.timestamp ? getTime(globalMeta.timestamp) : 0;
            
            if (filter === 'all' && isAdmin) {
                chatItemsArray.push({
                    id: 'global', targetUid: 'global', isGroup: false, name: t('Глобальный чат'), subtext: globalPreview,
                    avatarHtml: `<div style="background: var(--accent); width: 50px; height: 50px; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin-right: 15px; flex-shrink: 0; color: white;"><svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg></div>`,
                    time: globalTime, unread: 0, isOfficial: false, isPinned: myPinned.includes('global')
                });
            }

            // «Гнездо» — всегда первым во вкладке «Все» (в поиске — если ищут по его названию)
            if (filter === 'all' && (!isSearching || t("Гнездо").toLowerCase().includes(val) || "гнездо".includes(val))) {
                const nm = chatsMetaCache[nestId()];
                chatItemsArray.push({
                    id: nestId(), targetUid: 'nest', isGroup: false, isNest: true, name: t("Гнездо"),
                    subtext: nm && nm.lastMessageText ? iconizePreview(escapeHTML(nm.lastMessageText)) : t("Ваши заметки и сохранённое"),
                    avatarHtml: `<div class="nest-av">${NEST_SVG(26)}</div>`,
                    time: nm && nm.timestamp ? getTime(nm.timestamp) : 0, unread: 0, isOfficial: false, isPinned: false
                });
            }

            // Канал «Новости Owl» — вторым, сразу после «Гнезда»; точка — если вышел пост, который вы ещё не видели
            if (filter === 'all' && (!isSearching || t("Новости Owl").toLowerCase().includes(val) || "новости owl".includes(val))) {
                if (currentChatId === NEWS_ID) markNewsSeen(); // пост вышел, пока канал открыт, — он уже увиден
                const nm = chatsMetaCache[NEWS_ID], nt = nm && nm.timestamp ? getTime(nm.timestamp) : 0;
                chatItemsArray.push({
                    id: NEWS_ID, targetUid: 'news', isGroup: false, isNews: true, name: t("Новости Owl"), isOfficial: true,
                    subtext: nm && nm.lastMessageText ? iconizePreview(escapeHTML((LANG !== "ru" && nm.lastMessageI18n && nm.lastMessageI18n[LANG]) || nm.lastMessageText)) : t("Официальный канал Owl"),
                    avatarHtml: `<img class="news-av" src="icon-192.png" alt="">`,
                    time: nt, unread: nt > newsSeen() && currentChatId !== NEWS_ID ? 1 : 0, dot: true, isPinned: false
                });
            }

            Object.values(groupsCache).forEach(g => {
               if (g && g.members && g.members.includes(currentUser.uid)) {
                  if (isSearching && !String(g.name).toLowerCase().includes(val)) return;
                  let meta = chatsMetaCache[g.id];
                  let preview = meta && meta.lastMessageText ? sharedPreview(meta) : tp(g.members.length, "участник|участника|участников");
                  let time = meta && meta.timestamp ? getTime(meta.timestamp) : (g.createdAt ? getTime(g.createdAt) : 0);
                  let safeName = escapeHTML(g.name); let av = safeImg(g.photoURL) || generateAvatarSVG(g.name, true);
                  chatItemsArray.push({
                      id: g.id, targetUid: escapeHTML(g.id), isGroup: true, name: safeName, subtext: preview, namePrefix: groupIconSVG,
                      avatarHtml: `<img src="${av}" data-profile-target="${escapeHTML(g.id)}" title="${t("Открыть профиль группы")}">`, time: time, unread: 0, isOfficial: false, isPinned: myPinned.includes(g.id)
                  });
               }
            });

            Object.values(usersCache).forEach(u => {
              if(!u || !u.uid || !u.name || String(u.name) === "undefined" || String(u.name) === "null" || u.uid === currentUser.uid) return;
              let isFriend = myFollowing.includes(u.uid);
              
              let chatId = currentUser.uid < u.uid ? currentUser.uid+"_"+u.uid : u.uid+"_"+currentUser.uid;
              let meta = chatsMetaCache[chatId];
              let hasChatHistory = !!meta; 

              if (filter === 'friends') { 
                  if (!isFriend) return; 
                  if (isSearching && !String(u.name).toLowerCase().includes(val)) return; 
              } else { 
                  if (!isSearching && !isFriend && !hasChatHistory) return; 
                  if (isSearching && !String(u.name).toLowerCase().includes(val)) return; 
              }

              let preview = meta && meta.lastMessageText ? iconizePreview(escapeHTML(meta.lastMessageText)) : (u.bio && allowedBy(u, "bio") ? escapeHTML(u.bio) : t("Статус не указан"));
              if (bansCache[u.uid]) preview = `<span class="banned-label">${t("Пользователь заблокирован")}</span>`;
              if (meta && meta.lastMessageSender && !isMyMeta(meta) && !bansCache[u.uid]) preview = escapeHTML(meta.lastMessageSender) + ": " + preview;
              
              let time = meta && meta.timestamp ? getTime(meta.timestamp) : 0;
              let unread = (meta && meta.unreadCount && !isMyMeta(meta)) ? meta.unreadCount : 0;
              let avatarUrl = getAvatar(u.uid, u.name); 
              let isFriendIcon = isFriend ? `<svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" stroke-width="2" fill="currentColor" stroke-linecap="round" stroke-linejoin="round" style="margin-right:2px;"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>` : "";
              let isOfficial = (u.email === ADMIN_EMAIL);

              chatItemsArray.push({
                  id: chatId, uid: u.uid, targetUid: escapeHTML(u.uid), isGroup: false, isFriend: isFriend, name: escapeHTML(u.name), subtext: preview, namePrefix: isFriendIcon,
                  avatarHtml: `<span class="av-wrap"><img src="${avatarUrl}" data-profile-target="${escapeHTML(u.uid)}" title="${t("Открыть профиль")}">${isUserOnline(u) ? '<i class="online-dot"></i>' : ''}</span>`, time: time, unread: unread, isOfficial: isOfficial, isPinned: myPinned.includes(chatId)
              });
            });

            chatItemsArray.forEach(it => {
                if (it.id === currentChatId) return;
                const d = getDraft(it.id);
                if (d) it.subtext = `<span class="draft-label">${t("Черновик:")}</span> ${escapeHTML(d.replace(/\s+/g, " ").slice(0, 80))}`;
            });
            chatItemsArray.sort((a, b) => {
                if (a.isNest !== b.isNest) return a.isNest ? -1 : 1;
                if (!!a.isNews !== !!b.isNews) return a.isNews ? -1 : 1;
                if (a.isPinned && !b.isPinned) return -1;
                if (!a.isPinned && b.isPinned) return 1;
                return b.time - a.time;
            });
            
            chatItemsArray.forEach(item => {
                let badgeHtml = item.unread > 0 && currentChatId !== item.id ? `<span class="ci-badge${item.dot ? " dot" : ""}" data-n="${item.unread}" style="background:var(--accent); color:white; font-size:11px; padding:2px 6px; border-radius:10px; margin-left:auto; font-weight:bold;">${item.unread > 99 ? '99+' : item.unread}</span>` : "";
                let officialHtml = item.isOfficial ? `<span style="display:inline-flex; align-items:center; margin-left:4px;" title="${t("Официальный аккаунт")}"><svg viewBox="0 0 24 24" width="14" height="14" fill="#3390ec"><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zm-1.9 14.7L6 12.6l1.5-1.5 2.6 2.6 6.4-6.4 1.5 1.5-7.9 7.9z"/></svg></span>` : "";
                let pinHtml = item.isPinned ? `<svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none" style="margin-left:5px; opacity:0.6;"><line x1="12" y1="17" x2="12" y2="22"></line><path d="M5 17h14v-1.5l-3.2-3.2V5a1.8 1.8 0 0 0-1.8-1.8H10A1.8 1.8 0 0 0 8.2 5v7.3L5 15.5V17z"></path></svg>` : "";

                html += `
                  <div class="chat-item ${currentChatId === item.id ? 'active' : ''}" data-chat-id="${escapeHTML(item.id)}" data-chat-name="${item.name}" data-target-uid="${item.targetUid}" data-is-group="${item.isGroup}">
                    ${item.avatarHtml}
                    <div class="chat-item-info" style="pointer-events: none;">
                      <div class="chat-item-top">
                        <span class="chat-item-name" style="color: ${item.isFriend ? 'var(--accent)' : 'inherit'}; display:flex; align-items:center;">${item.namePrefix || ''}${item.name}${officialHtml}${item.uid ? verifiedBadge(item.uid, 13) + premiumBadge(item.uid, 15) : ''}${pinHtml}</span>
                        ${badgeHtml}
                      </div>
                      <span class="chat-item-subtext">${item.subtext}</span>
                    </div>
                  </div>
                `;
            });
            // Подсказки для пустого списка
            const realChats = chatItemsArray.filter(i => i.id !== 'global').length;
            const inviteBtn = `<br><button class="ob-mini-btn" data-invite>${icon("users", 16)}${t("Пригласить друга")}</button>`;
            if (isSearching && !realChats) html += `<div class="empty-hint"><b>${t("Никого не нашли")}</b>${t("Ник ищется по первым буквам — проверьте, как он пишется.")}${inviteBtn}</div>`;
            else if (!isSearching && !isAdmin && !realChats) html += filter === 'friends'
                ? `<div class="empty-hint"><b>${t("Вы пока ни на кого не подписаны")}</b>${t("Найдите друга по нику в поиске сверху и подпишитесь — он появится здесь.")}${inviteBtn}</div>`
                : `<div class="empty-hint"><b>${t("Здесь появятся ваши чаты")}</b>${t("Найдите друга по нику в поиске сверху или пригласите его в Owl.")}${inviteBtn}</div>`;
            // Плавные перестановки (FLIP): запоминаем, где были чаты, и после перерисовки «доезжаем» до новых мест.
            // Новый чат проявляется, счётчик непрочитанных подпрыгивает, когда растёт. Во время поиска — без анимации
            const animList = list.id === "chat-list" && !isSearching && !reduceMotion() && list.offsetParent !== null;
            const prevTop = {}, prevUnread = {};
            if (animList) list.querySelectorAll(".chat-item[data-chat-id]").forEach(el => { prevTop[el.dataset.chatId] = el.getBoundingClientRect().top; const b = el.querySelector(".ci-badge"); prevUnread[el.dataset.chatId] = b ? +b.dataset.n : 0; });
            const hadItems = Object.keys(prevTop).length > 0;
            list.innerHTML = html;
            if (animList && hadItems) list.querySelectorAll(".chat-item[data-chat-id]").forEach(el => {
                const id = el.dataset.chatId, top = el.getBoundingClientRect().top;
                if (id in prevTop) { const dy = prevTop[id] - top; if (Math.abs(dy) > 2) el.animate([{ transform: `translateY(${dy}px)` }, { transform: "none" }], { duration: 320, easing: "cubic-bezier(.2,.8,.2,1)" }); }
                else el.animate([{ opacity: 0, transform: "translateY(-8px)" }, { opacity: 1, transform: "none" }], { duration: 280, easing: "ease-out" });
                const b = el.querySelector(".ci-badge"); if (b && +b.dataset.n > (prevUnread[id] || 0)) b.classList.add("bump");
            });
        } catch (error) { console.error("Ошибка рендера: ", error); }
      }

      let isLoginMode = true; 
      document.getElementById("auth-toggle-btn").addEventListener("click", () => {
        isLoginMode = !isLoginMode;
        document.getElementById("auth-title").innerText = isLoginMode ? t("Вход в Owl") : t("Регистрация");
        document.getElementById("auth-name").style.display = isLoginMode ? "none" : "block";
        document.getElementById("auth-action-btn").innerText = isLoginMode ? t("Войти") : t("Создать аккаунт");
        document.getElementById("auth-toggle-btn").innerText = isLoginMode ? t("Нет аккаунта? Регистрация") : t("Уже есть аккаунт? Войти");
        
        let forgotBtn = document.getElementById("forgot-password-btn");
        if(forgotBtn) forgotBtn.style.display = isLoginMode ? "block" : "none";
        document.getElementById("turnstile-container").style.display = !isLoginMode ? "flex" : "none"; if (!isLoginMode) loadTurnstile();
      });

      let forgotBtn = document.getElementById("forgot-password-btn");
      if(forgotBtn) {
          forgotBtn.addEventListener("click", async () => {
            let email = document.getElementById("auth-email").value.trim();
            if (!email) return alert(t("Введите ваш Email в поле выше."));
            forgotBtn.style.pointerEvents = "none";
            try {
              // Красивое письмо от Owl через сервер; если сервер писем недоступен — стандартное письмо Firebase
              const r = await emailPost("/email/reset", { email, lang: LANG });
              if (r.status === 429) return showToast(t("Слишком часто. Попробуйте через {time}", { time: fmtWait(r.data.retryAfter) }), "shield");
              if (r.status === 400) return showToast(t("Проверьте email — похоже, в нём ошибка"), "alert");
              if (!r.ok) { auth.languageCode = LANG; await sendPasswordResetEmail(auth, email); }
              showToast(t("Если аккаунт с {email} существует, письмо для сброса пароля уже летит 🦉", { email }), "bell");
            } catch (error) { showToast(t("Не удалось отправить письмо. Проверьте email и интернет"), "alert"); }
            finally { forgotBtn.style.pointerEvents = ""; }
          });
      }

      // ===== ВТОРОЙ ФАКТОР (код из приложения-аутентификатора, TOTP) =====
      // Окно кода: verify(code) бросает ошибку на неверный код — окно остаётся открытым. Итог: true — подтверждено, false — отмена
      function askMfaCode({ title, hint, qrHtml = "", extraHtml = "", okText = t("Подтвердить"), verify }) {
          const scr = document.getElementById("mfa-screen"), inp = document.getElementById("mfa-code"), err = document.getElementById("mfa-err"), ok = document.getElementById("mfa-ok"), cancel = document.getElementById("mfa-cancel");
          document.getElementById("mfa-title").textContent = title;
          document.getElementById("mfa-hint").textContent = hint;
          document.getElementById("mfa-qr").innerHTML = qrHtml; document.getElementById("mfa-extra").innerHTML = extraHtml;
          ok.textContent = okText; cancel.textContent = t("Отмена"); inp.value = ""; err.textContent = ""; ok.disabled = false;
          scr.style.display = "flex"; setTimeout(() => inp.focus(), 50);
          return new Promise((done) => {
              const finish = (v) => { ok.onclick = cancel.onclick = inp.onkeydown = inp.oninput = null; scr.style.display = "none"; done(v); };
              const submit = async () => {
                  const code = inp.value.replace(/\D/g, "");
                  if (code.length !== 6) { err.textContent = t("Введите 6 цифр"); return; }
                  ok.disabled = true; err.textContent = "";
                  try { await verify(code); finish(true); }
                  catch (e) {
                      ok.disabled = false; inp.value = ""; inp.focus();
                      if (e.code === "auth/invalid-verification-code") err.textContent = t("Неверный код — попробуйте ещё раз");
                      else if (e.code === "auth/too-many-requests") err.textContent = t("Слишком много попыток. Подождите немного и повторите");
                      else if (e.code === "auth/network-request-failed") err.textContent = t("Нет соединения с интернетом");
                      else if (/session|timeout|expired/i.test(e.code || "")) { showToast(t("Время на ввод кода вышло — войдите заново"), "clock"); finish(false); }
                      else err.textContent = t("Ошибка: {error}", { error: e.code || e.message });
                  }
              };
              ok.onclick = submit; cancel.onclick = () => finish(false);
              inp.oninput = () => { inp.value = inp.value.replace(/\D/g, "").slice(0, 6); if (inp.value.length === 6) submit(); };
              inp.onkeydown = (e) => { if (e.key === "Enter") submit(); };
          });
      }
      // Вход или повторный вход упёрся во второй фактор — спрашиваем код и завершаем. false — человек отменил
      async function resolveMfa(error) {
          const resolver = getMultiFactorResolver(auth, error);
          const hint = resolver.hints.find(h => h.factorId === TotpMultiFactorGenerator.FACTOR_ID);
          if (!hint) throw error;
          return askMfaCode({ title: t("Код из приложения-аутентификатора"), hint: t("Откройте приложение с кодами (например, «Пароли») и введите 6 цифр для Owl Messenger."),
              verify: (code) => resolver.resolveSignIn(TotpMultiFactorGenerator.assertionForSignIn(hint.uid, code)) });
      }
      // Повторный вход паролем (перед удалением аккаунта и т.п.) — с кодом, если он подключён
      async function reauthWithPassword(pw) {
          try { await reauthenticateWithCredential(currentUser, EmailAuthProvider.credential(currentUser.email, pw)); return true; }
          catch (e) { if (e.code === "auth/multi-factor-auth-required") return resolveMfa(e); throw e; }
      }
      // «Настройки → Безопасность → Вход с кодом»: включить может каждый; выключить — каждый, кроме админа
      // (у админа код снимается только через Google Cloud Shell — так защиту не снимет и тот, кто перехватит открытую сессию)
      const mfaFactor = () => currentUser && multiFactor(currentUser).enrolledFactors.find(f => f.factorId === TotpMultiFactorGenerator.FACTOR_ID);
      function mfaRefresh() {
          const on = !!mfaFactor(), tg = document.getElementById("mfa-toggle");
          tg.checked = on; tg.disabled = on && isAdmin;
          document.getElementById("mfa-state").textContent = on
              ? t("Включён: после пароля Owl спрашивает 6-значный код из приложения-аутентификатора.") + (isAdmin ? " " + t("У админ-аккаунта выключить нельзя.") : "")
              : t("После пароля Owl будет спрашивать код из приложения-аутентификатора (на iPhone — «Пароли»). Так аккаунт не украдут, даже узнав пароль.");
      }
      function plainQrSvg(text) { // обычный чёрно-белый код без логотипа — его надёжно читает камера телефона
          const qr = qrcode(0, "M"); qr.addData(text); qr.make();
          const n = qr.getModuleCount(); let r = "";
          for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (qr.isDark(y, x)) r += `M${x} ${y}h1v1h-1z`;
          return `<svg viewBox="-2 -2 ${n + 4} ${n + 4}" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges"><path d="${r}" fill="#000"/></svg>`;
      }
      // Действие, которому нужен свежий вход: при auth/requires-recent-login спрашиваем пароль (и код, если он есть) и повторяем
      async function withRecentLogin(fn) {
          try { return await fn(); }
          catch (e) {
              if (e.code !== "auth/requires-recent-login") throw e;
              const pw = prompt(t("Для этого введите пароль от аккаунта ещё раз:")); if (!pw) return null;
              if (!(await reauthWithPassword(pw))) return null;
              return fn();
          }
      }
      async function mfaEnable() {
          const secret = await withRecentLogin(async () => TotpMultiFactorGenerator.generateSecret(await multiFactor(currentUser).getSession()));
          if (!secret) return;
          const url = secret.generateQrCodeUrl(currentUser.email, "Owl Messenger");
          await loadScript("lib-qrcode.js");
          const phone = /iPhone|iPad|Android/i.test(navigator.userAgent);
          const extraHtml = (phone ? `<a href="${escapeHTML(url)}">${escapeHTML(t("Открыть в приложении кодов"))}</a><br>` : "") + escapeHTML(t("Ключ вручную: {key}", { key: secret.secretKey }));
          const ok = await askMfaCode({ title: t("Вход с кодом"), okText: t("Включить"), qrHtml: plainQrSvg(url), extraHtml,
              hint: phone ? t("1. Нажмите «Открыть в приложении кодов» и сохраните код (или отсканируйте QR с другого устройства). 2. Вернитесь в Owl и введите 6 цифр, которые показывает приложение.")
                          : t("1. Наведите камеру телефона на QR-код и добавьте код в приложение-аутентификатор (на iPhone — «Пароли»). 2. Введите 6 цифр, которые оно показывает."),
              verify: (code) => multiFactor(currentUser).enroll(TotpMultiFactorGenerator.assertionForEnrollment(secret, code), "Owl") });
          if (ok) { showToast(t("Вход с кодом включён"), "shield"); await currentUser.getIdToken(true).catch(() => {}); }
      }
      async function mfaDisable() {
          const f = mfaFactor(); if (!f || isAdmin) return;
          if (!confirm(t("Выключить вход с кодом? Аккаунт снова будет защищён только паролем."))) return;
          const done = await withRecentLogin(async () => { await multiFactor(currentUser).unenroll(f); return true; });
          if (done) showToast(t("Вход с кодом выключен"), "shield");
      }
      document.getElementById("mfa-toggle").addEventListener("change", async (e) => {
          const tg = e.target, want = tg.checked; tg.disabled = true;
          try { if (want) await mfaEnable(); else await mfaDisable(); }
          catch (err) {
              console.error(err);
              if (err.code === "auth/user-token-expired") return; // после выключения кода Firebase может попросить войти заново — это нормально
              showToast(err.code === "auth/unverified-email" ? t("Сначала подтвердите почту") : t("Ошибка: {error}", { error: err.code || err.message }), "error");
          }
          finally { if (currentUser) mfaRefresh(); }
      });

      document.getElementById("auth-action-btn").addEventListener("click", async (e) => {
        let btn = e.target; let origText = btn.innerText;
        btn.innerText = t("Подождите..."); btn.disabled = true;

        let email = document.getElementById("auth-email").value.trim();
        let password = document.getElementById("auth-password").value.trim();
        let name = document.getElementById("auth-name").value.trim();

        // УМНАЯ ПРОВЕРКА КАПЧИ: берем токен напрямую из скрытого поля Cloudflare
        let cfToken = turnstileToken || document.querySelector('[name="cf-turnstile-response"]')?.value;

        try {
          if (isLoginMode) { 
              try { await signInWithEmailAndPassword(auth, email, password); }
              catch (signErr) {
                  if (signErr.code !== "auth/multi-factor-auth-required") throw signErr;
                  if (!(await resolveMfa(signErr))) { btn.innerText = origText; btn.disabled = false; return; } // передумали вводить код
              }
              if (window.owlReact) window.owlReact("happy"); 
          } else {
            // Используем надежный токен cfToken вместо старого turnstileToken
            if (!cfToken && (TURNSTILE_VERIFY_URL || turnstileWaiting)) { btn.innerText = origText; btn.disabled = false; return showToast(t("Подождите проверку Cloudflare!"), "shield"); }
            if (!name) { btn.innerText = origText; btn.disabled = false; return showToast(t("Укажите никнейм!"), "alert"); }
            name = normalizeNick(name);
            let nickErr = validateNick(name);
            if (nickErr) { btn.innerText = origText; btn.disabled = false; return showToast(t("Никнейм: {error}", { error: t(nickErr) }), "alert"); }
            // Быстрая проверка до создания аккаунта (если правила не пускают без входа — проверим после)
            try { if ((await getDoc(doc(db, "usernames", nickKey(name)))).exists()) { btn.innerText = origText; btn.disabled = false; return showToast(t("Никнейм «{name}» уже занят", { name }), "alert"); } } catch (_) {}
            if (TURNSTILE_VERIFY_URL) {
              const vr = await fetch(TURNSTILE_VERIFY_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: cfToken }) });
              const vj = await vr.json().catch(() => ({}));
              if (!vj.success) { btn.innerText = origText; btn.disabled = false; try { window.turnstile && window.turnstile.reset(); } catch (_) {} return showToast(t("Проверка Cloudflare не пройдена, попробуйте ещё раз"), "shield"); }
            }
            const userCred = await createUserWithEmailAndPassword(auth, email, password);
            // До подтверждения почты в базе НЕТ ничего публичного: ник запоминаем только в самом аккаунте входа (displayName),
            // а профиль создаётся и ник занимается после ввода кода из письма (createProfileAfterVerify). Так неверная почта
            // не оставляет «мёртвых» профилей и занятых ников
            try { await updateProfile(userCred.user, { displayName: name }); }
            catch (profileErr) { await deleteUser(userCred.user).catch(() => {}); throw profileErr; }
            // Код подтверждения почты отправит экран «Подтвердите почту» после перезагрузки
            location.reload(); 
          }
        } catch (error) { 
            btn.innerText = origText; btn.disabled = false; try { window.turnstile && window.turnstile.reset(); } catch (_) {} 
            if (window.owlReact) window.owlReact("shake");
            
            if (error.code === 'nick-taken') {
                showToast(t("Никнейм «{name}» уже занят, выберите другой", { name }), "alert");
            } else if (error.code === 'auth/invalid-credential') {
                showToast(t("Аккаунт не найден. Проверьте пароль или нажмите «Регистрация»"), "alert");
            } else if (error.code === 'auth/email-already-in-use') {
                showToast(t("Этот Email уже занят. Нажмите «Уже есть аккаунт? Войти»"), "info");
            } else if (error.code === 'auth/weak-password') {
                showToast(t("Пароль должен быть не менее 6 символов"), "shield");
            } else if (error.code === 'auth/invalid-email') {
                showToast(t("Неверный формат Email"), "mail");
            } else if (error.code === 'auth/too-many-requests') {
                showToast(t("Слишком много попыток. Подождите немного и повторите"), "clock");
            } else if (error.code === 'auth/network-request-failed') {
                showToast(t("Нет соединения с интернетом"), "offline");
            } else {
                showToast(t("Ошибка: {error}", { error: error.message }), "error"); 
            }
        }
      });

      // ===== ПОДТВЕРЖДЕНИЕ ПОЧТЫ КОДОМ =====
      // Обязательно для аккаунтов, созданных начиная с этой даты; старые аккаунты не трогаем
      const EMAIL_GATE_SINCE = Date.parse("2026-10-08T00:00:00Z");
      function needsEmailCode(user) {
          if (user.emailVerified) return false;
          if (user.email === ADMIN_EMAIL) return true; // права админа в правилах требуют подтверждённую почту
          const created = Date.parse(user.metadata && user.metadata.creationTime || "");
          return isFinite(created) && created >= EMAIL_GATE_SINCE;
      }
      const fmtWait = (sec) => { sec = Math.max(1, Number(sec) || 60); return sec < 90 ? t("{n} сек", { n: sec }) : t("{n} мин", { n: Math.ceil(sec / 60) }); };
      // Запрос к серверу писем: App Check обязателен, ID token — если вошли
      async function emailPost(path, data) {
          let ac = null; if (appCheck) try { ac = (await getAppCheckToken(appCheck)).token; } catch (e) { console.log("App Check токен:", e.code || e.message || e); }
          const token = auth.currentUser ? await auth.currentUser.getIdToken() : undefined;
          try {
              const res = await fetch(PUSH_SERVER + path, { method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify({ ...data, token, appCheck: ac }) });
              return { ok: res.ok, status: res.status, data: await res.json().catch(() => ({})) };
          } catch (e) { return { ok: false, status: 0, data: {} }; }
      }
      function showVerifyScreen(user) {
          const $v = (id) => document.getElementById(id);
          const owl = $v("owl-vf"), input = $v("otp-input"), wrap = $v("otp-wrap"), cells = wrap.querySelectorAll("span"), msg = $v("otp-msg");
          const resendBtn = $v("verify-resend"), verifyBtn = $v("verify-btn");
          const react = (k) => { owl.classList.remove("happy", "shake"); void owl.getBoundingClientRect(); owl.classList.add(k); };
          stopPresence(false);
          $v("global-loader").style.display = "none";
          $v("auth-screen").style.display = "none";
          $v("verify-screen").style.display = "flex";
          $v("verify-email").textContent = user.email;

          const paint = () => {
              const v = input.value;
              cells.forEach((c, i) => { c.textContent = v[i] || ""; c.classList.toggle("fill", !!v[i]); c.classList.toggle("cur", document.activeElement === input && i === Math.min(v.length, 4)); });
          };
          input.addEventListener("input", () => {
              input.value = input.value.replace(/\D/g, "").slice(0, 5);
              wrap.classList.remove("bad"); msg.textContent = ""; paint();
              if (input.value.length === 5) verify();
          });
          input.addEventListener("focus", paint); input.addEventListener("blur", paint);
          wrap.addEventListener("click", () => input.focus());

          let cooldownTimer = null;
          const cooldown = (sec) => {
              clearInterval(cooldownTimer); let left = Math.max(1, sec | 0);
              resendBtn.disabled = true;
              // «Письмо не приходит?» — только когда можно и запросить код заново: письмо с кодом обычно приходит за эти секунды,
              // а без паузы люди жмут ссылку сразу и получают второе (запасное) письмо от Firebase
              const linkBtn = $v("verify-by-link"); linkBtn.style.visibility = "hidden";
              const tick = () => { resendBtn.textContent = `${t("Отправить код ещё раз")} (${left})`; if (--left < 0) { clearInterval(cooldownTimer); resendBtn.disabled = false; resendBtn.textContent = t("Отправить код ещё раз"); linkBtn.style.visibility = ""; } };
              tick(); cooldownTimer = setInterval(tick, 1000);
          };
          const sentKey = "owl-otp-sent-" + user.uid;
          async function sendCode(manual) {
              resendBtn.disabled = true;
              const r = await emailPost("/email/send-code", { lang: LANG });
              if (r.ok && r.data.verified) return finish();
              if (r.ok) { try { sessionStorage.setItem(sentKey, String(Date.now())); } catch (_) {} if (manual) showToast(t("Новый код отправлен 🦉"), "bell"); cooldown(60); return; }
              if (r.status === 429) { cooldown(r.data.retryAfter || 60); if (manual) showToast(t("Слишком часто. Новый код можно запросить через {time}", { time: fmtWait(r.data.retryAfter) }), "shield"); return; }
              // Сервер писем недоступен — переходим на подтверждение ссылкой от Firebase
              resendBtn.disabled = false;
              if (r.status === 503 || r.status === 0 || r.status >= 500) return useLink(true);
              msg.textContent = t("Не удалось отправить код. Попробуйте ещё раз");
          }
          async function verify() {
              const code = input.value;
              if (code.length !== 5) { wrap.classList.add("bad"); msg.textContent = t("Введите все 5 цифр"); react("shake"); return; }
              verifyBtn.disabled = true; verifyBtn.textContent = t("Проверяем…");
              const r = await emailPost("/email/verify-code", { code });
              verifyBtn.disabled = false; verifyBtn.textContent = t("Подтвердить");
              if (r.ok) return finish();
              wrap.classList.add("bad"); react("shake"); input.value = ""; paint(); input.focus();
              const e = r.data.error;
              msg.textContent = e === "wrong code" ? (r.data.left > 0 ? t("Неверный код. Осталось попыток: {n}", { n: r.data.left }) : t("Неверный код. Запросите новый"))
                  : e === "expired" ? t("Код устарел — запросите новый")
                  : e === "too many tries" ? t("Слишком много попыток — запросите новый код")
                  : t("Не получилось проверить код. Попробуйте ещё раз");
          }
          async function finish() {
              react("happy"); $v("verify-title").textContent = t("Почта подтверждена!"); msg.textContent = "";
              try { sessionStorage.removeItem(sentKey); await user.reload(); await user.getIdToken(true); } catch (_) {}
              setTimeout(() => location.reload(), 900);
          }
          // Запасной путь: ссылка из стандартного письма Firebase
          async function useLink(auto) {
              $v("verify-code-box").style.display = "none"; $v("verify-link-box").style.display = "block";
              $v("verify-by-link").style.display = "none"; resendBtn.style.display = "none";
              $v("verify-text").innerHTML = "";
              $v("verify-text").append(t("Мы отправили ссылку для подтверждения на") + " ", Object.assign(document.createElement("b"), { textContent: user.email }), t(". Откройте письмо, перейдите по ссылке и вернитесь сюда."));
              try { auth.languageCode = LANG; await sendEmailVerification(user, { url: "https://owlmes.ru/" }); } // письмо Firebase — на языке приложения
              catch (e) { showToast(e.code === "auth/too-many-requests" ? t("Письмо уже отправлено недавно — проверьте почту и папку «Спам»") : t("Не удалось отправить письмо, попробуйте позже"), "alert"); }
              if (auto) console.log("Сервер писем недоступен — подтверждение по ссылке");
          }
          verifyBtn.addEventListener("click", verify);
          resendBtn.addEventListener("click", () => sendCode(true));
          $v("verify-by-link").addEventListener("click", () => useLink(false));
          $v("verify-link-done").addEventListener("click", async () => {
              try { await user.reload(); } catch (_) {}
              if (auth.currentUser && auth.currentUser.emailVerified) finish();
              else showToast(t("Почта ещё не подтверждена — откройте ссылку из письма (проверьте и «Спам»)"), "alert");
          });
          $v("verify-logout").addEventListener("click", () => { $v("verify-screen").style.display = "none"; signOut(auth); });

          paint();
          // Код отправляем сами, но не чаще раза в минуту при перезагрузках
          let last = 0; try { last = Number(sessionStorage.getItem(sentKey)) || 0; } catch (_) {}
          if (Date.now() - last > 60000) sendCode(false); else cooldown(60 - Math.floor((Date.now() - last) / 1000));
          setTimeout(() => input.focus(), 400);
      }

      onAuthStateChanged(auth, async (user) => {
        if (user) {
          currentUser = user; isAdmin = (user.email === ADMIN_EMAIL);
          if(isAdmin) { document.getElementById("admin-badge").style.display = "inline-flex"; document.getElementById("dev-panel-btn").style.display = "flex"; }
          mfaRefresh();
          ["my-verified-badge", "settings-verified-badge"].forEach(id => document.getElementById(id).setAttribute("data-verified-uid", user.uid));
          ["my-premium-badge", "settings-premium-badge"].forEach(id => document.getElementById(id).setAttribute("data-premium-uid", user.uid));

          // Аккаунт удалён админом — профиль заново не создаём, показываем экран и выходим
          try { if ((await getDoc(doc(db, "deleted_accounts", user.uid))).exists()) { showDeletedScreen(); return; } } catch (_) {}
          // Новые аккаунты сначала подтверждают почту кодом из письма
          if (needsEmailCode(user)) { showVerifyScreen(user); return; }

          try { await createProfileAfterVerify(user); } catch (e) { console.log("Профиль после подтверждения почты:", e.code || e); }
          let safeName = user.displayName || "Загрузка...";
          // Ник пишем, только если он уже есть (при регистрации он появится чуть позже — его занимает claimNickname)
          // Email храним в закрытой users_private (видят только сам человек и админ). В публичном профиле он
          // остаётся только у официального аккаунта — по нему рисуется синяя галочка.
          // owlv — версия приложения: по ней звонящий знает, что у собеседника Owl с видео (у старых версий видеоканал ломал бы звук на iPhone)
          let baseProfile = { uid: user.uid, owlv: OWL_SHELL, email: (user.email === ADMIN_EMAIL) ? user.email : deleteField() };
          setDoc(doc(db, "users_private", user.uid), { uid: user.uid, email: user.email || "" }, { merge: true }).catch(e => console.log("users_private:", e.code));
          if (user.displayName) { baseProfile.name = user.displayName; baseProfile.nameLower = nickKey(user.displayName); }
          await setDoc(doc(db, "users", user.uid), baseProfile, { merge: true });

          document.getElementById("auth-screen").style.display = "none"; 
          document.getElementById("my-name").innerText = safeName; 
          document.getElementById("my-avatar").src = getAvatar(user.uid, safeName);
          document.getElementById("my-email-display").innerText = user.email;

          startDatabaseListeners(); 
          startNotificationsListener();
          startBanListeners();
          startBlockListeners();
          startCallsListener();
          setTimeout(pushNudge, 20000);
          setTimeout(markActiveToday, 3000);
          startPresence();
          if (user.displayName) ensureProfileMigrated(user);
          if (pushEnabled()) serverPushSubscribe(); // привязываем устройство к аккаунту (и обновляем подписку)

          renderChatList();
          // Глобальный чат больше не открывается сам при входе (это 30 чтений при каждом запуске) — показываем заставку
          showChatPlaceholder(true);

          // СКРЫВАЕМ ЭКРАН ЗАГРУЗКИ И ПОКАЗЫВАЕМ ПРИЛОЖЕНИЕ ЧЕРЕЗ СЕКУНДУ
          setTimeout(() => {
              // Упрощённый режим: без растворения — иначе заставка гаснет мгновенно и 0,4 с виден пустой экран
              if (simpleMode()) { document.getElementById("global-loader").style.display = "none"; document.getElementById("app-container").style.display = "flex"; return; }
              document.getElementById("global-loader").style.opacity = "0";
              setTimeout(() => {
                  document.getElementById("global-loader").style.display = "none";
                  document.getElementById("app-container").style.display = "flex";
              }, 400);
          }, 1000);

        } else {
          // Вышли из аккаунта — перезапускаем приложение начисто, чтобы данные и права
          // прошлого аккаунта (например, панель разработчика) не достались следующему
          // Заодно стираем личное с устройства: черновики и прочее (clearPersonalData) и офлайн-копию переписки (хранилище Firestore)
          if (currentUser) {
              clearTimeout(draftTimer); clearPersonalData();
              const wait = (ms) => new Promise(r => setTimeout(r, ms));
              try { await Promise.race([waitForPendingWrites(db).catch(() => {}), wait(1500)]); await terminate(db); await Promise.race([clearIndexedDbPersistence(db), wait(2000)]); }
              catch (e) { console.log("Очистка офлайн-копии:", e.code || e.message); } // открыт в другой вкладке — сотрётся при следующем выходе
              location.reload(); return;
          }
          document.getElementById("global-loader").style.display = "none";
          document.getElementById("auth-screen").style.display = "flex"; 
          document.getElementById("app-container").style.display = "none";
          if(notificationsListener) notificationsListener(); 
          stopPresence(false);
          stopBanListeners();
        }
      });

      // Телефон: чат выезжает справа и уезжает обратно (при свайпе от края он уже сдвинут пальцем — тогда без анимации)
      let chatPaneTimer = null;
      function openChatPane() {
          const app = document.getElementById("app-container");
          if (app.classList.contains("chat-active") && !app.classList.contains("chat-closing")) return;
          clearTimeout(chatPaneTimer); app.classList.remove("chat-closing");
          app.classList.add("chat-active");
          if (reduceMotion()) return;
          app.classList.add("chat-opening");
          chatPaneTimer = setTimeout(() => app.classList.remove("chat-opening"), 340);
      }
      document.getElementById("mobile-back-btn").addEventListener("click", () => {
          const app = document.getElementById("app-container"), main = document.getElementById("main-chat");
          document.querySelectorAll('.chat-item').forEach(el => el.classList.remove('active'));
          clearTimeout(chatPaneTimer); app.classList.remove("chat-opening");
          if (reduceMotion() || main.style.transform || window.innerWidth > 768) { app.classList.remove("chat-active", "chat-closing"); return; }
          app.classList.add("chat-closing");
          chatPaneTimer = setTimeout(() => app.classList.remove("chat-active", "chat-closing"), 270);
      });

      // «Печатает...» — пишем не на каждую букву, а не чаще раза в 3 секунды (раньше каждая буква = запись в базу)
      let typingTimer; let typingListener = null; let lastTypingWrite = 0;
      document.getElementById("message-input").addEventListener("input", () => {
          if(!currentUser || !currentChatId || currentChatId === 'global' || currentChatId === NEWS_ID || isNest(currentChatId)) return;
          if (!myPrivacy("typing")) return;
          let docId = currentChatId + "_" + currentUser.uid;
          if (Date.now() - lastTypingWrite > 3000) {
              lastTypingWrite = Date.now();
              setDoc(doc(db, "typing", docId), { chatId: currentChatId, uid: currentUser.uid, name: currentUser.displayName, isTyping: true, timestamp: new Date() }, {merge: true}).catch(() => {});
          }
          clearTimeout(typingTimer); typingTimer = setTimeout(() => { lastTypingWrite = 0; setDoc(doc(db, "typing", docId), { isTyping: false, timestamp: new Date() }, {merge: true}).catch(() => {}); }, 3000);
      });

      // Хелпер для умной отрисовки реакций
      // Реакции — только из нашего набора: чужое значение из базы (например, подсунутый HTML) не показываем.
      // ❤ без «эмодзи-модификатора» компьютер рисует белым символом — показываем с ним (❤️)
      const REACTION_SET = new Set(["❤", "👍", "😂", "🔥", "😮", "😢", "👏", "🎉", "😍", "🤔", "💯", "🙏"]);
      const rxShow = (r) => r === "❤" ? "❤️" : r;
      window.buildReactionsHtml = function(msg) {
          let html = "";
          if (msg.reactions && Object.keys(msg.reactions).length > 0 && SAFE_ID.test(msg.id)) {
              let counts = {}; for(let u in msg.reactions) { let r = msg.reactions[u]; if (REACTION_SET.has(r)) counts[r] = (counts[r] || 0) + 1; }
              if (!Object.keys(counts).length) return "";
              html += `<div class="reactions-list">`;
              for(let r in counts) { html += `<span class="reaction-badge" data-r="${r}" data-n="${counts[r]}">${rxShow(r)} ${counts[r]}</span>`; }
              html += `</div>`;
          }
          return html;
      };

      let initialChatLoads = {}; 
      let loadedMsgs = {};
      // Номера документов, которые мы вставляем в разметку: настоящие всегда из латиницы и цифр.
      // Документ с «хитрым» номером (кавычки, скобки) мог бы выполнить чужой код — такие не показываем вовсе
      const SAFE_ID = /^[A-Za-z0-9]{1,40}$/;

      // Подгрузка истории: при прокрутке вверх увеличиваем лимит и переподписываемся
      const PAGE_SIZE = 30;
      let msgLimit = PAGE_SIZE, hasMoreMsgs = true, loadingOlder = false, subscribeMessages = null;
      function loadOlderMessages() {
          if (!subscribeMessages || !hasMoreMsgs || loadingOlder) return;
          loadingOlder = true; msgLimit += PAGE_SIZE; subscribeMessages();
      }
      document.getElementById("chat-box").addEventListener("scroll", e => { if (e.target.scrollTop < 150) loadOlderMessages(); }, { passive: true });

      // Отмечаем прочитанным только то, что человек реально видит: вкладка активна и чат открыт на экране
      function chatIsOnScreen() {
          if (document.visibilityState !== "visible") return false;
          if (window.innerWidth <= 768 && !document.getElementById("app-container").classList.contains("chat-active")) return false;
          return true;
      }
      function markVisibleAsRead() {
          if (!currentUser || !currentChatId || currentChatId === 'global' || currentChatId === NEWS_ID || !chatIsOnScreen()) return; // в канале «прочитано» не ставится (правила и не дают)
          if (!myPrivacy("readReceipts")) return; // человек выключил отметки о прочтении
          let batch = writeBatch(db); let n = 0;
          Object.values(loadedMsgs).forEach(m => {
              if (m.chatId === currentChatId && m.uid !== currentUser.uid && !m.read) { batch.update(doc(db, "messages", m.id), { read: true }); m.read = true; n++; }
          });
          if (n) batch.commit().catch(e => console.error("Не удалось отметить прочитанным (проверьте правила Firestore):", e));
      }
      document.addEventListener("visibilitychange", markVisibleAsRead);
      window.addEventListener("focus", markVisibleAsRead);

      const OFFICIAL_BADGE_13 = `<span style="display:inline-flex; align-items:center; margin-left:4px; transform:translateY(1px);" title="${t("Официальный аккаунт")}"><svg viewBox="0 0 24 24" width="13" height="13" fill="#3390ec"><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zm-1.9 14.7L6 12.6l1.5-1.5 2.6 2.6 6.4-6.4 1.5 1.5-7.9 7.9z"/></svg></span>`;
      // ===== СОЕДИНЕНИЕ: плашка «Нет соединения» =====
      // offline — браузер говорит, что сети нет; slow — сеть вроде есть, но мои сообщения висят неотправленными
      const pendingSince = {}; // id моего сообщения → когда заметили, что оно ещё не дошло до сервера
      let netState = "ok", netBackTimer = null;
      function trackPendingWrites(snapshot) {
          snapshot.forEach(d => {
              if (d.metadata.hasPendingWrites && d.data().uid === currentUser?.uid) { if (!pendingSince[d.id]) pendingSince[d.id] = Date.now(); }
              else delete pendingSince[d.id];
          });
          evalNet();
      }
      function setNet(state) {
          if (state === netState) return;
          const prev = netState; netState = state;
          const b = document.getElementById("net-banner"), nt = document.getElementById("net-banner-text");
          clearTimeout(netBackTimer);
          b.classList.remove("offline", "slow", "back");
          if (state === "ok") { b.classList.remove("show"); return; }
          if (state === "back" && prev === "ok") { netState = "ok"; return; }
          b.classList.add(state, "show");
          nt.innerText = state === "offline" ? t("Нет сети — отправим позже")
              : state === "slow" ? t("Подключаемся…")
              : t("Соединение восстановлено");
          if (state === "back") netBackTimer = setTimeout(() => setNet("ok"), 2200);
      }
      function evalNet() {
          if (!navigator.onLine) return setNet("offline");
          const times = Object.values(pendingSince);
          if (times.length && Date.now() - Math.min(...times) > 6000) return setNet("slow");
          if (netState === "offline" || netState === "slow") setNet("back");
      }
      window.addEventListener("online", evalNet);
      window.addEventListener("offline", evalNet);
      setInterval(evalNet, 2000);
      evalNet();

      // ===== СТАТИСТИКА =====
      // stats/{ГГГГ-ММ-ДД по Москве}: messages — сколько сообщений за день, active — кто заходил (только счётчик для панели)
      const dayKey = (offset = 0) => new Date(Date.now() + 3 * 3600e3 + offset * 864e5).toISOString().slice(0, 10);
      const dayOf = (t) => new Date(t + 3 * 3600e3).toISOString().slice(0, 10);
      function markActiveToday() {
          if (!currentUser || isAdmin) return;
          const k = dayKey(), ls = "owl-active-" + currentUser.uid;
          try { if (localStorage.getItem(ls) === k) return; } catch (_) {}
          setDoc(doc(db, "stats", k), { active: { [currentUser.uid]: true } }, { merge: true })
              .then(() => { try { localStorage.setItem(ls, k); } catch (_) {} })
              .catch(e => console.log("stats:", e.code));
      }
      document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") markActiveToday(); });
      let statsDocs = null, statsLoading = false;
      async function loadStats() {
          if (statsLoading) return; statsLoading = true;
          try {
              const snap = await getDocs(query(collection(db, "stats"), where(documentId(), ">=", dayKey(-29))));
              statsDocs = {}; snap.forEach(d => { statsDocs[d.id] = d.data(); });
          } catch (e) { console.log("Статистика:", e.code); statsDocs = { __error: e.code || "error" }; }
          statsLoading = false; renderDevPanel();
      }
      const fmtDay = (k) => new Date(k + "T12:00:00").toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
      function barChart(title, series, note) {
          const max = Math.max(1, ...series.map(x => x.v));
          const step = max <= 4 ? 1 : Math.ceil(max / 4);
          const top = Math.ceil(max / step) * step;
          let grid = ""; for (let g = step; g <= top; g += step) grid += `<div class="gl" style="bottom:${g / top * 100}%"><i>${g}</i></div>`;
          const bars = series.map(x => `<div class="st-bar${x.v ? "" : " zero"}" data-tip="${escapeHTML(fmtDay(x.k))}" data-v="${x.v}"><u style="height:${x.v / top * 100}%"></u></div>`).join("");
          const total = series.reduce((a, x) => a + x.v, 0);
          return `<div class="st-chart"><h4>${title}<small>${note || "за 30 дней: " + total}</small></h4><div class="st-plot">${grid}${bars}</div>
              <div class="st-axis"><span>${fmtDay(series[0].k)}</span><span>${fmtDay(series[15].k)}</span><span>сегодня</span></div><div class="st-tip"></div></div>`;
      }
      function renderStats() {
          const box = document.getElementById("dev-list");
          if (!statsDocs) { box.innerHTML = `<div class="dev-empty">Загружаем статистику…</div>`; loadStats(); return; }
          if (statsDocs.__error) { box.innerHTML = `<div class="dev-empty">Нет доступа к статистике (${escapeHTML(statsDocs.__error)}). Нужно правило Firestore для коллекции stats.</div>`; return; }
          const days = Array.from({ length: 30 }, (_, i) => dayKey(i - 29));
          const activeOf = (k) => Object.keys((statsDocs[k] || {}).active || {}).length;
          const msgsOf = (k) => (statsDocs[k] || {}).messages || 0;
          const union = (n) => { const set = new Set(); days.slice(-n).forEach(k => Object.keys((statsDocs[k] || {}).active || {}).forEach(u => set.add(u))); return set.size; };
          const users = Object.values(usersCache).filter(u => u && u.uid && u.name);
          const regs = {}; users.forEach(u => { const t = createdAtOf(u); if (t) { const k = dayOf(t); regs[k] = (regs[k] || 0) + 1; } });
          const sum = (arr) => arr.reduce((a, b) => a + b, 0);
          const inv = {}; users.forEach(u => { const by = (privateDocs[u.uid] || {}).invitedByNick || u.invitedByNick; if (by) { const k = nickKey(by); inv[k] = inv[k] || { name: by, n: 0 }; inv[k].n++; } });
          const invList = Object.values(inv).sort((a, b) => b.n - a.n);
          const since = Object.keys(statsDocs).sort()[0];
          box.innerHTML = `
            <div class="st-kpis">
              <div class="st-kpi"><b>${activeOf(dayKey())}</b><span>Активны сегодня</span></div>
              <div class="st-kpi"><b>${union(7)}</b><span>Активны за 7 дней</span></div>
              <div class="st-kpi"><b>${union(30)}</b><span>Активны за 30 дней</span></div>
              <div class="st-kpi"><b>${msgsOf(dayKey())}</b><span>Сообщений сегодня</span></div>
              <div class="st-kpi"><b>${sum(days.slice(-7).map(msgsOf))}</b><span>Сообщений за 7 дней</span></div>
              <div class="st-kpi"><b>${sum(days.slice(-7).map(k => regs[k] || 0))}</b><span>Регистраций за 7 дней</span></div>
              <div class="st-kpi"><b>${sum(invList.map(x => x.n))}</b><span>Пришли по приглашению</span></div>
              <div class="st-kpi"><b>${users.length}</b><span>Всего пользователей</span></div>
            </div>
            <p class="st-note">${since ? "Активность и сообщения считаются с " + fmtDay(since) + "." : "Счётчики начнут заполняться, как только люди откроют новую версию."} Ваш аккаунт в активных не учитывается.</p>
            ${barChart("Активные пользователи", days.map(k => ({ k, v: activeOf(k) })), "в день")}
            ${barChart("Сообщения", days.map(k => ({ k, v: msgsOf(k) })))}
            ${barChart("Регистрации", days.map(k => ({ k, v: regs[k] || 0 })))}
            <div class="st-chart"><h4>Кто приводит друзей<small>по ссылкам-приглашениям</small></h4>
              ${invList.length ? invList.slice(0, 10).map(x => `<div class="st-inv"><span>${escapeHTML(x.name)}</span><b>${x.n}</b></div>`).join("") : `<div class="st-note" style="margin:6px 0">Пока никто не пришёл по приглашению</div>`}
            </div>
            ${readsBlock()}
            <div style="text-align:center;margin:4px 0 8px"><button class="ob-mini-btn" id="st-refresh">${icon("clock", 16)}Обновить</button></div>`;
      }
      // Чтения базы с этого устройства за текущие сутки квоты — откуда берутся (чтобы понимать, что оптимизировать)
      function readsBlock() {
          if (readStats.day !== readDay()) readStats = { day: readDay(), total: 0, by: {} };
          const rows = Object.entries(readStats.by).sort((a, b) => b[1] - a[1]).slice(0, 12);
          return `<div class="st-chart"><h4>Чтения базы с этого устройства<small>с 10:00 МСК, примерно · лимит проекта 50 000 в сутки</small></h4>
              <div class="st-inv"><span><b>Всего</b></span><b>${readStats.total.toLocaleString("ru")}</b></div>
              ${rows.map(([k, v]) => `<div class="st-inv"><span>${escapeHTML(k)}</span><b>${v.toLocaleString("ru")}</b></div>`).join("") || `<div class="st-note" style="margin:6px 0">Пока ничего</div>`}
            </div>`;
      }
      // Подсказка при наведении на столбик
      document.getElementById("dev-list").addEventListener("mousemove", (e) => {
          const bar = e.target.closest(".st-bar"), chart = e.target.closest(".st-chart");
          document.querySelectorAll(".st-tip").forEach(t => { if (!chart || t.parentElement !== chart) t.style.display = "none"; });
          if (!bar || !chart) return;
          const tip = chart.querySelector(".st-tip"), cr = chart.getBoundingClientRect(), br = bar.getBoundingClientRect();
          tip.innerHTML = `${bar.dataset.tip}: <b>${bar.dataset.v}</b>`;
          tip.style.display = "block";
          tip.style.left = Math.max(40, Math.min(cr.width - 40, br.left - cr.left + br.width / 2)) + "px";
          tip.style.top = (br.top - cr.top + 4) + "px";
      });
      document.getElementById("dev-list").addEventListener("mouseleave", () => document.querySelectorAll(".st-tip").forEach(t => t.style.display = "none"));
      document.getElementById("dev-list").addEventListener("click", (e) => { if (e.target.closest("#st-refresh")) { statsDocs = null; renderDevPanel(); } });

      // ===== ПРИГЛАШЕНИЯ: owlmes.ru/?add=ник открывает профиль человека =====
      const inviteLink = () => "https://owlmes.ru/?add=" + encodeURIComponent(usersCache[currentUser.uid]?.name || currentUser.displayName || "");
      async function shareInvite(btn) {
          const url = inviteLink(), name = usersCache[currentUser.uid]?.name || currentUser.displayName || "";
          const text = t("Привет! Я в Owl — пиши мне, мой ник {name}", { name });
          try {
              // Ссылку кладём прямо в текст: многие приложения (мессенджеры, «Скопировать») при отдельном url берут только текст
              if (navigator.share) { await navigator.share({ text: text + "\n" + url }); return; }
          } catch (e) { if (e && e.name === "AbortError") return; }
          try { await navigator.clipboard.writeText(text + "\n" + url); showToast(t("Ссылка скопирована"), "check"); if (btn) { btn.classList.add("done"); btn.innerHTML = icon("check", 16) + t("Скопировано"); } }
          catch (_) { prompt(t("Скопируйте ссылку:"), url); }
      }
      try { const add = new URLSearchParams(location.search).get("add"); if (add) { window.__pendingAdd = add; try { localStorage.setItem("owl-invite", add.slice(0, 40)); } catch (_) {} } } catch (_) {}
      async function openPendingInvite() {
          const nick = window.__pendingAdd; if (!nick || !currentUser) return;
          window.__pendingAdd = null;
          try { history.replaceState(null, "", location.pathname); } catch (_) {}
          const key = nickKey(nick);
          let u = Object.values(usersCache).find(x => x && (x.nameLower === key || x.nameKey === key));
          if (!u) {
              try { const snap = await getDocs(query(collection(db, "users"), where("nameLower", "==", key), limit(1))); snap.forEach(d => { u = d.data(); window.__ingestUser(u, true); u = usersCache[u.uid]; }); } catch (e) { console.log("Приглашение:", e.code || e); }
          }
          if (!u) return showToast(t("Пользователь {name} не найден", { name: nick }), "alert");
          if (u.uid === currentUser.uid) return;
          openPublicProfile(u.uid);
      }

      // ===== ПЕРВЫЙ ЗАПУСК =====
      // Показываем новым аккаунтам (зарегистрированы меньше 3 дней назад) один раз; отметка — users_private/{я}.onboarded
      let obShown = false, obIndex = 0;
      const OB_COUNT = 4;
      const isStandalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
      const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
      function maybeShowOnboarding() {
          if (obShown || !currentUser || isAdmin || iAmBanned) return;
          const me = usersCache[currentUser.uid];
          if (!me || !myPrivate || me.onboarded || !me.name || me.name === "Загрузка...") return;
          const created = createdAtOf(me);
          if (!created || Date.now() - created > 3 * 24 * 60 * 60 * 1000) return;
          obShown = true;
          document.getElementById("ob-hello").innerText = t("Добро пожаловать, {name}!", { name: me.name });
          document.getElementById("ob-nick").innerText = "@" + me.name;
          const inv = document.getElementById("ob-invite-btn"); inv.innerHTML = icon("users", 16) + t("Пригласить друга");
          const body = document.getElementById("ob-install-body");
          if (!isStandalone() && /Mobi|Android|iPhone|iPad/.test(navigator.userAgent + (isIOS() ? "iPhone" : ""))) {
              document.getElementById("ob-install-title").innerText = t("Установите Owl на телефон");
              document.getElementById("ob-install-icon").innerHTML = '<svg viewBox="0 0 24 24" width="40" height="40" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"></rect><line x1="12" y1="18" x2="12.01" y2="18"></line></svg>';
              body.innerHTML = isIOS()
                  ? `<ul class="ob-steps"><li>${t("Нажмите на меню у адреса в Safari (≡ или «•••»)")}</li><li>${t("Выберите «Поделиться» → «На экран „Домой“»")}</li><li>${t("Нажмите «Добавить» — Owl появится среди приложений, и придут уведомления")}</li></ul>`
                  : `<ul class="ob-steps"><li>${t("Нажмите на три точки ⋮ в Chrome")}</li><li>${t("Выберите «Установить приложение» или «Добавить на главный экран»")}</li><li>${t("Откройте Owl с иконки и включите уведомления")}</li></ul>`;
          } else {
              document.getElementById("ob-install-title").innerText = t("Не пропускайте сообщения");
              const on = pushEnabled();
              body.innerHTML = `<p>${t("Включите уведомления — сообщения будут приходить, даже когда Owl закрыт.")}</p><button class="ob-mini-btn${on ? " done" : ""}" id="ob-push-btn">${icon(on ? "check" : "bell", 16)}${on ? t("Уведомления включены") : t("Включить уведомления")}</button>`;
              const pb = document.getElementById("ob-push-btn");
              if (!on) pb.addEventListener("click", () => {
                  const tog = document.getElementById("push-toggle"); tog.checked = true; tog.dispatchEvent(new Event("change"));
                  setTimeout(() => { if (pushEnabled()) { pb.classList.add("done"); pb.innerHTML = icon("check", 16) + t("Уведомления включены"); } }, 1500);
              });
          }
          obGo(0);
          document.getElementById("onboarding-screen").style.display = "flex";
      }
      function obGo(i) {
          obIndex = Math.max(0, Math.min(OB_COUNT - 1, i));
          document.getElementById("ob-track").style.transform = `translateX(-${obIndex * 100}%)`;
          document.querySelectorAll("#ob-dots i").forEach((d, k) => d.classList.toggle("on", k === obIndex));
          document.getElementById("ob-next").innerText = obIndex === OB_COUNT - 1 ? t("Начать общение") : t("Далее");
          document.getElementById("ob-skip").style.visibility = obIndex === OB_COUNT - 1 ? "hidden" : "visible";
      }
      function obFinish() {
          document.getElementById("onboarding-screen").style.display = "none";
          if (currentUser) setDoc(doc(db, "users_private", currentUser.uid), { onboarded: true }, { merge: true }).catch(e => console.log("onboarded:", e.code));
      }
      document.getElementById("ob-next").addEventListener("click", () => obIndex === OB_COUNT - 1 ? obFinish() : obGo(obIndex + 1));
      document.getElementById("ob-skip").addEventListener("click", obFinish);
      document.getElementById("st-invite").addEventListener("click", (e) => { e.preventDefault(); shareInvite(); });
      document.getElementById("ob-invite-btn").addEventListener("click", (e) => shareInvite(e.currentTarget));
      document.getElementById("chat-list").addEventListener("click", (e) => { const b = e.target.closest("[data-invite]"); if (b) { e.stopPropagation(); shareInvite(b); } }, true);
      // Свайп по карточкам
      (() => {
          let x0 = null; const box = document.querySelector("#onboarding-screen .modal-box");
          box.addEventListener("touchstart", (e) => { x0 = e.touches[0].clientX; }, { passive: true });
          box.addEventListener("touchend", (e) => { if (x0 === null) return; const dx = e.changedTouches[0].clientX - x0; x0 = null; if (Math.abs(dx) > 50) obGo(obIndex + (dx < 0 ? 1 : -1)); }, { passive: true });
      })();

      // ===== КОНФИДЕНЦИАЛЬНОСТЬ =====
      // users/{uid}.privacy = { showFollows, canMessage, groupAdd }: "all" | "following" (люди, на которых подписан владелец) | "nobody"
      const PRIVACY_BOOL_DEFAULTS = { showCounts: true, readReceipts: true, typing: true, searchable: true };
      const privacyOf = (u, key) => {
          const p = (u && u.privacy) || {};
          if (key in PRIVACY_BOOL_DEFAULTS) return p[key] === undefined ? PRIVACY_BOOL_DEFAULTS[key] : !!p[key];
          if (key === "lastSeen" && !p.lastSeen && u && u.hideOnline) return "nobody";
          return p[key] || ((key === "showFollowers" || key === "showFollowing") && p.showFollows) || "all"; // showFollows — старая общая настройка
      };
      const myPrivacy = (key) => privacyOf(currentUser && usersCache[currentUser.uid], key);
      const followsMe = (u) => !!(u && currentUser && ((myFollowsIn && myFollowsIn.has(u.uid)) || (u.following || []).includes(currentUser.uid))); // владелец профиля подписан на меня
      function allowedBy(u, key) {
          if (!currentUser) return false;
          if (!u) return true; // профиль ещё не загружен — не мешаем; окончательно проверяют правила базы
          if (isAdmin || u.uid === currentUser.uid) return true;
          const p = privacyOf(u, key);
          return p === "all" || (p === "following" && followsMe(u));
      }
      const canWriteTo = (uid) => allowedBy(usersCache[uid], "canMessage");
      const canAddToGroup = (uid) => allowedBy(usersCache[uid], "groupAdd");
      const PV_SHORT = { all: t("все"), following: t("подписки"), nobody: t("никто") };
      function renderPrivacySettings() {
          const me = usersCache[currentUser?.uid]; if (!me) return;
          document.querySelectorAll("[data-privacy]").forEach(sel => { sel.value = privacyOf(me, sel.getAttribute("data-privacy")); });
          document.querySelectorAll("[data-privacy-bool]").forEach(cb => { cb.checked = privacyOf(me, cb.getAttribute("data-privacy-bool")); });
          document.getElementById("pv-sum").textContent = `${t("В сети:")} ${PV_SHORT[privacyOf(me, "lastSeen")]} · ${t("Писать:")} ${PV_SHORT[privacyOf(me, "canMessage")]}`;
      }
      async function savePrivacy(key, val, quiet = false) {
          const me = usersCache[currentUser.uid];
          const patch = { privacy: { [key]: val } };
          const b = writeBatch(db), rRef = R_FIELDS[key] && doc(db, "restricted", currentUser.uid + "_" + key);
          if (key === "lastSeen") {
              // «Никто» — время визита не пишем вовсе (старый механизм hideOnline); «Подписки» — только в закрытый документ
              const now = { online: true, lastSeen: new Date() };
              if (val === "all") { Object.assign(patch, { hideOnline: false, ...now }); b.delete(rRef); }
              else { Object.assign(patch, { hideOnline: val === "nobody", online: false, lastSeen: deleteField() }); val === "nobody" ? b.delete(rRef) : b.set(rRef, { uid: currentUser.uid, ...now }); }
          } else if (rRef) {
              const vals = me ? pickFields(me, key) : {};
              if (val === "all") { Object.assign(patch, vals); b.delete(rRef); }
              else { R_FIELDS[key].forEach(f => { patch[f] = deleteField(); }); b.set(rRef, { uid: currentUser.uid, ...vals }); }
          }
          b.set(doc(db, "users", currentUser.uid), patch, { merge: true });
          try {
              await b.commit();
              if (me) { me.privacy = { ...(me.privacy || {}), [key]: val }; if (key === "lastSeen") me.hideOnline = val === "nobody"; }
              renderPrivacySettings(); renderOwlEye();
              if (!quiet) showToast(t("Сохранено"), "shield");
              return true;
          } catch (e) { console.error(e); showToast(t("Не удалось сохранить"), "error"); renderPrivacySettings(); renderOwlEye(); return false; }
      }

      // ===== «СОВИНЫЙ ВЗГЛЯД»: кто видит мои данные — наглядно, с отметкой, что гарантирует база =====
      const EYE_ROWS = [
          { key: "photo", title: t("Фото профиля"), ico: "camera", db: true, opts: ["all", "following"] },
          { key: "bio", title: t("«О себе»"), ico: "pencil", db: true, opts: ["all", "following", "nobody"] },
          { key: "lastSeen", title: t("Когда я в сети"), ico: "clock", db: true, opts: ["all", "following", "nobody"] },
          { key: "showFollowers", title: t("Список подписчиков"), ico: "users", db: true, opts: ["all", "following", "nobody"] },
          { key: "showFollowing", title: t("Список подписок"), ico: "users", db: true, opts: ["all", "following", "nobody"] },
          { key: "canMessage", title: t("Кто может мне писать"), ico: "mail", db: true, opts: ["all", "following"], verb: "могут" },
          { key: "groupAdd", title: t("Кто может звать в беседы"), ico: "users", db: true, opts: ["all", "following", "nobody"], verb: "могут" },
          { key: "searchable", title: t("Находят по нику"), ico: "search", db: false, bool: true },
          { key: "readReceipts", title: t("Видят, что я прочитал"), ico: "check", db: false, bool: true },
          { key: "typing", title: t("Видят «печатает…»"), ico: "pencil", db: false, bool: true },
      ];
      const EYE_OPT = { all: t("Все"), following: t("Подписки"), nobody: t("Никто") };
      // Режим невидимки: что закрываем (прежние значения сохраняем в users_private.prevPrivacy, чтобы вернуть одной кнопкой)
      const STEALTH = { photo: "following", bio: "following", lastSeen: "nobody", showFollowers: "nobody", showFollowing: "nobody", searchable: false };
      function eyeAudience(r, v) {
          const n = (usersCache[currentUser.uid]?.following || []).length;
          if (r.bool) return v ? { t: t("Да"), c: "open" } : { t: t("Нет — скрыто"), c: "closed" };
          if (v === "all") return { t: t("Все пользователи Owl"), c: "open" };
          if (v === "following") return { t: t("Только мои подписки") + " · " + tp(n, "человек|человека|человек"), c: "closed" };
          return { t: t("Никто, кроме меня"), c: "closed" };
      }
      function renderOwlEye() {
          const screen = document.getElementById("owl-eye-screen");
          if (!currentUser || screen.style.display === "none") return;
          const me = usersCache[currentUser.uid] || {};
          let closed = 0;
          const rows = EYE_ROWS.map(r => {
              const v = privacyOf(me, r.key), a = eyeAudience(r, v);
              if (a.c === "closed") closed++;
              const ctl = r.bool
                  ? `<label class="st-toggle"><input type="checkbox" data-eye-bool="${r.key}" ${v ? "checked" : ""}><span></span></label>`
                  : `<select class="st-sel" data-eye="${r.key}">${r.opts.map(o => `<option value="${o}" ${o === v ? "selected" : ""}>${EYE_OPT[o]}</option>`).join("")}</select>`;
              return `<div class="eye-row"><span class="eye-ico">${icon(r.ico, 17)}</span><span class="eye-txt"><b>${r.title} ${r.db ? `<span class="eye-db" title="${t("Гарантирует база данных")}">${icon("shield", 13)}</span>` : ""}</b><span class="${a.c}">${a.t}</span></span>${ctl}</div>`;
          });
          rows.unshift(`<div class="eye-row"><span class="eye-ico">${icon("mail", 17)}</span><span class="eye-txt"><b>${t("Почта")} <span class="eye-db" title="${t("Гарантирует база данных")}">${icon("shield", 13)}</span></b><span class="closed">${t("Только я — всегда")}</span></span></div>`);
          document.getElementById("eye-list").innerHTML = rows.join("");
          document.getElementById("eye-legend-ico").innerHTML = icon("shield", 13);
          const total = EYE_ROWS.length, ratio = closed / total;
          const lvl = (ratio >= .7 ? ["Сова-невидимка", "Почти всё о вас скрыто от посторонних"] : ratio >= .3 ? ["Осторожная сова", "Часть данных видят только ваши подписки"] : ["Открытая сова", "Большинство данных видят все пользователи"]).map(x => t(x));
          document.getElementById("eye-level").textContent = lvl[0];
          document.getElementById("eye-sub").textContent = `${lvl[1]} · ${t("скрыто {a} из {b}", { a: closed, b: total })}`;
          const lid = Math.round(3 + ratio * 19); // веки прикрываются тем сильнее, чем закрытее профиль
          ["eye-lid-l", "eye-lid-r"].forEach(id => document.getElementById(id).setAttribute("height", lid));
          const prev = myPrivate && myPrivate.prevPrivacy, st = document.getElementById("eye-stealth");
          st.classList.toggle("back", !!prev);
          st.textContent = prev ? t("Вернуть как было") : t("Режим невидимки — скрыть всё разом");
      }
      async function toggleStealth(btn) {
          const me = usersCache[currentUser.uid] || {}, prev = myPrivate && myPrivate.prevPrivacy;
          btn.disabled = true;
          try {
              if (prev) {
                  for (const [k, v] of Object.entries(prev)) if (privacyOf(me, k) !== v) await savePrivacy(k, v, true);
                  await setDoc(doc(db, "users_private", currentUser.uid), { prevPrivacy: deleteField() }, { merge: true });
                  if (myPrivate) delete myPrivate.prevPrivacy;
                  showToast(t("Настройки возвращены"), "eye");
              } else {
                  const saved = {}; Object.keys(STEALTH).forEach(k => { saved[k] = privacyOf(me, k); });
                  await setDoc(doc(db, "users_private", currentUser.uid), { prevPrivacy: saved }, { merge: true });
                  if (myPrivate) myPrivate.prevPrivacy = saved;
                  for (const [k, v] of Object.entries(STEALTH)) if (privacyOf(me, k) !== v) await savePrivacy(k, v, true);
                  showToast(t("Режим невидимки включён 🦉"), "eye");
              }
          } catch (e) { console.error(e); showToast(t("Не удалось сохранить"), "error"); }
          btn.disabled = false; renderOwlEye();
      }
      document.getElementById("eye-btn").addEventListener("click", (e) => { e.stopPropagation(); document.getElementById("owl-eye-screen").style.display = "flex"; renderOwlEye(); });
      document.getElementById("owl-eye-open").addEventListener("click", () => { document.getElementById("owl-eye-screen").style.display = "flex"; renderOwlEye(); });
      document.getElementById("owl-eye-close").addEventListener("click", () => { document.getElementById("owl-eye-screen").style.display = "none"; });
      document.getElementById("owl-eye-screen").addEventListener("click", (e) => { if (e.target.id === "owl-eye-screen") e.target.style.display = "none"; });
      document.getElementById("eye-list").addEventListener("change", (e) => {
          const sel = e.target.closest("[data-eye]"), cb = e.target.closest("[data-eye-bool]");
          if (sel) savePrivacy(sel.getAttribute("data-eye"), sel.value);
          if (cb) savePrivacy(cb.getAttribute("data-eye-bool"), cb.checked);
      });
      document.getElementById("eye-stealth").addEventListener("click", (e) => toggleStealth(e.currentTarget));
      document.querySelectorAll("[data-privacy]").forEach(sel => sel.addEventListener("change", () => savePrivacy(sel.getAttribute("data-privacy"), sel.value)));
      document.querySelectorAll("[data-privacy-bool]").forEach(cb => cb.addEventListener("change", () => savePrivacy(cb.getAttribute("data-privacy-bool"), cb.checked)));
      document.getElementById("pv-toggle").addEventListener("click", (e) => e.currentTarget.closest(".pv-card").classList.toggle("open"));

      // ===== ПОДПИСЧИКИ И ПОДПИСКИ =====
      let followTarget = null;
      async function ensureUsers(uids) {
          const missing = uids.filter(u => u && !usersCache[u]);
          for (let i = 0; i < missing.length; i += 20) {
              try {
                  const snap = await getDocs(query(collection(db, "users"), where(documentId(), "in", missing.slice(i, i + 20)), limit(20)));
                  snap.forEach(d => { const u = d.data(); if (u && u.uid) window.__ingestUser(u, true); });
              } catch (e) { console.log("Профили:", e.code); }
          }
      }
      // Кто подписан на uid (tab = followers) / на кого подписан uid (following). null — нет доступа (список скрыт)
      async function followUids(uid, tab) {
          const u = usersCache[uid] || {}, legacy = (uid === currentUser.uid ? myRawProfile || {} : u)[tab];
          let ids = [];
          if (uid === currentUser.uid && (tab === "followers" ? myFollowsIn : myFollowsOut)) ids = [...(tab === "followers" ? myFollowsIn : myFollowsOut)];
          else {
              try {
                  const snap = await getDocs(query(collection(db, "follows"), where(tab === "followers" ? "to" : "from", "==", uid), limit(500)));
                  ids = snap.docs.map(d => d.data()[tab === "followers" ? "from" : "to"]);
              } catch (e) { console.log("follows:", e.code); if (!Array.isArray(legacy)) return null; }
          }
          return [...new Set([...ids, ...(Array.isArray(legacy) ? legacy : [])])];
      }
      // ===== QR-КОД: «Мой код» (ссылка-приглашение owlmes.ru/?add=ник) и сканер =====
      // Библиотеки лежат у нас на сайте и грузятся только при открытии экрана
      const loadScript = (src) => new Promise((ok, fail) => { if (document.querySelector(`script[src="${src}"]`)) return ok(); const sc = document.createElement("script"); sc.src = src; sc.onload = ok; sc.onerror = fail; document.head.appendChild(sc); });
      let qrStream = null, qrTimer = null, qrDetector = null;
      function qrSvg(text) {
          const qr = qrcode(0, "H"); qr.addData(text); qr.make();
          const n = qr.getModuleCount(), c = 10, size = n * c, hole = Math.round(n * 0.22) | 1, h0 = Math.floor((n - hole) / 2);
          const finder = (r, k) => r < 7 && k < 7 || r < 7 && k >= n - 7 || r >= n - 7 && k < 7;
          let dots = "";
          for (let r = 0; r < n; r++) for (let k = 0; k < n; k++) {
              if (!qr.isDark(r, k) || finder(r, k) || (r >= h0 && r < h0 + hole && k >= h0 && k < h0 + hole)) continue;
              // зазор и скругление подобраны так, чтобы код читали и камеры телефонов, и запасной сканер jsQR (проверено)
              dots += `<rect x="${k * c + .5}" y="${r * c + .5}" width="${c - 1}" height="${c - 1}" rx="${c * .22}"/>`;
          }
          const eye = (x, y) => `<rect x="${x * c + c / 2}" y="${y * c + c / 2}" width="${6 * c}" height="${6 * c}" rx="${c * 1.8}" fill="none" stroke="url(#qrg)" stroke-width="${c}"/><rect x="${(x + 2) * c}" y="${(y + 2) * c}" width="${3 * c}" height="${3 * c}" rx="${c * .9}" fill="url(#qrg)"/>`;
          const lg = h0 * c, ls = hole * c;
          return `<svg viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="qrg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5b2fd6"/><stop offset="1" stop-color="#241552"/></linearGradient></defs>
            <g fill="url(#qrg)">${dots}</g>${eye(0, 0)}${eye(n - 7, 0)}${eye(0, n - 7)}
            <rect x="${lg + 2}" y="${lg + 2}" width="${ls - 4}" height="${ls - 4}" rx="${ls * .26}" fill="#7c4dff"/><image href="icon-192.png" x="${lg + 4}" y="${lg + 4}" width="${ls - 8}" height="${ls - 8}" clip-path="inset(0 round ${ls * .24}px)"/></svg>`;
      }
      async function openQr(tab = "mine") {
          document.getElementById("qr-screen").style.display = "flex";
          const me = usersCache[currentUser.uid] || {};
          document.getElementById("qr-name").textContent = me.name || currentUser.displayName || "";
          document.getElementById("qr-avatar").src = getAvatar(currentUser.uid, me.name || "");
          qrTab(tab);
          try { await loadScript("lib-qrcode.js"); document.getElementById("qr-code").innerHTML = qrSvg(inviteLink()); }
          catch (e) { document.getElementById("qr-code").innerHTML = `<div class="dev-empty">${t("Не удалось нарисовать код. Проверьте интернет")}</div>`; }
      }
      function qrTab(tab) {
          document.querySelectorAll("#qr-tabs .tab").forEach(t => t.classList.toggle("active", t.getAttribute("data-qt") === tab));
          document.getElementById("qr-tabs").classList.toggle("second", tab === "scan");
          document.getElementById("qr-mine").style.display = tab === "mine" ? "" : "none";
          document.getElementById("qr-scan").style.display = tab === "scan" ? "" : "none";
          if (tab === "scan") startQrScan(); else stopQrScan();
      }
      // Принимаем только наши ссылки owlmes.ru/?add=ник — всё остальное игнорируем
      function handleQrText(text) {
          let u; try { u = new URL(String(text).trim()); } catch (_) { return false; }
          if (!/^(www\.)?owlmes\.ru$/.test(u.hostname) || u.protocol !== "https:") return false;
          const add = (u.searchParams.get("add") || "").slice(0, 40); if (!add) return false;
          document.querySelector("#qr-scan .qr-frame").classList.add("hit"); try { navigator.vibrate && navigator.vibrate(30); } catch (_) {}
          setTimeout(() => { closeQr(); window.__pendingAdd = add; openPendingInvite(); }, 350);
          return true;
      }
      async function startQrScan() {
          const hint = document.getElementById("qr-scan-hint"), video = document.getElementById("qr-video");
          document.querySelector("#qr-scan .qr-frame").classList.remove("hit");
          if (qrStream) return;
          if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { hint.textContent = t("Этот браузер не даёт доступ к камере. Отсканируйте код обычной камерой телефона"); return; }
          try {
              qrStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
              video.srcObject = qrStream; await video.play();
              hint.textContent = t("Наведите камеру на QR-код друга из Owl");
          } catch (e) { qrStream = null; hint.textContent = e && e.name === "NotAllowedError" ? t("Нет доступа к камере. Разрешите его в настройках браузера или телефона") : t("Не удалось включить камеру"); return; }
          if ("BarcodeDetector" in window) { try { qrDetector = new BarcodeDetector({ formats: ["qr_code"] }); } catch (_) { qrDetector = null; } }
          if (!qrDetector) { try { await loadScript("lib-jsqr.js"); } catch (_) { hint.textContent = t("Не удалось загрузить сканер. Проверьте интернет"); return; } }
          const canvas = document.createElement("canvas"), ctx = canvas.getContext("2d", { willReadFrequently: true });
          let wrongShown = 0;
          const tick = async () => {
              if (!qrStream || !video.videoWidth) { qrTimer = setTimeout(tick, 200); return; }
              let found = null;
              try {
                  if (qrDetector) { const r = await qrDetector.detect(video); if (r && r[0]) found = r[0].rawValue; }
                  else { const w = 480, hgt = Math.round(w * video.videoHeight / video.videoWidth); canvas.width = w; canvas.height = hgt; ctx.drawImage(video, 0, 0, w, hgt); const r = jsQR(ctx.getImageData(0, 0, w, hgt).data, w, hgt, { inversionAttempts: "dontInvert" }); if (r) found = r.data; }
              } catch (_) {}
              if (found) { if (handleQrText(found)) return; if (Date.now() - wrongShown > 3000) { wrongShown = Date.now(); hint.textContent = t("Это не QR-код Owl — наведите на код друга"); } }
              qrTimer = setTimeout(tick, 180);
          };
          tick();
      }
      function stopQrScan() {
          clearTimeout(qrTimer); qrTimer = null;
          if (qrStream) { qrStream.getTracks().forEach(t => t.stop()); qrStream = null; }
          const v = document.getElementById("qr-video"); if (v) v.srcObject = null;
      }
      function closeQr() { stopQrScan(); document.getElementById("qr-screen").style.display = "none"; }
      // Картинка карточки (PNG) — для «Сохранить» и «Поделиться»
      async function qrCardPng() {
          const W = 720, H = 900, cv = document.createElement("canvas"); cv.width = W; cv.height = H; const g = cv.getContext("2d");
          const acc = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#8b5cf6";
          const grd = g.createLinearGradient(0, 0, W, H); grd.addColorStop(0, acc); grd.addColorStop(1, "#1d1240"); g.fillStyle = grd; g.fillRect(0, 0, W, H);
          const rr = (x, y, w, h, r) => { g.beginPath(); g.roundRect ? g.roundRect(x, y, w, h, r) : g.rect(x, y, w, h); };
          g.fillStyle = "#fff"; rr(80, 190, 560, 560, 44); g.fill();
          const svg = document.querySelector("#qr-code svg"); if (!svg) return null;
          const img = new Image(); img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg.outerHTML.replace('href="icon-192.png"', 'href="' + location.origin + '/icon-192.png"'));
          await new Promise(r => { img.onload = r; img.onerror = r; });
          g.drawImage(img, 110, 220, 500, 500);
          const logo = new Image(); logo.src = "icon-192.png"; await new Promise(r => { logo.onload = r; logo.onerror = r; });
          const ls = 500 * 0.22; g.save(); rr(360 - ls / 2, 470 - ls / 2, ls, ls, ls * .24); g.clip(); g.drawImage(logo, 360 - ls / 2, 470 - ls / 2, ls, ls); g.restore();
          g.fillStyle = "#fff"; g.textAlign = "center"; g.font = "800 46px Onest, system-ui, sans-serif"; g.fillText(document.getElementById("qr-name").textContent, W / 2, 110);
          g.font = "500 26px Onest, system-ui, sans-serif"; g.globalAlpha = .85; g.fillText(t("Добавь меня в Owl — наведи камеру"), W / 2, 152); g.globalAlpha = 1;
          g.font = "700 30px Onest, system-ui, sans-serif"; g.fillText("owlmes.ru", W / 2, 820);
          return new Promise(r => cv.toBlob(r, "image/png"));
      }
      document.getElementById("my-qr-btn").addEventListener("click", () => openQr("mine"));
      document.getElementById("st-qr").addEventListener("click", (e) => { e.preventDefault(); openQr("mine"); });
      document.getElementById("qr-close").addEventListener("click", closeQr);
      document.getElementById("qr-screen").addEventListener("click", (e) => { if (e.target.id === "qr-screen") closeQr(); });
      document.getElementById("qr-tabs").addEventListener("click", (e) => { const t = e.target.closest("[data-qt]"); if (t) qrTab(t.getAttribute("data-qt")); });
      document.getElementById("qr-copy").addEventListener("click", async () => { try { await navigator.clipboard.writeText(inviteLink()); showToast(t("Ссылка скопирована"), "check"); } catch (_) { prompt(t("Скопируйте ссылку:"), inviteLink()); } });
      document.getElementById("qr-save").addEventListener("click", async () => {
          const blob = await qrCardPng(); if (!blob) return;
          const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "owl-qr.png"; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      });
      document.getElementById("qr-share").addEventListener("click", async () => {
          const text = t("Добавь меня в Owl:") + " " + inviteLink();
          try {
              const blob = await qrCardPng(), file = blob && new File([blob], "owl-qr.png", { type: "image/png" });
              if (file && navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], text }); return; }
              if (navigator.share) { await navigator.share({ text }); return; }
          } catch (e) { if (e && e.name === "AbortError") return; }
          try { await navigator.clipboard.writeText(text); showToast(t("Ссылка скопирована"), "check"); } catch (_) { prompt(t("Скопируйте ссылку:"), inviteLink()); }
      });

      // ===== АНИМАЦИИ-МЕЛОЧИ =====
      const calmMotion = reduceMotion;
      // Число плавно «докручивается» до нового значения
      function countTo(el, to) {
          if (!el) return; to = Number(to) || 0;
          const from = Number(el.dataset.n || 0); el.dataset.n = to;
          if (calmMotion() || from === to || !isFinite(from)) { el.textContent = to; return; }
          const t0 = performance.now(), dur = Math.min(900, 300 + Math.abs(to - from) * 40);
          const step = (t) => { const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3); el.textContent = Math.round(from + (to - from) * e); if (k < 1) requestAnimationFrame(step); };
          requestAnimationFrame(step);
      }
      // «Вспышка» из точек вокруг кнопки — при подписке
      function burstAt(el) {
          if (!el || calmMotion()) return;
          const r = el.getBoundingClientRect(), box = document.createElement("div");
          box.className = "burst"; box.style.left = (r.left + r.width / 2) + "px"; box.style.top = (r.top + r.height / 2) + "px";
          for (let i = 0; i < 12; i++) { const d = document.createElement("i"), a = i / 12 * Math.PI * 2, dist = 34 + (i % 3) * 10; d.style.setProperty("--x", Math.cos(a) * dist + "px"); d.style.setProperty("--y", Math.sin(a) * dist + "px"); d.style.animationDelay = (i % 3) * 25 + "ms"; box.appendChild(d); }
          document.body.appendChild(box); setTimeout(() => box.remove(), 800);
          el.classList.remove("pop"); void el.offsetWidth; el.classList.add("pop");
      }
      // Мои подписчики/подписки в профиле (Настройки) + «+N новых» с прошлого просмотра
      function renderMyStats() {
          const me = currentUser && usersCache[currentUser.uid]; if (!me) return;
          const nIn = followCount(me, "followers"), nOut = followCount(me, "following");
          countTo(document.getElementById("my-followers-n"), nIn);
          countTo(document.getElementById("my-following-n"), nOut);
          let seen = 0; try { seen = Number(localStorage.getItem("owl-seen-followers-" + currentUser.uid)) || 0; } catch (_) {}
          const fresh = Object.values(myFollowersAt).filter(t => t > seen).length, badge = document.getElementById("my-followers-new");
          if (badge) { badge.textContent = fresh ? "+" + fresh : ""; badge.classList.toggle("on", fresh > 0 && seen > 0); }
          if (!seen) try { localStorage.setItem("owl-seen-followers-" + currentUser.uid, String(Date.now())); } catch (_) {}
      }
      document.querySelectorAll("[data-my-follow]").forEach(b => b.addEventListener("click", () => openFollowList(currentUser.uid, b.getAttribute("data-my-follow"))));
      const eyesMini = () => `<svg class="fl-eyes" viewBox="0 0 120 52" width="96" aria-hidden="true"><circle cx="30" cy="26" r="21" fill="#f6f3ff"/><circle cx="90" cy="26" r="21" fill="#f6f3ff"/><g class="fl-pupils"><circle cx="30" cy="28" r="9" fill="#1b1630"/><circle cx="90" cy="28" r="9" fill="#1b1630"/></g><circle cx="30" cy="26" r="21" fill="none" stroke="var(--accent)" stroke-width="3"/><circle cx="90" cy="26" r="21" fill="none" stroke="var(--accent)" stroke-width="3"/></svg>`;
      const agoText = (ts) => {
          if (!ts) return ""; const d = Date.now() - ts, m = 60000, h = 60 * m, day = 24 * h;
          if (d < h) return t("только что"); if (d < day) return t("{n} ч назад", { n: Math.floor(d / h) }); if (d < 2 * day) return t("вчера");
          if (d < 30 * day) return t("{n} дн. назад", { n: Math.floor(d / day) }); return new Date(ts).toLocaleDateString([], { day: "numeric", month: "short" });
      };
      async function openFollowList(uid, tab) {
          followTarget = uid;
          const u = usersCache[uid]; if (!u) return;
          if (!allowedBy(u, tab === "followers" ? "showFollowers" : "showFollowing")) return showToast(tab === "followers" ? t("Пользователь скрыл список подписчиков") : t("Пользователь скрыл список подписок"), "eye");
          document.querySelectorAll("#follow-tabs .tab").forEach(t => t.classList.toggle("active", t.getAttribute("data-ft") === tab));
          document.getElementById("follow-tabs").classList.toggle("second", tab === "following");
          const isMe = uid === currentUser.uid;
          if (isMe && tab === "followers") { try { localStorage.setItem("owl-seen-followers-" + uid, String(Date.now())); } catch (_) {} setTimeout(renderMyStats, 50); }
          document.getElementById("follow-title").textContent = uid === currentUser.uid ? (tab === "followers" ? t("Мои подписчики") : t("Мои подписки")) : (u.name || t("Профиль"));
          document.getElementById("public-profile-screen").style.display = "none";
          document.getElementById("follow-screen").style.display = "flex";
          const list = document.getElementById("follow-list");
          list.innerHTML = `<div class="dev-empty">${t("Загружаем…")}</div>`;
          const uids = await followUids(uid, tab);
          if (followTarget !== uid) return;
          if (!uids) { list.innerHTML = `<div class="dev-empty">${t("Список скрыт настройками конфиденциальности")}</div>`; return; }
          if (!uids.length) {
              const own = uid === currentUser.uid;
              list.innerHTML = `<div class="fl-empty">${eyesMini()}<b>${tab === "followers" ? t("Подписчиков пока нет") : t("Подписок пока нет")}</b>${own ? `<span>${tab === "followers" ? t("Позовите друзей — и они появятся здесь") : t("Найдите друзей по нику через поиск")}</span>${tab === "followers" ? `<button class="fl-invite" id="fl-invite">${t("Пригласить друзей")}</button>` : ""}` : ""}</div>`;
              const inv = document.getElementById("fl-invite"); if (inv) inv.addEventListener("click", () => shareInvite());
              return;
          }
          await ensureUsers(uids);
          if (followTarget !== uid) return;
          const rows = uids.map(id => usersCache[id]).filter(x => x && x.name && !bansCache[x.uid]);
          const myOut = new Set(usersCache[currentUser.uid]?.following || []);
          // Свои подписчики — сначала новые
          if (isMe && tab === "followers") rows.sort((a, b) => (myFollowersAt[b.uid] || 0) - (myFollowersAt[a.uid] || 0));
          const rowHtml = (x, i) => {
              const mutual = tab === "followers" ? myOut.has(x.uid) : followsMe(x);
              let sub = "", act = "";
              if (isMe && tab === "followers") {
                  sub = (mutual ? t("взаимная подписка") : t("подписан(а) на вас")) + (myFollowersAt[x.uid] ? " · " + agoText(myFollowersAt[x.uid]) : "");
                  act = mutual ? `<span class="fl-mutual">${icon("check", 14)}${t("Взаимно")}</span>` : `<button class="fl-back" data-fl-back="${escapeHTML(x.uid)}">${t("В ответ")}</button>`;
              } else if (isMe && tab === "following") sub = mutual ? t("взаимная подписка") : t("вы подписаны");
              else if (x.uid === currentUser.uid) sub = t("это вы");
              else sub = myOut.has(x.uid) ? t("вы подписаны") : "";
              const isNew = isMe && tab === "followers" && myFollowersAt[x.uid] && Date.now() - myFollowersAt[x.uid] < 3 * 86400000;
              return `<div class="fl-row" data-fl-uid="${escapeHTML(x.uid)}" style="--i:${Math.min(i, 14)}"><img src="${getAvatar(x.uid, x.name)}" alt=""><div class="fl-txt"><b>${escapeHTML(x.name)}${verifiedBadge(x.uid, 13)}${premiumBadge(x.uid, 13)}${isNew ? `<em class="fl-new">${t("новый")}</em>` : ""}</b>${sub ? `<span>${sub}</span>` : ""}</div>${act}</div>`;
          };
          const search = rows.length > 8 ? `<div class="fl-search">${icon("search", 16)}<input id="fl-q" placeholder="${t("Поиск по имени")}" autocomplete="off"></div>` : "";
          list.innerHTML = rows.length ? search + `<div class="fl-count">${tab === "followers" ? t("Подписчиков") : t("Подписок")}: ${rows.length}</div><div id="fl-rows">` + rows.map(rowHtml).join("") + "</div>" : `<div class="dev-empty">${t("Никого нет")}</div>`;
          const q = document.getElementById("fl-q");
          if (q) q.addEventListener("input", () => { const v = q.value.trim().toLowerCase(); document.getElementById("fl-rows").innerHTML = rows.filter(x => x.name.toLowerCase().includes(v)).map(rowHtml).join("") || `<div class="dev-empty">${t("Никого не нашли")}</div>`; });
      }
      document.querySelectorAll(".profile-stats [data-follow-tab]").forEach(el => el.addEventListener("click", () => {
          const uid = document.getElementById("public-follow-btn").getAttribute("data-action-uid") || (document.getElementById("public-report-btn").getAttribute("data-action-uid")) || currentUser.uid;
          openFollowList(window.__profileUid || uid, el.getAttribute("data-follow-tab"));
      }));
      document.getElementById("follow-tabs").addEventListener("click", (e) => { const t = e.target.closest("[data-ft]"); if (t && followTarget) openFollowList(followTarget, t.getAttribute("data-ft")); });
      document.getElementById("follow-close").addEventListener("click", () => { document.getElementById("follow-screen").style.display = "none"; followTarget = null; });
      document.getElementById("follow-list").addEventListener("click", async (e) => {
          const b = e.target.closest("[data-fl-back]"); if (!b) return;
          e.stopImmediatePropagation(); b.disabled = true;
          try { await setFollow(b.getAttribute("data-fl-back"), true); burstAt(b); b.outerHTML = `<span class="fl-mutual">${icon("check", 14)}${t("Взаимно")}</span>`; }
          catch (err) { console.error(err); b.disabled = false; showToast(t("Не удалось подписаться"), "error"); }
      }, true);
      document.getElementById("follow-list").addEventListener("click", (e) => { const r = e.target.closest("[data-fl-uid]"); if (r) { document.getElementById("follow-screen").style.display = "none"; openPublicProfile(r.getAttribute("data-fl-uid")); } });

      // ===== ЛИЧНАЯ БЛОКИРОВКА =====
      // blocks/{кто}_{кого} — закрытые записи: видят только эти двое (раньше список лежал в публичном профиле).
      // Заблокированный не может писать мне в личку, его сообщения в беседах скрыты, уведомлений от него нет.
      let myBlockedSet = new Set(), blocksListener = null;
      let peerBlockListener = null, peerBlockUid = null, peerBlockedMe = false;
      const myBlocked = () => [...myBlockedSet];
      const iBlocked = (uid) => !!uid && myBlockedSet.has(uid);
      const blockedMe = (uid) => !!uid && uid === peerBlockUid && peerBlockedMe;
      function startBlockListeners() {
          stopBlockListeners();
          if (!currentUser) return;
          blocksListener = onSnapshot(query(collection(db, "blocks"), where("blocker", "==", currentUser.uid)), (snap) => {
              myBlockedSet = new Set(snap.docs.map(d => d.data().blocked));
              applyBlockState(); watchContacts(); renderChatList(document.getElementById("search-input").value);
          }, (e) => console.log("blocks:", e.code));
      }
      function stopBlockListeners() {
          if (blocksListener) { blocksListener(); blocksListener = null; }
          watchPeerBlock(null); myBlockedSet = new Set();
      }
      // Заблокировал ли меня собеседник в открытой личке
      function watchPeerBlock(peer) {
          if (peer === peerBlockUid) return;
          if (peerBlockListener) { peerBlockListener(); peerBlockListener = null; }
          peerBlockUid = peer || null; peerBlockedMe = false;
          if (!peer || !currentUser) return;
          peerBlockListener = onSnapshot(doc(db, "blocks", peer + "_" + currentUser.uid), (d) => { peerBlockedMe = d.exists(); applyBlockState(); }, (e) => console.log("blocks (собеседник):", e.code));
      }
      // Перенос старого списка из профиля в blocks (свой — при входе; админ переносит у всех)
      async function migrateBlockedList(u) {
          if (!u || !Array.isArray(u.blocked)) return false;
          const batch = writeBatch(db);
          u.blocked.forEach(b => { if (b) batch.set(doc(db, "blocks", u.uid + "_" + b), { blocker: u.uid, blocked: b, createdAt: new Date() }); });
          batch.update(doc(db, "users", u.uid), { blocked: deleteField() });
          await batch.commit();
          return true;
      }
      // Канал «Новости Owl»: читают все, пишет только админ (это проверяют правила базы). Своего счётчика непрочитанных
      // у канала нет — помним на устройстве время последнего просмотра и показываем точку, если вышел новый пост
      const NEWS_ID = "news";
      const OFFICIAL_SVG = (size) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="#3390ec" aria-hidden="true"><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zm-1.9 14.7L6 12.6l1.5-1.5 2.6 2.6 6.4-6.4 1.5 1.5-7.9 7.9z"/></svg>`;
      const newsSeen = () => { try { return +localStorage.getItem("owl-news-seen") || 0; } catch (_) { return 0; } };
      const markNewsSeen = () => { const m = chatsMetaCache[NEWS_ID]; try { localStorage.setItem("owl-news-seen", String(Math.max(Date.now(), m && m.timestamp ? getTime(m.timestamp) : 0))); } catch (_) {} };
      // Пост канала на языке читателя (если есть перевод и читатель не попросил оригинал)
      const newsOrig = new Set();
      const newsText = (m) => (LANG !== "ru" && m.i18n && m.i18n[LANG] && !newsOrig.has(m.id)) ? m.i18n[LANG] : (m.text || "");
      const newsMuted = () => { try { return localStorage.getItem("owl-news-mute") === "1"; } catch (_) { return false; } };

      // «Гнездо» — чат с самим собой (заметки и сохранённое): id = мойUid_мойUid
      const nestId = () => currentUser ? currentUser.uid + "_" + currentUser.uid : null;
      const isNest = (chatId) => !!currentUser && chatId === nestId();
      // Совёнок сидит в гнезде: задний край — за ним, передний (с плетением) закрывает низ тела
      const NEST_SVG = (size) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true"><path d="M3.4 12.6C7.4 10.4 16.6 10.4 20.6 12.6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" opacity=".85"/><path d="M12 5.9C14.9 5.9 17.2 8.1 17.2 11.1V16H6.8V11.1C6.8 8.1 9.1 5.9 12 5.9Z" fill="currentColor"/><path d="M7.5 8.2L7.8 4.8L10.1 6.7Z M16.5 8.2L16.2 4.8L13.9 6.7Z" fill="currentColor"/><circle cx="9.95" cy="10.3" r="2.05" fill="#6d3dff"/><circle cx="14.05" cy="10.3" r="2.05" fill="#6d3dff"/><circle cx="10.35" cy="9.9" r=".72" fill="#fff"/><circle cx="14.45" cy="9.9" r=".72" fill="#fff"/><path d="M11.3 12.1L12 13.3L12.7 12.1Z" fill="#f5b942"/><path d="M2.4 12.9C6 15.7 18 15.7 21.6 12.9C21.2 18.5 17.3 21.3 12 21.3S2.8 18.5 2.4 12.9Z" fill="currentColor"/><path d="M2.4 12.9C6 15.7 18 15.7 21.6 12.9" fill="none" stroke="rgba(85,45,140,.5)" stroke-width="1.1" stroke-linecap="round"/><g fill="none" stroke="rgba(85,45,140,.3)" stroke-width="1" stroke-linecap="round"><path d="M4.4 15.9q2 1.3 4.2 1.4"/><path d="M10 17.6q2 .3 4 0"/><path d="M15.4 17.3q2.2-.1 4.2-1.4"/><path d="M6.4 18.9q2.4 1 4.4 1"/><path d="M13.2 19.9q2.2-.1 4.4-1"/></g><g stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M1.1 12.1L3.7 13.5"/><path d="M22.9 12.1L20.3 13.5"/><path d="M1.6 14.6L3.3 14.5"/><path d="M22.4 14.6L20.7 14.5"/></g></svg>`;
      const dmPeer = (chatId) => (currentUser && chatId && chatId.includes("_")) ? chatId.split("_").find(id => id !== currentUser.uid) : null;
      async function toggleBlock(uid) {
          if (!currentUser || !uid || uid === currentUser.uid) return;
          const name = usersCache[uid]?.name || t("пользователя");
          const blocking = !iBlocked(uid);
          if (blocking && !confirm(t("Заблокировать {name}?", { name }) + "\n\n" + t("Этот человек не сможет писать вам в личные сообщения, а его сообщения в беседах будут скрыты. Он не узнает, что вы его заблокировали."))) return;
          try {
              const ref = doc(db, "blocks", currentUser.uid + "_" + uid);
              if (blocking) await setDoc(ref, { blocker: currentUser.uid, blocked: uid, createdAt: new Date() });
              else await deleteDoc(ref);
              if (blocking) myBlockedSet.add(uid); else myBlockedSet.delete(uid);
              showToast(blocking ? t("{name} заблокирован(а)", { name }) : t("{name} разблокирован(а)", { name }), "block");
              applyBlockState();
              if (document.getElementById("public-profile-screen").style.display === "flex") openPublicProfile(uid);
          } catch (err) { console.error(err); showToast(t("Не удалось сохранить"), "error"); }
      }
      // Поле ввода в личке и скрытые сообщения в беседах
      function applyBlockState() {
          if (!currentUser) return;
          const peer = currentChatTargetUid;
          const bar = document.getElementById("block-bar"), input = document.querySelector(".input-area");
          let text = "", canUnblock = false;
          updateCallBtn();
          if (peer && iBlocked(peer)) { text = t("Вы заблокировали этого пользователя"); canUnblock = true; }
          else if (peer && (blockedMe(peer) || !canWriteTo(peer))) text = t("Пользователь ограничил, кто может ему писать");
          bar.classList.toggle("on", !!text);
          if (input) input.style.display = text ? "none" : "";
          document.getElementById("block-bar-text").innerText = text;
          document.getElementById("block-bar-btn").style.display = canUnblock ? "inline" : "none";
          if (text) cancelReply();
          // Канал: читателям — плашка «пишет только команда Owl» и кнопка заглушить; админу — поле ввода и галочка «push»
          const ch = document.getElementById("channel-bar"), inNews = currentChatId === NEWS_ID;
          ch.classList.toggle("on", inNews); ch.classList.toggle("admin", inNews && isAdmin);
          if (inNews) {
              document.getElementById("channel-bar-text").innerHTML = isAdmin ? "" : iconizeEmoji(escapeHTML(t("Здесь пишет только команда Owl. Ставьте реакции 💜")));
              const mb = document.getElementById("channel-mute-btn"); mb.style.display = isAdmin ? "none" : ""; mb.innerHTML = iconizeEmoji(escapeHTML(newsMuted() ? t("🔔 Включить уведомления") : t("🔕 Без уведомлений")));
              document.getElementById("channel-push-label").style.display = isAdmin ? "" : "none";
              document.getElementById("channel-push-text").textContent = t("Отправить push всем");
              if (!isAdmin && input) { input.style.display = "none"; cancelReply(); }
          }
          refreshNightBar();
          const inDM = !!dmPeer(currentChatId);
          document.querySelectorAll("#chat-box .message-row.other-msg[data-uid]").forEach(r => r.classList.toggle("from-blocked", !inDM && iBlocked(r.getAttribute("data-uid"))));
      }
      document.getElementById("block-bar-btn").addEventListener("click", () => toggleBlock(currentChatTargetUid));
      document.getElementById("chat-box").addEventListener("click", (e) => {
          const b = e.target.closest("[data-tr]"); if (!b) return;
          e.stopPropagation();
          const id = b.getAttribute("data-tr"), m = loadedMsgs[id]; if (!m) return;
          newsOrig.has(id) ? newsOrig.delete(id) : newsOrig.add(id);
          const row = document.getElementById("msg-" + id), el = row && row.querySelector(".msg-text-content");
          if (el) { const shown = newsText(m); el.innerHTML = highlightMentions(linkify(shown), m); el.dataset.raw = shown; }
          b.innerHTML = emojiIcon("🌐") + " " + escapeHTML(t(newsOrig.has(id) ? "Показать перевод" : "Переведено автоматически · оригинал"));
      });
      document.getElementById("channel-mute-btn").addEventListener("click", async () => {
          const mute = !newsMuted();
          try { localStorage.setItem("owl-news-mute", mute ? "1" : "0"); } catch (_) {}
          applyBlockState();
          showToast(mute ? t("Уведомления канала выключены") : t("Уведомления канала включены"), mute ? "moon" : "bell");
          pushPost("/mute", { news: mute }).catch(() => {});
      });
      document.getElementById("public-block-btn").addEventListener("click", (e) => toggleBlock(e.currentTarget.getAttribute("data-action-uid")));

      // ===== ЖАЛОБЫ =====
      // reports/{кто}_{на что} — повторная жалоба на то же самое просто обновляет старую
      let reportCtx = null;
      window.openReport = ({ targetUid, message }) => {
          if (!currentUser || !targetUid || targetUid === currentUser.uid) return;
          reportCtx = { targetUid, message: message || null };
          const name = usersCache[targetUid]?.name || message?.sender || t("пользователь");
          document.getElementById("report-target").innerHTML = message ? t("Сообщение от {name}", { name: `<b>${escapeHTML(name)}</b>` }) : t("Пользователь {name}", { name: `<b>${escapeHTML(name)}</b>` });
          const q = document.getElementById("report-quote");
          q.style.display = message ? "block" : "none";
          if (message) q.innerHTML = iconizePreview(escapeHTML(msgPreviewText(message).slice(0, 300)));
          document.querySelectorAll('input[name="rp-reason"]').forEach(r => r.checked = false);
          document.getElementById("report-comment").value = "";
          document.getElementById("public-profile-screen").style.display = "none";
          document.getElementById("report-screen").style.display = "flex";
      };
      const closeReport = () => { document.getElementById("report-screen").style.display = "none"; reportCtx = null; };
      document.getElementById("report-close").addEventListener("click", closeReport);
      document.getElementById("public-report-btn").addEventListener("click", (e) => openReport({ targetUid: e.currentTarget.getAttribute("data-action-uid") }));
      document.getElementById("report-send-btn").addEventListener("click", async (e) => {
          if (!currentUser || !reportCtx) return;
          const reason = (document.querySelector('input[name="rp-reason"]:checked') || {}).value;
          if (!reason) return showToast(t("Выберите причину жалобы"), "alert");
          const btn = e.currentTarget; btn.disabled = true;
          const { targetUid, message } = reportCtx;
          const me = usersCache[currentUser.uid] || {};
          const data = {
              fromUid: currentUser.uid, fromName: me.name || currentUser.displayName || "",
              targetUid, targetName: usersCache[targetUid]?.name || message?.sender || "",
              reason, comment: document.getElementById("report-comment").value.trim().slice(0, 500),
              createdAt: new Date()
          };
          if (message) Object.assign(data, { messageId: message.id, chatId: message.chatId || currentChatId || "", messageText: msgPreviewText(message).slice(0, 500) });
          try {
              await setDoc(doc(db, "reports", currentUser.uid + "_" + (message ? message.id : "u_" + targetUid)), data);
              closeReport(); showToast(t("Жалоба отправлена. Спасибо!"), "flag");
          } catch (err) { console.error(err); showToast(t("Не удалось отправить жалобу"), "error"); }
          btn.disabled = false;
      });
      async function resolveReport(id, action, btn) {
          const r = reportsCache[id]; if (!r || !isAdmin) return;
          btn.disabled = true;
          try {
              if (action === "delmsg") {
                  if (!confirm("Удалить это сообщение у всех?")) { btn.disabled = false; return; }
                  await deleteDoc(doc(db, "messages", r.messageId)).catch(() => {});
              }
              // Закрываем все жалобы на то же сообщение (или на того же человека, если без сообщения)
              const same = Object.entries(reportsCache).filter(([, x]) => r.messageId ? x.messageId === r.messageId : (!x.messageId && x.targetUid === r.targetUid)).map(([k]) => k);
              await Promise.all(same.map(k => deleteDoc(doc(db, "reports", k))));
              showToast(action === "delmsg" ? "Сообщение удалено, жалоба закрыта" : "Жалоба закрыта", "check");
          } catch (err) { console.error(err); showToast("Не удалось: " + err.message, "error"); btn.disabled = false; }
      }

      function startEdit(id) {
          const m = loadedMsgs[id]; if (!m || m.uid !== currentUser.uid || !m.text) return;
          cancelReply(); editingMsgId = id;
          const input = document.getElementById("message-input"); input.value = m.text; input.focus();
          document.getElementById("send-button").innerHTML = checkIconSVG;
      }
      async function deleteMessage(id) {
          const m = loadedMsgs[id]; if (!m) return;
          if (!confirm(isAdmin && m.uid !== currentUser.uid ? "[ADMIN] Удалить чужое сообщение?" : t("Удалить сообщение?"))) return;
          fixPreviewAfterDelete(id);
          try { await deleteDoc(doc(db, "messages", id)); } catch (e) { console.error(e); showToast(t("Не удалось удалить"), "error"); }
      }

      // ===== БЫСТРАЯ РЕАКЦИЯ (двойное нажатие) =====
      // Выбор хранится в закрытой users_private/{я}.quickReaction, поэтому одинаков на всех устройствах
      const QUICK_CHOICES = ["❤", "👍", "😂", "🔥", "😮", "😢", "👏", "🎉", "😍", "🤔", "💯", "🙏"];
      const showEmoji = (r) => r === "❤" ? "❤️" : r;
      const quickReaction = () => { const q = currentUser && usersCache[currentUser.uid]?.quickReaction; return QUICK_CHOICES.includes(q) ? q : "❤"; };
      function renderQuickReactionSetting() {
          const cur = quickReaction();
          document.getElementById("qr-current").textContent = showEmoji(cur);
          document.getElementById("qr-grid").innerHTML = QUICK_CHOICES.map(r => `<button data-qr="${r}" class="${r === cur ? "on" : ""}" title="${t("Выбрать")}">${showEmoji(r)}</button>`).join("");
      }
      document.getElementById("qr-grid").addEventListener("click", async (e) => {
          const b = e.target.closest("[data-qr]"); if (!b || !currentUser) return;
          const r = b.getAttribute("data-qr"), me = usersCache[currentUser.uid];
          if (me) me.quickReaction = r;
          renderQuickReactionSetting();
          try { await setDoc(doc(db, "users_private", currentUser.uid), { quickReaction: r }, { merge: true }); showToast(t("Быстрая реакция: ") + showEmoji(r), "check"); }
          catch (err) { console.error(err); showToast(t("Не удалось сохранить"), "error"); }
      });
      function quickReact(id) {
          if (selMode) return;
          const row = document.getElementById("msg-" + id), m = loadedMsgs[id];
          if (!row || !m || row.classList.contains("from-blocked")) return;
          const r = quickReaction();
          const removing = m.reactions && m.reactions[currentUser.uid] === r;
          if (!removing && !reduceMotion()) {
              const bubble = row.querySelector(".message-content");
              const pop = document.createElement("span"); pop.className = "quick-pop"; pop.textContent = showEmoji(r);
              bubble.appendChild(pop); setTimeout(() => pop.remove(), 800);
          }
          if (navigator.vibrate) navigator.vibrate(8);
          addReaction(id, r);
      }
      // Двойной клик мышью (компьютер)
      document.getElementById("chat-box").addEventListener("dblclick", (e) => {
          const row = e.target.closest(".message-row[data-msg-id]");
          if (!row || e.target.closest("a, audio, button, img, .reply-quote")) return;
          try { window.getSelection().removeAllRanges(); } catch (_) {}
          quickReact(row.getAttribute("data-msg-id"));
      });

      // ===== МЕНЮ СООБЩЕНИЯ (долгое нажатие / правая кнопка мыши) =====
      const MENU_REACTIONS = ["👍", "❤", "😂", "😮", "😢", "🔥"];
      let menuMsgId = null, menuOpenedAt = 0;
      function openMsgMenu(id, x, y) {
          if (selMode) return toggleSel(id); // в режиме выбора долгое нажатие и правая кнопка тоже просто отмечают
          const m = loadedMsgs[id], row = document.getElementById("msg-" + id);
          if (!m || !row || menuMsgId === id) return;
          const me = currentUser.uid, isMe = m.uid === me, hidden = row.classList.contains("from-blocked");
          menuMsgId = id; menuOpenedAt = Date.now();
          row.classList.add("msg-selected");
          const myR = m.reactions && m.reactions[me];
          document.getElementById("mm-reacts").style.display = hidden ? "none" : "";
          document.getElementById("mm-reacts").innerHTML = MENU_REACTIONS.map(r => `<button data-react="${r}" class="${myR === r ? "on" : ""}">${r === "❤" ? "❤️" : r}</button>`).join("");
          const acts = [];
          if (!hidden && !(m.chatId === NEWS_ID && !isAdmin)) acts.push(["reply", replyIconSVG.replace(/width="16" height="16"/, 'width="20" height="20"'), t("Ответить")]);
          if (!hidden && m.text) acts.push(["copy", icon("copy", 20), t("Копировать текст")]);
          if (!hidden && m.imageUrl) acts.push(["photo", icon("image", 20), t("Открыть фото")]);
          if (!hidden && !m.poll) acts.push(["forward", icon("forward", 20), t("Переслать")]);
          if (!hidden && !m.poll && !isNest(m.chatId)) acts.push(["nest", NEST_SVG(20), t("Сохранить в Гнездо")]);
          if (!hidden) acts.push(["select", icon("check", 20), t("Выбрать")]);
          if (isMe && m.text) acts.push(["edit", icon("pencil", 20), t("Изменить")]);
          if (isMe || isAdmin) acts.push(["delete", icon("trash", 20), t("Удалить"), "danger"]);
          if (!isMe && !isAdmin) acts.push(["report", icon("flag", 20), t("Пожаловаться"), "danger"]);
          document.getElementById("mm-actions").innerHTML = acts.map(([a, ic, t, cls]) => `<button data-act="${a}" class="${cls || ""}">${ic}<span>${t}</span></button>`).join("");
          const menu = document.getElementById("msg-menu"), sheet = document.getElementById("mm-sheet");
          menu.classList.add("on");
          if (!matchMedia("(pointer: coarse)").matches) {
              const w = sheet.offsetWidth, h = sheet.offsetHeight;
              sheet.style.left = Math.max(8, Math.min(x, innerWidth - w - 8)) + "px";
              sheet.style.top = Math.max(8, Math.min(y, innerHeight - h - 8)) + "px";
          }
          if (navigator.vibrate) navigator.vibrate(12);
      }
      function closeMsgMenu() {
          document.getElementById("msg-menu").classList.remove("on");
          document.querySelectorAll(".msg-selected").forEach(r => r.classList.remove("msg-selected"));
          menuMsgId = null;
      }
      document.getElementById("msg-menu").addEventListener("click", async (e) => {
          if (Date.now() - menuOpenedAt < 450) return; // «клик» от того же пальца, которым открыли меню
          const id = menuMsgId, m = loadedMsgs[id];
          const react = e.target.closest("[data-react]"), act = e.target.closest("[data-act]");
          if (!react && !act) { if (!e.target.closest("#mm-sheet")) closeMsgMenu(); return; }
          closeMsgMenu(); if (!m) return;
          if (react) return addReaction(id, react.getAttribute("data-react"));
          switch (act.getAttribute("data-act")) {
              case "reply": startReply(id); document.getElementById("message-input").focus(); break;
              case "copy":
                  try { await navigator.clipboard.writeText(m.text); showToast(t("Текст скопирован"), "copy"); }
                  catch (_) { prompt(t("Скопируйте текст:"), m.text); }
                  break;
              case "photo": { const img = document.querySelector(`#msg-${CSS.escape(id)} .message-content > img`); if (img) img.click(); break; }
              case "forward": openForward(m); break;
              case "nest": forwardMessageTo(m, { chatId: nestId(), title: t("Гнездо"), targetUid: null }, t("Сохранено в Гнездо 🪺")); break;
              case "select": enterSelect(id); break;
              case "edit": startEdit(id); break;
              case "delete": deleteMessage(id); break;
              case "report": openReport({ targetUid: m.uid, message: m }); break;
          }
      });
      document.addEventListener("keydown", (e) => { if (e.key === "Escape" && menuMsgId) closeMsgMenu(); });
      // Правая кнопка мыши (компьютер) и долгое нажатие на Android
      document.getElementById("chat-box").addEventListener("contextmenu", (e) => {
          const row = e.target.closest(".message-row[data-msg-id]");
          if (!row || e.target.closest("a, audio")) return;
          e.preventDefault();
          openMsgMenu(row.getAttribute("data-msg-id"), e.clientX, e.clientY);
      });

      // ===== ВЫБОР НЕСКОЛЬКИХ СООБЩЕНИЙ (меню → «Выбрать») =====
      // Пока режим включён, нажатие на сообщение отмечает его; действия — в панели вместо шапки чата.
      // Не больше SEL_MAX за раз: пересылка — это обычная отправка, а она ограничена 40 сообщениями в минуту
      const SEL_MAX = 20;
      let selMode = false;
      const selIds = new Set();
      const selMsgs = () => [...selIds].map(id => loadedMsgs[id]).filter(Boolean).sort((a, b) => getTime(a.timestamp) - getTime(b.timestamp));
      const canDeleteMsg = (m) => m.uid === currentUser.uid || isAdmin;
      function selPaint() {
          const list = selMsgs();
          document.getElementById("sel-count").textContent = t("Выбрано: {n}", { n: list.length });
          const can = { copy: list.some(m => m.text), forward: list.some(m => !m.poll), nest: !isNest(currentChatId) && list.some(m => !m.poll), delete: list.length > 0 && list.every(canDeleteMsg) };
          document.querySelectorAll("#select-bar [data-sel]").forEach(b => { const a = b.getAttribute("data-sel"); b.classList.toggle("off", !can[a]); b.style.display = a === "nest" && isNest(currentChatId) ? "none" : ""; });
      }
      function enterSelect(id) {
          if (selMode) return toggleSel(id);
          selMode = true; selIds.clear();
          const bar = document.getElementById("select-bar");
          bar.querySelector("#sel-close").innerHTML = icon("x", 22); bar.querySelector("#sel-close").title = t("Отмена");
          [["copy", icon("copy", 20), t("Копировать текст")], ["forward", icon("forward", 20), t("Переслать")], ["nest", NEST_SVG(20), t("Сохранить в Гнездо")], ["delete", icon("trash", 20), t("Удалить")]]
              .forEach(([a, ic, title]) => { const b = bar.querySelector(`[data-sel="${a}"]`); b.innerHTML = ic; b.title = title; b.setAttribute("aria-label", title); });
          document.getElementById("chat-header-info").classList.add("selecting");
          document.getElementById("chat-box").classList.add("select-mode");
          toggleSel(id);
      }
      function exitSelect() {
          if (!selMode) return;
          selMode = false; selIds.clear();
          document.querySelectorAll(".msg-picked").forEach(r => r.classList.remove("msg-picked"));
          document.getElementById("chat-header-info").classList.remove("selecting");
          document.getElementById("chat-box").classList.remove("select-mode");
      }
      function toggleSel(id) {
          const row = document.getElementById("msg-" + id);
          if (!row || !loadedMsgs[id] || row.classList.contains("from-blocked")) return;
          if (selIds.has(id)) selIds.delete(id);
          else { if (selIds.size >= SEL_MAX) return showToast(t("Можно выбрать до {n} сообщений", { n: SEL_MAX }), "info"); selIds.add(id); }
          row.classList.toggle("msg-picked", selIds.has(id));
          if (navigator.vibrate) navigator.vibrate(6);
          if (!selIds.size) return exitSelect();
          selPaint();
      }
      // В режиме выбора нажатие на сообщение только отмечает его (фото, ссылки и опросы не срабатывают)
      document.getElementById("chat-box").addEventListener("click", (e) => {
          if (!selMode) return;
          const row = e.target.closest(".message-row[data-msg-id]"); if (!row) return;
          e.preventDefault(); e.stopPropagation();
          toggleSel(row.getAttribute("data-msg-id"));
      }, true);
      document.getElementById("sel-close").addEventListener("click", exitSelect);
      document.addEventListener("keydown", (e) => { if (e.key === "Escape" && selMode && !menuMsgId) exitSelect(); });
      document.getElementById("select-bar").addEventListener("click", async (e) => {
          const b = e.target.closest("[data-sel]"); if (!b) return;
          const list = selMsgs(); if (!list.length) return exitSelect();
          switch (b.getAttribute("data-sel")) {
              case "copy": {
                  const text = list.filter(m => m.text).map(m => m.chatId === NEWS_ID ? newsText(m) : m.text).join("\n\n");
                  if (!text) return showToast(t("В выбранных сообщениях нет текста"), "info");
                  try { await navigator.clipboard.writeText(text); showToast(t("Текст скопирован"), "copy"); }
                  catch (_) { prompt(t("Скопируйте текст:"), text); }
                  return exitSelect();
              }
              case "forward": {
                  const fw = list.filter(m => !m.poll);
                  if (!fw.length) return showToast(t("Эти сообщения нельзя переслать"), "info");
                  exitSelect(); return openForward(fw);
              }
              case "nest": {
                  const fw = list.filter(m => !m.poll);
                  if (!fw.length) return showToast(t("Эти сообщения нельзя переслать"), "info");
                  exitSelect(); return forwardManyTo(fw, { chatId: nestId(), title: t("Гнездо"), targetUid: null }, t("Сохранено в Гнездо 🪺"));
              }
              case "delete": {
                  if (!list.every(canDeleteMsg)) return showToast(t("Удалить можно только свои сообщения"), "info");
                  if (!confirm(t("Удалить выбранные сообщения ({n})?", { n: list.length }))) return;
                  const ids = list.map(m => m.id);
                  exitSelect(); fixPreviewAfterDelete(ids);
                  const res = await Promise.allSettled(ids.map(id => deleteDoc(doc(db, "messages", id))));
                  const failed = res.filter(r => r.status === "rejected").length;
                  if (failed) { console.error(res.find(r => r.status === "rejected").reason); showToast(t("Не удалось удалить"), "error"); }
                  else showToast(t("Удалено: {n}", { n: ids.length }), "trash");
                  return;
              }
          }
      });

      // ===== ПЕРЕСЫЛКА =====
      let fwMsgs = null; // что пересылаем: одно сообщение или несколько выбранных
      function forwardTargets() {
          const items = [], seen = new Set();
          const add = (it) => { if (!seen.has(it.chatId)) { seen.add(it.chatId); items.push(it); } };
          const ts = (id) => getTime(chatsMetaCache[id]?.timestamp) || 0;
          Object.keys(chatsMetaCache).forEach(id => {
              const p = dmPeer(id); if (!p || iBlocked(p)) return;
              const u = usersCache[p]; if (!u || !u.name) return;
              add({ chatId: id, title: u.name, targetUid: p, isGroup: false, av: `<img src="${getAvatar(p, u.name)}">`, t: ts(id) });
          });
          Object.values(groupsCache).forEach(g => { if ((g.members || []).includes(currentUser.uid)) add({ chatId: g.id, title: g.name || t("Беседа"), targetUid: null, isGroup: true, av: `<img src="${safeImg(g.photoURL) || generateAvatarSVG(g.name, true)}">`, t: ts(g.id) }); });
          (usersCache[currentUser.uid]?.following || []).forEach(p => {
              const u = usersCache[p]; if (!u || !u.name || iBlocked(p)) return;
              const id = currentUser.uid < p ? currentUser.uid + "_" + p : p + "_" + currentUser.uid;
              add({ chatId: id, title: u.name, targetUid: p, isGroup: false, av: `<img src="${getAvatar(p, u.name)}">`, t: ts(id) });
          });
          items.sort((a, b) => b.t - a.t);
          items.unshift({ chatId: nestId(), title: t("Гнездо"), targetUid: null, isGroup: false, av: `<div class="fw-av nest">${NEST_SVG(22)}</div>`, t: Infinity });
          return items;
      }
      function renderForwardList() {
          const q = document.getElementById("fw-search").value.trim().toLowerCase();
          const list = forwardTargets().filter(i => !q || i.title.toLowerCase().includes(q));
          document.getElementById("fw-list").innerHTML = list.length
              ? list.map(i => `<div class="fw-item" data-chat="${escapeHTML(i.chatId)}">${i.av}<span>${escapeHTML(i.title)}</span></div>`).join("")
              : `<div class="empty-hint" style="margin:8px">${t("Чатов не найдено")}</div>`;
      }
      function openForward(m) {
          fwMsgs = Array.isArray(m) ? m : [m]; document.getElementById("fw-search").value = "";
          renderForwardList();
          document.getElementById("forward-screen").style.display = "flex";
      }
      const closeForward = () => { document.getElementById("forward-screen").style.display = "none"; fwMsgs = null; };
      document.getElementById("fw-close").addEventListener("click", closeForward);
      document.getElementById("fw-search").addEventListener("input", renderForwardList);
      document.getElementById("fw-list").addEventListener("click", async (e) => {
          const item = e.target.closest("[data-chat]"); if (!item || !fwMsgs) return;
          const target = forwardTargets().find(i => i.chatId === item.getAttribute("data-chat")); if (!target) return;
          const list = fwMsgs; closeForward();
          forwardManyTo(list, target);
      });
      // Переслать сообщение в чат (и «Сохранить в Гнездо» — это пересылка себе)
      const forwardMessageTo = (m, target, savedToast) => forwardManyTo([m], target, savedToast);
      // Несколько сообщений пересылаются по одному, в порядке переписки; на первой ошибке останавливаемся
      async function forwardManyTo(list, target, savedToast) {
          if (target.targetUid && (blockedMe(target.targetUid) || !canWriteTo(target.targetUid))) return showToast(t("Пользователь ограничил, кто может ему писать"), "block");
          let sent = 0;
          try { for (const m of list) { await forwardOne(m, target); sent++; } }
          catch (err) { return showToast(sent ? t("Переслано {n} из {total}: {error}", { n: sent, total: list.length, error: sendErrorText(err) }) : sendErrorText(err), "error"); }
          showToast(savedToast || t("Переслано в «{chat}»", { chat: target.title }), savedToast ? "check" : "forward");
      }
      async function forwardOne(m, target) {
          const orig = m.chatId === NEWS_ID ? { uid: "", name: "Owl Messenger" } : m.forwardedFrom && m.forwardedFrom.name ? m.forwardedFrom : { uid: m.uid || "", name: usersCache[m.uid]?.name || m.sender || "" };
          const data = { chatId: target.chatId, sender: currentUser.displayName, uid: currentUser.uid, timestamp: new Date(), read: false, forwardedFrom: orig };
          if (m.text) data.text = m.chatId === NEWS_ID ? newsText(m) : m.text; if (m.imageUrl) data.imageUrl = m.imageUrl; if (m.audioUrl) data.audioUrl = m.audioUrl; if (m.sticker && STICKER_IDS.has(m.sticker)) data.sticker = m.sticker;
          const preview = m.text ? m.text : m.imageUrl ? "📷 Фотография" : m.audioUrl ? "🎤 Голосовое сообщение" : data.sticker ? "🦉 Стикер" : "Сообщение";
          await postMessage(target.chatId, data, preview);
      }

      // ===== ОТВЕТ НА СООБЩЕНИЕ =====
      let replyingTo = null;
      function msgPreviewText(m) { return m.text ? m.text : (m.imageUrl ? "📷 Фотография" : (m.audioUrl ? "🎤 Голосовое сообщение" : (m.poll ? "📊 Опрос: " + m.poll.q : (m.sticker ? "🦉 Стикер" : "Сообщение")))); }
      window.startReply = (msgId) => {
          let m = loadedMsgs[msgId]; if (!m) return;
          if (editingMsgId) { editingMsgId = null; document.getElementById("message-input").value = ""; document.getElementById("send-button").innerHTML = sendIconSVG; }
          replyingTo = { id: m.id, uid: m.uid || "", sender: m.sender || "", text: msgPreviewText(m).slice(0, 140) };
          document.getElementById("reply-bar-name").innerText = replyingTo.sender;
          document.getElementById("reply-bar-text").innerHTML = iconizePreview(escapeHTML(replyingTo.text));
          document.getElementById("reply-bar").classList.add("on");
          let input = document.getElementById("message-input"); if (!input.disabled) input.focus();
      };
      function cancelReply() { replyingTo = null; let bar = document.getElementById("reply-bar"); if (bar) bar.classList.remove("on"); }
      document.getElementById("reply-cancel-btn").addEventListener("click", cancelReply);
      document.getElementById("message-input").addEventListener("keydown", e => { if (e.key === "Escape" && replyingTo) { e.stopPropagation(); cancelReply(); } });

      function showChatPlaceholder(on) { const el = document.getElementById("chat-placeholder"); if (el) el.classList.toggle("on", !!on); }
      window.loadChat = (chatId, title, targetUid, isGroup = false) => {
        try {
            if (!chatId) return;
            if (chatId === 'global' && !isAdmin) { chatId = NEWS_ID; title = t("Новости Owl"); targetUid = null; isGroup = false; }
            exitSelect();
            showChatPlaceholder(false);
            if (typeof closeChatSearch === "function") closeChatSearch();
            document.getElementById("chat-search-btn").style.display = "";
            Object.keys(pendingSince).forEach(k => delete pendingSince[k]); // следим только за сообщениями открытого чата
            currentChatId = chatId; editingMsgId = null; cancelReply(); closeChatNotifications(chatId); updateUnreadIndicators(totalUnread());
            currentChatTargetUid = (targetUid && !isGroup && chatId !== 'global') ? targetUid : null; currentTypers = [];

            if (chatId !== 'global') {
                setDoc(doc(db, "chats_metadata", chatId), chatId.includes("_") ? { unreadCount: 0, members: chatId.split("_") } : { unreadCount: 0 }, { merge: true }).catch(e=>console.log(e));
            }
            updatePinIcon();
            
            let qfBanner = document.getElementById("quick-follow-banner");
            if (targetUid && !isGroup && targetUid !== 'global') {
                let myFollowing = usersCache[currentUser.uid]?.following || [];
                if (!myFollowing.includes(targetUid)) {
                    document.getElementById("qf-name").innerText = title;
                    qfBanner.style.display = "flex";
                    
                    document.getElementById("qf-btn").onclick = async () => {
                        try {
                            await setFollow(targetUid, true);
                            showToast(t("Вы подписались!"), "check");
                            qfBanner.style.display = "none";
                            renderChatList(document.getElementById("search-input").value); 
                        } catch(e) { console.error(e); showToast(t("Не удалось подписаться"), "error"); }
                    };

                    let qfCloseBtn = document.getElementById("qf-close-btn");
                    if (qfCloseBtn) {
                        qfCloseBtn.onclick = () => { qfBanner.style.display = "none"; };
                    }
                } else {
                    qfBanner.style.display = "none";
                }
            } else {
                qfBanner.style.display = "none";
            }
            
            let msgInput = document.getElementById("message-input");
            if (isRecording) stopVoice(true); // закреплённая запись уходит в тот чат, где её начали
            msgInput.value = getDraft(chatId); msgInput.placeholder = t("Сообщение..."); document.getElementById("send-button").innerHTML = sendIconSVG;
            document.getElementById("mention-box").classList.remove("on");
            setTimeout(() => msgInput.dispatchEvent(new Event("owl-fit")), 0);
            
            let titleHtml = escapeHTML(title || t("Чат")); let statusHtml = ""; let headerTrigger = document.getElementById("header-profile-trigger");
            
            if (chatId === 'global') {
                if (isAdmin) { titleHtml = `<span style="display:flex; align-items:center; gap:5px;">${t("Глобальный чат")} <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg></span>`; statusHtml = "Закрыт · Настройки (Админ)"; headerTrigger.setAttribute("data-profile-target", "admin-settings"); headerTrigger.style.cursor = "pointer"; } 
                else { titleHtml = t("Глобальный чат"); statusHtml = t("Чат для всех пользователей приложения"); headerTrigger.removeAttribute("data-profile-target"); headerTrigger.style.cursor = "default"; }
            } else if (chatId === NEWS_ID) {
                titleHtml = `<span class="nest-title">${escapeHTML(t("Новости Owl"))}${OFFICIAL_SVG(16)}</span>`; statusHtml = t("Официальный канал Owl");
                headerTrigger.removeAttribute("data-profile-target"); headerTrigger.style.cursor = "default";
                markNewsSeen();
            } else if (isNest(chatId)) {
                titleHtml = `<span class="nest-title">${NEST_SVG(18)}${escapeHTML(t("Гнездо"))}</span>`; statusHtml = t("Ваши заметки и сохранённое");
                headerTrigger.removeAttribute("data-profile-target"); headerTrigger.style.cursor = "default";
            } else if (isGroup) { let g = groupsCache[chatId]; titleHtml = `<span style="display:flex; align-items:center;">${groupIconSVG} ${escapeHTML(title)}</span>`; statusHtml = g && g.members ? tp(g.members.length, "участник|участника|участников") : t("Группа"); headerTrigger.setAttribute("data-profile-target", chatId); headerTrigger.style.cursor = "pointer";
            } else { 
                if (targetUid) {
                    let u = usersCache[targetUid];
                    if (u && u.email === ADMIN_EMAIL) {
                        titleHtml += `<span style="display:inline-flex; align-items:center; margin-left:4px; transform:translateY(2px);" title="${t("Официальный аккаунт")}"><svg viewBox="0 0 24 24" width="16" height="16" fill="#3390ec"><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zm-1.9 14.7L6 12.6l1.5-1.5 2.6 2.6 6.4-6.4 1.5 1.5-7.9 7.9z"/></svg></span>`;
                    }
                }
                if (targetUid) titleHtml += verifiedBadge(targetUid, 15) + premiumBadge(targetUid, 17, true);
                statusHtml = t("Личные сообщения"); headerTrigger.setAttribute("data-profile-target", targetUid); headerTrigger.style.cursor = "pointer"; 
            }

            document.getElementById("current-chat-title").innerHTML = titleHtml; currentHeaderStatus = statusHtml; refreshHeaderStatus();
            if(window.innerWidth <= 768) openChatPane();

            renderChatList(document.getElementById("search-input").value); 

            if (activeListener) activeListener();
            if (typingListener) typingListener();

            if(targetUid !== null && !isGroup) {
                const tq = query(collection(db, "typing"), where("chatId", "==", currentChatId));
                typingListener = onSnapshot(tq, (snapshot) => {
                    let typers = [];
                    snapshot.forEach(d => { let data = d.data(); if(data.isTyping && data.uid !== currentUser.uid) { if (new Date() - (typeof data.timestamp.toDate === 'function' ? data.timestamp.toDate() : new Date(data.timestamp)) < 5000) typers.push(usersCache[data.uid]?.name || t("Собеседник")); }});
                    currentTypers = typers; refreshHeaderStatus();
                });
            }

            document.getElementById("chat-box").innerHTML = ""; loadedMsgs = {}; newBelow = 0; updateToBottom();
            // Liquid Glass: на компьютере переписка и заголовок нового чата мягко проявляются
            if (window.innerWidth > 768 && !reduceMotion()) ["chat-box", "main-chat"].forEach(id => {
                const el = id === "chat-box" ? document.getElementById(id) : document.querySelector("#main-chat .chat-header");
                if (!el) return; el.classList.remove("lg-enter"); void el.offsetWidth; el.classList.add("lg-enter");
                setTimeout(() => el.classList.remove("lg-enter"), 500);
            });
            const isPrivateChat = !!dmPeer(chatId);
            watchPeerBlock(isPrivateChat ? dmPeer(chatId) : null);
            applyBlockState();

            msgLimit = PAGE_SIZE; hasMoreMsgs = true; loadingOlder = false;

            subscribeMessages = () => {
            if (activeListener) activeListener();
            const q = query(collection(db, "messages"), where("chatId", "==", chatId), orderBy("timestamp", "desc"), limit(msgLimit));
            let firstSnap = true; // первый снимок (в т.ч. после подгрузки истории) — без звука
            
            // ВАЖНО: Умная отрисовка (Smart Render) работает БЕЗ морганий
            activeListener = onSnapshot(q, { includeMetadataChanges: true }, (snapshot) => {
              if (currentChatId !== chatId) return;
              let messages = [];
              trackPendingWrites(snapshot);

              const firstLoad = firstSnap;
              if (!firstSnap) snapshot.docChanges().forEach(change => { if (change.type === "added" && !change.doc.metadata.hasPendingWrites) { let msg = change.doc.data(); if (msg.uid !== currentUser.uid && !iBlocked(msg.uid)) { playNotifySound(); } } });
              firstSnap = false;

              snapshot.forEach(docSnap => {
                if (!SAFE_ID.test(docSnap.id)) return;
                let msg = { ...docSnap.data(), id: docSnap.id, _pending: docSnap.metadata.hasPendingWrites };
                messages.push(msg); loadedMsgs[docSnap.id] = msg;
              });
              markVisibleAsRead();
              
              messages.sort((a, b) => getTime(a.timestamp) - getTime(b.timestamp));

              let chatBox = document.getElementById("chat-box");
              let isScrolledToBottom = chatBox.scrollHeight - chatBox.clientHeight <= chatBox.scrollTop + 50;

              // Запоминаем верхнее видимое сообщение, чтобы экран не прыгал при вставке старых сверху
              let anchorRow = null, anchorOffset = 0;
              if (!isScrolledToBottom) {
                  for (const r of chatBox.children) { if (!r.classList.contains("message-row")) continue; if (r.offsetTop + r.offsetHeight > chatBox.scrollTop) { anchorRow = r; anchorOffset = r.offsetTop - chatBox.scrollTop; break; } }
              }

              chatBox.querySelectorAll(".day-sep").forEach(el => el.remove()); // расставим заново после раскладки
              let currentIds = [];
              let prevRow = null;

              messages.forEach((msg) => {
                currentIds.push(`msg-${msg.id}`);
                let existingRow = document.getElementById(`msg-${msg.id}`);
                
                let isMe = (msg.uid === currentUser.uid);
                // Пост канала: всегда слева, от имени Owl Messenger (ник админа не показываем); правит и удаляет — админ
                const chPost = chatId === NEWS_ID, authorIsMe = isMe;
                if (chPost) isMe = false;
                let timeString = ""; if (msg.timestamp) { let dateObj = typeof msg.timestamp.toDate === 'function' ? msg.timestamp.toDate() : new Date(msg.timestamp); if (!isNaN(dateObj)) timeString = dateObj.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}); }

                if (existingRow) {
                    // ЕСЛИ СООБЩЕНИЕ УЖЕ ЕСТЬ НА ЭКРАНЕ - ОБНОВЛЯЕМ ТОЛЬКО ДЕТАЛИ
                    let reactionsContainer = existingRow.querySelector('.reactions-list-container');
                    if (reactionsContainer) {
                        let newReactions = buildReactionsHtml(msg);
                        if (reactionsContainer.innerHTML !== newReactions) {
                            const before = {}; reactionsContainer.querySelectorAll("[data-r]").forEach(b => { before[b.dataset.r] = b.dataset.n; });
                            reactionsContainer.innerHTML = newReactions;
                            // новая реакция «выпрыгивает», у изменившейся подпрыгивает счётчик
                            reactionsContainer.querySelectorAll("[data-r]").forEach(b => { if (!(b.dataset.r in before)) b.classList.add("rx-new"); else if (before[b.dataset.r] !== b.dataset.n) b.classList.add("rx-bump"); });
                        }
                    }

                    let pollEl = existingRow.querySelector('.poll');
                    if (pollEl && msg.poll) { const sig = JSON.stringify(msg.votes || {}); if (pollEl.dataset.sig !== sig) { pollEl.innerHTML = pollInner(msg); pollEl.dataset.sig = sig; } }
                    let ticksEl = existingRow.querySelector('.msg-ticks');
                    if (ticksEl && isMe && ticksEl.getAttribute('data-state') !== tickState(msg)) ticksEl.outerHTML = ticksHtmlFor(msg);

                    let textEl = existingRow.querySelector('.msg-text-content');
                    if(textEl && msg.edited) {
                         const shown = chPost ? newsText(msg) : msg.text;
                         if (textEl.dataset.raw !== shown) { textEl.innerHTML = highlightMentions(linkify(shown), msg); textEl.dataset.raw = shown; }
                         let editedMarker = existingRow.querySelector('.edited-marker');
                         if(editedMarker && editedMarker.style.display === 'none') editedMarker.style.display = 'inline';
                    }

                } else {
                    // ЕСЛИ СООБЩЕНИЯ ЕЩЕ НЕТ - СОЗДАЕМ ЕГО
                    let avatarUrl = chPost ? "icon-192.png" : getAvatar(msg.uid, msg.sender);
                    let messageRow = document.createElement("div");
                    messageRow.id = `msg-${msg.id}`;
                    messageRow.className = isMe ? "message-row my-msg" : "message-row other-msg";
                    if (!firstLoad && Date.now() - getTime(msg.timestamp) < 60000) messageRow.classList.add(isMe ? "msg-in-me" : "msg-in"); // только что пришло — «выплывает»
                    messageRow.setAttribute("data-msg-id", msg.id);
                    messageRow.setAttribute("data-uid", msg.uid || "");
                    messageRow.setAttribute("data-ts", String(getTime(msg.timestamp) || 0));
                    if (!chPost) watchUser(msg.uid);
                    if (!isMe && !isPrivateChat && !chPost && iBlocked(msg.uid)) messageRow.classList.add("from-blocked");

                    let avatarHtml = chPost ? `<img src="${avatarUrl}" class="avatar chat-msg-avatar" alt="">` : `<img src="${avatarUrl}" class="avatar chat-msg-avatar" data-profile-target="${escapeHTML(msg.uid)}" title="${t("Смотреть профиль")}">`;
                    let contentHtml = `<div class="message-content">`;

                    let actionsHtml = `<div class="msg-actions"><button class="msg-action-btn reply-btn" data-id="${msg.id}" title="${t("Ответить")}">${replyIconSVG}</button><button class="msg-action-btn" data-rx="👍">👍</button><button class="msg-action-btn" data-rx="❤">❤️</button><button class="msg-action-btn" data-rx="😂">😂</button>`;
                    if ((isMe || (chPost && authorIsMe)) && !msg.guard && !msg.call) actionsHtml += `<button class="msg-action-btn edit-btn" data-id="${msg.id}" data-text="${escapeHTML(msg.text || '')}" title="${t("Редактировать")}">${editIconSVG}</button>`;
                    if (isMe || isAdmin) actionsHtml += `<button class="msg-action-btn delete-btn" data-id="${msg.id}" title="${t("Удалить")}">${deleteIconSVG}</button>`;
                    if (!isMe && !isAdmin) actionsHtml += `<button class="msg-action-btn report-btn" data-id="${msg.id}" title="${t("Пожаловаться")}">${icon("flag", 16)}</button>`;
                    actionsHtml += `</div>`; contentHtml += actionsHtml;

                    if (chPost) {
                        contentHtml += `<span class="sender-name chat-msg-name" style="display:flex; align-items:center;">Owl Messenger<span style="display:inline-flex; margin-left:4px; transform:translateY(1px);">${OFFICIAL_SVG(13)}</span></span>`;
                    } else if (!isMe) {
                        let isMsgOfficial = false;
                        if (usersCache[msg.uid] && usersCache[msg.uid].email === ADMIN_EMAIL) { isMsgOfficial = true; } else if (msg.uid === currentUser.uid && isAdmin) { isMsgOfficial = true; }
                        let officialBadge = isMsgOfficial ? `<span style="display:inline-flex; align-items:center; margin-left:4px; transform:translateY(1px);" title="${t("Официальный аккаунт")}"><svg viewBox="0 0 24 24" width="13" height="13" fill="#3390ec"><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zm-1.9 14.7L6 12.6l1.5-1.5 2.6 2.6 6.4-6.4 1.5 1.5-7.9 7.9z"/></svg></span>` : "";
                        let senderLabel = (isGroup && groupsCache[chatId] && groupsCache[chatId].adminUid === msg.uid) ? `<span style="font-size:9px; background:var(--accent); color:white; padding:2px 4px; border-radius:4px; margin-left:4px;">${t("Админ")}</span>` : "";
                        contentHtml += `<span class="sender-name chat-msg-name" data-profile-target="${escapeHTML(msg.uid)}" style="display:flex; align-items:center;">${escapeHTML(usersCache[msg.uid]?.name || msg.sender)}<span class="official-slot" data-official-uid="${escapeHTML(msg.uid)}" style="display:inline-flex;">${officialBadge}</span>${isMsgOfficial ? '' : verifiedBadge(msg.uid, 12)}${premiumBadge(msg.uid, 13)} ${senderLabel}</span>`;
                        contentHtml += `<span class="blocked-note">${t("Сообщение скрыто — вы заблокировали автора")}</span>`;
                    }

                    if (msg.forwardedFrom && msg.forwardedFrom.name) contentHtml += `<div class="fwd-label">${icon("forward", 13)}<span>${t("Переслано от {name}", { name: `<b>${escapeHTML(usersCache[msg.forwardedFrom.uid]?.name || msg.forwardedFrom.name)}</b>` })}</span></div>`;
                    // Цитата: если исходное сообщение загружено — автор и текст из него самого (в replyTo их пишет отвечающий, их можно подделать)
                    if (msg.replyTo && msg.replyTo.id) { const o = Object.prototype.hasOwnProperty.call(loadedMsgs, msg.replyTo.id) ? loadedMsgs[msg.replyTo.id] : null, rs = o ? (usersCache[o.uid]?.name || o.sender) : (usersCache[msg.replyTo.uid]?.name || msg.replyTo.sender), rt = o ? msgPreviewText(o).slice(0, 140) : msg.replyTo.text;
                      contentHtml += `<div class="reply-quote" data-reply-id="${escapeHTML(msg.replyTo.id)}"><b>${escapeHTML(rs || '')}</b><span>${iconizePreview(escapeHTML(rt || ''))}</span></div>`; }
                    if (msg.guard) messageRow.classList.add(msg.guard.kind === "ok" ? "guard-ok-msg" : "guard-msg");
                    if (msg.call) { messageRow.classList.add("call-msg"); contentHtml += callNoteHtml(msg, isMe); }
                    if (msg.text && !msg.call) { const shown = chPost ? newsText(msg) : msg.guard ? guardMsgText(msg) : msg.text; let body = highlightMentions(linkify(shown), msg); if (msg.guard) body = body.replace(/^(⚠\uFE0F?|✅)/u, (e) => emojiIcon(e)); contentHtml += `<span class="msg-text-content" data-raw="${escapeHTML(shown)}">${body}</span>`; }
                    if (chPost && LANG !== "ru" && msg.i18n && msg.i18n[LANG]) contentHtml += `<button type="button" class="tr-note" data-tr="${escapeHTML(msg.id)}">${emojiIcon("🌐")} ${t(newsOrig.has(msg.id) ? "Показать перевод" : "Переведено автоматически · оригинал")}</button>`;
                    if (Array.isArray(msg.mentions) && msg.mentions.includes(currentUser.uid) && !isMe) messageRow.classList.add("mentions-me");
                    if (isDataUrl(msg.imageUrl, "image")) contentHtml += `<img src="${escapeHTML(msg.imageUrl)}">`;
                    if (msg.sticker && STICKER_IDS.has(msg.sticker)) {
                        messageRow.classList.add("sticker-msg");
                        const fresh = Date.now() - getTime(msg.timestamp) < 15000;
                        contentHtml += `<img class="msg-sticker${fresh ? " fresh" : ""}" src="sticker-${msg.sticker}.png" alt="${t("Стикер")}" draggable="false">`;
                    }
                    if (isDataUrl(msg.audioUrl, "audio")) contentHtml += voicePlayerHtml(msg.id, msg.audioUrl);
                    if (msg.poll) contentHtml += `<div class="poll" data-poll="${escapeHTML(msg.id)}">${pollInner(msg)}</div>`;
                    { const lu = msg.text && firstExternalLink(msg.text); if (lu) contentHtml += `<a class="lp" data-lp-url="${escapeHTML(lu)}" href="${escapeHTML(lu)}" target="_blank" rel="noopener noreferrer nofollow"></a>`; }

                    let editedHtml = `<span class="edited-marker" style="font-size:10px; opacity:0.5; margin-right:4px; display:${msg.edited ? 'inline' : 'none'};">${t("(изм.)")}</span>`;
                    let ticksHtml = isMe ? ticksHtmlFor(msg) : "";
                    
                    contentHtml += `<div class="msg-meta">${editedHtml}<span class="msg-time">${timeString}</span>${ticksHtml}</div>`;
                    contentHtml += `<div class="reactions-list-container">${buildReactionsHtml(msg)}</div>`;
                    contentHtml += `</div>`;

                    messageRow.innerHTML = isMe ? contentHtml : avatarHtml + contentHtml;
                    existingRow = messageRow;
                }
                // Ставим строку на её место по времени (старые при подгрузке — наверх)
                let expected = prevRow ? prevRow.nextSibling : chatBox.firstChild;
                if (existingRow !== expected) chatBox.insertBefore(existingRow, expected);
                prevRow = existingRow;
              });

              // Удаляем сообщения, которые были удалены из БД
              Array.from(chatBox.children).forEach(child => {
                  if (!currentIds.includes(child.id)) child.remove();
              });
              placeDaySeparators(chatBox);
              observeVoices(chatBox);
              loadLinkPreviews(chatBox);
              if (chatSearchQuery) runChatSearch(false);
              if (!firstLoad && !isScrolledToBottom) {
                  const fresh = snapshot.docChanges().filter(c => c.type === "added" && !c.doc.metadata.hasPendingWrites && c.doc.data().uid !== currentUser.uid && getTime(c.doc.data().timestamp) > Date.now() - 60000).length;
                  if (fresh) { newBelow += fresh; updateToBottom(); }
              }

              // Пока ответ пришёл только из локального кэша и он неполный — ждём сервер, чтобы не решить, что истории больше нет
              if (!snapshot.metadata.fromCache || snapshot.size >= msgLimit) { hasMoreMsgs = snapshot.size >= msgLimit; loadingOlder = false; }

              if (isScrolledToBottom || !initialChatLoads[chatId + "_scroll"]) {
                  chatBox.scrollTop = chatBox.scrollHeight;
                  initialChatLoads[chatId + "_scroll"] = true;
              } else if (anchorRow && anchorRow.isConnected) {
                  chatBox.scrollTop = anchorRow.offsetTop - anchorOffset;
              }

              // Если сообщений мало и прокрутки нет — сразу догружаем ещё
              if (hasMoreMsgs && !loadingOlder && chatBox.scrollHeight <= chatBox.clientHeight + 150) loadOlderMessages();
            });
            };
            subscribeMessages();
        } catch (err) { console.error("Ошибка загрузки чата: ", err); }
      };

      // УМНАЯ СИСТЕМА ДОБАВЛЕНИЯ/УДАЛЕНИЯ РЕАКЦИЙ
      window.addReaction = async (msgId, emoji) => {
        if(!currentUser) return;
        emoji = String(emoji).replace(/\ufe0f/g, ""); // база принимает ❤ без «эмодзи-модификатора»
        if (!REACTION_SET.has(emoji) || !SAFE_ID.test(msgId)) return;
        try { 
            const msgRef = doc(db, "messages", msgId);
            const snap = await getDoc(msgRef);
            if(snap.exists()) {
                let data = snap.data();
                // Если пользователь уже ставил ЭТОТ эмодзи - мы его удаляем (toggle)
                if(data.reactions && data.reactions[currentUser.uid] === emoji) {
                    await updateDoc(msgRef, { [`reactions.${currentUser.uid}`]: deleteField() });
                } else {
                    // Иначе добавляем / заменяем на новый
                    await updateDoc(msgRef, { [`reactions.${currentUser.uid}`]: emoji });
                }
            }
        } catch(e) { console.error(e) }
      };

      document.getElementById("chat-box").addEventListener("click", async (e) => {
        if (vpClick(e)) return;
        // реакция: значок под сообщением или быстрые кнопки 👍 ❤️ 😂
        { const rx = e.target.closest(".reaction-badge[data-r], .msg-action-btn[data-rx]"), row = rx && rx.closest(".message-row[data-msg-id]");
          if (row) { addReaction(row.getAttribute("data-msg-id"), rx.getAttribute("data-r") || rx.getAttribute("data-rx")); return; } }
        { const vb = e.target.closest(".poll-opt"); if (vb) { const pid = vb.closest(".poll").getAttribute("data-poll"); votePoll(pid, +vb.getAttribute("data-vote")); return; } }
        if (e.target.closest(".lp")) return; // карточка ссылки — обычная ссылка
        let owlLink = e.target.closest("a[data-owl-link]");
        if (owlLink) {
           e.preventDefault();
           try {
               const u = new URL(owlLink.href), add = u.searchParams.get("add"), chat = u.searchParams.get("chat");
               if (add) { window.__pendingAdd = add; openPendingInvite(); }
               else if (chat) window.openChatById(chat);
               else if (u.pathname.length > 1) window.open(u.href, "_blank", "noopener");
           } catch (_) {}
           return;
        }
        if (e.target.closest("a.msg-link")) return; // обычная ссылка — пусть браузер откроет
        const photo = e.target.closest(".message-content > img");
        if (photo) {
           const row = photo.closest(".message-row"), m = row && loadedMsgs[row.getAttribute("data-msg-id")];
           const who = m ? (usersCache[m.uid]?.name || m.sender || "") : "";
           openPhoto(photo.src, who + (m && m.timestamp ? " · " + dayLabel(getTime(m.timestamp)) + ", " + new Date(getTime(m.timestamp)).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""), photo);
           return;
        }
        let replyBtn = e.target.closest(".reply-btn");
        if (replyBtn) { startReply(replyBtn.getAttribute("data-id")); return; }
        let reportBtn = e.target.closest(".report-btn");
        if (reportBtn) { const m = loadedMsgs[reportBtn.getAttribute("data-id")]; if (m) openReport({ targetUid: m.uid, message: m }); return; }
        let quote = e.target.closest(".reply-quote");
        if (quote) {
           let target = document.getElementById("msg-" + quote.getAttribute("data-reply-id"));
           if (target) { target.scrollIntoView({ behavior: reduceMotion() ? "auto" : "smooth", block: "center" }); target.classList.remove("msg-flash"); void target.offsetWidth; target.classList.add("msg-flash"); }
           else showToast(t("Сообщение слишком старое или удалено"), "info");
           return;
        }
        let editBtn = e.target.closest(".edit-btn");
        if (editBtn) { startEdit(editBtn.getAttribute("data-id")); return; }
        let deleteBtn = e.target.closest(".delete-btn");
        if (deleteBtn) deleteMessage(deleteBtn.getAttribute("data-id"));
      });

      let mediaRecorder; let audioChunks = []; let isRecording = false;

      // ===== ГОЛОСОВЫЕ: удерживать — запись, отпустить — отправить, влево — отмена, вверх — закрепить =====
      // Короткое нажатие (или клик мышью) сразу включает закреплённую запись с кнопками «Отмена» / «Отправить».
      const REC_CANCEL_DX = 110, REC_LOCK_DY = 70, REC_MIN_MS = 600, REC_TAP_MS = 300;
      // Запись в базе — до 1 МБ (1 048 576 байт), а при сохранении текстом голосовое вырастает на треть: 700 КБ звука ≈ 0,93 МБ
      const VOICE_MAX_BYTES = 700000, VOICE_MAX_DATAURL = 1000000;
      const recArea = document.querySelector(".input-area"), voiceBtn = document.getElementById("voice-btn");
      const recTimeEl = document.getElementById("rec-time"), recWave = document.getElementById("rec-wave");
      let rec = null; // { chatId, startedAt, x0, y0, locked, tapPending, pointerId, ctx, raf, levels }
      const vibe = (ms) => { try { navigator.vibrate && navigator.vibrate(ms); } catch (_) {} };
      const voiceSendSVG = sendIconSVG;
      const voiceMicSVG = voiceBtn.innerHTML;
      // Микрофон вместо «Отправить», пока поле пустое и мы не редактируем сообщение
      const voiceInput = document.getElementById("message-input");
      function syncVoiceBtn() { recArea.classList.toggle("empty", isRecording || (!voiceInput.value.trim() && !editingMsgId)); }
      voiceInput.addEventListener("input", syncVoiceBtn);
      voiceInput.addEventListener("owl-fit", syncVoiceBtn);
      document.addEventListener("click", () => setTimeout(syncVoiceBtn, 0));

      function setRecVars(dx, dy) {
          recArea.style.setProperty("--dx", dx + "px");
          recArea.style.setProperty("--dy", dy + "px");
          recArea.style.setProperty("--hint-op", String(Math.max(0, 1 + dx / REC_CANCEL_DX)));
          recArea.style.setProperty("--lock-dy", Math.max(-REC_LOCK_DY, dy) * .5 + "px");
      }
      function recTick() {
          if (!rec) return;
          const ms = Date.now() - rec.startedAt, sec = Math.floor(ms / 1000);
          recTimeEl.textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")},${Math.floor(ms % 1000 / 100)}`;
          let lvl = 0;
          if (rec.an) {
              rec.an.getByteTimeDomainData(rec.buf);
              let sum = 0; for (let i = 0; i < rec.buf.length; i++) { const v = (rec.buf[i] - 128) / 128; sum += v * v; }
              lvl = Math.min(1, Math.sqrt(sum / rec.buf.length) * 4);
          }
          rec.smooth = rec.smooth * .7 + lvl * .3;
          voiceBtn.style.setProperty("--lvl", rec.smooth.toFixed(3));
          if (ms - (rec.lastBar || 0) > 90) { // новая палочка волны ~11 раз в секунду
              rec.lastBar = ms;
              const bar = document.createElement("i"); bar.style.height = Math.max(3, Math.round(3 + rec.smooth * 21)) + "px";
              recWave.appendChild(bar);
              const maxBars = Math.max(60, Math.ceil(recWave.clientWidth / 5) + 2); // палочка 3px + промежуток 2px — заполняем всю ширину (на ПК поле шире)
              while (recWave.children.length > maxBars) recWave.firstChild.remove();
          }
          rec.raf = requestAnimationFrame(recTick);
      }
      async function startVoice(e) {
          if (rec || !currentChatId) return;
          rec = { chatId: currentChatId, startedAt: 0, x0: e.clientX, y0: e.clientY, pressAt: Date.now(), locked: false, tapPending: false, pointerId: e.pointerId, smooth: 0 };
          try { voiceBtn.setPointerCapture(e.pointerId); } catch (_) {}
          const my = rec;
          try {
              if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) throw Object.assign(new Error("unsupported"), { name: "NotSupportedError" });
              setAudioSession("play-and-record"); // в режиме ambient (для звуков уведомлений) iOS не даёт микрофон
              const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
              if (rec !== my) { stream.getTracks().forEach(t => t.stop()); restoreAmbient(); return; } // отпустили/отменили, пока спрашивали доступ
              // Голосовое хранится прямо в сообщении, а запись в базе — не больше 1 МБ. Поэтому пишем в «голосовом»
              // качестве (~32 кбит/с — несколько минут речи) и следим за размером: у предела запись сама остановится и отправится
              try { mediaRecorder = new MediaRecorder(stream, { audioBitsPerSecond: 32000 }); } catch (_) { mediaRecorder = new MediaRecorder(stream); }
              audioChunks = []; let recBytes = 0;
              mediaRecorder.ondataavailable = ev => {
                  if (ev.data.size > 0) { audioChunks.push(ev.data); recBytes += ev.data.size; }
                  if (rec === my && recBytes > VOICE_MAX_BYTES && !my.autoStop) { my.autoStop = true; showToast(t("Достигнута максимальная длина голосового — отправляем"), "mic"); stopVoice(true); }
              };
              mediaRecorder.start(1000); isRecording = true; // кусочки раз в секунду — чтобы знать размер во время записи
              rec.startedAt = Date.now(); rec.stream = stream;
              try { // уровень громкости — для ореола и волны
                  const AC = window.AudioContext || window.webkitAudioContext;
                  rec.ctx = new AC(); rec.an = rec.ctx.createAnalyser(); rec.an.fftSize = 512;
                  rec.ctx.createMediaStreamSource(stream).connect(rec.an); rec.buf = new Uint8Array(rec.an.fftSize);
              } catch (_) { rec.an = null; }
              recWave.innerHTML = ""; setRecVars(0, 0);
              recArea.classList.remove("rec-cancel"); recArea.classList.add("rec", "empty");
              vibe(12);
              // Нажали и сразу отпустили (в том числе пока iPhone спрашивал доступ) — закреплённый режим
              if (rec.tapPending) lockVoice();
              recTick();
          } catch (err) {
              console.error(err); rec = null; isRecording = false; restoreAmbient();
              const why = {
                  NotAllowedError: t("Нет доступа к микрофону. Разрешите его: на iPhone — Настройки → Приложения → Safari → Микрофон, на компьютере — значок замка в адресной строке."),
                  SecurityError: t("Нет доступа к микрофону. Разрешите его в настройках браузера для этого сайта."),
                  NotFoundError: t("Микрофон не найден. Проверьте, что он подключён."),
                  NotReadableError: t("Микрофон занят другим приложением (например, звонком). Завершите его и попробуйте снова."),
                  NotSupportedError: t("Этот браузер не умеет записывать голосовые. Обновите его или откройте Owl в Safari/Chrome.")
              }[err && err.name] || (t("Не удалось включить микрофон") + (err && err.name ? " (" + err.name + ")" : "") + ". " + t("Попробуйте ещё раз."));
              alert(why);
          }
      }
      function lockVoice() {
          if (!rec || rec.locked) return;
          rec.locked = true; setRecVars(0, 0);
          recArea.classList.add("locked"); voiceBtn.innerHTML = voiceSendSVG; voiceBtn.title = t("Отправить голосовое");
          vibe(8);
      }
      // send = true — отправить, false — отменить
      function stopVoice(send) {
          const r = rec; if (!r) return;
          rec = null; cancelAnimationFrame(r.raf);
          const recorder = mediaRecorder, chatId = r.chatId, dur = r.startedAt ? Date.now() - r.startedAt : 0;
          if (recorder && recorder.state !== "inactive") {
              recorder.onstop = () => {
                  const chunks = audioChunks; audioChunks = [];
                  if (send && dur >= REC_MIN_MS && chunks.length) {
                      const reader = new FileReader();
                      reader.onload = (ev) => {
                          if (ev.target.result.length > VOICE_MAX_DATAURL) return showToast(t("Голосовое слишком длинное — запишите покороче или разбейте на несколько"), "error");
                          sendMessage(null, null, ev.target.result, chatId);
                      };
                      reader.readAsDataURL(new Blob(chunks, { type: recorder.mimeType || "audio/mp4" }));
                  }
                  restoreAmbient();
              };
              recorder.stop();
          }
          if (r.stream) r.stream.getTracks().forEach(t => t.stop());
          if (r.ctx) r.ctx.close().catch(() => {});
          isRecording = false;
          voiceBtn.innerHTML = voiceMicSVG; voiceBtn.title = t("Удерживайте — запись, влево — отмена, вверх — без рук"); voiceBtn.style.setProperty("--lvl", "0");
          const finish = () => { recArea.classList.remove("rec", "locked", "rec-cancel"); setRecVars(0, 0); syncVoiceBtn(); };
          if (!send) { recArea.classList.add("rec-cancel"); vibe([10, 40, 10]); setTimeout(finish, 320); }
          else { finish(); if (dur && dur < REC_MIN_MS) showToast(t("Удерживайте кнопку, чтобы записать голосовое"), "info"); }
          if (!r.startedAt) restoreAmbient();
      }
      voiceBtn.addEventListener("contextmenu", e => e.preventDefault());
      voiceBtn.addEventListener("pointerdown", (e) => {
          if (e.button && e.button !== 0) return;
          e.preventDefault(); // не забираем фокус у поля и не вызываем выделение/лупу на iPhone
          if (rec && rec.locked) { stopVoice(true); return; } // закреплённая запись: кнопка = «Отправить»
          startVoice(e);
      });
      voiceBtn.addEventListener("pointermove", (e) => {
          if (!rec || rec.locked || e.pointerId !== rec.pointerId || !rec.startedAt) return;
          const dx = Math.min(0, e.clientX - rec.x0), dy = Math.min(0, e.clientY - rec.y0);
          if (dx < -12 || dy < -12) rec.held = true;
          if (-dx > REC_CANCEL_DX) { stopVoice(false); return; }
          if (-dy > REC_LOCK_DY) { lockVoice(); return; }
          // Тянем либо влево, либо вверх — по преобладающему направлению
          if (-dx > -dy) setRecVars(dx, 0); else setRecVars(0, dy);
      });
      const voiceRelease = (e) => {
          if (!rec || rec.locked || e.pointerId !== rec.pointerId) return;
          const quick = Date.now() - rec.pressAt < REC_TAP_MS && !rec.held;
          if (!rec.startedAt) { rec.tapPending = true; return; } // ещё ждём микрофон (iPhone спрашивает доступ) — запись начнётся закреплённой
          if (quick) { lockVoice(); return; }
          stopVoice(e.type === "pointerup");
      };
      voiceBtn.addEventListener("pointerup", voiceRelease);
      voiceBtn.addEventListener("pointercancel", voiceRelease);
      document.getElementById("rec-cancel").addEventListener("click", () => stopVoice(false));
      document.addEventListener("keydown", (e) => { if (e.key === "Escape" && rec) stopVoice(false); });
      syncVoiceBtn();

      // Правила базы принимают текст сообщения до 4000 символов. Длиннее — делим на части (как Telegram), по абзацам и предложениям
      const MAX_TEXT = 4000;
      function splitLongText(text, max = MAX_TEXT) {
          const parts = []; let rest = text;
          while (rest.length > max) {
              const win = rest.slice(0, max), min = max * 0.5;
              let cut = win.lastIndexOf("\n\n");
              if (cut < min) cut = win.lastIndexOf("\n");
              if (cut < min) cut = Math.max(win.lastIndexOf(". "), win.lastIndexOf("! "), win.lastIndexOf("? "), win.lastIndexOf("… ")) + 1;
              if (cut < min) cut = win.lastIndexOf(" ");
              if (cut < min) cut = max;
              parts.push(rest.slice(0, cut).trimEnd()); rest = rest.slice(cut).trimStart();
          }
          if (rest) parts.push(rest);
          return parts;
      }
      async function sendMessage(text, imageUrl = null, audioUrl = null, targetChat = null, sticker = null) {
        if (sticker && !STICKER_IDS.has(sticker)) return;
        if (!currentUser || iAmBanned) return;
        { const peer = dmPeer(targetChat || currentChatId); if (peer && (iBlocked(peer) || blockedMe(peer) || !canWriteTo(peer))) { applyBlockState(); return showToast(iBlocked(peer) ? t("Вы заблокировали этого пользователя") : t("Пользователь ограничил, кто может ему писать"), "block"); } }
        
        const chatId = targetChat || currentChatId; // запоминаем сразу: пока идёт запись, человек может переключить чат

        if (text && !editingMsgId && text.length > MAX_TEXT && !imageUrl && !audioUrl && !sticker) {
            const parts = splitLongText(text);
            for (let i = 0; i < parts.length; i++) {
                if (i && chatId === "global") await new Promise(r => setTimeout(r, 1200)); // в общем чате — не чаще раза в секунду
                if (!(await sendMessage(parts[i], null, null, chatId))) return false; // на ошибке останавливаемся, чтобы не нарушить порядок
            }
            return true;
        }

        if (editingMsgId && text) {
            const editedId = editingMsgId;
            editingMsgId = null; document.getElementById("send-button").innerHTML = sendIconSVG;
            const upd = { text: text, edited: true };
            if (chatId === NEWS_ID && isAdmin) { const tr = await translateNews(text); upd.i18n = tr || deleteField(); } // пост канала — переводы заново
            const edit = updateDoc(doc(db, "messages", editedId), upd);
            // Превью меняем, только если отредактировали последнее сообщение чата
            const latest = latestLoadedMsg();
            if (latest && latest.id === editedId) setDoc(doc(db, "chats_metadata", chatId), { lastMessageText: "✏️ " + text }, { merge: true }).catch(e => console.log(e));
            await edit;
            return;
        }

        let msgData = { chatId: chatId, sender: currentUser.displayName, uid: currentUser.uid, timestamp: new Date(), read: false };
        const mentioned = text ? mentionsIn(text, chatId) : [];
        if (mentioned.length) msgData.mentions = mentioned;
        if (text) msgData.text = text; if (imageUrl) msgData.imageUrl = imageUrl; if (audioUrl) msgData.audioUrl = audioUrl; if (sticker) msgData.sticker = sticker;
        if (replyingTo) { msgData.replyTo = replyingTo; cancelReply(); }
        if (nightUrgent && dmPeer(chatId) === currentChatTargetUid && peerNight(currentChatTargetUid)?.u) msgData.urgent = true; // разбудить собеседника
        if (nightUrgent) { nightUrgent = false; refreshNightBar(); }
        // Пост в канале — от имени Owl Messenger и сразу с переводами на en/de/pl
        if (chatId === NEWS_ID && isAdmin) {
            msgData.sender = "Owl Messenger";
            if (text) { showToast(t("Переводим пост…"), "clock"); const tr = await translateNews(text); if (tr) msgData.i18n = tr; }
        }

        let previewText = "";
        if (text) previewText = text; else if (imageUrl) previewText = "📷 Фотография"; else if (audioUrl) previewText = "🎤 Голосовое сообщение"; else if (sticker) previewText = "🦉 Стикер";

        let sentRef;
        try { sentRef = await postMessage(chatId, msgData, previewText); }
        catch (err) { showToast(sendErrorText(err), "error"); return false; }
        // Упомянутым — уведомление в колокольчик (в беседе им ещё придёт обычный push)
        if (mentioned.length) {
            const where = chatId === "global" ? "глобальном чате" : `беседе «${groupsCache[chatId]?.name || "Беседа"}»`;
            const snippet = text.replace(/\s+/g, " ").slice(0, 90);
            mentioned.forEach(uid => addDoc(collection(db, "notifications"), { fromUid: currentUser.uid, toUid: uid, text: `${currentUser.displayName} упомянул(а) вас в ${where}: ${snippet}`, timestamp: new Date(), read: false, type: "mention", chatId, msgId: sentRef.id }).catch(() => {})); // база сверит: сообщение есть и в нём упомянут получатель
        }
        return true;
      }
      const sendErrorText = (err) => err && err.code === "owl/rate" ? t("Не так быстро — в общий чат можно писать раз в секунду") : err && err.code === "owl/rate-min" ? t("Слишком много сообщений подряд — подождите минуту") : err && err.code === "permission-denied" ? t("Сообщение не отправлено: нет доступа к этому чату") : t("Сообщение не отправлено. Попробуйте ещё раз");
      // Записать сообщение в чат: само сообщение и превью пишем одновременно, не дожидаясь сервера —
      // Firestore сразу обновляет локальную копию, поэтому список чатов меняется мгновенно
      // Глобальный чат видят все — не чаще одного сообщения в секунду от человека. Вместе с сообщением пишем
      // отметку ratelimits/{я}.g = время сервера, правила базы сверяют её с прошлой (защита от флуда скриптами)
      let lastGlobalSend = 0;
      const globalTooFast = () => currentChatId === "global" && !isAdmin && Date.now() - lastGlobalSend < 1100;
      // ===== РЕЗЕРВНАЯ КОПИЯ БАЗЫ (только админ) =====
      // Сервер owl-push читает базу служебным ключом и отдаёт по страницам (нужен пароль копии — секрет BACKUP_KEY в Cloudflare).
      // Здесь собираем всё в один JSON, сжимаем (gzip) и шифруем паролем: PBKDF2 (250 000 итераций) → AES-256-GCM.
      // Формат файла .owlbak: "OWLBAK1" (7 байт) + флаг сжатия (1) + соль (16) + iv (12) + шифротекст
      const BK_MAGIC = "OWLBAK1";
      async function bkKey(pass, salt, usage) {
          const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(pass), "PBKDF2", false, ["deriveKey"]);
          return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: 250000, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, [usage]);
      }
      const gzipOk = typeof CompressionStream === "function" && typeof DecompressionStream === "function";
      const streamBytes = async (bytes, ts) => new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(ts)).arrayBuffer());
      async function bkEncrypt(text, pass) {
          let data = new TextEncoder().encode(text); const gz = gzipOk ? 1 : 0;
          if (gz) data = await streamBytes(data, new CompressionStream("gzip"));
          const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
          const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await bkKey(pass, salt, "encrypt"), data);
          return new Blob([new TextEncoder().encode(BK_MAGIC), new Uint8Array([gz]), salt, iv, new Uint8Array(ct)], { type: "application/octet-stream" });
      }
      async function bkDecrypt(buf, pass) {
          const b = new Uint8Array(buf);
          if (new TextDecoder().decode(b.slice(0, 7)) !== BK_MAGIC) throw new Error("Это не файл резервной копии Owl");
          const gz = b[7], salt = b.slice(8, 24), iv = b.slice(24, 36);
          let data;
          try { data = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv }, await bkKey(pass, salt, "decrypt"), b.slice(36))); }
          catch (_) { throw new Error("Неверный пароль или файл повреждён"); }
          if (gz) data = await streamBytes(data, new DecompressionStream("gzip"));
          return new TextDecoder().decode(data);
      }
      const saveBlob = (blob, name) => { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 60000); };
      const bkStatus = (t) => { document.getElementById("bk-status").innerHTML = iconizeEmoji(escapeHTML(t)); };
      document.getElementById("bk-download").addEventListener("click", async (e) => {
          const pass = document.getElementById("bk-key").value, btn = e.currentTarget;
          if (!isAdmin) return;
          if (pass.length < 8) return bkStatus("Введите пароль копии (не короче 8 символов)");
          btn.disabled = true;
          try {
              const call = async (data) => {
                  const r = await pushPost("/backup", { key: pass, ...data });
                  const j = await r.json().catch(() => ({}));
                  if (!r.ok) throw new Error(j.error === "bad key" ? `Неверный пароль копии (осталось попыток: ${j.left})` : j.error === "too many" ? `Слишком часто — попробуйте через ${Math.ceil((j.retryAfter || 60) / 60)} мин` : j.error === "backup not configured" ? "На сервере не задан пароль копии (секрет BACKUP_KEY)" : "Ошибка сервера: " + (j.error && j.error.message || j.error || r.status));
                  return j;
              };
              bkStatus("Получаем список коллекций…");
              const cols = (await call({})).collectionIds || [];
              const out = { app: "Owl Messenger", project: "mymessenger-12ec5", format: "firestore-rest-v1", createdAt: new Date().toISOString(), collections: {} };
              let total = 0;
              for (const c of cols) {
                  const docs = []; let token = "";
                  do {
                      const j = await call({ collection: c, pageSize: c === "messages" ? 40 : 200, pageToken: token });
                      (j.documents || []).forEach(d => docs.push(d));
                      token = j.nextPageToken || "";
                      bkStatus(`Скачиваем: ${c} — ${docs.length}\nВсего документов: ${total + docs.length}`);
                  } while (token);
                  out.collections[c] = docs; total += docs.length;
              }
              bkStatus(`Шифруем ${total} документов…`);
              const blob = await bkEncrypt(JSON.stringify(out), pass);
              saveBlob(blob, `owl-backup-${new Date().toISOString().slice(0, 10)}.owlbak`);
              bkStatus(`Готово ✓ Коллекций: ${cols.length}, документов: ${total}, файл: ${(blob.size / 1048576).toFixed(1)} МБ.\nЭто ≈ ${total} чтений из 50 000 суточного лимита. Храните файл и пароль отдельно друг от друга.`);
          } catch (err) { console.error(err); bkStatus("❌ " + (err.message || err)); }
          finally { btn.disabled = false; }
      });
      document.getElementById("bk-open").addEventListener("click", () => {
          if (document.getElementById("bk-key").value.length < 8) return bkStatus("Сначала введите пароль копии");
          document.getElementById("bk-file").click();
      });
      document.getElementById("bk-file").addEventListener("change", async (e) => {
          const f = e.target.files[0]; e.target.value = ""; if (!f) return;
          try {
              bkStatus("Расшифровываем…");
              const text = await bkDecrypt(await f.arrayBuffer(), document.getElementById("bk-key").value);
              const info = JSON.parse(text);
              saveBlob(new Blob([text], { type: "application/json" }), f.name.replace(/\.owlbak$/, "") + ".json");
              bkStatus(`Расшифровано ✓ Копия от ${new Date(info.createdAt).toLocaleString()}, коллекций: ${Object.keys(info.collections || {}).length}. Файл .json скачан — он НЕ зашифрован, не храните его долго.`);
          } catch (err) { bkStatus("❌ " + (err.message || err)); }
      });

      // Защита от флуда во всех чатах: не больше MSG_PER_MIN сообщений в минуту. Вместе с сообщением пишем счётчик
      // ratelimits/{я}: mw — начало минутного окна (время сервера), mc — сколько отправлено в нём. Правила базы сверяют
      // переход «то же окно, +1» или «новое окно с 1», так что скрипт в обход приложения упрётся в тот же лимит.
      const MSG_PER_MIN = 40;
      let rlState = null; // { mw: мс, mc } — копия счётчика (часы телефона могут расходиться с сервером на секунды)
      async function loadRl() {
          if (rlState) return rlState;
          try { const d = await getDoc(doc(db, "ratelimits", currentUser.uid)); const x = d.exists() ? d.data() : {}; rlState = { mw: x.mw ? getTime(x.mw) : 0, mc: x.mc || 0 }; }
          catch (_) { rlState = { mw: 0, mc: 0 }; }
          return rlState;
      }
      async function postMessage(chatId, msgData, previewText, opts = {}) {
        if (chatId === "global" && !isAdmin) {
            if (globalTooFast()) throw Object.assign(new Error("rate"), { code: "owl/rate" });
            lastGlobalSend = Date.now();
        }
        const msgRef = doc(collection(db, "messages"));
        let saving;
        if (isAdmin) saving = setDoc(msgRef, msgData);
        else {
            const st = await loadRl();
            const fresh = Date.now() - st.mw > 62000; // окно точно истекло (с запасом на расхождение часов)
            if (!fresh && st.mc >= MSG_PER_MIN) throw Object.assign(new Error("rate"), { code: "owl/rate-min" });
            // flip — повтор после отказа базы: значит, мы и сервер по-разному поняли, закончилась ли минута
            const commit = (useNew) => {
                const b = writeBatch(db);
                b.set(msgRef, msgData);
                b.set(doc(db, "ratelimits", currentUser.uid), { ...(chatId === "global" ? { g: serverTimestamp() } : {}), ...(useNew ? { mw: serverTimestamp(), mc: 1 } : { mc: increment(1) }) }, { merge: true });
                return b.commit().then(() => { rlState = useNew ? { mw: Date.now(), mc: 1 } : { mw: st.mw, mc: st.mc + 1 }; });
            };
            saving = commit(fresh).catch(err => {
                if (err && err.code === "permission-denied" && !(st.mw && !fresh && st.mc >= MSG_PER_MIN - 1)) return commit(!fresh);
                throw err;
            });
        }
        setDoc(doc(db, "chats_metadata", chatId), {
            ...(chatId.includes("_") ? { members: chatId.split("_") } : {}),
            lastMessageText: previewText,
            lastMessageSender: chatId === NEWS_ID ? "Owl Messenger" : currentUser.displayName,
            ...(chatId === NEWS_ID && msgData.i18n ? { lastMessageI18n: msgData.i18n } : {}),
            lastMessageSenderUid: currentUser.uid,
            lastMessageId: msgRef.id,
            timestamp: msgData.timestamp,
            unreadCount: (chatId === 'global' || chatId === NEWS_ID || isNest(chatId) ? 0 : increment(1))
        }, { merge: true }).catch(e => console.log("Превью чата:", e));
        try { await saving; }
        catch (err) { delete pendingSince[msgRef.id]; evalNet(); console.error(err); throw err; }
        if (chatId !== "global" && chatId !== NEWS_ID && !isNest(chatId) && !opts.noPush) notifyPushServer(msgRef.id);
        if (chatId === NEWS_ID && isAdmin && document.getElementById("channel-push").checked) newsPush(previewText, msgData.i18n);
        setDoc(doc(db, "stats", dayKey()), { messages: increment(1) }, { merge: true }).catch(() => {}); // счётчик сообщений за день
        return msgRef;
      }
      // Пост в канале — push всем подписанным устройствам (сервер шлёт порциями, учитывает «Сову не будит» и заглушивших)
      // Перевод поста канала на en/de/pl (сервер, Cloudflare Workers AI). Не вышло за 15 с — пост уйдёт без перевода
      async function translateNews(text) {
          try {
              const r = await Promise.race([pushPost("/translate", { text }), new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 15000))]);
              const j = await r.json().catch(() => ({}));
              if (!r.ok || !j.i18n) throw new Error(j.error || r.status);
              const out = {}; for (const c of ["en", "de", "pl"]) if (typeof j.i18n[c] === "string" && j.i18n[c].trim()) out[c] = j.i18n[c];
              return Object.keys(out).length ? out : null;
          } catch (e) { console.log("Перевод поста:", e); showToast("Перевод не получился — пост уйдёт только по-русски", "alert"); return null; }
      }
      async function newsPush(text, i18n) {
          let cursor = null, guard = 0, sent = 0;
          try {
              do {
                  const r = await (await pushPost("/broadcast", { text: trPreview(String(text || "")), chatId: NEWS_ID, i18n: i18n || null, cursor })).json();
                  if (!r.ok) throw new Error(r.error || "push");
                  sent += r.sent || 0; cursor = r.cursor;
              } while (cursor && ++guard < 200);
              showToast("Push о посте отправлен: " + sent, "megaphone");
          } catch (e) { console.log("Push канала:", e); showToast("Push о посте не отправился", "alert"); }
      }
      // Самое новое из загруженных сообщений открытого чата
      function latestLoadedMsg(except) { // except — id или массив id, которые не учитывать
          let best = null; const skip = new Set([].concat(except || []));
          for (const m of Object.values(loadedMsgs)) { if (!skip.has(m.id) && m.chatId === currentChatId && (!best || getTime(m.timestamp) > getTime(best.timestamp))) best = m; }
          return best;
      }
      // Удалили последнее сообщение (одно или несколько выбранных) — превью переводим на самое свежее из оставшихся
      function fixPreviewAfterDelete(deleted) {
          const ids = [].concat(deleted), latest = latestLoadedMsg();
          if (!latest || !ids.includes(latest.id) || !currentChatId) return;
          const prev = latestLoadedMsg(ids);
          const data = prev
              ? { lastMessageText: msgPreviewText(prev), lastMessageSender: prev.sender || "", lastMessageSenderUid: prev.uid || "", lastMessageId: prev.id }
              : { lastMessageText: deleteField(), lastMessageSender: deleteField(), lastMessageSenderUid: deleteField(), lastMessageId: deleteField() };
          setDoc(doc(db, "chats_metadata", currentChatId), data, { merge: true }).catch(e => console.log("Превью чата:", e));
      }

      let msgInput = document.getElementById("message-input");
      let draftTimer = null;
      msgInput.addEventListener("input", () => {
          updateMentionBox();
          if (editingMsgId || !currentChatId) return;
          const cid = currentChatId, val = msgInput.value;
          clearTimeout(draftTimer);
          draftTimer = setTimeout(() => { const had = !!getDraft(cid); setDraft(cid, val); if (had !== !!(val && val.trim())) renderChatList(document.getElementById("search-input").value); }, 400);
      });
      msgInput.addEventListener("click", updateMentionBox);
      msgInput.addEventListener("keydown", (e) => {
          const box = document.getElementById("mention-box");
          if (!box.classList.contains("on")) return;
          if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); mentionSel = (mentionSel + (e.key === "ArrowDown" ? 1 : mentionList.length - 1)) % mentionList.length; updateMentionBox(); }
          else if ((e.key === "Enter" || e.key === "Tab") && mentionList[mentionSel]) { e.preventDefault(); e.stopImmediatePropagation(); insertMention(mentionList[mentionSel].uid); }
          else if (e.key === "Escape") box.classList.remove("on");
      }, true);
      document.getElementById("send-button").addEventListener("click", () => { let txt = msgInput.value.trim().replace(/\n{3,}/g, "\n\n"); if (txt && editingMsgId && txt.length > MAX_TEXT) { showToast(t("Слишком длинно: в сообщении можно до {n} символов", { n: MAX_TEXT }), "alert"); return; } if (txt && !editingMsgId && globalTooFast()) { showToast(t("Не так быстро — в общий чат можно писать раз в секунду"), "clock"); return; } if(txt){ sendMessage(txt); msgInput.value = ""; clearTimeout(draftTimer); if (getDraft(currentChatId)) { setDraft(currentChatId, ""); renderChatList(document.getElementById("search-input").value); } document.getElementById("mention-box").classList.remove("on"); }});
      msgInput.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing && !matchMedia("(pointer: coarse)").matches) { e.preventDefault(); document.getElementById("send-button").click(); } });
      
      // Сжатие фото для сообщения: фото хранится прямо в документе (лимит Firestore — 1 МБ на документ),
      // поэтому подбираем самый большой размер и лучшее качество, которые укладываются в limit символов.
      // WebP (если браузер умеет) при том же весе заметно чётче JPEG; PNG — без потерь, для картинок с текстом
      const webpOk = (() => { try { const c = document.createElement("canvas"); c.width = c.height = 1; return c.toDataURL("image/webp").startsWith("data:image/webp"); } catch (_) { return false; } })();
      function encodeImage(img, { maxSide, limit, png = false }) {
          const cv = document.createElement("canvas"), ctx = cv.getContext("2d"), type = webpOk ? "image/webp" : "image/jpeg";
          const big = Math.max(img.width, img.height) || 1; let lastW = 0;
          for (const side of [maxSide, maxSide * 0.8, maxSide * 0.64, 800, 640, 500]) {
              const k = Math.min(1, side / big), w = Math.round(img.width * k), h = Math.round(img.height * k);
              if (w === lastW || side > maxSide) continue; lastW = w;
              cv.width = w; cv.height = h;
              if (type === "image/jpeg" && !png) { ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h); } // у JPEG нет прозрачности — иначе фон станет чёрным
              ctx.drawImage(img, 0, 0, w, h);
              if (png) { const p = cv.toDataURL("image/png"); if (p.length <= limit) return p; }
              for (const q of [0.9, 0.82, 0.72, 0.6]) { const d = cv.toDataURL(type, q); if (d.length <= limit) return d; }
          }
          return cv.toDataURL("image/jpeg", 0.5);
      }
      // ЗАГРУЗКА КАРТИНКИ ЧАТА (СОХРАНЯЕМ В BASE64)
      document.getElementById("attach-btn").addEventListener("click", (e) => { e.stopPropagation(); toggleAttachMenu(); });
      // Сжимаем и отправляем картинку-файл (из галереи, буфера обмена или перетаскиванием)
      function sendImageFile(file, caption, chatId = currentChatId) {
        let reader = new FileReader();
        reader.onload = function(e) {
          let img = new Image();
          img.onload = async function() {
            // Пост канала (админ) — до 1600 px и почти без потерь (PNG, если влезает), остальные — до 1280 px
            const post = chatId === NEWS_ID && isAdmin;
            let base64 = encodeImage(img, post ? { maxSide: 1600, limit: 900000, png: true } : { maxSide: 1280, limit: 380000 });
            sendMessage(caption, base64, null, chatId);
          };
          img.onerror = () => showToast(t("Не получилось открыть картинку"), "error");
          img.src = e.target.result;
        }; reader.readAsDataURL(file);
      }
      document.getElementById("image-input").addEventListener("change", function(e) {
        let file = e.target.files[0]; if(!file) return;
        sendImageFile(file, msgInput.value.trim());
        msgInput.value = ""; e.target.value = "";
      });

      // ===== ФОТО ИЗ БУФЕРА ОБМЕНА И ПЕРЕТАСКИВАНИЕМ =====
      // Cmd/Ctrl+V (на телефоне — «Вставить» в поле сообщения), пункт «Из буфера обмена» в меню скрепки, файл, брошенный в чат.
      // Сначала — окно с превью: случайно вставленная картинка не улетит собеседнику
      let imgSend = null; // { file, url, chatId, fromInput }
      const shownModal = () => [...document.querySelectorAll(".modal-screen")].some(m => m.style.display && m.style.display !== "none");
      const canAttachHere = () => !!(currentUser && currentChatId && !iAmBanned && document.querySelector(".input-area") && document.querySelector(".input-area").style.display !== "none"
          && document.getElementById("main-chat").offsetParent !== null && !(currentChatId === NEWS_ID && !isAdmin));
      function openImgSend(file) {
          if (!file || !/^image\//.test(file.type)) return false;
          if (file.size > 40 * 1024 * 1024) { showToast(t("Картинка слишком большая"), "alert"); return true; }
          closeImgSend();
          imgSend = { file, url: URL.createObjectURL(file), chatId: currentChatId };
          document.getElementById("img-send-preview").src = imgSend.url;
          const cap = document.getElementById("img-send-caption");
          cap.value = msgInput.value.trim(); imgSend.fromInput = !!cap.value;
          document.getElementById("img-send-screen").style.display = "flex";
          setTimeout(() => { if (!matchMedia("(pointer: coarse)").matches) document.getElementById("img-send-btn").focus(); }, 60);
          return true;
      }
      function closeImgSend() {
          document.getElementById("img-send-screen").style.display = "none";
          if (imgSend) { URL.revokeObjectURL(imgSend.url); imgSend = null; }
      }
      function confirmImgSend() {
          if (!imgSend) return;
          const { file, chatId, fromInput } = imgSend, caption = document.getElementById("img-send-caption").value.trim();
          closeImgSend();
          if (chatId !== currentChatId) return showToast(t("Чат сменился — фото не отправлено"), "alert");
          sendImageFile(file, caption, chatId);
          if (fromInput) { msgInput.value = ""; if (getDraft(chatId)) setDraft(chatId, ""); }
      }
      document.getElementById("img-send-btn").addEventListener("click", confirmImgSend);
      document.getElementById("img-send-close").addEventListener("click", closeImgSend);
      document.getElementById("img-send-screen").addEventListener("click", (e) => { if (e.target.id === "img-send-screen") closeImgSend(); });
      document.getElementById("img-send-caption").addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); confirmImgSend(); } });
      // Картинка из события вставки. Если в буфере ещё и обычный текст (копирование из Word, Excel, страницы) — вставляем текст, как раньше
      function clipImage(dt) {
          if (!dt) return null;
          const file = [...(dt.files || [])].find(f => /^image\//.test(f.type)) || [...(dt.items || [])].filter(i => i.kind === "file" && /^image\//.test(i.type)).map(i => i.getAsFile()).find(Boolean);
          if (!file) return null;
          const txt = (dt.getData("text/plain") || "").trim();
          return !txt || /^https?:\/\/\S+$/.test(txt) ? file : null;
      }
      document.addEventListener("paste", (e) => {
          if (!canAttachHere()) return;
          const tg = e.target;
          if (tg !== msgInput && tg.closest && tg.closest("input, textarea, [contenteditable]")) return; // вставка в другие поля — как обычно
          if (tg !== msgInput && shownModal()) return;
          const file = clipImage(e.clipboardData);
          if (file && openImgSend(file)) e.preventDefault();
      });
      // Пункт меню: читаем буфер сами (на iPhone система покажет кнопку «Вставить» — это её защита)
      async function pasteFromClipboard() {
          if (!canAttachHere()) return;
          try {
              for (const item of await navigator.clipboard.read()) {
                  const type = item.types.find(x => /^image\//.test(x));
                  if (!type) continue;
                  const blob = await item.getType(type);
                  openImgSend(new File([blob], "clipboard." + (type.split("/")[1] || "png"), { type }));
                  return;
              }
              showToast(t("В буфере обмена нет картинки. Скопируйте фото и попробуйте снова"), "image");
          } catch (e) {
              console.log("Буфер обмена:", e && (e.name || e.message));
              showToast(e && e.name === "NotAllowedError" ? t("Нет доступа к буферу обмена — разрешите его в браузере или вставьте фото через Cmd/Ctrl+V") : t("Не получилось прочитать буфер обмена"), "alert");
          }
      }
      // Перетаскивание файла в окно чата (компьютер)
      { let depth = 0;
        const zone = document.getElementById("drop-zone"), main = document.getElementById("main-chat");
        const hasFiles = (e) => e.dataTransfer && [...(e.dataTransfer.types || [])].includes("Files");
        main.addEventListener("dragenter", (e) => { if (!hasFiles(e) || !canAttachHere()) return; e.preventDefault(); depth++; zone.classList.add("on"); });
        main.addEventListener("dragover", (e) => { if (!hasFiles(e) || !canAttachHere()) return; e.preventDefault(); e.dataTransfer.dropEffect = "copy"; });
        main.addEventListener("dragleave", () => { if (--depth <= 0) { depth = 0; zone.classList.remove("on"); } });
        main.addEventListener("drop", (e) => {
            if (!hasFiles(e)) return;
            e.preventDefault(); depth = 0; zone.classList.remove("on");
            if (!canAttachHere()) return;
            const file = [...e.dataTransfer.files].find(f => /^image\//.test(f.type));
            if (!openImgSend(file)) showToast(t("Можно перетащить только картинку"), "image");
        });
      }

      document.getElementById("delete-account-btn").addEventListener("click", async () => {
          if (!currentUser) return;
          let confirmFirst = confirm(t("Вы уверены, что хотите удалить свой аккаунт? Это действие необратимо!")); if (!confirmFirst) return;
          let confirmSecond = confirm(t("АБСОЛЮТНО УВЕРЕНЫ? Будут стёрты профиль, ник, личные переписки и уведомления.")); if (!confirmSecond) return;

          try {
              const pw = prompt(t("Для подтверждения введите ваш пароль:"));
              if (!pw) return;
              if (!(await reauthWithPassword(pw))) return;
              stopPresence(false); let uidToDelete = currentUser.uid;
              showToast(t("Удаляем данные..."), "trash");
              // Каждый шаг — отдельно: если на что-то нет прав, остальное всё равно удаляется
              const step = async (name, fn) => { try { await fn(); } catch (e) { console.log("Удаление аккаунта, " + name + ":", e.code || e); } };
              await step("уведомления на устройство", serverPushUnsubscribe);
              await step("личные переписки", async () => {
                  const metas = await getDocs(query(collection(db, "chats_metadata"), where("members", "array-contains", uidToDelete)));
                  for (const m of metas.docs) {
                      const msgs = await getDocs(query(collection(db, "messages"), where("chatId", "==", m.id)));
                      await deleteRefsInChunks(msgs.docs.map(d => d.ref));
                      await deleteDoc(m.ref).catch(() => setDoc(m.ref, { lastMessageText: deleteField(), lastMessageSender: deleteField(), lastMessageSenderUid: deleteField(), unreadCount: 0 }, { merge: true }));
                  }
              });
              await step("уведомления", async () => {
                  const snap = await getDocs(query(collection(db, "notifications"), where("toUid", "==", uidToDelete)));
                  await deleteRefsInChunks(snap.docs.map(d => d.ref));
              });
              await step("беседы", async () => {
                  await Promise.all(Object.values(groupsCache).filter(g => (g.members || []).includes(uidToDelete)).map(g => setDoc(doc(db, "groups", g.id), { members: arrayRemove(uidToDelete) }, { merge: true })));
              });
              await step("ник", async () => { const key = usersCache[uidToDelete]?.nameKey || nickKey(usersCache[uidToDelete]?.name || currentUser.displayName || ""); if (key) await deleteDoc(doc(db, "usernames", key)); });
              await step("подписки", () => deleteFollowEdges(uidToDelete));
              await step("почта", () => deleteDoc(doc(db, "users_private", uidToDelete)));
              await deleteDoc(doc(db, "users", uidToDelete)); await deleteUser(currentUser);
              showToast(t("Аккаунт успешно удален"), "trash"); document.getElementById("settings-screen").style.display = "none";
          } catch (error) {
              console.error("Ошибка при удалении аккаунта:", error);
              if (error.code === 'auth/invalid-credential' || error.code === 'auth/wrong-password') { alert(t("Неверный пароль. Аккаунт не удалён.")); }
              else if (error.code === 'auth/requires-recent-login') { alert(t("В целях безопасности, чтобы удалить аккаунт, вам нужно выйти и зайти заново (ввести пароль).")); signOut(auth); } 
              else { alert(t("Произошла ошибка при удалении аккаунта: ") + error.message); }
          }
      });
    
      // Рассылка уведомлений всем пользователям (только админ)
      const bcBtn = document.getElementById("broadcast-btn"), bcText = document.getElementById("broadcast-text");
      // Куда отправлять: push на телефоны, колокольчик в приложении или оба
      const bcMode = () => (document.querySelector('input[name="bc-mode"]:checked') || {}).value || "both";
      const PUSH_LIMIT = 180; // столько текста помещается в push, дальше сервер обрежет
      function updateBroadcastCount() {
          const n = bcText.value.length, el = document.getElementById("broadcast-count");
          if (bcMode() === "push") { el.innerText = n + "/" + PUSH_LIMIT + (n > PUSH_LIMIT ? " — длиннее обрежется" : ""); el.style.color = n > PUSH_LIMIT ? "#ff9f0a" : "var(--text-muted)"; }
          else { el.innerText = n + "/1000"; el.style.color = "var(--text-muted)"; }
      }
      bcText.addEventListener("input", updateBroadcastCount);
      document.querySelectorAll('input[name="bc-mode"]').forEach(r => r.addEventListener("change", updateBroadcastCount));
      bcBtn.addEventListener("click", async () => {
          if (!currentUser || !isAdmin) return;
          const text = bcText.value.trim();
          if (!text) return showToast("Введите текст рассылки", "alert");
          const mode = bcMode(), toBell = mode !== "push", toPush = mode !== "bell";
          const uids = Object.keys(usersCache);
          if (toBell && !uids.length) return showToast("Список пользователей ещё загружается", "clock");
          const where = mode === "push" ? "push-уведомление всем подписанным устройствам" : mode === "bell" ? "уведомление в колокольчик " + uids.length + " пользователям" : "push и уведомление в колокольчик " + uids.length + " пользователям";
          if (!confirm("Отправить " + where + "?")) return;
          bcBtn.disabled = true; const orig = bcBtn.innerText; bcBtn.innerText = "Отправка...";
          try {
              const ts = new Date();
              if (toBell) for (let i = 0; i < uids.length; i += 400) {
                  const batch = writeBatch(db);
                  uids.slice(i, i + 400).forEach(uid => batch.set(doc(collection(db, "notifications")), { toUid: uid, text: text, timestamp: ts, read: false, type: "broadcast", fromUid: currentUser.uid }));
                  await batch.commit();
              }
              // Push на все подписанные устройства (сервер отправляет порциями)
              let pushed = 0, cursor = null, guard = 0;
              if (toPush) try {
                  do {
                      const r = await (await pushPost("/broadcast", { text, cursor })).json();
                      if (!r.ok) throw new Error(r.error || "push");
                      pushed += r.sent || 0; cursor = r.cursor;
                  } while (cursor && ++guard < 200);
              } catch (e) { console.log("Push-рассылка:", e); showToast("Push-рассылка не удалась", "alert"); }
              bcText.value = ""; updateBroadcastCount();
              showToast(mode === "push" ? "Push доставлено на устройства: " + pushed : mode === "bell" ? "Отправлено пользователям: " + uids.length : "Отправлено: " + uids.length + " пользователям, push: " + pushed, "megaphone");
          } catch (e) { console.error(e); showToast("Не удалось отправить: " + e.message, "error"); }
          bcBtn.disabled = false; bcBtn.innerText = orig;
      });

      // Скрыть онлайн-статус
      document.getElementById("hide-online-toggle").addEventListener("change", async (e) => {
          if (!currentUser) return;
          let hide = e.target.checked;
          try {
              await savePrivacy("lastSeen", hide ? "nobody" : "all");
          } catch (err) { console.error(err); e.target.checked = !hide; showToast(t("Не удалось сохранить"), "error"); }
      });

      // ===== ЖЕСТЫ (по системе свайпов из другого приложения владельца: «Система свайпов — описание для ИИ-помощника.md») =====
      // Pointer Events: один код для пальца, мыши и стилуса. Движения слушаем на всём окне, а не на элементе —
      // поэтому жест доходит до конца, даже если строку под пальцем перерисовали (так зависал свайп в v1.102).
      // Направление решается в первые 10 px; вертикально — это прокрутка, жест отпускается. Обновление — не чаще кадра
      const rub = (d, max) => max * d / (d + max); // «резинка»: чем дальше тянешь, тем туже
      const buzz = (ms = 8) => { try { if (navigator.vibrate && (!navigator.userActivation || navigator.userActivation.hasBeenActive)) navigator.vibrate(ms); } catch (_) {} };
      // После жеста отпускание пальца не должно считаться нажатием (не открывать чат под пальцем)
      let justDragged = false;
      // только настоящие нажатия: программные .click() из самих жестов (кнопка «назад», вкладка) должны проходить
      document.addEventListener("click", e => { if (justDragged && e.isTrusted) { e.stopPropagation(); e.preventDefault(); justDragged = false; } }, true);
      const swallowClick = () => { justDragged = true; setTimeout(() => { justDragged = false; }, 350); };
      const SWIPE_EASE = "cubic-bezier(.22,1,.36,1)";
      // root — где слушаем, sel — на каком элементе начинается жест.
      // h = { dir: 1 (только вправо) | -1 (только влево) | 0, ok(t, e), start(s), move(s), end(s, cancelled) }
      // s = { t: элемент, dx, dy, v: скорость px/мс, on }
      function gesture(root, sel, h) {
          root.addEventListener("pointerdown", e => {
              if (e.button) return;
              const t = e.target.closest(sel); if (!t || (h.ok && !h.ok(t, e))) return;
              const s = { t, x: e.clientX, y: e.clientY, dx: 0, dy: 0, on: false, v: 0, lx: e.clientX, lt: performance.now(), raf: 0 };
              const move = ev => {
                  if (ev.pointerId !== e.pointerId) return;
                  s.dx = ev.clientX - s.x; s.dy = ev.clientY - s.y;
                  const now = performance.now(); // скорость — по последнему отрезку
                  if (now > s.lt + 4) { s.v = (ev.clientX - s.lx) / (now - s.lt); s.lx = ev.clientX; s.lt = now; }
                  if (!s.on) {
                      if (Math.abs(s.dy) > 10 && Math.abs(s.dy) > Math.abs(s.dx)) return stop(); // вертикально — прокрутка
                      if (Math.abs(s.dx) < 10) return;                                           // ещё не понятно
                      if (h.dir && Math.sign(s.dx) !== h.dir) return stop();                     // не то направление
                      s.on = true; document.body.classList.add("swiping"); h.start && h.start(s);
                  }
                  if (!s.raf) s.raf = requestAnimationFrame(() => { s.raf = 0; if (s.on) h.move(s); });
              };
              const end = ev => {
                  if (ev.pointerId !== e.pointerId) return;
                  stop();
                  if (!s.on) return;
                  cancelAnimationFrame(s.raf); s.raf = 0; h.move(s);
                  document.body.classList.remove("swiping"); swallowClick();
                  // палец давно стоит на месте — скорости уже нет (иначе медленный жест засчитался бы как рывок)
                  if (performance.now() - s.lt > 90) s.v = 0;
                  h.end(s, ev.type === "pointercancel");
              };
              const stop = () => { removeEventListener("pointermove", move); removeEventListener("pointerup", end); removeEventListener("pointercancel", end); };
              addEventListener("pointermove", move); addEventListener("pointerup", end); addEventListener("pointercancel", end);
          });
      }

      // Вкладки «Все» ⇄ «Подписки» — лента. Текущая вкладка — #chat-list, соседняя рисуется сбоку в #chat-list-peek
      // в момент, когда жест пошёл в её сторону; лента едет за пальцем, капля под вкладками перетекает вместе с ней.
      // Отпустили дальше 22 % ширины или рывком — лента докатывается, иначе пружинит назад. У края — резинка
      (function () {
          const pager = document.getElementById("chat-pager"), track = document.getElementById("chat-track");
          const list = document.getElementById("chat-list"), peek = document.getElementById("chat-list-peek");
          const KEYS = ["all", "friends"];
          const tabEl = (f) => document.getElementById(f === "all" ? "tab-all" : "tab-friends");
          const searchVal = () => document.getElementById("search-input").value;
          let settling = false;
          const indAt = (a, b, p) => { const i = lgTabs.ind; if (!i || !a) return; b = b || a;
              i.style.width = (a.offsetWidth + (b.offsetWidth - a.offsetWidth) * p) + "px";
              i.style.transform = `translate(${a.offsetLeft + (b.offsetLeft - a.offsetLeft) * p}px, ${a.offsetTop}px)`; };
          gesture(pager, "#chat-pager", {
              ok: (t, e) => !settling && e.pointerType !== "mouse" && !e.target.closest("input, textarea, [data-invite]"),
              start(s) {
                  s.i = KEYS.indexOf(currentFilter); s.w = pager.offsetWidth || window.innerWidth;
                  s.next = KEYS[s.i + 1]; s.prev = KEYS[s.i - 1]; s.peekFor = null;
                  track.style.transition = "none"; lgTabs.hold = true; if (lgTabs.ind) lgTabs.ind.style.transition = "none";
              },
              move(s) {
                  const to = s.dx < 0 ? s.next : s.prev;
                  let x = s.dx;
                  if (!to) x = s.dx < 0 ? -rub(-s.dx, 70) : rub(s.dx, 70);
                  else if (s.peekFor !== to) { // соседний список — один раз на направление
                      renderChatList(searchVal(), to, peek); peek.scrollTop = 0;
                      peek.style.left = (s.dx < 0 ? 100 : -100) + "%"; pager.classList.add("peeking"); s.peekFor = to;
                  }
                  if (to) x = Math.max(-s.w, Math.min(s.w, x));
                  track.style.transform = `translate3d(${x}px,0,0)`;
                  if (!reduceMotion()) indAt(tabEl(KEYS[s.i]), to ? tabEl(to) : null, to ? Math.min(1, Math.abs(x) / s.w) : 0);
                  const arm = !!to && Math.abs(x) > s.w * .22; if (arm !== !!s.arm) { s.arm = arm; if (arm) buzz(); }
              },
              end(s, cancel) {
                  const to = s.dx < 0 ? s.next : s.prev, dir = s.dx < 0 ? -1 : 1;
                  const go = !cancel && !!to && (Math.abs(s.dx) > s.w * .22 || (Math.abs(s.v) > .35 && Math.sign(s.v) === dir));
                  const ms = reduceMotion() ? 0 : 380;
                  settling = true;
                  track.style.transition = ms ? `transform ${ms}ms ${SWIPE_EASE}` : "none";
                  if (lgTabs.ind) lgTabs.ind.style.transition = ms ? `transform ${ms}ms ${SWIPE_EASE}, width ${ms}ms ${SWIPE_EASE}` : "none";
                  track.style.transform = go ? `translate3d(${dir * s.w}px,0,0)` : "translate3d(0,0,0)";
                  indAt(tabEl(KEYS[s.i]), go ? tabEl(to) : null, go ? 1 : 0);
                  setTimeout(() => {
                      track.style.transition = "none";
                      if (go) { tabEl(to).click(); list.scrollTop = 0; } // основной список теперь сам показывает новую вкладку
                      track.style.transform = ""; pager.classList.remove("peeking"); peek.innerHTML = "";
                      lgTabs.hold = false; if (lgTabs.ind) lgTabs.ind.style.transition = ""; lgTabs.place();
                      settling = false;
                  }, ms + 20);
              }
          });
          // Нажатие на вкладку: новый список мягко «въезжает» с нужной стороны (капля перетекает сама)
          ["tab-all", "tab-friends"].forEach(id => document.getElementById(id).addEventListener("click", (e) => {
              if (!e.isTrusted || settling || reduceMotion() || !list.animate) return;
              const dir = id === "tab-friends" ? 1 : -1;
              list.animate([{ transform: `translate3d(${dir * 28}px,0,0)`, opacity: .35 }, { transform: "none", opacity: 1 }], { duration: 300, easing: SWIPE_EASE });
          }));
      })();

      // Открытый чат (телефон): свайп вправо из любого места — назад к списку. Чат едет за пальцем, из-под него
      // выезжает список, светлея. Треть ширины или резкий смах — чат уезжает, иначе пружинит назад
      (function () {
          const main = document.getElementById("main-chat"), app = document.getElementById("app-container"), side = document.getElementById("sidebar");
          const paint = (x, w) => { const k = Math.min(1, x / w); main.style.transform = `translate3d(${x}px,0,0)`; side.style.transform = `translate3d(${-22 * (1 - k)}%,0,0)`; side.style.filter = `brightness(${(.7 + .3 * k).toFixed(3)})`; };
          const clear = () => { app.classList.remove("chat-swiping"); [main, side].forEach(el => { el.style.transition = ""; el.style.transform = ""; el.style.filter = ""; }); };
          gesture(main, "#main-chat", {
              dir: 1,
              ok: (t, e) => window.innerWidth <= 768 && app.classList.contains("chat-active") && !app.classList.contains("chat-opening") && !app.classList.contains("chat-closing")
                  && !e.target.closest("input, textarea, select, [contenteditable], audio, .input-area, #attach-menu, #sticker-panel, .modal-screen, #select-bar"),
              start(s) { s.w = window.innerWidth; app.classList.add("chat-swiping"); main.style.transition = side.style.transition = "none"; },
              move(s) { paint(Math.max(0, s.dx), s.w); const arm = s.dx > s.w * .33; if (arm !== !!s.arm) { s.arm = arm; if (arm) buzz(); } },
              end(s, cancel) {
                  const go = !cancel && (s.dx > s.w * .33 || (s.v > .45 && s.dx > 24));
                  const ms = Math.round(Math.max(160, Math.min(340, (go ? s.w - s.dx : s.dx) / Math.max(.9, Math.abs(s.v)))));
                  main.style.transition = side.style.transition = `transform ${ms}ms ${SWIPE_EASE}, filter ${ms}ms`;
                  if (go) {
                      paint(s.w, s.w);
                      // кнопка «назад» видит сдвинутый чат и закрывает его без своей анимации — без «прыжка»
                      setTimeout(() => { document.getElementById("mobile-back-btn").click(); clear(); }, ms);
                  } else {
                      main.style.transform = ""; side.style.transform = "translate3d(-22%,0,0)"; side.style.filter = "brightness(.7)";
                      setTimeout(clear, ms);
                  }
              }
          });
      })();

      // Свайп влево по сообщению — ответить: пузырь едет за пальцем туго (резинка, максимум ~110 px), проявляется стрелка
      gesture(document.getElementById("chat-box"), ".message-row[data-msg-id]", {
          dir: -1,
          ok: (t, e) => !selMode && e.pointerType !== "mouse" && !e.target.closest("audio, button, a, .reply-quote, .poll, input, textarea"),
          start(s) {
              s.b = s.t.querySelector(".message-content"); if (!s.b) return;
              s.b.style.transition = "none";
              s.ic = document.createElement("div"); s.ic.className = "swipe-reply-icon"; s.ic.innerHTML = replyIconSVG; s.b.appendChild(s.ic);
          },
          move(s) {
              if (!s.b) return;
              const x = rub(Math.max(0, -s.dx), 110);
              s.b.style.transform = `translateX(${-x}px)`;
              const p = Math.min(1, x / 44); s.ic.style.opacity = p; s.ic.style.transform = `translate(100%, -50%) scale(${.5 + p * .5})`;
              const arm = x > 44; if (arm !== !!s.arm) { s.arm = arm; if (arm) buzz(10); }
          },
          end(s, cancel) {
              if (!s.b) return;
              const b = s.b, ic = s.ic;
              b.style.transition = `transform .32s ${SWIPE_EASE}`; b.style.transform = ""; ic.style.opacity = "0";
              setTimeout(() => { b.style.transition = ""; ic.remove(); }, 340);
              if (s.arm && !cancel) startReply(s.t.getAttribute("data-msg-id"));
          }
      });

      // Долгое нажатие на сообщение (0,45 с без движения) — меню; двойное нажатие — быстрая реакция
      (function () {
          const box = document.getElementById("chat-box");
          let row = null, sx = 0, sy = 0, moved = false, pressTimer = null, suppressClickUntil = 0, lastTap = { id: null, t: 0 };
          const cancelPress = () => { clearTimeout(pressTimer); pressTimer = null; };
          box.addEventListener("click", e => { if (Date.now() < suppressClickUntil) { e.stopPropagation(); e.preventDefault(); } }, true);
          box.addEventListener("touchstart", e => {
              if (e.touches.length !== 1 || selMode || e.target.closest("audio,button,a,.reply-quote")) { row = null; return; }
              row = e.target.closest(".message-row[data-msg-id]"); if (!row) return;
              sx = e.touches[0].clientX; sy = e.touches[0].clientY; moved = false;
              const id = row.getAttribute("data-msg-id");
              cancelPress();
              pressTimer = setTimeout(() => { pressTimer = null; if (moved) return; suppressClickUntil = Date.now() + 600; openMsgMenu(id); }, 450);
          }, { passive: true });
          box.addEventListener("touchmove", e => {
              if (Math.abs(e.touches[0].clientX - sx) > 8 || Math.abs(e.touches[0].clientY - sy) > 8) { moved = true; cancelPress(); }
          }, { passive: true });
          box.addEventListener("touchend", (e) => {
              const wasPress = !!pressTimer; cancelPress();
              // Двойное нажатие — быстрая реакция (не на фото, ссылках и кнопках)
              if (wasPress && row && !moved && !e.target.closest("a, audio, button, img, .reply-quote")) {
                  const id = row.getAttribute("data-msg-id"), now = Date.now();
                  if (lastTap.id === id && now - lastTap.t < 320) { lastTap = { id: null, t: 0 }; e.preventDefault(); quickReact(id); return; }
                  lastTap = { id, t: now };
              }
          });
          box.addEventListener("touchcancel", () => { cancelPress(); row = null; });
      })();
