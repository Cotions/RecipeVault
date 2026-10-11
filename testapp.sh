#!/bin/bash
# RecipeVault — run a throwaway instance.
#
#   ./testapp.sh            a copy of your real vault, your accounts
#   ./testapp.sh --demo     an invented vault instead (no real data involved)
#   ./testapp.sh --reset    throw the copy away and take a fresh one from live
#   ./testapp.sh --status   show what exists and where, then exit
#
# The test instance runs on port 3379 with its own config, so the live app
# never sees it. The copy has no git remote and "git_push": false: nothing it
# saves can reach GitHub. It listens on this machine only. With bubblewrap
# installed, the real vault and ~/.config/recipevault are read-only for it.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
CONFIG_HOME="${XDG_CONFIG_HOME:-$HOME/.config}/recipevault"
LIVE_CONFIG="$CONFIG_HOME/config.json"
DEMO_DIR="${RECIPEVAULT_DEMO_DIR:-${XDG_CACHE_HOME:-$HOME/.cache}/recipevault-demo}"
PORT="${RECIPEVAULT_TEST_PORT-3379}"

say()  { printf '\033[1;32m▸\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m✗\033[0m %s\n' "$*" >&2; exit 1; }

MODE=start
for arg in "$@"; do
  case "$arg" in
    --demo)   MODE=demo ;;
    --reset)  MODE=reset ;;
    --status) MODE=status ;;
    # The comment block under the #! line, up to the first line that is not one.
    --help|-h) awk 'NR == 1 { next } !/^#/ { exit } { sub(/^# ?/, ""); print }' "$0"; exit 0 ;;
    *) die "Unknown option: $arg (try --help)" ;;
  esac
done

cd "$ROOT"
command -v node &>/dev/null || die "node not found (Node 24.7 or later)"

# One value of a JSON config: $1 the file, $2 the key. Empty when absent.
json_get() {
  node -e 'const c = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); const v = c[process.argv[2]]; process.stdout.write(v === undefined ? "" : String(v))' "$1" "$2"
}
busy() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }

# --- port ---------------------------------------------------------------
# Never the live app's: 3370, or the port in its config.
[[ "$PORT" =~ ^[0-9]{1,5}$ ]] && (( 10#$PORT >= 1 && 10#$PORT <= 65535 )) \
  || die "RECIPEVAULT_TEST_PORT must be a port number from 1 to 65535, not '$PORT'"
PORT=$((10#$PORT))
LIVE_PORT=3370
if [ -f "$LIVE_CONFIG" ]; then
  LIVE_PORT="$(json_get "$LIVE_CONFIG" port)" || die "Cannot read $LIVE_CONFIG"
  [ -n "$LIVE_PORT" ] || LIVE_PORT=3370
fi
[ "$PORT" != 3370 ] && [ "$PORT" != "$LIVE_PORT" ] \
  || die "RECIPEVAULT_TEST_PORT must not be the live app's port ($PORT)"
# --- port end -----------------------------------------------------------

if [ "$MODE" != status ]; then
  [ -d node_modules ] || die "Dependencies not installed. Run ./run.sh once."
  [ -f build/index.js ] || die "App not built. Run: ./run.sh --build"
  ! busy "$PORT" || die "Port $PORT is already in use. Set RECIPEVAULT_TEST_PORT to something else."
fi

# --- demo: invented data, nothing to protect -------------------------------
if [ "$MODE" = demo ]; then
  # fixture-vault.ts refuses a folder it did not make.
  [ -f "$DEMO_DIR/config.json" ] || node_modules/.bin/tsx scripts/fixture-vault.ts "$DEMO_DIR" "$PORT" --corpus >/dev/null
  say "Demo instance → http://localhost:$PORT"
  say "Sign in as proprio / proprio-mot-de-passe (or cuisine / cuisine-mot-de-passe)"
  exec env "RECIPEVAULT_CONFIG=$DEMO_DIR/config.json" "RECIPEVAULT_PORT=$PORT" NODE_ENV=production node bin/serve.js
fi

[ -f "$LIVE_CONFIG" ] || die "No live config at $LIVE_CONFIG. Use --demo, or see docs/DEPLOY.md."

# --- test data ----------------------------------------------------------
# One folder beside the real vault holds everything: the copy (vault/), its
# config and a copy of the accounts. Only a folder this script made (it
# carries a .recipevault-test marker) is ever reset or written into.
LIVE_VAULT="$(json_get "$LIVE_CONFIG" vault_directory)" || die "Cannot read $LIVE_CONFIG"
[[ "$LIVE_VAULT" = /* ]] || die "vault_directory in $LIVE_CONFIG must be an absolute path, not '$LIVE_VAULT'"
LIVE_VAULT="$(realpath -m -- "$LIVE_VAULT")"

TEST_DIR="${RECIPEVAULT_TEST_DIR:-$LIVE_VAULT-test}"
[[ "$TEST_DIR" = /* ]] || die "RECIPEVAULT_TEST_DIR must be an absolute path, not '$TEST_DIR'"
TEST_DIR="$(realpath -m -- "$TEST_DIR")"
TEST_VAULT="$TEST_DIR/vault"
TEST_CONFIG="$TEST_DIR/config.json"
TEST_MARK="$TEST_DIR/.recipevault-test"

under() { [ "$1" = "$2" ] || [[ "$1" == "${2%/}/"* ]]; }    # $1 is $2 or inside it
for p in "$LIVE_VAULT" "$(realpath -m -- "$CONFIG_HOME")" "$ROOT"; do
  if under "$TEST_DIR" "$p" || under "$p" "$TEST_DIR"; then
    die "Test folder $TEST_DIR overlaps $p. Set RECIPEVAULT_TEST_DIR elsewhere."
  fi
done
for p in "${HOME:-/}" /; do
  p="$(realpath -m -- "$p")"
  ! under "$p" "$TEST_DIR" || die "Test folder $TEST_DIR would hold $p. Set RECIPEVAULT_TEST_DIR elsewhere."
done

marked() { [ -f "$TEST_MARK" ] && [ ! -L "$TEST_MARK" ]; }
if [ "$MODE" != status ] && { [ -e "$TEST_DIR" ] || [ -L "$TEST_DIR" ]; } && ! marked; then
  die "$TEST_DIR exists but has no .recipevault-test marker, so testapp.sh did not make it; nothing was changed. If it is an old test copy, check it, remove it by hand (rm -rf -- '$TEST_DIR') and run again; otherwise set RECIPEVAULT_TEST_DIR to a new folder."
fi
# --- test data end ------------------------------------------------------

if [ "$MODE" = status ]; then
  echo "live config   $LIVE_CONFIG"
  echo "live vault    $LIVE_VAULT"
  echo "live port     $LIVE_PORT"
  if [ -d "$TEST_DIR" ]; then
    echo "test folder   $TEST_DIR ($(du -sh "$TEST_DIR" | cut -f1)$(marked || echo ', no .recipevault-test marker: not made here'))"
  else
    echo "test folder   $TEST_DIR (not created yet)"
  fi
  echo "test port     $PORT"
  exit 0
fi

[ -d "$LIVE_VAULT/recipes" ] || die "$LIVE_VAULT is not a vault (no recipes/ folder)"

# --- test copy ----------------------------------------------------------
if [ "$MODE" = reset ] && [ -d "$TEST_DIR" ]; then
  marked || die "Not removing $TEST_DIR: it has no .recipevault-test marker"
  say "Removing the old copy at $TEST_DIR"
  rm -rf -- "$TEST_DIR"
fi

if [ ! -d "$TEST_VAULT/recipes" ]; then
  mkdir -p "$TEST_DIR"
  marked || printf 'A test copy made by RecipeVault'"'"'s testapp.sh; --reset deletes this folder.\n' > "$TEST_MARK"
  say "Copying your vault to $TEST_VAULT"
  rm -rf -- "$TEST_VAULT"
  cp -a -- "$LIVE_VAULT" "$TEST_VAULT"
  # The index and the sessions are rebuilt, not shared with the live app.
  rm -rf -- "$TEST_VAULT/cache"
  # No remote: nothing saved here can be pushed, whatever the config says.
  if [ -d "$TEST_VAULT/.git" ]; then
    rm -f -- "$TEST_VAULT/.git/index.lock"
    for r in $(git -C "$TEST_VAULT" remote); do git -C "$TEST_VAULT" remote remove "$r"; done
  fi
fi
# --- test copy end ------------------------------------------------------

# The live config on the copy, never config.json itself: this machine only, no push.
node - "$LIVE_CONFIG" "$TEST_CONFIG" "$TEST_VAULT" "$PORT" <<'JS'
const fs = require('fs');
const [live, out, vault, port] = process.argv.slice(2);
const c = JSON.parse(fs.readFileSync(live, 'utf8'));
Object.assign(c, { vault_directory: vault, port: Number(port), host: '127.0.0.1', git_push: false });
fs.writeFileSync(out, JSON.stringify(c, null, 2) + '\n');
JS
# Accounts live beside the config: a copy, so yours work here and a change made here stays here.
if [ -f "$CONFIG_HOME/users.json" ]; then
  [ -f "$TEST_DIR/users.json" ] || install -m 600 -- "$CONFIG_HOME/users.json" "$TEST_DIR/users.json"
else
  warn "No accounts at $CONFIG_HOME/users.json: pages open, but nobody can save (npx vault user add)."
fi

CMD=(env "RECIPEVAULT_CONFIG=$TEST_CONFIG" "RECIPEVAULT_PORT=$PORT" NODE_ENV=production node bin/serve.js)

if command -v bwrap &>/dev/null; then
  say "Sandbox on: the real vault and $CONFIG_HOME are read-only for this instance"
  CMD=(bwrap --dev-bind / / --ro-bind "$LIVE_VAULT" "$LIVE_VAULT" --ro-bind "$CONFIG_HOME" "$CONFIG_HOME" --die-with-parent "${CMD[@]}")
else
  warn "bwrap not found — running without the read-only protection"
fi

say "Test instance → http://localhost:$PORT   (live app stays on $LIVE_PORT)"
exec "${CMD[@]}"
