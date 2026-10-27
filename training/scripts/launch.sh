#!/bin/bash
# Remote LoRA launcher for the training Mac (Constantine).
#
#   training/scripts/launch.sh <name> <train_lora.py args...>
#
# Runs training/py/train_lora.py in a detached screen session <name>, under
# caffeinate and the MPS memory caps, logging to $BAI_TRAINING_HOME/<name>.log.
# Starts training/scripts/watchdog.sh (pidfile $BAI_TRAINING_HOME/watchdog.pid,
# log watchdog.log) if it isn't already running.
#
# $BAI_TRAINING_HOME (default ~/bai-training) is the rsync'd mirror that holds
# training/py, training/scripts, training/.venv and the base weights. On
# Constantine this file was ~/bai-training/launch.sh; running it from
# training/scripts/ inside the mirror is equivalent.
#
#   WATCHDOG_LIMIT     bytes, default 34359738368 (32 GiB)
#   WATCHDOG_INTERVAL  seconds, default 15
#
# Poll:  ssh trainbox "tail -c 600 ~/bai-training/<name>.log | tr '\r' '\n' | tail -3"
# The log ends with "<date> EXIT <status>" when the trainer exits.
set -eu
HOME_DIR=${BAI_TRAINING_HOME:-$HOME/bai-training}
LIMIT=${WATCHDOG_LIMIT:-34359738368}
INTERVAL=${WATCHDOG_INTERVAL:-15}
cd "$HOME_DIR"
NAME=${1:?usage: launch.sh <name> <train_lora.py args...>}; shift
LOG=$HOME_DIR/$NAME.log
if ! { [ -f watchdog.pid ] && kill -0 "$(cat watchdog.pid)" 2>/dev/null; }; then
  nohup training/scripts/watchdog.sh "$HOME_DIR/watchdog.log" "$LIMIT" "$INTERVAL" > /dev/null 2>&1 < /dev/null &
  echo $! > watchdog.pid
fi
ARGS=$(printf '%q ' "$@")
QH=$(printf '%q' "$HOME_DIR"); QL=$(printf '%q' "$LOG")
screen -dmS "$NAME" bash -c "cd $QH && echo \"\$(date '+%F %T') start: $ARGS\" > $QL && \
  PYTORCH_MPS_HIGH_WATERMARK_RATIO=0.5 PYTORCH_MPS_LOW_WATERMARK_RATIO=0.45 PYTHONUNBUFFERED=1 \
  caffeinate -dimsu training/.venv/bin/python training/py/train_lora.py $ARGS >> $QL 2>&1; \
  echo \"\$(date '+%F %T') EXIT \$?\" >> $QL"
echo "launched $NAME; watchdog pid $(cat watchdog.pid)"
