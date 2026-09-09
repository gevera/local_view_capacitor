#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

WWW="$ROOT/mobile/www"
ASSETS_SRC="$ROOT/priv/static/assets"
ASSETS_DST="$WWW/assets"

echo "[mobile] Building Phoenix assets…"
mix assets.build

if [[ ! -d "$ASSETS_SRC" ]]; then
  echo "[mobile] Missing $ASSETS_SRC — run mix setup first." >&2
  exit 1
fi

if [[ ! -f "$WWW/index.html" ]]; then
  echo "[mobile] Missing $WWW/index.html" >&2
  exit 1
fi

echo "[mobile] Copying assets into mobile/www…"
rm -rf "$ASSETS_DST"
mkdir -p "$ASSETS_DST"
# Android asset merger treats foo and foo.gz as the same resource; skip compressed
# and source-map siblings that Phoenix may emit alongside the runtime files.
rsync -a --exclude='*.gz' --exclude='*.map' "$ASSETS_SRC/" "$ASSETS_DST/"

# Hostless shell loads absolute /assets paths (same as the Phoenix offline page).
# Capacitor serves mobile/www as the web root, so /assets maps to mobile/www/assets.
if [[ ! -f "$ASSETS_DST/js/app.js" ]]; then
  echo "[mobile] Expected $ASSETS_DST/js/app.js after copy." >&2
  exit 1
fi

if [[ ! -d "$ROOT/android" ]]; then
  echo "[mobile] Android platform missing; run: npx cap add android" >&2
  exit 1
fi

echo "[mobile] Syncing Capacitor Android project…"
npx cap sync android

echo "[mobile] Ready. Build the debug APK with: npm run mobile:apk"
