#!/bin/bash
# Builds the three step-2 source trees from a pinned repo revision, never touching the repo:
#   trees/<rev>/base = git archive <rev> (editors document-models tests tsconfig.json package.json)
#   trees/<rev>/x6   = base + patches/x6-args-ship.patch
#   trees/<rev>/x9   = base + x6 patch + patches/x9-args2.patch (X9 applies on top of X6)
# node_modules / spike / vendor / training are symlinks to the repo working tree.
# The trees live OUTSIDE the repo (the root tsconfig includes **/*): $RIG_TREES, default
# ${BAI_TRAINING_TOOLS:-~/.cache/bai-training}/rig-trees/<rev12>. The patches are the committed copies in
# $RIG_PATCHES (default docs/superpowers/notes/in-browser-llm/exp-2026-10-23).
# Usage: build-trees.sh <rev>   (prints the trees dir)
set -euo pipefail
RIG=$(cd "$(dirname "$0")/.." && pwd)
REPO=${RIG_REPO:-$(cd "$RIG/../.." && pwd)}
PATCHES=${RIG_PATCHES:-$REPO/docs/superpowers/notes/in-browser-llm/exp-2026-10-23}
TREES=${RIG_TREES:-${BAI_TRAINING_TOOLS:-$HOME/.cache/bai-training}/rig-trees}
REV=$(git -C "$REPO" rev-parse "${1:-5e9c39046dcd8f08951a308e66c610dbd4c55c73}")
T=$TREES/${REV:0:12}
(cd "$RIG" && shasum -a 256 -c --quiet FROZEN.sha256) >&2
if [ -f "$T/.ok" ]; then echo "$T"; exit 0; fi
rm -rf "$T"; mkdir -p "$T"
for lvl in base x6 x9; do
  d=$T/$lvl; mkdir -p "$d"
  git -C "$REPO" archive "$REV" editors document-models tests tsconfig.json package.json | tar -x -C "$d"
  for l in node_modules spike vendor training; do ln -s "$REPO/$l" "$d/$l"; done
  case $lvl in
    x6) (cd "$d" && git apply "$PATCHES/x6-args-ship.patch");;
    x9) (cd "$d" && git apply "$PATCHES/x6-args-ship.patch" && git apply "$PATCHES/x9-args2.patch");;
  esac
done
echo "$REV" > "$T/.ok"
echo "$T"
