#!/usr/bin/env node
'use strict';

/**
 * @astralcore/aura-manager — Dashboard + Telegram Management Bot
 *
 * Full control over @astralcore/sl-aura sessions:
 * - View all sessions
 * - Delete/restart sessions
 * - View session stats
 */

require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');

// ── Config ─────────────────────────────────────────────────────
const PORT = process.env.MANAGER_PORT || 3100;
const MONGO_URI = process.env.MONGODB_URI || 'mongodb+srv://unity-free:unity-free@unity-free.pc6vkvw.mongodb.net/?appName=unity-free';
const TG_TOKEN = process.env.MANAGER_TG_TOKEN;
const ADMIN_USERS = (process.env.MANAGER_ADMINS || '').split(',').filter(Boolean);

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

// ── Session Schema (same as sl-aura) ──────────────────────────
const userAuthSchema = new mongoose.Schema({
  _id: String,
  data: { type: mongoose.Schema.Types.Mixed },
  updatedAt: { type: Date, default: Date.now }
});
const UserAuthState = mongoose.models.UserAuthState || mongoose.model('UserAuthState', userAuthSchema);

// ── Express Dashboard ──────────────────────────────────────────
function startDashboard() {
  const app = express();
  app.use(express.json());
  app.use(express.static(path.join(__dirname, 'public')));

  // ── API Routes ──
  app.get('/api/sessions', async (req, res) => {
    try {
      const sessions = await UserAuthState.find().select('_id updatedAt').lean();
      res.json({ ok: true, sessions });
    } catch (err) {
      res.json({ ok: false, error: err.message });
    }
  });

  app.delete('/api/sessions/:id', async (req, res) => {
    try {
      await UserAuthState.deleteOne({ _id: req.params.id });
      res.json({ ok: true, message: `Deleted ${req.params.id}` });
    } catch (err) {
      res.json({ ok: false, error: err.message });
    }
  });

  app.post('/api/sessions/:id/restart', async (req, res) => {
    try {
      // Update timestamp to trigger restart
      await UserAuthState.updateOne({ _id: req.params.id }, { updatedAt: new Date() });
      res.json({ ok: true, message: `Restart triggered for ${req.params.id}` });
    } catch (err) {
      res.json({ ok: false, error: err.message });
    }
  });

  // ── Serve dashboard HTML ──
  app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });

  app.listen(PORT, () => {
    console.log(`[DASH] Dashboard running at http://localhost:${PORT}`);
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
