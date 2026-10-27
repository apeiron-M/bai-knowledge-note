"""Rig evaluator: X7 prereg_eval.py logic, generalised (stdlib only).

  python3 evaluate.py <run-dir> [--val-dir <dir>] [--dev-dir <dir>] [--temps refit|frozen|explicit|dev-cv]
                      [--t-lora <x> --t-kev <y>] [--levels base,x6,x9] [--excluded <excluded.json>]

Reads <run-dir>/{items,step1}.jsonl, kev.jsonl (optional), args-<level>.jsonl (any present).
Writes <run-dir>/rows.jsonl (assembled rows), results.json, results.md.

Configs (all share the X7 no-action rule: LoRA says {"ops": []} -> dispatch none, nothing asked):
  lora      LoRA native greedy R2c pick                                   (X7 C1)
  kev       argmax over non-none ops of Kev logprobsT1                    (X7 "Kev alone, LoRA none rule")
  lora_x_kev argmax over non-none ops of 0.5 log softmax(loraExact/T_L) + 0.5 log softmax(kev/T_K)   (X7 C2)
  gate      lora_x_kev + fused-margin gate: ask iff p1 - p2 < 0.50 (p = softmax of the fused score over
            all options incl. none; p1, p2 = two best non-none), offer fused top-3   (X7 C3)
Temperatures: "frozen" = X7's registered T_L 1.80 / T_K 1.00. "refit" = refit on the Round 8 teacher val
(168 single items, action + none, softmax over all options incl. none): T_L by X3 analyze.fit_T
(geometric grid 0.2 * 1.05^k <= 8, NLL of gold), T_K by X4 analysis.py (grid 0.25..10 step 0.25, NLL of
gold on oneStage logprobsT1). Both blocks are always computed when val data exists; --temps picks the headline.
"explicit" = the given --t-lora / --t-kev (block "explicit"). "dev-cv" = gate-calibration.md option G2: the same
two fitters pointed at the DEV rows (--dev-dir; held-out-3 + held-out-4, single + no-action, softmax over all
options incl. none), all-dev pair -> block "dev-cv"; plus a leave-one-group-out report on the dev rows
(fit on h3 -> test h4, fit on h4 -> test h3, test folds summed) -> results.json "devCV" (never the headline).
Metrics per config: op one-shot over single-action items; fully-correct = [dispatch == gold] and args-ok on
the GOLD op (STRICT, NORMALISED) per args level, over single-action items with step-2 labels; gate: effective
fully (optimistic user picks gold when offered), gold-in-choices, ask over single-action + no-action, wrong
dispatches; fixed/broken vs lora with one-sided exact McNemar p; split by the set's own style labels.
"""
import json, math, os, sys

T_FROZEN = (1.80, 1.00)
W_LORA, W_KEV, TAU, K_OFFER = 0.5, 0.5, 0.5, 3
LEVELS = ["base", "x6", "x9"]


def jl(p):
    return [json.loads(l) for l in open(p) if l.strip()] if os.path.exists(p) else []


def lsm(d, T):
    m = max(v / T for v in d.values()); z = math.log(sum(math.exp(v / T - m) for v in d.values())) + m
    return {k: v / T - z for k, v in d.items()}


def assemble(run):
    items = jl(f"{run}/items.jsonl"); S1 = {r["id"]: r for r in jl(f"{run}/step1.jsonl")}
    K = {r["id"]: r for r in jl(f"{run}/kev.jsonl")}
    A = {lv: {r["id"]: r for r in jl(f"{run}/args-{lv}.jsonl")} for lv in LEVELS}
    A = {lv: a for lv, a in A.items() if a}
    rows, missing = [], []
    for it in items:
        i = it["id"]
        if i not in S1: missing.append(i); continue
        s = S1[i]; opts = s["candidates"] + ["none"]
        assert set(s["loraExact"]) == set(opts) and s["loraPick"] in opts, i
        r = {"id": i, "set": it["set"], "group": it["group"], "style": it.get("style"), "difficulty": it.get("difficulty"),
             "multi": it["gold"] is None, "gold": it["gold"], "goldOps": it.get("goldOps"), "opts": opts,
             "loraPick": s["loraPick"], "loraExact": s["loraExact"], "loraBranch": s["loraBranch"], "floored": s["floored"],
             "hasStep2": it["hasStep2"]}
        if K:
            k = K[i]; kc = [c if c != "__none__" else "none" for c in k["candidates"]]
            assert kc == opts, i
            r["kev"] = dict(zip(opts, k["oneStage"]["logprobsT1"])); r["kevServedT"] = k["servedT"]
        args = {}
        for lv, a in A.items():
            if it["gold"] == "none": args[lv] = args[lv + "_norm"] = True   # as X7 assemble: none items carry no args
            elif it["hasStep2"] and i in a: args[lv] = a[i]["ok"]; args[lv + "_norm"] = a[i]["okN"]
            elif it["hasStep2"]: missing.append(f"args-{lv}/{i}")
        r["args"] = args
        rows.append(r)
    return rows, missing, list(A)


def decide(it, TL, TK):
    ops = [o for o in it["opts"] if o != "none"]
    lp = it["loraPick"]
    out = {"lora": (lp, False, [])}
    if "kev" not in it: return out
    if lp == "none":
        for c in ("kev", "lora_x_kev", "gate"): out[c] = ("none", False, [])
        return out
    L, K = lsm(it["loraExact"], TL), lsm(it["kev"], TK)
    out["kev"] = (max(ops, key=lambda o: K[o]), False, [])    # first max in catalog order (X7 fuse.top)
    s = {o: W_LORA * L[o] + W_KEV * K[o] for o in it["opts"]}
    m = max(s.values()); Z = sum(math.exp(v - m) for v in s.values()); p = {o: math.exp(s[o] - m) / Z for o in it["opts"]}
    r = sorted(ops, key=lambda o: (-p[o], it["opts"].index(o)))
    out["lora_x_kev"] = (r[0], False, [])
    asked = len(r) > 1 and p[r[0]] - p[r[1]] < TAU
    out["gate"] = (r[0], asked, r[:K_OFFER] if asked else [])
    return out


def mcnemar(fx, br):
    n = fx + br
    return sum(math.comb(n, k) for k in range(fx, n + 1)) / 2 ** n if n else 1.0


def evaluate(rows, TL, TK, levels):
    single = [r for r in rows if not r["multi"]]
    act = [r for r in single if r["gold"] != "none"]; na = [r for r in single if r["gold"] == "none"]
    D = {r["id"]: decide(r, TL, TK) for r in single}
    configs = [c for c in ["lora", "kev", "lora_x_kev", "gate"] if all(c in D[r["id"]] for r in single)]
    styles = sorted({r["style"] for r in act if r["style"]})
    res = {"temps": {"T_lora": TL, "T_kev": TK}, "nAction": len(act), "nNoAction": len(na), "nMulti": len(rows) - len(single),
           "nArgs": sum(r["hasStep2"] for r in act), "argsOnGold": {}, "configs": {}}
    for lv in levels:
        for v in (lv, lv + "_norm"):
            res["argsOnGold"][v] = sum(bool(r["args"].get(v)) for r in act if r["hasStep2"])
    for c in configs:
        def final(r):
            d, a, off = D[r["id"]][c]
            return d if not a else (r["gold"] if r["gold"] in off else "none-of-these")
        e = {}
        for lab, sub in [("all", act)] + [(st, [r for r in act if r["style"] == st]) for st in styles]:
            x = {"n": len(sub), "op": sum(D[r["id"]][c][0] == r["gold"] for r in sub), "nArgs": sum(r["hasStep2"] for r in sub)}
            for lv in levels:
                for v in (lv, lv + "_norm"):
                    x["fully_" + v] = sum(D[r["id"]][c][0] == r["gold"] and bool(r["args"].get(v)) for r in sub if r["hasStep2"])
                    if c == "gate": x["eff_" + v] = sum(final(r) == r["gold"] and bool(r["args"].get(v)) for r in sub if r["hasStep2"])
            x["goldInChoices"] = sum((r["gold"] in D[r["id"]][c][2]) if D[r["id"]][c][1] else D[r["id"]][c][0] == r["gold"] for r in sub)
            e[lab] = x
        e["ask"] = sum(D[r["id"]][c][1] for r in single); e["askDenominator"] = len(single)
        e["askByStyle"] = {st: [sum(D[r["id"]][c][1] for r in single if r["style"] == st), sum(r["style"] == st for r in single)] for st in styles}
        e["wrongDispatch"] = sum(final(r) not in (r["gold"], "none-of-these") for r in act) + sum(final(r) not in ("none", "none-of-these") for r in na)
        e["noAction"] = {"tp": sum(final(r) == "none" for r in na), "predNone": sum(final(r) == "none" for r in single), "n": len(na)}
        if c != "lora":
            c1 = {r["id"]: D[r["id"]]["lora"][0] == r["gold"] for r in act}; me = {r["id"]: D[r["id"]][c][0] == r["gold"] for r in act}
            fx = sum(me[k] and not c1[k] for k in c1); br = sum(c1[k] and not me[k] for k in c1)
            e["vsLora"] = {"fixed": fx, "broken": br, "mcnemarOneSidedP": mcnemar(fx, br)}
        res["configs"][c] = e
    M = [r for r in rows if r["multi"]]
    res["multi"] = {"n": len(M), **{f"{c} pick in goldOps": sum(decide(r, TL, TK)[c][0] in (r.get("goldOps") or []) for r in M) for c in configs}}
    return res


# ---------------- temperature refit on teacher val ----------------
def fit_T_lora(val_rows):
    """X3 analyze.fit_T on exact_sum: geometric grid 0.2*1.05^k <= 8.0001, NLL of gold (incl. none) over all options."""
    sub = [r for r in val_rows if not r["multi"]]
    def nll(T):
        return -sum(lsm(r["loraExact"], T)[r["gold"]] for r in sub) / len(sub)
    best, T = None, 0.2
    while T <= 8.0001:
        v = nll(T)
        if best is None or v < best[1]: best = (round(T, 3), v)
        T *= 1.05
    return best[0]


def fit_T_kev(val_rows):
    """X4 analysis.py: grid 0.25*i, i = 1..40, NLL of gold (incl. none) on oneStage logprobsT1."""
    sub = [r for r in val_rows if not r["multi"]]
    def nll(T):
        return -sum(math.log(max(math.exp(lsm(r["kev"], T)[r["gold"]]), 1e-12)) for r in sub) / len(sub)
    return min([0.25 * i for i in range(1, 41)], key=nll)


# ---------------- report ----------------
NAMES = {"lora": "LoRA alone", "kev": "Kev alone (LoRA none rule)", "lora_x_kev": "LoRA x Kev (equal-weight PoE)", "gate": "LoRA x Kev + margin gate tau 0.5"}


def md_block(res, levels, label):
    a = res["configs"]; st = [k for k in next(iter(a.values())) if k not in ("all", "ask", "askDenominator", "askByStyle", "wrongDispatch", "noAction", "vsLora")]
    nA, nArgs = res["nAction"], res["nArgs"]
    L = [f"### {label}: T_lora {res['temps']['T_lora']}, T_kev {res['temps']['T_kev']}", "",
         f"{nA} single-action, {res['nNoAction']} no-action, {res['nMulti']} multi; fully-correct over {nArgs} items with step-2 labels. "
         f"Args on the gold op (STRICT / NORM): " + ", ".join(f"{lv} {res['argsOnGold'][lv]} / {res['argsOnGold'][lv + '_norm']}" for lv in levels), ""]
    hdr = ["Config", "Op /" + str(nA)] + [f"op {s}" for s in st] + [f"fully {lv} STRICT / NORM" for lv in levels] + ["vs LoRA (p)", "gold-in-choices", "ask", "wrong", "NA tp / predNone"]
    L += ["| " + " | ".join(hdr) + " |", "|" + "---|" * len(hdr)]
    for c, e in a.items():
        x = e["all"]
        f = [f"{x['fully_' + lv]} / {x['fully_' + lv + '_norm']}" + (f" (eff {x['eff_' + lv]} / {x['eff_' + lv + '_norm']})" if c == "gate" else "") for lv in levels]
        vs = f"+{e['vsLora']['fixed']}/-{e['vsLora']['broken']} ({e['vsLora']['mcnemarOneSidedP']:.2g})" if "vsLora" in e else "-"
        gic = f"{x['goldInChoices']} ({100 * x['goldInChoices'] / max(1, x['n']):.1f}%)" + ("; " + ", ".join(f"{s} {e[s]['goldInChoices']}/{e[s]['n']}" for s in st) if c == "gate" else "")
        ask = f"{e['ask']}/{e['askDenominator']} ({100 * e['ask'] / max(1, e['askDenominator']):.1f}%)"
        L.append("| " + " | ".join([NAMES[c], f"{x['op']} ({100 * x['op'] / max(1, nA):.1f}%)"] + [f"{e[s]['op']}/{e[s]['n']}" for s in st] + f + [vs, gic, ask, str(e["wrongDispatch"]), f"{e['noAction']['tp']}/{e['noAction']['n']}, {e['noAction']['predNone']}"]) + " |")
    if res["multi"]["n"]:
        L += ["", "Multi-action (pick in expected ops): " + ", ".join(f"{k.split(' ')[0]} {v}/{res['multi']['n']}" for k, v in res["multi"].items() if k != "n")]
    return "\n".join(L)


def add_res(a, b):
    """Sum two evaluate() results (fold test sets) count by count; p-values are recomputed by the caller."""
    if isinstance(a, bool) or isinstance(b, bool): return a
    if isinstance(a, (int, float)) and isinstance(b, (int, float)): return a + b
    if isinstance(a, list): return [add_res(x, y) for x, y in zip(a, b)]
    if isinstance(a, dict): return {k: add_res(a[k], b[k]) if k in a and k in b else a.get(k, b.get(k)) for k in list(a) + [k for k in b if k not in a]}
    return a


def dev_cv(drows, levels, has_kev):
    """Leave-one-group-out over the dev groups (h3 <-> h4): per-expert T by NLL of gold on the train group(s),
    evaluate() on the test group, test folds summed. Returns (all-dev T_L, T_K, report)."""
    groups = sorted({r["group"] for r in drows})
    if len(groups) < 2: raise SystemExit(f"dev-cv needs >= 2 dev groups, got {groups}")
    TL = fit_T_lora(drows); TK = fit_T_kev(drows) if has_kev else T_FROZEN[1]
    folds, tot = {}, None
    for g in groups:
        tr = [r for r in drows if r["group"] != g]; te = [r for r in drows if r["group"] == g]
        tl = fit_T_lora(tr); tk = fit_T_kev(tr) if has_kev else T_FROZEN[1]
        res = evaluate(te, tl, tk, levels)
        folds[g] = {"T_lora": tl, "T_kev": tk, "nTestSingle": sum(not r["multi"] for r in te)}
        tot = res if tot is None else add_res(tot, res)
    for e in tot["configs"].values():
        if "vsLora" in e: e["vsLora"]["mcnemarOneSidedP"] = mcnemar(e["vsLora"]["fixed"], e["vsLora"]["broken"])
    tot["temps"] = {"T_lora": "per fold", "T_kev": "per fold"}
    return TL, TK, {"groups": groups, "nDevSingle": sum(not r["multi"] for r in drows), "T_lora": TL, "T_kev": TK,
                    "folds": folds, "loso": tot}


def main():
    a = sys.argv[1:]
    run = a[0]
    opt = lambda k, d=None: a[a.index(k) + 1] if k in a else d
    val_dir, dev_dir, headline = opt("--val-dir"), opt("--dev-dir"), opt("--temps", "refit")
    if headline not in ("refit", "frozen", "explicit", "dev-cv"): raise SystemExit("--temps refit|frozen|explicit|dev-cv")
    rows, missing, levels = assemble(run)
    want = opt("--levels")
    if want: levels = [lv for lv in want.split(",") if lv in levels]
    with open(f"{run}/rows.jsonl", "w") as f:
        for r in rows: f.write(json.dumps(r) + "\n")
    has_kev = all("kev" in r for r in rows)
    out = {"run": run, "levels": levels, "missing": missing, "floored": sum(r["floored"] for r in rows), "blocks": {}}
    exc = opt("--excluded")
    if exc and os.path.exists(exc): out["excluded"] = json.load(open(exc))
    out["blocks"]["frozen"] = evaluate(rows, *T_FROZEN, levels)
    if val_dir:
        vrows = rows if os.path.abspath(val_dir) == os.path.abspath(run) else assemble(val_dir)[0]
        TL = fit_T_lora(vrows)
        TK = fit_T_kev(vrows) if has_kev and all("kev" in r for r in vrows) else T_FROZEN[1]
        out["refit"] = {"valDir": val_dir, "nValSingle": sum(not r["multi"] for r in vrows), "T_lora": TL, "T_kev": TK}
        out["blocks"]["refit"] = evaluate(rows, TL, TK, levels)
    elif headline == "refit":
        print("WARN: no --val-dir, refit impossible; headline falls back to frozen temps", file=sys.stderr); headline = "frozen"
    if headline == "explicit":
        tl, tk = opt("--t-lora"), opt("--t-kev")
        if tl is None or (has_kev and tk is None): raise SystemExit("--temps explicit needs --t-lora (and --t-kev with Kev rows)")
        TL, TK = float(tl), float(tk) if tk is not None else T_FROZEN[1]
        if not (TL > 0 and TK > 0): raise SystemExit("temperatures must be > 0")
        out["explicit"] = {"T_lora": TL, "T_kev": TK}
        out["blocks"]["explicit"] = evaluate(rows, TL, TK, levels)
    if dev_dir:
        drows = rows if os.path.abspath(dev_dir) == os.path.abspath(run) else assemble(dev_dir)[0]
        dkev = has_kev and all("kev" in r for r in drows)
        TL, TK, cv = dev_cv(drows, levels, dkev)
        out["devCV"] = {"devDir": dev_dir, **cv}
        out["blocks"]["dev-cv"] = evaluate(rows, TL, TK, levels)
    elif headline == "dev-cv":
        raise SystemExit("--temps dev-cv needs --dev-dir (dev rows: held-out-3 + held-out-4)")
    out["headline"] = headline
    json.dump(out, open(f"{run}/results.json", "w"), indent=1)
    md = [f"# Rig results: {os.path.basename(os.path.abspath(run))}", "", f"Headline temperatures: **{headline}**."
          + (f" Refit on {out['refit']['nValSingle']} teacher-val items: T_lora {out['refit']['T_lora']}, T_kev {out['refit']['T_kev']}." if "refit" in out else "")
          + (f" Explicit: T_lora {out['explicit']['T_lora']}, T_kev {out['explicit']['T_kev']}." if "explicit" in out else "")
          + (f" Dev fit on {out['devCV']['nDevSingle']} dev items: T_lora {out['devCV']['T_lora']}, T_kev {out['devCV']['T_kev']}." if "devCV" in out else ""),
          f"Missing rows: {len(missing)}. Floored trie children: {out['floored']}.", ""]
    if "excluded" in out:
        ex = out["excluded"]
        md += [f"Excluded at run start ({ex['nExcluded']} item(s), dedup normalize + leak_hit, threshold {ex['threshold']}): "
               + ("; ".join(f"{m['spec']} -> " + (", ".join(f"{h['id']} (score {h['score']})" for h in m["hits"]) or "no hit") for m in ex["matches"])), ""]
    for b in ([headline] + [k for k in out["blocks"] if k != headline]):
        md += [md_block(out["blocks"][b], levels, b + (" (headline)" if b == headline else "")), ""]
    if "devCV" in out:
        cv = out["devCV"]
        md += [md_block(cv["loso"], levels, "dev-cv leave-one-group-out on the dev rows (" + ", ".join(
            f"test {g}: T_lora {f['T_lora']}, T_kev {f['T_kev']}" for g, f in cv["folds"].items()) + "), test folds summed"), ""]
    open(f"{run}/results.md", "w").write("\n".join(md))
    print("\n".join(md))


if __name__ == "__main__":
    main()
