#!/bin/bash
# RecipeVault — start a bundled app on an invented vault and check it serves.
#
#   scripts/smoke_test.sh ./dist/recipevault/recipevault
#
# Run by the release workflow before it publishes. The app gets a fixture
# vault (scripts/fixture-vault.ts) and a HOME of its own in a temp dir:
# nothing of yours is read or written. SMOKE_PORT (3392) is the port,
# SMOKE_VERSION what --version must say.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN="${1:?usage: scripts/smoke_test.sh <path to the bundled recipevault launcher>}"
PORT="${SMOKE_PORT:-3392}"

die() { printf '\033[1;31m✗\033[0m %s\n' "$*" >&2; exit 1; }

[ -x "$BIN" ] || die "No executable at $BIN. Run ./bundle.sh first."
BIN="$(realpath -- "$BIN")"
# Never the live app's port nor testapp.sh's.
[[ "$PORT" =~ ^[0-9]{1,5}$ ]] && (( 10#$PORT >= 1 && 10#$PORT <= 65535 )) \
  || die "SMOKE_PORT must be a port number from 1 to 65535, not '$PORT'"
[ "$PORT" != 3370 ] && [ "$PORT" != 3379 ] || die "SMOKE_PORT must not be the live or the test app's port ($PORT)"
! (exec 3<>"/dev/tcp/127.0.0.1/$PORT") 2>/dev/null || die "Port $PORT is already in use. Set SMOKE_PORT to something else."

WORK="$(mktemp -d)"
PID=
cleanup() {
  [ -z "$PID" ] || kill "$PID" 2>/dev/null || true
  rm -rf -- "$WORK"
}
trap cleanup EXIT

if [ -n "${SMOKE_VERSION:-}" ]; then
  [ "$("$BIN" --version)" = "$SMOKE_VERSION" ] || die "--version says $("$BIN" --version), not $SMOKE_VERSION"
fi

(cd "$ROOT" && node_modules/.bin/tsx scripts/fixture-vault.ts "$WORK/vault" "$PORT" >/dev/null)
mkdir -p "$WORK/home"
ENV=(env "HOME=$WORK/home" "XDG_CONFIG_HOME=$WORK/home/.config" "RECIPEVAULT_CONFIG=$WORK/vault/config.json")

# The vault command runs from the bundle.
(cd "$WORK" && "${ENV[@]}" "$BIN" vault --help >/dev/null) || die "recipevault vault --help failed"

(cd "$WORK" && exec "${ENV[@]}" "$BIN") > "$WORK/log" 2>&1 &
PID=$!
for _ in $(seq 60); do
  curl -fsS -o /dev/null "http://127.0.0.1:$PORT/connexion" 2>/dev/null && break
  kill -0 "$PID" 2>/dev/null || { cat "$WORK/log" >&2; die "The app exited at startup"; }
  sleep 0.5
done
for path in / /connexion /r/crepes; do
  code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT$path")"
  [ "$code" = 200 ] || { cat "$WORK/log" >&2; die "GET $path answered $code"; }
done
printf '\033[1;32m▸\033[0m %s\n' "Smoke test passed ($("$BIN" --version))"
