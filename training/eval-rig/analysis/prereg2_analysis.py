"""Pre-registration 2 analysis (stdlib only). Frozen by sha256 in x7-fusion/PREREGISTRATION-2.md.

  python3 prereg2_analysis.py --x5 <run> --f <run> --r8 <run>
                              [--x5-full <run> --f-full <run> --r8-full <run>] [--run1 <prereg-input-h5.jsonl>]
                              --out <prefix>            (writes <prefix>.json and <prefix>.md)

<run> = a rig.sh out dir (rows.jsonl + results.json, written by rig/src/evaluate.py). Arms, at the frozen temperatures:
  A = X5 alone (config lora of the --x5 run)        B = X5 x Kev-FT PoE (lora_x_kev, T 1.63 / 4.0)
  C = B + margin gate (gate, tau 0.5, fused top 3)  D = F x Kev-FT + gate (gate of the --f run, T 2.08 / 4.0)
  K = R8 alone (lora of the --r8 run; the R8 temperature does not enter the LoRA-alone config)
Per-item decisions come from rig evaluate.decide (imported, never re-implemented); the within-run totals are asserted
equal to each run's results.json "explicit" block. Cross-run statistics (B vs K, D vs C), the difficulty and
style x difficulty splits, Wilson CIs and the continuity / determinism checks are computed here.
The primary view is the excluded runs (--x5/--f/--r8); the full-set runs (--*-full) give the secondary view.
"""
import json, math, os, sys

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.normpath(os.path.join(HERE, "..", "src")))
import evaluate as EV  # noqa: E402

T = {"x5": (1.63, 4.0), "f": (2.08, 4.0), "r8": (2.184, None)}
ALPHA, GIO_BAR, ASK_BAR, OP_BAR = 0.05, 0.92, 0.30, 0.90
Z = 1.959963984540054


def jl(p): return [json.loads(l) for l in open(p) if l.strip()]


def load(run, key):
    R = json.load(open(os.path.join(run, "results.json")))
    if "explicit" not in R["blocks"]: raise SystemExit(f"{run}: no explicit block (temps must be explicit)")
    tl, tk = T[key]
    got = R["blocks"]["explicit"]["temps"]
    if abs(got["T_lora"] - tl) > 1e-9 or (tk is not None and abs(got["T_kev"] - tk) > 1e-9):
        raise SystemExit(f"{run}: explicit temps {got} != frozen {T[key]}")
    rows = jl(os.path.join(run, "rows.jsonl"))
    if R.get("missing"): raise SystemExit(f"{run}: missing rows {R['missing'][:5]}")
    return {"run": os.path.abspath(run), "R": R, "rows": {r["id"]: r for r in rows}, "order": [r["id"] for r in rows],
            "TL": got["T_lora"], "TK": got["T_kev"], "levels": R["levels"]}


def wilson(x, n):
    if not n: return [None, None]
    p = x / n; d = 1 + Z * Z / n
    c = (p + Z * Z / (2 * n)) / d; h = Z * math.sqrt(p * (1 - p) / n + Z * Z / (4 * n * n)) / d
    return [round(c - h, 4), round(c + h, 4)]


def two_sided(fx, br): return min(1.0, 2 * min(EV.mcnemar(fx, br), EV.mcnemar(br, fx)))


def outcomes(M, cfg, lv):
    """Per-item outcome of config cfg of run M: dispatch, asked, offered, final, args ok (STRICT / NORM)."""
    out = {}
    for i, r in M["rows"].items():
        if r["multi"]: continue
        d, asked, off = EV.decide(r, M["TL"], M["TK"])[cfg]
        fin = d if not asked else (r["gold"] if r["gold"] in off else "none-of-these")
        out[i] = {"d": d, "asked": asked, "off": off, "final": fin,
                  "s": bool(r["args"].get(lv)), "n": bool(r["args"].get(lv + "_norm"))}
    return out


def metrics(O, rows, ids, gated):
    act = [i for i in ids if rows[i]["gold"] != "none"]; na = [i for i in ids if rows[i]["gold"] == "none"]
    a2 = [i for i in act if rows[i]["hasStep2"]]
    g = lambda i: rows[i]["gold"]
    m = {"nAction": len(act), "nNoAction": len(na), "nArgs": len(a2),
         "op": sum(O[i]["d"] == g(i) for i in act),
         "fullyNorm": sum(O[i]["d"] == g(i) and O[i]["n"] for i in a2),
         "fullyStrict": sum(O[i]["d"] == g(i) and O[i]["s"] for i in a2),
         "goldInChoices": sum((g(i) in O[i]["off"]) if O[i]["asked"] else O[i]["d"] == g(i) for i in act),
         "ask": sum(O[i]["asked"] for i in act + na), "askDen": len(act) + len(na),
         "wrong": sum(O[i]["final"] not in (g(i), "none-of-these") for i in act) + sum(O[i]["final"] not in ("none", "none-of-these") for i in na),
         "naTP": sum(O[i]["final"] == "none" for i in na), "predNone": sum(O[i]["final"] == "none" for i in act + na)}
    if gated:
        m["effNorm"] = sum(O[i]["final"] == g(i) and O[i]["n"] for i in a2)
        m["effStrict"] = sum(O[i]["final"] == g(i) and O[i]["s"] for i in a2)
    n = m["nAction"]
    m["opPct"] = round(100 * m["op"] / n, 1) if n else None
    m["opWilson95"] = wilson(m["op"], n)
    return m


def paired(Ox, Oy, rows, ids, key):
    """x vs y on action items: fixed = x right & y wrong, broken = y right & x wrong."""
    act = [i for i in ids if rows[i]["gold"] != "none"]
    if key == "op": ok = lambda O, i: O[i]["d"] == rows[i]["gold"]
    elif key == "fullyNorm": act = [i for i in act if rows[i]["hasStep2"]]; ok = lambda O, i: O[i]["d"] == rows[i]["gold"] and O[i]["n"]
    elif key == "effNorm": act = [i for i in act if rows[i]["hasStep2"]]; ok = lambda O, i: O[i]["final"] == rows[i]["gold"] and O[i]["n"]
    fx = sum(ok(Ox, i) and not ok(Oy, i) for i in act); br = sum(ok(Oy, i) and not ok(Ox, i) for i in act)
    return {"n": len(act), "fixed": fx, "broken": br, "oneSidedP": EV.mcnemar(fx, br), "twoSidedP": two_sided(fx, br)}


def check_within(M, cfg, O, lv):
    """Totals from the imported decide must equal the rig's own results.json explicit block."""
    e = M["R"]["blocks"]["explicit"]["configs"][cfg]; x = e["all"]
    m = metrics(O, M["rows"], [i for i in M["order"] if not M["rows"][i]["multi"]], cfg == "gate")
    pairs = [("op", x["op"]), ("fullyStrict", x["fully_" + lv]), ("fullyNorm", x["fully_" + lv + "_norm"]),
             ("goldInChoices", x["goldInChoices"]), ("ask", e["ask"]), ("askDen", e["askDenominator"]),
             ("wrong", e["wrongDispatch"]), ("naTP", e["noAction"]["tp"]), ("predNone", e["noAction"]["predNone"])]
    if cfg == "gate": pairs += [("effStrict", x["eff_" + lv]), ("effNorm", x["eff_" + lv + "_norm"])]
    bad = [(k, m[k], v) for k, v in pairs if m[k] != v]
    if bad: raise SystemExit(f"{M['run']} {cfg}: analysis != rig results.json explicit block: {bad}")


def view(runs, label):
    X5, F, R8 = runs["x5"], runs["f"], runs["r8"]
    lvs = {tuple(M["levels"]) for M in runs.values()}
    if len(lvs) != 1 or len(next(iter(lvs))) != 1: raise SystemExit(f"{label}: runs must share exactly one args level, got {lvs}")
    lv = next(iter(lvs))[0]
    ref = X5["rows"]; ids = [i for i in X5["order"] if not ref[i]["multi"]]
    for M in (F, R8):   # identity: same items, labels and step-2 flags in every run
        if set(M["rows"]) != set(ref): raise SystemExit(f"{label}: item ids differ between {X5['run']} and {M['run']}")
        for i, r in M["rows"].items():
            if any(r[k] != ref[i][k] for k in ("gold", "goldOps", "style", "difficulty", "multi", "hasStep2")):
                raise SystemExit(f"{label}: item {i} labels differ between runs")
    O = {"A": outcomes(X5, "lora", lv), "B": outcomes(X5, "lora_x_kev", lv), "C": outcomes(X5, "gate", lv),
         "D": outcomes(F, "gate", lv), "K": outcomes(R8, "lora", lv),
         "F alone (descriptive)": outcomes(F, "lora", lv), "F x Kev-FT PoE (descriptive)": outcomes(F, "lora_x_kev", lv)}
    for arm, M, cfg in (("A", X5, "lora"), ("B", X5, "lora_x_kev"), ("C", X5, "gate"), ("D", F, "gate"), ("K", R8, "lora"),
                        ("F alone (descriptive)", F, "lora"), ("F x Kev-FT PoE (descriptive)", F, "lora_x_kev")):
        check_within(M, cfg, O[arm], lv)
    gated = {"C", "D"}
    styles = sorted({ref[i]["style"] for i in ids if ref[i]["style"]})
    diffs = sorted({ref[i]["difficulty"] for i in ids if ref[i]["difficulty"] and ref[i]["gold"] != "none"})
    subsets = [("all", ids)] + [(f"style={s}", [i for i in ids if ref[i]["style"] == s]) for s in styles]
    subsets += [(f"difficulty={d} (action only)", [i for i in ids if ref[i]["gold"] != "none" and ref[i]["difficulty"] == d]) for d in diffs]
    subsets += [(f"style={s} x difficulty={d} (action only)", [i for i in ids if ref[i]["gold"] != "none" and ref[i]["style"] == s and ref[i]["difficulty"] == d])
                for s in styles for d in diffs]
    subsets = [(k, v) for k, v in subsets if v]
    res = {"label": label, "argsLevel": lv, "runs": {k: M["run"] for k, M in runs.items()},
           "temps": {k: [M["TL"], M["TK"]] for k, M in runs.items()},
           "excluded": {k: (M["R"].get("excluded") or {}).get("excludedIds", []) for k, M in runs.items()},
           "arms": {a: {s: metrics(O[a], ref, sub, a in gated) for s, sub in subsets} for a in O}}
    act_all = res["arms"]["B"]["all"]
    h = {}
    p1 = paired(O["B"], O["A"], ref, ids, "op"); p2 = paired(O["B"], O["K"], ref, ids, "op")
    h["H1 B > A (op one-shot, one-sided exact McNemar)"] = {**p1, "confirmed": p1["fixed"] > p1["broken"] and p1["oneSidedP"] < ALPHA,
                                                          "fullyNorm (secondary)": paired(O["B"], O["A"], ref, ids, "fullyNorm")}
    h["H2 B > K (op one-shot, one-sided exact McNemar)"] = {**p2, "confirmed": p2["fixed"] > p2["broken"] and p2["oneSidedP"] < ALPHA,
                                                          "fullyNorm (secondary)": paired(O["B"], O["K"], ref, ids, "fullyNorm")}
    ps = sorted([("H1", p1), ("H2", p2)], key=lambda t: t[1]["oneSidedP"])   # Holm, reported alongside
    holm, alive = {}, True
    for j, (k, p) in enumerate(ps):
        alive = alive and p["fixed"] > p["broken"] and p["oneSidedP"] < ALPHA / (len(ps) - j)
        holm[k] = alive
    h["Holm (H1, H2; reported, not the decision rule)"] = holm
    h["H3 B op one-shot >= 90% (descriptive)"] = {"op": act_all["op"], "n": act_all["nAction"], "pct": act_all["opPct"],
                                                 "wilson95": act_all["opWilson95"], "met": act_all["op"] >= OP_BAR * act_all["nAction"],
                                                 "ciLowerAtLeast90": (act_all["opWilson95"][0] or 0) >= OP_BAR}
    c = res["arms"]["C"]["all"]; a = res["arms"]["A"]["all"]
    h["H4 gate C bars"] = {"goldInChoices": [c["goldInChoices"], c["nAction"], round(c["goldInChoices"] / c["nAction"], 4)],
                           "goldInChoicesMet": c["goldInChoices"] >= GIO_BAR * c["nAction"],
                           "ask": [c["ask"], c["askDen"], round(c["ask"] / c["askDen"], 4)], "askMet": c["ask"] <= ASK_BAR * c["askDen"],
                           "wrongDispatches": c["wrong"], "wrongDispatchesReference": {k: res["arms"][k]["all"]["wrong"] for k in ("A", "B", "K", "D")},
                           "effNorm": c["effNorm"], "effStrict": c["effStrict"], "A fullyNorm": a["fullyNorm"],
                           "effNorm - A fullyNorm per 100": round(100 * (c["effNorm"] - a["fullyNorm"]) / a["nArgs"], 2) if a["nArgs"] else None}
    # C eff vs A one-shot fully, paired: C's final vs A's dispatch, both NORM args
    act2 = [i for i in ids if ref[i]["gold"] != "none" and ref[i]["hasStep2"]]
    fx = sum((O["C"][i]["final"] == ref[i]["gold"] and O["C"][i]["n"]) and not (O["A"][i]["d"] == ref[i]["gold"] and O["A"][i]["n"]) for i in act2)
    br = sum((O["A"][i]["d"] == ref[i]["gold"] and O["A"][i]["n"]) and not (O["C"][i]["final"] == ref[i]["gold"] and O["C"][i]["n"]) for i in act2)
    h["H4 gate C bars"]["C effNorm vs A fullyNorm (paired)"] = {"n": len(act2), "fixed": fx, "broken": br, "oneSidedP": EV.mcnemar(fx, br)}
    h["H4 gate C bars"]["met (gold-in-choices and ask)"] = h["H4 gate C bars"]["goldInChoicesMet"] and h["H4 gate C bars"]["askMet"]
    d = res["arms"]["D"]["all"]
    h["H5 D vs C (descriptive)"] = {k: {"D": d[k], "C": c[k]} for k in ("op", "fullyNorm", "fullyStrict", "goldInChoices", "ask", "wrong", "effNorm", "effStrict", "naTP")}
    h["H5 D vs C (descriptive)"]["op paired (D vs C)"] = paired(O["D"], O["C"], ref, ids, "op")
    h["H5 D vs C (descriptive)"]["effNorm paired (D vs C)"] = paired(O["D"], O["C"], ref, ids, "effNorm")
    res["hypotheses"] = h
    res["multi"] = {k: M["R"]["blocks"]["explicit"]["multi"] for k, M in runs.items()}
    return res, O


def determinism(ex, full):
    """Excluded vs full runs of the same model: every shared row must be identical (deterministic producers)."""
    out = {}
    for k in ex:
        a, b = ex[k]["rows"], full[k]["rows"]
        shared = sorted(set(a) & set(b)); extra = sorted(set(b) - set(a))
        if set(a) - set(b): raise SystemExit(f"determinism {k}: excluded run has ids missing from the full run")
        dl = max((abs(a[i]["loraExact"][o] - b[i]["loraExact"][o]) for i in shared for o in a[i]["opts"]), default=0)
        dk = max((abs(a[i]["kev"][o] - b[i]["kev"][o]) for i in shared if "kev" in a[i] for o in a[i]["opts"]), default=0)
        out[k] = {"shared": len(shared), "onlyInFull": extra,
                  "pickDiff": sum(a[i]["loraPick"] != b[i]["loraPick"] for i in shared),
                  "argsDiff": sum(a[i]["args"] != b[i]["args"] for i in shared),
                  "maxAbsDeltaLoraExact": dl, "maxAbsDeltaKev": dk}
    return out


def continuity(r8, path):
    """K vs run 1's C1 (same R8 GGUF, same step-1 path): picks and trie scores per shared item."""
    if not path or not os.path.exists(path): return None
    old = {r["id"]: r for r in jl(path)}; new = r8["rows"]
    shared = sorted(set(old) & set(new))
    act = [i for i in shared if not new[i]["multi"] and new[i]["gold"] != "none"]
    dl = max((abs(old[i]["loraExact"][o] - new[i]["loraExact"][o]) for i in shared for o in new[i]["opts"] if o in old[i]["loraExact"]), default=0)
    return {"run1": os.path.abspath(path), "shared": len(shared), "onlyRun1": len(set(old) - set(new)), "onlyRun2": len(set(new) - set(old)),
            "pickAgree": sum(old[i]["loraPick"] == new[i]["loraPick"] for i in shared),
            "goldAgree": sum(old[i]["gold"] == new[i]["gold"] for i in shared),
            "maxAbsDeltaLoraExact": round(dl, 4),
            "opRun1": sum(old[i]["loraPick"] == old[i]["gold"] for i in act), "opRun2": sum(new[i]["loraPick"] == new[i]["gold"] for i in act),
            "nAction": len(act)}


ARMS = [("A", "X5 alone"), ("B", "X5 x Kev-FT PoE"), ("C", "B + gate"), ("D", "F x Kev-FT + gate"), ("K", "R8 alone (control)"),
        ("F alone (descriptive)", "F alone"), ("F x Kev-FT PoE (descriptive)", "F x Kev-FT PoE")]


def md_view(res):
    L = [f"## {res['label']} (args level {res['argsLevel']})", "",
         "Excluded ids: " + "; ".join(f"{k}: {', '.join(v) or 'none'}" for k, v in res["excluded"].items()), ""]
    for s in res["arms"]["A"]:
        L += [f"### {s}", "", "| Arm | Op one-shot | Wilson 95% | Fully NORM | Fully STRICT | Gold-in-choices | Ask | Wrong | Eff NORM (STRICT) | NA TP / predNone |",
              "|---|---|---|---|---|---|---|---|---|---|"]
        for a, name in ARMS:
            m = res["arms"][a][s]
            eff = f"{m['effNorm']} ({m['effStrict']})" if "effNorm" in m else "-"
            w = m["opWilson95"]
            L.append(f"| {a}: {name} | {m['op']}/{m['nAction']} ({m['opPct']}%) | {w[0]}-{w[1]} | {m['fullyNorm']}/{m['nArgs']} | {m['fullyStrict']} | "
                     f"{m['goldInChoices']} | {m['ask']}/{m['askDen']} | {m['wrong']} | {eff} | {m['naTP']}/{m['nNoAction']}, {m['predNone']} |")
        L.append("")
    L += ["### Hypotheses", "", "```json", json.dumps(res["hypotheses"], indent=1), "```", ""]
    return L


def main():
    a = sys.argv[1:]
    opt = lambda k: a[a.index(k) + 1] if k in a else None
    if not (opt("--x5") and opt("--f") and opt("--r8") and opt("--out")): raise SystemExit(__doc__)
    ex = {k: load(opt("--" + k), k) for k in ("x5", "f", "r8")}
    out = {"analysis": os.path.abspath(__file__)}
    primary, _ = view(ex, "primary: with the pre-registered exclusion")
    out["primary"] = primary
    if all(opt(f"--{k}-full") for k in ("x5", "f", "r8")):
        full = {k: load(opt(f"--{k}-full"), k) for k in ("x5", "f", "r8")}
        out["fullSet"], _ = view(full, "secondary: full set, no exclusion")
        out["determinism"] = determinism(ex, full)
        out["continuity"] = continuity(full["r8"], opt("--run1"))
    else:
        out["continuity"] = continuity(ex["r8"], opt("--run1"))
    p = opt("--out")
    json.dump(out, open(p + ".json", "w"), indent=1)
    L = ["# Pre-registration 2: analysis", ""] + md_view(out["primary"])
    if "fullSet" in out: L += md_view(out["fullSet"]) + ["## Determinism (excluded vs full runs)", "", "```json", json.dumps(out["determinism"], indent=1), "```", ""]
    L += ["## Continuity (K vs run-1 C1)", "", "```json", json.dumps(out["continuity"], indent=1), "```", ""]
    open(p + ".md", "w").write("\n".join(L))
    print("\n".join(L))


if __name__ == "__main__":
    main()
