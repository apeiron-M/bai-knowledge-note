#!/usr/bin/env bash
# Local toolchain: venv, llama.cpp b11364 (the libllama build in wllama 3.8.1),
# schema->GBNF helper, base weights. Everything lands in gitignored paths.
set -euo pipefail
T="$(cd "$(dirname "$0")/.." && pwd)"
cd "$T"
# Outside the repo: the root tsconfig includes "**/*" and llama.cpp ships ~750 .ts files.
TOOLS="${BAI_TRAINING_TOOLS:-$HOME/.cache/bai-training}"
LLAMA_TAG=b11364   # = 46ca246, matches libllama "b11364-46ca246" in the results doc
mkdir -p "$TOOLS"
[ -d .venv ] || uv venv .venv --python 3.13
if [ ! -d "$TOOLS/llama.cpp" ]; then
  git clone -q --depth 1 --branch "$LLAMA_TAG" https://github.com/ggml-org/llama.cpp "$TOOLS/llama.cpp"
fi
uv pip install -q --python .venv/bin/python -r requirements.txt -e "$TOOLS/llama.cpp/gguf-py"
L="$TOOLS/llama.cpp"
cmake -S $L -B $L/build -G Ninja -DCMAKE_BUILD_TYPE=Release -DLLAMA_CURL=OFF \
  -DLLAMA_BUILD_TESTS=OFF -DLLAMA_BUILD_EXAMPLES=OFF > /dev/null
cmake --build $L/build --target llama-server llama-quantize llama-cli llama-tokenize > /dev/null
clang++ -std=c++17 -O1 -I$L/common -I$L/include -I$L/ggml/include -I$L/vendor tools/schema2gbnf.cpp \
  -L$L/build/bin -lllama-common -Wl,-rpath,"$L/build/bin" -o "$TOOLS/schema2gbnf"
.venv/bin/python - <<'PY'
from huggingface_hub import snapshot_download, hf_hub_download
snapshot_download("LiquidAI/LFM2.5-350M", local_dir="models/LFM2.5-350M")
hf_hub_download("LiquidAI/LFM2.5-350M-GGUF", "LFM2.5-350M-Q4_K_M.gguf", local_dir="models/LFM2.5-350M-GGUF")
PY
echo "setup ok"
