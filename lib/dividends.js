// Дивиденды по тикерам: история выплат, даты закрытия реестра и прогноз.
// Источники бесплатные и без модели — платить за эти данные не надо.
//
// Российские бумаги: dohod.ru отдаёт то, чего нет у Мосбиржи. MOEX ISS дивиденды
// не публикует в открытом доступе: /iss/securities/<тикер>/dividends.json содержит
// только описание бумаги и список режимов торгов, а ресурс /iss/cci/corp-actions/dividends
// закрыт подпиской («Информация доступна только подписчикам»).
// Американские: stockanalysis.com — Nasdaq отдаёт только свои бумаги, а NYSE-эмитенты
// (JNJ, KO, XOM, T) у него помечены как «дивидендов нет», хотя платят десятилетиями.

import fs from 'node:fs';
import { get, stripTags } from './http.js';

const DOHOD = 'https://www.dohod.ru/ik/analytics/dividend/';

// Даты у dohod в формате дд.мм.гггг, иногда с пометкой «(прогноз)» сразу после
export function parseDate(raw) {
  const m = String(raw || '').match(/(\d{2})\.(\d{2})\.(\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

const number = (raw) => {
  // Пустая ячейка — это отсутствие значения, а не ноль: Number('') === 0,
  // и без этой проверки доля от прибыли читалась бы как 0%
  const s = String(raw ?? '').replace(/\s/g, '').replace(',', '.').replace('%', '');
  if (!s || !/\d/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

// Что означает строка выплаты. У dohod будущие строки идут с class="forecast",
// но внутри них смешаны два разных случая: рекомендовано советом директоров
// (решение есть, дата известна) и прогноз аналитика dohod (решения ещё нет).
function paymentKind(rowHtml, registryRaw) {
  if (/рекомендован/i.test(rowHtml)) return 'recommended';
  if (/прогноз/i.test(registryRaw) || /прогноз/i.test(rowHtml)) return 'forecast';
  return 'paid';
}

// ---------------------------------------------------------------- разбор dohod
// На странице бумаги три таблицы: сводные показатели, суммы по годам и история
// выплат с датами реестра. Порядок устойчив — проверено на бумагах с 3 и с 52 строками.
export function parseDohod(html) {
  const tables = [...String(html).matchAll(/<table[^>]*>[\s\S]*?<\/table>/g)].map((m) => m[0]);
  if (tables.length < 3) return null;

  const cells = (row) =>
    [...row.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((m) => stripTags(m[1]));

  const rows = (table) => [...table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((m) => m[0]);

  // Сводка: три значения в первой строке, подписи к ним — во второй.
  // Берём именно первую строку: пустые ячейки-разделители иначе сдвигают позиции
  // и доля от прибыли читается как индекс DSI.
  const briefRow = rows(tables[0]).map(cells).find((c) => c.filter(Boolean).length >= 3);
  const brief = (briefRow || []).map(number).filter((n) => n !== null);
  const yieldPct = brief[0] ?? null;
  const payoutPct = brief[1] ?? null;
  const dsi = brief[2] ?? null;

  // Суммы по годам: первая строка — заголовок, среди строк есть «след 12m. (прогноз)»
  const annual = [];
  let forecastNext = null;
  for (const row of rows(tables[1]).slice(1)) {
    const c = cells(row);
    if (c.length < 2) continue;
    const amount = number(c[1]);
    if (amount === null) continue;
    if (/12m/i.test(c[0])) {
      forecastNext = amount;
      continue;
    }
    const year = Number(String(c[0]).match(/\d{4}/)?.[0]);
    if (!year) continue;
    annual.push({ year, amount, changePct: c[2] && c[2] !== '-' ? number(c[2]) : null });
  }

  // История выплат: дата объявления, дата закрытия реестра, год учёта, размер
  const payments = [];
  const seen = new Set();
  for (const row of rows(tables[2]).slice(1)) {
    const c = cells(row);
    if (c.length < 4) continue;
    const amount = number(c[3]);
    const registry = parseDate(c[1]);
    if (amount === null || !registry) continue;
    const kind = paymentKind(row, c[1]);
    // «Прогноз» нулевого размера — это не выплата, а запись «дивидендов не ждём».
    // На странице она только сбивает: держим её отдельным признаком, а не строкой.
    if (kind === 'forecast' && amount === 0) continue;
    const dedupeKey = `${registry}|${amount}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    payments.push({
      declared: parseDate(c[0]),
      registry,
      year: /^\d{4}$/.test(String(c[2]).trim()) ? Number(c[2]) : null,
      amount,
      kind,
    });
  }
  payments.sort((a, b) => String(b.registry).localeCompare(String(a.registry)));

  // Ближайшая выплата, у которой дата ещё не прошла. Прогнозы dohod тоже годятся:
  // на них и строятся запросы «когда дивиденды», но на странице они помечены.
  const today = new Date().toISOString().slice(0, 10);
  // Ищем по возрастанию: массив отсортирован от новых к старым, и find() по нему
  // вернул бы самую далёкую будущую дату, а не ближайшую
  const next = [...payments].reverse().find((p) => p.registry >= today) || null;

  return {
    yieldPct,
    payoutPct,
    dsi,
    forecastNext,
    annual: annual.sort((a, b) => b.year - a.year),
    payments: payments.slice(0, 40),
    next,
    currency: 'RUB',
  };
}

// ---------------------------------------------------------------- разбор stockanalysis
// Nasdaq отдаёт дивиденды только по своим бумагам: у NYSE-эмитентов (JNJ, KO, XOM, T)
// тот же запрос возвращает yield: "N/A", хотя бумаги платят десятилетиями.
// Поэтому США берём со stockanalysis.com — он покрывает обе биржи и прямо говорит,
// когда компания никогда не платила, а когда данных просто нет.
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

// Даты здесь в виде «Nov 24, 2026», в истории — уже ISO
function parseUsDate(raw) {
  const s = String(raw || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^([A-Za-z]{3})[a-z]*\s+(\d{1,2}),\s*(\d{4})$/);
  if (m) return `${m[3]}-${String(MONTHS[m[1].toLowerCase()] || 1).padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  return null;
}

// Частота выплат: источник пишет по-английски, а страница на русском
const FREQ = {
  quarterly: 'ежеквартально',
  monthly: 'ежемесячно',
  'semi-annually': 'раз в полгода',
  semiannual: 'раз в полгода',
  annually: 'раз в год',
  annual: 'раз в год',
};
export const freqLabel = (raw) => FREQ[String(raw || '').toLowerCase()] || null;

export function parseStockAnalysis(json, symbol) {
  const d = json?.data;
  if (!d) return null;
  const t = d.infoTable || {};
  const history = Array.isArray(d.history) ? d.history : [];
  const annualized = number(String(t.annual ?? '').replace(/\$/g, ''));
  const yieldPct = number(String(t.yield ?? '').replace('%', ''));

  // Ни истории, ни годовой выплаты — компания не платит. Это ответ, а не сбой:
  // страница так и должна сказать, а не притворяться, что данных нет.
  if (!history.length && annualized === null) {
    if (/never paid|no dividend history/i.test(String(d.infoBox || ''))) {
      return { pays: false, symbol, currency: 'USD', history: [], annual: [], payments: [], next: null };
    }
    return null;
  }

  const payments = history
    .map((h) => {
      const exDate = parseUsDate(h.dt);
      const registry = parseUsDate(h.record);
      return {
        declared: parseUsDate(h.dec),
        registry,
        exDate,
        payDate: parseUsDate(h.pay),
        // Год учёта выплаты: у dohod он приходит отдельной колонкой, здесь его нет
        year: Number(String(exDate || registry || '').slice(0, 4)) || null,
        amount: number(String(h.amt ?? '').replace(/\$/g, '')),
        kind: 'paid',
      };
    })
    .filter((p) => p.amount !== null)
    .sort((a, b) => String(b.exDate || '').localeCompare(String(a.exDate || '')));

  const today = new Date().toISOString().slice(0, 10);
  // Ближайшая отсечка: в отличие от российской истории, здесь будущие даты
  // приходят в тех же строках, что и прошедшие. Массив отсортирован по убыванию,
  // поэтому берём минимум из подходящих, а не первую попавшуюся строку
  const next =
    payments.filter((p) => (p.exDate || p.registry || '') >= today).sort((a, b) =>
      String(a.exDate || a.registry).localeCompare(String(b.exDate || b.registry))
    )[0] || null;

  const byYear = new Map();
  for (const p of payments) {
    const yr = Number(String(p.exDate || p.registry || '').slice(0, 4));
    if (!yr) continue;
    byYear.set(yr, (byYear.get(yr) || 0) + p.amount);
  }
  // Изменение к предыдущему году считаем сами: у dohod эта колонка приходит готовой,
  // а здесь её надо собрать, иначе в таблице везде прочерк. У текущего года выплаты
  // ещё не все сделаны, поэтому сравнение с полным прошлым годом ничего не значит
  const currentYear = new Date().getUTCFullYear();
  const annual = [...byYear.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([year, amount], i, arr) => {
      const prev = arr[i + 1];
      const complete = year < currentYear;
      return {
        year,
        amount: Math.round(amount * 1e4) / 1e4,
        changePct:
          complete && prev && prev[1] ? Math.round(((amount - prev[1]) / prev[1]) * 10000) / 100 : null,
      };
    });

  return {
    pays: true,
    symbol,
    yieldPct,
    payoutPct: number(String(t.payoutRatio ?? '').replace('%', '')),
    growthPct: number(String(t.growth ?? '').replace('%', '')),
    years: number(String(t.years ?? '')),
    frequency: freqLabel(t.frequency),
    dsi: null,
    forecastNext: annualized,
    annual: annual.slice(0, 25),
    payments: payments.slice(0, 40),
    next,
    currency: 'USD',
  };
}

// ---------------------------------------------------------------- загрузка
export async function fetchRuDividends(symbol, { timeout = 15000 } = {}) {
  const res = await get(DOHOD + encodeURIComponent(String(symbol).toLowerCase()), { timeout });
  // 404 у dohod приходит как обычная страница ошибки — разбор вернёт null
  if (!res.ok) return null;
  return parseDohod(await res.text());
}

export async function fetchUsDividends(symbol, { timeout = 15000 } = {}) {
  // В адресе точка вместо дефиса: у BRK.A и подобных классов акций другой тикер
  const sym = String(symbol).replace('-', '.');
  const res = await get(`https://stockanalysis.com/api/symbol/s/${encodeURIComponent(sym)}/dividend`, {
    timeout,
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) return null;
  let json = null;
  try {
    json = await res.json();
  } catch {
    return null;
  }
  return parseStockAnalysis(json, symbol);
}

// ---------------------------------------------------------------- хранение
// Дивиденды меняются раз в квартал, но дата отсечки всплывает заранее, поэтому
// обновляем раз в сутки. Файл отдельный: cache.json — про новости и стоит денег,
// а это справочные данные, которые надо уметь пережить без пересборки сводок.
export function createDividendStore(file, { log = () => {} } = {}) {
  let state = { at: null, items: {} };

  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (raw && typeof raw === 'object' && raw.items) state = { at: raw.at || null, items: raw.items };
  } catch {
    state = { at: null, items: {} };
  }

  let saveTimer = null;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        fs.writeFileSync(file, JSON.stringify(state));
      } catch (e) {
        log(`дивиденды: не удалось записать файл — ${e.message}`);
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
    remove(key) {
      if (!state.items[key]) return;
      delete state.items[key];
      save();
    },
    all: () => state.items,
    get size() {
      return Object.keys(state.items).length;
    },
    updatedAt: () => state.at,
    save,
  };
}
