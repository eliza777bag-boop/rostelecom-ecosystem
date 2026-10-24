(function () {
  'use strict';

  const INDUSTRIES = ['ТЭК', 'Торговля', 'Логистика', 'АПК', 'Промышленность', 'Услуги'];
  const COLORS = { active: '#7b2cbf', potential: '#ff6b00', unknown: '#8e86a3', mismatch: '#ff2d55' };
  const CENTER = [47.6, 40.6];          
  const SPOT_MIN = 5;                    


  const IFNS = {
    '01': 'Азов', '02': 'Аксай', '03': 'Багаевская', '04': 'Боковская', '05': 'Казанская', '06': 'Веселый',
    '07': 'Романовская', '08': 'Дубовское', '09': 'Егорлыкская', '10': 'Заветное', '11': 'Зерноград',
    '12': 'Зимовники', '13': 'Кагальницкая', '14': 'Глубокий', '15': 'Кашары', '16': 'Константиновск',
    '17': 'Куйбышево', '18': 'Большая Мартыновка', '19': 'Матвеев Курган', '20': 'Милютинская',
    '21': 'Морозовск', '22': 'Чалтырь', '23': 'Покровское', '24': 'Обливская', '25': 'Каменоломни',
    '26': 'Орловский', '27': 'Песчанокопское', '28': 'Пролетарск', '29': 'Ремонтное',
    '30': 'Родионово-Несветайская', '31': 'Сальск', '32': 'Семикаракорск', '33': 'Тарасовский',
    '34': 'Тацинская', '35': 'Усть-Донецкий', '36': 'Целина', '37': 'Цимлянск', '38': 'Чертково',
    '39': 'Вешенская', '40': 'Азов', '41': 'Батайск', '42': 'Белая Калитва', '43': 'Волгодонск',
    '44': 'Гуково', '45': 'Донецк', '46': 'Зверево', '47': 'Каменск-Шахтинский', '48': 'Красный Сулин',
    '49': 'Миллерово', '50': 'Новочеркасск', '51': 'Новошахтинск', '52': 'Сальск', '53': 'Сальск',
    '54': 'Таганрог', '55': 'Шахты',
    '61': 'Ростов-на-Дону', '62': 'Ростов-на-Дону', '63': 'Ростов-на-Дону', '64': 'Ростов-на-Дону',
    '65': 'Ростов-на-Дону', '66': 'Ростов-на-Дону', '67': 'Ростов-на-Дону', '68': 'Ростов-на-Дону', '69': 'Ростов-на-Дону'
  };

 
  const DATA = window.APP_DATA || {};
  const ZONES = DATA.ZONES || {};
  const zoneName = z => ZONES[z] || z || '—';
  let all = [], excluded = [], companies = [], sourceLabel = '', skippedRows = 0;


  function checkMismatch(c) {
    const inn = String(c.inn || '').trim();
    const reasons = [];
    if (inn.slice(0, 2) !== '61') {
      reasons.push(`ИНН присвоен вне Ростовской области (код ${inn.slice(0, 2)}${c.regRegionName ? ' — ' + c.regRegionName : ''})`);
    } else {
      // Город регистрации: явное поле regCity (если пришло из CRM), иначе — по коду ИФНС в ИНН
      const regZone = c.regCity || IFNS[inn.slice(2, 4)];
      if (regZone && regZone !== c.zone) {
        reasons.push(`Регистрация: ${zoneName(regZone)} → бизнес: ${c.addr}`);
      }
    }
    return reasons;
  }


  function setCompanies(list, label, skipped = 0) {
    all = list;
    sourceLabel = label;
    skippedRows = skipped;
  
    excluded = all.filter(c => c.excluded);
    companies = all.filter(c => !c.excluded).map(c => {
      const reasons = checkMismatch(c);
      return Object.assign(c, { mismatch: reasons.length > 0, reasons });
    });
    updateNote();
    render();
  }


  const $ = id => document.getElementById(id);
  const panel = $('panel-1');
  if (!panel || !$('m1-map')) return;

  $('m1-ind').innerHTML = INDUSTRIES.map(i =>
    `<label class="m1-chip"><input type="checkbox" name="m1-ind" value="${i}" checked><span>${i}</span></label>`).join('');


  function updateNote() {
    if (!all.length) {
      $('m1-note').textContent = 'Данные не загружены.';
      return;
    }
    const known = f => companies.filter(c => c[f] !== null && c[f] !== undefined).length;
    const n = companies.length;
    $('m1-note').textContent =
      `Источник: ${sourceLabel}, ${all.length} записей` + (skippedRows ? ` (ещё ${skippedRows} без координат — не показаны)` : '') +
      `. Ликвидированных (с датой исключения): ${excluded.length} — скрыты. ` +
      `Известно: статус клиента — у ${known('status')} из ${n}, выручка — у ${known('revenue')}, динамика — у ${known('growth')}. ` +
      `Остальное — «нет данных» (в реестре МСП этих полей нет; нужна выгрузка из CRM/ФНС). Координаты — центр города/района.`;
  }

  const fmtNum = n => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(n);
  const isNum = v => typeof v === 'number' && Number.isFinite(v);
  const NO_DATA = 'нет данных';
  /** 'active' | 'potential' | 'unknown' (статус в источнике не указан). */
  const statusKey = c => (c.status === 'active' || c.status === 'potential' ? c.status : 'unknown');
  const esc = s => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const toast = msg => (typeof window.showToast === 'function' ? window.showToast(msg) : console.info(msg));


  function getFilters() {
    const checked = name => [...panel.querySelectorAll(`input[name="${name}"]:checked`)].map(i => i.value);
    return {
      ind: new Set(checked('m1-ind')),
      status: new Set(checked('m1-status')),
      rev: $('m1-rev').value,
      dyn: $('m1-dyn').value,
      mismatch: $('m1-mismatch').checked
    };
  }

  function inRevenue(v, range) {
    if (range === 'all') return true;
    if (range === 'unknown') return !isNum(v);
    if (!isNum(v)) return false;
    const [lo, hi] = range.split('-').map(x => (x === '' ? Infinity : Number(x)));
    return v >= lo && v < hi;
  }
  function inDynamics(g, dyn) {
    if (dyn === 'all') return true;
    if (dyn === 'unknown') return !isNum(g);
    if (!isNum(g)) return false;
    if (dyn === 'fast') return g > 15;
    if (dyn === 'grow') return g >= 0 && g <= 15;
    if (dyn === 'fall') return g < 0;
    return true;
  }

  function applyFilters(list, f) {
    return list.filter(c =>
      f.ind.has(c.ind) && f.status.has(statusKey(c)) &&
      inRevenue(c.revenue, f.rev) && inDynamics(c.growth, f.dyn) &&
      (!f.mismatch || c.mismatch));
  }

  let map, markersLayer, heatLayer, spotsLayer, filtered = [];

  function initMap() {
    if (typeof L === 'undefined') {
      $('m1-empty').hidden = false;
      $('m1-empty').textContent = 'Не удалось загрузить Leaflet. Проверьте подключение к интернету.';
      return;
    }
    map = L.map('m1-map', { center: CENTER, zoom: 7, minZoom: 6, maxZoom: 18, preferCanvas: true, zoomControl: true });

    const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/';
    const esriAttr = 'Tiles &copy; <a href="https://www.esri.com">Esri</a> — Esri, HERE, Garmin, &copy; OpenStreetMap contributors';
    map.createPane('m1-labels');                     
    map.getPane('m1-labels').style.zIndex = 450;
    map.getPane('m1-labels').style.pointerEvents = 'none';
    const esriBase = L.tileLayer(ESRI + 'World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
      maxNativeZoom: 16, maxZoom: 19, attribution: esriAttr
    });
    const esriLabels = L.tileLayer(ESRI + 'World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}', {
      maxNativeZoom: 16, maxZoom: 19, pane: 'm1-labels'
    });
    const esriDark = L.layerGroup([esriBase, esriLabels]).addTo(map);

    const carto = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      subdomains: 'abcd', maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
    });
   
    const osmDark = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, className: 'm1-tiles-dark',
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    });
    L.control.layers({
      'Тёмная карта (Esri, без ключа)': esriDark,
      'CartoDB Dark Matter': carto,
      'OpenStreetMap (тёмная)': osmDark
    }, null, { position: 'topright' }).addTo(map);

   
    let tileErrors = 0;
    esriBase.on('tileerror', () => {
      if (++tileErrors === 6 && map.hasLayer(esriDark)) {
        map.removeLayer(esriDark); osmDark.addTo(map);
        toast('Подложка Esri недоступна — переключились на резервную OpenStreetMap');
      }
    });

    markersLayer = L.layerGroup().addTo(map);
    spotsLayer = L.layerGroup().addTo(map);
    if (typeof L.heatLayer === 'function') {
      heatLayer = L.heatLayer([], {
        radius: 28, blur: 22, maxZoom: 11, minOpacity: 0.35,
        gradient: { 0.2: '#3b0a8c', 0.45: '#7b2cbf', 0.7: '#ff6b00', 1: '#ffd000' }
      }).addTo(map);
    } else {
      $('m1-layer-heat').disabled = true;
      toast('Leaflet.heat не загрузился — тепловая карта недоступна');
    }
    render();
  }

  const STATUS_LABEL = { active: 'Действующий клиент', potential: 'Потенциальный клиент', unknown: 'Статус клиента: нет данных' };

  function popupHtml(c) {
    const sk = statusKey(c);
    const warn = c.mismatch
      ? `<div class="m1-warn">⚠ Расхождение юр. и факт. адреса${c.reasons.map(r => `<small>${esc(r)}</small>`).join('')}</div>`
      : '';
    const rev = isNum(c.revenue) ? `${fmtNum(c.revenue)} млн ₽` : `<span class="m1-na">${NO_DATA}</span>`;
    const g = !isNum(c.growth) ? `<span class="m1-na">${NO_DATA}</span>`
      : c.growth > 0 ? `+${fmtNum(c.growth)}%` : `${fmtNum(c.growth)}%`;
    const gColor = !isNum(c.growth) ? 'inherit' : c.growth < 0 ? '#b0002a' : '#0a7a3e';
    const missing = [sk === 'unknown' && 'статус', !isNum(c.revenue) && 'выручка', !isNum(c.growth) && 'динамика'].filter(Boolean);
    return `<div class="m1-pop">
      <h4>${esc(c.name)}</h4>
      <span class="m1-badge ${sk}">${STATUS_LABEL[sk]}</span>
      ${warn}
      <dl>
        <dt>ИНН</dt><dd>${esc(c.inn)}</dd>
        <dt>Отрасль</dt><dd>${esc(c.ind)}</dd>
        <dt>ОКВЭД</dt><dd>${esc(c.okved)}</dd>
        <dt>Категория</dt><dd>${esc(c.cat)}</dd>
        <dt>Адрес</dt><dd>${esc(c.addr)}${c.approx ? ' <span title="Точка поставлена в центр района">(≈)</span>' : ''}</dd>
        <dt>Выручка</dt><dd>${rev}</dd>
        <dt>Динамика</dt><dd style="color:${gColor}">${g}</dd>
      </dl>
      ${missing.length ? `<div class="m1-demo">Нет в источнике: ${missing.join(', ')}. Нужны данные CRM/ФНС.</div>` : ''}
    </div>`;
  }

  function render() {
    filtered = applyFilters(companies, getFilters());
    const count = s => filtered.filter(c => statusKey(c) === s).length;
    $('m1-k-total').textContent = filtered.length;
    $('m1-k-active').textContent = count('active');
    $('m1-k-potential').textContent = count('potential');
    $('m1-k-unknown').textContent = count('unknown');
    $('m1-k-mismatch').textContent = filtered.filter(c => c.mismatch).length;
    $('m1-k-excluded').textContent = excluded.length;
    // «Нет компаний по фильтрам» — только когда данные есть; если данных нет, об этом говорит m1-data-status
    $('m1-empty').hidden = filtered.length > 0 || !all.length;
    if (!map) return;

    markersLayer.clearLayers();
    filtered.forEach(c => {
      L.circleMarker([c.lat, c.lng], {
        radius: c.mismatch ? 7 : 6,
        color: c.mismatch ? COLORS.mismatch : '#ffffff',
        weight: c.mismatch ? 3 : 1,
        fillColor: COLORS[statusKey(c)], fillOpacity: 0.9
      }).bindPopup(popupHtml(c), { className: 'm1-popup', maxWidth: 320 })
        .bindTooltip(esc(c.name), { direction: 'top', offset: [0, -6] })
        .addTo(markersLayer);
    });
    if (heatLayer) {
      
      heatLayer.setLatLngs(filtered.map(c => [c.lat, c.lng,
        isNum(c.revenue) ? Math.min(1, 0.3 + Math.log10(1 + Math.max(0, c.revenue)) / 3) : 0.3]));
    }
    toggleLayers();
    spotsLayer.clearLayers();
    $('m1-insight').hidden = true;
  }

  function toggleLayers() {
    if (!map) return;
    const show = (layer, on) => layer && (on ? map.addLayer(layer) : map.removeLayer(layer));
    show(markersLayer, $('m1-layer-markers').checked);
    show(heatLayer, $('m1-layer-heat').checked);
  }

  function findWhiteSpots() {
    const f = getFilters();
    f.status = new Set(['active', 'potential', 'unknown']);
    const pool = applyFilters(companies, f);
    const knownStatus = pool.filter(c => statusKey(c) !== 'unknown').length;
    const zones = new Map();
    pool.forEach(c => {
      const z = zones.get(c.zone) || { zone: c.zone, list: [], active: 0, revenue: 0, revKnown: 0, lat: 0, lng: 0 };
      z.list.push(c); z.lat += c.lat; z.lng += c.lng;
      if (isNum(c.revenue)) { z.revenue += c.revenue; z.revKnown++; }
      if (c.status === 'active') z.active++;
      zones.set(c.zone, z);
    });
    const stats = [...zones.values()].map(z => {
      const n = z.list.length;
      const byInd = {};
      z.list.forEach(c => { byInd[c.ind] = (byInd[c.ind] || 0) + 1; });
      const topInd = Object.entries(byInd).sort((a, b) => b[1] - a[1])[0];
      const growing = z.list.filter(c => isNum(c.growth) && c.growth > 0).length;
      const growKnown = z.list.filter(c => isNum(c.growth)).length;
      return { ...z, n, share: z.active / n, lat: z.lat / n, lng: z.lng / n, topInd, growing, growKnown };
    });
    const spots = knownStatus === 0 ? [] : stats.filter(z => z.n >= SPOT_MIN && z.active === 0)
      .sort((a, b) => b.n - a.n || b.revenue - a.revenue);
    return { spots, stats, pool, knownStatus };
  }

  function showWhiteSpots() {
    if (!map) return;
    const { spots, stats, knownStatus } = findWhiteSpots();
    spotsLayer.clearLayers();
    const box = $('m1-insight');
    box.hidden = false;

    if (knownStatus === 0) {
      const dense = stats.filter(z => z.n >= SPOT_MIN).sort((a, b) => b.n - a.n).slice(0, 5);
      box.innerHTML = `<h4>Нет данных о статусе клиентов</h4>
        Чтобы найти белые пятна (зоны без действующих клиентов), загрузите CSV с колонкой <b>status</b>
        (active / potential) — кнопка «Загрузить CSV».` +
        (dense.length ? `<div class="m1-rec">Самые плотные зоны по реестру МСП: ${dense.map(z =>
          `${esc(zoneName(z.zone))} — ${z.n}`).join('; ')}.</div>` : '');
      return;
    }

    if (!spots.length) {
      const low = stats.filter(z => z.n >= SPOT_MIN).sort((a, b) => a.share - b.share).slice(0, 3);
      box.innerHTML = `<h4>Белых пятен не найдено</h4>
        В каждой зоне с ${SPOT_MIN}+ компаниями уже есть действующий клиент.` +
        (low.length ? `<div class="m1-rec">Минимальное присутствие: ${low.map(z =>
          `${esc(zoneName(z.zone))} — ${Math.round(z.share * 100)}% (${z.active} из ${z.n})`).join('; ')}.</div>` : '');
      return;
    }

    const maxN = spots[0].n;
    spots.forEach(z => {
      L.circle([z.lat, z.lng], {
        radius: 6000 + 14000 * (z.n / maxN),
        color: '#ff6b00', weight: 2, dashArray: '6 6', fillColor: '#ff6b00', fillOpacity: 0.12
      }).bindTooltip(`Белое пятно: ${esc(zoneName(z.zone))} · ${z.n} компаний`, { sticky: true })
        .addTo(spotsLayer);
    });

    const totalN = spots.reduce((s, z) => s + z.n, 0);
    const totalRev = spots.reduce((s, z) => s + z.revenue, 0);
    const revKnown = spots.reduce((s, z) => s + z.revKnown, 0);
    const revText = revKnown === 0 ? '(выручка: нет данных)'
      : `с выручкой ≈ ${fmtNum(Math.round(totalRev))} млн ₽` + (revKnown < totalN ? ` (известна у ${revKnown} из ${totalN})` : '');
    const top = spots[0];
    const growText = top.growKnown === 0 ? 'динамика роста: нет данных'
      : `${top.growing} из ${top.growKnown} с известной динамикой растут`;
    box.innerHTML = `<h4>Найдено белых пятен: ${spots.length}</h4>
      ${totalN} компаний ${revText} работают в зонах без известных действующих клиентов Ростелекома.
      <ol>${spots.slice(0, 5).map((z, i) =>
        `<li><button type="button" data-spot="${i}">${esc(zoneName(z.zone))}</button> — ${z.n} компаний, ${esc(z.topInd[0])} (${z.topInd[1]})</li>`).join('')}</ol>
      <div class="m1-rec"><b>Инсайт:</b> приоритет — ${esc(zoneName(top.zone))}: ${top.n} компаний без контракта,
        ${growText}. Основная отрасль — ${esc(top.topInd[0])}; предложите пакет связи и облачных
        сервисов для сектора «${esc(top.topInd[0])}» и назначьте выездного менеджера.</div>`;
    box.querySelectorAll('[data-spot]').forEach(btn => btn.addEventListener('click', () => {
      const z = spots[Number(btn.dataset.spot)];
      map.flyTo([z.lat, z.lng], 10, { duration: 0.8 });
    }));
    map.flyToBounds(L.latLngBounds(spots.map(z => [z.lat, z.lng])).pad(0.3), { duration: 0.8, maxZoom: 9 });
  }


  function exportCsv() {
    if (!filtered.length) { toast('Нет данных для экспорта — измените фильтры'); return; }
    const head = ['Наименование', 'ИНН', 'Категория', 'Отрасль', 'ОКВЭД', 'Адрес ведения бизнеса', 'Зона',
      'Статус', 'Выручка, млн руб.', 'Динамика, %', 'Расхождение адресов', 'Причина расхождения', 'Широта', 'Долгота'];
    const cell = v => {
      const s = String(v ?? '');
      return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };

    const num = v => (isNum(v) ? String(v).replace('.', ',') : '');
    const ST = { active: 'Действующий', potential: 'Потенциальный', unknown: '' };
    const lines = filtered.map(c => [
      c.name, c.inn, c.cat, c.ind, c.okved, c.addr, zoneName(c.zone),
      ST[statusKey(c)], num(c.revenue), num(c.growth),
      c.mismatch ? 'Да' : 'Нет', c.reasons.join(' | '), num(c.lat), num(c.lng)
    ].map(cell).join(';'));
  
    const blob = new Blob(['\uFEFF' + [head.join(';'), ...lines].join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), {
      href: url, download: `radar_${new Date().toISOString().slice(0, 10)}.csv`
    });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast(`Выгружено компаний: ${filtered.length}`);
  }

  panel.querySelectorAll('.m1-side input[name], #m1-rev, #m1-dyn, #m1-mismatch')
    .forEach(el => el.addEventListener('change', render));
  $('m1-layer-markers').addEventListener('change', toggleLayers);
  $('m1-layer-heat').addEventListener('change', toggleLayers);
  $('m1-spots').addEventListener('click', showWhiteSpots);
  $('m1-export').addEventListener('click', exportCsv);
  $('m1-reset').addEventListener('click', () => {
    panel.querySelectorAll('.m1-side input[name]').forEach(i => { i.checked = true; });
    $('m1-rev').value = 'all'; $('m1-dyn').value = 'all'; $('m1-mismatch').checked = false;
    render();
    if (map) map.flyTo(CENTER, 7, { duration: 0.6 });
  });


  function onPanelShown() {
    if (panel.hidden) return;
    requestAnimationFrame(() => {
      if (!map) initMap();
      else map.invalidateSize();
    });
  }
  new MutationObserver(onPanelShown).observe(panel, { attributes: true, attributeFilter: ['hidden'] });
  const tab = $('tab-1');
  if (tab) tab.addEventListener('click', () => {
    if (map) map.invalidateSize();  
    setTimeout(onPanelShown, 0);    
  });
  onPanelShown();      
  render();           

  
  function setDataStatus(html, isError) {
    const box = $('m1-data-status');
    box.hidden = !html;
    box.classList.toggle('is-error', !!isError);
    box.innerHTML = html || '';
  }

  
  async function loadDefault() {
    if (!DATA.loadRadarCsv) { setDataStatus('Не подключён js/data.js', true); return; }
    setDataStatus('Загружаем данные…');
    try {
      const { companies: list, skipped } = await DATA.loadRadarCsv();
      setCompanies(list, `реестр МСП (${DATA.RADAR_CSV_URL})`, skipped);
      setDataStatus('');
    } catch (err) {
      console.warn('[Радар] CSV не загружен:', err);
      const fileMode = location.protocol === 'file:';
      setDataStatus(
        `<b>Данные радара не загружены.</b> ` +
        (fileMode
          ? 'Страница открыта двойным щелчком (file://) — браузер не даёт прочитать CSV автоматически. '
          : `Файл <code>${esc(DATA.RADAR_CSV_URL)}</code> не найден (в публичном репозитории его может не быть). `) +
        'Нажмите <b>«Загрузить CSV»</b> и выберите файл <code>radar_data.csv</code>' +
        (fileMode ? ' или запустите локальный сервер (см. README).' : '.'), true);
      updateNote();
    }
  }

 
  $('m1-file').addEventListener('change', async e => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    try {
      const { companies: list, skipped } = DATA.parseRadarCsv(await file.text());
      setCompanies(list, `файл «${file.name}»`, skipped);
      setDataStatus('');
      toast(`Загружено компаний: ${list.length}` + (skipped ? ` (без координат пропущено: ${skipped})` : ''));
    } catch (err) {
      setDataStatus(`<b>Не удалось прочитать файл.</b> ${esc(err.message)}`, true);
    }
    e.target.value = '';   // чтобы можно было выбрать тот же файл ещё раз
  });
  $('m1-load').addEventListener('click', () => $('m1-file').click());

  loadDefault();


  window.RADAR = {
    get companies() { return companies; }, get excluded() { return excluded; },
    checkMismatch, findWhiteSpots, setCompanies, loadDefault, get map() { return map; }
  };
})();
