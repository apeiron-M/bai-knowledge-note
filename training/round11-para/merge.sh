#!/usr/bin/env bash
# Round 11 (X5) merge, keeping Round 10's train/val split exactly:
#   render.sh over the new kept rewrites (zod, replay, r6.1 render, parity;
#   no TOPK, like Round 10) -> train = round10/split/train-split.jsonl + the
#   new sequences whose source row is not in Round 10's val, minus any Round 10
#   train row that hits an eval set (held-out 1-4, blind 5/6); val =
#   round10/split/val.jsonl unchanged. (Round 10's split was a fresh split.py
#   over all 4,609 kept rows, so it does not exclude Round 8's val ids.)
# The new rows were already leak/near-dup filtered against held-out 1-6 and
# Round 10 by chain.sh, so Round 10's sequences are reused byte for byte.
#   training/round11-para/merge.sh <agreed.jsonl>
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
NEW="$1"
cd "$ROOT"
P=training/.venv/bin/python; X=training/round11-para/para.py; A=training/artifacts/round11-para
S10=training/artifacts/round10/split
mkdir -p $A/merged
training/scripts/render.sh "$NEW" $A/merged/new-final > $A/merged/render.log 2>&1
tail -1 $A/merged/render.log
$P $X mirror $A/merged/new-final/train.jsonl --rows $A/merged/new-final/rows-valid.jsonl \
    --base-train $S10/train-split.jsonl --base-val $S10/val.jsonl \
    --base-rows training/artifacts/round10/final/rows-kept.jsonl --out-dir $A/merged/split
