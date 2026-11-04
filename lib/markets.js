// Биржевые инструменты для страницы «Графики»: индексы, облигации, энергия,
// металлы и валюты. Это не тикеры каталога — у них нет ни сводок новостей,
// ни форума, поэтому они живут отдельным модулем и своим списком.
//
// Источника два, и разделение не случайное:
// - Мосбиржа (ISS) отдаёт и свечи, и текущую цену по индексам, ОФЗ и валютным
//   парам, причём нативно понимает минутки, час, день, неделю и месяц.
// - CNBC отдаёт то, чего у Мосбиржи нет: американские доходности, товары,
//   мировые индексы и валютные пары. Свечи у него задаются пресетом, а не шагом:
//   1D — минутки, 5D — пятиминутки, 1Y и длиннее — дни и недели.

import { get } from './http.js';
import { t, intlLocale } from './i18n.js';
import { makeCandle, aggregate, weekOf, moexRows, moexEpoch } from './charts.js';

const MOEX_ISS = 'https://iss.moex.com/iss/engines';
const CNBC_CHART = 'https://ts-api.cnbc.com/harmony/app/charts';
const CNBC_QUOTE = 'https://quote.cnbc.com/quote-html-webservice/restQuote';

// Категории — вкладки страницы. «Все» идёт первой, как в горизонтальном меню
// любых котировок: это точка входа, остальные — уточнение
export const CATS = [
  { key: 'all', label: 'Все', title: 'Все рынки', lead: 'Главный инструмент каждой категории' },
  { key: 'indices', label: 'Индексы', title: 'Индексы', lead: 'Мосбиржа и мировые площадки' },
  { key: 'bonds', label: 'Бонды', title: 'Облигации и доходности', lead: 'ОФЗ и ставки казначейств' },
  { key: 'energy', label: 'Энергия', title: 'Энергия', lead: 'Нефть, газ и нефтепродукты' },
  { key: 'metals', label: 'Металлы', title: 'Металлы', lead: 'Золото, серебро, платина, медь' },
  { key: 'currencies', label: 'Валюты', title: 'Валюты', lead: 'Рублёвые пары и доллар к миру' },
];

export const isCat = (k) => CATS.some((c) => c.key === k);

// Единица важнее названия: от неё зависит и формат цены, и подпись оси.
//   pct — проценты (доходности облигаций), money — цена в валюте, pts — пункты
//   индекса, fx — курс, где нужны четыре знака, а не два
//
// moex — путь к свечам Мосбиржи: движок и рынок различаются у индексов,
// облигаций и валюты, поэтому хранятся в записи, а не угадываются по категории.
// slug — адрес страницы инструмента, what — текст «что это» на ней, поэтому
// оба поля стоят в конце: строка таблицы читается слева направо, и описания
// в её середине разрывали бы сравнение соседних записей.
// indexSlug — страница подробностей индекса, если она есть.
export const INSTRUMENTS = [
  // ---------------------------------------------------------------- индексы
  { key: 'IMOEX', cat: 'indices', name: 'Индекс Мосбиржи', short: 'Мосбиржа', source: 'moex', moex: { engine: 'stock', market: 'index' }, code: 'IMOEX', unit: 'pts', tz: 'Europe/Moscow', indexSlug: 'imoex', slug: 'imoex',
    what: 'Основной рублёвый индекс Мосбиржи: самые ликвидные акции российского рынка, взвешенные по капитализации во free-float. По нему судят о рынке в целом, а не об отдельных бумагах.' },
  { key: 'RTSI', cat: 'indices', name: 'Индекс РТС', short: 'РТС', source: 'moex', moex: { engine: 'stock', market: 'index' }, code: 'RTSI', unit: 'pts', tz: 'Europe/Moscow', indexSlug: 'rts', slug: 'rts',
    what: 'Тот же набор акций Мосбиржи, но посчитанный в долларах. Растёт и падает вместе с рублём к доллару, поэтому расходится с IMOEX ровно на величину курса.' },
  { key: 'MOEXBC', cat: 'indices', name: 'Голубые фишки', short: 'Голубые фишки', source: 'moex', moex: { engine: 'stock', market: 'index' }, code: 'MOEXBC', unit: 'pts', tz: 'Europe/Moscow', indexSlug: 'moexbc', slug: 'moexbc',
    what: 'Индекс голубых фишек: пятнадцать самых ликвидных бумаг Мосбиржи с равными весами. Показывает, что делают крупнейшие компании, не давая мелким исказить картину.' },
  { key: 'MOEXOG', cat: 'indices', name: 'Индекс нефти и газа', short: 'Нефть и газ', source: 'moex', moex: { engine: 'stock', market: 'index' }, code: 'MOEXOG', unit: 'pts', tz: 'Europe/Moscow', slug: 'moexog',
    what: 'Отраслевой индекс нефтегазового сектора: Газпром, Роснефть, Лукойл, Новатэк и их соседи по отрасли.' },
  { key: 'MOEXFN', cat: 'indices', name: 'Индекс финансов', short: 'Финансы', source: 'moex', moex: { engine: 'stock', market: 'index' }, code: 'MOEXFN', unit: 'pts', tz: 'Europe/Moscow', slug: 'moexfn',
    what: 'Отраслевой индекс финансового сектора Мосбиржи: банки, брокеры и сама биржа. Сильнее рынка реагирует на ключевую ставку.' },
  { key: '.SPX', cat: 'indices', name: 'S&P 500', short: 'S&P 500', source: 'cnbc', code: '.SPX', unit: 'pts', tz: 'America/New_York', indexSlug: 'sp500', slug: 'sp500',
    what: 'Пятьсот крупнейших компаний США — главный ориентир мировых рынков. Управляющие фондов сравнивают доходность именно с ним, поэтому он двигает деньги по всему миру.' },
  { key: '.IXIC', cat: 'indices', name: 'NASDAQ Composite', short: 'NASDAQ', source: 'cnbc', code: '.IXIC', unit: 'pts', tz: 'America/New_York', indexSlug: 'nasdaq', slug: 'nasdaq',
    what: 'Все акции, торгуемые на NASDAQ. Сильнее остальных индексов США зависит от технологических компаний, поэтому растёт и падает резче.' },
  { key: '.DJI', cat: 'indices', name: 'Dow Jones', short: 'Dow Jones', source: 'cnbc', code: '.DJI', unit: 'pts', tz: 'America/New_York', indexSlug: 'dowjones', slug: 'dow-jones',
    what: 'Тридцать крупнейших компаний США, взвешенных по цене акции, а не по капитализации. Старейший из индексов Dow Jones, поэтому дорогая бумага в нём весит больше крупной.' },
  { key: '.NDX', cat: 'indices', name: 'NASDAQ 100', short: 'NASDAQ 100', source: 'cnbc', code: '.NDX', unit: 'pts', tz: 'America/New_York', slug: 'nasdaq-100',
    what: 'Сто крупнейших нефинансовых компаний NASDAQ. На него выпущены фьючерсы и биржевые фонды, поэтому движение индекса известно заранее — по контрактам.' },
  { key: '.VIX', cat: 'indices', name: 'Индекс волатильности VIX', short: 'VIX', source: 'cnbc', code: '.VIX', unit: 'pts', tz: 'America/New_York', indexSlug: 'vix', slug: 'vix',
    what: 'Ожидаемая волатильность S&P 500 на тридцать дней вперёд, посчитанная по ценам опционов. Растёт, когда рынок боится, и падает, когда всё спокойно, — его называют индексом страха.' },
  { key: '.N225', cat: 'indices', name: 'Nikkei 225', short: 'Nikkei', source: 'cnbc', code: '.N225', unit: 'pts', tz: 'Asia/Tokyo', slug: 'nikkei-225',
    what: '225 крупнейших компаний Токийской биржи, взвешенных по цене акции. Основной индикатор японского рынка.' },
  { key: '.GDAXI', cat: 'indices', name: 'DAX', short: 'DAX', source: 'cnbc', code: '.GDAXI', unit: 'pts', tz: 'Europe/Berlin', slug: 'dax',
    what: 'Сорок крупнейших компаний Германии на Франкфуртской бирже. Ведущий индекс крупнейшей экономики Европы.' },
  { key: '.HSI', cat: 'indices', name: 'Hang Seng', short: 'Hang Seng', source: 'cnbc', code: '.HSI', unit: 'pts', tz: 'Asia/Hong_Kong', slug: 'hang-seng',
    what: 'Компании Гонконгской биржи, включая бумаги материкового Китая. Показывает, что происходит с китайским рынком для внешних инвесторов.' },
  { key: '.FTSE', cat: 'indices', name: 'FTSE 100', short: 'FTSE 100', source: 'cnbc', code: '.FTSE', unit: 'pts', tz: 'Europe/London', slug: 'ftse-100',
    what: 'Сто крупнейших компаний Лондонской биржи. У многих выручка в долларах, поэтому индекс чувствителен к курсу фунта, а не только к делам компаний.' },

  // ---------------------------------------------------------------- бонды
  // RGBI — индекс цен ОФЗ, а отдельные выпуски показывают, что происходит
  // с длинным и коротким концом кривой. Доходности США и Европы — ориентир,
  // с которым российский рынок сравнивают постоянно
  // ОФЗ на Мосбирже котируются не в рублях, а в процентах от номинала:
  // «83,40» означает 83,4% номинала, а не 83 рубля 40 копеек. Рубли в подписи
  // были бы ошибкой на порядок, поэтому у них своя единица
  { key: 'RGBI', cat: 'bonds', name: 'Индекс гособлигаций RGBI', short: 'RGBI', source: 'moex', moex: { engine: 'stock', market: 'index' }, code: 'RGBI', unit: 'pts', tz: 'Europe/Moscow', indexSlug: 'rgbia', slug: 'rgbi',
    what: 'Индекс цен государственных облигаций Мосбиржи. Растёт, когда доходности ОФЗ падают: у облигации это две стороны одной величины.' },
  { key: 'SU26238RMFS4', cat: 'bonds', name: 'ОФЗ 26238', short: 'ОФЗ 26238', source: 'moex', moex: { engine: 'stock', market: 'bonds' }, code: 'SU26238RMFS4', unit: 'nom', tz: 'Europe/Moscow', slug: 'ofz-26238',
    what: 'ОФЗ с постоянным купоном, погашение в 2041 году. Самый длинный выпуск из трёх здесь, поэтому на изменение ставки он реагирует сильнее всех.' },
  { key: 'SU26254RMFS1', cat: 'bonds', name: 'ОФЗ 26254', short: 'ОФЗ 26254', source: 'moex', moex: { engine: 'stock', market: 'bonds' }, code: 'SU26254RMFS1', unit: 'nom', tz: 'Europe/Moscow', slug: 'ofz-26254',
    what: 'ОФЗ с постоянным купоном, выпуск 2025 года. Новый длинный выпуск: истории меньше, чем у соседей по вкладке.' },
  { key: 'SU26252RMFS5', cat: 'bonds', name: 'ОФЗ 26252', short: 'ОФЗ 26252', source: 'moex', moex: { engine: 'stock', market: 'bonds' }, code: 'SU26252RMFS5', unit: 'nom', tz: 'Europe/Moscow', slug: 'ofz-26252',
    what: 'ОФЗ с постоянным купоном, погашение в 2035 году. Средний срок — средняя чувствительность к ставке.' },
  { key: 'US10Y', cat: 'bonds', name: 'Доходность 10-летних США', short: 'США 10 лет', source: 'cnbc', code: 'US10Y', unit: 'pct', tz: 'America/New_York', slug: 'us10y',
    what: 'Доходность десятилетних казначейских бумаг США — та ставка, от которой считается стоимость денег в мире. Растёт, когда рынок ждёт инфляции или ужесточения ФРС.' },
  { key: 'US2Y', cat: 'bonds', name: 'Доходность 2-летних США', short: 'США 2 года', source: 'cnbc', code: 'US2Y', unit: 'pct', tz: 'America/New_York', slug: 'us2y',
    what: 'Доходность двухлетних бумаг США. Стоит ближе к решению ФРС, чем десятилетка, поэтому раньше отзывается на изменение ключевой ставки.' },
  { key: 'US30Y', cat: 'bonds', name: 'Доходность 30-летних США', short: 'США 30 лет', source: 'cnbc', code: 'US30Y', unit: 'pct', tz: 'America/New_York', slug: 'us30y',
    what: 'Доходность тридцатилетних бумаг США. Отражает ожидания к инфляции на длинном горизонте и доверие к госдолгу.' },
  { key: 'DE10Y', cat: 'bonds', name: 'Доходность 10-летних Германии', short: 'Германия 10 лет', source: 'cnbc', code: 'DE10Y', unit: 'pct', tz: 'Europe/Berlin', slug: 'de10y',
    what: 'Доходность десятилетних облигаций Германии — безрисковая ставка еврозоны. Спред к ней считают для любого европейского долга.' },
  { key: 'GB10Y', cat: 'bonds', name: 'Доходность 10-летних Британии', short: 'Британия 10 лет', source: 'cnbc', code: 'GB10Y', unit: 'pct', tz: 'Europe/London', slug: 'gb10y',
    what: 'Доходность десятилетних облигаций Британии. Растёт, когда рынок ждёт повышения ставки Банка Англии или ускорения инфляции.' },

  // ---------------------------------------------------------------- энергия
  // Фьючерсы CNBC, а не спот: у них есть непрерывный ряд и понятный контракт
  { key: '@CL.1', cat: 'energy', name: 'Нефть WTI', short: 'WTI', source: 'cnbc', code: '@CL.1', unit: 'usd', tz: 'America/New_York', slug: 'wti',
    what: 'Нефть WTI: лёгкая малосернистая нефть с поставкой в Кушинг, штат Оклахома. Североамериканский эталон цены на нефть.' },
  // Brent берём у ICE: у NYMEX-контракта @BZ.1 CNBC отдаёт котировку, но истории
  // свечей нет вовсе — карточка осталась бы без графика
  { key: '@LCO.1', cat: 'energy', name: 'Нефть Brent', short: 'Brent', source: 'cnbc', code: '@LCO.1', unit: 'usd', tz: 'Europe/London', slug: 'brent',
    what: 'Нефть Brent — эталон для двух третей мировых сортов. Российская нефть продаётся со скидкой именно к нему, поэтому по Brent считают и её цену.' },
  { key: '@NG.1', cat: 'energy', name: 'Природный газ', short: 'Газ', source: 'cnbc', code: '@NG.1', unit: 'usd', tz: 'America/New_York', slug: 'natural-gas',
    what: 'Природный газ на бирже NYMEX. Зимой и летом цены ходят по-разному: они зависят от отопительного сезона и заполненности хранилищ.' },
  { key: '@HO.1', cat: 'energy', name: 'Дизельное топливо', short: 'Дизель', source: 'cnbc', code: '@HO.1', unit: 'usd', tz: 'America/New_York', slug: 'diesel',
    what: 'Дизельное топливо. Это топливо грузовиков, поездов и промышленности, поэтому спрос на него сильнее бензина следует за состоянием экономики.' },
  { key: '@RB.1', cat: 'energy', name: 'Бензин RBOB', short: 'Бензин', source: 'cnbc', code: '@RB.1', unit: 'usd', tz: 'America/New_York', slug: 'gasoline',
    what: 'Бензин RBOB — смесь до добавления этанола. Летний сезон поездок и аварии на нефтепереработке двигают его сильнее, чем саму нефть.' },

  // ---------------------------------------------------------------- металлы
  { key: '@GC.1', cat: 'metals', name: 'Золото', short: 'Золото', source: 'cnbc', code: '@GC.1', unit: 'usd', tz: 'America/New_York', slug: 'gold',
    what: 'Золото на COMEX. Защитный актив: дорожает, когда инвесторы уходят от риска и ждут снижения ставок.' },
  { key: '@SI.1', cat: 'metals', name: 'Серебро', short: 'Серебро', source: 'cnbc', code: '@SI.1', unit: 'usd', tz: 'America/New_York', slug: 'silver',
    what: 'Серебро. Больше половины спроса — промышленность, поэтому в кризис оно падает вместе с ней, хотя и считается защитным металлом.' },
  { key: '@HG.1', cat: 'metals', name: 'Медь', short: 'Медь', source: 'cnbc', code: '@HG.1', unit: 'usd', tz: 'America/New_York', slug: 'copper',
    what: 'Медь. Её называют индикатором мировой экономики: спрос идёт от стройки, энергетики и производства транспорта.' },
  { key: '@PL.1', cat: 'metals', name: 'Платина', short: 'Платина', source: 'cnbc', code: '@PL.1', unit: 'usd', tz: 'America/New_York', slug: 'platinum',
    what: 'Платина. Главный потребитель — катализаторы автомобилей, поэтому цена следует за выпуском машин и заменой дизеля на бензин.' },
  { key: '@PA.1', cat: 'metals', name: 'Палладий', short: 'Палладий', source: 'cnbc', code: '@PA.1', unit: 'usd', tz: 'America/New_York', slug: 'palladium',
    what: 'Палладий. Больше восьмидесяти процентов поставок приходится на Россию, поэтому санкции и логистика двигают цену сильнее спроса.' },
  // Золото в рублях за грамм — то, что человек в России видит в обменнике
  { key: 'GLDRUB_TOM', cat: 'metals', name: 'Золото в рублях за грамм', short: 'Золото ₽/г', source: 'moex', moex: { engine: 'currency', market: 'selt' }, code: 'GLDRUB_TOM', unit: 'money', cur: 'RUB', tz: 'Europe/Moscow', slug: 'gold-rub',
    what: 'Золото в рублях за грамм по расчётам «завтра» на Мосбирже. Так цена металла выглядит для покупателя в России, вместе с курсом рубля.' },

  // ---------------------------------------------------------------- валюты
  // Рублёвые пары с расчётами «завтра» — основной режим валютной секции
  // Мосбиржи. USD000UTSTOM — та самая пара, по которой считается курс
  { key: 'USD000UTSTOM', cat: 'currencies', name: 'Доллар к рублю', short: 'USD/RUB', source: 'moex', moex: { engine: 'currency', market: 'selt' }, code: 'USD000UTSTOM', unit: 'fx', tz: 'Europe/Moscow', slug: 'usd-rub',
    what: 'Доллар к рублю с расчётами «завтра» — основной режим валютной секции Мосбиржи. По этой паре определяют биржевой курс доллара.' },
  { key: 'EUR_RUB__TOM', cat: 'currencies', name: 'Евро к рублю', short: 'EUR/RUB', source: 'moex', moex: { engine: 'currency', market: 'selt' }, code: 'EUR_RUB__TOM', unit: 'fx', tz: 'Europe/Moscow', slug: 'eur-rub',
    what: 'Евро к рублю с расчётами «завтра» на Мосбирже. Двигается вслед за долларом и за евро на мировом рынке.' },
  { key: 'CNYRUB_TOM', cat: 'currencies', name: 'Юань к рублю', short: 'CNY/RUB', source: 'moex', moex: { engine: 'currency', market: 'selt' }, code: 'CNYRUB_TOM', unit: 'fx', tz: 'Europe/Moscow', slug: 'cny-rub',
    what: 'Юань к рублю. После ухода доллара с биржи это главная валютная пара для расчётов с Китаем.' },
  { key: 'EUR=', cat: 'currencies', name: 'Евро к доллару', short: 'EUR/USD', source: 'cnbc', code: 'EUR=', unit: 'fx', tz: 'America/New_York', slug: 'eur-usd',
    what: 'Евро к доллару — самая торгуемая пара в мире. Доллар в ней дорожает, когда европейская экономика слабеет сильнее американской.' },
  { key: 'JPY=', cat: 'currencies', name: 'Доллар к иене', short: 'USD/JPY', source: 'cnbc', code: 'JPY=', unit: 'fx', tz: 'America/New_York', slug: 'usd-jpy',
    what: 'Доллар к иене. Иена дешевеет, пока Банк Японии держит ставку ниже, чем ФРС.' },
  { key: 'GBP=', cat: 'currencies', name: 'Фунт к доллару', short: 'GBP/USD', source: 'cnbc', code: 'GBP=', unit: 'fx', tz: 'America/New_York', slug: 'gbp-usd',
    what: 'Фунт к доллару. Ведёт себя иначе, чем евро: сильнее зависит от лондонского финансового сектора и решения Банка Англии.' },
  { key: 'CNY=', cat: 'currencies', name: 'Доллар к юаню', short: 'USD/CNY', source: 'cnbc', code: 'CNY=', unit: 'fx', tz: 'America/New_York', slug: 'usd-cny',
    what: 'Доллар к юаню. Народный банк Китая держит курс в узком коридоре, поэтому движения здесь медленнее, чем у других пар.' },
  { key: '.DXY', cat: 'currencies', name: 'Индекс доллара DXY', short: 'DXY', source: 'cnbc', code: '.DXY', unit: 'pts', tz: 'America/New_York', slug: 'dxy',
    what: 'Индекс доллара: американская валюта против корзины из шести, больше половины веса — евро. Растёт, когда доллар дорожает ко всем сразу.' },
];

// На вкладке «Все» — по одному инструменту от каждой категории: иначе восемьдесят
// карточек в одном экране превращают страницу в свалку, а обзор теряется
const ALL_KEYS = ['IMOEX', '.SPX', 'RGBI', 'US10Y', '@LCO.1', '@GC.1', 'USD000UTSTOM', 'EUR='];

export const byKey = (key) => INSTRUMENTS.find((i) => i.key === key) || null;

// Адрес страницы инструмента. Слаг, а не ключ источника: «@LCO.1» и «EUR=»
// в адресе выглядят как ошибка и требуют экранирования, а «brent» читается
// Имя отличается от bySlug из indices.js: там страницы индексов, здесь —
// весь справочник инструментов. Два разных bySlug в одном файле не уживаются
export const instrumentBySlug = (slug) => INSTRUMENTS.find((i) => i.slug === String(slug).toLowerCase()) || null;
export const instrumentPath = (inst) => `/charts/${inst.slug}`;

// Список вкладки. Неизвестная категория откатывается на «Все», как неизвестный
// интервал на странице тикера — страница не должна отдавать 404 из-за параметра
export function listOf(cat) {
  if (!isCat(cat) || cat === 'all') return ALL_KEYS.map(byKey).filter(Boolean);
  return INSTRUMENTS.filter((i) => i.cat === cat);
}

// ------------------------------------------------------------------ интервалы
// Набор тот же, что просил человек: от минуты до месяца. Десятиминутки здесь нет
// намеренно — она есть на странице тикера, но в сетке из двенадцати карточек
// лишняя кнопка только мешает
// adj и one — прилагательные для текста: «свечи день» по-русски не
// согласуется. adj — во множественном («дневные свечи»), one — в единственном
// («дневной график»): в заголовке нужен второй, иначе получается «график дневные»
export const CTF = {
  '1min': { label: '1 мин', sec: 60, adj: 'минутные', one: 'минутный' },
  '5min': { label: '5 мин', sec: 300, adj: 'пятиминутные', one: 'пятиминутный' },
  '15min': { label: '15 мин', sec: 900, adj: 'пятнадцатиминутные', one: 'пятнадцатиминутный' },
  '30min': { label: '30 мин', sec: 1800, adj: 'тридцатиминутные', one: 'тридцатиминутный' },
  '1h': { label: '1 час', sec: 3600, adj: 'часовые', one: 'часовой' },
  '1d': { label: 'День', sec: 86400, daily: true, adj: 'дневные', one: 'дневной' },
  '1w': { label: 'Неделя', sec: 7 * 86400, daily: true, adj: 'недельные', one: 'недельный' },
  '1mo': { label: 'Месяц', sec: 30 * 86400, daily: true, adj: 'месячные', one: 'месячный' },
};

export const isCtf = (t) => Object.hasOwn(CTF, t);
// По умолчанию — пятиминутки: страница называется «Графики» и обещает то,
// что происходит сейчас. Дневная свеча за день не меняется, и такой экран
// выглядел бы снимком, а не живой картиной. Пятнадцать свечей в час читаются
// и на телефоне, и на большом экране
export const DEFAULT_CTF = '5min';

// Сколько свечей просить для карточки. Рисуется меньше (CANDLES_CARD из
// chart-render), но запас нужен: на неделях и месяцах ряд склеивается из
// дневных, и просить ровно по числу видимых свечей значило бы получить
// обрезанный год. На минутках запас окупается: 80 пятиминуток — это одна
// страница Мосбиржи вместо двух
const WANT = 80;

// Мосбиржа: интервал, который она понимает сама, и во что склеивать.
//   page — базовый интервал запроса, bucket — размер итоговой свечи в секундах
const MOEX_PLAN = {
  '1min': { interval: 1 },
  '5min': { interval: 1, bucket: 300 },
  '15min': { interval: 1, bucket: 900 },
  '30min': { interval: 10, bucket: 1800 },
  '1h': { interval: 60 },
  '1d': { interval: 24 },
  '1w': { interval: 7 },
  '1mo': { interval: 31 },
};

// Пресет CNBC задаёт шаг свечи, а не размер окна:
// 1D — минутки, 5D — пятиминутки, 1Y — дни, 5Y и 10Y — недели
const CNBC_PLAN = {
  '1min': { preset: '1D' },
  '5min': { preset: '5D' },
  '15min': { preset: '5D', bucket: 900 },
  '30min': { preset: '5D', bucket: 1800 },
  '1h': { preset: '5D', bucket: 3600 },
  '1d': { preset: '1Y' },
  '1w': { preset: '5Y', byWeek: true },
  '1mo': { preset: '10Y', byMonth: true },
};

// Сколько строк просить у Мосбиржи: она режет ответ на 500 строках при любом limit
const MOEX_PAGE = 500;
const MOEX_MAX_PAGES = 6;

// ------------------------------------------------------------------ Мосбиржа
const moexCandlesUrl = (inst, interval, start = 0) =>
  `${MOEX_ISS}/${inst.moex.engine}/markets/${inst.moex.market}/securities/${encodeURIComponent(inst.code)}/candles.json` +
  `?iss.meta=off&iss.reverse=true&interval=${interval}&limit=${MOEX_PAGE}${start ? `&start=${start}` : ''}`;

// Один запрос страницы свечей. Ошибка источника здесь не исключение, а пустой
// список: в сетке из двенадцати карточек одна упавшая не должна ронять страницу
async function moexPage(inst, interval, start, timeout) {
  try {
    const res = await get(moexCandlesUrl(inst, interval, start), { timeout, headers: { Accept: 'application/json' } });
    if (!res.ok) return [];
    return moexRows(await res.json().catch(() => null));
  } catch {
    return [];
  }
}

// Свечи Мосбиржи. Базовый интервал Мосбиржа отдаёт сама — 1, 10, 60 минут,
// день, неделю, месяц; 5 и 15 минут склеиваются из минуток, 30 — из десятиминуток.
// Время в ответе московское, без зоны — moexEpoch проставляет +03:00
async function moexSeries(inst, tf, timeout, want = WANT) {
  const plan = MOEX_PLAN[tf];
  if (!plan) return [];
  const daily = Boolean(CTF[tf]?.daily);
  const need = plan.bucket ? Math.ceil((want * plan.bucket) / (plan.interval * 60)) : want;
  const pages = Math.min(Math.ceil(need / MOEX_PAGE), MOEX_MAX_PAGES);
  // Страницы независимы, поэтому идут параллельно: 15 минуток — это пять кругов,
  // и последовательно они складывались бы в полторы секунды на карточку
  const rows = (await Promise.all(Array.from({ length: pages }, (_, i) => moexPage(inst, plan.interval, i * MOEX_PAGE, timeout)))).flat();
  const candles = rows
    .map((r) => makeCandle(daily ? r.begin.slice(0, 10) : moexEpoch(r.begin), r.o, r.h, r.l, r.c))
    .filter((c) => c && (daily || Number.isFinite(c[0])));
  if (!candles.length) return [];
  // Мосбиржа отдаёт свежие первыми (iss.reverse), а склейке и графику нужен порядок по времени
  candles.sort((a, b) => (daily ? a[0].localeCompare(b[0]) : a[0] - b[0]));
  // Дневные дубли (основная и вечерняя сессия) дают две свечи на дату — склеиваем
  if (daily) return aggregate(candles, (d) => d);
  if (!plan.bucket) return candles;
  // Ключ окна — начало интервала: пятиминутка открывается в :00, :05, :10,
  // и склейка по делению без остатка совпадает с тем, что показал бы источник
  return aggregate(candles, (t) => Math.floor(t / plan.bucket)).map((c) => [
    Math.floor(c[0] / plan.bucket) * plan.bucket,
    c[1], c[2], c[3], c[4],
  ]);
}

// ------------------------------------------------------------------ CNBC
async function cnbcBars(code, preset, timeout) {
  try {
    const res = await get(`${CNBC_CHART}/${preset}.json?symbol=${encodeURIComponent(code)}&interval=1D`, {
      timeout,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return [];
    const bars = (await res.json().catch(() => null))?.barData?.priceBars;
    return Array.isArray(bars) ? bars : [];
  } catch {
    return [];
  }
}

// CNBC не даёт выбрать шаг свечи, поэтому интервал собирается из пресета:
// день — как есть, неделя и месяц склеиваются из дневных, 15/30/60 минут —
// из пятиминуток. Окно пресета при этом шире нужного, лишнее отрежет график
async function cnbcSeries(inst, tf, timeout) {
  const plan = CNBC_PLAN[tf];
  if (!plan) return [];
  const bars = await cnbcBars(inst.code, plan.preset, timeout);
  if (!bars.length) return [];
  const daily = Boolean(CTF[tf]?.daily);
  const candles = bars
    .map((b) => {
      // tradeTime — «20261030000000», без разделителей: дата собирается из групп,
      // а не берётся как подстрока, иначе weekOf получает «20261030» и падает
      const m = daily ? String(b.tradeTime || '').match(/^(\d{4})(\d{2})(\d{2})/) : null;
      const t = daily ? (m ? `${m[1]}-${m[2]}-${m[3]}` : null) : Math.round(Number(b.tradeTimeinMills) / 1000);
      return makeCandle(t, b.open, b.high, b.low, b.close);
    })
    .filter((c) => c && (daily || Number.isFinite(c[0])))
    .sort((a, b) => (daily ? a[0].localeCompare(b[0]) : a[0] - b[0]));
  if (!candles.length) return [];
  if (plan.byWeek) return aggregate(candles, weekOf);
  if (plan.byMonth) return aggregate(candles, (d) => String(d).slice(0, 7));
  if (plan.bucket) {
    return aggregate(candles, (t) => Math.floor(t / plan.bucket)).map((c) => [
      Math.floor(c[0] / plan.bucket) * plan.bucket,
      c[1], c[2], c[3], c[4],
    ]);
  }
  return candles;
}

// want — сколько свечей нужно. Карточке в сетке хватает 150, странице
// инструмента — 400, как на странице тикера. Влияет только на Мосбиржу:
// у CNBC окно задано пресетом, и лишнее отрезает график
export const fetchSeries = (inst, tf, opts = {}) =>
  inst.source === 'moex'
    ? moexSeries(inst, tf, opts.timeout ?? 6000, opts.want ?? WANT)
    : cnbcSeries(inst, tf, opts.timeout ?? 6000);

// ------------------------------------------------------------------ котировки
// Цена и дневное изменение берутся отдельно от свечей и одним запросом на рынок:
// двенадцать карточек, каждая со своим запросом котировки, — это двенадцать
// обращений к бирже на каждое обновление экрана.
//
// Поля у Мосбиржи разложены по режимам торгов, и колонки называются по-разному:
// у индексов LASTVALUE и LASTCHANGEPRC, у облигаций и валюты LAST и
// LASTCHANGEPRCNT. Поэтому таблица читается в словарь по именам колонок, а не
// по позициям — порядок колонок Мосбиржа меняет между рынками.

const MOEX_COLS = 'SECID,LAST,LASTVALUE,CURRENTVALUE,LASTCHANGEPRC,LASTCHANGEPRCNT,LASTCHANGE,VALTODAY,YIELD,PREVPRICE';

// Первое непустое значение: у бумаги без сделок днём LAST пустой, а LASTVALUE
// (последняя известная цена) есть — без этой цепочки карточка показывала прочерк.
// Запятая бывает и десятичной, и разделителем тысяч: у Мосбиржи «81,96», у CNBC
// «7,541.40». Если в строке есть и точка, и запятая, запятая — тысячи, иначе
// «7,541.40» превратилось бы в NaN
const parseNum = (v) => {
  let s = String(v).replace('%', '').replace(/\s/g, '');
  if (s.includes('.') && s.includes(',')) s = s.replace(/,/g, '');
  else s = s.replace(',', '.');
  return Number(s);
};

const firstNum = (...vals) => {
  for (const v of vals) {
    if (v === null || v === undefined || v === '') continue;
    const n = parseNum(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
};

async function moexQuotes(list, timeout) {
  const out = {};
  // Индексы, облигации и валюта — три разных рынка Мосбиржи, по запросу на каждый
  const groups = new Map();
  for (const i of list) {
    if (i.source !== 'moex') continue;
    const g = `${i.moex.engine}/${i.moex.market}`;
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(i);
  }
  await Promise.all(
    [...groups].map(async ([path, items]) => {
      const url = `${MOEX_ISS}/${path.replace('/', '/markets/')}/securities.json?iss.meta=off&iss.only=securities,marketdata` +
        `&securities=${items.map((i) => encodeURIComponent(i.code)).join(',')}` +
        `&securities.columns=SECID,PREVPRICE&marketdata.columns=${MOEX_COLS}`;
      try {
        const res = await get(url, { timeout, headers: { Accept: 'application/json' } });
        if (!res.ok) return;
        const j = await res.json().catch(() => null);
        // В таблице securities на бумагу приходит несколько строк (режимы торгов),
        // и последняя часто пустая: берём первое непустое значение, иначе
        // предыдущая цена затиралась на null и карточка оставалась без числа
        const prevMap = new Map();
        for (const [secid, price] of j?.securities?.data || []) {
          if (!prevMap.has(secid) && firstNum(price) !== null) prevMap.set(secid, price);
        }
        for (const row of j?.marketdata?.data || []) {
          const [secid] = row;
          const rec = {};
          (j.marketdata.columns || []).forEach((c, idx) => (rec[c] = row[idx]));
          // На бумагу приходит несколько строк — по режимам торгов (TQOB, SPOB),
          // и первая часто пустая: цена null, доходность 0. Если брать первую
          // попавшуюся, у ОФЗ терялась доходность, а у валюты — цена. Поэтому
          // строки одного SECID склеиваются: побеждает та, где значение непустое
          const key = `${path}:${secid}`;
          const prevRec = out[key] || {};
          const prevPrice = firstNum(prevMap.get(secid));
          const price = firstNum(rec.LAST, rec.LASTVALUE, rec.CURRENTVALUE) ?? prevRec.price ?? prevPrice;
          if (price === null) continue;
          out[key] = {
            price,
            pct: firstNum(rec.LASTCHANGEPRC, rec.LASTCHANGEPRCNT) ?? prevRec.pct ?? null,
            // Доходность ОФЗ приходит в процентах годовых; ноль означает
            // «в этом режиме не считается», а не «доходность 0%»
            yield: firstNum(rec.YIELD) || prevRec.yield || null,
            prev: prevPrice ?? prevRec.prev ?? null,
            turnover: firstNum(rec.VALTODAY) ?? prevRec.turnover ?? null,
          };
        }
      } catch {
        // Молча: котировка — украшение, свечи на карточке важнее
      }
    })
  );
  return out;
}

// CNBC отдаёт все символы одним запросом. Проценты приходят строкой с «%»,
// доходности — со знаком «%» прямо в значении цены: «4.896%»
async function cnbcQuotes(list, timeout) {
  const out = {};
  const codes = list.filter((i) => i.source === 'cnbc').map((i) => i.code);
  if (!codes.length) return out;
  const url = `${CNBC_QUOTE}/symbolType/symbol?symbols=${codes.join('|')}` +
    `&requestMethod=itv&noform=1&partnerId=2&fund=1&exthdrs=1&output=json&events=1`;
  try {
    const res = await get(url, { timeout, headers: { Accept: 'application/json' } });
    if (!res.ok) return out;
    const j = await res.json().catch(() => null);
    const raw = j?.FormattedQuoteResult?.FormattedQuote;
    const arr = Array.isArray(raw) ? raw : raw ? [raw] : [];
    for (const q of arr) {
      const price = firstNum(q.last);
      const pct = firstNum(q.change_pct);
      if (price === null) continue;
      out[q.symbol] = { price, pct, prev: firstNum(q.previous_day_closing), time: q.last_time || null };
    }
  } catch {
    // Пусто: карточка нарисуется по последней свече
  }
  return out;
}

// Котировки для набора инструментов: один вызов на всю страницу, а не на карточку
export async function fetchQuotes(list, { timeout = 6000 } = {}) {
  const [moex, cnbc] = await Promise.all([moexQuotes(list, timeout), cnbcQuotes(list, timeout)]);
  const out = {};
  for (const i of list) {
    const q = i.source === 'moex' ? moex[`${i.moex.engine}/${i.moex.market}:${i.code}`] : cnbc[i.code];
    if (q) out[i.key] = q;
  }
  return out;
}

// ------------------------------------------------------------------ кеш
// Карточки на экране обновляются сами, поэтому один и тот же ряд просят все
// посетители сразу. Без кеша двенадцать карточек — это двенадцать запросов
// к бирже на каждый браузер каждые двадцать секунд.
//
// Время жизни растёт вместе с интервалом: минутный ряд устаревает за секунды,
// а дневной не меняется до следующего торгового дня. TTL ниже периода опроса
// на клиенте — иначе человек видел бы один и тот же неизменный бар
const TTL = {
  '1min': 15_000,
  '5min': 30_000,
  '15min': 45_000,
  '30min': 60_000,
  '1h': 60_000,
  '1d': 300_000,
  '1w': 900_000,
  '1mo': 3_600_000,
};

const MAX_ENTRIES = 300;

export function createMarketFeed({ log = () => {} } = {}) {
  const cache = new Map();
  const inflight = new Map();

  const ttl = (tf) => TTL[tf] ?? 60_000;

  function remember(key, value) {
    if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value);
    cache.set(key, { value, at: Date.now() });
  }

  // Свечи одного инструмента на одном интервале. Отказ источника не стирает
  // прошлый ряд: пустая карточка в сетке хуже устаревшей
  async function series(inst, tf, { force = false, want } = {}) {
    // Длина ряда входит в ключ: иначе страница инструмента получила бы из кеша
    // короткий ряд сетки и показала бы 150 свечей вместо 400
    const key = `${inst.key}:${tf}:${want || 'grid'}`;
    const hit = cache.get(key);
    if (!force && hit && Date.now() - hit.at < ttl(tf)) return { ...hit.value, stale: false };

    if (inflight.has(key)) return inflight.get(key);

    const task = (async () => {
      try {
        const candles = await fetchSeries(inst, tf, { want });
        // Пустой ответ не кешируем надолго: биржа могла просто не ответить
        const value = { candles, fetchedAt: new Date().toISOString() };
        if (candles.length >= 2) remember(key, value);
        return { ...value, stale: false };
      } catch (e) {
        log(`графики: ${key} — ${e.message}`);
        if (hit) return { ...hit.value, stale: true };
        return { candles: [], fetchedAt: null, stale: true };
      } finally {
        inflight.delete(key);
      }
    })();

    inflight.set(key, task);
    return task;
  }

  // Серии и котировки для вкладки разом. Котировки не кешируются по инструментам:
  // они приходят одним запросом на рынок, и кешировать их по карточке значило бы
  // сходить за ними столько же раз, сколько карточек на экране
  async function board(cat, tf, { force = false } = {}) {
    const list = listOf(cat);
    const [rows, quotes] = await Promise.all([
      Promise.all(list.map(async (inst) => ({ inst, series: await series(inst, tf, { force }) }))),
      fetchQuotes(list).catch(() => ({})),
    ]);
    return { list, rows, quotes };
  }

  // Страница одного инструмента: длинный ряд и котировка. Котировку просим
  // только для него — запрос на весь рынок ради одной карточки был бы лишним
  async function one(inst, tf, { want = 400 } = {}) {
    const [series_, quotes] = await Promise.all([
      series(inst, tf, { want }),
      fetchQuotes([inst]).catch(() => ({})),
    ]);
    return { series: series_, quote: quotes[inst.key] || null };
  }

  return { series, board, one, size: () => cache.size };
}

// ------------------------------------------------------------------ формат
// Единица инструмента диктует и число знаков, и значок. Пункты индекса — два
// знака: «2 455,62 п.» читается, «2 455,6218 п.» уже нет. Доходность облигации —
// три, потому что шаг там в сотых процента, а курс — четыре
const DIGITS = { pct: 3, fx: 4, nom: 2, money: 2, usd: 2, pts: 2 };

export function fmtValue(n, inst) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  const unit = inst?.unit || 'pts';
  const digits = DIGITS[unit] ?? 2;
  const body = v.toLocaleString(intlLocale(), { minimumFractionDigits: digits, maximumFractionDigits: digits });
  if (unit === 'pct') return `${body}%`;
  if (unit === 'usd') return `$${body}`;
  if (unit === 'money') return `${body} ₽`;
  // ОФЗ: «83,40» — это не рубли, а проценты от номинала
  if (unit === 'nom') return `${body}% ${t('ном.')}`;
  if (unit === 'fx') return body;
  return `${body} ${t('п.')}`;
}

// Изменение за день. У доходностей относительный процент сбивает с толку:
// «+0,43%» рядом с «4,915%» читается как «стало 4,96», хотя на деле сдвиг
// в две сотых. Поэтому у них показывается разница в процентных пунктах
export function fmtChange(quote, inst) {
  const v = Number(quote?.pct);
  if (!Number.isFinite(v)) return { text: '—', dir: 'flat' };
  const dir = v > 0 ? 'up' : v < 0 ? 'down' : 'flat';
  if (inst?.unit === 'pct') {
    const diff = Number(quote.price) - Number(quote.prev);
    if (Number.isFinite(diff)) {
      const body = Math.abs(diff).toLocaleString(intlLocale(), { minimumFractionDigits: 3, maximumFractionDigits: 3 });
      return {
        text: `${diff > 0 ? '+' : diff < 0 ? '−' : ''}${body} ${t('п.п.')}`,
        dir: diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat',
      };
    }
  }
  return { text: fmtPct(v), dir };
}

export function fmtPct(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  const body = Math.abs(v).toLocaleString(intlLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${v > 0 ? '+' : v < 0 ? '−' : ''}${body}%`;
}
