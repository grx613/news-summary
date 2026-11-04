// Английский словарь. Ключ — русский текст из шаблона; значение — перевод.
// Строки с {переменными} обязаны сохранить все подстановки: иначе на странице
// останутся фигурные скобки вместо чисел и названий.

export default {
  // ---------------------------------------------------------------- общее
  'Разделы сайта': 'Site sections',
  'Каталог тикеров': 'Ticker catalog',
  'Акции Мосбиржи': 'Moscow Exchange stocks',
  'Акции США': 'US stocks',
  'Криптовалюты': 'Cryptocurrencies',
  'Графики': 'Charts',
  'Индексы': 'Indices',
  'Дивиденды': 'Dividends',
  'Правила обсуждений': 'Discussion rules',
  'Язык сайта': 'Site language',
  'Главная': 'Home',
  'Вернуться к началу страницы': 'Back to top of page',
  'Наверх': 'Top',
  'или': 'or',

  'Обсуждения — на странице каждого тикера.': 'Discussions live on each ticker page.',
  'Сервис собирает публикации из Bing News, Yahoo Finance, Reddit, Финама, Smart-Lab и новостей Мосбиржи и делает по ним сводку моделью {model}. Данные обновляются раз в сутки.':
    'The service collects publications from Bing News, Yahoo Finance, Reddit, Finam, Smart-Lab and Moscow Exchange news, then summarises them with the {model} model. Data is refreshed once a day.',
  'Материалы сервиса — не инвестиционная рекомендация.': 'Nothing here is investment advice.',

  // ---------------------------------------------------------------- рынки
  'Актив': 'Asset',
  'акции': 'shares',
  'котировки': 'quotes',
  'форум акции': 'share forum',
  'форум монеты': 'coin forum',
  'акции Мосбиржи': 'Moscow Exchange stocks',
  'акции США': 'US stocks',
  'криптовалюты': 'cryptocurrencies',
  'Бумаги индекса Мосбиржи: нефть и газ, банки, металлургия, ритейл, телеком, девелопмент.':
    'Moscow Exchange index members: oil and gas, banks, steel, retail, telecom, real estate.',
  'Крупнейшие по капитализации компании США: технологии, полупроводники, здравоохранение, финансы, потребительский сектор.':
    'The largest US companies by market cap: technology, semiconductors, healthcare, finance, consumer.',
  'Монеты с наибольшей капитализацией, без стейблкоинов и обёрнутых версий.':
    'The largest coins by market cap, excluding stablecoins and wrapped tokens.',
  'Сводки новостей и обсуждения по акциям Мосбиржи: цены, отчётность, дивиденды и события по каждой бумаге индекса. У каждого тикера — свежая подборка публикаций, ветки форума и ответы ИИ-аналитика.':
    'News summaries and discussions for Moscow Exchange stocks: prices, earnings, dividends and events for every index member. Each ticker has fresh publications, forum threads and AI analyst answers.',
  'Сводки новостей и обсуждения по акциям США: отчётности крупнейших компаний, прогнозы и события, влияющие на цену. По каждому тикеру — публикации за последние дни, форум и вопросы к аналитику.':
    'News summaries and discussions for US stocks: earnings from the largest companies, forecasts and price-moving events. Each ticker has recent publications, a forum and questions to the analyst.',
  'Сводки новостей и обсуждения по криптовалютам: курсы, движения рынка и события по монетам с наибольшей капитализацией. По каждому тикеру — свежие публикации, форум и ответы ИИ-аналитика.':
    'News summaries and discussions for cryptocurrencies: prices, market moves and events for the largest coins. Each ticker has fresh publications, a forum and AI analyst answers.',

  // ---------------------------------------------------------------- единицы
  'тикер': 'ticker',
  'тикера': 'tickers',
  'тикеров': 'tickers',
  'публикация': 'publication',
  'публикации': 'publications',
  'публикаций': 'publications',
  'токенов': 'tokens',
  '{n} токенов': '{n} tokens',
  'за {hours} ч': 'over {hours} h',

  // ---------------------------------------------------------------- сводка
  'обновлено {when}': 'updated {when}',
  '↻ Обновить': '↻ Refresh',
  '↻ Попробовать собрать': '↻ Try to build one',
  'Ключевое': 'Key points',
  'Риски': 'Risks',
  'Драйверы роста': 'Growth drivers',
  'Что обсуждают в сообществе': 'What the community is discussing',
  'Источники и публикации ({n})': 'Sources and publications ({n})',
  'Не ответили источники:': 'Sources that did not respond:',
  'Сводка собрана больше {hours} ч назад и не обновлялась. Данные ниже — на момент сбора; свежие можно получить кнопкой «Обновить».':
    'This summary was built more than {hours} h ago and has not been refreshed. The data below is as of that moment; use the Refresh button for a fresh one.',
  'По этому тикеру ещё нет готовой сводки: источники не дали достаточного числа публикаций за последние {hours} часа.':
    'There is no summary for this ticker yet: the sources did not return enough publications over the last {hours} hours.',
  'полнота данных: {level}': 'data completeness: {level}',
  'Полнота данных: {level}.': 'Data completeness: {level}.',
  'сводка новостей': 'news summary',
  '{name}: сводка новостей': '{name}: news summary',

  'Позитив': 'Positive',
  'Негатив': 'Negative',
  'Нейтрально': 'Neutral',
  'Смешанно': 'Mixed',
  'низкая': 'low',
  'средняя': 'medium',
  'высокая': 'high',

  // ---------------------------------------------------------------- вопросы
  'Спросить ИИ-аналитика: {name} {symbol}': 'Ask the AI analyst about {name} {symbol}',
  'Ответ строится только на публикациях из подборки по этому тикеру. Вопрос и ответ публикуются — их увидят другие посетители и поисковые системы.':
    'The answer is built only from the publications collected for this ticker. Questions and answers are published: other visitors and search engines will see them.',
  'Например: насколько выручка зависит от экспорта и что будет при укреплении рубля?':
    'For example: how much does revenue depend on exports, and what happens if the rouble strengthens?',
  '/300 · без ссылок и контактов': '/300 · no links or contact details',
  'Спросить': 'Ask',
  'Вопросов пока нет. Задайте первый — ответ появится на отдельной странице и будет виден всем.':
    'No questions yet. Ask the first one: the answer appears on its own page and everyone can see it.',
  'Абзацев в ответе: {n}': 'Paragraphs in the answer: {n}',
  'Вопрос посетителя: «{q}»': 'Visitor question: “{q}”',
  'Источники:': 'Sources:',
  'Источники, на которые опирается ответ ({n})': 'Sources the answer relies on ({n})',
  'Коротко': 'In short',
  'Ответ подготовлен ИИ с поиском по открытым источникам {date} и не является инвестиционной рекомендацией. Номера в тексте — ссылки на список источников ниже.':
    'The answer was prepared by AI with a search across public sources {date} and is not investment advice. Numbers in the text link to the source list below.',
  'Ответ подготовлен ИИ по публикациям за последние {hours} ч и не является инвестиционной рекомендацией.':
    'The answer was prepared by AI from publications over the last {hours} h and is not investment advice.',
  '← Вся сводка по {name}': '← Full summary for {name}',
  'Ещё вопросы: {name} {symbol}': 'More questions: {name} {symbol}',
  '← Поиск': '← Search',

  // ---------------------------------------------------------------- страница тикера
  'Сводка': 'Summary',
  'График': 'Chart',
  'Вопрос аналитику': 'Ask the analyst',
  'Форум': 'Forum',
  'Другие тикеры': 'Other tickers',
  '{name} — {kind} и новости': '{name} — {kind} and news',
  '{name} ({symbol}) — {kind}, новости и форум': '{name} ({symbol}) — {kind}, news and forum',
  '{name} ({symbol}) — {kind}, дивиденды и форум': '{name} ({symbol}) — {kind}, dividends and forum',
  'Дивиденды {name} ({symbol}): доходность {yield}%, история выплат и даты закрытия реестра. {headline}':
    'Dividends for {name} ({symbol}): {yield}% yield, payment history and record dates. {headline}',
  '{name} ({symbol}): {headline} Публикации за {hours} ч, {forum} и ответы ИИ-аналитика. {overview}':
    '{name} ({symbol}): {headline} Publications over {hours} h, {forum} and AI analyst answers. {overview}',
  '{name} ({symbol}), {market}: сводка новостей, {forum} и ответы ИИ-аналитика. Публикации за последние {hours} часа.':
    '{name} ({symbol}), {market}: news summary, {forum} and AI analyst answers. Publications over the last {hours} hours.',

  // ---------------------------------------------------------------- дивиденды
  'Дивиденды: {name} {symbol}': 'Dividends: {name} {symbol}',
  'Компания не выплачивает дивиденды: в истории выплат нет ни одной записи.':
    'The company pays no dividends: there is not a single payment on record.',
  'дата отсечки': 'record date',
  'прогноз за 12 мес: {amount}': '12-month forecast: {amount}',
  'Объявленных выплат вперёд нет.': 'No announced payments ahead.',
  'Объявленных выплат вперёд нет. Прогноз за 12 месяцев — {amount}.':
    'No announced payments ahead. The 12-month forecast is {amount}.',
  'Объявленных выплат вперёд сейчас нет.': 'There are no announced payments ahead right now.',
  'Дивидендная доходность': 'Dividend yield',
  'Доля от прибыли': 'Payout ratio',
  'Индекс стабильности (DSI)': 'Dividend stability index (DSI)',
  'Лет роста выплат': 'Years of dividend growth',
  'Периодичность': 'Frequency',
  'История выплат': 'Payment history',
  'Дата отсечки': 'Record date',
  'На акцию': 'Per share',
  'Год': 'Year',
  'Статус': 'Status',
  'Суммы по годам': 'Totals by year',
  'Выплачено': 'Paid',
  'Изм.': 'Change',
  'выплачено': 'paid',
  'рекомендовано советом директоров': 'recommended by the board',
  'прогноз': 'forecast',
  'объявлена': 'announced',
  'Источник: {src}': 'Source: {src}',
  'Дивиденды акций: календарь выплат и доходность': 'Stock dividends: payment calendar and yields',
  'Дивиденды акций — календарь выплат и доходность': 'Stock dividends — payment calendar and yields',
  'Ближайшие даты закрытия реестра и текущая дивидендная доходность по бумагам, которые платят дивиденды. По каждой компании есть история выплат на её странице. Источники: dohod.ru для Мосбиржи, stockanalysis.com для США.':
    'Upcoming record dates and current dividend yields for shares that pay dividends. Every company has its payment history on its own page. Sources: dohod.ru for the Moscow Exchange, stockanalysis.com for the US.',
  'Ближайшие дивиденды': 'Upcoming dividends',
  'Бумага': 'Share',
  'Прогнозные и рекомендованные выплаты помечены: окончательного решения собрания акционеров по ним может ещё не быть.':
    'Forecast and recommended payments are marked: the shareholder meeting may not have approved them yet.',
  'Самые высокие дивиденды': 'Highest dividends',
  'Доходность': 'Yield',
  'За 12 мес': 'Over 12 months',
  'Доля прибыли': 'Share of profit',
  'Доходность считается к текущей цене на момент сбора данных и меняется вместе с ней.':
    'Yield is calculated against the current price at the time of collection and moves with it.',
  'Календарь дивидендов по {n} бумагам Мосбиржи и США: даты закрытия реестра, размер выплаты на акцию и дивидендная доходность. Данные с dohod.ru и stockanalysis.com.':
    'Dividend calendar for {n} Moscow Exchange and US shares: record dates, payment per share and dividend yield. Data from dohod.ru and stockanalysis.com.',

  // ---------------------------------------------------------------- каталог
  'Каталог: {market}': 'Catalog: {market}',
  '{market}: {n} {tickers} — новости, обсуждения и вопросы к ИИ-аналитику. {lead}':
    '{market}: {n} {tickers} — news, discussions and questions to the AI analyst. {lead}',
  'Каталог из {n} тикеров со сводками новостей: акции Мосбиржи, акции США и криптовалюты. Списки по алфавиту для каждой категории.':
    'A catalog of {n} tickers with news summaries: Moscow Exchange stocks, US stocks and cryptocurrencies. Alphabetical lists for each category.',
  'Открыть отдельной страницей →': 'Open as a separate page →',

  // ---------------------------------------------------------------- главная
  'Курсы и капитализация акций Мосбиржи, акций США и криптовалют: {n} тикеров в одной таблице — цена, изменение за день и капитализация. По каждому — сводка новостей за 72 часа, дивиденды, график, форум и ответы ИИ-аналитика. Поиск по названию или тикеру.':
    'Prices and market caps for Moscow Exchange stocks, US stocks and cryptocurrencies: {n} tickers in one table with price, daily change and market cap. Each one has a 72-hour news summary, dividends, a chart, a forum and AI analyst answers. Search by name or ticker.',
  '{site} — курсы, капитализация и новости акций и криптовалют': '{site} — prices, market caps and news for stocks and crypto',
  'Курсы, капитализация и новости акций и криптовалют': 'Prices, market caps and news for stocks and crypto',
  'Акции США по капитализации — курсы, новости и форум': 'US stocks by market cap — prices, news and forum',
  'Акции США по капитализации': 'US stocks by market cap',
  'Акции Мосбиржи по капитализации — курсы, новости и форум': 'Moscow Exchange stocks by market cap — prices, news and forum',
  'Акции Мосбиржи по капитализации': 'Moscow Exchange stocks by market cap',
  'Криптовалюты по капитализации — курсы, новости и форум': 'Cryptocurrencies by market cap — prices, news and forum',
  'Криптовалюты по капитализации': 'Cryptocurrencies by market cap',
  'Крупнейшие компании США по капитализации: цена, изменение за день и новости по каждой. Публикации за 72 часа, форум и ответы ИИ-аналитика.':
    'The largest US companies by market cap: price, daily change and news for each. 72-hour publications, a forum and AI analyst answers.',
  'Бумаги Мосбиржи по капитализации: цена, изменение за день и новости по каждой. Публикации за 72 часа, дивиденды, форум и ответы ИИ-аналитика.':
    'Moscow Exchange shares by market cap: price, daily change and news for each. 72-hour publications, dividends, a forum and AI analyst answers.',
  'Монеты с наибольшей капитализацией: цена, изменение за день и новости по каждой. Без стейблкоинов и обёрнутых версий. Публикации за 72 часа и форум.':
    'The largest coins by market cap: price, daily change and news for each. No stablecoins or wrapped tokens. 72-hour publications and a forum.',
  'Поиск по названию или тикеру: <b>Apple</b>, <b>AAPL</b>, <b>Bitcoin</b>, <b>BTC</b>, <b>Газпром</b>, <b>GAZP</b>, <b>Сбербанк</b>…':
    'Search by name or ticker: <b>Apple</b>, <b>AAPL</b>, <b>Bitcoin</b>, <b>BTC</b>, <b>Gazprom</b>, <b>GAZP</b>, <b>Sberbank</b>…',
  'Поиск по названию или тикеру: <b>Apple</b>, <b>AAPL</b>, <b>NVIDIA</b>, <b>NVDA</b>, <b>Microsoft</b>, <b>Tesla</b>…':
    'Search by name or ticker: <b>Apple</b>, <b>AAPL</b>, <b>NVIDIA</b>, <b>NVDA</b>, <b>Microsoft</b>, <b>Tesla</b>…',
  'Поиск по названию или тикеру: <b>Газпром</b>, <b>GAZP</b>, <b>Сбербанк</b>, <b>SBER</b>, <b>Лукойл</b>, <b>LKOH</b>…':
    'Search by name or ticker: <b>Gazprom</b>, <b>GAZP</b>, <b>Sberbank</b>, <b>SBER</b>, <b>Lukoil</b>, <b>LKOH</b>…',
  'Поиск по названию или тикеру: <b>Bitcoin</b>, <b>BTC</b>, <b>Ethereum</b>, <b>ETH</b>, <b>Solana</b>, <b>SOL</b>…':
    'Search by name or ticker: <b>Bitcoin</b>, <b>BTC</b>, <b>Ethereum</b>, <b>ETH</b>, <b>Solana</b>, <b>SOL</b>…',
  '{n} {tickers} в одной таблице: цена, изменение за день и капитализация — акции Мосбиржи, акции США и криптовалюты.':
    '{n} {tickers} in one table: price, daily change and market cap — Moscow Exchange stocks, US stocks and cryptocurrencies.',
  '{n} {tickers}: цена, изменение за день и капитализация.': '{n} {tickers}: price, daily change and market cap.',
  'Название компании, тикер или монета…': 'Company name, ticker or coin…',
  'Обновлено недавно:': 'Updated recently:',
  'Ниже — полный список по алфавиту: {n} {tickers}.': 'Below is the full alphabetical list: {n} {tickers}.',
  'Сводки обновлены {when}.': 'Summaries updated {when}.',
  'Обсудить бумагу можно прямо на её странице — под сводкой есть форум по тикеру.':
    'You can discuss a share right on its page — there is a forum for each ticker under the summary.',

  // ---------------------------------------------------------------- служебные
  'Страница не найдена': 'Page not found',
  'Такого тикера нет в каталоге. Откройте каталог или воспользуйтесь поиском.':
    'There is no such ticker in the catalog. Open the catalog or use the search.',
  'Такого тикера нет в каталоге — возможно, он не входит в список или в названии опечатка.':
    'There is no such ticker in the catalog — it may not be listed, or the name is misspelled.',
  'Открыть каталог тикеров': 'Open the ticker catalog',
  'воспользоваться поиском': 'use the search',

  // ---------------------------------------------------------------- время
  'только что': 'just now',
  '{n} мин назад': '{n} min ago',
  '{n} ч назад': '{n} h ago',
};
