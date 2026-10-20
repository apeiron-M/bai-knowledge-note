#!/usr/bin/env bash
# One command from source rows to trainable JSONL with the current prompt
# format: dedup/leak filter -> zod + reducer replay -> chat-core render ->
# llama-server template/token parity.
#   training/scripts/render.sh <rows.jsonl> <out-dir>
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ROWS="$1"; OUT="$2"
PY="$ROOT/training/.venv/bin/python"
mkdir -p "$OUT"
cd "$ROOT"
"$PY" training/py/dedup.py "$ROWS" --out "$OUT/rows-kept.jsonl" --report "$OUT/dedup-report.json" > /dev/null
# zod + reducer replay; failing rows are dropped (listed in validate.json).
npx --no-install tsx training/gen/validate-rows.ts "$OUT/rows-kept.jsonl" "$OUT/validate.json" "$OUT/rows-valid.jsonl" > /dev/null \
  || { echo "no row passed validation, see $OUT/validate.json" >&2; exit 1; }
npx --no-install tsx training/gen/render-prompts.ts "$OUT/rows-valid.jsonl" "$OUT/rendered.jsonl"
"$PY" training/py/render_template.py "$OUT/rendered.jsonl" --out "$OUT/train.jsonl" --report "$OUT/template-report.json"
