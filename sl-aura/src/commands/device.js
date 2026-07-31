'use strict';
// Manual override for the auto-asked device preference (see helper.js
// askDeviceOnce()/getDevicePreference()/setDevicePreference() — every
// button-message footer points users here so a wrong/changed answer is
// easy to fix without waiting to be asked again.
const cfg = require('../../config');
const { setDevicePreference } = require('./helper');

module.exports = {
  commands: ['device', 'setdevice'],
  adminOnly: false,
  groupOnly: false,

  async run({ sock, m }) {
    const jid = m.chat;
    const arg = (m.text || '').trim().toLowerCase();

    if (!arg) {
      return m.reply(
        `📱 *Device Preference*\n\n` +
        `Menu/button messages ටික ඔයාගේ ෆෝන් එකට ගැලපෙන විදිහට එවනවා.\n\n` +
        `*.device iphone* — plain text menus\n` +
        `*.device android* — native buttons\n\n` +
        `${cfg.footer}`
      );
    }

    let device = null;
    if (arg.includes('iphone') || arg === 'ios' || arg === '1') device = 'iphone';
    else if (arg.includes('android') || arg === '2') device = 'android';
    else return m.reply(`❌ *.device iphone* හෝ *.device android* කියලා type කරන්න.\n\n${cfg.footer}`);

    await setDevicePreference(jid, device);

    return m.reply(`✅ *Device set to ${device === 'iphone' ? '📱 iPhone' : '🤖 Android'}!*\n\n${cfg.footer}`);
  },
};
