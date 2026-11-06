// Таблица на главной: тикеры по капитализации, с вкладками по рынкам.
// Как и всё остальное на сайте, собирается на сервере, а вкладки — обычные
// ссылки `?tab=us`: поисковик не исполняет JS, а человеку незачем ждать
// скрипт, чтобы увидеть список.

import { esc, niceName, tickerPath } from './render.js';
import { t, L, intlLocale, fmtNum } from './i18n.js';
import { fmtPrice } from './chart-render.js';
import { normalizePoints } from './charts.js';

// Вкладки названы так, как их ищут, и совпадают с разделами каталога
export const HOME_TABS = [
  { key: 'all', label: 'Все', markets: ['RU', 'US', 'CRYPTO'] },
  { key: 'us', label: 'США', markets: ['US'] },
  { key: 'ru', label: 'Акции РФ', markets: ['RU'] },
  { key: 'crypto', label: 'Крипта', markets: ['CRYPTO'] },
];

export const isTab = (key) => HOME_TABS.some((x) => x.key === key);
export const tabByKey = (key) => HOME_TABS.find((x) => x.key === key) || HOME_TABS[0];

// Сколько строк показывать. Обрезать список по счёту нельзя: крупнейшая бумага
// Мосбиржи стоит в общей сортировке около 120-го места, и потолок в сотню
// строк вырезал бы весь российский рынок из вкладки «Все». Строк немного,
// каждая — ссылка, которая нужна и человеку, и индексу
const ROWS = 250;

// Короткие подписи в колонке рынка: «Акции Мосбиржи» туда не влезает
const MARKET_TAG = { RU: 'РФ', US: 'США', CRYPTO: 'крипта' };
const marketTag = (m) => t(MARKET_TAG[m] || m);

// Капитализации отличаются на семь порядков: у биткоина триллион, у мелкой
// бумаги сотни миллионов. Писать их одним числом бессмысленно
function fmtCap(usd) {
  const v = Number(usd);
  if (!Number.isFinite(v) || v <= 0) return '—';
  if (v >= 1e12) return `$${fmtNum(v / 1e12, { maximumFractionDigits: 2 })} ${t('трлн')}`;
  if (v >= 1e9) return `$${fmtNum(v / 1e9, { maximumFractionDigits: 1 })} ${t('млрд')}`;
  return `$${fmtNum(v / 1e6, { maximumFractionDigits: 0 })} ${t('млн')}`;
}

const pct = (n) =>
  `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toLocaleString(intlLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;

// Цена и изменение за день берутся из дневного ряда, который уже лежит в файле
// графиков: отдельный запрос за котировками не нужен, а расхождение с ценой
// на странице тикера исключено — там тот же ряд. Свеча — массив
// [время, open, high, low, close], поэтому закрытие лежит по индексу 4
function lastTwo(rec) {
  const points = normalizePoints(rec?.points);
  if (!points.length) return null;
  const last = points[points.length - 1];
  const prev = points.length > 1 ? points[points.length - 2] : null;
  const close = Number(last[4]);
  if (!Number.isFinite(close)) return null;
  const prevClose = prev ? Number(prev[4]) : null;
  const changePct = prevClose ? ((close - prevClose) / prevClose) * 100 : null;
  return { close, changePct, currency: rec.currency || (rec.market === 'RU' ? 'RUB' : 'USD') };
}

export function rankRows({ groups, charts = {}, markets, live = {} }) {
  const rows = [];
  for (const m of markets) {
    for (const a of groups[m] || []) {
      const rec = charts[`${a.market}:${a.symbol}`] || null;
      const l = live[`${a.market}:${a.symbol}`];
      // Живая цена важнее дневного закрытия: строка с вчерашней ценой рядом с
      // сегодняшней на странице тикера — это два разных числа об одном активе
      rows.push({
        asset: a,
        cap: Number.isFinite(a.capUsd) ? a.capUsd : null,
        quote: l
          ? { close: l.price, changePct: l.pct, currency: a.market === 'RU' ? 'RUB' : 'USD' }
          : lastTwo(rec),
      });
    }
  }
  // Сортировка по капитализации, а без неё — по названию: пустые значения
  // не должны всплывать наверх и не должны пропадать
  rows.sort((x, y) => {
    if (x.cap != null && y.cap != null) return y.cap - x.cap;
    if (x.cap != null) return -1;
    if (y.cap != null) return 1;
    return String(x.asset.name).localeCompare(String(y.asset.name), intlLocale());
  });
  return rows;
}

// Подпись вкладки: в словаре она лежит как ключ, а не как метка в HOME_TABS —
// иначе английская версия показывала бы «США» латиницей рядом с русским словом
const tLabel = (tab) => t(tab.label);

export function homeRank({ groups, charts = {}, usdRate = null, tab = 'all', live = {} }) {
  const current = tabByKey(tab);
  const rows = rankRows({ groups, charts, markets: current.markets, live });
  const shown = rows.slice(0, ROWS);
  const total = rows.length;

  const tabs = HOME_TABS.map((t) => {
    const n = t.markets.reduce((sum, m) => sum + (groups[m] || []).length, 0);
    const on = t.key === current.key;
    return `<a class="tab${on ? ' on' : ''}" href="${L(t.key === 'all' ? '/' : `/?tab=${t.key}`)}"${
      on ? ' aria-current="page"' : ''
    }>${esc(tLabel(t))} <span>${n}</span></a>`;
  }).join('');

  const body = shown
    .map((r, i) => {
      const a = r.asset;
      const q = r.quote;
      // Ноль — не рост: зелёный цвет на «0,00%» врёт о направлении
      const dir = q && q.changePct != null ? (q.changePct > 0 ? 'up' : q.changePct < 0 ? 'down' : 'flat') : 'flat';
      // data-rt-f стоит на самом span: направление — его класс, и подменять
      // нужно там же, где стоит цвет, а не на ячейке
      const chg =
        q && q.changePct != null
          ? `<span class="${dir}" data-rt-f="p">${esc(pct(q.changePct))}</span>`
          : '<span class="flat">—</span>';
      return `<tr data-rt="${esc(`${a.market}:${a.symbol}`)}">
        <td class="rk">${i + 1}</td>
        <td class="nm"><a href="${L(tickerPath(a))}">${esc(niceName(a.name))}</a> <span class="sym">${esc(a.symbol)}</span></td>
        <td class="mk"><span class="tag ${esc(a.market)}">${esc(marketTag(a.market))}</span></td>
        <td class="num px" data-rt-f="m">${q ? esc(fmtPrice(q.close, q.currency)) : '—'}</td>
        <td class="num chg">${chg}</td>
        <td class="num cap">${esc(fmtCap(r.cap))}</td>
      </tr>`;
    })
    .join('');

  const rest =
    total > shown.length
      ? `<p class="sub" style="margin:12px 0 0">${esc(t('Показаны первые {shown} из {total}.', { shown: shown.length, total }))} <a href="${L('/catalog' + (current.key === 'all' ? '' : `/${current.key}`))}">${esc(t('каталоге по алфавиту'))}</a>.</p>`
      : '';

  return `
    <section class="rank" id="rank">
      <nav class="tabs">${tabs}</nav>
      <div class="rank-scroll">
      <table class="rank-table">
        <thead><tr>
          <th class="rk">#</th><th>${esc(t('Название'))}</th><th class="mk">${esc(t('Рынок'))}</th>
          <th class="num">${esc(t('Цена'))}</th><th class="num">${esc(t('За день'))}</th><th class="num">${esc(t('Капитализация'))}</th>
        </tr></thead>
        <tbody>${body}</tbody>
      </table>
      </div>
      ${rest}
      <p class="rank-src">${esc(usdRate
        ? t('Цена — последняя сделка, капитализация — по числу акций в выпуске, в долларах по курсу {rate} ₽. Капитализация пересчитывается раз в сутки, курс доллара — вместе с ней. Не инвестиционная рекомендация.', { rate: fmtNum(usdRate, { maximumFractionDigits: 2 }) })
        : t('Цена — последняя сделка, капитализация — по числу акций в выпуске. Капитализация пересчитывается раз в сутки. Не инвестиционная рекомендация.'))}</p>
    </section>`;
}
