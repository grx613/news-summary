// График на странице тикера: японские свечи в inline SVG. Клиентский JS поисковик
// не исполняет, а внешняя картинка — лишняя зависимость и лишний запрос.
// Интервал и период переключаются обычными ссылками, без скриптов.

import { esc } from './render.js';
import { TIMEFRAMES, TF_BY_MARKET, aggregate } from './charts.js';
import { stampFormatter } from './chart-intraday.js';

// Периоды — только для дневных и крупнее: у минуток окно задаёт сам интервал
const PERIODS = [
  { code: '1m', label: 'Месяц', days: 31 },
  { code: '3m', label: '3 месяца', days: 92 },
  { code: '6m', label: 'Полгода', days: 183 },
  { code: '1y', label: 'Год', days: 366 },
];

// Старые адреса окна графика остались в индексе и в чужих ссылках
const PERIOD_ALIAS = { '1m': '1m', '3m': '3m', '6m': '6m', '1y': '1y' };

export const isPeriod = (code) => PERIODS.some((p) => p.code === code);
export const isTimeframe = (code) => Object.hasOwn(TIMEFRAMES, code);

// Интервал по умолчанию — день: страница должна открываться тем же графиком,
// что и раньше, и не зависеть от сети при каждом показе
export const DEFAULT_TF = '1d';

export const tfList = (market) => TF_BY_MARKET[market] || TF_BY_MARKET.US;

// Цены разных порядков: у биткоина тысячи, у PEPE миллионные доли.
// Знаков после запятой должно хватать, чтобы строка не превратилась в «0»
export function fmtPrice(n, currency = 'RUB') {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  const digits = a >= 1000 ? 0 : a >= 10 ? 2 : a >= 0.01 ? 4 : 8;
  const body = a.toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: digits });
  const sign = v < 0 ? '−' : '';
  return currency === 'USD' ? `${sign}$${body}` : `${sign}${body} ₽`;
}

// Изменение за период — всегда со знаком: «18,52 ₽» без плюса читается
// как цена, а не как прирост
const fmtChange = (n, currency) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  return v > 0 ? `+${fmtPrice(v, currency)}` : fmtPrice(v, currency);
};

const fmtPct = (n) =>
  !Number.isFinite(Number(n))
    ? '—'
    : `${Number(n) > 0 ? '+' : ''}${Number(n).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/^-/, '−')}%`;

const dayText = (d) =>
  d ? new Date(`${d}T00:00:00Z`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : '—';
const shortDay = (d) =>
  d ? new Date(`${d}T00:00:00Z`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : '';

// Ключ месяца 'YYYY-MM': к нему нельзя приписывать число и отдавать в dayText —
// так получалась дата вида '2026-11-01-01' и «Invalid Date»
const monthText = (m) => {
  const [y, mo] = String(m).split('-');
  const n = Number(mo);
  return Number.isFinite(n) && y ? `${MONTHS[n - 1] || mo} ${y}` : String(m);
};
const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];

function slicePeriod(candles, days) {
  if (!candles.length) return [];
  const lastMs = new Date(`${candles[candles.length - 1][0]}T00:00:00Z`).getTime();
  if (Number.isNaN(lastMs)) return candles;
  const from = lastMs - days * 86400_000;
  return candles.filter(([d]) => {
    const ms = new Date(`${d}T00:00:00Z`).getTime();
    return Number.isFinite(ms) && ms >= from;
  });
}

// Yahoo за три месяца отдаёт ~450 часовых свечей. На телефоне 400 из них — это
// 0,7 px на свечу, уже не читается. Поэтому лишние отрезаются с начала ряда:
// свежие свечи важнее старых, а склейка превратила бы часовую свечу в двухчасовую
function trimSeries(candles, max) {
  return candles.length > max ? candles.slice(candles.length - max) : candles;
}

function svgCandles(candles, { width = 720, height = 220 } = {}) {
  const hi = Math.max(...candles.map((c) => c[2]));
  const lo = Math.min(...candles.map((c) => c[3]));
  const span = hi - lo || Math.max(hi * 0.02, 1e-9);
  const padY = 12;
  const n = Math.max(candles.length, 1);
  // Шаг по индексу, а не по времени: выходные и ночные перерывы иначе
  // сжимались бы в точку, а торговый день занимал бы треть ширины
  const step = width / n;
  // Тело — меньше шага: свечи с зазором читаются как свечи, а слипшиеся выглядят
  // заливкой. Потолок нужен, чтобы месяц из 13 свечей не превратился в столбы
  const bodyW = Math.min(Math.max(step * 0.62, 0.55), 9);
  const y = (v) => height - padY - ((v - lo) / span) * (height - padY * 2);

  const grid = [0.25, 0.5, 0.75]
    .map(
      (f) =>
        `<line x1="0" y1="${(height * f).toFixed(0)}" x2="${width}" y2="${(height * f).toFixed(0)}" stroke="var(--border)" stroke-width="1" stroke-dasharray="3 5" opacity=".5" />`
    )
    .join('');

  const parts = candles.map((c, i) => {
    const [, o, h, l, cl] = c;
    const x = (i + 0.5) * step;
    const up = cl >= o;
    const color = up ? 'var(--green)' : 'var(--red)';
    const yTop = y(Math.max(o, cl));
    const yBot = y(Math.min(o, cl));
    // Тело меньше пикселя всё равно должно быть видно, иначе день без движения
    // выглядит как пропуск данных
    const hBody = Math.max(1, yBot - yTop);
    return (
      `<line x1="${x.toFixed(1)}" y1="${y(h).toFixed(1)}" x2="${x.toFixed(1)}" y2="${y(l).toFixed(1)}" stroke="${color}" stroke-width="1" vector-effect="non-scaling-stroke" />` +
      `<rect x="${(x - bodyW / 2).toFixed(1)}" y="${yTop.toFixed(1)}" width="${bodyW.toFixed(1)}" height="${hBody.toFixed(1)}" fill="${color}" />`
    );
  });

  return `
    <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="График свечами, ${candles.length} свечей">
      ${grid}
      ${parts.join('')}
    </svg>`;
}

// Помесячные закрытия: текстовая версия графика. Поисковику она полезнее картинки,
// а человеку даёт точные цифры, которые со свечей не считаются
function monthlyRows(candles) {
  return aggregate(candles, (d) => String(d).slice(0, 7))
    .slice(-12)
    .map((c) => [c[0], c[4]]);
}

const SOURCE_LABEL = {
  moex: 'Мосбиржи (ISS)',
  cnbc: 'CNBC',
  yahoo: 'Yahoo Finance',
  binance: 'Binance',
  mexc: 'MEXC',
  coingecko: 'CoinGecko',
  gate: 'Gate.io',
};

// Источник пишется в записи: у крипты он разный от монеты к монете.
// Для записей без источника (собранных до его появления) по рынку угадывается
// самое вероятное, а не подставляется заведомо неверное «CoinGecko»
const sourceLabel = (source, asset) =>
  SOURCE_LABEL[source] ||
  (asset.market === 'RU' ? 'Мосбиржи (ISS)' : asset.market === 'US' ? 'CNBC' : 'CoinGecko или Binance');

// Ссылки интервалов: текущий помечен, адрес без параметра равен дневному графику,
// чтобы поисковик не увидел девять копий одной страницы
function tfBar(market, active, period, canonicalPath) {
  const base = canonicalPath || '#';
  const items = tfList(market).map((tf) => {
    const params = [];
    if (tf !== DEFAULT_TF) params.push(`tf=${tf}`);
    if (period !== '1y' && TIMEFRAMES[tf]?.daily) params.push(`period=${period}`);
    const href = params.length ? `${esc(base)}?${esc(params.join('&'))}` : esc(base);
    const on = tf === active;
    return `<a class="period${on ? ' on' : ''}" href="${href}"${on ? ' aria-current="page"' : ''}>${esc(TIMEFRAMES[tf].label)}</a>`;
  }).join('');
  return `<nav class="periods tf-bar" aria-label="Интервал свечей">${items}</nav>`;
}

// Период — обычные ссылки: страница рендерится на сервере, и переключение
// не должно требовать скриптов
function periodsBar(active, canonicalPath, tf) {
  const base = canonicalPath || '#';
  const items = PERIODS.map((p) => {
    const params = [];
    if (tf !== DEFAULT_TF) params.push(`tf=${tf}`);
    if (p.code !== '1y') params.push(`period=${p.code}`);
    const href = params.length ? `${esc(base)}?${esc(params.join('&'))}` : esc(base);
    return `<a class="period${p.code === active ? ' on' : ''}" href="${href}"${p.code === active ? ' aria-current="page"' : ''}>${esc(p.label)}</a>`;
  }).join('');
  return `<nav class="periods" aria-label="Период графика">${items}</nav>`;
}

export { PERIOD_ALIAS };

export function chartBlock({ asset, rec, series, tf = DEFAULT_TF, period = '1y', canonicalPath = '' }) {
  const meta = TIMEFRAMES[tf] || TIMEFRAMES[DEFAULT_TF];
  const isDaily = Boolean(meta.daily);
  const cur = rec?.currency || (asset.market === 'US' || asset.market === 'CRYPTO' ? 'USD' : 'RUB');
  const code = isPeriod(period) ? period : '1y';

  let candles = (series?.candles || []).filter((c) => Array.isArray(c) && c.length >= 5);
  if (isDaily) {
    const days = PERIODS.find((p) => p.code === code).days;
    candles = slicePeriod(candles, days);
  }

  const stamp = stampFormatter(series?.tz, tf);
  const market = asset.market;

  // Внутридневные точки не кешируются на диск: подпись честно говорит,
  // когда ряд пришёл, — по ней видно, насколько он свежий
  const stampText = isDaily
    ? rec?.at
      ? `по ${esc(dayText(String(candles[candles.length - 1]?.[0] || '').slice(0, 10)))}`
      : 'данные ещё не собраны'
    : series?.fetchedAt
      ? `запрос ${esc(fmtClock(series.fetchedAt, series.tz))}`
      : 'нет данных';

  const head = (inner) => `
      <section class="card chart-card" id="chart">
        <div class="head">
          <h2>График ${esc(asset.symbol)}: свечи ${esc(meta.label.toLowerCase())}</h2>
          <span class="meta-stamp">${stampText}</span>
        </div>
        ${tfBar(market, tf, code, canonicalPath)}
        ${inner}
      </section>`;

  if (candles.length < 2) {
    return head(
      `<p class="chart-empty">За этот интервал данных нет — источник их не отдаёт или история короче. Выберите другой интервал.</p>
       ${isDaily ? periodsBar(code, canonicalPath, tf) : ''}`
    );
  }

  const first = candles[0];
  const lastC = candles[candles.length - 1];
  const openFirst = Number(first[1]);
  const closeLast = Number(lastC[4]);
  const changePct = openFirst ? ((closeLast - openFirst) / openFirst) * 100 : null;
  const changeAbs = closeLast - openFirst;

  let hi = candles[0];
  let lo = candles[0];
  for (const c of candles) {
    if (Number(c[2]) > Number(hi[2])) hi = c;
    if (Number(c[3]) < Number(lo[3])) lo = c;
  }

  const cls = changeAbs >= 0 ? 'up' : 'down';
  // Отрезаем старое, а не склеиваем: часовой ряд из Yahoo длиннее 400 свечей,
  // и свёрнутая вдвое часовая свеча уже не часовая, а данных о ней в подписи нет
  const drawn = trimSeries(candles, 400);

  const rows = isDaily
    ? monthlyRows(candles)
        // Первое число месяца — только чтобы отформатировать подпись; регистр
        // даты для ключа остался в monthlyRows
        .map(([m, v]) => `<tr><td>${esc(monthText(m))}</td><td class="num">${esc(fmtPrice(v, cur))}</td></tr>`)
        .join('')
    : candles
        .slice(-10)
        .reverse()
        .map(
          (c) =>
            `<tr><td>${esc(stamp(c[0]))}</td><td class="num">${esc(fmtPrice(c[1], cur))}</td><td class="num">${esc(fmtPrice(c[2], cur))}</td><td class="num">${esc(fmtPrice(c[3], cur))}</td><td class="num">${esc(fmtPrice(c[4], cur))}</td></tr>`
        )
        .join('');

  const table = isDaily
    ? `<table class="idx-table"><thead><tr><th>Месяц</th><th class="num">Закрытие</th></tr></thead><tbody>${rows}</tbody></table>`
    : `<table class="idx-table"><thead><tr><th>Свеча</th><th class="num">Открытие</th><th class="num">Максимум</th><th class="num">Минимум</th><th class="num">Закрытие</th></tr></thead><tbody>${rows}</tbody></table>`;

  const sourceText = sourceLabel(series?.source || rec?.source, asset);
  const tzText = series?.tz ? ` Время: ${esc(TZ_TEXT[series.tz] || series.tz)}.` : '';
  // Ряд длиннее предела различимости обрезан: об этом сказано прямо, иначе
  // человек решит, что история бумаги начинается с этой даты
  const cutText = candles.length > drawn.length ? ` Показаны последние ${drawn.length} свечей из ${candles.length}.` : '';

  return head(`
        <div class="chart-facts">
          <div><span>Последнее закрытие</span><b>${esc(fmtPrice(closeLast, cur))}</b></div>
          <div><span>Изменение за период</span><b class="${cls}">${esc(fmtChange(changeAbs, cur))} (${esc(fmtPct(changePct))})</b></div>
          <div><span>Максимум</span><b>${esc(fmtPrice(hi[2], cur))}</b></div>
          <div><span>Минимум</span><b>${esc(fmtPrice(lo[3], cur))}</b></div>
        </div>
        ${isDaily ? periodsBar(code, canonicalPath, tf) : ''}
        <div class="chart${isDaily ? '' : ' chart-intraday'}">
          ${svgCandles(drawn)}
          <div class="chart-axis">
            <span>${esc(stamp(first[0]))} — ${esc(fmtPrice(first[1], cur))}</span>
            <span>${esc(stamp(lastC[0]))} — ${esc(fmtPrice(closeLast, cur))}</span>
          </div>
          <div class="chart-axis chart-axis-mid">
            <span>максимум ${esc(stamp(hi[0]))}: ${esc(fmtPrice(hi[2], cur))}</span>
            <span>минимум ${esc(stamp(lo[0]))}: ${esc(fmtPrice(lo[3], cur))}</span>
          </div>
        </div>
        <details class="chart-table">
          <summary>${isDaily ? 'Закрытия по месяцам' : 'Последние свечи'}</summary>
          ${table}
        </details>
        <p class="warn">Свечи ${esc(meta.label.toLowerCase())} по данным ${esc(sourceText)}.${tzText}${cutText} ${
          isDaily
            ? 'Это не котировка в реальном времени: последняя свеча — итог последнего торгового дня.'
            : 'Внутридневной ряд запрашивается при показе страницы и может отставать от биржи на минуту.'
        }</p>`);
}

// Подпись зоны человеческим языком: «UTC» вместо названия биржи читается понятнее
const TZ_TEXT = { 'Europe/Moscow': 'московское', 'America/New_York': 'нью-йоркское', UTC: 'UTC' };

function fmtClock(iso, tz) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: tz || 'UTC',
    hour: '2-digit',
    minute: '2-digit',
    day: 'numeric',
    month: 'short',
  }).format(d);
}
