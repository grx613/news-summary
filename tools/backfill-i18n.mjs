// Разовый перевод сводок, собранных до появления языков.
//
// Живому сервису этот файл не нужен: новые сводки переводятся при генерации.
// Здесь только наполнение rec.i18n у старых записей.
//
// Кеш нельзя править на ходу: работающий процесс держит его в памяти и
// перезаписывает файл целиком при следующем сохранении, так что правка
// потеряется. Поэтому работа в два шага:
//
//   node tools/backfill-i18n.mjs            # переводит, складывает в data/i18n-backfill.json
//   systemctl stop news-summary
//   node tools/backfill-i18n.mjs --merge    # вливает переводы в data/cache.json
//   systemctl start news-summary
//
// Первый шаг можно прерывать и повторять: уже переведённое берётся из
// файла-накопителя, а записи, у которых перевод есть в кеше, пропускаются.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { TRANS_LANG, TRANSLATION_SCHEMA, TRANSLATION_SYSTEM, buildTranslatePrompt, applyTranslation } from '../lib/summary-translate.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = process.env.DATA_DIR || path.join(ROOT, 'data');
const CACHE_FILE = path.join(DATA, 'cache.json');
const OUT_FILE = path.join(DATA, 'i18n-backfill.json');
const MERGE = process.argv.includes('--merge');
const LIMIT = Number(process.env.BACKFILL_LIMIT || 0);
const CONCURRENCY = Number(process.env.BACKFILL_CONCURRENCY || 3);

function loadEnv() {
  const file = path.join(ROOT, '.env');
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    out[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

const env = { ...loadEnv(), ...process.env };
const KEY = env.BOTHUB_API_KEY;
const MODEL = env.MODEL || 'claude-haiku-5.5';
const BASE = env.BOTHUB_BASE_URL || 'https://bothub.chat/api/v2/openai/v1';

// Копия правил сервера: дорогая модель не должна уйти в запрос даже здесь
const EXPENSIVE = new Set(['sonar-deep-research', 'sonar-reasoning-pro', 'sonar-reasoning']);

async function call(prompt) {
  const model = EXPENSIVE.has(MODEL) ? 'claude-haiku-5.5' : MODEL;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 90_000);
  try {
    const res = await fetch(`${BASE}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: TRANSLATION_SYSTEM },
          { role: 'user', content: prompt },
        ],
        max_tokens: 3000,
        temperature: 0.2,
        response_format: { type: 'json_schema', json_schema: { name: 'translation', strict: true, schema: TRANSLATION_SCHEMA } },
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    return data.choices?.[0]?.message?.content || '';
  } finally {
    clearTimeout(timer);
  }
}

function parseLoose(text) {
  try {
    return JSON.parse(text);
  } catch {}
  const a = text.indexOf('{');
  const b = text.lastIndexOf('}');
  if (a >= 0 && b > a) {
    try {
      return JSON.parse(text.slice(a, b + 1));
    } catch {}
  }
  return null;
}

async function translate(a, summary, lang) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const tr = applyTranslation(summary, parseLoose(await call(buildTranslatePrompt(a, summary, lang))));
      if (tr) return tr;
    } catch (e) {
      if (attempt) console.warn(`  ${lang}: ${e.message}`);
    }
  }
  return null;
}

async function merge() {
  const cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
  const done = fs.existsSync(OUT_FILE) ? JSON.parse(fs.readFileSync(OUT_FILE, 'utf8')) : {};
  let merged = 0;
  for (const [key, langs] of Object.entries(done)) {
    if (!cache[key]) continue;
    cache[key].i18n = { ...(cache[key].i18n || {}), ...langs };
    merged++;
  }
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
  console.log(`влито записей: ${merged}`);
}

async function main() {
  if (!KEY) throw new Error('нет BOTHUB_API_KEY');
  if (MERGE) return merge();

  const cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
  const done = fs.existsSync(OUT_FILE) ? JSON.parse(fs.readFileSync(OUT_FILE, 'utf8')) : {};

  const queue = Object.entries(cache)
    .filter(([key, rec]) => rec?.summary?.headline && Object.keys(rec.i18n || {}).length < Object.keys(TRANS_LANG).length)
    .filter(([key]) => !done[key] || Object.keys(done[key]).length < Object.keys(TRANS_LANG).length)
    .slice(0, LIMIT || undefined);

  console.log(`к переводу: ${queue.length} записей, по ${Object.keys(TRANS_LANG).length} языка, модель ${MODEL}`);

  let saved = 0;
  const save = () => fs.writeFileSync(OUT_FILE, JSON.stringify(done, null, 2));

  async function worker() {
    for (;;) {
      const item = queue.shift();
      if (!item) return;
      const [key, rec] = item;
      const langs = {};
      for (const lang of Object.keys(TRANS_LANG)) {
        const tr = await translate(rec.asset || { name: key, symbol: key }, rec.summary, lang);
        if (tr) langs[lang] = tr;
      }
      if (Object.keys(langs).length) {
        done[key] = { ...(done[key] || {}), ...langs };
        saved++;
        save();
        console.log(`  ${key}: ${Object.keys(langs).join(', ')} (осталось ${queue.length})`);
      } else {
        console.warn(`  ${key}: перевод не удался`);
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.log(`готово: переведено ${saved}, всего в накопителе ${Object.keys(done).length}`);
  console.log('дальше: systemctl stop news-summary && node tools/backfill-i18n.mjs --merge && systemctl start news-summary');
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
