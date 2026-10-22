"""Round 10 eval tables from harness results (`r9Run` files).

    training/.venv/bin/python training/py/r10_report.py --groups training/data/round10/sibling-groups.json \
        --groups training/data/round10/sibling-groups-dev.json \
        E8=spike/llm-harness/eval/results-r10-E8-h4.json E10=... [--out summary.json]

Per run, over action items: op accuracy overall, by style, by difficulty,
on items tagged `sibling-confusion` and on items whose gold op is in a Round
10 sibling group; args exact given the right op, per schema kind (the
harness's `argKinds`) and per item tag (`list`, `exact-copy`, `enum`);
ref-id exact; no-action precision/recall; fully right; latency; miss causes.
Pure counting over the rows; nothing is re-scored.
"""
from __future__ import annotations

import argparse
import json
import math
from collections import Counter
from pathlib import Path

NONE = "none"  # NONE_KEY in chat/core/op-scorer.ts


def load(path: str) -> dict:
    d = json.loads(Path(path).read_text())
    return d if "rows" in d else next(iter(d.values()))


def frac(n: int, d: int) -> str:
    return f"{n}/{d}" + (f" ({100 * n / d:.1f}%)" if d else "")


def miss_cause(r: dict) -> str | None:
    pick, gold = r.get("loraPick"), r.get("expectedOp")
    if pick == gold:
        return None
    if pick == NONE:
        return "LoRA chose no-action"
    if not pick:
        return "no parse"
    if r.get("inList") is False:
        return "gold not in list"
    if str(pick).split(":")[0] != str(gold).split(":")[0]:
        return "other model's op"
    return "sibling in list"


def quantile(xs: list[float], q: float) -> int | None:
    if not xs:
        return None
    s = sorted(xs)
    return round(s[min(len(s) - 1, max(0, math.ceil(q * len(s)) - 1))])  # as the harness


def report(rows: list[dict], grouped: set[str]) -> dict:
    action = [r for r in rows if r.get("expectedOp")]
    na = [r for r in rows if not r.get("expectedOp") and not r.get("expectedOps")]
    multi = [r for r in rows if isinstance(r.get("expectedOps"), list)]
    ok = lambda r: r.get("loraPick") == r.get("expectedOp")  # noqa: E731
    right = [r for r in action if ok(r)]
    scored = [r for r in right if r.get("exact") is not None]

    def split(key) -> dict:
        out: dict[str, list[int]] = {}
        for r in action:
            k = key(r)
            out.setdefault(k, [0, 0])
            out[k][0] += ok(r)
            out[k][1] += 1
        return {k: frac(*v) for k, v in sorted(out.items())}
    tags = lambda r: set(r.get("tags") or [])  # noqa: E731
    sib = [r for r in action if "sibling-confusion" in tags(r)]
    ing = [r for r in action if r["expectedOp"] in grouped]

    def args_tag(t: str) -> str:
        xs = [r for r in scored if t in tags(r)]
        return frac(sum(r["exact"] is True for r in xs), len(xs))
    kinds: dict[str, list[int]] = {}
    for r in scored:
        bad = set(r.get("mismatched") or [])
        for p, k in (r.get("argKinds") or {}).items():
            kinds.setdefault(k, [0, 0])
            kinds[k][0] += p not in bad
            kinds[k][1] += 1
    refs = [r for r in right if r.get("refExact") is not None]
    tp = sum(r.get("loraPick") == NONE for r in na)
    fp = sum(r.get("loraPick") == NONE for r in action)
    fully = [r for r in action if ok(r) and r.get("exact") is not False and r.get("refExact") is not False]
    lat = [r["ms"]["ungated"] for r in rows if not r.get("expectedOps")]
    misses = Counter(c for c in map(miss_cause, action) if c)
    conf = Counter(f"{r['expectedOp'].split(':')[1]} -> {str(r.get('loraPick')).split(':')[-1]}"
                   for r in action if miss_cause(r) == "sibling in list")
    arg_miss = Counter(f"{r['expectedOp'].split(':')[1]}.{f}" for r in scored if r["exact"] is False
                       for f in (r.get("mismatched") or []) + [f"{e} (extra)" for e in (r.get("extras") or [])])
    return {
        "action": len(action), "noAction": len(na), "multiAction": len(multi),
        "op": frac(len(right), len(action)),
        "opByStyle": split(lambda r: str(r.get("style"))),
        "opByDifficulty": split(lambda r: f"{r.get('style')}/{r.get('difficulty')}"),
        "opSiblingTagged": frac(sum(map(ok, sib)), len(sib)),
        "opSiblingTaggedByStyle": {s: frac(sum(ok(r) for r in sib if r.get("style") == s),
                                           sum(r.get("style") == s for r in sib)) for s in ("natural", "paraphrase")},
        "opGoldInGroup": frac(sum(map(ok, ing)), len(ing)),
        "opGoldNotInGroup": frac(sum(ok(r) for r in action if r not in ing), len(action) - len(ing)),
        "argsExact": frac(sum(r["exact"] is True for r in scored), len(scored)),
        "argsByKindFields": {k: frac(*v) for k, v in sorted(kinds.items())},
        "argsExactByTag": {t: args_tag(t) for t in ("list", "exact-copy", "enum", "date", "ref")},
        "refExact": frac(sum(r["refExact"] is True for r in refs), len(refs)),
        "requiredPresent": frac(sum(r.get("requiredPresent") is True for r in right if r.get("requiredPresent") is not None),
                                sum(r.get("requiredPresent") is not None for r in right)),
        "noActionPR": {"tp": tp, "fp": fp, "fn": len(na) - tp,
                       "precision": frac(tp, tp + fp), "recall": frac(tp, len(na))},
        "multiFirstInExpected": frac(sum(str(r.get("loraPick")) in r["expectedOps"] for r in multi), len(multi)),
        "fullyRight": frac(len(fully), len(action)),
        "fullyRightByStyle": {s: frac(sum(r.get("style") == s for r in fully), sum(r.get("style") == s for r in action))
                              for s in ("natural", "paraphrase")},
        "latencyMs": {"median": quantile(lat, 0.5), "p90": quantile(lat, 0.9)},
        "misses": dict(misses.most_common()),
        "siblingConfusions": dict(conf.most_common()),
        "argsMisses": dict(arg_miss.most_common()),
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("runs", nargs="+", help="NAME=results.json")
    ap.add_argument("--groups", action="append", default=[])
    ap.add_argument("--out")
    a = ap.parse_args()
    grouped = {k for g in a.groups for grp in json.loads(Path(g).read_text())["groups"] for k in grp["ops"]}
    out = {}
    for spec in a.runs:
        name, path = spec.split("=", 1)
        d = load(path)
        out[name] = {"file": path, "model": d.get("model"), "config": d.get("config"), **report(d["rows"], grouped)}
    text = json.dumps(out, indent=1, ensure_ascii=False)
    if a.out:
        Path(a.out).write_text(text + "\n")
    print(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
