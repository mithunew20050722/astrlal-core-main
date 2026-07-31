'use strict';
// Creator-only server file management. Every command here can read/write
// files on the box the bot runs on, so access is double-guarded: the
// plugin-level access:'creator' gate below, PLUS an explicit number check
// inside run() (matching the pattern used in creator.js's server-restart
// command) — never trust a single gate for something this powerful.
//
// All paths are resolved relative to the bot's own root (process.cwd(),
// which PM2 sets correctly per-app) and validated to stay inside it —
// no '../' escapes, no writing into node_modules/ or .git/.
const fs = require('fs');
const path = require('path');
const cfg = require('../../config');
const logger = require('./logger');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');

// FIX (2026-07): this used to be process.cwd() — each bot's OWN folder
// only. That meant ".putfile unity-md/..." typed from sl-aura silently
// wrote INSIDE sl-aura's own tree (a harmless-looking nested path) instead
// of touching the real unity-md file — the command reported success
// because the write genuinely succeeded, just not where anyone expected.
// PM2 runs each bot with cwd set to its own folder (e.g. ".../sl-aura"),
// so going one level up lands on the shared project root containing both
// unity-md/, sl-aura/, and selector/ as siblings.
// FIX (2026-07): BOT_ROOT used to be process.cwd()-based, which depends on
// wherever the process happened to be launched FROM — not where this file
// actually lives. If cwd was ever off by one level (e.g. someone runs
// `node sl-aura/start.js` from /home/ubuntu instead of cd-ing into
// sl-aura/ first, or a stale/incorrect ecosystem.config.js sets the wrong
// cwd — see the old per-bot ecosystem.config.js files, which pointed at a
// leftover /home/ubuntu/UNITY_FAST-main path from before this project was
// renamed), BOT_ROOT silently resolved too shallow — e.g. all the way up
// to /home. .fullzip would then try to zip the ENTIRE /home directory
// (every user's files, every nested node_modules, none of it excluded —
// the -x patterns only match top-level names) into a file named
// "home-<timestamp>.zip". __dirname is always THIS file's real location
// on disk (sl-aura/src/commands), so resolving from there is immune to
// how or from where the process was started.
const BOT_ROOT = path.resolve(__dirname, '..', '..', '..');
const MAX_FILE_BYTES = 20 * 1024 * 1024; // 20MB

// chat jid -> absolute .bak path awaiting a keep/delete answer from
// .putfile. Only ever set by the creator, so a simple in-memory map
// (no DB) is enough — it just needs to survive until the next reply.
const _pendingBackups = new Map();

function resolveSafePath(relPath) {
  const cleaned = (relPath || '').trim().replace(/^[/\\]+/, '');
  if (!cleaned) return null;
  const resolved = path.resolve(BOT_ROOT, cleaned);
  const rel = path.relative(BOT_ROOT, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null; // escaped root
  if (/(^|[/\\])(node_modules|\.git)([/\\]|$)/.test(rel)) return null; // protected
  return resolved;
}

function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

async function downloadDocBuffer(docContent) {
  const stream = await downloadContentFromMessage(docContent, 'document');
  let buf = Buffer.from([]);
  for await (const chunk of stream) buf = Buffer.concat([buf, chunk]);
  return buf;
}

module.exports = {
  commands: ['mkdir', 'lsdir', 'getfile', 'putfile', 'fullzip', 'bakkeep', 'bakdel'],
  access: 'creator',
  description: 'Creator only — server file management',

  async run({ sock, m }) {
    if (!m.isCreator) return; // silent — creator's exact number only
    const cmd  = m.command;
    const chat = m.chat;
    const text = (m.text || '').trim();

    // ── .mkdir <path> ──────────────────────────────────────────
    if (cmd === 'mkdir') {
      if (!text) return m.reply(`📌 *Usage:* .mkdir unity-md/src/commands/newfolder\n\n${cfg.footer}`);
      const target = resolveSafePath(text);
      if (!target) return m.reply(`❌ *Invalid or blocked path.*\n\n${cfg.footer}`);
      try {
        fs.mkdirSync(target, { recursive: true });
        return m.reply(`✅ *Folder created:*\n${path.relative(BOT_ROOT, target)}\n\n${cfg.footer}`);
      } catch (e) {
        return m.reply(`❌ Failed: ${e.message}\n\n${cfg.footer}`);
      }
    }

    // ── .lsdir [path] ──────────────────────────────────────────
    if (cmd === 'lsdir') {
      const target = resolveSafePath(text || '.');
      if (!target) return m.reply(`❌ *Invalid or blocked path.*\n\n${cfg.footer}`);
      try {
        const entries = fs.readdirSync(target, { withFileTypes: true })
          .filter(e => !['node_modules', '.git'].includes(e.name))
          .sort((a, b) => (a.isDirectory() === b.isDirectory() ? a.name.localeCompare(b.name) : a.isDirectory() ? -1 : 1));
        if (!entries.length) return m.reply(`📂 *Empty:* ${path.relative(BOT_ROOT, target) || '.'}\n\n${cfg.footer}`);
        const lines = entries.map(e => {
          if (e.isDirectory()) return `📁 ${e.name}/`;
          const size = fs.statSync(path.join(target, e.name)).size;
          return `📄 ${e.name}  _(${fmtBytes(size)})_`;
        });
        return m.reply(
          `📂 *${path.relative(BOT_ROOT, target) || '.'}*\n\n${lines.join('\n')}\n\n${cfg.footer}`
        );
      } catch (e) {
        return m.reply(`❌ Failed: ${e.message}\n\n${cfg.footer}`);
      }
    }

    // ── .getfile <path> ────────────────────────────────────────
    if (cmd === 'getfile') {
      if (!text) return m.reply(`📌 *Usage:* .getfile unity-md/src/commands/helper.js\n\n${cfg.footer}`);
      const target = resolveSafePath(text);
      if (!target) return m.reply(`❌ *Invalid or blocked path.*\n\n${cfg.footer}`);
      try {
        const stat = fs.statSync(target);
        if (stat.isDirectory()) return m.reply(`❌ *That's a folder.* Use .lsdir instead.\n\n${cfg.footer}`);
        if (stat.size > MAX_FILE_BYTES) return m.reply(`❌ *Too large* (${fmtBytes(stat.size)}, max 20MB).\n\n${cfg.footer}`);
        return sock.sendMessage(chat, {
          document: fs.readFileSync(target),
          fileName: path.basename(target),
          mimetype: 'application/octet-stream',
          caption: `📄 ${path.relative(BOT_ROOT, target)}\n\n${cfg.footer}`,
        }, { quoted: m.msg });
      } catch (e) {
        return m.reply(`❌ *Not found or unreadable:* ${e.message}\n\n${cfg.footer}`);
      }
    }

    // ── .putfile <path> ────────────────────────────────────────
    // Send a file WITH caption ".putfile <path>", or reply to an already-
    // sent document with ".putfile <path>" as the reply text. Existing
    // files are always backed up (.bak) before being overwritten — no
    // confirmation step, but nothing is ever silently destroyed.
    if (cmd === 'putfile') {
      if (!text) return m.reply(`📌 *Usage:* attach a file, caption *.putfile unity-md/src/commands/helper.js*\n(path starts with unity-md/ or sl-aura/ — reply to an already-sent file works too)\n\n${cfg.footer}`);
      const target = resolveSafePath(text);
      if (!target) return m.reply(`❌ *Invalid or blocked path.*\n\n${cfg.footer}`);

      const directDoc  = m.msg.message?.documentMessage;
      const quotedDoc  = m.quoted?.type === 'documentMessage' ? m.quoted.message.documentMessage : null;
      const docContent = directDoc || quotedDoc;
      if (!docContent) return m.reply(`❌ *No file attached.* Attach a file with this as the caption, or reply to a file with this command.\n\n${cfg.footer}`);
      if ((docContent.fileLength && Number(docContent.fileLength) > MAX_FILE_BYTES)) {
        return m.reply(`❌ *Too large* (max 20MB).\n\n${cfg.footer}`);
      }

      try {
        const buffer = await downloadDocBuffer(docContent);
        fs.mkdirSync(path.dirname(target), { recursive: true });

        // Still back up the existing file BEFORE overwriting — that part
        // never gets skipped, so a bad .putfile can never destroy the old
        // version outright. What changes is what happens AFTER: instead of
        // silently keeping the .bak forever, we ask once the save succeeds.
        let backupNote = '';
        let bakPath = null;
        if (fs.existsSync(target)) {
          bakPath = target + '.bak';
          fs.copyFileSync(target, bakPath);
          backupNote = `\n🗂️ _Old version backed up →_ ${path.relative(BOT_ROOT, bakPath)}`;
        }

        fs.writeFileSync(target, buffer);
        await m.reply(
          `✅ *Saved:* ${path.relative(BOT_ROOT, target)}\n` +
          `📦 ${fmtBytes(buffer.length)}${backupNote}\n\n` +
          `⚡ _Run .server restart for it to take effect._\n\n${cfg.footer}`
        );

        if (bakPath) {
          _pendingBackups.set(chat, bakPath);
          const { sendButtons } = require('./helper');
          await sendButtons(sock, chat, {
            text:
              `🗂️ *Keep the backup file?*\n${path.relative(BOT_ROOT, bakPath)}\n\n` +
              `Reply below.`,
            buttons: [
              { label: '✅ Keep it', id: '.bakkeep' },
              { label: '🗑️ Delete it', id: '.bakdel' },
            ],
          });
        }
        return;
      } catch (e) {
        return m.reply(`❌ Failed: ${e.message}\n\n${cfg.footer}`);
      }
    }

    // ── .bakkeep / .bakdel — answer to the "keep backup?" prompt ─
    if (cmd === 'bakkeep' || cmd === 'bakdel') {
      const bakPath = _pendingBackups.get(chat);
      if (!bakPath) return m.reply(`ℹ️ *No pending backup question right now.*\n\n${cfg.footer}`);
      _pendingBackups.delete(chat);

      if (cmd === 'bakdel') {
        try {
          if (fs.existsSync(bakPath)) fs.unlinkSync(bakPath);
          return m.reply(`🗑️ *Backup deleted:*\n${path.relative(BOT_ROOT, bakPath)}\n\n${cfg.footer}`);
        } catch (e) {
          return m.reply(`❌ Failed to delete backup: ${e.message}\n\n${cfg.footer}`);
        }
      }
      return m.reply(`✅ *Backup kept:*\n${path.relative(BOT_ROOT, bakPath)}\n\n${cfg.footer}`);
    }

    // ── .fullzip — zip the whole bot folder and send it ─────────
    if (cmd === 'fullzip') {
      // Extra sanity check on top of the __dirname-based BOT_ROOT fix
      // above: refuse outright if the resolved root doesn't actually
      // contain the expected sibling project folders. Better to fail
      // loudly here than to ever zip the wrong directory again.
      const expectedSiblings = ['sl-aura', 'unity-md', 'selector'];
      const looksRight = expectedSiblings.some(d => fs.existsSync(path.join(BOT_ROOT, d)));
      if (!looksRight) {
        return m.reply(
          `❌ *Refusing to zip.*\n` +
          `Resolved root doesn't look like the project folder:\n${BOT_ROOT}\n\n${cfg.footer}`
        );
      }

      await m.reply(`🗜️ *Zipping everything...* this can take a minute.\n\n${cfg.footer}`);
      const os = require('os');
      const { exec } = require('child_process');
      const zipPath = path.join(os.tmpdir(), `${path.basename(BOT_ROOT)}-${Date.now()}.zip`);

      // -x excludes: node_modules, .git, and any previous zip dumps in tmp
      // FIX (2026-07): the old exclude patterns ('node_modules/*', '.git/*')
      // only match those folders sitting directly at BOT_ROOT — but
      // BOT_ROOT is the project root, and node_modules/logs actually live
      // one level down inside sl-aura/, unity-md/, and selector/. Without
      // a '*/' prefix those patterns never matched, so every bot's
      // node_modules and logs were being zipped in full every time. Both
      // the bare and nested forms are included so this stays correct
      // whether a match is checked against the top level or any subfolder.
      const cmdStr = `cd "${BOT_ROOT}" && zip -r -q "${zipPath}" . ` +
        `-x "node_modules/*" -x "*/node_modules/*" ` +
        `-x "logs/*" -x "*/logs/*" ` +
        `-x ".git/*" -x "*/.git/*" ` +
        `-x "*.bak"`;

      exec(cmdStr, { maxBuffer: 1024 * 1024 * 50, timeout: 5 * 60_000 }, async (err) => {
        if (err) {
          logger.error('[FULLZIP] zip failed: ' + err.message);
          return sock.sendMessage(chat, {
            text: `❌ *Zip failed:* ${err.message}\n\n_Is the "zip" package installed? Try: sudo apt-get install zip_\n\n${cfg.footer}`,
          }).catch(() => {});
        }
        try {
          const stat = fs.statSync(zipPath);
          if (stat.size > 95 * 1024 * 1024) {
            fs.unlinkSync(zipPath);
            return sock.sendMessage(chat, {
              text: `❌ *Zip too large to send* (${fmtBytes(stat.size)}). Consider excluding more folders.\n\n${cfg.footer}`,
            }).catch(() => {});
          }
          await sock.sendMessage(chat, {
            document: fs.readFileSync(zipPath),
            fileName: path.basename(zipPath),
            mimetype: 'application/zip',
            caption: `📦 *Full backup*\n${fmtBytes(stat.size)}\n\n${cfg.footer}`,
          });
        } catch (e2) {
          logger.error('[FULLZIP] send failed: ' + e2.message);
          await sock.sendMessage(chat, { text: `❌ Failed to send zip: ${e2.message}\n\n${cfg.footer}` }).catch(() => {});
        } finally {
          fs.unlink(zipPath, () => {});
        }
      });
      return;
    }
  },
};
