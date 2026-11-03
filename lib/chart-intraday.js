// Внутридневные свечи по запросу: минутный ряд по 206 тикерам в файле не хранится.
// Час минуток — это ~500 свечей на бумагу; на круг вышло бы 150 тысяч свечей,
// которые всё равно устаревают к следующему показу. Поэтому здесь кеш в памяти
// с коротким сроком: минутная свеча живёт 45 секунд, остальные два минуты.

import {
  TIMEFRAMES,
  fetchMoexSeries,
  fetchYahooSeries,
  fetchCnbcIntraday,
  fetchExchangeSeries,
  normalizePoints,
  aggregate,
  weekOf,
} from './charts.js';

// Часовой пояс нужен подписи оси: «09:47» без зоны у бумаги Мосбиржи и у AAPL
// означает разное время, и читать график, не зная зоны, невозможно
export const MARKET_TZ = { RU: 'Europe/Moscow', US: 'America/New_York', CRYPTO: 'UTC' };
export const TZ_LABEL = { RU: 'мск', US: 'NYSE', CRYPTO: 'UTC' };

const TTL_MS = { '1min': 45_000, '5min': 90_000, '10min': 90_000, '15min': 120_000, '30min': 120_000, '1h': 120_000 };

// Сколько свечей просить у источника: по ширине графика различимо ~120,
// остальное нужно для склейки и для подсчёта экстремумов
const LIMIT = { '1min': 400, '5min': 400, '10min': 400, '15min': 400, '30min': 400, '1h': 400 };

const MAX_ENTRIES = 400;

const dayOfEpoch = (s) => new Date(s * 1000).toISOString().slice(0, 10);

// Месяц склеивается по календарю, а не по 30 дням: иначе границы «месяцев»
// разъезжаются с теми, что человек видит в календаре
const monthOf = (day) => day.slice(0, 7);

export function createChartSeries({ store, log = () => {} } = {}) {
  const cache = new Map();
  const inflight = new Map();

  const ttl = (tf) => TTL_MS[tf] ?? 120_000;

  function remember(key, value) {
    if (cache.size >= MAX_ENTRIES) {
      // Map хранит порядок вставки: самая старая запись уходит первой
      const oldest = cache.keys().next().value;
      cache.delete(oldest);
    }
    cache.set(key, { value, at: Date.now() });
  }

  // Последнее дневное закрытие из файла — доверенная цена бумаги. По ней
  // проверяется пара биржи: внутридневные свечи с чужой пары рисовали бы
  // другой актив, не тратя на сверку ни одного лишнего запроса
  function referencePrice(rec) {
    const pts = rec?.points || [];
    for (let i = pts.length - 1; i >= 0; i--) {
      const c = Number(pts[i]?.[pts[i].length >= 5 ? 4 : 1]);
      if (Number.isFinite(c) && c > 0) return c;
    }
    return null;
  }

  async function fromStore(rec, tf) {
    // Записи, собранные до перехода на OHLC, лежат парами [дата, закрытие]:
    // normalizePoints достраивает из них свечу без тела, чтобы график
    // не пропал до первого планового обхода
    const points = normalizePoints(rec?.points || []);
    if (!points.length) return [];
    if (tf === '1d') return points;
    if (tf === '1w') return aggregate(points, (d) => weekOf(d));
    if (tf === '1mo') return aggregate(points, monthOf);
    return [];
  }

  async function fromNetwork(asset, rec, tf) {
    const market = asset.market;
    if (market === 'RU') {
      const out = await fetchMoexSeries(asset.symbol, tf);
      return { candles: out, source: 'moex', tz: MARKET_TZ.RU };
    }

    if (market === 'US') {
      const yahoo = await fetchYahooSeries(asset.symbol, tf);
      if (yahoo.candles.length >= 2) {
        return { candles: yahoo.candles, source: 'yahoo', tz: yahoo.tz || MARKET_TZ.US };
      }
      // Yahoo ответил отказом — CNBC знает минутки и пятиминутки, но других интервалов у него нет
      const cnbc = await fetchCnbcIntraday(asset.symbol, tf);
      return { candles: cnbc, source: 'cnbc', tz: MARKET_TZ.US };
    }

    // Крипта: пара записана при суточном сборе. Если её нет (монета шла через
    // CoinGecko), перебираем биржи, сверяя последнюю цену с дневным закрытием
    const ref = referencePrice(rec);
    const pairs = [];
    if (rec?.pair) pairs.push([rec.source, rec.pair]);
    for (const [ex, pair] of [
      ['binance', `${asset.symbol}USDT`],
      ['mexc', `${asset.symbol}USDT`],
      ['gate', `${asset.symbol}_USDT`],
    ]) {
      if (!pairs.some(([e, p]) => e === ex && p === pair)) pairs.push([ex, pair]);
    }

    for (const [ex, pair] of pairs) {
      if (!ex) continue;
      const candles = await fetchExchangeSeries(ex, pair, tf, { limit: LIMIT[tf] || 300 });
      if (candles.length < 2) continue;
      const last = candles[candles.length - 1][4];
      const ok = ref ? Math.abs(last - ref) / ref < 0.2 : true;
      if (ok) return { candles, source: ex, tz: MARKET_TZ.CRYPTO, pair };
    }
    return { candles: [], source: null, tz: MARKET_TZ.CRYPTO };
  }

  // force — только для проверки вручную: страница не должна обходить кеш
  async function get(asset, rec, tf, { force = false } = {}) {
    const meta = TIMEFRAMES[tf];
    if (!meta) return { candles: [], tz: MARKET_TZ[asset.market] || 'UTC', source: null, fetchedAt: null };

    // День, неделя и месяц собираются из файла: сеть для них не нужна вовсе
    if (meta.daily) {
      const candles = await fromStore(rec, tf);
      return { candles, tz: 'UTC', source: rec?.source || null, fetchedAt: rec?.at || null, fromStore: true };
    }

    const key = `${asset.market}:${asset.symbol}:${tf}`;
    const hit = cache.get(key);
    if (!force && hit && Date.now() - hit.at < ttl(tf)) {
      return { ...hit.value, stale: false, fetchedAt: new Date(hit.at).toISOString() };
    }

    // Параллельные показы одной бумаги не должны тянуть ряд дважды:
    // второй посетитель ждёт тот же промис
    if (inflight.has(key)) return inflight.get(key);

    const task = (async () => {
      try {
        const r = await fromNetwork(asset, rec, tf);
        const value = { candles: r.candles, source: r.source, tz: r.tz, pair: r.pair || null };
        // Пустой ответ не кешируем надолго: биржа могла просто не ответить
        if (value.candles.length >= 2) remember(key, value);
        return { ...value, stale: false, fetchedAt: new Date().toISOString() };
      } catch (e) {
        log(`графики: ${key} — ${e.message}`);
        // Отказ источника не должен оставлять человека без графика:
        // отдаём просроченный ряд, если он есть
        if (hit) return { ...hit.value, stale: true, fetchedAt: new Date(hit.at).toISOString() };
        return { candles: [], tz: MARKET_TZ[asset.market] || 'UTC', source: null, stale: true, fetchedAt: null };
      } finally {
        inflight.delete(key);
      }
    })();

    inflight.set(key, task);
    return task;
  }

  return { get, size: () => cache.size };
}

// Подпись времени на оси: дата у дневных и выше, время у внутридневных
export function stampFormatter(tz, tf) {
  const daily = TIMEFRAMES[tf]?.daily;
  const fmt = new Intl.DateTimeFormat('ru-RU', {
    timeZone: tz || 'UTC',
    day: 'numeric',
    month: 'short',
    ...(daily ? { year: 'numeric' } : { hour: '2-digit', minute: '2-digit' }),
  });
  return (t) => {
    const d = typeof t === 'number' ? new Date(t * 1000) : new Date(`${t}T00:00:00Z`);
    return Number.isNaN(d.getTime()) ? '—' : fmt.format(d);
  };
}

export { dayOfEpoch };
