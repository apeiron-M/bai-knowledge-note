#!/bin/sh
# Kev-0.8B delta fine-tune recipe for the training Mac (Constantine, M4 Max 64 GB). X4 recipe; the X8 run used it.
#
#   training/kev/constantine-recipe.sh setup|probe|train|calibrate
#
# Run ON the training Mac, one step at a time. `train` runs in the foreground; for the real run use
# launch-kev-ft.sh (same command, detached under screen + caffeinate + the memory watchdog).
#
#   KEV_HOME  clone of github.com/jaredpalmer/kev        default ~/kev
#   KEV_DATA  dir holding train.jsonl / calibration.jsonl default ~/x4
#   KEV_RUN   run name under $KEV_HOME/runs/             default x4-kev08-r1
#
# Data: train.jsonl / calibration.jsonl from training/kev/to_kev_jsonl.py (see README.md). The shipped run used
#   sha256 train.jsonl       ed3d9aac475781498f5a6bf002edd9f07d16ce1e43e5f0a175e8608aaf486e65 (4,382 records)
#   sha256 calibration.jsonl 6abffad7e469c5c74c5fd2d73cf0440aa99d18dc4338d3ca5c14669a98e25248 (228 records)
# Copy them to $KEV_DATA and check the sha256s on both sides before training.
set -eu
KEV_HOME=${KEV_HOME:-$HOME/kev}
KEV_DATA=${KEV_DATA:-$HOME/x4}
KEV_RUN=${KEV_RUN:-x4-kev08-r1}
KEV_REV=2074cc44256200bb37540103fa4572901faa10f3          # github.com/jaredpalmer/kev
BASE_REV=dc7cdfe2ee4154fa7e30f5b51ca41bfa40174e68         # Qwen/Qwen3.5-0.8B-Base
INIT=jaredpalmer/kev-0.8b@bf75a6a8848ea6960ff2ed108d9ed44c2941174f

# Shared kev.train flags: LoRA 16 on all targets, fp32 on MPS, lr 2e-5, batch 4 x accum 2, seed 0,
# every distractor augmentation off.
train_flags() {
  echo --data "$KEV_DATA/train.jsonl" \
    --base Qwen/Qwen3.5-0.8B-Base --base_revision $BASE_REV --init_from $INIT \
    --lora 16 --head_dim 256 --lora_targets all --weights_dtype fp32 --dtype fp32 --device mps \
    --lr 2e-5 --batch 4 --accum 2 --checkpointing 1 \
    --p_none 0 --p_none_distract 0 --p_distract 0 --p_none_pair 0 --seed 0
}

case ${1:-} in
  setup)
    # code + env (uv fetches Python 3.13; kev pins torch>=2.6,<2.9, transformers>=5.17,<6)
    [ -d "$KEV_HOME" ] || git clone https://github.com/jaredpalmer/kev "$KEV_HOME"
    cd "$KEV_HOME" && git checkout $KEV_REV && uv sync
    mkdir -p "$KEV_DATA"
    ;;
  probe)
    # timing probe (minutes): 20 optimizer steps, then extrapolate. One step = batch*accum = 8 records;
    # 4,382 records -> about 548 steps per epoch. Observed: about 4.7-4.8 s per record (11.4 h for 2 epochs).
    cd "$KEV_HOME"
    # shellcheck disable=SC2046
    caffeinate -i uv run python -m kev.train $(train_flags) --epochs 1 --max_steps 20 --out runs/x4-kev08-probe
    ;;
  train)
    # 2 epochs; the checkpoint is the final one (no picking on held-out data). kev.train writes no
    # intermediate checkpoints in LoRA mode: a crash or sleep restarts from step 0.
    cd "$KEV_HOME"
    # shellcheck disable=SC2046
    caffeinate -i uv run python -m kev.train $(train_flags) --epochs 2 --out "runs/$KEV_RUN" 2>&1 | tee "runs/$KEV_RUN.log"
    ;;
  calibrate)
    # calibration-split score + temperature. The calibration rows are held-out items of our own distribution,
    # hence --allow-in-distribution. Writes head.pt["temperature"]; the GGUF converter copies it into
    # <arch>.decision.temperature.*. (kev-ft-calibrate.sh runs this remotely from the eval Mac.)
    cd "$KEV_HOME"
    uv run python -m kev.benchmark --run "runs/$KEV_RUN" --data "$KEV_DATA/calibration.jsonl" --device mps --out "runs/$KEV_RUN-cal"
    uv run python scripts/calibrate_checkpoint.py --run "runs/$KEV_RUN" --rows "runs/$KEV_RUN-cal/rows.json" --allow-in-distribution
    ;;
  *)
    sed -n 2,16p "$0" >&2; exit 2;;
esac

# Export happens on the eval Mac: kev-ft-export.sh (llama.cpp 46ca246 = wllama 3.8.1's pin). runs/$KEV_RUN holds
# adapter_config.json, adapter_model.safetensors, head.pt and training_config.json: the layout llama.cpp's
# conversion/lev.py:_is_kev_checkpoint detects (verified on the released kev-0.8b, X4 report).
#
# Optional Kev-0.6B arm (attention-only Qwen3, ONNX only: llama.cpp 46ca246 has no Qwen3 kev path), not shipped:
#   kev.train with --base Qwen/Qwen3-0.6B-Base --base_revision da87bfb608c14b7cf20ba1ce41287e8de496c0cd
#     --init_from jaredpalmer/kev-0.6b --lr 2e-5 --batch 8 --accum 1 --checkpointing 0 --out runs/x4-kev06-r1
#   export: head.pt -> head.npz, then X4's kev06_transplant.py (backup only) re-quantizes base+LoRA into the
#   published q4 graph.
