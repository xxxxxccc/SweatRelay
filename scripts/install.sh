#!/usr/bin/env sh
# SweatRelay CLI installer.
#
#   curl -fsSL https://raw.githubusercontent.com/xxxxxccc/SweatRelay/main/scripts/install.sh | sh
#
# Env vars:
#   SWEATRELAY_VERSION   Specific tag (e.g. v0.1.0) or "nightly". Default: latest release.
#   SWEATRELAY_INSTALL   Install dir. Default: /usr/local/bin (sudo if needed) or ~/.local/bin
#   SWEATRELAY_REPO      owner/repo override. Default: xxxxxccc/SweatRelay
set -eu

REPO="${SWEATRELAY_REPO:-xxxxxccc/SweatRelay}"
VERSION="${SWEATRELAY_VERSION:-}"

err() { printf '\033[31merror:\033[0m %s\n' "$*" >&2; exit 1; }
info() { printf '\033[36m→\033[0m %s\n' "$*"; }

case "$(uname -s)" in
  Darwin) os=darwin ;;
  Linux) err "Linux is not supported yet. Build from source: git clone + pnpm cli." ;;
  MINGW*|MSYS*|CYGWIN*) err "Windows: use install.ps1 or download from GitHub Releases" ;;
  *) err "unsupported OS: $(uname -s)" ;;
esac

case "$(uname -m)" in
  arm64|aarch64) arch=arm64 ;;
  x86_64|amd64) err "Intel Mac is not supported. Use Apple Silicon, or build from source." ;;
  *) err "unsupported arch: $(uname -m)" ;;
esac

asset="sweatrelay-${os}-${arch}"

# Resolve version
if [ -z "$VERSION" ]; then
  info "Resolving latest release..."
  VERSION=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" \
    | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -n1)
  [ -n "$VERSION" ] || err "could not resolve latest version; set SWEATRELAY_VERSION"
fi

url="https://github.com/${REPO}/releases/download/${VERSION}/${asset}"
info "Downloading ${url}"

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
curl -fsSL "$url" -o "$tmp/sweatrelay"
chmod +x "$tmp/sweatrelay"

# Pick install dir
if [ -n "${SWEATRELAY_INSTALL:-}" ]; then
  dest="$SWEATRELAY_INSTALL"
elif [ -w "/usr/local/bin" ]; then
  dest="/usr/local/bin"
elif command -v sudo >/dev/null 2>&1; then
  dest="/usr/local/bin"
  use_sudo=1
else
  dest="$HOME/.local/bin"
  mkdir -p "$dest"
fi

target="$dest/sweatrelay"
if [ "${use_sudo:-0}" = "1" ]; then
  sudo install -m 0755 "$tmp/sweatrelay" "$target"
else
  install -m 0755 "$tmp/sweatrelay" "$target"
fi

info "Installed: $target"
"$target" --version || true

case ":$PATH:" in
  *":$dest:"*) ;;
  *) printf '\033[33m!\033[0m %s is not in your PATH. Add: export PATH="%s:$PATH"\n' "$dest" "$dest" ;;
esac
