// Рендер HTML на сервере: страницы тикеров и каталог должны быть видны поисковикам
// целиком, без исполнения JS. Один рендерер на страницу — клиент только обновляет её целиком.

export const SITE_NAME = '$BOTHUB Аналитика';
export const MARKET_LABEL = { RU: 'Акции Мосбиржи', US: 'Акции США', CRYPTO: 'Криптовалюты' };
export const MARKET_SLUG = { RU: 'ru', US: 'us', CRYPTO: 'crypto' };
export const SLUG_MARKET = { ru: 'RU', us: 'US', crypto: 'CRYPTO' };

// Как называть актив в заголовках: люди ищут «акции Газпрома», «котировки биткоина»
export const ASSET_KIND = { RU: 'акции', US: 'акции', CRYPTO: 'котировки' };

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

export function fmtRelative(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 60000;
  if (diff < 1) return 'только что';
  if (diff < 60) return `${Math.round(diff)} мин назад`;
  if (diff < 1440) return `${Math.round(diff / 60)} ч назад`;
  return d.toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
}

const fmtFull = (iso) =>
  iso ? new Date(iso).toLocaleString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';

export const tickerPath = (asset) => `/ticker/${MARKET_SLUG[asset.market] || 'us'}/${encodeURIComponent(asset.symbol)}`;

// Биржа отдаёт часть имён капсом («ГАЗПРОМ», «ЛУКОЙЛ»). В заголовке это выглядит криком,
// но аббревиатуры (ВТБ, МТС, ЮГК) и написания вроде «ДОМ.РФ» трогать нельзя.
export function niceName(name = '') {
  const n = String(name).trim();
  if (n.length < 5 || n !== n.toUpperCase() || /[.\d]/.test(n)) return n;
  return n.charAt(0) + n.slice(1).toLowerCase();
}

// Вопрос живёт по адресу с hash-префиксом и читаемым хвостом: URL остаётся стабильным,
// даже если вопрос переформулируют, а человек видит, о чём страница
export const questionPath = (asset, rec) =>
  `/q/${MARKET_SLUG[asset.market] || 'us'}/${encodeURIComponent(asset.symbol)}/${rec.id}`;

// ------------------------------------------------------------------ оболочка
export function page({ siteUrl, title, description, canonical, body, jsonLd = [], ogType = 'website', ogImage, noindex = false, head = '' }) {
  const fullTitle = title.includes(SITE_NAME) ? title : `${title} — ${SITE_NAME}`;
  const desc = description.length > 300 ? description.slice(0, 297) + '…' : description;
  const ld = jsonLd
    .filter(Boolean)
    // В JSON-LD попадает текст посетителей: без экранирования `</script>` закрывает блок
    // и всё, что идёт дальше, исполняется как разметка страницы
    .map((o) => `<script type="application/ld+json">${JSON.stringify(o).replace(/[<>&\u2028\u2029]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)}</script>`)
    .join('\n  ');

  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(fullTitle)}</title>
  <meta name="description" content="${esc(desc)}" />
  <link rel="canonical" href="${esc(siteUrl + canonical)}" />
  ${noindex ? '<meta name="robots" content="noindex, follow" />' : '<meta name="robots" content="index, follow, max-image-preview:large" />'}
  <meta property="og:site_name" content="${esc(SITE_NAME)}" />
  <meta property="og:type" content="${esc(ogType)}" />
  <meta property="og:title" content="${esc(fullTitle)}" />
  <meta property="og:description" content="${esc(desc)}" />
  <meta property="og:url" content="${esc(siteUrl + canonical)}" />
  <meta property="og:locale" content="ru_RU" />
  ${ogImage ? `<meta property="og:image" content="${esc(siteUrl + ogImage)}" />` : ''}
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${esc(fullTitle)}" />
  <meta name="twitter:description" content="${esc(desc)}" />
  <meta name="theme-color" content="#0d1117" />
  <link rel="stylesheet" href="/app.css" />
  ${head}
  ${ld}
</head>
<body>
  <div class="wrap" id="top">
${body}
    <a class="totop" href="#top" title="Вернуться к началу страницы">↑<span> Наверх</span></a>
    <noscript><style>.totop { opacity: 1; visibility: visible; transform: none; }</style></noscript>
    <div class="foot">
      <p>Обсуждения — на странице каждого тикера. <a href="/catalog">Каталог тикеров</a> · <a href="/indices">Индексы</a> · <a href="/dividends">Дивиденды</a> · <a href="/forum/rules">Правила обсуждений</a>.</p>
      <p>Сервис собирает публикации из Bing News, Yahoo Finance, Reddit, Финама, Smart-Lab и новостей Мосбиржи
      и делает по ним сводку моделью ${esc('claude-haiku-5.5')}. Данные обновляются раз в сутки.</p>
      <p>Материалы сервиса — не инвестиционная рекомендация.</p>
    </div>
  </div>
  <script src="/app.js" defer></script>
</body>
</html>`;
}

// ------------------------------------------------------------------ элементы
function summaryCard(rec, { notice = '' } = {}) {
  const s = rec.summary || {};
  const a = rec.asset;
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
            <h2>${esc(niceName(a.name))} <span>${esc(a.symbol)}</span></h2>
            ${s.sentiment ? `<span class="sent ${esc(s.sentiment)}">${SENT[s.sentiment] || esc(s.sentiment)}</span>` : ''}
            <button class="refresh" id="refresh" data-next="${esc(rec.nextRefreshAt || '')}" data-symbol="${esc(a.symbol)}" data-market="${esc(a.market)}">↻ Обновить</button>
          </div>
          <div class="meta">
            <span class="pill hit">обновлено ${fmtRelative(rec.generatedAt)}</span>
            <span class="dot">•</span><span>${fmtFull(rec.generatedAt)}</span>
            <span class="dot">•</span><span>${(rec.news || []).length} ${plural((rec.news || []).length, 'публикация', 'публикации', 'публикаций')} за ${rec.windowHours || 72} ч</span>
            ${s.confidence ? `<span class="dot">•</span><span>полнота данных: ${CONF[s.confidence] || esc(s.confidence)}</span>` : ''}
          </div>

          ${notice ? `<div class="notice">${esc(notice)}</div>` : ''}
          <div id="flash"></div>

          ${s.headline ? `<div class="headline">${esc(s.headline)}</div>` : ''}
          ${s.overview ? `<p>${esc(s.overview)}</p>` : ''}

          ${
            s.key_points?.length
              ? `<h3>Ключевое</h3><ul>${s.key_points
                  .map((k) => {
                    const text = typeof k === 'string' ? k : k.text;
                    return `<li>${esc(text)}${refs(typeof k === 'object' ? k.refs : null)}</li>`;
                  })
                  .join('')}</ul>`
              : ''
          }

          <div class="cols">
            <div><h3>Риски</h3>${list(s.risks)}</div>
            <div class="cats"><h3>Драйверы роста</h3>${list(s.catalysts)}</div>
          </div>

          ${s.community ? `<h3>Что обсуждают в сообществе</h3><div class="community">${esc(s.community)}</div>` : ''}

          ${rec.warnings?.length ? `<div class="warn">Не ответили источники: ${rec.warnings.map((w) => `<code>${esc(w)}</code>`).join(', ')}</div>` : ''}

          <details>
            <summary>Источники и публикации (${(rec.news || []).length})</summary>
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

function qaBlock({ asset, questions, formAction }) {
  const list = questions.length
    ? `<div class="qa-list">${questions
        .map((q) => {
          const preview = String(q.bullets?.[0] || q.answer || '').replace(/\s+/g, ' ').trim();
          const n = answerParas(q);
          return `
        <a class="qa-item" href="${esc(questionPath(asset, q))}">
          <span class="qa-q">${esc(qaHeading(q))}${
            n ? ` <span class="qa-cnt" title="Абзацев в ответе: ${n}">(${n})</span>` : ''
          }</span>
          ${preview ? `<span class="qa-a">${esc(preview.slice(0, 160))}${preview.length > 160 ? '…' : ''}</span>` : ''}
        </a>`;
        })
        .join('')}</div>`
    : `<p class="qa-empty">Вопросов пока нет. Задайте первый — ответ появится на отдельной странице и будет виден всем.</p>`;

  return `
    <section class="qa" id="qa">
      <h2>Спросить ИИ-аналитика: ${esc(niceName(asset.name))} <span>${esc(asset.symbol)}</span></h2>
      <p class="lead">Ответ строится только на публикациях из подборки по этому тикеру. Вопрос и ответ публикуются — их увидят другие посетители и поисковые системы.</p>
      <form class="qa-form" method="post" action="${esc(formAction)}">
        <textarea name="question" rows="3" maxlength="300" required
          placeholder="Например: насколько выручка зависит от экспорта и что будет при укреплении рубля?"></textarea>
        <div class="qa-actions">
          <span class="qa-hint"><span id="qa-count">0</span>/300 · без ссылок и контактов</span>
          <button type="submit" class="btn">Спросить</button>
        </div>
      </form>
      ${list}
    </section>`;
}

// ------------------------------------------------------------------ страница вопроса
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
  const description = `${heading} — ответ по ${a.name} (${a.symbol}): ${String(rec.answer || '').replace(/\s+/g, ' ').slice(0, 190)}`;

  const body = `
    <div class="logo"><a href="/">${esc(SITE_NAME)}</a></div>
    <nav class="nav"><a href="/">← Поиск</a><a href="${esc(tickerPath(a))}">${esc(a.name)} (${esc(a.symbol)})</a><a href="/catalog/${MARKET_SLUG[a.market]}">${esc(MARKET_LABEL[a.market] || '')}</a></nav>
    <h1 class="qa-h1">${esc(heading)}</h1>

    <article class="card qa-page">
      <div class="meta">
        <span class="pill hit">${esc(MARKET_LABEL[a.market] || a.market)}</span>
        <span class="dot">•</span><span>${esc(a.symbol)}</span>
        <span class="dot">•</span><span>${fmtRelative(rec.askedAt)}</span>
        ${rec.tokens ? `<span class="dot">•</span><span>${esc(String(rec.tokens))} токенов</span>` : ''}
      </div>
      ${rec.title && rec.title !== rec.question ? `<p class="qa-asked">Вопрос посетителя: «${esc(rec.question)}»</p>` : ''}
      <div class="qa-answer">
        ${String(rec.answer || '')
          .split(/\n\s*\n/)
          .map((p) => `<p>${rec.mode === 'web' ? linkify(esc(p.trim())) : esc(p.trim())}</p>`)
          .join('')}
        ${inText ? `<p class="qa-refs">Источники: ${inText}</p>` : ''}
      </div>
      ${
        rec.bullets?.length
          ? `<h3>Коротко</h3><ul>${rec.bullets.map((b) => `<li>${rec.mode === 'web' ? linkify(esc(b)) : esc(b)}</li>`).join('')}</ul>`
          : ''
      }
      ${refs ? `<details><summary>Источники, на которые опирается ответ (${sources.length})</summary><ol class="news">${refs}</ol></details>` : ''}
      <p class="warn">${
        rec.mode === 'web'
          ? `Ответ подготовлен ИИ с поиском по открытым источникам ${rec.askedAt ? `(${esc(String(rec.askedAt).slice(0, 10))})` : ''} и не является инвестиционной рекомендацией. Номера в тексте — ссылки на список источников ниже.`
          : `Ответ подготовлен ИИ по публикациям за последние ${rec.windowHours || 72} ч и не является инвестиционной рекомендацией.`
      }
      Полнота данных: ${CONF[rec.confidence] || 'средняя'}.</p>
      <p style="margin-top:16px"><a href="${esc(tickerPath(a))}">← Вся сводка по ${esc(a.name)}</a></p>
    </article>

    ${
      others.length
        ? `<section class="qa"><h2>Ещё вопросы: ${esc(niceName(a.name))} <span>${esc(a.symbol)}</span></h2><div class="qa-list">${others
            .map(
              (q) =>
                `<a class="qa-item" href="${esc(questionPath(a, q))}"><span class="qa-q">${esc(qaHeading(q))}${
                  answerParas(q) ? ` <span class="qa-cnt" title="Абзацев в ответе: ${answerParas(q)}">(${answerParas(q)})</span>` : ''
                }</span></a>`
            )
            .join('')}</div></section>`
        : ''
    }

    ${
      related.length
        ? `<div class="cat"><h2>Другие тикеры</h2><div class="grid">${related
            .map((r) => `<a class="tl" href="${esc(tickerPath(r))}" title="${esc(niceName(r.name))} — ${ASSET_KIND[r.market] || 'акции'} и новости"><span class="s">${esc(r.symbol)}</span><span class="n">${esc(niceName(r.name))}</span></a>`)
            .join('')}</div></div>`
        : ''
    }`;

  const jsonLd = [
    {
      '@context': 'https://schema.org',
      '@type': 'QAPage',
      inLanguage: 'ru',
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
        about: { '@type': 'Corporation', name: a.name, tickerSymbol: a.symbol },
      },
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Главная', item: siteUrl + '/' },
        { '@type': 'ListItem', position: 2, name: `${a.name} (${a.symbol})`, item: siteUrl + tickerPath(a) },
        { '@type': 'ListItem', position: 3, name: heading.slice(0, 90), item: siteUrl + questionPath(a, rec) },
      ],
    },
  ];

  return page({
    siteUrl,
    title: `${heading.slice(0, 80)} — ${niceName(a.name)} (${a.symbol})`,
    description,
    canonical: questionPath(a, rec),
    body,
    jsonLd,
    ogType: 'article',
  });
}

// Карточка «сводки ещё нет»: тикер есть в каталоге, но публикаций не хватило.
// Раньше этот HTML стоял инлайном в двух местах и расходился при правках.
function noSummaryCard(a) {
  return `<div class="card" id="summary"><h2>${esc(niceName(a.name))} <span>${esc(a.symbol)}</span></h2>
             <p style="color:var(--muted)">По этому тикеру ещё нет готовой сводки: источники не дали достаточного числа публикаций за последние 72 часа.</p>
             <p><button class="refresh" id="refresh" data-next="" data-generate="1" data-symbol="${esc(a.symbol)}" data-market="${esc(a.market)}">↻ Попробовать собрать</button></p>
             <div id="flash"></div></div>`;
}

// ------------------------------------------------------------------ блок дивидендов
const money = (n, cur) => {
  if (n === null || n === undefined) return '—';
  const sign = cur === 'USD' ? '$' : '';
  const tail = cur === 'USD' ? '' : ' ₽';
  // Копейки нужны не всегда: у Газпрома выплата 51,03, у Лукойла 535
  const digits = Math.abs(n) < 100 ? 2 : Math.abs(n) % 1 ? 2 : 0;
  return sign + n.toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: digits }) + tail;
};

const fmtDate = (iso) =>
  iso ? new Date(iso + 'T00:00:00Z').toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : '—';

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
        <h2>Дивиденды: ${esc(nm)} <span>${esc(asset.symbol)}</span></h2>
        <p style="color:var(--muted);margin:0">Компания не выплачивает дивиденды: в истории выплат нет ни одной записи.</p>
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
           <span>${esc(next.kind === 'paid' ? 'дата отсечки' : PAY_KIND[next.kind]?.label || 'дата отсечки')}</span>
           <b>${esc(fmtDate(next.registry || next.exDate))}</b>
         </div>
         ${showForecast ? `<div class="div-yield">прогноз за 12 мес: ${esc(money(div.forecastNext, cur))}</div>` : ''}
       </div>`
    : `<p style="color:var(--muted);margin:0">Объявленных выплат вперёд нет.${showForecast ? ` Прогноз за 12 месяцев — ${esc(money(div.forecastNext, cur))}.` : ''}</p>`;

  const facts = [
    div.yieldPct !== null && div.yieldPct !== undefined ? `<div><span>Дивидендная доходность</span><b>${esc(String(div.yieldPct).replace('.', ','))}%</b></div>` : '',
    div.payoutPct !== null && div.payoutPct !== undefined ? `<div><span>Доля от прибыли</span><b>${esc(String(div.payoutPct).replace('.', ','))}%</b></div>` : '',
    div.dsi ? `<div><span>Индекс стабильности (DSI)</span><b>${esc(String(div.dsi).replace('.', ','))}</b></div>` : '',
    div.years ? `<div><span>Лет роста выплат</span><b>${esc(String(div.years))}</b></div>` : '',
    div.frequency ? `<div><span>Периодичность</span><b>${esc(div.frequency)}</b></div>` : '',
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
        <td><span class="div-kind ${esc(kind.cls)}">${esc(kind.label)}</span></td>
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
        <h2>Дивиденды: ${esc(nm)} <span>${esc(asset.symbol)}</span></h2>
        ${nextLine}
        ${facts ? `<div class="kv div-facts">${facts}</div>` : ''}
        ${
          rows
            ? `<h3>История выплат</h3>
        <table class="div-table">
          <thead><tr><th>Дата отсечки</th><th class="num">На акцию</th><th>Год</th><th>Статус</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>`
            : ''
        }
        ${
          years
            ? `<details><summary>Суммы по годам</summary>
        <table class="div-table">
          <thead><tr><th>Год</th><th class="num">Выплачено</th><th>Изм.</th></tr></thead>
          <tbody>${years}</tbody>
        </table></details>`
            : ''
        }
        <p class="div-src">Источник: ${asset.market === 'US' ? 'stockanalysis.com' : 'dohod.ru'}${
          div.forecastNext || (div.payments || []).some((p) => p.kind !== 'paid')
            ? '. Прогнозные и рекомендованные выплаты помечены — решения собрания акционеров по ним может ещё не быть'
            : ''
        }.</p>
      </section>`;
}

// ------------------------------------------------------------------ страница тикера
export function tickerPage({ asset, rec, div = null, siteUrl, siteName, related = [], questions = [], error = '', forumHtml = '', chartHtml = '' }) {
  const a = asset;
  const s = rec?.summary || {};
  const marketLabel = MARKET_LABEL[a.market] || 'Актив';
  const kind = ASSET_KIND[a.market] || 'акции';
  const nm = niceName(a.name);
  const paysDiv = div && div.pays !== false && (div.payments?.length || div.annual?.length);
  // Название раздела в тексте: «форум акции Сбербанк» — родительный единственный,
  // потому что форум у каждой бумаги свой. Для крипты так не сказать
  const forumWord = a.market === 'CRYPTO' ? 'форум монеты' : 'форум акции';

  // Заголовки собираются из того, как актив ищут: «<название> акции», «<название> новости»,
  // «<название> акции форум», «дивиденды <название>». Слово «форум» уместно: ветки правда
  // лежат на этой странице, а дивиденды упоминаем только там, где они реально есть.
  const title = paysDiv
    ? `${nm} (${a.symbol}) — ${kind}, дивиденды и форум`
    : `${nm} (${a.symbol}) — ${kind}, новости и форум`;
  const h1 = paysDiv
    ? `${nm} (${a.symbol}) — ${kind}, дивиденды и форум`
    : `${nm} (${a.symbol}) — ${kind}, новости и форум`;

  const description = paysDiv && div.yieldPct
    ? `Дивиденды ${nm} (${a.symbol}): доходность ${String(div.yieldPct).replace('.', ',')}%, история выплат и даты закрытия реестра. ${s.headline || ''}`.slice(0, 290)
    : rec
      ? `${nm} (${a.symbol}): ${s.headline || 'сводка новостей'} Публикации за ${rec.windowHours || 72} ч, ${forumWord} и ответы ИИ-аналитика. ${s.overview || ''}`.slice(0, 290)
      : `${nm} (${a.symbol}), ${marketLabel.toLowerCase()}: сводка новостей, ${forumWord} и ответы ИИ-аналитика. Публикации за последние 72 часа.`;

  // Два меню с разными задачами. Верхнее — по сайту, оно над заголовком: человек,
  // пришедший из поиска на «Газпром», должен увидеть, куда ещё можно пойти.
  // Нижнее — по самой странице: длинная страница тикера без него требует прокрутки.
  // Ссылки появляются только на те блоки, которые реально отрисованы.
  const jump = [
    rec ? '<a href="#summary">Сводка</a>' : '',
    chartHtml ? '<a href="#chart">График</a>' : '',
    div ? '<a href="#dividends">Дивиденды</a>' : '',
    '<a href="#qa">Вопрос аналитику</a>',
    // «Форум» ищут чаще, чем «обсуждение»: слово из заголовка блока и адреса
    forumHtml.includes('id="forum"') ? '<a href="#forum">Форум</a>' : '',
  ]
    .filter(Boolean)
    .join('');

  const body = `
    <div class="logo"><a href="/">${esc(SITE_NAME)}</a></div>
    <nav class="nav"><a href="/">← Поиск</a><a href="/catalog">Каталог тикеров</a><a href="/catalog/${MARKET_SLUG[a.market]}">${esc(marketLabel)}</a><a href="/indices">Индексы</a><a href="/dividends">Календарь дивидендов</a></nav>
    <h1>${esc(h1)}</h1>
    <nav class="jump">${jump}</nav>
    ${error ? `<div class="notice">${esc(error)}</div>` : ''}
    ${rec ? summaryCard(rec) : noSummaryCard(a)}
    ${chartHtml}
    ${dividendBlock({ asset: a, div })}
    ${qaBlock({ asset: a, questions, formAction: `${tickerPath(a)}/ask` })}
    ${forumHtml}
    ${
      related.length
        ? `<div class="cat" id="related"><h2>Другие тикеры</h2><div class="grid">${related
            .map((r) => `<a class="tl" href="${esc(tickerPath(r))}" title="${esc(niceName(r.name))} — ${ASSET_KIND[r.market] || 'акции'} и новости"><span class="s">${esc(r.symbol)}</span><span class="n">${esc(niceName(r.name))}</span></a>`)
            .join('')}</div></div>`
        : ''
    }`;

  // Хлебные крошки нужны любой странице, а не только той, где есть сводка.
  // NewsArticle добавляем лишь при наличии статьи: без неё разметка была бы ложной
  const crumb = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Главная', item: siteUrl + '/' },
      { '@type': 'ListItem', position: 2, name: marketLabel, item: `${siteUrl}/catalog/${MARKET_SLUG[a.market]}` },
      { '@type': 'ListItem', position: 3, name: `${a.name} (${a.symbol})`, item: siteUrl + tickerPath(a) },
    ],
  };

  const jsonLd = rec
    ? [
        {
          '@context': 'https://schema.org',
          '@type': 'NewsArticle',
          headline: s.headline || `${a.name}: сводка новостей`,
          description: (s.overview || '').slice(0, 300),
          datePublished: rec.generatedAt,
          dateModified: rec.generatedAt,
          inLanguage: 'ru',
          mainEntityOfPage: { '@type': 'WebPage', '@id': siteUrl + tickerPath(a) },
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
const sortKey = (name) => name.toLowerCase().replace(/[«»"'()]/g, '').replace(/^[^a-zа-яё0-9]+/i, '');

export function groupByLetter(items) {
  const groups = new Map();
  for (const a of [...items].sort((x, y) => sortKey(x.name).localeCompare(sortKey(y.name), 'ru'))) {
    const letter = (sortKey(a.name)[0] || '#').toUpperCase();
    if (!groups.has(letter)) groups.set(letter, []);
    groups.get(letter).push(a);
  }
  return [...groups.entries()];
}

export function catalogSection(market, items, siteUrl, withLead = true) {
  const groups = groupByLetter(items);
  return `
      <section class="cat" id="${MARKET_SLUG[market]}">
        <h2>${esc(MARKET_LABEL[market])} <span class="cnt">${items.length} ${plural(items.length, 'тикер', 'тикера', 'тикеров')}</span></h2>
        ${withLead ? `<p class="lead">${MARKET_LEAD[market]}</p>` : ''}
        ${groups
          .map(
            ([letter, arr]) => `
          <div class="letters">
            <div class="lt">${esc(letter)}</div>
            <div class="grid">${arr
              .map(
                (a) =>
                  `<a class="tl" href="${esc(tickerPath(a))}" title="${esc(niceName(a.name))} — ${ASSET_KIND[a.market] || 'акции'} и новости"><span class="s">${esc(a.symbol)}</span><span class="n">${esc(niceName(a.name))}</span></a>`
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
  const title = market ? `Каталог: ${MARKET_TITLE[market]}` : 'Каталог тикеров';
  const description = market
    ? `${MARKET_LABEL[market]}: ${total} ${plural(total, 'тикер', 'тикера', 'тикеров')} — новости, обсуждения и вопросы к ИИ-аналитику. ${MARKET_LEAD[market]}`
    : `Каталог из ${total} тикеров со сводками новостей: акции Мосбиржи, акции США и криптовалюты. Списки по алфавиту для каждой категории.`;

  const body = `
    <div class="logo"><a href="/">${esc(SITE_NAME)}</a></div>
    <nav class="nav"><a href="/">Поиск</a>${market ? '<a href="/catalog">Все категории</a>' : ''}${markets
      .map((m) => `<a href="/catalog/${MARKET_SLUG[m]}">${esc(MARKET_LABEL[m])}</a>`)
      .join('')}<a href="/indices">Индексы</a><a href="/dividends">Дивиденды</a></nav>
    <h1>${esc(title)}</h1>
    <p class="lead" style="color:var(--muted);font-size:14px">${esc(description)}</p>
    ${market ? `<p class="lead" style="color:var(--muted);font-size:14px">${esc(MARKET_INTRO[market] || MARKET_LEAD[market])}</p>` : ''}
    ${markets.map((m) => catalogSection(m, groups[m] || [], siteUrl, m !== market)).join('\n')}`;

  const canonical = market ? `/catalog/${MARKET_SLUG[market]}` : '/catalog';
  const jsonLd = [
    {
      '@context': 'https://schema.org',
      '@type': 'CollectionPage',
      name: title,
      description,
      url: siteUrl + canonical,
      inLanguage: 'ru',
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
            url: siteUrl + tickerPath(a),
          })),
      },
    },
  ];

  return page({ siteUrl, title, description, canonical, body, jsonLd });
}

// Статус будущей выплаты для календаря. «Выплачено» здесь было бы неправдой:
// строка попадает в календарь только если дата ещё не прошла
const nextStatus = (p) => {
  if (p.kind === 'recommended') return 'рекомендовано советом директоров';
  if (p.kind === 'forecast') return 'прогноз';
  return 'объявлена';
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
    `<a href="${esc(tickerPath(x.asset))}#dividends">${esc(niceName(x.asset.name))}</a> <span class="sym">${esc(x.asset.symbol)}</span>`;

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
        <td class="num">${esc(String(x.div.yieldPct).replace('.', ','))}%</td>
        <td class="num">${esc(money(x.div.forecastNext, x.cur))}</td>
        <td class="num">${
          x.div.payoutPct === null || x.div.payoutPct === undefined ? '—' : esc(String(x.div.payoutPct).replace('.', ',') + '%')
        }</td>
      </tr>`
    )
    .join('');

  const title = 'Дивиденды акций — календарь выплат и доходность';
  const description = `Календарь дивидендов по ${rows.length} бумагам Мосбиржи и США: даты закрытия реестра, размер выплаты на акцию и дивидендная доходность. Данные с dohod.ru и stockanalysis.com.`;

  const body = `
    <div class="logo"><a href="/">${esc(siteName)}</a></div>
    <nav class="nav"><a href="/">Поиск</a><a href="/catalog">Каталог тикеров</a><a href="/catalog/ru">Акции Мосбиржи</a><a href="/catalog/us">Акции США</a><a href="/indices">Индексы</a><a href="/dividends">Дивиденды</a></nav>
    <h1>Дивиденды акций: календарь выплат и доходность</h1>
    <p class="lead" style="color:var(--muted);font-size:14px">Ближайшие даты закрытия реестра и текущая дивидендная доходность по бумагам, которые платят дивиденды. По каждой компании есть история выплат на её странице. Источники: dohod.ru для Мосбиржи, stockanalysis.com для США.</p>

    <section class="card">
      <h2>Ближайшие дивиденды <span class="cnt">${withNext.length}</span></h2>
      ${
        nextTable
          ? `<table class="div-table">
        <thead><tr><th>Дата отсечки</th><th>Бумага</th><th class="num">На акцию</th><th>Статус</th></tr></thead>
        <tbody>${nextTable}</tbody>
      </table>`
          : '<p style="color:var(--muted)">Объявленных выплат вперёд сейчас нет.</p>'
      }
      <p class="div-src">Прогнозные и рекомендованные выплаты помечены: окончательного решения собрания акционеров по ним может ещё не быть.</p>
    </section>

    <section class="card">
      <h2>Самые высокие дивиденды</h2>
      <table class="div-table">
        <thead><tr><th>Бумага</th><th class="num">Доходность</th><th class="num">За 12 мес</th><th class="num">Доля прибыли</th></tr></thead>
        <tbody>${yieldTable}</tbody>
      </table>
      <p class="div-src">Доходность считается к текущей цене на момент сбора данных и меняется вместе с ней.</p>
    </section>`;

  const jsonLd = [
    {
      '@context': 'https://schema.org',
      '@type': 'CollectionPage',
      name: title,
      description,
      url: `${siteUrl}/dividends`,
      inLanguage: 'ru',
      mainEntity: {
        '@type': 'ItemList',
        numberOfItems: rows.length,
        itemListElement: rows.slice(0, 200).map((x, i) => ({
          '@type': 'ListItem',
          position: i + 1,
          name: `${x.asset.name} (${x.asset.symbol})`,
          url: siteUrl + tickerPath(x.asset),
        })),
      },
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Главная', item: siteUrl + '/' },
        { '@type': 'ListItem', position: 2, name: 'Каталог тикеров', item: siteUrl + '/catalog' },
        { '@type': 'ListItem', position: 3, name: 'Дивиденды', item: siteUrl + '/dividends' },
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
  const description = `Курсы и капитализация акций Мосбиржи, акций США и криптовалют: ${total} тикеров в одной таблице — цена, изменение за день и капитализация. По каждому — сводка новостей за 72 часа, дивиденды, график, форум и ответы ИИ-аналитика. Поиск по названию или тикеру.`;

  // Вкладки по рынкам — та же главная, но с одной категорией. Заголовок и
  // описание у них свои: иначе поисковик увидит четыре почти одинаковые
  // страницы, и ни одна не попадёт в выдачу по «акции США по капитализации»
  const TABS_META = {
    all: {
      title: `${SITE_NAME} — курсы, капитализация и новости акций и криптовалют`,
      heading: 'Курсы, капитализация и новости акций и криптовалют',
      canonical: '/',
    },
    us: {
      title: `Акции США по капитализации — курсы, новости и форум`,
      heading: 'Акции США по капитализации',
      canonical: '/?tab=us',
      description: `Крупнейшие компании США по капитализации: цена, изменение за день и новости по каждой. Публикации за 72 часа, форум и ответы ИИ-аналитика.`,
    },
    ru: {
      title: `Акции Мосбиржи по капитализации — курсы, новости и форум`,
      heading: 'Акции Мосбиржи по капитализации',
      canonical: '/?tab=ru',
      description: `Бумаги Мосбиржи по капитализации: цена, изменение за день и новости по каждой. Публикации за 72 часа, дивиденды, форум и ответы ИИ-аналитика.`,
    },
    crypto: {
      title: `Криптовалюты по капитализации — курсы, новости и форум`,
      heading: 'Криптовалюты по капитализации',
      canonical: '/?tab=crypto',
      description: `Монеты с наибольшей капитализацией: цена, изменение за день и новости по каждой. Без стейблкоинов и обёрнутых версий. Публикации за 72 часа и форум.`,
    },
  };

  // Примеры для поиска — только по рынку вкладки: на крипте «Газпром» в
  // подсказке выглядит как обещание, которого там нет
  const SEARCH_HINT = {
    all: 'Поиск по названию или тикеру: <b>Apple</b>, <b>AAPL</b>, <b>Bitcoin</b>, <b>BTC</b>, <b>Газпром</b>, <b>GAZP</b>, <b>Сбербанк</b>…',
    us: 'Поиск по названию или тикеру: <b>Apple</b>, <b>AAPL</b>, <b>NVIDIA</b>, <b>NVDA</b>, <b>Microsoft</b>, <b>Tesla</b>…',
    ru: 'Поиск по названию или тикеру: <b>Газпром</b>, <b>GAZP</b>, <b>Сбербанк</b>, <b>SBER</b>, <b>Лукойл</b>, <b>LKOH</b>…',
    crypto: 'Поиск по названию или тикеру: <b>Bitcoin</b>, <b>BTC</b>, <b>Ethereum</b>, <b>ETH</b>, <b>Solana</b>, <b>SOL</b>…',
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
        <summary><h2 style="display:inline">${esc(MARKET_LABEL[m])} <span class="cnt">${items.length} ${plural(items.length, 'тикер', 'тикера', 'тикеров')}</span></h2></summary>
        <p class="lead">${MARKET_LEAD[m]}</p>
        ${groupsByLetter
          .map(
            ([letter, arr]) => `
          <div class="letters">
            <div class="lt">${esc(letter)}</div>
            <div class="grid">${arr
              .map(
                (a) =>
                  `<a class="tl" href="${esc(tickerPath(a))}" title="${esc(niceName(a.name))} — ${ASSET_KIND[a.market] || 'акции'} и новости"><span class="s">${esc(a.symbol)}</span><span class="n">${esc(niceName(a.name))}</span></a>`
              )
              .join('')}</div>
          </div>`
          )
          .join('')}
        <p style="margin-top:12px"><a href="/catalog/${MARKET_SLUG[m]}">Открыть отдельной страницей →</a></p>
      </details>`;
    })
    .join('');

  // Число для подзаголовка и для абзаца над каталогом: на вкладке это только
  // её рынки, иначе «210 тикеров» стояло бы и над списком из 117 ссылок
  const shownTotal = (tabMarkets || ['RU', 'US', 'CRYPTO']).reduce((sum, m) => sum + (groups[m] || []).length, 0);

  const body = `
    <h1>${esc(meta.heading)}</h1>
    <p class="sub">${
      // На вкладке считаем только её рынки: «210 тикеров» под заголовком
      // «Акции США по капитализации» — неправда, там их 117
      tab === 'all'
        ? `${shownTotal} ${plural(shownTotal, 'тикер', 'тикера', 'тикеров')} в одной таблице: цена, изменение за день и капитализация — акции Мосбиржи, акции США и криптовалюты.`
        : `${shownTotal} ${plural(shownTotal, 'тикер', 'тикера', 'тикеров')}: цена, изменение за день и капитализация.`
    } ${SEARCH_HINT[tab] || SEARCH_HINT.all}</p>

    <div class="search">
      <input id="q" type="text" placeholder="Название компании, тикер или монета…" autocomplete="off" spellcheck="false" autofocus />
      <div id="dd" class="dd"></div>
    </div>
    <div id="recent" class="recent">${
      cached.length
        ? '<span>Обновлено недавно:</span>' +
          cached
            .slice(0, 14)
            .map(
              (c) =>
                `<a class="chip" href="${esc(tickerPath(c.asset))}" title="${esc(c.summary?.headline || c.asset.name)}">${esc(c.asset.symbol)}</a>`
            )
            .join('')
        : ''
    }</div>

    ${rankHtml}

    <p class="sub" style="margin-top:26px">Ниже — полный список по алфавиту: ${shownTotal} ${plural(shownTotal, 'тикер', 'тикера', 'тикеров')}.${
      refreshedAt ? ` Сводки обновлены ${fmtRelative(refreshedAt)}.` : ''
    }</p>
    <p class="sub">Обсудить бумагу можно прямо на её странице — под сводкой есть форум по тикеру.</p>

    ${indicesHtml}

    ${catalog}`;

  const jsonLd = [
    {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: siteName,
      url: siteUrl,
      inLanguage: 'ru',
      description,
      potentialAction: {
        '@type': 'SearchAction',
        target: { '@type': 'EntryPoint', urlTemplate: `${siteUrl}/?q={search_term_string}` },
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
  });
}

// ------------------------------------------------------------------ служебные страницы
export function notFoundPage({ siteUrl, siteName }) {
  return page({
    siteUrl,
    title: 'Страница не найдена',
    description: 'Такого тикера нет в каталоге. Откройте каталог или воспользуйтесь поиском.',
    canonical: '/404',
    noindex: true,
    body: `
    <h1><a href="/">${esc(siteName)}</a></h1>
    <div class="card">
      <h2>Страница не найдена</h2>
      <p style="color:var(--muted)">Такого тикера нет в каталоге — возможно, он не входит в список или в названии опечатка.</p>
      <p><a href="/catalog">Открыть каталог тикеров</a> или <a href="/">воспользоваться поиском</a>.</p>
    </div>`,
  });
}
