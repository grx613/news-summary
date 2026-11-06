// Рендер HTML на сервере: страницы тикеров и каталог должны быть видны поисковикам
// целиком, без исполнения JS. Один рендерер на страницу — клиент только обновляет её целиком.

import { t, L, getLang, href, alternates, currentPath, LANGS, LANG_LABEL, LANG_CODE, OG_LOCALE, intlLocale, fmtRelative, fmtFull, fmtDay, fmtNum, plural as numPlural } from './i18n.js';

// Название сайта — бренд, а не описание: «Finance Reinvented» часть имени, а не
// подпись под ним. В <title> и JSON-LD оно идёт целиком, в шапке — двумя
// строками, потому что одной строкой в две ширины экрана не помещается
export const BRAND = 'BotHub FiRe';
export const SITE_TAGLINE = 'Finance Reinvented';
export const SITE_NAME = `${BRAND}: ${SITE_TAGLINE}`;

// Период живых котировок страница не выдумывает: он приходит из реалтайм-слоя
// и печатается в <body> одним атрибутом. Ноль — опрос выключен
let QUOTE_MS = 0;
export const setQuoteMs = (ms) => {
  QUOTE_MS = Number(ms) > 0 ? Math.round(Number(ms)) : 0;
};
// Подвал говорит, как часто обновляется то, что видно на странице. Период
// котировок не выдуман: это тот же QUOTE_MS, с каким страница опрашивает
// /api/quotes, поэтому при выключенном реалтайме строка честно молчит о
// котировках, а не обещает обновление, которого нет
const footNote = () => {
  const sec = Math.round(QUOTE_MS / 1000);
  if (!sec) {
    return t(
      'Сервис собирает публикации из Bing News, Yahoo Finance, Reddit, Финама, Smart-Lab и новостей Мосбиржи и делает по ним сводку. Данные обновляются раз в сутки.'
    );
  }
  return t(
    'Сервис собирает публикации из Bing News, Yahoo Finance, Reddit, Финама, Smart-Lab и новостей Мосбиржи и делает по ним сводку. Сводки обновляются раз в сутки, котировки — раз в {sec} {unit}.',
    { sec, unit: numPlural(sec, t('секунду'), t('секунды'), t('секунд')) }
  );
};

export const MARKET_LABEL = { RU: 'Акции Мосбиржи', US: 'Акции США', CRYPTO: 'Криптовалюты', VIZ: 'Инструменты Viz' };
export const MARKET_SLUG = { RU: 'ru', US: 'us', CRYPTO: 'crypto', VIZ: 'viz' };
export const SLUG_MARKET = { ru: 'RU', us: 'US', crypto: 'CRYPTO', viz: 'VIZ' };

// Как называть актив в заголовках: люди ищут «акции Газпрома», «котировки биткоина»
export const ASSET_KIND = { RU: 'акции', US: 'акции', CRYPTO: 'котировки', VIZ: 'инструмент' };

// Заголовки каталога пишутся с маленькой буквы внутри фразы, но не ломая регистр названий
const MARKET_TITLE = { RU: 'акции Мосбиржи', US: 'акции США', CRYPTO: 'криптовалюты' };

export const SENT = { bullish: 'Позитив', bearish: 'Негатив', neutral: 'Нейтрально', mixed: 'Смешанно' };
const CONF = { low: 'низкая', medium: 'средняя', high: 'высокая' };

export function esc(s = '') {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const plural = (n, one, few, many) => {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
};

// Верхнее меню сайта, одно на все страницы. Раньше оно собиралось в каждом
// шаблоне отдельно и расходилось: на главной его не было вовсе, а на тикере
// пункт «Поиск» вёл на ту же страницу, с которой человек пришёл.
//
// Пункты называют то, что человек ищет, а не нашу внутреннюю структуру:
// «Капитализация» — это главная с таблицей по капитализации, «Визуализация» —
// доска графиков. Форум и FAQ — сводные страницы по всему сайту: обсуждения и
// вопросы живут при тикерах, но человек приходит искать их списком.
// active — ключ текущего раздела: он подсвечивается и не повторяет адрес
export const NAV = [
  { key: 'home', href: '/', label: 'Капитализация' },
  { key: 'charts', href: '/charts', label: 'Визуализация' },
  { key: 'forum', href: '/forum', label: 'Форум' },
  { key: 'faq', href: '/faq', label: 'FAQ' },
  // Наш токен живёт на другом сайте: уводим в новом окне, чтобы читатель
  // не терял открытую страницу. rel="noopener" — чтобы чужая вкладка не
  // получила доступ к нашей через window.opener
  { key: 'token', href: 'https://bothub.chat/token', label: 'Наш токен', external: true },
];

const navLink = (n, active) =>
  n.external
    ? `<a href="${esc(n.href)}" target="_blank" rel="noopener noreferrer"${n.key === active ? ' class="on"' : ''}>${esc(t(n.label))}</a>`
    : `<a href="${L(n.href)}"${n.key === active ? ' class="on" aria-current="page"' : ''}>${esc(t(n.label))}</a>`;

export function mainNav(active = '') {
  return `<nav class="nav" aria-label="${esc(t('Разделы сайта'))}">${NAV.map((n) => navLink(n, active)).join('')}</nav>`;
}

// Поиск стоит в шапке на каждой странице: раньше он был только на главной, и
// человек, пришедший из поисковика на «Газпром», должен был вернуться на
// главную, чтобы найти другую бумагу. Подсказка и переходы те же — их
// обрабатывает public/app.js по id="q" и id="dd"
export const searchBox = () =>
  `<div class="search hsearch" role="search">
      <input id="q" type="search" placeholder="${esc(t('Название компании, тикер или монета…'))}" autocomplete="off" spellcheck="false" aria-label="${esc(t('Поиск по тикеру или названию'))}" />
      <div id="dd" class="dd"></div>
    </div>`;

// Шапка целиком: бренд, меню, поиск — в этом порядке. Меню стоит выше
// строки ввода нарочно: на страницу чаще приходят за разделом, чем за словом,
// и «Визуализация» должна читаться раньше поиска. Переключатель языка переехал
// в подвал: язык выбирают один раз, а в шапке он занимал место на каждой
// странице. Одна шапка на весь сайт — собранная в каждом шаблоне, она
// неизбежно расходилась
export function siteHead(active = '') {
  return `<header class="site-head">
      <div class="brand"><a class="brand-a" href="${L('/')}">
        <span class="brand-name">${esc(BRAND)}</span>
        <span class="brand-tag">${esc(SITE_TAGLINE)}</span>
      </a></div>
      ${mainNav(active)}
      ${searchBox()}
    </header>`;
}

// Подвал: четыре колонки вместо одной длинной строки ссылок. Слева — о сервисе
// и источники данных с периодом обновления, справа — разделы и служебные
// страницы. Разделы дублируют меню не зря: до конца длинной страницы тикера
// меню уже уехало вверх, а подвал — то, что видно после чтения
export function siteFooter({ langSwitch = true } = {}) {
  const col = (title, links) =>
    `<div class="fcol"><h4>${esc(t(title))}</h4>${links
      .map((l) =>
        l.external
          ? `<a href="${esc(l.href)}" target="_blank" rel="noopener noreferrer">${esc(t(l.label))}</a>`
          : `<a href="${L(l.href)}">${esc(t(l.label))}</a>`
      )
      .join('')}</div>`;

  return `<footer class="foot">
      <div class="fgrid">
        <div class="fabout">
          <div class="fbrand">${esc(BRAND)}<span>${esc(SITE_TAGLINE)}</span></div>
          <p>${esc(footNote())}</p>
        </div>
        ${col('Разделы', [
          { href: '/', label: 'Капитализация' },
          { href: '/charts', label: 'Визуализация' },
          { href: '/forum', label: 'Форум' },
          { href: '/faq', label: 'FAQ' },
        ])}
        ${col('Данные', [
          { href: '/catalog', label: 'Каталог тикеров' },
          { href: '/indices', label: 'Индексы' },
          { href: '/dividends', label: 'Дивиденды' },
        ])}
        ${col('Сервис', [
          { href: '/forum/rules', label: 'Правила обсуждений' },
          { href: '/forum/register', label: 'Регистрация на форуме' },
          { href: 'https://bothub.chat/token', label: 'Наш токен', external: true },
        ])}
      </div>
      ${
        // Язык в подвале, а не в шапке: выбор делают однажды, и место в шапке
        // он занимал на каждой странице. У темы форума и страницы вопроса
        // переключателя нет: текст написан на одном языке и перевода не имеет
        langSwitch
          ? `<div class="flang"><span>${esc(t('Язык сайта'))}</span>${langLinks()}</div>`
          : ''
      }
      <p class="flegal">${esc(t('Материалы сервиса — не инвестиционная рекомендация.'))}</p>
    </footer>`;
}

// Языки в подвале — три ссылки подряд, а не раскрывающийся список: в подвале
// некуда раскрываться, а ссылки на три версии должны быть в разметке, чтобы
// поисковик видел их без исполнения JS. Каждое название — на своём языке:
// человек узнаёт родной, не переводя
function langLinks() {
  const lang = getLang();
  const path = currentPath();
  return LANGS.map((l) => {
    const cur = l === lang;
    return `<a href="${esc(href(l, path))}" hreflang="${l}" lang="${l}"${
      cur ? ' class="on" aria-current="true"' : ''
    }>${esc(LANG_LABEL[l])}</a>`;
  }).join('');
}

// Дата и относительное время локализуются в i18n.js: там же лежит выбор
// 'ru-RU' / 'en-US' / 'es-ES'. Реэкспорт — чтобы остальные рендереры получали
// их оттуда же, откуда и раньше, и не тянули два импорта
export { fmtRelative, fmtFull, fmtDay };

// У инструмента «Графиков» адрес свой — страница со свечами, а не тикер
// каталога. Возвращаем её здесь, а не в каждом вызывающем: так форум, вопросы,
// крошки и карта сайта ведут на один адрес, и второй копии не возникает
export const tickerPath = (asset) =>
  asset.market === 'VIZ'
    ? `/charts/${asset.slug || String(asset.symbol).toLowerCase()}`
    : `/ticker/${MARKET_SLUG[asset.market] || 'us'}/${encodeURIComponent(asset.symbol)}`;

// Биржа отдаёт часть имён капсом («ГАЗПРОМ», «ЛУКОЙЛ»). В заголовке это выглядит криком,
// но аббревиатуры (ВТБ, МТС, ЮГК) и написания вроде «ДОМ.РФ» трогать нельзя.
//
// Здесь же перевод: названия русских бумаг на английской странице остались бы
// кириллицей, а это единственный текст, который читает посетитель /en. Ключ
// словаря — русское имя, поэтому для AAPL и для биткоина t() ничего не меняет
// У бумаг одна часть имени — название серии: «ОФЗ 26246» переводится по
// префиксу, номера выпуска остаются как есть
const RU_SERIES = /^(ОФЗ)\s+(\S+)$/u;

export function niceName(name = '') {
  const raw = String(name).trim();
  const series = RU_SERIES.exec(raw);
  const n = series ? `${t(series[1])} ${series[2]}` : t(raw);
  if (n.length < 5 || n !== n.toUpperCase() || /[.\d]/.test(n)) return n;
  return n.charAt(0) + n.slice(1).toLowerCase();
}

// Вопрос живёт по адресу с hash-префиксом и читаемым хвостом: URL остаётся стабильным,
// даже если вопрос переформулируют, а человек видит, о чём страница
export const questionPath = (asset, rec) =>
  `/q/${MARKET_SLUG[asset.market] || 'us'}/${encodeURIComponent(asset.symbol)}/${rec.id}`;

// ------------------------------------------------------------------ оболочка
export function page({ siteUrl, title, description, canonical, body, jsonLd = [], ogType = 'website', ogImage, noindex = false, head = '', onlyLang = null, altPath = null, active = '' }) {
  const lang = getLang();
  const fullTitle = title.includes(SITE_NAME) ? title : `${title} — ${SITE_NAME}`;
  const desc = description.length > 300 ? description.slice(0, 297) + '…' : description;
  // canonical приходит путём без префикса: страница сама знает свой язык и
  // добавляет его. Так один и тот же вызов годится для всех трёх версий
  const canonUrl = siteUrl + href(lang, canonical);
  // hreflang нужен на каждой версии и указывает на все, включая себя: без него
  // поисковик считает испанскую страницу копией русской. Но он же обещает
  // перевод, которого нет: страница вопроса и тема форума написаны на одном
  // языке, и три адреса с одним текстом — это три копии, а не три версии.
  // onlyLang говорит «этот текст существует только здесь»
  // altPath — для страниц, у которых один и тот же смысл записан в каждом языке
  // по-своему: набор рынков по умолчанию зависит от языка, и русским переводом
  // мировой доски будет /ru/charts?set=world, а не голый /ru/charts
  const paths = altPath || (() => canonical);
  const alt = onlyLang
    ? `<link rel="alternate" hreflang="${onlyLang}" href="${esc(siteUrl + href(onlyLang, paths(onlyLang)))}" />`
    : alternates(siteUrl, null, paths)
        .map((a) => `<link rel="alternate" hreflang="${a.lang}" href="${esc(a.url)}" />`)
        .join('\n  ');
  const ld = jsonLd
    .filter(Boolean)
    // В JSON-LD попадает текст посетителей: без экранирования `</script>` закрывает блок
    // и всё, что идёт дальше, исполняется как разметка страницы
    .map((o) => `<script type="application/ld+json">${JSON.stringify(o).replace(/[<>&\u2028\u2029]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)}</script>`)
    .join('\n  ');

  return `<!doctype html>
<html lang="${lang}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(fullTitle)}</title>
  <meta name="description" content="${esc(desc)}" />
  <link rel="canonical" href="${esc(canonUrl)}" />
  ${alt}
  ${noindex ? '<meta name="robots" content="noindex, follow" />' : '<meta name="robots" content="index, follow, max-image-preview:large" />'}
  <meta property="og:site_name" content="${esc(SITE_NAME)}" />
  <meta property="og:type" content="${esc(ogType)}" />
  <meta property="og:title" content="${esc(fullTitle)}" />
  <meta property="og:description" content="${esc(desc)}" />
  <meta property="og:url" content="${esc(canonUrl)}" />
  <meta property="og:locale" content="${OG_LOCALE[lang] || 'ru_RU'}" />
  ${LANGS.filter((l) => l !== lang).map((l) => `<meta property="og:locale:alternate" content="${OG_LOCALE[l]}" />`).join('\n  ')}
  ${ogImage ? `<meta property="og:image" content="${esc(siteUrl + ogImage)}" />` : ''}
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${esc(fullTitle)}" />
  <meta name="twitter:description" content="${esc(desc)}" />
  <meta name="theme-color" content="#0d1117" />
  <link rel="stylesheet" href="/app.css" />
  ${head}
  ${ld}
</head>
<body${
  // Период живых котировок задаёт сервер: клиент не должен держать второй
  // экземпляр этого числа. Ноль — реалтайм выключен, и страница не опрашивает
  // /api/quotes вовсе
  QUOTE_MS ? ` data-quote-ms="${QUOTE_MS}"` : ''
}>
  <div class="wrap" id="top">
${siteHead(active)}
${body}
    <a class="totop" href="#top" title="${esc(t('Вернуться к началу страницы'))}">↑<span> ${esc(t('Наверх'))}</span></a>
    <noscript><style>.totop { opacity: 1; visibility: visible; transform: none; }</style></noscript>
    ${siteFooter({ langSwitch: !onlyLang })}
  </div>
  <script src="/app.js" defer></script>
</body>
</html>`;
}

// ------------------------------------------------------------------ элементы
// Сводка на языке страницы. Русский оригинал лежит в rec.summary, переводы —
// в rec.i18n. Нет перевода (старая запись или провал вызова) — показываем
// русский текст: пустая страница хуже непереведённой
export function localSummary(rec) {
  const lang = getLang();
  const tr = rec?.i18n?.[lang];
  return tr || rec?.summary || {};
}

// Подпись рядом с названием. У бумаги это тикер, у инструмента «Графиков» —
// его краткое обозначение: «Доллар к рублю USD-RUB» выдаёт наш внутренний слаг
export const symLabel = (a) => (a.market === 'VIZ' ? String(a.short || a.name) : String(a.symbol));

// Сводка и блок вопросов нужны двум страницам: тикеру каталога и инструменту
// «Графиков». Выносятся наружу, чтобы разметка у них не расходилась
export function summaryCard(rec, { notice = '' } = {}) {
  const s = localSummary(rec);
  const a = rec.asset;
  // Сводка может быть старше TTL: крон не всегда успевает, а по «тонкому» тикеру
  // может и не пройти вовсе. Показывать «обновлено 2 ноября» без пояснения нельзя —
  // читатель принимает это за текущую картину. Причина в тексте не называется:
  // это может быть и промах источников, и просто ещё не дошедшая очередь
  const stale = rec.expiresAt ? Date.parse(rec.expiresAt) < Date.now() : false;
  const staleNote = stale
    ? `<div class="notice">${esc(t('Сводка собрана больше {hours} ч назад и не обновлялась. Данные ниже — на момент сбора; свежие можно получить кнопкой «Обновить».', { hours: rec.ttlHours || 26 }))}</div>`
    : '';
  const refs = (arr) => (arr || []).map((n) => `<a class="ref" href="#n${n}">[${n}]</a>`).join('');
  const list = (arr) =>
    arr && arr.length
      ? `<ul>${arr.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`
      : '<div style="color:var(--muted);font-size:14px">—</div>';

  const sources = (rec.sources || []).map(esc).join(' · ');
  const news = (rec.news || [])
    .map(
      (n, i) => `
              <li id="n${i + 1}">
                <span class="num">${i + 1}.</span>
                <a class="t" href="${esc(n.link)}" target="_blank" rel="noopener noreferrer nofollow">${esc(n.title)}</a>
                <div class="src">${esc(n.source || '')}${n.published ? ' · ' + fmtRelative(n.published) : ''}</div>
                ${n.snippet ? `<div class="snp">${esc(n.snippet.slice(0, 220))}${n.snippet.length > 220 ? '…' : ''}</div>` : ''}
              </li>`
    )
    .join('');

  return `
        <article class="card" id="summary">
          <div class="head">
            <h2>${esc(niceName(a.name))} <span>${esc(symLabel(a))}</span></h2>
            ${s.sentiment ? `<span class="sent ${esc(s.sentiment)}">${esc(t(SENT[s.sentiment] || s.sentiment))}</span>` : ''}
            <button class="refresh" id="refresh" data-next="${esc(rec.nextRefreshAt || '')}" data-symbol="${esc(a.symbol)}" data-market="${esc(a.market)}">${esc(t('↻ Обновить'))}</button>
          </div>
          <div class="meta">
            <span class="pill hit">${esc(t('обновлено {when}', { when: fmtRelative(rec.generatedAt) }))}</span>
            <span class="dot">•</span><span>${fmtFull(rec.generatedAt)}</span>
            <span class="dot">•</span><span>${(rec.news || []).length} ${numPlural((rec.news || []).length, t('публикация'), t('публикации'), t('публикаций'))} ${esc(t('за {hours} ч', { hours: rec.windowHours || 72 }))}</span>
            ${s.confidence ? `<span class="dot">•</span><span>${esc(t('полнота данных: {level}', { level: t(CONF[s.confidence] || s.confidence) }))}</span>` : ''}
          </div>

          ${notice ? `<div class="notice">${esc(notice)}</div>` : ''}
          ${staleNote}
          <div id="flash"></div>

          ${s.headline ? `<div class="headline">${esc(s.headline)}</div>` : ''}
          ${s.overview ? `<p>${esc(s.overview)}</p>` : ''}

          ${
            s.key_points?.length
              ? `<h3>${esc(t('Ключевое'))}</h3><ul>${s.key_points
                  .map((k) => {
                    const text = typeof k === 'string' ? k : k.text;
                    return `<li>${esc(text)}${refs(typeof k === 'object' ? k.refs : null)}</li>`;
                  })
                  .join('')}</ul>`
              : ''
          }

          <div class="cols">
            <div><h3>${esc(t('Риски'))}</h3>${list(s.risks)}</div>
            <div class="cats"><h3>${esc(t('Драйверы роста'))}</h3>${list(s.catalysts)}</div>
          </div>

          ${s.community ? `<h3>${esc(t('Что обсуждают в сообществе'))}</h3><div class="community">${esc(s.community)}</div>` : ''}

          ${rec.warnings?.length ? `<div class="warn">${esc(t('Не ответили источники:'))} ${rec.warnings.map((w) => `<code>${esc(w)}</code>`).join(', ')}</div>` : ''}

          <details>
            <summary>${esc(t('Источники и публикации ({n})', { n: (rec.news || []).length }))}</summary>
            <div style="color:var(--muted);font-size:13px;margin-top:8px">${sources}</div>
            <ol class="news">${news}</ol>
          </details>
        </article>`;
}

// ------------------------------------------------------------------ блок вопросов
// Сколько абзацев в ответе: рядом с заголовком сразу видно, разбор это
// на несколько абзацев или ответ в одну строку. Отвеченный вопрос — не ветка
// с ответами, поэтому считать «сколько ответов» тут нечего
const answerParas = (rec) =>
  String(rec?.answer || '')
    .split(/\n\s*\n/)
    .filter((p) => p.trim()).length;

// Заголовок от модели, а не текст посетителя: у старых записей заголовка нет,
// там остаётся сам вопрос — как в <title> страницы вопроса
const qaHeading = (q) => String(q.title || q.question || '').trim();

export function qaBlock({ asset, questions, formAction }) {
  const list = questions.length
    ? `<div class="qa-list">${questions
        .map((q) => {
          const preview = String(q.bullets?.[0] || q.answer || '').replace(/\s+/g, ' ').trim();
          const n = answerParas(q);
          return `
        <a class="qa-item" href="${esc(href(q.lang || 'ru', questionPath(asset, q)))}">
          <span class="qa-q">${esc(qaHeading(q))}${
            n ? ` <span class="qa-cnt" title="${esc(t('Абзацев в ответе: {n}', { n }))}">(${n})</span>` : ''
          }</span>
          ${preview ? `<span class="qa-a">${esc(preview.slice(0, 160))}${preview.length > 160 ? '…' : ''}</span>` : ''}
        </a>`;
        })
        .join('')}</div>`
    : `<p class="qa-empty">${esc(t('Вопросов пока нет. Задайте первый — ответ появится на отдельной странице и будет виден всем.'))}</p>`;

  return `
    <section class="qa" id="qa">
      <h2>${esc(
        asset.market === 'VIZ'
          ? t('Спросить ИИ-аналитика: {name}', { name: t(asset.name) })
          : t('Спросить ИИ-аналитика: {name} {symbol}', { name: niceName(asset.name), symbol: asset.symbol })
      )}</h2>
      <p class="lead">${esc(
        asset.market === 'VIZ'
          ? t('Ответ строится только на публикациях из подборки по этому инструменту. Вопрос и ответ публикуются — их увидят другие посетители и поисковые системы.')
          : t('Ответ строится только на публикациях из подборки по этому тикеру. Вопрос и ответ публикуются — их увидят другие посетители и поисковые системы.')
      )}</p>
      <form class="qa-form" method="post" action="${esc(formAction)}">
        <textarea name="question" rows="3" maxlength="300" required
          placeholder="${esc(t('Например: насколько выручка зависит от экспорта и что будет при укреплении рубля?'))}"></textarea>
        <div class="qa-actions">
          <span class="qa-hint"><span id="qa-count">0</span>${esc(t('/300 · без ссылок и контактов'))}</span>
          <button type="submit" class="btn">${esc(t('Спросить'))}</button>
        </div>
      </form>
      ${list}
    </section>`;
}

// ------------------------------------------------------------------ страница вопроса
// У инструмента «Графиков» нет тикера: символ — это слаг, и подпись
// «Доллар к рублю (USD-RUB)» читается как обозначение, а не как код бумаги.
// В разметке он тоже не Corporation: индексу и валютной паре это не подходит
const assetTag = (a) => (a.market === 'VIZ' ? t(a.short || a.name) : `${niceName(a.name)} (${a.symbol})`);
const aboutType = (a) => (a.market === 'VIZ' ? 'Thing' : a.market === 'CRYPTO' ? 'CryptoCurrency' : 'Corporation');

export function questionPage({ asset, rec, siteUrl, siteName, related = [], others = [] }) {
  const a = asset;

  // Источники двух видов: старые записи ссылаются на номера в rec.news,
  // новые несут готовые URL от поисковика. Поддерживаем оба, чтобы архив не ломался.
  const fromNews = (rec.refs || [])
    .map((n) => ({ item: (rec.news || [])[n - 1], n }))
    .filter(({ item }) => item?.link)
    .map(({ item, n }) => ({ url: item.link, title: item.title || '', src: item.source || '', anchor: `q-ref-${n}` }));

  const seen = new Set();
  const sources = [...(rec.sources || []), ...fromNews].filter((s) => {
    if (!s?.url || seen.has(s.url)) return false;
    seen.add(s.url);
    return true;
  });

  const hostOf = (u) => {
    try {
      return new URL(u).hostname.replace(/^www\./, '');
    } catch {
      return '';
    }
  };

  const refs = sources
    .map(
      (s) =>
        `<li${s.anchor ? ` id="${esc(s.anchor)}"` : ''}><a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer nofollow">${esc(s.title || hostOf(s.url))}</a> <span class="src">${esc(s.src || hostOf(s.url))}</span></li>`
    )
    .join('');

  const inText = (rec.refs || []).map((n) => `<a class="ref" href="#q-ref-${n}">[${n}]</a>`).join('');

  // Поисковые ответы приходят с номерами вида [3] прямо в тексте. Размечаем их ссылками
  // на якоря источников; номера без якоря (после склейки дублей) оставляем текстом.
  const anchored = new Set(sources.filter((s) => s.anchor).map((s) => s.anchor));
  const linkify = (text) =>
    text.replace(/\[(\d{1,2})\]/g, (m, d) => (anchored.has(`q-ref-${Number(d)}`) ? `<a class="ref" href="#q-ref-${Number(d)}">[${d}]</a>` : m));

  // Заголовок делает модель: в индексе не должно быть опечаток и сленга вопроса.
  // Вопрос всё равно показываем — под заголовком, как цитату.
  const heading = (rec.title || rec.question).trim();
  const description = `${heading} — ${t('ответ по')} ${assetTag(a)}: ${String(rec.answer || '').replace(/\s+/g, ' ').slice(0, 190)}`;

  const body = `
    <nav class="jump"><a href="${L('/')}">${esc(t('← Поиск'))}</a><a href="${L(tickerPath(a))}">${esc(t(a.name))}${a.market === 'VIZ' ? '' : ` (${esc(a.symbol)})`}</a><a href="${L(a.market === 'VIZ' ? '/charts' : '/catalog/' + MARKET_SLUG[a.market])}">${esc(t(MARKET_LABEL[a.market]) || '')}</a></nav>
    <h1 class="qa-h1">${esc(heading)}</h1>

    <article class="card qa-page">
      <div class="meta">
        <span class="pill hit">${esc(t(MARKET_LABEL[a.market]) || a.market)}</span>
        <span class="dot">•</span><span>${esc(a.symbol)}</span>
        <span class="dot">•</span><span>${fmtRelative(rec.askedAt)}</span>
        ${rec.tokens ? `<span class="dot">•</span><span>${esc(t('{n} токенов', { n: rec.tokens }))}</span>` : ''}
      </div>
      ${rec.title && rec.title !== rec.question ? `<p class="qa-asked">${esc(t('Вопрос посетителя: «{q}»', { q: rec.question }))}</p>` : ''}
      <div class="qa-answer">
        ${String(rec.answer || '')
          .split(/\n\s*\n/)
          .map((p) => `<p>${rec.mode === 'web' ? linkify(esc(p.trim())) : esc(p.trim())}</p>`)
          .join('')}
        ${inText ? `<p class="qa-refs">${esc(t('Источники:'))} ${inText}</p>` : ''}
      </div>
      ${
        rec.bullets?.length
          ? `<h3>${esc(t('Коротко'))}</h3><ul>${rec.bullets.map((b) => `<li>${rec.mode === 'web' ? linkify(esc(b)) : esc(b)}</li>`).join('')}</ul>`
          : ''
      }
      ${refs ? `<details><summary>${esc(t('Источники, на которые опирается ответ ({n})', { n: sources.length }))}</summary><ol class="news">${refs}</ol></details>` : ''}
      <p class="warn">${
        rec.mode === 'web'
          ? esc(t('Ответ подготовлен ИИ с поиском по открытым источникам {date} и не является инвестиционной рекомендацией. Номера в тексте — ссылки на список источников ниже.', { date: rec.askedAt ? `(${String(rec.askedAt).slice(0, 10)})` : '' }))
          : esc(t('Ответ подготовлен ИИ по публикациям за последние {hours} ч и не является инвестиционной рекомендацией.', { hours: rec.windowHours || 72 }))
      }
      ${esc(t('Полнота данных: {level}.', { level: t(CONF[rec.confidence] || 'средняя') }))}</p>
      <p style="margin-top:16px"><a href="${L(tickerPath(a))}">${esc(t('← Вся сводка по {name}', { name: t(a.name) }))}</a></p>
    </article>

    ${
      others.length
        ? `<section class="qa"><h2>${esc(
            a.market === 'VIZ'
              ? t('Ещё вопросы: {name}', { name: t(a.name) })
              : t('Ещё вопросы: {name} {symbol}', { name: niceName(a.name), symbol: a.symbol })
          )}</h2><div class="qa-list">${others
            .map(
              (q) =>
                `<a class="qa-item" href="${esc(questionPath(a, q))}"><span class="qa-q">${esc(qaHeading(q))}${
                  answerParas(q) ? ` <span class="qa-cnt" title="${esc(t('Абзацев в ответе: {n}', { n: answerParas(q) }))}">(${answerParas(q)})</span>` : ''
                }</span></a>`
            )
            .join('')}</div></section>`
        : ''
    }

    ${
      related.length
        ? `<div class="cat"><h2>${esc(t('Другие тикеры'))}</h2><div class="grid">${related
            .map((r) => `<a class="tl" href="${L(tickerPath(r))}" title="${esc(t('{name} — {kind} и новости', { name: niceName(r.name), kind: t(ASSET_KIND[r.market] || 'акции') }))}"><span class="s">${esc(r.symbol)}</span><span class="n">${esc(niceName(r.name))}</span></a>`)
            .join('')}</div></div>`
        : ''
    }`;

  const jsonLd = [
    {
      '@context': 'https://schema.org',
      '@type': 'QAPage',
      inLanguage: getLang(),
      mainEntity: {
        '@type': 'Question',
        name: heading,
        dateCreated: rec.askedAt,
        answerCount: 1,
        acceptedAnswer: {
          '@type': 'Answer',
          text: rec.answer + (rec.bullets?.length ? '\n\n' + rec.bullets.join('; ') : ''),
          dateCreated: rec.askedAt,
          upvoteCount: 1,
          author: { '@type': 'Organization', name: siteName },
        },
        about: { '@type': aboutType(a), name: a.name, ...(a.market === 'CRYPTO' ? {} : a.market === 'VIZ' ? {} : { tickerSymbol: a.symbol }) },
      },
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: t('Главная'), item: siteUrl + L('/') },
        { '@type': 'ListItem', position: 2, name: assetTag(a), item: siteUrl + L(tickerPath(a)) },
        { '@type': 'ListItem', position: 3, name: heading.slice(0, 90), item: siteUrl + L(questionPath(a, rec)) },
      ],
    },
  ];

  // Вопрос задан на одном языке и на нём же отвечен: переводить ответ значит
  // платить за вызов на каждую страницу, а показывать русский текст под
  // английским адресом — обманывать и читателя, и поисковик. Поэтому у страницы
  // один язык, и hreflang указывает только на него
  return page({
    siteUrl,
    title: `${heading.slice(0, 80)} — ${assetTag(a)}`,
    description,
    canonical: questionPath(a, rec),
    body,
    jsonLd,
    ogType: 'article',
    onlyLang: rec.lang || 'ru',
    active: 'faq',
  });
}

// Карточка «сводки ещё нет»: тикер есть в каталоге, но публикаций не хватило.
// Раньше этот HTML стоял инлайном в двух местах и расходился при правках.
export function noSummaryCard(a) {
  // «По этому тикеру» на странице индекса или валютной пары — не про то:
  // там нет тикера, а есть инструмент
  const empty =
    a.market === 'VIZ'
      ? t('По этому инструменту ещё нет готовой сводки: источники не дали достаточного числа публикаций за последние {hours} часа.', { hours: 72 })
      : t('По этому тикеру ещё нет готовой сводки: источники не дали достаточного числа публикаций за последние {hours} часа.', { hours: 72 });
  return `<div class="card" id="summary"><h2>${esc(niceName(a.name))} <span>${esc(symLabel(a))}</span></h2>
             <p style="color:var(--muted)">${esc(empty)}</p>
             <p><button class="refresh" id="refresh" data-next="" data-generate="1" data-symbol="${esc(a.symbol)}" data-market="${esc(a.market)}">${esc(t('↻ Попробовать собрать'))}</button></p>
             <div id="flash"></div></div>`;
}

// ------------------------------------------------------------------ блок дивидендов
const money = (n, cur) => {
  if (n === null || n === undefined) return '—';
  const sign = cur === 'USD' ? '$' : '';
  const tail = cur === 'USD' ? '' : ' ₽';
  // Копейки нужны не всегда: у Газпрома выплата 51,03, у Лукойла 535
  const digits = Math.abs(n) < 100 ? 2 : Math.abs(n) % 1 ? 2 : 0;
  return sign + n.toLocaleString(intlLocale(), { minimumFractionDigits: 0, maximumFractionDigits: digits }) + tail;
};

const fmtDate = (iso) =>
  iso
    ? new Date(iso + 'T00:00:00Z').toLocaleDateString(intlLocale(), {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      })
    : '—';

// Подписи к статусу выплаты. Совпадают с тем, что пишет dohod, но названы по-русски
const PAY_KIND = {
  paid: { label: 'выплачено', cls: 'paid' },
  recommended: { label: 'рекомендовано советом директоров', cls: 'rec' },
  forecast: { label: 'прогноз', cls: 'fc' },
};

export function dividendBlock({ asset, div }) {
  if (!div) return '';
  const nm = niceName(asset.name);
  const cur = div.currency || (asset.market === 'US' ? 'USD' : 'RUB');

  // Компания не платит — это тоже ответ на запрос «дивиденды <тикер>»,
  // поэтому говорим прямо, вместо того чтобы прятать блок
  if (div.pays === false) {
    return `
      <section class="card div-card" id="dividends">
        <h2>${esc(t('Дивиденды: {name} {symbol}', { name: nm, symbol: asset.symbol }))}</h2>
        <p style="color:var(--muted);margin:0">${esc(t('Компания не выплачивает дивиденды: в истории выплат нет ни одной записи.'))}</p>
      </section>`;
  }

  const next = div.next;
  // Прогноз за 12 месяцев дублирует ближайшую выплату, когда она и есть этот прогноз
  const showForecast =
    div.forecastNext && (!next || Math.abs(Number(div.forecastNext) - Number(next.amount)) > 0.005);
  const nextLine = next
    ? `<div class="div-next">
         <div class="div-amount">${esc(money(next.amount, cur))}</div>
         <div class="div-when">
           <span>${esc(next.kind === 'paid' ? t('дата отсечки') : t(PAY_KIND[next.kind]?.label || 'дата отсечки'))}</span>
           <b>${esc(fmtDate(next.registry || next.exDate))}</b>
         </div>
         ${showForecast ? `<div class="div-yield">${esc(t('прогноз за 12 мес: {amount}', { amount: money(div.forecastNext, cur) }))}</div>` : ''}
       </div>`
    : `<p style="color:var(--muted);margin:0">${esc(showForecast
        ? t('Объявленных выплат вперёд нет. Прогноз за 12 месяцев — {amount}.', { amount: money(div.forecastNext, cur) })
        : t('Объявленных выплат вперёд нет.'))}</p>`;

  const facts = [
    div.yieldPct !== null && div.yieldPct !== undefined ? `<div><span>${esc(t('Дивидендная доходность'))}</span><b>${esc(fmtNum(div.yieldPct, { maximumFractionDigits: 2 }))}%</b></div>` : '',
    div.payoutPct !== null && div.payoutPct !== undefined ? `<div><span>${esc(t('Доля от прибыли'))}</span><b>${esc(fmtNum(div.payoutPct, { maximumFractionDigits: 2 }))}%</b></div>` : '',
    div.dsi ? `<div><span>${esc(t('Индекс стабильности (DSI)'))}</span><b>${esc(fmtNum(div.dsi, { maximumFractionDigits: 2 }))}</b></div>` : '',
    div.years ? `<div><span>${esc(t('Лет роста выплат'))}</span><b>${esc(String(div.years))}</b></div>` : '',
    div.frequency ? `<div><span>${esc(t('Периодичность'))}</span><b>${esc(t(div.frequency))}</b></div>` : '',
  ]
    .filter(Boolean)
    .join('');

  // История: у dohod это выплаты с датой реестра, у США — с датой отсечки
  const rows = (div.payments || [])
    .slice(0, 12)
    .map((p) => {
      const date = p.registry || p.exDate;
      // У американских бумаг будущая отсечка приходит с тем же kind: «выплачено»
      // на завтрашнюю дату читается как ошибка, поэтому смотрим ещё и на дату
      const kind =
        p.kind === 'paid' && date && date > new Date().toISOString().slice(0, 10)
          ? { label: 'объявлена', cls: 'rec' }
          : PAY_KIND[p.kind] || PAY_KIND.paid;
      return `<tr>
        <td>${esc(fmtDate(date))}</td>
        <td class="num">${esc(money(p.amount, cur))}</td>
        <td>${p.year ? esc(String(p.year)) : '—'}</td>
        <td><span class="div-kind ${esc(kind.cls)}">${esc(t(kind.label))}</span></td>
      </tr>`;
    })
    .join('');

  // Годовые суммы: раньше — под раскрывающимся блоком, чтобы не растягивать страницу
  const years = (div.annual || [])
    .slice(0, 12)
    .map(
      (y) =>
        `<tr><td>${esc(String(y.year))}</td><td class="num">${esc(money(Math.round(y.amount * 100) / 100, cur))}</td><td>${y.changePct === null || y.changePct === undefined ? '—' : esc((y.changePct > 0 ? '+' : '') + String(y.changePct).replace('.', ',') + '%')}</td></tr>`
    )
    .join('');

  return `
      <section class="card div-card" id="dividends">
        <h2>${esc(t('Дивиденды: {name} {symbol}', { name: nm, symbol: asset.symbol }))}</h2>
        ${nextLine}
        ${facts ? `<div class="kv div-facts">${facts}</div>` : ''}
        ${
          rows
            ? `<h3>${esc(t('История выплат'))}</h3>
        <table class="div-table">
          <thead><tr><th>${esc(t('Дата отсечки'))}</th><th class="num">${esc(t('На акцию'))}</th><th>${esc(t('Год'))}</th><th>${esc(t('Статус'))}</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>`
            : ''
        }
        ${
          years
            ? `<details><summary>${esc(t('Суммы по годам'))}</summary>
        <table class="div-table">
          <thead><tr><th>${esc(t('Год'))}</th><th class="num">${esc(t('Выплачено'))}</th><th>${esc(t('Изм.'))}</th></tr></thead>
          <tbody>${years}</tbody>
        </table></details>`
            : ''
        }
        <p class="div-src">${esc(t('Источник: {src}', { src: asset.market === 'US' ? 'stockanalysis.com' : 'dohod.ru' }))}${
          div.forecastNext || (div.payments || []).some((p) => p.kind !== 'paid')
            ? '. ' + esc(t('Прогнозные и рекомендованные выплаты помечены — решения собрания акционеров по ним может ещё не быть'))
            : ''
        }.</p>
      </section>`;
}

// ------------------------------------------------------------------ страница тикера
export function tickerPage({ asset, rec, div = null, siteUrl, siteName, related = [], questions = [], error = '', forumHtml = '', chartHtml = '' }) {
  const a = asset;
  const s = rec ? localSummary(rec) : {};
  const marketLabel = t(MARKET_LABEL[a.market] || 'Актив');
  const kind = t(ASSET_KIND[a.market] || 'акции');
  const nm = niceName(a.name);
  const paysDiv = div && div.pays !== false && (div.payments?.length || div.annual?.length);
  // Название раздела в тексте: «форум акции Сбербанк» — родительный единственный,
  // потому что форум у каждой бумаги свой. Для крипты так не сказать
  const forumWord = t(a.market === 'CRYPTO' ? 'форум монеты' : 'форум акции');

  // Заголовки собираются из того, как актив ищут: «<название> акции», «<название> новости»,
  // «<название> акции форум», «дивиденды <название>». Слово «форум» уместно: ветки правда
  // лежат на этой странице, а дивиденды упоминаем только там, где они реально есть.
  // Заголовок — самая ценная строка для поиска, поэтому шаблон целиком в словаре,
  // а не собран из кусков: порядок слов в английском и испанском другой
  const title = paysDiv
    ? t('{name} ({symbol}) — {kind}, дивиденды и форум', { name: nm, symbol: a.symbol, kind })
    : t('{name} ({symbol}) — {kind}, новости и форум', { name: nm, symbol: a.symbol, kind });
  const h1 = title;

  const description = paysDiv && div.yieldPct
    ? t('Дивиденды {name} ({symbol}): доходность {yield}%, история выплат и даты закрытия реестра. {headline}', {
        name: nm,
        symbol: a.symbol,
        yield: fmtNum(div.yieldPct, { maximumFractionDigits: 2 }),
        headline: s.headline || '',
      }).slice(0, 290)
    : rec
      ? t('{name} ({symbol}): {headline} Публикации за {hours} ч, {forum} и ответы ИИ-аналитика. {overview}', {
          name: nm,
          symbol: a.symbol,
          headline: s.headline || t('сводка новостей'),
          hours: rec.windowHours || 72,
          forum: forumWord,
          overview: s.overview || '',
        }).slice(0, 290)
      : t('{name} ({symbol}), {market}: сводка новостей, {forum} и ответы ИИ-аналитика. Публикации за последние {hours} часа.', {
          name: nm,
          symbol: a.symbol,
          market: marketLabel.toLowerCase(),
          forum: forumWord,
          hours: 72,
        });

  // Два меню с разными задачами. Верхнее — по сайту, оно над заголовком: человек,
  // пришедший из поиска на «Газпром», должен увидеть, куда ещё можно пойти.
  // Нижнее — по самой странице: длинная страница тикера без него требует прокрутки.
  // Ссылки появляются только на те блоки, которые реально отрисованы.
  const jump = [
    chartHtml ? `<a href="#chart">${esc(t('График'))}</a>` : '',
    rec ? `<a href="#summary">${esc(t('Сводка'))}</a>` : '',
    // «Форум» ищут чаще, чем «обсуждение»: слово из заголовка блока и адреса
    forumHtml.includes('id="forum"') ? `<a href="#forum">${esc(t('Форум'))}</a>` : '',
    `<a href="#qa">${esc(t('Вопрос аналитику'))}</a>`,
    div ? `<a href="#dividends">${esc(t('Дивиденды'))}</a>` : '',
  ]
    .filter(Boolean)
    .join('');

  const body = `
    <h1>${esc(h1)}</h1>
    <nav class="jump">${jump}</nav>
    ${error ? `<div class="notice">${esc(error)}</div>` : ''}
    ${chartHtml}
    ${rec ? summaryCard(rec) : noSummaryCard(a)}
    ${forumHtml}
    ${qaBlock({ asset: a, questions, formAction: L(`${tickerPath(a)}/ask`) })}
    ${dividendBlock({ asset: a, div })}
    ${
      related.length
        ? `<div class="cat" id="related"><h2>${esc(t('Другие тикеры'))}</h2><div class="grid">${related
            .map((r) => `<a class="tl" href="${L(tickerPath(r))}" title="${esc(t('{name} — {kind} и новости', { name: niceName(r.name), kind: t(ASSET_KIND[r.market] || 'акции') }))}"><span class="s">${esc(r.symbol)}</span><span class="n">${esc(niceName(r.name))}</span></a>`)
            .join('')}</div></div>`
        : ''
    }`;

  // Хлебные крошки нужны любой странице, а не только той, где есть сводка.
  // NewsArticle добавляем лишь при наличии статьи: без неё разметка была бы ложной
  const crumb = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: t('Главная'), item: siteUrl + L('/') },
      { '@type': 'ListItem', position: 2, name: marketLabel, item: siteUrl + L(`/catalog/${MARKET_SLUG[a.market]}`) },
      { '@type': 'ListItem', position: 3, name: `${a.name} (${a.symbol})`, item: siteUrl + L(tickerPath(a)) },
    ],
  };

  const jsonLd = rec
    ? [
        {
          '@context': 'https://schema.org',
          '@type': 'NewsArticle',
          headline: s.headline || t('{name}: сводка новостей', { name: a.name }),
          description: (s.overview || '').slice(0, 300),
          datePublished: rec.generatedAt,
          dateModified: rec.generatedAt,
          inLanguage: getLang(),
          mainEntityOfPage: { '@type': 'WebPage', '@id': siteUrl + L(tickerPath(a)) },
          author: { '@type': 'Organization', name: siteName },
          publisher: { '@type': 'Organization', name: siteName },
          about: {
            '@type': a.market === 'CRYPTO' ? 'CryptoCurrency' : 'Corporation',
            name: a.name,
            ...(a.market === 'CRYPTO' ? {} : { tickerSymbol: a.symbol }),
          },
        },
        crumb,
      ]
    : [crumb];

  return page({
    siteUrl,
    title,
    description,
    canonical: tickerPath(a),
    body,
    jsonLd,
    ogType: 'article',
    // Без новостной сводки страница обычно пустая и в индекс ей рано, но блок
    // дивидендов — самостоятельный полезный контент: такие страницы индексируем
    noindex: !rec && !paysDiv,
  });
}

// ------------------------------------------------------------------ каталог
// Русский алфавит: латинские названия идут после кириллицы, внутри — по алфавиту
const sortKey = (name) => String(name).toLowerCase().replace(/[«»"'()]/g, '').replace(/^[^a-zа-яё0-9]+/i, '');

// Сортируем и режем по первой букве уже переведённого имени: на английской
// странице кириллический алфавит рассыпался бы на «А, Б, В» посреди латиницы
export function groupByLetter(items) {
  const groups = new Map();
  const key = (a) => sortKey(t(niceName(a.name)));
  for (const a of [...items].sort((x, y) => key(x).localeCompare(key(y), intlLocale()))) {
    const letter = (key(a)[0] || '#').toUpperCase();
    if (!groups.has(letter)) groups.set(letter, []);
    groups.get(letter).push(a);
  }
  return [...groups.entries()];
}

export function catalogSection(market, items, siteUrl, withLead = true) {
  const groups = groupByLetter(items);
  return `
      <section class="cat" id="${MARKET_SLUG[market]}">
        <h2>${esc(t(MARKET_LABEL[market]))} <span class="cnt">${items.length} ${numPlural(items.length, t('тикер'), t('тикера'), t('тикеров'))}</span></h2>
        ${withLead ? `<p class="lead">${esc(t(MARKET_LEAD[market]))}</p>` : ''}
        ${groups
          .map(
            ([letter, arr]) => `
          <div class="letters">
            <div class="lt">${esc(letter)}</div>
            <div class="grid">${arr
              .map(
                (a) =>
                  `<a class="tl" href="${L(tickerPath(a))}" title="${esc(t('{name} — {kind} и новости', { name: niceName(a.name), kind: t(ASSET_KIND[a.market] || 'акции') }))}"><span class="s">${esc(a.symbol)}</span><span class="n">${esc(niceName(a.name))}</span></a>`
              )
              .join('')}</div>
          </div>`
          )
          .join('')}
      </section>`;
}

const MARKET_LEAD = {
  RU: 'Бумаги индекса Мосбиржи: нефть и газ, банки, металлургия, ритейл, телеком, девелопмент.',
  US: 'Крупнейшие по капитализации компании США: технологии, полупроводники, здравоохранение, финансы, потребительский сектор.',
  CRYPTO: 'Монеты с наибольшей капитализацией, без стейблкоинов и обёрнутых версий.',
};

// Вводный абзац категории пишется под то, как ищут: «акции Мосбиржи», «котировки акций США».
// Поисковик берёт из него контекст страницы, а посетитель — что здесь вообще есть.
const MARKET_INTRO = {
  RU: 'Сводки новостей и обсуждения по акциям Мосбиржи: цены, отчётность, дивиденды и события по каждой бумаге индекса. У каждого тикера — свежая подборка публикаций, ветки форума и ответы ИИ-аналитика.',
  US: 'Сводки новостей и обсуждения по акциям США: отчётности крупнейших компаний, прогнозы и события, влияющие на цену. По каждому тикеру — публикации за последние дни, форум и вопросы к аналитику.',
  CRYPTO: 'Сводки новостей и обсуждения по криптовалютам: курсы, движения рынка и события по монетам с наибольшей капитализацией. По каждому тикеру — свежие публикации, форум и ответы ИИ-аналитика.',
};

export function catalogPage({ groups, siteUrl, siteName, market = null }) {
  const markets = market ? [market] : ['RU', 'US', 'CRYPTO'];
  const total = markets.reduce((n, m) => n + (groups[m] || []).length, 0);
  const title = market ? t('Каталог: {market}', { market: t(MARKET_TITLE[market]) }) : t('Каталог тикеров');
  const description = market
    ? t('{market}: {n} {tickers} — новости, обсуждения и вопросы к ИИ-аналитику. {lead}', {
        market: t(MARKET_LABEL[market]),
        n: total,
        tickers: numPlural(total, t('тикер'), t('тикера'), t('тикеров')),
        lead: t(MARKET_LEAD[market]),
      })
    : t('Каталог из {n} тикеров со сводками новостей: акции Мосбиржи, акции США и криптовалюты. Списки по алфавиту для каждой категории.', { n: total });

  const body = `
    <h1>${esc(title)}</h1>
    <p class="lead" style="color:var(--muted);font-size:14px">${esc(description)}</p>
    ${market ? `<p class="lead" style="color:var(--muted);font-size:14px">${esc(t(MARKET_INTRO[market] || MARKET_LEAD[market]))}</p>` : ''}
    ${markets.map((m) => catalogSection(m, groups[m] || [], siteUrl, m !== market)).join('\n')}`;

  const canonical = market ? `/catalog/${MARKET_SLUG[market]}` : '/catalog';
  const jsonLd = [
    {
      '@context': 'https://schema.org',
      '@type': 'CollectionPage',
      name: title,
      description,
      url: siteUrl + L(canonical),
      inLanguage: getLang(),
      mainEntity: {
        '@type': 'ItemList',
        numberOfItems: total,
        itemListElement: markets
          .flatMap((m) => groups[m] || [])
          .slice(0, 200)
          .map((a, i) => ({
            '@type': 'ListItem',
            position: i + 1,
            name: `${a.name} (${a.symbol})`,
            url: siteUrl + L(tickerPath(a)),
          })),
      },
    },
  ];

  return page({ siteUrl, title, description, canonical, body, jsonLd, active: 'home' });
}

// Статус будущей выплаты для календаря. «Выплачено» здесь было бы неправдой:
// строка попадает в календарь только если дата ещё не прошла
const nextStatus = (p) => {
  if (p.kind === 'recommended') return t('рекомендовано советом директоров');
  if (p.kind === 'forecast') return t('прогноз');
  return t('объявлена');
};

// ------------------------------------------------------------------ страница дивидендов
// Сводная таблица по всем бумагам: календарь ближайших отсечек и сортировка по
// доходности. Нужна и человеку, и как источник внутренних ссылок на страницы тикеров.
export function dividendsPage({ items, siteUrl, siteName }) {
  const rows = items
    .filter((x) => x.div && x.div.pays !== false)
    .map((x) => ({ ...x, cur: x.div.currency || (x.asset.market === 'US' ? 'USD' : 'RUB') }));

  const withNext = rows
    .filter((x) => x.div.next)
    .sort((a, b) =>
      String(a.div.next.registry || a.div.next.exDate).localeCompare(String(b.div.next.registry || b.div.next.exDate))
    );
  const withYield = rows
    .filter((x) => typeof x.div.yieldPct === 'number' && x.div.yieldPct > 0)
    .sort((a, b) => b.div.yieldPct - a.div.yieldPct);

  const link = (x) =>
    `<a href="${L(tickerPath(x.asset))}#dividends">${esc(niceName(x.asset.name))}</a> <span class="sym">${esc(x.asset.symbol)}</span>`;

  const nextTable = withNext
    .map(
      (x) => `<tr>
        <td>${esc(fmtDate(x.div.next.registry || x.div.next.exDate))}</td>
        <td>${link(x)}</td>
        <td class="num">${esc(money(x.div.next.amount, x.cur))}</td>
        <td>${esc(nextStatus(x.div.next))}</td>
      </tr>`
    )
    .join('');

  const yieldTable = withYield
    .slice(0, 60)
    .map(
      (x) => `<tr>
        <td>${link(x)}</td>
        <td class="num">${esc(fmtNum(x.div.yieldPct, { maximumFractionDigits: 2 }))}%</td>
        <td class="num">${esc(money(x.div.forecastNext, x.cur))}</td>
        <td class="num">${
          x.div.payoutPct === null || x.div.payoutPct === undefined ? '—' : esc(fmtNum(x.div.payoutPct, { maximumFractionDigits: 2 }) + '%')
        }</td>
      </tr>`
    )
    .join('');

  const title = t('Дивиденды акций — календарь выплат и доходность');
  const description = t('Календарь дивидендов по {n} бумагам Мосбиржи и США: даты закрытия реестра, размер выплаты на акцию и дивидендная доходность. Данные с dohod.ru и stockanalysis.com.', { n: rows.length });

  const body = `
    <h1>${esc(t('Дивиденды акций: календарь выплат и доходность'))}</h1>
    <p class="lead" style="color:var(--muted);font-size:14px">${esc(t('Ближайшие даты закрытия реестра и текущая дивидендная доходность по бумагам, которые платят дивиденды. По каждой компании есть история выплат на её странице. Источники: dohod.ru для Мосбиржи, stockanalysis.com для США.'))}</p>

    <section class="card">
      <h2>${esc(t('Ближайшие дивиденды'))} <span class="cnt">${withNext.length}</span></h2>
      ${
        nextTable
          ? `<table class="div-table">
        <thead><tr><th>${esc(t('Дата отсечки'))}</th><th>${esc(t('Бумага'))}</th><th class="num">${esc(t('На акцию'))}</th><th>${esc(t('Статус'))}</th></tr></thead>
        <tbody>${nextTable}</tbody>
      </table>`
          : `<p style="color:var(--muted)">${esc(t('Объявленных выплат вперёд сейчас нет.'))}</p>`
      }
      <p class="div-src">${esc(t('Прогнозные и рекомендованные выплаты помечены: окончательного решения собрания акционеров по ним может ещё не быть.'))}</p>
    </section>

    <section class="card">
      <h2>${esc(t('Самые высокие дивиденды'))}</h2>
      <table class="div-table">
        <thead><tr><th>${esc(t('Бумага'))}</th><th class="num">${esc(t('Доходность'))}</th><th class="num">${esc(t('За 12 мес'))}</th><th class="num">${esc(t('Доля прибыли'))}</th></tr></thead>
        <tbody>${yieldTable}</tbody>
      </table>
      <p class="div-src">${esc(t('Доходность считается к текущей цене на момент сбора данных и меняется вместе с ней.'))}</p>
    </section>`;

  const jsonLd = [
    {
      '@context': 'https://schema.org',
      '@type': 'CollectionPage',
      name: title,
      description,
      url: `${siteUrl}${L('/dividends')}`,
      inLanguage: getLang(),
      mainEntity: {
        '@type': 'ItemList',
        numberOfItems: rows.length,
        itemListElement: rows.slice(0, 200).map((x, i) => ({
          '@type': 'ListItem',
          position: i + 1,
          name: `${niceName(x.asset.name)} (${x.asset.symbol})`,
          url: siteUrl + L(tickerPath(x.asset)),
        })),
      },
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: t('Главная'), item: siteUrl + L('/') },
        { '@type': 'ListItem', position: 2, name: t('Каталог тикеров'), item: siteUrl + L('/catalog') },
        { '@type': 'ListItem', position: 3, name: t('Дивиденды'), item: siteUrl + L('/dividends') },
      ],
    },
  ];

  return page({ siteUrl, title, description, canonical: '/dividends', body, jsonLd });
}

// ------------------------------------------------------------------ главная
export function homePage({ siteUrl, siteName, groups, cached, refreshedAt, indicesHtml = '', rankHtml = '', tab = 'all', tabMarkets = null }) {
  const total = ['RU', 'US', 'CRYPTO'].reduce((n, m) => n + (groups[m] || []).length, 0);
  // Страница давно не только про сводки: сверху таблица по капитализации с ценой
  // и изменением за день, а новости — один из блоков страницы тикера. Заголовок
  // называет то, что человек видит первым, иначе он обещает не то, что отдаёт
  const description = t('Курсы и капитализация акций Мосбиржи, акций США и криптовалют: {n} тикеров в одной таблице — цена, изменение за день и капитализация. По каждому — сводка новостей за 72 часа, дивиденды, график, форум и ответы ИИ-аналитика. Поиск по названию или тикеру.', { n: total });

  // Вкладки по рынкам — та же главная, но с одной категорией. Заголовок и
  // описание у них свои: иначе поисковик увидит четыре почти одинаковые
  // страницы, и ни одна не попадёт в выдачу по «акции США по капитализации»
  const TABS_META = {
    all: {
      title: t('{site} — курсы, капитализация и новости акций и криптовалют', { site: SITE_NAME }),
      heading: t('Курсы, капитализация и новости акций и криптовалют'),
      canonical: '/',
    },
    us: {
      title: t('Акции США по капитализации — курсы, новости и форум'),
      heading: t('Акции США по капитализации'),
      canonical: '/?tab=us',
      description: t('Крупнейшие компании США по капитализации: цена, изменение за день и новости по каждой. Публикации за 72 часа, форум и ответы ИИ-аналитика.'),
    },
    ru: {
      title: t('Акции Мосбиржи по капитализации — курсы, новости и форум'),
      heading: t('Акции Мосбиржи по капитализации'),
      canonical: '/?tab=ru',
      description: t('Бумаги Мосбиржи по капитализации: цена, изменение за день и новости по каждой. Публикации за 72 часа, дивиденды, форум и ответы ИИ-аналитика.'),
    },
    crypto: {
      title: t('Криптовалюты по капитализации — курсы, новости и форум'),
      heading: t('Криптовалюты по капитализации'),
      canonical: '/?tab=crypto',
      description: t('Монеты с наибольшей капитализацией: цена, изменение за день и новости по каждой. Без стейблкоинов и обёрнутых версий. Публикации за 72 часа и форум.'),
    },
  };

  const meta = TABS_META[tab] || TABS_META.all;

  // Каталог целиком: ссылки нужны поисковику и человеку, который не хочет искать.
  // Длинные списки сворачиваем в <details>, чтобы страница не растягивалась на метры.
  // На вкладке — только её рынок: иначе четыре адреса несут одни и те же 200 ссылок,
  // и поисковик видит три копии главной
  const catalog = (tabMarkets || ['RU', 'US', 'CRYPTO'])
    .map((m) => {
      const items = groups[m] || [];
      if (!items.length) return '';
      const groupsByLetter = groupByLetter(items);
      return `
      <details class="cat" id="${MARKET_SLUG[m]}">
        <summary><h2 style="display:inline">${esc(t(MARKET_LABEL[m]))} <span class="cnt">${items.length} ${numPlural(items.length, t('тикер'), t('тикера'), t('тикеров'))}</span></h2></summary>
        <p class="lead">${esc(t(MARKET_LEAD[m]))}</p>
        ${groupsByLetter
          .map(
            ([letter, arr]) => `
          <div class="letters">
            <div class="lt">${esc(letter)}</div>
            <div class="grid">${arr
              .map(
                (a) =>
                  `<a class="tl" href="${L(tickerPath(a))}" title="${esc(t('{name} — {kind} и новости', { name: niceName(a.name), kind: t(ASSET_KIND[a.market] || 'акции') }))}"><span class="s">${esc(a.symbol)}</span><span class="n">${esc(niceName(a.name))}</span></a>`
              )
              .join('')}</div>
          </div>`
          )
          .join('')}
        <p style="margin-top:12px"><a href="${L('/catalog/' + MARKET_SLUG[m])}">${esc(t('Открыть отдельной страницей →'))}</a></p>
      </details>`;
    })
    .join('');

  // Число для подзаголовка и для абзаца над каталогом: на вкладке это только
  // её рынки, иначе «210 тикеров» стояло бы и над списком из 117 ссылок
  const shownTotal = (tabMarkets || ['RU', 'US', 'CRYPTO']).reduce((sum, m) => sum + (groups[m] || []).length, 0);

  const body = `
    <h1>${esc(meta.heading)}</h1>

    ${rankHtml}


    <p class="sub" style="margin-top:26px">${esc(t('Ниже — полный список по алфавиту: {n} {tickers}.', { n: shownTotal, tickers: numPlural(shownTotal, t('тикер'), t('тикера'), t('тикеров')) }))}${
      refreshedAt ? ' ' + esc(t('Сводки обновлены {when}.', { when: fmtRelative(refreshedAt) })) : ''
    }</p>
    <p class="sub">${esc(t('Обсудить бумагу можно прямо на её странице — под сводкой есть форум по тикеру.'))}</p>

    <div id="recent" class="recent">${
      cached.length
        ? `<span>${esc(t('Обновлено недавно:'))}</span>` +
          cached
            .slice(0, 14)
            .map(
              (c) =>
                `<a class="chip" href="${L(tickerPath(c.asset))}" title="${esc(localSummary(c).headline || niceName(c.asset.name))}">${esc(c.asset.symbol)}</a>`
            )
            .join('')
        : ''
    }</div>

    ${indicesHtml}

    ${catalog}`;

  const jsonLd = [
    {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: siteName,
      url: siteUrl,
      inLanguage: getLang(),
      description,
      potentialAction: {
        '@type': 'SearchAction',
        target: { '@type': 'EntryPoint', urlTemplate: `${siteUrl}${L('/')}?q={search_term_string}` },
        'query-input': 'required name=search_term_string',
      },
    },
    {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: siteName,
      url: siteUrl,
    },
  ];

  return page({
    siteUrl,
    title: meta.title,
    description: meta.description || description,
    canonical: meta.canonical,
    body,
    jsonLd,
    active: 'home',
  });
}

// ------------------------------------------------------------------ служебные страницы
export function notFoundPage({ siteUrl, siteName }) {
  return page({
    siteUrl,
    title: t('Страница не найдена'),
    description: t('Такого тикера нет в каталоге. Откройте каталог или воспользуйтесь поиском.'),
    canonical: '/404',
    noindex: true,
    body: `
    <h1><a href="${L('/')}">${esc(siteName)}</a></h1>
    <div class="card">
      <h2>${esc(t('Страница не найдена'))}</h2>
      <p style="color:var(--muted)">${esc(t('Такого тикера нет в каталоге — возможно, он не входит в список или в названии опечатка.'))}</p>
      <p><a href="${L('/catalog')}">${esc(t('Открыть каталог тикеров'))}</a> ${esc(t('или'))} <a href="${L('/')}">${esc(t('воспользоваться поиском'))}</a>.</p>
    </div>`,
  });
}
