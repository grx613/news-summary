// История цен по тикерам: год дневных закрытий для графика на странице бумаги.
// Как и дивиденды с индексами — справочные данные без модели, свой файл и свой крон.
//
// Источники по рынкам разные, и это не вкусовщина:
// - Россия: MOEX ISS, свечи дневного интервала. Один запрос отдаёт весь год
//   (history-эндпоинт режет ответ сотней строк, а candles — нет), поэтому 41 бумага
//   собирается за считанные секунды.
// - США: CNBC. Перебирает и NYSE, и Nasdaq, в отличие от API самого Nasdaq,
//   и отдаёт ~500 баров за два года одним ответом.
// - Крипта: Binance, а на монетах, которых там нет (WBT, OKB, BGB, MNT и прочие
//   биржевые токены), — CoinGecko по id монеты. Yahoo первым не годится: под
//   «POL» он отдаёт DOT, а HYPE, RAIN, CC и PUMP вообще не находит по символу.
//   CoinGecko на бесплатном тарифе считает запросы в минуту и отказывает
//   непредсказуемо: 9 монет из 50 в контрольном прогоне получили 429, хотя
//   пауза в 4 с соблюдалась. Поэтому он второй, а не первый.

import fs from 'node:fs';
import path from 'node:path';
import { get } from './http.js';

const MOEX_CANDLES = 'https://iss.moex.com/iss/engines/stock/markets/shares/securities';
const CNBC_CHART = 'https://ts-api.cnbc.com/harmony/app/charts';
const CG = 'https://api.coingecko.com/api/v3';
const CG_MARKETS = `${CG}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=1`;

const num = (v) => {
  const n = Number(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

// Цены разных порядков: биткоин 110 000, а PEPE 0,000012. Одно правило округления
// превратило бы второе в нули, поэтому знаков после запятой тем больше, чем мельче цена
export function roundPrice(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return null;
  const a = Math.abs(v);
  if (a >= 1000) return Math.round(v * 100) / 100;
  if (a >= 1) return Math.round(v * 100) / 100;
  if (a >= 0.01) return Math.round(v * 10000) / 10000;
  return Math.round(v * 1e8) / 1e8;
}

// ---------------------------------------------------------------- Россия
export async function fetchRuCandles(symbol, { days = 365, timeout = 20000 } = {}) {
  const till = new Date();
  const from = new Date(Date.now() - days * 86400_000);
  const iso = (d) => d.toISOString().slice(0, 10);
  const url = `${MOEX_CANDLES}/${encodeURIComponent(symbol)}/candles.json?iss.meta=off&from=${iso(
    from
  )}&till=${iso(till)}&interval=24&limit=500`;

  const res = await get(url, { timeout });
  if (!res.ok) return [];
  const json = await res.json().catch(() => null);
  const c = json?.candles;
  if (!c?.data?.length) return [];
  const bi = c.columns.indexOf('begin');
  const ci = c.columns.indexOf('close');

  const byDay = new Map();
  for (const row of c.data) {
    const close = num(row[ci]);
    const day = String(row[bi] || '').slice(0, 10);
    if (close === null || !day) continue;
    // Свечи могут прийти и с утренней, и с вечерней сессии одной датой — берём последнюю
    byDay.set(day, close);
  }
  return [...byDay.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([d, v]) => [d, roundPrice(v)]);
}

// ---------------------------------------------------------------- США
export async function fetchUsDaily(symbol, { timeout = 20000 } = {}) {
  // CNBC знает BRK.A, а в каталоге бумага записана как BRK-A: пробуем оба написания
  const variants = [symbol];
  if (symbol.includes('-')) variants.push(symbol.replace(/-/g, '.'));

  for (const sym of variants) {
    const res = await get(`${CNBC_CHART}/1Y.json?symbol=${encodeURIComponent(sym)}&interval=1D`, {
      timeout,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) continue;
    const json = await res.json().catch(() => null);
    const bars = json?.barData?.priceBars;
    if (!Array.isArray(bars) || !bars.length) continue;

    const points = [];
    for (const b of bars) {
      const m = String(b.tradeTime || '').match(/^(\d{4})(\d{2})(\d{2})/);
      const close = num(b.close);
      if (!m || close === null) continue;
      points.push([`${m[1]}-${m[2]}-${m[3]}`, roundPrice(close)]);
    }
    if (points.length) return points.sort((a, b) => a[0].localeCompare(b[0]));
  }
  return [];
}

// ---------------------------------------------------------------- крипта
// Один запрос к CoinGecko даёт и id монеты, и её текущую цену. Цена нужна не для
// графика, а как проверка: пары Binance совпадают по символу, но не всегда по
// смыслу — под XMR там торгуется не Monero за $610, а совсем другой токен за $118.
// Сверка последней цены отсекает такие совпадения, и тогда монета идёт через CoinGecko
export async function fetchCryptoIds({ timeout = 25000 } = {}) {
  const res = await get(CG_MARKETS, { timeout, headers: { Accept: 'application/json' } });
  if (!res.ok) return {};
  const rows = await res.json().catch(() => null);
  if (!Array.isArray(rows)) return {};
  const out = {};
  for (const x of rows) {
    const s = String(x.symbol || '').toUpperCase();
    if (s && x.id) out[s] = { id: x.id, price: num(x.current_price) };
  }
  return out;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Binance: 366 дневных свечей одним запросом, без ключа и без лимитов на 50 монет.
// Закрытие — пятый элемент свечи, время открытия — нулевой
export async function fetchBinanceDaily(symbol, { timeout = 15000 } = {}) {
  const url = `https://api.binance.com/api/v3/klines?symbol=${encodeURIComponent(symbol)}USDT&interval=1d&limit=366`;
  const res = await get(url, { timeout, headers: { Accept: 'application/json' } });
  if (!res.ok) return [];
  const rows = await res.json().catch(() => null);
  if (!Array.isArray(rows)) return [];

  const out = [];
  for (const k of rows) {
    if (!Array.isArray(k)) continue;
    const ms = Number(k[0]);
    const close = num(k[4]);
    if (!Number.isFinite(ms) || close === null) continue;
    out.push([new Date(ms).toISOString().slice(0, 10), roundPrice(close)]);
  }
  return out.sort((a, b) => a[0].localeCompare(b[0]));
}

export async function fetchCryptoDaily(id, { days = 365, timeout = 20000, retryMs = 12_000 } = {}) {
  const url = `${CG}/coins/${encodeURIComponent(id)}/market_chart?vs_currency=usd&days=${days}&interval=daily`;
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await get(url, { timeout, headers: { Accept: 'application/json' } });
    // Бесплатный тариф считает запросы в минуту: на отказе ждём и пробуем ещё раз,
    // иначе монета просто выпадет из графика до следующих суток
    if (res.status === 429 && attempt === 0) {
      await sleep(retryMs);
      continue;
    }
    if (!res.ok) return [];
    const json = await res.json().catch(() => null);
    const prices = json?.prices;
    if (!Array.isArray(prices)) return [];

    const byDay = new Map();
    for (const pair of prices) {
      const ms = Number(pair?.[0]);
      const close = num(pair?.[1]);
      if (!Number.isFinite(ms) || close === null) continue;
      byDay.set(new Date(ms).toISOString().slice(0, 10), close);
    }
    return [...byDay.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([d, v]) => [d, roundPrice(v)]);
  }
  return [];
}

// ---------------------------------------------------------------- хранение
// Точки лежат парами [дата, закрытие], а не объектами: за год по 206 тикерам
// это разница в пару мегабайт, а файл переписывается целиком
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
        // Каталог данных может ещё не существовать на чистом DATA_DIR
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
