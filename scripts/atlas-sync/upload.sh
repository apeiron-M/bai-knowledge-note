#!/usr/bin/env bash
set -euo pipefail

###############################################################################
# upload.sh — bash entry for the Atlas vault rebuild.
#
# Mirrors scripts/drive-sync/upload.sh: asserts the active switchboard
# profile before doing anything, then delegates to atlas.py. The guard
# exists because `upload` writes ~1,500 documents — pointing it at the
# wrong reactor is not something you want to discover afterwards.
#
# Usage:
#   bash scripts/atlas-sync/upload.sh [target] [drive-name]
#
# Env:
#   PROFILE          switchboard profile to assert (default: matches target)
#   DATA_DIR         dataset directory (default: scripts/atlas-sync/data/atlas-vault)
#   EXISTING_DRIVE   drive id to upload into (skip drive creation)
#   THROTTLE_MS      sleep between mutations (use ~50 on remote)
#   ALL_LINK_TYPES   set to 1 to replay RELATES_TO too (default: structural only)
###############################################################################

TARGET="${1:-local}"
DRIVE_NAME="${2:-Atlas Vault}"
PROFILE="${PROFILE:-$TARGET}"
EXISTING_DRIVE="${EXISTING_DRIVE:-}"
THROTTLE_MS="${THROTTLE_MS:-0}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DATA_DIR="${DATA_DIR:-$SCRIPT_DIR/data/atlas-vault}"
source "$SCRIPT_DIR/../drive-sync/lib/common.sh"

step "Preflight"
preflight
assert_profile "$PROFILE"
[ -f "$DATA_DIR/manifest.json" ] || die "no snapshot at $DATA_DIR — run: atlas.py download --from remote"
log "Dataset: $DATA_DIR ($(python3 -c "import json;print(len(json.load(open('$DATA_DIR/manifest.json'))['documents']))") documents)"

step "Running atlas.py upload"
EXTRA=()
[ -n "$EXISTING_DRIVE" ] && EXTRA+=(--existing-drive "$EXISTING_DRIVE")
[ "$THROTTLE_MS" != "0" ] && EXTRA+=(--throttle-ms "$THROTTLE_MS")
[ "${ALL_LINK_TYPES:-0}" = "1" ] || EXTRA+=(--structural-only)

python3 -u "$SCRIPT_DIR/atlas.py" --data "$DATA_DIR" upload \
    --to "$TARGET" \
    --drive-name "$DRIVE_NAME" \
    "${EXTRA[@]}"
