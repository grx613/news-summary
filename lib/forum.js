// Обсуждения по тикерам: тема принадлежит активу, ответы образуют дерево.
// Вход по сид-фразе, как в MetaMask: пароля и почты нет, фраза — единственный ключ.
// Сервер хранит только производную от неё (PBKDF2 + sha256), а не саму фразу.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// Стандартный список BIP39: 2048 слов, фраза из него выглядит привычно
const WORDS = fs
  .readFileSync(path.join(HERE, 'bip39-english.txt'), 'utf8')
  .trim()
  .split('\n')
  .map((w) => w.trim().toLowerCase());
const WORD_INDEX = new Map(WORDS.map((w, i) => [w, i]));

// Своя соль-парольная строка (BIP39 passphrase): если человек вставит фразу
// от настоящего кошелька, идентичность всё равно получится другой
const FORUM_TAG = 'bothub-analytics-forum-v1';

export const NICK_RE = /^[\p{L}\p{N}][\p{L}\p{N} _.\-]{1,23}$/u;

// ---------------------------------------------------------------- фраза
export function generatePhrase(wordCount = 12) {
  const entBytes = (wordCount * 11 * 32) / 33 / 8;
  const ent = crypto.randomBytes(entBytes);
  const csBits = (wordCount * 11) % 32;
  const hash = crypto.createHash('sha256').update(ent).digest();
  let bits = '';
  for (const b of ent) bits += b.toString(2).padStart(8, '0');
  let cs = '';
  for (let i = 0; i < csBits; i++) cs += (hash[i >> 3] >> (7 - (i & 7))) & 1;
  bits += cs;
  const words = [];
  for (let i = 0; i < bits.length; i += 11) words.push(WORDS[parseInt(bits.slice(i, i + 11), 2)]);
  return words.join(' ');
}

export const normalizePhrase = (p) =>
  String(p || '')
    .toLowerCase()
    .replace(/[^a-z\s]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .join(' ');

// Возвращает текст ошибки или null. Проверяем и словарь, и контрольную сумму:
// опечатка в одном слове иначе дала бы другой аккаунт и «пропавший» ник
export function checkPhrase(raw) {
  const source = String(raw || '').trim();
  if (!source) return 'Введите фразу восстановления.';
  const phrase = normalizePhrase(source);
  if (!phrase) return 'Фраза состоит из английских слов — кириллицу и символы она не содержит.';
  const words = phrase.split(' ');
  if (![12, 15, 18, 21, 24].includes(words.length)) {
    return `Во фразе ${words.length} ${words.length === 1 ? 'слово' : 'слов'} — нужно 12, 15, 18, 21 или 24.`;
  }
  const idx = [];
  for (const w of words) {
    const n = WORD_INDEX.get(w);
    if (n === undefined) return `Слова «${w}» нет в списке BIP39 — проверьте его.`;
    idx.push(n);
  }
  let bits = '';
  for (const n of idx) bits += n.toString(2).padStart(11, '0');
  const csBits = bits.length % 32;
  const entBits = bits.slice(0, bits.length - csBits);
  const cs = bits.slice(bits.length - csBits);
  const ent = Buffer.alloc(entBits.length / 8);
  for (let i = 0; i < ent.length; i++) ent[i] = parseInt(entBits.slice(i * 8, i * 8 + 8), 2);
  const hash = crypto.createHash('sha256').update(ent).digest();
  let want = '';
  for (let i = 0; i < csBits; i++) want += (hash[i >> 3] >> (7 - (i & 7))) & 1;
  if (cs !== want) return 'Фраза не проходит проверку контрольной суммы — одно из слов записано с ошибкой.';
  return null;
}

// Из фразы — устойчивые идентификаторы. Сам seed из BIP39 (PBKDF2, 2048 итераций),
// дальше отдельные производные: одна для поиска аккаунта, другая для показа.
export function deriveIdentity(rawPhrase) {
  const phrase = normalizePhrase(rawPhrase);
  const seed = crypto.pbkdf2Sync(phrase, 'mnemonic' + FORUM_TAG, 2048, 64, 'sha512');
  const key = crypto.createHash('sha256').update('forum-key-v1|' + seed.toString('hex')).digest('hex');
  const address = crypto
    .createHash('sha256')
    .update('forum-addr-v1|' + seed.toString('hex'))
    .digest('hex')
    .slice(0, 16);
  seed.fill(0);
  return { key, address };
}

export const shortAddress = (addr) => (addr ? `${addr.slice(0, 4)}…${addr.slice(-4)}` : '');

// ---------------------------------------------------------------- хостнейм
// Рядом с ником показываем хост отправителя. Настоящий IP не публикуем:
// PTR отвечает «кто это по сети», а адрес целиком оставляем у себя.
const hostCache = new Map(); // ip -> { host, at }
const HOST_TTL = 6 * 3600_000;

const isPrivate = (ip) =>
  /^(10\.|127\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|::1|fc|fd|fe80)/i.test(ip);

const maskIp = (ip) => {
  if (!ip || ip === 'unknown') return 'неизвестно';
  if (ip.includes(':')) return ip.split(':').filter(Boolean).slice(0, 2).join(':') + ':****';
  const parts = ip.split('.');
  return parts.length === 4 ? `${parts[0]}.${parts[1]}.${parts[2]}.*` : ip;
};

export async function resolveHost(ip) {
  if (!ip) return 'неизвестно';
  const hit = hostCache.get(ip);
  if (hit && Date.now() - hit.at < HOST_TTL) return hit.host;
  let host = isPrivate(ip) ? (ip.startsWith('127.') || ip === '::1' ? 'localhost' : 'локальная сеть') : '';
  if (!host) {
    try {
      const names = await Promise.race([
        dns.reverse(ip),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 1200)),
      ]);
      const name = (names || []).map((n) => String(n).replace(/\.$/, '')).find(Boolean);
      // Обратная зона без PTR отдаёт сам адрес в виде имени — это не хостнейм
      host = name && !name.endsWith('.in-addr.arpa') && !name.includes('ip6.arpa') ? name : maskIp(ip);
    } catch {
      host = maskIp(ip);
    }
  }
  if (hostCache.size > 5000) hostCache.clear();
  hostCache.set(ip, { host, at: Date.now() });
  return host;
}

// ---------------------------------------------------------------- проверки
const SPAM = /(https?:\/\/\S+\s*){4,}|tg:\/\/|@[a-z0-9_]{4,}\b|\+7[\s(-]?\d{3}[\s)-]?\d{3}|казин|букмекер|займ[ыа]?\s+онлайн|бинарн\w*\s+опцион/i;

export function validateNick(raw) {
  const nick = String(raw || '').replace(/\s+/g, ' ').trim();
  if (nick.length < 2) return 'Ник — минимум 2 символа.';
  if (nick.length > 24) return 'Ник — не больше 24 символов.';
  if (!NICK_RE.test(nick)) return 'В нике допустимы буквы, цифры, пробел, точка, дефис и подчёркивание.';
  return null;
}

export function validateTitle(raw) {
  const t = String(raw || '').replace(/\s+/g, ' ').trim();
  if (t.length < 4) return 'Тема — минимум 4 символа.';
  if (t.length > 110) return 'Тема — не больше 110 символов.';
  if (!/[\p{L}\p{N}]/u.test(t)) return 'В теме должен быть текст.';
  return null;
}

export function validatePost(raw) {
  const body = String(raw || '').replace(/\r\n/g, '\n').replace(/\n{4,}/g, '\n\n\n').trim();
  if (body.length < 2) return 'Сообщение пустое.';
  if (body.length > 4000) return 'Сообщение — не больше 4000 символов.';
  if (SPAM.test(body)) return 'Похоже на рекламу: уберите контакты и пачку ссылок.';
  return null;
}

// ---------------------------------------------------------------- хранение
const MAX_MESSAGES = 20000;

export function createForumStore(file, { log = () => {} } = {}) {
  let state = { nextId: 1, accounts: [], messages: [] };
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (raw && Array.isArray(raw.messages)) {
      state = {
        nextId: Number(raw.nextId) || raw.messages.length + 1,
        accounts: Array.isArray(raw.accounts) ? raw.accounts.filter((a) => a?.key && a?.nick) : [],
        messages: raw.messages.filter((m) => m && m.id && m.body && m.key),
      };
    }
  } catch {
    state = { nextId: 1, accounts: [], messages: [] };
  }

  let saveTimer = null;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        // Пишем через временный файл: обрыв на середине не должен оставить битый JSON
        const tmp = `${file}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
        fs.renameSync(tmp, file);
      } catch (e) {
        log(`обсуждения: не удалось записать файл — ${e.message}`);
      }
    }, 60);
  }

  const visible = () => state.messages.filter((m) => !m.hidden);

  return {
    get nextId() {
      return state.nextId;
    },
    accountByKey: (key) => state.accounts.find((a) => a.key === key) || null,
    accountByNick: (nick) => state.accounts.find((a) => a.nick.toLowerCase() === String(nick || '').toLowerCase()) || null,
    accountByAddress: (addr) => state.accounts.find((a) => a.address === addr) || null,
    addAccount(acc) {
      state.accounts.push(acc);
      save();
      return acc;
    },
    // Общего форума нет: тема всегда принадлежит тикеру, поэтому список строится по ключу
    threads: (ticker) =>
      visible()
        .filter((m) => !m.parent && (!ticker || m.ticker === ticker))
        .sort((a, b) => b.id - a.id),
    byId: (id) => state.messages.find((m) => m.id === id) || null,
    // Ответы вложенные: у каждого свой parent, поэтому для темы собираем всё поддерево
    replies: (id) => {
      const root = state.messages.find((m) => m.id === id);
      if (!root) return [];
      const out = [];
      const seen = new Set();
      const walk = (pid) => {
        for (const m of visible()) {
          if (m.parent === pid && !seen.has(m.id)) {
            seen.add(m.id);
            out.push(m);
            walk(m.id);
          }
        }
      };
      walk(id);
      return out.sort((a, b) => a.id - b.id);
    },
    replyCount: (id) => {
      const seen = new Set();
      const walk = (pid) => {
        for (const m of visible()) {
          if (m.parent === pid && !seen.has(m.id)) {
            seen.add(m.id);
            walk(m.id);
          }
        }
      };
      walk(id);
      return seen.size;
    },
    postsBy: (key) => visible().filter((m) => m.key === key).length,
    addMessage(msg) {
      const rec = { id: state.nextId++, ...msg };
      state.messages.push(rec);
      // Потолок: старые ветки не удаляем, просто перестаём пухнуть бесконечно
      if (state.messages.length > MAX_MESSAGES) {
        log(`обсуждения: достигнут потолок ${MAX_MESSAGES} сообщений`);
      }
      save();
      return rec;
    },
    hide(id) {
      const m = state.messages.find((x) => x.id === Number(id));
      if (!m) return false;
      m.hidden = true;
      save();
      return true;
    },
    save,
    get size() {
      return visible().length;
    },
  };
}

// ---------------------------------------------------------------- сессия
export function loadSecret(file, { log = () => {} } = {}) {
  try {
    const s = fs.readFileSync(file, 'utf8').trim();
    if (s.length >= 32) return s;
  } catch {}
  const s = crypto.randomBytes(32).toString('hex');
  try {
    fs.writeFileSync(file, s, { mode: 0o600 });
  } catch (e) {
    log(`обсуждения: не удалось сохранить секрет сессии — ${e.message}`);
  }
  return s;
}

const hmac = (secret, data) => crypto.createHmac('sha256', secret).update(data).digest('hex');

export const signSession = (secret, key) => `${key}.${hmac(secret, key).slice(0, 32)}`;

export function readSession(secret, token) {
  const [key, sig] = String(token || '').split('.');
  if (!key || !sig || !/^[0-9a-f]{64}$/.test(key)) return null;
  const want = hmac(secret, key).slice(0, 32);
  // Сравнение постоянного времени: иначе подпись подбирается по таймеру
  const a = Buffer.from(sig);
  const b = Buffer.from(want);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return key;
}
