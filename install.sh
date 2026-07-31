#!/bin/bash
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  🌟 ASTRAL CORE — Install Script"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

echo ""
echo "📦 Installing Selector dependencies..."
cd selector && npm install --production && cd ..

echo ""
echo "📦 Installing UNITY-MD dependencies..."
cd unity-md && npm install --production && cd ..

echo ""
echo "📦 Installing SL AURA dependencies..."
cd sl-aura && npm install --production && cd ..

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Done! Now start all 3 apps:"
echo ""
echo "  pm2 start ecosystem.config.js"
echo "  pm2 save"
echo ""
echo "  🎯 Selector    → http://your-ip:3000"
echo "  🧲 UNITY-MD    → http://your-ip:3001"
echo "  🌟 SL AURA     → http://your-ip:3002"
echo ""
echo "  🎯 Select Pair → http://your-ip:3000/pair"
echo "  🧲 Unity Pair  → http://your-ip:3001/pair"
echo "  🌟 Aura Pair   → http://your-ip:3002/pair"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
