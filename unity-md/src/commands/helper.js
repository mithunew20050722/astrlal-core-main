'use strict';
const cfg = require('../../config');
const fs = require('fs-extra');
const db = require('./index');
const { UNICODE_FONTS, toUnicodeFont } = require('./unicodeFonts');

// ── Device preference (iPhone/Android) — saved in MongoDB ────────
// FIX (2026-07, final): asked ONCE per user, then saved permanently in
// the User doc (db.getUser().device) — survives restarts. A user can
// change it anytime with .device iphone / .device android (see device.js);
// every button-message footer reminds them that command exists.
const _deviceCache = new Map(); // jid -> { device, ts } — just a short
const DEVICE_CACHE_TTL = 5 * 60_000; // cache to avoid a DB hit on every send
const _pendingQueue = new Map(); // jid -> { sock, jid, opts }

async function getDevicePreference(jid) {
  const key = (jid || '').replace(/:\d+@/, '@');
  const cached = _deviceCache.get(key);
  if (cached && (Date.now() - cached.ts) < DEVICE_CACHE_TTL) return cached.device;
  let device = null;
  try {
    const user = await db.getUser(key);
    device = user?.device || null;
  } catch { device = null; }
  _deviceCache.set(key, { device, ts: Date.now() });
  return device;
}

async function setDevicePreference(jid, device) {
  const key = (jid || '').replace(/:\d+@/, '@');
  try {
    const user = await db.getUser(key);
    if (user?.save) { user.device = device; await user.save(); }
    else await db.User.updateOne({ jid: key }, { $set: { device } }, { upsert: true });
  } catch (_e) {}
  _deviceCache.set(key, { device, ts: Date.now() });
}

function queuePendingButtonMessage(sock, jid, opts) {
  const key = (jid || '').replace(/:\d+@/, '@');
  _pendingQueue.set(key, { sock, jid, opts });
}

async function flushQueuedButtonMessage(jid) {
  const key = (jid || '').replace(/:\d+@/, '@');
  const queued = _pendingQueue.get(key);
  if (!queued) return;
  _pendingQueue.delete(key);
  await sendButtons(queued.sock, queued.jid, queued.opts);
}

function askDeviceOnce(sock, jid) {
  const key = (jid || '').replace(/:\d+@/, '@');
  if (!global.pendingDeviceQuestion) global.pendingDeviceQuestion = new Map();
  if (global.pendingDeviceQuestion.get(key)) return; // already asked, waiting on reply
  global.pendingDeviceQuestion.set(key, true);
  sock.sendMessage(jid, {
    text:
      `📱 *Quick one-time question!*\n\n` +
      `WHATS YOUR PHONE MODEL ?\n\n` +
      `*1.* 📱 iPhone\n` +
      `*2.* 🤖 Android\n\n` +
      `↩️ reply *1* or *2*`,
  }).catch(() => {});
}

// ── Fake WhatsApp Status Reply Context ──────────────────────────
function fakeStatusCtx() {
  return {
    remoteJid: 'status@broadcast',
    participant: '0@s.whatsapp.net',
    fromMe: false,
    stanzaId: '3EB0' + [...Array(16)].map(() =>
      Math.floor(Math.random()*16).toString(16).toUpperCase()).join(''),
    quotedMessage: { conversation: 'Wait loading menu...' },
  };
}
// fakeStatusCtx used internally by sendButtons

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

function formatDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function getUptime() {
  return formatDuration(process.uptime());
}

function random(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function cleanJid(jid) {
  return jid?.replace('@s.whatsapp.net', '')
    .replace('@g.us', '')
    .replace(/[^0-9]/g, '') || '';
}

function jidToNum(jid) {
  return jid?.split('@')[0]?.split(':')[0] || '';
}

function isUrl(text) {
  return /https?:\/\/(www\.)?[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_+.~#?&//=]*)/.test(text);
}

function isPhoneNumber(text) {
  return /^[0-9]{7,15}$/.test(text.replace(/[\s+\-()]/g, ''));
}

function truncate(text, max = 100) {
  if (!text) return '';
  return text.length > max ? text.slice(0, max) + '...' : text;
}

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

const FANCY_STYLES = {
  bold: str => str.split('').map(c => {
    const code = c.codePointAt(0);
    if (code >= 65 && code <= 90) return String.fromCodePoint(code + 120211);
    if (code >= 97 && code <= 122) return String.fromCodePoint(code + 120205);
    if (code >= 48 && code <= 57) return String.fromCodePoint(code + 120734);
    return c;
  }).join(''),

  italic: str => str.split('').map(c => {
    const code = c.codePointAt(0);
    if (code >= 65 && code <= 90) return String.fromCodePoint(code + 120263);
    if (code >= 97 && code <= 122) return String.fromCodePoint(code + 120257);
    return c;
  }).join(''),

  mono: str => str.split('').map(c => {
    const code = c.codePointAt(0);
    if (code >= 65 && code <= 90) return String.fromCodePoint(code + 120367);
    if (code >= 97 && code <= 122) return String.fromCodePoint(code + 120361);
    if (code >= 48 && code <= 57) return String.fromCodePoint(code + 120774);
    return c;
  }).join(''),

  circle: str => str.split('').map(c => {
    const code = c.codePointAt(0);
    if (code >= 65 && code <= 90) return String.fromCodePoint(code + 9333);
    if (code >= 97 && code <= 122) return String.fromCodePoint(code + 9327);
    if (code >= 49 && code <= 57) return String.fromCodePoint(code + 9263);
    if (code === 48) return '⓪';
    return c;
  }).join(''),

  square: str => str.split('').map(c => {
    const code = c.codePointAt(0);
    if (code >= 65 && code <= 90) return String.fromCodePoint(code + 127215);
    if (code >= 97 && code <= 122) return String.fromCodePoint(code + 127247);
    return c;
  }).join(''),

  flip: str => {
    const map = {
      a:'ɐ', b:'q', c:'ɔ', d:'p', e:'ǝ', f:'ɟ', g:'ƃ', h:'ɥ',
      i:'ᴉ', j:'ɾ', k:'ʞ', l:'l', m:'ɯ', n:'u', o:'o', p:'d',
      q:'b', r:'ɹ', s:'s', t:'ʇ', u:'n', v:'ʌ', w:'ʍ', x:'x',
      y:'ʎ', z:'z',
    };
    return str.toLowerCase().split('').map(c => map[c] || c).reverse().join('');
  },

  morse: str => {
    const map = {
      a:'.-',  b:'-...', c:'-.-.', d:'-..', e:'.',
      f:'..-.', g:'--.', h:'....', i:'..', j:'.---',
      k:'-.-',  l:'.-..', m:'--', n:'-.', o:'---',
      p:'.--.', q:'--.-', r:'.-.', s:'...', t:'-',
      u:'..-',  v:'...-', w:'.--', x:'-..-', y:'-.--',
      z:'--..',
    };
    return str.toLowerCase().split('').map(c => map[c] || (c === ' ' ? '/' : c)).join(' ');
  },

  binary: str => str.split('').map(c => c.charCodeAt(0).toString(2).padStart(8, '0')).join(' '),

  mirror: str => str.split('').reverse().join(''),

  zalgo: str => {
    const up = ['̍','̎','̄','̅','̿','̑','̆','̐','͒','͗','͑','̇','̈','̊','͂','̓','̈','͊','͋','͌','̃','̂','̌','͐','̀','́','̋','̏','̒','̓','̔','̽','̉','ͣ','ͤ','ͥ','ͦ','ͧ','ͨ','ͩ','ͪ','ͫ','ͬ','ͭ','ͮ','ͯ','̾','͛','͆','̚'];
    const down = ['̖','̗','̘','̙','̜','̝','̞','̟','̠','̤','̥','̦','̩','̪','̫','̬','̭','̮','̯','̰','̱','̲','̳','̹','̺','̻','̼','ͅ','͇','͈','͉','͍','͎','͓','͔','͕','͖','͙','͚','̣'];
    return str.split('').map(c => {
      if (c === ' ') return c;
      let r = c;
      for (let i = 0; i < randomInt(1, 4); i++) r += random(up);
      for (let i = 0; i < randomInt(1, 3); i++) r += random(down);
      return r;
    }).join('');
  },

  glitch: str => {
    const glitchChars = ['̴','̵','̶','̷','̸','̡','̢','͜','͝','͞','͟','͠'];
    return str.split('').map(c => c + (Math.random() > 0.5 ? random(glitchChars) : '')).join('');
  },
};

function fancyText(style, text) {
  return FANCY_STYLES[style]?.(text) || text;
}

function sinhalaBold(text) {
  return `*${text}*`;
}

function toSmallCaps(text) {
  const map = {
    a:'ᴀ', b:'ʙ', c:'ᴄ', d:'ᴅ', e:'ᴇ', f:'ꜰ', g:'ɢ', h:'ʜ',
    i:'ɪ', j:'ᴊ', k:'ᴋ', l:'ʟ', m:'ᴍ', n:'ɴ', o:'ᴏ', p:'ᴘ',
    q:'ǫ', r:'ʀ', s:'ꜱ', t:'ᴛ', u:'ᴜ', v:'ᴠ', w:'ᴡ', x:'x',
    y:'ʏ', z:'ᴢ',
  };
  return text.toLowerCase().split('').map(c => map[c] || c).join('');
}

function menuBox(title, items) {
  const line = '═'.repeat(30);
  const top = `╔${line}╗`;
  const mid = `╠${line}╣`;
  const bot = `╚${line}╝`;
  const center = (str, width = 30) => {
    const pad = Math.max(0, width - str.length);
    const left = Math.floor(pad / 2);
    const right = pad - left;
    return `║${' '.repeat(left)}${str}${' '.repeat(right)}║`;
  };
  let out = `${top}\n${center(title)}\n${mid}\n`;
  for (const item of items) out += `║ ${item.padEnd(28)} ║\n`;
  out += bot;
  return out;
}

function tmpFile(ext = 'tmp') {
  fs.ensureDirSync('./temp');
  return `./temp/aura_${Date.now()}_${randomInt(1000, 9999)}.${ext}`;
}

// ── Forward/newsletter context builder ───────────────────────
function _fwdCtx() {
  return {
    isForwarded: true,
    forwardingScore: 1,
    forwardedNewsletterMessageInfo: {
      newsletterJid:   cfg.ch1 || '120363419201971095@newsletter',
      newsletterName:  cfg.botName || 'SL AURA',
      serverMessageId: -1,
    },
  };
}

// ── Sub menu command set (auto-append ⬅️ Main Menu) ──────────
const SUB_MENU_CMDS = new Set([
  'menu_system','menu_group','menu_download','menu_media','menu_other',
  'menu_bot','menu_ai','menu_sticker','menu_fun','menu_tools','menu_anime',
  'menu_games','menu_protection','menu_privacy','menu_auto','menu_stats',
  'menu_info',
]);
const MAIN_MENU_CMDS = new Set(['menu','help','m','allmenu','listmenu']);

// ── Interactive Buttons → WhatsApp native interactiveMessage ─
// Uses nativeFlowMessage + single_select — works on Baileys v6.7+
async function sendButtons(sock, jid, opts) {
  const { text, footer = '', image = null, quoted = null } = opts;
  let buttons = opts.buttons || [];

  // Ask once, remember permanently in the DB (see getDevicePreference/
  // setDevicePreference above). If unknown, queue this request and ask —
  // nothing else is sent until they answer.
  const _device = await getDevicePreference(jid);
  if (_device === null) {
    queuePendingButtonMessage(sock, jid, opts);
    askDeviceOnce(sock, jid);
    return;
  }
  const _forcePlainText = _device === 'iphone';
  // Shown on every button-message so a wrong/changed answer is easy to fix.
  const _deviceHint = `\n\n_📱 Wrong phone? Type .device iphone or .device android_`;

  // ── Auto-append ⬅️ Main Menu for sub menus ──────────────────
  const _curCmd = global.currentCmd || '';
  const isMain  = MAIN_MENU_CMDS.has(_curCmd);
  const hasBack  = buttons.some(b => b.id === '.menu' || (b.label || '').includes('Main Menu'));
  if (!isMain && !hasBack) {
    buttons = [...buttons, { label: '🏠 Main Menu', id: '.menu' }];
  }

  // ── Store reply-number mapping (JID normalized, for text fallback) ──
  const _normJid = typeof jid === 'string' ? jid.replace(/:\d+@/, '@') : jid;
  if (!global.pendingButtonReplies) global.pendingButtonReplies = new Map();
  global.pendingButtonReplies.set(_normJid, buttons.map(b => b.id));

  const fwd = _fwdCtx();
  let msg;

  if (_forcePlainText) {
    const numberedLines = buttons.map((b, i) =>
      `  *${i + 1}.* ${b.label}${b.desc ? `\n      _${b.desc}_` : ''}`
    ).join('\n');
    const fullText = `${text}\n\n${numberedLines}\n\n_↩ reply with a number_${_deviceHint}` +
      (footer ? `\n\n${footer}` : '');
    const sendOpts = quoted ? { quoted } : {};
    try {
      const { getPoolImage } = require('./imageCache');
      const imgBuf = image || getPoolImage();
      if (imgBuf) {
        msg = await sock.sendMessage(jid, { image: Buffer.isBuffer(imgBuf) ? imgBuf : { url: imgBuf }, caption: fullText, contextInfo: fwd }, sendOpts);
      } else {
        msg = await sock.sendMessage(jid, { text: fullText, contextInfo: fwd }, sendOpts);
      }
    } catch (_e) {
      msg = await sock.sendMessage(jid, { text: fullText, contextInfo: fwd }, sendOpts);
    }

  } else {
  try {
    const { generateWAMessageFromContent, prepareWAMessageMedia, proto } = require('@whiskeysockets/baileys');

    let header = proto.Message.InteractiveMessage.Header.create({ hasMediaAttachment: false });
    try {
      const _imgSrc = image ? { url: image } : (() => {
        const { getPoolImage } = require('./imageCache');
        const buf = getPoolImage();
        return buf ? buf : null;
      })();
      if (_imgSrc) {
        const media = await prepareWAMessageMedia(
          { image: Buffer.isBuffer(_imgSrc) ? _imgSrc : { url: _imgSrc.url } },
          { upload: sock.waUploadToServer }
        );
        header = proto.Message.InteractiveMessage.Header.create({
          hasMediaAttachment: true,
          imageMessage: media.imageMessage,
        });
      }
    } catch (_imgE) { /* no image — text-only header */ }

    const nativeBtn = [{
      name: 'single_select',
      buttonParamsJson: JSON.stringify({
        title: '☰  SELECT',
        sections: [{
          title: '',
          rows: buttons.map(b => ({
            header:      '',
            title:       b.label,
            description: '',
            id:          String(b.id || b.label),
          })),
        }],
      }),
    }];

    const numberedLines = buttons.map((b, i) =>
      `  *${i + 1}.* ${b.label}${b.desc ? `\n      _${b.desc}_` : ''}`
    ).join('\n');
    const bodyText = `${text}\n\n${numberedLines}\n\n_↩ reply with a number or tap_ *☰ SELECT*${_deviceHint}`;
    let ctxInfo = { ...fwd };
    if (quoted) {
      ctxInfo = {
        ...ctxInfo,
        stanzaId:      quoted.key?.id,
        remoteJid:     quoted.key?.remoteJid,
        participant:   quoted.key?.participant || quoted.key?.remoteJid,
        fromMe:        quoted.key?.fromMe,
        quotedMessage: quoted.message,
      };
    }

    const waMsg = await generateWAMessageFromContent(jid, {
      viewOnceMessage: {
        message: {
          messageContextInfo: {
            deviceListMetadata: {},
            deviceListMetadataVersion: 2,
          },
          interactiveMessage: proto.Message.InteractiveMessage.create({
            body:   proto.Message.InteractiveMessage.Body.create({ text: bodyText }),
            footer: proto.Message.InteractiveMessage.Footer.create({ text: footer || cfg.footer }),
            header,
            nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.create({
              buttons: nativeBtn,
            }),
            contextInfo: ctxInfo,
          }),
        },
      },
    }, {});

    await sock.relayMessage(waMsg.key.remoteJid, waMsg.message, {
      messageId: waMsg.key.id,
      additionalNodes: [{
        tag: 'biz',
        attrs: {},
        content: [{
          tag: 'interactive',
          attrs: { type: 'native_flow', v: '1' },
          content: [{ tag: 'native_flow', attrs: { v: '9', name: 'mixed' } }],
        }],
      }],
    });
    msg = waMsg;

  } catch (_btnErr) {
    const numberedLines = buttons.map((b, i) =>
      `  *${i + 1}.* ${b.label}${b.desc ? `\n      _${b.desc}_` : ''}`
    ).join('\n');
    const fullText = `${text}\n\n${numberedLines}\n\n_↩ reply with a number_${_deviceHint}` +
      (footer ? `\n\n${footer}` : '');
    const sendOpts = quoted ? { quoted } : {};
    try {
      const { getPoolImage } = require('./imageCache');
      const imgBuf = getPoolImage();
      if (imgBuf) {
        msg = await sock.sendMessage(jid, { image: imgBuf, caption: fullText, contextInfo: fwd }, sendOpts);
      } else {
        msg = await sock.sendMessage(jid, { text: fullText, contextInfo: fwd }, sendOpts);
      }
    } catch (_e) {
      msg = await sock.sendMessage(jid, { text: fullText, contextInfo: fwd }, sendOpts);
    }
  }
  }

  // ── Track for auto-delete ────────────────────────────────────
  if (msg?.key && global.botMsgTracker && global.currentCmd) {
    const menuCmds = ['menu','help','m','allmenu','listmenu',
      'menu_system','menu_group','menu_download','menu_media','menu_other',
      'menu_bot','menu_ai','menu_sticker','menu_fun','menu_tools','menu_anime',
      'menu_games','menu_protection','menu_privacy','menu_auto','menu_stats',
      'settings','botmode','publicmode','groupmode','inboxmode','privatemode',
      'autorecording','autoonline','autoread','autotyping','autobio',
      'anticall','didyoumean'];
    if (!menuCmds.includes(global.currentCmd)) {
      const chatJid  = msg.key.remoteJid;
      const existing = global.botMsgTracker.get(chatJid) || [];
      existing.push(msg.key);
      global.botMsgTracker.set(chatJid, existing);
    }
  }

  return msg;
}


// ── _appendMenuButton: append 📋 Main Menu hint to reply text ─
// Embeds the hint inline — NO separate message sent.
async function _appendMenuButton(sock, jid, text, quotedMsg) {
  const hint = `\n\n_↩ .menu for main menu_`;
  return sock.sendMessage(
    jid,
    { text: text + hint, contextInfo: _fwdCtx() },
    { quoted: quotedMsg }
  );
}


// ── sendUrlButtons: plain text fallback (URL buttons not supported) ──────────
async function sendUrlButtons(sock, jid, { text, footer = '', buttons = [], quoted = null }) {
  const lines = buttons.map((b, i) => `  *${i + 1}.* ${b.label}\n     ${b.url}`).join('\n');
  const fullText = `${text}\n\n${lines}` + (footer ? `\n\n${footer}` : '');
  const sendOpts = quoted ? { quoted } : {};
  return sock.sendMessage(jid, { text: fullText }, sendOpts);
}


// ── sendWithThumb: plain text reply with channel forward effect ─
async function sendWithThumb(sock, jid, text, quoted) {
  return sock.sendMessage(jid,
    { text, contextInfo: _fwdCtx() },
    quoted ? { quoted } : {}
  );
}

// ═══════════════════════════════════════════════════════════════
// ── Text Styling System — two style presets ────────────────────
// ═══════════════════════════════════════════════════════════════

const TEXT_STYLES = {
  // Style 1: Elegant — clean borders, subtle dividers
  elegant: {
    border: '━',
    corner: '┃',
    top:    '┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓',
    bottom: '┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛',
    divider: '┠──────────────────────────────┨',
    bullet: '  ◈ ',
    arrow: '  → ',
    prefix: '  ',
    suffix: '',
    header: (icon, title) => `┃  ${icon} *${title}*`,
    footer: (text) => `┃  _${text}_`,
  },
  // Style 2: Bold — heavy borders, strong emphasis
  bold: {
    border: '═',
    corner: '║',
    top:    '╔══════════════════════════════╗',
    bottom: '╚══════════════════════════════╝',
    divider: '╠══════════════════════════════╣',
    bullet: '  ◆ ',
    arrow: '  ⇒ ',
    prefix: '  ',
    suffix: '',
    header: (icon, title) => `║  ${icon} *${title}*`,
    footer: (text) => `║  _${text}_`,
  },
};

// Apply a text style to a message
function applyTextStyle(text, styleName = 'elegant') {
  const style = TEXT_STYLES[styleName] || TEXT_STYLES.elegant;
  return text; // Return as-is — styling is applied at send time
}

// Get the current text style from bot config
async function getTextStyle(sessionId = 'config') {
  try {
    const db = require('./index');
    const botCfg = await db.getBotConfig(sessionId);
    return botCfg?.textStyle || 'elegant';
  } catch {
    return 'elegant';
  }
}

// Style a message before sending
function styleText(text, styleName = 'elegant') {
  const style = TEXT_STYLES[styleName] || TEXT_STYLES.elegant;
  return text; // For now, return as-is — inline styling applied per-message
}

// ═══════════════════════════════════════════════════════════════

module.exports = {
  formatBytes, formatDuration, getUptime,
  random, randomInt, sleep,
  cleanJid, jidToNum,
  isUrl, isPhoneNumber, truncate,
  getGreeting, fancyText, sinhalaBold,
  menuBox, tmpFile,
  sendButtons, sendUrlButtons,
  sendWithThumb, _appendMenuButton, _fwdCtx,
  MAIN_MENU_CMDS, SUB_MENU_CMDS,
  // ── Text styling ────────────────────────────────────────────
  styleText, applyTextStyle, TEXT_STYLES, UNICODE_FONTS, toUnicodeFont,
  FANCY_STYLES,
  flushQueuedButtonMessage, setDevicePreference,
  toSmallCaps,
};