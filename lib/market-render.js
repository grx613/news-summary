// Страница «Графики»: сетка свечных графиков по категориям рынков.
// Всё рисуется на сервере — поисковик не исполняет JS, а внешняя картинка
// ради графика означала бы лишний запрос и чужую зависимость. Скрипт на клиенте
// только перерисовывает карточки по таймеру.

import { esc, SITE_NAME } from './render.js';
import { CATS, CTF, DEFAULT_CTF, fmtValue, fmtChange, listOf } from './markets.js';
import { svgCandles, trimSeries } from './chart-render.js';

// Сколько свечей на карточке: столько же, сколько различимо по её ширине
const CARD_CANDLES = 150;

// Интервалы идут от минуты к месяцу — так их и читают: слева мелко, справа крупно
const TF_ORDER = ['1min', '5min', '15min', '30min', '1h', '1d', '1w', '1mo'];

// Обновление в реальном времени: минутки меняются чаще, дневные свечи — раз
// в сутки, и опрашивать их каждую минуту значит грузить биржу впустую.
// null — карточки не обновляются сами, число — период опроса в миллисекундах
const POLL_MS = {
  '1min': 20_000,
  '5min': 30_000,
  '15min': 45_000,
  '30min': 60_000,
  '1h': 60_000,
  '1d': null,
  '1w': null,
  '1mo': null,
};

export const pollFor = (tf) => POLL_MS[tf] ?? null;

// Запасной вариант — именно «Все», а не последняя вкладка списка: с ней
// заголовок страницы описал бы не тот рынок, который на ней нарисован
const catMeta = (key) => CATS.find((c) => c.key === key) || CATS.find((c) => c.key === 'all');

// Подпись времени в правом нижнем углу карточки: когда ряд пришёл.
// Пояс один на всю страницу — московский, а не пояс каждой биржи: в сетке
// соседние карточки показывали бы «09:03» и «17:03» и выглядели бы как
// разное время одного события. Пояс назван в подписи под сеткой
function stampText(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Moscow',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

// Одна карточка. Разметка нарочно короткая: на вкладке их бывает и четырнадцать,
// и лишний <div> вокруг каждой — это лишние сорок узлов в дереве.
//
// Ключ инструмента в data-key, а не в id: по нему скрипт находит карточку,
// когда приходит ответ /api/charts
function cardHtml({ inst, series, quote, tf }) {
  const candles = (series?.candles || []).filter((c) => Array.isArray(c) && c.length >= 5);
  const drawn = trimSeries(candles, CARD_CANDLES);

  // Цена — из котировки: свеча показывает закрытие последнего бара, а человек
  // ждёт от карточки текущую цену. Если котировки нет, годится и закрытие
  const lastClose = candles.length ? Number(candles[candles.length - 1][4]) : null;
  const price = quote?.price ?? lastClose;

  // Изменение за день — из котировки. Считать его по первому и последнему бару
  // нельзя: на минутном интервале это изменение за час, а не за день
  const chg = fmtChange(quote, inst);

  const stamp = series?.candles?.length && typeof candles[candles.length - 1]?.[0] === 'number' ? 'intraday' : 'daily';
  // На неделях и месяцах ряд покрывает годы, и подпись «5 апр. — 31 окт.»
  // читалась бы как полгода. Поэтому год там обязателен — в обеих крайних точках
  const withYear = tf === '1w' || tf === '1mo';
  const fmtT = (t) => {
    const d = typeof t === 'number' ? new Date(t * 1000) : new Date(`${t}T00:00:00Z`);
    if (Number.isNaN(d.getTime())) return '—';
    return new Intl.DateTimeFormat('ru-RU', {
      timeZone: 'Europe/Moscow',
      ...(stamp === 'intraday'
        ? { hour: '2-digit', minute: '2-digit' }
        : withYear
          ? { day: 'numeric', month: 'short', year: '2-digit' }
          : { day: 'numeric', month: 'short' }),
    }).format(d);
  };

  const chart = drawn.length >= 2
    ? `<div class="gchart">${svgCandles(drawn, { width: 360, height: 120 })}</div>
       <div class="gaxis"><span>${esc(fmtT(drawn[0][0]))}</span><span>${esc(fmtT(drawn[drawn.length - 1][0]))}</span></div>`
    : `<div class="gchart gempty">данных нет</div>`;

  // Название ведёт на страницу индекса, если она есть: у ОФЗ и товаров такой
  // страницы нет, и ссылка вела бы в 404
  const name = inst.indexSlug
    ? `<a href="/index/${esc(inst.indexSlug)}">${esc(inst.name)}</a>`
    : esc(inst.name);

  return `
    <article class="gcard" data-key="${esc(inst.key)}">
      <div class="ghead">
        <div class="gname">${name}</div>
        <div class="gsym">${esc(inst.short)}</div>
      </div>
      <div class="gvals">
        <b class="gprice">${esc(fmtValue(price, inst))}</b>
        <span class="gchg ${chg.dir}">${esc(chg.text)}</span>
      </div>
      ${chart}
      <div class="gfoot"><span class="gtime">${esc(stampText(series?.fetchedAt))}</span>${quote?.yield ? `<span>дох. ${esc(fmtValue(quote.yield, { unit: 'pct' }))}</span>` : ''}</div>
    </article>`;
}

// Только внутренности карточки: скрипт подменяет их целиком и не трогает
// обёртку, чтобы не терять data-key и не пересобирать сетку
export const cardInnerHtml = (args) => {
  const html = cardHtml(args);
  return html.replace(/^[\s\S]*?<article[^>]*>/, '').replace(/<\/article>\s*$/, '');
};

// Вкладки категорий и кнопки интервала — обычные ссылки: страница работает
// без скрипта, а поисковик видит содержимое каждой вкладки отдельным адресом.
// Интервал в канонический адрес не входит — иначе десять копий одной страницы
const catBar = (cat) =>
  `<nav class="gtabs" aria-label="Категории рынков">${CATS.map(
    (c) =>
      `<a class="gtab${c.key === cat ? ' on' : ''}" href="${c.key === 'all' ? '/charts' : `/charts?cat=${c.key}`}"${
        c.key === cat ? ' aria-current="page"' : ''
      }>${esc(c.label)}</a>`
  ).join('')}</nav>`;

// Якорь #grid обязателен по той же причине, что и на странице тикера: переход
// перезагружает страницу, и без него человек оказывается у заголовка, а не у сетки
const tfBar = (cat, tf) => {
  const base = cat === 'all' ? '/charts' : `/charts?cat=${cat}`;
  const items = TF_ORDER.map((k) => {
    const href = `${base}${base.includes('?') ? '&' : '?'}tf=${k}#grid`;
    const on = k === tf;
    return `<a class="period${on ? ' on' : ''}" href="${esc(href)}"${on ? ' aria-current="page"' : ''}>${esc(CTF[k].label)}</a>`;
  }).join('');
  return `<nav class="periods gperiods" aria-label="Интервал свечей">${items}</nav>`;
};

export function chartsPage({ cat = 'all', tf = DEFAULT_CTF, rows = [], quotes = {}, siteName }) {
  const meta = catMeta(cat);
  const list = listOf(cat);
  const isAll = cat === 'all';

  // Заголовок — с двоеточием, а не подряд: «Графики индексы» по-русски не
  // согласуется, а «Графики: индексы — свечи 5 мин» читается и человеком,
  // и поисковой выдачей, где заголовок обрезается посередине
  const title = `Графики: ${meta.title.toLowerCase()} — свечи ${CTF[tf].label.toLowerCase()}`;
  const description = isAll
    ? `Живые графики по ${list.length} инструментам: индексы, облигации, энергия, металлы и валюты. Свечи от минуты до месяца, обновление в реальном времени. Источники: Мосбиржа и CNBC.`
    : `${meta.title}: ${list.length} ${list.length === 1 ? 'инструмент' : list.length < 5 ? 'инструмента' : 'инструментов'} со свечами от минуты до месяца. ${meta.lead}. Обновление в реальном времени.`;

  const poll = pollFor(tf);

  const body = `
    <div class="logo"><a href="/">${esc(siteName || SITE_NAME)}</a></div>
    <nav class="nav"><a href="/">Поиск</a><a href="/catalog">Каталог тикеров</a><a href="/charts">Графики</a><a href="/indices">Индексы</a><a href="/dividends">Дивиденды</a></nav>
    <h1>Графики: ${esc(meta.title.toLowerCase())}</h1>
    <p class="sub">${esc(meta.lead)}. Свечи от минуты до месяца${
      poll ? ', цены обновляются сами' : ''
    }. Источники: Мосбиржа (ISS) и CNBC.</p>

    ${catBar(cat)}
    ${tfBar(cat, tf)}

    <div class="ggrid" id="grid" ${
      poll ? `data-cat="${esc(cat)}" data-tf="${esc(tf)}" data-poll="${poll}"` : `data-cat="${esc(cat)}" data-tf="${esc(tf)}"`
    }>
      ${rows.map((r) => cardHtml({ inst: r.inst, series: r.series, quote: quotes[r.inst.key], tf })).join('')}
    </div>

    <p class="warn">Время на графиках — московское, пояс назван у каждой карточки.${
      poll
        ? ' Внутридневные ряды обновляются автоматически и могут отставать от биржи на несколько секунд.'
        : ' Дневные, недельные и месячные свечи в течение дня не меняются — страница показывает последние собранные данные.'
    } Данные — не инвестиционная рекомендация.</p>

    <section class="card">
      <h2>Что на этой странице</h2>
      <p>Свечной график показывает четыре цены за интервал: открытие, максимум, минимум и закрытие. Тело свечи — разница между открытием и закрытием, тени — крайние цены за период. Зелёная свеча закрылась выше открытия, красная — ниже.</p>
      <p>Интервал задаёт шаг одной свечи, а не окно целиком: минутный ряд покрывает несколько часов, месячный — несколько лет. Переключение интервала перезагружает страницу, поэтому адрес вкладки у каждого интервала свой.</p>
      <p>Кнопки категорий делят инструменты по классам активов. На вкладке «Все» — по одному инструменту от каждой категории: так видно, что происходит на всех рынках сразу.</p>
    </section>`;

  return { title, description, body, canonical: isAll ? '/charts' : `/charts?cat=${cat}` };
}
