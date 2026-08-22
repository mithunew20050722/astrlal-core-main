'use strict';
/**
 * SL AURA — Boost Job Watcher (main-bot side)
 *
 * chboost.js / boost.js already fan a LOCALLY-triggered boost out across
 * every session THIS install has (owner + sub-sessions), synchronously,
 * the moment someone runs .chboost / .chreact here. That covers "this
 * bot reacts to its own trigger" — it does not cover "this bot reacts
 * to a boost triggered somewhere else" (the other main bot, an
 * @astralcore/aura-wb npm install, the dashboard, or the Telegram
 * management bot). This watcher is what closes that gap: it polls the
 * same shared BoostJob collection everyone else already publishes to,
 * and for any job THIS install didn't create itself, fans it out across
 * every session here too — same as if someone had typed the command
 * locally.
 *
 * Each local WhatsApp number gets its own BoostResult row, keyed
 * "<this install's sessionId>:<number>", so restart-safety and
 * per-number retry work the same way aura-wb's single-session watcher
 * already does, just across possibly several numbers instead of one.
 *
 * Always-on — unlike aura-wb's watcher (gated behind AURA_WB_MODE for
 * npm/yarn installs only), this one starts unconditionally on connect
 * since this bot's own process is always the thing running it.
 */
const cfg = require('../../config');
const db  = require('./index');
const { safeFollowChannel } = require('./newsletterUtils');

const POLL_INTERVAL_MS = 20_000;
const LOOKBACK_MS      = 5 * 60_000; // ignore jobs older than 5 min (already expired/stale)

// BUG FIX (2026-08): always reacted to "the latest post" — fine for
// .chreact (no specific post in mind), but Telegram's /react <link>
// targets one exact post. Without msgId, this could land on an older
// post it already reacted to, if the channel hasn't posted since. Now
// reacts to job.msgId directly when the job carries one.
async function safeReact(sock, jid, emoji, msgId) {
  if (msgId) {
    await sock.newsletterReactMessage(jid, String(msgId), emoji || '❤️');
    return;
  }
  const msgs = await sock.newsletterFetchMessages('direct', jid, 5);
  if (!msgs?.length) throw new Error('No posts to react to');
  await sock.newsletterReactMessage(jid, msgs[0].key.id, emoji || '❤️');
}

async function safeView(sock, jid) {
  const msgs = await sock.newsletterFetchMessages('direct', jid, 5);
  if (!msgs?.length) return;
  await sock.readMessages(msgs.map(m => m.key));
}

// Every local session this install currently has: the owner (read live
// from global.astraSock, refreshed by start.js on every connect/
// reconnect — never captured once and reused stale) plus every
// connected sub-session from sessionManager.
function getLocalTargets() {
  const targets = [];
  const ownerSock = global.astraSock;
  const ownerNum  = (ownerSock?.user?.id || '').split(':')[0];
  if (ownerSock && ownerNum) targets.push({ sock: ownerSock, number: ownerNum });
  try {
    const sm = require('../sessionManager');
    for (const s of sm.getAllSessions()) {
      if (s.status !== 'connected') continue;
      if (s.number === ownerNum) continue; // don't double up the owner
      const live = sm.getSession(s.userId)?.sock;
      if (live) targets.push({ sock: live, number: s.number });
    }
  } catch (_e) {}
  return targets;
}

async function handleJob(job) {
  const targets = getLocalTargets();
  if (!targets.length) return;

  // Which of THIS install's numbers already have a result for this job
  // (restart safety — never double-react/double-follow on re-poll).
  let already = new Set();
  try {
    const mine = await db.BoostResult.find({
      jobId: String(job._id),
      sessionId: new RegExp(`^${cfg.sessionId}:`),
    }).lean();
    already = new Set(mine.map(r => r.sessionId.split(':').slice(1).join(':')));
  } catch (_e) {}

  for (const { sock, number } of targets) {
    if (already.has(number)) continue;
    let success = false;
    try {
      if (job.type === 'react') await safeReact(sock, job.channelJid, job.emoji, job.msgId);
      else if (job.type === 'view') await safeView(sock, job.channelJid);
      else await safeFollowChannel(sock, job.channelJid);
      success = true;
    } catch (_e) {
      success = false;
    }
    try {
      await db.BoostResult.create({
        jobId: String(job._id),
        sessionId: `${cfg.sessionId}:${number}`,
        number,
        success,
      });
    } catch (_e) {
      // unique index (jobId+sessionId) throws if already recorded — expected on re-poll races
    }
    await new Promise(r => setTimeout(r, 800 + Math.floor(Math.random() * 2000)));
  }
}

let timer = null;

function startBoostWatcher() {
  if (timer) return; // already running — getLocalTargets() reads global.astraSock live, so reconnects don't need a restart
  const tick = async () => {
    try {
      const since = new Date(Date.now() - LOOKBACK_MS);
      const jobs = await db.BoostJob.find({ createdAt: { $gte: since } }).lean();
      for (const job of jobs) {
        // Never handle a job THIS install itself created — chboost.js /
        // boost.js already ran the local fan-out synchronously when
        // they published it.
        if (job.createdBy === cfg.sessionId) continue;
        await handleJob(job);
      }
    } catch (_e) {
      // Mongo hiccup or offline — just try again next tick.
    }
  };
  timer = setInterval(tick, POLL_INTERVAL_MS);
  tick(); // run once immediately
}

function stopBoostWatcher() {
  if (timer) { clearInterval(timer); timer = null; }
}

module.exports = { startBoostWatcher, stopBoostWatcher };
