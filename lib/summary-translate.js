// Перевод готовой сводки на другие языки.
//
// Сводка переводится сразу при генерации, а не по заходу посетителя: поисковик
// не исполняет скрипты и на /en увидел бы русский текст. Русский оригинал
// остаётся в rec.summary, переводы — в rec.i18n.
//
// Здесь только то, что не зависит от HTTP: схема ответа, запрос и приведение
// ответа к виду хранения. Сам вызов модели делает вызывающий код, поэтому
// модуль годится и серверу, и разовому бэкфиллу старых записей.

export const TRANS_LANG = { en: 'English', es: 'Spanish (español)' };

// Переводчик получает уже готовую русскую сводку и возвращает только текст:
// sentiment, ссылки на публикации и уверенность не переводятся, а копируются.
// Так один вызов на язык не может изменить факты — их в ответе нет
export const TRANSLATION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['headline', 'overview', 'key_points', 'risks', 'catalysts', 'community'],
  properties: {
    headline: { type: 'string' },
    overview: { type: 'string' },
    key_points: { type: 'array', items: { type: 'string' } },
    risks: { type: 'array', items: { type: 'string' } },
    catalysts: { type: 'array', items: { type: 'string' } },
    community: { type: 'string' },
  },
};

export const TRANSLATION_SYSTEM =
  'You are a professional translator of financial texts. You translate meaning, keeping facts, numbers and terminology intact, and you reply only with the requested JSON.';

// Запрос на английском, а правило про кириллицу названо прямо: русский промпт
// провоцировал ответ по-русски — в испанской сводке оставались «РСБУ» и «Газпром»
export function buildTranslatePrompt(a, summary, lang) {
  return `Translate an analyst summary about ${a.name} (${a.symbol}) into ${TRANS_LANG[lang]}.

Headline: ${summary.headline}
Overview: ${summary.overview}
Key points:
${(summary.key_points || []).map((k, i) => `${i + 1}. ${k.text}`).join('\n')}
Risks:
${(summary.risks || []).map((x) => `- ${x}`).join('\n')}
Growth drivers:
${(summary.catalysts || []).map((x) => `- ${x}`).join('\n')}
Community discussion: ${summary.community || '—'}

Rules:
- Translate the meaning, not the words. Do not add or drop anything: the facts, numbers and conclusions must stay the same.
- Keep every number, date and percentage exactly as in the source; the decimal separator is a dot and the thousands separator a comma.
- Write natural ${TRANS_LANG[lang]}, not a word-for-word calque.
- The output must contain NO Cyrillic characters at all. The source is Russian; render every Russian name and term in Latin script:
  • company names in their usual Latin spelling: «Газпром» → Gazprom, «Сбербанк» → Sberbank, «Лукойл» → Lukoil;
  • Russian accounting and market terms as the standard equivalent: «РСБУ» → RAS (Russian Accounting Standards), «МСФО» → IFRS, «Мосбиржа» → Moscow Exchange, «ЦБ РФ» → the Bank of Russia;
  • tickers, product names and abbreviations (IPO, ETF, P/E, EBITDA) stay in Latin script.
- Return key_points in the same order and the same count as the input; risks and catalysts likewise.
- If community is empty, return an empty string.`;
}

const str = (v) => typeof v === 'string' && v.trim().length > 0;

// Кириллица в переводе — брак, даже когда структура целая: модель иногда
// переводит часть пунктов и оставляет остальные как есть. Проверка ловит это
// до записи, иначе на /en молча появляется русская строка посреди английского
const CYRILLIC = /[\u0400-\u04FF]/;

// Ответ модели → запись перевода. Пункты сопоставляются по порядку: ссылки на
// публикации остаются от оригинала, иначе перевод мог бы сослаться на
// несуществующий номер.
//
// Списки должны прийти той же длины. Модель иногда обрывает их на третьем
// пункте, и подстановка «недостающее возьмём из русского» оставляла на /en
// русские строки посреди английского — молча, потому что структурно ответ
// целый. Такой перевод отвергается целиком: вызывающий код повторит вызов,
// а если не выйдет — страница покажет русский текст, что честнее смеси
export function applyTranslation(summary, parsed) {
  if (!str(parsed?.headline) || !str(parsed?.overview)) return null;
  const sameLen = (ru, tr) => !Array.isArray(ru) || (Array.isArray(tr) && tr.length === ru.length);
  if (!sameLen(summary.key_points, parsed.key_points)) return null;
  if (!sameLen(summary.risks, parsed.risks)) return null;
  if (!sameLen(summary.catalysts, parsed.catalysts)) return null;
  // community законно бывает пустым — это «обсуждать нечего», а не брак
  const filled = [
    parsed.headline,
    parsed.overview,
    ...(parsed.key_points || []),
    ...(parsed.risks || []),
    ...(parsed.catalysts || []),
  ];
  if (filled.some((x) => !str(x) || CYRILLIC.test(x))) return null;
  if (str(parsed.community) && CYRILLIC.test(parsed.community)) return null;
  const list = (tr, ru) => ru.map((x, i) => (str(tr?.[i]) ? tr[i].trim() : x));
  return {
    headline: parsed.headline.trim(),
    overview: parsed.overview.trim(),
    key_points: (summary.key_points || []).map((k, i) => ({ text: parsed.key_points[i].trim(), refs: k.refs })),
    risks: list(parsed.risks, summary.risks || []),
    catalysts: list(parsed.catalysts, summary.catalysts || []),
    community: str(parsed.community) ? parsed.community.trim() : '',
  };
}
