'use strict';
// ── SL-AURA · Extra Group Features ────────────────────────────
// NOTE (2026-07 cleanup): this file previously contained warn/kick/ban/
// promote/demote/mute/tag/del/groupinfo/resetlink/topmembers — all of
// that is already implemented in management.js, so it was removed here
// to avoid duplicate command registration. This file now only owns the
// features that are NOT in management.js.
//
// This file was also found to contain a large block of injected,
// heavily-obfuscated code (unrelated to this bot) mixed with thousands
// of junk proxy IP:port lines. That entire block has been deleted.
// If this codebase was pulled from a shared/leaked source, please
// treat that source as compromised and avoid reusing it.

const cfg = require('../../config');
const { sendButtons } = require('./helper');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');

// ── Helpers ───────────────────────────────────────────────────
async function getAdminStatus(sock, chat, senderId) {
  try {
    const meta = await sock.groupMetadata(chat);
    const participants = meta.participants || [];

    const botId  = sock.user?.id  || '';
    const botNum = botId.split('@')[0].split(':')[0];
    const botLid    = sock.user?.lid || '';
    const botLidNum = botLid.split('@')[0].split(':')[0];
    const senderNum = senderId.split('@')[0].split(':')[0];

    const isAdmin = (p) => p.admin === 'admin' || p.admin === 'superadmin';

    const isBotAdmin = participants.some(p => {
      const pRaw = p.id || '';
      const pNum = pRaw.split('@')[0].split(':')[0];
      const matchesPhone = pNum === botNum;
      const matchesLid   = botLidNum && pRaw.includes('@lid') && pNum === botLidNum;
      return (matchesPhone || matchesLid) && isAdmin(p);
    });

    const isSenderAdmin = participants.some(p => {
      const pNum = (p.id || '').split('@')[0].split(':')[0];
      return pNum === senderNum && isAdmin(p);
    });

    return { isBotAdmin, isSenderAdmin };
  } catch {
    return { isBotAdmin: false, isSenderAdmin: false };
  }
}

async function downloadMediaBuffer(content, mediaType) {
  const stream = await downloadContentFromMessage(content, mediaType);
  let buf = Buffer.from([]);
  for await (const chunk of stream) buf = Buffer.concat([buf, chunk]);
  return buf;
}

function jidToNum(jid) {
  return (jid || '').split('@')[0].split(':')[0];
}

module.exports = {
  commands: [
    'hidetag', 'htag',
    'approve', 'acceptreq',
    'reject', 'rejectreq',
    'viewreq', 'joinrequests',
    'addmember',
    'removeall', 'kickall',
    'kickme', 'leavegroup',
    'setname',
    'setdescription',
    'grouplink', 'glink', 'invitelink', 'link',
    'tagadmin', 'tgadmin',
    'opentime', 'closetime',
    'joingroup', 'joininvite',
    'cloud',
  ],

  adminOnly: false,
  groupOnly: true,

  async run({ sock, m }) {
    const cmd  = m.command;
    const chat = m.chat;
    const msg  = m.msg;
    const senderId = m.sender;
    const text = (m.text || '').trim();
    const mentioned = msg?.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
    const repliedParticipant = msg?.message?.extendedTextMessage?.contextInfo?.participant;
    const quotedMessage = msg?.message?.extendedTextMessage?.contextInfo?.quotedMessage;

    if (!m.isGroup) {
      return sendButtons(sock, chat, {
        text: `🖤 *This ritual only works within a group.*\n\n${cfg.footer}`,
        footer: cfg.footer,
        buttons: [{ label: '📋 Menu', id: '.menu' }],
        quoted: msg,
      });
    }

    const { isBotAdmin, isSenderAdmin } = await getAdminStatus(sock, chat, senderId);
    const targets = mentioned.length > 0 ? mentioned : (repliedParticipant ? [repliedParticipant] : []);

    // ── HIDETAG / HTAG ────────────────────────────────────────
    if (cmd === 'hidetag' || cmd === 'htag') {
      if (!isSenderAdmin && !m.isOwner) return m.reply(`🖤 *Only those who rule this domain may speak here.*\n\n${cfg.footer}`);
      let meta;
      try { meta = await sock.groupMetadata(chat); } catch { return m.reply(`💀 *The domain won't reveal itself.*\n\n${cfg.footer}`); }
      const allJids = meta.participants.map(p => p.id);
      const body = text || '👁️';

      const qType = quotedMessage ? Object.keys(quotedMessage).find(k => k.endsWith('Message')) : null;
      if (quotedMessage && (qType === 'imageMessage' || qType === 'videoMessage')) {
        try {
          const buffer = await downloadMediaBuffer(quotedMessage[qType], qType === 'imageMessage' ? 'image' : 'video');
          const payload = qType === 'imageMessage'
            ? { image: buffer, caption: body, mentions: allJids }
            : { video: buffer, caption: body, mentions: allJids };
          await sock.sendMessage(chat, payload, { quoted: msg });
        } catch {
          await sock.sendMessage(chat, { text: body, mentions: allJids }, { quoted: msg });
        }
      } else {
        await sock.sendMessage(chat, { text: body, mentions: allJids }, { quoted: msg });
      }
      return;
    }

    // ── APPROVE / ACCEPTREQ ───────────────────────────────────
    if (cmd === 'approve' || cmd === 'acceptreq') {
      if (!isBotAdmin) return m.reply(`👁️ *Aura has no power here — make me admin first.*\n\n${cfg.footer}`);
      if (!isSenderAdmin && !m.isOwner) return m.reply(`🖤 *Only those who rule this domain may speak here.*\n\n${cfg.footer}`);
      try {
        const pending = await sock.groupRequestParticipantsList(chat);
        if (!pending || pending.length === 0) return m.reply(`🌑 *No souls wait at the gate.*\n\n${cfg.footer}`);
        const jids = targets.length > 0 ? targets : pending.map(p => p.jid);
        await sock.groupRequestParticipantsUpdate(chat, jids, 'approve');
        return sock.sendMessage(chat, { text: `🌑 *${jids.length} soul(s) let through the gate*\n\n${cfg.footer}`, mentions: jids }, { quoted: msg });
      } catch (e) {
        return m.reply(`❌ Failed to approve: ${e.message}\n\n${cfg.footer}`);
      }
    }

    // ── REJECT / REJECTREQ ────────────────────────────────────
    if (cmd === 'reject' || cmd === 'rejectreq') {
      if (!isBotAdmin) return m.reply(`👁️ *Aura has no power here — make me admin first.*\n\n${cfg.footer}`);
      if (!isSenderAdmin && !m.isOwner) return m.reply(`🖤 *Only those who rule this domain may speak here.*\n\n${cfg.footer}`);
      try {
        const pending = await sock.groupRequestParticipantsList(chat);
        if (!pending || pending.length === 0) return m.reply(`🌑 *No souls wait at the gate.*\n\n${cfg.footer}`);
        const jids = targets.length > 0 ? targets : pending.map(p => p.jid);
        await sock.groupRequestParticipantsUpdate(chat, jids, 'reject');
        return m.reply(`⛓️ *${jids.length} soul(s) turned away at the gate*\n\n${cfg.footer}`);
      } catch (e) {
        return m.reply(`❌ Failed to reject: ${e.message}\n\n${cfg.footer}`);
      }
    }

    // ── VIEWREQ / JOINREQUESTS ────────────────────────────────
    if (cmd === 'viewreq' || cmd === 'joinrequests') {
      if (!isSenderAdmin && !m.isOwner) return m.reply(`🖤 *Only those who rule this domain may speak here.*\n\n${cfg.footer}`);
      try {
        const pending = await sock.groupRequestParticipantsList(chat);
        if (!pending || pending.length === 0) return m.reply(`🌑 *No souls wait at the gate.*\n\n${cfg.footer}`);
        const list = pending.map((p, i) => `${i + 1}. @${jidToNum(p.jid)}`).join('\n');
        return sock.sendMessage(chat, {
          text: `👁️ *Souls waiting at the gate (${pending.length})*\n\n${list}\n\n${cfg.footer}`,
          mentions: pending.map(p => p.jid),
        }, { quoted: msg });
      } catch (e) {
        return m.reply(`❌ Failed to fetch requests: ${e.message}\n\n${cfg.footer}`);
      }
    }

    // ── ADDMEMBER ─────────────────────────────────────────────
    if (cmd === 'addmember') {
      if (!isBotAdmin) return m.reply(`👁️ *Aura has no power here — make me admin first.*\n\n${cfg.footer}`);
      if (!isSenderAdmin && !m.isOwner) return m.reply(`🖤 *Only those who rule this domain may speak here.*\n\n${cfg.footer}`);
      const num = text.replace(/[^0-9]/g, '');
      if (!num) return m.reply(`📌 *Usage:* .addmember 94771234567\n\n${cfg.footer}`);
      const jid = `${num}@s.whatsapp.net`;
      try {
        const res = await sock.groupParticipantsUpdate(chat, [jid], 'add');
        const status = String(res?.[0]?.status || '');
        if (status === '200') return sock.sendMessage(chat, { text: `🖤 *DRAWN IN:* @${num}\n\n${cfg.footer}`, mentions: [jid] }, { quoted: msg });
        if (status === '409') return m.reply(`🌑 *@${num} already walks among us.*\n\n${cfg.footer}`);
        return m.reply(`👁️ *@${num} is shielded or doesn't exist* — privacy settings or an invalid number.\n\n${cfg.footer}`);
      } catch (e) {
        return m.reply(`❌ Failed to add member: ${e.message}\n\n${cfg.footer}`);
      }
    }

    // ── REMOVEALL / KICKALL ───────────────────────────────────
    if (cmd === 'removeall' || cmd === 'kickall') {
      if (!isBotAdmin) return m.reply(`👁️ *Aura has no power here — make me admin first.*\n\n${cfg.footer}`);
      if (!isSenderAdmin && !m.isOwner) return m.reply(`🖤 *Only those who rule this domain may speak here.*\n\n${cfg.footer}`);
      if (text.toLowerCase() !== 'confirm') {
        return m.reply(`⛓️ *This casts EVERY non-admin out of the domain!*\n\nType *.${cmd} confirm* to proceed.\n\n${cfg.footer}`);
      }
      let meta;
      try { meta = await sock.groupMetadata(chat); } catch { return m.reply(`💀 *The domain won't reveal itself.*\n\n${cfg.footer}`); }
      const botId = (sock.user?.id || '').split(':')[0] + '@s.whatsapp.net';
      const toRemove = meta.participants
        .filter(p => p.admin !== 'admin' && p.admin !== 'superadmin' && p.id !== botId)
        .map(p => p.id);
      if (toRemove.length === 0) return m.reply(`🌑 *No one left to banish.*\n\n${cfg.footer}`);
      let removed = 0;
      for (let i = 0; i < toRemove.length; i += 20) {
        const batch = toRemove.slice(i, i + 20);
        try { await sock.groupParticipantsUpdate(chat, batch, 'remove'); removed += batch.length; } catch {}
        await new Promise(r => setTimeout(r, 1500));
      }
      return sock.sendMessage(chat, { text: `⛓️ *${removed} soul(s) cast out of the domain.*\n\n${cfg.footer}` }, { quoted: msg });
    }

    // ── KICKME / LEAVEGROUP (self-removal) ────────────────────
    if (cmd === 'kickme' || cmd === 'leavegroup') {
      if (!isBotAdmin) return m.reply(`👁️ *Aura has no power here — make me admin first.*\n\n${cfg.footer}`);
      try {
        await sock.groupParticipantsUpdate(chat, [senderId], 'remove');
      } catch (e) {
        return m.reply(`❌ Failed to remove you: ${e.message}\n\n${cfg.footer}`);
      }
      return;
    }

    // ── SETNAME ───────────────────────────────────────────────
    if (cmd === 'setname') {
      if (!isBotAdmin) return m.reply(`👁️ *Aura has no power here — make me admin first.*\n\n${cfg.footer}`);
      if (!isSenderAdmin && !m.isOwner) return m.reply(`🖤 *Only those who rule this domain may speak here.*\n\n${cfg.footer}`);
      if (!text) return m.reply(`📌 *Usage:* .setname [new group name]\n\n${cfg.footer}`);
      try {
        await sock.groupUpdateSubject(chat, text);
        return m.reply(`🖤 *A new name echoes now:* ${text}\n\n${cfg.footer}`);
      } catch (e) {
        return m.reply(`❌ Failed to update group name: ${e.message}\n\n${cfg.footer}`);
      }
    }

    // ── SETDESCRIPTION ────────────────────────────────────────
    if (cmd === 'setdescription') {
      if (!isBotAdmin) return m.reply(`👁️ *Aura has no power here — make me admin first.*\n\n${cfg.footer}`);
      if (!isSenderAdmin && !m.isOwner) return m.reply(`🖤 *Only those who rule this domain may speak here.*\n\n${cfg.footer}`);
      if (!text) return m.reply(`📌 *Usage:* .setdescription [new description]\n\n${cfg.footer}`);
      try {
        await sock.groupUpdateDescription(chat, text);
        return m.reply(`🌑 *The domain's story has changed.*\n\n${cfg.footer}`);
      } catch (e) {
        return m.reply(`❌ Failed to update description: ${e.message}\n\n${cfg.footer}`);
      }
    }

    // ── GROUPLINK / GLINK / INVITELINK / LINK ─────────────────
    if (cmd === 'grouplink' || cmd === 'glink' || cmd === 'invitelink' || cmd === 'link') {
      if (!isBotAdmin) return m.reply(`👁️ *Aura has no power here — make me admin first.*\n\n${cfg.footer}`);
      try {
        const code = await sock.groupInviteCode(chat);
        return m.reply(`🌑 *The gate into the domain:*\nhttps://chat.whatsapp.com/${code}\n\n${cfg.footer}`);
      } catch (e) {
        return m.reply(`❌ Failed to get invite link: ${e.message}\n\n${cfg.footer}`);
      }
    }

    // ── TAGADMIN / TGADMIN ────────────────────────────────────
    if (cmd === 'tagadmin' || cmd === 'tgadmin') {
      let meta;
      try { meta = await sock.groupMetadata(chat); } catch { return m.reply(`💀 *The domain won't reveal itself.*\n\n${cfg.footer}`); }
      const admins = meta.participants.filter(p => p.admin === 'admin' || p.admin === 'superadmin').map(p => p.id);
      if (admins.length === 0) return m.reply(`🌑 *No one rules here.*\n\n${cfg.footer}`);
      const body = text || '👁️ *The ones who rule — Aura calls you.*';
      const list = admins.map(a => `@${jidToNum(a)}`).join(' ');
      return sock.sendMessage(chat, { text: `${body}\n\n${list}\n\n${cfg.footer}`, mentions: admins }, { quoted: msg });
    }

    // ── OPENTIME / CLOSETIME ──────────────────────────────────
    if (cmd === 'opentime' || cmd === 'closetime') {
      if (!isBotAdmin) return m.reply(`👁️ *Aura has no power here — make me admin first.*\n\n${cfg.footer}`);
      if (!isSenderAdmin && !m.isOwner) return m.reply(`🖤 *Only those who rule this domain may speak here.*\n\n${cfg.footer}`);
      try {
        if (cmd === 'opentime') {
          await sock.groupSettingUpdate(chat, 'not_announcement');
          return m.reply(`🌑 *The gate is open.* Everyone may speak now.\n\n${cfg.footer}`);
        }
        await sock.groupSettingUpdate(chat, 'announcement');
        return m.reply(`⛓️ *The gate is sealed.* Only those who rule may speak.\n\n${cfg.footer}`);
      } catch (e) {
        return m.reply(`❌ Failed: ${e.message}\n\n${cfg.footer}`);
      }
    }

    // ── JOINGROUP / JOININVITE (bot owner only) ───────────────
    if (cmd === 'joingroup' || cmd === 'joininvite') {
      if (!cfg.isOwnerNumber(senderId) && !m.isOwner) return m.reply(`👁️ *Only Aura's master commands this.*\n\n${cfg.footer}`);
      const match = text.match(/chat\.whatsapp\.com\/([A-Za-z0-9]+)/) || text.match(/^([A-Za-z0-9]{15,})$/);
      if (!match) return m.reply(`📌 *Usage:* .joingroup https://chat.whatsapp.com/XXXXXXXX\n\n${cfg.footer}`);
      try {
        await sock.groupAcceptInvite(match[1]);
        return m.reply(`🌑 *Aura has entered the domain.*\n\n${cfg.footer}`);
      } catch (e) {
        return m.reply(`❌ Failed to join group: ${e.message}\n\n${cfg.footer}`);
      }
    }

    // ── CLOUD (ghost message) ─────────────────────────────────
    if (cmd === 'cloud') {
      try { await sock.sendMessage(chat, { delete: msg.key }); } catch {}
      return sock.sendMessage(chat, { text: `🌑 *Gone.* Your words dissolve into the dark ☁️\n\n${cfg.footer}` });
    }
  },
};
