// Owl: защита от рамки для отдельных страниц (action.html, privacy*.html, terms*.html, 404.html).
// Подключается первым в <head>, до отрисовки. Делает то же, что boot.js в приложении: страницу внутри чужого сайта
// (в рамке) не показываем — иначе поверх неё можно подложить невидимые кнопки. frame-ancestors в <meta> браузеры
// не учитывают, поэтому — скрипт. Других действий нет (boot.js сюда не подходит: он ещё шлёт журнал CSP и включает режимы).
// Меняешь файл — подними ?v= у <script src="/frame-guard.js?v=…"> во всех этих страницах
(function () {
  if (self !== top) {
    document.documentElement.style.display = "none";
    try { top.location.replace(location.href); } catch (_) {}
  }
})();
