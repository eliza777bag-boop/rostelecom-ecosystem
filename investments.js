/* ===================== МОДУЛЬ 2 · ИНВЕСТИЦИОННЫЙ НАВИГАТОР =====================
   Фильтры: стадия, отрасль, ИТ-потребности, крупные проекты, поиск (инициатор, муниципалитет, название).
   Таймлайн по году ввода, карточки, модальное окно, экспорт CSV, подписка (демо),
   кнопка «Сформировать КП» → Модуль 3 (регион «Южный ФО» + уровень по бюджету).
   Данные: window.APP_DATA.INV_DATA (js/data.js). */
(function () {
  'use strict';
  // Реестр инвестпроектов — из js/data.js (встроен в JS, поэтому работает и при открытии двойным щелчком)
  const DATA = (window.APP_DATA && window.APP_DATA.INV_DATA) || [];
  const root = document.getElementById('module-2');
  if (!root) return;
  const $ = id => document.getElementById(id);
  const toast = msg => (typeof window.showToast === 'function' ? window.showToast(msg) : console.info(msg));
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nf1 = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });
  const mln = n => nf1.format(n);
  const NOW_YEAR = 2026;
  const BIG = 250;

  const STAGES = ['Проектирование', 'Строительство', 'Запуск'];
  const INDS = ['ТЭК', 'АПК', 'Логистика и склад', 'Промышленность', 'Услуги и Торговля', 'Девелопмент'];
  const NEEDS = ['ИТ-инфраструктура', 'АСУ ТП', 'Физическая безопасность', 'Информационная безопасность'];

  /* Корзины таймлайна по году ввода в эксплуатацию */
  const BUCKETS = [
    { key: '2026', label: '2026', test: y => y <= 2026 },
    { key: '2027', label: '2027', test: y => y === 2027 },
    { key: '2028', label: '2028', test: y => y === 2028 },
    { key: '2029', label: '2029–2030', test: y => y >= 2029 && y <= 2030 },
    { key: '2031', label: '2031+', test: y => y >= 2031 }
  ];

  /* Рекомендуемые решения Ростелекома по ИТ-потребностям */
  const SOLUTIONS = {
    'ИТ-инфраструктура': [
      { ico: '🔗', t: 'Прокладка ВОЛС и выделенный интернет', d: 'Подключение площадки, резервный канал, SLA 99,9%' },
      { ico: '☎️', t: 'Облачная АТС', d: 'Телефония и колл-центр без собственного оборудования' },
      { ico: '☁️', t: 'Облако и ЦОД Ростелекома', d: 'IaaS, резервное копирование, размещение ERP' }
    ],
    'АСУ ТП': [
      { ico: '🏭', t: 'Индустриальный IoT / АСУ ТП', d: 'Телеметрия, учёт энергоресурсов, LoRaWAN/NB-IoT' },
      { ico: '📡', t: 'Частная сеть LTE/5G для предприятия', d: 'Связь для датчиков, техники и персонала' }
    ],
    'Физическая безопасность': [
      { ico: '🎥', t: 'Видеонаблюдение с ИИ', d: 'Видеоаналитика, контроль периметра, распознавание ТС' },
      { ico: '🔐', t: 'СКУД и охранная сигнализация', d: 'Контроль доступа персонала и подрядчиков' }
    ],
    'Информационная безопасность': [
      { ico: '🛡️', t: 'Кибербезопасность Solar', d: 'Защита от DDoS, SOC, защита АСУ ТП (КИИ)' }
    ]
  };
  const IND_EXTRA = {
    'АПК': { ico: '🌾', t: 'Агромониторинг на IoT', d: 'Датчики климата, полива, учёт техники' },
    'Логистика и склад': { ico: '🚚', t: 'M2M и мониторинг транспорта', d: 'Трекинг флота, WMS-связь, Wi-Fi для ТСД' },
    'Девелопмент': { ico: '🏢', t: '«Умный дом» и цифровой квартал', d: 'Домофония, интернет и ТВ для жильцов' },
    'Услуги и Торговля': { ico: '📶', t: 'Wi-Fi для посетителей', d: 'Гостевой Wi-Fi с авторизацией и аналитикой' },
    'ТЭК': { ico: '⚡', t: 'Спутниковая и резервная связь', d: 'Связь на удалённых объектах и трассах' },
    'Промышленность': { ico: '🤖', t: 'Цифровой двойник производства', d: 'Сбор данных с линий и предиктивный ремонт' }
  };

  const state = { stage: 'all', ind: 'all', needs: new Set(), big: false, q: '' };
  const subs = new Set();

  /* ---------- Фильтры ---------- */
  function chip(label, value, group, count) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'inv-chip';
    b.dataset.value = value;
    if (group === 'need') b.setAttribute('aria-pressed', 'false');
    else { b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', String(value === 'all')); }
    b.innerHTML = esc(label) + (count != null ? `<small>${count}</small>` : '');
    return b;
  }
  function buildChips() {
    const cnt = (k, v) => DATA.filter(p => p[k] === v).length;
    const st = $('inv-stage'), ind = $('inv-ind'), nd = $('inv-need');
    st.append(chip('Все', 'all', 'stage'), ...STAGES.map(s => chip(s, s, 'stage', cnt('stage', s))));
    ind.append(chip('Все', 'all', 'ind'), ...INDS.map(s => chip(s, s, 'ind', cnt('ind', s))));
    nd.append(...NEEDS.map(s => chip(s, s, 'need', DATA.filter(p => p.needs.includes(s)).length)));
    nd.title = 'Можно выбрать несколько: показываются проекты с любой из выбранных потребностей';

    const radio = (box, key) => box.addEventListener('click', e => {
      const b = e.target.closest('.inv-chip'); if (!b) return;
      state[key] = b.dataset.value;
      box.querySelectorAll('.inv-chip').forEach(c => c.setAttribute('aria-checked', String(c === b)));
      render();
    });
    radio(st, 'stage'); radio(ind, 'ind');
    nd.addEventListener('click', e => {
      const b = e.target.closest('.inv-chip'); if (!b) return;
      const v = b.dataset.value;
      state.needs.has(v) ? state.needs.delete(v) : state.needs.add(v);
      b.setAttribute('aria-pressed', String(state.needs.has(v)));
      render();
    });
  }

  function filtered() {
    const q = state.q.trim().toLowerCase();
    return DATA.filter(p =>
      (state.stage === 'all' || p.stage === state.stage) &&
      (state.ind === 'all' || p.ind === state.ind) &&
      (!state.needs.size || p.needs.some(n => state.needs.has(n))) &&
      (!state.big || p.budget > BIG) &&
      (!q || p.title.toLowerCase().includes(q) || p.inv.toLowerCase().includes(q) || p.mun.toLowerCase().includes(q))
    );
  }
  /* ---------- Рендер ---------- */
  const shortName = s => s.length > 60 ? s.slice(0, 58) + '…' : s;
  function card(p) {
    return `<button type="button" class="inv-card" data-id="${p.id}" aria-haspopup="dialog">
      <span class="inv-card-top"><span>${esc(p.mun)}</span><span>${p.start}–${p.end}${p.key ? ' · <span class="inv-key">★ ключевой</span>' : ''}</span></span>
      <span class="inv-card-t">${esc(p.title)}</span>
      <span class="inv-card-i">${esc(shortName(p.inv))}</span>
      <span class="inv-badges">
        <span class="inv-b inv-b-stage">${esc(p.stage)}</span>
        <span class="inv-b inv-b-ind">${esc(p.ind)}</span>
        <span class="inv-b inv-b-bud">${mln(p.budget)} млн ₽</span>
      </span>
    </button>`;
  }

  function render() {
    const list = filtered();
    const sum = list.reduce((s, p) => s + p.budget, 0);
    $('inv-k-count').textContent = list.length;
    $('inv-k-count-sub').textContent = `из ${DATA.length} в реестре`;
    $('inv-k-sum').textContent = mln(sum);
    $('inv-k-it').textContent = list.length ? `${mln(sum * 0.03)} – ${mln(sum * 0.05)}` : '0';
    $('inv-k-jobs').textContent = list.reduce((s, p) => s + p.jobs, 0).toLocaleString('ru-RU');

    const tl = $('inv-tl');
    $('inv-empty').hidden = list.length > 0;
    tl.hidden = !list.length;
    tl.innerHTML = BUCKETS.map(b => {
      const items = list.filter(p => b.test(p.end)).sort((a, c) => c.budget - a.budget);
      if (!items.length) return '';
      const s = items.reduce((a, p) => a + p.budget, 0);
      const now = b.key === String(NOW_YEAR);
      return `<div class="inv-col${now ? ' is-now' : ''}">
        <div class="inv-mile"><span class="inv-mile-dot"></span>
          <div class="inv-mile-y">${b.label}${now ? '<em>текущий год</em>' : ''}</div>
          <div class="inv-mile-s">Ввод: ${items.length} пр. · ${mln(s)} млн ₽</div>
        </div>
        <div class="inv-cards">${items.map(card).join('')}</div>
      </div>`;
    }).join('');
  }

  /* ---------- Модальное окно ---------- */
  let lastFocus = null, current = null;
  function solutionsFor(p) {
    const out = [];
    p.needs.forEach(n => (SOLUTIONS[n] || []).forEach(s => out.push(s)));
    if (IND_EXTRA[p.ind]) out.push(IND_EXTRA[p.ind]);
    const seen = new Set();
    return out.filter(s => !seen.has(s.t) && seen.add(s.t)).slice(0, 6);
  }
  function openModal(id) {
    const p = DATA.find(x => x.id === id); if (!p) return;
    current = p;
    lastFocus = document.activeElement;
    $('inv-m-body').innerHTML = `
      <div class="inv-badges">
        <span class="inv-b inv-b-stage">${esc(p.stage)}</span>
        <span class="inv-b inv-b-ind">${esc(p.ind)}</span>
        <span class="inv-b inv-b-bud">${mln(p.budget)} млн ₽</span>
        ${p.key ? '<span class="inv-b inv-b-stage">★ Ключевой инвестпроект</span>' : ''}
      </div>
      <h3 class="inv-m-h" id="inv-m-title">${esc(p.title)}</h3>
      <p class="inv-m-inv">Инвестор: <b>${esc(p.inv)}</b></p>
      <div class="inv-m-grid">
        <div class="inv-m-cell"><span>Муниципалитет</span><b>${esc(p.mun)}</b></div>
        <div class="inv-m-cell"><span>Куратор</span><b>${esc(p.cur)}</b></div>
        <div class="inv-m-cell"><span>Сроки</span><b>${p.start} – ${p.end} гг.</b></div>
        <div class="inv-m-cell"><span>Бюджет</span><b>${mln(p.budget)} млн ₽</b></div>
        <div class="inv-m-cell"><span>Рабочие места</span><b>${p.jobs || '—'}</b></div>
        <div class="inv-m-cell"><span>Потребности ИТ</span><b>${p.needs.map(esc).join(', ')}</b></div>
      </div>
      <h4 class="inv-m-sec">Рекомендуемые решения Ростелекома</h4>
      <ul class="inv-sol">${solutionsFor(p).map(s => `<li><i aria-hidden="true">${s.ico}</i><span><b>${esc(s.t)}</b><small>${esc(s.d)}</small></span></li>`).join('')}</ul>
      <div class="inv-m-foot">
        <div class="inv-m-pot">Потенциал ИТ/связи: <b>${mln(p.budget * 0.03)} – ${mln(p.budget * 0.05)} млн ₽</b></div>
        <button type="button" class="inv-btn inv-btn-orange" id="inv-m-kp">🧮 Сформировать КП в Калькуляторе</button>
      </div>`;
    $('inv-modal').hidden = false;
    document.body.style.overflow = 'hidden';
    $('inv-m-kp').addEventListener('click', () => toCalculator(p));
    root.closest('.panel').querySelector('.inv-modal-box').focus();
  }
  function closeModal() {
    if ($('inv-modal').hidden) return;
    $('inv-modal').hidden = true;
    document.body.style.overflow = '';
    if (lastFocus && document.contains(lastFocus)) lastFocus.focus();
  }

  /* Переход в Модуль 3: регион «Южный ФО», уровень — по бюджету и АСУ ТП */
  function toCalculator(p) {
    closeModal();
    const level = p.budget >= 1000 || p.needs.includes('АСУ ТП') && p.budget >= 250 ? '1.6' : p.budget >= 100 ? '1.3' : '1.0';
    const reg = document.querySelector('#calc-form [name="region"][value="1.10"]');
    const lvl = document.querySelector(`#calc-form [name="level"][value="${level}"]`);
    if (reg) reg.checked = true;
    if (lvl) lvl.checked = true;
    const tab3 = $('tab-3');
    if (tab3) tab3.click();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    toast(`КП по проекту «${shortName(p.title)}»: регион — Южный ФО, уровень — ${lvl ? lvl.dataset.name : 'базовый'}. Выберите оборудование и рассчитайте.`);
  }

  /* ---------- Подписка ---------- */
  function subscribe() {
    const cats = state.ind !== 'all' ? [state.ind] : [...new Set(filtered().map(p => p.ind))].sort((a, b) => INDS.indexOf(a) - INDS.indexOf(b));
    if (!cats.length) { toast('Нет отраслей в выборке — измените фильтры'); return; }
    const fresh = cats.filter(c => !subs.has(c));
    if (!fresh.length) { toast(`Вы уже подписаны на категории: ${cats.join(', ')}`); return; }
    fresh.forEach(c => subs.add(c));
    const list = fresh.length > 1 ? fresh.slice(0, -1).join(', ') + ' и ' + fresh[fresh.length - 1] : fresh[0];
    toast(`🔔 Вы успешно подписаны на уведомления по новым инвестпроектам в категории ${list}!`);
  }

  /* ---------- CSV (UTF-8 BOM, «;» для Excel) ---------- */
  function exportCsv() {
    const list = filtered();
    if (!list.length) { toast('Нет данных для экспорта — измените фильтры'); return; }
    const cell = v => { const s = String(v ?? ''); return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const num = n => String(Math.round(n * 100) / 100).replace('.', ',');
    const head = ['№', 'Муниципальное образование', 'Куратор', 'Ключевой', 'Инициатор', 'Название и суть проекта', 'Начало', 'Ввод', 'Бюджет, млн руб.', 'Рабочие места', 'Стадия', 'Отрасль', 'Потребности ИТ', 'Потенциал ИТ min (3%), млн руб.', 'Потенциал ИТ max (5%), млн руб.'];
    const rows = list.map(p => [p.id, p.mun, p.cur, p.key ? 'Да' : 'Нет', p.inv, p.title, p.start, p.end, num(p.budget), p.jobs, p.stage, p.ind, p.needs.join(', '), num(p.budget * 0.03), num(p.budget * 0.05)]);
    const csv = '﻿' + [head, ...rows].map(r => r.map(cell).join(';')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: `invest_reestr_${new Date().toISOString().slice(0, 10)}.csv` });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast(`Выгружено проектов: ${list.length}`);
  }

  /* ---------- Сброс ---------- */
  function reset() {
    Object.assign(state, { stage: 'all', ind: 'all', big: false, q: '' });
    state.needs.clear();
    $('inv-q').value = ''; $('inv-big').checked = false;
    root.querySelectorAll('[role="radio"].inv-chip').forEach(c => c.setAttribute('aria-checked', String(c.dataset.value === 'all')));
    root.querySelectorAll('[aria-pressed].inv-chip').forEach(c => c.setAttribute('aria-pressed', 'false'));
    render();
  }

  /* ---------- События ---------- */
  buildChips();
  let qTimer;
  $('inv-q').addEventListener('input', e => { clearTimeout(qTimer); qTimer = setTimeout(() => { state.q = e.target.value; render(); }, 150); });
  $('inv-big').addEventListener('change', e => { state.big = e.target.checked; render(); });
  $('inv-reset').addEventListener('click', reset);
  $('inv-sub').addEventListener('click', subscribe);
  $('inv-csv').addEventListener('click', exportCsv);
  $('inv-tl').addEventListener('click', e => { const c = e.target.closest('.inv-card'); if (c) openModal(Number(c.dataset.id)); });
  $('inv-modal').addEventListener('click', e => { if (e.target.closest('[data-close]')) closeModal(); });
  document.addEventListener('keydown', e => {
    if ($('inv-modal').hidden) return;
    if (e.key === 'Escape') closeModal();
    if (e.key === 'Tab') {
      const f = [...$('inv-modal').querySelectorAll('button')];
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });
  render();

  window.inv_api = { filtered, state, render, openModal, closeModal, exportCsv, subscribe, reset };
})();
