// Реалтайм-котировки: цена и изменение за день, обновляемые каждые несколько
// секунд, а не раз в сутки вместе с дневным файлом.
//
// Опрос идёт на сервере, а не в браузере. Источники надо дёргать одним пакетом
// на весь рынок: иначе сто пятнадцать карточек — это сто пятнадцать запросов
// на каждого посетителя, а Мосбиржа и CNBC такого не любят. Здесь один таймер,
// одно обращение за цикл, результат в памяти; страница забирает готовое.
//
// Почему не раз в секунду. CNBC обновляет цифры рывками примерно раз в пять
// секунд: её Cache-Control скачет от max-age=5 к max-age=0, а last_time в трёх
// запросах подряд приходит одинаковый. Опрос каждую секунду приносил бы те же
// значения четыре раза из пяти. QUOTE_MS достаточно уменьшить, когда источник
// начнёт отдавать чаще, — код к этому готов, но данные быстрее не станут.
//
// Ключ — MARKET:SYMBOL, как в cache.json и в дневном файле графиков: страница
// ищет цену по тому же ключу, по которому нашла бы сводку.

import { get } from './http.js';
import { INDEXES, fetchCnbcQuotes, fetchYahooQuotes } from './indices.js';
import { alpacaEnabled, fetchAlpacaSnapshots } from './alpaca.js';

const QUOTE_MS = 5_000;
// За сутки бумага может сходить на 20–30%, крипта — больше. Порог выбран так,
// чтобы ловить подмену монеты (там разница в разы), а не настоящий обвал
const REF_TOLERANCE = 0.5;
const IDLE_AFTER_MS = 5 * 60_000;
const IDLE_EVERY_MS = 60_000;

const MOEX_SHARES = 'https://iss.moex.com/iss/engines/stock/markets/shares/boards/TQBR/securities.json';
const MOEX_INDEX = 'https://iss.moex.com/iss/engines/stock/markets/index/securities.json';
const BINANCE = 'https://api.binance.com/api/v3/ticker/24hr';
const MEXC = 'https://api.mexc.com/api/v3/ticker/24hr';
const GATE = 'https://api.gateio.ws/api/v4/spot/tickers';

// Number(null) — это 0, а пустая цена нулём быть не может
const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// Мосбиржа пишет в UPDATETIME только «19:00:06» — дату надо взять из SYSTIME
// или из сегодняшнего дня. Без этого подпись на странице показывала бы время
// нашего опроса вместо времени последней сделки
function moexAt(row, iTime, iSys) {
  const t = iTime >= 0 ? String(row[iTime] || '') : '';
  if (!t) return undefined;
  const sys = iSys >= 0 ? String(row[iSys] || '').slice(0, 10) : '';
  const day = sys || new Date().toISOString().slice(0, 10);
  return `${day}T${t}+03:00`;
}

export function createRealtime({ log = () => {}, enabled = true, intervalMs = QUOTE_MS } = {}) {
  const quotes = new Map();
  const runtime = { running: false, lastAt: null, lastMs: null, lastCount: 0, errors: [] };

  let timer = null;
  let uni = { items: [] };
  // Биржа и пара для каждой монеты берутся из дневного файла графиков, а не
  // угадываются по символу. Пара с правильным именем может торговать другой
  // монетой: XMRUSDT на Binance стоит $118, настоящий Monero — $610. Крон
  // графиков уже сверил каждую пару с CoinGecko и записал ту, что прошла
  // проверку; монеты, у которых такой пары нет (источник — сам CoinGecko),
  // в реалтайм не попадают вовсе — честнее показать дневную цену, чем чужую
  let routes = { binance: [], mexc: [], gate: [] };
  // Дневное закрытие — вторая страховка: живая цена, отличающаяся от него
  // больше чем на REF_TOLERANCE, отбрасывается. Пара могла смениться на бирже
  // уже после того, как крон её проверил
  let refClose = new Map();
  // Кого опрашивать по акциям. Вселенной мало: в ней нет бумаг, которые уже
  // лежат в кеше, но не попали в сегодняшний список — предпочтительных акций
  // Сбера, например. Таблица капитализации их показывает, и строка с ценой
  // вчерашнего закрытия рядом с живыми выглядела бы поломкой. Дневной файл
  // графиков — ровно то, что реально рисуется на страницах
  let chartSymbols = { RU: new Set(), US: new Set() };
  const shareSymbols = (market) => {
    const out = new Set(chartSymbols[market] || []);
    for (const a of uni.items) if (a.market === market) out.add(a.symbol);
    return out;
  };
  // История индексов Мосбиржи: из неё берётся закрытие прошлого дня
  let indexHistory = {};
  const prevCloseOf = (code, tradeDate) => {
    const pts = indexHistory[code];
    if (!Array.isArray(pts) || !pts.length) return null;
    const day = String(tradeDate || '').slice(0, 10);
    // Последняя точка раньше сегодняшнего торгового дня: если история уже
    // успела записать сегодняшнее закрытие, сравнивать с ним нельзя
    for (let i = pts.length - 1; i >= 0; i--) {
      if (!day || String(pts[i].d) < day) return num(pts[i].c);
    }
    return null;
  };

  function put(key, price, pct, extra = {}) {
    if (price === null || !Number.isFinite(price) || price <= 0) return false;
    const ref = refClose.get(key);
    if (ref && Math.abs(price - ref) / ref > REF_TOLERANCE) {
      runtime.rejected = (runtime.rejected || 0) + 1;
      return false;
    }
    quotes.set(key, {
      price,
      pct: Number.isFinite(pct) ? pct : null,
      // Абсолютное изменение за день: у индексов Мосбиржа отдаёт его готовым
      // (LASTCHANGE), у CNBC оно приходит вместе с ценой. Считать его как
      // price - prev нельзя: предыдущего закрытия у индекса в потоке нет
      abs: Number.isFinite(extra.abs) ? extra.abs : null,
      at: extra.at || runtime.lastAt,
      open: extra.open ?? null,
      high: extra.high ?? null,
      low: extra.low ?? null,
      prev: extra.prev ?? null,
    });
    return true;
  }

  async function ruShares() {
    const ru = [...shareSymbols('RU')];
    if (!ru.length) return 0;
    // securities= сужает ответ с 189 КБ до 17: на всей доске 511 строк, из них
    // нужен 41. PREVPRICE живёт в таблице securities, а не в marketdata
    const res = await get(
      `${MOEX_SHARES}?iss.meta=off&iss.only=securities,marketdata&securities.columns=SECID,PREVPRICE&securities=${ru.join(',')}`,
      { timeout: 6000, headers: { Accept: 'application/json' } }
    );
    if (!res.ok) return 0;
    const j = await res.json().catch(() => null);
    const md = j?.marketdata;
    if (!md?.data?.length) return 0;
    const prevOf = new Map((j?.securities?.data || []).map(([sec, p]) => [sec, num(p)]));
    const c = (name) => md.columns.indexOf(name);
    const iSym = c('SECID');
    const iLast = c('LAST');
    // LASTTOPREVPRICE — изменение к закрытию прошлого дня, как у finviz.
    // LASTCHANGEPRCNT рядом с ним — к предыдущей сделке: у GAZP это было
    // +0,02% при дневном −1,04%, и страница рисовала зелёный там, где красный
    const iPct = c('LASTTOPREVPRICE');
    const iOpen = c('OPEN');
    const iHigh = c('HIGH');
    const iLow = c('LOW');
    const iTime = c('UPDATETIME');
    const iSys = c('SYSTIME');
    let n = 0;
    for (const row of md.data) {
      const price = num(row[iLast]);
      if (price === null) continue;
      const prev = prevOf.get(row[iSym]) ?? null;
      if (
        put(`RU:${row[iSym]}`, price, num(row[iPct]), {
          abs: prev ? price - prev : null,
          prev,
          open: num(row[iOpen]),
          high: num(row[iHigh]),
          low: num(row[iLow]),
          // Время биржи, а не наше: подпись «обновлено 19:32» при последней
          // сделке в 19:00 обещала бы свежесть, которой нет. Мосбиржа отдаёт
          // только часы и минуты, дату берём из системного времени ответа
          at: moexAt(row, iTime, iSys),
        })
      )
        n++;
    }
    return n;
  }

  async function ruIndexes() {
    const idxs = INDEXES.filter((i) => i.source === 'moex');
    if (!idxs.length) return 0;
    const res = await get(`${MOEX_INDEX}?iss.meta=off&iss.only=marketdata&securities=${idxs.map((i) => i.sourceCode).join(',')}`, {
      timeout: 6000,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return 0;
    const md = (await res.json().catch(() => null))?.marketdata;
    if (!md?.data?.length) return 0;
    const c = (name) => md.columns.indexOf(name);
    const iSym = c('SECID');
    const iVal = c('CURRENTVALUE');
    const iOpen = c('OPENVALUE');
    const iHigh = c('HIGH');
    const iLow = c('LOW');
    const iDate = c('TRADEDATE');
    const byCode = new Map(idxs.map((i) => [i.sourceCode, i.code]));
    let n = 0;
    for (const row of md.data) {
      const price = num(row[iVal]);
      const code = byCode.get(row[iSym]);
      if (price === null || !code) continue;
      // Изменение за день считаем сами, от закрытия прошлого торгового дня из
      // истории. LASTCHANGE и LASTCHANGEPRC у индекса — к предыдущему расчёту,
      // а не ко вчера: IMOEX показывал «+0,11 (0,00%)» при дневных −0,19%
      const prev = prevCloseOf(code, row[iDate]);
      // Ключ — наш code, а не биржевой символ: страница индекса ищет по нему
      if (
        put(`IDX:${code}`, price, prev ? ((price - prev) / prev) * 100 : null, {
          abs: prev ? price - prev : null,
          prev,
          open: num(row[iOpen]),
          high: num(row[iHigh]),
          low: num(row[iLow]),
          at: moexAt(row, c('UPDATETIME'), c('SYSTIME')),
        })
      )
        n++;
    }
    return n;
  }

  // Alpaca (SIP): цена последней сделки без задержки, весь рынок одним пакетом.
  // Изменение за день считаем сами — от закрытия прошлой сессии
  async function usSharesAlpaca(us) {
    const got = await fetchAlpacaSnapshots(us, { timeout: 8000 });
    let n = 0;
    for (const [sym, q] of Object.entries(got)) {
      const abs = q.prev ? q.price - q.prev : null;
      if (
        put(`US:${sym}`, q.price, q.prev ? (abs / q.prev) * 100 : null, {
          abs,
          prev: q.prev,
          open: q.open,
          high: q.high,
          low: q.low,
          at: q.at,
        })
      )
        n++;
    }
    return n;
  }

  async function usShares() {
    const us = [...shareSymbols('US')];
    if (!us.length) return 0;
    if (alpacaEnabled()) {
      try {
        const n = await usSharesAlpaca(us);
        if (n > 0) return n;
      } catch (e) {
        runtime.errors.push(`alpaca: ${String(e.message).slice(0, 80)}`);
      }
    }
    // CNBC пишет класс акций через точку (BRK.A), а в каталоге он через дефис.
    // Спрашиваем оба написания, а ответ приводим обратно к нашему символу:
    // иначе бумага молча выпадала из реалтайма
    const alias = new Map();
    const ask = [];
    for (const sym of us) {
      ask.push(sym);
      alias.set(sym, sym);
      if (sym.includes('-')) {
        const dotted = sym.replace(/-/g, '.');
        ask.push(dotted);
        alias.set(dotted, sym);
      }
    }
    const got = await fetchCnbcQuotes(ask, { compact: true, timeout: 8000 });
    let n = 0;
    for (const [raw, q] of Object.entries(got || {})) {
      const sym = alias.get(raw) || raw;
      if (
        put(`US:${sym}`, num(q.price), num(q.pct), {
          abs: num(q.change),
          prev: num(q.prev),
          open: num(q.open),
          high: num(q.high),
          low: num(q.low),
          at: q.time || undefined,
        })
      )
        n++;
    }
    return n;
  }

  async function cnbcIndexes() {
    const idxs = INDEXES.filter((i) => i.source === 'cnbc');
    if (!idxs.length) return 0;
    const got = await fetchCnbcQuotes(idxs.map((i) => i.sourceCode), { compact: true, timeout: 8000 });
    let n = 0;
    for (const idx of idxs) {
      const q = got?.[idx.sourceCode];
      if (
        q &&
        put(`IDX:${idx.code}`, num(q.price), num(q.pct), {
          abs: num(q.change),
          prev: num(q.prev),
          open: num(q.open),
          high: num(q.high),
          low: num(q.low),
          at: q.time || undefined,
        })
      )
        n++;
    }
    return n;
  }

  async function crypto() {
    let n = 0;
    const jobs = [];

    // Binance: все пары одним запросом. На незнакомую пару он отвечает 400 на
    // весь пакет, поэтому сюда попадают только пары, которые крон уже получал
    if (routes.binance.length) {
      jobs.push(
        (async () => {
          const url = `${BINANCE}?symbols=${encodeURIComponent(JSON.stringify(routes.binance.map((r) => r.pair)))}`;
          const res = await get(url, { timeout: 8000, headers: { Accept: 'application/json' } });
          if (!res.ok) throw new Error(`binance ${res.status}`);
          const rows = await res.json().catch(() => []);
          const bySym = new Map(routes.binance.map((r) => [r.pair, r.symbol]));
          for (const r of Array.isArray(rows) ? rows : []) {
            const sym = bySym.get(r.symbol);
            if (!sym) continue;
            if (
              put(`CRYPTO:${sym}`, num(r.lastPrice), num(r.priceChangePercent), {
                abs: num(r.priceChange),
                prev: num(r.openPrice),
                open: num(r.openPrice),
                high: num(r.highPrice),
                low: num(r.lowPrice),
              })
            )
              n++;
          }
        })()
      );
    }

    // MEXC говорит на API Binance, но с одним отличием: priceChangePercent у
    // него — доля, а не проценты. 0.0432 — это +4,32%, и без умножения рост
    // на четыре процента показывался бы как четыре сотых. Полный список MEXC —
    // 1813 строк ради десятка монет, поэтому спрашиваем точечно, параллельно
    const mexcOne = async (r) => {
      try {
        const res = await get(`${MEXC}?symbol=${encodeURIComponent(r.pair)}`, { timeout: 5000, headers: { Accept: 'application/json' } });
        if (!res.ok) return;
        const j = await res.json().catch(() => null);
        if (!j || j.lastPrice === undefined) return;
        const frac = num(j.priceChangePercent);
        if (
          put(`CRYPTO:${r.symbol}`, num(j.lastPrice), frac === null ? null : frac * 100, {
            abs: num(j.priceChange),
            prev: num(j.openPrice),
            open: num(j.openPrice),
            high: num(j.highPrice),
            low: num(j.lowPrice),
          })
        )
          n++;
      } catch {
        // одна пара не отменяет остальные
      }
    };
    jobs.push(...routes.mexc.map(mexcOne));

    // Gate отвечает медленно (до 1,5 с), но точечный запрос лёгкий — 263 байта.
    // change_percentage у него уже в процентах
    const gateOne = async (r) => {
      try {
        const res = await get(`${GATE}?currency_pair=${encodeURIComponent(r.pair)}`, { timeout: 6000, headers: { Accept: 'application/json' } });
        if (!res.ok) return;
        const j = (await res.json().catch(() => null))?.[0];
        if (!j) return;
        if (put(`CRYPTO:${r.symbol}`, num(j.last), num(j.change_percentage), { high: num(j.high_24h), low: num(j.low_24h) })) n++;
      } catch {
        // то же
      }
    };
    jobs.push(...routes.gate.map(gateOne));

    const res = await Promise.allSettled(jobs);
    for (const x of res) if (x.status === 'rejected') runtime.errors.push(String(x.reason?.message || x.reason).slice(0, 120));
    return n;
  }

  // Ночью и в выходные биржа стоит, а цикл продолжал бы спрашивать одни и те
  // же цифры каждые пять секунд. Расписание бирж здесь не зашито: у Мосбиржи
  // есть вечерняя сессия и торги выходного дня, у США — пре- и постмаркет, и
  // любое правило в коде однажды разойдётся с биржей. Вместо этого источник,
  // чьи цены не менялись IDLE_AFTER_MS, опрашивается раз в IDLE_EVERY_MS.
  // Первая же изменившаяся цена возвращает его на полную частоту
  const parts = { ruShares, ruIndexes, usShares, cnbcIndexes, crypto };
  const partState = Object.fromEntries(Object.keys(parts).map((k) => [k, { sig: '', changedAt: 0, polledAt: 0 }]));

  // Индексы Мосбиржи и CNBC лежат под одним префиксом IDX:, но стоят в разное
  // время — поэтому принадлежность ключа решает не префикс, а источник индекса
  const idxOf = (src) => new Set(INDEXES.filter((i) => i.source === src).map((i) => `IDX:${i.code}`));
  const MOEX_IDX = idxOf('moex');
  const CNBC_IDX = idxOf('cnbc');
  const OWNS = {
    ruShares: (k) => k.startsWith('RU:'),
    ruIndexes: (k) => MOEX_IDX.has(k),
    usShares: (k) => k.startsWith('US:'),
    cnbcIndexes: (k) => CNBC_IDX.has(k),
    crypto: (k) => k.startsWith('CRYPTO:'),
  };
  const signature = (part) => {
    let sig = '';
    for (const [k, v] of quotes) if (OWNS[part](k)) sig += `${k}=${v.price};`;
    return sig;
  };

  async function cycle({ force = false } = {}) {
    if (runtime.running) return runtime;
    runtime.running = true;
    const t0 = Date.now();
    runtime.lastAt = new Date().toISOString();
    const due = Object.keys(parts).filter((k) => {
      const st = partState[k];
      if (force || !st.changedAt) return true;
      if (t0 - st.changedAt < IDLE_AFTER_MS) return true;
      return t0 - st.polledAt >= IDLE_EVERY_MS;
    });
    const results = await Promise.allSettled(due.map((k) => parts[k]()));
    let n = 0;
    results.forEach((p, i) => {
      const k = due[i];
      const st = partState[k];
      st.polledAt = t0;
      if (p.status === 'fulfilled') n += p.value || 0;
      else runtime.errors.push(`${k}: ${String(p.reason?.message || p.reason).slice(0, 120)}`);
      const sig = signature(k);
      if (sig !== st.sig) {
        st.sig = sig;
        st.changedAt = t0;
      }
    });
    runtime.lastCount = n;
    runtime.lastMs = Date.now() - t0;
    runtime.polled = due;
    runtime.running = false;
    runtime.errors = runtime.errors.slice(-4);
    return runtime;
  }

  // Входные данные — вселенная, дневной файл графиков, история индексов —
  // меняются раз в сутки, но не в момент запуска: крон дописывает их позже.
  // Поэтому сервер передаёт функцию, а не значения, и она перечитывается раз
  // в INPUTS_MS
  let inputs = null;
  let inputsAt = 0;
  const INPUTS_MS = 10 * 60_000;
  const refreshInputs = (api) => {
    if (!inputs || Date.now() - inputsAt < INPUTS_MS) return;
    inputsAt = Date.now();
    try {
      const x = inputs() || {};
      api.setUniverse(x.universe, { charts: x.charts, indices: x.indices });
    } catch (e) {
      runtime.errors.push(`входные данные: ${e.message}`);
    }
  };

  const api = {
    start({ inputs: fn } = {}) {
      if (!enabled) return;
      inputs = fn || null;
      inputsAt = 0;
      refreshInputs(api);
      const loop = async () => {
        refreshInputs(api);
        await cycle().catch(() => {});
        timer = setTimeout(loop, intervalMs);
        timer.unref?.();
      };
      timer = setTimeout(loop, 3_000);
      timer.unref?.();
      log(`котировки: опрос раз в ${Math.round(intervalMs / 1000)} с`);
    },
    // Вселенную задаёт сервер: она меняется раз в сутки, и разбирать её на
    // каждом цикле незачем. charts — записи дневного файла графиков: из них
    // берутся проверенные пары крипты и опорные закрытия
    setUniverse(u, { charts = {}, indices = null } = {}) {
      uni = u || { items: [] };
      if (indices) indexHistory = indices;
      const next = { binance: [], mexc: [], gate: [] };
      const ref = new Map();
      const shar = { RU: new Set(), US: new Set() };
      for (const [key, rec] of Object.entries(charts || {})) {
        const pts = rec?.points;
        const last = Array.isArray(pts) && pts.length ? pts[pts.length - 1] : null;
        // Свеча — [t, o, h, l, c]; старые записи — пары [t, c]
        const close = Array.isArray(last) ? num(last.length >= 5 ? last[4] : last[1]) : null;
        if (close && close > 0) ref.set(key, close);
        const mk = key.slice(0, key.indexOf(':'));
        if (shar[mk]) shar[mk].add(key.slice(mk.length + 1));
        if (!key.startsWith('CRYPTO:') || !rec?.pair) continue;
        const route = next[rec.source];
        if (route) route.push({ symbol: key.slice(7), pair: String(rec.pair) });
      }
      routes = next;
      refClose = ref;
      chartSymbols = shar;
    },
    stop() {
      clearTimeout(timer);
    },
    get: (key) => quotes.get(key) || null,
    // Наложение поверх сохранённых котировок: страница получает ту же форму
    // записи, что и раньше, но с живой ценой. Поля, которых в реалтайме нет
    // (годовые экстремумы, капитализация, статус рынка), остаются из файла:
    // они не меняются каждые пять секунд, и терять их нельзя
    overlay(code, rec) {
      const live = quotes.get(`IDX:${code}`) || null;
      if (!live || !rec) return rec;
      const out = { ...rec, value: live.price };
      if (live.pct !== null) out.changePct = live.pct;
      if (live.abs !== null) out.change = live.abs;
      else if (live.prev !== null) out.change = live.price - live.prev;
      if (live.prev !== null) out.prevClose = live.prev;
      if (live.open !== null) out.open = live.open;
      if (live.high !== null) out.high = live.high;
      if (live.low !== null) out.low = live.low;
      if (live.at) out.at = live.at;
      out.live = true;
      return out;
    },
    // То же для целого словаря { DOW: {...}, IMOEX: {...} }
    overlayAll(map = {}) {
      const out = {};
      for (const [code, rec] of Object.entries(map)) out[code] = api.overlay(code, rec);
      return out;
    },
    // Цена бумаги по ключу. Отдельно от overlay, потому что бумаге нужна только
    // цена с процентом: остальное у неё считается из свечей на месте
    quoteOf(market, symbol) {
      return quotes.get(`${String(market).toUpperCase()}:${symbol}`) || null;
    },
    all: () => Object.fromEntries(quotes),
    at: () => runtime.lastAt,
    // Период опроса отдаётся странице: клиент не должен знать его сам —
    // уменьшение интервала в одном месте иначе потребовало бы правки в двух.
    // Ноль значит «опрашивать нечего»: выключенный реалтайм не наполняет
    // хранилище, и таймер на странице только тратил бы запросы впустую
    intervalMs: () => (enabled ? intervalMs : 0),
    status: () => ({
      enabled,
      intervalSec: Math.round(intervalMs / 1000),
      running: runtime.running,
      stored: quotes.size,
      lastAt: runtime.lastAt,
      lastMs: runtime.lastMs,
      lastCount: runtime.lastCount,
      // Сколько живых цен отброшено сверкой с дневным закрытием: не ноль — повод
      // проверить пару в charts.json
      rejected: runtime.rejected || 0,
      // Какие источники опрошены в последнем цикле: стоящие биржи выпадают
      // из списка и опрашиваются раз в минуту
      polled: runtime.polled || [],
      crypto: { binance: routes.binance.length, mexc: routes.mexc.length, gate: routes.gate.length },
      recentErrors: runtime.errors.slice(-4),
    }),
    runNow: () => cycle({ force: true }),
  };
  return api;
}
