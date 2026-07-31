'use strict';
/**
 * ASTRAL CORE — Bot Selector Server
 * Runs standalone on port 3000.
 * Lets the user choose between UNITY-MD (3001) and SL AURA (3002).
 */
const express = require('express');
const path    = require('path');
const { start: startPairBot } = require('./telegram/pairBot');

const app  = express();
const PORT = process.env.SELECTOR_PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'selector.html'));
});

// Pair selector — separate page, redirects straight to /pair (no login)
app.get('/pair', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'pair-selector.html'));
});

app.get('/pair/unity', (req, res) => {
  res.redirect('https://unity-astralbots.duckdns.org/pair');
});

app.get('/pair/aura', (req, res) => {
  res.redirect('https://aura-astralbots.duckdns.org/pair');
});

app.listen(PORT, () => {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  🎯 ASTRAL CORE Selector running`);
  console.log(`  🌐 http://localhost:${PORT}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
});

try { startPairBot(); } catch (e) { console.error('[TG-PAIR] Start failed:', e.message); }
