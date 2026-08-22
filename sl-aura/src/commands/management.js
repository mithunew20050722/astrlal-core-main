'use strict';
const { t, getLang  } = require('../lang');
const fs = require('fs');
const path = require('path');
const cfg = require('../../config');
const db = require('./index');
const { sendButtons } = require('./helper');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');

const dataDir = path.join(process.cwd(), 'data');
const warningsPath = path.join(dataDir, 'warnings.json');
const bannedPath = path.join(dataDir, 'banned.json');

function ensureDir() { if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true }); }
function loadWarnings() { ensureDir(); if (!fs.existsSync(warningsPath)) fs.writeFileSync(warningsPath,'{}'); try { return JSON.parse(fs.readFileSync(warningsPath,'utf8')); } catch { return {}; } }
function saveWarnings(w) { ensureDir(); fs.writeFileSync(warningsPath, JSON.stringify(w,null,2)); }
function loadBanned() { ensureDir(); if (!fs.existsSync(bannedPath)) fs.writeFileSync(bannedPath,'[]'); try { return JSON.parse(fs.readFileSync(bannedPath,'utf8')); } catch { return []; } }
function saveBanned(b) { ensureDir(); fs.writeFileSync(bannedPath, JSON.stringify(b,null,2)); }

// chat jid -> { days, candidates: [jid,...], requestedBy, ts } awaiting a
// yes/no reply from .kickinactive before anyone actually gets removed.
const _pendingKickInactive = new Map();
const KICKINACTIVE_CONFIRM_TTL = 2 * 60 * 1000; // 2 minutes

async function getAdminStatus(sock, chat, senderId) {
  try {
    const meta = await sock.groupMetadata(chat);
    const participants = meta.participants || [];
    const botId = sock.user?.id || '';
    const botLid = sock.user?.lid || '';
    const botNum = botId.split('@')[0].split(':')[0];
    const botLidNum = botLid.split('@')[0].split(':')[0];
    const senderNum = senderId.split('@')[0].split(':')[0];
    const isAdminRole = p => p.admin === 'admin' || p.admin === 'superadmin';
    const pNum = p => (p.id || '').split('@')[0].split(':')[0];
    const pLidNum = p => (p.lid || '').split('@')[0].split(':')[0];
    // FIX (2026-07): sock.user?.lid isn't always populated depending on the
    // Baileys version/timing, which made the two @lid-based checks below
    // silently no-op and leave ONLY the direct phone-number match — that
    // fails whenever the group represents the bot's own entry via @lid
    // instead of its phone JID, causing "make me admin" even when the bot
    // already is. The group's own participant list often carries a
    // .phoneNumber field for @lid entries (same field used elsewhere for
    // resolving real numbers), which is a more dependable cross-check.
    const pPhoneNum = p => (p.phoneNumber || '').split('@')[0].replace(/[^0-9]/g, '');
    const isBotAdmin = participants.some(p =>
      isAdminRole(p) && (
        pNum(p) === botNum ||
        (botLidNum && pLidNum(p) && pLidNum(p) === botLidNum) ||
        (botLidNum && pNum(p) === botLidNum) ||
        (pPhoneNum(p) && pPhoneNum(p) === botNum)
      )
    );
    const isSenderAdmin = participants.some(p =>
      isAdminRole(p) && (
        pNum(p) === senderNum ||
        (pLidNum(p) && pLidNum(p) === senderNum) ||
        (pPhoneNum(p) && pPhoneNum(p) === senderNum)
      )
    );
    return { isBotAdmin, isSenderAdmin };
  } catch { return { isBotAdmin: false, isSenderAdmin: false }; }
}

module.exports = {
  commands: [
    'kick', 'remove',
    'promote', 'demote',
    'ban', 'unban',
    'mute', 'unmute',
    'warn', 'warnings', 'resetwarn',
    'tagall', 'everyone', 'tgall',
    'tagnotadmin', 'tgna',
    'tag',
    'del', 'delete',
    'groupinfo', 'ginfo',
    'resetlink', 'newlink',
    'topmembers', 'topmsg',
    'open', 'close',
    'setdesc', 'setsubject', 'setppgc',
    'rules', 'setrules', 'faq', 'setfaq',
    'linkgc', 'revoke',
    'membercount', 'members',
    'kickinactive', 'copygc',
    'setkeyword', 'addkeyword', 'delkeyword',
    'kickinactive_confirm', 'kickinactive_cancel',
    'add',
    'antitag',
  ],

  groupOnly: true,

  async run({ sock, m, db: database }) {
    const lang = await getLang(m.sessionOwner);
    const tr = (key) => t(key, lang); // FIX (2026-07): was undefined — every error-message branch below was silently crashing before this
    const cmd    = m.command;
    const text   = m.text?.trim();
    const chat   = m.chat;
    const msg    = m.msg;
    const sender = m.sender;
    const mentioned = msg?.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
    const repliedParticipant = msg?.message?.extendedTextMessage?.contextInfo?.participant;
    const quotedMessage = msg?.message?.extendedTextMessage?.contextInfo?.quotedMessage;
    const isAdmin = m.isGroupAdmin || m.isOwner;

    if (!m.isGroup) return sendButtons(sock, chat, { text: `👥 *Group only!*\n\n${cfg.footer}`, footer: cfg.footer, buttons: [{ label: '📋 Menu', id: '.menu' }], quoted: msg });

    const { isBotAdmin, isSenderAdmin } = await getAdminStatus(sock, chat, sender);

    // ── KICK ──────────────────────────────────────────────────
    if (cmd === 'kick' || cmd === 'remove') {
      if (!isBotAdmin) return m.reply(`${tr('err_need_admin')}\n\n${cfg.footer}`);
      if (!isSenderAdmin && !m.isOwner) return m.reply(`${tr('err_admins_only')}\n\n${cfg.footer}`);
      const targets = mentioned.length > 0 ? mentioned : (repliedParticipant ? [repliedParticipant] : []);
      if (!targets.length) return sendButtons(sock, chat, { text: `📌 Mention or reply to a user!\n\n${cfg.footer}`, footer: cfg.footer, buttons: [{ label: '📋 Menu', id: '.menu' }], quoted: msg });
      await sock.groupParticipantsUpdate(chat, targets, 'remove');
      return sock.sendMessage(chat, { text: `⚡ *EXILED FROM THE DARK*\n\n${targets.map(t=>`@${t.split('@')[0]}`).join(', ')}\n\n${cfg.footer}`, mentions: targets }, { quoted: msg });
    }

    // ── PROMOTE ───────────────────────────────────────────────
    if (cmd === 'promote') {
      if (!isBotAdmin) return m.reply(`${tr('err_need_admin')}\n\n${cfg.footer}`);
      if (!isSenderAdmin && !m.isOwner) return m.reply(`${tr('err_admins_only')}\n\n${cfg.footer}`);
      const targets = mentioned.length > 0 ? mentioned : (repliedParticipant ? [repliedParticipant] : []);
      if (!targets.length) return m.reply(`📌 Mention or reply to a user!\n\n${cfg.footer}`);
      await sock.groupParticipantsUpdate(chat, targets, 'promote');
      return sock.sendMessage(chat, { text: `👑 *CROWNED BY AURA*\n\n${targets.map(t=>`@${t.split('@')[0]}`).join('\n')}\n\n${cfg.footer}`, mentions: targets }, { quoted: msg });
    }

    // ── DEMOTE ────────────────────────────────────────────────
    if (cmd === 'demote') {
      if (!isBotAdmin) return m.reply(`${tr('err_need_admin')}\n\n${cfg.footer}`);
      if (!isSenderAdmin && !m.isOwner) return m.reply(`${tr('err_admins_only')}\n\n${cfg.footer}`);
      const targets = mentioned.length > 0 ? mentioned : (repliedParticipant ? [repliedParticipant] : []);
      if (!targets.length) return m.reply(`📌 Mention or reply to a user!\n\n${cfg.footer}`);
      await sock.groupParticipantsUpdate(chat, targets, 'demote');
      return sock.sendMessage(chat, { text: `💀 *STRIPPED OF POWER*\n\n${targets.map(t=>`@${t.split('@')[0]}`).join('\n')}\n\n${cfg.footer}`, mentions: targets }, { quoted: msg });
    }

    // ── BAN ───────────────────────────────────────────────────
    if (cmd === 'ban') {
      if (!isBotAdmin) return m.reply(`${tr('err_need_admin')}\n\n${cfg.footer}`);
      if (!isSenderAdmin && !m.isOwner) return m.reply(`${tr('err_admins_only')}\n\n${cfg.footer}`);
      const target = mentioned[0] || repliedParticipant;
      if (!target) return m.reply(`📌 Mention or reply to a user!\n\n${cfg.footer}`);
      const banned = loadBanned();
      if (!banned.includes(target)) { banned.push(target); saveBanned(banned); }
      await sock.groupParticipantsUpdate(chat, [target], 'remove');
      return sock.sendMessage(chat, { text: `⛓️ *BANISHED INTO THE VOID*\n\n@${target.split('@')[0]}\n\n${cfg.footer}`, mentions: [target] }, { quoted: msg });
    }

    // ── UNBAN ─────────────────────────────────────────────────
    if (cmd === 'unban') {
      if (!isSenderAdmin && !m.isOwner) return m.reply(`${tr('err_admins_only')}\n\n${cfg.footer}`);
      const target = mentioned[0] || repliedParticipant;
      if (!target) return m.reply(`📌 Mention or reply to a user!\n\n${cfg.footer}`);
      const banned = loadBanned(); const idx = banned.indexOf(target);
      if (idx > -1) { banned.splice(idx, 1); saveBanned(banned); }
      return m.reply(`🌑 @${target.split('@')[0]} is released from the void.\n\n${cfg.footer}`);
    }

    // ── MUTE ──────────────────────────────────────────────────
    if (cmd === 'mute') {
      if (!isBotAdmin) return m.reply(`${tr('err_need_admin')}\n\n${cfg.footer}`);
      if (!isSenderAdmin && !m.isOwner) return m.reply(`${tr('err_admins_only')}\n\n${cfg.footer}`);
      await sock.groupSettingUpdate(chat, 'announcement');
      const mins = parseInt(text);
      if (!isNaN(mins) && mins > 0) {
        await m.reply(`🔇 *Muted for ${mins} min!*\n\n${cfg.footer}`);
        setTimeout(async () => { try { await sock.groupSettingUpdate(chat, 'not_announcement'); await sock.sendMessage(chat, { text: `🔊 *Auto unmuted!*\n\n${cfg.footer}` }); } catch {} }, mins * 60000);
      } else return m.reply(`🔇 *Group muted!*\n\n${cfg.footer}`);
      return;
    }

    // ── UNMUTE ────────────────────────────────────────────────
    if (cmd === 'unmute') {
      if (!isBotAdmin) return m.reply(`${tr('err_need_admin')}\n\n${cfg.footer}`);
      if (!isSenderAdmin && !m.isOwner) return m.reply(`${tr('err_admins_only')}\n\n${cfg.footer}`);
      await sock.groupSettingUpdate(chat, 'not_announcement');
      return m.reply(`🔊 *Group unmuted!*\n\n${cfg.footer}`);
    }

    // ── WARN ──────────────────────────────────────────────────
    if (cmd === 'warn') {
      if (!isBotAdmin) return m.reply(`${tr('err_need_admin')}\n\n${cfg.footer}`);
      if (!isSenderAdmin && !m.isOwner) return m.reply(`${tr('err_admins_only')}\n\n${cfg.footer}`);
      const target = mentioned[0] || repliedParticipant;
      if (!target) return sendButtons(sock, chat, { text: `📌 Usage: *.warn* @user\n\n${cfg.footer}`, footer: cfg.footer, buttons: [{ label: '📋 Menu', id: '.menu' }], quoted: msg });
      const warnings = loadWarnings();
      if (!warnings[chat]) warnings[chat] = {};
      if (!warnings[chat][target]) warnings[chat][target] = 0;
      warnings[chat][target]++;
      saveWarnings(warnings);
      const count = warnings[chat][target];
      await sock.sendMessage(chat, { text: `🖤 *A MARK FROM AURA*\n\n👁️ @${target.split('@')[0]}\n🖤 Marks: ${count}/3\n👑 Cast by: @${sender.split('@')[0]}\n\n${cfg.footer}`, mentions: [target, sender] }, { quoted: msg });
      if (count >= 3) {
        await sock.groupParticipantsUpdate(chat, [target], 'remove');
        delete warnings[chat][target]; saveWarnings(warnings);
        await sock.sendMessage(chat, { text: `⛓️ @${target.split('@')[0]} — three marks, and the dark casts you out.\n\n${cfg.footer}`, mentions: [target] });
      }
      return;
    }

    // ── WARNINGS ──────────────────────────────────────────────
    if (cmd === 'warnings') {
      const target = mentioned[0] || repliedParticipant;
      if (!target) return m.reply(`📌 Usage: *.warnings* @user\n\n${cfg.footer}`);
      const warnings = loadWarnings();
      return sendButtons(sock, chat, { text: `🖤 *Marks against @${target.split('@')[0]}*\n\n🖤 ${warnings[chat]?.[target]||0}/3\n\n${cfg.footer}`, footer: cfg.footer, buttons: [{ label: '📋 Menu', id: '.menu' }], quoted: msg });
    }

    // ── RESETWARN ─────────────────────────────────────────────
    if (cmd === 'resetwarn') {
      if (!isSenderAdmin && !m.isOwner) return m.reply(`${tr('err_admins_only')}\n\n${cfg.footer}`);
      const target = mentioned[0] || repliedParticipant;
      if (!target) return m.reply(`📌 Usage: *.resetwarn* @user\n\n${cfg.footer}`);
      const warnings = loadWarnings();
      if (warnings[chat]) delete warnings[chat][target];
      saveWarnings(warnings);
      return m.reply(`🌑 The slate is wiped clean for @${target.split('@')[0]}.\n\n${cfg.footer}`);
    }

    // ── TAGALL ────────────────────────────────────────────────
    if (['tagall', 'everyone', 'tgall'].includes(cmd)) {
      if (!isSenderAdmin && !m.isOwner) return m.reply(`${tr('err_admins_only')}\n\n${cfg.footer}`);
      const meta = await sock.groupMetadata(chat);
      let tagText = `🔊 *Hello Everyone!*\n\n`;
      meta.participants.forEach(p => { tagText += `@${p.id.split('@')[0]}\n`; });
      return sock.sendMessage(chat, { text: tagText, mentions: meta.participants.map(p=>p.id) });
    }

    // ── TAGNOTADMIN ───────────────────────────────────────────
    if (cmd === 'tagnotadmin' || cmd === 'tgna') {
      if (!isBotAdmin) return m.reply(`${tr('err_need_admin')}\n\n${cfg.footer}`);
      if (!isSenderAdmin && !m.isOwner) return m.reply(`${tr('err_admins_only')}\n\n${cfg.footer}`);
      const meta = await sock.groupMetadata(chat);
      const nonAdmins = meta.participants.filter(p=>!p.admin).map(p=>p.id);
      if (!nonAdmins.length) return m.reply(`${tr('grp_no_members')}\n\n${cfg.footer}`);
      let tagText2 = `🔊 *Members:*\n\n`;
      nonAdmins.forEach(jid => { tagText2 += `@${jid.split('@')[0]}\n`; });
      return sock.sendMessage(chat, { text: tagText2, mentions: nonAdmins }, { quoted: msg });
    }

    // ── TAG ───────────────────────────────────────────────────
    if (cmd === 'tag') {
      if (!isBotAdmin) return m.reply(`${tr('err_need_admin')}\n\n${cfg.footer}`);
      if (!isSenderAdmin && !m.isOwner) return m.reply(`${tr('err_admins_only')}\n\n${cfg.footer}`);
      const meta = await sock.groupMetadata(chat);
      const mentionedJidList = meta.participants.map(p=>p.id);
      const tagText3 = text || 'Tagged message';
      if (quotedMessage?.imageMessage) {
        const stream = await downloadContentFromMessage(quotedMessage.imageMessage, 'image');
        let buf = Buffer.from([]); for await (const chunk of stream) buf = Buffer.concat([buf, chunk]);
        await sock.sendMessage(chat, { image: buf, caption: tagText3, mentions: mentionedJidList });
      } else if (quotedMessage?.videoMessage) {
        const stream = await downloadContentFromMessage(quotedMessage.videoMessage, 'video');
        let buf = Buffer.from([]); for await (const chunk of stream) buf = Buffer.concat([buf, chunk]);
        await sock.sendMessage(chat, { video: buf, caption: tagText3, mentions: mentionedJidList });
      } else {
        await sock.sendMessage(chat, { text: tagText3, mentions: mentionedJidList });
      }
      return;
    }

    // ── DELETE ────────────────────────────────────────────────
    if (cmd === 'del' || cmd === 'delete') {
      if (!isBotAdmin) return m.reply(`${tr('err_need_admin')}\n\n${cfg.footer}`);
      if (!isSenderAdmin && !m.isOwner) return m.reply(`${tr('err_admins_only')}\n\n${cfg.footer}`);
      const ctxInfo = msg?.message?.extendedTextMessage?.contextInfo;
      if (ctxInfo?.stanzaId) {
        try { await sock.sendMessage(chat, { delete: { remoteJid: chat, fromMe: false, id: ctxInfo.stanzaId, participant: ctxInfo.participant } }); await m.react('✅'); }
        catch { await m.react('❌'); return m.reply(`${tr('err_failed')}\n\n${cfg.footer}`); }
      } else return sendButtons(sock, chat, { text: `📌 Reply to a message with *.del*\n\n${cfg.footer}`, footer: cfg.footer, buttons: [{ label: '📋 Menu', id: '.menu' }], quoted: msg });
      return;
    }

    // ── GROUPINFO ─────────────────────────────────────────────
    if (cmd === 'groupinfo' || cmd === 'ginfo') {
      const meta = await sock.groupMetadata(chat);
      const admins = meta.participants.filter(p=>p.admin);
      const listAdmin = admins.map((v,i)=>`${i+1}. @${v.id.split('@')[0]}`).join('\n');
      let pp; try { pp = await sock.profilePictureUrl(chat, 'image'); } catch { pp = null; }
      const infoText = `┌──「 *AURA'S DOMAIN* 」\n│\n│ 🌑 *Name:* ${meta.subject}\n│ 👥 *Souls here:* ${meta.participants.length}\n│ 👑 *Those who rule:*\n│ ${listAdmin}\n│\n│ 🖤 *Description:*\n│ ${meta.desc?.toString()||'No description'}\n└───────────\n\n${cfg.footer}`;
      if (pp) await sock.sendMessage(chat, { image: { url: pp }, caption: infoText, mentions: admins.map(v=>v.id) }, { quoted: msg });
      else await sock.sendMessage(chat, { text: infoText, mentions: admins.map(v=>v.id) }, { quoted: msg });
      return;
    }

    // ── RESETLINK ─────────────────────────────────────────────
    if (cmd === 'resetlink' || cmd === 'revoke') {
      if (!isBotAdmin) return m.reply(`${tr('err_need_admin')}\n\n${cfg.footer}`);
      if (!isSenderAdmin && !m.isOwner) return m.reply(`${tr('err_admins_only')}\n\n${cfg.footer}`);
      await sock.groupRevokeInvite(chat);
      const code = await sock.groupInviteCode(chat);
      return sendButtons(sock, chat, { text: `🔗 *Link reset!*\n\nhttps://chat.whatsapp.com/${code}\n\n${cfg.footer}`, footer: cfg.footer, buttons: [{ label: '📋 Menu', id: '.menu' }], quoted: msg });
    }

    if (cmd === 'newlink' || cmd === 'linkgc') {
      const code = await sock.groupInviteCode(chat);
      return sendButtons(sock, chat, { text: `🔗 *Group Link*\n\nhttps://chat.whatsapp.com/${code}\n\n${cfg.footer}`, footer: cfg.footer, buttons: [{ label: '📋 Menu', id: '.menu' }], quoted: msg });
    }

    // ── TOPMEMBERS ────────────────────────────────────────────
    if (cmd === 'topmembers' || cmd === 'topmsg') {
      const dataPath = path.join(process.cwd(), 'data', 'messageCount.json');
      let data = {};
      try { if (fs.existsSync(dataPath)) data = JSON.parse(fs.readFileSync(dataPath, 'utf8')); } catch {}
      const groupData = data[chat] || {};
      const sorted = Object.entries(groupData).sort(([,a],[,b])=>b-a).slice(0,10);
      if (!sorted.length) return m.reply(`📊 No message data yet!\n\n${cfg.footer}`);
      let topText = `🔥 *THE INNER CIRCLE*\n\n`;
      sorted.forEach(([jid,count],i) => { const medals=['🥇','🥈','🥉','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣','🔟']; topText += `${medals[i]||`${i+1}.`} @${jid.split('@')[0]} — *${count}* msgs\n`; });
      return sock.sendMessage(chat, { text: topText + `\n${cfg.footer}`, mentions: sorted.map(([jid])=>jid) }, { quoted: msg });
    }

    // ── MEMBERCOUNT ───────────────────────────────────────────
    if (cmd === 'membercount' || cmd === 'members') {
      const meta = await sock.groupMetadata(chat);
      return sendButtons(sock, chat, { text: `👥 *Members:* ${meta.participants.length}\n\n${cfg.footer}`, footer: cfg.footer, buttons: [{ label: '📋 Menu', id: '.menu' }], quoted: msg });
    }

    // ── OPEN/CLOSE ────────────────────────────────────────────
    if (cmd === 'open') {
      if (!isBotAdmin) return m.reply(`${tr('err_need_admin')}\n\n${cfg.footer}`);
      if (!isSenderAdmin && !m.isOwner) return m.reply(`${tr('err_admins_only')}\n\n${cfg.footer}`);
      await sock.groupSettingUpdate(chat, 'not_announcement');
      return m.reply(`${tr('grp_opened2')}\n\n${cfg.footer}`);
    }

    if (cmd === 'close') {
      if (!isBotAdmin) return m.reply(`${tr('err_need_admin')}\n\n${cfg.footer}`);
      if (!isSenderAdmin && !m.isOwner) return m.reply(`${tr('err_admins_only')}\n\n${cfg.footer}`);
      await sock.groupSettingUpdate(chat, 'announcement');
      return m.reply(`${tr('grp_closed2')}\n\n${cfg.footer}`);
    }

    // ── SETDESC ───────────────────────────────────────────────
    if (cmd === 'setdesc') {
      if (!isBotAdmin) return m.reply(`${tr('err_need_admin')}\n\n${cfg.footer}`);
      if (!isSenderAdmin && !m.isOwner) return m.reply(`${tr('err_admins_only')}\n\n${cfg.footer}`);
      if (!text) return m.reply(`📌 Usage: *.setdesc* [description]\n\n${cfg.footer}`);
      await sock.groupUpdateDescription(chat, text);
      return m.reply(`🌑 The domain's story has changed.\n\n${cfg.footer}`);
    }

    // ── SETSUBJECT ────────────────────────────────────────────
    if (cmd === 'setsubject') {
      if (!isBotAdmin) return m.reply(`${tr('err_need_admin')}\n\n${cfg.footer}`);
      if (!isSenderAdmin && !m.isOwner) return m.reply(`${tr('err_admins_only')}\n\n${cfg.footer}`);
      if (!text) return m.reply(`📌 Usage: *.setsubject* [name]\n\n${cfg.footer}`);
      await sock.groupUpdateSubject(chat, text);
      return m.reply(`🖤 A new name echoes through the domain now.\n\n${cfg.footer}`);
    }

    // ── RULES ─────────────────────────────────────────────────
    if (cmd === 'rules' || cmd === 'setrules') {
      const rulesPath = path.join(dataDir, 'rules.json');
      let rules = {};
      try { if (fs.existsSync(rulesPath)) rules = JSON.parse(fs.readFileSync(rulesPath,'utf8')); } catch {}
      if (cmd === 'setrules') {
        if (!isSenderAdmin && !m.isOwner) return m.reply(`${tr('err_admins_only')}\n\n${cfg.footer}`);
        if (!text) return m.reply(`📌 Usage: *.setrules* [rules text]\n\n${cfg.footer}`);
        rules[chat] = text; fs.writeFileSync(rulesPath, JSON.stringify(rules,null,2));
        return m.reply(`⛧ The law is written. No one escapes it.\n\n${cfg.footer}`);
      }
      return sendButtons(sock, chat, { text: `⛧ *AURA'S LAW*\n\n${rules[chat]||'No law has been written yet.'}\n\n${cfg.footer}`, footer: cfg.footer, buttons: [{ label: '📋 Menu', id: '.menu' }], quoted: msg });
    }

    // ── ADD ───────────────────────────────────────────────────
    if (cmd === 'add') {
      if (!isBotAdmin) return m.reply(`${tr('err_need_admin')}\n\n${cfg.footer}`);
      if (!isSenderAdmin && !m.isOwner) return m.reply(`${tr('err_admins_only')}\n\n${cfg.footer}`);
      if (!text) return m.reply(`📌 Usage: *.add* 94771234567\n\nNumber will be added to the group.\n\n${cfg.footer}`);
      // Clean number - remove spaces, +, dashes
      const rawNum = text.replace(/[^0-9]/g, '').trim();
      if (!rawNum || rawNum.length < 7) return m.reply(`💀 That's not a number from this realm. Usage: *.add* 94771234567\n\n${cfg.footer}`);
      const jid = rawNum + '@s.whatsapp.net';
      try {
        const result = await sock.groupParticipantsUpdate(chat, [jid], 'add');
        const status = result?.[0]?.status;
        if (status === '200' || status === 200) {
          return sock.sendMessage(chat, { text: `🖤 *DRAWN INTO THE FOLD*\n\n@${rawNum}\n\n${cfg.footer}`, mentions: [jid] }, { quoted: msg });
        } else if (status === '403') {
          return m.reply(`👁️ @${rawNum} is shielded — can't be pulled into the fold.\n\n${cfg.footer}`);
        } else if (status === '408') {
          return m.reply(`💀 @${rawNum} doesn't exist in this realm.\n\n${cfg.footer}`);
        } else if (status === '409') {
          return m.reply(`🌑 @${rawNum} already walks among us.\n\n${cfg.footer}`);
        } else {
          return m.reply(`⚠️ Cannot add (status: ${status})\n\n${cfg.footer}`);
        }
      } catch (err) {
        return m.reply(`❌ Error: ${err.message}\n\n${cfg.footer}`);
      }
    }

    // ── ANTITAG ───────────────────────────────────────────────
    if (cmd === 'antitag') {
      if (!isSenderAdmin && !m.isOwner) return m.reply(`${tr('err_admins_only')}\n\n${cfg.footer}`);
      const antitagPath = path.join(dataDir, 'antitag.json');
      let state = {};
      try { if (fs.existsSync(antitagPath)) state = JSON.parse(fs.readFileSync(antitagPath, 'utf8')); } catch {}
      const sub = text?.toLowerCase();
      if (!sub || !['on','off','status'].includes(sub)) {
        return m.reply(`📌 *Anti Tag Usage:*\n\n*.antitag on* — Enable\n*.antitag off* — Disable\n*.antitag status* — Current status\n\n⚠️ 5+ mention = warning\n❌ 3rd warning = kick\n\n${cfg.footer}`);
      }
      if (sub === 'status') {
        const on = state[chat]?.enabled || false;
        return m.reply(`🏷️ *Anti Tag:* ${on ? '✅ ON' : '❌ OFF'}\n\n${cfg.footer}`);
      }
      state[chat] = { enabled: sub === 'on' };
      fs.writeFileSync(antitagPath, JSON.stringify(state, null, 2));
      return m.reply(`${sub === 'on' ? '🖤 Anti-Tag ward is active' : '🌑 Anti-Tag ward is down'}\n\n${sub === 'on' ? '5+ mentions summons a mark. 3 marks = exile.' : ''}\n\n${cfg.footer}`);
    }

    // ── SET GROUP PROFILE PICTURE ─────────────────────────────
    if (cmd === 'setppgc') {
      if (!isBotAdmin) return m.reply(`❌ Bot must be admin to change group photo!\n\n${cfg.footer}`);
      if (!isSenderAdmin && !m.isOwner) return m.reply(`❌ Only admins can use this command!\n\n${cfg.footer}`);

      // Get image — either from quoted message or direct image message
      let imgBuf = null;

      const directImg = msg?.message?.imageMessage;
      const quotedImg = msg?.message?.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage;

      if (directImg) {
        const stream = await downloadContentFromMessage(directImg, 'image');
        let buf = Buffer.from([]);
        for await (const chunk of stream) buf = Buffer.concat([buf, chunk]);
        imgBuf = buf;
      } else if (quotedImg) {
        const stream = await downloadContentFromMessage(quotedImg, 'image');
        let buf = Buffer.from([]);
        for await (const chunk of stream) buf = Buffer.concat([buf, chunk]);
        imgBuf = buf;
      }

      if (!imgBuf) {
        return m.reply(`📌 *Usage:*\n\nSend an image with *.setppgc* as caption,\nor reply to an image with *.setppgc*\n\n${cfg.footer}`);
      }

      try {
        await sock.updateProfilePicture(chat, imgBuf);
        await m.react('✅');
        return m.reply(`🌑 *A new face for the domain.*\n\n${cfg.footer}`);
      } catch (err) {
        await m.react('❌');
        return m.reply(`❌ Failed to update group photo!\n\n_${err.message}_\n\n${cfg.footer}`);
      }
    }

    // ── FAQ ───────────────────────────────────────────────────
    if (cmd === 'faq') {
      const group = await db.getGroup(chat);
      const list = group.faq || [];
      if (!list.length) {
        return m.reply(`❓ *No FAQ set yet.*\n\nAn admin can add one:\n*.setfaq* question | answer\n\n${cfg.footer}`);
      }
      if (text && /^\d+$/.test(text.trim())) {
        const item = list[parseInt(text.trim(), 10) - 1];
        if (!item) return m.reply(`❌ No FAQ #${text.trim()}. Send *.faq* to see the list.\n\n${cfg.footer}`);
        return m.reply(`❓ *${item.q}*\n\n${item.a}\n\n${cfg.footer}`);
      }
      const listText = list.map((f, i) => `${i + 1}. ${f.q}`).join('\n');
      return sendButtons(sock, chat, {
        text: `❓ *Frequently Asked Questions*\n\n${listText}\n\n_Reply *.faq <number>* for the answer._\n\n${cfg.footer}`,
        footer: cfg.footer, buttons: [{ label: '📋 Menu', id: '.menu' }], quoted: msg,
      });
    }

    if (cmd === 'setfaq') {
      if (!isSenderAdmin && !m.isOwner) return m.reply(`${tr('err_admins_only')}\n\n${cfg.footer}`);
      const parts = text ? text.split('|') : [];
      const q = parts[0]?.trim();
      const a = parts.slice(1).join('|').trim();
      if (!q || !a) {
        return m.reply(`📌 *Usage:*\n\n*.setfaq* question | answer\n\nExample:\n*.setfaq* What is this group about? | Official support group for XYZ.\n\n${cfg.footer}`);
      }
      const group = await db.getGroup(chat);
      if (typeof group.save !== 'function') return m.reply(`❌ Database unavailable right now — try again shortly.\n\n${cfg.footer}`);
      group.faq = group.faq || [];
      const idx = group.faq.findIndex(f => f.q.toLowerCase() === q.toLowerCase());
      if (idx >= 0) {
        group.faq[idx].a = a;
      } else {
        if (group.faq.length >= 50) return m.reply(`⚠️ Max 50 FAQ entries reached for this group.\n\n${cfg.footer}`);
        group.faq.push({ q, a });
      }
      group.markModified('faq');
      await group.save();
      return m.reply(`✅ *FAQ saved:*\n\n❓ ${q}\n\n${cfg.footer}`);
    }

    // ── KEYWORD AUTO-REPLY ──────────────────────────────────────
    if (cmd === 'setkeyword') {
      if (!isSenderAdmin && !m.isOwner) return m.reply(`${tr('err_admins_only')}\n\n${cfg.footer}`);
      const sub = text?.toLowerCase().trim();
      const group = await db.getGroup(chat);
      if (typeof group.save !== 'function') return m.reply(`❌ Database unavailable right now — try again shortly.\n\n${cfg.footer}`);
      if (sub === 'status') {
        const on = group.settings?.keywordReplyEnabled !== false;
        const count = (group.keywords || []).length;
        return m.reply(`🔑 *Keyword Auto-Reply:* ${on ? '✅ ON' : '❌ OFF'}\n📋 Keywords set: ${count}\n\n${cfg.footer}`);
      }
      if (!['on', 'off'].includes(sub)) {
        return m.reply(`📌 *Usage:*\n\n*.setkeyword on* — Enable keyword auto-reply\n*.setkeyword off* — Disable\n*.setkeyword status* — Current status\n\nManage the actual keywords with *.addkeyword* / *.delkeyword*.\n\n${cfg.footer}`);
      }
      group.settings = group.settings || {};
      group.settings.keywordReplyEnabled = sub === 'on';
      group.markModified('settings');
      await group.save();
      return m.reply(`${sub === 'on' ? '✅ Keyword auto-reply enabled.' : '❌ Keyword auto-reply disabled.'}\n\n${cfg.footer}`);
    }

    if (cmd === 'addkeyword') {
      if (!isSenderAdmin && !m.isOwner) return m.reply(`${tr('err_admins_only')}\n\n${cfg.footer}`);
      const group = await db.getGroup(chat);
      if (typeof group.save !== 'function') return m.reply(`❌ Database unavailable right now — try again shortly.\n\n${cfg.footer}`);
      group.keywords = group.keywords || [];

      // No args → just list what's already set, for convenience.
      if (!text) {
        if (!group.keywords.length) {
          return m.reply(`📌 *Usage:*\n\n*.addkeyword* keyword | reply\n\nExample:\n*.addkeyword* group link | https://chat.whatsapp.com/xxxx\n\n${cfg.footer}`);
        }
        const listText = group.keywords.map((k, i) => `${i + 1}. *${k.trigger}*`).join('\n');
        return m.reply(`🔑 *Keywords set (${group.keywords.length}):*\n\n${listText}\n\n_Remove one with *.delkeyword <number or keyword>*_\n\n${cfg.footer}`);
      }

      const parts = text.split('|');
      const trigger = parts[0]?.trim();
      const reply = parts.slice(1).join('|').trim();
      if (!trigger || !reply) {
        return m.reply(`📌 *Usage:*\n\n*.addkeyword* keyword | reply\n\n${cfg.footer}`);
      }
      const idx = group.keywords.findIndex(k => k.trigger.toLowerCase() === trigger.toLowerCase());
      if (idx >= 0) {
        group.keywords[idx].reply = reply;
      } else {
        if (group.keywords.length >= 50) return m.reply(`⚠️ Max 50 keywords reached for this group.\n\n${cfg.footer}`);
        group.keywords.push({ trigger, reply });
      }
      group.markModified('keywords');
      await group.save();
      return m.reply(
        `✅ *Keyword saved:* "${trigger}"\n\n` +
        `${group.settings?.keywordReplyEnabled === false ? '⚠️ _Keyword auto-reply is currently OFF — turn it on with *.setkeyword on*._\n\n' : ''}` +
        `${cfg.footer}`
      );
    }

    if (cmd === 'delkeyword') {
      if (!isSenderAdmin && !m.isOwner) return m.reply(`${tr('err_admins_only')}\n\n${cfg.footer}`);
      if (!text) return m.reply(`📌 *Usage:*\n\n*.delkeyword <number or keyword>*\n\nSend *.addkeyword* with no text to see the numbered list.\n\n${cfg.footer}`);
      const group = await db.getGroup(chat);
      if (typeof group.save !== 'function') return m.reply(`❌ Database unavailable right now — try again shortly.\n\n${cfg.footer}`);
      group.keywords = group.keywords || [];
      let idx = -1;
      if (/^\d+$/.test(text.trim())) {
        idx = parseInt(text.trim(), 10) - 1;
      } else {
        idx = group.keywords.findIndex(k => k.trigger.toLowerCase() === text.trim().toLowerCase());
      }
      const removed = group.keywords[idx];
      if (!removed) return m.reply(`❌ Keyword not found. Send *.addkeyword* with no text to see the numbered list.\n\n${cfg.footer}`);
      group.keywords.splice(idx, 1);
      group.markModified('keywords');
      await group.save();
      return m.reply(`🗑️ *Removed keyword:* "${removed.trigger}"\n\n${cfg.footer}`);
    }

    // ── KICK INACTIVE MEMBERS ───────────────────────────────────
    // Two-step: show who WOULD be kicked and wait for a Confirm tap.
    // Members with NO recorded activity at all are treated as "unknown",
    // not "inactive" — otherwise the very first run after this feature
    // ships would try to kick the entire group, since nobody has any
    // tracked history yet. Only members we've actually SEEN be inactive
    // past the threshold get flagged.
    if (cmd === 'kickinactive') {
      if (!isBotAdmin) return m.reply(`${tr('err_need_admin')}\n\n${cfg.footer}`);
      if (!isSenderAdmin && !m.isOwner) return m.reply(`${tr('err_admins_only')}\n\n${cfg.footer}`);
      const days = parseInt(text?.trim(), 10);
      if (!days || days < 1) {
        return m.reply(`📌 *Usage:*\n\n*.kickinactive <days>*\n\nExample: *.kickinactive 30* — flags members with no messages in 30+ days.\n\n⚠️ Members never seen sending a message yet are skipped (not enough data), not auto-kicked.\n\n${cfg.footer}`);
      }

      const { lastActivePath, flushLastActive } = require('./groupHandler');
      flushLastActive();
      let lastActive = {};
      try { if (fs.existsSync(lastActivePath)) lastActive = JSON.parse(fs.readFileSync(lastActivePath, 'utf8')); } catch {}
      const groupActivity = lastActive[chat] || {};

      const meta = await sock.groupMetadata(chat);
      const thresholdMs = days * 24 * 60 * 60 * 1000;
      const now = Date.now();
      const botNum = (sock.user?.id || '').split('@')[0].split(':')[0];

      const candidates = meta.participants
        .filter(p => {
          if (p.admin === 'admin' || p.admin === 'superadmin') return false; // never touch admins
          const num = (p.id || '').split('@')[0].split(':')[0];
          if (num === botNum) return false;
          if (p.id === m.sender) return false; // never kick the person who ran the command
          const seen = groupActivity[p.id];
          if (!seen) return false; // no data yet — skip, don't assume inactive
          return (now - seen) >= thresholdMs;
        })
        .map(p => p.id);

      if (!candidates.length) {
        return m.reply(`✅ *No inactive members found* (${days}+ days) with enough tracked activity data yet.\n\n_Note: activity tracking only started recently, so this improves as more messages come in._\n\n${cfg.footer}`);
      }

      _pendingKickInactive.set(chat, { days, candidates, requestedBy: m.sender, ts: Date.now() });
      const preview = candidates.slice(0, 15).map(j => `@${j.split('@')[0]}`).join(', ') + (candidates.length > 15 ? ` +${candidates.length - 15} more` : '');
      return sock.sendMessage(chat, {
        text:
          `⚠️ *Kick Inactive — Confirm*\n\n` +
          `${candidates.length} member(s) inactive for ${days}+ days:\n${preview}\n\n` +
          `Tap *Confirm* to remove them, or *Cancel*. This expires in 2 minutes.`,
        mentions: candidates,
      }, { quoted: msg }).then(() =>
        sendButtons(sock, chat, {
          text: `Confirm removal of ${candidates.length} inactive member(s)?`,
          footer: cfg.footer,
          buttons: [
            { label: '✅ Confirm', id: '.kickinactive_confirm' },
            { label: '❌ Cancel', id: '.kickinactive_cancel' },
          ],
          quoted: msg,
        })
      );
    }

    if (cmd === 'kickinactive_confirm' || cmd === 'kickinactive_cancel') {
      const pending = _pendingKickInactive.get(chat);
      if (!pending || (Date.now() - pending.ts) > KICKINACTIVE_CONFIRM_TTL) {
        _pendingKickInactive.delete(chat);
        return m.reply(`ℹ️ *No pending kick-inactive request* (or it expired). Run *.kickinactive <days>* again.\n\n${cfg.footer}`);
      }
      if (!isSenderAdmin && !m.isOwner) return m.reply(`${tr('err_admins_only')}\n\n${cfg.footer}`);
      _pendingKickInactive.delete(chat);

      if (cmd === 'kickinactive_cancel') {
        return m.reply(`❌ *Cancelled.* No one was removed.\n\n${cfg.footer}`);
      }

      try {
        // Batch-remove to avoid "bad-request" on large groups
        const batchSize = 200;
        let removed = 0;
        let failed = 0;
        for (let i = 0; i < pending.candidates.length; i += batchSize) {
          const batch = pending.candidates.slice(i, i + batchSize);
          try {
            await sock.groupParticipantsUpdate(chat, batch, 'remove');
            removed += batch.length;
          } catch { failed += batch.length; }
        }
        let msg = `✅ *Removed ${removed} inactive member(s).*`;
        if (failed > 0) msg += `\n⚠️ ${failed} failed to remove.`;
        return m.reply(msg + `\n\n${cfg.footer}`);
      } catch (err) {
        return m.reply(`❌ Failed to remove some members: ${err.message}\n\n${cfg.footer}`);
      }
    }

    // ── COPY GROUP TO NEW ────────────────────────────────────────
    // Creates a brand-new group with the same members, name, description,
    // and photo as this one. The bot becomes the new group's owner (that's
    // unavoidable — whoever calls groupCreate is the owner), and the
    // person who ran the command is promoted to admin immediately after.
    if (cmd === 'copygc') {
      if (!isSenderAdmin && !m.isOwner) return m.reply(`${tr('err_admins_only')}\n\n${cfg.footer}`);
      try {
        const meta = await sock.groupMetadata(chat);
        // Bot's own JID (should be phone-based, not LID)
        const botId = sock.user?.id?.replace(/:.*@/, '@') || '';

        // WhatsApp groupCreate requires phone-number JIDs (@s.whatsapp.net),
        // NOT LID JIDs (@lid). Filter participants to only include valid phone JIDs.
        const isPhoneJid = (jid) => jid && jid.endsWith('@s.whatsapp.net');
        const allPhoneJids = meta.participants
          .map(p => p.id)
          .filter(isPhoneJid);

        // Get the sender's phone JID — if sender is LID, try to resolve
        let senderPhoneJid = isPhoneJid(m.sender) ? m.sender : null;
        if (!senderPhoneJid && botId) {
          // If sender is LID, we can't easily resolve it. Try to find their
          // phone JID by checking if they exist in the participant list with
          // a phone JID (some users appear as both LID and phone).
          // Fallback: use bot's JID as the initial participant.
          senderPhoneJid = botId;
        }

        // Filter out bot and sender from the add-list
        const membersToAdd = allPhoneJids.filter(id => id !== botId && id !== senderPhoneJid);

        // WhatsApp group name limit is 100 chars
        const rawName = (text?.trim()) || `${meta.subject} (Copy)`;
        const newName = rawName.length > 100 ? rawName.substring(0, 97) + '...' : rawName;

        await m.reply(`🌀 *Creating new group...* this can take a moment.\n\n${cfg.footer}`);

        // Create group with sender (or bot) first, then batch-add the rest.
        // WhatsApp groupCreate fails with "bad-request" if LID JIDs are passed
        // or if too many participants are passed at once.
        const batchSize = 200;
        let newId;
        try {
          const initialParticipant = senderPhoneJid || botId;
          if (!initialParticipant) {
            throw new Error('Cannot determine valid participant (no phone JID available).');
          }
          const newGroup = await sock.groupCreate(newName, [initialParticipant]);
          newId = newGroup.id || newGroup.gid;
        } catch (e) {
          throw new Error(`Failed to create group: ${e.message}`);
        }

        // Batch-add remaining members
        let addedCount = 0;
        let failedCount = 0;
        for (let i = 0; i < membersToAdd.length; i += batchSize) {
          const batch = membersToAdd.slice(i, i + batchSize);
          try {
            await sock.groupParticipantsUpdate(newId, batch, 'add');
            addedCount += batch.length;
          } catch (e) {
            failedCount += batch.length;
          }
        }

        // Promote sender to admin (if they're not the bot)
        if (senderPhoneJid && senderPhoneJid !== botId) {
          await sock.groupParticipantsUpdate(newId, [senderPhoneJid], 'promote').catch(() => {});
        }

        if (meta.desc) {
          await sock.groupUpdateDescription(newId, meta.desc).catch(() => {});
        }

        try {
          const ppUrl = await sock.profilePictureUrl(chat, 'image');
          if (ppUrl) {
            const axios = require('axios');
            const resp = await axios.get(ppUrl, { responseType: 'arraybuffer', timeout: 15000 });
            await sock.updateProfilePicture(newId, Buffer.from(resp.data)).catch(() => {});
          }
        } catch (_e) { /* no photo on original group — skip silently */ }

        const lidCount = meta.participants.length - allPhoneJids.length;
        let resultMsg =
          `✅ *Group copied!*\n\n` +
          `📛 ${newName}\n` +
          `👥 ${addedCount} members added`;
        if (lidCount > 0) {
          resultMsg += `\n⚠️ ${lidCount} member(s) use linked devices and couldn't be added (WhatsApp limitation)`;
        }
        if (failedCount > 0) {
          resultMsg += `\n⚠️ ${failedCount} members failed to add (privacy settings)`;
        }
        resultMsg += `\n\n_Check your chats — the new group should appear now._\n\n${cfg.footer}`;

        return sock.sendMessage(chat, { text: resultMsg }, { quoted: msg });
      } catch (err) {
        return m.reply(`❌ Failed to copy group: ${err.message}\n\n${cfg.footer}`);
      }
    }
  },
};
