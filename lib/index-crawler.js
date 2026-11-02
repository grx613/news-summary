// Обновление индексов: значения часто, история и состав — раз в сутки.
// Отдельно от новостей и дивидендов: значение меняется весь торговый день,
// а история за год — нет, и тянуть её каждые пять минут бессмысленно.

import {
  INDEXES,
  fetchMoexHistory,
  fetchMoexComposition,
  fetchCnbcQuotes,
  fetchCnbcHistory,
  parseMoex,
} from './indices.js';
import { get } from './http.js';

const MOEX_SEC = 'https://iss.moex.com/iss/engines/stock/markets/index/securities.json';

const QUOTE_MS = 5 * 60_000; // значения — каждые 5 минут
const HEAVY_MS = 24 * 3600_000; // история и состав — раз в сутки
const FIRST_DELAY_MS = 20_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function createIndexCrawler({ store, log = () => {}, enabled = true, quoteMs = QUOTE_MS, heavyMs = HEAVY_MS }) {
  const runtime = {
    running: false,
    lastQuotesAt: null,
    lastHeavyAt: null,
    stats: null,
    errors: [],
  };
  let timer = null;

  const ruCodes = INDEXES.filter((i) => i.source === 'moex').map((i) => i.sourceCode);
  const usCodes = INDEXES.filter((i) => i.source === 'cnbc').map((i) => i.sourceCode);

  async function refreshQuotes() {
    const got = {};
    try {
      // Мосбиржа отдаёт все свои индексы одним запросом, если перечислить коды
      const res = await get(
        `${MOEX_SEC}?iss.meta=off&iss.only=securities,marketdata&securities=${ruCodes.join(',')}`,
        { timeout: 20000 }
      );
      if (res.ok) Object.assign(got, parseMoex(await res.json()));
    } catch (e) {
      runtime.errors.push(`moex значения: ${e.message}`);
    }

    try {
      const quotes = await fetchCnbcQuotes(usCodes);
      // CNBC присылает время в своём формате: храним как есть, страница покажет
      // его как «обновлено», не пытаясь перевести в московское время.
      // Ключ — наш code, а не биржевой символ: иначе индекс не найдётся в хранилище
      for (const idx of INDEXES.filter((i) => i.source === 'cnbc')) {
        const q = quotes[idx.sourceCode];
        if (q) got[idx.code] = { ...q, code: idx.code };
      }
    } catch (e) {
      runtime.errors.push(`cnbc значения: ${e.message}`);
    }

    if (Object.keys(got).length) store.setQuotes(got);
    return Object.keys(got).length;
  }

  async function refreshHeavy() {
    let n = 0;
    for (const idx of INDEXES) {
      try {
        const points =
          idx.source === 'moex' ? await fetchMoexHistory(idx.sourceCode) : await fetchCnbcHistory(idx.sourceCode);
        if (points.length) {
          store.setHistory(idx.code, points);
          n++;
        }
      } catch (e) {
        runtime.errors.push(`${idx.code} история: ${e.message}`);
      }
      await sleep(250);
    }
    // Состав есть только у российских индексов: у CNBC веса бумаг в индексе
    // в открытом доступе нет, а придумывать их нельзя
    for (const idx of INDEXES.filter((i) => i.source === 'moex')) {
      try {
        const rows = await fetchMoexComposition(idx.sourceCode);
        if (rows.length) store.setComposition(idx.code, rows);
      } catch (e) {
        runtime.errors.push(`${idx.code} состав: ${e.message}`);
      }
      await sleep(250);
    }
    return n;
  }

  async function runOnce({ heavy = false } = {}) {
    if (runtime.running) return runtime;
    runtime.running = true;
    const started = Date.now();
    try {
      const quotes = await refreshQuotes();
      runtime.lastQuotesAt = new Date().toISOString();
      let hist = 0;
      const heavyAge = store.historyAt() ? Date.now() - new Date(store.historyAt()).getTime() : Infinity;
      if (heavy || heavyAge > heavyMs * 0.9) {
        hist = await refreshHeavy();
        runtime.lastHeavyAt = new Date().toISOString();
      }
      runtime.stats = { quotes, history: hist, sec: Math.round((Date.now() - started) / 1000) };
    } catch (e) {
      runtime.errors.push(`обход целиком: ${e.message}`);
    } finally {
      runtime.running = false;
      runtime.errors = runtime.errors.slice(-6);
      store.save();
      log(`индексы: значений ${runtime.stats?.quotes ?? 0}, историй ${runtime.stats?.history ?? 0} за ${runtime.stats?.sec ?? 0} с`);
    }
    return runtime;
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      await runOnce().catch(() => {});
      schedule();
    }, quoteMs);
    if (timer.unref) timer.unref();
  }

  return {
    start() {
      if (!enabled) return;
      setTimeout(() => {
        runOnce().catch(() => {});
        schedule();
      }, FIRST_DELAY_MS).unref?.();
      log(`индексы: обновление значений раз в ${Math.round(quoteMs / 60_000)} мин, истории — раз в сутки`);
    },
    stop() {
      clearTimeout(timer);
      runtime.running = false;
    },
    runNow: runOnce,
    status: () => ({
      enabled,
      running: runtime.running,
      quoteMin: Math.round(quoteMs / 60_000),
      lastQuotesAt: runtime.lastQuotesAt,
      lastHeavyAt: runtime.lastHeavyAt,
      lastStats: runtime.stats,
      stored: store.size(),
      recentErrors: runtime.errors.slice(-4),
    }),
  };
}
