// Alpaca Market Data: американские акции по SIP — дневная история пакетом,
// свежие внутридневные свечи и живые снапшоты. Остальные рынки (индексы,
// фьючерсы, валюты, Мосбиржа, крипта) у Alpaca не торгуются и остаются на своих
// источниках. Без ключей или при отказе модуль молчит, а вызывающий код уходит
// на CNBC и Yahoo, как было до него.

import { get } from './http.js';
import { makeCandle, DAILY_DAYS, TIMEFRAMES } from './charts.js';

const BASE = 'https://data.alpaca.markets/v2/stocks';
const FEED = 'sip';
const TZ = 'America/New_York';
// 100 тикеров — это ~700 символов в адресе и ~30 КБ снапшота: запас по обоим пределам
const MAX_SYMBOLS = 100;
// Неверный или отозванный ключ не повод долбить API каждые пять секунд
const BLOCK_MS = 10 * 60_000;
let blockedUntil = 0;

export const alpacaEnabled = () => Boolean(process.env.ALPACA_KEY_ID && process.env.ALPACA_SECRET_KEY) && Date.now() >= blockedUntil;

// В каталоге класс акций через дефис (BRK-A), у Alpaca — через точку
export const alpacaSymbol = (s) => String(s).replace(/-/g, '.');

async function api(path, params, { timeout }) {
  const qs = new URLSearchParams({ feed: FEED, ...params });
  const res = await get(`${BASE}${path}?${qs}`, {
    timeout,
    headers: {
      Accept: 'application/json',
      'APCA-API-KEY-ID': process.env.ALPACA_KEY_ID,
      'APCA-API-SECRET-KEY': process.env.ALPACA_SECRET_KEY,
    },
  });
  if (res.status === 401 || res.status === 403) blockedUntil = Date.now() + BLOCK_MS;
  if (!res.ok) throw new Error(`alpaca ${res.status}`);
  return res.json();
}

const symbolMap = (symbols) => new Map(symbols.map((s) => [alpacaSymbol(s), s]));
const chunks = (list, n) => Array.from({ length: Math.ceil(list.length / n) }, (_, i) => list.slice(i * n, (i + 1) * n));

// Дневные свечи по всем тикерам разом: год на 115 бумаг — три запроса вместо
// 115. split-поправка нужна, чтобы дробление акций не рисовало обрыв на графике
export async function fetchAlpacaDaily(symbols, { days = DAILY_DAYS, timeout = 20000 } = {}) {
  const back = symbolMap(symbols);
  const start = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
  const out = new Map();
  for (const part of chunks([...back.keys()], MAX_SYMBOLS)) {
    let token = null;
    do {
      const j = await api(
        '/bars',
        { symbols: part.join(','), timeframe: '1Day', start, limit: '10000', adjustment: 'split', ...(token && { page_token: token }) },
        { timeout }
      );
      for (const [sym, bars] of Object.entries(j.bars || {})) {
        const ours = back.get(sym);
        if (!ours) continue;
        const list = out.get(ours) || [];
        // Метка дневного бара — полночь по Нью-Йорку в UTC, дата в ней совпадает с торговым днём
        for (const b of bars) {
          const c = makeCandle(String(b.t).slice(0, 10), b.o, b.h, b.l, b.c);
          if (c) list.push(c);
        }
        out.set(ours, list);
      }
      token = j.next_page_token || null;
    } while (token);
  }
  for (const list of out.values()) list.sort((a, b) => a[0].localeCompare(b[0]));
  return out;
}

// Внутридневные интервалы — только хвост: последние свечи, а не история.
// Окно в днях покрывает выходные и праздники, а лимит отсекает лишнее
const INTRADAY = { '1min': ['1Min', 7], '5min': ['5Min', 14], '15min': ['15Min', 30], '30min': ['30Min', 60], '1h': ['1Hour', 120] };

const etClock = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hourCycle: 'h23', hour: '2-digit', minute: '2-digit' });
const minuteOfDay = (epochSec) => {
  const p = etClock.formatToParts(new Date(epochSec * 1000));
  return Number(p.find((x) => x.type === 'hour').value) * 60 + Number(p.find((x) => x.type === 'minute').value);
};
const OPEN = 9 * 60 + 30;
const CLOSE = 16 * 60;

export const alpacaHasIntraday = (tf) => Object.hasOwn(INTRADAY, tf);

// SIP отдаёт и пре-, и постмаркет, а Yahoo и CNBC — только основную сессию.
// Чтобы график не менялся от смены источника, лишнее отрезается: свеча
// остаётся, если она кончается после открытия и начинается до закрытия
export async function fetchAlpacaSeries(symbol, tf, { limit = 400, timeout = 8000 } = {}) {
  const plan = INTRADAY[tf];
  if (!plan) return { candles: [], tz: null };
  const start = new Date(Date.now() - plan[1] * 86400_000).toISOString();
  // Просим с запасом: вне сессии баров почти столько же, сколько в ней,
  // и последние 400 без запаса после фильтра ужались бы вдвое
  const j = await api(
    `/${encodeURIComponent(alpacaSymbol(symbol))}/bars`,
    { timeframe: plan[0], start, limit: String(Math.min(10000, limit * 3)), sort: 'desc', adjustment: 'split' },
    { timeout }
  );
  const sec = TIMEFRAMES[tf].sec;
  const candles = [];
  for (const b of (j.bars || []).slice().reverse()) {
    const t = Math.floor(Date.parse(b.t) / 1000);
    if (!Number.isFinite(t)) continue;
    const s = minuteOfDay(t);
    if (s + sec / 60 <= OPEN || s >= CLOSE) continue;
    const c = makeCandle(t, b.o, b.h, b.l, b.c);
    if (c) candles.push(c);
  }
  return { candles: candles.slice(-limit), tz: TZ };
}

// Живые цены по всем тикерам: снапшот даёт и последнюю сделку, и закрытия.
// Изменение за день считается от закрытия предыдущей сессии, а сессию определяет
// день последней сделки, а не календарь: в субботу последняя сделка пятничная,
// и сравнивать её надо с четверговым закрытием, а не с пятничным — иначе в
// выходные на карточке висел бы ноль. Дневной бар свежее сделки (пре-маркет
// понедельника, когда бар ещё пятничный) значит, что опора — он сам
export async function fetchAlpacaSnapshots(symbols, { timeout = 8000 } = {}) {
  const back = symbolMap(symbols);
  const etDay = new Intl.DateTimeFormat('en-CA', { timeZone: TZ });
  const parts = await Promise.all(chunks([...back.keys()], MAX_SYMBOLS).map((part) => api('/snapshots', { symbols: part.join(',') }, { timeout })));
  const out = {};
  for (const j of parts) {
    for (const [sym, s] of Object.entries(j || {})) {
      const ours = back.get(sym);
      const price = Number(s?.latestTrade?.p);
      if (!ours || !(price > 0)) continue;
      const daily = s.dailyBar;
      const tradeDay = etDay.format(new Date(s.latestTrade.t));
      const sameSession = String(daily?.t || '').slice(0, 10) === tradeDay;
      const prev = Number(sameSession ? s.prevDailyBar?.c : daily?.c);
      out[ours] = {
        price,
        prev: prev > 0 ? prev : null,
        open: sameSession ? (daily?.o ?? null) : null,
        high: sameSession ? (daily?.h ?? null) : null,
        low: sameSession ? (daily?.l ?? null) : null,
        at: s.latestTrade.t,
      };
    }
  }
  return out;
}
