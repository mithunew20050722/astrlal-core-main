'use strict';
const { getT } = require('../lang');
const cfg = require('../../config');
const db = require('./index');
const { formatDuration } = require('./helper');

// ── Format JID for display (privacy) ─────────────────────────
function formatJid(jid) {
  const clean = jid
    .replace('@s.whatsapp.net', '')
    .replace('@lid', '')
    .replace(/[^0-9]/g, '');
  if (clean.length > 6) {
    return `+${clean.slice(0, 4)}****${clean.slice(-3)}`;
  }
  return `+${clean}`;
}

module.exports = {
  commands: [
    'mystats', 'rank', 'leaderboard',
    'topcmds', 'botstats', 'botinfo', 'groupstats',
  ],

  async run({ sock, m }) {
    const tr = await getT(m.sessionOwner);
    const cmd    = m.command;
    const chat   = m.chat;
    const sender = m.sender;

    // ── My stats ──────────────────────────────────────────────
    if (cmd === 'mystats') {
      const user = await db.getUser(sender);
      const joined  = new Date(user.createdAt)
        .toLocaleDateString('en-LK', { timeZone: cfg.timezone });
      const lastCmd = user.lastCommand
        ? new Date(user.lastCommand)
            .toLocaleString('en-LK', { timeZone: cfg.timezone })
        : 'Never';
      return m.reply(
        `📊 *My Stats*\n\n` +
        `👤 Number: ${formatJid(sender)}\n` +
        `📅 Joined: ${joined}\n` +
        `⚡ Commands: ${user.totalCommands || 0}\n` +
        `⚠️ Warns: ${user.warns || 0}/${cfg.limits.warnLimit}\n` +
        `💰 Coins: ${user.coins || 0}\n` +
        `🏆 Level: ${user.level || 1}\n` +
        `⭐ XP: ${user.xp || 0}\n` +
        `🔥 Streak: ${user.streak || 0} days\n` +
        `🕐 Last Command: ${lastCmd}\n\n` +
        `${cfg.footer}`
      );
    }

    // ── Rank ──────────────────────────────────────────────────
    if (cmd === 'rank') {
      const top = await db.User
        .find({ totalCommands: { $gt: 0 } })
        .sort({ totalCommands: -1 })
        .limit(10)
        .lean();
      if (!top.length) return m.reply(`${tr('stats_no_rank')}\n\n${cfg.footer}`);
      const myRank = top.findIndex(u => u.jid === sender) + 1;
      const list = top.map((u, i) => {
        const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
        const you = u.jid === sender ? ' ← You' : '';
        return `${medal} ${formatJid(u.jid)} — ${u.totalCommands} cmds${you}`;
      }).join('\n');
      return m.reply(
        `🏆 *Top 10 Users*\n\n${list}\n\n` +
        `${myRank > 0 ? `📍 Your rank: #${myRank}` : '📍 Not ranked yet'}\n\n` +
        `${cfg.footer}`
      );
    }

    // ── Leaderboard ───────────────────────────────────────────
    if (cmd === 'leaderboard') {
      const top = await db.User
        .find({ coins: { $gt: 0 } })
        .sort({ coins: -1 })
        .limit(10)
        .lean();
      if (!top.length) return m.reply(`${tr('stats_no_coins')}\n\n${cfg.footer}`);
      const list = top.map((u, i) => {
        const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
        return `${medal} ${formatJid(u.jid)} — 💰 ${u.coins}`;
      }).join('\n');
      return m.reply(`💰 *Coin Leaderboard*\n\n${list}\n\n${cfg.footer}`);
    }

    // ── Top commands ──────────────────────────────────────────
    if (cmd === 'topcmds') {
      const stats = await db.getStats(1);
      const today = stats[0];
      if (!today?.topCommands) return m.reply(`📊 *No data yet.*\n\n${cfg.footer}`);
      const sorted = Object.entries(today.topCommands)
        .sort(([,a],[,b]) => b - a)
        .slice(0, 10);
      const list = sorted.map(([c, n], i) => `${i + 1}. *.${c}* — ${n} times`).join('\n');
      return m.reply(
        `⚡ *Top Commands Today*\n\n${list}\n\n📅 ${today.date}\n\n${cfg.footer}`
      );
    }

    // ── Bot stats ─────────────────────────────────────────────
    if (cmd === 'botstats' || cmd === 'botinfo') {
      const stats  = await db.getStats(7);
      const totalCmds = stats.reduce((s, d) => s + (d.totalCommands || 0), 0);
      const totalUsers  = await db.User.countDocuments();
      const totalGroups = await db.Group.countDocuments();
      const { plugins } = require('./messageHandler');
      const uptime = formatDuration(process.uptime());
      const mem = (process.memoryUsage().rss / 1024 / 1024).toFixed(1);
      return m.reply(
        `🧲 *SL AURA Stats*\n\n` +
        `⏱️ Uptime: ${uptime}\n` +
        `💾 RAM: ${mem} MB\n` +
        `📦 Commands: ${plugins.size}+\n` +
        `👥 Users: ${totalUsers}\n` +
        `👥 Groups: ${totalGroups}\n` +
        `⚡ Cmds (7 days): ${totalCmds}\n\n` +
        `${cfg.footer}`
      );
    }

    // ── Group stats ───────────────────────────────────────────
    if (cmd === 'groupstats') {
      if (!m.isGroup) return m.reply(`${tr('err_group_only2')}\n\n${cfg.footer}`);
      const meta  = await sock.groupMetadata(chat);
      const group = await db.getGroup(chat);
      const admins = meta.participants.filter(p => p.admin);
      const cmdStats = group.commandStats
        ? Object.entries(group.commandStats)
            .sort(([,a],[,b]) => b - a)
            .slice(0, 5)
        : [];
      const topCmds = cmdStats.length
        ? cmdStats.map(([c,n], i) => `${i + 1}. .${c} — ${n}x`).join('\n')
        : 'No data yet';
      return m.reply(
        `📊 *Group Stats*\n\n` +
        `📛 Name: ${meta.subject}\n` +
        `👥 Members: ${meta.participants.length}\n` +
        `👑 Admins: ${admins.length}\n` +
        `🛡️ Spam: ${group.settings?.antiSpam ? '✅' : '❌'} | ` +
        `Link: ${group.settings?.antiLink ? '✅' : '❌'}\n\n` +
        `⚡ *Top Commands:*\n${topCmds}\n\n` +
        `${cfg.footer}`
      );
    }
  },
};