'use strict';
const { getT } = require('../lang');
const cfg = require('../../config');
const db = require('./index');

module.exports = {
  commands: [
    'chpost', 'channelpost',
    'chaudio', 'chvideo',
    'chschedule', 'channelschedule',
    'chdel', 'channeldel',
    'chstats', 'channelstats',
    'chdesc', 'channeldesc',
    'chname', 'channelname',
    'chlist', 'channellist',
    'chpromo', 'channelpromo',
    'setmychannel',
    // New from 5993-95 bot
    'chr', 'creact',
    'cid',
  ],

  async run({ sock, m }) {
    const tr = await getT(m.sessionOwner);
    const cmd  = m.command;
    const text = m.text?.trim();
    const sender = m.sender;

    // ── Get target channel ────────────────────────────────────
    const getChannel = async () => {
      if (m.isOwner) return cfg.channel1 || null;
      const user = await db.getUser(sender);
      return user.channelJid || null;
    };

    // ── Set personal channel (owner sets for user) ────────────
    if (cmd === 'setmychannel') {
      if (!m.isOwner) return m.reply(`${tr('err_owner_only2')}\n\n${cfg.footer}`);
      const args = text?.split(' ');
      if (!args || args.length < 2) return m.reply(
        `📌 Usage: *.setmychannel* [number] [channelJID]\n\n${cfg.footer}`
      );
      const targetJid = args[0].replace(/[^0-9]/g, '') + '@s.whatsapp.net';
      const channelJid = args[1];
      await db.User.updateOne(
        { jid: targetJid },
        { $set: { channelJid } },
        { upsert: true }
      );
      return m.reply(
        `✅ *Channel set!*\n\n` +
        `👤 User: +${args[0]}\n` +
        `📢 Channel: ${channelJid}\n\n` +
        `${cfg.footer}`
      );
    }

    // ── Get channel ───────────────────────────────────────────
    const channelJid = await getChannel();
    if (!channelJid) {
      return m.reply(
        `❌ *No channel configured!*\n\n` +
        `${m.isOwner
          ? 'Set CHANNEL_JID_1 in config.env'
          : 'Contact owner to assign your channel'}\n\n` +
        `${cfg.footer}`
      );
    }

    // ── Post text to channel ──────────────────────────────────
    if (cmd === 'chpost' || cmd === 'channelpost') {
      if (!text) return m.reply(
        `📌 Usage: *.chpost* [message]\n\n${cfg.footer}`
      );
      await m.react('⏳');
      try {
        await sock.sendMessage(channelJid, { text });
        await m.react('✅');
        return m.reply(`✅ *Posted to channel!*\n\n${cfg.footer}`);
      } catch (e) {
        await m.react('❌');
        return m.reply(`❌ Failed: ${e.message}\n\n${cfg.footer}`);
      }
    }

    // ── Post video to channel ─────────────────────────────────
    if (cmd === 'chvideo') {
      const vid = m.quoted?.message?.videoMessage || m.message?.videoMessage;
      if (!vid) return m.reply(
        `📌 Send/reply video with *.chvideo* [caption]\n\n${cfg.footer}`
      );
      await m.react('⏳');
      try {
        const buf = await sock.downloadMediaMessage(
          vid === m.message?.videoMessage
            ? m.msg
            : { message: m.quoted.message, key: m.quoted.key }
        );
        await sock.sendMessage(channelJid, {
          video: buf,
          caption: text || '',
        });
        await m.react('✅');
        return m.reply(`✅ *Video posted to channel!*\n\n${cfg.footer}`);
      } catch (e) {
        await m.react('❌');
        return m.reply(`❌ Failed: ${e.message}\n\n${cfg.footer}`);
      }
    }

    // ── Post song as voice note to channel ────────────────────
    if (cmd === 'chaudio') {
      const audio = m.quoted?.message?.audioMessage || m.message?.audioMessage;
      if (!audio && !text) return m.reply(
        `📌 Usage: *.chaudio* or reply audio\n\n${cfg.footer}`
      );
      await m.react('⏳');
      try {
        if (audio) {
          const buf = await sock.downloadMediaMessage(
            audio === m.message?.audioMessage
              ? m.msg
              : { message: m.quoted.message, key: m.quoted.key }
          );
          await sock.sendMessage(channelJid, {
            audio: buf,
            mimetype: 'audio/mp4',
            ptt: false,
          });
        } else {
          // Search and post song
          const yts = require('yt-search');
          const ytdl = require('ytdl-core');
          const fs = require('fs-extra');
          const { tmpFile } = require('./helper');

          const r = await yts(text);
          if (!r?.videos?.[0]) throw new Error('Song not found');
          const url = r.videos[0].url;
          const info = await ytdl.getInfo(url);
          const title = info.videoDetails.title;
          const filePath = tmpFile('mp3');

          await new Promise((resolve, reject) => {
            ytdl(url, { filter: 'audioonly', quality: 'highestaudio' })
              .pipe(fs.createWriteStream(filePath))
              .on('finish', resolve)
              .on('error', reject);
          });

          const buf = await fs.readFile(filePath);
          await fs.remove(filePath);

          await sock.sendMessage(channelJid, {
            audio: buf,
            mimetype: 'audio/mpeg',
            fileName: `${title}.mp3`,
            ptt: false,
          });
        }
        await m.react('✅');
        return m.reply(`✅ *Audio posted to channel!*\n\n${cfg.footer}`);
      } catch (e) {
        await m.react('❌');
        return m.reply(`❌ Failed: ${e.message}\n\n${cfg.footer}`);
      }
    }

    // ── Schedule channel post ─────────────────────────────────
    if (cmd === 'chschedule' || cmd === 'channelschedule') {
      if (!text) return m.reply(
        `📌 Usage: *.chschedule* [minutes] | [message]\n` +
        `Example: *.chschedule* 30 | Hello channel!\n\n` +
        `${cfg.footer}`
      );
      const parts = text.split('|');
      if (parts.length < 2) return m.reply(
        `📌 Format: *.chschedule* [minutes] | [message]\n\n${cfg.footer}`
      );
      const mins = parseInt(parts[0].trim());
      const msg  = parts.slice(1).join('|').trim();
      if (isNaN(mins) || mins < 1) return m.reply(
        `❌ Invalid time.\n\n${cfg.footer}`
      );

      const sendAt = new Date(Date.now() + mins * 60 * 1000);
      await db.Schedule.create({
        chatJid:   channelJid,
        message:   msg,
        sendAt,
        createdBy: sender,
      });

      return m.reply(
        `✅ *Channel post scheduled!*\n\n` +
        `⏰ In: ${mins} minute(s)\n` +
        `💬 Message: ${msg.slice(0, 50)}${msg.length > 50 ? '...' : ''}\n\n` +
        `${cfg.footer}`
      );
    }

    // ── Promo post (auto-delete after time) ───────────────────
    if (cmd === 'chpromo' || cmd === 'channelpromo') {
      if (!text) return m.reply(
        `📌 Usage: *.chpromo* [minutes] | [message]\n` +
        `Example: *.chpromo* 60 | Check this out!\n\n` +
        `${cfg.footer}`
      );
      const parts = text.split('|');
      if (parts.length < 2) return m.reply(
        `📌 Format: *.chpromo* [minutes] | [message]\n\n${cfg.footer}`
      );
      const mins = parseInt(parts[0].trim());
      const msg  = parts.slice(1).join('|').trim();
      if (isNaN(mins) || mins < 1) return m.reply(
        `❌ Invalid time.\n\n${cfg.footer}`
      );

      await m.react('⏳');
      try {
        // Post to channel
        const sent = await sock.sendMessage(channelJid, { text: msg });
        await m.react('✅');
        await m.reply(
          `✅ *Promo posted!*\n\n` +
          `🗑️ Auto-deletes in ${mins} minute(s)\n\n` +
          `${cfg.footer}`
        );

        // Auto delete after time
        setTimeout(async () => {
          if (sent?.key) {
            await sock.sendMessage(channelJid, {
              delete: sent.key
            }).catch(() => {});
          }
        }, mins * 60 * 1000);

      } catch (e) {
        await m.react('❌');
        return m.reply(`❌ Failed: ${e.message}\n\n${cfg.footer}`);
      }
    }

    // ── Channel description ───────────────────────────────────
    if (cmd === 'chdesc' || cmd === 'channeldesc') {
      if (!text) return m.reply(
        `📌 Usage: *.chdesc* [description]\n\n${cfg.footer}`
      );
      await m.react('⏳');
      try {
        await sock.newsletterUpdateDescription(channelJid, text);
        await m.react('✅');
        return m.reply(`${tr('chan_desc_updated')}\n\n${cfg.footer}`);
      } catch (e) {
        await m.react('❌');
        return m.reply(`❌ Failed: ${e.message}\n\n${cfg.footer}`);
      }
    }

    // ── Channel name ──────────────────────────────────────────
    if (cmd === 'chname' || cmd === 'channelname') {
      if (!text) return m.reply(
        `📌 Usage: *.chname* [name]\n\n${cfg.footer}`
      );
      await m.react('⏳');
      try {
        await sock.newsletterUpdateName(channelJid, text);
        await m.react('✅');
        return m.reply(`✅ *Channel name updated!*\n\n${cfg.footer}`);
      } catch (e) {
        await m.react('❌');
        return m.reply(`❌ Failed: ${e.message}\n\n${cfg.footer}`);
      }
    }

    // ── Channel stats ─────────────────────────────────────────
    if (cmd === 'chstats' || cmd === 'channelstats') {
      await m.react('⏳');
      try {
        const meta = await sock.newsletterMetadata('jid', channelJid);
        await m.react('✅');
        return m.reply(
          `📊 *AURA Channel Stats*\n\n` +
          `📛 Name: ${meta.name || 'N/A'}\n` +
          `👥 Subscribers: ${meta.subscribers || 'N/A'}\n` +
          `📝 Description: ${meta.description?.slice(0, 100) || 'N/A'}\n` +
          `🔗 JID: ${channelJid}\n\n` +
          `${cfg.footer}`
        );
      } catch (e) {
        await m.react('❌');
        return m.reply(`❌ Failed: ${e.message}\n\n${cfg.footer}`);
      }
    }

    // ── List scheduled posts ──────────────────────────────────
    if (cmd === 'chlist' || cmd === 'channellist') {
      const scheduled = await db.Schedule.find({
        chatJid: channelJid,
        active: true,
      }).sort({ sendAt: 1 }).limit(10);

      if (!scheduled.length) return m.reply(
        `📋 *No scheduled posts.*\n\n${cfg.footer}`
      );

      const list = scheduled.map((s, i) => {
        const timeLeft = Math.ceil((s.sendAt - Date.now()) / 60000);
        return `${i + 1}. "${s.message.slice(0, 30)}..." — in ${timeLeft}min`;
      }).join('\n');

      return m.reply(
        `📋 *Scheduled Posts (${scheduled.length}):*\n\n` +
        `${list}\n\n` +
        `${cfg.footer}`
      );
    }

    // ── Channel React (chr) ───────────────────────────────────
    if (cmd === 'chr' || cmd === 'creact') {
      if (!m.isOwner) return m.reply(`${tr('err_owner_only2')}\n\n${cfg.footer}`);
      if (!text) return m.reply(
        `📌 Usage: *.chr* [channel-link] [text]\nExample: *.chr* https://whatsapp.com/channel/xxx hello\n\n${cfg.footer}`
      );

      const stylizedChars = {
        a:'🅐',b:'🅑',c:'🅒',d:'🅓',e:'🅔',f:'🅕',g:'🅖',h:'🅗',i:'🅘',j:'🅙',k:'🅚',l:'🅛',m:'🅜',
        n:'🅝',o:'🅞',p:'🅟',q:'🅠',r:'🅡',s:'🅢',t:'🅣',u:'🅤',v:'🅥',w:'🅦',x:'🅧',y:'🅨',z:'🅩',
        '0':'⓿','1':'➊','2':'➋','3':'➌','4':'➍','5':'➎','6':'➏','7':'➐','8':'➑','9':'➒',
      };

      const parts = text.split(' ');
      const link = parts[0];
      const inputText = parts.slice(1).join(' ').toLowerCase();

      if (!link.includes('whatsapp.com/channel/'))
        return m.reply(`❌ Invalid channel link!\n\n${cfg.footer}`);
      if (!inputText)
        return m.reply(`📌 Please provide text after the channel link.\n\n${cfg.footer}`);

      const emoji = inputText.split('').map(c => c === ' ' ? '―' : (stylizedChars[c] || c)).join('');
      const channelId  = link.split('/')[4];
      const messageId  = link.split('/')[5];

      if (!channelId || !messageId)
        return m.reply(`❌ Invalid link — missing channel/message ID.\n\n${cfg.footer}`);

      try {
        const channelMeta = await sock.newsletterMetadata('invite', channelId);
        await sock.newsletterReactMessage(channelMeta.id, messageId, emoji);
        return m.reply(
          `✅ *Reaction Sent!*\n\n` +
          `📢 *Channel:* ${channelMeta.name}\n` +
          `💬 *Reaction:* ${emoji}\n\n` +
          `${cfg.footer}`
        );
      } catch (e) {
        return m.reply(`❌ Failed: ${e.message}\n\n${cfg.footer}`);
      }
    }

    // ── Channel Info by Link (cid) ────────────────────────────
    if (cmd === 'cid') {
      if (!text) return m.reply(
        `📌 Usage: *.cid* [channel-link]\nExample: *.cid* https://whatsapp.com/channel/xxx\n\n${cfg.footer}`
      );

      const match = text.match(/whatsapp\.com\/channel\/([\w-]+)/);
      if (!match) return m.reply(`⚠️ *Invalid channel link.*\n\nFormat: https://whatsapp.com/channel/xxxxxxxx\n\n${cfg.footer}`);

      try {
        const meta = await sock.newsletterMetadata('invite', match[1]);
        if (!meta?.id) return m.reply(`${tr('chan_not_found')}\n\n${cfg.footer}`);

        const info =
          `📢 *AURA Channel Info*\n━━━━━━━━━━━━━━━━━━━━━\n` +
          `🆔 *ID:* ${meta.id}\n` +
          `📌 *Name:* ${meta.name}\n` +
          `👥 *Followers:* ${meta.subscribers?.toLocaleString() || 'N/A'}\n` +
          `📅 *Created:* ${meta.creation_time ? new Date(meta.creation_time * 1000).toLocaleString() : 'Unknown'}\n\n` +
          `${cfg.footer}`;

        if (meta.preview) {
          await sock.sendMessage(m.chat, {
            image: { url: `https://pps.whatsapp.net${meta.preview}` },
            caption: info,
          }, { quoted: m.msg });
        } else {
          await m.reply(info);
        }
      } catch (e) {
        return m.reply(`❌ Failed: ${e.message}\n\n${cfg.footer}`);
      }
    }
  },
};