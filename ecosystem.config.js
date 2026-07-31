module.exports = {
  apps: [
    {
      name: 'SELECTOR',
      script: 'server.js',
      cwd: './selector',
      watch: false,
      autorestart: true,
      max_memory_restart: '128M',
      env: {
        NODE_ENV: 'production',
        SELECTOR_PORT: 3000,
        // Same token that used to live in unity-md/sl-aura config.env —
        // now polled from ONE place only (fixes the Telegram 409 conflict).
        TG_PAIR_BOT_TOKEN: '8193395159:AAFZ-ZarlGN3SFHCHHhmck2KJMlva0-F9Ls',
        UNITY_PORT: 3001,
        AURA_PORT: 3002,
      },
    },
    {
      name: 'UNITY-MD',
      // Runs rebuild-start.sh instead of start.js directly: on every
      // (re)start this wipes node_modules + logs and reinstalls first.
      script: 'rebuild-start.sh',
      interpreter: 'bash',
      cwd: './unity-md',
      watch: false,
      autorestart: true,
      max_memory_restart: '512M',
      env: { NODE_ENV: 'production' },
    },
    {
      name: 'SL-AURA',
      // Runs rebuild-start.sh instead of start.js directly: on every
      // (re)start this wipes node_modules + logs and reinstalls first.
      script: 'rebuild-start.sh',
      interpreter: 'bash',
      cwd: './sl-aura',
      watch: false,
      autorestart: true,
      max_memory_restart: '512M',
      env: { NODE_ENV: 'production' },
    },
  ],
};
