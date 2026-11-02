// Ежедневный сбор дивидендов по всем тикерам.
// Отдельно от новостного крона: тот пишет cache.json и стоит денег, а здесь
// справочные данные из бесплатных источников и свой файл. Общий таймер не нужен,
// потому что пересекаться им нечем.

import { fetchRuDividends, fetchUsDividends } from './dividends.js';

const DAY_MS = 24 * 3600_000;
const FIRST_DELAY_MS = 3 * 60_000;

// Пауза между запросами: dohod и stockanalysis отвечают быстро, но 140 запросов
// подряд выглядят как краулер. Полный обход при 300 мс занимает меньше минуты.
const PACE_MS = 300;
// Отказ по тикеру не должен блокировать его до следующего суток
const RETRY_FAILED_MS = 6 * 3600_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function createDividendCrawler({ store, listUniverse, log = () => {}, intervalMs = DAY_MS, enabled = true }) {
  const runtime = {
    running: false,
    lastRunAt: null,
    lastRunMs: null,
    stats: null,
    errors: [],
  };
  const backoff = new Map();
  let timer = null;

  const age = (rec) => (rec?.at ? Date.now() - new Date(rec.at).getTime() : Infinity);

  async function runOnce({ force = false } = {}) {
    if (runtime.running) return runtime;
    runtime.running = true;
    const started = Date.now();
    const stats = { total: 0, updated: 0, skipped: 0, failed: 0, noPay: 0 };

    try {
      const universe = await listUniverse();
      const items = (universe.items || []).filter((a) => a.market === 'RU' || a.market === 'US');
      stats.total = items.length;

      for (const a of items) {
        const key = `${a.market}:${a.symbol}`;
        const rec = store.get(key);
        // Дивиденды меняются раз в квартал: суточной давности достаточно
        if (!force && rec && age(rec) < intervalMs * 0.9) {
          stats.skipped++;
          continue;
        }
        if ((backoff.get(key) || 0) > Date.now()) {
          stats.skipped++;
          continue;
        }
        try {
          const data = a.market === 'RU' ? await fetchRuDividends(a.symbol) : await fetchUsDividends(a.symbol);
          if (!data) {
            stats.failed++;
            backoff.set(key, Date.now() + RETRY_FAILED_MS);
            runtime.errors.push(`${key}: пустой ответ`);
            continue;
          }
          // «Не платит» — тоже ответ: страница должна сказать это прямо, а не молчать
          if (data.pays === false) stats.noPay++;
          else stats.updated++;
          store.set(key, { ...data, symbol: a.symbol, market: a.market, at: new Date().toISOString() });
        } catch (e) {
          stats.failed++;
          backoff.set(key, Date.now() + RETRY_FAILED_MS);
          runtime.errors.push(`${key}: ${e.message}`);
        }
        await sleep(PACE_MS);
      }
    } catch (e) {
      runtime.errors.push(`обход целиком: ${e.message}`);
    } finally {
      runtime.running = false;
      runtime.lastRunAt = new Date().toISOString();
      runtime.lastRunMs = Date.now() - started;
      runtime.stats = stats;
      runtime.errors = runtime.errors.slice(-8);
      store.save();
      const sec = Math.round(runtime.lastRunMs / 1000);
      log(
        `дивиденды: обновлено ${stats.updated}, не платят ${stats.noPay}, без данных ${stats.failed}, ` +
          `пропущено ${stats.skipped} за ${sec} с`
      );
    }
    return runtime;
  }

  function schedule(delay) {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      await runOnce().catch(() => {});
      schedule(DAY_MS);
    }, delay);
    if (timer.unref) timer.unref();
  }

  return {
    start() {
      if (!enabled) return;
      schedule(FIRST_DELAY_MS);
      log(`дивиденды: крон включён, обновление раз в ${Math.round(intervalMs / 3600_000)} ч`);
    },
    stop() {
      clearTimeout(timer);
      runtime.running = false;
    },
    runNow: runOnce,
    status: () => ({
      enabled,
      running: runtime.running,
      intervalHours: intervalMs / 3600_000,
      lastRunAt: runtime.lastRunAt,
      lastRunSec: runtime.lastRunMs ? Math.round(runtime.lastRunMs / 1000) : null,
      lastStats: runtime.stats,
      stored: store.size,
      recentErrors: runtime.errors.slice(-5),
    }),
  };
}
