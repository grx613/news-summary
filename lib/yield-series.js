// Доходности, которых нет ни у Yahoo, ни у Alpaca: десятилетние Германии и
// Британии. Ни один из них не отдаёт их ни под каким написанием — проверены
// десятки вариантов тикеров, везде 404. Зато их публикуют сами центробанки,
// и это даже точнее пересказа: значение официальное, а не пересчёт брокера.
//
// Bundesbank — дневная серия доходности десятилетних Bund (BBSIS), формат CSV.
// Bank of England — серия IUDMNZC (10-year nominal par yield), тоже CSV.
// Оба отдают историю на годы, поэтому дневной, недельный и месячный графики
// собираются из одного ответа.
//
// Свеча — массив [дата 'YYYY-MM-DD', open, high, low, close]. У доходности нет
// внутридневных значений: open = high = low = close, тело у свечи нулевое.
// Рисовать её бары бессмысленно, и график для таких инструментов показывается
// линией — см. chart-render.js.

import { get } from './http.js';
import { makeCandle } from './charts.js';

// FRED с браузерным User-Agent не отвечает вовсе: соединение висит до таймаута,
// а без него те же данные приходят за сто миллисекунд. Это единственный
// источник здесь, которому нужен свой заголовок
const plainGet = (url, { timeout = 20000 } = {}) => {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  return fetch(url, { signal: ctrl.signal, headers: { Accept: 'text/csv' } }).finally(() => clearTimeout(t));
};

const BUNDESBANK =
  'https://api.statistiken.bundesbank.de/rest/data/BBSIS/D.I.ZST.ZI.EUR.S1311.B.A604.R10XX.R.A.A._Z._Z.A?format=csv&lang=en';
// FRED: официальные доходности Минфина США. Нужны для двухлетней бумаги —
// у Yahoo её нет: 2YY=F оказался просроченным фьючерсом, который неделями
// показывает одно и то же значение (4.78 против реальных 4.46)
const FRED = 'https://fred.stlouisfed.org/graph/fredgraph.csv';

const BOE =
  'https://www.bankofengland.co.uk/boeapps/database/_iadb-fromshowcolumns.asp?csv.x=yes' +
  '&Datefrom=01/Jan/2015&Dateto=31/Dec/2030&SeriesCodes=IUDMNZC&CSVF=TN&UsingCodes=Y&VPD=Y&VFD=N';

// Какой серии соответствует код каталога
export const YIELD_SOURCE = { US2Y: 'fred', DE10Y: 'bundesbank', GB10Y: 'boe' };
export const yieldHasHistory = (code) => Object.hasOwn(YIELD_SOURCE, code);

const day = (raw) => {
  // Bundesbank пишет 2026-11-06, BoE — 06 Nov 2026
  const s = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})$/);
  if (!m) return null;
  const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const mo = months.indexOf(m[2].toLowerCase().slice(0, 3));
  if (mo < 0) return null;
  return `${m[3]}-${String(mo + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
};

async function rows(url, timeout, { plain = false } = {}) {
  const res = plain ? await plainGet(url, { timeout }) : await get(url, { timeout, headers: { Accept: 'text/csv,text/plain,*/*' } });
  if (!res.ok) return [];
  const text = await res.text();
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || /^[A-Za-z]/.test(line)) continue;
    const parts = line.split(',');
    // Где дата — первая колонка или вторая — зависит от параметров запроса:
    // с UsingCodes=Y BoE не пишет имя серии, и дата сдвигается влево
    const i = day(parts[0]) ? 0 : day(parts[1]) ? 1 : -1;
    if (i < 0) continue;
    const raw = Number(parts[i + 1]);
    if (!Number.isFinite(raw) || raw <= 0) continue;
    out.push([day(parts[i]), raw]);
  }
  return out;
}

// У всех трёх серий дата и значение стоят рядом, а с какой колонки начинается
// строка — разбирает rows(): у Bundesbank «2026-11-06,3.29», у BoE
// «06 Nov 2026,5.146», у FRED «2026-11-05,4.46» с заголовком в первой строке
const seriesRows = (code, timeout) => {
  const kind = YIELD_SOURCE[code];
  // FRED отдаёт всю серию с 1976 года — 13 тысяч строк, и на этом объёме
  // ответ не успевает за таймаут. Просим два года: глубже дневного графика
  // всё равно не нужно
  if (kind === 'fred') {
    const from = new Date(Date.now() - 800 * 86400_000).toISOString().slice(0, 10);
    return rows(`${FRED}?id=DGS2&cosd=${from}`, timeout, { plain: true });
  }
  return rows(kind === 'bundesbank' ? BUNDESBANK : BOE, timeout);
};

export async function fetchYieldSeries(code, { timeout = 15000 } = {}) {
  if (!yieldHasHistory(code)) return [];
  const rows = await seriesRows(code, timeout);
  if (!rows.length) return [];
  rows.sort((a, b) => a[0].localeCompare(b[0]));
  return rows.map(([d, v]) => makeCandle(d, v, v, v, v)).filter(Boolean);
}

// Живое значение — последняя точка ряда. Отдельного «тикера» у центробанков
// нет: серия обновляется раз в день после закрытия, раньше этого значения
// не существует ни у кого
export async function fetchYieldQuote(code, { timeout = 15000 } = {}) {
  const candles = await fetchYieldSeries(code, { timeout });
  const last = candles.at(-1);
  const prev = candles.at(-2);
  if (!last) return null;
  const value = last[4];
  const pct = prev ? Math.round(((value - prev[4]) / prev[4]) * 10000) / 100 : null;
  return {
    price: value,
    pct,
    prev: prev ? prev[4] : null,
    time: `${last[0]}T00:00:00Z`,
    source: 'yield',
  };
}
