// Сводные страницы сайта: все обсуждения и все вопросы к ИИ-аналитику сразу.
//
// Обсуждения и вопросы живут при тикерах — это их дом, и ссылка на отдельную
// копию развела бы один разговор по двум адресам. Здесь только список:
// строка на каждую ветку и на каждый вопрос, ссылка ведёт туда, где текст
// лежит целиком. Поэтому у страницы нет своей формы и своего кэша содержимого.
//
// Обе страницы собираются на сервере целиком: поисковик не исполняет JS, и
// список ссылок на темы — единственное, что делает эти страницы полезными
// для него и для человека, пришедшего с запросом «форум трейдеров» или
// «вопросы про дивиденды Газпрома».

import { esc, page, tickerPath, questionPath, fmtRelative, niceName, symLabel, MARKET_LABEL } from './render.js';
import { threadPath } from './forum-render.js';
import { t, L, href, plural } from './i18n.js';

// Название актива для строки списка. У инструмента «Графиков» тикера нет,
// поэтому подписываем кратким обозначением, а не слагом в скобках
const assetLine = (a) =>
  a ? (a.market === 'VIZ' ? `${niceName(a.name)} · ${symLabel(a)}` : `${niceName(a.name)} (${symLabel(a)})`) : '';

// Сколько сообщений в ветке: у корня темы их обычно несколько, и «3 сообщения»
// читается полезнее, чем одна ссылка без числа
const repliesWord = (n) =>
  plural(n, t('ответ'), t('ответа'), t('ответов'));

// ------------------------------------------------------------------ форум
// rows — плоский список веток: { thread, asset, replies, lastAt }
export function forumIndexPage({ siteUrl, rows = [], totalMessages = 0, siteName }) {
  const body = `
    <h1>${esc(t('Форум: обсуждения по тикерам'))}</h1>
    <p class="lead sub">${esc(
      t('Обсуждения идут на страницах тикеров: у каждой бумаги свой форум, и это не случайность — вопрос про дивиденды Газпрома бесполезен в общем потоке. Здесь собраны все ветки сайта, свежие сверху.')
    )}</p>

    ${
      rows.length
        ? `<div class="findex">
      ${rows
        .map(({ thread, asset, replies, lastAt }) => {
          // Адрес строится тем же threadPath, что и в самой ветке: у инструмента
          // Viz тема живёт на /charts/<слаг>, и вторая формула адреса разошлась бы
          // с первой молча — обе вели бы «куда-то», но не туда
          return `<a class="frow" href="${esc(L(threadPath(thread)))}">
          <span class="ftitle">${esc(thread.title)}</span>
          <span class="fmeta">
            <span class="fasset">${esc(assetLine(asset))}</span>
            <span class="dot">•</span><span>${esc(t('{n} {replies}', { n: replies, replies: repliesWord(replies) }))}</span>
            <span class="dot">•</span><span>${esc(fmtRelative(lastAt))}</span>
          </span>
        </a>`;
        })
        .join('')}
    </div>`
        : `<p class="qa-empty">${esc(t('Веток пока нет. Откройте страницу любого тикера — форма новой темы внизу.'))}</p>`
    }

    <p class="sub" style="margin-top:22px">${esc(
      totalMessages
        ? t('Всего сообщений с ответами: {n}. Открыть обсуждение можно на странице любого тикера.', { n: totalMessages })
        : t('Обсуждение открывается на странице любого тикера.')
    )} <a href="${L('/catalog')}">${esc(t('Каталог тикеров'))}</a> · <a href="${L('/forum/rules')}">${esc(t('Правила обсуждений'))}</a>.</p>`;

  return page({
    siteUrl,
    title: t('Форум сайта: обсуждения акций, криптовалют и индексов'),
    description: t('Все обсуждения сайта одним списком: ветки по акциям Мосбиржи, акциям США, криптовалютам и инструментам Viz. Мнения и разбор отчётов от посетителей.'),
    canonical: '/forum',
    body,
    active: 'forum',
  });
}

// ------------------------------------------------------------------ FAQ
// rows — { rec, asset, lang }. Схема FAQPage годится только для страницы
// вопросов и ответов, и здесь она честная: каждый пункт — ссылка на страницу
// с полным ответом
export function faqPage({ siteUrl, rows = [], siteName }) {
  const items = rows.filter((r) => r.asset);
  const jsonLd = items.length
    ? [
        {
          '@context': 'https://schema.org',
          '@type': 'FAQPage',
          mainEntity: items.slice(0, 30).map(({ rec, asset }) => ({
            '@type': 'Question',
            name: String(rec.title || rec.question || '').trim(),
            acceptedAnswer: {
              '@type': 'Answer',
              text: String(rec.answer || '').replace(/\s+/g, ' ').trim().slice(0, 500),
              url: siteUrl + href(rec.lang || 'ru', questionPath(asset, rec)),
            },
          })),
        },
      ]
    : [];

  const body = `
    <h1>${esc(t('FAQ: вопросы к ИИ-аналитику'))}</h1>
    <p class="lead sub">${esc(
      t('Посетители спрашивают — аналитик отвечает по публикациям и источникам. Каждый ответ живёт на своей странице со ссылками, здесь — все вопросы сайта, свежие сверху. Задать свой можно на странице любого тикера.')
    )}</p>

    ${
      items.length
        ? `<div class="qalist">
      ${items
        .map(({ rec, asset }) => {
          const head = String(rec.title || rec.question || '').trim();
          const preview = String(rec.answer || '').replace(/\s+/g, ' ').trim();
          return `<a class="qarow" href="${esc(href(rec.lang || 'ru', questionPath(asset, rec)))}">
          <span class="qahead">${esc(head)}</span>
          ${preview ? `<span class="qaprev">${esc(preview.slice(0, 200))}${preview.length > 200 ? '…' : ''}</span>` : ''}
          <span class="qameta">
            <span>${esc(assetLine(asset))}</span>
            <span class="dot">•</span><span>${esc(t(MARKET_LABEL[asset.market] || 'Актив'))}</span>
            <span class="dot">•</span><span>${esc(fmtRelative(rec.askedAt))}</span>
          </span>
        </a>`;
        })
        .join('')}
    </div>`
        : `<p class="qa-empty">${esc(t('Вопросов пока нет. Откройте страницу любого тикера — форма вопроса внизу.'))}</p>`
    }

    <p class="sub" style="margin-top:22px">${esc(
      t('Аналитик отвечает по публикациям за последние 72 часа и указывает источники. Это не инвестиционная рекомендация.')
    )} <a href="${L('/catalog')}">${esc(t('Каталог тикеров'))}</a>.</p>`;

  return page({
    siteUrl,
    title: t('FAQ: вопросы и ответы ИИ-аналитика по акциям и криптовалютам'),
    description: t('Вопросы посетителей и ответы ИИ-аналитика по акциям Мосбиржи, акциям США, криптовалютам и инструментам Viz: выручка, дивиденды, риски и оценка.'),
    canonical: '/faq',
    body,
    jsonLd,
    active: 'faq',
  });
}
