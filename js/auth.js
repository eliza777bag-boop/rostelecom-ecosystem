(function () {
  'use strict';
  const box = document.getElementById('auth-box');
  if (!box || !/^https?:$/.test(location.protocol)) return;

  /** Вызывается из data.js, если сервер ответил 401 (сессия закончилась). */
  window.handleSessionExpired = function () {
    if (window.showToast) window.showToast('Сессия завершена. Войдите заново.');
    setTimeout(() => location.replace('/login'), 1200);
  };

  fetch('/api/me', { credentials: 'same-origin', cache: 'no-store' })
    .then(res => {
      if (res.status === 401) { window.handleSessionExpired(); return null; }
      return res.ok ? res.json() : null;   // 404 и т.п. = сервера входа нет (например, GitHub Pages)
    })
    .then(data => {
      if (!data || !data.ok) return;
      document.getElementById('auth-user').textContent = data.user;
      box.hidden = false;
    })
    .catch(() => { /* сервер без API входа — ничего не делаем */ });

  document.getElementById('auth-logout').addEventListener('click', async () => {
    try {
      await fetch('/api/logout', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' }, body: '{}'
      });
    } finally {
      location.replace('/login');
    }
  });
})();
