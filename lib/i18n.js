// Языковые версии сайта. У каждого языка свой префикс — /ru/, /en/, /es/ — и
// ни один не является «адресом по умолчанию». Русский живёт без префикса с
// самого запуска, и старые адреса продолжают работать: сервер отвечает на них
// 301 на /ru/. Так у всех трёх версий одинаковый вид адреса, и переключатель
// не делает вид, что русская страница «не имеет» языка.
//
// Поисковик не исполняет JS, поэтому язык — это адрес, а не настройка в браузере:
// страница на испанском должна существовать отдельным URL, иначе её нет в индексе.
//
// Ключ словаря — сам русский текст. Придуманные имена ключей пришлось бы держать
// в трёх файлах и сверять; здесь сверять нечего: пропущенная строка просто
// остаётся русской, а не превращается в «nav.ctalog» на живой странице.

import { AsyncLocalStorage } from 'node:async_hooks';
import en from './langs/en.js';
import es from './langs/es.js';

export const LANGS = ['ru', 'en', 'es'];
export const DEFAULT_LANG = 'ru';

// Названия языков пишутся на самом языке: человек ищет «Español», а не «Spanish»
export const LANG_LABEL = { ru: 'Русский', en: 'English', es: 'Español' };
// Код для угла шапки: полное название там занимает место, а код понятен и
// совпадает с префиксом адреса. Список названий в меню — уже на своём языке,
// чтобы человек узнал родной без перевода
export const LANG_CODE = { ru: 'RU', en: 'EN', es: 'ES' };
// og:locale требует территорию, hreflang — только язык
export const OG_LOCALE = { ru: 'ru_RU', en: 'en_US', es: 'es_ES' };
// Как язык называется внутри текста: «сводка на русском»
export const LANG_IN = { ru: 'на русском', en: 'in English', es: 'en español' };

export const isLang = (l) => LANGS.includes(l);
export const normLang = (l) => (isLang(l) ? l : DEFAULT_LANG);

// Разбор адреса на язык и путь. Префикса нет — считаем русским: так выглядят
// старые ссылки, и сервер уводит их на /ru/ отдельным 301, а этот разбор нужен,
// чтобы ответить на них, а не упасть в 404.
export function langFromPath(pathname) {
  const m = /^\/(en|es|ru)(\/.*)?$/.exec(pathname || '');
  if (!m) return { lang: DEFAULT_LANG, path: pathname || '/' };
  return { lang: m[1], path: m[2] || '/' };
}

// Адрес в нужном языке. Ведущий слэш обязателен: все внутренние ссылки сайта
// начинаются с него, и склеивать префикс с относительным путём не приходится.
// Главная — /ru без слэша, а не /ru/: так canonical и ссылки в меню совпадают
// посимвольно, и поисковик не видит двух адресов одной страницы
export function href(lang, path = '/') {
  const p = path.startsWith('/') ? path : `/${path}`;
  const l = normLang(lang);
  if (p === '/') return `/${l}`;
  // «/?tab=us» — та же главная с параметром: префикс ставится перед слэшем,
  // иначе вышел бы /ru/?tab=us рядом с /ru?tab=us
  if (p.startsWith('/?')) return `/${l}${p.slice(1)}`;
  return `/${l}${p}`;
}

// Один и тот же смысл в трёх адресах — для hreflang. x-default указывает на
// русскую версию: это основной язык сайта, и поисковик должен вести туда того,
// чей язык не совпал ни с одним из перечисленных
export function alternates(siteUrl, path = '/') {
  const out = LANGS.map((l) => ({ lang: l, url: siteUrl + href(l, path) }));
  out.push({ lang: 'x-default', url: siteUrl + href(DEFAULT_LANG, path) });
  return out;
}

// Словари. Русский словарь пуст по определению: его ключ и есть перевод
const DICT = { ru: {}, en: {}, es: {} };

// Текущий язык рендера. В запросе есть await (источники, сводка, свечи), поэтому
// одна переменная на процесс протекла бы: пока один запрос ждёт сеть, другой уже
// выставил свой язык, и первый отрисовался бы на чужом. AsyncLocalStorage хранит
// значение применительно к цепочке промисов запроса, а не ко всему процессу.
// Протаскивать lang через сорок функций рендера значило бы менять каждую
// подпись и каждый вызов ради одного значения
const store = new AsyncLocalStorage();
const current = () => store.getStore()?.lang || DEFAULT_LANG;

export const getLang = current;

// Путь текущего запроса без языкового префикса: нужен переключателю языка,
// чтобы ссылка вела на ту же страницу, а не на главную
export const currentPath = () => store.getStore()?.path || '/';

// Язык и путь ставятся на весь запрос сразу после разбора адреса, до отрисовки
export const withLang = (lang, fn, path = '/') => store.run({ lang: normLang(lang), path }, fn);

// Адрес в языке текущего запроса: шаблоны не знают, в каком языке их рисуют,
// и не должны об этом спрашивать — им нужна только ссылка
export const L = (path = '/') => href(current(), path);

// Перевод строки. Подстановки — в фигурных скобках: «обновлено {when}».
// Нет перевода — возвращаем русский ключ как есть; страница остаётся читаемой,
// и на живом сайте видно, что именно забыли перевести
export function t(key, vars) {
  const s = DICT[current()][key] ?? key;
  if (!vars) return s;
  return String(s).replace(/\{(\w+)\}/g, (m, k) => (vars[k] === undefined ? m : String(vars[k])));
}

// Формы множественного числа вызывающий код передаёт уже переведёнными:
// plural(n, t('публикация'), t('публикации'), t('публикаций')). В английском
// и испанском третья форма не нужна — там двухформенное правило ниже,
// поэтому «публикации» и «публикаций» просто совпадают в словаре.
export const plural = (n, one, few, many) => {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (current() !== 'ru') return Math.abs(n) === 1 ? one : few;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
};

// Даты и числа: 'ru-RU', 'en-US', 'es-ES'. Пояс у каждого рынка свой, поэтому
// локализуется только оформление, а не момент времени
export const intlLocale = (lang = current()) =>
  ({ ru: 'ru-RU', en: 'en-US', es: 'es-ES' }[normLang(lang)] || 'ru-RU');

export const fmtNum = (n, opts) => Number(n).toLocaleString(intlLocale(), opts);

const fmtDate = (d, opts) => new Date(d).toLocaleString(intlLocale(), opts);

// Относительное время — самая заметная строка на странице, и по-английски
// «3 ч назад» выглядит поломкой. Формы заданы словарём, а не склейкой
export function fmtRelative(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 60000;
  if (diff < 1) return t('только что');
  if (diff < 60) return t('{n} мин назад', { n: Math.round(diff) });
  if (diff < 1440) return t('{n} ч назад', { n: Math.round(diff / 60) });
  return fmtDate(d, { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
}

export const fmtFull = (iso) =>
  iso && !Number.isNaN(Date.parse(iso))
    ? fmtDate(iso, { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '';

export const fmtDay = (iso) =>
  iso && !Number.isNaN(Date.parse(iso)) ? fmtDate(iso, { day: 'numeric', month: 'long', year: 'numeric' }) : '';

// Регистрация словаря отдельным вызовом: файлы языков импортируются в i18n.js
// ниже, и порядок инициализации не должен зависеть от того, кто первый позвал t()
export function defineDict(lang, pack) {
  if (!isLang(lang)) throw new Error(`неизвестный язык словаря: ${lang}`);
  DICT[lang] = pack;
}

// Словари подключаются в конце файла: defineDict объявлена выше, а файлы языков
// не должны знать о существовании i18n.js, чтобы не получился цикл импорта
export const dictKeys = (lang) => Object.keys(DICT[normLang(lang)] || {});
export const ruKeys = () => Object.keys(DICT.ru || {});

defineDict('en', en);
defineDict('es', es);
