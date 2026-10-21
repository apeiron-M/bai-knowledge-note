"""Train/val split of a rendered train.jsonl, for loss monitoring only.

Grouped by source row (`meta.id`), so a row's step-1 and step-2
sequences land on the same side, and stratified by the row's op (`null`
for no-action): each op sends round(share * its rows) rows to val, at
least 1 when it has 10 or more rows. The held-out eval sets are never
in train.jsonl (dedup.py drops leaks), so they cannot reach either side.

  python training/py/split.py train.jsonl --out-dir DIR [--share 0.05] [--seed 20261021]
"""

from __future__ import annotations

import argparse
import json
import random
from collections import defaultdict
from pathlib import Path


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("train")
    ap.add_argument("--out-dir", required=True)
    ap.add_argument("--share", type=float, default=0.05)
    ap.add_argument("--seed", type=int, default=20261021)
    a = ap.parse_args()
    seqs = [json.loads(l) for l in Path(a.train).read_text().splitlines() if l.strip()]
    by_row: dict[str, list[dict]] = defaultdict(list)
    for s in seqs:
        by_row[s["meta"]["id"]].append(s)
    by_op: dict[str, list[str]] = defaultdict(list)
    for rid, ss in by_row.items():
        by_op[str(ss[0]["meta"]["op"])].append(rid)
    rng = random.Random(a.seed)
    val_ids: set[str] = set()
    per_op = {}
    for op in sorted(by_op):
        ids = sorted(by_op[op])
        k = round(len(ids) * a.share)
        if k == 0 and len(ids) >= 10:
            k = 1
        val_ids.update(rng.sample(ids, k))
        per_op[op] = {"rows": len(ids), "val": k}
    out = Path(a.out_dir)
    out.mkdir(parents=True, exist_ok=True)
    tr = [s for s in seqs if s["meta"]["id"] not in val_ids]
    va = [s for s in seqs if s["meta"]["id"] in val_ids]
    (out / "train-split.jsonl").write_text("".join(json.dumps(s, ensure_ascii=False) + "\n" for s in tr))
    (out / "val.jsonl").write_text("".join(json.dumps(s, ensure_ascii=False) + "\n" for s in va))
    summary = {"share": a.share, "seed": a.seed, "rows": len(by_row), "valRows": len(val_ids),
               "trainSequences": len(tr), "valSequences": len(va), "ops": len(by_op), "perOp": per_op}
    (out / "split.json").write_text(json.dumps(summary, indent=1) + "\n")
    print(json.dumps({k: v for k, v in summary.items() if k != "perOp"}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
