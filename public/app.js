// Клиентская часть. Страницы приходят с сервера готовым HTML — здесь только
// поиск с подсказками, переход на страницу тикера и кнопка «Обновить».
(function () {
  const esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const SLUG = { RU: 'ru', US: 'us', CRYPTO: 'crypto' };

  // Язык берём у самой страницы: сервер уже проставил <html lang>, и второй
  // настройки на клиенте не нужно. Ключи — те же русские строки, что в словарях
  // сервера; нет перевода — остаётся русская строка, а не пустое место
  const LANG = document.documentElement.lang || 'ru';
  const CLIENT_DICT = {
    en: {
      'Ничего не найдено. Попробуйте тикер: GAZP, AAPL, BTC.': 'Nothing found. Try a ticker: GAZP, AAPL, BTC.',
      'Собрать': 'Generate',
      'Обновить': 'Refresh',
      '↻ через {t}': '↻ in {t}',
      'Данные обновляли недавно — повторное обновление недоступно': 'The data was refreshed recently, a second refresh is not available',
      '↻ обновляем…': '↻ refreshing…',
      'Собираем публикации и готовим сводку — 10–30 секунд.': 'Collecting publications and preparing the summary, 10–30 seconds.',
      'Обновление недоступно': 'Refresh is not available',
      'Готовим ответ…': 'Preparing the answer…',
      'Скопировано': 'Copied',
      'Выделено — скопируйте вручную': 'Selected — copy it manually',
      'не удалось получить ряд': 'could not get the series',
      'Отправляем…': 'Sending…',
    },
    es: {
      'Ничего не найдено. Попробуйте тикер: GAZP, AAPL, BTC.': 'No se encontró nada. Prueba con un ticker: GAZP, AAPL, BTC.',
      'Собрать': 'Generar',
      'Обновить': 'Actualizar',
      '↻ через {t}': '↻ en {t}',
      'Данные обновляли недавно — повторное обновление недоступно': 'Los datos se actualizaron hace poco; no se puede repetir',
      '↻ обновляем…': '↻ actualizando…',
      'Собираем публикации и готовим сводку — 10–30 секунд.': 'Recopilando publicaciones y preparando el resumen: 10–30 segundos.',
      'Обновление недоступно': 'La actualización no está disponible',
      'Готовим ответ…': 'Preparando la respuesta…',
      'Скопировано': 'Copiado',
      'Выделено — скопируйте вручную': 'Seleccionado: cópialo a mano',
      'не удалось получить ряд': 'no se pudo obtener la serie',
      'Отправляем…': 'Enviando…',
    },
  };
  const CT = (k, vars) => {
    const s = (CLIENT_DICT[LANG] && CLIENT_DICT[LANG][k]) || k;
    return vars ? String(s).replace(/\{(\w+)\}/g, (m, n) => (vars[n] === undefined ? m : String(vars[n]))) : s;
  };

  // Префикс языка в ссылке: подсказка поиска ведёт на страницу тикера, и на
  // /en/ она должна остаться в английской версии. Префикс есть у всех трёх
  // языков, включая русский, — иначе ссылка уводила бы через 301
  const langPrefix = `/${LANG}`;
  const tickerUrl = (type, symbol) =>
    `${langPrefix}/ticker/${SLUG[type] || 'us'}/${encodeURIComponent(symbol)}`;

  // ---------------------------------------------------------- поиск на главной
  const $q = document.getElementById('q');
  if ($q) {
    const $dd = document.getElementById('dd');
    let results = [];
    let active = -1;
    let seq = 0;
    let timer = null;

    const closeDd = () => {
      $dd.classList.remove('open');
      results = [];
      active = -1;
    };

    const renderDd = () => {
      if (!results.length) {
        $dd.innerHTML = `<div class="hint">${esc(CT('Ничего не найдено. Попробуйте тикер: GAZP, AAPL, BTC.'))}</div>`;
      } else {
        $dd.innerHTML = results
          .map(
            (r, i) => `
          <div class="opt ${i === active ? 'active' : ''}" data-i="${i}">
            <span class="sym">${esc(r.symbol)}</span>
            <span class="nm">${esc(r.name)}${r.exchange ? ` · ${esc(r.exchange)}` : ''}</span>
            <span class="tag ${esc(r.type)}">${esc(r.typeLabel || r.type)}</span>
          </div>`
          )
          .join('');
        $dd.querySelectorAll('.opt[data-i]').forEach((el) => {
          el.addEventListener('mousedown', (ev) => ev.preventDefault());
          el.addEventListener('click', () => go(results[+el.dataset.i]));
        });
      }
      $dd.classList.add('open');
    };

    const go = (r) => {
      closeDd();
      location.href = tickerUrl(r.type, r.symbol);
    };

    const search = async (v) => {
      const my = ++seq;
      try {
        const r = await fetch('/api/search?q=' + encodeURIComponent(v)).then((r) => r.json());
        if (my !== seq) return;
        results = Array.isArray(r) ? r : [];
        active = results.length ? 0 : -1;
        renderDd();
      } catch {
        /* сеть */
      }
    };

    $q.addEventListener('input', () => {
      clearTimeout(timer);
      const v = $q.value.trim();
      if (!v) return closeDd();
      timer = setTimeout(() => search(v), 220);
    });

    $q.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' && results.length) {
        active = (active + 1) % results.length;
        renderDd();
        e.preventDefault();
      } else if (e.key === 'ArrowUp' && results.length) {
        active = (active - 1 + results.length) % results.length;
        renderDd();
        e.preventDefault();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (results.length) go(results[Math.max(active, 0)]);
        else if ($q.value.trim()) search($q.value.trim());
      } else if (e.key === 'Escape') closeDd();
    });

    document.addEventListener('click', (e) => {
      if (!e.target.closest('.search')) closeDd();
    });

    // Переход с главной по ?q=... (поиск из адресной строки)
    const p = new URLSearchParams(location.search);
    if (p.get('q')) {
      $q.value = p.get('q');
      search(p.get('q'));
    }
  }

  // ---------------------------------------------------------- обновление тикера
  const btn = document.getElementById('refresh');
  if (btn) {
    const flash = document.getElementById('flash');
    const symbol = btn.dataset.symbol;
    const market = btn.dataset.market;
    let until = btn.dataset.next ? new Date(btn.dataset.next).getTime() : 0;
    let timer = null;

    const paint = () => {
      const left = until - Date.now();
      if (left <= 0) {
        clearInterval(timer);
        btn.disabled = false;
        btn.textContent = '↻ ' + (btn.dataset.generate ? CT('Собрать') : CT('Обновить'));
        btn.title = '';
        return;
      }
      btn.disabled = true;
      const mm = Math.floor(left / 60000);
      const ss = Math.floor((left % 60000) / 1000);
      btn.textContent = CT('↻ через {t}', { t: `${mm}:${String(ss).padStart(2, '0')}` });
      btn.title = CT('Данные обновляли недавно — повторное обновление недоступно');
    };

    paint();
    if (until > Date.now()) timer = setInterval(paint, 1000);

    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.textContent = CT('↻ обновляем…');
      if (flash) flash.innerHTML = `<div class="notice">${esc(CT('Собираем публикации и готовим сводку — 10–30 секунд.'))}</div>`;
      try {
        const p = new URLSearchParams({ symbol, market, refresh: '1' });
        const res = await fetch('/api/summary?' + p);
        const data = await res.json().catch(() => ({}));
        // 429 с готовыми данными — кулдаун: страница всё равно актуальна, просто ждём
        if (!res.ok && !data.summary && !data.asset) throw new Error(data.error || `HTTP ${res.status}`);
        if (res.ok) return location.reload();
        if (flash) flash.innerHTML = `<div class="notice">${esc(data.error || CT('Обновление недоступно'))}</div>`;
        until = data.nextRefreshAt ? new Date(data.nextRefreshAt).getTime() : until;
        paint();
      } catch (e) {
        if (flash) flash.innerHTML = `<div class="err">⚠️ ${esc(e.message)}</div>`;
        btn.disabled = false;
        btn.textContent = '↻ ' + CT('Обновить');
      }
    });
  }
  // ---------------------------------------------------------- форма вопроса
  const $qForm = document.querySelector('.qa-form');
  if ($qForm) {
    const $ta = $qForm.querySelector('textarea');
    const $count = document.getElementById('qa-count');
    const $btn = $qForm.querySelector('button[type="submit"]');
    const paint = () => {
      if ($count) $count.textContent = String($ta.value.length);
      const ok = $ta.value.trim().length >= 12 && $ta.value.length <= 300;
      if ($btn) $btn.disabled = !ok;
    };
    $ta.addEventListener('input', paint);
    paint();
    // Двойная отправка создаёт дубль вопроса — блокируем кнопку сразу
    $qForm.addEventListener('submit', () => {
      if ($btn) {
        $btn.disabled = true;
        $btn.textContent = CT('Готовим ответ…');
      }
    });
  }

  // ---------------------------------------------------------- обсуждения
  // Счётчик символов в формах обсуждения. Открытие <details> с формой
  // прокручиваем к форме: иначе после ошибки валидации она остаётся вне экрана
  document.querySelectorAll('.forum-form').forEach((form) => {
    const cnt = form.querySelector('#post-count') || document.getElementById('post-count');
    const ta = form.querySelector('textarea[name="body"]');
    if (cnt && ta) {
      const paint = () => {
        cnt.textContent = String(ta.value.length);
      };
      ta.addEventListener('input', paint);
      paint();
    }
  });

  // «Скопировать» фразу при регистрации: буфер обмена есть не всегда,
  // поэтому фолбэк — выделить текст, чтобы человек скопировал вручную
  document.querySelectorAll('[data-copy]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const el = document.getElementById(btn.dataset.copy);
      if (!el) return;
      const text = el.textContent.trim();
      try {
        await navigator.clipboard.writeText(text);
        btn.textContent = CT('Скопировано');
      } catch {
        const r = document.createRange();
        r.selectNodeContents(el);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(r);
        btn.textContent = CT('Выделено — скопируйте вручную');
      }
    });
  });

  // Кнопка «Наверх» появляется после прокрутки и плавно уходит наверху.
  // Слушатель passive: прокрутка не должна ждать обработчик. Порог в один
  // экран — пока видна шапка, кнопка не нужна и место в углу не занимает
  const toTop = document.querySelector('.totop');
  if (toTop) {
    let shown = false;
    const paint = () => {
      const want = window.scrollY > window.innerHeight * 0.75;
      if (want === shown) return;
      shown = want;
      toTop.classList.toggle('on', want);
    };
    window.addEventListener('scroll', paint, { passive: true });
    window.addEventListener('resize', paint, { passive: true });
    paint();
  }


  // -------------------------------------------------- живые графики
  // Сетка карточек обновляется сама: сервер отдаёт уже готовую разметку, поэтому
  // форматирование и подписи остаются в одном месте, а на клиенте нет ни одной
  // копии правил вывода. Дневные и крупнее не опрашиваются вовсе — data-poll
  // у них не выставлен, свеча за день в течение дня не меняется.
  // Опрос перезапускается при переключении интервала: у дневного ряда его нет,
  // у минутного свой период, и таймер должен следовать за выбранной свечой
  const polls = new Map();

  const startPolling = (grid) => {
    const stop = polls.get(grid);
    if (stop) stop();
    polls.delete(grid);
    // Сетка, которую заменило переключение интервала, больше не в документе:
    // её таймер иначе тикал бы вхолостую до перезагрузки страницы
    for (const [old, kill] of polls) {
      if (!old.isConnected) {
        kill();
        polls.delete(old);
      }
    }

    const cat = grid.dataset.cat || 'all';
    const tf = grid.dataset.tf || '1d';
    const every = Number(grid.dataset.poll) || 0;
    if (!every) return;

    let busy = false;

    const paint = (cards) => {
      for (const c of cards || []) {
        // Ищем по data-key, а не по порядку: если сервер вернул список короче,
        // карточки не должны сдвинуться и показать чужую цену
        const el = grid.querySelector(`.gcard[data-key="${c.key}"]`);
        if (el) el.innerHTML = c.html;
      }
    };

    const tick = async () => {
      // Вкладка в фоне не должна тянуть трафик: браузер и так режет таймеры,
      // но проверка избавляет от запроса сразу после возврата на вкладку
      if (busy || document.hidden || !grid.isConnected) return;
      busy = true;
      try {
        const r = await fetch(`/api/charts?cat=${encodeURIComponent(cat)}&tf=${encodeURIComponent(tf)}&lang=${encodeURIComponent(LANG)}`, {
          headers: { Accept: 'application/json' },
        });
        if (r.ok) paint((await r.json()).cards);
      } catch {
        // Сеть отвалилась — на экране остаётся последний удачный кадр
      } finally {
        busy = false;
      }
    };

    const timer = setInterval(tick, every);
    // Возврат на вкладку — хороший момент обновить сразу, а не ждать период
    const onVisible = () => {
      if (!document.hidden) tick();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('pagehide', () => clearInterval(timer));

    polls.set(grid, () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    });
  };

  const firstGrid = document.querySelector('.ggrid[data-poll]');
  if (firstGrid) startPolling(firstGrid);

  // ------------------------------ переключение интервала и категории
  // Кнопки остаются обычными ссылками: без скрипта и для поисковика работает
  // href. Здесь мы перехватываем нажатие и меняем только нужный кусок, чтобы
  // страница не мигала и не теряла место, где человек читал.
  // Обработчик висит на документе, а не на блоке: у тикера блок заменяется
  // целиком вместе со своими потомками, и обработчик на нём умер бы после
  // первого же переключения
  const loadFragment = async (board, tf, cat) => {
    const kind = board.dataset.live;
    let url;
    // Язык едет вместе с запросом: у /api нет префикса адреса, и без параметра
    // сервер отвечает по-русски — на английской странице переключение
    // интервала вставляло бы русские подписи и ссылки
    const langQ = `&lang=${encodeURIComponent(LANG)}`;
    if (kind === 'charts') {
      url = `/api/board?cat=${encodeURIComponent(cat || 'all')}&tf=${encodeURIComponent(tf)}${langQ}`;
    } else if (kind === 'inst') {
      url = `/api/chart?slug=${encodeURIComponent(board.dataset.slug || '')}&tf=${encodeURIComponent(tf)}${langQ}`;
    } else {
      url = `/api/chart?market=${encodeURIComponent(board.dataset.market || '')}&symbol=${encodeURIComponent(
        board.dataset.symbol || ''
      )}&tf=${encodeURIComponent(tf)}${langQ}`;
    }
    const r = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error(CT('не удалось получить ряд'));
    return r.json();
  };

  // Само переключение. push=false — когда состояние уже пришло от кнопки
  // «назад»: новый шаг истории там не нужен, иначе назад пришлось бы
  // нажимать дважды. link — ссылка, на которую нажали: из неё берётся адрес
  const switchBoard = async (board, link, { tf, cat, href }, push) => {
    const kind = board.dataset.live;
    const nextTf = tf || board.dataset.tf;
    const nextCat = cat || board.dataset.cat || 'all';

    // Открытая таблица должна остаться открытой: разметка заменяется целиком,
    // и <details> без этого схлопнулся бы на каждом переключении
    const oldDetails = board.querySelector('details.chart-table');
    const wasOpen = Boolean(oldDetails && oldDetails.open);

    board.classList.add('loading');
    try {
      const data = await loadFragment(board, nextTf, nextCat);

      // У тикера ответ приходит вместе с обёрткой — заменяем секцию целиком,
      // у сетки и инструмента меняем только внутренность
      let live = board;
      if (kind === 'ticker') {
        const fresh = document.createElement('div');
        fresh.innerHTML = data.html;
        const next = fresh.firstElementChild;
        if (!next) throw new Error('пустой ответ');
        board.replaceWith(next);
        live = next;
      } else {
        board.innerHTML = data.html;
      }

      const nextDetails = live.querySelector('details.chart-table');
      if (nextDetails && wasOpen) nextDetails.open = true;

      // Выбранный интервал запоминается на год: он один на весь сайт, и на
      // «Графиках», и на тикере, поэтому меняется там же, где нажали
      if (tf) document.cookie = `tf=${encodeURIComponent(nextTf)}; Path=/; Max-Age=31536000; SameSite=Lax`;

      live.dataset.tf = nextTf;
      if (kind === 'charts') live.dataset.cat = nextCat;
      // Опрос привязан к интервалу: у дневного его нет вовсе, у минутного
      // свой период — старый таймер остался бы с чужим шагом
      if (kind === 'charts') {
        const grid = live.querySelector('.ggrid');
        if (grid) startPolling(grid);
      }

      // Заголовок вкладки, h1 и описание в ответе есть только там, где они
      // зависят от выбранного — иначе трогать их незачем
      if (data.title) document.title = data.title;
      if (data.h1) {
        const h1 = document.getElementById('page-h1');
        if (h1) h1.textContent = data.h1;
      }
      // Описание у категорий разное: вкладка «Все» обещает все рынки, у
      // «Индексов» их пять. Оставлять старое — значит описывать не то, что
      // открыто, в том числе для «поделиться ссылкой»
      if (data.description) {
        const md = document.querySelector('meta[name="description"]');
        if (md) md.setAttribute('content', data.description);
      }

      // Адрес: при нажатии — из самой ссылки (в ней уже учтено, что вкладка
      // «Все» и интервал по умолчанию лишних параметров не несут), при
      // возврате «назад» — собранный из состояния, там нужны оба параметра
      const u = href ? new URL(href, location.origin) : new URL(link.href);
      u.hash = '';
      if (push) history.pushState({ tf: nextTf, cat: nextCat }, '', u);
      else history.replaceState({ tf: nextTf, cat: nextCat }, '', u);
    } catch (err) {
      // Не смогли тихо — пусть сработает ссылка: честная загрузка лучше
      // застывшего экрана
      location.href = href || (link ? link.href : location.href);
    } finally {
      board.classList.remove('loading');
    }
  };

  // Вкладка «Графиков» и кнопки интервала лежат в одном блоке: отличаем их
  // по атрибуту, который поставил сервер
  const boardFromClick = (e) => {
    const link = e.target.closest('a[data-tf], a[data-cat]');
    if (!link) return null;
    const board = link.closest('[data-live]');
    // Категории есть только у сетки — ссылки на каталог и меню не перехватываем
    if (!board || (link.dataset.cat && board.dataset.live !== 'charts')) return null;
    return { link, board };
  };

  // Начальная запись истории тоже должна знать, что показано: иначе «назад»
  // с первого переключения вернёт адрес без параметра, а на экране останется
  // прежний ряд — состояние и картинка разойдутся
  const firstBoard = document.querySelector('[data-live]');
  if (firstBoard) {
    history.replaceState({ tf: firstBoard.dataset.tf, cat: firstBoard.dataset.cat }, '', location.href);
    // Пришли по ссылке с интервалом — он же и запомнился. Нажатие перехвачено
    // выше, но ссылку могли открыть в новой вкладке или прислать её извне
    const asked = new URL(location.href).searchParams.get('tf');
    if (asked === firstBoard.dataset.tf) {
      document.cookie = `tf=${encodeURIComponent(asked)}; Path=/; Max-Age=31536000; SameSite=Lax`;
    }
  }

  document.addEventListener('click', (e) => {
    const hit = boardFromClick(e);
    if (!hit) return;
    const { link, board } = hit;
    // Средняя кнопка, Ctrl/Cmd и Shift — человек хочет новую вкладку или
    // загрузку: отдаём ссылке сделать своё дело
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;

    const tf = link.dataset.tf;
    const cat = link.dataset.cat;
    // Нажатие на текущую вкладку или текущий интервал — не переключение
    if (cat && cat === (board.dataset.cat || 'all')) return;
    if (tf && !cat && tf === board.dataset.tf) return;
    e.preventDefault();
    switchBoard(board, link, { tf, cat }, true);
  });

  // Кнопка «назад» после переключения должна возвращать прежний интервал
  // или прежнюю вкладку, а не прошлую страницу: адрес менялся через pushState
  window.addEventListener('popstate', (e) => {
    const st = e.state || {};
    const board = document.querySelector('[data-live]');
    if (!board) return;
    const cat = st.cat || 'all';
    const tf = st.tf || board.dataset.tf;
    if (tf === board.dataset.tf && cat === (board.dataset.cat || 'all')) return;
    // Адрес собираем сами: в разметке каждая ссылка несёт только свой
    // параметр, а после «назад» нужны оба сразу
    const u = new URL(location.href);
    // Категория есть только у сетки: на странице инструмента её в адресе быть
    // не должно, там категорию задаёт сам инструмент
    if (board.dataset.live !== 'charts') u.searchParams.delete('cat');
    else if (cat === 'all') u.searchParams.delete('cat');
    else u.searchParams.set('cat', cat);
    // Интервал в адресе остаётся всегда, даже если он совпадает с умолчанием:
    // голый адрес означает «взять запомненный», и после возврата «назад»
    // страница рассказывала бы не о том ряде, который на экране
    u.searchParams.set('tf', tf);
    switchBoard(board, null, { tf, cat, href: u.href }, false);
  });

  // ------------------------------ живые котировки
  // Сервер опрашивает биржи сам и держит цены в памяти; здесь только забираем
  // готовое и подставляем. Числа приходят уже отформатированными — правила
  // разные (у индекса два знака, у крипты восемь, у рубля знак ₽), и вторая их
  // копия в браузере разошлась бы с первой. Каждый элемент с data-rt-f говорит,
  // какое поле ему нужно: «i» — значение индекса, «p» — процент, «m» — цена
  // бумаги, «v:usd» — цена в единицах инструмента
  const rt = (() => {
    // Поле ищет свой ключ у ближайшего предка с data-rt. Не у «корня страницы»:
    // карточка «Графиков» перерисовывается через /api/charts, внешний <a>
    // вместе с ключом исчезает, и после первого же обновления поля остались бы
    // без адреса. Ключ на самом поле это переживает
    const fields = () => [...document.querySelectorAll('[data-rt-f]')];
    const keyOf = (el) => el.closest('[data-rt]')?.dataset.rt || null;

    // Направление — свойство величины, а не текста, поэтому класс ставим по
    // ответу сервера: «−1,04%» и «+0,00%» различаются знаком, а «0» не растёт
    const DIRS = ['up', 'down', 'flat'];
    const paint = (quotes) => {
      for (const el of fields()) {
        const key = keyOf(el);
        if (!key) continue;
        const q = quotes[key];
        if (!q) continue;
        const tok = el.dataset.rtF;
        if (q[tok] === undefined || q[tok] === null) continue;
        if (el.textContent !== q[tok]) el.textContent = q[tok];
        if (tok === 'p' || tok === 'd' || tok.startsWith('c:')) {
          el.classList.remove(...DIRS);
          el.classList.add(q.dir || 'flat');
        }
      }
    };

    let timer = null;
    let busy = false;
    let every = 5000;

    const tick = async () => {
      if (busy || document.hidden) return;
      const keys = new Set();
      const tokens = new Set();
      for (const el of fields()) {
        const key = keyOf(el);
        if (!key) continue;
        keys.add(key);
        tokens.add(el.dataset.rtF);
      }
      if (!keys.size || !tokens.size) return;
      busy = true;
      try {
        const r = await fetch(
          `/api/quotes?keys=${encodeURIComponent([...keys].join(','))}&f=${encodeURIComponent([...tokens].join(','))}&lang=${encodeURIComponent(LANG)}`,
          { headers: { Accept: 'application/json' } }
        );
        if (!r.ok) return;
        const data = await r.json();
        // Период задаёт сервер: он же знает, как часто обновляется источник, и
        // уменьшать интервал придётся в одном месте, а не в двух
        if (data.poll > 0 && data.poll !== every) {
          every = data.poll;
          restart();
        }
        paint(data.quotes || {});
      } catch {
        // Сеть отвалилась — на экране остаются последние цены, а не прочерки
      } finally {
        busy = false;
      }
    };

    const restart = () => {
      if (timer) clearInterval(timer);
      timer = setInterval(tick, every);
    };

    return {
      start(ms) {
        // Ноль означает «реалтайм выключен»: опрашивать нечего, и молчащий
        // таймер каждые пять секунд — это трафик без пользы
        if (!ms) return;
        every = ms;
        restart();
        tick();
        document.addEventListener('visibilitychange', () => {
          if (!document.hidden) tick();
        });
        window.addEventListener('pagehide', () => timer && clearInterval(timer));
      },
    };
  })();
  if (document.querySelector('[data-rt]')) rt.start(Number(document.body.dataset.quoteMs || 0));

  // Меню языка — <details>, и сам по себе он закрывается только повторным
  // кликом по коду. Клик мимо и Esc должны его отпускать: раскрытый список
  // поверх меню сайта читается как часть шапки и мешает
  const langDd = document.querySelector('.lang-dd');
  if (langDd) {
    document.addEventListener('click', (e) => {
      if (langDd.open && !langDd.contains(e.target)) langDd.open = false;
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && langDd.open) {
        langDd.open = false;
        langDd.querySelector('summary')?.focus();
      }
    });
  }

  // Кнопки отправки блокируем на время запроса, иначе двойной клик даёт два сообщения
  document.querySelectorAll('.forum-form').forEach((f) => {
    f.addEventListener('submit', () => {
      const b = f.querySelector('button[type="submit"]');
      if (b) {
        b.disabled = true;
        b.textContent = CT('Отправляем…');
      }
    });
  });
})();
