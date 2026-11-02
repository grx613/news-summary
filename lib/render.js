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
  <div class="wrap">
${body}
    <div class="foot">
      <p>Обсуждения — на странице каждого тикера. <a href="/catalog">Каталог тикеров</a> · <a href="/forum/rules">Правила обсуждений</a>.</p>
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
        <article class="card">
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
function qaBlock({ asset, questions, formAction }) {
  const list = questions.length
    ? `<div class="qa-list">${questions
        .map(
          (q) => `
        <a class="qa-item" href="${esc(questionPath(asset, q))}">
          <span class="qa-q">${esc(q.question)}</span>
          <span class="qa-a">${esc((q.bullets?.[0] || q.answer || '').slice(0, 160))}${(q.bullets?.[0] || q.answer || '').length > 160 ? '…' : ''}</span>
        </a>`
        )
        .join('')}</div>`
    : `<p class="qa-empty">Вопросов пока нет. Задайте первый — ответ появится на отдельной странице и будет виден всем.</p>`;

  return `
    <section class="qa">
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
    <h1 class="qa-h1">${esc(heading)}</h1>
    <nav class="nav"><a href="/">← Поиск</a><a href="${esc(tickerPath(a))}">${esc(a.name)} (${esc(a.symbol)})</a><a href="/catalog/${MARKET_SLUG[a.market]}">${esc(MARKET_LABEL[a.market] || '')}</a></nav>

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
                `<a class="qa-item" href="${esc(questionPath(a, q))}"><span class="qa-q">${esc(q.question)}</span></a>`
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

// ------------------------------------------------------------------ страница тикера
export function tickerPage({ asset, rec, siteUrl, siteName, related = [], questions = [], error = '', forumHtml = '' }) {
  const a = asset;
  const s = rec?.summary || {};
  const marketLabel = MARKET_LABEL[a.market] || 'Актив';
  const kind = ASSET_KIND[a.market] || 'акции';
  const nm = niceName(a.name);

  // Заголовки собираются из того, как актив ищут: «<название> акции», «<название> новости»,
  // «<название> акции форум». Слово «форум» уместно: ветки правда лежат на этой странице.
  const title = `${nm} (${a.symbol}) — ${kind}, новости и форум`;
  const h1 = `${nm} (${a.symbol}) — ${kind}, новости и обсуждение на форуме`;

  const description = rec
    ? `${nm} (${a.symbol}): ${s.headline || 'сводка новостей'} Публикации за ${rec.windowHours || 72} ч, обсуждение и ответы ИИ-аналитика. ${s.overview || ''}`.slice(0, 290)
    : `${nm} (${a.symbol}), ${marketLabel.toLowerCase()}: сводка новостей, обсуждение и ответы ИИ-аналитика. Публикации за последние 72 часа.`;

  const body = `
    <div class="logo"><a href="/">${esc(SITE_NAME)}</a></div>
    <h1>${esc(h1)}</h1>
    <nav class="nav"><a href="/">← Поиск</a><a href="/catalog">Каталог тикеров</a><a href="/catalog/${MARKET_SLUG[a.market]}">${esc(marketLabel)}</a></nav>
    ${error ? `<div class="notice">${esc(error)}</div>` : ''}
    ${
      rec
        ? summaryCard(rec)
        : `<div class="card"><h2>${esc(niceName(a.name))} <span>${esc(a.symbol)}</span></h2>
             <p style="color:var(--muted)">По этому тикеру ещё нет готовой сводки: источники не дали достаточного числа публикаций за последние 72 часа.</p>
             <p><button class="refresh" id="refresh" data-next="" data-generate="1" data-symbol="${esc(a.symbol)}" data-market="${esc(a.market)}">↻ Попробовать собрать</button></p>
             <div id="flash"></div></div>`
    }
    ${qaBlock({ asset: a, questions, formAction: `${tickerPath(a)}/ask` })}
    ${forumHtml}
    ${
      related.length
        ? `<div class="cat"><h2>Другие тикеры</h2><div class="grid">${related
            .map((r) => `<a class="tl" href="${esc(tickerPath(r))}" title="${esc(niceName(r.name))} — ${ASSET_KIND[r.market] || 'акции'} и новости"><span class="s">${esc(r.symbol)}</span><span class="n">${esc(niceName(r.name))}</span></a>`)
            .join('')}</div></div>`
        : ''
    }`;

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
        {
          '@context': 'https://schema.org',
          '@type': 'BreadcrumbList',
          itemListElement: [
            { '@type': 'ListItem', position: 1, name: 'Главная', item: siteUrl + '/' },
            { '@type': 'ListItem', position: 2, name: marketLabel, item: `${siteUrl}/catalog/${MARKET_SLUG[a.market]}` },
            { '@type': 'ListItem', position: 3, name: `${a.name} (${a.symbol})`, item: siteUrl + tickerPath(a) },
          ],
        },
      ]
    : [];

  return page({
    siteUrl,
    title,
    description,
    canonical: tickerPath(a),
    body,
    jsonLd,
    ogType: 'article',
    noindex: !rec,
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
    <h1>${esc(title)}</h1>
    <nav class="nav"><a href="/">Поиск</a>${market ? '<a href="/catalog">Все категории</a>' : ''}${markets
      .map((m) => `<a href="/catalog/${MARKET_SLUG[m]}">${esc(MARKET_LABEL[m])}</a>`)
      .join('')}</nav>
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

// ------------------------------------------------------------------ главная
export function homePage({ siteUrl, siteName, groups, cached, refreshedAt }) {
  const total = ['RU', 'US', 'CRYPTO'].reduce((n, m) => n + (groups[m] || []).length, 0);
  const description = `Сводки новостей по акциям и криптовалютам: ${total} тикеров, публикации за 72 часа из Bing News, Yahoo Finance, Reddit, Финама и Мосбиржи. Поиск по названию или тикеру.`;

  // Каталог целиком: ссылки нужны поисковику и человеку, который не хочет искать.
  // Длинные списки сворачиваем в <details>, чтобы страница не растягивалась на метры.
  const catalog = ['RU', 'US', 'CRYPTO']
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

  const body = `
    <h1>Сводки новостей по акциям и криптовалютам</h1>
    <p class="sub">Ищите по названию или тикеру: <b>Apple</b>, <b>AAPL</b>, <b>Bitcoin</b>, <b>BTC</b>, <b>Газпром</b>, <b>GAZP</b>, <b>Сбербанк</b>…</p>

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

    <p class="sub" style="margin-top:26px">Не хотите искать — выберите из каталога: ${total} ${plural(total, 'тикер', 'тикера', 'тикеров')} по категориям и алфавиту.${
      refreshedAt ? ` Сводки обновлены ${fmtRelative(refreshedAt)}.` : ''
    }</p>
    <p class="sub">Обсудить бумагу можно прямо на её странице — под сводкой есть ветки посетителей.</p>

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

  return page({ siteUrl, title: `${SITE_NAME} — сводки новостей по акциям и криптовалютам`, description, canonical: '/', body, jsonLd });
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
