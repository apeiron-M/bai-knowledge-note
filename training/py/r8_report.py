"""Round-8 eval tables from the harness result files (per-item rows).

  python training/py/r8_report.py spike/llm-harness/eval/results-r8-*.json [--md out.md] [--json out.json]

Each file holds one or more `r8Run` results ({label: {summary, rows}}).
Metrics follow the round-8 pre-registration: op accuracy over action items,
args/refs over action items with the right op, fully right over action
items, no-action precision/recall with action items sent to no-action as
false positives, latency per utterance.
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

NONE = "none"
FOLD = {"heldout1": ["h1", "h1na"], "heldout2": ["h2", "h2na"], "dev": ["dev", "devx", "devna"]}


def q(xs: list[float], p: float) -> int | None:
    if not xs:
        return None
    s = sorted(xs)
    return round(s[min(len(s) - 1, max(0, math.ceil(p * len(s)) - 1))])


def frac(n: int, d: int) -> str:
    return f"{n}/{d} ({100 * n / d:.1f}%)" if d else "–"


def full(r: dict, key: str = "pick") -> bool:
    return r.get(key) == r["expectedOp"] and r.get("exact") is not False and r.get("refExact") is not False


def metrics(rows: list[dict]) -> dict:
    act = [r for r in rows if r["expectedOp"]]
    na = [r for r in rows if not r["expectedOp"]]
    right = [r for r in act if r["pick"] == r["expectedOp"]]
    scored = lambda k: [r for r in right if r.get(k) is not None]  # noqa: E731
    tp = sum(r["pick"] == NONE for r in na)
    fp = sum(r["pick"] == NONE for r in act)
    lat = [r["ms"]["total"] for r in rows]
    m = {
        "n": len(rows), "action": len(act),
        "op": frac(len(right), len(act)),
        "argsExact": frac(sum(r["exact"] for r in scored("exact")), len(scored("exact"))),
        "requiredPresent": frac(sum(r["requiredPresent"] for r in scored("requiredPresent")), len(scored("requiredPresent"))),
        "refExact": frac(sum(r["refExact"] for r in scored("refExact")), len(scored("refExact"))),
        "fullyRight": frac(sum(full(r) for r in act), len(act)),
        "noActionP": frac(tp, tp + fp) if na else "–",
        "noActionR": frac(tp, len(na)) if na else "–",
        "latMedian": q(lat, 0.5), "latP90": q(lat, 0.9),
    }
    if act and "inTopK" in act[0]:
        ink = [r for r in act if r.get("inTopK")]
        m["recallTopK"] = frac(len(ink), len(act))
        m["opGivenTopK"] = frac(sum(r["pick"] == r["expectedOp"] for r in ink), len(ink))
        ltp = sum(r.get("loraPick") == NONE for r in na)
        lfp = sum(r.get("loraPick") == NONE for r in act)
        m["loraOnly"] = {"op": frac(sum(r.get("loraPick") == r["expectedOp"] for r in act), len(act)),
                         "fullyRight": frac(sum(full(r, "loraPick") for r in act), len(act)),
                         "noActionP": frac(ltp, ltp + lfp) if na else "–",
                         "noActionR": frac(ltp, len(na)) if na else "–"}
        if act[0].get("variants"):
            m["variants"] = {v: frac(sum(r["variants"].get(v) == r["expectedOp"] for r in act), len(act))
                             for v in act[0]["variants"]}
    return m


def load(files: list[str]) -> dict[str, list[dict]]:
    runs: dict[str, list[dict]] = {}
    for f in files:
        for label, res in json.loads(Path(f).read_text()).items():
            if not isinstance(res, dict) or "rows" not in res:
                continue
            cfg = res["summary"]["config"]
            name = cfg["config"] + (f"-k{cfg.get('k', 5)}" if cfg["config"] in ("C2", "C3") else "")
            name += f"-{cfg['model']}" if cfg["config"] == "A" else ""
            runs[name] = res["rows"]
    return runs


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("files", nargs="+")
    ap.add_argument("--md")
    ap.add_argument("--json")
    a = ap.parse_args()
    runs = load(a.files)
    out: dict = {}
    lines = []
    for name, rows in runs.items():
        out[name] = {}
        for fold, members in FOLD.items():
            rs = [r for r in rows if r["set"] in members]
            if rs:
                out[name][fold] = metrics(rs)
        h2 = [r for r in rows if r["set"] in ("h2", "h2na")]
        for style in sorted({r.get("style") for r in h2 if r.get("style")}):
            out[name][f"heldout2/{style}"] = metrics([r for r in h2 if r.get("style") == style])
    cols = ["op", "opGivenTopK", "argsExact", "requiredPresent", "refExact", "noActionP", "noActionR", "fullyRight", "latMedian", "latP90"]
    for fold in ["heldout1", "heldout2", "heldout2/natural", "heldout2/paraphrase", "dev"]:
        lines.append(f"\n**{fold}**\n\n| Config | " + " | ".join(cols) + " |\n|" + "---|" * (len(cols) + 1))
        for name in runs:
            m = out[name].get(fold)
            if m:
                lines.append(f"| {name} | " + " | ".join(str(m.get(c, "–")) for c in cols) + " |")
    md = "\n".join(lines) + "\n"
    print(md)
    if a.md:
        Path(a.md).write_text(md)
    if a.json:
        Path(a.json).write_text(json.dumps(out, indent=1) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
