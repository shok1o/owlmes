// Owl: запускается первым, до отрисовки (подключён в <head> index.html)
(function () {
  var root = document.documentElement;
  // Упрощённый режим: класс на <html> — до первой отрисовки, чтобы заставка не успела показать звёзды и анимацию.
  // owlCalm() — «без лишнего движения»: этот режим или системное «Уменьшение движения»
  try { if (localStorage.getItem("owl-simple") === "on") root.classList.add("owl-simple"); } catch (_) {}
  window.owlCalm = function () { return root.classList.contains("owl-simple") || matchMedia("(prefers-reduced-motion: reduce)").matches; };

  // Owl внутри чужого сайта (в рамке) не показываем: иначе поверх него можно подложить невидимые кнопки
  if (self !== top) { window.owlFramed = true; root.style.display = "none"; try { top.location.replace(location.href); } catch (_) {} }

  // Защита от чужих скриптов (CSP): какие адреса странице можно загружать. Эта же строка — в <meta> в index.html
  // (когда защита включена для всех); здесь — для пробного режима. Менять обе вместе.
  var CSP = "default-src 'none'; script-src 'self' https://www.gstatic.com/firebasejs/10.11.0/ https://www.google.com/recaptcha/ https://www.gstatic.com/recaptcha/ https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; media-src 'self' data: blob:; connect-src 'self' data: blob: https://firestore.googleapis.com https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://content-firebaseappcheck.googleapis.com https://www.google.com/recaptcha/ https://push.owlmes.ru; frame-src https://www.google.com/recaptcha/ https://recaptcha.google.com/recaptcha/ https://challenges.cloudflare.com; worker-src 'self'; manifest-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'";
  window.OWL_CSP = CSP;

  // Журнал нарушений: что именно браузер не пустил (без адресов с параметрами); первые 5 — на сервер, чтобы увидеть сбои у людей
  var log = window.owlCspLog = [], seen = {}, sent = 0;
  document.addEventListener("securitypolicyviolation", function (e) {
    var url = String(e.blockedURI || "").split(/[?#]/)[0].slice(0, 200), key = e.effectiveDirective + " " + url;
    if (/^(chrome|moz|safari|safari-web|ms-browser)-extension/.test(url) || seen[key]) return; // расширения браузера — не наше
    seen[key] = 1; log.push(key);
    if (sent++ < 5 && navigator.sendBeacon) try {
      navigator.sendBeacon("https://push.owlmes.ru/csp", JSON.stringify({ d: e.effectiveDirective, u: url, f: String(e.sourceFile || "").split(/[?#]/)[0].slice(0, 200), l: e.lineNumber || 0, m: e.disposition }));
    } catch (_) {}
  });

  // Пробный режим: ?csp=on — включить на 2 часа на этом устройстве, ?csp=off — выключить (и кнопка в «Панели разработчика»)
  try {
    var q = window.owlFramed ? null : new URLSearchParams(location.search).get("csp");
    if (q === "on") localStorage.setItem("owl-csp-canary", String(Date.now()));
    else if (q === "off") localStorage.removeItem("owl-csp-canary");
    var since = +localStorage.getItem("owl-csp-canary") || 0;
    if (since && Date.now() - since < 2 * 3600000) {
      var m = document.createElement("meta"); m.httpEquiv = "Content-Security-Policy"; m.content = CSP;
      document.head.appendChild(m); window.owlCspCanary = true;
    }
  } catch (_) {}
})();
