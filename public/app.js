// Клиентская часть. Страницы приходят с сервера готовым HTML — здесь только
// поиск с подсказками, переход на страницу тикера и кнопка «Обновить».
(function () {
  const esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const SLUG = { RU: 'ru', US: 'us', CRYPTO: 'crypto' };
  const tickerUrl = (type, symbol) => `/ticker/${SLUG[type] || 'us'}/${encodeURIComponent(symbol)}`;

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
        $dd.innerHTML = '<div class="hint">Ничего не найдено. Попробуйте тикер: GAZP, AAPL, BTC.</div>';
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
        btn.textContent = '↻ ' + (btn.dataset.generate ? 'Собрать' : 'Обновить');
        btn.title = '';
        return;
      }
      btn.disabled = true;
      const mm = Math.floor(left / 60000);
      const ss = Math.floor((left % 60000) / 1000);
      btn.textContent = `↻ через ${mm}:${String(ss).padStart(2, '0')}`;
      btn.title = 'Данные обновляли недавно — повторное обновление недоступно';
    };

    paint();
    if (until > Date.now()) timer = setInterval(paint, 1000);

    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.textContent = '↻ обновляем…';
      if (flash) flash.innerHTML = '<div class="notice">Собираем публикации и готовим сводку — 10–30 секунд.</div>';
      try {
        const p = new URLSearchParams({ symbol, market, refresh: '1' });
        const res = await fetch('/api/summary?' + p);
        const data = await res.json().catch(() => ({}));
        // 429 с готовыми данными — кулдаун: страница всё равно актуальна, просто ждём
        if (!res.ok && !data.summary && !data.asset) throw new Error(data.error || `HTTP ${res.status}`);
        if (res.ok) return location.reload();
        if (flash) flash.innerHTML = `<div class="notice">${esc(data.error || 'Обновление недоступно')}</div>`;
        until = data.nextRefreshAt ? new Date(data.nextRefreshAt).getTime() : until;
        paint();
      } catch (e) {
        if (flash) flash.innerHTML = `<div class="err">⚠️ ${esc(e.message)}</div>`;
        btn.disabled = false;
        btn.textContent = '↻ Обновить';
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
        $btn.textContent = 'Готовим ответ…';
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
        btn.textContent = 'Скопировано';
      } catch {
        const r = document.createRange();
        r.selectNodeContents(el);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(r);
        btn.textContent = 'Выделено — скопируйте вручную';
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
  const grid = document.querySelector('.ggrid[data-poll]');
  if (grid) {
    const cat = grid.dataset.cat || 'all';
    const tf = grid.dataset.tf || '1d';
    const every = Number(grid.dataset.poll) || 0;
    let timer = null;
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
      if (busy || document.hidden) return;
      busy = true;
      try {
        const r = await fetch(`/api/charts?cat=${encodeURIComponent(cat)}&tf=${encodeURIComponent(tf)}`, {
          headers: { Accept: 'application/json' },
        });
        if (r.ok) paint((await r.json()).cards);
      } catch {
        // Сеть отвалилась — на экране остаётся последний удачный кадр
      } finally {
        busy = false;
      }
    };

    if (every > 0) {
      timer = setInterval(tick, every);
      // Возврат на вкладку — хороший момент обновить сразу, а не ждать период
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) tick();
      });
      window.addEventListener('pagehide', () => clearInterval(timer));
    }
  }

  // Кнопки отправки блокируем на время запроса, иначе двойной клик даёт два сообщения
  document.querySelectorAll('.forum-form').forEach((f) => {
    f.addEventListener('submit', () => {
      const b = f.querySelector('button[type="submit"]');
      if (b) {
        b.disabled = true;
        b.textContent = 'Отправляем…';
      }
    });
  });
})();
