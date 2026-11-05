// Страница «Графики»: сетка свечных графиков по категориям рынков.
// Всё рисуется на сервере — поисковик не исполняет JS, а внешняя картинка
// ради графика означала бы лишний запрос и чужую зависимость. Скрипт на клиенте
// только перерисовывает карточки по таймеру.

import { esc, SITE_NAME, mainNav } from './render.js';
import { t, L, getLang, intlLocale, plural as numPlural } from './i18n.js';
import {
  CATS, CTF, CTF_ORDER as TF_ORDER, DEFAULT_CTF, SETS, fmtValue, fmtChange, listOf, catsOf,
  setMeta, setSize, chartsPath, instHref, instrumentPath,
} from './markets.js';
import { svgCandles, trimSeries, CANDLES_CARD, CANDLES_FULL } from './chart-render.js';
import { aggregate } from './charts.js';
// Ключ инструмента на «Графиках» — биржевой символ (.SPX, IMOEX), а реалтайм
// хранит индексы под нашим кодом (IDX:SP500). Связь между ними — sourceCode
import { INDEXES } from './indices.js';

// Живой ключ для карточки. Он есть только у индексов: облигации, сырьё и
// валюта в реалтайм не попадают, и выдумывать им ключ незачем — карточка
// просто останется со значением, собранным при отдаче страницы
const liveKeyOf = (inst) => {
  const idx = INDEXES.find((i) => i.sourceCode === inst.code);
  return idx ? `IDX:${idx.code}` : null;
};

// Единица измерения диктует и формат числа: карточка печатает цену через
// fmtValue, поэтому и подмена идёт тем же форматтером, а не своим
export const unitToken = (inst) => `v:${inst.unit || 'pts'}`;

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

// Подзаголовок категории зависит и от набора: «Мосбиржа и мировые площадки»
// над девятью мировыми индексами описывало бы то, чего на экране нет
const leadOf = (cat, set) => (set !== 'all' && cat.leads?.[set]) || cat.lead;

// Подпись времени в правом нижнем углу карточки: когда ряд пришёл.
// Пояс один на всю страницу — московский, а не пояс каждой биржи: в сетке
// соседние карточки показывали бы «09:03» и «17:03» и выглядели бы как
// разное время одного события. Пояс назван в подписи под сеткой
function stampText(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat(intlLocale(), {
    timeZone: 'Europe/Moscow',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

// 'YYYY-MM' → «ноябрь 2026». Ключ месяца нельзя приписывать к первому числу
// и отдавать в Date: так получалась дата вида '2026-11-01-01' и «Invalid Date».
// Название месяца берётся у Intl: список слов пришлось бы держать на каждый язык
const monthName = (m) => {
  const [y, mo] = String(m).split('-');
  const n = Number(mo);
  if (!Number.isFinite(n) || n < 1 || n > 12 || !y) return String(m);
  // Год дописываем сами: Intl с {year:'numeric'} в русской локали даёт
  // «ноябрь 2026 г.», а прежний вид — «ноябрь 2026»
  const month = new Date(Date.UTC(Number(y), n - 1, 1)).toLocaleDateString(intlLocale(), {
    month: 'long',
    timeZone: 'UTC',
  });
  return `${month} ${y}`;
};

// Одна карточка. Разметка нарочно короткая: на вкладке их бывает и четырнадцать,
// и лишний <div> вокруг каждой — это лишние сорок узлов в дереве.
//
// Ключ инструмента в data-key, а не в id: по нему скрипт находит карточку,
// когда приходит ответ /api/charts
function cardHtml({ inst, series, quote, tf, set = 'all' }) {
  const candles = (series?.candles || []).filter((c) => Array.isArray(c) && c.length >= 5);
  const drawn = trimSeries(candles, CANDLES_CARD);

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
    return new Intl.DateTimeFormat(intlLocale(), {
      timeZone: 'Europe/Moscow',
      ...(stamp === 'intraday'
        ? { hour: '2-digit', minute: '2-digit' }
        : withYear
          ? { day: 'numeric', month: 'short', year: '2-digit' }
          : { day: 'numeric', month: 'short' }),
    }).format(d);
  };

  const chart = drawn.length >= 2
    ? `<div class="gchart">${svgCandles(drawn, { width: 360, height: 150 })}</div>
       <div class="gaxis"><span>${esc(fmtT(drawn[0][0]))}</span><span>${esc(fmtT(drawn[drawn.length - 1][0]))}</span></div>`
    : `<div class="gchart gempty">${esc(t('данных нет'))}</div>`;

  // Вся карточка — одна ссылка на страницу инструмента. Вложенную ссылку в
  // названии держать нельзя: <a> внутри <a> браузер разбирает непредсказуемо,
  // а человек всё равно ждёт, что откроется то, на что он нажал
  const live = liveKeyOf(inst);
  return `
    <a class="gcard" href="${esc(L(instHref(inst, set)))}" data-key="${esc(inst.key)}"${live ? ` data-rt="${esc(live)}"` : ''}>
      <div class="ghead">
        <div class="gname">${esc(t(inst.name))}</div>
        <div class="gsym">${esc(t(inst.short))}</div>
      </div>
      <div class="gvals">
        <b class="gprice"${live ? ` data-rt="${esc(live)}" data-rt-f="${esc(unitToken(inst))}"` : ''}>${esc(fmtValue(price, inst))}</b>
        <span class="gchg ${chg.dir}"${live ? ` data-rt="${esc(live)}" data-rt-f="c:${esc(inst.unit || 'pts')}"` : ''}>${esc(chg.text)}</span>
      </div>
      ${chart}
      <div class="gfoot"><span class="gtime">${esc(stampText(series?.fetchedAt))}</span>${quote?.yield ? `<span>${esc(t('дох. {value}', { value: fmtValue(quote.yield, { unit: 'pct' }) }))}</span>` : ''}</div>
    </a>`;
}

// Только внутренности карточки: скрипт подменяет их целиком и не трогает
// обёртку, чтобы не терять data-key и не пересобирать сетку
export const cardInnerHtml = (args) => {
  const html = cardHtml(args);
  return html.replace(/^[\s\S]*?<a class="gcard"[^>]*>/, '').replace(/<\/a>\s*$/, '');
};

// Вкладки категорий. data-cat — для скрипта: по нему он отличает смену
// категории от смены интервала, когда обе кнопки лежат в одном блоке.
// Интервал в ссылке сохраняется: иначе смена вкладки сбрасывала бы его и в
// адресе, и в запасном пути без скрипта.
// На странице инструмента та же полоса показывает, в какой категории он лежит,
// но aria-current там неуместен: открыта не вкладка, а страница инструмента
const catBar = (cat, tf = DEFAULT_CTF, { here = true, set = 'all' } = {}) => {
  // Интервал в ссылке есть всегда, как и у кнопок интервала: адрес без него
  // открывает запомненный, и смена категории без скрипта сбрасывала бы выбор.
  // Категории набора, в которых ничего нет, не показываются: у «России» нет
  // энергии, и кнопка, открывающая пустую сетку, — кнопка в никуда
  const hrefOf = (key) => L(chartsPath(key, set, tf));
  return `<nav class="gtabs" aria-label="${esc(t('Категории рынков'))}">${catsOf(set).map(
    (c) =>
      `<a class="gtab${c.key === cat ? ' on' : ''}" href="${hrefOf(c.key)}" data-cat="${esc(
        c.key
      )}"${c.key === cat && here ? ' aria-current="page"' : ''}>${esc(t(c.label))}</a>`
  ).join('')}</nav>`;
};

// Выбор набора рынков. Обычные ссылки, без перехвата: набор меняет не только
// карточки, но и сами вкладки категорий, а половина страницы, перерисованная
// скриптом, разошлась бы с адресом при первой же ошибке. Перезагрузка здесь
// дешевле и честнее, и без скрипта работает так же
const setBar = (cat, set, tf) =>
  `<nav class="gsets" aria-label="${esc(t('Наборы рынков'))}">${SETS.map(
    (s) =>
      `<a class="gset${s.key === set ? ' on' : ''}" href="${esc(L(chartsPath(cat, s.key, tf)))}"${
        s.key === set ? ' aria-current="page"' : ''
      }>${esc(t(s.label))}</a>`
  ).join('')}</nav>`;

// data-tf — метка для скрипта: он перехватывает нажатие и меняет ряд без
// перезагрузки. href остаётся настоящим адресом: без скрипта и для поисковика
// работает он.
// Интервал в ссылке есть всегда, и у пятиминуток тоже: адрес без параметра
// открывает интервал, запомненный в куке, и нажатие на «5 мин» без скрипта
// показало бы прошлый выбор. Дублей это не плодит — canonical у всех один.
// Якоря нет: полоса стоит под меню сайта, и переход к #grid увёл бы её
// за верх экрана — ровно то место, где её ищут
const tfBar = (base, tf) => {
  const items = TF_ORDER.map((k) => {
    const href = `${base}${base.includes('?') ? '&' : '?'}tf=${k}`;
    const on = k === tf;
    return `<a class="period${on ? ' on' : ''}" href="${esc(L(href))}" data-tf="${esc(k)}"${on ? ' aria-current="page"' : ''}>${esc(t(CTF[k].label))}</a>`;
  }).join('');
  return `<nav class="periods gperiods" aria-label="${esc(t('Интервал свечей'))}">${items}</nav>`;
};

// Меню «Графиков»: категории и интервалы. Одна и та же разметка стоит первой
// и на сетке, и на странице инструмента, сразу под меню сайта, — поэтому при
// переходе между ними кнопки остаются на своём месте и не прыгают вслед за
// заголовком, длина которого у каждой страницы своя
const chartsNav = ({ cat, tf, set = 'all', inst = null }) => `<div class="gnav">
      ${setBar(cat, set, tf)}
      ${catBar(cat, tf, { here: !inst, set })}
      ${tfBar(inst ? instHref(inst, set) : chartsPath(cat, set), tf)}
    </div>`;

// Переключаемая часть страницы графиков: заголовок, вкладки категорий, кнопки
// интервала, сетка карточек и подпись под ней. Всё это зависит от вкладки —
// заголовок называет категорию, — поэтому отдаётся и страницей целиком, и
// ответом на запрос скрипта: разметка не может разойтись между двумя путями
export function chartsBoard({ cat = 'all', tf = DEFAULT_CTF, set = 'all', rows = [], quotes = {} }) {
  const meta = catMeta(cat);
  const poll = pollFor(tf);
  const sm = setMeta(set);

  return `${chartsNav({ cat, tf, set })}
    <h1 id="page-h1">${esc(h1Of(cat, set))}</h1>
    <p class="sub">${esc(t(poll ? '{lead}. Свечи от минуты до месяца, цены обновляются сами. Источники: {sources}.' : '{lead}. Свечи от минуты до месяца. Источники: {sources}.', { lead: t(leadOf(meta, set)), sources: t(sm.sources) }))}</p>

    <div class="ggrid" id="grid" data-set="${esc(set)}" ${
      poll ? `data-cat="${esc(cat)}" data-tf="${esc(tf)}" data-poll="${poll}"` : `data-cat="${esc(cat)}" data-tf="${esc(tf)}"`
    }>
      ${rows.map((r) => cardHtml({ inst: r.inst, series: r.series, quote: quotes[r.inst.key], tf, set })).join('')}
    </div>

    <p class="warn">${esc(poll
      ? t('Время на графиках — московское, пояс назван у каждой карточки. Внутридневные ряды обновляются автоматически и могут отставать от биржи на несколько секунд. Данные — не инвестиционная рекомендация.')
      : t('Время на графиках — московское, пояс назван у каждой карточки. Дневные, недельные и месячные свечи в течение дня не меняются — страница показывает последние собранные данные. Данные — не инвестиционная рекомендация.'))}</p>`;
}

// Заголовок и описание страницы: заголовок называет интервал, поэтому скрипт
// берёт его же при переключении — иначе вкладка браузера врала бы про ряд
// Название категории с уточнением набора: «индексы мира», «облигации России».
// Родительный падеж, а не приставка «набор: мир»: так фраза читается и в
// заголовке вкладки, и в поисковой выдаче, и переводится как обычное
// прилагательное — «world indices», «índices del mundo»
const catPhrase = (cat, set) => {
  // «Все рынки» с уточнением не склоняется: «все рынки мира» — это не по-русски,
  // а по-английски ещё и читается задом наперёд («world all markets»). Поэтому
  // у общей вкладки на каждый набор своё название, а не приставка
  if (cat === 'all') return set === 'world' ? t('Мировые рынки') : set === 'ru' ? t('Российский рынок') : t('Все рынки');
  // Категория называется в родительном падеже: «индексы мира», «облигации
  // России». Уточнение идёт после и склоняется само — переводится как обычное
  // прилагательное: world indices, índices del mundo
  const title = t(catMeta(cat).title).toLowerCase();
  if (set === 'world') return t('{cat} мира', { cat: title });
  if (set === 'ru') return t('{cat} России', { cat: title });
  return title;
};

// После двоеточия по-русски идёт строчная, по-английски и по-испански —
// заглавная у каждого слова. Поэтому регистр понижается только для русского
const phraseIn = (cat, set) => {
  const p = catPhrase(cat, set);
  // Понижается только первая буква: «индексы России», а не «индексы россии»
  return getLang() === 'ru' ? p.charAt(0).toLowerCase() + p.slice(1) : p;
};

export const h1Of = (cat, set = 'all') => t('Viz: {cat}', { cat: phraseIn(cat, set) });

export function chartsMeta({ cat = 'all', tf = DEFAULT_CTF, set = 'all' }) {
  const meta = catMeta(cat);
  const list = listOf(cat, set);
  const isAll = cat === 'all';
  const sm = setMeta(set);

  // Заголовок — с двоеточием, а не подряд: «Графики индексы» по-русски не
  // согласуется, а «Графики: индексы — часовые свечи» читается и человеком,
  // и поисковой выдачей, где заголовок обрезается посередине.
  // «Свечи день» тоже не согласуется: у интервала есть прилагательное именно
  // для этого места — «дневные свечи», «часовые свечи»
  const title = t('Viz: {cat} — {tf} свечи', { cat: phraseIn(cat, set), tf: t(CTF[tf].adj) });
  // Категории перечисляются те, что в наборе есть: у «России» нет энергии,
  // и упоминать её в описании значит обещать то, чего на странице не будет
  const kinds = catsOf(set).filter((c) => c.key !== 'all').map((c) => t(c.label).toLowerCase());
  const description = isAll
    ? t('Живые графики по {n} инструментам: {kinds}. Свечи от минуты до месяца, обновление в реальном времени. Источники: {sources}.', {
        n: setSize(set),
        kinds: kinds.join(', '),
        sources: t(sm.sources),
      })
    : t('{cat}: {n} {instruments} со свечами от минуты до месяца. {lead}. Обновление в реальном времени.', {
        cat: t(meta.title),
        n: list.length,
        instruments: numPlural(list.length, t('инструмент'), t('инструмента'), t('инструментов')),
        lead: t(leadOf(meta, set)),
      });

  // h1 строит сам блок: он внутри переключаемой области и меняется вместе с
  // вкладкой. Здесь только то, что уходит в <head>
  return { title, description };
}

export function chartsPage({ cat = 'all', tf = DEFAULT_CTF, set = 'all', rows = [], quotes = {}, siteName }) {
  const { title, description } = chartsMeta({ cat, tf, set });

  const body = `
    <div class="logo"><a href="${L('/')}">${esc(siteName || SITE_NAME)}</a></div>
    ${mainNav('charts')}

    <div data-live="charts" data-cat="${esc(cat)}" data-set="${esc(set)}" data-tf="${esc(tf)}">
      ${chartsBoard({ cat, tf, set, rows, quotes })}
    </div>

    <section class="card">
      <h2>${esc(t('Что на этой странице'))}</h2>
      <p>${esc(t('Свечной график показывает четыре цены за интервал: открытие, максимум, минимум и закрытие. Тело свечи — разница между открытием и закрытием, тени — крайние цены за период. Зелёная свеча закрылась выше открытия, красная — ниже.'))}</p>
      <p>${esc(t('Интервал задаёт шаг одной свечи, а не окно целиком: минутный ряд покрывает несколько часов, месячный — несколько лет. Переключение интервала подменяет ряд на месте, не перезагружая страницу; адрес вкладки у каждого интервала при этом свой, и такую ссылку можно сохранить.'))}</p>
      <p>${esc(t('Кнопки категорий делят инструменты по классам активов. На вкладке «Все» — по одному инструменту от каждой категории: так видно, что происходит на всех рынках сразу.'))}</p>
      <p>${esc(t('Кнопки наборов делят рынки на мосбиржевые и мировые. Набор по умолчанию зависит от языка страницы: в английской и испанской версиях первыми показаны мировые площадки, в русской — все сразу. Выбранный набор остаётся в адресе, поэтому ссылку можно сохранить и передать.'))}</p>
    </section>`;

  // Канонический адрес — без интервала, но с набором, если тот не по
  // умолчанию: иначе две разные доски объявили бы себя одной страницей.
  // altPath пересчитывает тот же адрес для каждого языка по его собственному
  // умолчанию: у русского мировой набор — голый путь, у английского — ?set=all
  return {
    title,
    description,
    body,
    canonical: chartsPath(cat, set),
    altPath: (l) => chartsPath(cat, set, null, l),
  };
}

// ------------------------------------------------------ страница инструмента
// По аналогии со страницей тикера: тот же адрес по слагу, тот же разбор
// «что это», те же кнопки интервала. Отличие одно — здесь нет новостей и
// обсуждений: инструмент справочный, а не бумага из каталога

// Внутренность блока графика на странице инструмента. Отдельно от обёртки,
// потому что этот же кусок сервер отдаёт скрипту при переключении интервала:
// иначе разметка разошлась бы между загрузкой страницы и переключением
export function instChartInner({ inst, series = null, quote = null, tf = DEFAULT_CTF }) {
  const candles = (series?.candles || []).filter((c) => Array.isArray(c) && c.length >= 5);
  const price = quote?.price ?? (candles.length ? Number(candles[candles.length - 1][4]) : null);
  const chg = fmtChange(quote, inst);
  const poll = pollFor(tf);

  // Подпись времени — по Москве, как и в сетке: пояс у страницы один
  const stamp = series?.fetchedAt
    ? new Intl.DateTimeFormat(intlLocale(), { timeZone: 'Europe/Moscow', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).format(new Date(series.fetchedAt))
    : null;

  const drawn = trimSeries(candles, CANDLES_FULL);
  const fmtT = (t) => {
    const d = typeof t === 'number' ? new Date(t * 1000) : new Date(`${t}T00:00:00Z`);
    if (Number.isNaN(d.getTime())) return '—';
    return new Intl.DateTimeFormat(intlLocale(), {
      timeZone: 'Europe/Moscow',
      ...(typeof t === 'number'
        ? { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }
        : { day: 'numeric', month: 'short', year: 'numeric' }),
    }).format(d);
  };

  // Дневные закрытия по месяцам — для робота: он не исполняет JS и не читает
  // картинку, но текст таблицы понимает. У внутридневного ряда месяцы не нужны,
  // там важны последние свечи
  const isDaily = candles.length > 0 && typeof candles[0][0] === 'string';
  const rows = isDaily
    ? aggregate(candles, (d) => String(d).slice(0, 7)).slice(-12).reverse()
    : candles.slice(-10).reverse();
  const tableRows = isDaily
    ? rows.map((c) => `<tr><td>${esc(monthName(c[0]))}</td><td class="num">${esc(fmtValue(c[4], inst))}</td></tr>`).join('')
    : rows
        .map(
          (c) =>
            `<tr><td>${esc(fmtT(c[0]))}</td><td class="num">${esc(fmtValue(c[1], inst))}</td><td class="num">${esc(fmtValue(c[2], inst))}</td><td class="num">${esc(fmtValue(c[3], inst))}</td><td class="num">${esc(fmtValue(c[4], inst))}</td></tr>`
        )
        .join('');

  // Экстремумы — по показанному окну: подпись «максимум» под графиком должна
  // относиться к свече, которую видно, а не к отрезанному началу ряда
  const hi = drawn.length ? drawn.reduce((a, c) => (Number(c[2]) > Number(a[2]) ? c : a)) : null;
  const lo = drawn.length ? drawn.reduce((a, c) => (Number(c[3]) < Number(a[3]) ? c : a)) : null;

  return `
      <div class="head">
        <h2>${esc(t('{name} — {tf} свечи', { name: t(inst.name), tf: t(CTF[tf].adj) }))}</h2>
        <span class="meta-stamp">${stamp ? esc(t('данные на {when} мск', { when: stamp })) : esc(t('данные ещё не получены'))}</span>
      </div>
      <div class="gvals">
        <b class="gprice"${liveKeyOf(inst) ? ` data-rt="${esc(liveKeyOf(inst))}" data-rt-f="${esc(unitToken(inst))}"` : ''}>${esc(fmtValue(price, inst))}</b>
        <span class="gchg ${chg.dir}"${liveKeyOf(inst) ? ` data-rt="${esc(liveKeyOf(inst))}" data-rt-f="c:${esc(inst.unit || 'pts')}"` : ''}>${esc(chg.text)}</span>
        ${quote?.yield ? `<span class="gsym">${esc(t('доходность {value}', { value: fmtValue(quote.yield, { unit: 'pct' }) }))}</span>` : ''}
      </div>
      ${
        drawn.length >= 2
          ? `<div class="chart${isDaily ? '' : ' chart-intraday'}">
        ${svgCandles(drawn, { width: 720, height: 220 })}
        <div class="chart-axis">
          <span>${esc(fmtT(drawn[0][0]))} — ${esc(fmtValue(drawn[0][1], inst))}</span>
          <span>${esc(fmtT(drawn[drawn.length - 1][0]))} — ${esc(fmtValue(drawn[drawn.length - 1][4], inst))}</span>
        </div>
        ${
          hi && lo
            ? `<div class="chart-axis chart-axis-mid">
          <span>${esc(t('максимум {when}: {value}', { when: fmtT(hi[0]), value: fmtValue(hi[2], inst) }))}</span>
          <span>${esc(t('минимум {when}: {value}', { when: fmtT(lo[0]), value: fmtValue(lo[3], inst) }))}</span>
        </div>`
            : ''
        }
      </div>`
          : `<p class="chart-empty">${esc(t('За этот интервал данных нет — источник их не отдаёт или история короче. Выберите другой интервал.'))}</p>`
      }
      <details class="chart-table">
        <summary>${esc(isDaily ? t('Закрытия по месяцам') : t('Последние свечи'))}</summary>
        <table class="idx-table">
          <thead><tr>${
            isDaily
              ? `<th>${esc(t('Месяц'))}</th><th class="num">${esc(t('Закрытие'))}</th>`
              : `<th>${esc(t('Свеча'))}</th><th class="num">${esc(t('Открытие'))}</th><th class="num">${esc(t('Максимум'))}</th><th class="num">${esc(t('Минимум'))}</th><th class="num">${esc(t('Закрытие'))}</th>`
          }</tr></thead>
          <tbody>${tableRows}</tbody>
        </table>
      </details>
      <p class="warn">${esc(t('Свечи: {tf} по данным {source}. Время — московское.', {
        tf: t(CTF[tf].label).toLowerCase(),
        source: t(inst.source === 'moex' ? 'Мосбиржи (ISS)' : 'CNBC'),
      }))}${
        candles.length > drawn.length ? ' ' + esc(t('Показаны последние {shown} свечей из {total}.', { shown: drawn.length, total: candles.length })) : ''
      } ${esc(
        poll
          ? t('Внутридневной ряд запрашивается при показе страницы и может отставать от биржи на минуту. Данные — не инвестиционная рекомендация.')
          : t('Последняя свеча — итог последнего торгового периода, а не котировка в реальном времени. Данные — не инвестиционная рекомендация.')
      )}</p>`;
}

// Переключаемая часть страницы инструмента: меню «Графиков», заголовок и блок
// графика. Меню внутри неё, а не над ней: кнопка интервала должна найти, какой
// ряд просить, а отмеченный интервал — смениться вместе с рядом. Этот же кусок
// сервер отдаёт скрипту, поэтому разметка не расходится между двумя путями
export const instBoard = ({ inst, series = null, quote = null, tf = DEFAULT_CTF, set = 'all' }) => `${chartsNav({ cat: inst.cat, tf, set: setOfInst(inst, set), inst })}
    <h1 id="page-h1">${esc(t('{name}: {tf} график, цена и история', { name: t(inst.name), tf: t(CTF[tf].one) }))}</h1>
    <section class="card chart-card inst-chart" id="chart"${liveKeyOf(inst) ? ` data-rt="${esc(liveKeyOf(inst))}"` : ''}>
      ${instChartInner({ inst, series, quote, tf })}
    </section>`;

// Набор страницы инструмента: пришли из мирового набора — меню остаётся
// мировым, даже если сам инструмент мосбиржевой (иначе «назад» вело бы в
// другую доску). Инструмента, которого в этом наборе нет, это не касается:
// его страница открывается всегда, а меню показывает полный набор
const setOfInst = (inst, set) =>
  setMeta(set).has(inst) ? set : inst.source === 'moex' ? 'ru' : 'world';

export function instrumentPage({ inst, series = null, quote = null, tf = DEFAULT_CTF, set = 'all', siteName, siteUrl }) {
  const cat = catMeta(inst.cat);
  const shown = setOfInst(inst, set);
  const siblings = listOf(inst.cat, shown).filter((i) => i.key !== inst.key);
  // Цену и изменение для описания берём тем же правилом, что и блок графика
  const candles = (series?.candles || []).filter((c) => Array.isArray(c) && c.length >= 5);
  const price = quote?.price ?? (candles.length ? Number(candles[candles.length - 1][4]) : null);
  const chg = fmtChange(quote, inst);

  const body = `
    <div class="logo"><a href="${L('/')}">${esc(siteName || SITE_NAME)}</a></div>
    ${mainNav('charts')}

    <div data-live="inst" data-slug="${esc(inst.slug)}" data-cat="${esc(inst.cat)}" data-set="${esc(shown)}" data-tf="${esc(tf)}">
      ${instBoard({ inst, series, quote, tf, set: shown })}
    </div>

    <p class="sub inst-what">${esc(t(inst.what))}</p>

    ${
      inst.indexSlug
        ? `<p class="sub">${esc(t('Подробнее об индексе — его история и состав:'))} <a href="${esc(L(`/index/${inst.indexSlug}`))}">${esc(t('страница индекса {short}', { short: t(inst.short) }))}</a>.</p>`
        : ''
    }

    ${
      // В наборе «Россия» у металлов один инструмент, и список соседей там
      // пустой: заголовок с пустой сеткой читался бы как ошибка страницы
      siblings.length
        ? `<div class="cat"><h2>${esc(t('Другие инструменты: {cat}', { cat: t(cat.label).toLowerCase() }))}</h2><div class="grid">${siblings
            .map((i) => `<a class="tl" href="${esc(L(instHref(i, shown)))}"><span class="s">${esc(t(i.short))}</span><span class="n">${esc(t(i.name))}</span></a>`)
            .join('')}</div></div>`
        : ''
    }`;

  const title = t('{name}: {tf} график и цена', { name: t(inst.name), tf: t(CTF[tf].one) });
  const description = t('{name} ({short}) — {tf} свечи, цена {price}{change}. {what}', {
    name: t(inst.name),
    short: t(inst.short),
    tf: t(CTF[tf].adj),
    price: fmtValue(price, inst),
    change: quote?.pct !== null && quote?.pct !== undefined ? t(', изменение {value}', { value: chg.text }) : '',
    what: t(inst.what),
  }).slice(0, 300);

  // Канонический адрес — без интервала и без набора, как у графика на
  // странице тикера: восемь интервалов одного инструмента отличаются только
  // рядом свечей, а набор меняет лишь список соседей внизу, и индексировать
  // такие варианты как отдельные страницы значит плодить почти-копии
  const canonical = instrumentPath(inst);

  const jsonLd = [
    {
      '@context': 'https://schema.org',
      '@type': 'WebPage',
      name: title,
      description,
      url: siteUrl + L(canonical),
      inLanguage: getLang(),
      ...(inst.indexSlug ? { sameAs: `${siteUrl}${L(`/index/${inst.indexSlug}`)}` } : {}),
      about: { '@type': 'Thing', name: t(inst.name), alternateName: inst.short },
      isPartOf: { '@type': 'WebSite', name: siteName || SITE_NAME, url: siteUrl },
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: t('Главная'), item: `${siteUrl}${L('/')}` },
        { '@type': 'ListItem', position: 2, name: t('Viz'), item: `${siteUrl}${L(chartsPath('all', shown))}` },
        { '@type': 'ListItem', position: 3, name: t(cat.label), item: `${siteUrl}${L(chartsPath(inst.cat, shown))}` },
        { '@type': 'ListItem', position: 4, name: t(inst.name), item: `${siteUrl}${L(instrumentPath(inst))}` },
      ],
    },
  ];

  // hreflang строится по canonical: у страницы инструмента он один и без
  // набора, поэтому и переводы ведут на голые адреса — иначе hreflang и
  // canonical указывали бы на разные страницы одной и той же сущности
  return { title, description, body, canonical, jsonLd };
}
