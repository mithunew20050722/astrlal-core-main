'use strict';
/**
 * newsletterUtils.js — shared, proven-correct WhatsApp channel (newsletter)
 * follow helpers.
 *
 * BUG FIX (2026-08): chboost.js / boost.js each had their own tiny
 * `safeFollow()` that called `sock.followNewsletter(jid)` directly using
 * whatever JID the channel link parsed to. That's the invite-code-shaped
 * JID (e.g. 0029xxxxx@newsletter), not the real newsletter JID Baileys
 * actually needs for follow (e.g. 120363xxxxx@newsletter) — reacting
 * happens to work with the invite-code JID via newsletterFetchMessages
 * ('direct' mode resolves it internally), which is exactly why boosts
 * were reacting fine but never actually following.
 *
 * dashboard/server.js has always resolved the real JID first via
 * newsletterMetadata() before following, and separately treats Baileys'
 * known "unexpected response structure" parse error (thrown on some
 * accounts even though the follow succeeded on WhatsApp's side) as a
 * success rather than a failure. This module ports that exact,
 * already-proven logic so every follow call-site (chboost.js, boost.js,
 * boostWatcher.js) shares one correct implementation instead of each
 * reinventing (and re-breaking) it.
 */

const FOLLOW_METHODS = ['followNewsletter', 'newsletterFollow', 'newsletterSubscribe', 'followChannel'];

function isExpectedFollowError(message) {
  const msg = (message || '').toLowerCase();
  return (
    msg.includes('unexpected response structure') ||
    msg.includes('unexpected response') ||
    msg.includes('result is not') ||
    msg.includes('cannot read propert') ||
    msg.includes('undefined')
  );
}

// Resolve the real newsletter JID from either an invite code or a
// possibly-wrong JID. Falls back to whatever was passed in if both
// metadata lookups fail — some sessions can still follow with just the
// invite-code JID, so a failed resolve never blocks the follow attempt.
async function resolveChannelJid(sock, jidOrInviteCode) {
  const raw = String(jidOrInviteCode || '').replace('@newsletter', '');
  try {
    const meta = await sock.newsletterMetadata('invite', raw);
    if (meta?.id) return meta.id;
  } catch (_e) {
    try {
      const meta2 = await sock.newsletterMetadata('jid', jidOrInviteCode);
      if (meta2?.id) return meta2.id;
    } catch (_e2) { /* fall through to raw jid below */ }
  }
  return jidOrInviteCode;
}

// Follow a channel on the given sock. Resolves the real JID first, tries
// every known follow method name, and treats Baileys' known
// parse-error-but-actually-succeeded responses as success. Throws only
// if every method genuinely failed.
async function safeFollowChannel(sock, jidOrInviteCode) {
  if (!sock || !jidOrInviteCode) throw new Error('Missing sock or channel JID');
  const realJid = await resolveChannelJid(sock, jidOrInviteCode);

  let lastErr = '';
  for (const method of FOLLOW_METHODS) {
    if (typeof sock[method] !== 'function') continue;
    try {
      await sock[method](realJid);
      return true;
    } catch (e) {
      const msg = e?.message || 'unknown error';
      if (isExpectedFollowError(msg)) return true; // WA-side follow succeeded
      lastErr = msg;
    }
  }
  throw new Error(lastErr || 'No newsletter follow method available on this session');
}

module.exports = { resolveChannelJid, safeFollowChannel, isExpectedFollowError, FOLLOW_METHODS };
