#!/bin/bash
# Unified evaluation rig (inference only, native llama-server Metal). See README.md.
#
#   rig.sh --lora <gguf> [--kev <gguf>] --set dev|val|heldout5|file:<path> [--args base|x6|x9[,...]] --out <dir>
#          [--temps refit|frozen|explicit|dev-cv] [--t-lora <x> --t-kev <y>] [--val-from <dir>] [--dev-from <dir>]
#          [--exclude-match <training-row-file>:<row-id>]... [--rev <git rev>] [--only id,id,...] [--blind-ok]
#   rig.sh --prereg <prereg.md> [--prereg-run <name>] [--prereg-sha256 <hex>]   (all parameters from the file)
#
# Steps: build patched trees (outside the repo) -> items -> LoRA server: step 1 (R2c pick + trie scores),
# step 2 on the gold op per args level -> stop -> Kev server: one-stage option logprobs (frozen X4 decide.mjs,
# W3/desc) -> stop -> evaluate.py (X7 logic). With --temps refit (default) and a non-val set, the Round 8
# teacher val is also scored (step 1 + Kev, no args) into <out>/val unless --val-from points at an earlier one.
# --temps dev-cv fits T on the dev rows (the run itself for --set dev, else --dev-from or <out>/dev, scored here).
set -euo pipefail
RIG=$(cd "$(dirname "$0")" && pwd)
REPO=${RIG_REPO:-$(cd "$RIG/../.." && pwd)}
KEVD=${RIG_KEV:-$(cd "$RIG/../kev" && pwd)}   # frozen decide.mjs + catalog.json (training/kev)
export RIG_REPO=$REPO RIG_KEV=$KEVD
BIN=${LLAMA_SERVER:-${BAI_TRAINING_TOOLS:-$HOME/.cache/bai-training}/llama.cpp/build/bin/llama-server}
TSX=${TSX:-tsx}
HELP() { sed -n 2,14p "$0"; }

# ---- pre-registration mode: every parameter comes from the (sha256-verified) file ----
if [ "${1:-}" = --prereg ]; then
  PRF=${2:?--prereg <file>}; shift 2; PRRUN= PRSHA=
  while [ $# -gt 0 ]; do
    case $1 in --prereg-run) PRRUN=$2; shift 2;; --prereg-sha256) PRSHA=$2; shift 2;;
      *) echo "--prereg takes every parameter from the file; refusing extra arg $1" >&2; exit 2;; esac
  done
  PRARGS=(); i=0
  while IFS= read -r -d '' f; do
    case $i in 0) PSHA=$f;; 1) PNAME=$f;; 2) PEXP=$f;; *) PRARGS+=("$f");; esac; i=$((i + 1))
  done < <(python3 "$RIG/src/prereg.py" "$PRF" ${PRRUN:+--run "$PRRUN"} ${PRSHA:+--sha256 "$PRSHA"} || echo -ne "\0FAIL\0")
  [ $i -ge 4 ] && [ "${PRARGS[$((i - 4))]}" != FAIL ] || { echo "prereg verification failed" >&2; exit 3; }
  echo "[rig] prereg $(basename "$PRF") run '${PNAME}': ${PRARGS[*]}" >&2
  RIG_PREREG_FILE=$(cd "$(dirname "$PRF")" && pwd)/$(basename "$PRF") RIG_PREREG_SHA=$PSHA RIG_PREREG_RUN=$PNAME \
    RIG_EXPECT_EXCLUDED=$PEXP exec "$0" "${PRARGS[@]}"
fi
for a in "$@"; do case $a in --prereg|--prereg-run|--prereg-sha256) echo "$a: --prereg must be the first argument" >&2; exit 2;; esac; done

LORA= KEV= SET= ARGS=x9 OUT= TEMPS=refit VALFROM= DEVFROM= REV=5e9c39046dcd8f08951a308e66c610dbd4c55c73 ONLY= BLIND=0 TL= TK=
EXCL=()
while [ $# -gt 0 ]; do
  case $1 in
    --lora) LORA=$2; shift 2;; --kev) KEV=$2; shift 2;; --set) SET=$2; shift 2;; --args) ARGS=$2; shift 2;;
    --out) OUT=$2; shift 2;; --temps) TEMPS=$2; shift 2;; --val-from) VALFROM=$2; shift 2;; --rev) REV=$2; shift 2;;
    --t-lora) TL=$2; shift 2;; --t-kev) TK=$2; shift 2;; --dev-from) DEVFROM=$2; shift 2;;
    --exclude-match) EXCL+=("$2"); shift 2;;
    --only) ONLY=$2; shift 2;; --blind-ok) BLIND=1; shift;;
    -h|--help) HELP; exit 0;;
    *) echo "unknown arg $1" >&2; exit 2;;
  esac
done
[ -n "$LORA" ] && [ -n "$SET" ] && [ -n "$OUT" ] || { HELP >&2; exit 2; }
[ -f "$LORA" ] || { echo "no LoRA gguf $LORA" >&2; exit 2; }
[ -z "$KEV" ] || [ -f "$KEV" ] || { echo "no Kev gguf $KEV" >&2; exit 2; }
case $TEMPS in refit|frozen|explicit|dev-cv) ;; *) echo "--temps refit|frozen|explicit|dev-cv" >&2; exit 2;; esac
isnum() { python3 -c 'import sys; v=float(sys.argv[1]); sys.exit(0 if v > 0 else 1)' "$1" 2>/dev/null; }
if [ "$TEMPS" = explicit ]; then
  [ -n "$TL" ] && isnum "$TL" || { echo "--temps explicit needs --t-lora <x> (> 0)" >&2; exit 2; }
  [ -z "$KEV" ] || { [ -n "$TK" ] && isnum "$TK"; } || { echo "--temps explicit with --kev needs --t-kev <y> (> 0)" >&2; exit 2; }
  [ -n "$KEV" ] || [ -z "$TK" ] || { echo "--t-kev without --kev" >&2; exit 2; }
else
  [ -z "$TL$TK" ] || { echo "--t-lora / --t-kev only with --temps explicit" >&2; exit 2; }
fi
[ -z "$DEVFROM" ] || [ "$TEMPS" = dev-cv ] || { echo "--dev-from only with --temps dev-cv" >&2; exit 2; }
[ -z "$DEVFROM" ] || [ "$SET" != dev ] || { echo "--dev-from with --set dev: dev-cv fits on the run itself" >&2; exit 2; }
for e in ${EXCL[@]+"${EXCL[@]}"}; do f=${e%:*}; [ "$f" != "$e" ] && [ -f "$f" ] || { echo "--exclude-match $e: want <existing file>:<row-id>" >&2; exit 2; }; done
for lv in ${ARGS//,/ }; do case $lv in base|x6|x9) ;; *) echo "--args levels: base x6 x9" >&2; exit 2;; esac; done
if [ "$SET" = heldout5 ]; then
  [ "$BLIND" = 1 ] || { echo "refusing --set heldout5 without --blind-ok: blind runs are pre-registered and run separately" >&2; exit 2; }
  export RIG_BLIND_OK=1
fi
LORA=$(cd "$(dirname "$LORA")" && pwd)/$(basename "$LORA"); [ -z "$KEV" ] || KEV=$(cd "$(dirname "$KEV")" && pwd)/$(basename "$KEV")
mkdir -p "$OUT/logs"; OUT=$(cd "$OUT" && pwd)
log() { echo "[rig $(date +%H:%M:%S)] $*" | tee -a "$OUT/logs/rig.log" >&2; }
if [ -n "${RIG_PREREG_FILE:-}" ]; then
  log "prereg $RIG_PREREG_FILE run '${RIG_PREREG_RUN:-}' sha256 $RIG_PREREG_SHA"
  mkdir -p "$OUT/prereg"; cp -p "$RIG_PREREG_FILE" "$OUT/prereg/"
fi

TREES=$("$RIG/src/build-trees.sh" "$REV")
log "trees $TREES (rev $REV)"

# ---- item sets ----
python3 "$RIG/src/items.py" "$SET" "$OUT/items.jsonl" | tee -a "$OUT/logs/rig.log" >&2
# ---- run-start exclusion (before any producer): ids + scores only, never utterances ----
rm -f "$OUT/excluded.json"
if [ ${#EXCL[@]} -gt 0 ]; then
  python3 "$RIG/src/exclude.py" "$OUT/items.jsonl" "$OUT/excluded.json" "${EXCL[@]}" 2>&1 | tee -a "$OUT/logs/rig.log" >&2
  NEX=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["nExcluded"])' "$OUT/excluded.json")
  if [ -n "${RIG_EXPECT_EXCLUDED:-}" ] && [ "$NEX" != "$RIG_EXPECT_EXCLUDED" ]; then
    log "DEVIATION: excluded $NEX item(s), pre-registration expected $RIG_EXPECT_EXCLUDED (all hits stay excluded)"
  fi
fi
VAL=
if [ "$TEMPS" = refit ] || [ -n "$VALFROM" ]; then
  if [ "$SET" = val ]; then VAL=$OUT
  elif [ -n "$VALFROM" ]; then VAL=$(cd "$VALFROM" && pwd)
  else VAL=$OUT/val; mkdir -p "$VAL"; python3 "$RIG/src/items.py" val "$VAL/items.jsonl" | tee -a "$OUT/logs/rig.log" >&2; fi
fi
NEED_VAL=0; [ -n "$VAL" ] && [ "$VAL" != "$OUT" ] && [ -z "$VALFROM" ] && NEED_VAL=1
DEV=
if [ "$TEMPS" = dev-cv ]; then
  if [ "$SET" = dev ]; then DEV=$OUT
  elif [ -n "$DEVFROM" ]; then DEV=$(cd "$DEVFROM" && pwd)
  else DEV=$OUT/dev; mkdir -p "$DEV"; python3 "$RIG/src/items.py" dev "$DEV/items.jsonl" | tee -a "$OUT/logs/rig.log" >&2; fi
fi
NEED_DEV=0; [ -n "$DEV" ] && [ "$DEV" != "$OUT" ] && [ -z "$DEVFROM" ] && NEED_DEV=1

# ---- server management ----
PID=
stop_server() { if [ -n "$PID" ]; then kill "$PID" 2>/dev/null || true; wait "$PID" 2>/dev/null || true; PID=; fi; }
trap stop_server EXIT INT TERM
start_server() { # <gguf> <log> <args...>
  local g=$1 lg=$2; shift 2
  PORT=$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1])')
  echo "$BIN -m $g --port $PORT --host 127.0.0.1 $*" > "$lg.cmd"
  "$BIN" -m "$g" --port "$PORT" --host 127.0.0.1 "$@" > "$lg" 2>&1 &
  PID=$!
  for _ in $(seq 1 480); do
    curl -sf "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && { export LLAMA_URL=http://127.0.0.1:$PORT; log "server up :$PORT ($(basename "$g"))"; return 0; }
    kill -0 "$PID" 2>/dev/null || { echo "llama-server died, see $lg" >&2; exit 1; }
    sleep 0.25
  done
  echo "llama-server did not come up, see $lg" >&2; exit 1
}
tsxrun() { # <tree> <script> args...
  local t=$1 s=$2; shift 2
  RIG_TREE=$t RIG_REPO=$REPO "$TSX" --tsconfig "$t/tsconfig.json" "$RIG/src/$s" "$@"
}

# ---- LoRA: step 1 (+ val), step 2 per level ----
start_server "$LORA" "$OUT/logs/lora-server.log" -c 4096 -np 1 --no-jinja --no-webui
log "step1 $SET"; tsxrun "$TREES/base" step1.ts "$OUT/items.jsonl" "$OUT/step1.jsonl" $ONLY 2>>"$OUT/logs/step1.log"
if [ $NEED_VAL = 1 ]; then log "step1 val (for temperature refit)"; tsxrun "$TREES/base" step1.ts "$VAL/items.jsonl" "$VAL/step1.jsonl" 2>>"$OUT/logs/step1-val.log"; fi
if [ $NEED_DEV = 1 ]; then log "step1 dev (for dev-cv temperatures)"; tsxrun "$TREES/base" step1.ts "$DEV/items.jsonl" "$DEV/step1.jsonl" 2>>"$OUT/logs/step1-dev.log"; fi
for lv in ${ARGS//,/ }; do
  log "step2 $lv"; RIG_LEVEL=$lv tsxrun "$TREES/$lv" step2.ts "$OUT/items.jsonl" "$OUT/args-$lv.jsonl" $ONLY 2>>"$OUT/logs/step2-$lv.log"
  if [ $NEED_DEV = 1 ]; then log "step2 $lv dev (dev-cv report)"; RIG_LEVEL=$lv tsxrun "$TREES/$lv" step2.ts "$DEV/items.jsonl" "$DEV/args-$lv.jsonl" 2>>"$OUT/logs/step2-$lv-dev.log"; fi
done
stop_server

# ---- Kev: one-stage option logprobs ----
if [ -n "$KEV" ]; then
  SERVED_T=$(python3 "$RIG/src/gguf_meta.py" "$KEV")
  DEC=$(basename "$KEV" .gguf)
  log "Kev servedT $SERVED_T (GGUF decision.temperature.choice)"
  start_server "$KEV" "$OUT/logs/kev-server.log" -c 8192
  kev_run() { # <dir>
    local d=$1
    python3 "$RIG/src/kev_items.py" "$d/items.jsonl" "$d/step1.jsonl" "$d/kev-items.json" >&2
    local n; n=$(python3 -c "import json,sys; print(len(json.load(open(sys.argv[1]))))" "$d/kev-items.json")
    if [ -f "$d/kev.jsonl" ] && [ "$(grep -c . "$d/kev.jsonl")" = "$n" ]; then log "kev $d: complete, skipped"; return; fi
    node "$KEVD/node/decide.mjs" --runtime server --port "$PORT" --decider "$DEC" --variant desc --wording W3 \
      --servedT "$SERVED_T" --items "$d/kev-items.json" --out "$d/kev.jsonl" 2>>"$OUT/logs/kev.log"
  }
  log "kev $SET"; kev_run "$OUT"
  if [ $NEED_VAL = 1 ]; then log "kev val"; kev_run "$VAL"; fi
  if [ $NEED_DEV = 1 ]; then log "kev dev"; kev_run "$DEV"; fi
  stop_server
fi

# ---- evaluate ----
python3 "$RIG/src/evaluate.py" "$OUT" ${VAL:+--val-dir "$VAL"} ${DEV:+--dev-dir "$DEV"} --temps "$TEMPS" ${TL:+--t-lora "$TL"} ${TK:+--t-kev "$TK"} \
  --levels "$ARGS" --excluded "$OUT/excluded.json" > "$OUT/logs/evaluate.log"
[ $NEED_VAL = 0 ] || python3 "$RIG/src/evaluate.py" "$VAL" --val-dir "$VAL" --temps refit > "$OUT/logs/evaluate-val.log" 2>&1 || true
[ $NEED_DEV = 0 ] || python3 "$RIG/src/evaluate.py" "$DEV" --dev-dir "$DEV" --temps dev-cv --levels "$ARGS" > "$OUT/logs/evaluate-dev.log" 2>&1 || true

# ---- manifest ----
python3 - "$OUT" "$LORA" "${KEV:-}" "$SET" "$ARGS" "$TEMPS" "$REV" "$RIG" "$BIN" "${VAL:-}" "${DEV:-}" "$TL" "$TK" <<'PY'
import glob, hashlib, json, subprocess, sys, os
out, lora, kev, set_, args, temps, rev, rig, binp, val, dev, tl, tk = sys.argv[1:14]
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
llama = subprocess.run(["git", "-C", os.path.dirname(os.path.dirname(os.path.dirname(binp))), "rev-parse", "--short", "HEAD"], capture_output=True, text=True).stdout.strip()
m = {"set": set_, "args": args.split(","), "temps": temps, "repoRev": rev, "lora": {"path": lora, "sha256": sha(lora)},
     "kev": {"path": kev, "sha256": sha(kev)} if kev else None, "valDir": val or None, "llamaServer": {"bin": binp, "llamaCppCommit": llama},
     "frozen": {l.split()[1]: l.split()[0] for l in open(f"{rig}/FROZEN.sha256") if l.strip() and not l.startswith("#")},
     "node": subprocess.run(["node", "--version"], capture_output=True, text=True).stdout.strip(),
     "tsx": subprocess.run(["tsx", "--version"], capture_output=True, text=True).stdout.split("\n")[0]}
R = json.load(open(f"{out}/results.json"))
m["tempsValues"] = {k: R[k] for k in ("explicit", "refit", "devCV") if k in R}
if "devCV" in m["tempsValues"]: m["tempsValues"]["devCV"] = {k: v for k, v in R["devCV"].items() if k != "loso"}
m["devDir"] = dev or None
m["rigFiles"] = {os.path.relpath(p, rig): sha(p) for p in sorted(glob.glob(f"{rig}/src/*.py") + glob.glob(f"{rig}/src/*.ts") + glob.glob(f"{rig}/src/*.sh") + [f"{rig}/rig.sh"])}
if os.path.exists(f"{out}/excluded.json"): m["excluded"] = json.load(open(f"{out}/excluded.json"))
pf = os.environ.get("RIG_PREREG_FILE")
if pf:
    got = sha(pf)
    assert got == os.environ.get("RIG_PREREG_SHA"), f"prereg file changed during the run: {got}"
    m["prereg"] = {"file": pf, "sha256": got, "run": os.environ.get("RIG_PREREG_RUN"), "expectExcluded": os.environ.get("RIG_EXPECT_EXCLUDED") or None}
json.dump(m, open(f"{out}/manifest.json", "w"), indent=1)
PY
log "done: $OUT/results.md"
cat "$OUT/results.md"
