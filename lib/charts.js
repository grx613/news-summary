// Свечи по тикерам для графика на странице бумаги.
// Дневные свечи собирает суточный крон в свой файл (страница по умолчанию рендерится
// без сети), внутридневные, недельные и месячные берутся по запросу — см. chart-intraday.js.
//
// Свеча — массив [время, open, high, low, close]. В файле время — дата 'YYYY-MM-DD',
// во внутридневных — секунды unix: у минутной свечи без часа и минуты нет смысла.
//
// Источники по рынкам разные, и это не вкусовщина:
// - Россия: MOEX ISS candles. Нативно умеет 1, 10, 60 минут, день, неделю и месяц —
//   5 и 15 минут Мосбиржа не отдаёт вовсе. Ответ режется на 500 строках при любом
//   limit, свежие данные — через iss.reverse=true.
// - США: дневные — CNBC (и NYSE, и Nasdaq, ~500 баров одним ответом). Внутри дня —
//   Yahoo chart: у CNBC шаг свечи не задаётся (1D всегда минутки, 5D — пятиминутки).
// - Крипта: Binance, затем MEXC и Gate.io с тем же набором интервалов. MEXC закрывает
//   почти все монеты, которых нет на Binance (WBT, OKB, BGB, KCS, MNT…), Gate — GT.
//   Каждая пара сверяется с ценой CoinGecko: под XMRUSDT на Binance торгуется не
//   Monero за $610, а другой токен за $118. CoinGecko — последний запасной: свечей
//   у него нет, только закрытия, а на бесплатном тарифе он отвечает 429 непредсказуемо.

import fs from 'node:fs';
import path from 'node:path';
import { get } from './http.js';

const MOEX_CANDLES = 'https://iss.moex.com/iss/engines/stock/markets/shares/securities';
const CNBC_CHART = 'https://ts-api.cnbc.com/harmony/app/charts';
const YAHOO_CHART = 'https://query1.finance.yahoo.com/v8/finance/chart';
const CG = 'https://api.coingecko.com/api/v3';
const CG_MARKETS = `${CG}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=1`;

// Сколько дней дневных свечей держать в файле: год плюс запас на выходные
export const DAILY_DAYS = 400;

// Интервалы свечей. Коды не «1m»/«1M»: в адресе их легко перепутать
export const TIMEFRAMES = {
  '1min': { label: '1 мин', sec: 60 },
  '5min': { label: '5 мин', sec: 300 },
  '10min': { label: '10 мин', sec: 600 },
  '15min': { label: '15 мин', sec: 900 },
  '30min': { label: '30 мин', sec: 1800 },
  '1h': { label: '1 час', sec: 3600 },
  '1d': { label: 'День', sec: 86400, daily: true },
  '1w': { label: 'Неделя', sec: 7 * 86400, daily: true },
  '1mo': { label: 'Месяц', sec: 30 * 86400, daily: true },
};

// Набор зависит от того, что источник отдаёт сам: склеивать 5 минут из минуток
// Мосбиржи — значит тянуть по десятку страниц на каждый показ
export const TF_BY_MARKET = {
  RU: ['1min', '5min', '10min', '15min', '1h', '1d', '1w', '1mo'],
  US: ['1min', '5min', '15min', '30min', '1h', '1d', '1w', '1mo'],
  CRYPTO: ['1min', '5min', '15min', '30min', '1h', '1d', '1w', '1mo'],
};

// Мосбиржа не отдаёт 5 и 15 минут — их склеиваем из минуток. Минутный ряд
// за пять дней Мосбиржа отдаёт двенадцатью страницами за полсекунды,
// поэтому это дешевле, чем кажется
const RU_AGGREGATE = { '5min': 300, '15min': 900 };

const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

// Цены разных порядков: биткоин 110 000, а PEPE 0,000012. Одно правило округления
// превратило бы второе в нули, поэтому знаков после запятой тем больше, чем мельче цена
export function roundPrice(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return null;
  const a = Math.abs(v);
  if (a >= 1) return Math.round(v * 100) / 100;
  if (a >= 0.01) return Math.round(v * 10000) / 10000;
  return Math.round(v * 1e8) / 1e8;
}

// Свеча из сырых значений. Тень обязана накрывать тело: у части источников
// high/low округлены грубее open/close, и без поправки фитиль «не дотягивается»
export function makeCandle(t, o, h, l, c) {
  const v = [o, h, l, c].map(num);
  if (v.some((x) => x === null) || t === null || t === undefined || t === '') return null;
  const [O, H, L, C] = v;
  return [t, roundPrice(O), roundPrice(Math.max(H, O, C)), roundPrice(Math.min(L, O, C)), roundPrice(C)];
}

// Склейка свечей в более крупные: open первой, close последней, крайние high и low.
// Экстремумы при этом не теряются, в отличие от прореживания
export function aggregate(candles, bucketOf) {
  const out = [];
  let cur = null;
  let curKey = null;
  for (const c of candles) {
    const key = bucketOf(c[0]);
    if (cur && key === curKey) {
      cur[2] = Math.max(cur[2], c[2]);
      cur[3] = Math.min(cur[3], c[3]);
      cur[4] = c[4];
    } else {
      if (cur) out.push(cur);
      cur = [c[0], c[1], c[2], c[3], c[4]];
      curKey = key;
    }
  }
  if (cur) out.push(cur);
  return out;
}

const DAY = (s) => new Date(s * 1000).toISOString().slice(0, 10);

// Неделя начинается с понедельника — так режут недельные свечи и Мосбиржа, и Binance, и Yahoo
export function weekOf(day) {
  const d = new Date(`${day}T00:00:00Z`);
  const shift = (d.getUTCDay() + 6) % 7;
  return new Date(d.getTime() - shift * 86400_000).toISOString().slice(0, 10);
}

// Старые записи хранили пары [дата, закрытие]. Пока крон их не перезапишет,
// они рисуются «крестиками» без тела, а не роняют страницу
export function normalizePoints(points) {
  if (!Array.isArray(points)) return [];
  const out = [];
  for (const p of points) {
    if (!Array.isArray(p)) continue;
    const c = p.length >= 5 ? makeCandle(p[0], p[1], p[2], p[3], p[4]) : makeCandle(p[0], p[1], p[1], p[1], p[1]);
    if (c) out.push(c);
  }
  return out;
}

// ---------------------------------------------------------------- Мосбиржа
export function moexRows(json) {
  const c = json?.candles;
  if (!c?.data?.length) return [];
  const [oi, hi, li, ci, bi] = ['open', 'high', 'low', 'close', 'begin'].map((n) => c.columns.indexOf(n));
  return c.data.map((r) => ({ begin: String(r[bi] || ''), o: r[oi], h: r[hi], l: r[li], c: r[ci] }));
}

// Время в ответе Мосбиржи — московское, без зоны
export const moexEpoch = (begin) => Math.round(Date.parse(`${begin.replace(' ', 'T')}+03:00`) / 1000);

export async function fetchRuCandles(symbol, { days = DAILY_DAYS, timeout = 20000 } = {}) {
  const iso = (d) => d.toISOString().slice(0, 10);
  const from = iso(new Date(Date.now() - days * 86400_000));
  const till = iso(new Date());
  const url = `${MOEX_CANDLES}/${encodeURIComponent(symbol)}/candles.json?iss.meta=off&from=${from}&till=${till}&interval=24&limit=500`;
  const res = await get(url, { timeout });
  if (!res.ok) return [];
  const rows = moexRows(await res.json().catch(() => null));
  const daily = rows
    .map((r) => makeCandle(r.begin.slice(0, 10), r.o, r.h, r.l, r.c))
    .filter(Boolean)
    .sort((a, b) => a[0].localeCompare(b[0]));
  // Одна дата может прийти дважды (основная и вечерняя сессия) — склеиваем в одну свечу
  return aggregate(daily, (d) => d);
}

// Внутридневные, недельные и месячные свечи Мосбиржи: свежие вперёд, одной страницей
const MOEX_INTERVAL = { '1min': 1, '10min': 10, '1h': 60, '1w': 7, '1mo': 31 };

export async function fetchMoexSeries(symbol, tf, { timeout = 8000 } = {}) {
  const agg = RU_AGGREGATE[tf];
  if (agg) return fetchMoexAggregated(symbol, agg, timeout);
  const iv = MOEX_INTERVAL[tf];
  if (!iv) return [];
  const url = `${MOEX_CANDLES}/${encodeURIComponent(symbol)}/candles.json?iss.meta=off&iss.reverse=true&interval=${iv}&limit=500`;
  const res = await get(url, { timeout });
  if (!res.ok) return [];
  const daily = TIMEFRAMES[tf].daily;
  return moexRows(await res.json().catch(() => null))
    .map((r) => makeCandle(daily ? r.begin.slice(0, 10) : moexEpoch(r.begin), r.o, r.h, r.l, r.c))
    .filter((c) => c && (daily || Number.isFinite(c[0])))
    .reverse();
}

// 5 и 15 минут: минутки пачками по 500 строк и склейка. Свежие страницы идут
// первыми (iss.reverse), поэтому обрываем обход, как только набрали нужное —
// за 15 минутами это двенадцать страниц, за 5 минутами — шесть
const PAGES_PER_500 = 500;

async function fetchMoexAggregated(symbol, bucketSec, timeout) {
  const want = 400 * (bucketSec / 60); // столько минуток нужно на 400 свечей
  const pages = Math.min(Math.ceil(want / PAGES_PER_500), 14);
  const urls = Array.from(
    { length: pages },
    (_, i) =>
      `${MOEX_CANDLES}/${encodeURIComponent(symbol)}/candles.json?iss.meta=off&iss.reverse=true&interval=1&limit=500&start=${i * PAGES_PER_500}`
  );
  // Страницы независимы: идём параллельно, иначе 15 минут ждут двенадцати кругов подряд
  const results = await Promise.all(
    urls.map(async (u) => {
      try {
        const res = await get(u, { timeout });
        if (!res.ok) return [];
        return moexRows(await res.json().catch(() => null));
      } catch {
        return [];
      }
    })
  );
  const rows = results.flat();
  const minutes = rows
    .map((r) => makeCandle(moexEpoch(r.begin), r.o, r.h, r.l, r.c))
    .filter((c) => c && Number.isFinite(c[0]))
    .sort((a, b) => a[0] - b[0]);
  if (!minutes.length) return [];
  // Ключ — начало окна: 5-минутные свечи открываются в :00, :05, :10
  const out = aggregate(minutes, (t) => Math.floor(t / bucketSec));
  return out.map((c) => [Math.floor(c[0] / bucketSec) * bucketSec, c[1], c[2], c[3], c[4]]);
}

// ---------------------------------------------------------------- США
// CNBC знает BRK.A, а в каталоге бумага записана как BRK-A: пробуем оба написания
const cnbcVariants = (symbol) => (symbol.includes('-') ? [symbol, symbol.replace(/-/g, '.')] : [symbol]);

async function cnbcBars(symbol, preset, timeout) {
  for (const sym of cnbcVariants(symbol)) {
    const res = await get(`${CNBC_CHART}/${preset}.json?symbol=${encodeURIComponent(sym)}&interval=1D`, {
      timeout,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) continue;
    const bars = (await res.json().catch(() => null))?.barData?.priceBars;
    if (Array.isArray(bars) && bars.length) return bars;
  }
  return [];
}

// Дневная история из Yahoo: тот же OHLC, но год (range=1y) отдаётся одним
// запросом. Нужен, когда CNBC недоступен — Akamai за ним блокирует целые
// датацентровые сети, и без этого запасного пути графики США оставались бы
// пустыми навсегда, а не до следующего прогона
export async function fetchYahooDaily(symbol, { timeout = 20000 } = {}) {
  const res = await get(`${YAHOO_CHART}/${encodeURIComponent(symbol)}?range=1y&interval=1d`, {
    timeout,
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) return [];
  const json = await res.json().catch(() => null);
  const r = (json?.chart?.result || [])[0];
  if (!r) return [];
  const ts = r.timestamp || [];
  const q = r.indicators?.quote?.[0] || {};
  const from = new Date(Date.now() - DAILY_DAYS * 86400_000).toISOString().slice(0, 10);
  const out = [];
  for (let i = 0; i < ts.length; i++) {
    const close = q.close?.[i];
    if (close === null || close === undefined) continue;
    const open = q.open?.[i] ?? close;
    const high = q.high?.[i] ?? close;
    const low = q.low?.[i] ?? close;
    // День берём по нью-йоркскому календарю: у Yahoo метка — открытие сессии в UTC
    const d = new Date(ts[i] * 1000).toISOString().slice(0, 10);
    const c = makeCandle(d, open, high, low, close);
    if (c && c[0] >= from) out.push(c);
  }
  return aggregate(out.sort((a, b) => a[0].localeCompare(b[0])), (d) => d);
}

export async function fetchUsDaily(symbol, { timeout = 20000 } = {}) {
  const bars = await cnbcBars(symbol, '1Y', timeout);
  // CNBC ответил отказом (403 у Akamai) — уходим в Yahoo, иначе истории нет
  if (!bars.length) return fetchYahooDaily(symbol, { timeout });
  const from = new Date(Date.now() - DAILY_DAYS * 86400_000).toISOString().slice(0, 10);
  const out = [];
  for (const b of bars) {
    const m = String(b.tradeTime || '').match(/^(\d{4})(\d{2})(\d{2})/);
    if (!m) continue;
    const c = makeCandle(`${m[1]}-${m[2]}-${m[3]}`, b.open, b.high, b.low, b.close);
    if (c && c[0] >= from) out.push(c);
  }
  return aggregate(out.sort((a, b) => a[0].localeCompare(b[0])), (d) => d);
}

// Запасной путь на случай отказа Yahoo: CNBC отдаёт минутки за день и пятиминутки за 5 дней
const CNBC_PRESET = { '1min': '1D', '5min': '5D' };

export async function fetchCnbcIntraday(symbol, tf, { timeout = 8000 } = {}) {
  const preset = CNBC_PRESET[tf];
  if (!preset) return [];
  const bars = await cnbcBars(symbol, preset, timeout);
  return bars
    .map((b) => makeCandle(Math.round(Number(b.tradeTimeinMills) / 1000), b.open, b.high, b.low, b.close))
    .filter((c) => c && Number.isFinite(c[0]));
}

// Yahoo: диапазон подобран так, чтобы свечей хватило на график, но не больше —
// минутки он отдаёт только за 7 дней, 15 и 30 минут — только за месяц
const YAHOO_PLAN = {
  '1min': ['5d', '1m'],
  '5min': ['5d', '5m'],
  '15min': ['1mo', '15m'],
  '30min': ['1mo', '30m'],
  '1h': ['3mo', '60m'],
  '1w': ['5y', '1wk'],
  '1mo': ['10y', '1mo'],
};

export async function fetchYahooSeries(symbol, tf, { timeout = 8000 } = {}) {
  const plan = YAHOO_PLAN[tf];
  if (!plan) return { candles: [], tz: null };
  const res = await get(`${YAHOO_CHART}/${encodeURIComponent(symbol)}?range=${plan[0]}&interval=${plan[1]}`, {
    timeout,
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) return { candles: [], tz: null };
  const r = (await res.json().catch(() => null))?.chart?.result?.[0];
  const ts = r?.timestamp;
  const q = r?.indicators?.quote?.[0];
  if (!Array.isArray(ts) || !q) return { candles: [], tz: null };
  const daily = TIMEFRAMES[tf].daily;
  // Yahoo ставит недельной и месячной свече время открытия биржи по Нью-Йорку:
  // для даты берём сдвиг биржи, иначе понедельник уедет в воскресенье
  const off = Number(r.meta?.gmtoffset) || 0;
  const candles = [];
  ts.forEach((t, i) => {
    const c = makeCandle(daily ? DAY(t + off) : t, q.open?.[i], q.high?.[i], q.low?.[i], q.close?.[i]);
    if (c) candles.push(c);
  });
  return { candles: dropUnfinished(candles), tz: r.meta?.exchangeTimezoneName || 'America/New_York' };
}

// Последняя внутридневная свеча у Yahoo бывает пустой: open, high, low и close
// равны, потому что час только начался. Рисовать её — значит показывать
// неподвижную цену, которой на рынке не было
function dropUnfinished(candles) {
  if (candles.length < 2) return candles;
  const last = candles[candles.length - 1];
  if (last[1] === last[2] && last[2] === last[3] && last[3] === last[4]) return candles.slice(0, -1);
  return candles;
}

// ---------------------------------------------------------------- крипта
// Один запрос к CoinGecko даёт и id монеты, и её текущую цену. Цена нужна не для
// графика, а как проверка совпадения пары на бирже по смыслу, а не по символу
export async function fetchCryptoIds({ timeout = 25000 } = {}) {
  const res = await get(CG_MARKETS, { timeout, headers: { Accept: 'application/json' } });
  if (!res.ok) return {};
  const rows = await res.json().catch(() => null);
  if (!Array.isArray(rows)) return {};
  const out = {};
  for (const x of rows) {
    const s = String(x.symbol || '').toUpperCase();
    if (s && x.id && !out[s]) out[s] = { id: x.id, price: num(x.current_price) };
  }
  return out;
}

// Binance и MEXC говорят на одном API, Gate.io — на своём, с другим порядком полей
const EXCHANGES = {
  binance: {
    pair: (s) => `${s}USDT`,
    iv: { '1min': '1m', '5min': '5m', '15min': '15m', '30min': '30m', '1h': '1h', '1d': '1d', '1w': '1w', '1mo': '1M' },
    url: (pair, iv, limit) => `https://api.binance.com/api/v3/klines?symbol=${pair}&interval=${iv}&limit=${limit}`,
    row: (k) => [Math.round(Number(k[0]) / 1000), k[1], k[2], k[3], k[4]],
  },
  mexc: {
    pair: (s) => `${s}USDT`,
    // Недельных свечей у MEXC нет: их склеиваем из дневных
    iv: { '1min': '1m', '5min': '5m', '15min': '15m', '30min': '30m', '1h': '60m', '1d': '1d', '1mo': '1M' },
    url: (pair, iv, limit) => `https://api.mexc.com/api/v3/klines?symbol=${pair}&interval=${iv}&limit=${Math.min(limit, 500)}`,
    row: (k) => [Math.round(Number(k[0]) / 1000), k[1], k[2], k[3], k[4]],
  },
  gate: {
    pair: (s) => `${s}_USDT`,
    iv: { '1min': '1m', '5min': '5m', '15min': '15m', '30min': '30m', '1h': '1h', '1d': '1d', '1w': '7d', '1mo': '30d' },
    url: (pair, iv, limit) => `https://api.gateio.ws/api/v4/spot/candlesticks?currency_pair=${pair}&interval=${iv}&limit=${limit}`,
    // [время, объём в USDT, close, high, low, open, …]
    row: (k) => [Number(k[0]), k[5], k[3], k[4], k[2]],
  },
};

export const CRYPTO_EXCHANGES = Object.keys(EXCHANGES);

export async function fetchExchangeSeries(exchange, pair, tf, { limit = 300, timeout = 8000 } = {}) {
  const ex = EXCHANGES[exchange];
  if (!ex || !pair) return [];
  const daily = TIMEFRAMES[tf]?.daily;
  // Недели там, где их нет, — из дневных свечей
  if (!ex.iv[tf] && tf === '1w') {
    const days = await fetchExchangeSeries(exchange, pair, '1d', { limit: 1000, timeout });
    return aggregate(days, weekOf).map((c) => [weekOf(c[0]), c[1], c[2], c[3], c[4]]);
  }
  if (!ex.iv[tf]) return [];
  const res = await get(ex.url(encodeURIComponent(pair), ex.iv[tf], limit), { timeout, headers: { Accept: 'application/json' } });
  if (!res.ok) return [];
  const rows = await res.json().catch(() => null);
  if (!Array.isArray(rows)) return [];
  return rows
    .filter(Array.isArray)
    .map((k) => {
      const [t, o, h, l, c] = ex.row(k);
      return Number.isFinite(t) ? makeCandle(daily ? DAY(t) : t, o, h, l, c) : null;
    })
    .filter(Boolean)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Только закрытия: свечу из них честно не построить, поэтому open — закрытие
// предыдущего дня, а тени совпадают с телом. Лучше так, чем пустой график
export async function fetchCoinGeckoDaily(id, { days = 365, timeout = 20000, retryMs = 12_000 } = {}) {
  const url = `${CG}/coins/${encodeURIComponent(id)}/market_chart?vs_currency=usd&days=${days}&interval=daily`;
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await get(url, { timeout, headers: { Accept: 'application/json' } });
    if (res.status === 429 && attempt === 0) {
      await sleep(retryMs);
      continue;
    }
    if (!res.ok) return [];
    const prices = (await res.json().catch(() => null))?.prices;
    if (!Array.isArray(prices)) return [];
    const byDay = new Map();
    for (const pair of prices) {
      const ms = Number(pair?.[0]);
      const close = num(pair?.[1]);
      if (Number.isFinite(ms) && close !== null) byDay.set(new Date(ms).toISOString().slice(0, 10), close);
    }
    const out = [];
    let prev = null;
    for (const [d, c] of [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      const candle = makeCandle(d, prev ?? c, Math.max(prev ?? c, c), Math.min(prev ?? c, c), c);
      if (candle) out.push(candle);
      prev = c;
    }
    return out;
  }
  return [];
}

// Дневные свечи монеты: первая биржа, у которой пара есть и цена сходится с CoinGecko
export async function fetchCryptoDaily(symbol, meta, { tolerance = 0.2 } = {}) {
  if (!meta) return { points: [], source: null, pair: null, tried: [] };
  const tried = [];
  for (const exchange of CRYPTO_EXCHANGES) {
    const pair = EXCHANGES[exchange].pair(symbol);
    let points = [];
    try {
      points = await fetchExchangeSeries(exchange, pair, '1d', { limit: DAILY_DAYS, timeout: 15000 });
    } catch {
      points = [];
    }
    const last = points.length ? points[points.length - 1][4] : null;
    const ok = last !== null && meta.price ? Math.abs(last - meta.price) / meta.price < tolerance : false;
    tried.push(`${exchange}:${points.length ? (ok ? 'ok' : `цена ${last}`) : 'нет'}`);
    if (ok && points.length >= 2) return { points, source: exchange, pair, tried };
  }
  const points = await fetchCoinGeckoDaily(meta.id);
  return { points, source: points.length ? 'coingecko' : null, pair: null, tried };
}

// ---------------------------------------------------------------- хранение
// Свечи лежат массивами, а не объектами: за год по 206 тикерам это разница
// в несколько мегабайт, а файл переписывается целиком
export const CHART_FORMAT = 2;

export function createChartStore(file, { log = () => {} } = {}) {
  let state = { at: null, items: {} };

  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (raw && typeof raw === 'object' && raw.items) state = { at: raw.at || null, items: raw.items };
  } catch {
    /* первый запуск */
  }

  let saveTimer = null;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, JSON.stringify(state));
      } catch (e) {
        log(`графики: не удалось записать файл — ${e.message}`);
      }
    }, 100);
  }

  return {
    get: (key) => state.items[key] || null,
    set(key, rec) {
      state.items[key] = rec;
      state.at = new Date().toISOString();
      save();
      return rec;
    },
    all: () => state.items,
    get size() {
      return Object.keys(state.items).length;
    },
    updatedAt: () => state.at,
    save,
  };
}
