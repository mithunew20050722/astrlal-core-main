'use strict';
/**
 * UNITY-MD — Boost Job Watcher
 *
 * SL AURA's dashboard (or any peer sharing the same MongoDB) publishes a
 * BoostJob when a channel boost is triggered. This bot is a separate
 * process, so it polls for jobs instead of being told directly — and
 * when it finds one, EVERY one of its own connected sub-sessions
 * (paired via .pair / the control panel) joins in, not just one number.
 *
 * Each sub-session's result is recorded as its own BoostResult (unique
 * per jobId + sessionId), so a restart or an overlapping poll never
 * double-counts the same sub-session against the same job.
 */
const cfg = require('../../config');
const db  = require('./index');

const POLL_INTERVAL_MS = 20_000;
const LOOKBACK_MS      = 5 * 60_000; // ignore jobs older than 5 min
const PER_SESSION_DELAY_MS = 300;

async function safeFollow(sock, jid) {
  const methods = ['followNewsletter', 'newsletterFollow', 'newsletterSubscribe', 'followChannel'];
  for (const method of methods) {
    if (typeof sock[method] === 'function') { await sock[method](jid); return; }
  }
  throw new Error('No newsletter follow method available');
}

async function safeReact(sock, jid, emoji) {
  const msgs = await sock.newsletterFetchMessages('direct', jid, 5);
  if (!msgs?.length) throw new Error('No posts to react to');
  await sock.newsletterReactMessage(jid, msgs[0].key.id, emoji || '❤️');
}

async function safeView(sock, jid) {
  const msgs = await sock.newsletterFetchMessages('direct', jid, 5);
  if (!msgs?.length) return;
  await sock.readMessages(msgs.map(m => m.key));
}

async function runJobOnSession(job, sessionInfo, sock) {
  const sid = `${cfg.sessionId || 'unity'}_${sessionInfo.number || sessionInfo.userId}`;
  const already = await db.BoostResult.findOne({ jobId: String(job._id), sessionId: sid }).lean();
  if (already) return;

  let success = false;
  try {
    if (job.type === 'react') await safeReact(sock, job.channelJid, job.emoji);
    else if (job.type === 'view') await safeView(sock, job.channelJid);
    else await safeFollow(sock, job.channelJid);
    success = true;
  } catch (_e) {
    success = false;
  }
  try {
    await db.BoostResult.create({ jobId: String(job._id), sessionId: sid, number: sessionInfo.number, success });
  } catch (_e) {
    // unique index throws on a race with another poll — expected, ignore
  }
}

let timer = null;

function startBoostWatcher() {
  if (timer) return;
  const tick = async () => {
    try {
      const sm = global.unitySessionManager;
      if (!sm?.getAllSessions) return;

      const since = new Date(Date.now() - LOOKBACK_MS);
      const jobs = await db.BoostJob.find({ createdAt: { $gte: since } }).lean();
      if (!jobs.length) return;

      const connected = sm.getAllSessions().filter(s => s.status === 'connected');
      if (!connected.length) return;

      for (const job of jobs) {
        if (job.createdBy === (cfg.sessionId || 'unity')) continue; // our own job — already counted where it was published
        for (const sessionInfo of connected) {
          const session = sm.getSession(sessionInfo.userId);
          const sock = session?.sock;
          if (!sock) continue;
          await runJobOnSession(job, sessionInfo, sock);
          await new Promise(r => setTimeout(r, PER_SESSION_DELAY_MS));
        }
      }
    } catch (_e) {
      // Mongo hiccup or offline — just try again next tick.
    }
  };
  timer = setInterval(tick, POLL_INTERVAL_MS);
  tick();
}

function stopBoostWatcher() {
  if (timer) { clearInterval(timer); timer = null; }
}

module.exports = { startBoostWatcher, stopBoostWatcher };
