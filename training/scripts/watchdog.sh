#!/bin/bash
# Memory watchdog for a train_lora.py run (macOS).
#
#   training/scripts/watchdog.sh <log> [limit-bytes] [interval-sec]
#
# Every interval it logs the training process's RSS and phys footprint
# (footprint counts Metal / unified-memory buffers, which RSS can miss)
# plus swap use. If either exceeds the limit (default: half of hw.memsize)
# it sends TERM, then KILL 10 s later, and logs that. It runs until
# killed; it waits while no train_lora.py process exists.
set -u
LOG=${1:?log path}
LIMIT=${2:-$(( $(sysctl -n hw.memsize) / 2 ))}
INTERVAL=${3:-15}
echo "$(date '+%F %T') watchdog start pid=$$ limit=${LIMIT} interval=${INTERVAL}s" >> "$LOG"
while true; do
  PID=$(pgrep -f 'py/train_lora.py' | head -1)
  if [ -n "$PID" ]; then
    RSS=$(( $(ps -o rss= -p "$PID" 2>/dev/null | tr -d ' ' || echo 0) * 1024 ))
    # "phys_footprint: 12 GB" -> bytes
    FP=$(footprint -p "$PID" 2>/dev/null | awk '/phys_footprint:/ {
          v=$2; u=$3; m=1;
          if (u=="KB") m=1024; else if (u=="MB") m=1024^2; else if (u=="GB") m=1024^3;
          printf "%d", v*m; exit }')
    FP=${FP:-0}
    SWAP=$(sysctl -n vm.swapusage | awk '{print $6}')
    echo "$(date '+%F %T') pid=$PID rss=$RSS footprint=$FP swap_used=$SWAP" >> "$LOG"
    if [ "$RSS" -gt "$LIMIT" ] || [ "$FP" -gt "$LIMIT" ]; then
      echo "$(date '+%F %T') LIMIT EXCEEDED (rss=$RSS footprint=$FP limit=$LIMIT): TERM $PID" >> "$LOG"
      kill -TERM "$PID" 2>/dev/null
      sleep 10
      if kill -0 "$PID" 2>/dev/null; then
        echo "$(date '+%F %T') still alive: KILL $PID" >> "$LOG"
        kill -KILL "$PID" 2>/dev/null
      fi
    fi
  fi
  sleep "$INTERVAL"
done
