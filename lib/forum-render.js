// Обсуждение привязано к тикеру: отдельного общего форума нет, темы живут
// на странице самой бумаги. Оформление — как у остального сайта: тёмная тема,
// карточки, системный шрифт, те же кнопки и подписи.

import { esc, page, SITE_NAME, MARKET_LABEL, MARKET_SLUG, tickerPath, fmtRelative, niceName } from './render.js';

const plural = (n, one, few, many) => {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
};

const fullTime = (iso) =>
  iso ? new Date(iso).toLocaleString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';

// Адрес темы собирается из ключа тикера, поэтому ссылка не зависит от того,
// откуда её строят: и со страницы тикера, и из карты сайта получается один URL
export const threadPath = (t) => {
  const [m, s] = String(t?.ticker || '').split(':');
  return `/ticker/${MARKET_SLUG[m] || 'us'}/${encodeURIComponent(s || '')}/forum/${t.id}`;
};

// Текст поста: только экранирование и переводы строк. Ссылки не превращаем
// в разметку автоматически — это главный путь для спама мимо фильтра.
export function postHtml(body) {
  return String(body || '')
    .split(/\n{2,}/)
    .map((para) => `<p>${esc(para).replace(/\n/g, '<br />')}</p>`)
    .join('');
}

const hostChip = (host) => (host ? `<span class="post-host" title="хостнейм отправителя">${esc(host)}</span>` : '');

function postMeta({ nick, host, createdAt, extra = '', right = '' }) {
  return `<div class="post-meta">
          <span class="post-nick">${esc(nick)}</span>
          ${hostChip(host)}
          <span class="post-date" title="${esc(fullTime(createdAt))}">${esc(fmtRelative(createdAt))}</span>
          ${extra}
          ${right}
        </div>`;
}

// ---------------------------------------------------------------- форма новой темы
function newThreadForm({ asset, me, title = '', body = '', error = '' }) {
  if (!me) {
    return `<p class="qa-empty">Чтобы открыть тему, <a href="/forum/login?next=${encodeURIComponent(tickerPath(asset) + '#forum')}">войдите по фразе</a>
      или <a href="/forum/register">зарегистрируйтесь</a> — это одна строка из 12 слов, почты и пароля нет.</p>`;
  }
  return `
      ${error ? `<div class="msg err">${esc(error)}</div>` : ''}
      <form class="forum-form" method="post" action="${esc(tickerPath(asset))}/thread">
        <label>
          <span class="field-label">Тема</span>
          <input type="text" name="title" maxlength="110" required value="${esc(title)}" placeholder="О чём поговорим? Например: что будет с дивидендами после отчёта" />
        </label>
        <label>
          <span class="field-label">Сообщение</span>
          <textarea name="body" rows="5" maxlength="4000" required placeholder="Текст сообщения. Пустая строка — новый абзац.">${esc(body)}</textarea>
        </label>
        <input type="text" name="website" class="hp" tabindex="-1" autocomplete="off" aria-hidden="true" />
        <div class="qa-actions">
          <span class="qa-hint"><span id="post-count">0</span>/4000 · без ссылок, контактов и рекламы</span>
          <button class="btn" type="submit">Открыть тему</button>
        </div>
      </form>`;
}

// ---------------------------------------------------------------- блок на странице тикера
// Дерево, как на старых досках: строка темы, под ней с отступом её ответы,
// ответ на ответ — ещё глубже. В скобках — просмотры: ноль виден прочерком,
// по нему понятно, что открывать нечего. Сообщение без текста — тоже прочерк
// вместо текста и без ссылки: открывать в нём нечего.
const VIEWS = (n) => (Number(n) > 0 ? String(Number(n)) : '-');
// Текст в дереве — одной строкой: длина сообщения не должна ломать сетку,
// а полный текст всё равно открывается по ссылке
const clip = (s, n = 160) => {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n) + '…' : t;
};

function treeRow({ m, root, depth }) {
  const isRoot = !root;
  const text = isRoot ? clip(m.title) : clip(m.body);
  // ?view=<id> — чтобы сервер засчитал просмотр именно этому сообщению.
  // ?to=<id> тут не годится: он открывает форму ответа на это сообщение
  const href = isRoot ? threadPath(m) : `${threadPath(root)}?view=${m.id}#m${m.id}`;
  const views = `<span class="ft-cnt" title="Просмотров: ${Number(m.views) || 0}">(${VIEWS(m.views)})</span>`;
  const by = `<span class="ft-by"><span class="ft-nick">${esc(m.nick || '')}</span> ${
    m.host ? hostChip(m.host) : ''
  } <span class="ft-date">${esc(fmtRelative(m.createdAt))}</span></span>`;
  const inner = `${text ? `<span class="ft-text">${esc(text)}</span>` : '<span class="ft-text ft-empty">(-)</span>'}${views}${by}`;

  // Глубину отдаём в CSS переменной, а не готовым отступом: на узком экране
  // шаг отступа меньше, и одной и той же разметкой управляют медиазапросы.
  // Больше трёх уровней не показываем: глубже текст уезжает за край
  const style = depth ? ` style="--d:${Math.min(depth, 3)}"` : '';
  const cls = `ftree-row${isRoot ? ' root' : ' nested'}${text ? '' : ' empty'}`;
  return text
    ? `<a class="${cls}"${style} href="${esc(href)}">${inner}</a>`
    : `<span class="${cls}"${style}>${inner}</span>`;
}

export function forumBlock({ asset, threads = [], messages = [], me, account, notice = '', error = '', title = '', body = '' }) {
  // Ответы раскладываем по родителю: дерево строится одним проходом,
  // без поиска по всему списку на каждом узле
  const kids = new Map();
  for (const m of messages) {
    if (!m.parent) continue;
    if (!kids.has(m.parent)) kids.set(m.parent, []);
    kids.get(m.parent).push(m);
  }
  for (const list of kids.values()) list.sort((a, b) => a.id - b.id);

  const lines = [];
  const walk = (m, root, depth) => {
    lines.push(treeRow({ m, root, depth }));
    // Корень ветки запоминаем при первом уровне: иначе детям уйдёт null
    // и каждый ответ нарисуется как самостоятельная тема
    const base = root || m;
    for (const k of kids.get(m.id) || []) walk(k, base, depth + 1);
  };
  // Свежие ветки сверху: в обсуждении интересно последнее, а не первое
  for (const t of threads) walk(t, null, 0);

  // Потолок на страницу тикера: иначе большая ветка растянет её на километр
  const MAX_LINES = 100;
  const shown = lines.slice(0, MAX_LINES);
  const cut = lines.length - shown.length;
  const items = shown.join('');

  return `
    <section class="qa" id="forum">
      <div class="head">
        <h2>Форум: ${esc(niceName(asset.name))} <span>${esc(asset.symbol)}</span> — обсуждение ${asset.market === 'CRYPTO' ? 'монеты' : 'акции'}</h2>
        ${me ? `<span class="meta-nick">${esc(account?.nick || '')}</span>` : ''}
      </div>
      <p class="lead">Ветки по этому тикеру: вопросы, мнения и разбор отчётов. Пишут посетители, это не рекомендация сервиса.
      Ответы стоят с отступом, в скобках — сколько раз сообщение открывали.</p>
      ${notice ? `<div class="msg ok">${esc(notice)}</div>` : ''}
      ${
        items
          ? `<div class="ftree">${items}</div>${
              cut > 0 ? `<p class="qa-empty">Ещё ${cut} ${plural(cut, 'сообщение', 'сообщения', 'сообщений')} — в самих ветках.</p>` : ''
            }`
          : '<p class="qa-empty">Веток пока нет. Откройте первую — она появится здесь и на отдельной странице.</p>'
      }
      <details class="forum-new"${error ? ' open' : ''}>
        <summary>Открыть новую тему</summary>
        ${newThreadForm({ asset, me, title, body, error })}
      </details>
      <p class="warn">Правила — <a href="/forum/rules">короткий список</a>. Модератор может скрыть сообщение.</p>
    </section>`;
}

// ---------------------------------------------------------------- страница темы
export function threadPage({ siteUrl, asset, thread, replies = [], me, account, to = 0, error = '' }) {
  const target = Number(to) || 0;
  const replyTarget =
    target && replies.some((r) => r.id === target)
      ? `<input type="hidden" name="parent" value="${target}" /><div class="post-target">ответ на #${target}</div>`
      : '<input type="hidden" name="parent" value="" />';

  // Глубину считаем по цепочке родителей, а не берём из записи: у старых
  // ответов поле depth равно 0, и тогда вся ветка рисуется плоско
  const byId = new Map(replies.map((r) => [r.id, r]));
  const depthOf = (r) => {
    let d = 0;
    let cur = r;
    for (let i = 0; i < 12 && cur?.parent && cur.parent !== thread.id; i++) {
      cur = byId.get(cur.parent);
      if (!cur) break;
      d++;
    }
    return Math.min(d, 3);
  };

  const replyBlock = replies
    .map((r) => {
      // Глубину отдаём переменной --d: шаг отступа задаёт CSS, чтобы на телефоне
      // он был меньше. Раньше отступ был записан в style готовым числом
      const depth = depthOf(r);
      return `
        <div class="post${depth ? ' post-nest' : ''}" id="m${r.id}"${depth ? ` style="--d:${depth}"` : ''}>
          ${r.parent ? `<div class="post-target">в ответ на <a href="#m${r.parent}">#${r.parent}</a></div>` : ''}
          <div class="post-body">${postHtml(r.body)}</div>
          ${postMeta({
            nick: r.nick,
            host: r.host,
            createdAt: r.createdAt,
            extra: `<span class="post-cnt" title="Просмотров">(${Number(r.views) > 0 ? Number(r.views) : '-'})</span>`,
            right: `<a class="post-reply" href="${esc(threadPath(thread))}?to=${r.id}#reply">ответить</a>`,
          })}
        </div>`;
    })
    .join('');

  const replyForm = me
    ? `<form class="forum-form" method="post" action="${esc(threadPath(thread))}/reply">
          ${replyTarget}
          <textarea name="body" rows="5" maxlength="4000" required placeholder="Текст сообщения. Пустая строка — новый абзац."></textarea>
          <input type="text" name="website" class="hp" tabindex="-1" autocomplete="off" aria-hidden="true" />
          <div class="qa-actions">
            <span class="qa-hint"><span id="post-count">0</span>/4000</span>
            <button class="btn" type="submit">Ответить</button>
          </div>
        </form>`
    : `<p class="qa-empty">Чтобы ответить, <a href="/forum/login?next=${encodeURIComponent(threadPath(thread))}">войдите по фразе</a>
        или <a href="/forum/register">зарегистрируйтесь</a>.</p>`;

  const body = `
    <div class="logo"><a href="/">${esc(SITE_NAME)}</a></div>
    <nav class="nav"><a href="/">← Поиск</a><a href="${esc(tickerPath(asset))}">${esc(asset.name)} (${esc(asset.symbol)})</a><a href="${esc(tickerPath(asset))}#forum">Все темы</a></nav>
    <h1 class="post-h1">${esc(thread.title)}</h1>

    <article class="card">
      <div class="meta">
        <span class="pill hit">${esc(MARKET_LABEL[asset.market] || asset.market)}</span>
        <span class="dot">•</span><span>${esc(asset.symbol)}</span>
        <span class="dot">•</span><span>${replies.length} ${plural(replies.length, 'ответ', 'ответа', 'ответов')}</span>
        <span class="dot">•</span><span title="Просмотров темы">просмотров: ${Number(thread.views) > 0 ? Number(thread.views) : '-'}</span>
      </div>
      <div class="post-body">${postHtml(thread.body)}</div>
      ${postMeta({ nick: thread.nick, host: thread.host, createdAt: thread.createdAt })}
    </article>

    <section class="qa">
      <h2>Ответы</h2>
      ${error ? `<div class="msg err">${esc(error)}</div>` : ''}
      ${replyBlock ? `<div class="post-list">${replyBlock}</div>` : '<p class="qa-empty">Ответов пока нет.</p>'}
      <details class="forum-new" id="reply"${error ? ' open' : ''}>
        <summary>Ответить в тему</summary>
        ${replyForm}
      </details>
    </section>`;

  const jsonLd = [
    {
      '@context': 'https://schema.org',
      '@type': 'DiscussionForumPosting',
      headline: thread.title,
      text: thread.body || undefined,
      datePublished: thread.createdAt,
      url: `${siteUrl}${threadPath(thread)}`,
      inLanguage: 'ru',
      author: { '@type': 'Person', name: thread.nick },
      interactionStatistic: {
        '@type': 'InteractionCounter',
        interactionType: 'https://schema.org/CommentAction',
        userInteractionCount: replies.length,
      },
      comment: replies.slice(0, 50).map((r) => ({
        '@type': 'Comment',
        text: r.body,
        dateCreated: r.createdAt,
        author: { '@type': 'Person', name: r.nick },
      })),
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Главная', item: siteUrl + '/' },
        { '@type': 'ListItem', position: 2, name: asset.name, item: siteUrl + tickerPath(asset) },
        { '@type': 'ListItem', position: 3, name: thread.title.slice(0, 90), item: siteUrl + threadPath(thread) },
      ],
    },
  ];

  return page({
    siteUrl,
    title: `${thread.title} — ${niceName(asset.name)} (${asset.symbol}) — форум`,
    description: `${thread.title} — обсуждение на ${SITE_NAME}: ${String(thread.body || '').replace(/\s+/g, ' ').slice(0, 180)}`,
    canonical: threadPath(thread),
    body,
    jsonLd,
    ogType: 'article',
  });
}

// ---------------------------------------------------------------- формы входа
const navBack = (next) =>
  next && next !== '/catalog' ? `<a href="${esc(next)}">← Вернуться</a>` : '<a href="/catalog">← Каталог тикеров</a>';

function phraseField(label, hint) {
  return `<label>
      <span class="field-label">${esc(label)}</span>
      <textarea class="phrase" name="phrase" rows="3" spellcheck="false" autocomplete="off" required
        placeholder="abandon ability able about above absent absorb abstract absurd abuse access accident">${''}</textarea>
      <span class="qa-hint">${hint}</span>
    </label>`;
}

export function loginPage({ siteUrl, next = '/catalog', error = '' }) {
  const body = `
    <div class="logo"><a href="/">${esc(SITE_NAME)}</a></div>
    <nav class="nav">${navBack(next)}<a href="/forum/rules">Правила</a></nav>
    <h1>Вход по фразе</h1>
    <article class="card">
      <p class="lead">Пароля и почты нет: аккаунт — это фраза восстановления из 12 слов (BIP39, как в MetaMask).
      Вставьте её, чтобы войти под своим ником. Фраза отправляется только на этот сервер и хранится в виде хеша.</p>
      ${error ? `<div class="msg err">${esc(error)}</div>` : ''}
      <form class="forum-form" method="post" action="/forum/login">
        <input type="hidden" name="next" value="${esc(next)}" />
        ${phraseField('Фраза восстановления', '12, 15, 18, 21 или 24 слова через пробел')}
        <div class="qa-actions"><button class="btn" type="submit">Войти</button></div>
      </form>
      <p class="warn">Нет фразы — <a href="/forum/register">зарегистрируйтесь</a>, сервер сгенерирует её сам.</p>
    </article>`;
  return page({
    siteUrl,
    title: 'Вход по фразе',
    description: 'Вход на сайт по фразе восстановления: пароля и почты нет.',
    canonical: '/forum/login',
    noindex: true,
    body,
  });
}

export function registerPage({ siteUrl, generated, error = '', nick = '', next = '/catalog' }) {
  const body = `
    <div class="logo"><a href="/">${esc(SITE_NAME)}</a></div>
    <nav class="nav">${navBack(next)}<a href="/forum/rules">Правила</a></nav>
    <h1>Регистрация на форуме</h1>
    <article class="card">
      <p class="lead">Аккаунт нужен, чтобы открывать темы и отвечать в обсуждениях тикеров. Пароля и почты нет —
      ключ к аккаунту это фраза восстановления.</p>
      ${error ? `<div class="msg err">${esc(error)}</div>` : ''}
      ${
        generated
          ? `<div class="msg"><b>Сохраните фразу.</b> Это единственный ключ к аккаунту: пароля и почты нет,
             восстановить доступ без фразы невозможно. Запишите её на бумагу и никому не отправляйте —
             любой, кто её знает, может войти под вами.
             <div class="seed" id="seed">${esc(generated)}</div>
             <button class="btn ghost" type="button" data-copy="seed">Скопировать</button></div>`
          : ''
      }
      <form class="forum-form" method="post" action="/forum/register">
        <input type="hidden" name="next" value="${esc(next)}" />
        ${
          generated
            ? `<input type="hidden" name="phrase" value="${esc(generated)}" />`
            : phraseField('Своя фраза', 'Если фраза уже есть — вставьте её и войдите. Так аккаунт переносится между устройствами.')
        }
        <label>
          <span class="field-label">Ник</span>
          <input type="text" name="nick" maxlength="24" required value="${esc(nick)}" placeholder="например, Миноритарий" />
          <span class="qa-hint">От 2 до 24 символов: буквы, цифры, пробел, точка, дефис.</span>
        </label>
        <label class="check"><input type="checkbox" name="agree" value="1" required /> <span>согласен с <a href="/forum/rules">правилами</a></span></label>
        <div class="qa-actions"><button class="btn" type="submit">Создать аккаунт</button></div>
      </form>
    </article>`;
  return page({
    siteUrl,
    title: 'Регистрация по фразе',
    description: 'Регистрация по фразе восстановления: без пароля и почты.',
    canonical: '/forum/register',
    noindex: true,
    body,
  });
}

export function accountPage({ siteUrl, account, posts }) {
  const body = `
    <div class="logo"><a href="/">${esc(SITE_NAME)}</a></div>
    <nav class="nav"><a href="/catalog">← Каталог тикеров</a><a href="/forum/rules">Правила</a></nav>
    <h1>Ваш аккаунт</h1>
    <article class="card">
      <div class="kv">
        <div><span>Вход</span><b>фраза восстановления</b></div>
        <div><span>Адрес</span><b><code>${esc(account.address)}</code> — производная от фразы, а не от IP</b></div>
        <div><span>Регистрация</span><b>${esc(fullTime(account.createdAt))}</b></div>
        <div><span>Сообщений</span><b>${posts}</b></div>
      </div>
      <p class="warn">Ник можно сменить, пока он не занят. Фраза остаётся той же, старые сообщения сохраняют прежний ник.</p>
      <form class="forum-form" method="post" action="/forum/nick">
        <label>
          <span class="field-label">Новый ник</span>
          <input type="text" name="nick" maxlength="24" required value="${esc(account.nick)}" />
        </label>
        <div class="qa-actions"><button class="btn" type="submit">Сохранить ник</button></div>
      </form>
      <form method="post" action="/forum/logout" class="logout"><button class="linkish" type="submit">Выйти из аккаунта</button></form>
    </article>`;
  return page({ siteUrl, title: `Аккаунт ${account.nick}`, description: 'Аккаунт на сайте.', canonical: '/forum/me', body, noindex: true });
}

export function rulesPage({ siteUrl }) {
  const body = `
    <div class="logo"><a href="/">${esc(SITE_NAME)}</a></div>
    <nav class="nav"><a href="/catalog">← Каталог тикеров</a></nav>
    <h1>Правила обсуждений на форуме</h1>
    <article class="card">
      <ol class="rules">
        <li>Обсуждение живёт на странице тикера: пишите про эту бумагу, её отрасль, отчётность и макро-факторы. Вопросы по сервису — тоже сюда.</li>
        <li>Без рекламы, ссылок на казино и «сигналов», без набора контактов. Ссылки в тексте не становятся кликабельными.</li>
        <li>Без оскорблений и личных данных — своих и чужих.</li>
        <li>Не выдавайте себя за другого участника. Ник закреплён за фразой, сменить его можно только из своего аккаунта.</li>
        <li>Мнения — это мнения. Сервис не даёт инвестиционных рекомендаций, и обсуждения тоже.</li>
      </ol>
      <p class="warn">Рядом с ником показывается хостнейм отправителя. IP-адрес целиком не публикуется:
      если обратная зона не отвечает, видна только маска адреса.</p>
      <p class="warn"><b>Фраза восстановления — это ключ.</b> Кто её знает, тот и вы. Никто, включая администрацию,
      не сможет восстановить доступ без неё. Модератор может скрыть сообщение; аккаунт при этом не удаляется.</p>
    </article>`;
  return page({ siteUrl, title: 'Правила обсуждений', description: 'Правила обсуждений по тикерам.', canonical: '/forum/rules', body });
}

export function forumNotFound({ siteUrl }) {
  const body = `
    <div class="logo"><a href="/">${esc(SITE_NAME)}</a></div>
    <h1>Сообщение не найдено</h1>
    <article class="card">
      <p class="lead">Возможно, его скрыли или ссылка устарела.</p>
      <p><a href="/catalog">Открыть каталог тикеров</a>.</p>
    </article>`;
  return page({ siteUrl, title: 'Сообщение не найдено', description: 'Такого сообщения нет.', canonical: '/forum', noindex: true, body });
}
