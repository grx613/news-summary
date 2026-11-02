// График цены на странице тикера. Серверный inline SVG: клиентский JS поисковик
// не исполняет, а внешняя картинка — лишняя зависимость и лишний запрос.
// Периоды переключаются обычными ссылками с ?period=, без скриптов.

import { esc } from './render.js';

const PERIODS = [
  { code: '1m', label: 'Месяц', days: 31 },
  { code: '3m', label: '3 месяца', days: 92 },
  { code: '6m', label: 'Полгода', days: 183 },
  { code: '1y', label: 'Год', days: 366 },
];

export const isPeriod = (code) => PERIODS.some((p) => p.code === code);

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

function slicePeriod(points, days) {
  if (!points.length) return [];
  const lastMs = new Date(`${points[points.length - 1][0]}T00:00:00Z`).getTime();
  if (Number.isNaN(lastMs)) return points;
  const from = lastMs - days * 86400_000;
  return points.filter(([d]) => {
    const ms = new Date(`${d}T00:00:00Z`).getTime();
    return Number.isFinite(ms) && ms >= from;
  });
}

// Ломаная по точкам: одна линия на всю ширину. Логарифмическая шкала тут не нужна —
// за месяц-год цена растёт в разы, а не на порядки, и обычная шкала читается привычнее.
// Точек за год около 250-500, а по ширине графика различимо ~150: лишние
// координаты весят в HTML по 12 байт каждая и ничего не меняют на глаз.
// Глобальный минимум и максимум оставляем всегда — иначе пик может попасть
// между выборками, и график соврёт о размахе
function thin(points, max = 150) {
  if (points.length <= max) return points;
  const step = (points.length - 1) / (max - 1);
  const picked = new Map();
  for (let i = 0; i < max; i++) {
    const idx = Math.round(i * step);
    picked.set(idx, points[idx]);
  }
  let lo = 0;
  let hi = 0;
  points.forEach((p, i) => {
    if (Number(p[1]) < Number(points[lo][1])) lo = i;
    if (Number(p[1]) > Number(points[hi][1])) hi = i;
  });
  picked.set(lo, points[lo]);
  picked.set(hi, points[hi]);
  return [...picked.entries()].sort((a, b) => a[0] - b[0]).map(([, p]) => p);
}

function svgChart(points, { width = 720, height = 200 } = {}) {
  const vals = points.map((p) => Number(p[1]));
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || Math.max(max * 0.02, 1e-9);
  const padY = 14;
  const x = (i) => (i / Math.max(vals.length - 1, 1)) * width;
  const y = (v) => height - padY - ((v - min) / span) * (height - padY * 2);

  const line = vals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const area = `${x(0).toFixed(1)},${height} ${line} ${x(vals.length - 1).toFixed(1)},${height}`;
  const up = vals[vals.length - 1] >= vals[0];
  const stroke = up ? 'var(--green)' : 'var(--red)';
  const fill = up ? 'rgba(63,185,80,.12)' : 'rgba(248,81,73,.12)';

  // Три горизонтальные линии: по ним видно, где цена была относительно краёв диапазона
  const grid = [0.25, 0.5, 0.75]
    .map((f) => `<line x1="0" y1="${(height * f).toFixed(0)}" x2="${width}" y2="${(height * f).toFixed(0)}" stroke="var(--border)" stroke-width="1" stroke-dasharray="3 5" opacity=".5" />`)
    .join('');

  return `
    <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img"
      aria-label="График цены с ${esc(points[0][0])} по ${esc(points[points.length - 1][0])}">
      ${grid}
      <polygon points="${area}" fill="${fill}" />
      <polyline points="${line}" fill="none" stroke="${stroke}" stroke-width="2" vector-effect="non-scaling-stroke" />
    </svg>`;
}

// Помесячные закрытия: текстовая версия графика. Поисковику она полезнее картинки,
// а человеку даёт точные цифры, которые с ломаной не считаются
function monthlyRows(points) {
  const months = new Map();
  for (const [d, v] of points) {
    const m = d.slice(0, 7);
    // Точки идут по возрастанию даты, поэтому последняя запись месяца и есть его закрытие
    months.set(m, { d, v });
  }
  return [...months.entries()].slice(-12);
}

const SOURCE_LABEL = { moex: 'Мосбиржи (ISS)', cnbc: 'CNBC', binance: 'Binance', coingecko: 'CoinGecko' };

export function chartBlock({ asset, rec, period = '1y', canonicalPath = '' }) {
  const pts = (rec?.points || []).filter((p) => Array.isArray(p) && Number.isFinite(Number(p[1])));
  const cur = rec?.currency || (asset.market === 'US' || asset.market === 'CRYPTO' ? 'USD' : 'RUB');
  const code = isPeriod(period) ? period : '1y';
  const days = PERIODS.find((p) => p.code === code).days;
  const shown = slicePeriod(pts, days);

  const head = (inner) => `
      <section class="card chart-card" id="chart">
        <div class="head">
          <h2>График цены: ${esc(asset.symbol)}</h2>
          <span class="meta-stamp">${rec?.at ? `закрытия по ${esc(dayText(pts[pts.length - 1]?.[0]))}` : 'данные ещё не собраны'}</span>
        </div>
        ${inner}
      </section>`;

  // Нет истории — нет и блока: пустая рамка «данные ещё не собраны» на каждой
  // новой бумаге выглядит как поломка, а не как отсутствие данных
  if (pts.length < 2) return '';

  if (shown.length < 2) {
    return head(
      `<p style="color:var(--muted);margin:0">За выбранный период точек слишком мало — история короче. Выберите период длиннее.</p>
       ${periodsBar(code, canonicalPath)}`
    );
  }

  const first = Number(shown[0][1]);
  const last = Number(shown[shown.length - 1][1]);
  const changePct = first ? ((last - first) / first) * 100 : null;
  const changeAbs = last - first;

  // Минимум и максимум с датами: одно число без даты ничего не говорит о том,
  // когда это было, а человек как раз ищет «когда был пик»
  let lo = shown[0];
  let hi = shown[0];
  for (const p of shown) {
    if (Number(p[1]) < Number(lo[1])) lo = p;
    if (Number(p[1]) > Number(hi[1])) hi = p;
  }

  const cls = changeAbs >= 0 ? 'up' : 'down';
  const rows = monthlyRows(shown)
    .map(([m, { d, v }]) => `<tr><td>${esc(dayText(d))}</td><td class="num">${esc(fmtPrice(v, cur))}</td></tr>`)
    .join('');

  return head(`
        <div class="chart-facts">
          <div><span>Последнее закрытие</span><b>${esc(fmtPrice(last, cur))}</b></div>
          <div><span>Изменение за период</span><b class="${cls}">${esc(fmtChange(changeAbs, cur))} (${esc(fmtPct(changePct))})</b></div>
          <div><span>Максимум периода</span><b>${esc(fmtPrice(hi[1], cur))}</b></div>
          <div><span>Минимум периода</span><b>${esc(fmtPrice(lo[1], cur))}</b></div>
        </div>
        ${periodsBar(code, canonicalPath)}
        <div class="chart">
          ${svgChart(thin(shown))}
          <div class="chart-axis">
            <span>${esc(shortDay(shown[0][0]))} — ${esc(fmtPrice(shown[0][1], cur))}</span>
            <span>${esc(shortDay(shown[shown.length - 1][0]))} — ${esc(fmtPrice(shown[shown.length - 1][1], cur))}</span>
          </div>
          <div class="chart-axis chart-axis-mid">
            <span>максимум ${esc(shortDay(hi[0]))}: ${esc(fmtPrice(hi[1], cur))}</span>
            <span>минимум ${esc(shortDay(lo[0]))}: ${esc(fmtPrice(lo[1], cur))}</span>
          </div>
        </div>
        <details class="chart-table">
          <summary>Закрытия по месяцам</summary>
          <table class="idx-table"><thead><tr><th>Дата</th><th class="num">Закрытие</th></tr></thead><tbody>${rows}</tbody></table>
        </details>
        <p class="warn">Дневные закрытия по данным ${esc(sourceLabel(rec, asset))}. Это не котировка в реальном времени: последняя точка — итог последнего торгового дня.</p>`);
}

// Источник пишется в записи: у крипты он разный от монеты к монете —
// Binance для большинства, CoinGecko для биржевых токенов.
// Для записей без источника (собранных до его появления) по рынку угадывается
// самое вероятное, а не подставляется заведомо неверное «CoinGecko»
const sourceLabel = (rec, asset) =>
  SOURCE_LABEL[rec?.source] ||
  (asset.market === 'RU' ? 'Мосбиржи (ISS)' : asset.market === 'US' ? 'CNBC' : 'CoinGecko или Binance');

// Периоды — обычные ссылки: страница рендерится на сервере, и переключение
// не должно требовать скриптов. Текущий период помечен
function periodsBar(active, canonicalPath) {
  const base = canonicalPath || '#';
  const items = PERIODS.map((p) => {
    const href = p.code === '1y' ? esc(base) : `${esc(base)}?period=${p.code}`;
    return `<a class="period${p.code === active ? ' on' : ''}" href="${href}"${p.code === active ? ' aria-current="page"' : ''}>${esc(p.label)}</a>`;
  }).join('');
  return `<nav class="periods">${items}</nav>`;
}
