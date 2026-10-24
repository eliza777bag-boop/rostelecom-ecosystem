(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const formPw = $('form-password'), formCode = $('form-code'), msg = $('message');

  function showMessage(text) { msg.textContent = text || ''; msg.hidden = !text; }

  function goStep(n) {
    formPw.hidden = n !== 1;
    formCode.hidden = n !== 2;
    $('step-1-mark').className = n === 1 ? 'is-active' : 'is-done';
    $('step-2-mark').className = n === 2 ? 'is-active' : '';
    if (n === 1) { $('code').value = ''; $('password').value = ''; $('username').focus(); }
    else { $('code').focus(); }
  }

  async function post(url, body) {
    const res = await fetch(url, {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    let data = {};
    try { data = await res.json(); } catch (e) { /* пустой ответ */ }
    return { status: res.status, data };
  }

  async function submit(form, handler) {
    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    showMessage('');
    try { await handler(); }
    catch (e) { showMessage('Сервер недоступен. Проверьте, что он запущен (python backend/server.py).'); }
    finally { btn.disabled = false; }
  }

  formPw.addEventListener('submit', e => {
    e.preventDefault();
    const username = $('username').value.trim(), password = $('password').value;
    if (!username || !password) { showMessage('Введите логин и пароль.'); return; }
    submit(formPw, async () => {
      const { status, data } = await post('/api/login', { username, password });
      if (status === 200 && data.ok) { goStep(2); return; }
      $('password').value = '';
      showMessage(data.error || 'Ошибка входа.');
    });
  });

  $('code').addEventListener('input', e => {
    e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6);
  });

  formCode.addEventListener('submit', e => {
    e.preventDefault();
    const code = $('code').value;
    if (!/^\d{6}$/.test(code)) { showMessage('Код состоит из 6 цифр.'); return; }
    submit(formCode, async () => {
      const { status, data } = await post('/api/verify', { code });
      if (status === 200 && data.ok) { location.replace('/'); return; }
      $('code').value = '';
      if (data.restart) goStep(1);
      showMessage(data.error || 'Неверный код.');
    });
  });

  $('back').addEventListener('click', () => { showMessage(''); goStep(1); });
  $('username').focus();
})();
