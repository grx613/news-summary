import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { get, stripTags, norm, decodeEntities } from './lib/http.js';
import { buildUniverse, getUniverse, loadedUniverse, currentUniverse } from './lib/universe.js';
import { createCrawler } from './lib/crawler.js';
import { createDividendStore } from './lib/dividends.js';
import { createDividendCrawler } from './lib/dividend-crawler.js';
import { INDEXES, bySlug, createIndexStore } from './lib/indices.js';
import { createIndexCrawler } from './lib/index-crawler.js';
import { indexPage, indicesPage, homeIndices } from './lib/index-render.js';
import {
  SITE_NAME,
  MARKET_LABEL,
  MARKET_SLUG,
  SLUG_MARKET,
  tickerPath,
  questionPath,
  homePage,
  catalogPage,
  tickerPage,
  questionPage,
  dividendsPage,
  notFoundPage,
} from './lib/render.js';
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
  threadPage,
  loginPage,
  registerPage,
  accountPage,
  rulesPage,
  forumNotFound,
  threadPath,
} from './lib/forum-render.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnv(path.join(__dirname, '.env'));

const PORT = Number(process.env.PORT) || 3000;
// Слушаем только localhost: наружу сайт отдаёт Caddy с HTTPS, порт приложения не должен торчать
const HOST = process.env.HOST || '127.0.0.1';
const API_KEY = process.env.BOTHUB_API_KEY;
const BASE_URL = process.env.BOTHUB_BASE_URL || 'https://openai.bothub.chat/v1';
const MODEL = process.env.MODEL || 'claude-haiku-5.5';

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
// цитаты отдельным полем. QA_SEARCH_MODEL=off отключает поиск и оставляет ответ по кешу новостей
const QA_SEARCH_MODEL = (process.env.QA_SEARCH_MODEL || 'sonar-pro').trim();
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
const FORUM_FILE = path.join(DATA_DIR, 'forum.json');
const FORUM_SECRET_FILE = path.join(DATA_DIR, 'forum-secret.key');
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
    cache[key] = { ...rec, summary: clean };
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
const TYPES = { RU: 'Акция MOEX', US: 'Stock', CRYPTO: 'Crypto', ETF: 'ETF', INDEX: 'Index' };

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
const newsQuery = (a) => {
  if (a.market === 'CRYPTO') return `${a.name} ${a.symbol} crypto`;
  if (a.market === 'RU') return `${a.name} новости`;
  return `${a.name} ${a.symbol} stock`;
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
  const url = `https://www.bing.com/news/search?q=${encodeURIComponent(newsQuery(a))}&format=rss&qft=sortbydate%3d%221%22`;
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
  if (!/[а-я]/i.test(w)) return w;
  if (w.length <= 4) return w;
  if (w.length === 5) return w.slice(0, 4);
  return w.slice(0, w.length - 2);
}

const nameStems = (name) =>
  norm(name)
    .split(' ')
    .filter((w) => w.length >= (w.match(/[a-z]/) ? 4 : 3))
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

  const kind = { CRYPTO: 'криптовалюте', RU: 'российской акции', US: 'акции' }[a.market] || 'активу';
  return `Ниже подборка публикаций по ${kind} ${a.name} (${a.symbol}) за последние дни.

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
  throw Object.assign(new Error('Модель вернула некорректный ответ, попробуйте позже'), { status: 502 });
}

async function buildSummary(a) {
  const { items, used, failed } = await collectNews(a);
  if (!items.length) {
    throw Object.assign(new Error('Свежих публикаций по этому тикеру не нашлось'), { status: 404 });
  }
  const summary = await summarize(a, items);
  // Расход считаем по факту генерации, а не по содержимому кеша: записи из старых версий его не хранят
  if (summary.costUsd) totalCostUsd += summary.costUsd;
  if (summary.tokens) totalTokens += summary.tokens;
  return {
    asset: a,
    summary,
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
  if (typeof crawlerState?.thin === 'object' && crawlerState.thin[key]) {
    delete crawlerState.thin[key];
    saveCrawlerState();
  }
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

// Ответ на форму: 303 на GET, чтобы обновление страницы не отправляло пост второй раз
const redirect = (res, location) => {
  res.writeHead(303, { Location: location });
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
        throw Object.assign(new Error('Поиск сейчас недоступен. Попробуйте через несколько минут.'), { status: 502 });
      }
    }
  }

  const res = await answerFromCache(asset, rec, question);
  if (res.verdict !== 'ok') return res;
  if (res.answer.length < 40) {
    throw Object.assign(new Error('Модель не смогла ответить на вопрос. Попробуйте переформулировать.'), {
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
    return { thin: s?.thin && typeof s.thin === 'object' ? s.thin : {} };
  } catch {
    return { thin: {} };
  }
}

function saveCrawlerState() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFile(CRAWLER_STATE_FILE, JSON.stringify(crawlerState, null, 2), () => {});
  } catch {}
}

const crawlerState = loadCrawlerState();

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

const crawler = createCrawler({
  cfg: CRAWLER,
  log,
  cache,
  cacheKey,
  isFresh,
  refresh: (asset) => getSummary(asset, { force: true }),
  state: crawlerState,
  onDone: saveCrawlerState,
  listUniverse: async () => {
    const u = await getUniverse(CRAWLER, log);
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFile(UNIVERSE_FILE, JSON.stringify(u, null, 2), () => {});
    } catch {}
    return u;
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

function marketGroups() {
  const groups = { RU: [], US: [], CRYPTO: [] };
  for (const a of universeItems()) (groups[a.market] || (groups[a.market] = [])).push(a);
  // В каталог попадают и тикеры вне ежедневного списка, если они уже собраны
  const known = new Set(universeItems().map((a) => `${a.market}:${a.symbol}`));
  for (const rec of Object.values(cache)) {
    const k = `${rec.asset.market}:${rec.asset.symbol}`;
    if (!known.has(k) && groups[rec.asset.market]) {
      groups[rec.asset.market].push(rec.asset);
      known.add(k);
    }
  }
  return groups;
}

function cachedRecent(limit = 14) {
  return Object.values(cache)
    .sort((a, b) => String(b.generatedAt).localeCompare(String(a.generatedAt)))
    .slice(0, limit);
}

function findAsset(market, symbol) {
  const sym = String(symbol || '').toUpperCase();
  const m = String(market || '').toUpperCase();
  const hit = cache[`${m}:${sym}`]?.asset;
  if (hit) return hit;
  return universeItems().find((a) => a.market === m && a.symbol.toUpperCase() === sym) || null;
}

// Соседние тикеры того же рынка: по алфавиту вокруг текущего
function relatedAssets(asset, limit = 10) {
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
        reject(Object.assign(new Error('Слишком большой запрос'), { status: 413 }));
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

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (!checkAuth(req, res)) return;
  const ip = clientIp(req);
  try {
    if (url.pathname === '/api/search') {
      const q = (url.searchParams.get('q') || '').trim();
      if (!q) return sendJson(res, 200, []);
      const wait = ipBucket(ip, 'search', 60_000, MAX_SEARCH_PER_IP_MIN);
      if (wait) return sendJson(res, 429, { error: 'Слишком много запросов поиска. Подождите минуту.' });
      return sendJson(res, 200, await searchTickers(q));
    }

    if (url.pathname === '/api/summary') {
      const symbol = (url.searchParams.get('symbol') || '').trim();
      if (!symbol) return sendJson(res, 400, { error: 'Параметр symbol обязателен' });
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
              error: `Данные по ${asset.symbol} обновляли недавно. Следующее обновление через ${Math.ceil(left / 60000)} мин.`,
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
            error: `Вы исчерпали лимит обновлений (${MAX_GEN_PER_IP_HOUR} в час). Подождите ${Math.ceil(ipWait / 60)} мин или откройте тикер, который уже собран.`,
            retryAfterSec: ipWait,
          });
        }
        if (!allowGeneration()) {
          return sendJson(res, 429, {
            error: 'Сервис собирает слишком много сводок прямо сейчас. Попробуйте через несколько минут или откройте тикер, который уже в кеше.',
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
          name: c.asset.name,
          type: c.asset.market,
          typeLabel: TYPES[c.asset.market] || c.asset.market,
          generatedAt: c.generatedAt,
          sentiment: c.summary?.sentiment,
          headline: c.summary?.headline,
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
          label: MARKET_LABEL[m] || m,
          slug: MARKET_SLUG[m],
          items: arr
            .map((a) => ({
              symbol: a.symbol,
              name: a.name,
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
        spend: { tokens: totalTokens, usd: Number(totalCostUsd.toFixed(4)) },
        auth: Boolean(BASIC_AUTH),
        ipLimits: { generationsPerHour: MAX_GEN_PER_IP_HOUR, searchesPerMinute: MAX_SEARCH_PER_IP_MIN },
        generationsLastHour: genLog.length,
        cooldownMin: REFRESH_COOLDOWN_MS / 60000,
        crawler: crawler.status(),
        dividends: dividendCrawler.status(),
        indices: indexCrawler.status(),
      });
    }

    // ------------------------------------------------------------ SEO-служебное
    if (url.pathname === '/robots.txt') {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' });
      return res.end(`User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ${SITE_URL}/sitemap.xml\n`);
    }

    if (url.pathname === '/sitemap.xml') {
      const paths = ['/', '/catalog', '/catalog/ru', '/catalog/us', '/catalog/crypto'];
      if (dividendCrawler.status().stored) paths.push('/dividends');
      // Индексы попадают в карту только со значениями: страница из одних прочерков
      // поисковику бесполезна, а после первого прохода крона значения есть всегда
      if (indexCrawler.status().stored) {
        paths.push('/indices');
        for (const i of INDEXES) paths.push(`/index/${i.slug}`);
      }
      for (const a of universeItems()) paths.push(tickerPath(a));
      for (const rec of Object.values(cache)) {
        const p = tickerPath(rec.asset);
        if (!paths.includes(p)) paths.push(p);
      }
      // Страницы вопросов — самый ценный для индексации контент
      for (const q of questionStore.all()) {
        if (q.asset) paths.push(questionPath(q.asset, q));
      }
      // Обсуждения индексируем мягко: темы лежат внутри страниц тикеров, ответы — часть темы.
      // Отдельного раздела «форум» больше нет, поэтому в карте только правила
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
      if (quotesAt) for (const i of INDEXES) mod.set(`/index/${i.slug}`, quotesAt);
      if (FORUM_ENABLED) {
        for (const t of forumStore.threads()) if (t.createdAt) mod.set(threadPath(t), t.createdAt);
      }
      const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${[...new Set(paths)]
  .map((p) => {
    const d = mod.get(p);
    return `  <url><loc>${esc(SITE_URL + p)}</loc>${d ? `<lastmod>${esc(String(d).slice(0, 10))}</lastmod>` : ''}</url>`;
  })
  .join('\n')}
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

      // Корень форума больше не нужен: обсуждения ищутся на странице бумаги
      if (seg === '') {
        res.writeHead(303, { Location: '/catalog' });
        return res.end();
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
              error: 'Аккаунта с такой фразой нет. Зарегистрируйтесь — сервер примет эту же фразу, и аккаунт создастся с ней.',
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
          return fail('Этот ник занят. Выберите другой или войдите своей фразой.');
        }
        forumStore.addAccount({ key, address, nick, createdAt: new Date().toISOString() });
        setSessionCookie(res, key);
        log(`обсуждения: регистрация ${nick} (${shortAddress(address)})`);
        return redirect(res, '/forum/me?ok=' + encodeURIComponent('Аккаунт создан. Фраза — единственный ключ к нему.'));
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

      // /forum/<id> — старая ссылка на тему: переводим на адрес внутри тикера
      const oldId = Number(seg);
      if (Number.isInteger(oldId) && oldId > 0) {
        const thread = forumStore.byId(oldId);
        if (!thread || thread.hidden) return sendHtml(res, forumNotFound({ siteUrl: SITE_URL }), { status: 404, cache: 'no-store' });
        res.writeHead(301, { Location: threadPath(thread) });
        return res.end();
      }

      return sendHtml(res, forumNotFound({ siteUrl: SITE_URL }), { status: 404, cache: 'no-store' });
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

    // ------------------------------------------------------------ индексы
    // Значения читаются из своего файла: страница не ходит в сеть и открывается
    // мгновенно даже при холодном старте сервиса.
    if (url.pathname === '/indices' || url.pathname === '/indices/') {
      // Пока крон не собрал значения, страница состояла бы из прочерков:
      // отдаём 404, как у дивидендов, чтобы пустое не попало в индекс
      if (!indexCrawler.status().stored) {
        return sendHtml(res, notFoundPage({ siteUrl: SITE_URL, siteName: SITE_NAME }), { status: 404, cache: 'no-store' });
      }
      return sendHtml(res, indicesPage({ quotes: indexStore.all(), history: indexStore.allHistory(), siteUrl: SITE_URL, siteName: SITE_NAME }), {
        cache: 'public, max-age=120',
      });
    }

    if (url.pathname.startsWith('/index/')) {
      const idx = bySlug(decodeURIComponent(url.pathname.split('/')[2] || ''));
      if (!idx || !indexCrawler.status().stored) {
        return sendHtml(res, notFoundPage({ siteUrl: SITE_URL, siteName: SITE_NAME }), { status: 404, cache: 'no-store' });
      }
      return sendHtml(
        res,
        indexPage({
          idx,
          quote: indexStore.quote(idx.code),
          history: indexStore.history(idx.code),
          composition: indexStore.composition(idx.code),
          knownSymbols: knownSymbols(),
          siteUrl: SITE_URL,
          siteName: SITE_NAME,
        }),
        { cache: 'public, max-age=120' }
      );
    }

    // ------------------------------------------------------------ вопрос по тикеру
    // POST /ticker/us/AAPL/ask: ответ собирается один раз и сохраняется как публичная страница
    if (url.pathname.startsWith('/ticker/') && url.pathname.endsWith('/ask')) {
      if (req.method !== 'POST') {
        res.writeHead(303, { Location: url.pathname.replace(/\/ask$/, '') });
        return res.end();
      }
      const [, , slugRaw, symRaw] = url.pathname.split('/');
      const market = SLUG_MARKET[String(slugRaw || '').toLowerCase()];
      const asset = market && symRaw ? findAsset(market, decodeURIComponent(symRaw)) : null;
      if (!asset) return sendHtml(res, notFoundPage({ siteUrl: SITE_URL, siteName: SITE_NAME }), { status: 404, cache: 'no-store' });

      const bodyRaw = await readBody(req, 8 * 1024);
      const form = new URLSearchParams(bodyRaw);
      const question = (form.get('question') || '').trim();
      const back = `${tickerPath(asset)}?err=`;

      const invalid = validateQuestion(question);
      if (invalid) {
        res.writeHead(303, { Location: back + encodeURIComponent(invalid) });
        return res.end();
      }

      const key = cacheKey(asset);
      const rec = cache[key];
      if (!rec) {
        res.writeHead(303, {
          Location: `${tickerPath(asset)}?err=` + encodeURIComponent('Сначала соберите сводку по тикеру — вопрос отвечается по её публикациям.'),
        });
        return res.end();
      }

      // Тот же вопрос второй раз не оплачиваем: отдаём готовый ответ
      const existing = questionStore.findByHash(key, question);
      if (existing) {
        res.writeHead(303, { Location: questionPath(asset, existing) });
        return res.end();
      }

      const ipWait = ipBucket(ip, 'gen', 3600_000, MAX_GEN_PER_IP_HOUR);
      if (ipWait) {
        res.writeHead(303, {
          Location: `${tickerPath(asset)}?err=` + encodeURIComponent(`Лимит вопросов исчерпан. Попробуйте через ${Math.ceil(ipWait / 60)} мин.`),
        });
        return res.end();
      }
      if (!allowGeneration()) {
        res.writeHead(303, {
          Location: `${tickerPath(asset)}?err=` + encodeURIComponent('Сервис перегружен, попробуйте через несколько минут.'),
        });
        return res.end();
      }

      try {
        const reject = (kind) => {
          log(`вопрос ${key} отклонён (${kind}): ${question.slice(0, 80)}`);
          res.writeHead(303, {
            Location: `${tickerPath(asset)}?err=` + encodeURIComponent(VERDICT_MESSAGE[kind] || VERDICT_MESSAGE.off_topic),
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
          asset: { symbol: asset.symbol, name: asset.name, market: asset.market },
          question,
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
        res.writeHead(303, { Location: questionPath(asset, stored) });
        return res.end();
      } catch (e) {
        log(`вопрос ${key} не удался: ${e.message}`);
        res.writeHead(303, { Location: `${tickerPath(asset)}?err=` + encodeURIComponent(e.message) });
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
          const fail = (msg) =>
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
              }),
              { status: 200, cache: 'no-store' }
            );
          if (bad) return fail(bad);
          const wait = ipBucket(ip, 'forum', 3600_000, MAX_FORUM_PER_HOUR);
          if (wait) return fail(`Слишком часто. Попробуйте через ${Math.ceil(wait / 60)} мин.`);

          const rec = forumStore.addMessage({
            ticker: key,
            parent: null,
            title,
            body,
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
              threadPage({ siteUrl: SITE_URL, asset, thread, replies: forumStore.replies(thread.id), me: user.me, account: user.account, error: bad }),
              { cache: 'no-store' }
            );
          }
          const wait = ipBucket(ip, 'forum', 3600_000, MAX_FORUM_PER_HOUR);
          if (wait) return redirect(res, threadPath(thread) + '?err=' + encodeURIComponent(`Слишком часто. Попробуйте через ${Math.ceil(wait / 60)} мин.`));

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
      const asset = market && symRaw ? findAsset(market, decodeURIComponent(symRaw)) : null;
      if (!asset) {
        return sendHtml(res, notFoundPage({ siteUrl: SITE_URL, siteName: SITE_NAME }), { status: 404, cache: 'no-store' });
      }
      const key = cacheKey(asset);
      const rec = cache[key];
      const user = currentUser(req);
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
      });
      // Страницы со свежей сводкой кешируем ненадолго, без сводки — не кешируем вовсе,
      // иначе поисковик запомнит «нет данных» и не переиндексирует.
      // Страницу вошедшего не кешируем: в ней ник и формы, чужая копия из кеша их не должна показать
      return sendHtml(res, html, { cache: user.me ? 'no-store' : rec ? 'public, max-age=300' : 'no-store' });
    }

    if (url.pathname === '/' || url.pathname === '/index.html') {
      const groups = marketGroups();
      const recent = cachedRecent(14);
      const refreshedAt = recent.length ? recent[0].generatedAt : null;
      return sendHtml(
        res,
        homePage({
          siteUrl: SITE_URL,
          siteName: SITE_NAME,
          groups,
          cached: recent,
          refreshedAt,
          indicesHtml: homeIndices({ quotes: indexStore.all(), siteUrl: SITE_URL }),
        })
      );
    }

    const rel = url.pathname === '/' ? 'index.html' : path.normalize(url.pathname).replace(/^(\.\.[/\\])+/, '');
    const file = path.join(PUBLIC_DIR, rel);
    if (!file.startsWith(PUBLIC_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Not found');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    if (e.status !== 404) console.error(e);
    sendJson(res, e.status || 500, { error: e.message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`News Summary: http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}  (модель: ${MODEL})`);
  if (droppedEntries) log(`из кеша выброшено битых записей: ${droppedEntries}`);
  if (CRAWLER.enabled) crawler.start();
  else log('крон выключен (CRAWLER_ENABLED=0)');
  dividendCrawler.start();
  indexCrawler.start();
});
