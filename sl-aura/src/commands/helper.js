'use strict';
const cfg = require('../../config');
const fs = require('fs-extra');
const db = require('./index');

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

// Unicode font style maps
const UNICODE_FONTS = {
  // Normal (no change)
  normal: null,
  // Bold sans-serif: 𝗔𝗕𝗖...
  bold: {
    A: '𝗔', B: '𝗕', C: '𝗖', D: '𝗗', E: '𝗘', F: '𝗙', G: '𝗚', H: '𝗛', I: '𝗜',
    J: '𝗝', K: '𝗞', L: '𝗟', M: '𝗠', N: '𝗡', O: '𝗢', P: '𝗣', Q: '𝗤', R: '𝗥',
    S: '𝗦', T: '𝗧', U: '𝗨', V: '𝗩', W: '𝗪', X: '𝗫', Y: '𝗬', Z: '𝗭',
    a: '𝗮', b: '𝗯', c: '𝗰', d: '𝗱', e: '𝗲', f: '𝗳', g: '𝗴', h: '𝗵', i: '𝗶',
    j: '𝗷', k: '𝗸', l: '𝗹', m: '𝗺', n: '𝗻', o: '𝗼', p: '𝗽', q: '𝗾', r: '𝗿',
    s: '𝘀', t: '𝘁', u: '𝘂', v: '𝘃', w: '𝘄', x: '𝘅', y: '𝘆', z: '𝘇',
    '0': '𝟬', '1': '𝟭', '2': '𝟮', '3': '𝟯', '4': '𝟰', '5': '𝟱', '6': '𝟲', '7': '𝟳', '8': '𝟴', '9': '𝟵',
  },
  // Italic sans-serif: 𝘈𝘉𝘊...
  italic: {
    A: '𝘈', B: '𝘉', C: '𝘊', D: '𝘋', E: '𝘌', F: '𝘍', G: '𝘎', H: '𝘏', I: '𝘐',
    J: '𝘑', K: '𝘒', L: '𝘓', M: '𝘔', N: '𝘕', O: '𝘖', P: '𝘗', Q: '𝘘', R: '𝘙',
    S: '𝘚', T: '𝘛', U: '𝘜', V: '𝘝', W: '𝘞', X: '𝘟', Y: '𝘠', Z: '𝘡',
    a: '𝘢', b: '𝘣', c: '𝘤', d: '𝘥', e: '𝘦', f: '𝘧', g: '𝘨', h: '𝘩', i: '𝘪',
    j: '𝘫', k: '𝘬', l: '𝘭', m: '𝘮', n: '𝘯', o: '𝘰', p: '𝘱', q: '𝘲', r: '𝘳',
    s: '𝘴', t: '𝘵', u: '𝘶', v: '𝘷', w: '𝘸', x: '𝘹', y: '𝘺', z: '𝘻',
  },
  // Bold italic sans-serif: 𝘼𝘽𝘾...
  bolditalic: {
    A: '𝘼', B: '𝘽', C: '𝘾', D: '𝘿', E: '𝙀', F: '𝙁', G: '𝙂', H: '𝙃', I: '𝙄',
    J: '𝙅', K: '𝙆', L: '𝙇', M: '𝙈', N: '𝙉', O: '𝙊', P: '𝙋', Q: '𝙌', R: '𝙍',
    S: '𝙎', T: '𝙏', U: '𝙐', V: '𝙑', W: '𝙒', X: '𝙓', Y: '𝙔', Z: '𝙕',
    a: '𝙖', b: '𝙗', c: '𝙘', d: '𝙙', e: '𝙚', f: '𝙛', g: '𝙜', h: '𝙝', i: '𝙞',
    j: '𝙟', k: '𝙠', l: '𝙡', m: '𝙢', n: '𝙣', o: '𝙤', p: '𝙥', q: '𝙦', r: '𝙧',
    s: '𝙨', t: '𝙩', u: '𝙪', v: '𝙫', w: '𝙬', x: '𝙭', y: '𝙮', z: '𝙯',
  },
  // Monospace: 𝙰𝙱𝙲...
  mono: {
    A: '𝙰', B: '𝙱', C: '𝙲', D: '𝙳', E: '𝙴', F: '𝙵', G: '𝙶', H: '𝙷', I: '𝙸',
    J: '𝙹', K: '𝙺', L: '𝙻', M: '𝙼', N: '𝙽', O: '𝙾', P: '𝙿', Q: '𝚀', R: '𝚁',
    S: '𝚂', T: '𝚃', U: '𝚄', V: '𝚅', W: '𝚆', X: '𝚇', Y: '𝚈', Z: '𝚉',
    a: '𝚊', b: '𝚋', c: '𝚌', d: '𝚍', e: '𝚎', f: '𝚏', g: '𝚐', h: '𝚑', i: '𝚒',
    j: '𝚓', k: '𝚔', l: '𝚕', m: '𝚖', n: '𝚗', o: '𝚘', p: '𝚙', q: '𝚚', r: '𝚛',
    s: '𝚜', t: '𝚝', u: '𝚞', v: '𝚟', w: '𝚠', x: '𝚡', y: '𝚢', z: '𝚣',
    '0': '𝟶', '1': '𝟷', '2': '𝟸', '3': '𝟹', '4': '𝟺', '5': '𝟻', '6': '𝟼', '7': '𝟽', '8': '𝟾', '9': '𝟿',
  },
  // Double-struck: 𝔸𝔹ℂ...
  double: {
    A: '𝔸', B: '𝔹', C: 'ℂ', D: '𝔻', E: '𝔼', F: '𝔽', G: '𝔾', H: 'ℍ', I: '𝕀',
    J: '𝕁', K: '𝕂', L: '𝕃', M: '𝕄', N: 'ℕ', O: '𝕆', P: 'ℙ', Q: 'ℚ', R: 'ℝ',
    S: '𝕊', T: '𝕋', U: '𝕌', V: '𝕍', W: '𝕎', X: '𝕏', Y: '𝕐', Z: 'ℤ',
    a: '𝕒', b: '𝕓', c: '𝕔', d: '𝕕', e: '𝕖', f: '𝕗', g: '𝕘', h: '𝕙', i: '𝕚',
    j: '𝕛', k: '𝕜', l: '𝕝', m: '𝕞', n: '𝕟', o: '𝕠', p: '𝕡', q: '𝕢', r: '𝕣',
    s: '𝕤', t: '𝕥', u: '𝕦', v: '𝕧', w: '𝕨', x: '𝕩', y: '𝕪', z: '𝕫',
    '0': '𝟘', '1': '𝟙', '2': '𝟚', '3': '𝟛', '4': '𝟜', '5': '𝟝', '6': '𝟞', '7': '𝟟', '8': '𝟠', '9': '𝟡',
  },
  // Small caps: ᴀʙᴄ...
  smallcaps: {
    a: 'ᴀ', b: 'ʙ', c: 'ᴄ', d: 'ᴅ', e: 'ᴇ', f: 'ꜰ', g: 'ɢ', h: 'ʜ', i: 'ɪ',
    j: 'ᴊ', k: 'ᴋ', l: 'ʟ', m: 'ᴍ', n: 'ɴ', o: 'ᴏ', p: 'ᴘ', q: 'ǫ', r: 'ʀ',
    s: 'ꜱ', t: 'ᴛ', u: 'ᴜ', v: 'ᴠ', w: 'ᴡ', x: 'x', y: 'ʏ', z: 'ᴢ',
  },
  // Circled: ⒶⒷⒸ...
  circled: {
    A: 'Ⓐ', B: 'Ⓑ', C: 'Ⓒ', D: 'Ⓓ', E: 'Ⓔ', F: 'Ⓕ', G: 'Ⓖ', H: 'Ⓗ', I: 'Ⓘ',
    J: 'Ⓙ', K: 'Ⓚ', L: 'Ⓛ', M: 'Ⓜ', N: 'Ⓝ', O: 'Ⓞ', P: 'Ⓟ', Q: 'Ⓠ', R: 'Ⓡ',
    S: 'Ⓢ', T: 'Ⓣ', U: 'Ⓤ', V: 'Ⓥ', W: 'Ⓦ', X: 'Ⓧ', Y: 'Ⓨ', Z: 'Ⓩ',
    a: 'ⓐ', b: 'ⓑ', c: 'ⓒ', d: 'ⓓ', e: 'ⓔ', f: 'ⓕ', g: 'ⓖ', h: 'ⓗ', i: 'ⓘ',
    j: 'ⓙ', k: 'ⓚ', l: 'ⓛ', m: 'ⓜ', n: 'ⓝ', o: 'ⓞ', p: 'ⓟ', q: 'ⓠ', r: 'ⓡ',
    s: 'ⓢ', t: 'ⓣ', u: 'ⓤ', v: 'ⓥ', w: 'ⓦ', x: 'ⓧ', y: 'ⓨ', z: 'ⓩ',
    '0': '⓪', '1': '①', '2': '②', '3': '③', '4': '④', '5': '⑤', '6': '⑥', '7': '⑦', '8': '⑧', '9': '⑨',
  },
};

// Convert text to a Unicode font style
function toUnicodeFont(text, fontName) {
  if (!fontName || !UNICODE_FONTS[fontName]) return text;
  const map = UNICODE_FONTS[fontName];
  if (!map) return text;
  return text.split('').map(char => map[char] || char).join('');
}

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