#!/usr/bin/env bash
set -euo pipefail

###############################################################################
# upload.sh — bash entry for upload.py
#
# Asserts that the active switchboard profile is `local` (safety guard against
# accidental remote uploads), then delegates to upload.py.
#
# Usage:
#   bash scripts/drive-sync/upload.sh <data-dir> [drive-name]
#
# Env:
#   PROFILE            override profile name to assert (default: local)
#   PREFERRED_EDITOR   drive-level editor module (default: knowledge-vault)
#   EXISTING_DRIVE     drive id to upload into (skip drive creation)
#   THROTTLE_MS        sleep between mutations
###############################################################################

DATA_DIR="${1:?Usage: $0 <data-dir> [drive-name]}"
DRIVE_NAME="${2:-knowledge vault}"
PROFILE="${PROFILE:-local}"
PREFERRED_EDITOR="${PREFERRED_EDITOR:-knowledge-vault}"
EXISTING_DRIVE="${EXISTING_DRIVE:-}"
THROTTLE_MS="${THROTTLE_MS:-0}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/common.sh"

step "Preflight"
preflight
assert_profile "$PROFILE"

step "Running upload.py"
EXTRA=()
[ -n "$EXISTING_DRIVE" ] && EXTRA+=(--existing-drive "$EXISTING_DRIVE")
[ "$THROTTLE_MS" != "0" ] && EXTRA+=(--throttle-ms "$THROTTLE_MS")

python3 "$SCRIPT_DIR/upload.py" \
    --data "$DATA_DIR" \
    --drive-name "$DRIVE_NAME" \
    --preferred-editor "$PREFERRED_EDITOR" \
    "${EXTRA[@]}"
