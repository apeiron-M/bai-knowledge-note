#!/bin/sh
# Kev-FT post-training step 1, run from the eval Mac: score the calibration split on the training Mac, then fit
# the decision temperature into head.pt (constantine-recipe.sh `calibrate`, under the MPS caps). Run only after
# $KEV_DATA/kev-ft.log on the training Mac ends with "EXIT 0". The shipped run took 14 min and fitted T = 2.7007.
# The untouched head is kept as runs/<run>-head.precal.pt.
#
#   training/kev/kev-ft-calibrate.sh
#
#   KEV_REMOTE       ssh host of the training Mac     default trainbox
#   KEV_REMOTE_KEV   kev clone, relative to its home  default kev
#   KEV_REMOTE_DATA  data dir, relative to its home   default x4
#   KEV_RUN          run name                         default x4-kev08-r1
set -eu
H=${KEV_REMOTE:-trainbox}
K=${KEV_REMOTE_KEV:-kev}
D=${KEV_REMOTE_DATA:-x4}
R=${KEV_RUN:-x4-kev08-r1}
ssh "$H" "cd ~/$K && PYTORCH_MPS_HIGH_WATERMARK_RATIO=0.5 PYTORCH_MPS_LOW_WATERMARK_RATIO=0.45 caffeinate -i .venv/bin/python -m kev.benchmark \
  --run runs/$R --data ~/$D/calibration.jsonl --device mps --out runs/$R-cal > ~/$D/kev-cal.log 2>&1 && \
  cp runs/$R/head.pt runs/$R-head.precal.pt && \
  .venv/bin/python scripts/calibrate_checkpoint.py --run runs/$R --rows runs/$R-cal/rows.json --allow-in-distribution >> ~/$D/kev-cal.log 2>&1; tail -20 ~/$D/kev-cal.log"
