'use strict';

module.exports = {
  commands: ['jid'],

  async run({ sock, m }) {
    const chat   = m.chat;   // remoteJid
    const sender = m.sender; // participant jid

    const isGroup     = chat.endsWith('@g.us');
    const isChannel   = chat.endsWith('@newsletter');
    const isPrivate   = !isGroup && !isChannel;

    let text = '';

    if (isGroup) {
      text =
        `⛧▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬⛧\n` +
        `   👁️ 𝙅𝙄𝘿 𝙄𝙣𝙛𝙤\n` +
        `⛧▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬⛧\n\n` +
        `👥 *Group JID:*\n\`${chat}\`\n\n` +
        `👤 *Sender JID:*\n\`${sender}\`\n\n` +
        `® 𝘼𝙎𝙏𝙍𝘼𝙇 𝘾𝙊𝙍𝙀`;
    } else if (isChannel) {
      text =
        `⛧▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬⛧\n` +
        `   👁️ 𝙅𝙄𝘿 𝙄𝙣𝙛𝙤\n` +
        `⛧▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬⛧\n\n` +
        `📢 *Channel JID:*\n\`${chat}\`\n\n` +
        `® 𝘼𝙎𝙏𝙍𝘼𝙇 𝘾𝙊𝙍𝙀`;
    } else {
      // Private inbox
      text =
        `⛧▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬⛧\n` +
        `   👁️ 𝙅𝙄𝘿 𝙄𝙣𝙛𝙤\n` +
        `⛧▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬⛧\n\n` +
        `👤 *Your JID:*\n\`${sender}\`\n\n` +
        `® 𝘼𝙎𝙏𝙍𝘼𝙇 𝘾𝙊𝙍𝙀`;
    }

    await m.reply(text);
  },
};
