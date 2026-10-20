#!/usr/bin/env bash
# HF checkpoint -> GGUF (bf16) -> Q4_K_M with the b11364 converter/quantizer.
#   training/scripts/export-gguf.sh <hf-dir> <out-prefix>
# Writes <out-prefix>-BF16.gguf and <out-prefix>-Q4_K_M.gguf, and prints
# wall-clock and max RSS per stage (macOS /usr/bin/time -l).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TOOLS="${BAI_TRAINING_TOOLS:-$HOME/.cache/bai-training}"
L="$TOOLS/llama.cpp"
PY="$ROOT/training/.venv/bin/python"
HF="$1"; OUT="$2"
mkdir -p "$(dirname "$OUT")"
stage() {
  local name="$1"; shift
  local log="$OUT.$name.log"
  /usr/bin/time -l "$@" > "$log" 2>&1 || { tail -20 "$log" >&2; exit 1; }
  local real rss
  real=$(grep -E '^ +[0-9.]+ real' "$log" | awk '{print $1}')
  rss=$(grep 'maximum resident set size' "$log" | awk '{print $1}')
  echo "{\"stage\": \"$name\", \"wallSec\": $real, \"maxRssBytes\": $rss}"
}
# The HF repo's chat_template.jinja has changed since Liquid published the
# GGUF the browser loads today; carry that GGUF's template over so the shipped
# file renders exactly like the current one (jinja on or off).
TEMPLATE_GGUF="${TEMPLATE_GGUF:-$ROOT/training/models/LFM2.5-350M-GGUF/LFM2.5-350M-Q4_K_M.gguf}"
"$PY" -c 'import sys; from gguf import GGUFReader; sys.stdout.write(GGUFReader(sys.argv[1]).fields["tokenizer.chat_template"].contents())' \
  "$TEMPLATE_GGUF" > "$OUT.chat_template.jinja"
stage convert "$PY" "$L/convert_hf_to_gguf.py" "$HF" --outtype bf16 --outfile "$OUT-BF16.raw.gguf"
stage template "$PY" "$L/gguf-py/gguf/scripts/gguf_new_metadata.py" "$OUT-BF16.raw.gguf" "$OUT-BF16.gguf" \
  --chat-template-file "$OUT.chat_template.jinja" --force
rm -f "$OUT-BF16.raw.gguf"
stage quantize "$L/build/bin/llama-quantize" "$OUT-BF16.gguf" "$OUT-Q4_K_M.gguf" Q4_K_M
stat -f '{"file": "%N", "bytes": %z}' "$OUT-BF16.gguf" "$OUT-Q4_K_M.gguf"
