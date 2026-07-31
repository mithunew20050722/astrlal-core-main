/**
 * SL AURA App API
 * SL AURA dashboard API
 * Then add this line in dashboard/server.js (before the last app.listen):
 *
 *   require('./appApi')(app, () => _sm, db);
 */

'use strict';

// In-memory OTP store: phone -> { otp, expires }
const _otpStore = new Map();

module.exports = function registerAppApi(app, getSm, db) {

  // ── Phone token auth ─────────────────────────────────────────
  // Simple: phone number itself is the token (matches session userId)
  function getPhone(req) {
    return req.headers['x-phone'] || req.query.phone || null;
  }

  // ── Ping ─────────────────────────────────────────────────────
  app.get('/api/app/ping', (req, res) => {
    res.json({ ok: true, ts: Date.now() });
  });

  // ── Register / get pairing code ──────────────────────────────
  app.post('/api/app/register', async (req, res) => {
    try {
      const { phone } = req.body;
      if (!phone) return res.status(400).json({ error: 'phone required' });

      const sm = getSm();
      if (!sm) return res.status(503).json({ error: 'Server not ready' });

      const userId = phone.replace(/[^0-9]/g, '');

      // Stop existing session if connected/pairing
      const existing = sm.getSession(userId);
      if (existing?.status === 'connected' || existing?.status === 'pairing') {
        try { await sm.stopSession(userId); } catch (_) {}
        await new Promise(r => setTimeout(r, 1500));
      }

      // Start session and wait for pair code
      const sess = await sm.startSession(userId, (uid, update) => {}, true);

      let waited = 0;
      while (!sess.pairCode && sess.status !== 'connected' && sess.status !== 'error' && waited < 60000) {
        await new Promise(r => setTimeout(r, 500));
        waited += 500;
      }

      if (sess.status === 'error') return res.status(500).json({ ok: false, error: 'Session error. Try again.' });
      if (sess.status === 'connected') return res.json({ ok: true, status: 'connected' });
      if (sess.pairCode) return res.json({ ok: true, pairCode: sess.pairCode });
      return res.status(504).json({ ok: false, error: 'Pair code timeout. Try again.' });

    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Status ───────────────────────────────────────────────────
  app.get('/api/app/status/:phone', (req, res) => {
    try {
      const sm = getSm();
      const userId = req.params.phone.replace(/[^0-9]/g, '');
      const session = sm?.getSession(userId);
      if (!session) return res.json({ status: 'disconnected' });
      res.json({ status: session.status, connectedAt: session.connectedAt });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Bot Info ─────────────────────────────────────────────────
  app.get('/api/app/bot/info/:phone', async (req, res) => {
    try {
      const sm = getSm();
      const sessions = sm?.getAllSessions() || [];
      const session = sessions.find(s => s.userId === req.params.phone || s.number === req.params.phone);

      const uptimeSecs = session?.connectedAt
        ? Math.floor((Date.now() - new Date(session.connectedAt).getTime()) / 1000)
        : 0;

      // Get command count from DB
      const user = await db.User.findOne({ userId: req.params.phone }).lean().catch(() => null);
      const commandCount = user?.totalCommands || 0;

      res.json({
        status:       session?.status || 'disconnected',
        uptime:       uptimeSecs,
        commandCount,
        name:         session?.name || '',
        connectedAt:  session?.connectedAt || null,
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Reconnect ────────────────────────────────────────────────
  app.post('/api/app/reconnect', async (req, res) => {
    try {
      const { phone } = req.body;
      if (!phone) return res.status(400).json({ error: 'phone required' });
      const sm = getSm();
      if (!sm) return res.status(503).json({ error: 'Session manager not ready' });
      await sm.startSession(phone);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Restart ──────────────────────────────────────────────────
  app.post('/api/app/restart', async (req, res) => {
    try {
      const { phone } = req.body;
      if (!phone) return res.status(400).json({ error: 'phone required' });
      const sm = getSm();
      if (!sm) return res.status(503).json({ error: 'Session manager not ready' });
      await sm.restartSession(phone);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Disconnect ───────────────────────────────────────────────
  app.post('/api/app/disconnect', async (req, res) => {
    try {
      const { phone } = req.body;
      if (!phone) return res.status(400).json({ error: 'phone required' });
      const sm = getSm();
      if (!sm) return res.status(503).json({ error: 'Session manager not ready' });
      await sm.stopSession(phone);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Chat Setup ───────────────────────────────────────────────
  app.post('/api/app/chat/setup', async (req, res) => {
    try {
      const { phone } = req.body;
      if (!phone) return res.status(400).json({ error: 'phone required' });
      res.json({ ok: true, jid: `${phone}@s.whatsapp.net` });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/app/chat/jid/:phone', (req, res) => {
    res.json({ jid: `${req.params.phone}@s.whatsapp.net` });
  });

  // ── Chat Send ────────────────────────────────────────────────
  app.post('/api/app/chat/send', async (req, res) => {
    try {
      const { phone, text } = req.body;
      if (!phone || !text) return res.status(400).json({ error: 'phone and text required' });
      const sm = getSm();
      const sessions = sm?.getAllSessions() || [];
      const session = sessions.find(s => s.userId === phone || s.number === phone);
      if (!session?.sock) return res.status(404).json({ error: 'Session not connected' });
      await session.sock.sendMessage(`${phone}@s.whatsapp.net`, { text });
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Chat Messages ────────────────────────────────────────────
  app.get('/api/app/chat/messages/:phone', async (req, res) => {
    try {
      // Return last 50 messages from DB if available
      const msgs = await db.Message?.find({ userId: req.params.phone })
        .sort({ ts: -1 }).limit(50).lean().catch(() => []) || [];
      res.json({ messages: msgs.reverse() });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });


  // ── OTP: Send OTP via bot to owner ───────────────────────────
  app.post('/api/app/otp/send', async (req, res) => {
    try {
      const { phone } = req.body;
      if (!phone) return res.status(400).json({ error: 'phone required' });

      const sm = getSm();
      const userId = phone.replace(/[^0-9]/g, '');
      const session = sm?.getSession(userId);

      // Try session sock first, fallback to global astraSock
      const sock = session?.sock || global.astraSock;
      if (!sock) return res.status(404).json({ error: 'Bot session not found' });

      // Generate 6-digit OTP
      const otp = Math.floor(100000 + Math.random() * 900000).toString();
      
      // Store OTP with 5 min expiry
      _otpStore.set(phone, { otp, expires: Date.now() + 5 * 60 * 1000 });

      // Send OTP to bot owner inbox
      const ownerJid = `${phone}@s.whatsapp.net`;
      await sock.sendMessage(ownerJid, {
        text: `🔐 *SL AURA Login OTP*\n\nYour OTP: *${otp}*\n\nValid for 5 minutes. Do not share this code.`
      });

      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── OTP: Verify OTP ──────────────────────────────────────────
  app.post('/api/app/otp/verify', (req, res) => {
    try {
      const { phone, otp } = req.body;
      if (!phone || !otp) return res.status(400).json({ error: 'phone and otp required' });

      const record = _otpStore.get(phone);
      if (!record) return res.status(400).json({ error: 'OTP not found. Request a new one.' });
      if (Date.now() > record.expires) {
        _otpStore.delete(phone);
        return res.status(400).json({ error: 'OTP expired. Request a new one.' });
      }
      if (record.otp !== otp.trim()) {
        return res.status(400).json({ error: 'Invalid OTP' });
      }

      _otpStore.delete(phone);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Settings: get ────────────────────────────────────────────
  app.get('/api/app/settings/:phone', async (req, res) => {
    try {
      const userId = req.params.phone.replace(/[^0-9]/g, '');
      const botCfg = await db.getBotConfig(userId);
      const { CMD_GROUPS } = require('../src/commands/settings');
      const { ALWAYS_ON_CMDS } = require('../src/commands/index');
      const enabledMap = botCfg.enabledCommands || new Map();

      const groups = {};
      for (const [cat, cmds] of Object.entries(CMD_GROUPS)) {
        groups[cat] = cmds
          .filter(c => !ALWAYS_ON_CMDS.has(c))
          .map(c => {
            const val = enabledMap.get(c);
            return { cmd: c, enabled: val === undefined ? true : !!val };
          });
      }

      res.json({
        ok: true,
        mode: botCfg.mode || 'public',
        maintenance: !!botCfg.maintenance,
        features: botCfg.features || {},
        groups,
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ── Settings: save ────────────────────────────────────────────
  app.post('/api/app/settings/:phone', async (req, res) => {
    try {
      const userId = req.params.phone.replace(/[^0-9]/g, '');
      const { commands, features, mode, maintenance } = req.body;
      const botCfg = await db.getBotConfig(userId);

      if (mode) botCfg.mode = mode;
      if (typeof maintenance === 'boolean') botCfg.maintenance = maintenance;
      if (features && typeof features === 'object') {
        for (const [k, v] of Object.entries(features)) {
          if (typeof v === 'boolean') botCfg.features[k] = v;
          else if (k === 'autoChannelReactJid' && typeof v === 'string') botCfg.features[k] = v.trim();
        }
        botCfg.markModified('features');
      }
      if (commands && typeof commands === 'object') {
        if (!botCfg.enabledCommands) botCfg.enabledCommands = new Map();
        for (const [cmd, val] of Object.entries(commands)) {
          botCfg.enabledCommands.set(cmd, !!val);
        }
        botCfg.markModified('enabledCommands');
      }

      await botCfg.save();

      const sm = getSm();
      if (sm) {
        await sm.stopSession(userId);
        sm.startSession(userId, (uid, update) => {}).catch(() => {});
      }

      res.json({ ok: true, restarted: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  console.log('[AppAPI] /api/app/* routes registered ✓');
};

