#!/bin/bash
# Kev-0.8B delta fine-tune launcher for the training Mac (constantine-recipe.sh `train`, detached).
#
#   training/kev/launch-kev-ft.sh
#
# Starts kev.train in screen session $KEV_SCREEN under caffeinate and the MPS memory caps, logging to
# $KEV_DATA/kev-ft.log (ends with "<date> EXIT <status>"), and starts watchdog-kev.sh if it isn't running.
# Refuses to start if $KEV_HOME/runs/$KEV_RUN exists (kev.train has no checkpoints in LoRA mode; remove the
# partial run first to restart from step 0).
#
#   KEV_HOME, KEV_DATA, KEV_RUN   as in constantine-recipe.sh (defaults ~/kev, ~/x4, x4-kev08-r1)
#   KEV_SCREEN                    default kev-ft
#   WATCHDOG_LIMIT / _INTERVAL    default 34359738368 (32 GiB) / 15 s
#
# Copy this file and watchdog-kev.sh into $KEV_DATA on the training Mac (that is where the shipped run had
# them: ~/x4/launch-kev-ft.sh, ~/x4/watchdog-kev.sh). Poll: ssh trainbox 'tail -3 ~/x4/kev-ft.log'.
set -eu
KEV_HOME=${KEV_HOME:-$HOME/kev}
KEV_DATA=${KEV_DATA:-$HOME/x4}
KEV_RUN=${KEV_RUN:-x4-kev08-r1}
KEV_SCREEN=${KEV_SCREEN:-kev-ft}
LIMIT=${WATCHDOG_LIMIT:-34359738368}
INTERVAL=${WATCHDOG_INTERVAL:-15}
HERE=$(cd "$(dirname "$0")" && pwd)
cd "$KEV_DATA"
if ! { [ -f watchdog-kev.pid ] && kill -0 "$(cat watchdog-kev.pid)" 2>/dev/null; }; then
  nohup "$HERE/watchdog-kev.sh" "$KEV_DATA/watchdog-kev.log" "$LIMIT" "$INTERVAL" > /dev/null 2>&1 < /dev/null &
  echo $! > watchdog-kev.pid
fi
test ! -e "$KEV_HOME/runs/$KEV_RUN"
QH=$(printf '%q' "$KEV_HOME"); QD=$(printf '%q' "$KEV_DATA"); QR=$(printf '%q' "runs/$KEV_RUN")
screen -dmS "$KEV_SCREEN" bash -c "cd $QH && echo \"\$(date +%F\ %T) start kev-ft\" > $QD/kev-ft.log && \
  PYTORCH_MPS_HIGH_WATERMARK_RATIO=0.5 PYTORCH_MPS_LOW_WATERMARK_RATIO=0.45 PYTHONUNBUFFERED=1 \
  caffeinate -dimsu .venv/bin/python -m kev.train --data $QD/train.jsonl \
  --base Qwen/Qwen3.5-0.8B-Base --base_revision dc7cdfe2ee4154fa7e30f5b51ca41bfa40174e68 \
  --init_from jaredpalmer/kev-0.8b@bf75a6a8848ea6960ff2ed108d9ed44c2941174f \
  --lora 16 --head_dim 256 --lora_targets all --weights_dtype fp32 --dtype fp32 --device mps \
  --epochs 2 --lr 2e-5 --batch 4 --accum 2 --checkpointing 1 \
  --p_none 0 --p_none_distract 0 --p_distract 0 --p_none_pair 0 \
  --seed 0 --out $QR >> $QD/kev-ft.log 2>&1; echo \"\$(date +%F\ %T) EXIT \$?\" >> $QD/kev-ft.log"
echo "launched $KEV_SCREEN"
