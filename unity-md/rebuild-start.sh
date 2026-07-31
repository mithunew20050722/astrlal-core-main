#!/bin/bash
# ASTRAL CORE — UNITY-MD rebuild-on-restart wrapper.
#
# FIX (2026-07-31): Replaced flock (not supported on Termux/Android) with
# a simple file-based lock using mkdir (atomic on all filesystems).

set -e
cd "$(dirname "$0")"

LOCK_DIR="$(pwd)/../.rebuild.lock"

MAX_WAIT=300  # 5 minutes max wait for lock
ELAPSED=0

# Atomic lock via mkdir — fails if another process holds it
while ! mkdir "$LOCK_DIR" 2>/dev/null; do
  if [ "$ELAPSED" -ge "$MAX_WAIT" ]; then
    echo "[REBUILD] UNITY-MD — lock timeout after ${MAX_WAIT}s, force-cleaning and proceeding..."
    rm -rf "$LOCK_DIR"
    mkdir -p "$LOCK_DIR"
    break
  fi
  echo "[REBUILD] UNITY-MD — waiting for install lock (shared with sl-aura)..."
  sleep 2
  ELAPSED=$((ELAPSED + 2))
done

# Ensure lock is cleaned up on exit
trap 'rm -rf "$LOCK_DIR"' EXIT

echo "[REBUILD] UNITY-MD — got the lock. Removing node_modules and logs..."
rm -rf node_modules logs

echo "[REBUILD] UNITY-MD — running npm ci (exact install from package-lock.json)..."
if ! npm ci --no-audit --no-fund --ignore-scripts; then
  echo "[REBUILD] UNITY-MD — npm ci failed, falling back to npm install..."
  npm install --no-audit --no-fund --ignore-scripts
fi

echo "[REBUILD] UNITY-MD — starting bot..."
exec node start.js
