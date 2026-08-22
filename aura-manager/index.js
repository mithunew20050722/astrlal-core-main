#!/usr/bin/env node
'use strict';

/**
 * @astralcore/aura-manager — ASTRAL CORE npm Bots Control Panel
 *   (+ legacy sl-aura session tools, + Telegram management bot)
 *
 * This is the control panel for @astralcore/aura-wb (npm/yarn) installs
 * — it reads the AuraWbNode heartbeat collection each install upserts
 * itself into (see aura-wb's src/commands/nodeHeartbeat.js) and shows
 * which are currently online, completely separate from the boost
 * system (BoostJob/BoostResult) — the two only ever meet at the moment
 * an actual boost runs. Same "online" rule as the Telegram management
 * bot's /which: a heartbeat within AURA_WB_STALE_AFTER_MS counts as
 * online; anything older just ages out instead of showing forever.
 *
 * Also still carries the original, generic sl-aura session tools this
 * app started as (view/restart/delete raw UserAuthState docs) — kept
 * as a secondary tab, unchanged in behaviour, now sitting behind the
 * same login as everything else here.
 */

require('dotenv').config();
const express        = require('express');
const session         = require('express-session');
const helmet          = require('helmet');
const compression     = require('compression');
const mongoose        = require('mongoose');
const path            = require('path');

// ── Config ─────────────────────────────────────────────────────
const PORT              = process.env.MANAGER_PORT || 3100;
const MONGO_URI         = process.env.MONGODB_URI || 'mongodb+srv://unity-free:unity-free@unity-free.pc6vkvw.mongodb.net/?appName=unity-free';
const TG_TOKEN           = process.env.MANAGER_TG_TOKEN;
const ADMIN_USERS        = (process.env.MANAGER_ADMINS || '').split(',').filter(Boolean);
const MANAGER_PASSWORD   = process.env.MANAGER_PASSWORD || '';
const SESSION_SECRET     = process.env.MANAGER_SESSION_SECRET || 'astral-core-manager-' + Math.random().toString(36).slice(2);
// Same threshold as sl-aura's managementBot.js /which — keep in sync if
// either changes, they're independent codebases sharing one convention.
const AURA_WB_STALE_AFTER_MS = 3 * 60_000;

// Sibling dashboards this panel links out to (and is linked back from).
// Configurable per-deployment — see root README for the documented
// local port layout (selector:3000, unity-md:3001, sl-aura:3002) vs a
// production reverse-proxy/duckdns layout.
const CROSS_LINKS = {
  selector: process.env.SELECTOR_URL || 'http://localhost:3000',
  unity:    process.env.UNITY_DASHBOARD_URL || 'http://localhost:3001',
  aura:     process.env.AURA_DASHBOARD_URL  || 'http://localhost:3002',
};

if (!MANAGER_PASSWORD) {
  console.warn('[AUTH] ⚠️  MANAGER_PASSWORD not set — dashboard is running with NO password protection.');
  console.warn('[AUTH] ⚠️  Set MANAGER_PASSWORD in aura-manager/.env before exposing this publicly.');
}

// ── MongoDB ────────────────────────────────────────────────────
async function connectDB() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log(`[DB] Connected to MongoDB`);
  } catch (err) {
    console.error(`[DB] Failed to connect: ${err.message}`);
    process.exit(1);
  }
}

// ── Schemas ───────────────────────────────────────────────────
// Same shape as sl-aura/src/commands/index.js — kept independent
// (this app has no dependency on the bot source trees) but must agree
// with them since all sides share one MongoDB.
const userAuthSchema = new mongoose.Schema({
  _id: String,
  data: { type: mongoose.Schema.Types.Mixed },
  updatedAt: { type: Date, default: Date.now }
});
const UserAuthState = mongoose.models.UserAuthState || mongoose.model('UserAuthState', userAuthSchema);

const auraWbNodeSchema = new mongoose.Schema({
  sessionId:   { type: String, required: true, unique: true },
  number:      String,
  name:        String,
  connectedAt: { type: Date, default: Date.now },
  lastSeenAt:  { type: Date, default: Date.now },
}, { versionKey: false });
const AuraWbNode = mongoose.models.AuraWbNode || mongoose.model('AuraWbNode', auraWbNodeSchema);

function withOnlineFlag(node) {
  return { ...node, online: (Date.now() - new Date(node.lastSeenAt).getTime()) <= AURA_WB_STALE_AFTER_MS };
}

// ── Auth middleware ──────────────────────────────────────────
function requireAuth(req, res, next) {
  if (!MANAGER_PASSWORD) return next(); // no password configured — dev mode
  if (req.session && req.session.authenticated) return next();
  res.status(401).json({ ok: false, error: 'Not authenticated' });
}

function requirePageAuth(req, res, next) {
  if (!MANAGER_PASSWORD) return next();
  if (req.session && req.session.authenticated) return next();
  res.redirect('/login.html');
}

// ── Express Dashboard ──────────────────────────────────────────
function startDashboard() {
  const app = express();
  app.use(helmet({ contentSecurityPolicy: false })); // CSP off: inline <style>/<script> in the static pages
  app.use(compression());
  app.use(express.json());
  app.use(session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 12 * 60 * 60 * 1000 }, // 12h
  }));

  // ── Auth routes ──
  app.post('/api/login', (req, res) => {
    const { password } = req.body || {};
    if (!MANAGER_PASSWORD || password === MANAGER_PASSWORD) {
      req.session.authenticated = true;
      return res.json({ ok: true });
    }
    res.status(401).json({ ok: false, error: 'Wrong password' });
  });
  app.post('/api/logout', (req, res) => {
    req.session.destroy(() => res.json({ ok: true }));
  });
  app.get('/api/auth-status', (req, res) => {
    res.json({ ok: true, authenticated: !MANAGER_PASSWORD || !!(req.session && req.session.authenticated) });
  });

  // ── Cross-link config (for the frontend nav) ──
  app.get('/api/cross-links', requireAuth, (req, res) => {
    res.json({ ok: true, links: CROSS_LINKS });
  });

  // ── npm bots (AuraWbNode) ──────────────────────────────────
  app.get('/api/npm-nodes', requireAuth, async (req, res) => {
    try {
      const nodes = await AuraWbNode.find().sort({ lastSeenAt: -1 }).lean();
      const withFlags = nodes.map(withOnlineFlag);
      res.json({
        ok: true,
        total: withFlags.length,
        online: withFlags.filter(n => n.online).length,
        nodes: withFlags,
      });
    } catch (err) {
      res.json({ ok: false, error: err.message });
    }
  });

  app.delete('/api/npm-nodes/:sessionId', requireAuth, async (req, res) => {
    try {
      await AuraWbNode.deleteOne({ sessionId: req.params.sessionId });
      res.json({ ok: true, message: `Removed ${req.params.sessionId}` });
    } catch (err) {
      res.json({ ok: false, error: err.message });
    }
  });

  // ── Legacy: generic sl-aura session tools (unchanged behaviour) ──
  app.get('/api/sessions', requireAuth, async (req, res) => {
    try {
      const sessions = await UserAuthState.find().select('_id updatedAt').lean();
      res.json({ ok: true, sessions });
    } catch (err) {
      res.json({ ok: false, error: err.message });
    }
  });

  app.delete('/api/sessions/:id', requireAuth, async (req, res) => {
    try {
      await UserAuthState.deleteOne({ _id: req.params.id });
      res.json({ ok: true, message: `Deleted ${req.params.id}` });
    } catch (err) {
      res.json({ ok: false, error: err.message });
    }
  });

  app.post('/api/sessions/:id/restart', requireAuth, async (req, res) => {
    try {
      // Update timestamp to trigger restart
      await UserAuthState.updateOne({ _id: req.params.id }, { updatedAt: new Date() });
      res.json({ ok: true, message: `Restart triggered for ${req.params.id}` });
    } catch (err) {
      res.json({ ok: false, error: err.message });
    }
  });

  // ── Static pages (login page always open; everything else gated) ──
  app.get('/login.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
  });
  app.get('/', requirePageAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });
  app.use(express.static(path.join(__dirname, 'public')));

  app.listen(PORT, () => {
    console.log(`[DASH] npm Bots Control Panel running at http://localhost:${PORT}`);
  });
}

// ── Telegram Management Bot ────────────────────────────────────
function startTelegramBot() {
  if (!TG_TOKEN) {
    console.log('[TG] No token provided — Telegram bot disabled');
    return;
  }

  const TelegramBot = require('node-telegram-bot-api');
  const bot = new TelegramBot(TG_TOKEN, { polling: true });

  bot.onText(/\/sessions/, async (msg) => {
    if (!ADMIN_USERS.includes(msg.from.id.toString())) return;
    try {
      const sessions = await UserAuthState.find().select('_id updatedAt').lean();
      if (sessions.length === 0) {
        bot.sendMessage(msg.chat.id, 'No active sessions.');
        return;
      }
      let text = `📊 **Active Sessions (${sessions.length})**\n\n`;
      sessions.forEach((s, i) => {
        const time = s.updatedAt ? new Date(s.updatedAt).toLocaleString() : 'unknown';
        text += `${i + 1}. \`"${s._id}"\`\n   Last: ${time}\n`;
      });
      bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
    } catch (err) {
      bot.sendMessage(msg.chat.id, `❌ Error: ${err.message}`);
    }
  });

  bot.onText(/\/delete (.+)/, async (msg, match) => {
    if (!ADMIN_USERS.includes(msg.from.id.toString())) return;
    const sessionId = match[1];
    try {
      await UserAuthState.deleteOne({ _id: sessionId });
      bot.sendMessage(msg.chat.id, `✅ Deleted session: \`${sessionId}\``, { parse_mode: 'Markdown' });
    } catch (err) {
      bot.sendMessage(msg.chat.id, `❌ Error: ${err.message}`);
    }
  });

  bot.onText(/\/restart (.+)/, async (msg, match) => {
    if (!ADMIN_USERS.includes(msg.from.id.toString())) return;
    const sessionId = match[1];
    try {
      await UserAuthState.updateOne({ _id: sessionId }, { updatedAt: new Date() });
      bot.sendMessage(msg.chat.id, `🔄 Restart triggered for: \`${sessionId}\``, { parse_mode: 'Markdown' });
    } catch (err) {
      bot.sendMessage(msg.chat.id, `❌ Error: ${err.message}`);
    }
  });

  bot.onText(/\/stats/, async (msg) => {
    if (!ADMIN_USERS.includes(msg.from.id.toString())) return;
    try {
      const total = await UserAuthState.countDocuments();
      const recent = await UserAuthState.countDocuments({ updatedAt: { $gte: new Date(Date.now() - 3600000) } });
      bot.sendMessage(msg.chat.id, `📊 **Stats**\n\nTotal sessions: ${total}\nActive (last hour): ${recent}`);
    } catch (err) {
      bot.sendMessage(msg.chat.id, `❌ Error: ${err.message}`);
    }
  });

  bot.onText(/\/npmbots/, async (msg) => {
    if (!ADMIN_USERS.includes(msg.from.id.toString())) return;
    try {
      const nodes = (await AuraWbNode.find().sort({ lastSeenAt: -1 }).lean()).map(withOnlineFlag);
      const online = nodes.filter(n => n.online);
      if (nodes.length === 0) {
        bot.sendMessage(msg.chat.id, 'No npm bot installs have ever reported in.');
        return;
      }
      let text = `🌐 **npm Bots — ${online.length} online / ${nodes.length} total**\n\n`;
      nodes.forEach((n, i) => {
        text += `${i + 1}. ${n.online ? '🟢' : '⚫'} +${n.number || '?'}  _(last seen ${new Date(n.lastSeenAt).toLocaleString()})_\n`;
      });
      bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
    } catch (err) {
      bot.sendMessage(msg.chat.id, `❌ Error: ${err.message}`);
    }
  });

  console.log(`[TG] Telegram management bot running`);
}

// ── Start Everything ───────────────────────────────────────────
async function main() {
  await connectDB();
  startDashboard();
  startTelegramBot();
}

main().catch(err => {
  console.error(`[FATAL] ${err.message}`);
  process.exit(1);
});
