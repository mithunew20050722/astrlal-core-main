'use strict';
const strings = require('./strings');
const db = require('../commands/index');

// ── Per-session in-memory lang cache ─────────────────────────
// Map<sessionId, { lang, time }>
const _cache = new Map();
const CACHE_TTL = 10_000; // 10 seconds

async function getLang(sessionId = 'config') {
  // FIX (2026-07): default changed from 'en' to 'si' — this bot's users
  // are almost entirely Sinhala speakers; English should be an opt-in
  // choice (via whatever sets botCfg.lang), not the silent fallback.
  const now = Date.now();
  const cached = _cache.get(sessionId);
  if (cached && (now - cached.time) < CACHE_TTL) return cached.lang;
  try {
    const botCfg = await db.getBotConfig(sessionId);
    const lang = botCfg?.lang || 'si';
    _cache.set(sessionId, { lang, time: now });
    return lang;
  } catch {}
  return 'si';
}

// Call this after saving lang to DB so cache refreshes immediately
function setLangCache(lang, sessionId = 'config') {
  _cache.set(sessionId, { lang, time: Date.now() });
}

function t(key, lang = 'si') {
  const entry = strings[key];
  if (!entry) return key;
  if (entry[lang] !== undefined && entry[lang] !== '') return entry[lang];
  return entry['en'] || key;
}

async function getT(sessionId = 'config') {
  const lang = await getLang(sessionId);
  return (key) => t(key, lang);
}

module.exports = { t, getLang, getT, setLangCache };
