#!/bin/bash
# RecipeVault — one-click start from source.
#
#   ./run.sh          install and build if needed, then start the app
#   ./run.sh --dev    Vite dev server with hot reload
#   ./run.sh --build  rebuild, then start
#   ./run.sh --test   type check and unit tests
#
# This is the real app: it reads ~/.config/recipevault/config.json, so it opens
# your real vault (and pushes it, with "git_push": true). --dev does too. For a
# throwaway instance use ./testapp.sh.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"

# --- relaunch inside a terminal when double-clicked ------------------------
if ! [ -t 0 ] && ! [ -t 1 ] && [ -z "${TERM:-}" ] && [ "${RECIPEVAULT_NO_TERMINAL:-}" != "1" ]; then
  for term in gnome-terminal xfce4-terminal konsole xterm; do
    command -v "$term" &>/dev/null || continue
    case "$term" in
      gnome-terminal) exec "$term" -- bash "$0" "$@" ;;
      konsole)        exec "$term" -e bash "$0" "$@" ;;
      *)              exec "$term" -e "bash \"$0\" $*" ;;
    esac
  done
  exit 0
fi

say() { printf '\033[1;32m▸\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m✗\033[0m %s\n' "$*" >&2; exit 1; }

MODE=start
for arg in "$@"; do
  case "$arg" in
    --dev)   MODE=dev ;;
    --build) MODE=build ;;
    --test)  MODE=test ;;
    # The comment block under the #! line, up to the first line that is not one.
    --help|-h) awk 'NR == 1 { next } !/^#/ { exit } { sub(/^# ?/, ""); print }' "$0"; exit 0 ;;
    *) die "Unknown option: $arg (try --help)" ;;
  esac
done

cd "$ROOT"

# --- node -----------------------------------------------------------------
# Passwords are hashed with node:crypto's argon2 (Node 24.7 and later).
command -v node &>/dev/null || die "node not found (Node 24.7 or later)"
command -v npm &>/dev/null || die "npm not found"
node -e 'const [a, b] = process.versions.node.split(".").map(Number); process.exit(a > 24 || (a === 24 && b >= 7) ? 0 : 1)' \
  || die "Node 24.7 or later is needed, this is $(node -v)"

# --- dependencies ---------------------------------------------------------
# Installed again when the lockfile is newer than what npm last installed.
if [ ! -f node_modules/.package-lock.json ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then
  say "Installing dependencies"
  npm ci
fi

if [ "$MODE" = test ]; then
  npm run check
  exec npm test
fi

if [ "$MODE" = dev ]; then
  say "Starting the Vite dev server on your real vault"
  exec npm run dev
fi

# --- build ----------------------------------------------------------------
is_stale() {
  [ ! -f build/index.js ] && return 0
  [ -n "$(find src static package.json package-lock.json vite.config.ts -newer build/index.js -print -quit 2>/dev/null)" ]
}
if [ "$MODE" = build ] || is_stale; then
  say "Building"
  npm run build
fi

# --- port -----------------------------------------------------------------
URL="$(node bin/url.js)" || exit 1
PORT="${URL##*:}"
if (exec 3<>"/dev/tcp/127.0.0.1/$PORT") 2>/dev/null; then
  die "Port $PORT is already in use: RecipeVault may be running already ($URL; as a service: systemctl --user status recipevault)."
fi

say "Starting RecipeVault on $URL"
NODE_ENV=production exec node bin/serve.js
