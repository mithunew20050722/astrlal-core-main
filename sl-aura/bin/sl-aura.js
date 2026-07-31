#!/usr/bin/env node
'use strict';

/**
 * @astralcore/sl-aura — CLI entry point
 *
 * Simple WhatsApp bot — no Telegram, no Dashboard.
 *
 * Usage:
 *   npx @astralcore/sl-aura          → interactive setup
 *   npx @astralcore/sl-aura --pair    → pair a WhatsApp number
 *   npx @astralcore/sl-aura --start   → start bot (requires paired session)
 *   npx @astralcore/sl-aura --status  → show session status
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs-extra');

const BOT_DIR = path.dirname(require.resolve('@astralcore/sl-aura/package.json'));
const SESSIONS_DIR = path.join(BOT_DIR, 'sessions');

function log(msg, color = '\x1b[36m') {
  console.log(`${color}[AURA]${'\x1b[0m'} ${msg}`);
}

function prompt(question) {
  return new Promise((resolve) => {
    process.stdout.write(question);
    process.stdin.once('data', (data) => resolve(data.toString().trim()));
  });
}

async function main() {
  const args = process.argv.slice(2);

  // --status
  if (args.includes('--status')) {
    const sessions = fs.existsSync(SESSIONS_DIR)
      ? fs.readdirSync(SESSIONS_DIR).filter(d => !d.startsWith('.'))
      : [];
    if (sessions.length === 0) {
      log('No paired sessions found.', '\x1b[33m');
      log('Run: sl-aura --pair', '\x1b[33m');
    } else {
      log(`Found ${sessions.length} session(s):`, '\x1b[32m');
      sessions.forEach(s => log(`  • ${s}`, '\x1b[36m'));
    }
    return;
  }

  // --pair
  if (args.includes('--pair')) {
    log('Starting pairing wizard...', '\x1b[33m');
    process.env.AURA_PAIR_ONLY = '1';
    const child = spawn('node', [path.join(BOT_DIR, 'start.js')], { stdio: 'inherit', cwd: BOT_DIR });
    child.on('exit', (code) => process.exit(code || 0));
    return;
  }

  // --start
  if (args.includes('--start')) {
    const sessions = fs.existsSync(SESSIONS_DIR)
      ? fs.readdirSync(SESSIONS_DIR).filter(d => !d.startsWith('.'))
      : [];
    if (sessions.length === 0) {
      log('No paired sessions! Run --pair first.', '\x1b[31m');
      process.exit(1);
    }
    log(`Starting SL-AURA with ${sessions.length} session(s)...`, '\x1b[32m');
    const child = spawn('node', [path.join(BOT_DIR, 'start.js')], { stdio: 'inherit', cwd: BOT_DIR });
    child.on('exit', (code) => process.exit(code || 0));
    return;
  }

  // Default: Interactive wizard
  console.log('');
  console.log('  ⛧▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬⛧');
  console.log('      🖤 S L - A U R A 🖤');
  console.log('  ⛧▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬⛧');
  console.log('');
  console.log('  WhatsApp Multi-Session Bot');
  console.log('  by ASTRAL CORE 🇱🇰');
  console.log('');

  const sessions = fs.existsSync(SESSIONS_DIR)
    ? fs.readdirSync(SESSIONS_DIR).filter(d => !d.startsWith('.'))
    : [];

  if (sessions.length === 0) {
    log('No sessions found. Let\'s pair your phone!', '\x1b[33m');
    process.env.AURA_PAIR_ONLY = '1';
  } else {
    log(`Found ${sessions.length} session(s): ${sessions.join(', ')}`, '\x1b[32m');
    const action = await prompt('Start bot (s) / Pair new (p) / Exit (x): ');
    if (action.toLowerCase() === 'p') {
      process.env.AURA_PAIR_ONLY = '1';
    } else if (action.toLowerCase() === 'x') {
      log('Bye!', '\x1b[36m');
      process.exit(0);
    }
  }

  const child = spawn('node', [path.join(BOT_DIR, 'start.js')], { stdio: 'inherit', cwd: BOT_DIR });
  child.on('exit', (code) => process.exit(code || 0));
}

main().catch((err) => {
  log(`Error: ${err.message}`, '\x1b[31m');
  process.exit(1);
});
