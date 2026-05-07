#!/usr/bin/env bash
set -euo pipefail

###############################################################################
# reindex.sh — Phase 5 wrapper. Triggers reindex on the local switchboard's
# knowledge-graph subgraph. Reads drive id from upload-summary.json.
#
# Usage:
#   bash scripts/drive-sync/reindex.sh <data-dir>
#
# Env:
#   ENDPOINT  override subgraph URL (default: http://localhost:4001/graphql/knowledgeGraph)
###############################################################################

DATA_DIR="${1:?Usage: $0 <data-dir>}"
ENDPOINT="${ENDPOINT:-http://localhost:4001/graphql/knowledgeGraph}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/common.sh"

step "Phase 5: reindex"
python3 "$SCRIPT_DIR/reindex.py" \
    --endpoint "$ENDPOINT" \
    --data "$DATA_DIR"
