#!/bin/sh
# Kev-FT post-training step 2, on the eval Mac: copy the calibrated run back from the training Mac, check it by
# sha256, convert it to a BF16 GGUF with llama.cpp 46ca246 (b11364, wllama 3.8.1's pin; its conversion/lev.py
# detects the Kev checkpoint layout) and quantise to Q4_K_M. Run kev-ft-calibrate.sh first.
#
#   training/kev/kev-ft-export.sh [gguf-stem]          default stem Kev-0.8B-vault-ft1-<today>
#
#   KEV_REMOTE, KEV_REMOTE_KEV, KEV_REMOTE_DATA, KEV_RUN   as in kev-ft-calibrate.sh
#   KEV_FT_OUT          output root          default <repo>/training/artifacts/kev-ft (gitignored)
#   KEV_HF_CACHE        HF_HUB_CACHE holding Qwen/Qwen3.5-0.8B-Base@dc7cdfe2 (the converter reads the base
#                       weights from it)    default <repo>/training/models/hf (gitignored)
#   KEV_MODEL_NAME      GGUF general.name    default the stem minus its last -suffix (Kev-0.8B-vault-ft1)
#   BAI_TRAINING_TOOLS  llama.cpp build root default ~/.cache/bai-training (training/scripts/setup.sh)
#
# The shipped run: Kev-0.8B-vault-ft1-20261024-{BF16,Q4_K_M}.gguf, Q4_K_M 529,595,072 B, sha256 30b5796e...7b23;
# the GGUF carries qwen35.decision.temperature.* = 2.7007. macOS only (/usr/bin/time -l).
set -eu
REPO=$(cd "$(dirname "$0")/../.." && pwd)
H=${KEV_REMOTE:-trainbox}
K=${KEV_REMOTE_KEV:-kev}
D=${KEV_REMOTE_DATA:-x4}
R=${KEV_RUN:-x4-kev08-r1}
OUT=${KEV_FT_OUT:-$REPO/training/artifacts/kev-ft}
LC=${BAI_TRAINING_TOOLS:-$HOME/.cache/bai-training}/llama.cpp
STEM=${1:-Kev-0.8B-vault-ft1-$(date +%Y%m%d)}
PY=$REPO/training/.venv/bin/python

# 1. Copy back (adapter, head, configs, metrics, logs, calibration rows) and check against the remote sha256s
mkdir -p "$OUT/remote" "$OUT/gguf"
rsync -a "$H:$K/runs/$R/" "$OUT/remote/$R/"
rsync -a "$H:$K/runs/$R-cal/" "$OUT/remote/$R-cal/"
rsync -a "$H:$D/kev-ft.log" "$H:$D/kev-cal.log" "$H:$D/watchdog-kev.log" "$OUT/remote/"
ssh "$H" "cd ~/$K/runs/$R && shasum -a 256 *" > "$OUT/remote/SHA256SUMS"
(cd "$OUT/remote/$R" && shasum -a 256 -c ../SHA256SUMS)

# 2. GGUF (same path as convert-kev-base.sh)
export HF_HUB_CACHE=${KEV_HF_CACHE:-$REPO/training/models/hf}
cd "$LC"
/usr/bin/time -l "$PY" convert_hf_to_gguf.py "$OUT/remote/$R" --outtype bf16 \
  --outfile "$OUT/gguf/$STEM-BF16.gguf" --model-name "${KEV_MODEL_NAME:-${STEM%-*}}" > "$OUT/gguf/convert.log" 2>&1
"$LC/build/bin/llama-quantize" "$OUT/gguf/$STEM-BF16.gguf" "$OUT/gguf/$STEM-Q4_K_M.gguf" Q4_K_M > "$OUT/gguf/quantize.log" 2>&1
grep -i temperature "$OUT/gguf/convert.log" | head -3     # the fitted T must be copied into <arch>.decision.temperature.*
ls -l "$OUT"/gguf/*.gguf; shasum -a 256 "$OUT"/gguf/*.gguf
# 3. Dev eval: training/eval-rig/rig.sh --lora <lora.gguf> --kev "$OUT/gguf/$STEM-Q4_K_M.gguf" --set dev --args x9 --temps dev-cv ...
