#!/bin/bash
# RecipeVault — build one self-contained app folder.
#
#   ./bundle.sh             build ./dist/recipevault/
#   ./bundle.sh --install   build, then install: the `recipevault` command, an
#                           app menu entry and a systemd user unit (not started)
#   ./bundle.sh --uninstall remove the installed copy (config and vault stay)
#
# The folder carries the built app, the vault command and their dependencies,
# for this machine's kind (Linux x64 or arm64); it needs Node 24.7 or later and
# nothing else. It
# reads ~/.config/recipevault/config.json like ./run.sh does and writes nothing
# next to itself.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
OUT="$ROOT/dist/recipevault"

BIN_DIR="$HOME/.local/bin"
DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
APP_HOME="$DATA_HOME/recipevault"
ICON_DIR="$DATA_HOME/icons/hicolor/scalable/apps"
APP_DIR="$DATA_HOME/applications"
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
UNIT="$UNIT_DIR/recipevault.service"
# The first line of the unit this script writes: one written by hand is left alone.
UNIT_MARK="# systemd user unit for the installed RecipeVault (./bundle.sh --install)."

say()  { printf '\033[1;32m▸\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m✗\033[0m %s\n' "$*" >&2; exit 1; }

MODE=build
for arg in "$@"; do
  case "$arg" in
    --install)   MODE=install ;;
    --uninstall) MODE=uninstall ;;
    # The comment block under the #! line, up to the first line that is not one.
    --help|-h) awk 'NR == 1 { next } !/^#/ { exit } { sub(/^# ?/, ""); print }' "$0"; exit 0 ;;
    *) die "Unknown option: $arg (try --help)" ;;
  esac
done

refresh_menu() {
  command -v update-desktop-database &>/dev/null && update-desktop-database "$APP_DIR" 2>/dev/null || true
}
ours() { [ -f "$UNIT" ] && [ "$(head -n 1 "$UNIT")" = "$UNIT_MARK" ]; }
# Only a folder this script installed (it holds the app's VERSION file) is replaced or removed.
installed() { [ -f "$APP_HOME/VERSION" ] && [ -f "$APP_HOME/recipevault" ]; }

# --- uninstall ------------------------------------------------------------
if [ "$MODE" = uninstall ]; then
  rm -f "$BIN_DIR/recipevault" "$ICON_DIR/recipevault.svg" "$APP_DIR/RecipeVault.desktop"
  if installed; then rm -rf -- "$APP_HOME"; fi
  if ours; then
    systemctl --user disable --now recipevault &>/dev/null || true
    rm -f "$UNIT"
    systemctl --user daemon-reload &>/dev/null || true
  fi
  refresh_menu
  say "Uninstalled. Your config, accounts and vault were left untouched."
  exit 0
fi

cd "$ROOT"

# --- node -----------------------------------------------------------------
command -v node &>/dev/null || die "node not found (Node 24.7 or later)"
command -v npm &>/dev/null || die "npm not found"
node -e 'const [a, b] = process.versions.node.split(".").map(Number); process.exit(a > 24 || (a === 24 && b >= 7) ? 0 : 1)' \
  || die "Node 24.7 or later is needed, this is $(node -v)"

# --- build ----------------------------------------------------------------
# Installed again when the lockfile is newer than what npm last installed, as ./run.sh does.
if [ ! -f node_modules/.package-lock.json ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then
  say "Installing dependencies"
  npm ci
fi
say "Building"
npm run build
[ -f build/index.js ] || die "The build produced no build/index.js"

# --- bundle ---------------------------------------------------------------
# What runs: the built server, the entries in bin/, the library and the CLI
# they load through tsx, and the three docs the vault command reads.
say "Bundling"
rm -rf -- "$OUT"
mkdir -p "$OUT/src" "$OUT/docs"
cp -r build bin "$OUT/"
cp -r src/lib src/cli "$OUT/src/"
cp docs/AI-TEMPLATE.md docs/VOCAB.md docs/INGREDIENTS-SEED.yaml "$OUT/docs/"
cp package.json package-lock.json "$OUT/"
install -m 755 packaging/recipevault "$OUT/recipevault"
# RECIPEVAULT_VERSION is the tag a release is built from.
VERSION="${RECIPEVAULT_VERSION:-$(git describe --tags --always --dirty 2>/dev/null || echo unknown)}"
printf '%s\n' "$VERSION" > "$OUT/VERSION"

say "Installing the runtime dependencies into the bundle"
# No install script is needed: better-sqlite3 and sharp ship their binaries as
# files, and --ignore-scripts skips package.json's own `prepare`.
(cd "$OUT" && npm ci --omit=dev --ignore-scripts --no-audit --no-fund)

[ "$("$OUT/recipevault" --version)" = "$VERSION" ] || die "Build failed: $OUT/recipevault does not run"
say "Built $OUT ($(du -sh "$OUT" | cut -f1), $VERSION)"

if [ "$MODE" = build ]; then
  say "Run it:      $OUT/recipevault"
  say "Install it:  ./bundle.sh --install"
  exit 0
fi

# --- install --------------------------------------------------------------
if [ -e "$APP_HOME" ] && ! installed; then
  die "$APP_HOME exists and is not a RecipeVault install; nothing was changed."
fi
NODE="$(command -v node)"
mkdir -p "$BIN_DIR" "$ICON_DIR" "$APP_DIR" "$UNIT_DIR"
rm -rf -- "$APP_HOME"
cp -r "$OUT" "$APP_HOME"
# The command: the bundle's launcher, with this machine's node (a service and
# the app menu have no shell profile, so no nvm on their PATH).
cat > "$BIN_DIR/recipevault" <<EOF
#!/bin/sh
RECIPEVAULT_NODE="\${RECIPEVAULT_NODE:-$NODE}" exec "$APP_HOME/recipevault" "\$@"
EOF
chmod 755 "$BIN_DIR/recipevault"
install -m 644 packaging/recipevault.svg "$ICON_DIR/recipevault.svg"
say "Installed $BIN_DIR/recipevault ($VERSION, node at $NODE)"

# Quoted as the desktop entry spec and systemd want, so a space in $HOME does
# not split it. A path with a character that needs more than quotes there (or
# that sed reads) gets no menu entry and no unit rather than wrong ones.
case "$BIN_DIR" in
  *[\\\"\`\$%\|\&]*|*$'\n'*)
    warn "No app menu entry and no service unit: $BIN_DIR has a character they cannot hold as it is."
    exit 0 ;;
esac
sed -e "s|__EXEC__|\"$BIN_DIR/recipevault\"|" -e "s|__ICON__|recipevault|" \
  packaging/RecipeVault.desktop > "$APP_DIR/RecipeVault.desktop"
chmod 644 "$APP_DIR/RecipeVault.desktop"
refresh_menu

if [ ! -e "$UNIT" ] || ours; then
  sed -e "s|__EXEC__|\"$BIN_DIR/recipevault\"|" packaging/recipevault.service > "$UNIT"
  systemctl --user daemon-reload &>/dev/null || true
  if systemctl --user is-active --quiet recipevault 2>/dev/null; then
    say "The service is running the old copy: systemctl --user restart recipevault"
  else
    say "As a service:  systemctl --user enable --now recipevault"
  fi
else
  warn "$UNIT was not written by this script and was left as it is."
fi

say "Or run it by hand: recipevault (the app menu entry opens the browser too)"
case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) warn "$BIN_DIR is not on your PATH." ;;
esac
say "It reads the same config as ./run.sh, so it opens the same vault: run one or the other, not both."
