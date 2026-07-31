'use strict';
const db = require('./index');

// ── AURA-exclusive: daily mystic reading + coin/xp reward ─────
const READINGS = [
  { tag: '🔮 Fortune',   text: 'The stars align in your favor today. A bold move pays off.' },
  { tag: '🌙 Guidance',  text: 'Patience is your ally now. Wait before you send that message.' },
  { tag: '⚡ Warning',   text: 'Someone is testing your patience. Stay calm, stay sharp.' },
  { tag: '✨ Blessing',  text: 'Good luck follows you into every group chat today.' },
  { tag: '🌊 Reflection',text: 'Look back before moving forward — an old lead resurfaces.' },
  { tag: '🔥 Energy',    text: 'Your energy is magnetic today. People notice you more.' },
  { tag: '🌌 Mystery',   text: 'Something unexpected arrives before midnight.' },
];

const COLORS = ['Violet', 'Gold', 'Magenta', 'Amber', 'Rose'];

function todaySeed(jid) {
  const d = new Date();
  const dayKey = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  let hash = 0;
  const str = jid + dayKey;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  }
  return hash;
}

module.exports = {
  commands: ['aura', 'aurareading', 'fortune'],

  async run({ sock, m }) {
    const sender = m.sender;
    const user = await db.getUser(sender);

    const seed = todaySeed(sender);
    const reading = READINGS[seed % READINGS.length];
    const color = COLORS[seed % COLORS.length];
    const luck = 10 + (seed % 90); // 10–99

    const lastAuraKey = 'lastAuraReading';
    const lastDate = user[lastAuraKey]
      ? new Date(user[lastAuraKey]).toDateString()
      : null;
    const today = new Date().toDateString();
    const alreadyClaimed = lastDate === today;

    let reward = '';
    if (!alreadyClaimed) {
      const coinsGain = 15 + (seed % 20);
      const xpGain = 5 + (seed % 10);
      try {
        await db.User.updateOne(
          { jid: sender },
          {
            $inc: { coins: coinsGain, xp: xpGain },
            $set: { [lastAuraKey]: new Date() },
          }
        );
      } catch (e) {
        // fail silently, still show the reading
      }
      reward = `\n💰 +${coinsGain} coins  ⭐ +${xpGain} xp`;
    } else {
      reward = `\n_(already claimed today's reading — come back tomorrow)_`;
    }

    const text =
      `╭─────────────────╮\n` +
      `   🌌 *SL AURA READING* 🌌\n` +
      `╰─────────────────╯\n\n` +
      `${reading.tag}\n` +
      `_${reading.text}_\n\n` +
      `🎨 Your Aura Color: *${color}*\n` +
      `🍀 Luck Meter: *${luck}%*` +
      reward +
      `\n\n® 𝙎𝙇 𝘼𝙐𝙍𝘼`;

    await m.reply(text);
  },
};
