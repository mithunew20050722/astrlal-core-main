'use strict';
const { getT } = require('../lang');
const cron   = require('node-cron');
const cfg    = require('../../config');
const logger = require('./logger');
const axios  = require('axios');
// Same password chboost.js asks for — reused, not duplicated, so the two
// never drift apart.
const { CHBOOST_PASSWORD } = require('./chboost');
const { safeFollowChannel } = require('./newsletterUtils');

// ── .chreact — emoji choices offered to the requester ──────────
const CHREACT_EMOJIS = ['💖', '✅', '🤕', '😁'];
const pendingChreact  = new Map(); // sender jid → { step, channelJid, chatJid, emoji }

// ── Notify Telegram instead of WhatsApp ───────────────────────
const TG_NOTIFY_ID = '7752365037';
async function tgNotify(text) {
  try {
    const token = process.env.TG_MGMT_BOT_TOKEN;
    if (!token) return;
    await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
      chat_id: TG_NOTIFY_ID,
      text,
      parse_mode: 'HTML',
    });
  } catch (_e) {}
}

let _sock = null;

// ── Init ──────────────────────────────────────────────────────
function initBoost(sock) {
  _sock = sock;
  startReFollowCron();
  logger.info('[BOOST] Social boost system initialized');
}

// ── Extract JID from WA channel link ─────────────────────────
function extractChannelJID(link) {
  // https://whatsapp.com/channel/xxxxx → JID
  // Already a JID (contains @newsletter) → return as is
  if (link?.includes('@newsletter')) return link;
  const match = link?.match(/whatsapp\.com\/channel\/([a-zA-Z0-9_-]+)/i);
  if (match) return `${match[1]}@newsletter`;
  return null;
}

// ── Follow channel ────────────────────────────────────────────
// BUG FIX (2026-08): used to call _sock.followNewsletter(jid) directly
// with the raw invite-code JID — see newsletterUtils.js for why that
// reliably reacts but never actually follows.
async function followChannel(jid) {
  if (!_sock || !jid) return false;
  try {
    await safeFollowChannel(_sock, jid);
    return true;
  } catch (e) {
    return false;
  }
}

// ── Unfollow detect + re-follow ───────────────────────────────
async function ensureFollowed() {
  if (!_sock) return;
  const channels = [cfg.channel1, cfg.channel2].filter(Boolean);
  for (const ch of channels) {
    try {
      await safeFollowChannel(_sock, ch);
    } catch (e) {}
    await new Promise(r => setTimeout(r, 1000));
  }
}

// ── React to latest channel post ──────────────────────────────
async function reactChannel(jid, emoji = '❤️') {
  if (!_sock || !jid) return false;
  try {
    // Correct Baileys 6.7.x signature: newsletterFetchMessages('direct', jid, count)
    const msgs = await _sock.newsletterFetchMessages('direct', jid, 5);
    if (!msgs?.length) return false;
    const latest = msgs[0];
    // Correct newsletter react method
    await _sock.newsletterReactMessage(jid, latest.key.id, emoji);
    return true;
  } catch (e) {
    return false;
  }
}

// ── View channel posts ─────────────────────────────────────────
async function viewChannel(jid) {
  if (!_sock || !jid) return false;
  try {
    // Correct Baileys 6.7.x signature
    const msgs = await _sock.newsletterFetchMessages('direct', jid, 5);
    if (!msgs?.length) return false;
    const keys = msgs.map(m => m.key);
    await _sock.readMessages(keys);
    return true;
  } catch (e) {
    return false;
  }
}

// ── React to latest channel post, on ANY given sock ─────────────
// Generalized version of reactChannel() above — that one is hardwired to
// the single module-level _sock (whichever session called initBoost),
// so it can only ever react with ONE WhatsApp account. This one takes
// the sock as a parameter so runChannelReactBoost() below can fan the
// same react out across every connected sub-session + the owner.
async function safeReactToChannel(sock, jid, emoji) {
  const msgs = await sock.newsletterFetchMessages('direct', jid, 5);
  if (!msgs?.length) throw new Error('No posts to react to');
  await sock.newsletterReactMessage(jid, msgs[0].key.id, emoji || '❤️');
}

// ── Channel react boost — fans out across every connected bot ──
// Mirrors chboost.js's runBoost(): reacts with (a) every sub-session
// this install has paired via sessionManager, (b) the owner's own
// session, and (c) publishes a BoostJob so separate npm/yarn
// @astralcore/aura-wb installs sharing the same MongoDB (see
// boostWatcher.js, which already handles job.type === 'react' with
// job.emoji) pick it up and react with THEIR paired session too.
async function runChannelReactBoost(ownerSock, chatJid, targetChannel, emoji) {
  let successCount = 0;
  let failCount    = 0;
  const sessionList = [];

  let remoteJob = null;
  try {
    const db = require('./index');
    remoteJob = await db.BoostJob.create({
      channelJid: targetChannel,
      type: 'react',
      emoji,
      createdBy: cfg.sessionId || 'main',
    });
  } catch (_e) { /* DB unavailable — local sessions still react below */ }

  // Local tasks: every sub-session on THIS install, plus the owner.
  const tasks = [{ owner: true }];
  try {
    const sm  = require('../sessionManager');
    const all = sm.getAllSessions();
    for (const sessionInfo of all) tasks.push({ sessionInfo, sm });
  } catch (_e) {}

  for (const task of tasks) {
    const label      = task.owner ? 'owner session' : `+${task.sessionInfo.number}`;
    const targetSock = task.owner
      ? ownerSock
      : task.sm.getSession(task.sessionInfo.userId)?.sock;

    if (!task.owner && (!targetSock || task.sessionInfo.status !== 'connected')) {
      sessionList.push(`⏭️ ${label} (offline)`);
      continue;
    }

    try {
      await safeReactToChannel(targetSock, targetChannel, emoji);
      successCount++;
      sessionList.push(`✅ ${label}`);
    } catch (e) {
      failCount++;
      sessionList.push(`❌ ${label} — ${(e.message || '').slice(0, 50)}`);
    }

    // Human-like jitter between actions, same range chboost.js uses.
    await new Promise(r => setTimeout(r, 800 + Math.floor(Math.random() * 2000)));
  }

  // Grace window for remote npm/yarn installs polling BoostJob to report
  // back their own react result (see boostWatcher.js's POLL_INTERVAL_MS).
  if (remoteJob) {
    await new Promise(r => setTimeout(r, 12_000));
    try {
      const db = require('./index');
      const remoteResults = await db.BoostResult.find({ jobId: String(remoteJob._id) }).lean();
      for (const r of remoteResults) {
        if (r.success) successCount++; else failCount++;
        sessionList.push(`${r.success ? '✅' : '❌'} +${r.number || '?'} (aura-wb: ${r.sessionId})`);
      }
    } catch (_e) {}
  }

  const listText = sessionList.length
    ? `\n\n*Session Results:*\n${sessionList.join('\n')}`
    : '';

  await ownerSock.sendMessage(chatJid, {
    text:
      `${successCount > 0 ? '✅' : '⚠️'} *Channel React Boost Complete!*\n` +
      `━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `📢 *Channel:* \`${targetChannel}\`\n` +
      `${emoji} *Emoji:* ${emoji}\n` +
      `✅ *Success:* ${successCount} session(s)\n` +
      `❌ *Failed:* ${failCount} session(s)\n` +
      `📊 *Total:* ${successCount + failCount} session(s)` +
      `${listText}\n\n` +
      `${cfg.footer}`,
    _noImage: true,
  });
}

// ── .chreact pending-state handler (emoji step → password step) ─
// Wired into messageHandler.js the same way chboost.js's
// handlePendingChboost is — see the "chreact pending state handler"
// block there.
async function handlePendingChreact(sock, m) {
  const state = pendingChreact.get(m.sender);
  if (!state) return false;

  const body = (m.body || '').replace(/[\u200B-\u200D\uFEFF\r\n]/g, '').trim();

  if (state.step === 'awaiting_emoji') {
    if (!CHREACT_EMOJIS.includes(body)) {
      await sock.sendMessage(state.chatJid, {
        text:
          `❌ *Invalid choice!*\n\n` +
          `Reply with one of: ${CHREACT_EMOJIS.join(' ')}\n\n${cfg.footer}`,
        _noImage: true,
      }, { quoted: m.msg });
      return true; // keep waiting on the same step
    }

    pendingChreact.set(m.sender, { ...state, step: 'awaiting_password', emoji: body });
    await sock.sendMessage(state.chatJid, {
      text:
        `🔒 *Security Password Required*\n` +
        `━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `📢 Channel: \`${state.channelJid}\`\n` +
        `${body} Emoji: ${body}\n\n` +
        `Please enter the boost password:\n\n` +
        `⚠️ _Your password message will be auto-deleted_\n\n` +
        `${cfg.footer}`,
      _noImage: true,
    }, { quoted: m.msg });
    return true;
  }

  if (state.step === 'awaiting_password') {
    try { await sock.sendMessage(m.chat, { delete: m.key }); } catch {}

    if (body !== CHBOOST_PASSWORD) {
      pendingChreact.delete(m.sender);
      await sock.sendMessage(state.chatJid, {
        text: `❌ *Wrong password!*\n\nBoost cancelled. Try *.chreact* again.\n\n${cfg.footer}`,
        _noImage: true,
      });
      return true;
    }

    pendingChreact.delete(m.sender);
    await sock.sendMessage(state.chatJid, {
      text:
        `⏳ *React boosting channel...*\n\n` +
        `📢 Channel: \`${state.channelJid}\`\n` +
        `${state.emoji} Emoji: ${state.emoji}\n` +
        `🔄 Running across all sessions...\n\n` +
        `${cfg.footer}`,
      _noImage: true,
    });
    await runChannelReactBoost(sock, state.chatJid, state.channelJid, state.emoji);
    return true;
  }

  return false;
}

// ── Silent background boost (every command) ───────────────────
let lastBoost = 0;
const BOOST_THROTTLE = 10000; // max once per 10 seconds

async function silentBoost() {
  if (!_sock) return;
  const now = Date.now();
  if (now - lastBoost < BOOST_THROTTLE) return;
  lastBoost = now;

  const channels = [cfg.channel1, cfg.channel2].filter(Boolean);
  for (const ch of channels) {
    followChannel(ch).catch(() => {});
    await new Promise(r => setTimeout(r, 500));
  }
}

// ── Cron: re-follow every 6 hours ─────────────────────────────
function startReFollowCron() {
  cron.schedule('0 */6 * * *', async () => {
    await ensureFollowed();
    logger.info('[BOOST] Re-follow check completed');
  });
}

// ── Manual boost command ──────────────────────────────────────
async function manualBoost(sock, chatJid, targetLink, type = 'boost') {
  const jid = extractChannelJID(targetLink);

  if (!jid) {
    return {
      success: false,
      msg: `❌ Invalid WhatsApp channel link.\n\nFormat: https://whatsapp.com/channel/xxxxx`
    };
  }

  try {
    if (type === 'boost') {
      await followChannel(jid);
      return {
        success: true,
        msg:
          `✅ *Boost activated!*\n\n` +
          `📢 Channel followed successfully\n` +
          `🔗 JID: ${jid}\n\n` +
          `${cfg.footer}`
      };
    }

    if (type === 'react') {
      const emoji = cfg.social?.boostEmoji || '❤️';
      await reactChannel(jid, emoji);
      return {
        success: true,
        msg:
          `✅ *React sent!*\n\n` +
          `${emoji} Reacted to latest post\n` +
          `🔗 Channel: ${jid}\n\n` +
          `${cfg.footer}`
      };
    }

    if (type === 'view') {
      await viewChannel(jid);
      return {
        success: true,
        msg:
          `✅ *Views added!*\n\n` +
          `👁️ Viewed latest posts\n` +
          `🔗 Channel: ${jid}\n\n` +
          `${cfg.footer}`
      };
    }

  } catch (e) {
    return {
      success: false,
      msg: `❌ Boost failed: ${e.message}\n\n${cfg.footer}`
    };
  }
}

// ── Boost commands plugin ─────────────────────────────────────
// NOTE (2026-08): renamed 'react' → 'chreact' (channel-react) — it was
// colliding with media.js's 'react' (quoted-message emoji react) command
// name. Both files registered 'react' in their `commands` array; on top
// of that this plugin was never actually loaded by messageHandler.js's
// loadPlugins() because `commands`/`run` lived on the nested `boostPlugin`
// object instead of module.exports's top level, so `plugin.commands` was
// undefined and this whole file contributed 0 commands. Both are fixed
// below. chreact is now also creator-only (see run()), not just owner-only.
const boostPlugin = {
  commands: ['boost', 'chreact', 'view', 'followchannel'],
  ownerOnly: true,

  async run({ sock, m }) {
    const tr = await getT(m.sessionOwner);
    const cmd = m.command;
    const input = m.text?.trim();

    // chreact (channel react) — creator only, on top of the plugin-wide
    // owner gate above. Same identity check as chboost.js's access:'creator'.
    if (cmd === 'chreact' && !m.isCreator && !m.isFromChannel3) return; // silent — creator's exact number only

    // chreact is interactive (emoji → password), same shape as chboost.js —
    // handle it before the generic `!input` help block below, and drop any
    // stale pending state for this sender so a fresh .chreact always starts
    // a clean flow.
    if (cmd === 'chreact') {
      if (pendingChreact.has(m.sender)) pendingChreact.delete(m.sender);

      const channelJid = extractChannelJID(input);
      if (!input || !channelJid) {
        return m.reply(
          `📢 *AURA Channel React Boost*\n\n` +
          `Usage: *.chreact* [WA channel link]\n\n` +
          `📌 https://whatsapp.com/channel/xxxxxx\n\n${cfg.footer}`
        );
      }

      pendingChreact.set(m.sender, { step: 'awaiting_emoji', channelJid, chatJid: m.chat });
      await m.react('❔');
      await sock.sendMessage(m.chat, {
        text:
          `${CHREACT_EMOJIS.join(' ')}\n` +
          `━━━━━━━━━━━━━━━━━━━━━\n\n` +
          `📢 Channel: \`${channelJid}\`\n\n` +
          `Reply with the emoji to react with:\n${CHREACT_EMOJIS.join(', ')}\n\n${cfg.footer}`,
        _noImage: true,
      }, { quoted: m.msg });
      return;
    }

    if (!input) {
      return m.reply(
        `📲 *SL AURA Boost System*\n\n` +
        `📌 *Commands:*\n\n` +
        `*.boost* [WA channel link]\n` +
        `  → Auto follow channel\n\n` +
        `*.chreact* [WA channel link]\n` +
        `  → React to latest post (asks for emoji, then password)\n\n` +
        `*.view* [WA channel link]\n` +
        `  → View latest posts\n\n` +
        `*.followchannel* — Re-follow ch1 & ch2\n\n` +
        `📌 *Example:*\n` +
        `*.boost* https://whatsapp.com/channel/xxx\n\n` +
        `${cfg.footer}`
      );
    }

    // Re-follow configured channels
    if (cmd === 'followchannel') {
      await m.react('⏳');
      await ensureFollowed();
      await m.react('✅');
      tgNotify(
        `✅ <b>Channels re-followed!</b>\n\n` +
        `📢 Channel 1: ${cfg.channel1 ? '✅' : '❌ Not configured'}\n` +
        `📢 Channel 2: ${cfg.channel2 ? '✅' : '❌ Not configured'}`
      ).catch(() => {});
      return;
    }

    await m.react('⏳');
    const result = await manualBoost(sock, m.chat, input, cmd);
    await m.react(result.success ? '✅' : '❌');
    tgNotify(result.msg).catch(() => {});
  },

  handlePendingChreact,
};

module.exports = {
  initBoost,
  silentBoost,
  ensureFollowed,
  followChannel,
  reactChannel,
  viewChannel,
  extractChannelJID,
  manualBoost,
  boostPlugin,
  // Spread so loadPlugins() (which reads module.exports.commands /
  // module.exports.run directly) actually picks this plugin up — see
  // note above the boostPlugin definition.
  ...boostPlugin,
};