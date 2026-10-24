/* =====================================================================
   main.js — общая логика приложения
   ---------------------------------------------------------------------
   1. showToast() — всплывающее уведомление внизу экрана (используют все модули).
   2. Вкладки-модули: переключение мышью и стрелками ← → на клавиатуре.

   Порядок подключения скриптов (в конце index.html):
     data.js → main.js → map.js → investments.js → calculator.js
   Модули не зависят друг от друга напрямую, общаются через DOM
   (например, Модуль 2 «Сформировать КП» нажимает вкладку tab-3).
   ===================================================================== */

/* ---------- Уведомления ---------- */
let toastTimer;
function showToast(text) {
  const t = document.getElementById('toast');
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3500);
}
window.showToast = showToast;

/* ---------- Навигация между модулями ---------- */
const tabs = [...document.querySelectorAll('[role="tab"]')];
function selectTab(tab) {
  tabs.forEach(t => {
    const active = t === tab;
    t.setAttribute('aria-selected', active);
    t.tabIndex = active ? 0 : -1;
    document.getElementById(t.getAttribute('aria-controls')).hidden = !active;
  });
  tab.focus();
}
tabs.forEach((tab, i) => {
  tab.addEventListener('click', () => selectTab(tab));
  tab.addEventListener('keydown', e => {
    if (e.key === 'ArrowRight') selectTab(tabs[(i + 1) % tabs.length]);
    if (e.key === 'ArrowLeft')  selectTab(tabs[(i - 1 + tabs.length) % tabs.length]);
  });
});
