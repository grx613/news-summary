// График на странице тикера: японские свечи в inline SVG. Клиентский JS поисковик
// не исполняет, а внешняя картинка — лишняя зависимость и лишний запрос.
// Интервал переключается обычными ссылками, без скриптов.

import { esc } from './render.js';
import { t, L, intlLocale } from './i18n.js';
import { TIMEFRAMES, TF_BY_MARKET, aggregate } from './charts.js';
import { plural as numPlural } from './i18n.js';
import { stampFormatter } from './chart-intraday.js';

// Период как отдельная настройка больше не нужен: окно задаёт сам интервал
// свечи. Дневной ряд лежит в файле за 400 дней, и это ровно то, что человек
// ждёт от «Дня»; для минуток окно и так задано источником.

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
  const body = a.toLocaleString(intlLocale(), { minimumFractionDigits: 0, maximumFractionDigits: digits });
  const sign = v < 0 ? '−' : '';
  return currency === 'USD' ? `${sign}$${body}` : `${sign}${body} ₽`;
}

// Изменение за интервал — всегда со знаком: «18,52 ₽» без плюса читается
// как цена, а не как прирост
const fmtChange = (n, currency) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  return v > 0 ? `+${fmtPrice(v, currency)}` : fmtPrice(v, currency);
};

const fmtPct = (n) =>
  !Number.isFinite(Number(n))
    ? '—'
    : `${Number(n) > 0 ? '+' : ''}${Number(n).toLocaleString(intlLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/^-/, '−')}%`;

const dayText = (d) =>
  d ? new Date(`${d}T00:00:00Z`).toLocaleDateString(intlLocale(), { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : '—';
const shortDay = (d) =>
  d ? new Date(`${d}T00:00:00Z`).toLocaleDateString(intlLocale(), { day: 'numeric', month: 'short', timeZone: 'UTC' }) : '';

// Ключ месяца 'YYYY-MM': к нему нельзя приписывать число и отдавать в dayText —
// так получалась дата вида '2026-11-01-01' и «Invalid Date»
const monthText = (m) => monthText2(m);
// Названия месяцев берутся у Intl, а не из списка: так они не разъезжаются
// с языком страницы, и склонять их вручную не приходится
const monthText2 = (m) => {
  const [y, mo] = String(m).split('-');
  const n = Number(mo);
  if (!Number.isFinite(n) || n < 1 || n > 12 || !y) return String(m);
  // Год дописываем сами: Intl с {year:'numeric'} в русской локали даёт
  // «май 2026 г.», а прежние списки месяцев — «май 2026». Вид подписи не
  // должен меняться от перевода
  const month = new Date(Date.UTC(Number(y), n - 1, 1)).toLocaleDateString(intlLocale(), {
    month: 'long',
    timeZone: 'UTC',
  });
  return `${month} ${y}`;
};


// Yahoo за три месяца отдаёт ~450 часовых свечей. На телефоне 400 из них — это
// 0,7 px на свечу, уже не читается. Поэтому лишние отрезаются с начала ряда:
// свежие свечи важнее старых, а склейка превратила бы часовую свечу в двухчасовую
export function trimSeries(candles, max) {
  return candles.length > max ? candles.slice(candles.length - max) : candles;
}

// Сколько свечей рисовать. Считается не «сколько влезет», а сколько нужно, чтобы
// свеча читалась: тело занимает 62% шага, и при шаге меньше четырёх пикселей оно
// сливается с тенью — график превращается в частокол, а последняя свеча, ради
// которой на него и смотрят, теряется среди соседних.
//   карточка сетки — ~380 px по ширине: 60 свечей дают шаг 6,3 px;
//   полная страница — ~940 px: 120 свечей дают шаг 7,8 px, как у finviz.
// Ряд при этом запрашивается длиннее: таблицы под графиком считаются по всем
// свечам, обрезается только картинка
export const CANDLES_CARD = 60;
export const CANDLES_FULL = 120;

// «253 свечей» не согласуется: форма слова зависит от последней цифры, а в
// подписи графика число меняется вместе с интервалом
const candleWord = (n) => numPlural(n, t('свеча'), t('свечи'), t('свечей'));

export function svgCandles(candles, { width = 720, height = 220 } = {}) {
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
    <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="${esc(t('График свечами, {n} {candles}', { n: candles.length, candles: candleWord(candles.length) }))}">
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
  t(SOURCE_LABEL[source]) ||
  (asset.market === 'RU' ? t('Мосбиржи (ISS)') : asset.market === 'US' ? 'CNBC' : t('CoinGecko или Binance'));

// Ссылки интервалов: текущий помечен, адрес без параметра равен дневному графику,
// чтобы поисковик не увидел девять копий одной страницы.
// Якорь #chart нужен запасному пути: если скрипт не сработал, ссылка честно
// перезагрузит страницу, и без него человек оказался бы у шапки, а не у графика
function tfBar(market, active, canonicalPath) {
  const base = canonicalPath || '';
  const items = tfList(market).map((tf) => {
    const params = tf !== DEFAULT_TF ? `?tf=${tf}` : '';
    // Адрес строится в языке текущего запроса и несёт якорь: без него переход
    // по ссылке без JS оставил бы человека у шапки страницы
    const href = `${esc(L(base + params))}#chart`;
    const on = tf === active;
    // data-tf — для скрипта: он перехватывает нажатие и подменяет блок без
    // перезагрузки. href остаётся настоящим: без JS и для поисковика работает он
    return `<a class="period${on ? ' on' : ''}" href="${href}" data-tf="${esc(tf)}"${on ? ' aria-current="page"' : ''}>${esc(t(TIMEFRAMES[tf].label))}</a>`;
  }).join('');
  return `<nav class="periods tf-bar" aria-label="${esc(t('Интервал свечей'))}">${items}</nav>`;
}

// Внутренность блока: всё, что меняется при переключении интервала. Вынесено
// из chartBlock, чтобы сервер мог отдать ровно этот кусок на запрос скрипта
export function chartInner({ asset, rec, series, tf = DEFAULT_TF, canonicalPath = '' }) {
  const meta = TIMEFRAMES[tf] || TIMEFRAMES[DEFAULT_TF];
  const isDaily = Boolean(meta.daily);
  const cur = rec?.currency || (asset.market === 'US' || asset.market === 'CRYPTO' ? 'USD' : 'RUB');

  // Окно не настраивается отдельно: ряд приходит уже в нужном объёме, и
  // единственное, что его ограничивает, — предел различимости на графике
  const candles = (series?.candles || []).filter((c) => Array.isArray(c) && c.length >= 5);

  const stamp = stampFormatter(series?.tz, tf);
  const market = asset.market;

  // Внутридневные точки не кешируются на диск: подпись честно говорит,
  // когда ряд пришёл, — по ней видно, насколько он свежий
  const stampText = isDaily
    ? rec?.at
      ? esc(t('по {date}', { date: dayText(String(candles[candles.length - 1]?.[0] || '').slice(0, 10)) }))
      : esc(t('данные ещё не собраны'))
    : series?.fetchedAt
      ? esc(t('запрос {time}', { time: fmtClock(series.fetchedAt, series.tz) }))
      : esc(t('нет данных'));

  const head = (inner) => `
        <div class="head">
          <h2>${esc(t('График {symbol}: свечи {tf}', { symbol: asset.symbol, tf: t(meta.label).toLowerCase() }))}</h2>
          <span class="meta-stamp">${stampText}</span>
        </div>
        ${tfBar(market, tf, canonicalPath)}
        ${inner}`;

  if (candles.length < 2) {
    return head(
      `<p class="chart-empty">${esc(t('За этот интервал данных нет — источник их не отдаёт или история короче. Выберите другой интервал.'))}</p>`
    );
  }

  // Отрезаем старое, а не склеиваем: годовой дневной ряд длиннее того, что
  // читается на графике, а свёрнутая вдвое дневная свеча уже не дневная.
  // Числа считаем по показанному окну: «максимум» на подписи под графиком
  // должен относиться к тому, что человек видит, а не к отрезанной части
  const drawn = trimSeries(candles, CANDLES_FULL);

  const first = drawn[0];
  const lastC = drawn[drawn.length - 1];
  const openFirst = Number(first[1]);
  const closeLast = Number(lastC[4]);
  const changePct = openFirst ? ((closeLast - openFirst) / openFirst) * 100 : null;
  const changeAbs = closeLast - openFirst;

  let hi = drawn[0];
  let lo = drawn[0];
  for (const c of drawn) {
    if (Number(c[2]) > Number(hi[2])) hi = c;
    if (Number(c[3]) < Number(lo[3])) lo = c;
  }

  const cls = changeAbs >= 0 ? 'up' : 'down';

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
    ? `<table class="idx-table"><thead><tr><th>${esc(t('Месяц'))}</th><th class="num">${esc(t('Закрытие'))}</th></tr></thead><tbody>${rows}</tbody></table>`
    : `<table class="idx-table"><thead><tr><th>${esc(t('Свеча'))}</th><th class="num">${esc(t('Открытие'))}</th><th class="num">${esc(t('Максимум'))}</th><th class="num">${esc(t('Минимум'))}</th><th class="num">${esc(t('Закрытие'))}</th></tr></thead><tbody>${rows}</tbody></table>`;

  const sourceText = sourceLabel(series?.source || rec?.source, asset);
  const tzText = series?.tz ? ' ' + esc(t('Время: {tz}.', { tz: t(TZ_TEXT[series.tz] || series.tz) })) : '';
  // Ряд длиннее предела различимости обрезан: об этом сказано прямо, иначе
  // человек решит, что история бумаги начинается с этой даты
  const cutText = candles.length > drawn.length
    ? ' ' + esc(t('Показаны последние {shown} свечей из {total}.', { shown: drawn.length, total: candles.length }))
    : '';

  return head(`
        <div class="chart-facts">
          <div><span>${esc(t('Последнее закрытие'))}</span><b>${esc(fmtPrice(closeLast, cur))}</b></div>
          <div><span>${esc(t('Изменение на графике'))}</span><b class="${cls}">${esc(fmtChange(changeAbs, cur))} (${esc(fmtPct(changePct))})</b></div>
          <div><span>${esc(t('Максимум'))}</span><b>${esc(fmtPrice(hi[2], cur))}</b></div>
          <div><span>${esc(t('Минимум'))}</span><b>${esc(fmtPrice(lo[3], cur))}</b></div>
        </div>
        <div class="chart${isDaily ? '' : ' chart-intraday'}">
          ${svgCandles(drawn)}
          <div class="chart-axis">
            <span>${esc(stamp(first[0]))} — ${esc(fmtPrice(first[1], cur))}</span>
            <span>${esc(stamp(lastC[0]))} — ${esc(fmtPrice(closeLast, cur))}</span>
          </div>
          <div class="chart-axis chart-axis-mid">
            <span>${esc(t('максимум {when}: {value}', { when: stamp(hi[0]), value: fmtPrice(hi[2], cur) }))}</span>
            <span>${esc(t('минимум {when}: {value}', { when: stamp(lo[0]), value: fmtPrice(lo[3], cur) }))}</span>
          </div>
        </div>
        <details class="chart-table">
          <summary>${esc(isDaily ? t('Закрытия по месяцам') : t('Последние свечи'))}</summary>
          ${table}
        </details>
        <p class="warn">${esc(t('Свечи {tf} по данным {source}.', { tf: t(meta.label).toLowerCase(), source: sourceText }))}${tzText}${cutText} ${esc(
          isDaily
            ? t('Это не котировка в реальном времени: последняя свеча — итог последнего торгового дня.')
            : t('Внутридневной ряд запрашивается при показе страницы и может отставать от биржи на минуту.')
        )}</p>`);
}

// Обёртка блока. data-live и пара market/symbol нужны скрипту: по ним он
// понимает, куда просить новый ряд, и не собирает адрес из ничего
export const chartBlock = ({ asset, rec, series, tf = DEFAULT_TF, canonicalPath = '' }) => `
      <section class="card chart-card" id="chart" data-live="ticker" data-market="${esc(asset.market)}" data-symbol="${esc(asset.symbol)}" data-tf="${esc(tf)}" data-default-tf="${esc(DEFAULT_TF)}">
        ${chartInner({ asset, rec, series, tf, canonicalPath })}
      </section>`;

// Подпись зоны человеческим языком: «UTC» вместо названия биржи читается понятнее
const TZ_TEXT = { 'Europe/Moscow': 'московское', 'America/New_York': 'нью-йоркское', UTC: 'UTC', ET: 'нью-йоркское' };

function fmtClock(iso, tz) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat(intlLocale(), {
    timeZone: tz || 'UTC',
    hour: '2-digit',
    minute: '2-digit',
    day: 'numeric',
    month: 'short',
  }).format(d);
}
