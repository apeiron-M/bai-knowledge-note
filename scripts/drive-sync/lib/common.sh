#!/usr/bin/env bash
###############################################################################
# common.sh — Shared helpers for drive-sync scripts (sourced, not executed)
###############################################################################

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log()  { echo -e "${GREEN}  ✓${NC} $*"; }
warn() { echo -e "${YELLOW}  !${NC} $*"; }
err()  { echo -e "${RED}  ✗${NC} $*" >&2; }
step() { echo -e "\n${CYAN}━━━ $* ━━━${NC}"; }
die()  { err "$@"; exit 1; }

# Assert all required tools exist and switchboard is reachable on the active profile.
preflight() {
  command -v switchboard >/dev/null 2>&1 || die "switchboard CLI not found"
  command -v python3     >/dev/null 2>&1 || die "python3 not found"
  switchboard ping --format json >/dev/null 2>&1 || die "Switchboard not reachable"
  log "Switchboard reachable"
}

# Print active profile name + url.
get_active_profile() {
  switchboard config show --format json 2>/dev/null \
    | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('name','?'), d.get('url','?'))" 2>/dev/null
}

# Refuse to proceed unless the active profile equals $1.
assert_profile() {
  local expected="$1"
  local info actual_name
  info=$(get_active_profile)
  actual_name=$(echo "$info" | cut -d' ' -f1)
  if [ "$actual_name" != "$expected" ]; then
    die "Expected profile '$expected' but active profile is '$actual_name'. Aborting."
  fi
  log "Profile: $actual_name"
}
