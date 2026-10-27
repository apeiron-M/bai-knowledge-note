"""Gate calibration analysis (dev only, no inference). Reuses the rig's evaluate.py (lsm, decide, fit_T_*).

  RIG_VALIDATION=<dir holding r8-kevq4-dev, x1-kevq4-dev, x5-kevq4-dev> python3 calib.py
Default RIG_VALIDATION: $RIG_EXP/rig/validation ($RIG_EXP default: the gitignored backup training/artifacts/exp-2026-10-23).
The run dir names in RUNS are the ones of the gate-calibration study (rig-gate-calibration.md); edit them for new arms.
"""
import json, math, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
EXP = os.environ.get("RIG_EXP") or os.path.abspath(os.path.join(HERE, "..", "..", "artifacts", "exp-2026-10-23"))
V = os.environ.get("RIG_VALIDATION") or os.path.join(EXP, "rig", "validation")
sys.path.insert(0, os.path.join(HERE, "..", "src"))
import evaluate as E

RUNS = {"R8": "r8-kevq4-dev", "X1": "x1-kevq4-dev", "X5": "x5-kevq4-dev"}
VALT = {}
def load(m):
    rows = [json.loads(l) for l in open(f"{V}/{RUNS[m]}/rows.jsonl")]
    VALT[m] = (json.load(open(f"{V}/{RUNS[m]}/results.json"))["refit"]["T_lora"], json.load(open(f"{V}/{RUNS[m]}/results.json"))["refit"]["T_kev"])
    return [r for r in rows if not r["multi"]], [r for r in rows if r["multi"]]
DATA = {m: load(m) for m in RUNS}
# Kev identical across runs
for i, r in enumerate(DATA["R8"][0]):
    for m in ("X1", "X5"):
        q = DATA[m][0][i]; assert q["id"] == r["id"] and q["kev"] == r["kev"] and q["opts"] == r["opts"], (m, r["id"])
fold = lambda r: "h3" if r["set"].startswith("h3") else "h4"
LV = "x9"

def fused(r, TL, TK, wL=0.5, TF=1.0):
    L, K = E.lsm(r["loraExact"], TL), E.lsm(r["kev"], TK)
    s = {o: (wL * L[o] + (1 - wL) * K[o]) / TF for o in r["opts"]}
    m = max(s.values()); Z = sum(math.exp(v - m) for v in s.values())
    return {o: math.exp(s[o] - m) / Z for o in r["opts"]}, L, K

def decide(r, P):
    """P: dict(TL, TK, wL, TF, gate in {'margin','disagree','none'}, tau). Returns (dispatch, asked, offered, margin)."""
    ops = [o for o in r["opts"] if o != "none"]
    if r["loraPick"] == "none": return "none", False, [], None
    p, L, K = fused(r, P["TL"], P["TK"], P.get("wL", .5), P.get("TF", 1.0))
    rk = sorted(ops, key=lambda o: (-p[o], r["opts"].index(o)))
    mg = p[rk[0]] - p[rk[1]] if len(rk) > 1 else 1.0
    g = P.get("gate", "margin")
    if g == "margin": asked = len(rk) > 1 and mg < P["tau"]
    elif g == "disagree":
        tl = max(ops, key=lambda o: L[o]); tk = max(ops, key=lambda o: K[o]); asked = tl != tk
    else: asked = False
    return rk[0], asked, (rk[:3] if asked else []), mg

def metrics(rows, P):
    act = [r for r in rows if r["gold"] != "none"]; na = [r for r in rows if r["gold"] == "none"]
    out = dict(nA=len(act), nS=len(rows), op=0, gio=0, ask=0, wrong=0, fully=0, fullyS=0, eff=0, effS=0)
    for r in rows:
        d, a, off, _ = decide(r, P)
        fin = d if not a else (r["gold"] if r["gold"] in off else "none-of-these")
        out["ask"] += a
        if r["gold"] == "none":
            out["wrong"] += fin not in ("none", "none-of-these"); continue
        out["op"] += d == r["gold"]
        out["gio"] += (r["gold"] in off) if a else d == r["gold"]
        out["wrong"] += fin not in (r["gold"], "none-of-these")
        if r["hasStep2"]:
            okN, okS = bool(r["args"].get(LV + "_norm")), bool(r["args"].get(LV))
            out["fully"] += d == r["gold"] and okN; out["fullyS"] += d == r["gold"] and okS
            out["eff"] += fin == r["gold"] and okN; out["effS"] += fin == r["gold"] and okS
    return out

def add(a, b): return {k: a[k] + b[k] for k in a}

# ---------- fitters (train fold only) ----------
def fit_TL(rows): return E.fit_T_lora(rows)
def fit_TK(rows): return E.fit_T_kev(rows)
GRID_TF = [round(0.25 * 1.05 ** k, 4) for k in range(0, 80) if 0.25 * 1.05 ** k <= 10]
def fit_TF(rows, TL, TK, wL=.5, obj="nll"):
    sub = [r for r in rows if r["loraPick"] != "none"]   # items that reach the gate
    def loss(TF):
        tot = 0.0
        for r in sub:
            p, _, _ = fused(r, TL, TK, wL, TF)
            if obj == "nll": tot -= math.log(max(p[r["gold"]], 1e-12))
            else:   # binary NLL of [top1 == gold] against p1 (top non-none)
                ops = [o for o in r["opts"] if o != "none"]; t = max(ops, key=lambda o: (p[o], -r["opts"].index(o)))
                y = t == r["gold"]; q = min(max(p[t], 1e-9), 1 - 1e-9); tot -= math.log(q if y else 1 - q)
        return tot
    return min(GRID_TF, key=loss)
TAUS = [round(0.05 * i, 2) for i in range(1, 20)]
def fit_tau(rows, P, cap):
    best = None
    for t in TAUS:
        m = metrics(rows, {**P, "tau": t})
        if m["ask"] <= cap * m["nS"]:
            key = (m["gio"], -m["ask"])
            if best is None or key > best[0]: best = (key, t)
    return best[1] if best else TAUS[0]
WGRID = [round(0.1 * i, 1) for i in range(1, 10)]
def fit_w(rows, P):
    sc = {w: metrics(rows, {**P, "wL": w, "gate": "none"})["op"] for w in WGRID}
    mx = max(sc.values()); return min([w for w in WGRID if sc[w] == mx], key=lambda w: abs(w - .5))

# ---------- options ----------
def opt_params(name, m, train):
    TLv, TKv = VALT[m]
    if name == "G0 val-refit T, tau .5": return dict(TL=TLv, TK=TKv, tau=.5)
    if name == "G1 frozen 1.8/1.0, tau .5": return dict(TL=1.8, TK=1.0, tau=.5)
    if name.startswith("G2"): return dict(TL=fit_TL(train), TK=fit_TK(train), tau=.5)
    if name.startswith("G3 "):
        TL, TK = fit_TL(train), fit_TK(train); return dict(TL=TL, TK=TK, TF=fit_TF(train, TL, TK), tau=.5)
    if name.startswith("G3b"):
        TL, TK = fit_TL(train), fit_TK(train); return dict(TL=TL, TK=TK, TF=fit_TF(train, TL, TK, obj="bin"), tau=.5)
    if name.startswith("G3v"): return dict(TL=TLv, TK=TKv, TF=fit_TF(train, TLv, TKv), tau=.5)
    if name.startswith("G4a"): P = dict(TL=TLv, TK=TKv); return {**P, "tau": fit_tau(train, P, .20)}
    if name.startswith("G4b"): P = dict(TL=TLv, TK=TKv); return {**P, "tau": fit_tau(train, P, .25)}
    if name.startswith("G4c"): P = dict(TL=fit_TL(train), TK=fit_TK(train)); return {**P, "tau": fit_tau(train, P, .20)}
    if name.startswith("G5"): return dict(TL=fit_TL(train), TK=fit_TK(train), gate="disagree")
    raise KeyError(name)
OPTS = ["G0 val-refit T, tau .5", "G1 frozen 1.8/1.0, tau .5", "G2 dev-fit T_L,T_K (NLL), tau .5",
        "G3 G2 + fused scale T_F (NLL of gold), tau .5", "G3b G2 + fused scale T_F (binary NLL of top1), tau .5",
        "G3v val-refit T + fused scale T_F (NLL), tau .5",
        "G4a val-refit T, tau for max gio s.t. ask<=20%", "G4b val-refit T, tau for max gio s.t. ask<=25%",
        "G4c dev-fit T, tau for max gio s.t. ask<=20%", "G5 dev-fit T, disagreement gate (scale-free)"]

def fmtP(P):
    s = f"T_L {P['TL']:.3g} T_K {P['TK']:.3g}"
    if P.get("TF", 1) != 1: s += f" T_F {P['TF']:.3g}"
    if P.get("wL", .5) != .5: s += f" w_L {P['wL']}"
    if P.get("gate", "margin") == "margin" and "tau" in P: s += f" tau {P['tau']}"
    if P.get("gate") == "disagree": s += " disagree"
    return s

res = {}
for m in RUNS:
    rows = DATA[m][0]; res[m] = {}
    for o in OPTS:
        tot, folds = None, {}
        for test in ("h3", "h4"):
            tr = [r for r in rows if fold(r) != test]; te = [r for r in rows if fold(r) == test]
            P = opt_params(o, m, tr); mt = metrics(te, P); folds[test] = (fmtP(P), mt)
            tot = mt if tot is None else add(tot, mt)
        Pall = opt_params(o, m, rows)
        res[m][o] = dict(loso=tot, folds=folds, allP=fmtP(Pall), allP_raw=Pall, inSample=metrics(rows, Pall))
# fusion weight, X5 (and others for reference)
wres = {}
for m in RUNS:
    rows = DATA[m][0]; wres[m] = {}
    for base in ("G2", "G0"):
        curve = {}
        for w in WGRID:
            Pb = opt_params("G2 x" if base == "G2" else "G0 val-refit T, tau .5", m, rows)
            curve[w] = metrics(rows, {**Pb, "wL": w, "gate": "none"})
        tot, fw = None, {}
        for test in ("h3", "h4"):
            tr = [r for r in rows if fold(r) != test]; te = [r for r in rows if fold(r) == test]
            Pb = opt_params("G2 x" if base == "G2" else "G0 val-refit T, tau .5", m, tr)
            w = fit_w(tr, Pb); mt = metrics(te, {**Pb, "wL": w, "gate": "none"}); fw[test] = w
            # gate with that weight: refit TF under that weight on train, tau .5 (G3-style)
            TF = fit_TF(tr, Pb["TL"], Pb["TK"], w); mg = metrics(te, {**Pb, "wL": w, "TF": TF, "tau": .5})
            fw[test + "_TF"] = TF
            tot = (mt, mg) if tot is None else (add(tot[0], mt), add(tot[1], mg))
        wres[m][base] = dict(curve={str(k): v for k, v in curve.items()}, loso_oneshot=tot[0], loso_gate=tot[1], folds=fw)
# reproduce rig numbers as a cross-check
chk = {}
for m in RUNS:
    rows = DATA[m][0]
    for tag, (TL, TK) in (("refit", VALT[m]), ("frozen", (1.8, 1.0))):
        mine = metrics(rows, dict(TL=TL, TK=TK, tau=.5))
        rig = json.load(open(f"{V}/{RUNS[m]}/results.json"))["blocks"][tag]["configs"]["gate"]
        ok = (mine["gio"] == rig["all"]["goldInChoices"] and mine["ask"] == rig["ask"] and mine["wrong"] == rig["wrongDispatch"]
              and mine["eff"] == rig["all"]["eff_x9_norm"] and mine["effS"] == rig["all"]["eff_x9"] and mine["op"] == rig["all"]["op"])
        chk[f"{m}/{tag}"] = ok
        assert ok, (m, tag, mine)
json.dump(dict(check=chk, gate=res, weight=wres), open(f"{HERE}/calib.json", "w"), indent=1, default=str)

# --- print ---
print("cross-check vs rig results.json:", chk)
for m in RUNS:
    print(f"\n## {m} x Kev  (dev LOSO h3<->h4 sums; 196 act / 216 single)")
    print("| option | params h3->h4 test | params h4->h3 test | op | gio | ask | wrong | fully NORM | eff NORM | eff STRICT | all-dev params | in-sample gio/ask/wrong/effN |")
    for o, x in res[m].items():
        L = x["loso"]; i = x["inSample"]
        print(f"| {o} | {x['folds']['h4'][0]} | {x['folds']['h3'][0]} | {L['op']} | {L['gio']} | {L['ask']} | {L['wrong']} | {L['fully']} | {L['eff']} | {L['effS']} | {x['allP']} | {i['gio']}/{i['ask']}/{i['wrong']}/{i['eff']} |")
    for base, w in wres[m].items():
        print(f"weights ({base} temps): curve op/fullyN:", {k: (v['op'], v['fully']) for k, v in w["curve"].items()},
              "| LOSO w:", w["folds"], "one-shot op/fullyN", w["loso_oneshot"]["op"], w["loso_oneshot"]["fully"],
              "| +gate(T_F refit, tau .5) gio/ask/wrong/effN/effS", w["loso_gate"]["gio"], w["loso_gate"]["ask"], w["loso_gate"]["wrong"], w["loso_gate"]["eff"], w["loso_gate"]["effS"])
