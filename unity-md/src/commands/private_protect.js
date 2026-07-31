'use strict';
/**
 * private_protect.js
 * Exports anticallPending Map and setFeature() used by messageHandler's
 * interactive anticall toggle handler.
 * The actual anticall on/off command lives in extra_protection.js.
 */
const fs   = require('fs');
const path = require('path');

const dataDir = path.join(process.cwd(), 'data');

// ── anticallPending: tracks open "toggle anticall" dialogs ────
// key: chat JID  value: { userId, msgId, ts }
const anticallPending = new Map();

// ── setFeature: persist a boolean feature toggle for a user ───
async function setFeature(user, feature, enabled) {
  try {
    // Save to per-session JSON file (same pattern as extra_protection.js)
    const sessionId = user?.sessionOwner || user?.sessionId || '';
    const fileName  = `${feature}.json`;
    const filePath  = path.join(
      dataDir,
      sessionId ? `${sessionId}_${fileName}` : fileName
    );
    fs.writeFileSync(filePath, JSON.stringify({ enabled }, null, 2));
  } catch (_e) {}
}

module.exports = { anticallPending, setFeature };
