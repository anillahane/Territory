#!/bin/sh
set -eu

STAMP_FILE="node_modules/.package-lock.sha256"
CURRENT_HASH="$(sha256sum package-lock.json | awk '{ print $1 }')"
STORED_HASH=""

if [ -f "$STAMP_FILE" ]; then
  STORED_HASH="$(cat "$STAMP_FILE")"
fi

if [ ! -d node_modules ] || [ "$STORED_HASH" != "$CURRENT_HASH" ]; then
  echo "Refreshing backend dependencies with npm ci..."
  npm ci --no-audit --fund=false
  printf '%s\n' "$CURRENT_HASH" > "$STAMP_FILE"
fi

exec "$@"
