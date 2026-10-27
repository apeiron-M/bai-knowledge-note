"""Pre-registration 3 analysis (stdlib only). Frozen by sha256 in x7-fusion/PREREGISTRATION-3.md.

  python3 prereg3_analysis.py --x5 <run> --f <run> [--x5-full <run> --f-full <run>]
                              [--parity-x5 <ref run> --parity-f <ref run>] --out <prefix>   (writes <prefix>.json/.md)

<run> = a rig.sh out dir (rows.jsonl + results.json from rig/src/evaluate.py). Arms, at the frozen temperatures:
  A         X5 alone                       (config lora of the --x5 run; reference only)
  B         X5 x Kev-FT PoE, T 1.63 / 4.0  (lora_x_kev of --x5) = C one-shot
  C         B + margin gate tau 0.5, fused top 3 (gate of --x5)
  D-oneshot F x Kev-FT PoE, T 2.08 / 4.0   (lora_x_kev of --f)
  D         D-oneshot + the same gate      (gate of --f)
The per-item machinery is prereg2_analysis.py (frozen a36ce55b..., imported, not copied): load (asserts the frozen
temperatures), outcomes (rig evaluate.decide), metrics, paired, check_within (totals == the rig's results.json explicit
block), wilson, determinism. Added here: P1/P2 (PASS iff op one-shot >= 90% of the scored action items, point estimate,
with Wilson 95%; secondary: one-sided exact binomial vs 0.90 with Holm step-down over the two, reported only), the gate
bars for C and D, Wilson CIs on effective fully-correct NORM and the wrong-dispatch rate, D vs C exact McNemar
(two-sided), the pre-registered shipping rule, and --parity (rows and metrics vs stored reference runs; exit 4 on failure).
"""
import json, os, sys
from fractions import Fraction
from math import comb

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import prereg2_analysis as P2  # noqa: E402  (puts rig/src on sys.path and imports evaluate as P2.EV)

EV = P2.EV
ALPHA, OP_BAR, GIO_BAR, ASK_BAR = 0.05, 0.90, 0.92, 0.30
SHIP_DELTA_PTS, SHIP_ALPHA = 3.0, 0.05
TRIE_TOL = 0.05
ARMS = [("A", "X5 alone (reference)", "x5", "lora"), ("B", "X5 x Kev-FT PoE (C one-shot)", "x5", "lora_x_kev"),
        ("C", "B + margin gate", "x5", "gate"), ("D-oneshot", "F x Kev-FT PoE (D one-shot)", "f", "lora_x_kev"),
        ("D", "D-oneshot + margin gate", "f", "gate")]
GATED = {"C", "D"}


def binom_ge(x, n, p0=Fraction(9, 10)):
    """Exact one-sided P(X >= x | n, p0) (H0: pi = 0.90 vs H1: pi > 0.90)."""
    if not n: return None
    return float(sum(comb(n, k) * p0 ** k * (1 - p0) ** (n - k) for k in range(x, n + 1)))


def pct(x, n): return round(100 * x / n, 2) if n else None


def enrich(m):
    """Rates + Wilson 95% on top of prereg2_analysis.metrics (counts unchanged)."""
    m = dict(m)
    m["fullyNormPct"], m["fullyNormWilson95"] = pct(m["fullyNorm"], m["nArgs"]), P2.wilson(m["fullyNorm"], m["nArgs"])
    m["goldInChoicesPct"] = pct(m["goldInChoices"], m["nAction"])
    m["askPct"] = pct(m["ask"], m["askDen"])
    m["wrongRatePct"], m["wrongWilson95"] = pct(m["wrong"], m["askDen"]), P2.wilson(m["wrong"], m["askDen"])
    if "effNorm" in m:
        m["effNormPct"], m["effNormWilson95"] = pct(m["effNorm"], m["nArgs"]), P2.wilson(m["effNorm"], m["nArgs"])
        m["effStrictPct"] = pct(m["effStrict"], m["nArgs"])
    return m


def view(runs, label, ids_only=None, check=True):
    """All arms on the shared items of the x5 and f runs. ids_only restricts to a subset (parity reference only)."""
    X5, F = runs["x5"], runs["f"]
    lvs = {tuple(M["levels"]) for M in runs.values()}
    if len(lvs) != 1 or len(next(iter(lvs))) != 1: raise SystemExit(f"{label}: runs must share exactly one args level, got {lvs}")
    lv = next(iter(lvs))[0]
    ref = X5["rows"]
    if set(F["rows"]) != set(ref): raise SystemExit(f"{label}: item ids differ between {X5['run']} and {F['run']}")
    for i, r in F["rows"].items():
        if any(r[k] != ref[i][k] for k in ("gold", "goldOps", "style", "difficulty", "multi", "hasStep2")):
            raise SystemExit(f"{label}: item {i} labels differ between runs")
    ids = [i for i in X5["order"] if not ref[i]["multi"] and (ids_only is None or i in ids_only)]
    O = {a: P2.outcomes(runs[k], cfg, lv) for a, _, k, cfg in ARMS}
    if check:
        for a, _, k, cfg in ARMS: P2.check_within(runs[k], cfg, O[a], lv)
    styles = sorted({ref[i]["style"] for i in ids if ref[i]["style"]})
    diffs = sorted({ref[i]["difficulty"] for i in ids if ref[i]["difficulty"] and ref[i]["gold"] != "none"})
    subsets = [("all", ids)] + [(f"style={s}", [i for i in ids if ref[i]["style"] == s]) for s in styles]
    subsets += [(f"difficulty={d} (action only)", [i for i in ids if ref[i]["gold"] != "none" and ref[i]["difficulty"] == d]) for d in diffs]
    subsets += [(f"style={s} x difficulty={d} (action only)",
                 [i for i in ids if ref[i]["gold"] != "none" and ref[i]["style"] == s and ref[i]["difficulty"] == d]) for s in styles for d in diffs]
    subsets = [(k, v) for k, v in subsets if v]
    res = {"label": label, "argsLevel": lv, "runs": {k: M["run"] for k, M in runs.items()},
           "temps": {k: [M["TL"], M["TK"]] for k, M in runs.items()},
           "excluded": {k: (M["R"].get("excluded") or {}).get("excludedIds", []) for k, M in runs.items()},
           "nItems": len(ids), "arms": {a: {s: enrich(P2.metrics(O[a], ref, sub, a in GATED)) for s, sub in subsets} for a, *_ in ARMS}}
    res["hypotheses"], res["decision"] = hypotheses(res, O, ref, ids)
    return res, O


def hypotheses(res, O, ref, ids):
    al = {a: res["arms"][a]["all"] for a, *_ in ARMS}
    h = {}
    prim = []
    for key, arm in (("P1", "B"), ("P2", "D-oneshot")):
        m = al[arm]; p = binom_ge(m["op"], m["nAction"])
        h[f"{key} {arm} op one-shot >= 90%"] = {"op": m["op"], "n": m["nAction"], "pct": m["opPct"], "wilson95": m["opWilson95"],
                                               "PASS (op >= 0.90 x n, point estimate)": bool(m["nAction"]) and 10 * m["op"] >= 9 * m["nAction"],
                                               "wilsonLowerAtLeast90 (descriptive)": (m["opWilson95"][0] or 0) >= OP_BAR,
                                               "secondary: oneSidedExactBinomialP (H0 pi=0.90)": p}
        prim.append((key, arm, p))
    holm, alive = {}, True   # secondary test only: Holm step-down over the two binomial p at family alpha 0.05
    for j, (key, arm, p) in enumerate(sorted(prim, key=lambda t: (t[2], t[0]))):
        thr = ALPHA / (len(prim) - j)
        alive = alive and p is not None and p < thr
        holm[key] = {"p": p, "threshold": thr, "rejected": alive}
    h["secondary: exact binomial vs 0.90, Holm over P1, P2 (reported, not the pass criterion)"] = holm
    for g in ("C", "D"):
        m = al[g]
        gio, ask = m["goldInChoices"] >= GIO_BAR * m["nAction"], m["ask"] <= ASK_BAR * m["askDen"]
        h[f"gate bars {g}"] = {"goldInChoices": [m["goldInChoices"], m["nAction"], m["goldInChoicesPct"]], "goldInChoicesMet (>= 92%)": gio,
                               "ask": [m["ask"], m["askDen"], m["askPct"]], "askMet (<= 30%)": ask, "met (both)": gio and ask,
                               "effNorm": [m["effNorm"], m["nArgs"], m["effNormPct"], m["effNormWilson95"]],
                               "effStrict": [m["effStrict"], m["nArgs"], m["effStrictPct"]],
                               "wrongDispatches": [m["wrong"], m["askDen"], m["wrongRatePct"], m["wrongWilson95"]]}
    c, d = al["C"], al["D"]
    pe, po = P2.paired(O["D"], O["C"], ref, ids, "effNorm"), P2.paired(O["D"], O["C"], ref, ids, "op")
    h["D vs C (descriptive; effNorm McNemar enters the shipping rule)"] = {
        **{k: {"D": d[k], "C": c[k]} for k in ("op", "fullyNorm", "fullyStrict", "goldInChoices", "ask", "wrong", "effNorm", "effStrict", "naTP")},
        "effNorm paired (D vs C, exact McNemar)": pe, "op paired (D vs C, exact McNemar)": po}
    h["reference: B vs A, D-oneshot vs A (op, paired)"] = {"B vs A": P2.paired(O["B"], O["A"], ref, ids, "op"),
                                                         "D-oneshot vs A": P2.paired(O["D-oneshot"], O["A"], ref, ids, "op")}
    delta = 100 * (d["effNorm"] - c["effNorm"]) / c["nArgs"] if c["nArgs"] else None
    ship_d = delta is not None and delta >= SHIP_DELTA_PTS and pe["twoSidedP"] < SHIP_ALPHA
    dec = {"rule": "ship D iff 100*(effNorm_D - effNorm_C)/nArgs >= 3.0 AND two-sided exact McNemar p (paired effNorm, D vs C) < 0.05; else ship C",
           "effNormD": d["effNorm"], "effNormC": c["effNorm"], "nArgs": c["nArgs"], "deltaPoints": delta,
           "mcnemarEffNorm": {"fixed (D right, C wrong)": pe["fixed"], "broken (C right, D wrong)": pe["broken"], "twoSidedP": pe["twoSidedP"]},
           "deltaAtLeast3": delta is not None and delta >= SHIP_DELTA_PTS, "mcnemarSignificant": pe["twoSidedP"] < SHIP_ALPHA,
           "ship": "D (F 1.2B x Kev-FT + gate)" if ship_d else "C (X5 350M x Kev-FT + gate)",
           "sizeNote": "C 229 + 530 MB on device; D 731 + 530 MB (F is 3.2x X5); F native latency ~1.9x X5 on step 1 and ~2.1x on step 2 (rig/validation/latency-b2b2-{f,x5}); Kev-FT is shared"}
    return h, dec


def parity(runs, refs):
    """Fresh runs vs stored reference runs: rows on shared ids, the ids only in the reference must be exactly the
    fresh run's excluded ids, and every metric of every arm/subset must equal the reference restricted to the same ids."""
    rep, ok = {}, True
    for k in runs:
        a, b = runs[k]["rows"], refs[k]["rows"]
        exc = set((runs[k]["R"].get("excluded") or {}).get("excludedIds", []))
        only_new, only_ref = sorted(set(a) - set(b)), sorted(set(b) - set(a))
        shared = sorted(set(a) & set(b))
        dl = max((abs(a[i]["loraExact"][o] - b[i]["loraExact"][o]) for i in shared for o in a[i]["opts"]), default=0)
        dk = max((abs(a[i]["kev"][o] - b[i]["kev"][o]) for i in shared if "kev" in a[i] for o in a[i]["opts"]), default=0)
        r = {"ref": refs[k]["run"], "shared": len(shared), "onlyInFresh": only_new, "onlyInRef": only_ref, "freshExcluded": sorted(exc),
             "optsDiff": sum(a[i]["opts"] != b[i]["opts"] for i in shared), "pickDiff": sum(a[i]["loraPick"] != b[i]["loraPick"] for i in shared),
             "argsDiff": sum(a[i]["args"] != b[i]["args"] for i in shared), "goldDiff": sum(a[i]["gold"] != b[i]["gold"] for i in shared),
             "maxAbsDeltaLoraExact": dl, "maxAbsDeltaKev": dk}
        r["ok"] = (not only_new and set(only_ref) == exc and r["optsDiff"] == r["pickDiff"] == r["argsDiff"] == r["goldDiff"] == 0
                   and dl <= TRIE_TOL and dk == 0)
        ok = ok and r["ok"]; rep[k] = r
    fresh, _ = view(runs, "fresh")
    keep = set(runs["x5"]["rows"])
    stored, _ = view(refs, "stored reference, restricted to the fresh run's items", ids_only=keep, check=False)
    diffs = [(a, s, f, fresh["arms"][a][s].get(f), stored["arms"][a].get(s, {}).get(f))
             for a in fresh["arms"] for s in fresh["arms"][a] for f in fresh["arms"][a][s]
             if fresh["arms"][a][s].get(f) != stored["arms"][a].get(s, {}).get(f)]
    same_h = fresh["hypotheses"] == stored["hypotheses"] and fresh["decision"] == stored["decision"]
    rep["metrics"] = {"subsetsCompared": sum(len(v) for v in fresh["arms"].values()), "differences": diffs[:20], "nDifferences": len(diffs),
                      "hypothesesAndDecisionEqual": same_h}
    ok = ok and not diffs and same_h
    rep["ok"] = ok
    return rep, stored


def md_view(res):
    L = [f"## {res['label']} (args level {res['argsLevel']}, {res['nItems']} single items)", "",
         "Excluded ids: " + "; ".join(f"{k}: {', '.join(v) or 'none'}" for k, v in res["excluded"].items()), ""]
    for s in res["arms"]["A"]:
        L += [f"### {s}", "", "| Arm | Op one-shot | Wilson 95% | Fully NORM | Fully STRICT | Gold-in-choices | Ask | Wrong (rate) | Eff NORM (Wilson 95%) / STRICT | NA TP / predNone |",
              "|---|---|---|---|---|---|---|---|---|---|"]
        for a, name, *_ in ARMS:
            m = res["arms"][a].get(s)
            if not m: continue
            w = m["opWilson95"]
            eff = f"{m['effNorm']} ({m['effNormWilson95'][0]}-{m['effNormWilson95'][1]}) / {m['effStrict']}" if "effNorm" in m else "-"
            L.append(f"| {a}: {name} | {m['op']}/{m['nAction']} ({m['opPct']}%) | {w[0]}-{w[1]} | {m['fullyNorm']}/{m['nArgs']} | {m['fullyStrict']} | "
                     f"{m['goldInChoices']} ({m['goldInChoicesPct']}%) | {m['ask']}/{m['askDen']} | {m['wrong']} ({m['wrongRatePct']}%) | {eff} | {m['naTP']}/{m['nNoAction']}, {m['predNone']} |")
        L.append("")
    L += ["### Hypotheses", "", "```json", json.dumps(res["hypotheses"], indent=1), "```", "",
          "### Shipping decision (pre-registered rule)", "", "```json", json.dumps(res["decision"], indent=1), "```", ""]
    return L


def main():
    a = sys.argv[1:]
    opt = lambda k: a[a.index(k) + 1] if k in a else None
    if not (opt("--x5") and opt("--f") and opt("--out")): raise SystemExit(__doc__)
    ex = {k: P2.load(opt("--" + k), k) for k in ("x5", "f")}
    out = {"analysis": os.path.abspath(__file__), "prereg2Analysis": os.path.abspath(P2.__file__)}
    out["primary"], _ = view(ex, "primary: with the pre-registered exclusion")
    L = ["# Pre-registration 3: analysis", ""] + md_view(out["primary"])
    if opt("--x5-full") and opt("--f-full"):
        full = {k: P2.load(opt(f"--{k}-full"), k) for k in ("x5", "f")}
        out["fullSet"], _ = view(full, "secondary: full set, no exclusion")
        out["determinism"] = P2.determinism(ex, full)
        L += md_view(out["fullSet"]) + ["## Determinism (excluded vs full runs)", "", "```json", json.dumps(out["determinism"], indent=1), "```", ""]
    rc = 0
    if opt("--parity-x5") and opt("--parity-f"):
        refs = {k: P2.load(opt(f"--parity-{k}"), k) for k in ("x5", "f")}
        out["parity"], stored = parity(ex, refs)
        L += ["## Parity vs stored reference runs", "", "```json", json.dumps(out["parity"], indent=1), "```", "",
              f"PARITY {'OK' if out['parity']['ok'] else 'FAIL'}", ""]
        rc = 0 if out["parity"]["ok"] else 4
    p = opt("--out")
    json.dump(out, open(p + ".json", "w"), indent=1)
    open(p + ".md", "w").write("\n".join(L))
    print("\n".join(L))
    sys.exit(rc)


if __name__ == "__main__":
    main()
