#!/usr/bin/env sh
set -eu

INSTALL_ROOT="${HOME}/.codex-mcp/npm"
MANAGED_BIN="${HOME}/.codex-mcp/bin"

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

success() {
  status '✓' '32' "$1"
}

if [ ! -e "$INSTALL_ROOT" ] && [ ! -e "$MANAGED_BIN" ]; then
  info "codex-mcp is no longer installed on this computer."
  exit 0
fi

rm -rf "$INSTALL_ROOT" "$MANAGED_BIN"

remove_path_line() {
  profile="$1"
  [ -f "$profile" ] || return 0
  tmp="${profile}.codex-mcp.tmp.$$"
  cp -p "$profile" "$tmp"
  awk '$0 != "# codex-mcp" && $0 != "export PATH=\"$HOME/.codex-mcp/npm/bin:$PATH\""' "$profile" > "$tmp"
  mv "$tmp" "$profile"
}

remove_path_line "${HOME}/.zshrc"
remove_path_line "${HOME}/.bashrc"
remove_path_line "${HOME}/.bash_profile"
remove_path_line "${HOME}/.profile"

success "codex-mcp application removed."
printf '%s\n' ""
info "Your configuration, connection password, and Tunnel settings are preserved in: ${HOME}/.codex-mcp"
info "These settings can be reused when you reinstall codex-mcp."
