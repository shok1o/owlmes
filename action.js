// Owl: страница из писем — сброс пароля и подтверждение почты (подключается в action.html).
// Вынесено из <script> внутри страницы, чтобы работала защита от чужих скриптов (CSP без inline-кода).
// Меняешь этот файл — подними ?v= у <script src="/action.js?v=…"> в action.html (иначе service worker отдаст старую копию)

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-app.js";
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-app-check.js";
import { initializeAuth, indexedDBLocalPersistence, browserLocalPersistence, browserSessionPersistence, applyActionCode, checkActionCode, verifyPasswordResetCode, confirmPasswordReset } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-auth.js";

// Язык страницы: из ссылки в письме (?lang=), иначе из настроек Owl или телефона. Ключ перевода — русский текст
const LANG = (() => {
  const q = new URLSearchParams(location.search).get("lang"); if (["ru", "en", "de", "pl"].includes(q)) return q;
  try { const s = localStorage.getItem("owl-lang"); if (["ru", "en", "de", "pl"].includes(s)) return s; } catch (_) {}
  for (const l of (navigator.languages || [navigator.language || ""])) { const c = String(l).slice(0, 2).toLowerCase(); if (["ru", "be", "kk"].includes(c)) return "ru"; if (["en", "de", "pl"].includes(c)) return c; }
  return "en";
})();
const DICTS = {"en": {"Секундочку…": "Just a moment…", "Новый пароль": "New password", "для": "for", "Показать пароль": "Show password", "Минимум 6 символов. Лучше — фраза из нескольких слов.": "At least 6 characters. Even better — a phrase of several words.", "Сохранить пароль": "Save password", "Открыть Owl": "Open Owl", "Ссылка не сработала": "The link didn't work", "Конфиденциальность": "Privacy", "Срок действия ссылки истёк. Запросите новое письмо в приложении.": "This link has expired. Request a new email in the app.", "Ссылка уже использована или устарела. Если вы запрашивали письмо несколько раз — откройте самое последнее.": "This link has already been used or is out of date. If you requested several emails, open the most recent one.", "Этот аккаунт отключён.": "This account has been disabled.", "Аккаунт не найден — возможно, он удалён.": "Account not found — it may have been deleted.", "Нет соединения с интернетом. Проверьте сеть и откройте ссылку ещё раз.": "No internet connection. Check your network and open the link again.", "Слишком много попыток. Подождите немного и попробуйте снова.": "Too many attempts. Please wait a moment and try again.", "Не удалось пройти проверку безопасности. Отключите блокировщик рекламы или откройте ссылку в другом браузере.": "The security check failed. Turn off your ad blocker or open the link in another browser.", "Что-то пошло не так. Попробуйте открыть ссылку ещё раз или запросите новое письмо.": "Something went wrong. Try opening the link again or request a new email.", "Здесь пусто": "Nothing here", "Эта страница открывается по ссылке из письма Owl.": "This page opens from a link in an Owl email.", "Почта подтверждена!": "Email confirmed!", "Спасибо! Теперь ваш аккаунт Owl надёжнее защищён. Можно возвращаться к общению.": "Thanks! Your Owl account is now better protected. You can get back to chatting.", "Почта восстановлена": "Email restored", "Для аккаунта снова указан адрес {email}. Если почту меняли не вы — смените пароль.": "The account email is back to {email}. If you didn't change it, change your password.", "Почта изменена": "Email changed", "Новый адрес подтверждён. Используйте его для входа в Owl.": "Your new address is confirmed. Use it to sign in to Owl.", "Пароль должен быть не короче 6 символов": "Password must be at least 6 characters", "Сохраняем…": "Saving…", "Пароль изменён!": "Password changed!", "Войдите в Owl с новым паролем. Если вы были авторизованы на других устройствах — там тоже понадобится новый пароль.": "Sign in to Owl with your new password. If you were signed in on other devices, you'll need the new password there too.", "Слишком простой пароль — придумайте сложнее": "That password is too simple — choose a stronger one"}, "de": {"Секундочку…": "Einen Moment …", "Новый пароль": "Neues Passwort", "для": "für", "Показать пароль": "Passwort anzeigen", "Минимум 6 символов. Лучше — фраза из нескольких слов.": "Mindestens 6 Zeichen. Noch besser: ein Satz aus mehreren Wörtern.", "Сохранить пароль": "Passwort speichern", "Открыть Owl": "Owl öffnen", "Ссылка не сработала": "Der Link hat nicht funktioniert", "Конфиденциальность": "Datenschutz", "Срок действия ссылки истёк. Запросите новое письмо в приложении.": "Dieser Link ist abgelaufen. Fordere in der App eine neue E-Mail an.", "Ссылка уже использована или устарела. Если вы запрашивали письмо несколько раз — откройте самое последнее.": "Dieser Link wurde bereits verwendet oder ist veraltet. Wenn du mehrere E-Mails angefordert hast, öffne die neueste.", "Этот аккаунт отключён.": "Dieses Konto wurde deaktiviert.", "Аккаунт не найден — возможно, он удалён.": "Konto nicht gefunden – vielleicht wurde es gelöscht.", "Нет соединения с интернетом. Проверьте сеть и откройте ссылку ещё раз.": "Keine Internetverbindung. Prüf dein Netz und öffne den Link noch einmal.", "Слишком много попыток. Подождите немного и попробуйте снова.": "Zu viele Versuche. Warte kurz und versuch es noch einmal.", "Не удалось пройти проверку безопасности. Отключите блокировщик рекламы или откройте ссылку в другом браузере.": "Die Sicherheitsprüfung ist fehlgeschlagen. Deaktiviere deinen Werbeblocker oder öffne den Link in einem anderen Browser.", "Что-то пошло не так. Попробуйте открыть ссылку ещё раз или запросите новое письмо.": "Etwas ist schiefgelaufen. Öffne den Link noch einmal oder fordere eine neue E-Mail an.", "Здесь пусто": "Hier ist nichts", "Эта страница открывается по ссылке из письма Owl.": "Diese Seite öffnet sich über einen Link aus einer Owl-E-Mail.", "Почта подтверждена!": "E-Mail bestätigt!", "Спасибо! Теперь ваш аккаунт Owl надёжнее защищён. Можно возвращаться к общению.": "Danke! Dein Owl-Konto ist jetzt besser geschützt. Du kannst weiterchatten.", "Почта восстановлена": "E-Mail wiederhergestellt", "Для аккаунта снова указан адрес {email}. Если почту меняли не вы — смените пароль.": "Für das Konto ist wieder die Adresse {email} hinterlegt. Wenn du sie nicht geändert hast, ändere dein Passwort.", "Почта изменена": "E-Mail geändert", "Новый адрес подтверждён. Используйте его для входа в Owl.": "Deine neue Adresse ist bestätigt. Nutze sie zur Anmeldung bei Owl.", "Пароль должен быть не короче 6 символов": "Das Passwort muss mindestens 6 Zeichen lang sein", "Сохраняем…": "Wird gespeichert …", "Пароль изменён!": "Passwort geändert!", "Войдите в Owl с новым паролем. Если вы были авторизованы на других устройствах — там тоже понадобится новый пароль.": "Melde dich mit deinem neuen Passwort bei Owl an. Auf anderen Geräten, auf denen du angemeldet warst, brauchst du ebenfalls das neue Passwort.", "Слишком простой пароль — придумайте сложнее": "Das Passwort ist zu einfach – wähle ein sichereres"}, "pl": {"Секундочку…": "Chwileczkę…", "Новый пароль": "Nowe hasło", "для": "dla", "Показать пароль": "Pokaż hasło", "Минимум 6 символов. Лучше — фраза из нескольких слов.": "Co najmniej 6 znaków. Najlepiej — fraza z kilku słów.", "Сохранить пароль": "Zapisz hasło", "Открыть Owl": "Otwórz Owl", "Ссылка не сработала": "Link nie zadziałał", "Конфиденциальность": "Prywatność", "Срок действия ссылки истёк. Запросите новое письмо в приложении.": "Ten link wygasł. Poproś w aplikacji o nowy e-mail.", "Ссылка уже использована или устарела. Если вы запрашивали письмо несколько раз — откройте самое последнее.": "Ten link został już użyty lub jest nieaktualny. Jeśli wysłano kilka e-maili, otwórz najnowszy.", "Этот аккаунт отключён.": "To konto zostało wyłączone.", "Аккаунт не найден — возможно, он удалён.": "Nie znaleziono konta — możliwe, że zostało usunięte.", "Нет соединения с интернетом. Проверьте сеть и откройте ссылку ещё раз.": "Brak połączenia z internetem. Sprawdź sieć i otwórz link ponownie.", "Слишком много попыток. Подождите немного и попробуйте снова.": "Zbyt wiele prób. Odczekaj chwilę i spróbuj ponownie.", "Не удалось пройти проверку безопасности. Отключите блокировщик рекламы или откройте ссылку в другом браузере.": "Weryfikacja bezpieczeństwa nie powiodła się. Wyłącz blokadę reklam lub otwórz link w innej przeglądarce.", "Что-то пошло не так. Попробуйте открыть ссылку ещё раз или запросите новое письмо.": "Coś poszło nie tak. Spróbuj otworzyć link ponownie lub poproś o nowy e-mail.", "Здесь пусто": "Tu nic nie ma", "Эта страница открывается по ссылке из письма Owl.": "Ta strona otwiera się z linku w e-mailu od Owl.", "Почта подтверждена!": "E-mail potwierdzony!", "Спасибо! Теперь ваш аккаунт Owl надёжнее защищён. Можно возвращаться к общению.": "Dziękujemy! Twoje konto Owl jest teraz lepiej chronione. Możesz wracać do rozmów.", "Почта восстановлена": "E-mail przywrócony", "Для аккаунта снова указан адрес {email}. Если почту меняли не вы — смените пароль.": "Dla konta ponownie ustawiono adres {email}. Jeśli to nie Ty zmieniasz adres, zmień hasło.", "Почта изменена": "E-mail zmieniony", "Новый адрес подтверждён. Используйте его для входа в Owl.": "Nowy adres został potwierdzony. Używaj go do logowania w Owl.", "Пароль должен быть не короче 6 символов": "Hasło musi mieć co najmniej 6 znaków", "Сохраняем…": "Zapisujemy…", "Пароль изменён!": "Hasło zmienione!", "Войдите в Owl с новым паролем. Если вы были авторизованы на других устройствах — там тоже понадобится новый пароль.": "Zaloguj się do Owl nowym hasłem. Na innych urządzeniach, na których było się zalogowanym, również będzie potrzebne nowe hasło.", "Слишком простой пароль — придумайте сложнее": "Hasło jest zbyt proste — wymyśl trudniejsze"}};
const DICT = DICTS[LANG] || {};
const t = (ru, vars) => { let s = DICT[ru] || ru; if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => vars[k] ?? m); return s; };
document.documentElement.lang = LANG;
// «Политика» и «Соглашение» — на языке интерфейса
if (LANG !== "ru") document.querySelectorAll('a[href="/privacy.html"], a[href="/terms.html"]').forEach(a => a.setAttribute("href", a.getAttribute("href").replace(".html", "-" + LANG + ".html")));
if (LANG !== "ru") {
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    if (n.nodeType === 3) { const k = n.nodeValue.replace(/\s+/g, " ").trim(); if (k && DICT[k]) n.nodeValue = n.nodeValue.replace(k, DICT[k]); }
    else if (n.tagName !== "SCRIPT") for (const a of ["placeholder", "aria-label"]) { const v = n.getAttribute(a); if (v && DICT[v]) n.setAttribute(a, DICT[v]); }
  }
}

const app = initializeApp({
  apiKey: "AIzaSyCYeKCL1hqaDwmNp6bRuSZ4MPjMvMikqbY",
  authDomain: "mymessenger-12ec5.firebaseapp.com",
  projectId: "mymessenger-12ec5",
  appId: "1:334096138410:web:c9cd4112c71ca79b91d0d3", // без него App Check не получал токен (запрос уходил на apps/undefined)
});
// App Check обязателен для Authentication (Enforced) — без него ссылки из писем не сработают
try { initializeAppCheck(app, { provider: new ReCaptchaEnterpriseProvider("6LciOuQtAAAAACzfAsHZMSxZ13E4hyN9kYvXcVK3"), isTokenAutoRefreshEnabled: false }); } catch (e) { console.log("appcheck:", e); }
// Вход только по почте и паролю: без getAuth, который на iPhone заранее грузит скрипт Google и скрытую страницу firebaseapp.com
// (для входа через Google — не нужны). Хранилище входа то же, что у getAuth, — никого не разлогинит
const auth = initializeAuth(app, { persistence: [indexedDBLocalPersistence, browserLocalPersistence, browserSessionPersistence] });
auth.languageCode = LANG;

const $ = (id) => document.getElementById(id);
const owl = $("owl");
const params = new URLSearchParams(location.search);
const mode = params.get("mode"), code = params.get("oobCode");
// убираем одноразовый код из адресной строки и истории
try { history.replaceState(null, "", location.pathname); } catch (_) {}

function show(id) { for (const s of ["v-loading", "v-reset", "v-done", "v-error"]) $(s).hidden = s !== id; }
function react(kind) { owl.classList.remove("happy", "shake"); void owl.getBoundingClientRect(); owl.classList.add(kind); }
function done(title, text) { $("done-title").textContent = title; $("done-text").textContent = text; show("v-done"); react("happy"); }
function fail(err) {
  const c = (err && err.code) || "";
  console.log("action error:", c, err);
  const texts = {
    "auth/expired-action-code": t("Срок действия ссылки истёк. Запросите новое письмо в приложении."),
    "auth/invalid-action-code": t("Ссылка уже использована или устарела. Если вы запрашивали письмо несколько раз — откройте самое последнее."),
    "auth/user-disabled": t("Этот аккаунт отключён."),
    "auth/user-not-found": t("Аккаунт не найден — возможно, он удалён."),
    "auth/network-request-failed": t("Нет соединения с интернетом. Проверьте сеть и откройте ссылку ещё раз."),
    "auth/too-many-requests": t("Слишком много попыток. Подождите немного и попробуйте снова."),
  };
  $("err-text").textContent = texts[c] || (c.includes("app-check") ? t("Не удалось пройти проверку безопасности. Отключите блокировщик рекламы или откройте ссылку в другом браузере.") : t("Что-то пошло не так. Попробуйте открыть ссылку ещё раз или запросите новое письмо."));
  show("v-error"); react("shake");
}

async function run() {
  if (!mode || !code) { $("err-title").textContent = t("Здесь пусто"); $("err-text").textContent = t("Эта страница открывается по ссылке из письма Owl."); show("v-error"); return; }
  try {
    if (mode === "verifyEmail") {
      await applyActionCode(auth, code);
      done(t("Почта подтверждена!"), t("Спасибо! Теперь ваш аккаунт Owl надёжнее защищён. Можно возвращаться к общению."));
    } else if (mode === "resetPassword") {
      const email = await verifyPasswordResetCode(auth, code);
      $("reset-email").textContent = email;
      show("v-reset"); setTimeout(() => $("pw").focus(), 300);
    } else if (mode === "recoverEmail") {
      const info = await checkActionCode(auth, code);
      await applyActionCode(auth, code);
      done(t("Почта восстановлена"), t("Для аккаунта снова указан адрес {email}. Если почту меняли не вы — смените пароль.", { email: info.data.email || "" }));
    } else if (mode === "verifyAndChangeEmail") {
      await applyActionCode(auth, code);
      done(t("Почта изменена"), t("Новый адрес подтверждён. Используйте его для входа в Owl."));
    } else {
      throw { code: "auth/invalid-action-code" };
    }
  } catch (e) { fail(e); }
}

// форма нового пароля: сова закрывает глаза, пока вы печатаете
const pw = $("pw"), eye = $("pw-eye");
pw.addEventListener("focus", () => owl.classList.toggle(pw.type === "password" ? "cover" : "peek", true));
pw.addEventListener("blur", () => owl.classList.remove("cover", "peek"));
pw.addEventListener("input", () => { $("reset-msg").textContent = ""; });
eye.addEventListener("mousedown", (e) => e.preventDefault());
eye.addEventListener("click", () => {
  const show = pw.type === "password";
  pw.type = show ? "text" : "password"; eye.classList.toggle("on", show);
  if (document.activeElement === pw) { owl.classList.toggle("cover", !show); owl.classList.toggle("peek", show); }
});
$("reset-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const val = pw.value;
  if (val.length < 6) { $("reset-msg").textContent = t("Пароль должен быть не короче 6 символов"); react("shake"); return; }
  const btn = $("reset-btn"); btn.disabled = true; btn.textContent = t("Сохраняем…");
  try {
    await confirmPasswordReset(auth, code, val);
    pw.blur(); owl.classList.remove("cover", "peek");
    done(t("Пароль изменён!"), t("Войдите в Owl с новым паролем. Если вы были авторизованы на других устройствах — там тоже понадобится новый пароль."));
  } catch (err) {
    btn.disabled = false; btn.textContent = t("Сохранить пароль");
    if (err.code === "auth/weak-password") { $("reset-msg").textContent = t("Слишком простой пароль — придумайте сложнее"); react("shake"); }
    else fail(err);
  }
});

run();
