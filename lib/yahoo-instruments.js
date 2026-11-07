// Запасной путь для инструментов, которые раньше жили только на CNBC.
// Akamai за CNBC блокирует целые датацентровые сети, и с этого сервера он
// отвечает 403 на свечи и котировки — без второго источника карточки индексов,
// сырья и валют оставались пустыми навсегда, а не до следующего прогона.
//
// Yahoo отдаёт те же ряды по своим тикерам. Соответствие задано в YAHOO_ALIAS:
// у CNBC фьючерс на Brent — @LCO.1, у Yahoo — BZ=F. Доходности Германии и
// Британии Yahoo не отдаёт ни под одним написанием, их берём у Мосбиржи нет
// тоже — такие инструменты помечены noHistory и честно остаются без графика,
// но с ценой из другого источника.
//
// Свеча — тот же массив [время, open, high, low, close], что и везде.

import { get } from './http.js';
import { makeCandle, aggregate, weekOf } from './charts.js';

const YAHOO_CHART = 'https://query1.finance.yahoo.com/v8/finance/chart';

// Ключ каталога -> тикер Yahoo. Пустая строка означает «Yahoo не знает»
export const YAHOO_ALIAS = {
  '.SPX': '^GSPC',
  '.IXIC': '^IXIC',
  '.DJI': '^DJI',
  '.NDX': '^NDX',
  '.VIX': '^VIX',
  '.N225': '^N225',
  '.GDAXI': '^GDAXI',
  '.HSI': '^HSI',
  '.FTSE': '^FTSE',
  // Доходности: у Yahoo своё имя у каждой серии. ^TNX — 10 лет, ^TYX — 30 лет.
  // Двухлетней здесь нет: 2YY=F оказался просроченным фьючерсом, который неделями
  // показывает одно и то же (4.78 против реальных 4.46), а ^IRX — дисконт
  // тринадцатинедельных векселей. Эта бумага живёт на FRED
  US10Y: '^TNX',
  US2Y: '',
  US30Y: '^TYX',
  DE10Y: '',
  GB10Y: '',
  '@CL.1': 'CL=F',
  '@LCO.1': 'BZ=F',
  '@NG.1': 'NG=F',
  '@HO.1': 'HO=F',
  '@RB.1': 'RB=F',
  '@GC.1': 'GC=F',
  '@SI.1': 'SI=F',
  '@HG.1': 'HG=F',
  '@PL.1': 'PL=F',
  '@PA.1': 'PA=F',
  'EUR=': 'EURUSD=X',
  'JPY=': 'JPY=X',
  'GBP=': 'GBPUSD=X',
  'CNY=': 'CNY=X',
  '.DXY': 'DX-Y.NYB',
};

export const yahooAliasOf = (code) => YAHOO_ALIAS[code] ?? '';
export const yahooHasHistory = (code) => Boolean(yahooAliasOf(code));

// Сколько дней назад Yahoo начинает ряд. Окна повторяют пресеты CNBC, чтобы
// переключение интервалов показывало ту же глубину, что и раньше
const RANGE = { '1min': '5d', '5min': '5d', '15min': '1mo', '30min': '1mo', '1h': '3mo', '1d': '1y', '1w': '5y', '1mo': '10y' };
const INTERVAL = { '1min': '1m', '5min': '5m', '15min': '15m', '30min': '30m', '1h': '60m', '1d': '1d', '1w': '1d', '1mo': '1d' };

// Дневные бары режутся на недели и месяцы здесь же: у Yahoo недельная свеча
// помечена временем открытия биржи по Нью-Йорку, и понедельник уезжал бы
// в воскресенье
export async function fetchYahooInstSeries(code, tf, { timeout = 12000 } = {}) {
  const sym = yahooAliasOf(code);
  const range = RANGE[tf];
  if (!sym || !range) return [];
  const res = await get(`${YAHOO_CHART}/${encodeURIComponent(sym)}?range=${range}&interval=${INTERVAL[tf]}`, {
    timeout,
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) return [];
  const j = await res.json().catch(() => null);
  const r = (j?.chart?.result || [])[0];
  const ts = r?.timestamp;
  const q = r?.indicators?.quote?.[0];
  if (!Array.isArray(ts) || !q) return [];

  const daily = tf === '1d' || tf === '1w' || tf === '1mo';
  // У дневных и выше нужен торговый день, а метка — открытие сессии в UTC.
  // Сдвиг биржи из meta приводит её к календарю площадки
  const off = Number(r.meta?.gmtoffset) || 0;
  const candles = [];
  ts.forEach((t, i) => {
    const key = daily ? new Date((t + off) * 1000).toISOString().slice(0, 10) : t;
    const c = makeCandle(key, q.open?.[i], q.high?.[i], q.low?.[i], q.close?.[i]);
    if (c) candles.push(c);
  });
  candles.sort((a, b) => (daily ? a[0].localeCompare(b[0]) : a[0] - b[0]));
  if (tf === '1w') return aggregate(candles, weekOf);
  if (tf === '1mo') return aggregate(candles, (d) => String(d).slice(0, 7));
  return candles;
}

// Живая цена одним запросом: значение, изменение к прошлому закрытию и OHLC дня
export async function fetchYahooInstQuote(code, { timeout = 10000 } = {}) {
  const sym = yahooAliasOf(code);
  if (!sym) return null;
  const res = await get(`${YAHOO_CHART}/${encodeURIComponent(sym)}?range=1d&interval=1d`, {
    timeout,
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) return null;
  const j = await res.json().catch(() => null);
  const r = (j?.chart?.result || [])[0];
  const m = r?.meta;
  const num = (v) => (v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);
  const value = num(m?.regularMarketPrice);
  if (value === null) return null;
  const q = r?.indicators?.quote?.[0] || {};
  const last = (a) => (Array.isArray(a) ? a.filter((x) => x !== null && x !== undefined).at(-1) : null);
  const prev = num(m?.chartPreviousClose) ?? num(m?.previousClose);
  return {
    code,
    value,
    change: prev === null ? null : Math.round((value - prev) * 100) / 100,
    changePct: prev ? Math.round(((value - prev) / prev) * 10000) / 100 : null,
    prevClose: prev,
    open: num(last(q.open)) ?? num(m?.regularMarketOpen),
    high: num(last(q.high)) ?? num(m?.regularMarketDayHigh),
    low: num(last(q.low)) ?? num(m?.regularMarketDayLow),
    at: m?.regularMarketTime ? new Date(m.regularMarketTime * 1000).toISOString() : null,
    source: 'yahoo',
  };
}
