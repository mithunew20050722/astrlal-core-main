'use strict';
const mongoose = require('mongoose');
const cfg = require('../../config');

let connected = false;

async function connect() {
  if (connected) return;
  const MAX_RETRIES = 5;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      await mongoose.connect(cfg.mongoUri, {
        serverSelectionTimeoutMS: 15000,
        socketTimeoutMS: 45000,
        connectTimeoutMS: 15000,
        maxPoolSize: 5,
        minPoolSize: 1,
      });
      connected = true;
      console.log('\x1b[32m[DB]\x1b[0m MongoDB connected ✅');
      return;
    } catch (e) {
      console.error(`\x1b[31m[DB]\x1b[0m MongoDB failed (attempt ${attempt}/${MAX_RETRIES}):`, e.message);
      if (attempt === MAX_RETRIES) {
        console.error('\x1b[31m[DB]\x1b[0m All retries failed. Check MONGODB_URI in Railway variables.');
        process.exit(1);
      }
      // Wait before retry: 5s, 10s, 20s, 30s
      const delay = Math.min(5000 * attempt, 30000);
      console.log(`\x1b[33m[DB]\x1b[0m Retrying in ${delay/1000}s...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

// ── User Schema ───────────────────────────────────────────────
const userSchema = new mongoose.Schema({
  jid:            { type: String, required: true, unique: true },
  name:           String,
  category:       { type: String, default: 'normal', enum: ['normal', 'pair', 'owner', 'creator'] },
  isOwner:        { type: Boolean, default: false },
  isSubAdmin:     { type: Boolean, default: false },
  isBanned:       { type: Boolean, default: false },
  isMuted:        { type: Boolean, default: false },
  isPaired:       { type: Boolean, default: false },
  pairedAt:       Date,
  warns:          { type: Number, default: 0 },
  warnReasons:    [String],
  coins:          { type: Number, default: 0 },
  xp:             { type: Number, default: 0 },
  level:          { type: Number, default: 1 },
  streak:         { type: Number, default: 0 },
  lastSeen:       Date,
  lastCommand:    Date,
  totalCommands:  { type: Number, default: 0 },
  badges:         [String],
  achievements:   [String],
  afk:            { type: Boolean, default: false },
  afkReason:      String,
  // FIX (2026-07): lets sendButtons() know whether to send native WhatsApp
  // interactive buttons (Android — renders fine) or plain numbered text
  // (iPhone — native buttons often fail to render on iOS WhatsApp).
  // This field existed in helper.js's getDevicePreference()/setDevicePreference()
  // already, and in unity-md's schema, but was missing here — meaning
  // .device / the auto-ask flow could never actually persist a choice on
  // sl-aura: user.device = X; user.save() silently dropped the field
  // every time (Mongoose ignores writes to undeclared schema paths), so
  // it fell back to null/undefined behavior on the very next lookup.
  device:         { type: String, enum: ['iphone', 'android', null], default: null },
  commandHistory: [{ cmd: String, at: Date }],
  personalPrefix: String,
  personalLang:   { type: String, default: 'en' },
  personalName:   String,
  lastAuraReading: Date,
  createdAt:      { type: Date, default: Date.now },
});

// ── Group Schema ──────────────────────────────────────────────
const groupSchema = new mongoose.Schema({
  jid:  { type: String, required: true, unique: true },
  name: String,
  settings: {
    activated:     { type: Boolean, default: true  }, // FIX: groups active by default
    hideMode:      { type: Boolean, default: false }, // FIX: was missing from schema
    antiLink:      { type: Boolean, default: false },
    antiSpam:      { type: Boolean, default: false },
    antiDelete:    { type: Boolean, default: false },
    antiForward:   { type: Boolean, default: false },
    antiRaid:      { type: Boolean, default: false },
    antiToxic:     { type: Boolean, default: false },
    antiCall:      { type: Boolean, default: false },
    floodDetect:   { type: Boolean, default: false },
    slowMode:      { type: Boolean, default: false },
    slowModeDelay: { type: Number,  default: 5 },
    captcha:       { type: Boolean, default: false },
    muteAll:       { type: Boolean, default: false },
    disappearing:  { type: Number,  default: 0 },
    lang:          { type: String,  default: 'en' },
    aiMode:        { type: Boolean, default: false },
    // Added for .setkeyword on/off — default true so existing groups that
    // already had keywords set up keep working exactly as before.
    keywordReplyEnabled: { type: Boolean, default: true },
  },
  rules:        [String],
  faq:          [{ q: String, a: String }],
  keywords:     [{ trigger: String, reply: String }],
  bannedWords:  [String],
  warnCount:    { type: Map, of: Number },
  commandStats: { type: Map, of: Number },
  createdAt:    { type: Date, default: Date.now },
});

// ── Stats Schema ──────────────────────────────────────────────
const statsSchema = new mongoose.Schema({
  date:          { type: String, required: true, unique: true },
  totalCommands: { type: Number, default: 0 },
  uniqueUsers:   [String],
  topCommands:   { type: Map, of: Number },
  errorCount:    { type: Number, default: 0 },
  newUsers:      { type: Number, default: 0 },
});

// ── Audit Schema ──────────────────────────────────────────────
const auditSchema = new mongoose.Schema({
  userJid:   String,
  userName:  String,
  command:   String,
  groupJid:  String,
  success:   Boolean,
  error:     String,
  at:        { type: Date, default: Date.now },
});

// ── JadiBot Schema ────────────────────────────────────────────
const jadibotSchema = new mongoose.Schema({
  ownerJid: { type: String, required: true, unique: true },
  sessions: [{ sessionId: String, createdAt: Date }],
  active:   { type: Boolean, default: false },
  createdAt:{ type: Date, default: Date.now },
});

// ── Schedule Schema ───────────────────────────────────────────
const scheduleSchema = new mongoose.Schema({
  chat:      String,
  message:   String,
  media:     String,
  mediaType: String,
  at:        Date,
  repeat:    String,
  active:    { type: Boolean, default: true },
  createdBy: String,
  createdAt: { type: Date, default: Date.now },
});

// ── AuthState Schema ──────────────────────────────────────────
const authStateSchema = new mongoose.Schema({
  _id:  String,
  data: mongoose.Schema.Types.Mixed,
}, { versionKey: false });

// ── BotConfig Schema ──────────────────────────────────────────
// enabledCommands: Map<commandName, boolean>
// ALL commands default OFF except core system commands (menu/alive/ping/help/settings)
// ALL auto features default OFF
const botConfigSchema = new mongoose.Schema({
  _id:         { type: String, default: 'config' },
  mode:        { type: String, default: 'public' },
  prefix:      String,
  lang:        { type: String, default: 'en' },
  langSet:     { type: Boolean, default: false },
  maintenance: { type: Boolean, default: false },
  features: {
    autoRecording:   { type: Boolean, default: false },
    autoOnline:      { type: Boolean, default: false },
    autoRead:        { type: Boolean, default: false },
    autoTyping:      { type: Boolean, default: false },
    autoBio:         { type: Boolean, default: true },
    didYouMean:      { type: Boolean, default: false },
    antiCall:        { type: Boolean, default: false },
    autoDeleteChat:  { type: Boolean, default: false },
    autoStatusView:  { type: Boolean, default: false },
    autoStatusReact: { type: Boolean, default: false },
    autoStatusReactEmoji: { type: String, default: '❤️' },
    statusDlEnabled: { type: Boolean, default: true },
  maintenanceMsg:  { type: String,  default: '🔧 SL AURA is under maintenance. Back soon!' },
  },
  // Per-command toggle map  (commandName → boolean)
  // Commands missing from the map = disabled
  enabledCommands: { type: Map, of: Boolean, default: () => new Map() },
  // Dashboard settings password (auto-generated on first connect, sent via WA)
  sessionPassword: { type: String, default: null },
  // Channel boost active tasks
  boostTasks: [{
    link:      String,
    emoji:     String,
    startedAt: Date,
    endsAt:    Date,
    active:    { type: Boolean, default: true },
  }],
  // First ever deployment time — set once, never overwritten on restarts
  firstBootAt: { type: Date, default: null },
  // Text style for bot replies (elegant | bold)
  textStyle: { type: String, default: 'elegant', enum: ['elegant', 'bold'] },
}, { versionKey: false });

// ── Boost Job / Boost Result Schemas ────────────────────────────
// BUG FIX (2026-08): these were missing from this file entirely, so
// every db.BoostJob.create(...) call in commands/boost.js and
// commands/chboost.js threw (caught by their surrounding try/catch and
// silently swallowed) — no BoostJob doc was EVER written by the main
// bot, so no @astralcore/aura-wb (npm/yarn) install ever had anything
// to poll for. This is the root cause of "npm bots don't react/follow
// for boosts". Schema kept byte-identical to aura-wb's copy — both
// sides must agree on this shape since they share the same MongoDB.
const boostJobSchema = new mongoose.Schema({
  channelJid: String,
  msgId:      String, // optional — react to this exact post; if absent, react to the channel's latest
  type:       { type: String, default: 'boost' },
  emoji:      String,
  createdBy:  String,
  createdAt:  { type: Date, default: Date.now, expires: 3600 },
}, { versionKey: false });

const boostResultSchema = new mongoose.Schema({
  jobId:     String,
  sessionId: String,
  number:    String,
  success:   Boolean,
  at:        { type: Date, default: Date.now, expires: 86400 },
}, { versionKey: false });
boostResultSchema.index({ jobId: 1, sessionId: 1 }, { unique: true });

// ── npm/yarn install heartbeat (AuraWbNode) ─────────────────────
// Deliberately separate from BoostJob/BoostResult above — this is
// ONLY a "is this npm install currently online" registry so the
// Telegram management bot can show a live npm-bot-connected count.
// It has nothing to do with boosting; the two systems only meet at
// the moment a boost actually runs (a node polls BoostJob same as
// always). Each @astralcore/aura-wb install upserts its own doc
// (keyed by its own sessionId) on connect and every ~60s afterwards;
// "online" is inferred from lastSeenAt being recent, so a killed
// process (no clean shutdown) still shows offline soon after, with no
// separate disconnect signal required.
const auraWbNodeSchema = new mongoose.Schema({
  sessionId:   { type: String, required: true, unique: true },
  number:      String,
  name:        String,
  connectedAt: { type: Date, default: Date.now },
  lastSeenAt:  { type: Date, default: Date.now },
}, { versionKey: false });

// ── Models ────────────────────────────────────────────────────
const User        = mongoose.model('User',        userSchema);
const Group       = mongoose.model('Group',       groupSchema);
const Stats       = mongoose.model('Stats',       statsSchema);
const Audit       = mongoose.model('Audit',       auditSchema);
const JadiBot     = mongoose.model('JadiBot',     jadibotSchema);
const Schedule    = mongoose.model('Schedule',    scheduleSchema);
const AuthState   = mongoose.model('AuthState',   authStateSchema);
const BotConfig   = mongoose.model('BotConfig',   botConfigSchema);
const BoostJob    = mongoose.model('BoostJob',    boostJobSchema);
const BoostResult = mongoose.model('BoostResult', boostResultSchema);
const AuraWbNode  = mongoose.model('AuraWbNode',  auraWbNodeSchema);

// ── Commands that are ALWAYS on regardless of toggle ──────────
// These are system-level commands the owner always needs
const ALWAYS_ON_CMDS = new Set([
  'menu', 'm', 'alive', 'ping', 'help',
  'settings', 'botmode',
  'publicmode', 'groupmode', 'inboxmode', 'privatemode',
  'autorecording', 'autoonline',
  'autoread', 'autotyping', 'autobio', 'didyoumean', 'anticall',
  'setlang', 'setprefix', 'language', 'lang',
  'mysettings', 'myprefix', 'mylang', 'myname', 'myreset',
  'getid', 'getjid', 'getgroupid', 'getchannelid',
  'pair', 'unpair',
  'maintenance', 'maintain',
  'addowner', 'delowner', 'listowner',
  'addsubadmin', 'delsubadmin',
  'version', 'restart', 'kill', 'clearcache',
  'clearchat', 'chatclear', 'auditlog',
  'cmds', 'cmdson', 'cmdsoff', 'cmdtoggle',
  '_setlang',
  'save', 'send',
]);

// ── Database Functions ────────────────────────────────────────
async function getUser(jid) {
  try {
    return await User.findOneAndUpdate(
      { jid },
      { $setOnInsert: { jid } },
      { upsert: true, new: true }
    );
  } catch {
    // DB temporarily unavailable — return minimal fallback so commands still run
    return { jid, isBanned: false, isMuted: false, isOwner: false, isPaired: false, category: 'normal', coins: 0, xp: 0, level: 1, warns: 0 };
  }
}

async function getGroup(jid) {
  try {
    return await Group.findOneAndUpdate(
      { jid },
      { $setOnInsert: { jid } },
      { upsert: true, new: true }
    );
  } catch {
    return { jid, settings: {} };
  }
}

async function getBotConfig(sessionId = 'config') {
  // FIX (2026-07): this had no error handling — any DB hiccup made it
  // throw, and since settings.js (and others) call this WITHOUT their
  // own try/catch, that silently killed the whole command with zero
  // feedback to the user (this is why .ping worked but .settings didn't
  // — .ping never touches the DB, .settings always does). Now falls
  // back to safe defaults instead of throwing.
  try {
    return await BotConfig.findByIdAndUpdate(
      sessionId,
      { $setOnInsert: { _id: sessionId, mode: 'public' } },
      { upsert: true, new: true }
    );
  } catch (e) {
    return { _id: sessionId, mode: 'public', features: {}, langSet: true };
  }
}

// Set firstBootAt only if it has never been set before (survives restarts/updates)
async function setFirstBootTime(sessionId = 'config') {
  await BotConfig.findByIdAndUpdate(
    sessionId,
    [
      {
        $set: {
          firstBootAt: {
            $cond: [{ $eq: ['$firstBootAt', null] }, new Date(), '$firstBootAt'],
          },
        },
      },
    ],
    { upsert: true }
  );
}

// Check if a command is enabled
async function isCommandEnabled(commandName, sessionId = 'config') {
  if (ALWAYS_ON_CMDS.has(commandName)) return true;
  try {
    const botCfg = await getBotConfig(sessionId);
    const map = botCfg.enabledCommands;
    if (!map) return true;
    const val = map.get(commandName);
    if (val === undefined) return true; // not explicitly set = enabled
    return val === true;
  } catch {
    return true;
  }
}

// Toggle a command on/off — returns new value
async function toggleCommand(commandName, value, sessionId = 'config') {
  const botCfg = await getBotConfig(sessionId);
  if (!botCfg.enabledCommands) botCfg.enabledCommands = new Map();
  botCfg.enabledCommands.set(commandName, value);
  botCfg.markModified('enabledCommands');
  await botCfg.save();
  return value;
}

async function logCommand({ command, userJid }) {
  const today = new Date().toISOString().split('T')[0];
  await Stats.findOneAndUpdate(
    { date: today },
    {
      $inc: { totalCommands: 1, [`topCommands.${command}`]: 1 },
      $addToSet: { uniqueUsers: userJid },
    },
    { upsert: true }
  ).catch(() => {});
}

async function logAudit({ userJid, userName, command, groupJid, success, error }) {
  await Audit.create({ userJid, userName, command, groupJid, success, error }).catch(() => {});
}

// ── setPaired — mark user as paired/unpaired ──────────────────
async function setPaired(jid, value = true) {
  return User.findOneAndUpdate(
    { jid },
    { $set: { isPaired: value, pairedAt: value ? new Date() : null } },
    { upsert: true, new: true }
  );
}

// ── warnUser — increment warn count, return new total ─────────
async function warnUser(jid, reason = '') {
  const user = await User.findOneAndUpdate(
    { jid },
    {
      $inc: { warns: 1 },
      $push: { warnReasons: reason },
    },
    { upsert: true, new: true }
  );
  return user.warns;
}

// ── resetWarns — reset warn count ────────────────────────────
async function resetWarns(jid) {
  return User.findOneAndUpdate(
    { jid },
    { $set: { warns: 0, warnReasons: [] } },
    { upsert: true, new: true }
  );
}

// ── getStats — get stats for last N days ─────────────────────
async function getStats(days = 1) {
  const dates = [];
  for (let i = 0; i < days; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    dates.push(d.toISOString().split('T')[0]);
  }
  return Stats.find({ date: { $in: dates } }).sort({ date: -1 });
}

// ── Single-user MongoDB auth state (used by start.js) ────────
// Uses the AuthState model to persist Baileys credentials & signal keys.
//
// ⚠️ IMPORTANT: UNITY-MD and SL AURA share ONE MongoDB database
// (see config.env → MONGODB_URI). Without a per-bot namespace,
// both bots would write to the SAME `_id: 'creds'` document and
// silently overwrite each other's session on every reconnect —
// causing "works fine, then breaks after a restart / needs re-pair"
// symptoms. We prefix every key with the bot's own sessionId so
// each bot's auth state lives in its own isolated set of documents,
// exactly like sessionManager.js already does for jadibot sub-users.
async function useMongoDBAuthState() {
  const { BufferJSON, initAuthCreds, proto } = require('@whiskeysockets/baileys');

  const ns = (cfg.sessionId || 'default').replace(/[^a-zA-Z0-9_-]/g, '');
  const nsKey = (key) => `${ns}:${key}`;

  const writeData = async (data, key) => {
    await AuthState.findByIdAndUpdate(
      nsKey(key),
      { _id: nsKey(key), data: JSON.parse(JSON.stringify(data, BufferJSON.replacer)) },
      { upsert: true }
    );
  };

  const readData = async (key) => {
    try {
      const doc = await AuthState.findById(nsKey(key)).lean();
      return doc ? JSON.parse(JSON.stringify(doc.data), BufferJSON.reviver) : null;
    } catch { return null; }
  };

  const creds = (await readData('creds')) || initAuthCreds();

  const state = {
    creds,
    keys: {
      get: async (type, ids) => {
        const result = {};
        // Batch fetch for performance
        const docIds = ids.map(id => nsKey(`${type}-${id}`));
        try {
          const docs = await AuthState.find({ _id: { $in: docIds } }).lean();
          const docMap = {};
          for (const d of docs) docMap[d._id] = d;
          for (const id of ids) {
            const doc = docMap[nsKey(`${type}-${id}`)];
            if (!doc) { result[id] = undefined; continue; }
            let value = JSON.parse(JSON.stringify(doc.data), BufferJSON.reviver);
            if (type === 'app-state-sync-key' && value) {
              value = proto.Message.AppStateSyncKeyData.fromObject(value);
            }
            result[id] = value;
          }
        } catch {
          // Fallback to individual reads
          await Promise.all(ids.map(async (id) => {
            result[id] = await readData(`${type}-${id}`);
            if (type === 'app-state-sync-key' && result[id]) {
              result[id] = proto.Message.AppStateSyncKeyData.fromObject(result[id]);
            }
          }));
        }
        return result;
      },
      set: async (data) => {
        const tasks = [];
        for (const category in data) {
          for (const id in data[category]) {
            const value = data[category][id];
            tasks.push(
              value
                ? writeData(value, `${category}-${id}`)
                : AuthState.deleteOne({ _id: nsKey(`${category}-${id}`) })
            );
          }
        }
        await Promise.all(tasks);
      },
    },
  };

  return {
    state,
    saveCreds: () => writeData(state.creds, 'creds'),
  };
}

module.exports = {
  connect,
  User, Group, Stats, Audit, JadiBot, Schedule, AuthState, BotConfig,
  BoostJob, BoostResult, AuraWbNode,
  getUser, getGroup, getBotConfig,
  isCommandEnabled, toggleCommand,
  ALWAYS_ON_CMDS,
  logCommand, logAudit,
  // ── newly added ──────────────────────────────────────────────
  setPaired,
  warnUser,
  resetWarns,
  getStats,
  setFirstBootTime,
  useMongoDBAuthState,
};
