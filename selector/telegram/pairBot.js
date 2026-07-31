'use strict';
/**
 * ASTRAL CORE — Unified Telegram Pair Bot
 * Token: TG_PAIR_BOT_TOKEN
 *
 * Flow:
 *   /start           -> always shows the bot-selection tab (UNITY-MD / SL AURA)
 *   [select a bot]   -> shows that bot's pair screen
 *   /pair <number>   -> pairs the number to the SELECTED bot (via its dashboard API)
 *   [pairing ends]   -> selection is cleared, so the NEXT command shows the
 *                        selection tab again (as requested)
 */

const TelegramBot = require('node-telegram-bot-api');

let bot = null;

// chatId -> { bot: 'unity' | 'aura' }
const chatState = new Map();
// number -> true while a pairing request is in flight (prevents double taps)
const _inProgress = new Set();

function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

const BOTS = {
  unity: { key: 'unity', label: 'UNITY-MD', emoji: '🧲', port: process.env.UNITY_PORT || 3001 },
  aura:  { key: 'aura',  label: 'SL AURA',  emoji: '🌟', port: process.env.AURA_PORT  || 3002 },
};

function apiBase(botKey) {
  return `http://127.0.0.1:${BOTS[botKey].port}`;
}

async function apiStartPair(botKey, number) {
  const res = await fetch(`${apiBase(botKey)}/api/pair`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ number }),
  });
  return res.json();
}

async function apiPairStatus(botKey, number) {
  const res = await fetch(`${apiBase(botKey)}/api/pair/status/${number}`);
  return res.json();
}

// ── Keyboards ─────────────────────────────────────────────────
const KB_SELECT = {
  inline_keyboard: [
    [
      { text: '🧲 UNITY-MD', callback_data: 'select_unity' },
      { text: '🌟 SL AURA',  callback_data: 'select_aura'  },
    ],
  ],
};
function kbBotHome() {
  return {
    inline_keyboard: [
      [{ text: '🔗 Pair My Number', callback_data: 'pair_start' }],
      [{ text: '📖 How It Works',   callback_data: 'pair_help'  }],
      [{ text: '🔄 Change Bot',     callback_data: 'change_bot' }],
    ],
  };
}
function kbBack() {
  return { inline_keyboard: [[{ text: '🔄 Change Bot', callback_data: 'change_bot' }]] };
}
function kbRetry(num) {
  return {
    inline_keyboard: [[
      { text: '🔄 Try Again', callback_data: 'retry_' + num },
      { text: '🔄 Change Bot', callback_data: 'change_bot' },
    ]],
  };
}

// ── Message templates ────────────────────────────────────────
function msgSelect(name) {
  return (
    '<b>╔══════════════════╗</b>\n' +
    '<b>║  🌐  ASTRAL CORE  ║</b>\n' +
    '<b>╚══════════════════╝</b>\n\n' +
    '👋 Hey <b>' + (name || 'there') + '</b>! Welcome to the\n' +
    '<b>ASTRAL CORE Pairing Bot</b>\n\n' +
    '━━━━━━━━━━━━━━━━━━━━━\n' +
    '📌 Select which bot you want\n' +
    '   to pair your WhatsApp with:\n' +
    '━━━━━━━━━━━━━━━━━━━━━\n\n' +
    '<i>Tap a button below 👇</i>'
  );
}
function msgBotHome(b, name) {
  return (
    '<b>╔══════════════════╗</b>\n' +
    '<b>║  ' + b.emoji + '  ' + b.label + ' BOT  ║</b>\n' +
    '<b>╚══════════════════╝</b>\n\n' +
    '👋 Hey <b>' + (name || 'there') + '</b>!\n' +
    '🔗 Connect your WhatsApp number to\n' +
    '   <b>' + b.label + '</b> in seconds.\n\n' +
    '📌 All you need is your\n' +
    '   WhatsApp number with country code.\n' +
    '━━━━━━━━━━━━━━━━━━━━━\n\n' +
    '<i>Tap a button below to get started 👇</i>'
  );
}
function msgHelp(b) {
  return (
    '<b>╔══════════════════╗</b>\n' +
    '<b>║   📖  HOW IT WORKS  ║</b>\n' +
    '<b>╚══════════════════╝</b>\n\n' +
    '<b>Bot:</b> ' + b.emoji + ' ' + b.label + '\n\n' +
    '<b>Step 1</b> — Send your number:\n' +
    '   <code>/pair 94771234567</code>\n' +
    '   <i>(include country code, no + or spaces)</i>\n\n' +
    '<b>Step 2</b> — You will receive a pairing code\n\n' +
    '<b>Step 3</b> — Open WhatsApp on your phone:\n' +
    '   ⚙️ Settings\n' +
    '   📱 Linked Devices\n' +
    '   ➕ Link a Device\n' +
    '   🔢 Enter the code\n\n' +
    '━━━━━━━━━━━━━━━━━━━━━\n' +
    '⚠️ <b>Note:</b> Code expires in <b>60 seconds</b>\n' +
    '━━━━━━━━━━━━━━━━━━━━━'
  );
}
function msgUsage(b) {
  return (
    '<b>╔══════════════════╗</b>\n' +
    '<b>║   🔗  PAIR YOUR BOT  ║</b>\n' +
    '<b>╚══════════════════╝</b>\n\n' +
    '<b>Bot:</b> ' + b.emoji + ' ' + b.label + '\n\n' +
    '📌 <b>Usage:</b>\n' +
    '   <code>/pair [number]</code>\n\n' +
    '📌 <b>Example:</b>\n' +
    '   <code>/pair 94771234567</code>\n' +
    '   <i>(country code + number, no spaces)</i>\n\n' +
    '━━━━━━━━━━━━━━━━━━━━━\n' +
    '💡 Need help? Tap <b>How It Works</b> below.'
  );
}
function msgGenerating(b, num) {
  return (
    '<b>╔══════════════════╗</b>\n' +
    '<b>║  ⏳  GENERATING CODE  ║</b>\n' +
    '<b>╚══════════════════╝</b>\n\n' +
    '<b>Bot:</b> ' + b.emoji + ' ' + b.label + '\n' +
    '📞 Number: <code>+' + num + '</code>\n\n' +
    '<b>🔄 Creating your pairing code...</b>\n' +
    '<i>This may take a few seconds.</i>\n\n' +
    '━━━━━━━━━━━━━━━━━━━━━\n' +
    '⏱ Please wait, do not close this chat.'
  );
}
function msgReady(b, num, code) {
  return (
    '<b>╔══════════════════╗</b>\n' +
    '<b>║  ✅  CODE IS READY!  ║</b>\n' +
    '<b>╚══════════════════╝</b>\n\n' +
    '<b>Bot:</b> ' + b.emoji + ' ' + b.label + '\n' +
    '📞 Number: <code>+' + num + '</code>\n' +
    '🔑 Your Code:\n\n' +
    '<code>' + code + '</code>\n\n' +
    '━━━━━━━━━━━━━━━━━━━━━\n' +
    '<b>📲 Enter this code in WhatsApp:</b>\n\n' +
    '   1️⃣ Open <b>WhatsApp</b>\n' +
    '   2️⃣ Tap <b>Settings</b> ⚙️\n' +
    '   3️⃣ <b>Linked Devices</b> → <b>Link a Device</b>\n' +
    '   4️⃣ Enter the code above 👆\n\n' +
    '━━━━━━━━━━━━━━━━━━━━━\n' +
    '⏱ <b>Expires in 60 seconds!</b>\n' +
    '<i>Tap the code above to copy it.</i>\n\n' +
    '✅ Done? Send /start to pair another bot.'
  );
}
function msgConnected(b, num) {
  return (
    '<b>╔══════════════════╗</b>\n' +
    '<b>║  🎉  ALREADY LINKED!  ║</b>\n' +
    '<b>╚══════════════════╝</b>\n\n' +
    '<b>Bot:</b> ' + b.emoji + ' ' + b.label + '\n' +
    '✅ <code>+' + num + '</code> is already connected!\n\n' +
    'Your WhatsApp is linked and ready.\n\n' +
    '━━━━━━━━━━━━━━━━━━━━━\n' +
    '💬 Go chat — ' + b.label + ' is active!\n' +
    '✅ Send /start to pair another bot.'
  );
}
function msgTimeout(b, num) {
  return (
    '<b>╔══════════════════╗</b>\n' +
    '<b>║  ⏰  CODE EXPIRED!   ║</b>\n' +
    '<b>╚══════════════════╝</b>\n\n' +
    '<b>Bot:</b> ' + b.emoji + ' ' + b.label + '\n' +
    '❌ The pairing code for <code>+' + num + '</code>\n' +
    '   expired before being entered.\n\n' +
    '━━━━━━━━━━━━━━━━━━━━━\n' +
    '💡 Tap <b>Try Again</b> below, or send /start\n' +
    '   to choose a bot again.'
  );
}
function msgError(b, err) {
  return (
    '<b>╔══════════════════╗</b>\n' +
    '<b>║   ❌  PAIRING FAILED  ║</b>\n' +
    '<b>╚══════════════════╝</b>\n\n' +
    '<b>Bot:</b> ' + b.emoji + ' ' + b.label + '\n' +
    'Something went wrong during pairing.\n\n' +
    '<b>Reason:</b> <code>' + err + '</code>\n\n' +
    '━━━━━━━━━━━━━━━━━━━━━\n' +
    '<b>Check the following:</b>\n' +
    '   ◉ Number includes country code\n' +
    '   ◉ Number has an active WhatsApp\n' +
    '   ◉ Number not already linked\n\n' +
    '💡 Tap <b>Try Again</b> below, or send /start\n' +
    '   to choose a bot again.'
  );
}
function msgInProgress(b, num) {
  return (
    '<b>⏳ Already Processing...</b>\n\n' +
    '<b>Bot:</b> ' + b.emoji + ' ' + b.label + '\n' +
    'A pairing request for <code>+' + num + '</code>\n' +
    'is currently in progress.\n\n' +
    'Please wait for it to complete.'
  );
}
function msgNoSelection() {
  return '⚠️ <b>No bot selected yet.</b>\nPlease choose a bot first 👇';
}

// ── Core pair flow ────────────────────────────────────────────
async function doPair(chatId, botKey, number, editMsgId = null) {
  const b = BOTS[botKey];
  const opts = { parse_mode: 'HTML' };

  if (_inProgress.has(botKey + ':' + number)) {
    return editMsgId
      ? bot.editMessageText(msgInProgress(b, number), { chat_id: chatId, message_id: editMsgId, ...opts }).catch(() => {})
      : bot.sendMessage(chatId, msgInProgress(b, number), opts);
  }

  _inProgress.add(botKey + ':' + number);

  let sentMsgId = editMsgId;
  if (editMsgId) {
    await bot.editMessageText(msgGenerating(b, number), { chat_id: chatId, message_id: editMsgId, parse_mode: 'HTML' }).catch(() => {});
  } else {
    const sentMsg = await bot.sendMessage(chatId, msgGenerating(b, number), { parse_mode: 'HTML' });
    sentMsgId = sentMsg.message_id;
  }

  try {
    const startRes = await apiStartPair(botKey, number);

    if (!startRes.ok) {
      await bot.editMessageText(msgError(b, startRes.error || 'Request failed'), {
        chat_id: chatId, message_id: sentMsgId, parse_mode: 'HTML', reply_markup: kbRetry(number),
      }).catch(() => {});
      return;
    }

    if (startRes.status === 'already_connected') {
      await bot.editMessageText(msgConnected(b, number), {
        chat_id: chatId, message_id: sentMsgId, parse_mode: 'HTML', reply_markup: kbBack(),
      }).catch(() => {});
      return;
    }

    if (startRes.status === 'pairing' && startRes.pairCode) {
      await bot.editMessageText(msgReady(b, number, startRes.pairCode), {
        chat_id: chatId, message_id: sentMsgId, parse_mode: 'HTML',
      }).catch(() => {});

      // Watch in the background for the moment the number actually links,
      // so we can clear the selection (next command -> selection tab again).
      (async () => {
        let waited = 0;
        while (waited < 65000) {
          await wait(2000);
          waited += 2000;
          try {
            const st = await apiPairStatus(botKey, number);
            if (st.status === 'connected' || st.status === 'error') break;
          } catch (_e) { break; }
        }
      })();
      return;
    }

    await bot.editMessageText(msgTimeout(b, number), {
      chat_id: chatId, message_id: sentMsgId, parse_mode: 'HTML', reply_markup: kbRetry(number),
    }).catch(() => {});

  } catch (e) {
    await bot.editMessageText(
      msgError(b, /fetch failed|ECONNREFUSED/.test(e.message) ? (b.label + ' bot is offline') : e.message),
      { chat_id: chatId, message_id: sentMsgId, parse_mode: 'HTML', reply_markup: kbRetry(number) }
    ).catch(() => {});
  } finally {
    _inProgress.delete(botKey + ':' + number);
    // Requirement: once a pairing attempt finishes, clear the selection so
    // the next command shows the selection tab again.
    chatState.delete(chatId);
  }
}

// ── Purge any stale/backlogged updates (old button taps queued up during
// the earlier 409-conflict period) so they don't replay on every restart ──
async function purgeOldUpdates(TOKEN) {
  try {
    const peek = await fetch(`https://api.telegram.org/bot${TOKEN}/getUpdates?offset=-1&limit=1`);
    const peekData = await peek.json();
    if (peekData.ok && peekData.result.length) {
      const lastId = peekData.result[0].update_id;
      // Re-request with offset = lastId+1 -> tells Telegram "discard everything up to here"
      await fetch(`https://api.telegram.org/bot${TOKEN}/getUpdates?offset=${lastId + 1}&limit=1`);
      console.log('[TG-PAIR] Purged stale update backlog');
    }
  } catch (e) {
    console.error('[TG-PAIR] Purge failed:', e.message);
  }
}

// ── Start bot ─────────────────────────────────────────────────
async function start() {
  const TOKEN = process.env.TG_PAIR_BOT_TOKEN;
  if (!TOKEN) {
    console.warn('[TG-PAIR] TG_PAIR_BOT_TOKEN not set — pair bot disabled');
    return;
  }

  await purgeOldUpdates(TOKEN);

  bot = new TelegramBot(TOKEN, { polling: true });
  bot.on('polling_error', err => console.error('[TG-PAIR] Polling error:', err.message));

  function showSelect(chatId, name, msgId = null) {
    chatState.delete(chatId);
    const opts = { parse_mode: 'HTML', reply_markup: KB_SELECT };
    return msgId
      ? bot.editMessageText(msgSelect(name), { chat_id: chatId, message_id: msgId, ...opts }).catch(() => {})
      : bot.sendMessage(chatId, msgSelect(name), opts);
  }

  // /start — always resets to the selection tab
  bot.onText(/^\/start(@\S+)?$/, (msg) => {
    const name = msg.from && msg.from.first_name ? msg.from.first_name : 'there';
    showSelect(msg.chat.id, name);
  });

  // /help
  bot.onText(/^\/help(@\S+)?$/, (msg) => {
    const sel = chatState.get(msg.chat.id);
    const b = sel ? BOTS[sel.bot] : null;
    if (!b) return showSelect(msg.chat.id, msg.from?.first_name);
    bot.sendMessage(msg.chat.id, msgHelp(b), { parse_mode: 'HTML', reply_markup: kbBack() });
  });

  // /pair <number>
  bot.onText(/^\/pair(?:@\S+)?\s+(.+)$/, async (msg, match) => {
    const chatId = msg.chat.id;
    const sel = chatState.get(chatId);
    if (!sel) {
      await bot.sendMessage(chatId, msgNoSelection(), { parse_mode: 'HTML', reply_markup: KB_SELECT });
      return;
    }
    const b = BOTS[sel.bot];
    const number = (match[1] || '').replace(/[^0-9]/g, '');
    if (number.length < 7) {
      return bot.sendMessage(chatId, msgUsage(b), { parse_mode: 'HTML', reply_markup: kbBack() });
    }
    await doPair(chatId, sel.bot, number);
  });

  // /pair no args
  bot.onText(/^\/pair(@\S+)?$/, (msg) => {
    const chatId = msg.chat.id;
    const sel = chatState.get(chatId);
    if (!sel) return showSelect(chatId, msg.from?.first_name);
    bot.sendMessage(chatId, msgUsage(BOTS[sel.bot]), { parse_mode: 'HTML', reply_markup: kbBack() });
  });

  // Any other plain text / unknown command -> if nothing is selected, show selection tab
  bot.on('message', (msg) => {
    const text = msg.text || '';
    if (text.startsWith('/start') || text.startsWith('/help') || text.startsWith('/pair')) return;
    const chatId = msg.chat.id;
    if (!chatState.get(chatId)) showSelect(chatId, msg.from?.first_name);
  });

  // Inline callbacks
  bot.on('callback_query', async (cb) => {
    const chatId = cb.message?.chat?.id;
    const msgId  = cb.message?.message_id;
    const data   = cb.data || '';
    const name   = cb.from?.first_name;
    await bot.answerCallbackQuery(cb.id).catch(() => {});

    if (data === 'select_unity' || data === 'select_aura') {
      const key = data === 'select_unity' ? 'unity' : 'aura';
      chatState.set(chatId, { bot: key });
      const b = BOTS[key];
      await bot.editMessageText(msgBotHome(b, name), {
        chat_id: chatId, message_id: msgId, parse_mode: 'HTML', reply_markup: kbBotHome(),
      }).catch(() => {});
      return;
    }

    if (data === 'change_bot') {
      showSelect(chatId, name, msgId);
      return;
    }

    const sel = chatState.get(chatId);
    const b = sel ? BOTS[sel.bot] : null;

    if (data === 'pair_help') {
      if (!b) return showSelect(chatId, name, msgId);
      await bot.editMessageText(msgHelp(b), { chat_id: chatId, message_id: msgId, parse_mode: 'HTML', reply_markup: kbBack() }).catch(() => {});
      return;
    }
    if (data === 'pair_start') {
      if (!b) return showSelect(chatId, name, msgId);
      await bot.editMessageText(msgUsage(b), { chat_id: chatId, message_id: msgId, parse_mode: 'HTML', reply_markup: kbBack() }).catch(() => {});
      return;
    }
    if (data.startsWith('retry_')) {
      if (!b) return showSelect(chatId, name, msgId);
      const number = data.replace('retry_', '');
      await doPair(chatId, sel.bot, number, msgId);
      return;
    }
  });

  console.log('[TG-PAIR] Unified pair bot started ✅');
}

module.exports = { start };
