#!/usr/bin/env sh
set -eu

PACKAGE="${CODEX_MCP_PACKAGE:-https://github.com/meesii/codex-mcp/releases/latest/download/codex-mcp.tgz}"
INSTALL_ROOT="${HOME}/.codex-mcp/npm"
BIN_DIR="${INSTALL_ROOT}/bin"

say() {
  printf '%s\n' "$1"
}

status() {
  marker="$1"
  color="$2"
  message="$3"
  if [ -t 1 ] && [ -z "${NO_COLOR+x}" ]; then
    printf '\033[%sm%s %s\033[0m\n' "$color" "$marker" "$message"
  else
    printf '%s %s\n' "$marker" "$message"
  fi
}

info() {
  status 'ℹ' '36' "$1"
}

warn() {
  status '!' '33' "$1"
}

success() {
  status '✓' '32' "$1"
}

fail() {
  if [ -t 2 ] && [ -z "${NO_COLOR+x}" ]; then
    printf '\033[31m✗ Installation failed: %s\033[0m\n' "$1" >&2
  else
    printf '✗ Installation failed: %s\n' "$1" >&2
  fi
  exit 1
}

command -v node >/dev/null 2>&1 || fail "Node.js not found. Install Node.js 22 or later first."
command -v npm >/dev/null 2>&1 || fail "npm not found. Reinstalling Node.js usually fixes this."

NODE_MAJOR="$(node -p 'Number(process.versions.node.split(".")[0])')"
[ "$NODE_MAJOR" -ge 22 ] || fail "Current Node.js version is $(node -v); version 22 or later is required."

if [ "${CODEX_MCP_UPDATE:-}" = "1" ]; then
  info "Updating codex-mcp…"
else
  info "Installing codex-mcp…"
fi
mkdir -p "$INSTALL_ROOT"
npm install --global --prefix "$INSTALL_ROOT" "$PACKAGE"

[ -x "$BIN_DIR/codex-mcp" ] || fail "Installation complete, but the codex-mcp command was not found."

TOOLS_CLI="$INSTALL_ROOT/lib/node_modules/@meesii/codex-mcp/dist/managed-tools/cli.js"
[ -f "$TOOLS_CLI" ] || fail "Installation complete, but the runtime tool manager is missing."
info "Preparing required tools…"
node "$TOOLS_CLI" bootstrap || fail "Required tool preparation failed. Check your network and rerun installation."
success "Required tools ready"

add_path_line() {
  profile="$1"
  line='export PATH="$HOME/.codex-mcp/npm/bin:$PATH"'
  if [ -f "$profile" ] && grep -F '.codex-mcp/npm/bin' "$profile" >/dev/null 2>&1; then
    return
  fi
  printf '\n# codex-mcp\n%s\n' "$line" >> "$profile"
}

SHELL_NAME="$(basename "${SHELL:-sh}")"
case "$SHELL_NAME" in
  zsh) PROFILE="${HOME}/.zshrc" ;;
  bash)
    if [ "$(uname -s 2>/dev/null || true)" = "Darwin" ]; then
      PROFILE="${HOME}/.bash_profile"
    else
      PROFILE="${HOME}/.bashrc"
    fi
    ;;
  *) PROFILE="${HOME}/.profile" ;;
esac

add_path_line "$PROFILE"
export PATH="$BIN_DIR:$PATH"

VERSION="$(codex-mcp --version 2>/dev/null || true)"
say ""
success "codex-mcp ${VERSION:-Installed}"
success "Command directory added to PATH: ${BIN_DIR}"
say ""
if [ "${CODEX_MCP_UPDATE:-}" = "1" ]; then
  success "Update complete. Configuration, connection password, and Tunnel settings are preserved."
  warn "Restart any running codex-mcp service; existing processes do not automatically load the updated core tool schema."
else
  info "For first use, run: codex-mcp open"
  info "Or run in a project directory: codex-mcp start"
  warn "If this terminal cannot find codex-mcp, open a new terminal window."
fi
