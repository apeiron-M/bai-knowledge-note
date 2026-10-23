#!/usr/bin/env bash
# Round 12 (X11) merge, keeping Round 11's train/val split:
#   render.sh over the new kept rows (dedup, zod, replay, r6.1 render, parity;
#   no TOPK) -> train = round11-para/merged/split/train-split.jsonl + the new
#   sequences whose source row is not in the val split (seed selection already
#   skipped Round 10 val rows), minus any base row that hits an eval set;
#   val = Round 11's val (= Round 10's) unchanged -> para12 check.
#   training/round12-para/merge.sh <agreed.jsonl> [more agreed.jsonl ...]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
: "${BAI_BLIND_DIR:?set BAI_BLIND_DIR to the blind held-out-5/6 directory}"
P=training/.venv/bin/python; X11=training/round11-para/para.py; X=training/round12-para/para12.py
A=training/artifacts/round12-para; S11=training/artifacts/round11-para/merged
mkdir -p $A/merged
cat "$@" > $A/merged/new-rows.jsonl
training/scripts/render.sh $A/merged/new-rows.jsonl $A/merged/new-final > $A/merged/render.log 2>&1
tail -1 $A/merged/render.log
cat training/artifacts/round10/final/rows-kept.jsonl $S11/new-final/rows-valid.jsonl > $A/merged/base-rows.jsonl
$P $X11 mirror $A/merged/new-final/train.jsonl --rows $A/merged/new-final/rows-valid.jsonl \
    --base-train $S11/split/train-split.jsonl --base-val $S11/split/val.jsonl \
    --base-rows $A/merged/base-rows.jsonl --out-dir $A/merged/split
$P $X check --train $A/merged/split/train-split.jsonl --val $A/merged/split/val.jsonl --base-val $S11/split/val.jsonl \
    --rows $A/merged/new-final/rows-valid.jsonl --manifest $S11/new-final/rendered.manifest.json \
    --manifest $A/merged/new-final/rendered.manifest.json \
    --scan $A/merged/new-final/rows-valid.jsonl --scan $A/merged/split/train-split.jsonl --scan $A/merged/split/val.jsonl \
    --out $A/merged/check.json
