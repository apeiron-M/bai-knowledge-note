#!/usr/bin/env bash
# End-to-end smoke test: hand-made rows -> render -> LoRA (few steps) -> merge
# -> GGUF bf16 -> Q4_K_M -> llama-server inference under grammars.
#   training/scripts/smoke.sh [steps]
# Per-stage wall-clock and max RSS go to artifacts/smoke/stages.jsonl.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
STEPS="${1:-20}"
T="$ROOT/training"; A="$T/artifacts/smoke"; PY="$T/.venv/bin/python"
mkdir -p "$A"; : > "$A/stages.jsonl"
cd "$ROOT"
timed() {
  local name="$1"; shift
  local log="$A/$name.log"
  /usr/bin/time -l "$@" > "$log" 2>&1 || { tail -30 "$log" >&2; exit 1; }
  local real rss foot
  real=$(grep -E '^ +[0-9.]+ real' "$log" | awk '{print $1}')
  rss=$(grep 'maximum resident set size' "$log" | awk '{print $1}')
  foot=$(grep 'peak memory footprint' "$log" | awk '{print $1}')
  echo "{\"stage\": \"$name\", \"wallSec\": $real, \"maxRssBytes\": $rss, \"peakFootprintBytes\": $foot}" | tee -a "$A/stages.jsonl"
}
timed render "$T/scripts/render.sh" "$T/data/smoke-rows.jsonl" "$A"
timed render-probe "$T/scripts/render.sh" "$T/data/smoke-probe-rows.jsonl" "$T/artifacts/smoke-probe"
timed train "$PY" "$T/py/train_lora.py" "$A/train.jsonl" --out "$A/run" --max-steps "$STEPS" --batch 8 --grad-accum 1
timed merge "$PY" "$T/py/merge.py" "$A/run/adapter" --out "$A/run/merged" --check "$A/train.jsonl"
timed export "$T/scripts/export-gguf.sh" "$A/run/merged" "$A/gguf/smoke"
timed infer "$PY" "$T/py/smoke_infer.py" "$T/artifacts/smoke-probe/rendered.jsonl" \
  --gguf "$T/models/LFM2.5-350M-GGUF/LFM2.5-350M-Q4_K_M.gguf" --gguf "$A/gguf/smoke-Q4_K_M.gguf" \
  --out "$A/infer.json"
grep -E '^\{' "$A/export.log"
grep -vE '^ +[0-9]+ ' "$A/infer.log" | grep -vE 'real|user|sys' | head -40
