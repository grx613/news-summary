// Страницы индексов. Отдельный файл, потому что они ни к тикерам, ни к дивидендам
// не относятся: здесь только значение, динамика и состав. Как и везде на сайте,
// всё рендерится на сервере — поисковик не исполняет JS.

import { esc, page, SITE_NAME, niceName, tickerPath } from './render.js';
import { INDEXES } from './indices.js';

const plural = (n, one, few, many) => {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
};

// Значение индекса — обычно четыре значащие цифры с двумя после запятой.
// У VIX их две, у RGBI тоже, поэтому правило одно: до двух знаков, без хвостовых нулей
const val = (n) =>
  n === null || n === undefined || !Number.isFinite(Number(n))
    ? '—'
    : Number(n).toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

const signed = (n) =>
  n === null || n === undefined || !Number.isFinite(Number(n))
    ? '—'
    : (Number(n) > 0 ? '+' : '') + Number(n).toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

// «пункт» после дробного числа всегда в родительном единственном: 2 454,27 пункта,
// и только целое склоняется по обычному правилу — 2 456 пунктов
const points = (n) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return 'пунктов';
  return Number.isInteger(v) ? plural(v, 'пункт', 'пункта', 'пунктов') : 'пункта';
};

const pct = (n) =>
  n === null || n === undefined || !Number.isFinite(Number(n))
    ? '—'
    : (Number(n) > 0 ? '+' : '') + Number(n).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%';

// Капитализация в рублях: 6 112 062 771 332 читается плохо, «6,11 трлн ₽» — сразу
function bigMoney(n, cur = 'RUB') {
  if (n === null || n === undefined || !Number.isFinite(Number(n)) || Number(n) <= 0) return '—';
  const v = Number(n);
  const unit = cur === 'USD' ? '$' : '';
  const tail = cur === 'USD' ? '' : ' ₽';
  if (v >= 1e12) return `${unit}${(v / 1e12).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} трлн${tail}`;
  if (v >= 1e9) return `${unit}${(v / 1e9).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} млрд${tail}`;
  return `${unit}${v.toLocaleString('ru-RU', { maximumFractionDigits: 0 })}${tail}`;
}

// Мосбиржа даёт дату торгов и время обновления по Москве, CNBC — ISO со смещением.
// Обе приводим к одному виду: дата и время по Москве, чтобы на странице не было
// двух разных часовых поясов рядом
function stampMs(q) {
  if (!q) return null;
  if (q.tradeDate && q.updateTime) {
    const d = new Date(`${q.tradeDate}T${q.updateTime}+03:00`);
    return Number.isNaN(d.getTime()) ? null : d.getTime();
  }
  if (q.at) {
    const d = new Date(q.at);
    return Number.isNaN(d.getTime()) ? null : d.getTime();
  }
  return null;
}

const stampText = (q) => {
  const ms = stampMs(q);
  if (!ms) return '';
  return new Date(ms).toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Moscow',
  });
};

const dayText = (d) =>
  d ? new Date(`${d}T00:00:00Z`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : '—';
const shortDay = (d) =>
  d ? new Date(`${d}T00:00:00Z`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : '';

// График рисуем сами: клиентский JS поисковик не увидит, а картинка из чужого
// сервиса — лишняя зависимость. Ломаная по точкам истории, заливка под ней
function sparkline(points, { width = 720, height = 190 } = {}) {
  const clean = points.filter((p) => Number.isFinite(Number(p.c)));
  if (clean.length < 2) return '';
  const vals = clean.map((p) => Number(p.c));
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  const pad = 12;
  const x = (i) => (i / (vals.length - 1)) * width;
  const y = (v) => height - pad - ((v - min) / span) * (height - pad * 2);

  const line = vals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const area = `${x(0).toFixed(1)},${height} ${line} ${x(vals.length - 1).toFixed(1)},${height}`;
  const up = vals[vals.length - 1] >= vals[0];
  const stroke = up ? 'var(--green)' : 'var(--red)';
  const fill = up ? 'rgba(63,185,80,.12)' : 'rgba(248,81,73,.12)';

  return `
    <div class="idx-chart">
      <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="График индекса за период с ${esc(clean[0].d)} по ${esc(clean[clean.length - 1].d)}">
        <polygon points="${area}" fill="${fill}" />
        <polyline points="${line}" fill="none" stroke="${stroke}" stroke-width="2" vector-effect="non-scaling-stroke" />
      </svg>
      <div class="idx-chart-axis">
        <span>${esc(shortDay(clean[0].d))} — ${esc(val(vals[0]))}</span>
        <span>${esc(shortDay(clean[clean.length - 1].d))} — ${esc(val(vals[vals.length - 1]))}</span>
      </div>
    </div>`;
}

// CNBC не присылает изменение за год, но история у него за два — считаем сами.
// Берём точку, ближайшую к году до последней даты в ряду. У Мосбиржи значение
// приходит готовым, и его не пересчитываем: биржа знает свой состав точнее
export function yearChangePct(q, closes = []) {
  const given = q?.yearChangePct;
  if (given !== null && given !== undefined && Number.isFinite(Number(given))) return Number(given);
  if (!closes || closes.length < 2) return null;
  const lastPoint = closes[closes.length - 1];
  const endMs = new Date(`${lastPoint.d}T00:00:00Z`).getTime();
  if (Number.isNaN(endMs)) return null;
  const target = endMs - 365 * 86400_000;
  let best = null;
  for (const p of closes) {
    const ms = new Date(`${p.d}T00:00:00Z`).getTime();
    if (Number.isNaN(ms)) continue;
    if (!best || Math.abs(ms - target) < Math.abs(best.ms - target)) best = { ms, c: Number(p.c) };
  }
  // Год назад нужен именно год: если ряд короче, честнее прочерк, чем цифра за полгода
  if (!best || Math.abs(best.ms - target) > 45 * 86400_000 || !Number.isFinite(best.c) || best.c === 0) return null;
  const last = Number(lastPoint.c);
  return ((last - best.c) / best.c) * 100;
}

// ------------------------------------------------------------------ одна страница
export function indexPage({ idx, quote, history = [], composition = [], knownSymbols = new Set(), siteUrl, siteName }) {
  const q = quote || {};
  const stamp = stampText(q);
  const hasValue = q.value !== null && q.value !== undefined;
  const title = hasValue
    ? `${idx.h1} сегодня — ${val(q.value)} ${points(q.value)}, ${pct(q.changePct)} за день`
    : `${idx.h1} — значение и динамика`;

  const description = hasValue
    ? `${idx.title}: ${val(q.value)} ${points(q.value)}${stamp ? ` на ${stamp}` : ''}, ${pct(q.changePct)} за день. ${
        idx.market === 'RU' ? 'Динамика за год и состав с весами бумаг.' : 'Годовой диапазон и история значений.'
      }`
    : `${idx.title}: значение, изменение за день, годовой диапазон и история.`;

  // Итог за период считаем по своей же истории: у Мосбиржи в потоке приходит
  // изменение за месяц и год, у CNBC — нет, а сравнение должно быть одинаковым
  const closes = history.filter((p) => Number.isFinite(Number(p.c)));
  const first = closes.length ? Number(closes[0].c) : null;
  const last = closes.length ? Number(closes[closes.length - 1].c) : null;
  const periodPct = first && last ? ((last - first) / first) * 100 : null;

  const yearPct = yearChangePct(q, closes);

  const facts = [
    ['Значение', hasValue ? `${val(q.value)} п.` : '—'],
    ['Изменение за день', hasValue ? `${signed(q.change)} п. (${pct(q.changePct)})` : '—'],
    q.high !== null && q.high !== undefined ? ['Максимум дня', `${val(q.high)} п.`] : null,
    q.low !== null && q.low !== undefined ? ['Минимум дня', `${val(q.low)} п.`] : null,
    q.yearHigh ? ['Годовой максимум', `${val(q.yearHigh)} п.`] : null,
    q.yearLow ? ['Годовой минимум', `${val(q.yearLow)} п.`] : null,
    yearPct !== null ? ['Изменение за год', pct(yearPct)] : null,
    idx.market === 'RU' && q.capitalization ? ['Капитализация', bigMoney(q.capitalization)] : null,
    // Период подписываем числом дней: без него «за торговых дней» читается как обрыв
    periodPct !== null
      ? [`За ${closes.length} ${plural(closes.length, 'торговый день', 'торговых дня', 'торговых дней')}`, pct(periodPct)]
      : null,
  ]
    .filter(Boolean)
    .map(([k, v]) => `<div><span>${esc(k)}</span><b>${esc(v)}</b></div>`)
    .join('');

  // История: последние 30 значений — столько видно на графике и хватает, чтобы
  // понять направление. Полные ряды незачем вываливать в HTML
  const tail = closes.slice(-30);
  const histRows = tail
    .map((p, i) => {
      const prev = i > 0 ? Number(tail[i - 1].c) : null;
      const chg = prev ? ((Number(p.c) - prev) / prev) * 100 : null;
      return `<tr>
        <td>${esc(dayText(p.d))}</td>
        <td class="num">${esc(val(p.c))}</td>
        <td class="num ${chg === null ? '' : chg >= 0 ? 'up' : 'down'}">${chg === null ? '—' : esc(pct(chg))}</td>
      </tr>`;
    })
    .reverse()
    .join('');

  // Состав: веса официальные, ссылки — только на те бумаги, что есть в каталоге,
  // чтобы страница не вела в пустоту
  const compRows = composition
    .map((c) => {
      const nm = niceName(c.name || c.symbol);
      const label = knownSymbols.has(c.symbol)
        ? `<a href="${esc(tickerPath({ market: 'RU', symbol: c.symbol }))}">${esc(nm)}</a> <span class="sym">${esc(c.symbol)}</span>`
        : `${esc(nm)} <span class="sym">${esc(c.symbol)}</span>`;
      return `<tr>
        <td>${label}</td>
        <td class="num">${esc(Number(c.weight).toLocaleString('ru-RU', { maximumFractionDigits: 2 }))}%</td>
      </tr>`;
    })
    .join('');

  const others = INDEXES.filter((i) => i.slug !== idx.slug);

  const body = `
    <div class="logo"><a href="/">${esc(siteName || SITE_NAME)}</a></div>
    <h1>${esc(idx.h1)}</h1>
    <nav class="nav"><a href="/">← Поиск</a><a href="/indices">Все индексы</a><a href="/catalog">Каталог тикеров</a><a href="/dividends">Дивиденды</a></nav>

    <section class="card">
      <div class="idx-value">
        <div class="idx-num">${esc(hasValue ? val(q.value) : '—')}<span>п.</span></div>
        <div class="idx-delta ${q.changePct === null || q.changePct === undefined ? '' : Number(q.changePct) >= 0 ? 'up' : 'down'}">
          ${esc(signed(q.change))} (${esc(pct(q.changePct))})
        </div>
      </div>
      <div class="meta">${
        stamp
          ? `<span class="pill hit">данные на ${esc(stamp)} МСК</span>`
          : '<span class="pill miss">значение ещё не получено</span>'
      }<span class="dot">·</span><span>${esc(idx.market === 'RU' ? 'Мосбиржа (ISS)' : 'CNBC')}</span></div>
      ${facts ? `<div class="kv div-facts">${facts}</div>` : ''}
      ${sparkline(closes)}
    </section>

    <section class="card">
      <h2>Что это за индекс</h2>
      <p>${esc(idx.what)}</p>
      <p style="color:var(--muted);font-size:13.5px;margin:0">Страница показывает ${esc(idx.lead)}. Данные обновляются автоматически, значения в пунктах — не рубли: пункты сравнимы между днями, но не между индексами.</p>
    </section>

    ${
      histRows
        ? `<section class="card">
      <h2>История значений</h2>
      <table class="div-table idx-table">
        <thead><tr><th>Дата</th><th class="num">Закрытие</th><th class="num">Изм.</th></tr></thead>
        <tbody>${histRows}</tbody>
      </table>
      <p class="div-src">Закрытие торгового дня. Изменение — к предыдущей строке.</p>
    </section>`
        : ''
    }

    ${
      compRows
        ? `<section class="card">
      <h2>Состав индекса <span class="cnt">${composition.length}</span></h2>
      <table class="div-table idx-table">
        <thead><tr><th>Бумага</th><th class="num">Вес</th></tr></thead>
        <tbody>${compRows}</tbody>
      </table>
      <p class="div-src">Веса — официальные данные Мосбиржи. Бумаги, у которых есть страница на сайте, стали ссылками.</p>
    </section>`
        : ''
    }

    <div class="cat"><h2>Другие индексы</h2><div class="grid">${others
      .map((i) => `<a class="tl" href="/index/${esc(i.slug)}"><span class="s">${esc(i.short)}</span><span class="n">${esc(i.title)}</span></a>`)
      .join('')}</div></div>`;

  const jsonLd = [
    {
      '@context': 'https://schema.org',
      '@type': 'WebPage',
      name: idx.h1,
      description,
      url: `${siteUrl}/index/${idx.slug}`,
      inLanguage: 'ru',
      ...(hasValue ? { dateModified: stampMs(q) ? new Date(stampMs(q)).toISOString() : undefined } : {}),
      about: { '@type': 'Thing', name: idx.title, alternateName: idx.code },
      isPartOf: { '@type': 'WebSite', name: siteName || SITE_NAME, url: siteUrl },
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Главная', item: siteUrl + '/' },
        { '@type': 'ListItem', position: 2, name: 'Индексы', item: siteUrl + '/indices' },
        { '@type': 'ListItem', position: 3, name: idx.title, item: `${siteUrl}/index/${idx.slug}` },
      ],
    },
  ];

  return page({ siteUrl, title, description, canonical: `/index/${idx.slug}`, body, jsonLd });
}

// ------------------------------------------------------------------ блок на главной
// Компактная строка индексов: главная — самая сильная страница сайта, и ссылки
// с неё дают страницам индексов вес. Полные таблицы там не нужны, только
// значение и изменение за день.
export function homeIndices({ quotes = {}, siteUrl }) {
  const have = INDEXES.filter((i) => quotes[i.code]?.value !== null && quotes[i.code]?.value !== undefined);
  if (!have.length) return '';
  const cell = (i) => {
    const q = quotes[i.code];
    const dir = q.changePct === null || q.changePct === undefined ? '' : Number(q.changePct) >= 0 ? 'up' : 'down';
    return `<a class="idx-cell" href="/index/${esc(i.slug)}">
      <span class="idx-cell-name">${esc(i.short || i.title)}</span>
      <span class="idx-cell-val">${esc(val(q.value))}</span>
      <span class="idx-cell-chg ${dir}">${esc(pct(q.changePct))}</span>
    </a>`;
  };
  return `
      <section class="card idx-home">
        <h2 style="margin-top:0">Биржевые индексы сегодня <span class="cnt">${have.length}</span></h2>
        <div class="idx-strip">${have.map(cell).join('')}</div>
        <p class="div-src">Значения обновляются в течение торгового дня. <a href="/indices">Подробно по каждому индексу →</a></p>
      </section>`;
}

// ------------------------------------------------------------------ список индексов
export function indicesPage({ quotes = {}, history = {}, siteUrl, siteName }) {
  const ru = INDEXES.filter((i) => i.market === 'RU');
  const us = INDEXES.filter((i) => i.market === 'US');

  const row = (i) => {
    const q = quotes[i.code] || {};
    const has = q.value !== null && q.value !== undefined;
    const dir = q.changePct === null || q.changePct === undefined ? '' : Number(q.changePct) >= 0 ? 'up' : 'down';
    const y = yearChangePct(q, history[i.code] || []);
    return `<tr>
      <td><a href="/index/${esc(i.slug)}">${esc(i.title)}</a>${i.title.includes(i.code) ? '' : ` <span class="sym">${esc(i.code)}</span>`}</td>
      <td class="num">${esc(has ? val(q.value) : '—')}</td>
      <td class="num ${dir}">${esc(pct(q.changePct))}</td>
      <td class="num ${y === null ? '' : y >= 0 ? 'up' : 'down'}">${esc(pct(y))}</td>
    </tr>`;
  };

  const table = (items, caption) => `
    <section class="card">
      <h2>${esc(caption)}</h2>
      <table class="div-table idx-table">
        <thead><tr><th>Индекс</th><th class="num">Значение</th><th class="num">За день</th><th class="num">За год</th></tr></thead>
        <tbody>${items.map(row).join('')}</tbody>
      </table>
    </section>`;

  const title = 'Индексы: Мосбиржа, S&P 500, NASDAQ, Dow Jones и VIX';
  const description = `Значение биржевых индексов сегодня: индекс Мосбиржи и РТС, S&P 500, NASDAQ Composite, промышленный индекс Доу Джонса и индекс волатильности VIX. Изменение за день и год, история и состав.`;

  const body = `
    <div class="logo"><a href="/">${esc(siteName || SITE_NAME)}</a></div>
    <h1>Биржевые индексы: значение сегодня</h1>
    <nav class="nav"><a href="/">Поиск</a><a href="/catalog">Каталог тикеров</a><a href="/indices">Индексы</a><a href="/dividends">Дивиденды</a></nav>
    <p class="lead" style="color:var(--muted);font-size:14px">Российские индексы считает Мосбиржа, американские — биржи США; данные приходят с задержкой в несколько минут. У каждого индекса отдельная страница с историей значений${' '}и составом.</p>
    ${table(ru, 'Индексы Мосбиржи')}
    ${table(us, 'Индексы США')}
    <section class="card">
      <h2>Как читать индексы</h2>
      <p style="margin-top:0">Индекс — это средняя цена группы бумаг, приведённая к условным пунктам. Сам по себе уровень ничего не говорит: важны изменение за день и за год, а также то, что индекс не равен средней акции. В индексе Мосбиржи и S&P 500 вес бумаги зависит от её капитализации, поэтому несколько крупнейших компаний двигают индекс сильнее остальных; в промышленном индексе Доу Джонса вес зависит от цены акции, а не от размера компании.</p>
      <p style="margin-bottom:0">Индекс волатильности VIX стоит отдельно: он считается по ценам опционов на S&P 500 и показывает, насколько сильных колебаний ждёт рынок в ближайший месяц, а не направление движения.</p>
    </section>`;

  const jsonLd = [
    {
      '@context': 'https://schema.org',
      '@type': 'CollectionPage',
      name: title,
      description,
      url: `${siteUrl}/indices`,
      inLanguage: 'ru',
      mainEntity: {
        '@type': 'ItemList',
        numberOfItems: INDEXES.length,
        itemListElement: INDEXES.map((i, n) => ({
          '@type': 'ListItem',
          position: n + 1,
          name: i.h1,
          url: `${siteUrl}/index/${i.slug}`,
        })),
      },
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Главная', item: siteUrl + '/' },
        { '@type': 'ListItem', position: 2, name: 'Индексы', item: `${siteUrl}/indices` },
      ],
    },
  ];

  return page({ siteUrl, title, description, canonical: '/indices', body, jsonLd });
}
