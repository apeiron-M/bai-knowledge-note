"""Teacher batch-size comparison: funnel, diversity, position effect,
agreement and cost per arm, from the artifacts of the per-arm chain
(plan --batch-size B, run, rows, render.sh, label, run, agree).

    training/.venv/bin/python training/py/batchcmp.py <arm-dir>... --context context.json --out summary.json

Each arm dir holds gen-requests.jsonl(.meta.json), gen-results.jsonl(.usage.json),
rows.jsonl.summary.json, r1/{dedup-report,validate,rendered.manifest}.json,
label-results.jsonl.usage.json, agreed.jsonl(.summary.json) and the
optional timing.json ({"localS": ...}). Pairwise similarity is gte-small
cosine (training/gen/pairwise-similarity.ts, browser wasm numerics).
"""

from __future__ import annotations

import argparse
import json
import random
import re
import statistics
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from teacher import LENGTHS, REPO, op_words, uses_op_words  # noqa: E402

LIMIT = re.compile(r"api_error_status=429|spend limit|session limit|usage limit", re.I)


def jl(p: Path) -> list[dict]:
    return [json.loads(l) for l in p.read_text().splitlines() if l.strip()] if p.exists() else []


def norm(u: str) -> str:
    return " ".join(re.findall(r"[a-z0-9']+", u.lower()))


def ngrams(u: str, n: int) -> set[tuple]:
    w = norm(u).split()
    return {tuple(w[i:i + n]) for i in range(len(w) - n + 1)}


def pct(xs: list[float], q: float) -> float | None:
    xs = sorted(xs)
    return round(xs[min(len(xs) - 1, int(q * len(xs)))], 2) if xs else None


def usage(p: Path) -> dict:
    """Per-call latency and totals from a results file's attempts (incl. failed attempts)."""
    rows = jl(p)
    lat = [r["attempts"][-1]["wallS"] for r in rows if r.get("type") == "succeeded" and r.get("attempts")]
    tot = {"input": 0, "cacheWrite": 0, "cacheRead": 0, "output": 0, "thinking": 0, "costUsd": 0.0}
    for r in rows:
        for at in r.get("attempts", []):
            for k in tot:
                tot[k] += (at.get("usage") or {}).get(k) or 0
    summ = json.loads(Path(str(p) + ".usage.json").read_text()) if Path(str(p) + ".usage.json").exists() else {}
    errs = [a["error"] for r in rows for a in r.get("attempts", []) if not a.get("ok")]
    # Attempts lost to the account's spend/session limit (HTTP 429) are not
    # parse or model failures. The interrupted first invocation's attempts
    # (journaled or not) are all in <out>.limit-run1.usage.json; a resumed run
    # stops on the first 429 (exit 4), so it adds none unless it was cut short.
    run1 = Path(str(p) + ".limit-run1.usage.json")
    run1_limit = sum(1 for e in json.loads(run1.read_text())["attemptErrors"] if LIMIT.search(e)) if run1.exists() else 0
    limit = [e for e in errs if LIMIT.search(e)]
    return {"calls": len(rows), "succeeded": sum(r.get("type") == "succeeded" for r in rows),
            "attempts": sum(len(r.get("attempts", [])) for r in rows),
            "retriesExcludingLimit": len(errs) - len(limit),
            "otherAttemptErrors": [e for e in errs if not LIMIT.search(e)],
            "limitInterruptedAttempts": run1_limit if run1.exists() else len(limit),
            "wallS": summ.get("wallS"), "resumedFromJournal": summ.get("resumedFromJournal", 0),
            "sumLatencyOver3S": round(sum(lat) / 3, 1), "latencyMedianS": round(statistics.median(lat), 2) if lat else None,
            "latencyP90S": pct(lat, 0.9),
            "inputTokens": tot["input"] + tot["cacheWrite"] + tot["cacheRead"], "cacheRead": tot["cacheRead"],
            "outputTokens": tot["output"], "thinkingTokens": tot["thinking"], "costUsd": round(tot["costUsd"], 4)}


def returned_items(arm: Path, meta: dict) -> list[dict]:
    """Every item the teacher returned, with its call, list position and spec."""
    out = []
    for r in jl(arm / "gen-results.jsonl"):
        if r.get("type") != "succeeded":
            continue
        try:
            items = json.loads(r["text"])["items"]
        except (json.JSONDecodeError, KeyError):
            continue
        m = meta[r["custom_id"]]
        for j, it in enumerate(items):
            if not isinstance(it, dict) or not isinstance(it.get("utterance"), str):
                continue
            n = it.get("spec")
            sp = m["specs"][n - 1] if isinstance(n, int) and 1 <= n <= len(m["specs"]) else None
            out.append({"id": f"{r['custom_id']}-{j}", "call": r["custom_id"], "job": m["job"], "pos": j + 1,
                        "callSize": len(m["specs"]), "utterance": it["utterance"], "spec": sp})
    return out


def similarity(groups: dict[str, list[str]]) -> dict:
    with tempfile.TemporaryDirectory() as d:
        i, o = Path(d) / "in.json", Path(d) / "out.json"
        i.write_text(json.dumps(groups))
        subprocess.run(["npx", "--no-install", "tsx", "training/gen/pairwise-similarity.ts", str(i), str(o)],
                       cwd=REPO, check=True, capture_output=True)
        return json.loads(o.read_text())


def diversity(items: list[dict], ctx_by_name: dict, sim: dict | None) -> dict:
    by_job: dict[str, list[dict]] = {}
    for it in items:
        by_job.setdefault(it["job"], []).append(it)
    utts = [it["utterance"] for it in items]
    per_job_ng = {n: [] for n in (2, 3)}
    for rs in by_job.values():
        for n in (2, 3):
            grams = set().union(*(ngrams(r["utterance"], n) for r in rs))
            per_job_ng[n].append(len(grams) / len(rs) * 100)
    act = [it for it in items if it["job"].startswith("gen-")]
    free = [it for it in act if not uses_op_words(it["utterance"], op_words(ctx_by_name[it["job"]]))]
    names: dict[str, int] = {}
    for it in items:
        nm = (it["spec"] or {}).get("name")
        if nm and any(t.lower() in it["utterance"].lower() for t in nm.split()):
            names[nm] = names.get(nm, 0) + 1
    words = [len(u.split()) for u in utts]
    bucket = lambda n: next((k for k, (lo, hi) in LENGTHS.items() if n <= hi), "over 50")  # noqa: E731
    openers: dict[str, int] = {}
    for u in utts:
        k = " ".join(norm(u).split()[:2])
        openers[k] = openers.get(k, 0) + 1
    out = {
        "items": len(items),
        "distinctUtteranceRatio": round(len({norm(u) for u in utts}) / len(utts), 3) if utts else None,
        "distinct2gramsPer100PerOp": round(statistics.mean(per_job_ng[2]), 1) if items else None,
        "distinct3gramsPer100PerOp": round(statistics.mean(per_job_ng[3]), 1) if items else None,
        "distinct2gramsPer100All": round(len(set().union(*(ngrams(u, 2) for u in utts))) / len(utts) * 100, 1) if utts else None,
        "opWordFree": f"{len(free)}/{len(act)} ({len(free) / len(act):.0%})" if act else None,
        "opWordFreeOfAvoidSpecs": None, "opWordUsedOfUseSpecs": None,
        "maxNameReuse": max(names.values(), default=0),
        "lengthBuckets": {k: sum(1 for n in words if bucket(n) == k) for k in [*LENGTHS, "over 50"]},
        "wordsMedianMinMax": [statistics.median(words), min(words), max(words)] if words else None,
        "questionsShare": round(sum(u.rstrip().endswith("?") for u in utts) / len(utts), 2) if utts else None,
        "topOpeners": sorted(openers.items(), key=lambda kv: -kv[1])[:5],
    }
    av = [it for it in act if (it["spec"] or {}).get("avoid")]
    us = [it for it in act if (it["spec"] or {}).get("use")]
    if av:
        k = sum(1 for it in av if not uses_op_words(it["utterance"], it["spec"]["avoid"]))
        out["opWordFreeOfAvoidSpecs"] = f"{k}/{len(av)}"
    if us:
        k = sum(1 for it in us if uses_op_words(it["utterance"], it["spec"]["use"]))
        out["opWordUsedOfUseSpecs"] = f"{k}/{len(us)}"
    if sim is not None:
        vals = [v["meanCosine"] for v in sim.values() if v["meanCosine"] is not None]
        out["meanPairwiseCosinePerOp(gte-small)"] = round(statistics.mean(vals), 4) if vals else None
    return out


def arm_summary(arm: Path, ctx: dict, with_sim: bool, seed: int) -> dict:
    meta = json.loads((arm / "gen-requests.jsonl.meta.json").read_text())
    ctx_by_job = {f"gen-{k.replace(':', '--')}": o["opName"] for k, o in ctx.items()}
    requested = sum(len(m["specs"]) for m in meta.values())
    sizes = sorted({len(m["specs"]) for m in meta.values()})
    items = returned_items(arm, meta)
    rows_sum = json.loads((arm / "rows.jsonl.summary.json").read_text())
    dedup = json.loads((arm / "r1/dedup-report.json").read_text())
    val = json.loads((arm / "r1/validate.json").read_text())
    agree = json.loads((arm / "agreed.jsonl.summary.json").read_text())
    kept = jl(arm / "agreed.jsonl")
    gen, lab = usage(arm / "gen-results.jsonl"), usage(arm / "label-results.jsonl")
    timing = json.loads((arm / "timing.json").read_text()) if (arm / "timing.json").exists() else {}

    def cat(reason: str) -> str:
        if reason.startswith("context-leak"):
            return "contextLeak"
        if reason.startswith(("spec ", "wording:")):
            return "spec/wording"
        if reason.startswith("ref-mismatch"):
            return "refEcho"
        if reason.startswith("person "):
            return "personName"
        if reason in ("errored", "cancelled") or reason.startswith("unparseable"):
            return "lostCall"
        if reason.startswith("item is not"):
            return "badItem"
        return "grounding"
    rows_drops: dict[str, int] = {}
    for d in rows_sum["droppedDetail"]:
        if "id" in d:
            rows_drops[cat(d["reason"])] = rows_drops.get(cat(d["reason"]), 0) + 1
    calls_lost = [d for d in rows_sum["droppedDetail"] if "custom_id" in d]
    lost_items = sum(len(meta[d["custom_id"]]["specs"]) for d in calls_lost)
    dd_leak = sum(1 for x in dedup["rejected"] if x.get("reason") == "eval-leak")
    labeled = dedup["kept"] - len(val["summary"]["failed"]) - agree["gateRejected"]
    funnel = {
        "requested": requested, "returned": len(items),
        "callsLostOrUnparseable": len(calls_lost), "itemsLostWithCalls": lost_items,
        "shortCalls": len(rows_sum.get("shortCalls") or {}),
        "rowsStageDrops": rows_drops, "afterRows": rows_sum["rows"],
        "dedupEvalLeak": dd_leak, "dedupNearDuplicate": len(dedup["rejected"]) - dd_leak,
        "zodReplayRefChecks": len(val["summary"]["failed"]), "r61Gate": agree["gateRejected"],
        "labelDisagreeOp": agree["disagreeOnOp"], "labelDisagreeArgsOnly": agree["disagree"] - agree["disagreeOnOp"],
        "quotaDropped": agree["quotaDropped"], "nameCapDropped": agree["nameCapDropped"],
        "kept": len(kept), "yield": round(len(kept) / requested, 3),
    }
    agreement = {"labeled": labeled,
                 "op": f"{labeled - agree['disagreeOnOp']}/{labeled} ({(labeled - agree['disagreeOnOp']) / labeled:.1%})",
                 "exact": f"{labeled - agree['disagree']}/{labeled} ({(labeled - agree['disagree']) / labeled:.1%})",
                 "tolerant": f"{agree['agreeTolerant(case/final punctuation)']}/{labeled}"}

    # Position in list: drop before the label pass, and label disagreement, by position.
    reached_label = {r["id"] for r in jl(arm / "r1/rows-valid.jsonl")} - set(agree["gateRejectedIds"])
    disagree = {d["id"] for d in agree["detail"]}
    position = None
    big = max(sizes)
    if big > 1:
        full = [it for it in items if it["callSize"] == big]

        def stats(sel: list[dict]) -> dict:
            lab = [it for it in sel if it["id"] in reached_label]
            dis = [it for it in lab if it["id"] in disagree]
            return {"items": len(sel), "droppedBeforeLabel": f"{len(sel) - len(lab)}/{len(sel)}",
                    "labelDisagree": f"{len(dis)}/{len(lab)}"}
        position = {"callSize": big, "first5": stats([it for it in full if it["pos"] <= 5]),
                    "last5": stats([it for it in full if it["pos"] > big - 5])}
    groups = {}
    for it in items:
        groups.setdefault(it["job"], []).append(it["utterance"])
    sim = similarity(groups) if with_sim else None
    states = {json.dumps(m["scenario"]["state"]) for m in meta.values() if m.get("scenario")}
    cost = round(gen["costUsd"] + lab["costUsd"], 4)
    rng = random.Random(seed)
    sample = [{"utterance": r["utterance"], "op": r["op"], "args": r.get("args")}
              for r in rng.sample(kept, min(5, len(kept)))]
    return {
        "arm": arm.name, "callSizes": sizes, "generationCalls": len(meta),
        "distinctRefStates": len(states), "funnel": funnel, "agreement": agreement,
        "diversityReturned": diversity(items, ctx_by_job, sim),
        "diversityKept": diversity([it for it in items if it["id"] in {r["id"] for r in kept}], ctx_by_job, None),
        "position": position,
        "generation": gen, "label": lab, "localStagesS": timing.get("localS"),
        "costUsd": cost, "costPerKeptRowUsd": round(cost / len(kept), 4) if kept else None,
        "genCostPerKeptRowUsd": round(gen["costUsd"] / len(kept), 4) if kept else None,
        "sampleKept(seed)": sample,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("arms", nargs="+")
    ap.add_argument("--context", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--no-similarity", dest="sim", action="store_false")
    ap.add_argument("--seed", type=int, default=20261021)
    a = ap.parse_args()
    ctx = {o["key"]: o for o in json.loads(Path(a.context).read_text())}
    out = {"label": "observed (one run per arm); costUsd is the CLI's total_cost_usd, API-list-price equivalent",
           "arms": [arm_summary(Path(p), ctx, a.sim, a.seed) for p in a.arms]}
    Path(a.out).write_text(json.dumps(out, indent=1, ensure_ascii=False) + "\n")
    print(json.dumps(out, indent=1, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
