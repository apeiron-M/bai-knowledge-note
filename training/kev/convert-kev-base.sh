#!/bin/sh
# Convert the released (not fine-tuned) Kev-0.8B to GGUF, as X4 did for the zero-shot Kev arms
# (Kev-0.8B-local-*.gguf). X4 checked this path against ggml-org's GGUF: 59/59 argmax, max |dp| 3e-4.
#
#   training/kev/convert-kev-base.sh <kev-0.8b checkpoint dir> <out dir>
#
# The checkpoint dir is jaredpalmer/kev-0.8b@bf75a6a8848ea6960ff2ed108d9ed44c2941174f (adapter_config.json,
# adapter_model.safetensors, head.pt, training_config.json, tokenizer files), e.g.
#   hf download jaredpalmer/kev-0.8b --revision bf75a6a8848ea6960ff2ed108d9ed44c2941174f --local-dir <dir>
# The converter reads the base weights Qwen/Qwen3.5-0.8B-Base@dc7cdfe2ee4154fa7e30f5b51ca41bfa40174e68 from
# $KEV_HF_CACHE (default <repo>/training/models/hf), e.g.
#   HF_HUB_CACHE=training/models/hf hf download Qwen/Qwen3.5-0.8B-Base --revision dc7cdfe2ee4154fa7e30f5b51ca41bfa40174e68
#
#   KEV_QUANT           default Q8_0 (X4 wrote Q8_0; use Q4_K_M for the browser-size arm)
#   BAI_TRAINING_TOOLS  llama.cpp build root, default ~/.cache/bai-training
set -eu
REPO=$(cd "$(dirname "$0")/../.." && pwd)
SRC=$(cd "${1:?usage: convert-kev-base.sh <checkpoint dir> <out dir>}" && pwd)
mkdir -p "${2:?out dir}"; OUTD=$(cd "$2" && pwd)
Q=${KEV_QUANT:-Q8_0}
LC=${BAI_TRAINING_TOOLS:-$HOME/.cache/bai-training}/llama.cpp
export HF_HUB_CACHE=${KEV_HF_CACHE:-$REPO/training/models/hf}
cd "$LC"
/usr/bin/time -l "$REPO/training/.venv/bin/python" convert_hf_to_gguf.py "$SRC" --outtype bf16 \
  --outfile "$OUTD/Kev-0.8B-local-BF16.gguf" --model-name Kev-0.8B
"$LC/build/bin/llama-quantize" "$OUTD/Kev-0.8B-local-BF16.gguf" "$OUTD/Kev-0.8B-local-$Q.gguf" "$Q"
shasum -a 256 "$OUTD"/*.gguf
