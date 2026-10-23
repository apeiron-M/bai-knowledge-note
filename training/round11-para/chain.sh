#!/usr/bin/env bash
# Round 11 (X5) post-generation chain for one teacher results file:
#   rows (value / op-word / account checks) -> leak (held-out 1-4 + blind 5/6,
#   near-dups seeded with Round 10) -> render.sh (zod, replay, render, parity)
#   -> blind label (batch 8) -> prompt leak check -> run -> agree.
#   training/round11-para/chain.sh <gen-results.jsonl> <requests.meta.json> <out-dir> <empty label cwd>
# Stops on any teacher error; `teacher.py run` keeps its journal on a 429, so
# re-running the same command resumes the label pass.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
RES="$1"; META="$2"; OUT="$3"; LCWD="$4"
cd "$ROOT"
P=training/.venv/bin/python; X=training/round11-para/para.py
A=training/artifacts/round11-para; C=training/artifacts/round10/context.json
R10=training/artifacts/round10/final/rows-valid.jsonl
mkdir -p "$OUT" "$LCWD"
if [ ! -f "$OUT/r1/rendered.manifest.json" ]; then
  $P $X rows "$RES" --meta "$META" --sources $A/sources.jsonl --context $C --out "$OUT/rows.jsonl"
  $P $X leak "$OUT/rows.jsonl" --out "$OUT/rows-leak.jsonl" --prior $R10
  training/scripts/render.sh "$OUT/rows-leak.jsonl" "$OUT/r1" > "$OUT/render.log" 2>&1
  tail -1 "$OUT/render.log"
fi
if [ ! -f "$OUT/label-requests.jsonl" ]; then
  $P training/py/teacher.py label "$OUT/r1/rendered.jsonl" --context $C --rows "$OUT/r1/rows-valid.jsonl" \
      --batch 8 --out "$OUT/label-requests.jsonl"
fi
$P $X promptcheck "$OUT/label-requests.jsonl"
# label-run.log is appended to, so a resumed run keeps the earlier runs' stderr.
echo "=== $(date -u +%Y-%m-%dT%H:%M:%SZ) teacher.py run ===" >> "$OUT/label-run.log"
$P training/py/teacher.py run "$OUT/label-requests.jsonl" --out "$OUT/label-results.jsonl" --timeout 600 \
    --concurrency 5 --max-requests 1000 --cli-cwd "$LCWD" 2>>"$OUT/label-run.log" | tail -1
$P $X agree "$OUT/label-results.jsonl" --keys "$OUT/label-requests.jsonl.keys.json" --rows "$OUT/r1/rows-valid.jsonl" \
    --sources $A/sources.jsonl --context $C --manifest "$OUT/r1/rendered.manifest.json" --out "$OUT/agreed.jsonl"
