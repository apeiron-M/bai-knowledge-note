#!/usr/bin/env bash
# Round 12 (X11) post-generation chain for one teacher results file:
#   para12 rows (value / op-word / account-email checks) -> round11 leak
#   (held-out 1-4 + dev/seed, blind 5/6 via $BAI_BLIND_DIR; per-op near-dups
#   seeded with Round 10, Round 11's kept rows and any extra --prior files)
#   -> render.sh (dedup, zod, replay, render, parity) -> blind label (batch 8)
#   -> prompt leak check -> run -> round11 agree (op + args exact, op-word quota).
#   training/round12-para/chain.sh <gen-results.jsonl> <requests.meta.json> <out-dir> <empty label cwd> [extra prior rows ...]
# Stops on any teacher error (exit 3 auth, 4 usage limit/429); `teacher.py run`
# keeps its journal, so re-running the same command resumes the label pass.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
RES="$1"; META="$2"; OUT="$3"; LCWD="$4"; shift 4
cd "$ROOT"
: "${BAI_BLIND_DIR:?set BAI_BLIND_DIR to the blind held-out-5/6 directory}"
P=training/.venv/bin/python; X11=training/round11-para/para.py; X=training/round12-para/para12.py
A=training/artifacts/round12-para; C=training/artifacts/round10/context.json
PRIOR=(--prior training/artifacts/round10/final/rows-valid.jsonl
       --prior training/artifacts/round11-para/merged/new-final/rows-valid.jsonl)
for p in "$@"; do PRIOR+=(--prior "$p"); done
mkdir -p "$OUT" "$LCWD"
if [ ! -f "$OUT/r1/rendered.manifest.json" ]; then
  $P $X rows "$RES" --meta "$META" --sources $A/sources.jsonl --context $C --out "$OUT/rows.jsonl"
  $P $X11 leak "$OUT/rows.jsonl" --out "$OUT/rows-leak.jsonl" "${PRIOR[@]}"
  training/scripts/render.sh "$OUT/rows-leak.jsonl" "$OUT/r1" > "$OUT/render.log" 2>&1
  tail -1 "$OUT/render.log"
fi
if [ ! -f "$OUT/label-requests.jsonl" ]; then
  $P training/py/teacher.py label "$OUT/r1/rendered.jsonl" --context $C --rows "$OUT/r1/rows-valid.jsonl" \
      --batch 8 --out "$OUT/label-requests.jsonl"
fi
$P $X11 promptcheck "$OUT/label-requests.jsonl"
echo "=== $(date -u +%Y-%m-%dT%H:%M:%SZ) teacher.py run ===" >> "$OUT/label-run.log"
$P training/py/teacher.py run "$OUT/label-requests.jsonl" --out "$OUT/label-results.jsonl" --timeout 600 \
    --concurrency 5 --max-requests 1000 --cli-cwd "$LCWD" 2>>"$OUT/label-run.log" | tail -1
$P $X11 agree "$OUT/label-results.jsonl" --keys "$OUT/label-requests.jsonl.keys.json" --rows "$OUT/r1/rows-valid.jsonl" \
    --sources $A/sources.jsonl --context $C --manifest "$OUT/r1/rendered.manifest.json" --out "$OUT/agreed.jsonl"
