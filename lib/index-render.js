// Страницы индексов. Отдельный файл, потому что они ни к тикерам, ни к дивидендам
// не относятся: здесь только значение, динамика и состав. Как и везде на сайте,
// всё рендерится на сервере — поисковик не исполняет JS.

import { esc, page, SITE_NAME, niceName, tickerPath } from './render.js';
import { t, L, getLang, intlLocale, plural } from './i18n.js';
import { INDEXES } from './indices.js';
// График индекса рисуется тем же свечным рендером, что и у тикеров: две
// отрисовки одного и того же разъехались бы по цвету, шагу и подписям
// Связь индекса со страницей инструмента — через indexSlug: слаги у них разные
import { INSTRUMENTS } from './markets.js';

// Значение индекса — обычно четыре значащие цифры с двумя после запятой.
// У VIX их две, у RGBI тоже, поэтому правило одно: до двух знаков, без хвостовых нулей
export const val = (n) =>
  n === null || n === undefined || !Number.isFinite(Number(n))
    ? '—'
    : Number(n).toLocaleString(intlLocale(), { minimumFractionDigits: 0, maximumFractionDigits: 2 });

export const signed = (n) =>
  n === null || n === undefined || !Number.isFinite(Number(n))
    ? '—'
    : (Number(n) > 0 ? '+' : Number(n) < 0 ? '−' : '') +
      Math.abs(Number(n)).toLocaleString(intlLocale(), { minimumFractionDigits: 0, maximumFractionDigits: 2 });

// «пункт» после дробного числа всегда в родительном единственном: 2 454,27 пункта,
// и только целое склоняется по обычному правилу — 2 456 пунктов
const points = (n) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return t('пунктов');
  return Number.isInteger(v) ? plural(v, t('пункт'), t('пункта'), t('пунктов')) : t('пункта');
};

// Знак ставится явно, а не берётся у toLocaleString: тот печатает минус
// дефисом, а рядом на сайте стоит «−» из типографского набора. Одна и та же
// величина выглядела бы набранной двумя разными знаками
export const pct = (n) =>
  n === null || n === undefined || !Number.isFinite(Number(n))
    ? '—'
    : (Number(n) > 0 ? '+' : Number(n) < 0 ? '−' : '') +
      Math.abs(Number(n)).toLocaleString(intlLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 }) +
      '%';

// Капитализация в рублях: 6 112 062 771 332 читается плохо, «6,11 трлн ₽» — сразу
function bigMoney(n, cur = 'RUB') {
  if (n === null || n === undefined || !Number.isFinite(Number(n)) || Number(n) <= 0) return '—';
  const v = Number(n);
  const unit = cur === 'USD' ? '$' : '';
  const tail = cur === 'USD' ? '' : ' ₽';
  if (v >= 1e12) return `${unit}${(v / 1e12).toLocaleString(intlLocale(), { maximumFractionDigits: 2 })} ${t('трлн')}${tail}`;
  if (v >= 1e9) return `${unit}${(v / 1e9).toLocaleString(intlLocale(), { maximumFractionDigits: 1 })} ${t('млрд')}${tail}`;
  return `${unit}${v.toLocaleString(intlLocale(), { maximumFractionDigits: 0 })}${tail}`;
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
  return new Date(ms).toLocaleString(intlLocale(), {
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Moscow',
  });
};

const dayText = (d) =>
  d ? new Date(`${d}T00:00:00Z`).toLocaleDateString(intlLocale(), { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : '—';
const shortDay = (d) =>
  d ? new Date(`${d}T00:00:00Z`).toLocaleDateString(intlLocale(), { day: 'numeric', month: 'short', timeZone: 'UTC' }) : '';

// Сегодняшний бар дописывается к истории из текущей котировки.
//
// Ни один из двух источников не отдаёт текущий день в историческом ряду: CNBC
// закрывает ряд вчерашним баром, хотя в ответе стоит сегодняшний endTime, а
// Мосбиржа показывает завершённые торговые дни. Из-за этого график и шапка
// расходились: заголовок обещал 53 300, а последняя свеча стояла на 51 786 —
// закрытии предыдущего дня. На финвизе в это же время последняя свеча живая.
//
// Берём open/high/low из котировки, закрытием — текущее значение. Если день
// ещё не начался или источник не дал открытие, свечу не рисуем: вырожденная
// черта на графике врёт сильнее, чем отсутствие сегодняшнего дня
function withToday(history, quote) {
  const q = quote || {};
  // Приводим «пусто» к NaN сразу: Number(null) — это 0, и без этой проверки
  // отсутствующее открытие становилось нулём, то есть свечой, падающей с нуля
  const num = (v) => (v === null || v === undefined || v === '' ? NaN : Number(v));
  const value = num(q.value);
  if (!Number.isFinite(value)) return history;
  const day = q.tradeDate || (q.at ? String(q.at).slice(0, 10) : null);
  if (!day) return history;
  // Уже есть бар за этот день — второй не нужен. Бывает, источник успел
  // записать закрытие после конца торгов: тогда он точнее нашей котировки
  if (history.some((p) => p.d === day)) return history;
  const last = history[history.length - 1];
  const prev = num(q.prevClose) || (history.length ? num(last.c) : NaN);
  const o = num(q.open);
  const open = Number.isFinite(o) ? o : prev;
  if (!Number.isFinite(open)) return history;
  const hi = num(q.high);
  const lo = num(q.low);
  return [
    ...history,
    {
      d: day,
      o: open,
      h: Number.isFinite(hi) ? Math.max(hi, open, value) : Math.max(open, value),
      l: Number.isFinite(lo) ? Math.min(lo, open, value) : Math.min(open, value),
      c: value,
    },
  ];
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

// ------------------------------------------------------------------ разделы страницы
// Значение, состав и история индекса жили на отдельной странице /index/<слаг>,
// а свечи — на /charts/<слаг>. Два адреса про один и тот же индекс и два
// самостоятельных canonical — это дубль: поисковик выбирал между ними сам, а
// читатель попадал то на график без состава, то на состав без графика. Теперь
// страница одна (/charts/<слаг>), а её своя начинка собирается здесь и
// подставляется в instrumentPage.
//
// Заголовок и описание тоже оттуда: «Индекс Мосбиржи сегодня — 2 456,12 пункта,
// +0,41% за день» — это то, как индекс ищут, и такую строку из одного имени
// инструмента не собрать
export function indexSeo({ idx, quote }) {
  const q = quote || {};
  const hasValue = q.value !== null && q.value !== undefined;
  const stamp = stampText(q);
  const title = hasValue
    ? t('{h1} сегодня — {value} {points}, {pct} за день', { h1: t(idx.h1), value: val(q.value), points: points(q.value), pct: pct(q.changePct) })
    : t('{h1} — значение и динамика', { h1: t(idx.h1) });
  const description = hasValue
    ? t('{title}: {value} {points}{at}, {pct} за день. {tail}', {
        title: t(idx.title),
        value: val(q.value),
        points: points(q.value),
        at: stamp ? t(' на {stamp}', { stamp }) : '',
        pct: pct(q.changePct),
        tail: t(idx.market === 'RU' ? 'Динамика за год и состав с весами бумаг.' : 'Годовой диапазон и история значений.'),
      })
    : t('{title}: значение, изменение за день, годовой диапазон и история.', { title: t(idx.title) });
  return { title, description };
}

export function indexSections({ idx, quote, history = [], composition = [], knownSymbols = new Set() }) {
  const q = quote || {};
  const stamp = stampText(q);
  const hasValue = q.value !== null && q.value !== undefined;

  // Итог за период считаем по своей же истории: у Мосбиржи в потоке приходит
  // изменение за месяц и год, у CNBC — нет, а сравнение должно быть одинаковым.
  // Ряд — вместе с сегодняшним баром: иначе «за период» расходилось бы с ценой
  // на той же странице
  const series = withToday(history, q);
  const closes = series.filter((p) => Number.isFinite(Number(p.c)));
  const first = closes.length ? Number(closes[0].c) : null;
  const last = closes.length ? Number(closes[closes.length - 1].c) : null;
  const periodPct = first && last ? ((last - first) / first) * 100 : null;

  const yearPct = yearChangePct(q, closes);

  const pt = t('п.');
  const facts = [
    ['Значение', hasValue ? `${val(q.value)} ${pt}` : '—'],
    ['Изменение за день', hasValue ? `${signed(q.change)} ${pt} (${pct(q.changePct)})` : '—'],
    q.high !== null && q.high !== undefined ? ['Максимум дня', `${val(q.high)} ${pt}`] : null,
    q.low !== null && q.low !== undefined ? ['Минимум дня', `${val(q.low)} ${pt}`] : null,
    q.yearHigh ? ['Годовой максимум', `${val(q.yearHigh)} ${pt}`] : null,
    q.yearLow ? ['Годовой минимум', `${val(q.yearLow)} ${pt}`] : null,
    yearPct !== null ? ['Изменение за год', pct(yearPct)] : null,
    idx.market === 'RU' && q.capitalization ? ['Капитализация', bigMoney(q.capitalization)] : null,
    // Период подписываем числом дней: без него «за торговых дней» читается как обрыв
    periodPct !== null
      ? [t('За {n} {days}', { n: closes.length, days: plural(closes.length, t('торговый день'), t('торговых дня'), t('торговых дней')) }), pct(periodPct)]
      : null,
  ]
    .filter(Boolean)
    .map(([k, v]) => `<div><span>${esc(t(k))}</span><b>${esc(v)}</b></div>`)
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
        ? `<a href="${esc(L(tickerPath({ market: 'RU', symbol: c.symbol })))}">${esc(nm)}</a> <span class="sym">${esc(c.symbol)}</span>`
        : `${esc(nm)} <span class="sym">${esc(c.symbol)}</span>`;
      return `<tr>
        <td>${label}</td>
        <td class="num">${esc(Number(c.weight).toLocaleString(intlLocale(), { maximumFractionDigits: 2 }))}%</td>
      </tr>`;
    })
    .join('');

  return `
    <section class="card" id="value">
      <h2>${esc(t('Значение и динамика'))}</h2>
      ${facts ? `<div class="kv div-facts">${facts}</div>` : ''}
      <div class="meta">${
        stamp
          ? `<span class="pill hit">${esc(t('данные на {when} МСК', { when: stamp }))}</span>`
          : `<span class="pill miss">${esc(t('значение ещё не получено'))}</span>`
      }<span class="dot">·</span><span>${esc(t(idx.market === 'RU' ? 'Мосбиржа (ISS)' : 'CNBC'))}</span></div>
      <p style="color:var(--muted);font-size:13.5px;margin:14px 0 0">${esc(t('Страница показывает {lead}. Значения в пунктах — не рубли: пункты сравнимы между днями, но не между индексами.', { lead: t(idx.lead) }))}</p>
    </section>

    <section class="card">
      <h2>${esc(t('Что это за индекс'))}</h2>
      <p style="margin-top:0">${esc(t(idx.what))}</p>
      <p class="div-src" style="margin-bottom:0">${esc(t(idx.market === 'RU' ? 'Индекс считает Мосбиржа.' : 'Индекс считает биржа США; значения приходят с задержкой в несколько минут.'))} <a href="${esc(L('/indices'))}">${esc(t('Все индексы: значения за день и за год →'))}</a></p>
    </section>

    ${
      histRows
        ? `<section class="card">
      <h2>${esc(t('История значений'))}</h2>
      <table class="div-table idx-table">
        <thead><tr><th>${esc(t('Дата'))}</th><th class="num">${esc(t('Закрытие'))}</th><th class="num">${esc(t('Изм.'))}</th></tr></thead>
        <tbody>${histRows}</tbody>
      </table>
      <p class="div-src">${esc(t('Закрытие торгового дня. Изменение — к предыдущей строке.'))}</p>
    </section>`
        : ''
    }

    ${
      compRows
        ? `<section class="card">
      <h2>${esc(t('Состав индекса'))} <span class="cnt">${composition.length}</span></h2>
      <table class="div-table idx-table">
        <thead><tr><th>${esc(t('Бумага'))}</th><th class="num">${esc(t('Вес'))}</th></tr></thead>
        <tbody>${compRows}</tbody>
      </table>
      <p class="div-src">${esc(t('Веса — официальные данные Мосбиржи. Бумаги, у которых есть страница на сайте, стали ссылками.'))}</p>
    </section>`
        : ''
    }`;
}

// Адрес страницы индекса: у индекса и у инструмента «Графиков» разные слаги
// (rgbia и rgbi, dowjones и dow-jones), и связь между ними — indexSlug
export const instrumentSlugOfIndex = (idx) => INSTRUMENTS.find((i) => i.indexSlug === idx.slug)?.slug || null;

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
    return `<a class="idx-cell" href="${esc(L(`/charts/${instrumentSlugOfIndex(i) || i.slug}`))}" data-rt="IDX:${esc(i.code)}">
      <span class="idx-cell-name">${esc(t(i.short || i.title))}</span>
      <span class="idx-cell-val" data-rt-f="i">${esc(val(q.value))}</span>
      <span class="idx-cell-chg ${dir}" data-rt-f="p">${esc(pct(q.changePct))}</span>
    </a>`;
  };
  return `
      <section class="card idx-home">
        <h2 style="margin-top:0">${esc(t('Биржевые индексы сегодня'))} <span class="cnt">${have.length}</span></h2>
        <div class="idx-strip">${have.map(cell).join('')}</div>
        <p class="div-src">${esc(t('Значения обновляются в течение торгового дня.'))} <a href="${L('/indices')}">${esc(t('Подробно по каждому индексу →'))}</a></p>
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
    // Год считаем от того же ряда, что и график на странице индекса: без
    // сегодняшнего бара динамика за год расходилась бы с ценой на той же строке
    const y = yearChangePct(q, withToday(history[i.code] || [], q));
    return `<tr data-rt="IDX:${esc(i.code)}">
      <td><a href="${esc(L(`/charts/${instrumentSlugOfIndex(i) || i.slug}`))}">${esc(t(i.title))}</a>${i.title.includes(i.code) ? '' : ` <span class="sym">${esc(i.code)}</span>`}</td>
      <td class="num" data-rt-f="i">${esc(has ? val(q.value) : '—')}</td>
      <td class="num ${dir}" data-rt-f="p">${esc(pct(q.changePct))}</td>
      <td class="num ${y === null ? '' : y >= 0 ? 'up' : 'down'}">${esc(pct(y))}</td>
    </tr>`;
  };

  const table = (items, caption) => `
    <section class="card">
      <h2>${esc(caption)}</h2>
      <table class="div-table idx-table">
        <thead><tr><th>${esc(t('Индекс'))}</th><th class="num">${esc(t('Значение'))}</th><th class="num">${esc(t('За день'))}</th><th class="num">${esc(t('За год'))}</th></tr></thead>
        <tbody>${items.map(row).join('')}</tbody>
      </table>
    </section>`;

  const title = t('Индексы: Мосбиржа, S&P 500, NASDAQ, Dow Jones и VIX');
  const description = t('Значение биржевых индексов сегодня: индекс Мосбиржи и РТС, S&P 500, NASDAQ Composite, промышленный индекс Доу Джонса и индекс волатильности VIX. Изменение за день и год, история и состав.');

  const body = `
    <h1>${esc(t('Биржевые индексы: значение сегодня'))}</h1>
    <p class="lead" style="color:var(--muted);font-size:14px">${esc(t('Российские индексы считает Мосбиржа, американские — биржи США; данные приходят с задержкой в несколько минут. У каждого индекса отдельная страница с историей значений и составом.'))}</p>
    ${table(ru, t('Индексы Мосбиржи'))}
    ${table(us, t('Индексы США'))}
    <section class="card">
      <h2>${esc(t('Как читать индексы'))}</h2>
      <p style="margin-top:0">${esc(t('Индекс — это средняя цена группы бумаг, приведённая к условным пунктам. Сам по себе уровень ничего не говорит: важны изменение за день и за год, а также то, что индекс не равен средней акции. В индексе Мосбиржи и S&P 500 вес бумаги зависит от её капитализации, поэтому несколько крупнейших компаний двигают индекс сильнее остальных; в промышленном индексе Доу Джонса вес зависит от цены акции, а не от размера компании.'))}</p>
      <p style="margin-bottom:0">${esc(t('Индекс волатильности VIX стоит отдельно: он считается по ценам опционов на S&P 500 и показывает, насколько сильных колебаний ждёт рынок в ближайший месяц, а не направление движения.'))}</p>
    </section>`;

  const jsonLd = [
    {
      '@context': 'https://schema.org',
      '@type': 'CollectionPage',
      name: title,
      description,
      url: `${siteUrl}${L('/indices')}`,
      inLanguage: getLang(),
      mainEntity: {
        '@type': 'ItemList',
        numberOfItems: INDEXES.length,
        itemListElement: INDEXES.map((i, n) => ({
          '@type': 'ListItem',
          position: n + 1,
          name: t(i.h1),
          url: `${siteUrl}${L(`/charts/${instrumentSlugOfIndex(i) || i.slug}`)}`,
        })),
      },
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: t('Главная'), item: siteUrl + L('/') },
        { '@type': 'ListItem', position: 2, name: t('Индексы'), item: `${siteUrl}${L('/indices')}` },
      ],
    },
  ];

  return page({ siteUrl, title, description, canonical: '/indices', body, jsonLd });
}
