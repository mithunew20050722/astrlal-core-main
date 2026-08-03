# 🌟 ASTRAL CORE — Bot Suite

Two WhatsApp bots + a selector dashboard, in one project.

## ⚠️ Read this before you deploy anywhere public

`unity-md/config.env` and `sl-aura/config.env` (and `ecosystem.config.js` at the root) currently
contain **real, live credentials** committed directly in the files — MongoDB URI, Gemini API key,
Telegram bot tokens, dashboard password/secret, and a Gmail app password. `.gitignore` only excludes
`.env`, not `config.env`, so if this project is ever pushed to a public (or even shared private) repo,
all of those are exposed.

Before you go further:
- **Rotate every one of those credentials** (new Mongo user/password, new Gemini key, new Telegram
  bot tokens via @BotFather, new Gmail app password, new dashboard password/secret).
- Add `config.env` to `.gitignore` alongside `.env`, and keep real values only on the machine that
  runs the bot (or in your host's env-var settings).

This doesn't block the bot from starting — it starts fine with the values already in the file — but
it's a real security hole, so fix it before you rely on this for anything you care about.

## 📁 Structure
```
ASTRAL_CORE/
├── selector/            → Selector Server (port 3000)
├── unity-md/            → UNITY-MD Bot (port 3001)
├── sl-aura/             → SL AURA Bot (port 3002)
├── aura-manager/        → Standalone session dashboard, NOT started by ecosystem.config.js — run separately (`cd aura-manager && npm install && node index.js`) only if you actually use it.
├── ecosystem.config.js  → PM2 config (starts SELECTOR, UNITY-MD, SL-AURA)
└── install.sh           → Legacy per-app installer (no platform detection, no PM2 start)
```

> **Note:** older versions of this README pointed at `setup.sh` / `setup.bat` / `setup.ps1`.
> Those files never existed in this repo — that's why following them couldn't start the bot.
> The block below replaces them with something that actually works.

## 🚀 One-Command Setup (Termux / Linux / macOS)

**1. Get the project onto your device** — extract this project's zip, or `git clone` it if you've
pushed it to your own GitHub repo.

**2. `cd` into the project root** — the folder that contains `ecosystem.config.js`.

**3. Paste this whole block into your terminal (bash):**

```bash
# ── 0. Sanity check ──────────────────────────────────────────
if [ ! -f ecosystem.config.js ]; then
  echo "❌ Run this from the ASTRAL CORE project root (the folder with ecosystem.config.js)."
  return 1 2>/dev/null || exit 1
fi

# ── 1. Detect platform ───────────────────────────────────────
if [ -n "$PREFIX" ] && [[ "$PREFIX" == *com.termux* ]]; then
  PLATFORM="termux"
elif command -v apt-get >/dev/null 2>&1; then
  PLATFORM="debian"      # Debian, Ubuntu, most cloud VPS images (incl. Ubuntu on Oracle Cloud)
elif command -v dnf >/dev/null 2>&1; then
  PLATFORM="fedora"      # Fedora, RHEL 8+, Oracle Linux 8+ (Oracle Cloud's default OS image)
elif command -v yum >/dev/null 2>&1; then
  PLATFORM="rhel"        # older RHEL/CentOS/Oracle Linux 7
elif command -v pacman >/dev/null 2>&1; then
  PLATFORM="arch"
elif command -v apk >/dev/null 2>&1; then
  PLATFORM="alpine"      # Alpine, common base for Docker images
elif command -v brew >/dev/null 2>&1; then
  PLATFORM="mac"
else
  PLATFORM="unknown"
fi
echo "🔎 Platform detected: $PLATFORM"

# ── 2. System packages (node 18+, git, ffmpeg) ───────────────
case "$PLATFORM" in
  termux)
    pkg update -y && pkg install -y nodejs-lts git ffmpeg
    ;;
  debian)
    sudo apt-get update -y && sudo apt-get install -y nodejs npm git ffmpeg
    ;;
  fedora)
    sudo dnf install -y nodejs git
    sudo dnf install -y ffmpeg || echo "⚠️  ffmpeg isn't in Fedora/Oracle Linux's default repos (licensing). Enable RPM Fusion first — https://rpmfusion.org/Configuration — then run: sudo dnf install -y ffmpeg"
    ;;
  rhel)
    sudo yum install -y nodejs git
    sudo yum install -y ffmpeg || echo "⚠️  ffmpeg isn't in RHEL/CentOS/Oracle Linux 7's default repos (licensing). Enable EPEL + RPM Fusion, then: sudo yum install -y ffmpeg"
    ;;
  arch)
    sudo pacman -Sy --noconfirm nodejs npm git ffmpeg
    ;;
  alpine)
    sudo apk add --no-cache nodejs npm git ffmpeg
    ;;
  mac)
    brew install node git ffmpeg
    ;;
  *)
    echo "⚠️  Unknown platform. Install Node.js 18+, git and ffmpeg yourself, then re-run this block."
    ;;
esac

# ── 2b. Node version sanity check (some distro repos ship old Node) ──
NODE_MAJOR=0
command -v node >/dev/null 2>&1 && NODE_MAJOR="$(node -v | sed 's/v//' | cut -d. -f1)"
if [ "$NODE_MAJOR" -lt 18 ] 2>/dev/null; then
  echo "⚠️  Node.js is v$NODE_MAJOR — this project needs 18+."
  echo "    Debian/Ubuntu/Fedora/RHEL/Oracle Linux: use NodeSource — https://github.com/nodesource/distributions"
  echo "    or nvm — https://github.com/nvm-sh/nvm — then re-run this block."
fi

# ── 3. PM2 (process manager) ─────────────────────────────────
if ! command -v pm2 >/dev/null 2>&1; then
  case "$PLATFORM" in
    termux|mac) npm install -g pm2 ;;
    *)          sudo npm install -g pm2 ;;
  esac
fi

# ── 4. Install each app's dependencies ───────────────────────
#     --ignore-scripts skips native builds (sharp etc.) that fail on Termux —
#     the code already falls back to jimp/pure-JS where needed, so this is safe everywhere.
for app in selector unity-md sl-aura; do
  echo "📦 Installing $app dependencies..."
  (cd "$app" && npm install --no-audit --no-fund --ignore-scripts)
done

# ── 5. Start all 3 apps under PM2 ────────────────────────────
pm2 start ecosystem.config.js
pm2 save

echo ""
echo "✅ Done — all 3 apps are running under PM2."
echo "   🎯 Selector : http://localhost:3000/pair"
echo "   🧲 UNITY-MD : http://localhost:3001/pair"
echo "   🌟 SL AURA  : http://localhost:3002/pair"
echo "   (swap localhost for your server's IP if this is a remote box)"
```

That's the whole thing — download/clone, install, and start, in one paste. First run takes a few
minutes (longer on mobile data), since it's installing 3 apps' worth of packages.

Optional, run once after the above if you want the bots to survive a reboot:
```bash
pm2 startup   # then run the sudo command it prints
```

### 🪟 Windows (CMD) — one-shot

**Why this looks different from the bash block:** `ecosystem.config.js` starts UNITY-MD and
SL-AURA through `rebuild-start.sh` with `interpreter: 'bash'` — and plain Windows CMD has no `bash`
on PATH by default (even after installing Git for Windows, its bundled `bash.exe` usually isn't
added to PATH unless you specifically chose that option during install). Rather than depend on
that, the block below starts all 3 apps under PM2 directly with `node`, skipping the bash wrapper
entirely. The only thing you lose vs. Linux/Termux/Mac is the automatic
wipe-node_modules-and-reinstall-on-every-restart behavior — on Windows, `pm2 restart` just restarts
the process, which is normally what you want anyway.

**Paste this whole block into a Command Prompt** (needs `winget`, built into Windows 10 2004+ / 11 —
if missing, install "App Installer" from the Microsoft Store first):

```bat
:: 0. Sanity check
if not exist "ecosystem.config.js" (
  echo Run this from the ASTRAL CORE project root - the folder with ecosystem.config.js
  exit /b 1
)

where winget >nul 2>nul
if errorlevel 1 (
  echo winget not found. Install "App Installer" from the Microsoft Store, or install
  echo Node.js 18+, Git and ffmpeg manually from nodejs.org / git-scm.com / ffmpeg.org, then re-run this.
  exit /b 1
)

:: 1. Node.js, Git, ffmpeg
set NEED_RESTART=0

where node >nul 2>nul
if errorlevel 1 (
  winget install --id OpenJS.NodeJS.LTS -e --silent --accept-package-agreements --accept-source-agreements
  set NEED_RESTART=1
)

where git >nul 2>nul
if errorlevel 1 (
  winget install --id Git.Git -e --silent --accept-package-agreements --accept-source-agreements
  set NEED_RESTART=1
)

where ffmpeg >nul 2>nul
if errorlevel 1 (
  winget install --id Gyan.FFmpeg -e --silent --accept-package-agreements --accept-source-agreements
  set NEED_RESTART=1
)

if "%NEED_RESTART%"=="1" (
  echo.
  echo Node.js / Git / ffmpeg was just installed. Windows needs a fresh terminal to see the
  echo updated PATH - close this window, open a NEW Command Prompt, cd back into this folder,
  echo and run this same block once more.
  exit /b 0
)

:: 2. PM2
where pm2 >nul 2>nul
if errorlevel 1 call npm install -g pm2

:: 3. Install each app's dependencies
cd selector
call npm install --no-audit --no-fund --ignore-scripts
cd ..

cd unity-md
call npm install --no-audit --no-fund --ignore-scripts
cd ..

cd sl-aura
call npm install --no-audit --no-fund --ignore-scripts
cd ..

:: 4. Start all 3 apps under PM2 directly (bypasses the bash rebuild wrapper - see note above)
set SELECTOR_PORT=3000
set UNITY_PORT=3001
set AURA_PORT=3002
set TG_PAIR_BOT_TOKEN=REPLACE_WITH_YOUR_OWN_ROTATED_TOKEN
cd selector
call pm2 start server.js --name SELECTOR
cd ..

set NODE_ENV=production
cd unity-md
call pm2 start start.js --name UNITY-MD
cd ..

cd sl-aura
call pm2 start start.js --name SL-AURA
cd ..

call pm2 save

echo.
echo Done - all 3 apps running under PM2.
echo Selector : http://localhost:3000/pair
echo UNITY-MD : http://localhost:3001/pair
echo SL AURA  : http://localhost:3002/pair
```

`TG_PAIR_BOT_TOKEN` above needs your own (rotated) Telegram bot token — grab it from
`ecosystem.config.js` or @BotFather and swap the placeholder before running, otherwise the selector
still runs fine, just without the Telegram pairing bot.

> `pm2 startup` (auto-start on reboot) doesn't work natively on Windows the way it does on
> Linux/Mac — if you want that, look at the community `pm2-windows-startup` package separately.

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
pm2 delete all               # සියල්ල ඉවත් කරන්න
```

## 🔄 Rebuild & Restart

Both bots use `rebuild-start.sh` — on every PM2 (re)start:
1. Acquires a shared install lock (prevents parallel npm installs between UNITY-MD and SL-AURA)
2. Wipes `node_modules` and `logs`
3. Runs `npm ci` (falls back to `npm install` if it fails — this fallback always fires right now,
   because `package-lock.json` is gitignored, so there's never a lockfile for `npm ci` to use)
4. Starts the bot with `node start.js`

This means **every `pm2 restart UNITY-MD` / `pm2 restart SL-AURA` fully reinstalls all packages from
scratch** — intentional, but slow and data-heavy on Termux/mobile connections. Expect each restart to
take as long as the first install did.

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

- **`sharp`** and **`wa-sticker-formatter`** are still listed in `package.json` (they give better
  quality image/sticker processing on platforms where they work), but every call site already tries
  `sharp` first and automatically falls back to `jimp` (pure JS) if it's missing or broken — so on
  Termux, where there's no prebuilt `sharp` binary for android-arm64, those specific commands just
  quietly use the `jimp` path instead. You don't need to remove anything by hand.
- **`ffmpeg-static`**: not used — the code shells out to whatever `ffmpeg` is on your system `PATH`
  via `fluent-ffmpeg`, so `pkg install ffmpeg` (Termux) / `apt install ffmpeg` (Linux) is what
  actually matters here.
- **`flock`**: not supported on Termux — `rebuild-start.sh` uses an `mkdir`-based file lock instead,
  which works on any filesystem.
- The install step uses `--ignore-scripts` to skip native build steps that would otherwise fail on
  Termux's architecture.

## 🧩 Troubleshooting

- **`bash: setup.sh: No such file or directory`** — that file never existed; use the one-shot block
  under "One-Command Setup" above instead.
- **`npm ci` fails then falls back to `npm install`** — expected right now, see "Rebuild & Restart"
  above. Not an error, just slower than it needs to be.
- **A specific command (sticker/image editing) doesn't work on Termux** — check `pm2 logs` for a
  `[PLUGIN] Failed to load ...` line; that plugin's optional native dependency isn't available on
  your platform, but the rest of the bot keeps running normally.
- **Bot won't connect / dashboard errors mention MongoDB** — check `MONGODB_URI` in `config.env` is
  reachable from your network; a broken dashboard connection is caught and logged, it won't take the
  WhatsApp connection down with it.
- **Windows: `'winget' is not recognized`** — install "App Installer" from the Microsoft Store, then
  reopen Command Prompt and re-run the block.
- **Windows: commands work but `node`/`git`/`ffmpeg` still show as missing right after install** —
  expected the first time; close the Command Prompt window, open a new one, `cd` back into the
  project folder, and run the block again so it picks up the updated PATH.
