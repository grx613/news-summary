// Ежедневный сбор свечей по тикерам: год дневных OHLC для графика.
// Свой файл и свой крон, как у дивидендов и индексов: модель здесь не участвует,
// и новостной обход с его стоимостью тут ни при чём.

import { fetchRuCandles, fetchUsDaily, fetchCryptoIds, fetchCryptoDaily, CHART_FORMAT } from './charts.js';
import { alpacaEnabled, fetchAlpacaDaily } from './alpaca.js';

const DAY_MS = 24 * 3600_000;
const FIRST_DELAY_MS = 4 * 60_000;

// Паузы у источников разные. Мосбиржа и CNBC держат темп легко, Binance тоже,
// а CoinGecko на бесплатном тарифе считает запросы в минуту: при 1,5 с он отвечает
// 429 на каждой второй монете, при 4 с — всё равно на девятой из пятидесяти.
// Поэтому CoinGecko — только для тех монет, которых нет на Binance
const PACE_RU_MS = 150;
const PACE_US_MS = 150;
const PACE_CRYPTO_MS = 300;
const PACE_CG_MS = 5000;

// Отказ не должен блокировать тикер до следующих суток
const RETRY_FAILED_MS = 6 * 3600_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function createChartCrawler({ store, listUniverse, log = () => {}, intervalMs = DAY_MS, enabled = true, firstDelayMs = FIRST_DELAY_MS }) {
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
    const stats = { total: 0, updated: 0, skipped: 0, failed: 0, noData: 0 };

    try {
      const universe = await listUniverse();
      const items = universe.items || [];
      stats.total = items.length;

      // id монет приходят одним запросом на все: искать их по одной незачем,
      // и символ без id — это честное «истории нет», а не ошибка
      let cryptoIds = {};
      if (items.some((a) => a.market === 'CRYPTO')) {
        try {
          cryptoIds = await fetchCryptoIds();
        } catch (e) {
          runtime.errors.push(`coingecko список: ${e.message}`);
        }
      }

      // Американские акции Alpaca отдаёт пакетом: вся история одним обходом
      // вместо запроса на каждую бумагу. Бумага, которой в ответе нет, уходит
      // на CNBC и Yahoo, как и при выключенном Alpaca
      let alpaca = new Map();
      const usSymbols = items.filter((a) => a.market === 'US').map((a) => a.symbol);
      if (usSymbols.length && alpacaEnabled()) {
        try {
          alpaca = await fetchAlpacaDaily(usSymbols, { days: Number(process.env.ALPACA_HISTORY_DAYS) || 1830 });
        } catch (e) {
          runtime.errors.push(`alpaca история: ${e.message}`);
        }
      }

      for (const a of items) {
        const key = `${a.market}:${a.symbol}`;
        const rec = store.get(key);
        // Старый формат точек — повод пересобрать: иначе записи, собранные
        // до перехода на OHLC, висели бы свечами без тела ещё сутки
        // Запись с чужим источником тоже пересобирается: после подключения
        // Alpaca американские бумаги иначе ждали бы до следующих суток на CNBC
        const wantsAlpaca = a.market === 'US' && alpaca.has(a.symbol) && rec?.source !== 'alpaca';
        if (!force && !wantsAlpaca && rec && rec.format === CHART_FORMAT && age(rec) < intervalMs * 0.9) {
          stats.skipped++;
          continue;
        }
        if ((backoff.get(key) || 0) > Date.now()) {
          stats.skipped++;
          continue;
        }

        let points = [];
        let pace = PACE_RU_MS;
        let source = null;
        let pair = null;
        try {
          if (a.market === 'RU') {
            source = 'moex';
            points = await fetchRuCandles(a.symbol);
          } else if (a.market === 'US') {
            const fromAlpaca = alpaca.get(a.symbol);
            if (fromAlpaca && fromAlpaca.length >= 2) {
              source = 'alpaca';
              points = fromAlpaca;
              pace = 0;
            } else {
              pace = PACE_US_MS;
              source = 'cnbc';
              points = await fetchUsDaily(a.symbol);
            }
          } else {
            pace = PACE_CRYPTO_MS;
            // Биржа выбирается по сверке цены с CoinGecko: под одним символом
            // могут торговаться разные монеты. Пара запоминается в записи,
            // чтобы внутридневной график шёл сразу на нужную биржу
            const r = await fetchCryptoDaily(a.symbol, cryptoIds[a.symbol]);
            points = r.points;
            source = r.source;
            pair = r.pair;
            if (r.source === 'coingecko') pace = PACE_CG_MS;
          }
        } catch (e) {
          stats.failed++;
          backoff.set(key, Date.now() + RETRY_FAILED_MS);
          runtime.errors.push(`${key}: ${e.message}`);
          await sleep(pace);
          continue;
        }

        if (points.length < 2) {
          // Пустой ответ по одной бумаге не повод класть отказ в ошибки:
          // по новым бумагам истории просто нет
          stats.noData++;
          backoff.set(key, Date.now() + RETRY_FAILED_MS);
        } else {
          stats.updated++;
          store.set(key, {
            symbol: a.symbol,
            market: a.market,
            currency: a.market === 'US' || a.market === 'CRYPTO' ? 'USD' : 'RUB',
            source,
            // Пара биржи нужна внутридневному графику: по ней он идёт сразу,
            // не перебирая биржи заново на каждый показ
            pair,
            format: CHART_FORMAT,
            points,
            at: new Date().toISOString(),
          });
        }
        await sleep(pace);
      }
    } catch (e) {
      runtime.errors.push(`обход целиком: ${e.message}`);
    } finally {
      runtime.running = false;
      runtime.lastRunAt = new Date().toISOString();
      runtime.lastRunMs = Date.now() - started;
      runtime.stats = stats;
      runtime.errors = runtime.errors.slice(-6);
      store.save();
      log(
        `графики: собрано ${stats.updated} из ${stats.total}, без истории ${stats.noData}, отказов ${stats.failed} за ${Math.round(
          runtime.lastRunMs / 1000
        )} с`
      );
    }
    return runtime;
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      await runOnce().catch(() => {});
      schedule();
    }, intervalMs);
    if (timer.unref) timer.unref();
  }

  return {
    start() {
      if (!enabled) return;
      setTimeout(() => {
        runOnce().catch(() => {});
        schedule();
      }, firstDelayMs).unref?.();
      log(`графики: обновление истории раз в ${Math.round(intervalMs / 3600_000)} ч`);
    },
    stop() {
      clearTimeout(timer);
      runtime.running = false;
    },
    runNow: runOnce,
    status: () => ({
      enabled,
      running: runtime.running,
      intervalHours: Math.round(intervalMs / 3600_000),
      lastRunAt: runtime.lastRunAt,
      lastRunMs: runtime.lastRunMs,
      lastStats: runtime.stats,
      stored: store.size,
      recentErrors: runtime.errors.slice(-4),
    }),
  };
}
