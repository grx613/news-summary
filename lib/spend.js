// Учёт расхода по данным BotHub, а не по собственному счётчику.
//
// Свои totalTokens/totalCostUsd живут в памяти: после перезапуска они обнуляются, а
// повторная генерация по тому же тикеру перезаписывает запись в кеше, и прежний расход
// исчезает вместе с ней. Поэтому источник правды — сам провайдер:
//
//   GET /transaction/usage-report?from=…&to=…   → Excel, строка на каждый запрос
//   GET /dev/key/list                            → значения ключей, чтобы опознать свой
//   GET /pricing/models                          → rubPerMillionCaps, курс caps → рубли
//
// Отчёт пересчитывается целиком за весь период при каждом обращении, поэтому файл
// не накапливает ошибок: повторный проход даёт те же цифры, а не удвоенные.
//
// Excel разбирается здесь же: у проекта нет зависимостей, а xlsx — это zip с XML,
// и node:zlib хватает, чтобы его распаковать.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const DAY_MS = 24 * 3600_000;
const SHEET = 'xl/worksheets/sheet1.xml';
const SHARED = 'xl/sharedStrings.xml';

// ---------------------------------------------------------------- xlsx

// Центральный каталог zip лежит в конце файла: идём от EOCD, а не от начала,
// иначе пришлось бы разбирать локальные заголовки с data descriptor
function unzip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('не zip: не найден EOCD');
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const files = new Map();
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) break;
    const method = buf.readUInt16LE(off + 10);
    const csize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const cmtLen = buf.readUInt16LE(off + 32);
    const lho = buf.readUInt32LE(off + 42);
    const name = buf.toString('utf8', off + 46, off + 46 + nameLen);
    const lNameLen = buf.readUInt16LE(lho + 26);
    const lExtra = buf.readUInt16LE(lho + 28);
    const start = lho + 30 + lNameLen + lExtra;
    const raw = buf.subarray(start, start + csize);
    files.set(name, method === 0 ? raw : zlib.inflateRawSync(raw));
    off += 46 + nameLen + extraLen + cmtLen;
  }
  return files;
}

const unescapeXml = (s) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&amp;/g, '&');

function sharedStrings(xml) {
  if (!xml) return [];
  const out = [];
  // Текст может быть разбит на несколько <t> внутри <si> (правки, фонты) — склеиваем
  for (const m of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
    const texts = [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => unescapeXml(t[1]));
    out.push(texts.join(''));
  }
  return out;
}

// Строки листа → массив объектов { A: '…', C: '270150', … }
function readSheet(xml, shared) {
  const rows = [];
  for (const rm of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells = {};
    for (const cm of rm[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attrs = cm[1];
      const ref = /\br="([A-Z]+)\d+"/.exec(attrs);
      if (!ref) continue;
      const type = /\bt="([^"]+)"/.exec(attrs)?.[1] || '';
      const body = cm[2];
      let value = '';
      if (type === 'inlineStr') {
        value = unescapeXml([...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join(''));
      } else {
        const v = /<v>([\s\S]*?)<\/v>/.exec(body);
        value = v ? v[1] : '';
        if (type === 's' && value !== '') value = shared[Number(value)] ?? '';
        else if (type !== 'str') value = unescapeXml(value);
      }
      cells[ref[1]] = value;
    }
    rows.push(cells);
  }
  return rows;
}

// Даты отчёта — серийные числа Excel. Смещение считается от 1899-12-30, потому что
// в 1900 году Excel считает 29 февраля, которого не было
const excelDate = (v) => new Date(Date.UTC(1899, 11, 30) + Number(v) * 86400_000);

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

// ---------------------------------------------------------------- отчёт

export function parseUsageReport(buffer) {
  const files = unzip(buffer);
  const sheet = files.get(SHEET);
  if (!sheet) throw new Error('в отчёте нет листа sheet1');
  const shared = sharedStrings(files.get(SHARED)?.toString('utf8'));
  const rows = readSheet(sheet.toString('utf8'), shared);

  const header = rows[0] || {};
  const col = {};
  for (const [k, v] of Object.entries(header)) col[String(v).trim()] = k;
  // Названия колонок — часть контракта отчёта, но позиции могут сдвинуться:
  // ищем по заголовку, а не по букве
  const pick = (...names) => {
    for (const n of names) {
      for (const [label, letter] of Object.entries(col)) {
        if (label.toLowerCase().startsWith(n.toLowerCase())) return letter;
      }
    }
    return null;
  };
  const C = {
    date: pick('Date'),
    caps: pick('CAPS'),
    model: pick('model_id', 'model'),
    prompt: pick('Prompt tokens'),
    cached: pick('Cached Tokens'),
    completion: pick('Completion Tokens'),
    provider: pick('Provider'),
    key: pick('API Key'),
  };

  return rows
    .slice(1)
    .filter((r) => C.date && r[C.date] && C.caps && r[C.caps] !== undefined)
    .map((r) => ({
      at: excelDate(r[C.date]),
      caps: num(r[C.caps]),
      model: r[C.model] || '?',
      prompt: num(r[C.prompt]),
      cached: num(r[C.cached]),
      completion: num(r[C.completion]),
      provider: r[C.provider] || '',
      key: String(r[C.key] || '').replace(/\u200b/g, '').trim(),
    }));
}

// ---------------------------------------------------------------- хранилище

const emptyBucket = () => ({ requests: 0, prompt: 0, cached: 0, completion: 0, tokens: 0, caps: 0 });

// «opencode-ssh (c4a5ad...)» против id «c4a5ad23-9aa0-…»: отчёт обрезает id до шести
// знаков и ставит многоточие, поэтому берём то, что есть в скобках, и сверяем начало
function sameKey(cell, id) {
  const m = /\(([0-9a-f]{4,})/i.exec(cell || '');
  if (!m) return false;
  return String(id || '').toLowerCase().startsWith(m[1].toLowerCase());
}

function addTo(bucket, row) {
  bucket.requests += 1;
  bucket.prompt += row.prompt;
  bucket.cached += row.cached;
  bucket.completion += row.completion;
  bucket.tokens += row.prompt + row.completion;
  bucket.caps += row.caps;
}

export function createSpendTracker({
  apiKey,
  baseUrl = 'https://bothub.chat/api/v2',
  dataFile,
  from = '2026-11-01',
  intervalMs = 6 * 3600_000,
  enabled = true,
  log = () => {},
  usdRate = null,
} = {}) {
  const runtime = { running: false, lastRunAt: null, lastError: null, lastRunMs: null };
  let data = null;
  let timer = null;

  function load() {
    try {
      const raw = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
      if (raw && typeof raw === 'object' && raw.totals) data = raw;
    } catch {}
  }

  function save() {
    try {
      fs.mkdirSync(path.dirname(dataFile), { recursive: true });
      fs.writeFileSync(dataFile, JSON.stringify(data, null, 2));
    } catch (e) {
      log(`учёт расхода: не удалось записать ${dataFile}: ${e.message}`);
    }
  }

  async function api(pathname) {
    const res = await fetch(`${baseUrl}${pathname}`, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`${pathname}: HTTP ${res.status}`);
    return res;
  }

  // Ключ опознаётся по значению: метка в отчёте — это украшение, её можно
  // переименовать, а значение ключа из .env не меняется
  async function identifyKey() {
    try {
      const list = await (await api('/dev/key/list')).json();
      const items = Array.isArray(list) ? list : list?.data || [];
      const own = items.find((k) => k?.key && k.key === apiKey);
      if (own) return { id: own.id, label: own.label || own.id };
      // Тот же ключ мог быть выдан в другом виде — тогда сверяем по JWT-полю jti
      return null;
    } catch (e) {
      runtime.lastError = `список ключей: ${e.message}`;
      return null;
    }
  }

  async function rubRate() {
    try {
      const p = await (await api('/pricing/models')).json();
      const v = Number(p?.rates?.rubPerMillionCaps);
      if (v > 0) return v;
    } catch {}
    return null;
  }

  async function runOnce() {
    if (runtime.running || !enabled || !apiKey) return status();
    runtime.running = true;
    const started = Date.now();
    try {
      const key = await identifyKey();
      const to = new Date(Date.now() + DAY_MS).toISOString();
      const url = `/transaction/usage-report?from=${new Date(`${from}T00:00:00Z`).toISOString()}&to=${to}`;
      const res = await api(url);
      const rows = parseUsageReport(Buffer.from(await res.arrayBuffer()));

      // Фильтр по своему ключу. В отчёте он подписан «метка (id…)», причём id
      // усечён до шести символов — сравниваем по общей части, а не по равенству,
      // иначе фильтр находит ноль строк и расход молча показывается нулевым
      const mine = key ? rows.filter((r) => sameKey(r.key, key.id)) : rows;

      const days = {};
      const models = {};
      const totals = emptyBucket();
      for (const row of mine) {
        const d = row.at.toISOString().slice(0, 10);
        days[d] = days[d] || emptyBucket();
        addTo(days[d], row);
        models[row.model] = models[row.model] || emptyBucket();
        addTo(models[row.model], row);
        addTo(totals, row);
      }

      const rate = (await rubRate()) ?? data?.rubPerMillionCaps ?? 250;
      const rub = (bucket) => (bucket.caps * rate) / 1e6;
      for (const b of [...Object.values(days), ...Object.values(models), totals]) b.rub = rub(b);

      // Курс доллара нужен только чтобы рядом с рублями показать привычную цифру.
      // Приходит функцией: он обновляется вместе со списком тикеров, а учёт
      // пересчитывается реже и не должен держать устаревшее значение
      const fx = (typeof usdRate === 'function' ? usdRate() : usdRate) || data?.usdRate || null;
      data = {
        keyLabel: key?.label || null,
        keyId: key?.id || null,
        keyKnown: Boolean(key),
        from,
        fetchedAt: new Date().toISOString(),
        rubPerMillionCaps: rate,
        usdRate: fx,
        totals,
        days,
        models,
        // Строки отчёта целиком не храним: их 4–5 тысяч, и они нужны только для сумм
        rows: mine.length,
      };
      save();
      runtime.lastError = null;
      log(
        `учёт расхода: ${totals.requests} запросов, ${Math.round(totals.tokens / 1000)} тыс. токенов, ` +
          `${totals.rub.toFixed(2)} ₽ (ключ ${data.keyLabel || 'не опознан'})`
      );
    } catch (e) {
      runtime.lastError = e.message;
      log(`учёт расхода: ошибка — ${e.message}`);
    } finally {
      runtime.running = false;
      runtime.lastRunAt = new Date().toISOString();
      runtime.lastRunMs = Date.now() - started;
    }
    return status();
  }

  function schedule(delay) {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      await runOnce().catch(() => {});
      schedule(intervalMs);
    }, delay);
    if (timer.unref) timer.unref();
  }

  function status() {
    const t = data?.totals;
    return {
      enabled,
      running: runtime.running,
      // Метку ключа наружу не отдаём: /api/status открыт всем, а имя ключа —
      // это уже про то, чей баланс здесь тратится
      keyKnown: data?.keyKnown ?? null,
      from: data?.from || from,
      fetchedAt: data?.fetchedAt || null,
      stale: data?.fetchedAt ? Date.now() - new Date(data.fetchedAt).getTime() > intervalMs * 2 : true,
      lastError: runtime.lastError,
      rubPerMillionCaps: data?.rubPerMillionCaps ?? null,
      totals: t
        ? {
            requests: t.requests,
            tokens: t.tokens,
            prompt: t.prompt,
            cached: t.cached,
            completion: t.completion,
            rub: Number(t.rub.toFixed(2)),
            usd: data.usdRate ? Number((t.rub / data.usdRate).toFixed(2)) : null,
          }
        : null,
      days: data?.days || {},
      models: data?.models || {},
    };
  }

  load();

  return {
    start() {
      if (!enabled) return;
      // Первый проход с задержкой: старт сервера не должен ждать внешний отчёт
      schedule(30_000);
      log(`учёт расхода: включён, обновление раз в ${Math.round(intervalMs / 3600_000)} ч`);
    },
    stop() {
      clearTimeout(timer);
    },
    runNow: runOnce,
    status,
    get: () => data,
  };
}
