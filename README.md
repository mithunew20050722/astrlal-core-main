# 🌟 ASTRAL CORE — Bot Suite

Two WhatsApp bots + a selector dashboard, in one project.

## 📁 Structure
```
ASTRAL_CORE/
├── selector/           → Selector Server (port 3000)
├── unity-md/           → UNITY-MD Bot (port 3001)
├── sl-aura/             → SL AURA Bot (port 3002)
├── ecosystem.config.js → PM2 config (all 3 apps)
└── install.sh           → Install script
```

## 🚀 Setup

```bash
# 1. Install dependencies (all 3 apps)
bash install.sh

# 2. Edit configs
nano unity-md/config.env
nano sl-aura/config.env

# 3. Start everything
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

## 🌐 URLs

| Page | URL |
|------|-----|
| 🎯 Selector (control panel) | http://your-ip:3000 |
| 🧲 UNITY-MD dashboard | http://your-ip:3001 |
| 🌟 SL AURA dashboard | http://your-ip:3002 |
| 🎯 Select Pair page | http://your-ip:3000/pair |
| 🧲 Unity Pair | http://your-ip:3001/pair |
| 🌟 Aura Pair | http://your-ip:3002/pair |

## ⚡ PM2 Commands

```bash
pm2 list                    # සියලු apps status
pm2 logs SELECTOR           # Selector logs
pm2 logs UNITY-MD           # Unity logs
pm2 logs SL-AURA            # SL AURA logs
pm2 restart UNITY-MD        # Unity restart
pm2 restart SL-AURA         # SL AURA restart
pm2 restart all             # සියල්ල restart
```
