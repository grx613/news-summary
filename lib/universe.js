// Состав тикеров для ежедневного обновления.
// Источники: индекс Мосбиржи, скринер Nasdaq по капитализации, CoinGecko по капитализации.

import { get, norm } from './http.js';

const CACHE_TTL_MS = 24 * 3600_000;

// ---------------------------------------------------------------- акции MOEX
// Убираем кавычки, «ПАО», хвосты «ао»/«ап» — по названию ищутся новости
// \b в JS не работает с кириллицей, поэтому границы слов задаём пробелами
function cleanRuName(raw = '') {
  return ` ${raw} `
    .replace(/["«»']/g, ' ')
    .replace(/\(ПАО\)|МКПАО|ПАО|ОАО|ЗАО/gi, ' ')
    .replace(/\s(НК|ао\.?|ап\.?|акции об\.?|акц\.пр\.?|\d+ вып\.?)(?=\s)/gi, ' ')
    .replace(/\s(НК|ао\.?|ап\.?|акции об\.?|акц\.пр\.?|\d+ вып\.?)(?=\s)/gi, ' ')
    .replace(/\s[-–—]\s/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Биржевые названия бывают сокращены до нечитаемого — по ним новости не ищутся
const RU_ALIASES = {
  LKOH: 'Лукойл', ROSN: 'Роснефть', GMKN: 'Норникель', MAGN: 'ММК', AFLT: 'Аэрофлот', MTSS: 'МТС',
  VTBR: 'ВТБ', X5: 'X5', VKCO: 'ВК', CBOM: 'МКБ', ENPG: 'Эн+', UGLD: 'ЮГК', RUAL: 'Русал',
  TRNFP: 'Транснефть', RTKM: 'Ростелеком', T: 'Т-Технологии', YDEX: 'Яндекс', NVTK: 'Новатэк',
  SBER: 'Сбербанк', SBERP: 'Сбербанк', TATN: 'Татнефть', TATNP: 'Татнефть', SNGS: 'Сургутнефтегаз',
  SNGSP: 'Сургутнефтегаз', IRAO: 'Интер РАО', HEAD: 'Хэдхантер', MDMG: 'Мать и дитя', CNRU: 'Циан',
  ALRS: 'Алроса', AFKS: 'АФК Система', PHOR: 'ФосАгро', NLMK: 'НЛМК', CHMF: 'Северсталь',
  PLZL: 'Полюс', POSI: 'Позитив', RAGR: 'Русагро', MOEX: 'Мосбиржа', OZON: 'Озон', GAZP: 'Газпром',
};

async function ruUniverse() {
  const url = 'https://iss.moex.com/iss/statistics/engines/stock/markets/index/analytics/IMOEX.json?iss.meta=off&limit=100';
  const res = await get(url, { timeout: 15000 });
  if (!res.ok) throw new Error(`MOEX index ${res.status}`);
  const d = (await res.json()).analytics;
  const col = Object.fromEntries(d.columns.map((c, i) => [c, i]));

  const namesRes = await get(
    'https://iss.moex.com/iss/engines/stock/markets/shares/boards/TQBR/securities.json?iss.meta=off&iss.only=securities&securities.columns=SECID,SHORTNAME,SECNAME',
    { timeout: 15000 }
  );
  const names = {};
  if (namesRes.ok) {
    const n = (await namesRes.json()).securities;
    const nc = Object.fromEntries(n.columns.map((c, i) => [c, i]));
    for (const r of n.data) names[r[nc.SECID]] = r[nc.SECNAME] || r[nc.SHORTNAME];
  }

  const bySymbol = new Map();
  for (const r of d.data) {
    const symbol = r[col.ticker];
    if (!symbol) continue;
    bySymbol.set(symbol, {
      symbol,
      name: RU_ALIASES[symbol] || cleanRuName(names[symbol] || r[col.shortnames] || symbol),
      market: 'RU',
      weight: r[col.weight] ?? 0,
    });
  }

  // Привилегированные акции дают те же новости, что и обыкновенные: оставляем одну бумагу
  const out = [];
  const byName = new Map();
  for (const a of [...bySymbol.values()].sort((x, y) => y.weight - x.weight)) {
    const key = norm(a.name);
    if (byName.has(key)) continue;
    byName.set(key, a);
    out.push(a);
  }
  return out;
}

// ---------------------------------------------------------------- акции США
// Срезаем юридические формы, «Common Stock», ADS/ADR — остаётся название компании
const LEGAL =
  /\b(Inc\.?|Incorporated|Corp\.?|Corporation|Company|Companies|Co\.?|Ltd\.?|Limited|plc\.?|PLC|p\.l\.c\.?|Group|Holding|Holdings|AG|SE|N\.V\.?|S\.A\.?|S\.A\.B\.?|de C\.V\.?|A\/S|LLC|LP|N\.A\.?)\b\.?,?\s*$/i;

export function cleanUsName(raw = '') {
  let n = raw.replace(/\s+/g, ' ').trim();
  n = n.replace(/\s*(Class [A-Z]\s*)(Common Stock|Capital Stock)/i, ' ');
  n = n.replace(/\s*\((?:DE|The|new|Ireland|Japan|Belgium|Spain|UK|USA)\)\s*/gi, ' ');
  n = n.replace(/\s*(Class [A-Z]\s*)?(Common Stock|Capital Stock|Subordinate Voting Shares|New York Registry Shares|Registered Ordinary Shares|Ordinary Shares?)\s*$/i, '');
  n = n.replace(/\s*American Depositary Shares.*$/i, '');
  n = n.replace(/\s*(Sponsored |Unsponsored )?(ADR|ADS)\b.*$/i, '');
  n = n.replace(/[,\s]+$/, '');
  for (let i = 0; i < 3; i++) n = n.replace(LEGAL, '').trim();
  n = n.replace(/\s+(and|of|&)\s*$/i, '').replace(/[,\s&]+$/, '');
  return n.replace(/\s+/g, ' ').trim();
}

// Не обыкновенные акции: депозитарные расписки на конвертируемые префы, облигации, варранты
const US_NOISE = /depositary shares|global notes|\bzones\b|mandatory convertible|warrant|preferred stock|% /i;

async function usUniverse(limit) {
  const url = `https://api.nasdaq.com/api/screener/stocks?tableonly=true&limit=${limit}&offset=0&download=false&sortcolumn=marketCap&sorttype=desc`;
  const res = await get(url, { timeout: 20000, headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Nasdaq screener ${res.status}`);
  const rows = (await res.json())?.data?.table?.rows || [];

  const out = [];
  const seen = new Map();
  for (const r of rows) {
    if (!r.symbol || US_NOISE.test(r.name || '')) continue;
    const name = cleanUsName(r.name || '');
    if (name.length < 2) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue; // вторая доля того же эмитента (GOOG после GOOGL)
    seen.set(key, r.symbol);
    out.push({
      // BRK/A в скринере — у Yahoo это BRK-A
      symbol: r.symbol.includes('/') ? r.symbol.replace('/', '-') : r.symbol,
      name,
      market: 'US',
    });
  }
  return out;
}

// ---------------------------------------------------------------- криптовалюты
// Стейблкоины, обёрнутые и стейкинг-версии — не отдельные истории: новости у них те же
const CRYPTO_STABLE = new Set([
  'USDT', 'USDC', 'DAI', 'USDE', 'USD0', 'USDF', 'FDUSD', 'TUSD', 'BUSD', 'USDS', 'PYUSD', 'USD1', 'RLUSD',
  'USTC', 'FRAX', 'LUSD', 'GUSD', 'USDD', 'USDP', 'EURC', 'XAUT', 'PAXG', 'USDG', 'USDX', 'USDY', 'BUIDL',
  'USYC', 'SUSDE', 'SUSDS', 'USDTB', 'USDB', 'USR', 'DEUSD', 'CRVUSD', 'GHO', 'BFUSD', 'USDAI', 'OUSG', 'USTB',
]);
const CRYPTO_NOISE = /wrapped|staked|bridged|stable|liquid staking|restaked|dollar|tokenized|treasury|\bgold\b|peg/i;

async function cryptoUniverse(limit) {
  const url =
    'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=1&sparkline=false';
  const res = await get(url, { timeout: 20000 });
  if (!res.ok) throw new Error(`CoinGecko ${res.status}`);
  const rows = await res.json();

  const out = [];
  for (const x of rows) {
    const symbol = String(x.symbol || '').toUpperCase();
    const rawName = x.name || symbol;
    if (!symbol || CRYPTO_STABLE.has(symbol)) continue;
    if (/^USD/.test(symbol) || /USD$/.test(symbol)) continue;
    if (CRYPTO_NOISE.test(rawName)) continue;
    if ((x.total_volume || 0) < 5_000_000) continue; // тонкий рынок: новостей и смысла нет
    // «Gram (prev. Toncoin)» — в поиске новостей лучше работает имя без пояснений
    const name = rawName.replace(/\s*\(.*?\)\s*/g, ' ').replace(/\s+/g, ' ').trim() || symbol;
    out.push({ symbol, name, market: 'CRYPTO', rank: x.market_cap_rank });
    if (out.length >= limit) break;
  }
  return out;
}

// ---------------------------------------------------------------- сборка
export async function buildUniverse(cfg, log = () => {}) {
  const [ru, us, crypto] = await Promise.allSettled([
    ruUniverse(),
    usUniverse(cfg.usLimit),
    cryptoUniverse(cfg.cryptoLimit),
  ]);

  const pick = (r, label) => {
    if (r.status === 'fulfilled') {
      log(`${label}: ${r.value.length} тикеров`);
      return r.value;
    }
    log(`${label}: не удалось — ${r.reason?.message || 'ошибка'}`);
    return null;
  };

  const seen = new Set();
  const all = [];
  for (const part of [pick(ru, 'MOEX'), pick(us, 'США'), pick(crypto, 'крипта')]) {
    for (const a of part || []) {
      const key = `${a.market}:${a.symbol}`;
      if (seen.has(key)) continue;
      seen.add(key);
      all.push(a);
    }
  }
  return { items: all, at: new Date().toISOString(), failed: [ru, us, crypto].filter((r) => r.status === 'rejected').length };
}

const universeCache = { data: null, at: 0 };

export async function getUniverse(cfg, log) {
  if (universeCache.data && Date.now() - universeCache.at < CACHE_TTL_MS) return universeCache.data;
  const data = await buildUniverse(cfg, log);
  if (data.items.length) {
    universeCache.data = data;
    universeCache.at = Date.now();
  }
  return data;
}

export function loadedUniverse(data) {
  universeCache.data = data;
  universeCache.at = Date.now();
}

// Текущий список без похода в сеть: нужен каталогу на главной и в sitemap
export function currentUniverse() {
  return universeCache.data;
}
