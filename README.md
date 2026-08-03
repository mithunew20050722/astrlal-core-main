# 🌟 ASTRAL CORE — Bot Suite

Two WhatsApp bots + a selector dashboard, in one project.

## 📁 Structure
```
ASTRAL_CORE/
├── selector/           → Selector Server (port 3000)
├── unity-md/           → UNITY-MD Bot (port 3001)
├── sl-aura/             → SL AURA Bot (port 3002)
├── ecosystem.config.js → PM2 config (all 3 apps)
├── setup.sh             → 🆕 Linux / Termux / macOS setup
├── setup.bat            → 🆕 Windows CMD setup
├── setup.ps1            → 🆕 Windows PowerShell setup
└── install.sh           → Legacy install (kept for compat)
```

## 🚀 One-Command Setup (All Platforms)

### 🤖 Termux (Android) / Linux / macOS
```bash
bash setup.sh
```

### 🪟 Windows CMD
```cmd
setup.bat
```

### 🪟 Windows PowerShell
```powershell
.\setup.ps1
```

> The setup script auto-detects your platform, installs missing dependencies (node, npm, git, pm2, ffmpeg), then installs all 3 apps.

### Manual Setup (if needed)

<details>
<summary>Click to expand manual instructions</summary>

#### Termux (Android)
```bash
pkg update && pkg install -y nodejs git ffmpeg
npm install -g pm2
bash install.sh
```

#### Linux (apt)
```bash
sudo apt update && sudo apt install -y nodejs npm git ffmpeg
sudo npm install -g pm2
bash install.sh
```

#### Windows
1. Install [Node.js](https://nodejs.org/) (includes npm)
2. Install [git](https://git-scm.com/)
3. Install [ffmpeg](https://ffmpeg.org/download.html) — `winget install ffmpeg`
4. `npm install -g pm2`
5. Run `setup.bat` or `setup.ps1`
</details>

### Start the bots
```bash
pm2 start ecosystem.config.js
pm2 save
pm2 startup   # optional — auto-start on boot
```

### Pair your devices
Open the `/pair` page on each bot:
- 🎯 Selector: `http://localhost:3000/pair`
- 🧲 UNITY-MD: `http://localhost:3001/pair`
- 🌟 SL AURA: `http://localhost:3002/pair`

Scan the QR code with WhatsApp.

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
pm2 stop all                # සියල්ල නවත්වන්න
pm2 delete all              # සියල්ල ඉවත් කරන්න
```

## 🔄 Rebuild & Restart

Both bots use `rebuild-start.sh` — on every PM2 (re)start:
1. Acquires a shared install lock (prevents parallel npm installs)
2. Wipes `node_modules` and `logs`
3. Runs `npm ci` (falls back to `npm install` if it fails)
4. Starts the bot with `node start.js`

```bash
pm2 restart UNITY-MD    # full rebuild + restart
pm2 restart SL-AURA     # full rebuild + restart
```

## 🗑️ Session Management

Sessions are stored locally:
```
~/.sl-aura/sessions/<userId>/creds.json
~/.unity-md/sessions/<userId>/creds.json
```

MongoDB is still used for stale session detection on startup.
To clear a user's session:
```bash
rm -rf ~/.sl-aura/sessions/<userId>/
rm -rf ~/.unity-md/sessions/<userId>/
```

## ⚠️ Termux Notes

- **`sharp`**: Not available on Termux (no android-arm64 prebuilt). Use `jimp` fallback.
- **`wa-sticker-formatter`**: Removed — depends on `sharp` internally.
- **`ffmpeg-static`**: Removed — uses system `ffmpeg` (`pkg install ffmpeg`).
- **`flock`**: Not supported — replaced with `mkdir`-based file locks in `rebuild-start.sh`.
- Install scripts use `--ignore-scripts` to skip native build steps.
