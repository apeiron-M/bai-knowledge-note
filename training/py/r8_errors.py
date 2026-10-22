"""Round-8 error types and per-op accuracy vs training rows for one config.

  python training/py/r8_errors.py results-r8-C3-k5.json --rows agreed-s1.jsonl [--json out.json]

Op misses on held-out action items are split into: gated (G3 sent it to
no-action), LoRA said no-action, gold not in the top k, wrong op in the top
k. Args misses (right op) list the mismatched fields. Per op: held-out items
and hits beside the op's kept training rows (full and step-1-only).
"""

from __future__ import annotations

import argparse
import json
from collections import Counter, defaultdict
from pathlib import Path

NONE = "none"
HELDOUT = {"h1", "h2"}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("results")
    ap.add_argument("--rows", required=True)
    ap.add_argument("--json")
    a = ap.parse_args()
    res = next(v for v in json.loads(Path(a.results).read_text()).values() if isinstance(v, dict) and "rows" in v)
    rows = [r for r in res["rows"] if r["set"] in HELDOUT]
    train = [json.loads(l) for l in Path(a.rows).read_text().splitlines() if l.strip()]
    full = Counter(r["op"] for r in train if not r.get("step1Only"))
    s1 = Counter(r["op"] for r in train if r.get("step1Only"))

    miss = Counter()
    pairs = Counter()
    for r in rows:
        if r["pick"] == r["expectedOp"]:
            continue
        if r.get("gate", {}).get("noAction"):
            miss["gated by G3"] += 1
        elif r["pick"] == NONE:
            miss["LoRA chose no-action"] += 1
        elif r.get("inTopK") is False:
            miss["gold not in top k"] += 1
        else:
            miss["wrong op among candidates"] += 1
            pairs[(r["expectedOp"], r["pick"])] += 1
    args_miss = Counter()
    for r in rows:
        if r["pick"] == r["expectedOp"] and r.get("exact") is False:
            for f in r.get("mismatched") or []:
                args_miss[f"{r['expectedOp']}.{f}"] += 1
            for f in r.get("extras") or []:
                args_miss[f"{r['expectedOp']}.{f} (extra)"] += 1
        if r["pick"] == r["expectedOp"] and r.get("refExact") is False:
            args_miss[f"{r['expectedOp']} (ref)"] += 1

    per_op: dict[str, dict] = defaultdict(lambda: {"items": 0, "hits": 0})
    for r in rows:
        p = per_op[r["expectedOp"]]
        p["items"] += 1
        p["hits"] += r["pick"] == r["expectedOp"]
    table = []
    for op, p in per_op.items():
        table.append({"op": op, **p, "trainFull": full[op], "trainStep1Only": s1[op]})
    # Kept training rows of the op (full + step-1-only; both train step 1).
    buckets: dict[str, list[int]] = {"0": [0, 0], "1-19": [0, 0], "20-39": [0, 0], "40+": [0, 0]}
    for t in table:
        n = t["trainFull"] + t["trainStep1Only"]
        b = "0" if n == 0 else "1-19" if n < 20 else "20-39" if n < 40 else "40+"
        buckets[b][0] += t["hits"]
        buckets[b][1] += t["items"]
    out = {"config": res["summary"]["config"], "heldoutActionItems": len(rows),
           "opMisses": dict(miss), "confusions": [f"{g} -> {p} x{n}" for (g, p), n in pairs.most_common(25)],
           "argsMisses": dict(args_miss.most_common(40)),
           "opAccByTrainRows": {k: f"{h}/{n}" for k, (h, n) in buckets.items()},
           "perOp": sorted(table, key=lambda t: (t["hits"] / t["items"], t["op"]))}
    print(json.dumps({k: v for k, v in out.items() if k != "perOp"}, indent=1))
    if a.json:
        Path(a.json).write_text(json.dumps(out, indent=1) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
