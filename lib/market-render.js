// Страница «Графики»: сетка свечных графиков по категориям рынков.
// Всё рисуется на сервере — поисковик не исполняет JS, а внешняя картинка
// ради графика означала бы лишний запрос и чужую зависимость. Скрипт на клиенте
// только перерисовывает карточки по таймеру.

import { esc, SITE_NAME, mainNav } from './render.js';
import { t, L, getLang, intlLocale, plural as numPlural } from './i18n.js';
import { CATS, CTF, DEFAULT_CTF, fmtValue, fmtChange, listOf, instrumentPath } from './markets.js';
import { svgCandles, trimSeries, CANDLES_CARD, CANDLES_FULL } from './chart-render.js';
import { aggregate } from './charts.js';

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
function cardHtml({ inst, series, quote, tf }) {
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
  return `
    <a class="gcard" href="${esc(L(instrumentPath(inst)))}" data-key="${esc(inst.key)}">
      <div class="ghead">
        <div class="gname">${esc(t(inst.name))}</div>
        <div class="gsym">${esc(t(inst.short))}</div>
      </div>
      <div class="gvals">
        <b class="gprice">${esc(fmtValue(price, inst))}</b>
        <span class="gchg ${chg.dir}">${esc(chg.text)}</span>
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
// адресе, и в запасном пути без скрипта
const catBar = (cat, tf = DEFAULT_CTF) => {
  const hrefOf = (key) => {
    const q = [key === 'all' ? '' : `cat=${key}`, tf === DEFAULT_CTF ? '' : `tf=${tf}`].filter(Boolean);
    return L(q.length ? `/charts?${q.join('&')}` : '/charts');
  };
  return `<nav class="gtabs" aria-label="${esc(t('Категории рынков'))}">${CATS.map(
    (c) =>
      `<a class="gtab${c.key === cat ? ' on' : ''}" href="${hrefOf(c.key)}" data-cat="${esc(
        c.key
      )}"${c.key === cat ? ' aria-current="page"' : ''}>${esc(t(c.label))}</a>`
  ).join('')}</nav>`;
};

// data-tf — метка для скрипта: он перехватывает нажатие и меняет ряд без
// перезагрузки. href остаётся настоящим адресом: без скрипта и для поисковика
// работает он, а якорь #grid не даёт человеку остаться у заголовка
const tfBar = (cat, tf) => {
  const base = cat === 'all' ? '/charts' : `/charts?cat=${cat}`;
  const items = TF_ORDER.map((k) => {
    // Интервал по умолчанию живёт по адресу без параметра: две ссылки на одну
    // и ту же сетку поисковик считает дублями
    const href = k === DEFAULT_CTF ? `${base}#grid` : `${base}${base.includes('?') ? '&' : '?'}tf=${k}#grid`;
    const on = k === tf;
    return `<a class="period${on ? ' on' : ''}" href="${esc(L(href))}" data-tf="${esc(k)}"${on ? ' aria-current="page"' : ''}>${esc(t(CTF[k].label))}</a>`;
  }).join('');
  return `<nav class="periods gperiods" aria-label="${esc(t('Интервал свечей'))}">${items}</nav>`;
};

// Переключаемая часть страницы графиков: заголовок, вкладки категорий, кнопки
// интервала, сетка карточек и подпись под ней. Всё это зависит от вкладки —
// заголовок называет категорию, — поэтому отдаётся и страницей целиком, и
// ответом на запрос скрипта: разметка не может разойтись между двумя путями
export function chartsBoard({ cat = 'all', tf = DEFAULT_CTF, rows = [], quotes = {} }) {
  const meta = catMeta(cat);
  const poll = pollFor(tf);

  return `<h1 id="page-h1">${esc(t('Графики: {cat}', { cat: t(meta.title).toLowerCase() }))}</h1>
    <p class="sub">${esc(t(poll ? '{lead}. Свечи от минуты до месяца, цены обновляются сами. Источники: Мосбиржа (ISS) и CNBC.' : '{lead}. Свечи от минуты до месяца. Источники: Мосбиржа (ISS) и CNBC.', { lead: t(meta.lead) }))}</p>

    ${catBar(cat, tf)}
    ${tfBar(cat, tf)}

    <div class="ggrid" id="grid" ${
      poll ? `data-cat="${esc(cat)}" data-tf="${esc(tf)}" data-poll="${poll}"` : `data-cat="${esc(cat)}" data-tf="${esc(tf)}"`
    }>
      ${rows.map((r) => cardHtml({ inst: r.inst, series: r.series, quote: quotes[r.inst.key], tf })).join('')}
    </div>

    <p class="warn">${esc(poll
      ? t('Время на графиках — московское, пояс назван у каждой карточки. Внутридневные ряды обновляются автоматически и могут отставать от биржи на несколько секунд. Данные — не инвестиционная рекомендация.')
      : t('Время на графиках — московское, пояс назван у каждой карточки. Дневные, недельные и месячные свечи в течение дня не меняются — страница показывает последние собранные данные. Данные — не инвестиционная рекомендация.'))}</p>`;
}

// Заголовок и описание страницы: заголовок называет интервал, поэтому скрипт
// берёт его же при переключении — иначе вкладка браузера врала бы про ряд
export function chartsMeta({ cat = 'all', tf = DEFAULT_CTF }) {
  const meta = catMeta(cat);
  const list = listOf(cat);
  const isAll = cat === 'all';

  // Заголовок — с двоеточием, а не подряд: «Графики индексы» по-русски не
  // согласуется, а «Графики: индексы — часовые свечи» читается и человеком,
  // и поисковой выдачей, где заголовок обрезается посередине.
  // «Свечи день» тоже не согласуется: у интервала есть прилагательное именно
  // для этого места — «дневные свечи», «часовые свечи»
  const title = t('Графики: {cat} — {tf} свечи', { cat: t(meta.title).toLowerCase(), tf: t(CTF[tf].adj) });
  const description = isAll
    ? t('Живые графики по {n} инструментам: индексы, облигации, энергия, металлы и валюты. Свечи от минуты до месяца, обновление в реальном времени. Источники: Мосбиржа и CNBC.', { n: list.length })
    : t('{cat}: {n} {instruments} со свечами от минуты до месяца. {lead}. Обновление в реальном времени.', {
        cat: t(meta.title),
        n: list.length,
        instruments: numPlural(list.length, t('инструмент'), t('инструмента'), t('инструментов')),
        lead: t(meta.lead),
      });

  // h1 строит сам блок: он внутри переключаемой области и меняется вместе с
  // вкладкой. Здесь только то, что уходит в <head>
  return { title, description };
}

export function chartsPage({ cat = 'all', tf = DEFAULT_CTF, rows = [], quotes = {}, siteName }) {
  const { title, description } = chartsMeta({ cat, tf });
  const isAll = cat === 'all';

  const body = `
    <div class="logo"><a href="${L('/')}">${esc(siteName || SITE_NAME)}</a></div>
    ${mainNav('charts')}

    <div data-live="charts" data-cat="${esc(cat)}" data-tf="${esc(tf)}" data-default-tf="${esc(DEFAULT_CTF)}">
      ${chartsBoard({ cat, tf, rows, quotes })}
    </div>

    <section class="card">
      <h2>${esc(t('Что на этой странице'))}</h2>
      <p>${esc(t('Свечной график показывает четыре цены за интервал: открытие, максимум, минимум и закрытие. Тело свечи — разница между открытием и закрытием, тени — крайние цены за период. Зелёная свеча закрылась выше открытия, красная — ниже.'))}</p>
      <p>${esc(t('Интервал задаёт шаг одной свечи, а не окно целиком: минутный ряд покрывает несколько часов, месячный — несколько лет. Переключение интервала подменяет ряд на месте, не перезагружая страницу; адрес вкладки у каждого интервала при этом свой, и такую ссылку можно сохранить.'))}</p>
      <p>${esc(t('Кнопки категорий делят инструменты по классам активов. На вкладке «Все» — по одному инструменту от каждой категории: так видно, что происходит на всех рынках сразу.'))}</p>
    </section>`;

  return { title, description, body, canonical: isAll ? '/charts' : `/charts?cat=${cat}` };
}

// ------------------------------------------------------ страница инструмента
// По аналогии со страницей тикера: тот же адрес по слагу, тот же разбор
// «что это», те же кнопки интервала. Отличие одно — здесь нет новостей и
// обсуждений: инструмент справочный, а не бумага из каталога

// data-tf — метка для скрипта, href — настоящий адрес для запасного пути.
// Якорь #chart нужен именно запасному пути: при перезагрузке браузер должен
// оказаться у графика, а не у шапки
const instTfBar = (inst, tf) => {
  const base = instrumentPath(inst);
  const items = TF_ORDER.map((k) => {
    const href = `${base}${k === DEFAULT_CTF ? '' : `?tf=${k}`}#chart`;
    const on = k === tf;
    return `<a class="period${on ? ' on' : ''}" href="${esc(L(href))}" data-tf="${esc(k)}"${on ? ' aria-current="page"' : ''}>${esc(t(CTF[k].label))}</a>`;
  }).join('');
  return `<nav class="periods tf-bar" aria-label="${esc(t('Интервал свечей'))}">${items}</nav>`;
};

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
        <b class="gprice">${esc(fmtValue(price, inst))}</b>
        <span class="gchg ${chg.dir}">${esc(chg.text)}</span>
        ${quote?.yield ? `<span class="gsym">${esc(t('доходность {value}', { value: fmtValue(quote.yield, { unit: 'pct' }) }))}</span>` : ''}
      </div>
      ${instTfBar(inst, tf)}
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

// Обёртка блока. data-live и слаг нужны скрипту: по ним он понимает, куда
// просить новый ряд. Якорь #chart остаётся на секции — на него смотрят
// ссылки из меню страницы и запасной путь без скрипта
export const instChartBlock = ({ inst, series = null, quote = null, tf = DEFAULT_CTF }) => `
    <section class="card chart-card" id="chart" data-live="inst" data-slug="${esc(inst.slug)}" data-tf="${esc(tf)}" data-default-tf="${esc(DEFAULT_CTF)}">
      ${instChartInner({ inst, series, quote, tf })}
    </section>`;

export function instrumentPage({ inst, series = null, quote = null, tf = DEFAULT_CTF, siteName, siteUrl }) {
  const cat = catMeta(inst.cat);
  const siblings = listOf(inst.cat).filter((i) => i.key !== inst.key);
  // Цену и изменение для описания берём тем же правилом, что и блок графика
  const candles = (series?.candles || []).filter((c) => Array.isArray(c) && c.length >= 5);
  const price = quote?.price ?? (candles.length ? Number(candles[candles.length - 1][4]) : null);
  const chg = fmtChange(quote, inst);

  const body = `
    <div class="logo"><a href="${L('/')}">${esc(siteName || SITE_NAME)}</a></div>
    ${mainNav('charts')}
    <nav class="crumbs"><a href="${L('/charts')}">${esc(t('Графики'))}</a> → <a href="${L(`/charts?cat=${inst.cat}`)}">${esc(t(cat.label))}</a></nav>
    <h1 id="page-h1">${esc(t('{name}: {tf} график, цена и история', { name: t(inst.name), tf: t(CTF[tf].one) }))}</h1>
    <p class="sub">${esc(t(inst.what))}</p>

    ${instChartBlock({ inst, series, quote, tf })}

    ${
      inst.indexSlug
        ? `<p class="sub">${esc(t('Подробнее об индексе — его история и состав:'))} <a href="${esc(L(`/index/${inst.indexSlug}`))}">${esc(t('страница индекса {short}', { short: t(inst.short) }))}</a>.</p>`
        : ''
    }

    <div class="cat"><h2>${esc(t('Другие инструменты: {cat}', { cat: t(cat.label).toLowerCase() }))}</h2><div class="grid">${siblings
      .map((i) => `<a class="tl" href="${esc(L(instrumentPath(i)))}"><span class="s">${esc(t(i.short))}</span><span class="n">${esc(t(i.name))}</span></a>`)
      .join('')}</div></div>`;

  const title = t('{name}: {tf} график и цена', { name: t(inst.name), tf: t(CTF[tf].one) });
  const description = t('{name} ({short}) — {tf} свечи, цена {price}{change}. {what}', {
    name: t(inst.name),
    short: t(inst.short),
    tf: t(CTF[tf].adj),
    price: fmtValue(price, inst),
    change: quote?.pct !== null && quote?.pct !== undefined ? t(', изменение {value}', { value: chg.text }) : '',
    what: t(inst.what),
  }).slice(0, 300);

  // Канонический адрес — без интервала, как у графика на странице тикера:
  // восемь интервалов одного инструмента отличаются только рядом свечей,
  // и индексировать их как восемь страниц значит плодить почти-копии
  const canonical = instrumentPath(inst);

  const jsonLd = [
    {
      '@context': 'https://schema.org',
      '@type': 'WebPage',
      name: title,
      description,
      url: siteUrl + canonical,
      inLanguage: getLang(),
      ...(inst.indexSlug ? { sameAs: `${siteUrl}/index/${inst.indexSlug}` } : {}),
      about: { '@type': 'Thing', name: t(inst.name), alternateName: inst.short },
      isPartOf: { '@type': 'WebSite', name: siteName || SITE_NAME, url: siteUrl },
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: t('Главная'), item: `${siteUrl}${L('/')}` },
        { '@type': 'ListItem', position: 2, name: t('Графики'), item: `${siteUrl}${L('/charts')}` },
        { '@type': 'ListItem', position: 3, name: t(cat.label), item: `${siteUrl}${L(`/charts?cat=${inst.cat}`)}` },
        { '@type': 'ListItem', position: 4, name: t(inst.name), item: `${siteUrl}${L(instrumentPath(inst))}` },
      ],
    },
  ];

  return { title, description, body, canonical, jsonLd };
}
