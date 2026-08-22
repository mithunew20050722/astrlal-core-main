'use strict';
require('dotenv').config({ path: require('path').join(__dirname, 'config.env') });
const { toSmallCaps } = require('./src/commands/helper');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  makeInMemoryStore,
  proto,
  generateWAMessageFromContent,
  prepareWAMessageMedia,
  Browsers } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const pino = require('pino');
const chalk = require('chalk');
// FIX (2026-07): jadibot.js's .pair command already tried to read
// sock.store?.contacts?.[jid] to resolve a @lid chat to its real phone
// number, but nothing ever created or bound a store — sock.store was
// always undefined, so "auto-detect number" silently never worked.
// This creates that store once and binds it below, after the socket
// is created. Wrapped defensively: if makeInMemoryStore isn't exported
// by the installed Baileys version, the bot still boots fine — the
// .pair command just falls back to asking the user to type their number.
let contactStore = null;
try {
  if (typeof makeInMemoryStore === 'function') {
    contactStore = makeInMemoryStore({ logger: pino().child({ level: 'silent', stream: 'store' }) });
  }
} catch (_e) { contactStore = null; }
const fs = require('fs-extra');
const NodeCache = require('node-cache');
const cfg = require('./config');
const axios = require('axios');
const path = require('path');
// FIX (2026-07): startup thumbnail was a hardcoded remote UNITY-MD image
// URL — Aura now uses its own local branded image instead.
const AURA_THUMB_PATH = path.join(__dirname, 'src/media/aura_thumb.jpg');
const FORWARD_CHANNEL_JID = '120363419201971095@newsletter';
const db = require('./src/commands/index');
const { handleMessage, loadPlugins, plugins } = require('./src/commands/messageHandler');
const { handleGroupJoin, handleGroupLeave } = require('./src/commands/groupHandler');
const { init: initAuto, autoBehaviors, handleStatus, handleCall } = require('./src/commands/autoHandler');
// FIX (2026-07): this was a bare top-level require — if dashboard/server.js
// throws while setting up (e.g. its Mongo session store can't init because
// MONGODB_URI didn't resolve), it used to take the ENTIRE bot process down
// before WhatsApp even tried to connect. A broken dashboard should never be
// able to kill the WhatsApp connection, so this is now wrapped defensively.
let startDashboard = () => { console.log(chalk.yellow('[DASHBOARD] Disabled (failed to load).')); };
try {
  ({ startDashboard } = require('./dashboard/server'));
} catch (dashErr) {
  console.error(chalk.red('[DASHBOARD] Failed to load — bot will still run, dashboard is unavailable.'));
  console.error(chalk.red('[DASHBOARD] Reason:'), dashErr.message);
  console.error(chalk.gray('[DASHBOARD] Check config.env → MONGODB_URI is set and reachable.'));
}
const { start: startPairBot } = require('./src/telegram/pairBot');
const { start: startMgmtBot } = require('./src/telegram/managementBot');

function showBanner() {
  console.log(chalk.magenta(`
╔════════════════════════════════════════╗
║                                        ║
║   🖤   ❮❮   A U R A   ❯❯   🌑          ║
║       ⛧  T H E   D A R K   O N E S    ║
║                                        ║
╠════════════════════════════════════════╣
║  Version  : 2.0.0                      ║
║  Creator  : ASTRAL CORE 🇱🇰            ║
║  Database : MongoDB (Shared DB)     ║
║  Commands : 350+                       ║
╚════════════════════════════════════════╝`));
  console.log(chalk.gray('\n  Awakening from the dark...\n'));
}

const messageStore = new Map();
const msgRetryCounterCache = new NodeCache();
let sock = null;
let retryCount      = 0;
const MAX_RETRIES   = 10;           // give up after 10 consecutive fails
const BASE_DELAY_MS = 3_000;        // 3s first retry
const MAX_DELAY_MS  = 300_000;      // cap at 5 min

function getReconnectDelay() {
  // Exponential backoff with jitter: 3s, 6s, 12s … up to 5min
  const exp   = Math.min(retryCount, 8);
  const base  = BASE_DELAY_MS * Math.pow(2, exp);
  const jitter = Math.floor(Math.random() * 2000);
  return Math.min(base + jitter, MAX_DELAY_MS);
}

function safeReconnect(label = '') {
  retryCount++;
  if (retryCount > MAX_RETRIES) {
    console.error(chalk.red(`[CONN] ${MAX_RETRIES} consecutive reconnect failures — stopping to protect session.`));
    console.error(chalk.red('[CONN] Restart the process manually.'));
    return;
  }
  const delay = getReconnectDelay();
  console.log(chalk.yellow(`[CONN] ${label} — retry ${retryCount}/${MAX_RETRIES} in ${Math.round(delay/1000)}s`));
  setTimeout(() => connectToWhatsApp(), delay);
}
let pairingStarted = false;
let pairingInterval = null;

// FIX (2026-07): the loggedOut/forbidden branches below used to clear auth
// and reconnect UNCONDITIONALLY, forever, with zero cap — unlike every
// other disconnect reason, which goes through safeReconnect()'s
// MAX_RETRIES. If WhatsApp logs the number out again right after each
// fresh pairing code is issued (which is exactly what happens if nobody
// is there entering the code, or WA is rate-limiting repeated pair
// attempts), this becomes an infinite connect → new-code → 401 → clear →
// reconnect loop — spamming a real phone number with pairing codes
// forever. Capped the same way safeReconnect() already caps transient
// disconnects.
let logoutAttempts = 0;
const MAX_LOGOUT_ATTEMPTS = 3;

global.SL_AURA_THUMB = AURA_THUMB_PATH;
global.sendThumb = async (sock, jid, text, quoted = null) => {
  try {
    return await sock.sendMessage(jid,
      { image: { url: global.SL_AURA_THUMB }, caption: text },
      quoted ? { quoted } : {}
    );
  } catch (e) {}
  return sock.sendMessage(jid, { text }, quoted ? { quoted } : {});
};

async function connectToWhatsApp() {
  pairingStarted = false;

  try {
    await db.connect();

    const { state, saveCreds } = await db.useMongoDBAuthState();
    const { version } = await fetchLatestBaileysVersion();
    const logger = pino({ level: 'silent' });

    sock = makeWASocket({
      version,
      logger,
      msgRetryCounterCache,
      syncFullHistory: false,
      maxMsgRetryCount: 15,
      retryRequestDelayMs: 10,
      defaultQueryTimeoutMs: 0,
      connectTimeoutMs: 120000,
      keepAliveIntervalMs: 10000,
      maxRetries: 10,
      generateHighQualityLinkPreview: false,
      markOnlineOnConnect: cfg.features?.autoOnline || false,
      printQRInTerminal: false,
      transactionOpts: {
        maxCommitRetries: 10,
        delayBetweenTriesMs: 10,
      },
      appStateMacVerification: {
        patch: true,
        snapshot: true,
      },
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, logger),
      },
      getMessage: async (key) => {
        const stored = messageStore.get(key.id);
        return stored || proto.Message.fromObject({});
      },
      browser: Browsers.baileys('Desktop'),
    });

    // Bind + expose the contact store (see contactStore comment near top)
    if (contactStore) {
      try {
        contactStore.bind(sock.ev);
        sock.store = contactStore;
      } catch (_e) {}
    }

    global.astraSock = sock;

    // ── Global Fake WhatsApp Status Context Patch ─────────────────
    const _fakeStatusCtx = () => ({
      remoteJid:    'status@broadcast',
      participant:  '0@s.whatsapp.net',
      fromMe:       false,
      stanzaId:     '3EB0' + [...Array(16)].map(() =>
        Math.floor(Math.random()*16).toString(16).toUpperCase()).join(''),
      quotedMessage: { conversation: 'Wait loading menu...' },
    });
    const _skipContent = new Set(['delete','react','poll','keep','pin','unpin','star','disappearingMessagesInChat','groupInviteMessage']);

    // ── Original sendMessage (before we wrap it) ─────────────────
    const _origSendMsg = sock.sendMessage.bind(sock);

    // ── Wrap sendMessage: convert all text to smallcaps ──────────
    const _wrappedSendMsg = function(jid, content, opts = {}) {
      // Convert text content to smallcaps
      if (content.text) content.text = toSmallCaps(content.text);
      if (content.caption) content.caption = toSmallCaps(content.caption);
      // Also convert buttons text if present
      if (opts?.quoted) {
        // don't touch quoted messages
      }
      return _origSendMsg(jid, content, opts);
    };

    // Override sendMessage on the sock object
    sock.sendMessage = _wrappedSendMsg;

    // ── Channel forward helper ──────────────────────────────────
    // Posts clean copy to newsletter — no "Forwarded" label, no status quote.
    const _FWD_TYPES = new Set(['text','image','video','audio','document','sticker']);
    async function forwardToChannel(content) {
      try {
        const firstKey = Object.keys(content)[0];
        if (!_FWD_TYPES.has(firstKey)) return;
        // Completely clean copy — no contextInfo, no forward, no quoted
        // This prevents "Forwarded many times" and "You • Status" quote
        const fwd = {};
        if (firstKey === 'text') {
          fwd.text = content.text || content.caption || '';
        } else {
          fwd[firstKey] = content[firstKey];
          if (content.caption)  fwd.caption  = content.caption;
          if (content.mimetype) fwd.mimetype  = content.mimetype;
          if (content.ptt)      fwd.ptt       = content.ptt;
        }
        // Send with _origSendMsg directly — bypasses sendMessage patch
        // (avoids infinite loop and strips all contextInfo)
        await _origSendMsg(FORWARD_CHANNEL_JID, fwd, {});
      } catch (_fe) {}
    }

    // ── Channel ad-reply contextInfo (looks like sent from channel) ──
    const _CHANNEL_URL  = process.env.AUTO_JOIN_CHANNEL || 'https://whatsapp.com/channel/0029Vb6UYsDCxoArqy6JsX0l';
    const _CHANNEL_THUMB = global.SL_AURA_THUMB || AURA_THUMB_PATH;
    function _channelCtx() {
      return {
        externalAdReply: {
          title:                 'SL AURA',
          body:                  '® ASTRAL CORE',
          thumbnailUrl:          _CHANNEL_THUMB,
          sourceUrl:             _CHANNEL_URL,
          mediaType:             1,
          renderLargerThumbnail: false,
          showAdAttribution:     true,
        },
      };
    }

    sock.sendMessage = async (jid, content, opts = {}) => {
      const firstKey = Object.keys(content)[0];
      if (!_skipContent.has(firstKey) && !opts.quoted && content.contextInfo?.remoteJid !== 'status@broadcast') {
        content = { ...content, contextInfo: _fakeStatusCtx() };
      }
      return _origSendMsg(jid, content, opts);
    };
    const _origRelay = sock.relayMessage.bind(sock);
    sock.relayMessage = async (jid, msg, opts = {}) => {
      try {
        const im = msg?.viewOnceMessage?.message?.interactiveMessage;
        if (im && !im.contextInfo?.remoteJid) im.contextInfo = _fakeStatusCtx();
        for (const t of ['conversation','extendedTextMessage','imageMessage','videoMessage','audioMessage','documentMessage']) {
          const node = msg[t];
          if (node && !node.contextInfo?.remoteJid) { node.contextInfo = _fakeStatusCtx(); break; }
        }
      } catch {}
      return _origRelay(jid, msg, opts);
    };
    // ──────────────────────────────────────────────────────────────

    initAuto(sock);

    sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {

      if ((connection === 'connecting' || !!qr) && !sock.authState.creds.registered && !pairingStarted) {
        pairingStarted = true;
        const num = cfg.ownerNumber?.replace(/[^0-9]/g, '');
        if (num) {
          const requestCode = async () => {
            if (sock.authState.creds.registered) return;
            try {
              const code = await sock.requestPairingCode(num);
              const formatted = code?.match(/.{1,4}/g)?.join('-') || code;
              console.log(chalk.bgGreen.black(' ════════════════════════════ '));
              console.log(chalk.cyan(`🔑 PAIRING CODE: `), chalk.bgWhite.black.bold(` ${formatted} `));
              console.log(chalk.yellow('⏰ WhatsApp → Linked Devices → Link a Device → Enter code'));
              console.log(chalk.bgGreen.black(' ════════════════════════════ '));
            } catch (e) {
              console.error(chalk.red('[PAIR] Failed:'), e.message);
            }
          };
          setTimeout(async () => {
            await requestCode();
            pairingInterval = setInterval(async () => {
              if (sock.authState.creds.registered) {
                clearInterval(pairingInterval);
                return;
              }
              await requestCode();
            }, 115000);
          }, 3000);
        }
      }

      if (connection === 'close') {
        const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
        console.log(chalk.red(`[CONN] Closed — code: ${reason}`));
        if (pairingInterval) { clearInterval(pairingInterval); pairingInterval = null; }

        if (reason === DisconnectReason.connectionLost) {
          safeReconnect('Connection lost');
        } else if (reason === DisconnectReason.connectionClosed) {
          safeReconnect('Connection closed');
        } else if (reason === DisconnectReason.restartRequired) {
          safeReconnect('Restart required');
        } else if (reason === DisconnectReason.timedOut) {
          safeReconnect('Timed out');
        } else if (reason === DisconnectReason.badSession) {
          console.log(chalk.red('❌ Bad session — clearing creds and reconnecting...'));
          retryCount = 0; // reset — fresh session
          safeReconnect('Bad session');
        } else if (reason === DisconnectReason.loggedOut) {
          // FIX (2026-07): previously this retried with the SAME stale creds,
          // which stay "registered" forever → bot loops connect→loggedOut
          // forever and never offers a fresh pairing code. Clear the stored
          // auth so the next connect attempt starts clean and re-pairs.
          logoutAttempts++;
          if (logoutAttempts > MAX_LOGOUT_ATTEMPTS) {
            console.error(chalk.red(`[SESSION] Logged out ${MAX_LOGOUT_ATTEMPTS} times in a row — stopping auto-reconnect.`));
            console.error(chalk.red('[SESSION] This number needs a fresh, manually-requested .pair — restart the process once someone is ready to enter the code.'));
            return;
          }
          console.log(chalk.yellow(`🚪 Logged out — clearing stale session, will request a new pairing code... (${logoutAttempts}/${MAX_LOGOUT_ATTEMPTS})`));
          retryCount = 0;
          try {
            const ns = (cfg.sessionId || 'default').replace(/[^a-zA-Z0-9_-]/g, '');
            await db.AuthState.deleteMany({ _id: new RegExp(`^${ns}:`) });
            console.log(chalk.gray('[SESSION] Stale auth cleared from DB.'));
          } catch (e) {
            console.error(chalk.red('[SESSION] Failed to clear stale auth:'), e.message);
          }
          setTimeout(() => connectToWhatsApp(), 5000);
        } else if (reason === DisconnectReason.forbidden) {
          // Same fix as loggedOut — forbidden is also a permanent ban/unlink,
          // retrying with the old creds would just loop forever.
          logoutAttempts++;
          if (logoutAttempts > MAX_LOGOUT_ATTEMPTS) {
            console.error(chalk.red(`[SESSION] Forbidden ${MAX_LOGOUT_ATTEMPTS} times in a row — stopping auto-reconnect.`));
            console.error(chalk.red('[SESSION] This number needs a fresh, manually-requested .pair — restart the process once someone is ready to enter the code.'));
            return;
          }
          console.log(chalk.red(`❌ Forbidden — clearing stale session, waiting 5min before reconnect... (${logoutAttempts}/${MAX_LOGOUT_ATTEMPTS})`));
          retryCount = 0;
          try {
            const ns = (cfg.sessionId || 'default').replace(/[^a-zA-Z0-9_-]/g, '');
            await db.AuthState.deleteMany({ _id: new RegExp(`^${ns}:`) });
          } catch (e) {
            console.error(chalk.red('[SESSION] Failed to clear stale auth:'), e.message);
          }
          setTimeout(() => connectToWhatsApp(), 300000);
        } else if (reason === DisconnectReason.multideviceMismatch) {
          safeReconnect('Multi-device mismatch');
        } else {
          safeReconnect(`Unknown (${reason})`);
        }
        return;
      }

      if (connection === 'open') {
        retryCount = 0; // successful connect — reset backoff counter
        logoutAttempts = 0;
        pairingStarted = false;
        if (pairingInterval) { clearInterval(pairingInterval); pairingInterval = null; }
        global.astraSock = sock;

        // ── Polyfill: sock.downloadMediaMessage (media commands) ──────
        if (!sock.downloadMediaMessage) {
          const { downloadMediaMessage: _dlMedia } = require('@whiskeysockets/baileys');
          sock.downloadMediaMessage = (msg) => _dlMedia(msg, 'buffer', {}, {
            logger: require('pino')({ level: 'silent' }),
            reuploadRequest: sock.updateMediaMessage,
          });
        }

        // ── Set sessionOwner for parser.js owner detection ────────────
        if (!sock.sessionOwner) {
          const _ownerNum = process.env.OWNER_NUMBERS?.split(',')[0]?.replace(/[^0-9]/g,'') ||
                            process.env.OWNER_NUMBER?.replace(/[^0-9]/g,'') || '';
          if (_ownerNum) sock.sessionOwner = _ownerNum;
        }

        // ── Register main bot in sessionManager so mgmt bot can use it ──
        try {
          const _sm = global.astraSessionManager;
          if (_sm && _sm.registerMainSession) {
            const _mainNum = sock.user?.id?.split(':')[0];
            if (_mainNum) _sm.registerMainSession(_mainNum, sock);
          }
        } catch (_re) {}

        // ── Join channel boosts triggered anywhere else (other bot,
        // any aura-wb npm install, dashboard, Telegram mgmt bot) ──────
        try {
          require('./src/commands/boostWatcher').startBoostWatcher();
        } catch (_bwe) {}

        const user = sock.user;
        const num = user?.id?.split(':')[0];
        console.log(chalk.green(`\n[✅] Connected: ${user?.name} (+${num})`));
        console.log(chalk.cyan(`[🧲] SL AURA LIVE — ${plugins.size}+ commands\n`));

        const os = require('os');
        const onlineMsg =
            `╔═══════════════════════╗\n` +
            `║   🖤  A U R A  🌑    ║\n` +
            `║  ───────────────────  ║\n` +
            `║   ⛧ HAS AWAKENED ⛧   ║\n` +
            `╚═══════════════════════╝\n\n` +
            `🖤 *Aura is watching now.*\n\n` +
            `┌─────────────────────\n` +
            `│ 👁️ *Number:* +${num}\n` +
            `│ 🗡️ *Commands:* ${plugins.size}+\n` +
            `│ 🌑 *RAM:* ${(process.memoryUsage().rss/1024/1024).toFixed(1)} MB\n` +
            `│ 🖥️ *OS:* ${os.platform()} ${os.arch()}\n` +
            `│ 📅 *Time:* ${new Date().toLocaleString('en-LK', { timeZone: cfg.timezone })}\n` +
            `└─────────────────────\n\n` +
            `⛧ _The dark has fully awakened. Speak, and Aura listens._\n\n` +
            `${cfg.footer}`;

        // ── Startup message → own inbox ──────────────────────────
        setImmediate(async () => {
          try {
            const selfJid = sock.user?.id?.replace(/:[0-9]+@/, '@') || `${num}@s.whatsapp.net`;
            const THUMB_URL = AURA_THUMB_PATH;
            const AUDIO_URL = 'https://www.image2url.com/r2/default/audio/1776957022770-98aea04d-2005-48b7-8bec-cc060ae20da9.mp3';

            // Channel JID for "View channel" button
            const channelJid = cfg.channel1 || '120363419201971095@newsletter';
            const channelId  = channelJid.replace('@newsletter', '');
            const channelUrl = `https://whatsapp.com/channel/${channelId}`;

            // 1) Image + caption + channel ad-reply (forwarded from channel look)
            const _chUrl   = process.env.AUTO_JOIN_CHANNEL || 'https://whatsapp.com/channel/0029Vb6UYsDCxoArqy6JsX0l';
            const _startupPayload = {
              image: { url: THUMB_URL },
              caption: onlineMsg,
              contextInfo: {
                isForwarded: true,
                forwardingScore: 1,
                forwardedNewsletterMessageInfo: {
                  newsletterJid:   '120363419201971095@newsletter',
                  newsletterName:  'SL AURA',
                  serverMessageId: -1,
                },
              },
            };
            await sock.sendMessage(selfJid, _startupPayload).catch(() => {});

            // ── Forward startup message to channel ────────────────
            try {
              await _origSendMsg(FORWARD_CHANNEL_JID, {
                image: { url: THUMB_URL },
                caption: onlineMsg,
              });
            } catch (_cfe) {}

            // 2) Audio — local file first, fallback to URL
            const _audioPath = require('path').join(__dirname, 'src/media/startup_voice.ogg');
            const _audioExists = require('fs-extra').existsSync(_audioPath);
            await sock.sendMessage(selfJid, {
              audio: _audioExists ? { url: 'file://' + _audioPath } : { url: AUDIO_URL },
              mimetype: _audioExists ? 'audio/ogg; codecs=opus' : 'audio/mp4',
              ptt: true,
            }).catch(() => {});

          } catch (_e) {}
        });

        // ── Image pool: background download 30 fresh images ──────
        // Command runs use local disk images (no per-command API call)
        setImmediate(() => {
          require('./src/commands/imageCache').initImagePool().catch(e =>
            console.error('[imageCache] Pool init failed:', e.message)
          );
        });
      }
    });

    sock.ev.on('creds.update', saveCreds);

    // ── Telegram reaction-notify helper ──────────────────────────
    async function notifyReactionTelegram(senderJid, emoji, msgText) {
      try {
        const TG_TOKEN = process.env.TG_MGMT_BOT_TOKEN;
        const TG_CHAT  = '7752365037';
        if (!TG_TOKEN) return;
        const senderNum = senderJid.replace(/[^0-9]/g, '');
        const preview   = msgText ? `\n📄 *Message:* ${msgText.slice(0, 80)}` : '';
        const text = `${emoji} *React Notification*\n👤 *From:* +${senderNum}${preview}\n🔗 [WhatsApp](https://wa.me/${senderNum})`;
        await axios.post(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
          chat_id: TG_CHAT,
          text,
          parse_mode: 'Markdown',
        }).catch(() => {});
      } catch (_e) {}
    }

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return;
      for (const msg of messages) {
        if (!msg.message) continue;

        // ── React notification → Telegram ────────────────────────
        const reaction = msg.message?.reactionMessage;
        if (reaction && reaction.text && !msg.key?.fromMe) {
          const reactedMsgId = reaction.key?.id;
          const reactedMsg   = reactedMsgId ? messageStore.get(reactedMsgId) : null;
          const msgText = reactedMsg?.conversation ||
                          reactedMsg?.extendedTextMessage?.text ||
                          reactedMsg?.imageMessage?.caption || '';
          await notifyReactionTelegram(msg.key.remoteJid, reaction.text, msgText);
        }

        if (msg.key?.id) {
          messageStore.set(msg.key.id, msg.message);
          if (messageStore.size > 1000) {
            const firstKey = messageStore.keys().next().value;
            messageStore.delete(firstKey);
          }
        }
        if (msg.key.remoteJid === 'status@broadcast') {
          await handleStatus(sock, msg);
          continue;
        }
        await autoBehaviors(sock, msg);
        await handleMessage(sock, msg);
      }
    });



    sock.ev.on('group-participants.update', async (update) => {
      await handleGroupJoin(sock, update);
      await handleGroupLeave(sock, update);
    });

    sock.ev.on('groups.update', async (updates) => {
      for (const u of updates) {
        try {
          const g = await db.getGroup(u.id);
          if (u.subject) g.name = u.subject;
          await g.save();
        } catch (e) {}
      }
    });

    sock.ev.on('messages.update', async (updates) => {
      for (const { key, update } of updates) {
        if (update.message !== null) continue;
        try {
          const jid = key.remoteJid;
          if (!jid?.endsWith('@g.us')) continue;
          const group = await db.getGroup(jid);
          if (!group?.settings?.antiDelete) continue;
          const storedMsg = messageStore.get(key.id);
          if (!storedMsg) continue;
          const body =
            storedMsg?.conversation ||
            storedMsg?.extendedTextMessage?.text ||
            storedMsg?.imageMessage?.caption || '[media]';
          const sender = key.participant || key.remoteJid;
          await sock.sendMessage(jid, {
            text:
              `🗑️ *Deleted Message*\n\n` +
              `👤 @${sender.split('@')[0]}\n` +
              `💬 ${body}\n\n${cfg.footer}`,
            mentions: [sender],
          });
        } catch (e) {}
      }
    });

    sock.ev.on('call', async (calls) => {
      await handleCall(sock, calls);
    });

    return sock;
  } catch (e) {
    console.error(chalk.red('[FATAL]'), e.message);
    console.log(chalk.yellow('Reconnecting in 15s...'));
    setTimeout(() => connectToWhatsApp(), 15000);
  }
}

async function main() {
  showBanner();
  loadPlugins();
  // Set sessionManager globally BEFORE connecting so .pair command can use it
  const sm = require('./src/sessionManager');
  global.astraSessionManager = sm;
  await connectToWhatsApp();
  startDashboard(sm);

  // FIX (2026-07): this was never called before, so every paired sub-session
  // (users who used .pair / control panel to connect their own number) sat
  // dead after any PM2/server restart until someone opened the control panel
  // and started each one manually. Restore them automatically, 5s after boot
  // so the DB connection and dashboard have time to settle.
  setTimeout(async () => {
    try {
      const count = await sm.restoreActiveSessions((userId, update) => {
        console.log(chalk.cyan(`[SUB-SESSION] ${userId} → ${update.status}`));
      });
      console.log(chalk.green(`[✅] ${count} paired sub-session(s) restored`));
    } catch (e) {
      console.error(chalk.red('[SESSION] restoreActiveSessions failed:'), e.message);
    }
  }, 5000);

  // ── Telegram bots ─────────────────────────────────────────
  // NOTE: Pair Bot moved to selector/telegram/pairBot.js (single unified
  // bot, routed via dashboard API). Starting it here too caused a
  // Telegram 409 Conflict (same TG_PAIR_BOT_TOKEN polled twice).
  // startPairBot().catch(e => console.error("[TG-PAIR] Start failed:", e.message));
  // FIX (2026-07): startMgmtBot() returns plain `undefined` (not a Promise)
  // whenever TG_MGMT_BOT_TOKEN isn't set in config.env — it just logs a
  // warning and does a bare `return`. Calling .catch() directly on that
  // undefined result crashed the whole process with an unhandled
  // rejection (visible in the logs as "Cannot read properties of
  // undefined (reading 'catch')"), which in turn fed right back into the
  // pairing-code reconnect loop. Promise.resolve(...) makes this safe
  // regardless of whether start() returns a Promise or nothing at all.
  Promise.resolve(startMgmtBot()).catch(e => console.error("[TG-MGMT] Start failed:", e.message));
}

main();

process.on('uncaughtException', e => {
  console.error(chalk.red('[UNCAUGHT]'), e.message);
  // Don't exit — let reconnect logic handle recovery
});
process.on('unhandledRejection', e => {
  console.error(chalk.red('[UNHANDLED]'), e?.message || e);
  // Don't exit — log and continue
});