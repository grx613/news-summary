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
const YAHOO_CHART = 'https://query1.finance.yahoo.com/v8/finance/chart';

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
      'Основной индикатор российского рынка акций: Мосбиржа считает его по наиболее ликвидным бумагам основных торгов, вес компании — по капитализации с поправкой на free-float. Дивиденды в значение не входят: за полную доходность с реинвестированием выплат отвечает отдельный индекс — MCFTR. Значение 2 400–2 600 пунктов соответствует рынку 2024–2026 годов.',
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
      'Индекс российских гособлигаций: считается по ценам наиболее ликвидных выпусков ОФЗ, купоны в него не входят (за доходность с реинвестированием отвечает отдельно RGBITR). Растёт, когда ОФЗ дорожают, то есть когда ставки и инфляционные ожидания снижаются. Часто движется раньше акций, поэтому за ним смотрят как за опережающим индикатором.',
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
      // Открытие нужно для сегодняшней свечи на графике: в историю текущий день
      // не попадает, а без open свеча выродилась бы в горизонтальную черту
      open: row[mi('OPENVALUE')],
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
// поэтому год приходится собирать курсором. Окно — ровно год: при 250 днях
// ряд обрывался на восьмом месяце, а страница обещает динамику за год
export async function fetchMoexHistory(code, { days = 365, timeout = 20000 } = {}) {
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
    // Мосбиржа отдаёт и OPEN, и HIGH, и LOW — значит, историю можно рисовать
    // свечами, а не ломаной по одним закрытиям. У самых ранних строк открытия
    // нет: там свеча вырождается в закрытие, это честнее пропуска
    const oi = h.columns.indexOf('OPEN');
    const hi = h.columns.indexOf('HIGH');
    const li = h.columns.indexOf('LOW');
    for (const row of h.data) {
      if (row[ci] === null) continue;
      points.push({
        d: row[di],
        c: row[ci],
        o: oi >= 0 ? row[oi] : null,
        h: hi >= 0 ? row[hi] : null,
        l: li >= 0 ? row[li] : null,
      });
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

// ---------------------------------------------------------------- Yahoo (запасной)
// CNBC отдаёт всё одним запросом и потому остаётся основным источником, но
// Akamai, за которым он стоит, блокирует целые датацентровые сети: с хостинга
// в Hetzner quote.cnbc.com и ts-api.cnbc.com отвечают 403 на любой запрос.
// Тогда индексы и котировки США просто исчезали со страниц. Yahoo закрывает
// эту дыру: у него v8/chart отдаёт и цену, и предыдущее закрытие, и OHLC дня.
// v7/finance/quote (пакетный) закрыт для неавторизованных, поэтому символы
// спрашиваются по одному, но параллельно.
const YAHOO_SYMBOL = {
  '.SPX': '%5EGSPC',
  '.IXIC': '%5EIXIC',
  '.DJI': '%5EDJI',
  '.VIX': '%5EVIX',
};

const yahooSymbol = (code) => YAHOO_SYMBOL[code] || code;

export async function fetchYahooQuote(code, { timeout = 12000 } = {}) {
  // yahooSymbol отдаёт готовый %5E-код, повторно кодировать нельзя
  const res = await get(`${YAHOO_CHART}/${yahooSymbol(code)}?range=1d&interval=1d`, {
    timeout,
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) return null;
  const json = await res.json().catch(() => null);
  const r = (json?.chart?.result || [])[0];
  const m = r?.meta;
  const value = num(m?.regularMarketPrice);
  if (value === null) return null;

  const q = r?.indicators?.quote?.[0] || {};
  const last = (arr) => (Array.isArray(arr) ? arr.filter((x) => x !== null && x !== undefined).at(-1) : null);
  const prev = num(m?.chartPreviousClose) ?? num(m?.previousClose);
  const open = num(last(q.open)) ?? num(m?.regularMarketOpen);
  const high = num(last(q.high)) ?? num(m?.regularMarketDayHigh);
  const low = num(last(q.low)) ?? num(m?.regularMarketDayLow);

  return {
    code,
    name: code,
    value,
    // change и changePct считаем сами: Yahoo не отдаёт готовое изменение за день
    change: prev === null ? null : Math.round((value - prev) * 100) / 100,
    changePct: prev ? Math.round(((value - prev) / prev) * 10000) / 100 : null,
    prevClose: prev,
    open,
    high,
    low,
    yearHigh: null,
    yearLow: null,
    at: m?.regularMarketTime ? new Date(m.regularMarketTime * 1000).toISOString() : null,
    marketStatus: null,
    source: 'yahoo',
    currency: 'USD',
  };
}

// Кэш на минуту. В реалтайме цикл идёт раз в пять секунд, а Yahoo не умеет
// пакетный запрос: без кэша это были бы 115 запросов каждые пять секунд —
// верный 429 через полчаса. Минута для запасного источника приемлема:
// страница всё равно печатает время котировки из поля at
const YAHOO_TTL_MS = 60_000;
const yahooCache = new Map(); // code -> { at, quote }

export async function fetchYahooQuotes(codes, { timeout = 12000, ttlMs = YAHOO_TTL_MS } = {}) {
  const now = Date.now();
  const out = {};
  const stale = [];
  for (const c of codes) {
    const hit = yahooCache.get(c);
    if (hit && now - hit.at < ttlMs) out[c] = hit.quote;
    else stale.push(c);
  }
  if (stale.length) {
    const got = await Promise.all(stale.map((c) => fetchYahooQuote(c, { timeout }).catch(() => null)));
    for (const q of got) {
      if (!q) continue;
      yahooCache.set(q.code, { at: now, quote: q });
      out[q.code] = q;
    }
  }
  return out;
}

// compact — режим для реалтайма: ответ вдвое меньше (fund=0&events=0), и
// возвращаются только цена, процент и OHLC дня. Описание, статус рынка и
// годовые экстремумы на странице уже есть из дневного файла, а повторять их
// каждые пять секунд — тратить трафик на неизменное
export async function fetchCnbcQuotes(codes, { timeout = 20000, compact = false } = {}) {
  const symbols = codes.map((c) => encodeURIComponent(c)).join('%7C');
  const url = `${CNBC_QUOTE}?symbols=${symbols}&requestMethod=itv&noform=1&partnerId=2&fund=${
    compact ? 0 : 1
  }&exthrs=0&output=json&events=${compact ? 0 : 1}`;
  const res = await get(url, { timeout, headers: { Accept: 'application/json' } });
  // CNBC закрыт для датацентровых сетей (403 от Akamai) — тогда идём в Yahoo,
  // иначе котировки США и индексы молча пропадали бы со страницы
  if (!res.ok) return fetchYahooQuotes(codes, { timeout });
  const json = await res.json().catch(() => null);
  const full = parseCnbc(json);
  if (!Object.keys(full).length) return fetchYahooQuotes(codes, { timeout });
  if (!compact) return full;
  const out = {};
  for (const [sym, q] of Object.entries(full)) {
    out[sym] = {
      price: q.value,
      pct: q.changePct,
      // change — готовое абсолютное изменение за день, как у Мосбиржи
      change: q.change,
      prev: q.prevClose,
      open: q.open,
      high: q.high,
      low: q.low,
      time: q.at,
    };
  }
  return out;
}

export async function fetchYahooHistory(code, { timeout = 20000, range = '1y' } = {}) {
  const res = await get(`${YAHOO_CHART}/${yahooSymbol(code)}?range=${range}&interval=1d`, {
    timeout,
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) return [];
  const json = await res.json().catch(() => null);
  const r = (json?.chart?.result || [])[0];
  if (!r) return [];
  const ts = r.timestamp || [];
  const q = r.indicators?.quote?.[0] || {};
  const out = [];
  for (let i = 0; i < ts.length; i++) {
    const c = num(q.close?.[i]);
    if (c === null) continue;
    const o = num(q.open?.[i]);
    const h = num(q.high?.[i]);
    const l = num(q.low?.[i]);
    // Дневная точка истории — {d, c, o, h, l}, ровно как у Мосбиржи.
    // Дыры в OHLC заменяем закрытием: свеча без тела лучше отсутствующей
    out.push({
      d: new Date(ts[i] * 1000).toISOString().slice(0, 10),
      c,
      o: o === null ? c : o,
      h: h === null ? c : h,
      l: l === null ? c : l,
    });
  }
  return out.sort((a, b) => a.d.localeCompare(b.d));
}

export async function fetchCnbcHistory(code, { timeout = 20000 } = {}) {
  const res = await get(`${CNBC_CHART}/1Y.json?symbol=${encodeURIComponent(code)}&interval=1D`, {
    timeout,
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) return fetchYahooHistory(code, { timeout });
  const json = await res.json().catch(() => null);
  const bars = json?.barData?.priceBars;
  if (!Array.isArray(bars)) return fetchYahooHistory(code, { timeout });
  return bars
    .map((b) => {
      const t = String(b.tradeTime || '');
      const m = t.match(/^(\d{4})(\d{2})(\d{2})/);
      // CNBC отдаёт полный OHLC, и он нужен: без него график индекса остаётся
      // ломаной по закрытиям, тогда как у любого тикера на сайте — свечи
      return m ? { d: `${m[1]}-${m[2]}-${m[3]}`, c: num(b.close), o: num(b.open), h: num(b.high), l: num(b.low) } : null;
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
