import http from 'node:http';
import fs from 'node:fs';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { get, stripTags, norm, decodeEntities } from './lib/http.js';
import { buildUniverse, getUniverse, loadedUniverse, currentUniverse } from './lib/universe.js';
import { createCrawler } from './lib/crawler.js';
import { createDividendStore } from './lib/dividends.js';
import { createDividendCrawler } from './lib/dividend-crawler.js';
import { INDEXES, bySlug, createIndexStore } from './lib/indices.js';
import { createIndexCrawler } from './lib/index-crawler.js';
import { createChartStore, TIMEFRAMES } from './lib/charts.js';
import { createChartCrawler } from './lib/chart-crawler.js';
import { createChartSeries } from './lib/chart-intraday.js';
import { createRealtime } from './lib/realtime.js';
import {
  TRANS_LANG,
  TRANSLATION_SCHEMA,
  TRANSLATION_SYSTEM,
  buildTranslatePrompt,
  applyTranslation,
} from './lib/summary-translate.js';
import {
  createMarketFeed,
  isCat,
  DEFAULT_CTF,
  CTF,
  CTF_ORDER,
  SETS,
  INSTRUMENTS,
  catsOf,
  isSet,
  setMeta,
  defaultSet,
  chartsPath,
  instrumentBySlug,
  instrumentPath,
  fmtValue,
  fmtChange,
  HIDE_COOKIE,
  parseHidden,
  hiddenValue,
  vizAsset,
  vizAssets,
  vizBySymbol,
  newsPhrases,
} from './lib/markets.js';
import {
  chartsPage,
  chartsBoard,
  chartsMeta,
  instrumentPage,
  instBoard,
  cardInnerHtml,
  pollFor,
  unitToken,
  settingsPage,
  settingsPath,
} from './lib/market-render.js';
import { chartBlock, tfList, DEFAULT_TF, fmtPrice } from './lib/chart-render.js';
import {
  indexSeo,
  indexSections,
  indicesPage,
  homeIndices,
  instrumentSlugOfIndex,
  val as idxVal,
  signed as idxSigned,
  pct as idxPct,
} from './lib/index-render.js';
import { homeRank, isTab, HOME_TABS } from './lib/home-rank.js';
import { forumIndexPage, faqPage } from './lib/feed-pages.js';
import {
  SITE_NAME,
  setQuoteMs,
  MARKET_LABEL,
  MARKET_SLUG,
  SLUG_MARKET,
  tickerPath,
  questionPath,
  niceName,
  homePage,
  catalogPage,
  tickerPage,
  questionPage,
  dividendsPage,
  notFoundPage,
  page,
  summaryCard,
  noSummaryCard,
  qaBlock,
} from './lib/render.js';
import {
  langFromPath,
  isLang,
  withLang,
  getLang,
  href as langHref,
  alternates,
  t,
  LANGS,
  DEFAULT_LANG,
  defineDict,
} from './lib/i18n.js';
import {
  QA_SCHEMA,
  createQuestionStore,
  validateQuestion,
  buildQaPrompt,
  buildSearchPrompt,
  VERDICT_MESSAGE,
  questionHash,
  slugify,
} from './lib/qa.js';
import {
  checkPhrase,
  generatePhrase,
  deriveIdentity,
  resolveHost,
  createForumStore,
  loadSecret,
  signSession,
  readSession,
  shortAddress,
  validateNick,
  validateTitle,
  validatePost,
} from './lib/forum.js';
import {
  forumBlock,
  threadForm,
  threadPage,
  threadTree,
  loginPage,
  registerPage,
  accountPage,
  rulesPage,
  forumNotFound,
  threadPath,
} from './lib/forum-render.js';
import { createSpendTracker } from './lib/spend.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnv(path.join(__dirname, '.env'));

const PORT = Number(process.env.PORT) || 3000;
// Слушаем только localhost: наружу сайт отдаёт Caddy с HTTPS, порт приложения не должен торчать
const HOST = process.env.HOST || '127.0.0.1';
const API_KEY = process.env.BOTHUB_API_KEY;
const BASE_URL = process.env.BOTHUB_BASE_URL || 'https://openai.bothub.chat/v1';

// Модели, которых у нас быть не должно ни при какой настройке. sonar-deep-research
// стоит 345 ₽ за миллион входных токенов против 17 у haiku: один случайный вызов
// 2 ноября обошёлся в 67,5 ₽ — четверть всего расхода проекта. Настройка модели
// приходит строкой из .env, и опечатка в ней не должна стоить денег
const EXPENSIVE_MODELS = new Set(['sonar-deep-research', 'sonar-reasoning-pro', 'sonar-reasoning']);
function safeModel(want, fallback, what) {
  if (want && EXPENSIVE_MODELS.has(want)) {
    console.warn(`${what}=${want}: модель в списке дорогих, беру ${fallback}`);
    return fallback;
  }
  return want || fallback;
}

const MODEL = safeModel(process.env.MODEL, 'claude-haiku-5.5', 'MODEL');

const CACHE_TTL_MS = (Number(process.env.CACHE_TTL_HOURS) || 24) * 3600_000;
const NEWS_WINDOW_H = Number(process.env.NEWS_WINDOW_HOURS) || 72;
const MAX_NEWS = Number(process.env.MAX_NEWS) || 30;
// Меньше этого числа релевантных публикаций — не зовём модель, это гарантированно «данных нет»
const MIN_NEWS = Number(process.env.MIN_NEWS) || 3;
const REDDIT_GAP_MS = Number(process.env.REDDIT_MIN_GAP_MS) || 3000;
const BASIC_AUTH = (process.env.BASIC_AUTH || '').trim();
const MAX_GEN_PER_HOUR = Number(process.env.MAX_GENERATIONS_PER_HOUR) || 40;
const REFRESH_COOLDOWN_MS = (Number(process.env.REFRESH_COOLDOWN_MIN) || 15) * 60_000;
// Сайт публичный, поэтому общий лимит дополняем лимитом на посетителя:
// иначе один человек выжигает баланс и блокирует генерации всем остальным
const MAX_GEN_PER_IP_HOUR = Number(process.env.MAX_GENERATIONS_PER_IP_HOUR) || 10;
const MAX_SEARCH_PER_IP_MIN = Number(process.env.MAX_SEARCHES_PER_IP_MIN) || 60;
const SITE_URL = (process.env.SITE_URL || 'https://news.147-45-251-157.nip.io').replace(/\/$/, '');
// Форум: сообщения публичные, поэтому лимит отдельный от вопросов к аналитику
const MAX_FORUM_PER_HOUR = Number(process.env.MAX_FORUM_POSTS_PER_IP_HOUR) || 12;
const FORUM_ENABLED = process.env.FORUM_ENABLED !== '0';
// Скрывать сообщения может только тот, у кого есть токен: иначе любой гость чистит борду
const MODERATOR_TOKEN = (process.env.FORUM_MODERATOR_TOKEN || '').trim();

// Поисковая модель для ответов на вопросы. Perplexity sonar ходит в интернет сам и возвращает
// цитаты отдельным полем. QA_SEARCH_MODEL=off отключает поиск и оставляет ответ по кешу новостей.
// Имя модели проверяется тем же списком дорогих, что и MODEL: строка в .env — это просто
// текст, и опечатка в ней молча включала бы модель в тысячу раз дороже обычной
const QA_SEARCH_DEFAULT = 'sonar-pro';
const QA_SEARCH_MODEL =
  process.env.QA_SEARCH_MODEL === 'off'
    ? 'off'
    : safeModel((process.env.QA_SEARCH_MODEL || QA_SEARCH_DEFAULT).trim(), QA_SEARCH_DEFAULT, 'QA_SEARCH_MODEL');
const QA_SEARCH_ON = QA_SEARCH_MODEL && QA_SEARCH_MODEL !== 'off';
const QA_SEARCH_RECENCY = (process.env.QA_SEARCH_RECENCY || 'month').trim();
// Второй проход по кешу, если интернет недоступен: ответ по публикациям лучше, чем ошибка
const QA_FALLBACK_TO_CACHE = process.env.QA_FALLBACK_TO_CACHE !== '0';

const CRAWLER = {
  enabled: process.env.CRAWLER_ENABLED !== '0',
  intervalMs: (Number(process.env.CRAWLER_INTERVAL_HOURS) || 24) * 3600_000,
  concurrency: Number(process.env.CRAWLER_CONCURRENCY) || 2,
  gapMs: Number(process.env.CRAWLER_GAP_MS) || 1500,
  usLimit: Number(process.env.US_UNIVERSE_LIMIT) || 130,
  cryptoLimit: Number(process.env.CRYPTO_UNIVERSE_LIMIT) || 50,
};

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const CACHE_FILE = path.join(DATA_DIR, 'cache.json');
const UNIVERSE_FILE = path.join(DATA_DIR, 'universe.json');
const QUESTIONS_FILE = path.join(DATA_DIR, 'questions.json');
const DIVIDENDS_FILE = path.join(DATA_DIR, 'dividends.json');
const INDICES_FILE = path.join(DATA_DIR, 'indices.json');
const CHARTS_FILE = path.join(DATA_DIR, 'charts.json');
const FORUM_FILE = path.join(DATA_DIR, 'forum.json');
const FORUM_SECRET_FILE = path.join(DATA_DIR, 'forum-secret.key');
const SPEND_FILE = path.join(DATA_DIR, 'spend.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

if (!API_KEY) {
  console.error('BOTHUB_API_KEY не задан (см. .env)');
  process.exit(1);
}

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const log = (...a) => console.log(new Date().toISOString(), ...a);

// ---------------------------------------------------------------- кеш
const SENTIMENTS = new Set(['bullish', 'bearish', 'neutral', 'mixed']);

// Модель может вернуть не тот JSON, поэтому проверяем структуру до записи в кеш
function validateSummary(s) {
  if (!s || typeof s !== 'object' || Array.isArray(s)) return null;
  if (!SENTIMENTS.has(s.sentiment)) return null;
  const str = (v) => typeof v === 'string' && v.trim().length > 0;
  if (!str(s.headline) || !str(s.overview)) return null;
  if (s.overview.trim().length < 20) return null;
  if (!Array.isArray(s.key_points) || !Array.isArray(s.risks) || !Array.isArray(s.catalysts)) return null;
  const points = s.key_points
    .map((k) => (typeof k === 'string' ? { text: k, refs: [] } : k && typeof k === 'object' ? k : null))
    .filter((k) => k && str(k.text))
    .map((k) => ({ text: k.text.trim(), refs: Array.isArray(k.refs) ? k.refs.filter(Number.isInteger) : [] }));
  return {
    sentiment: s.sentiment,
    headline: s.headline.trim(),
    overview: s.overview.trim(),
    key_points: points,
    risks: s.risks.filter(str).map((x) => x.trim()),
    catalysts: s.catalysts.filter(str).map((x) => x.trim()),
    community: str(s.community) ? s.community.trim() : '',
    confidence: ['low', 'medium', 'high'].includes(s.confidence) ? s.confidence : 'medium',
  };
}

// Переводы проверяются отдельно от сводки: структура та же, но sentiment
// и ссылки в них не хранятся. Битая запись отбрасывается по одному языку,
// не утягивая за собой соседний
function validateTranslation(tr) {
  if (!tr || typeof tr !== 'object' || Array.isArray(tr)) return null;
  const str = (v) => typeof v === 'string' && v.trim().length > 0;
  if (!str(tr.headline) || !str(tr.overview)) return null;
  const point = (k) => (k && typeof k === 'object' && str(k.text) ? { text: k.text.trim(), refs: Array.isArray(k.refs) ? k.refs.filter(Number.isInteger) : [] } : null);
  return {
    headline: tr.headline.trim(),
    overview: tr.overview.trim(),
    key_points: Array.isArray(tr.key_points) ? tr.key_points.map(point).filter(Boolean) : [],
    risks: Array.isArray(tr.risks) ? tr.risks.filter(str).map((x) => x.trim()) : [],
    catalysts: Array.isArray(tr.catalysts) ? tr.catalysts.filter(str).map((x) => x.trim()) : [],
    community: str(tr.community) ? tr.community.trim() : '',
  };
}

function validateI18n(obj) {
  const out = {};
  if (!obj || typeof obj !== 'object') return out;
  for (const lang of ['en', 'es']) {
    const clean = validateTranslation(obj[lang]);
    if (clean) out[lang] = clean;
  }
  return out;
}

const cacheKey = (a) => `${a.market}:${a.symbol}`.toUpperCase();

let cache = {};
let droppedEntries = 0;
let totalTokens = 0;
let totalCostUsd = 0;
try {
  const raw = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
  for (const [key, rec] of Object.entries(raw)) {
    const clean = validateSummary(rec?.summary);
    // Битые записи (например, модель вернула один пункт вместо саммари) не грузим — соберём заново
    if (!clean || !rec?.asset?.symbol) {
      droppedEntries++;
      continue;
    }
    // Служебные поля (расход токенов и денег) не входят в схему саммари, но нужны для учёта
    clean.tokens = rec.summary.tokens;
    clean.costUsd = rec.summary.costUsd;
    clean.model = rec.summary.model;
    if (clean.costUsd) totalCostUsd += clean.costUsd;
    if (clean.tokens) totalTokens += clean.tokens;
    cache[key] = { ...rec, summary: clean, i18n: validateI18n(rec.i18n) };
  }
} catch {
  cache = {};
}
const inflight = new Map();
let saveTimer = null;

function saveCache() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFile(CACHE_FILE, JSON.stringify(cache, null, 2), () => {});
  }, 50);
}

// ---------------------------------------------------------------- поиск тикеров
const TYPES = { RU: 'Акция MOEX', US: 'Stock', CRYPTO: 'Crypto', ETF: 'ETF', INDEX: 'Index', VIZ: 'Инструмент Viz' };

function cleanUSName(name = '', type = '') {
  let n = name;
  if (type === 'CRYPTOCURRENCY') n = n.replace(/\s+USD$/i, '');
  return n
    .replace(/,?\s+(Inc\.?|Incorporated|Corporation|Corp\.?|Company|Co\.?|Ltd\.?|Limited|PLC|plc|N\.V\.|S\.A\.|AG|SE|Holdings?|Group|N\.A\.)$/i, '')
    .trim();
}

async function searchYahoo(q) {
  const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=10&newsCount=0&enableFuzzyQuery=true`;
  const res = await get(url, { timeout: 8000 });
  if (!res.ok) throw new Error(`Yahoo ${res.status}`);
  const data = await res.json();
  const allowed = new Set(['EQUITY', 'CRYPTOCURRENCY', 'ETF', 'INDEX']);
  return (data.quotes || [])
    .filter((x) => x.symbol && allowed.has(x.quoteType))
    .filter((x) => x.quoteType !== 'CRYPTOCURRENCY' || /-USD$/i.test(x.symbol))
    .filter((x) => x.quoteType !== 'INDEX')
    .map((x) => {
      const crypto = x.quoteType === 'CRYPTOCURRENCY';
      return {
        symbol: crypto ? x.symbol.replace(/-USD$/i, '') : x.symbol,
        yahooSymbol: x.symbol,
        name: cleanUSName(x.longname || x.shortname || x.symbol, x.quoteType),
        type: crypto ? 'CRYPTO' : x.quoteType === 'ETF' ? 'ETF' : 'US',
        exchange: x.exchDisp || x.exchange || '',
        typeLabel: crypto ? TYPES.CRYPTO : x.quoteType === 'ETF' ? TYPES.ETF : TYPES.US,
      };
    });
}

async function searchMoex(q) {
  const url = `https://iss.moex.com/iss/securities.json?q=${encodeURIComponent(q)}&iss.meta=off`;
  const res = await get(url, { timeout: 8000 });
  if (!res.ok) throw new Error(`MOEX ${res.status}`);
  const d = (await res.json()).securities;
  const col = Object.fromEntries(d.columns.map((c, i) => [c, i]));
  const qn = norm(q);
  return d.data
    .filter((r) => r[col.is_traded] === 1 && ['common_share', 'preferred_share'].includes(r[col.type]))
    .filter((r) => !/-RM$|-RM\b/i.test(r[col.secid]) && /^TQ[A-Z0-9]+$/.test(String(r[col.primary_boardid] || '')))
    .map((r) => {
      const secid = r[col.secid];
      const short = r[col.shortname] || secid;
      const long = r[col.name] || '';
      const emitent = r[col.emitent_title] || '';
      let score = 0;
      if (secid.toLowerCase() === qn) score += 100;
      if (norm(short) === qn) score += 80;
      if (norm(short).startsWith(qn)) score += 40;
      if (norm(short).includes(qn)) score += 20;
      if (norm(emitent).includes(qn)) score += 15;
      if (norm(long).includes(qn)) score += 10;
      return {
        symbol: secid,
        moexSymbol: secid,
        name: short.replace(/\s+(ао|ап|ao|ap)$/i, ''),
        fullName: emitent,
        type: 'RU',
        exchange: 'MOEX',
        typeLabel: TYPES.RU,
        score,
      };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);
}

async function searchTickers(q) {
  const results = await Promise.allSettled([searchMoex(q), searchYahoo(q)]);
  const moex = results[0].status === 'fulfilled' ? results[0].value : [];
  const yahoo = results[1].status === 'fulfilled' ? results[1].value : [];
  if (results[0].status === 'rejected') console.warn('MOEX search:', results[0].reason.message);
  if (results[1].status === 'rejected') console.warn('Yahoo search:', results[1].reason.message);

  const seen = new Set();
  return [...moex, ...yahoo]
    .filter((x) => (seen.has(x.symbol) ? false : seen.add(x.symbol)))
    .slice(0, 10);
}

async function resolveAsset({ symbol, name, type, market }) {
  const s = symbol.trim();
  let m = (market || type || '').toUpperCase();

  // Инструмент «Графиков» приходит из своей страницы, а не из поиска: ни в
  // каталоге, ни в списке тикеров его нет, и поиск по слову вернул бы чужую
  // бумагу. Слаг известен точно, поэтому восстанавливаем запись из справочника
  if (m === 'VIZ') {
    const inst = vizBySymbol(s);
    if (!inst) throw Object.assign(new Error(t('Инструмент не найден')), { status: 404 });
    return inst;
  }

  // Название из кеша главнее — по нему ищутся новости
  const known = cache[`${m}:${s}`.toUpperCase()]?.asset;
  if (!name && known?.name) name = known.name;

  const findByName = async () =>
    (await searchTickers(s).catch(() => [])).find(
      (x) => x.symbol.toUpperCase() === s.toUpperCase() && (!m || x.type === m)
    );

  if (!m) {
    const found = (await searchTickers(s).catch(() => [])).find((x) => x.symbol.toUpperCase() === s.toUpperCase()) || {};
    m = found.type || 'US';
    name ||= found.name;
  }
  if (!name) {
    // Рынок уже известен — берём совпадение только с этого рынка: у «T» это AT&T в США
    // и Т-Технологии в России, перепутать их значит искать новости не по той компании
    const found = await findByName();
    name = found?.name || s;
  }
  return { symbol: s.toUpperCase(), name: name || s, market: m };
}

// ---------------------------------------------------------------- источники новостей
// Формулировки подобраны по живой выдаче Bing: хвост «акции» отсекает половину результатов,
// а «новости» наоборот расширяет выдачу в 2-10 раз. Релевантность всё равно проверит фильтр.
// Источник инструмента Viz: у сохранённой записи он рядом, у восстановленной
// из адреса — в справочнике. От него зависит, спрашивать ли русские ленты
const vizSource = (a) => a.source || INSTRUMENTS.find((i) => i.slug === a.slug)?.source || '';

// Категория инструмента в дательном падеже — для первой строки промпта.
// У доходности и товара род другой, и «по валютной паре Нефть Brent» читалось
// бы как ошибка, поэтому категории разные, а не одна общая «инструменту»
const VIZ_KIND = {
  indices: 'индексу',
  bonds: 'долговому инструменту',
  energy: 'товару',
  metals: 'товару',
  currencies: 'валютной паре',
};
const vizKind = (a) => VIZ_KIND[a.cat || INSTRUMENTS.find((i) => i.slug === a.slug)?.cat] || 'инструменту';

const newsQuery = (a) => {
  // Инструмент «Графиков» ищется по фразам из справочника: биржевой ключ
  // (@LCO.1, EUR=) в поиске не значит ничего, а название целиком у половины
  // записей состоит из общих слов. Первая фраза — основная
  if (a.market === 'VIZ') {
    const p = vizPhrases(a)[0];
    return /новост/i.test(p) || !/[а-я]/i.test(p) ? p : `${p} новости`;
  }
  if (a.market === 'CRYPTO') return `${a.name} ${a.symbol} crypto`;
  if (a.market === 'RU') return `${a.name} новости`;
  return `${a.name} ${a.symbol} stock`;
};

// Все фразы инструмента Viz: у остальных рынков она одна — название с тикером
const vizPhrases = (a) => {
  const inst = INSTRUMENTS.find((i) => i.slug === a.slug);
  return inst ? newsPhrases(inst) : [a.name];
};

function tag(xml, name) {
  const m = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? m[1] : '';
}

const rssItems = (xml) => [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, it]) => it);
const atomEntries = (xml) => [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(([, it]) => it);

function parseDate(v) {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d) ? null : d.toISOString();
}

function item({ title, link, source, published, snippet = '' }) {
  return {
    title: stripTags(title),
    link: decodeEntities(link).trim(),
    source,
    published: published || null,
    snippet: stripTags(snippet).slice(0, 400),
  };
}

async function bingNews(a) {
  const one = async (q) => {
    const url = `https://www.bing.com/news/search?q=${encodeURIComponent(q)}&format=rss&qft=sortbydate%3d%221%22`;
    const res = await get(url, { timeout: 12000 });
    if (!res.ok) throw new Error(`Bing ${res.status}`);
    const xml = await res.text();
    return rssItems(xml).map((it) => {
      let link = decodeEntities(tag(it, 'link')).trim();
      try {
        const real = new URL(link).searchParams.get('url');
        if (real) link = real;
      } catch {}
      return item({
        title: tag(it, 'title'),
        link,
        source: stripTags(tag(it, 'News:Source')) || 'Bing News',
        published: parseDate(tag(it, 'pubDate')),
        snippet: tag(it, 'description'),
      });
    });
  };

  // У инструмента Viz запросов несколько: один даёт 8–12 публикаций, и после
  // фильтра релевантности от них остаётся меньше MIN_NEWS. Спрашиваем все
  // фразы сразу — поиск дешёвый, а генерация по пустому списку всё равно
  // не состоится. Ошибка одной фразы не отменяет остальные
  if (a.market !== 'VIZ') return one(newsQuery(a));
  // «новости» дописываем только к русской фразе: у английской этот хвост
  // меняет выдачу в худшую сторону, а смысла не добавляет
  const q = (p) => (/новост/i.test(p) || !/[а-я]/i.test(p) ? p : `${p} новости`);
  const settled = await Promise.allSettled(vizPhrases(a).map((p) => one(q(p))));
  const out = [];
  for (const r of settled) if (r.status === 'fulfilled') out.push(...r.value);
  if (!out.length) throw new Error('Bing News: ни одна фраза не дала ответа');
  return out;
}

async function yahooNews(a) {
  const sym = a.market === 'CRYPTO' ? `${a.symbol}-USD` : a.symbol;
  const region = a.market === 'RU' ? 'RU' : 'US';
  const lang = a.market === 'RU' ? 'ru-RU' : 'en-US';
  const url = `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(sym)}&region=${region}&lang=${lang}`;
  const res = await get(url, { timeout: 10000 });
  if (!res.ok) throw new Error(`Yahoo RSS ${res.status}`);
  const xml = await res.text();
  return rssItems(xml).map((it) =>
    item({
      title: tag(it, 'title'),
      link: tag(it, 'link'),
      source: 'Yahoo Finance',
      published: parseDate(tag(it, 'pubDate')),
      snippet: tag(it, 'description'),
    })
  );
}

// Reddit режет частые запросы (429), поэтому все обращения идут через очередь с паузой
let redditChain = Promise.resolve();
let redditLastAt = 0;

function redditQueue(fn) {
  const run = redditChain.then(async () => {
    const wait = Math.max(0, redditLastAt + REDDIT_GAP_MS - Date.now());
    if (wait) await new Promise((r) => setTimeout(r, wait));
    try {
      return await fn();
    } finally {
      redditLastAt = Date.now();
    }
  });
  redditChain = run.catch(() => {});
  return run;
}

const SPAM = /(telegram|телеграм|whatsapp|dm me|личк|guaranteed|100% profit|сигнал[а-я]*\s+бесплатн|pump|giveaway|airdrop guide)/i;

async function redditNews(a) {
  const q = a.market === 'CRYPTO' ? a.name : `${a.symbol}`;
  const t = a.market === 'CRYPTO' ? 'day' : 'week';
  const url = `https://www.reddit.com/search.rss?q=${encodeURIComponent(q)}&sort=new&t=${t}`;
  const xml = await redditQueue(async () => {
    const res = await get(url, { timeout: 12000 });
    if (res.status === 429) {
      await new Promise((r) => setTimeout(r, 2500));
      const retry = await get(url, { timeout: 12000 });
      if (!retry.ok) throw new Error(`Reddit ${retry.status}`);
      return retry.text();
    }
    if (!res.ok) throw new Error(`Reddit ${res.status}`);
    return res.text();
  });

  return atomEntries(xml)
    .filter((e) => /<id>t3_/.test(e))
    .map((e) => {
      const sub = (e.match(/<category[^>]*label="([^"]*)"/) || [])[1] || '';
      const text = stripTags(tag(e, 'content'));
      const link = (e.match(/<link href="([^"]*)"/) || [])[1] || '';
      return item({
        title: tag(e, 'title'),
        link: decodeEntities(link),
        source: `Reddit ${sub.replace(/^r\//, 'r/') || ''}`.trim(),
        published: parseDate(tag(e, 'updated')),
        snippet: text.split(/submitted by/)[0].slice(0, 300),
      });
    })
    .filter((x) => x.title.length > 12 && !SPAM.test(x.title + ' ' + x.snippet));
}

async function finamNews(a) {
  const res = await get('https://www.finam.ru/analysis/conews/rsspoint/', { timeout: 12000 });
  if (!res.ok) throw new Error(`Finam ${res.status}`);
  const xml = await res.text();
  return rssItems(xml)
    .map((it) =>
      item({
        title: tag(it, 'title'),
        link: tag(it, 'link'),
        source: 'Финам',
        published: parseDate(tag(it, 'pubDate')),
        snippet: tag(it, 'description'),
      })
    )
    .filter((n) => relevant(n, a, true));
}

async function smartlabNews(a) {
  const res = await get('https://smart-lab.ru/rss/', { timeout: 12000 });
  if (!res.ok) throw new Error(`SmartLab ${res.status}`);
  const xml = await res.text();
  return rssItems(xml)
    .map((it) =>
      item({
        title: tag(it, 'title'),
        link: tag(it, 'link'),
        source: 'Smart-Lab',
        published: parseDate(tag(it, 'pubDate')),
        snippet: tag(it, 'description'),
      })
    )
    .filter((n) => relevant(n, a, false));
}

// Русские падежи меняют только окончание, поэтому сравниваем по префиксу слова:
// «Роснефть» и «Роснефти» дают общий префикс «роснеф». Стемминг по списку суффиксов
// так не умеет — он превращает «Газпром» в «газпр», а «Газпрома» в «газпром».
// Латиницу не трогаем: префикс «appl» поймал бы «applied» и «appliances».
function stemRu(w) {
  // Число — не слово: «2-летние» и «10-летние» различаются ровно цифрой,
  // а стем отрезал бы её вместе с окончанием и сделал инструменты неразличимыми
  if (/^\d+$/.test(w)) return w;
  if (!/[а-я]/i.test(w)) return w;
  if (w.length <= 4) return w;
  if (w.length === 5) return w.slice(0, 4);
  return w.slice(0, w.length - 2);
}

const nameStems = (name) =>
  norm(name)
    .split(' ')
    .filter((w) => /^\d+$/.test(w) || w.length >= (w.match(/[a-z]/) ? 4 : 3))
    .map(stemRu);

// Границы слов, а не подстрока: иначе «rain» находится в «training», а «T» — везде
function hasWord(hay, w) {
  const esc = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-zа-я0-9])${esc}`, 'i').test(hay);
}

// Крипто-названия часто совпадают с обычными словами (Rain, Gram, Near, Sky, Sand),
// поэтому для монет требуем ещё и крипто-контекст в тексте
const CRYPTO_CONTEXT =
  /crypto|крипт|bitcoin|биткоин|blockchain|блокчейн|token|токен|coin(?!c)|альткоин|altcoin|defi|web3|exchange|биржа|etf|стейкинг|staking|onchain|on-chain|валют(а|ы|у)|капитализац/i;

// Публикация относится к активу, если в тексте есть все значимые слова названия или сам тикер
function relevant(n, a, alsoSnippet = false) {
  const raw = `${n.title} ${alsoSnippet ? n.snippet : ''}`;
  if (a.market === 'CRYPTO' && !CRYPTO_CONTEXT.test(raw)) return false;
  // У инструмента «Графиков» символа в публикациях нет: «USD-RUB» — наш слаг,
  // а не обозначение из новости. Судим по фразам справочника и принимаем
  // совпадение с любой из них: название целиком («Доходность 10-летних
  // Германии») требует всех своих слов сразу, и такой публикации не находится
  // ни одной, а «доходность облигаций Германии» находит
  if (a.market === 'VIZ') {
    const hay = norm(raw);
    return vizPhrases(a).some((p) => {
      const stems = nameStems(p);
      return stems.length > 0 && stems.every((s) => hasWord(hay, s));
    });
  }
  const hay = norm(raw);
  const stems = nameStems(a.name);
  if (stems.length && stems.every((s) => hasWord(hay, s))) return true;
  // Знаки в названии («AT&T», «ДОМ.РФ») при нормализации теряются, поэтому проверяем название как есть:
  // иначе у AT&T не остаётся ни одного слова длиннее трёх букв, и тикер «T» совпадает с чем угодно
  if (/[^\p{L}\p{N} ]/u.test(a.name)) {
    const esc = a.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*');
    if (new RegExp(esc, 'i').test(raw)) return true;
  }
  // Названия вроде «BP» или «X5» — это и есть тикер: ищем его с учётом регистра,
  // иначе обычное слово «bp» даст ложное совпадение. Односимвольные сюда не пускаем:
  // «T-Mobile» не имеет отношения к AT&T (его ловит правило выше, по знаку в названии)
  if (!stems.length && a.symbol.length >= 2) {
    return new RegExp(`(^|[^A-Za-z0-9])${a.symbol}([^A-Za-z0-9]|$)`).test(raw);
  }
  // Короткие тикеры (T, V, F, K) случайно совпадают с чем угодно, а «AT&T» даёт слово «t».
  // Такие принимаем только по названию, кроме тикеров с цифрой (X5)
  const sym = a.symbol;
  if (sym.length < 3 && !/\d/.test(sym)) return false;
  return hasWord(hay, sym.toLowerCase());
}

async function moexNews(a) {
  const res = await get('https://iss.moex.com/iss/sitenews.json?iss.meta=off&limit=200', { timeout: 10000 });
  if (!res.ok) throw new Error(`MOEX news ${res.status}`);
  const d = (await res.json()).sitenews;
  const col = Object.fromEntries(d.columns.map((c, i) => [c, i]));
  return d.data
    .map((r) => ({
      title: r[col.title],
      link: `https://www.moex.com/n${r[col.id]}`,
      source: 'Мосбиржа',
      published: parseDate(String(r[col.published_at]).replace(' ', 'T') + '+03:00'),
      snippet: '',
    }))
    .filter((n) => relevant(n, a));
}

function sourceList(a) {
  const list = [['Bing News', () => bingNews(a)]];
  // Инструменту Viz русские ленты подходят, только если он про российский
  // рынок; мировому они дают чужие публикации. Yahoo и Reddit ищут по тикеру,
  // которого у инструмента нет, поэтому не спрашиваются вовсе
  if (a.market === 'VIZ') {
    if (vizSource(a) === 'moex') list.push(['Финам', () => finamNews(a)], ['Smart-Lab', () => smartlabNews(a)]);
    return list;
  }
  if (a.market === 'RU') {
    list.push(['Финам', () => finamNews(a)], ['Smart-Lab', () => smartlabNews(a)], ['Мосбиржа', () => moexNews(a)]);
  } else {
    list.push(['Yahoo Finance', () => yahooNews(a)], ['Reddit', () => redditNews(a)]);
  }
  return list;
}

function dedupe(items) {
  const seen = new Set();
  const out = [];
  for (const n of items) {
    const key = norm(n.title).slice(0, 60);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(n);
  }
  return out;
}

async function collectNews(a) {
  const sources = sourceList(a);
  const settled = await Promise.allSettled(sources.map(([, fn]) => fn()));
  const items = [];
  const used = [];
  const failed = [];

  settled.forEach((r, i) => {
    const [label] = sources[i];
    if (r.status === 'fulfilled' && r.value.length) {
      // Фильтр применяем ко всем источникам: Bing и Reddit регулярно отдают чужие публикации
      const kept = r.value.filter((n) => relevant(n, a, true));
      if (kept.length) {
        used.push(label);
        items.push(...kept);
      }
    } else if (r.status === 'rejected') {
      failed.push(`${label}: ${r.reason?.message || 'ошибка'}`);
    }
  });

  const cutoff = Date.now() - NEWS_WINDOW_H * 3600_000;
  let fresh = items.filter((n) => !n.published || new Date(n.published).getTime() >= cutoff);
  if (fresh.length < 5) fresh = items; // окно слишком узкое для этого тикера

  const ranked = dedupe(fresh)
    .sort((x, y) => new Date(y.published || 0) - new Date(x.published || 0))
    .slice(0, MAX_NEWS);

  // Свежих публикаций нет — не тратим генерацию: модель тут всё равно напишет «данных нет»
  if (ranked.length < MIN_NEWS) {
    throw Object.assign(
      new Error(`Свежих публикаций по этому тикеру не нашлось (${ranked.length} из ${MIN_NEWS} нужных)`),
      { status: 404 }
    );
  }

  return { items: ranked, used, failed };
}

// ---------------------------------------------------------------- саммари
const SUMMARY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['sentiment', 'headline', 'overview', 'key_points', 'risks', 'catalysts', 'community', 'confidence'],
  properties: {
    sentiment: { type: 'string', enum: ['bullish', 'bearish', 'neutral', 'mixed'] },
    headline: { type: 'string', description: 'одна ёмкая фраза — главное за период' },
    overview: { type: 'string', description: '2-4 предложения: что происходит и почему это важно' },
    key_points: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['text', 'refs'],
        properties: {
          text: { type: 'string' },
          refs: { type: 'array', items: { type: 'integer' } },
        },
      },
    },
    risks: { type: 'array', items: { type: 'string' } },
    catalysts: { type: 'array', items: { type: 'string' } },
    community: { type: 'string', description: 'что обсуждают частные инвесторы; пустая строка, если не о чем' },
    confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
  },
};

const ANALYST_SYSTEM =
  'Ты финансовый аналитик. Опираешься только на переданные публикации, ничего не выдумываешь. Ссылки на источники оформляешь в тексте как [1], [2]. ' +
  'Пишешь по-русски: английские термины заменяешь русскими, латиницу оставляешь только для названий компаний, тикеров, продуктов и устоявшихся аббревиатур (IPO, ETF, P/E, EBITDA).';

// Общий вызов модели: схема и системная роль меняются в зависимости от задачи
async function callModel(
  prompt,
  {
    schema = SUMMARY_SCHEMA,
    schemaName = 'summary',
    system = ANALYST_SYSTEM,
    maxTokens = 8000,
    temperature = 0.3,
    model = MODEL,
    // Свежесть важна только для поисковых моделей: без неё Perplexity тянет статьи
    // годичной давности, а вопрос инвестора почти всегда про текущую ситуацию
    recency = '',
    timeoutMs = 120_000,
  } = {}
) {
  // Последняя сетка: дорогая модель не должна уйти в запрос, даже если её имя придёт
  // не из .env, а из новой настройки или будущей правки кода. sonar-pro остаётся
  // поисковой, поэтому ответ не теряет цитаты
  if (EXPENSIVE_MODELS.has(model)) {
    console.warn(`модель ${model} в списке дорогих, вместо неё ${QA_SEARCH_DEFAULT}`);
    model = QA_SEARCH_DEFAULT;
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const body = {
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: prompt },
    ],
    max_tokens: maxTokens,
    temperature,
    // Строгая схема: модель не сможет вернуть обрезанный или обёрнутый в markdown JSON
    response_format: { type: 'json_schema', json_schema: { name: schemaName, strict: true, schema } },
  };
  if (recency) body.search_recency_filter = recency;

  let res;
  try {
    res = await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new Error(`BotHub недоступен: ${e.message}`);
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) throw new Error(`BotHub API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const msg = data.choices?.[0]?.message || {};
  return {
    text: msg.content || '',
    model: data.model || model,
    tokens: data.usage?.total_tokens,
    costUsd: data.usage?.cost,
    // Поисковые модели возвращают список источников отдельным полем — это готовые URL,
    // их не надо выдумывать и потом проверять
    citations: (msg.annotations || [])
      .map((a) => a?.url_citation)
      .filter((c) => c?.url)
      .map((c) => ({ url: c.url, title: c.title || '' })),
    truncated: data.choices?.[0]?.finish_reason === 'length',
  };
}

// На случай, если провайдер проигнорирует схему и вернёт что-то нестандартное
function parseLooseJson(text) {
  const body = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  try {
    return JSON.parse(body);
  } catch {
    let s = text.slice(text.indexOf('{'));
    const stack = [];
    let inStr = false;
    let esc = false;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (inStr) {
        if (esc) esc = false;
        else if (c === '\\') esc = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') inStr = true;
      else if (c === '{' || c === '[') stack.push(c);
      else if (c === '}' || c === ']') {
        stack.pop();
        if (stack.length === 0) return JSON.parse(s.slice(0, i + 1));
      }
    }
    s = s.replace(/,\s*$/, '').replace(/"[^"]*$/, '""').replace(/,\s*$/, '');
    s += stack.reverse().map((c) => (c === '{' ? '}' : ']')).join('');
    return JSON.parse(s);
  }
}

function buildPrompt(a, news) {
  const list = news
    .map((n, i) => {
      const date = n.published ? n.published.slice(0, 16).replace('T', ' ') : 'б/д';
      return `[${i + 1}] ${date} · ${n.source} · ${n.title}${n.snippet ? `\n     ${n.snippet.slice(0, 220)}` : ''}`;
    })
    .join('\n');

  // Род в первой строке промпта задаёт и род всей сводки: «по российской
  // акции Доллар к рублю» модель поняла бы как опечатку и написала бы про акции.
  // У инструмента «Графиков» категория и есть род: индекс, валютная пара,
  // товар, доходность или облигация
  const kind = a.market === 'VIZ' ? vizKind(a) : { CRYPTO: 'криптовалюте', RU: 'российской акции', US: 'акции' }[a.market] || 'активу';
  const subject = a.market === 'VIZ' ? t(a.name) : `${a.name} (${a.symbol})`;
  return `Ниже подборка публикаций по ${kind} ${subject} за последние дни.

${list}

Сделай аналитическое саммари на русском языке для инвестора. Опирайся ТОЛЬКО на эти публикации: не добавляй факты, цифры и события, которых в них нет. Если по какому-то блоку данных нет — верни пустой массив или пустую строку.
Посты Reddit — это мнения частных инвесторов, а не факты: отличай их от новостей и игнорируй рекламу, спам и призывы «написать в личку». Если постов Reddit нет, верни community пустой строкой.
key_points — 3-6 пунктов, risks и catalysts — по 0-4. В refs указывай номера публикаций из списка выше.

Язык. Пиши по-русски. Англицизмы не переноси из публикаций механически: у понятия должен быть русский термин.
- «core search» → «основной поисковый бизнес», «поисковая реклама»; «Cloud» → «облачный сегмент»; «big tech» → «крупнейшие технологические компании»; «кэшфлоу», «free cash flow» → «свободный денежный поток»; «guidance» → «прогноз компании»; «capex» → «капитальные затраты»; «postmarket» → «после закрытия торгов»; «AI-капитал» → «вложения в ИИ».
- Оставляй латиницей только устоявшееся: тикеры и названия компаний и продуктов (Alphabet, Google, iPhone, ChatGPT), аббревиатуры (IPO, ETF, P/E, EBITDA, ИИ), а также термины, у которых нет общепринятого русского перевода (smart money, buyback — можно, «обратный выкуп» тоже годится).
- Названия отраслей и сегментов бизнеса переводи: не «advertising», а «реклама»; не «search», а «поиск».
- Если очень нужно оставить английский термин, при первом упоминании дай русский эквивалент: «свободный денежный поток (free cash flow)».`;
}

async function summarize(a, news) {
  const prompt = buildPrompt(a, news);
  let last = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const out = await callModel(prompt);
    let parsed;
    try {
      parsed = parseLooseJson(out.text);
    } catch {
      parsed = null;
    }
    const clean = validateSummary(parsed);
    if (clean) return { ...clean, model: out.model, tokens: out.tokens, costUsd: out.costUsd };
    last = out;
    console.warn(`саммари ${a.market}:${a.symbol}: попытка ${attempt + 1} вернула невалидный ответ`);
  }
  throw Object.assign(new Error(t('Модель вернула некорректный ответ, попробуйте позже')), { status: 502 });
}

// ---------------------------------------------------------------- перевод сводок
// Саммари переводится сразу после генерации: страница /en не должна
// собираться по заходу посетителя. Провал перевода не отменяет сводку —
// покажется русский текст
async function translateSummary(a, summary, lang) {
  const out = await callModel(buildTranslatePrompt(a, summary, lang), {
    schema: TRANSLATION_SCHEMA,
    schemaName: 'translation',
    system: TRANSLATION_SYSTEM,
    maxTokens: 3000,
    temperature: 0.2,
    timeoutMs: 90_000,
  });
  const tr = applyTranslation(summary, parseLooseJson(out.text));
  if (!tr) return null;
  return { ...tr, model: out.model, tokens: out.tokens, costUsd: out.costUsd };
}

async function translateAll(a, summary) {
  const out = {};
  let tokens = 0;
  let costUsd = 0;
  for (const lang of Object.keys(TRANS_LANG)) {
    try {
      const tr = await translateSummary(a, summary, lang);
      if (!tr) {
        console.warn(`перевод ${a.market}:${a.symbol} ${lang}: модель вернула невалидный ответ`);
        continue;
      }
      out[lang] = tr;
      tokens += tr.tokens || 0;
      costUsd += tr.costUsd || 0;
    } catch (e) {
      // Сеть и лимиты провайдера — не повод терять сводку целиком
      console.warn(`перевод ${a.market}:${a.symbol} ${lang}: ${e.message}`);
    }
  }
  return { i18n: out, tokens, costUsd };
}

async function buildSummary(a) {
  const { items, used, failed } = await collectNews(a);
  if (!items.length) {
    throw Object.assign(new Error(t('Свежих публикаций по этому тикеру не нашлось')), { status: 404 });
  }
  const summary = await summarize(a, items);
  // Переводы идут сразу: страница /en не должна собираться по заходу посетителя.
  // Провал перевода не отменяет сводку — покажется русский текст
  const tr = await translateAll(a, summary);
  // Расход считаем по факту генерации, а не по содержимому кеша: записи из старых версий его не хранят
  const costUsd = (summary.costUsd || 0) + tr.costUsd;
  const tokens = (summary.tokens || 0) + tr.tokens;
  if (costUsd) totalCostUsd += costUsd;
  if (tokens) totalTokens += tokens;
  return {
    asset: a,
    summary: { ...summary, costUsd, tokens },
    i18n: tr.i18n,
    news: items,
    sources: used,
    warnings: failed,
    generatedAt: new Date().toISOString(),
    windowHours: NEWS_WINDOW_H,
  };
}

function meta(rec, cached) {
  return {
    cached,
    expiresAt: new Date(new Date(rec.generatedAt).getTime() + CACHE_TTL_MS).toISOString(),
    nextRefreshAt: new Date(new Date(rec.generatedAt).getTime() + REFRESH_COOLDOWN_MS).toISOString(),
    // Часы нужны тексту предупреждения об устаревании: он должен называть настоящий
    // TTL, а не зашитое в шаблон число, которое разойдётся с настройкой
    ttlHours: Math.round(CACHE_TTL_MS / 3600_000),
  };
}

const isFresh = (rec) => rec && Date.now() - new Date(rec.generatedAt).getTime() < CACHE_TTL_MS;
const cooldownLeft = (rec) =>
  rec ? Math.max(0, REFRESH_COOLDOWN_MS - (Date.now() - new Date(rec.generatedAt).getTime())) : 0;

// refresh: 'force' — пересобрать мимо кеша (кулдаун проверяет вызывающий код),
// origin: 'crawler' ограничения для пользователей не действуют
async function getSummary(a, { force = false } = {}) {
  const key = cacheKey(a);
  const hit = cache[key];
  if (!force && isFresh(hit)) return { ...hit, ...meta(hit, true) };

  if (!inflight.has(key)) {
    inflight.set(
      key,
      buildSummary(a)
        .then((r) => {
          cache[key] = r;
          saveCache();
          return r;
        })
        .finally(() => inflight.delete(key))
    );
  }
  const r = await inflight.get(key);
  return { ...r, ...meta(r, false) };
}

// Тикер, который открыл человек, снова попадает в ежедневную ротацию —
// даже если крон успел записать его в «тонкие»
function reviveThin(a) {
  const key = cacheKey(a);
  let changed = false;
  if (typeof crawlerState?.thin === 'object' && crawlerState.thin[key]) {
    delete crawlerState.thin[key];
    changed = true;
  }
  if (crawlerState?.thinAt && crawlerState.thinAt[key]) {
    delete crawlerState.thinAt[key];
    changed = true;
  }
  if (changed) saveCrawlerState();
}

// ---------------------------------------------------------------- лимиты
const genLog = [];
function allowGeneration() {
  const now = Date.now();
  while (genLog.length && now - genLog[0] > 3600_000) genLog.shift();
  if (genLog.length >= MAX_GEN_PER_HOUR) return false;
  genLog.push(now);
  return true;
}

// Лимиты на посетителя. Caddy складывает реальный адрес последним в X-Forwarded-For,
// поэтому берём именно последний элемент: первые может прислать сам клиент.
function clientIp(req) {
  const fwd = String(req.headers['x-forwarded-for'] || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const ip = fwd.length ? fwd[fwd.length - 1] : req.socket.remoteAddress || 'unknown';
  return ip.replace(/^::ffff:/, '');
}

const ipLog = new Map(); // ip -> { gen: number[], search: number[], forum: number[] }
function ipBucket(ip, field, windowMs, limit) {
  const now = Date.now();
  let b = ipLog.get(ip);
  if (!b) {
    b = { gen: [], search: [], forum: [] };
    ipLog.set(ip, b);
  }
  const arr = b[field];
  while (arr.length && now - arr[0] > windowMs) arr.shift();
  if (arr.length >= limit) return Math.ceil((windowMs - (now - arr[0])) / 1000);
  arr.push(now);
  return 0;
}

// Память не должна расти бесконечно: раз в час выбрасываем пустые записи
setInterval(() => {
  const now = Date.now();
  for (const [ip, b] of ipLog) {
    b.gen = b.gen.filter((t) => now - t < 3600_000);
    b.search = b.search.filter((t) => now - t < 60_000);
    b.forum = (b.forum || []).filter((t) => now - t < 3600_000);
    if (!b.gen.length && !b.search.length && !b.forum.length) ipLog.delete(ip);
  }
}, 600_000).unref();

// ---------------------------------------------------------------- вопросы
// Вопрос с ответом становится отдельной индексируемой страницей, поэтому он собирается
// один раз и живёт в файле: повторный показ не тратит деньги.
const questionStore = createQuestionStore(QUESTIONS_FILE, { log });

// ---------------------------------------------------------------- форум
// Вход по фразе, как в MetaMask: пароля нет, аккаунт выводится из фразы детерминированно.
// В куке — только подписанный ключ аккаунта, сама фраза на сервере не хранится.
const forumStore = createForumStore(FORUM_FILE, { log });
const FORUM_SECRET = loadSecret(FORUM_SECRET_FILE, { log });

const COOKIE = 'bd_session';
const parseCookies = (req) =>
  Object.fromEntries(
    String(req.headers.cookie || '')
      .split(';')
      .map((s) => s.trim().split('='))
      .filter(([k]) => k)
      .map(([k, v]) => [k, decodeURIComponent(v || '')])
  );

const isHttps = () => SITE_URL.startsWith('https://');

function setSessionCookie(res, key, { maxAge = 365 * 24 * 3600 } = {}) {
  const parts = [
    `${COOKIE}=${encodeURIComponent(signSession(FORUM_SECRET, key))}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
  ];
  if (isHttps()) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

// Интервал свечей запоминается одной кукой на весь сайт: выбрал «День» на
// одном графике — тот же интервал откроется и на следующем, и на тикере.
// Куку пишет скрипт (переключение идёт без перезагрузки), а сервер читает её,
// когда в адресе нет явного ?tf=. Порядок: адрес, потом кука, потом умолчание
// страницы — поисковик кук не присылает и видит тот интервал, что обещан
// в заголовке и canonical.
const TF_COOKIE = 'tf';

// Ближайший интервал из тех, что страница вообще умеет показать. Наборы
// рынков разные: у Мосбиржи есть 10 минут и нет 30, у США наоборот. Оставить
// запомненное число как есть значило бы отдать 404 или пустой ряд
function nearestTf(key, list) {
  if (!key || list.includes(key)) return key || null;
  const want = TIMEFRAMES[key]?.sec;
  if (!want) return null;
  // Сравниваем логарифмы: разница «5 мин против 15» и «час против трёх часов»
  // в секундах несопоставима, а на слух это одно и то же расстояние
  let best = null;
  let bestGap = Infinity;
  for (const k of list) {
    const gap = Math.abs(Math.log(TIMEFRAMES[k].sec / want));
    if (gap < bestGap) {
      bestGap = gap;
      best = k;
    }
  }
  return best;
}

// Интервал страницы: явный параметр главнее запомненного
function pickTf(req, url, list, fallback) {
  const raw = String(url.searchParams.get('tf') || '');
  if (raw && list.includes(raw)) return raw;
  return nearestTf(parseCookies(req)[TF_COOKIE], list) || fallback;
}

// Набор рынков: явный параметр адреса, иначе набор языка. Куки здесь нет
// намеренно — ответ остаётся общим для всех и кешируется, а выбор человека
// едет в ссылке. Категории, которой в наборе нет, соответствует «Все»:
// страница не должна отдавать пустую сетку из-за параметра в адресе
function pickSet(url, cat) {
  const raw = String(url.searchParams.get('set') || '');
  const set = isSet(raw) ? raw : defaultSet(getLang());
  if (cat !== 'all' && !catsOf(set).some((c) => c.key === cat)) return { set, cat: 'all' };
  return { set, cat };
}

// Интервал пришёл из куки, а не из адреса. Такой ответ у каждого посетителя
// свой: в общий кеш его отдавать нельзя, браузеру — можно, ключ там меняется
// вместе с кукой (Vary: Cookie)
function tfFromCookie(req, url) {
  return !url.searchParams.get('tf') && Boolean(parseCookies(req)[TF_COOKIE]);
}

// Скрытые карточки читаются из куки: доска личная, но адрес у неё один —
// иначе каждый набор убранных карточек стал бы отдельной страницей в индексе.
// Куку ставит ответ на форму, читает и сервер, и он же отдаёт доску без
// скрытого: скрипт перерисовки карточек о скрытии просто не знает
const hiddenOf = (req) => parseHidden(parseCookies(req)[HIDE_COOKIE]);
function writeHiddenCookie(res, hidden) {
  const value = hiddenValue(hidden);
  const parts = [
    `${HIDE_COOKIE}=${encodeURIComponent(value)}`,
    'Path=/',
    'SameSite=Lax',
    // Пустой список удаляет куку: «показать все» не должно оставлять после
    // себя след, из-за которого доска останется персональной
    `Max-Age=${value ? 31536000 : 0}`,
  ];
  if (isHttps()) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

// Кто пришёл: аккаунт по подписанной куке. Подпись проверяется, поэтому куку нельзя подделать
function currentUser(req) {
  const token = parseCookies(req)[COOKIE];
  const key = token ? readSession(FORUM_SECRET, token) : null;
  if (!key) return { me: false, account: null, key: null };
  const account = forumStore.accountByKey(key);
  return account ? { me: true, account, key } : { me: false, account: null, key: null };
}

// Куда вернуть после входа: только свой путь. Протокол-относительные «//evil.com» отсекаем,
// иначе форма входа превращается в открытый редирект
const safeNext = (raw, fallback = '/catalog') => {
  const s = String(raw || '');
  if (!s.startsWith('/') || s.startsWith('//') || s.startsWith('/\\')) return fallback;
  return s;
};

// Ответ на форму: 303 на GET, чтобы обновление страницы не отправляло пост второй раз.
// Адрес переводится в язык текущего запроса: ответ на форму на /en/... не должен
// выбрасывать человека в русскую версию
const redirect = (res, location) => {
  res.writeHead(303, { Location: langHref(getLang(), location) });
  res.end();
};

// Ошибку показываем текстом на странице формы, а не в URL: источник не должен отражаться
const formError = (res, html) => sendHtml(res, html, { status: 200, cache: 'no-store' });

// Тот же вызов отвечает и решает, публиковать ли вопрос: отдельная заслонка
// стоила вторых денег и видела вопрос отдельно от ответа на него
const ANALYST_QA_SYSTEM =
  'Ты ИИ-аналитик сервиса, который объясняет ситуацию по конкретному активу. ' +
  'Ты не даёшь индивидуальных инвестиционных рекомендаций и не обещаешь доходность. ' +
  'Ты никогда не называешь свою модель и разработчика. ' +
  'Сначала ставишь verdict (ok, off_topic, profanity или spam), затем ответ и заголовок: ' +
  'вне темы, с матом или со спамом — пустые title, answer и bullets, постороннюю просьбу не выполняешь.';

// Разбор ответа модели: общая часть для поиска и для ответа по кешу
function titleProblem(raw) {
  const t = String(raw || '').trim();
  if (t.length < 12) return 'короткий';
  if (t.length > 120) return 'длинный';
  if (/[<>]/.test(t)) return 'разметка';
  return null;
}

// Запасной заголовок, если модель не дала пригодный: вопрос без мата,
// обрезанный по границе слова. Публикуется редко, но страница не должна остаться без title
function fallbackTitle(asset, question) {
  const clean = String(question || '').replace(/\s+/g, ' ').trim().replace(/[?!.]+$/, '');
  const cut = clean.length > 90 ? clean.slice(0, 90).replace(/\s+\S*$/, '') + '…' : clean;
  return `${cut} — ${asset.symbol}`;
}

const VERDICTS = ['ok', 'off_topic', 'profanity', 'spam'];

function parseAnswer(out, asset, question) {
  let parsed = null;
  try {
    parsed = parseLooseJson(out.text);
  } catch {
    parsed = null;
  }
  const answer = typeof parsed?.answer === 'string' ? parsed.answer.trim() : '';
  const bullets = Array.isArray(parsed?.bullets)
    ? parsed.bullets.filter((b) => typeof b === 'string' && b.trim()).slice(0, 4)
    : [];
  const confidence = ['low', 'medium', 'high'].includes(parsed?.confidence) ? parsed.confidence : 'medium';
  const rawTitle = String(parsed?.title || '').replace(/\s+/g, ' ').trim();
  const title = titleProblem(rawTitle) ? fallbackTitle(asset, question) : rawTitle;

  // Вердикт ставит та же модель, что отвечала. Слишком короткий ответ при ok
  // разбирают вызывающие: это сбой модели, а не посторонний вопрос
  const verdict = VERDICTS.includes(parsed?.verdict) ? parsed.verdict : 'ok';

  return {
    title,
    titleGenerated: !titleProblem(rawTitle),
    answer,
    bullets,
    confidence,
    verdict,
    raw: parsed,
  };
}

// Ответ по кешу новостей: дёшево, но знает только то, что попало в суточную подборку
async function answerFromCache(asset, rec, question) {
  const out = await callModel(buildQaPrompt({ asset, rec, question }), {
    schema: QA_SCHEMA,
    schemaName: 'qa_answer',
    maxTokens: 3000,
    system: `${ANALYST_QA_SYSTEM} Опираешься только на переданные публикации, ничего не выдумываешь.`,
  });
  const parsedOut = parseAnswer(out, asset, question);
  if (parsedOut.verdict !== 'ok') return { verdict: parsedOut.verdict, answer: '', meta: out };
  const { title, titleGenerated, answer, bullets, confidence, raw } = parsedOut;

  const ids = Array.isArray(raw?.refs) ? raw.refs.filter((n) => Number.isInteger(n)) : [];
  const refs = ids.filter((n) => n >= 1 && n <= (rec.news || []).length);
  const sources = refs
    .map((n) => {
      const item = (rec.news || [])[n - 1];
      return item?.link ? { url: item.link, title: item.title || item.source || '' } : null;
    })
    .filter(Boolean);

  return { verdict: 'ok', title, titleGenerated, answer, bullets, confidence, refs, sources, meta: out };
}

// Ответ с поиском в интернете: дороже (~$0.005-0.015), но видит отчётность и свежие новости.
// Источники приходят готовыми URL, поэтому refs не нужны — в тексте они остаются как [N].
async function answerFromWeb(asset, rec, question) {
  const out = await callModel(buildSearchPrompt({ asset, rec, question }), {
    schema: QA_SCHEMA,
    schemaName: 'qa_answer',
    maxTokens: 2000,
    model: QA_SEARCH_MODEL,
    recency: QA_SEARCH_RECENCY,
    timeoutMs: 180_000,
    system: `${ANALYST_QA_SYSTEM} Ты ищешь данные в интернете и опираешься только на найденные источники.`,
  });
  const parsedOut = parseAnswer(out, asset, question);
  if (parsedOut.verdict !== 'ok') return { verdict: parsedOut.verdict, answer: '', meta: out };
  const { title, titleGenerated, answer, bullets, confidence } = parsedOut;
  if (out.truncated) log(`вопрос ${asset.market}:${asset.symbol}: ответ обрезан по лимиту токенов`);

  // Номера в тексте ([3]) заменяем на настоящие ссылки из цитат поисковика
  const sources = out.citations.map((c, i) => ({ url: c.url, title: c.title, anchor: `q-ref-${i + 1}` }));
  return { verdict: 'ok', title, titleGenerated, answer, bullets, confidence, refs: [], sources, meta: out };
}

async function answerQuestion(asset, rec, question) {
  const key = `${asset.market}:${asset.symbol}`;

  if (QA_SEARCH_ON) {
    try {
      const res = await answerFromWeb(asset, rec, question);
      if (res.verdict !== 'ok') return res;
      if (res.answer.length >= 40) return { ...res, mode: 'web', model: QA_SEARCH_MODEL };
      log(`вопрос ${key}: поиск вернул пустой ответ, откат на кеш`);
    } catch (e) {
      log(`вопрос ${key}: поиск не удался (${e.message}), откат на кеш`);
      if (!QA_FALLBACK_TO_CACHE) {
        throw Object.assign(new Error(t('Поиск сейчас недоступен. Попробуйте через несколько минут.')), { status: 502 });
      }
    }
  }

  const res = await answerFromCache(asset, rec, question);
  if (res.verdict !== 'ok') return res;
  if (res.answer.length < 40) {
    throw Object.assign(new Error(t('Модель не смогла ответить на вопрос. Попробуйте переформулировать.')), {
      status: 502,
    });
  }
  return { ...res, mode: 'cache', model: MODEL };
}

// ---------------------------------------------------------------- крон
const CRAWLER_STATE_FILE = path.join(DATA_DIR, 'crawler-state.json');

function loadCrawlerState() {
  try {
    const s = JSON.parse(fs.readFileSync(CRAWLER_STATE_FILE, 'utf8'));
    const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
    // backoff тоже переживает перезапуск: иначе после рестарта крон сразу бьёт
    // по тем же тикерам и второй раз засчитывает страйк за те же сутки
    return { thin: obj(s?.thin), thinAt: obj(s?.thinAt), backoff: obj(s?.backoff) };
  } catch {
    return { thin: {}, thinAt: {}, backoff: {} };
  }
}

function saveCrawlerState() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFile(CRAWLER_STATE_FILE, JSON.stringify(crawlerState, null, 2), () => {});
  } catch {}
}

const crawlerState = loadCrawlerState();

// Расход считает сам провайдер, а не наш счётчик в памяти: после перезапуска
// счётчик обнулялся, а повторная генерация по тикеру затирала прежнюю запись в кеше
// вместе с её расходом. Отчёт BotHub — единственный источник, который это переживает.
// Свой крон: отчёт весит сотни килобайт, чаще раза в несколько часов его тянуть незачем
const spendTracker = createSpendTracker({
  apiKey: API_KEY,
  dataFile: SPEND_FILE,
  log,
  // Ключ .env — это ключ проекта, его расход и считаем. Разработка идёт другим ключом
  // и в этот итог не входит — иначе сайт показывал бы чужой счёт
  from: process.env.SPEND_FROM || '2026-11-01',
  intervalMs: (Number(process.env.SPEND_INTERVAL_HOURS) || 6) * 3600_000,
  enabled: process.env.SPEND_ENABLED !== '0',
  usdRate: () => currentUniverse()?.usdRate ?? null,
});

// Дивиденды живут своим файлом и своим кроном: новостной пишет cache.json и тратит
// деньги на модель, а это справочные данные из бесплатных источников.
const dividendStore = createDividendStore(DIVIDENDS_FILE, { log });
const dividendCrawler = createDividendCrawler({
  store: dividendStore,
  // Список уже загружен при старте: сеть для него не нужна, а дивиденды
  // не должны ждать, пока новостной крон соберёт вселенную заново
  listUniverse: async () => currentUniverse() || (await getUniverse(CRAWLER, log)),
  // Тестовая копия не должна ходить по сети: гасим её тем же CRAWLER_ENABLED=0,
  // а отдельный флаг оставлен, чтобы можно было выключить только дивиденды
  enabled: CRAWLER.enabled && process.env.DIVIDENDS_ENABLED !== '0',
  intervalMs: (Number(process.env.DIVIDENDS_INTERVAL_HOURS) || 24) * 3600_000,
  log,
});

// Индексы — тоже бесплатные справочные данные, но, в отличие от дивидендов,
// значение меняется весь торговый день. Поэтому свой крон с коротким интервалом:
// история и состав раз в сутки, значения — каждые несколько минут.
const indexStore = createIndexStore(INDICES_FILE, { log });
const indexCrawler = createIndexCrawler({
  store: indexStore,
  enabled: CRAWLER.enabled && process.env.INDICES_ENABLED !== '0',
  quoteMs: (Number(process.env.INDICES_QUOTE_MIN) || 5) * 60_000,
  log,
});

// Графики — тоже справочные данные без модели: год дневных закрытий по каждой
// бумаге. Свой файл и свой крон по той же причине, что у дивидендов.
const chartStore = createChartStore(CHARTS_FILE, { log });
const chartCrawler = createChartCrawler({
  store: chartStore,
  // Не только дневной список: страница тикера живёт и после того, как бумага
  // выпала из списка, — она открывается из кеша. Без этого SBERP показывал
  // «данных нет», хотя страница у него есть и сводка на месте
  listUniverse: async () => {
    const base = currentUniverse() || (await getUniverse(CRAWLER, log));
    const items = [...(base?.items || [])];
    const known = new Set(items.map((a) => `${a.market}:${a.symbol}`));
    for (const rec of Object.values(cache)) {
      const a = rec?.asset;
      if (!a?.symbol || !a.market) continue;
      const k = `${a.market}:${a.symbol}`;
      if (known.has(k)) continue;
      known.add(k);
      items.push(a);
    }
    return { ...base, items };
  },
  enabled: CRAWLER.enabled && process.env.CHARTS_ENABLED !== '0',
  intervalMs: (Number(process.env.CHARTS_INTERVAL_HOURS) || 24) * 3600_000,
  log,
});
// Внутридневные ряды живут в памяти с коротким сроком: в файл их не положить,
// они устаревают раньше, чем закончится запись
const chartSeries = createChartSeries({ store: chartStore, log });

// Страница «Графики»: индексы, облигации, энергия, металлы и валюты.
// Своего файла у неё нет — все ряды справочные и запрашиваются по требованию,
// поэтому кеш живёт в памяти и отдельного крона не требует
const marketFeed = createMarketFeed({ log });

// Реалтайм-котировки: цена и изменение за день каждые несколько секунд.
// Своего файла нет намеренно — значение, записанное на диск, к следующему
// чтению уже устарело. Опрос идёт на сервере, потому что источник отдаёт весь
// рынок одним пакетом: браузеру остаётся один запрос к нам за всеми ценами
const realtime = createRealtime({
  // Своя переменная, а не CRAWLER_ENABLED: опрос котировок к новостному крону
  // отношения не имеет, и выключение крона в тестовой копии не должно гасить
  // цены — иначе проверять реалтайм не на чем
  enabled: process.env.REALTIME_ENABLED !== '0',
  intervalMs: (Number(process.env.REALTIME_SEC) || 5) * 1000,
  log,
});

const crawler = createCrawler({
  cfg: CRAWLER,
  log,
  cache,
  cacheKey,
  isFresh,
  // TTL передаётся, чтобы крон считал срок от него: при TTL 26 ч и интервале 24 ч
  // сводка должна обновляться до истечения, а не «за 90% интервала»
  ttlMs: CACHE_TTL_MS,
  refresh: (asset) => getSummary(asset, { force: true }),
  state: crawlerState,
  onDone: saveCrawlerState,
  listUniverse: async () => {
    const u = await getUniverse(CRAWLER, log);
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFile(UNIVERSE_FILE, JSON.stringify(u, null, 2), () => {});
    } catch {}
    // Страницы тикеров живут и после того, как бумага выпала из дневного списка:
    // префы вроде SBERP схлопываются с обыкновенными, но у них своя страница в каталоге
    // и в sitemap. Без этого их сводка не обновляется никогда — тот же довод, что
    // у крона графиков. Четыре лишних генерации в сутки стоят меньше рубля
    const items = [...(u?.items || [])];
    const known = new Set(items.map((a) => cacheKey(a)));
    // Инструменты «Графиков» в дневную вселенную не входят: их собирает
    // справочник рынков, а не биржевой скрин. Но сводка, форум и вопросы у них
    // те же, что у тикера, и без этой строки их страницы оставались бы пустыми
    // навсегда — крон обновлял бы только бумаги каталога
    for (const a of vizAssets()) {
      const k = cacheKey(a);
      if (known.has(k)) continue;
      known.add(k);
      items.push(a);
    }
    for (const rec of Object.values(cache)) {
      const a = rec?.asset;
      if (!a?.symbol || !a.market) continue;
      const k = cacheKey(a);
      if (known.has(k)) continue;
      known.add(k);
      items.push(a);
    }
    return { ...u, items };
  },
});

// Список тикеров с прошлого запуска подхватываем сразу, чтобы сайт не ждал сеть
try {
  const u = JSON.parse(fs.readFileSync(UNIVERSE_FILE, 'utf8'));
  if (u?.items?.length) {
    loadedUniverse(u);
    log(`список тикеров из файла: ${u.items.length}`);
  }
} catch {}

// ---------------------------------------------------------------- страницы// Каталог и страницы тикеров рендерятся на сервере: без этого поисковики
// видят пустую оболочку, потому что весь контент раньше собирался в браузере.
function universeItems() {
  return currentUniverse()?.items || [];
}

// Дивиденды ключуются как кеш: MARKET:SYMBOL. Отдаём только то, что уже собрано —
// страница не должна ждать сеть, а крон догонит на первом проходе
const dividendFor = (asset) => dividendStore.get(`${asset.market}:${asset.symbol}`);

// График ключуется так же. Интервал приходит из ?tf=, и он же задаёт окно:
// отдельного ?period= больше нет — человек выбирает свечу, а не два параметра,
// которые друг друга перебивают. Канонической остаётся страница без параметров,
// иначе поисковик увидит десятки копий, отличающихся только графиком.
// Внутридневной ряд берётся по сети, поэтому функция асинхронная; день, неделя
// и месяц собираются из файла и сети не требуют вовсе
// Живой процент поверх котировки карточки «Графиков». Цена и там приходит
// сетью, но изменение у Мосбиржи считается к предыдущей сделке, а не к
// вчерашнему закрытию — на карточке это выглядело как «0.00%» при −0,19%.
// Ключ ищем по биржевому символу через sourceCode, как и в разметке карточки
function liveForInstrument(inst, quote) {
  const idx = INDEXES.find((i) => i.sourceCode === inst.code);
  const live = idx ? realtime.get(`IDX:${idx.code}`) : null;
  if (!live) return quote;
  return { ...(quote || {}), price: live.price, pct: live.pct, prev: live.prev ?? quote?.prev ?? null };
}

async function chartHtmlFor(asset, { tf: tfParam = '' } = {}) {
  const tf = tfList(asset.market).includes(String(tfParam || '')) ? String(tfParam) : DEFAULT_TF;
  const rec = chartStore.get(`${asset.market}:${asset.symbol}`);
  try {
    const series = await chartSeries.get(asset, rec, tf);
    return chartBlock({
      asset,
      rec,
      series,
      tf,
      // Живая цена на странице тикера: тот же ключ, что у сводки и таблицы
      // капитализации — страница ищет цену по нему же
      live: realtime.quoteOf(asset.market, asset.symbol),
      // Ссылки относительные: страница должна работать и на тестовой копии
      // с чужим портом, где абсолютный адрес увёл бы на прод
      canonicalPath: tickerPath(asset),
    });
  } catch (e) {
    // График — украшение, а не причина отдать 500 на всю страницу:
    // сводка, обсуждение и дивиденды важнее свечей
    log(`график ${asset.market}:${asset.symbol}: ${e.message}`);
    return '';
  }
}

// Ключ -> актив: нужен сводной странице и карте сайта, где дивиденды приходят
// отдельным списком без ссылки на бумагу
function assetByKey() {
  const map = new Map();
  for (const a of universeItems()) map.set(`${a.market}:${a.symbol}`, a);
  return map;
}

// Тикеры, у которых есть страница: состав индекса ссылается только на них,
// чтобы список не вёл в 404. Кеш тоже считается — записи о бумагах,
// выпавших из дневного списка, продолжают жить
function knownSymbols() {
  const set = new Set();
  for (const a of universeItems()) set.add(a.symbol);
  for (const rec of Object.values(cache)) if (rec?.asset?.symbol) set.add(rec.asset.symbol);
  return set;
}

// Каталог — про бумаги и монеты. Инструмент «Графиков» живёт на своей вкладке
// со своим адресом, и в алфавитном списке бумаг он был бы ссылкой не туда
const IN_CATALOG = new Set(['RU', 'US', 'CRYPTO']);

function marketGroups() {
  const groups = { RU: [], US: [], CRYPTO: [] };
  for (const a of universeItems()) {
    if (IN_CATALOG.has(a.market)) groups[a.market].push(a);
  }
  // В каталог попадают и тикеры вне ежедневного списка, если они уже собраны
  const known = new Set(universeItems().map((a) => `${a.market}:${a.symbol}`));
  for (const rec of Object.values(cache)) {
    const k = `${rec.asset.market}:${rec.asset.symbol}`;
    if (!known.has(k) && IN_CATALOG.has(rec.asset.market)) {
      groups[rec.asset.market].push(rec.asset);
      known.add(k);
    }
  }
  return groups;
}

function cachedRecent(limit = 14) {
  return Object.values(cache)
    .filter((r) => IN_CATALOG.has(r?.asset?.market))
    .sort((a, b) => String(b.generatedAt).localeCompare(String(a.generatedAt)))
    .slice(0, limit);
}

function findAsset(market, symbol) {
  const sym = String(symbol || '').toUpperCase();
  const m = String(market || '').toUpperCase();
  const hit = cache[`${m}:${sym}`]?.asset;
  if (hit) return hit;
  // Инструменты «Графиков» в списке бумаг не лежат: их справочник свой.
  // Восстанавливаем объект из слага, поэтому форум и вопросы открываются
  // даже до того, как по инструменту собрана сводка
  if (m === 'VIZ') return vizBySymbol(sym);
  return universeItems().find((a) => a.market === m && a.symbol.toUpperCase() === sym) || null;
}

// Соседние тикеры того же рынка: по алфавиту вокруг текущего
function relatedAssets(asset, limit = 10) {
  // У инструмента «Графиков» соседи — своя категория: «другие валюты» полезнее
  // случайных бумаг каталога, которых рядом с индексом просто нет
  if (asset.market === 'VIZ') {
    const own = INSTRUMENTS.find((i) => i.slug === asset.slug);
    return INSTRUMENTS.filter((i) => i.cat === own?.cat && i.slug !== asset.slug)
      .map(vizAsset)
      .slice(0, limit);
  }
  const items = (marketGroups()[asset.market] || []).filter((a) => a.symbol !== asset.symbol);
  const sorted = [...items].sort((x, y) => String(x.name).localeCompare(String(y.name), 'ru'));
  const i = Math.max(
    0,
    sorted.findIndex((a) => String(a.name).localeCompare(String(asset.name), 'ru') > 0)
  );
  const start = Math.max(0, Math.min(i - Math.floor(limit / 2), sorted.length - limit));
  return sorted.slice(start, start + limit);
}

// Число ответов по каждой теме тикера: список на странице показывает счётчик,
// а сам счётчик считается по всему поддереву, поэтому берём его из хранилища
// Блок обсуждения на странице тикера. Рендерер получает готовый HTML,
// чтобы lib/render.js не тянул за собой lib/forum-render.js и не замыкал импорт
const forumHtmlFor = (asset, user, { notice = '', error = '', title = '', body = '' } = {}) => {
  if (!FORUM_ENABLED) return '';
  return forumBlock({
    asset,
    me: user.me,
    account: user.account,
    threads: forumStore.threads(cacheKey(asset)).slice(0, 20),
    // Дерево строит рендерер, поэтому ему нужны все сообщения тикера, а не только корни
    messages: forumStore.messagesOf(cacheKey(asset)),
    notice,
    error,
    title,
    body,
  });
};

// Актив по ключу кеша «РЫНОК:СИМВОЛ»: нужен сводным страницам форума и FAQ,
// где запись приходит без ссылки на бумагу. Справочник, кеш, затем Viz —
// тот же порядок, что у findAsset, но по одной строке ключа
const assetOfKey = (key) => {
  const [m, sym] = String(key || '').split(':');
  return findAsset(m, sym);
};

// Счётчики общего форума: сколько веток и сколько сообщений вместе с ответами.
// Само дерево строит рендерер по всем сообщениям — второй обход здесь был бы
// ещё одной копией логики вложенности
const forumCounts = () => {
  const all = forumStore.allMessages();
  return { threads: all.filter((m) => !m.parent).length, messages: all.length };
};

// Поиск тикера по тому, что человек вписал в поле «Тикер» общего форума.
// Принимаем и «SBER», и «ru:SBER», и «AAPL» — рынок ищется по всем трём
// справочникам, потому что поле одно, а рынков три. Возвращаем ключ кеша:
// тема хранится им же, и второй формы записи рынка не заводим
const tickerFromInput = (raw) => {
  const v = String(raw || '').trim();
  if (!v) return null;
  const [maybeMarket, maybeSym] = v.includes(':') ? v.split(':') : ['', v];
  const hint = String(maybeMarket || '').toUpperCase();
  const sym = String(maybeSym || '').trim().toUpperCase();
  if (!sym) return null;
  const order = ['RU', 'US', 'CRYPTO'].includes(hint) ? [hint] : ['RU', 'US', 'CRYPTO'];
  for (const m of order) {
    const a = findAsset(m, sym);
    if (a) return cacheKey(a);
  }
  // Инструмент «Графиков»: символом там служит слаг, и «SP500» — это он
  const viz = vizBySymbol(sym);
  return viz ? cacheKey(viz) : null;
};

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
};

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

// Отдача карточек обновления. Разметка свечей — это килобайты повторяющихся
// координат, которые жмутся в десять раз: 470 КБ на вкладку индексов против 50
// после gzip. Caddy здесь ничего не сжимает, а гонять полмегабайта каждые
// полминуты на каждого посетителя нельзя, поэтому gzip делается на месте
// Текст одного поля котировки. Форматирование живёт здесь, а не в браузере:
// правила у всех разные — у индекса до двух знаков, у крипты до восьми, у
// рубля знак ₽, у доллара $, — и вторая их копия на клиенте разошлась бы с
// первой при первой же правке. Скрипт только подставляет готовую строку
function quoteText(live, token, key) {
  const market = String(key).split(':')[0];
  // Абсолютное изменение у индексов приходит готовым, у бумаг — разницей с
  // предыдущим закрытием; общего поля «change» в потоке нет
  const abs = Number.isFinite(Number(live.abs)) ? Number(live.abs) : live.prev ? live.price - live.prev : null;
  if (token === 'i') return key.startsWith('IDX:') ? idxVal(live.price) : null;
  if (token === 'd') return key.startsWith('IDX:') ? `${idxSigned(abs)} (${idxPct(live.pct)})` : null;
  if (token === 'p') return idxPct(live.pct);
  if (token === 'm') return fmtPrice(live.price, market === 'RU' ? 'RUB' : 'USD');
  const [kind, unit] = String(token).split(':');
  if (!unit) return null;
  if (kind === 'v') return fmtValue(live.price, { unit });
  if (kind === 'c') return fmtChange({ pct: live.pct, price: live.price, prev: live.prev }, { unit }).text;
  return null;
}

function sendJsonGzip(req, res, status, body) {
  const raw = Buffer.from(JSON.stringify(body), 'utf8');
  const accepts = String(req.headers['accept-encoding'] || '').includes('gzip');
  if (!accepts) {
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Length': raw.length,
    });
    res.end(raw);
    return;
  }
  const packed = gzipSync(raw);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Encoding': 'gzip',
    Vary: 'Accept-Encoding',
    'Content-Length': packed.length,
  });
  res.end(packed);
}

function sendHtml(res, html, { status = 200, cache = 'public, max-age=300' } = {}) {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': cache,
    // Страница зависит от входа: гость и участник видят разное, промежуточный кеш не должен их путать
    Vary: 'Cookie',
  });
  res.end(html);
}

// Тело POST читаем с потолком: форма маленькая, всё что больше — мусор
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(Object.assign(new Error(t('Слишком большой запрос')), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// Basic-авторизация включается только если в .env задан BASIC_AUTH=user:password
function checkAuth(req, res) {
  if (!BASIC_AUTH) return true;
  const header = req.headers.authorization || '';
  if (header.startsWith('Basic ')) {
    const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
    if (decoded === BASIC_AUTH) return true;
  }
  res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="News Summary", charset="UTF-8"' });
  res.end('Требуется авторизация');
  return false;
}

// Язык живёт в адресе, поэтому префикс снимается до разбора маршрутов: дальше
// весь код работает с путём без префикса и не знает, на каком языке страница.
// Так `/en/ticker/us/AAPL` и `/ticker/us/AAPL` попадают в один и тот же обработчик
const handleRequest = async (req, res, url) => {
  if (!checkAuth(req, res)) return;
  const ip = clientIp(req);
  try {
    if (url.pathname === '/api/search') {
      const q = (url.searchParams.get('q') || '').trim();
      if (!q) return sendJson(res, 200, []);
      const wait = ipBucket(ip, 'search', 60_000, MAX_SEARCH_PER_IP_MIN);
      if (wait) return sendJson(res, 429, { error: t('Слишком много запросов поиска. Подождите минуту.') });
      return sendJson(res, 200, await searchTickers(q));
    }

    if (url.pathname === '/api/summary') {
      const symbol = (url.searchParams.get('symbol') || '').trim();
      if (!symbol) return sendJson(res, 400, { error: t('Параметр symbol обязателен') });
      const asset = await resolveAsset({
        symbol,
        name: (url.searchParams.get('name') || '').trim(),
        type: (url.searchParams.get('type') || '').trim(),
        market: (url.searchParams.get('market') || '').trim(),
      });
      const key = cacheKey(asset);
      const wantRefresh = url.searchParams.get('refresh') === '1';
      const hit = cache[key];
      const needsGeneration = wantRefresh || !isFresh(hit);

      if (needsGeneration) {
        // Кнопку может нажать любой, но не чаще кулдауна на тикер — иначе баланс выжигается
        if (wantRefresh) {
          const left = cooldownLeft(hit);
          if (left > 0) {
            return sendJson(res, 429, {
              error: t('Данные по {symbol} обновляли недавно. Следующее обновление через {min} мин.', {
                symbol: asset.symbol,
                min: Math.ceil(left / 60000),
              }),
              retryAfterSec: Math.ceil(left / 1000),
              ...(hit ? hit : {}),
              ...(hit ? meta(hit, true) : {}),
              cached: true,
            });
          }
        }
        // Лимит на посетителя: общий лимит сервера остаётся как страховка от нескольких IP
        const ipWait = ipBucket(ip, 'gen', 3600_000, MAX_GEN_PER_IP_HOUR);
        if (ipWait) {
          return sendJson(res, 429, {
            error: t('Вы исчерпали лимит обновлений ({limit} в час). Подождите {min} мин или откройте тикер, который уже собран.', {
              limit: MAX_GEN_PER_IP_HOUR,
              min: Math.ceil(ipWait / 60),
            }),
            retryAfterSec: ipWait,
          });
        }
        if (!allowGeneration()) {
          return sendJson(res, 429, {
            error: t('Сервис собирает слишком много сводок прямо сейчас. Попробуйте через несколько минут или откройте тикер, который уже в кеше.'),
            retryAfterSec: 300,
          });
        }
      }

      reviveThin(asset);
      return sendJson(res, 200, await getSummary(asset, { force: wantRefresh }));
    }

    if (url.pathname === '/api/cache') {
      const limit = Math.min(Number(url.searchParams.get('limit')) || 24, 200);
      const all = Object.values(cache);
      const items = all
        .map((c) => ({
          symbol: c.asset.symbol,
          name: niceName(c.asset.name),
          type: c.asset.market,
          typeLabel: t(TYPES[c.asset.market] || c.asset.market),
          generatedAt: c.generatedAt,
          sentiment: c.summary?.sentiment,
          headline: c.i18n?.[getLang()]?.headline || c.summary?.headline,
        }))
        .sort((a, b) => String(b.generatedAt).localeCompare(String(a.generatedAt)))
        .slice(0, limit);
      return sendJson(res, 200, { total: all.length, items });
    }

    if (url.pathname === '/api/universe') {
      const groups = marketGroups();
      const out = {};
      for (const [m, arr] of Object.entries(groups)) {
        out[m] = {
          label: t(MARKET_LABEL[m] || m),
          slug: MARKET_SLUG[m],
          items: arr
            .map((a) => ({
              symbol: a.symbol,
              name: niceName(a.name),
              market: a.market,
              cached: Boolean(cache[`${a.market}:${a.symbol}`]),
              url: tickerPath(a),
            }))
            .sort((x, y) => String(x.name).localeCompare(String(y.name), 'ru')),
        };
      }
      return sendJson(res, 200, { total: universeItems().length, groups: out });
    }

    if (url.pathname === '/api/status') {
      return sendJson(res, 200, {
        ok: true,
        model: MODEL,
        cacheEntries: Object.keys(cache).length,
        // Счётчик с последнего запуска оставлен для совместимости, но полный итог
        // теперь берётся у провайдера — он не обнуляется перезапуском
        spendSinceStart: { tokens: totalTokens, usd: Number(totalCostUsd.toFixed(4)) },
        spend: spendTracker.status(),
        auth: Boolean(BASIC_AUTH),
        ipLimits: { generationsPerHour: MAX_GEN_PER_IP_HOUR, searchesPerMinute: MAX_SEARCH_PER_IP_MIN },
        generationsLastHour: genLog.length,
        cooldownMin: REFRESH_COOLDOWN_MS / 60000,
        crawler: crawler.status(),
        dividends: dividendCrawler.status(),
        indices: indexCrawler.status(),
        charts: chartCrawler.status(),
        realtime: realtime.status(),
      });
    }

    // ------------------------------------------------------------ SEO-служебное
    if (url.pathname === '/robots.txt') {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' });
      return res.end(`User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ${SITE_URL}/sitemap.xml\n`);
    }

    if (url.pathname === '/sitemap.xml') {
      const paths = ['/', '/catalog', '/catalog/ru', '/catalog/us', '/catalog/crypto'];
      // FAQ — только когда вопросы есть: страница «вопросов пока нет» в индексе
      // ничего не даёт, а после первого же вопроса попадёт туда сама
      if (questionStore.all().some((q) => q && q.id && q.question && q.answer)) paths.push('/faq');
      // Сводный форум попадает в карту только когда ветки есть: пустой список
      // поисковику нечего индексировать, а страница «веток пока нет» — плохой вход
      if (FORUM_ENABLED && forumStore.threads().length) paths.push('/forum');
      // Вкладки главной — не копии: у каждой свой заголовок, описание и канонический
      // адрес, поэтому в карту они идут отдельно. «Все» — это сам корень
      for (const t of HOME_TABS) if (t.key !== 'all') paths.push(`/?tab=${t.key}`);
      if (dividendCrawler.status().stored) paths.push('/dividends');
      // Страница графиков и её вкладки: у каждой свой заголовок, описание
      // и самоссылающийся canonical, поэтому это не копии одной страницы.
      // Набор по умолчанию у каждого языка свой, поэтому одна и та же доска
      // («индексы мира») записана в языках разными адресами: /en/charts?cat=indices
      // и /ru/charts?cat=indices&set=world. Такие записи идут семьями — адрес
      // на каждый язык и hreflang между ними, — а не одним общим путём
      const families = [];
      for (const st of SETS) {
        for (const c of catsOf(st.key)) families.push(Object.fromEntries(LANGS.map((l) => [l, chartsPath(c.key, st.key, null, l)])));
      }
      // Страница каждого инструмента: у всех свой заголовок и своё содержимое
      for (const i of INSTRUMENTS) paths.push(instrumentPath(i));
      // Индексы попадают в карту только со значениями: страница из одних прочерков
      // поисковику бесполезна, а после первого прохода крона значения есть всегда
      // Отдельных /index/<слаг> больше нет: страница индекса — это страница
      // инструмента, и её адрес уже добавлен выше, в цикле по INSTRUMENTS
      if (indexCrawler.status().stored) paths.push('/indices');
      for (const a of universeItems()) paths.push(tickerPath(a));
      for (const rec of Object.values(cache)) {
        const p = tickerPath(rec.asset);
        if (!paths.includes(p)) paths.push(p);
      }
      // Страницы вопросов — самый ценный для индексации контент
      for (const q of questionStore.all()) {
        if (q.asset) paths.push(questionPath(q.asset, q));
      }
      // Обсуждения: каждая ветка — свой адрес, ответы — часть темы. Общая тема
      // живёт по /forum/<id>, тема по бумаге — внутри её страницы
      if (FORUM_ENABLED) {
        paths.push('/forum/rules');
        for (const t of forumStore.threads()) paths.push(threadPath(t));
      }
      // Дата у каждого адреса своя: поисковик должен видеть, что обновилась одна бумага,
      // а не весь сайт целиком. Вопросы и темы несут свою дату создания.
      const mod = new Map();
      if (dividendCrawler.status().lastRunAt) mod.set('/dividends', dividendCrawler.status().lastRunAt);
      if (indexCrawler.status().lastQuotesAt) mod.set('/indices', indexCrawler.status().lastQuotesAt);
      for (const rec of Object.values(cache)) {
        const p = tickerPath(rec.asset);
        if (rec.generatedAt) mod.set(p, rec.generatedAt);
      }
      // Дивиденды обновляются чаще сводок: страница меняется и тогда, когда новостей нет
      const divAssets = assetByKey();
      for (const [key, div] of Object.entries(dividendStore.all())) {
        const a = divAssets.get(key);
        const p = a ? tickerPath(a) : null;
        if (p && div.at && (!mod.has(p) || String(div.at) > String(mod.get(p)))) mod.set(p, div.at);
      }
      for (const q of questionStore.all()) {
        if (q.asset && q.askedAt) mod.set(questionPath(q.asset, q), q.askedAt);
      }
      // Значения индексов обновляются чаще всего остального на сайте
      const quotesAt = indexStore.quotesAt();
      // Значение индекса меняется чаще всего остального на его странице,
      // поэтому дата обновления — время котировок, а не сводки
      if (quotesAt) {
        for (const i of INDEXES) {
          const slug = instrumentSlugOfIndex(i);
          if (slug) mod.set(`/charts/${slug}`, quotesAt);
        }
      }
      if (FORUM_ENABLED) {
        for (const t of forumStore.threads()) if (t.createdAt) mod.set(threadPath(t), t.createdAt);
      }
      const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
      // Не всякий путь существует в трёх языках. Страница вопроса и тема форума
      // написаны на одном языке, и три адреса с одинаковым текстом — это три
      // копии, а не три версии: такой путь объявляется один раз, со своим
      // hreflang и без x-default
      const singleLang = new Map();
      for (const q of questionStore.all()) {
        if (q.asset) singleLang.set(questionPath(q.asset, q), q.lang || 'ru');
      }
      if (FORUM_ENABLED) {
        for (const th of forumStore.threads()) singleLang.set(threadPath(th), th.lang || 'ru');
      }
      const entry = (p) => {
        const d = mod.get(p);
        const lastmod = d ? [`    <lastmod>${esc(String(d).slice(0, 10))}</lastmod>`] : [];
        const only = singleLang.get(p);
        if (only) {
          const link = `    <xhtml:link rel="alternate" hreflang="${only}" href="${esc(SITE_URL + langHref(only, p))}"/>`;
          return ['  <url>', `    <loc>${esc(SITE_URL + langHref(only, p))}</loc>`, ...lastmod, link, '  </url>'].join('\n');
        }
        // Каждая страница существует в трёх языках, и в карте нужны все три адреса:
        // поисковик обходит sitemap, а не догадывается о /en/ по hreflang в разметке.
        // Взаимные ссылки hreflang ставятся здесь же — так связка «три копии одного
        // текста» объявлена целиком, а не наполовину
        const links = alternates(SITE_URL, p)
          .map((a) => `    <xhtml:link rel="alternate" hreflang="${a.lang}" href="${esc(a.url)}"/>`)
          .join('\n');
        return LANGS.map((l) =>
          ['  <url>', `    <loc>${esc(SITE_URL + langHref(l, p))}</loc>`, ...lastmod, links, '  </url>'].filter(Boolean).join('\n')
        ).join('\n');
      };
      const familyEntry = (fam) => {
        const links = [
          ...LANGS.map((l) => `    <xhtml:link rel="alternate" hreflang="${l}" href="${esc(SITE_URL + langHref(l, fam[l]))}"/>`),
          `    <xhtml:link rel="alternate" hreflang="x-default" href="${esc(SITE_URL + langHref(DEFAULT_LANG, fam[DEFAULT_LANG]))}"/>`,
        ].join('\n');
        return LANGS.map((l) => ['  <url>', `    <loc>${esc(SITE_URL + langHref(l, fam[l]))}</loc>`, links, '  </url>'].join('\n')).join('\n');
      };
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${[...[...new Set(paths)].map(entry), ...families.map(familyEntry)].join('\n')}
</urlset>`;
      res.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' });
      return res.end(xml);
    }

    // ------------------------------------------------------------ обсуждения
    // Отдельного общего форума нет: темы привязаны к тикеру и живут на его странице.
    // Здесь только служебные маршруты — вход по фразе, аккаунт, правила, модерация.
    if (FORUM_ENABLED && (url.pathname === '/forum' || url.pathname.startsWith('/forum/'))) {
      const seg = url.pathname.split('/')[2] || '';
      const user = currentUser(req);

      // Корень форума — дерево всех веток сайта и форма новой темы. Раньше
      // здесь был список ссылок, а писать можно было только на странице
      // бумаги: чтобы открыть общую тему, приходилось сначала найти тикер.
      // Теперь форум один, и тикер у ветки — необязательный признак
      if (seg === '') {
        const counts = forumCounts();
        const all = forumStore.allMessages();
        // Свежие ветки сверху, ответы внутри своих корней: тот же порядок и
        // тот же рендерер, что на странице тикера
        const roots = forumStore.threads();
        const { html: treeHtml, cut } = threadTree({ threads: roots, messages: all, max: 200, showTicker: true });
        const formHtml = threadForm({ action: '/forum/thread', back: '/forum?new=1', me: user.me, ticker: '', error: '', title: '', body: '' });
        return sendHtml(
          res,
          forumIndexPage({
            siteUrl: SITE_URL,
            siteName: SITE_NAME,
            treeHtml,
            cut,
            totalThreads: counts.threads,
            totalMessages: counts.messages,
            me: user.me,
            account: user.account,
            formHtml,
            error: (url.searchParams.get('err') || '').slice(0, 200),
            openForm: url.searchParams.get('new') === '1' || url.searchParams.get('err'),
          }),
          // Дерево меняется с каждым сообщением, а форма и ник зависят от
          // входа: в общий кеш такую страницу отдавать нельзя
          { cache: user.me ? 'no-store' : 'public, max-age=60' }
        );
      }

      // Приём новой темы из общего форума. Отдельно от /ticker/.../thread:
      // там ключ приходит из адреса, здесь — из необязательного поля
      if (seg === 'thread') {
        if (req.method !== 'POST') return redirect(res, '/forum');
        if (!user.me) return redirect(res, `/forum/login?next=${encodeURIComponent('/forum?new=1')}`);
        const bodyRaw = await readBody(req, 16 * 1024);
        const form = new URLSearchParams(bodyRaw);
        if (form.get('website')) return redirect(res, '/forum');
        const title = String(form.get('title') || '').replace(/\s+/g, ' ').trim();
        const body = String(form.get('body') || '');
        const tickerRaw = String(form.get('ticker') || '').trim();
        const key = tickerRaw ? tickerFromInput(tickerRaw) : '';
        // Тикер вписан, но не найден — это ошибка, а не «сделаем общую тему»:
        // человек думал, что привязывает ветку к бумаге
        const unknown = tickerRaw && !key ? t('Тикер {t} не найден. Проверьте написание или оставьте поле пустым — получится общая тема.', { t: tickerRaw }) : null;
        const bad = validateTitle(title) || validatePost(body) || unknown;
        // Ошибка возвращает ту же страницу с заполненной формой: введённый
        // текст не должен пропадать из-за опечатки в тикере
        const formErr = (msg) => {
          const tree = threadTree({ threads: forumStore.threads(), messages: forumStore.allMessages(), max: 200, showTicker: true });
          const counts = forumCounts();
          return sendHtml(
            res,
            forumIndexPage({
              siteUrl: SITE_URL,
              siteName: SITE_NAME,
              treeHtml: tree.html,
              cut: tree.cut,
              totalThreads: counts.threads,
              totalMessages: counts.messages,
              me: user.me,
              account: user.account,
              formHtml: threadForm({ action: '/forum/thread', back: '/forum?new=1', me: true, title, body, ticker: tickerRaw, error: msg }),
              error: msg,
              openForm: true,
            }),
            { cache: 'no-store' }
          );
        };
        if (bad) return formErr(bad);
        const wait = ipBucket(ip, 'forum', 3600_000, MAX_FORUM_PER_HOUR);
        if (wait) return formErr(t('Слишком часто. Попробуйте через {min} мин.', { min: Math.ceil(wait / 60) }));

        const rec = forumStore.addMessage({
          ticker: key || '',
          parent: null,
          title,
          body,
          lang: getLang(),
          nick: user.account.nick,
          key: user.key,
          address: user.account.address,
          host: await resolveHost(ip),
          createdAt: new Date().toISOString(),
        });
        log(`форум: тема #${rec.id} от ${user.account.nick}${key ? ` (${key})` : ' (общая)'}`);
        return redirect(res, threadPath(rec));
      }

      if (seg === 'rules') return sendHtml(res, rulesPage({ siteUrl: SITE_URL }), { cache: 'public, max-age=3600' });

      if (seg === 'login') {
        const back = safeNext(url.searchParams.get('next'), '/catalog');
        if (req.method === 'GET') {
          return sendHtml(res, loginPage({ siteUrl: SITE_URL, next: back }), { cache: 'no-store' });
        }
        const bodyRaw = await readBody(req, 8 * 1024);
        const form = new URLSearchParams(bodyRaw);
        const next = safeNext(form.get('next'), '/catalog');
        const bad = checkPhrase(form.get('phrase'));
        if (bad) return formError(res, loginPage({ siteUrl: SITE_URL, next, error: bad }));
        const { key } = deriveIdentity(form.get('phrase'));
        const account = forumStore.accountByKey(key);
        if (!account) {
          // Аккаунт мог переехать на другой сервер, но ник по такой фразе не создаём
          return formError(
            res,
            loginPage({
              siteUrl: SITE_URL,
              next,
              error: t('Аккаунта с такой фразой нет. Зарегистрируйтесь — сервер примет эту же фразу, и аккаунт создастся с ней.'),
            })
          );
        }
        setSessionCookie(res, key);
        log(`обсуждения: вход ${account.nick}`);
        return redirect(res, next);
      }

      if (seg === 'register') {
        const back = safeNext(url.searchParams.get('next'), '/catalog');
        if (req.method === 'GET') {
          // Фразу генерируем на сервере и показываем один раз: на клиенте нет crypto-кода
          return sendHtml(res, registerPage({ siteUrl: SITE_URL, generated: generatePhrase(12), next: back }), { cache: 'no-store' });
        }
        const bodyRaw = await readBody(req, 8 * 1024);
        const form = new URLSearchParams(bodyRaw);
        const next = safeNext(form.get('next'), '/catalog');
        const nick = String(form.get('nick') || '').replace(/\s+/g, ' ').trim();
        const phrase = String(form.get('phrase') || '');
        const fail = (error) =>
          formError(res, registerPage({ siteUrl: SITE_URL, error, nick, next, generated: form.get('phrase') || '' }));

        const badPhrase = checkPhrase(phrase);
        if (badPhrase) return fail(badPhrase);
        const badNick = validateNick(nick);
        if (badNick) return fail(badNick);

        const { key, address } = deriveIdentity(phrase);
        const existing = forumStore.accountByKey(key);
        if (existing) {
          setSessionCookie(res, key);
          return redirect(res, next);
        }
        if (forumStore.accountByNick(nick)) {
          return fail(t('Этот ник занят. Выберите другой или войдите своей фразой.'));
        }
        forumStore.addAccount({ key, address, nick, createdAt: new Date().toISOString() });
        setSessionCookie(res, key);
        log(`обсуждения: регистрация ${nick} (${shortAddress(address)})`);
        return redirect(res, '/forum/me?ok=' + encodeURIComponent(t('Аккаунт создан. Фраза — единственный ключ к нему.')));
      }

      if (seg === 'logout') {
        clearSessionCookie(res);
        return redirect(res, '/catalog');
      }

      if (seg === 'me') {
        if (!user.me) return redirect(res, '/forum/login?next=%2Fforum%2Fme');
        return sendHtml(
          res,
          accountPage({ siteUrl: SITE_URL, account: user.account, posts: forumStore.postsBy(user.key) }),
          { cache: 'no-store' }
        );
      }

      if (seg === 'nick') {
        if (req.method !== 'POST') return redirect(res, '/forum/me');
        if (!user.me) return redirect(res, '/forum/login');
        const bodyRaw = await readBody(req, 4 * 1024);
        const nick = String(new URLSearchParams(bodyRaw).get('nick') || '').replace(/\s+/g, ' ').trim();
        const bad = validateNick(nick);
        const mePage = () => accountPage({ siteUrl: SITE_URL, account: user.account, posts: forumStore.postsBy(user.key) });
        if (bad) return formError(res, mePage());
        const taken = forumStore.accountByNick(nick);
        if (taken && taken.key !== user.key) return formError(res, mePage());
        // Ник в старых сообщениях не переписываем — там он остаётся историческим
        user.account.nick = nick;
        forumStore.save();
        return redirect(res, '/forum/me');
      }

      if (seg === 'hide') {
        // Модерация: токен в заголовке или форме, значение — в .env
        const token = req.headers['x-admin-token'] || new URLSearchParams(await readBody(req, 1024)).get('token');
        if (!MODERATOR_TOKEN || token !== MODERATOR_TOKEN) {
          res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
          return res.end('Нет доступа');
        }
        const ok = forumStore.hide(Number(url.searchParams.get('id')));
        return sendJson(res, ok ? 200 : 404, { ok });
      }

      // /forum/<id> — тема без актива, и он же старый адрес темы по тикеру.
      // Ветка с бумагой живёт на странице этой бумаги, и второй полный текст
      // здесь был бы её копией: уводим 301. Общая тема остаётся тут — другого
      // места у неё нет
      const oldId = Number(seg);
      if (Number.isInteger(oldId) && oldId > 0) {
        const thread = forumStore.byId(oldId);
        if (!thread || thread.hidden || thread.parent) {
          return sendHtml(res, forumNotFound({ siteUrl: SITE_URL }), { status: 404, cache: 'no-store' });
        }
        if (thread.ticker) {
          const keep = ['to', 'view']
            .map((k) => (url.searchParams.get(k) ? `${k}=${encodeURIComponent(url.searchParams.get(k))}` : ''))
            .filter(Boolean)
            .join('&');
          // Хвост /reply переезжает вместе с адресом: иначе отправка ответа
          // по старой ссылке превратилась бы в GET страницы темы
          const tail = url.pathname.split('/')[3] === 'reply' ? '/reply' : '';
          // 307 на POST: 301 браузер выполняет как GET, и текст ответа
          // потерялся бы по дороге
          res.writeHead(req.method === 'POST' ? 307 : 301, {
            Location: langHref(getLang(), threadPath(thread) + tail) + (keep ? `?${keep}` : ''),
          });
          return res.end();
        }
        const thLang = thread.lang || 'ru';
        if (thLang !== getLang()) {
          res.writeHead(301, { Location: langHref(thLang, threadPath(thread)) });
          return res.end();
        }

        // Ответ в общую тему — тот же код, что у темы по тикеру: ветка, чужой
        // parent, ханипот и лимит на IP
        if (url.pathname.split('/')[3] === 'reply') {
          if (req.method !== 'POST') return redirect(res, threadPath(thread) + '#reply');
          if (!user.me) return redirect(res, `/forum/login?next=${encodeURIComponent(threadPath(thread))}`);
          const bodyRaw = await readBody(req, 16 * 1024);
          const form = new URLSearchParams(bodyRaw);
          if (form.get('website')) return redirect(res, threadPath(thread));
          const body = String(form.get('body') || '');
          const bad = validatePost(body);
          if (bad) {
            return sendHtml(
              res,
              threadPage({
                siteUrl: SITE_URL,
                asset: null,
                thread,
                replies: forumStore.replies(thread.id),
                me: user.me,
                account: user.account,
                to: Number(form.get('parent')) || 0,
                error: bad,
              }),
              { cache: 'no-store' }
            );
          }
          const wait = ipBucket(ip, 'forum', 3600_000, MAX_FORUM_PER_HOUR);
          if (wait) {
            return redirect(res, threadPath(thread) + '?err=' + encodeURIComponent(t('Слишком часто. Попробуйте через {min} мин.', { min: Math.ceil(wait / 60) })));
          }
          const wantParent = Number(form.get('parent')) || 0;
          const inThread = (m) => {
            let cur = m;
            for (let i = 0; i < 30 && cur; i++) {
              if (cur.id === thread.id) return true;
              cur = cur.parent ? forumStore.byId(cur.parent) : null;
            }
            return false;
          };
          const cand = wantParent ? forumStore.byId(wantParent) : null;
          const parentRec = cand && !cand.hidden && inThread(cand) ? cand : null;
          const created = forumStore.addMessage({
            // ticker пустой — так ответ и остаётся внутри общей ветки
            ticker: '',
            parent: parentRec ? parentRec.id : thread.id,
            body,
            nick: user.account.nick,
            key: user.key,
            address: user.account.address,
            host: await resolveHost(ip),
            createdAt: new Date().toISOString(),
          });
          return redirect(res, `${threadPath(thread)}#m${created.id}`);
        }

        const replies = forumStore.replies(thread.id);
        const viewMsg = Number(url.searchParams.get('view')) || Number(url.searchParams.get('to')) || 0;
        forumStore.addView(replies.some((r) => r.id === viewMsg) ? viewMsg : thread.id);
        return sendHtml(
          res,
          threadPage({
            siteUrl: SITE_URL,
            asset: null,
            thread,
            replies,
            me: user.me,
            account: user.account,
            to: Number(url.searchParams.get('to')) || 0,
            error: (url.searchParams.get('err') || '').slice(0, 200),
          }),
          { cache: 'no-store' }
        );
      }

      return sendHtml(res, forumNotFound({ siteUrl: SITE_URL }), { status: 404, cache: 'no-store' });
    }

    // ------------------------------------------------------------ FAQ
    // Сводная страница вопросов. Своих вопросов она не принимает: форма живёт
    // на странице тикера, потому что вопрос без актива аналитику не о чем.
    // Здесь только список ссылок на готовые ответы — он и нужен поисковику
    if (url.pathname === '/faq' || url.pathname === '/faq/') {
      const rows = questionStore
        .all()
        .filter((q) => q && q.id && q.question && q.answer)
        .sort((a, b) => String(b.askedAt).localeCompare(String(a.askedAt)))
        .map((rec) => ({ rec, asset: assetOfKey(rec.ticker) }));
      return sendHtml(
        res,
        faqPage({ siteUrl: SITE_URL, siteName: SITE_NAME, rows }),
        { cache: 'public, max-age=120' }
      );
    }

    // ------------------------------------------------------------ каталог
    if (url.pathname === '/catalog' || url.pathname.startsWith('/catalog/')) {
      const slug = url.pathname.split('/')[2];
      if (slug && !SLUG_MARKET[slug.toLowerCase()]) {
        return sendHtml(res, notFoundPage({ siteUrl: SITE_URL, siteName: SITE_NAME }), { status: 404, cache: 'no-store' });
      }
      const market = slug ? SLUG_MARKET[slug.toLowerCase()] : null;
      const groups = marketGroups();
      if (market && !(groups[market] || []).length) {
        return sendHtml(res, notFoundPage({ siteUrl: SITE_URL, siteName: SITE_NAME }), { status: 404, cache: 'no-store' });
      }
      return sendHtml(res, catalogPage({ groups, siteUrl: SITE_URL, siteName: SITE_NAME, market }));
    }

    // ------------------------------------------------------------ дивиденды
    // Сводная страница не привязана к дате сбора: крон обновляет данные раз в сутки,
    // а сама страница читается из готового файла.
    if (url.pathname === '/dividends' || url.pathname === '/dividends/') {
      const assets = assetByKey();
      const items = Object.entries(dividendStore.all())
        .map(([key, div]) => ({ asset: assets.get(key), div }))
        .filter((x) => x.asset);
      // Пустая таблица — не страница: пока крон не собрал данные, отдаём 404,
      // чтобы поисковик не запомнил пустой календарь
      if (!items.length) {
        return sendHtml(res, notFoundPage({ siteUrl: SITE_URL, siteName: SITE_NAME }), { status: 404, cache: 'no-store' });
      }
      return sendHtml(res, dividendsPage({ items, siteUrl: SITE_URL, siteName: SITE_NAME }), {
        cache: 'public, max-age=3600',
      });
    }

    // ------------------------------------------------------------ графики
    // Страница с сеткой свечей по рынкам. Ряды справочные и запрашиваются
    // по требованию, поэтому своего файла и крона у неё нет — только кеш в памяти
    if (url.pathname === '/charts' || url.pathname === '/charts/') {
      // Набор, совпавший с набором языка, из адреса убирается: голый /en/charts
      // и есть мировые рынки, и ?set=world рядом с ним — второй адрес той же
      // страницы. Ссылки набора такой адрес и не строят, но его набирают руками
      const setRaw = String(url.searchParams.get('set') || '');
      if (isSet(setRaw) && setRaw === defaultSet(getLang())) {
        url.searchParams.delete('set');
        const qs2 = url.searchParams.toString();
        res.writeHead(301, { Location: langHref(getLang(), '/charts') + (qs2 ? `?${qs2}` : '') });
        return res.end();
      }
      const catRaw = String(url.searchParams.get('cat') || 'all');
      // Набор решает и форму категории: категории, которой в нём нет, здесь
      // соответствует «Все», а не пустая сетка
      const { set, cat } = pickSet(url, isCat(catRaw) ? catRaw : 'all');
      // Неизвестный интервал откатывается на запомненный, а тот — на умолчание:
      // страница не должна отдавать 404 из-за параметра, набранного руками
      const tf = pickTf(req, url, CTF_ORDER, DEFAULT_CTF);
      const hidden = hiddenOf(req);
      const { rows, quotes } = await marketFeed.board(cat, tf, { set, hidden });
      // Котировки индексов заменяются живыми: иначе карточка считает
      // процент по полю Мосбиржи «к предыдущей сделке»
      for (const r of rows) quotes[r.inst.key] = liveForInstrument(r.inst, quotes[r.inst.key]);
      const out = chartsPage({ cat, tf, set, rows, quotes, hidden, siteName: SITE_NAME });
      return sendHtml(
        res,
        page({
          siteUrl: SITE_URL,
          title: out.title,
          description: out.description,
          canonical: out.canonical,
          altPath: out.altPath,
          body: out.body,
          active: 'charts',
        }),
        // Дневные и крупнее меняются раз в сутки, минутные — постоянно:
        // кешировать их одинаково значило бы показывать пятиминутную давность.
        // Признак — сам интервал, а не «тот, что открывается по умолчанию».
        // Доска с убранными карточками у каждого своя, в общий кеш её нельзя
        { cache: CTF[tf]?.daily ? (tfFromCookie(req, url) || hidden.size ? 'private, max-age=120' : 'public, max-age=120') : 'no-store' }
      );
    }

    // Настройка доски и крестик на карточке. Оба адреса стоят до подстраниц
    // инструментов: иначе «settings» разобрался бы как слаг инструмента и
    // вернул бы 404, а «hide» не нашёл бы маршрута вовсе
    if (url.pathname === '/charts/hide' || url.pathname === '/charts/settings') {
      // Возврат только на доску: адрес приходит из формы, и уводить человека
      // на произвольную страницу сайта она права не даёт
      // Шаблон, а не startsWith: «/charts/../forum» начинается правильно, но
      // браузер раскроет точки и уведёт с доски
      const safeBoard = (raw) => {
        const p = String(raw || '');
        return /^\/charts(\/[a-z0-9-]+)?(\?[\w=&%.-]*)?$/i.test(p) ? p : '/charts';
      };
      const back = safeBoard(url.searchParams.get('back'));
      const hidden = hiddenOf(req);

      if (url.pathname === '/charts/hide') {
        // Скрытие меняет состояние, поэтому только формой: ссылку открыл бы
        // предзагрузчик страниц и убрал бы карточку мимо воли человека
        if (req.method !== 'POST') return redirect(res, back);
        const bodyRaw = await readBody(req, 4 * 1024);
        const form = new URLSearchParams(bodyRaw);
        const inst = instrumentBySlug(String(form.get('slug') || ''));
        if (!inst) return redirect(res, back);
        if (form.get('do') === 'show') hidden.delete(inst.slug);
        else hidden.add(inst.slug);
        writeHiddenCookie(res, hidden);
        // Скрипт перерисует доску сам: переход на целую страницу ему не нужен
        if (req.headers['x-requested-with'] === 'fetch') {
          res.writeHead(204, { 'Cache-Control': 'no-store' });
          return res.end();
        }
        return redirect(res, safeBoard(form.get('back')));
      }

      if (req.method === 'POST') {
        const bodyRaw = await readBody(req, 16 * 1024);
        const form = new URLSearchParams(bodyRaw);
        // «Показать все» — та же форма: кнопка присылает do=reset, и это
        // единственный способ вернуть всё разом, не снимая галочки по одной.
        // Галочка значит «показывать», а хранится обратное — скрытое, поэтому
        // список переворачивается: иначе отмеченные инструменты исчезли бы,
        // а неотмеченные остались
        const shown = new Set(
          form.getAll('show').map((v) => instrumentBySlug(v)?.slug).filter(Boolean)
        );
        const next = form.get('do') === 'reset'
          ? new Set()
          : new Set(INSTRUMENTS.filter((i) => !shown.has(i.slug)).map((i) => i.slug));
        writeHiddenCookie(res, next);
        return redirect(res, safeBoard(form.get('back')));
      }

      const out = settingsPage({ hidden, back, siteName: SITE_NAME });
      return sendHtml(
        res,
        page({
          siteUrl: SITE_URL,
          title: out.title,
          description: out.description,
          canonical: out.canonical,
          body: out.body,
          // Страница личная и у каждого своя: в индекс её пускать незачем,
          // доска и её инструменты индексируются обычными адресами
          noindex: true,
          active: 'charts',
        }),
        { cache: 'no-store' }
      );
    }

    // Подстраницы инструмента — тема, ответ, вопрос — обслуживаются теми же
    // обработчиками, что и у тикера каталога. Вместо второй копии тех же ста
    // строк адрес переписывается во внутренний вид /ticker/viz/<символ>/…:
    // рынок VIZ и слаг в роли символа уже понимают findAsset, tickerPath и
    // threadPath, поэтому обратно человек попадает на /charts/<слаг>, а не в
    // /ticker/. Наружу этот вид не выходит — он живёт только внутри запроса
    if (url.pathname.startsWith('/charts/')) {
      const seg = url.pathname.split('/'); // ['', 'charts', слаг, хвост, …]
      const vizInst = seg[2] ? instrumentBySlug(decodeURIComponent(seg[2])) : null;
      const tail = seg[3] || '';
      if (vizInst && (tail === 'thread' || tail === 'forum' || tail === 'ask')) {
        url.pathname = `/ticker/viz/${encodeURIComponent(vizInst.slug.toUpperCase())}/` + seg.slice(3).join('/');
      }
    }

    // Подстраницы инструментов обязаны стоять до общего правила /charts:
    // страница сетки смотрит только на точный путь и лишние сегменты не увидит,
    // но порядок держим явным, как у форума на странице тикера
    if (url.pathname.startsWith('/charts/')) {
      const inst = instrumentBySlug(decodeURIComponent(url.pathname.split('/')[2] || ''));
      // Набор по умолчанию на странице инструмента — тоже лишний параметр:
      // canonical у неё один и без набора, и второй адрес был бы копией
      const setRaw = String(url.searchParams.get('set') || '');
      if (inst && isSet(setRaw) && setRaw === defaultSet(getLang())) {
        url.searchParams.delete('set');
        const qs2 = url.searchParams.toString();
        res.writeHead(301, { Location: langHref(getLang(), url.pathname) + (qs2 ? `?${qs2}` : '') });
        return res.end();
      }
      if (!inst) {
        return sendHtml(res, notFoundPage({ siteUrl: SITE_URL, siteName: SITE_NAME }), { status: 404, cache: 'no-store' });
      }
      const tf = pickTf(req, url, CTF_ORDER, DEFAULT_CTF);
      // Набор нужен только меню: список соседей внизу и подсветка категории.
      // Сама страница инструмента одна и та же во всех наборах
      const { set } = pickSet(url, 'all');
      const hidden = hiddenOf(req);
      const { series, quote } = await marketFeed.one(inst, tf);
      const liveQuote = liveForInstrument(inst, quote);
      // Инструмент получает ту же начинку, что и тикер каталога: сводку с
      // кнопкой обновления, вопросы аналитику и обсуждение. Ключ у них свой
      // (VIZ:USD-RUB), поэтому хранилища общие и заводить второе незачем
      const viz = vizAsset(inst);
      const vizKey = cacheKey(viz);
      const rec = cache[vizKey] ? { ...cache[vizKey], ...meta(cache[vizKey], true) } : null;
      const user = currentUser(req);
      // Восемь индексов несут на этой странице ещё значение, состав и историю:
      // отдельный /index/<слаг> был вторым адресом того же индекса со своим
      // canonical, и поисковик выбирал между копиями сам
      // Связь односторонняя: indexSlug лежит у инструмента, а у индекса —
      // свой слаг, и он не совпадает (rgbia ↔ rgbi, dowjones ↔ dow-jones)
      const idx = inst.indexSlug ? INDEXES.find((i) => i.slug === inst.indexSlug) || null : null;
      const idxQuote = idx ? realtime.overlay(idx.code, indexStore.quote(idx.code)) : null;
      const out = instrumentPage({
        inst,
        series,
        quote: liveQuote,
        tf,
        set,
        hidden,
        siteUrl: SITE_URL,
        siteName: SITE_NAME,
        rec,
        summaryHtml: rec ? summaryCard(rec) : noSummaryCard(viz),
        qaHtml: qaBlock({ asset: viz, questions: questionStore.byTicker(vizKey), formAction: langHref(getLang(), `${tickerPath(viz)}/ask`) }),
        forumHtml: forumHtmlFor(viz, user, {
          notice: (url.searchParams.get('ok') || '').slice(0, 140),
          error: (url.searchParams.get('err') || '').slice(0, 300),
        }),
        indexHtml: idx
          ? indexSections({
              idx,
              quote: idxQuote,
              history: indexStore.history(idx.code),
              composition: indexStore.composition(idx.code),
              knownSymbols: knownSymbols(),
            })
          : '',
        seo: idx ? indexSeo({ idx, quote: idxQuote }) : null,
      });
      return sendHtml(
        res,
        page({
          siteUrl: SITE_URL,
          title: out.title,
          description: out.description,
          canonical: out.canonical,
          altPath: out.altPath,
          body: out.body,
          jsonLd: out.jsonLd,
          // Та же ширина, что у сетки: меню стоит на одном месте на обеих
          // страницах, а не сдвигается вместе с границей колонки
        }),
        // Та же логика, что у сетки: минутный ряд живёт секунды, дневной — сутки,
        // а запомненный в куке интервал и скрытые карточки — своё у каждого
        { cache: CTF[tf]?.daily ? (tfFromCookie(req, url) || hidden.size ? 'private, max-age=120' : 'public, max-age=120') : 'no-store' }
      );
    }

    // Переключение интервала без перезагрузки: те же куски разметки, что и на
    // странице, но отдельным ответом. Страница без скрипта работает как раньше —
    // это дополнение к ссылкам, а не замена им
    if (url.pathname === '/api/board') {
      const catRaw = String(url.searchParams.get('cat') || 'all');
      const { set, cat } = pickSet(url, isCat(catRaw) ? catRaw : 'all');
      const tf = pickTf(req, url, CTF_ORDER, DEFAULT_CTF);
      const hidden = hiddenOf(req);
      const { rows, quotes } = await marketFeed.board(cat, tf, { set, hidden });
      // Котировки индексов заменяются живыми: иначе карточка считает
      // процент по полю Мосбиржи «к предыдущей сделке»
      for (const r of rows) quotes[r.inst.key] = liveForInstrument(r.inst, quotes[r.inst.key]);
      const out = chartsMeta({ cat, tf, set });
      return sendJsonGzip(req, res, 200, {
        at: new Date().toISOString(),
        cat,
        set,
        tf,
        // Заголовок вкладки и описание называют категорию и интервал: без них
        // в браузере осталось бы название вкладки, которую уже не видно
        title: out.title,
        description: out.description,
        html: chartsBoard({ cat, tf, set, rows, quotes, hidden }),
      });
    }

    // Фрагмент графика: страница инструмента и страница тикера. Ряд меняется
    // на месте — перезагружать страницу ради одной картинки незачем
    if (url.pathname === '/api/chart') {
      const slug = String(url.searchParams.get('slug') || '');
      if (slug) {
        const inst = instrumentBySlug(slug);
        if (!inst) return sendJsonGzip(req, res, 404, { error: t('Инструмент не найден') });
        const tf = pickTf(req, url, CTF_ORDER, DEFAULT_CTF);
        const { set } = pickSet(url, 'all');
        const hidden = hiddenOf(req);
        const { series, quote } = await marketFeed.one(inst, tf);
        return sendJsonGzip(req, res, 200, {
          tf,
          set,
          title: t('{name}: {tf} график и цена', { name: t(inst.name), tf: t(CTF[tf].one) }),
          // Меню, h1 и график приходят одним куском: полоса интервалов стоит
          // над заголовком, и без неё в ответе отмеченный интервал остался бы
          // прежним, пока под ним уже нарисован новый ряд
          html: instBoard({ inst, series, quote: liveForInstrument(inst, quote), tf, set, hidden }),
        });
      }
      const market = SLUG_MARKET[String(url.searchParams.get('market') || '').toLowerCase()];
      const symbol = String(url.searchParams.get('symbol') || '');
      const asset = market && symbol ? findAsset(market, symbol) : null;
      if (!asset) return sendJsonGzip(req, res, 404, { error: t('Тикер не найден') });
      const tfTicker = pickTf(req, url, tfList(asset.market), DEFAULT_TF);
      const html = await chartHtmlFor(asset, { tf: tfTicker });
      // chartHtmlFor отдаёт блок целиком, вместе с обёрткой: у тикера проще
      // заменить секцию целиком, чем разбирать её на части
      return sendJsonGzip(req, res, 200, { tf: tfTicker, html });
    }

    // Живые котировки для уже открытой страницы. Отдаём готовые строки, а не
    // числа: форматирование у каждого рынка своё, и на клиенте оно разошлось
    // бы с серверным при первой же правке. Скрипт только подставляет текст
    if (url.pathname === '/api/quotes') {
      const want = [
        ...new Set(
          String(url.searchParams.get('keys') || '')
            .split(',')
            .map((x) => x.trim())
            .filter(Boolean)
        ),
      ].slice(0, 400);
      // Поля, которые просит страница: «i» — значение индекса, «d» — его
      // изменение, «p» — процент, «m» — цена бумаги в её валюте, «v:usd» и
      // «c:usd» — цена и изменение в единицах инструмента. Список, а не
      // набор, потому что одна и та же величина печатается по-разному: на
      // странице индекса «2 442,1», в карточке «2 442,10 п.»
      const tokens = [
        ...new Set(
          String(url.searchParams.get('f') || '')
            .split(',')
            .map((x) => x.trim())
            .filter(Boolean)
        ),
      ].slice(0, 8);
      const quotes = {};
      for (const k of want) {
        const live = realtime.get(k);
        if (!live) continue;
        const out = { at: live.at };
        // Направление считает сервер: класс на элементе — тоже часть
        // оформления, и страница не должна выводить его из строки
        const v = Number(live.pct);
        out.dir = Number.isFinite(v) ? (v > 0 ? 'up' : v < 0 ? 'down' : 'flat') : 'flat';
        for (const tok of tokens) {
          const text = quoteText(live, tok, k);
          if (text !== null) out[tok] = text;
        }
        quotes[k] = out;
      }
      return sendJsonGzip(req, res, 200, { at: realtime.at(), poll: realtime.intervalMs(), quotes });
    }

    if (url.pathname === '/api/charts') {
      const catRaw = String(url.searchParams.get('cat') || '');
      const { set, cat } = pickSet(url, isCat(catRaw) ? catRaw : 'all');
      const tf = pickTf(req, url, CTF_ORDER, DEFAULT_CTF);
      const { rows, quotes } = await marketFeed.board(cat, tf, { set, hidden: hiddenOf(req) });
      // Котировки индексов заменяются живыми: иначе карточка считает
      // процент по полю Мосбиржи «к предыдущей сделке»
      for (const r of rows) quotes[r.inst.key] = liveForInstrument(r.inst, quotes[r.inst.key]);
      const cards = rows.map((r) => ({
        key: r.inst.key,
        html: cardInnerHtml({ inst: r.inst, series: r.series, quote: quotes[r.inst.key], tf, set }),
      }));
      return sendJsonGzip(req, res, 200, { at: new Date().toISOString(), poll: pollFor(tf), cards });
    }

    // ------------------------------------------------------------ индексы
    // Значения читаются из своего файла: страница не ходит в сеть и открывается
    // мгновенно даже при холодном старте сервиса.
    if (url.pathname === '/indices' || url.pathname === '/indices/') {
      // Пока крон не собрал значения, страница состояла бы из прочерков:
      // отдаём 404, как у дивидендов, чтобы пустое не попало в индекс
      if (!indexCrawler.status().stored) {
        return sendHtml(res, notFoundPage({ siteUrl: SITE_URL, siteName: SITE_NAME }), { status: 404, cache: 'no-store' });
      }
      return sendHtml(res, indicesPage({ quotes: realtime.overlayAll(indexStore.all()), history: indexStore.allHistory(), siteUrl: SITE_URL, siteName: SITE_NAME }), {
        cache: 'public, max-age=120',
      });
    }

    if (url.pathname.startsWith('/index/')) {
      const idx = bySlug(decodeURIComponent(url.pathname.split('/')[2] || ''));
      const slug = idx ? instrumentSlugOfIndex(idx) : null;
      if (!slug) return sendHtml(res, notFoundPage({ siteUrl: SITE_URL, siteName: SITE_NAME }), { status: 404, cache: 'no-store' });
      const qsIdx = url.searchParams.toString();
      res.writeHead(301, { Location: langHref(getLang(), `/charts/${slug}`) + (qsIdx ? `?${qsIdx}` : '') });
      return res.end();
    }

    // ------------------------------------------------------------ вопрос по тикеру
    // POST /ticker/us/AAPL/ask: ответ собирается один раз и сохраняется как публичная страница
    if (url.pathname.startsWith('/ticker/') && url.pathname.endsWith('/ask')) {
      const [, , slugRaw, symRaw] = url.pathname.split('/');
      const market = SLUG_MARKET[String(slugRaw || '').toLowerCase()];
      const asset = market && symRaw ? findAsset(market, decodeURIComponent(symRaw)) : null;
      // GET сюда не приходит: адрес переписан из /charts/<слаг>/ask, и обратно
      // человека надо вести на страницу инструмента, а не на внутренний вид
      if (req.method !== 'POST') {
        res.writeHead(303, { Location: langHref(getLang(), asset ? tickerPath(asset) : '/catalog') });
        return res.end();
      }
      if (!asset) return sendHtml(res, notFoundPage({ siteUrl: SITE_URL, siteName: SITE_NAME }), { status: 404, cache: 'no-store' });

      const bodyRaw = await readBody(req, 8 * 1024);
      const form = new URLSearchParams(bodyRaw);
      const question = (form.get('question') || '').trim();
      const back = `${tickerPath(asset)}?err=`;

      const invalid = validateQuestion(question);
      if (invalid) {
        res.writeHead(303, { Location: langHref(getLang(), back) + encodeURIComponent(invalid) });
        return res.end();
      }

      const key = cacheKey(asset);
      const rec = cache[key];
      if (!rec) {
        res.writeHead(303, {
          Location:
            `${langHref(getLang(), tickerPath(asset))}?err=` +
            encodeURIComponent(
              asset.market === 'VIZ'
                ? t('Сначала соберите сводку по этому инструменту — вопрос отвечается по её публикациям.')
                : t('Сначала соберите сводку по тикеру — вопрос отвечается по её публикациям.')
            ),
        });
        return res.end();
      }

      // Тот же вопрос второй раз не оплачиваем: отдаём готовый ответ
      const existing = questionStore.findByHash(key, question);
      if (existing) {
        res.writeHead(303, { Location: langHref(getLang(), questionPath(asset, existing)) });
        return res.end();
      }

      const ipWait = ipBucket(ip, 'gen', 3600_000, MAX_GEN_PER_IP_HOUR);
      if (ipWait) {
        res.writeHead(303, {
          Location:
            `${langHref(getLang(), tickerPath(asset))}?err=` +
            encodeURIComponent(t('Лимит вопросов исчерпан. Попробуйте через {min} мин.', { min: Math.ceil(ipWait / 60) })),
        });
        return res.end();
      }
      if (!allowGeneration()) {
        res.writeHead(303, {
          Location:
            `${langHref(getLang(), tickerPath(asset))}?err=` +
            encodeURIComponent(t('Сервис перегружен, попробуйте через несколько минут.')),
        });
        return res.end();
      }

      try {
        const reject = (kind) => {
          log(`вопрос ${key} отклонён (${kind}): ${question.slice(0, 80)}`);
          res.writeHead(303, {
            Location:
              `${langHref(getLang(), tickerPath(asset))}?err=` +
              encodeURIComponent(t(VERDICT_MESSAGE[kind] || VERDICT_MESSAGE.off_topic)),
          });
          return res.end();
        };

        const ans = await answerQuestion(asset, rec, question);
        if (ans.meta?.costUsd) totalCostUsd += ans.meta.costUsd;
        if (ans.meta?.tokens) totalTokens += ans.meta.tokens;
        // Одна модель ответила, придумала заголовок и решила, публиковать ли вопрос
        if (ans.verdict !== 'ok') return reject(ans.verdict);
        const hash = questionHash(key, question);
        const stored = questionStore.add({
          id: `${hash}-${slugify(ans.title || question, 48) || 'vopros'}`,
          ticker: key,
          // У инструмента «Графиков» в записи нужен слаг: символ вопроса —
          // слаг, и восстановить по нему страницу иначе не из чего
          asset: { symbol: asset.symbol, name: niceName(asset.name), market: asset.market, ...(asset.slug ? { slug: asset.slug } : {}) },
          question,
          // Язык, на котором задан вопрос: на нём же написан ответ, и другого
          // перевода у страницы нет. По нему строится canonical и hreflang
          lang: getLang(),
          // Заголовок делает модель: в <title>, H1 и JSON-LD не должны попасть опечатки и сленг вопроса
          title: ans.title,
          askedAt: new Date().toISOString(),
          windowHours: rec.windowHours || NEWS_WINDOW_H,
          news: rec.news,
          answer: ans.answer,
          bullets: ans.bullets,
          confidence: ans.confidence,
          refs: ans.refs,
          sources: ans.sources,
          mode: ans.mode,
          model: ans.model,
          tokens: ans.meta?.tokens,
          costUsd: ans.meta?.costUsd,
        });
        log(`вопрос ${key} [${ans.mode}]: ${question.slice(0, 80)}`);
        res.writeHead(303, { Location: langHref(getLang(), questionPath(asset, stored)) });
        return res.end();
      } catch (e) {
        log(`вопрос ${key} не удался: ${e.message}`);
        res.writeHead(303, { Location: `${langHref(getLang(), tickerPath(asset))}?err=` + encodeURIComponent(e.message) });
        return res.end();
      }
    }

    // ------------------------------------------------------------ обсуждение по тикеру
    // Тема принадлежит активу, поэтому её адрес лежит внутри /ticker/: вкладка не уводит
    // на отдельный форум, а остаётся на той же бумаге.
    if (FORUM_ENABLED && url.pathname.startsWith('/ticker/')) {
      const parts = url.pathname.split('/'); // ['', 'ticker', market, symbol, 'thread'|'forum', id?, ...]
      const market = SLUG_MARKET[String(parts[2] || '').toLowerCase()];
      const asset = market && parts[3] ? findAsset(market, decodeURIComponent(parts[3])) : null;
      const tail = parts[4] || '';

      if (asset && (tail === 'thread' || tail === 'forum')) {
        const user = currentUser(req);
        const notice = (url.searchParams.get('ok') || '').slice(0, 140);
        const errRaw = (url.searchParams.get('err') || '').slice(0, 200);

        // POST /ticker/<market>/<symbol>/thread — новая тема
        if (tail === 'thread') {
          if (req.method !== 'POST') return redirect(res, tickerPath(asset) + '#forum');
          if (!user.me) {
            return redirect(res, `/forum/login?next=${encodeURIComponent(tickerPath(asset) + '#forum')}`);
          }
          const bodyRaw = await readBody(req, 16 * 1024);
          const form = new URLSearchParams(bodyRaw);
          // Ханипот: поле скрыто стилями, человек его не заполнит
          if (form.get('website')) return redirect(res, tickerPath(asset) + '#forum');
          const title = String(form.get('title') || '').replace(/\s+/g, ' ').trim();
          const body = String(form.get('body') || '');
          const bad = validateTitle(title) || validatePost(body);
          const key = cacheKey(asset);
          const fail = async (msg) =>
            sendHtml(
              res,
              tickerPage({
                asset,
                rec: cache[key] ? { ...cache[key], ...meta(cache[key], true) } : null,
                div: dividendFor(asset),
                siteUrl: SITE_URL,
                siteName: SITE_NAME,
                related: relatedAssets(asset),
                questions: questionStore.byTicker(key),
                forumHtml: forumHtmlFor(asset, user, { error: msg, title, body }),
                chartHtml: await chartHtmlFor(asset),
              }),
              { status: 200, cache: 'no-store' }
            );
          if (bad) return fail(bad);
          const wait = ipBucket(ip, 'forum', 3600_000, MAX_FORUM_PER_HOUR);
          if (wait) return fail(t('Слишком часто. Попробуйте через {min} мин.', { min: Math.ceil(wait / 60) }));

          const rec = forumStore.addMessage({
            ticker: key,
            parent: null,
            title,
            body,
            // Язык, на котором написана тема: переводов у неё нет, и в sitemap
            // адрес не должен обещать три версии одного текста
            lang: getLang(),
            nick: user.account.nick,
            key: user.key,
            address: user.account.address,
            host: await resolveHost(ip),
            createdAt: new Date().toISOString(),
          });
          log(`обсуждение ${key}: тема #${rec.id} от ${user.account.nick}`);
          return redirect(res, threadPath(rec));
        }

        // /ticker/<market>/<symbol>/forum/<id> — тема и ответы в ней
        const id = Number(parts[5]) || 0;
        const thread = id ? forumStore.byId(id) : null;
        // Чужой id в адресе не должен открывать тему другого тикера
        if (!thread || thread.hidden || thread.ticker !== cacheKey(asset)) {
          return sendHtml(res, forumNotFound({ siteUrl: SITE_URL }), { status: 404, cache: 'no-store' });
        }

        // Тема написана на языке автора и перевода не имеет: /en/ того же
        // адреса — копия с самоссылающимся canonical. Ведём на настоящий адрес,
        // тот, что объявлен в hreflang. Ответ на сообщение и просмотр не
        // теряются: и ?to=, и ?view= переезжают вместе с адресом
        const thLang = thread.lang || 'ru';
        if (thLang !== getLang()) {
          const keep = ['to', 'view']
            .map((k) => (url.searchParams.get(k) ? `${k}=${encodeURIComponent(url.searchParams.get(k))}` : ''))
            .filter(Boolean)
            .join('&');
          res.writeHead(301, { Location: langHref(thLang, threadPath(thread)) + (keep ? `?${keep}` : '') });
          return res.end();
        }

        if (parts[6] === 'reply') {
          if (req.method !== 'POST') return redirect(res, threadPath(thread) + '#reply');
          if (!user.me) return redirect(res, `/forum/login?next=${encodeURIComponent(threadPath(thread))}`);
          const bodyRaw = await readBody(req, 16 * 1024);
          const form = new URLSearchParams(bodyRaw);
          if (form.get('website')) return redirect(res, threadPath(thread));
          const body = String(form.get('body') || '');
          const bad = validatePost(body);
          if (bad) {
            return sendHtml(
              res,
              // Адресата передаём обратно: иначе форма после ошибки
              // прикрепит ответ к теме, а не к тому сообщению, где её открыли
              threadPage({
                siteUrl: SITE_URL,
                asset,
                thread,
                replies: forumStore.replies(thread.id),
                me: user.me,
                account: user.account,
                to: Number(form.get('parent')) || 0,
                error: bad,
              }),
              { cache: 'no-store' }
            );
          }
          const wait = ipBucket(ip, 'forum', 3600_000, MAX_FORUM_PER_HOUR);
          if (wait) {
            const msg = t('Слишком часто. Попробуйте через {min} мин.', { min: Math.ceil(wait / 60) });
            return redirect(res, threadPath(thread) + '?err=' + encodeURIComponent(msg));
          }

          // Отвечаем только внутрь этой ветки: чужой parent из формы игнорируем
          const wantParent = Number(form.get('parent')) || 0;
          const inThread = (m) => {
            let cur = m;
            for (let i = 0; i < 30 && cur; i++) {
              if (cur.id === thread.id) return true;
              cur = cur.parent ? forumStore.byId(cur.parent) : null;
            }
            return false;
          };
          const cand = wantParent ? forumStore.byId(wantParent) : null;
          const parentRec = cand && !cand.hidden && inThread(cand) ? cand : null;
          // Глубину не храним: родитель и так записан, а поле depth расходилось
          // с реальной цепочкой (у ответов оставался 0) и рисовало ветку плоско
          const created = forumStore.addMessage({
            ticker: thread.ticker,
            parent: parentRec ? parentRec.id : thread.id,
            body,
            nick: user.account.nick,
            key: user.key,
            address: user.account.address,
            host: await resolveHost(ip),
            createdAt: new Date().toISOString(),
          });
          return redirect(res, `${threadPath(thread)}#m${created.id}`);
        }

        // Просмотр засчитываем тому сообщению, на которое пришли: в дереве
        // ссылка несёт ?view=<id>. Отдельно от ?to=<id>, который открывает форму
        // ответа: пришли читать — не то же самое, что пришли отвечать.
        // Считать показ всей ветки всем её строкам бессмысленно — было бы одно число
        const replies = forumStore.replies(thread.id);
        const viewMsg = Number(url.searchParams.get('view')) || Number(url.searchParams.get('to')) || 0;
        forumStore.addView(replies.some((r) => r.id === viewMsg) ? viewMsg : thread.id);
        return sendHtml(
          res,
          threadPage({
            siteUrl: SITE_URL,
            asset,
            thread,
            replies,
            me: user.me,
            account: user.account,
            to: Number(url.searchParams.get('to')) || 0,
            error: errRaw,
          }),
          { cache: 'no-store' }
        );
      }
    }

    // ------------------------------------------------------------ страница вопроса
    if (url.pathname.startsWith('/q/')) {
      const [, , slugRaw, symRaw, idRaw] = url.pathname.split('/');
      const market = SLUG_MARKET[String(slugRaw || '').toLowerCase()];
      const id = decodeURIComponent(idRaw || '');
      const found = id ? questionStore.byId(id) : null;
      // Ссылка могла остаться от старой формулировки: hash в начале id не меняется
      const rec = found || (id ? questionStore.byHash(id.split('-')[0]) : null);
      const asset = rec?.asset && rec.asset.market === market ? rec.asset : null;
      if (!rec || !asset) {
        return sendHtml(res, notFoundPage({ siteUrl: SITE_URL, siteName: SITE_NAME }), { status: 404, cache: 'no-store' });
      }
      // Ответ написан на одном языке и перевода не имеет. /en/ того же вопроса был
      // бы копией с самоссылающимся canonical и обещанием английского текста,
      // которого нет. Ведём на настоящий адрес — тот, что объявлен в hreflang
      const qLang = rec.lang || 'ru';
      if (qLang !== getLang()) {
        res.writeHead(301, { Location: langHref(qLang, questionPath(asset, rec)) });
        return res.end();
      }
      const html = questionPage({
        asset,
        rec,
        siteUrl: SITE_URL,
        siteName: SITE_NAME,
        related: relatedAssets(asset),
        others: questionStore.byTicker(rec.ticker).filter((q) => q.id !== rec.id).slice(0, 8),
      });
      return sendHtml(res, html, { cache: 'public, max-age=3600' });
    }

    // ------------------------------------------------------------ страница тикера
    if (url.pathname.startsWith('/ticker/')) {
      const [, , slugRaw, symRaw] = url.pathname.split('/');
      const market = SLUG_MARKET[String(slugRaw || '').toLowerCase()];
      // У инструмента «Графиков» страница одна — со свечами. Второго адреса
      // /ticker/viz/… в индексе быть не должно, поэтому ведём на неё
      if (market === 'VIZ') {
        const inst = symRaw ? vizBySymbol(decodeURIComponent(symRaw)) : null;
        if (!inst) {
          return sendHtml(res, notFoundPage({ siteUrl: SITE_URL, siteName: SITE_NAME }), { status: 404, cache: 'no-store' });
        }
        const qs3 = url.searchParams.toString();
        res.writeHead(301, { Location: langHref(getLang(), tickerPath(inst)) + (qs3 ? `?${qs3}` : '') });
        return res.end();
      }
      const asset = market && symRaw ? findAsset(market, decodeURIComponent(symRaw)) : null;
      if (!asset) {
        return sendHtml(res, notFoundPage({ siteUrl: SITE_URL, siteName: SITE_NAME }), { status: 404, cache: 'no-store' });
      }
      const key = cacheKey(asset);
      const rec = cache[key];
      const user = currentUser(req);
      // Интервал тот же, что запомнен на «Графиках»: выбрав «День» там,
      // человек ждёт день и на странице бумаги
      const tfParam = pickTf(req, url, tfList(asset.market), DEFAULT_TF);
      const chartHtml = await chartHtmlFor(asset, { tf: tfParam });
      const html = tickerPage({
        asset,
        rec: rec ? { ...rec, ...meta(rec, true) } : null,
        div: dividendFor(asset),
        siteUrl: SITE_URL,
        siteName: SITE_NAME,
        related: relatedAssets(asset),
        questions: questionStore.byTicker(key),
        error: (url.searchParams.get('err') || '').slice(0, 300),
        // Обсуждение живёт на странице тикера: список тем и форма новой ветки
        forumHtml: forumHtmlFor(asset, user, {
          notice: (url.searchParams.get('ok') || '').slice(0, 140),
          error: (url.searchParams.get('err') || '').slice(0, 300),
        }),
        chartHtml,
      });
      // Страницы со свежей сводкой кешируем ненадолго, без сводки — не кешируем вовсе,
      // иначе поисковик запомнит «нет данных» и не переиндексирует.
      // Страницу вошедшего не кешируем: в ней ник и формы, чужая копия из кеша их не должна показать.
      // Внутридневной график устаревает за минуты, поэтому такой странице срок короче
      // дневного: иначе человек полчаса видел бы минутные свечи пятиминутной давности
      const intraday = TIMEFRAMES[tfParam] && !TIMEFRAMES[tfParam].daily;
      return sendHtml(res, html, {
        // Интервал из куки у каждого свой — такой ответ в общий кеш не годится,
        // но браузеру его держать можно: ключ меняется вместе с кукой
        cache: user.me || intraday
          ? 'no-store'
          : tfFromCookie(req, url)
            ? 'private, max-age=300'
            : rec
              ? 'public, max-age=300'
              : 'no-store',
      });
    }

    if (url.pathname === '/' || url.pathname === '/index.html') {
      const groups = marketGroups();
      const recent = cachedRecent(14);
      const refreshedAt = recent.length ? recent[0].generatedAt : null;
      // Вкладка — обычный параметр, а не якорь: сервер отдаёт уже собранный
      // список, поэтому страница работает и без скриптов. Неизвестное значение
      // молча откатывается на «Все», как и неизвестный интервал свечи
      const tab = isTab(url.searchParams.get('tab')) ? url.searchParams.get('tab') : 'all';
      return sendHtml(
        res,
        homePage({
          siteUrl: SITE_URL,
          siteName: SITE_NAME,
          groups,
          cached: recent,
          refreshedAt,
          tab,
          // На вкладке каталог показывает только её рынок — иначе три адреса
          // главной несут одни и те же ссылки и выглядят как копии
          tabMarkets: tab === 'all' ? null : HOME_TABS.find((t) => t.key === tab)?.markets || null,
          rankHtml: homeRank({
            groups,
            charts: chartStore.all(),
            usdRate: currentUniverse()?.usdRate ?? null,
            tab,
            // Первая отрисовка сразу с живыми ценами: иначе таблица показывает
            // вчерашнее закрытие и через пять секунд прыгает на сегодняшнее
            live: realtime.all(),
          }),
          indicesHtml: homeIndices({ quotes: realtime.overlayAll(indexStore.all()), siteUrl: SITE_URL }),
        })
      );
    }

    const rel = url.pathname === '/' ? 'index.html' : path.normalize(url.pathname).replace(/^(\.\.[/\\])+/, '');
    const file = path.join(PUBLIC_DIR, rel);
    if (!file.startsWith(PUBLIC_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Not found');
    }
    // Без ETag браузер держал старую копию app.css по собственной эвристике,
    // и новый блок страницы приезжал без стилей. Отдаём метку по mtime+размеру
    const st = fs.statSync(file);
    const etag = `W/"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
    const headers = {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      ETag: etag,
      'Last-Modified': st.mtime.toUTCString(),
      // Кеш короткий, а не «навсегда»: имена файлов не содержат хеша версии
      'Cache-Control': 'public, max-age=600',
    };
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, headers);
      return res.end();
    }
    res.writeHead(200, headers);
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    if (e.status !== 404) console.error(e);
    sendJson(res, e.status || 500, { error: e.message });
  }
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const { lang: pathLang, path } = langFromPath(url.pathname);
  // Служебные адреса и статика существуют в одном экземпляре на весь сайт:
  // /api, /app.css, /robots.txt не переводятся и префикса не имеют
  const isService = /^\/api\//.test(url.pathname) || /\.[a-z0-9]+$/i.test(url.pathname);
  // Но содержимое служебного ответа всё-таки языковое: /api/board отдаёт
  // заголовок вкладки и разметку с подписями, /api/quotes — отформатированные
  // числа. Префикса у адреса нет, поэтому язык приходит параметром, а без
  // него — русский, как и раньше
  const qLang = String(url.searchParams.get('lang') || '');
  const lang = isService && isLang(qLang) ? qLang : pathLang;
  // Один канонический вид адреса на страницу. Расходится он по двум причинам:
  // языкового префикса нет (русский раньше жил без него) или в конце стоит
  // лишний слэш. И то и другое даёт вторую копию страницы с чужим canonical,
  // поэтому ведём 301 на канонический адрес, а не показываем её как есть.
  // Слэш снимаем до вычисления адреса: /ru/catalog/ и /ru/catalog — одна
  // страница, и без этого перехода она осталась бы стабильной и неисправленной
  if (!isService) {
    const bare = path.length > 1 ? path.replace(/\/+$/, '') || '/' : path;
    const target = langHref(lang, bare);
    if (target !== url.pathname) {
      const qs = url.searchParams.toString();
      // Тело запроса переживает только 307: 301 превратил бы POST в GET и
      // выбросил введённый вопрос, а старая форма шлёт именно POST
      res.writeHead(req.method === 'GET' || req.method === 'HEAD' ? 301 : 307, {
        Location: target + (qs ? `?${qs}` : ''),
      });
      return res.end();
    }
    url.pathname = path;
  }
  // Путь для переключателя языка — снятый: с него строятся ссылки на ту же
  // страницу в других языках, и префикс не должен накапливаться. Параметры
  // адреса переезжают вместе с ним: /?tab=us и /charts/gold?tf=1h — это разные
  // страницы, и переключатель должен вести на ту же, а не на её вариант по
  // умолчанию. Значения уже закодированы в строке запроса, повторно не трогаем
  const qs = url.searchParams.toString();
  return withLang(lang, () => handleRequest(req, res, url), qs ? `${path}?${qs}` : path);
});

server.listen(PORT, HOST, () => {
  console.log(`News Summary: http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}  (модель: ${MODEL})`);
  if (droppedEntries) log(`из кеша выброшено битых записей: ${droppedEntries}`);
  if (CRAWLER.enabled) crawler.start();
  else log('крон выключен (CRAWLER_ENABLED=0)');
  dividendCrawler.start();
  indexCrawler.start();
  chartCrawler.start();
  spendTracker.start();
  // Котировкам нужны вселенная (что опрашивать), дневной файл графиков (какой
  // парой торгуется монета и опорное закрытие) и история индексов (закрытие
  // прошлого дня). Всё это крон дописывает уже после старта, поэтому
  // передаётся функция, а не снимок
  realtime.start({
    inputs: () => ({ universe: currentUniverse(), charts: chartStore.all(), indices: indexStore.allHistory() }),
  });
  // Страница узнаёт период опроса из своей же разметки: так выключенный
  // реалтайм гасит и клиентский таймер, и запросы к /api/quotes
  setQuoteMs(process.env.REALTIME_ENABLED === '0' ? 0 : realtime.intervalMs());
});
