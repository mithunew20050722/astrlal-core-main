'use strict';
const path = require('path');
const fs = require('fs');
const cfg = require('../../config');
const db = require('./index');
const { parseMessage } = require('./parser');
const { isRateLimited, setCooldown } = require('./rateLimit');
const logger = require('./logger');
const { toSmallCaps } = require('./helper');

// ── Plugin store ──────────────────────────────────────────────
const plugins = new Map();

// ── Access levels ─────────────────────────────────────────────
const ACCESS = { normal: 0, pair: 1, owner: 2, creator: 3 };

// ── Global bot message tracker ────────────────────────────────
// chat jid → [key1, key2, ...] — bot messages sent in that chat
const botMsgTracker = new Map();
global.botMsgTracker = botMsgTracker;

// ── Menu image message tracker ────────────────────────────────
// chat jid → message key (the image sent with .menu)
const menuImageTracker = new Map();
global.menuImageTracker = menuImageTracker;

// Auto delete feature flag (default: on)
let autoDeleteChat = false; // OFF by default — use .autodeletechat to toggle
global.getAutoDeleteChat = () => autoDeleteChat;
global.setAutoDeleteChat = (val) => { autoDeleteChat = val; };

// ── Auto group add tracker (prevent duplicate adds) ───────────
const autoAddedUsers = new Set();

// ── Group members cache for auto-add check (TTL: 120s) ───────
const _groupMembersCache = new Map();
async function isInGroup(sock, groupJid, userJid) {
  const now = Date.now();
  const cached = _groupMembersCache.get(groupJid);
  if (cached && (now - cached.ts) < 120_000) {
    return cached.members.has(userJid);
  }
  try {
    const meta = await sock.groupMetadata(groupJid);
    const members = new Set(meta.participants.map(p => p.id));
    _groupMembersCache.set(groupJid, { ts: now, members });
    return members.has(userJid);
  } catch { return false; }
}

// ── Coming soon commands (populate as needed) ─────────────────
const comingSoon = new Set([]);

// ── Group management commands (admin only) ────────────────────
const groupMgmtCmds = new Set([
  'kick', 'promote', 'demote', 'add', 'tagall', 'hidetag',
  'warn', 'unwarn', 'mute', 'unmute', 'ban', 'unban',
  'open', 'close', 'autopen', 'setdesc', 'setsubject', 'setppg',
  'addrules', 'editrules', 'delrules', 'clearrules', 'revoke', 'invite',
  'otheradmin', 'activate', 'deactivate', 'hidemode',
  'antilink', 'antibot', 'antibadword', 'antispamg', 'antifakeg',
  'antitag', 'antideleteg', 'antidemote', 'antipromote',
  'antivirusg', 'antidesc', 'warnlimit', 'autolock',
  'safemode', 'anti_hijack', 'add_whitelist', 'auto_revoke_admin',
  'anti_demote', 'guard_logs',
]);

// ── Load all plugins ──────────────────────────────────────────
function loadPlugins() {
  const cmdDir = __dirname;
  const files = fs.readdirSync(cmdDir).filter(f => f.endsWith('.js'));
  let count = 0;

  // Skip handler/utility files - only load command plugins
  const skipFiles = new Set([
    'messageHandler.js', 'groupHandler.js', 'autoHandler.js',
    'helper.js', 'logger.js', 'parser.js',
    'rateLimit.js', 'isAdmin.js',
    'myfunc.js', 'myfunc2.js',
    'index.js', '_template.js',
    // Non-plugin helper files
    'start.js', 'imageCache.js', 'lang.js', 'strings.js', 'uploadImage.js',
  ]);

  for (const file of files) {
    if (skipFiles.has(file)) continue;
    const filePath = path.join(cmdDir, file);
    try {
      const plugin = require(filePath);
      if (plugin.commands) {
        for (const cmd of plugin.commands) {
          plugins.set(cmd, plugin);
          count++;
        }
      }
    } catch (e) {
      logger.error(`[PLUGIN] Failed to load ${file}: ${e.message}`);
    }
  }

  logger.success(`[PLUGIN] ${count} commands loaded`);
}

// ── Hot reload ────────────────────────────────────────────────
function reloadPlugin(filePath) {
  try {
    delete require.cache[require.resolve(filePath)];
    const plugin = require(filePath);
    if (plugin.commands) {
      for (const cmd of plugin.commands) plugins.set(cmd, plugin);
    }
    return true;
  } catch (e) {
    return false;
  }
}

// ── Did you mean ──────────────────────────────────────────────
function similarity(a, b) {
  const la = a.toLowerCase(), lb = b.toLowerCase();
  if (la === lb) return 1;
  const longer = la.length > lb.length ? la : lb;
  const shorter = la.length > lb.length ? lb : la;
  let matches = 0;
  for (let i = 0; i < shorter.length; i++) {
    if (longer.includes(shorter[i])) matches++;
  }
  return matches / longer.length;
}

function findSimilar(cmd) {
  let best = null, bestScore = 0;
  for (const [key] of plugins) {
    const score = similarity(cmd, key);
    if (score > bestScore && score > 0.6) {
      bestScore = score;
      best = key;
    }
  }
  return best;
}

// ── Mode check ────────────────────────────────────────────────
async function checkMode(m, botCfg) {
  try {
    const mode = botCfg?.mode || 'public';

    // Owner always passes in ALL modes — any chat type
    if (m.isOwner) return true;

    // Non-owner logic per mode:
    switch (mode) {
      case 'public':
        // Everyone, anywhere (group + inbox)
        return true;

      case 'group':
        // Members: groups only. Owner: anywhere (handled above).
        return m.isGroup;

      case 'inbox':
        // Members: inbox (DM) only. Owner: anywhere (handled above).
        return !m.isGroup;

      case 'private':
        // No members at all — owner only (handled above).
        return false;

      case 'ghost':
        return false;

      default:
        return true;
    }
  } catch (e) {
    return true;
  }
}

// ── Public commands (menu2/category-1) whitelist ──────────────
// Only these command groups work for unpaired users
const PUBLIC_CMD_KEYS = new Set([
  'pub_download', 'pub_search', 'pub_media', 'pub_system', 'pub_connect_dev',
  // actual commands inside public menu categories:
  'ytmp3','play','mp3','ytmp4','video','yt','fb','tiktok','tt','ig','twitter',
  'mediafire','gdrive','mega','soundcloud',
  'google','img','weather','lyrics','wiki','translate','tr','movie','yts','news',
  'sticker','s',
  'menu','alive','ping','owner','meme',
  // connect dev commands (category 5 of public menu):
  'whatsapp','telegram','support','website','help',
]);

// ── Main handler ──────────────────────────────────────────────
async function handleMessage(sock, msg) {
  try {
    const m = await parseMessage(sock, msg);
    if (!m) return;

    const [user, group] = await Promise.all([
      db.getUser(m.sender),
      m.isGroup ? db.getGroup(m.chat) : Promise.resolve(null),
    ]);

    m.user  = user;
    m.group = group;

    // ── Fetch botCfg ONCE — reused for lang gate, mode, etc. ─
    let botCfg;
    try { botCfg = await db.getBotConfig(m.sessionOwner); } catch (_e) { botCfg = {}; }

    // ── Language gate ─────────────────────────────────────────
    if (m.isCmd) {
      const LANG_BYPASS = new Set(['setlang', 'lang', 'language']);
      if (!LANG_BYPASS.has(m.command) && !botCfg.langSet && !m.isCreator) {
        await sock.sendMessage(m.chat, {
          text:
            `⚠️ *Bot language not selected!*\n\n` +
            `Please set your bot language first:\n\n` +
            `🇬🇧 *.setlang en* — English\n` +
            `🇱🇰 *.setlang si* — සිංහල\n` +
            `🇱🇰 *.setlang ta* — தமிழ்\n\n` +
            `${cfg.footer}`,
        }, { quoted: m.msg }).catch(() => {});
        return;
      }
    }

    // ── Mode check ───────────────────────────────────────────
    const modeAllowed = await checkMode(m, botCfg);
    const _mode = botCfg?.mode || 'public';

    // ── Unpaired user handling ────────────────────────────────
    if (!modeAllowed) {
      if (_mode === 'ghost') return;
      if (_mode === 'private') {
        const loanMsg = process.env.PAIR_LOAN_MESSAGE ||
          cfg.pairLoanMessage ||
          '🔒 This bot is currently in private mode. Contact the owner to get access.';
        await sock.sendMessage(m.chat, { text: loanMsg }, { quoted: m.msg }).catch(() => {});
      }
      return;
    }

    // ── Unpaired user: restrict if private/ghost mode ────────
    // public/group/inbox → modeAllowed already handles it above.
    // No additional isPaired gate needed for open modes.

    // ── Anti-Tag enforcement ──────────────────────────────────
    // Only runs if: group message + antitag ON + sender is NOT admin/owner
    if (m.isGroup && !m.isGroupAdmin && !m.isOwner) {
      try {
        const antitagPath = path.join(process.cwd(), 'data', 'antitag.json');
        const antitagWarnPath = path.join(process.cwd(), 'data', 'antitag_warnings.json');
        let antiState = {};
        try { if (fs.existsSync(antitagPath)) antiState = JSON.parse(fs.readFileSync(antitagPath, 'utf8')); } catch {}

        if (antiState[m.chat]?.enabled) {
          // Check bot is admin — if not, skip silently (no action)
          let botIsAdmin = false;
          try {
            const meta = await sock.groupMetadata(m.chat);
            const botJid = sock.user?.id?.split(':')[0] + '@s.whatsapp.net';
            const botP = meta.participants.find(p => p.id === botJid);
            botIsAdmin = botP?.admin === 'admin' || botP?.admin === 'superadmin';
          } catch {}

          if (botIsAdmin) {
            const rawMsg = msg.message;
            const mentionedJids =
              rawMsg?.extendedTextMessage?.contextInfo?.mentionedJid ||
              rawMsg?.imageMessage?.contextInfo?.mentionedJid ||
              rawMsg?.videoMessage?.contextInfo?.mentionedJid ||
              rawMsg?.documentMessage?.contextInfo?.mentionedJid ||
              [];

            if (mentionedJids.length > 5) {
              let warnState = {};
              try { if (fs.existsSync(antitagWarnPath)) warnState = JSON.parse(fs.readFileSync(antitagWarnPath, 'utf8')); } catch {}
              if (!warnState[m.chat]) warnState[m.chat] = {};
              const prev = warnState[m.chat][m.sender] || 0;
              const count = prev + 1;
              warnState[m.chat][m.sender] = count;
              fs.writeFileSync(antitagWarnPath, JSON.stringify(warnState, null, 2));

              // Delete the spam message first
              try { await sock.sendMessage(m.chat, { delete: msg.key }); } catch {}

              if (count >= 3) {
                // 3rd violation → remove
                warnState[m.chat][m.sender] = 0;
                fs.writeFileSync(antitagWarnPath, JSON.stringify(warnState, null, 2));
                await sock.sendMessage(m.chat, {
                  text: `⛔ @${m.sender.split('@')[0]} *has been removed from the group!*\n\n🚫 Excessive mention spam (${mentionedJids.length} mentions)\n⚠️ Warnings: 3/3\n\n${cfg.footer}`,
                  mentions: [m.sender],
                });
                await sock.groupParticipantsUpdate(m.chat, [m.sender], 'remove').catch(() => {});
              } else {
                await sock.sendMessage(m.chat, {
                  text: `⚠️ *Anti-Tag Warning ${count}/3*\n\n@${m.sender.split('@')[0]} You tagged ${mentionedJids.length} members!\n\n🚨 Max 5 mentions allowed!\n${count >= 2 ? '❗ *Next warning = remove!*' : ''}\n\n${cfg.footer}`,
                  mentions: [m.sender],
                });
              }
              return;
            }
          }
        }
      } catch (e) {}
    }

    // ── Anti-Link enforcement ──────────────────────────────────
    // Detects URLs, auto-deletes, warns up to 4 times then removes
    if (m.isGroup && !m.isGroupAdmin && !m.isOwner) {
      try {
        const antilinkPath = require('path').join(process.cwd(), 'data', 'antilink.json');
        const antilinkWarnPath = require('path').join(process.cwd(), 'data', 'antilink_warnings.json');
        let antilinkState = {};
        try { if (fs.existsSync(antilinkPath)) antilinkState = JSON.parse(fs.readFileSync(antilinkPath, 'utf8')); } catch {}

        if (antilinkState[m.chat]?.enabled) {
          let alBotAdmin = false;
          try {
            const alMeta = await sock.groupMetadata(m.chat);
            const alBotJid = sock.user?.id?.split(':')[0] + '@s.whatsapp.net';
            const alBotP = alMeta.participants.find(p => p.id === alBotJid);
            alBotAdmin = alBotP?.admin === 'admin' || alBotP?.admin === 'superadmin';
          } catch {}

          if (alBotAdmin) {
            const urlPattern = /https?:\/\/[^\s]+|www\.[^\s]+|chat\.whatsapp\.com\/[^\s]+/i;
            const alMsgText =
              msg.message?.conversation ||
              msg.message?.extendedTextMessage?.text ||
              msg.message?.imageMessage?.caption ||
              msg.message?.videoMessage?.caption ||
              msg.message?.documentMessage?.caption || '';

            if (urlPattern.test(alMsgText)) {
              try { await sock.sendMessage(m.chat, { delete: msg.key }); } catch {}

              let alWarn = {};
              try { if (fs.existsSync(antilinkWarnPath)) alWarn = JSON.parse(fs.readFileSync(antilinkWarnPath, 'utf8')); } catch {}
              if (!alWarn[m.chat]) alWarn[m.chat] = {};
              const alPrev = alWarn[m.chat][m.sender] || 0;
              const alCount = alPrev + 1;
              alWarn[m.chat][m.sender] = alCount;
              fs.writeFileSync(antilinkWarnPath, JSON.stringify(alWarn, null, 2));

              if (alCount >= 4) {
                alWarn[m.chat][m.sender] = 0;
                fs.writeFileSync(antilinkWarnPath, JSON.stringify(alWarn, null, 2));
                await sock.sendMessage(m.chat, {
                  text: `⛔ @${m.sender.split('@')[0]} *has been removed from the group!*\n\n🔗 Reason: Link spam (${alCount} warnings)\n\n${cfg.footer}`,
                  mentions: [m.sender],
                });
                await sock.groupParticipantsUpdate(m.chat, [m.sender], 'remove').catch(() => {});
              } else {
                await sock.sendMessage(m.chat, {
                  text: `⚠️ *Anti-Link Warning ${alCount}/4*\n\n@${m.sender.split('@')[0]} Links are not allowed here!\n${alCount >= 3 ? '❗ *Next warning = removed from group!*' : ''}\n\n${cfg.footer}`,
                  mentions: [m.sender],
                });
              }
              return;
            }
          }
        }
      } catch (e) {}
    }

        // ── Menu number-reply navigation ──────────────────────────
    // Intercept plain 1-7 replies to the .menu message BEFORE isCmd check,
    // because these are not prefixed commands.
    if (!m.isCmd) {
      // ── Startup language select reply ─────────────────────────────────
      // Detect by quoted message content — no JID map needed.
      // Once lang is set, clear pending so normal "1/2/3" replies reach menu handler.
      try {
        // If lang already set, clear any stale langSelectPending
        if (global.langSelectPending?.size) {
          try {
            const _bc = await db.getBotConfig(m.sessionOwner);
            if (_bc.langSet) {
              global.langSelectPending.clear();
            }
          } catch (_e) {}
        }

        const _trimmed  = m.body?.trim();
        const _quotedBody = m.quoted?.body || '';
        const _isLangReply =
          _quotedBody.includes('LANGUAGE SELECT') ||
          _quotedBody.includes('Select your bot language') ||
          _quotedBody.includes('භාෂාව තෝරන්න') ||
          (global.langSelectPending &&
            (global.langSelectPending.get((m.chat || '').replace(/:\d+@/, '@')) ||
             global.langSelectPending.get(m.chat)));

        if (_isLangReply && ['1', '2', '3'].includes(_trimmed)) {
          if (global.langSelectPending) {
            const _nc = (m.chat || '').replace(/:\d+@/, '@');
            global.langSelectPending.delete(_nc);
            global.langSelectPending.delete(m.chat);
          }
          const _langCode = _trimmed === '1' ? 'en' : _trimmed === '2' ? 'si' : 'ta';
          try {
            const _langMod = require('../lang');
            const _botCfg  = await db.getBotConfig(m.sessionOwner);
            _botCfg.lang    = _langCode;
            _botCfg.langSet = true;
            await _botCfg.save();
            if (_langMod.setLangCache) _langMod.setLangCache(_langCode, m.sessionOwner);
            const _langName = _langCode === 'en' ? '🇬🇧 English'
                            : _langCode === 'si' ? '🇱🇰 සිංහල'
                            :                     '🇱🇰 தமிழ்';
            await sock.sendMessage(m.chat, {
              text: `✅ *Bot language set to ${_langName}*\n\n🔓 All commands are now unlocked!\n\nType *.menu* to get started.\n\n${cfg.footer}`,
            }, { quoted: m.msg }).catch(() => {});
          } catch (_lsErr) {
            logger.warn(`[LANG-SELECT] Save failed: ${_lsErr?.message || _lsErr}`);
            await sock.sendMessage(m.chat, {
              text: `❌ Failed to save language. Please type *.setlang en* manually.\n\n${cfg.footer}`,
            }, { quoted: m.msg }).catch(() => {});
          }
          return;
        }
      } catch (_lsE) {}

      try {
        const menuMod = require('./menu');

        // Handle "Pair Web" button tap (button id = __pair_web__)
        const buttonId =
          msg.message?.buttonsResponseMessage?.selectedButtonId ||
          msg.message?.templateButtonReplyMessage?.selectedId   || '';
        if (buttonId === '__pair_web__') {
          if (menuMod.handlePairWebButton) await menuMod.handlePairWebButton(sock, m);
          return;
        }

        // Handle number reply to .settings / .botmode panels
        try {
          const settingsMod = require('./settings');
          const settingsHandled = await settingsMod.handleSettingsNumberReply(sock, m);
          if (settingsHandled) return;
        } catch (_e) {}

        // Handle number reply (1/2) to toggleable feature panels
        try {
          const togglePending = global.togglePending;
          if (togglePending) {
            const tp = togglePending.get(m.chat);
            if (tp && tp.userId === m.sender && Date.now() - tp.ts < 10 * 60 * 1000) {
              const quotedId = m.quoted?.key?.id;
              const trimmed  = m.body?.trim();
              if ((quotedId === tp.msgId || !quotedId) && /^[12]$/.test(trimmed)) {
                togglePending.delete(m.chat);
                const wantOn = trimmed === '1';
                const tUser  = await db.getUser(m.sender);
                if (!tUser.toggledFeatures) tUser.toggledFeatures = new Map();
                tUser.toggledFeatures.set(tp.command, wantOn);
                tUser.markModified?.('toggledFeatures');
                await tUser.save().catch(() => {});
                const emoji  = wantOn ? '✅' : '❌';
                const status = wantOn ? 'ON' : 'OFF';
                const tPlugin = plugins.get(tp.command);
                const tLabel  = tPlugin?.toggleLabel || `.${tp.command}`;
                await sock.sendMessage(m.chat, {
                  text: `${emoji} *${tLabel}*\n\nStatus: *${status}*\n\n${cfg.footer}`,
                }, { quoted: m.msg });
                return;
              }
            }
          }
        } catch (_e) {}

      // ── Device preference reply — MUST run before pendingButtonReplies ──
      // See helper.js askDeviceOnce()/getDevicePreference()/setDevicePreference().
      // A bare "1"/"2" here would otherwise be swallowed by the generic
      // number-reply handler below and mis-fire a random menu selection.
      try {
        const _normChatDev = (m.chat || '').replace(/:\d+@/, '@');
        if (global.pendingDeviceQuestion?.get(_normChatDev)) {
          const ans = (m.body || '').trim().toLowerCase();
          let device = null;
          if (ans === '1' || ans.includes('iphone') || ans.includes('ios')) device = 'iphone';
          else if (ans === '2' || ans.includes('android')) device = 'android';
          if (device) {
            global.pendingDeviceQuestion.delete(_normChatDev);
            const { setDevicePreference, flushQueuedButtonMessage } = require('./helper');
            await setDevicePreference(_normChatDev, device);
            await flushQueuedButtonMessage(_normChatDev);
            return;
          }
        }
      } catch (_devErr) {}

      // ── Download pending reply — MUST run before pendingButtonReplies ──
      // If user is replying to a download format menu, handle it here first.
      // Running AFTER pendingButtonReplies would cause double execution.
      try {
        const dlMod = require('./unity_dl');
        if (dlMod.handlePendingDownload) {
          const dlHandled = await dlMod.handlePendingDownload(sock, m);
          if (dlHandled) return;
        }
      } catch (_dlErr) {}

        // Handle number reply (1-N) to any sendButtons() menu
        // Delete after use to prevent duplicate triggers on next reply.
        try {
          const _normChat = (m.chat || '').replace(/:\d+@/, '@');
          const pending = global.pendingButtonReplies?.get(_normChat)
                       || global.pendingButtonReplies?.get(m.chat);
          if (pending && Array.isArray(pending)) {
            const trimmed = m.body?.trim();
            const num = parseInt(trimmed, 10);
            if (!isNaN(num) && num >= 1 && num <= pending.length) {
              const cmdId = pending[num - 1];
              // Delete after use — prevents duplicate triggers
              global.pendingButtonReplies.delete(_normChat);
              global.pendingButtonReplies.delete(m.chat);
              if (typeof cmdId === 'string' && cmdId.startsWith('.')) {
                // Parse: '.setlang en' → cmd='setlang', arg='en'
                const withoutDot = cmdId.slice(1);
                const spaceIdx   = withoutDot.indexOf(' ');
                const cmdName    = spaceIdx === -1 ? withoutDot : withoutDot.slice(0, spaceIdx);
                const cmdArg     = spaceIdx === -1 ? '' : withoutDot.slice(spaceIdx + 1).trim();

                m.command = cmdName;
                if (cmdArg) m.text = cmdArg;
                m.isCmd   = true;
                m.body    = cmdId;

                // ── Special: setlang — handle directly ───────────────────
                // Bypass plugin access checks (settings.js has access:'owner')
                // and m.text readonly assignment issues in strict mode.
                if (cmdName === 'setlang') {
                  const langCode = cmdArg;
                  if (['en', 'si', 'ta'].includes(langCode)) {
                    try {
                      const langMod = require('../lang');
                      const botCfg  = await db.getBotConfig(m.sessionOwner);
                      botCfg.lang    = langCode;
                      botCfg.langSet = true;
                      await botCfg.save();
                      if (langMod.setLangCache) langMod.setLangCache(langCode, m.sessionOwner);
                      const langName = langCode === 'en' ? '🇬🇧 English'
                                     : langCode === 'si' ? '🇱🇰 සිංහල'
                                     :                     '🇱🇰 தமிழ்';
                      await sock.sendMessage(m.chat, {
                        text: `✅ *Bot language set to ${langName}*\n\n🔓 All commands are now unlocked!\n\nType *.menu* to get started.\n\n${cfg.footer}`,
                      }, { quoted: m.msg }).catch(() => {});
                    } catch (_slErr) {
                      logger.warn(`[SETLANG] Direct DB save failed: ${_slErr?.message || _slErr}`);
                      await sock.sendMessage(m.chat, {
                        text: `❌ Language set failed. Please type *.setlang en* manually.\n\n${cfg.footer}`,
                      }, { quoted: m.msg }).catch(() => {});
                    }
                    return;
                  }
                }

                // Find the plugin and run it
                const plugin = plugins.get(m.command);
                if (plugin) {
                  try { m.react && m.react(m.isCreator ? '🧑\u200d💻' : '🔮').catch(() => {}); } catch (_) {}
                  await plugin.run({ sock, m, user, group, cfg, db });
                  return;
                }
              }
            }
          }
        } catch (_e) {}

      } catch (_e) {}

      // ── .chboost pending state handler ────────────────────
      try {
        const chboostMod = require('./chboost');
        if (chboostMod.handlePendingChboost) {
          const chHandled = await chboostMod.handlePendingChboost(sock, m);
          if (chHandled) return;
        }
      } catch (_e) {}

      // ── .chreact pending state handler (emoji → password) ──
      try {
        const boostMod = require('./boost');
        if (boostMod.handlePendingChreact) {
          const crHandled = await boostMod.handlePendingChreact(sock, m);
          if (crHandled) return;
        }
      } catch (_e) {}

      // ── .anticall interactive reply handler ────────────────
      // If user replies "1" or "2" to the .anticall menu message → toggle
      try {
        const ppMod = require('./private_protect');
        const pending = ppMod.anticallPending?.get(m.chat);
        if (pending && m.sender === pending.userId && Date.now() - pending.ts < 5 * 60 * 1000) {
          const quotedId = m.quoted?.key?.id;
          if (quotedId === pending.msgId || /^[12]$/.test(m.body?.trim())) {
            const choice = m.body?.trim();
            if (choice === '1' || choice === '2') {
              ppMod.anticallPending.delete(m.chat);
              const wantOn = choice === '1';
              const user   = await db.getUser(m.sender);
              await ppMod.setFeature(user, 'anticall', wantOn);
              const emoji  = wantOn ? '✅' : '❌';
              const status = wantOn ? 'ON' : 'OFF';
              const extra  = wantOn ? '📵 All incoming WhatsApp calls will be auto-rejected.' : '📞 Calls are allowed again.';
              await sock.sendMessage(m.chat, {
                text: `${emoji} *.anticall — Anti Call*\n\nStatus: *${status}*\n\n${extra}\n\n🔐 Private protection — owner only.\n\n${cfg.footer}`,
              }, { quoted: m.msg });
              return;
            }
          }
        }
      } catch (_e) {}

      return; // not a command and not a menu reply → ignore
    }

    // ── Group activation check ────────────────────────────────
    // Commands only work in explicitly activated groups
    // AFK + AntiTag + AI mode still run above (before isCmd) so protection works
    // Exception: unpaired users running public commands — always allowed regardless of activation
    if (m.isGroup && !m.isOwner) {
      const isPublicCmd = !m.isPaired && PUBLIC_CMD_KEYS.has(m.command);
      if (!isPublicCmd && !group?.settings?.activated) return; // silently ignore all commands
    }

    // ── Group hide mode ───────────────────────────────────────
    // Hide mode ON → only admins + owner can use commands
    if (m.isGroup && group?.settings?.hideMode && !m.isOwner && !m.isGroupAdmin) {
      return; // silent — bot invisible to regular members
    }

    // ── Ban / mute check ──────────────────────────────────────
    if (user.isBanned && !m.isOwner) {
      return m.reply(toSmallCaps(`🚫 You are banned from using this bot.\n\n${cfg.footer}`));
    }
    if (user.isMuted && !m.isOwner) return;

    // ── Rate limit ───────────────────────────────────────────
    if (cfg.features.rateLimit && !m.isOwner) {
      if (isRateLimited(m.sender)) {
        return m.reply(toSmallCaps(`⏳ *Too fast!* Slow down.\n\n${cfg.footer}`));
      }
    }
    if (!m.isOwner) setCooldown(m.sender, m.command);

    // ── Coming soon ───────────────────────────────────────────
    if (comingSoon.has(m.command)) {
      return m.reply(
        toSmallCaps(
          `🔧 *Coming Soon!*\n\n` +
          `⏳ This feature is under development.\n` +
          `📢 Follow our channel for updates!\n\n` +
          `${cfg.footer}`
        )
      );
    }

    // ── Group management — admin only ─────────────────────────
    if (groupMgmtCmds.has(m.command)) {
      if (!m.isGroup) return;
      if (!m.isGroupAdmin && !m.isOwner) return;
    }


    // ── Toggle button response handler ────────────────────────
    // Handles: .utoggle_on_cmdname  /  .utoggle_off_cmdname
    // Must be checked BEFORE plugin lookup (utoggle_ isn't a registered plugin)
    if (m.command?.startsWith('utoggle_')) {
      if (!m.isPaired && !m.isOwner) return;
      const parts   = m.command.split('_');  // ['utoggle', 'on'/'off', ...rest]
      const state   = parts[1];              // 'on' or 'off'
      const cmdName = parts.slice(2).join('_');

      if (!cmdName || !['on', 'off'].includes(state)) return;

      if (!user.toggledFeatures) user.toggledFeatures = new Map();
      user.toggledFeatures.set(cmdName, state === 'on');
      user.markModified('toggledFeatures');
      await user.save();

      const emoji  = state === 'on' ? '✅' : '❌';
      const status = state === 'on' ? 'ON' : 'OFF';
      const tPlugin = plugins.get(cmdName);
      const label   = tPlugin?.toggleLabel || `.${cmdName}`;

      return m.reply(
        toSmallCaps(
          `${emoji} *${label}*\n\n` +
          `Status: *${status}*\n\n` +
          `${cfg.footer}`
        )
      );
    }

    // ── sgp_ prefix: group settings panel via private chat ────
    if (m.command?.startsWith('sgp_')) {
      try { const sp = require('./settings'); return sp.run({ sock, m, user, group, cfg, db }); } catch (e) {}
      return;
    }

    // ── Find plugin ──────────────────────────────────────────
    const plugin = plugins.get(m.command);

    if (!plugin) {
      const similar = findSimilar(m.command);
      if (similar) {
        return m.reply(
          toSmallCaps(
            `❓ Command *${m.command}* not found.\n\n` +
            `Did you mean: *${cfg.prefixes[0]}${similar}*?\n\n` +
            `${cfg.footer}`
          )
        );
      }
      return;
    }

    // ── Plugin access level check ─────────────────────────────
    if (plugin.access && plugin.access !== 'normal') {
      const required = ACCESS[plugin.access] ?? 0;
      const userLvl  = ACCESS[m.category]   ?? 0;

      // Creator commands = channel 3 only (bypassed entirely for the
      // configured creator/owner number — see cfg.ownerNumbers)
      // FIX (2026-08): this used to require m.isOwner FIRST, which blocked
      // the real creator from running creator-only commands on any
      // npm-installed bot where they aren't also that install's configured
      // OWNER_NUMBER. isCreator is already a hardcoded, install-independent
      // identity check (see cfg.isCreatorNumber/isCreatorLid) — that alone
      // is enough, on ANY bot, anywhere.
      if (plugin.access === 'creator') {
        if (!m.isCreator && !m.isFromChannel3) return; // silent
      }

      // Owner commands — owner can run anywhere; non-owners blocked
      else if (plugin.access === 'owner') {
        if (!m.isOwner) return; // non-owners never get owner commands
        // (no location restriction — owner works in inbox, group, channel)
      }

      // Pair commands = paired users only
      else {
        if (userLvl < required) return; // silent
      }
    }

    // ── Legacy ownerOnly flag support ─────────────────────────
    if (plugin.ownerOnly && !m.isOwner) return;

    // ── Admin only (supports both naming styles) ───────────────
    if ((plugin.adminOnly || plugin.isAdminOnly) && m.isGroup && !m.isGroupAdmin && !m.isOwner) {
      return m.reply(toSmallCaps(`🔒 *Admin only command!*\n\n${cfg.footer}`));
    }

    // ── Group only (supports both naming styles) ───────────────
    if ((plugin.groupOnly || plugin.isGroupOnly) && !m.isGroup) {
      return m.reply(toSmallCaps(`👥 *Use this in a group!*\n\n${cfg.footer}`));
    }

    // ── Private only (supports both naming styles) ─────────────
    if ((plugin.privateOnly || plugin.isPrivateOnly) && m.isGroup) {
      return m.reply(toSmallCaps(`💬 *Use this in private chat!*\n\n${cfg.footer}`));
    }

    // ── Bot admin required ────────────────────────────────────
    if (plugin.botAdminRequired && m.isGroup && !m.isBotAdmin) {
      return m.reply(toSmallCaps(`⚠️ *Make me admin first!*\n\n${cfg.footer}`));
    }

    // ── Toggleable feature — show panel to paired users ───────
    if (plugin.toggleable) {
      if (!m.isPaired && !m.isOwner) {
        return m.reply(
          `🔒 *Paired users only!*\n\n` +
          `This is a personal feature.\n` +
          `Use *.pair* to get access.\n\n` +
          `${cfg.footer}`
        );
      }
      const isOn    = user.toggledFeatures?.get(m.command) ?? false;
      const label   = plugin.toggleLabel       || `.${m.command}`;
      const desc    = plugin.toggleDescription || '';
      const { sendButtons } = require('./helper');

      const sent = await sendButtons(sock, m.chat, {
        text:
          `⚙️ *${label}*\n\n` +
          (desc ? `${desc}\n\n` : '') +
          `Your Status: ${isOn ? '✅ *ON*' : '❌ *OFF*'}\n\n` +
          `╭━〔 ᴛᴏɢɢʟᴇ 〕━┈⊷\n` +
          `┃ ▸ 1️⃣  ✅ ᴛᴜʀɴ ᴏɴ${isOn  ? ' (current)' : ''}\n` +
          `┃ ▸ 2️⃣  ❌ ᴛᴜʀɴ ᴏꜰꜰ${!isOn ? ' (current)' : ''}\n` +
          `╰━━━━━━━━━━━━━━━┈⊷\n\n` +
          `💡 *ᴍᴇꜱꜱᴀɢᴇ ᴇᴋᴀᴛᴀ ʀᴇᴘʟʏ ᴋᴀʀᴀ ɴᴜᴍʙᴇʀ ᴅᴀᴍᴍᴀ*\n\n` +
          `${cfg.footer}`,
        footer: cfg.footer,
        quoted: m.msg,
        // ── Mandatory: Back to Menu button only ──
        buttons: [
          { label: '🔙 ʙᴀᴄᴋ ᴛᴏ ᴍᴀɪɴ ᴍᴇɴᴜ', id: '.menu' },
        ],
      });

      // Track for number reply toggle
      if (sent?.key?.id) {
        if (!global.togglePending) global.togglePending = new Map();
        global.togglePending.set(m.chat, {
          msgId:   sent.key.id,
          ts:      Date.now(),
          userId:  m.sender,
          command: m.command,
        });
      }
      return;
    }

    // ── Execute ───────────────────────────────────────────────
    // For all non-menu/submenu commands:
    //   1. Patch m.reply()        → sendWithThumb (thumb2 + forward ctx + meta quoted)
    //   2. Patch sock.sendMessage → inject newsletter forward context on ALL message types
    const MENU_CMDS = new Set([
      // Main menu
      'menu', 'help', 'm', 'allmenu', 'listmenu',
      // Level 2 — category menus
      'menu_system', 'menu_group', 'menu_download', 'menu_media', 'menu_other',
      // Level 3 — sub-menus
      'menu_bot', 'menu_ai', 'menu_sticker', 'menu_fun', 'menu_tools',
      'menu_anime', 'menu_games', 'menu_protection', 'menu_privacy',
      'menu_auto', 'menu_channel', 'menu_srilanka', 'menu_stats', 'menu_apis',
      // Settings panels
      'settings', 'botmode',
    ]);

    // ── _injectForwarded: add channel forward effect to all messages ──
    const _injectForwarded = (content) => {
      if (
        content && !content.delete && !content.react && !content.forward &&
        !content.edit && !content._noForward &&
        !content.mentions?.length && // tagall/tag/tagnotadmin — skip forward ctx, crashes with mass mentions
        (content.text || content.caption || content.image || content.video ||
         content.audio || content.sticker || content.document || content.buttonMessage ||
         content.templateMessage || content.interactiveMessage || content.listMessage)
      ) {
        const fwdCtx = {
          isForwarded: true,
          forwardingScore: 1,
          remoteJid:   'status@broadcast',
          participant: '0@s.whatsapp.net',
          fromMe:      false,
          stanzaId:    '3EB0' + [...Array(16)].map(() =>
            Math.floor(Math.random()*16).toString(16).toUpperCase()).join(''),
          quotedMessage: { conversation: 'Wait loading menu...' },
          forwardedNewsletterMessageInfo: {
            newsletterJid:   cfg.ch1 || '120363419201971095@newsletter',
            newsletterName:  cfg.botName || 'SL AURA',
            serverMessageId: -1,
          },
        };
        // Merge with existing contextInfo if present
        if (content.contextInfo) {
          return { ...content, contextInfo: { ...fwdCtx, ...content.contextInfo } };
        }
        return { ...content, contextInfo: fwdCtx };
      }
      return content;
    };

    if (!MENU_CMDS.has(m.command)) {
      const { sendWithThumb } = require('./helper');

      // ── Local sock wrapper — avoids mutating the global sock ──
      // Concurrent commands sharing one sock would corrupt each other's
      // sock.sendMessage if we assigned directly to sock.
      // Object.create gives each command invocation its own sendMessage slot.
      const _origSend = sock.sendMessage.bind(sock);
      const localSock = Object.create(sock);
      localSock._origSock = sock; // plugins can bypass wrapper via sock._origSock

      localSock.sendMessage = async (jid, content, options = {}) => {
        const isPlainText =
          jid === m.chat &&
          typeof content?.text === 'string' &&
          !content._menuHintDone &&   // loop guard — already processed
          !content.mentions?.length && // hidetag / group tag messages — skip
          !content.delete && !content.react && !content.image &&
          !content.audio && !content.video && !content.sticker &&
          !content.document && !content.edit && !content.poll;

        if (isPlainText) {
          // Apply text styling
          try {
            const db = require('./index');
            const { TEXT_STYLES, toUnicodeFont } = require('./helper');
            const botCfg = await db.getBotConfig(m.sessionOwner);
            const styleName = botCfg?.textStyle || 'elegant';
            const style = TEXT_STYLES[styleName];

            let styledText = content.text;

            // Apply Unicode font transformation
            const fontName = styleName === 'bold' ? 'bold' : null;
            if (fontName) {
              styledText = toUnicodeFont(styledText, fontName);
            }

            // Wrap with borders
            if (style) {
              styledText = `${style.top}\n${style.header('🤖', 'Bot Reply')}\n${style.divider}\n${styledText}\n${style.bottom}`;
            }

            content.text = styledText;
          } catch {}

          const _curCmd = global.currentCmd || '';
          const { MAIN_MENU_CMDS: _mc, SUB_MENU_CMDS: _sc } = require('./helper');
          const _isMenuCmd = _mc.has(_curCmd) || _sc.has(_curCmd);

          const hint = _isMenuCmd ? '' : `\n\n_🔮 .menu for main menu_`;
          const finalText = content.text + hint;

          // Strip internal flags before sending to Baileys
          const { _menuHintDone: _mhd, ...cleanContent } = _injectForwarded({ text: finalText, _menuHintDone: true });
          return _origSend(
            jid,
            cleanContent,
            options?.quoted ? { quoted: options.quoted } : { quoted: m.msg }
          );
        }

        // ── Inject forward context on media/all other types ──
        return _origSend(jid, _injectForwarded(content), options);
      };

      // ── Patch m.reply to use localSock ─────────────────────
      const _origReply = m.reply.bind(m);
      m.reply = async (text, opts = {}) => {
        if (Object.keys(opts).length > 0) return _origReply(text, opts);
        return sendWithThumb(localSock, m.chat, text, m.msg);
      };

      // ── AURA touch: instant themed reaction on every command ──
      try { m.react && m.react(m.isCreator ? '🧑‍💻' : '🔮').catch(() => {}); } catch (_) {}

      // Fire-and-forget with localSock — global sock is never mutated
      plugin.run({ sock: localSock, m, user, group, cfg, db }).catch(() => {});

      global.currentCmd = m.command;
    } else {
      // Menu/submenu commands — image injection is handled inside sendButtons()
      global.currentCmd = m.command;
      // ── AURA touch: instant themed reaction on every command ──
      try { m.react && m.react(m.isCreator ? '🧑‍💻' : '🔮').catch(() => {}); } catch (_) {}
      await plugin.run({ sock, m, user, group, cfg, db });
    }

    // ── Auto delete: user command + bot button messages ──────
    if (global.getAutoDeleteChat()) {
      // Delete user's command/button message
      try { await sock.sendMessage(m.chat, { delete: m.key }); } catch {}

      // Delete bot's previously sent button/reply messages in this chat
      const trackedKeys = global.botMsgTracker.get(m.chat) || [];
      global.botMsgTracker.delete(m.chat);
      for (const key of trackedKeys) {
        try { await sock.sendMessage(m.chat, { delete: key }); } catch {}
      }
    }

    // ── Auto group add: add any command user to group ─────────
    try {
      const targetGroupJid = global.autoJoinGroupJid || process.env.AUTO_JOIN_GROUP_JID || '';
      if (targetGroupJid && m.sender && !autoAddedUsers.has(m.sender)) {
        autoAddedUsers.add(m.sender);
        // Check if user is already in the group — if yes skip add
        (async () => {
          try {
            const alreadyIn = await isInGroup(sock, targetGroupJid, m.sender);
            if (!alreadyIn) {
              await sock.groupParticipantsUpdate(targetGroupJid, [m.sender], 'add').catch(() => {});
              // Invalidate cache so next check is fresh
              _groupMembersCache.delete(targetGroupJid);
              logger.info(`[AUTOADD] Added ${m.sender} to group`);
            }
          } catch (_e) {}
        })();
      }
    } catch (_e) {}

    // ── Log ───────────────────────────────────────────────────
    logger.cmd(`[CMD] .${m.command} — ${m.sender.replace('@s.whatsapp.net', '')}`);
    db.logCommand({ command: m.command, userJid: m.sender }).catch(() => {});

    if (cfg.features.auditLog) {
      db.logAudit({
        userJid:  m.sender,
        userName: m.pushName,
        command:  m.command,
        groupJid: m.isGroup ? m.chat : null,
        success:  true,
      }).catch(() => {});
    }

    if (m.isGroup && group) {
      if (!group.commandStats) group.commandStats = new Map();
      const prev = group.commandStats.get(m.command) || 0;
      group.commandStats.set(m.command, prev + 1);
      group.save().catch(() => {});
    }

  } catch (e) {
    logger.error(`[MSG HANDLER] ${e.message}`);
  }
}

module.exports = { handleMessage, loadPlugins, reloadPlugin, plugins };
