// Биржевые индексы: значение, изменение, история и состав.
// Данные бесплатные и без модели, поэтому живут своим файлом и своим таймером,
// как дивиденды, а не в cache.json с новостными сводками.
//
// Российские индексы берём у Мосбиржи: ISS отдаёт и значение с капитализацией,
// и официальные веса бумаг в индексе. Американские — у CNBC: один запрос на все
// четыре, вместе с предыдущим закрытием и годовым диапазоном. Yahoo для этого
// не годится — он отвечает 429 после нескольких запросов подряд, а индексы надо
// обновлять часто, чтобы значение на странице не врало.

import fs from 'node:fs';
import path from 'node:path';
import { get } from './http.js';
import { cleanRuName, RU_ALIASES } from './universe.js';

const MOEX_SEC = 'https://iss.moex.com/iss/engines/stock/markets/index/securities.json';
const MOEX_HIST = 'https://iss.moex.com/iss/history/engines/stock/markets/index/securities';
const MOEX_COMP = 'https://iss.moex.com/iss/statistics/engines/stock/markets/index/analytics';
const CNBC_QUOTE = 'https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol';
const CNBC_CHART = 'https://ts-api.cnbc.com/harmony/app/charts';

// Описание — не украшение: страница должна объяснять, что это за индекс,
// иначе она состоит из одних цифр и поисковику нечего индексировать
export const INDEXES = [
  {
    slug: 'imoex',
    short: 'Мосбиржа',
    code: 'IMOEX',
    source: 'moex',
    sourceCode: 'IMOEX',
    market: 'RU',
    title: 'Индекс Мосбиржи',
    h1: 'Индекс Мосбиржи (IMOEX)',
    what:
      'Основной индикатор российского рынка акций: рассчитывается Мосбиржей как индекс полной доходности по наиболее ликвидным бумагам, которые торгуются в режиме основных торгов. Значение 2 400–2 600 пунктов соответствует рынку 2024–2026 годов.',
    lead: 'значение, изменение за день, годовой диапазон и состав с весами бумаг',
  },
  {
    slug: 'rts',
    short: 'РТС',
    source: 'moex',
    sourceCode: 'RTSI',
    code: 'RTSI',
    market: 'RU',
    title: 'Индекс РТС',
    h1: 'Индекс РТС (RTSI)',
    what:
      'Долларовый индекс российского рынка: те же бумаги, что и в индексе Мосбиржи, но номинированные в долларах. Поэтому РТС падает не только когда дешевеют акции, но и когда слабеет рубль — расхождение двух индексов показывает вклад курса.',
    lead: 'значение, изменение и сравнение с индексом Мосбиржи',
  },
  {
    slug: 'moexbc',
    short: 'Голубые фишки',
    source: 'moex',
    sourceCode: 'MOEXBC',
    code: 'MOEXBC',
    market: 'RU',
    title: 'Индекс голубых фишек',
    h1: 'Индекс голубых фишек (MOEXBC)',
    what:
      'Индекс 15 самых ликвидных и капитализированных российских компаний. Служит ориентиром для крупных инвесторов: если он расходится с широким рынком, значит движение делают тяжёлые бумаги, а не весь рынок.',
    lead: 'значение, состав и веса бумаг',
  },
  {
    slug: 'rgbia',
    short: 'ОФЗ (RGBI)',
    source: 'moex',
    sourceCode: 'RGBI',
    code: 'RGBI',
    market: 'RU',
    title: 'Индекс гособлигаций RGBI',
    h1: 'Индекс гособлигаций (RGBI)',
    what:
      'Индекс доходности российских государственных облигаций: растёт, когда ОФЗ дорожают, то есть когда ставки и инфляционные ожидания снижаются. Часто движется раньше акций, поэтому за ним смотрят как за опережающим индикатором.',
    lead: 'значение, изменение и состав выпусков ОФЗ',
  },
  {
    slug: 'sp500',
    short: 'S&P 500',
    source: 'cnbc',
    sourceCode: '.SPX',
    code: 'SP500',
    market: 'US',
    title: 'Индекс S&P 500',
    h1: 'Индекс S&P 500 (SPX)',
    what:
      'Главный индекс американского рынка: 500 крупнейших публичных компаний США, взвешенных по капитализации. На него ориентируются большинство фондов и он же служит базой для одноимённых ETF.',
    lead: 'значение, изменение за день и годовой диапазон',
  },
  {
    slug: 'nasdaq',
    short: 'NASDAQ',
    source: 'cnbc',
    sourceCode: '.IXIC',
    code: 'NASDAQ',
    market: 'US',
    title: 'Индекс NASDAQ Composite',
    h1: 'Индекс NASDAQ Composite (IXIC)',
    what:
      'Индекс всех компаний, торгующихся на бирже NASDAQ — около трёх тысяч бумаг с сильным перекосом в технологический сектор. Поэтому он заметно волатильнее S&P 500 и сильнее реагирует на новости крупных IT-компаний.',
    lead: 'значение, изменение за день и годовой диапазон',
  },
  {
    slug: 'dowjones',
    short: 'Доу Джонс',
    source: 'cnbc',
    sourceCode: '.DJI',
    code: 'DOW',
    market: 'US',
    title: 'Промышленный индекс Доу Джонса',
    h1: 'Промышленный индекс Доу Джонса (DJI)',
    what:
      'Старейший индекс США: 30 крупных компаний, взвешенных не по капитализации, а по цене акции. Из-за этого бумага за 500 долларов влияет на индекс сильнее, чем компания вдвое дороже по капитализации, — это отличие от S&P 500.',
    lead: 'значение, изменение за день и годовой диапазон',
  },
  {
    slug: 'vix',
    short: 'VIX',
    source: 'cnbc',
    sourceCode: '.VIX',
    code: 'VIX',
    market: 'US',
    title: 'Индекс волатильности VIX',
    h1: 'Индекс волатильности VIX',
    what:
      'Показатель ожидаемой волатильности S&P 500 на ближайший месяц — его считают по ценам опционов. Чем выше значение, тем сильнее рынок ждёт колебаний: 10–15 — спокойный рынок, выше 25 — напряжённость, выше 40 — кризисные эпизоды, как в марте 2020 года.',
    lead: 'значение, изменение и исторические уровни',
    noCap: true,
  },
];

export const bySlug = (slug) => INDEXES.find((i) => i.slug === String(slug || '').toLowerCase()) || null;

const num = (raw) => {
  const s = String(raw ?? '').replace(/[\s,$%+]/g, '').replace(',', '.');
  if (!s || !/\d/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

// ---------------------------------------------------------------- разбор Мосбиржи
export function parseMoex(json) {
  const sec = json?.securities;
  const md = json?.marketdata;
  if (!sec || !md) return {};
  const si = (name) => sec.columns.indexOf(name);
  const mi = (name) => md.columns.indexOf(name);

  const names = new Map();
  for (const row of sec.data || []) {
    names.set(row[si('SECID')], String(row[si('SHORTNAME')] || row[si('SECID')] || '').trim());
  }

  const out = {};
  for (const row of md.data || []) {
    const code = row[mi('SECID')];
    const value = row[mi('CURRENTVALUE')] ?? row[mi('LASTVALUE')];
    if (value === null || value === undefined) continue;
    out[code] = {
      code,
      name: names.get(code) || code,
      value,
      change: row[mi('LASTCHANGE')],
      changePct: row[mi('LASTCHANGEPRC')],
      high: row[mi('HIGH')],
      low: row[mi('LOW')],
      capitalization: row[mi('CAPITALIZATION')] || null,
      tradeDate: row[mi('TRADEDATE')] || null,
      updateTime: row[mi('UPDATETIME')] || null,
      monthChangePct: row[mi('MONTHCHANGEPRC')],
      yearChangePct: row[mi('YEARCHANGEPRC')],
      source: 'moex',
      currency: 'RUB',
    };
  }
  return out;
}

// История Мосбиржи приходит страницами по 100 записей и только вперёд,
// поэтому год приходится собирать курсором
export async function fetchMoexHistory(code, { days = 250, timeout = 20000 } = {}) {
  const till = new Date();
  const from = new Date(Date.now() - days * 86400_000);
  const iso = (d) => d.toISOString().slice(0, 10);
  const points = [];
  let start = 0;

  for (let page = 0; page < 6; page++) {
    const url = `${MOEX_HIST}/${encodeURIComponent(code)}.json?iss.meta=off&from=${iso(from)}&till=${iso(
      till
    )}&start=${start}`;
    const res = await get(url, { timeout });
    if (!res.ok) break;
    const json = await res.json().catch(() => null);
    const h = json?.history;
    if (!h || !h.data?.length) break;
    const di = h.columns.indexOf('TRADEDATE');
    const ci = h.columns.indexOf('CLOSE');
    for (const row of h.data) {
      if (row[ci] === null) continue;
      points.push({ d: row[di], c: row[ci] });
    }
    if (h.data.length < 100) break;
    start += h.data.length;
  }
  return points.sort((a, b) => a.d.localeCompare(b.d));
}

// Состав с весами: официальные данные биржи, ссылки на наши же страницы тикеров
export async function fetchMoexComposition(code, { timeout = 20000 } = {}) {
  const res = await get(`${MOEX_COMP}/${encodeURIComponent(code)}.json?iss.meta=off&limit=100`, { timeout });
  if (!res.ok) return [];
  const json = await res.json().catch(() => null);
  const key = Object.keys(json || {}).find((k) => !k.includes('.'));
  const t = key ? json[key] : null;
  if (!t?.data?.length) return [];
  const wi = t.columns.indexOf('weight');
  const ti = t.columns.indexOf('ticker');
  const ni = t.columns.indexOf('shortnames');
  return t.data
    // Названия в составе сокращены биржей до нечитаемого: «ГАЗПРОМ ао», «Татнфт 3ао».
    // Чистим их теми же правилами, что и каталог, — иначе страница выглядит черновиком
    .map((row) => ({
      symbol: row[ti],
      name: RU_ALIASES[row[ti]] || cleanRuName(row[ni] || row[ti] || ''),
      weight: row[wi],
    }))
    .filter((x) => x.symbol && x.weight !== null)
    .sort((a, b) => b.weight - a.weight);
}

// ---------------------------------------------------------------- разбор CNBC
export function parseCnbc(json) {
  const list = json?.FormattedQuoteResult?.FormattedQuote;
  if (!Array.isArray(list)) return {};
  const out = {};
  for (const q of list) {
    const value = num(q.last);
    if (value === null) continue;
    out[q.symbol] = {
      code: q.symbol,
      name: q.name || q.shortName || q.symbol,
      value,
      change: num(q.change),
      changePct: num(q.change_pct),
      prevClose: num(q.previous_day_closing),
      open: num(q.open),
      high: num(q.high),
      low: num(q.low),
      yearHigh: num(q.yrhiprice),
      yearLow: num(q.yrloprice),
      at: q.last_time || null,
      marketStatus: q.curmktstatus || null,
      source: 'cnbc',
      currency: 'USD',
    };
  }
  return out;
}

export async function fetchCnbcQuotes(codes, { timeout = 20000 } = {}) {
  const symbols = codes.map((c) => encodeURIComponent(c)).join('%7C');
  const url = `${CNBC_QUOTE}?symbols=${symbols}&requestMethod=itv&noform=1&partnerId=2&fund=1&exthrs=0&output=json&events=1`;
  const res = await get(url, { timeout, headers: { Accept: 'application/json' } });
  if (!res.ok) return {};
  const json = await res.json().catch(() => null);
  return parseCnbc(json);
}

export async function fetchCnbcHistory(code, { timeout = 20000 } = {}) {
  const res = await get(`${CNBC_CHART}/1Y.json?symbol=${encodeURIComponent(code)}&interval=1D`, {
    timeout,
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) return [];
  const json = await res.json().catch(() => null);
  const bars = json?.barData?.priceBars;
  if (!Array.isArray(bars)) return [];
  return bars
    .map((b) => {
      const t = String(b.tradeTime || '');
      const m = t.match(/^(\d{4})(\d{2})(\d{2})/);
      return m ? { d: `${m[1]}-${m[2]}-${m[3]}`, c: num(b.close) } : null;
    })
    .filter((p) => p && p.c !== null)
    .sort((a, b) => a.d.localeCompare(b.d));
}

// ---------------------------------------------------------------- хранение
// Значения нужны свежие, поэтому опрос идёт часто, а история и состав меняются
// раз в сутки — их незачем тянуть каждые пятнадцать минут
export function createIndexStore(file, { log = () => {} } = {}) {
  let state = { quotesAt: null, historyAt: null, quotes: {}, history: {}, composition: {} };

  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (raw && typeof raw === 'object') {
      state = {
        quotesAt: raw.quotesAt || null,
        historyAt: raw.historyAt || null,
        quotes: raw.quotes || {},
        history: raw.history || {},
        composition: raw.composition || {},
      };
    }
  } catch {
    /* первый запуск */
  }

  let saveTimer = null;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        // Каталог данных может ещё не существовать: на чистом DATA_DIR сервер
        // создаёт его позже, чем проходит первый проход крона
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, JSON.stringify(state));
      } catch (e) {
        log(`индексы: не удалось записать файл — ${e.message}`);
      }
    }, 100);
  }

  return {
    quote: (code) => state.quotes[code] || null,
    all: () => state.quotes,
    allHistory: () => state.history,
    history: (code) => state.history[code] || [],
    composition: (code) => state.composition[code] || [],
    setQuotes(next) {
      state.quotes = { ...state.quotes, ...next };
      state.quotesAt = new Date().toISOString();
      save();
    },
    setHistory(code, points) {
      state.history[code] = points;
      state.historyAt = new Date().toISOString();
      save();
    },
    setComposition(code, rows) {
      state.composition[code] = rows;
      save();
    },
    quotesAt: () => state.quotesAt,
    historyAt: () => state.historyAt,
    size: () => Object.keys(state.quotes).length,
    save,
  };
}
