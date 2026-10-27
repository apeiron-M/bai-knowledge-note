"""Validation of a rig run against the stored X7 / X6 / X9 dev (or val) outputs.

  python3 validate.py <run-dir> dev|val|h3|h4 <out.json>     (<run-dir> "-": section 1 only)

1. Evaluator parity: the rig evaluator on X7's own prereg-input-<set>.jsonl == prereg-expected-<set>.json.
2. Producer parity per item vs X7's prereg-input: loraPick identical, |delta loraExact|, |delta kev|, args flags.
3. The untouched frozen prereg_eval.py on the rig's rows (base -> base, x6 -> ship) == prereg-expected-<set>.json.
4. Args per item vs X6 base.json / ship-v1.json and X9 combo.patched.json (args canonical JSON, ok, okN).
The stored X6 / X7 / X9 outputs live only in the session experiment tree: $RIG_EXP, default the gitignored backup
training/artifacts/exp-2026-10-23.
"""
import json, math, os, subprocess, sys, tempfile
HERE = os.path.dirname(os.path.abspath(__file__))
EXP = os.environ.get("RIG_EXP") or os.path.abspath(os.path.join(HERE, "..", "..", "artifacts", "exp-2026-10-23"))
sys.path.insert(0, HERE)
import evaluate as E

run, which, outp = sys.argv[1:4]
X7 = f"{EXP}/x7-fusion/out"
ref_in = [json.loads(l) for l in open(f"{X7}/prereg-input-{which}.jsonl") if l.strip()]
ref_exp = json.load(open(f"{X7}/prereg-expected-{which}.json"))
report = {"set": which, "run": run}
CMAP = {"C1": "lora", "C2": "lora_x_kev", "C3": "gate"}
VMAP = {"base": "base", "ship": "x6", "base_norm": "base_norm", "ship_norm": "x6_norm"}


def to_rig(r):
    g = r["gold"]
    return {"id": r["id"], "set": "", "group": which, "style": r["style"], "multi": r["multi"], "gold": g, "goldOps": r.get("goldOps"),
            "opts": r["opts"], "loraPick": r["loraPick"], "loraExact": r["loraExact"], "loraBranch": r.get("loraBranch", r["loraExact"]),
            "floored": 0, "kev": r["kev_q4"], "hasStep2": g not in (None, "none") and r.get("args") is not None and r["args"].get("hasStep2", True),
            "args": {VMAP[k]: v for k, v in (r.get("args") or {}).items() if k in VMAP}}


def compare_to_expected(res, exp):
    """res: rig evaluate() output; exp: prereg_eval output. Returns list of mismatches."""
    bad = []
    for C, c in CMAP.items():
        e, m = exp[C], res["configs"][c]
        for lab in ["all", "natural", "paraphrase"]:
            if lab not in e or e[lab]["n"] == 0: continue
            for k, v in e[lab].items():
                kk = k.replace("goldInOffered", "goldInChoices")
                for a, b in VMAP.items(): kk = kk.replace("_" + a, "_" + b) if kk.endswith("_" + a) else kk
                if kk.startswith("eff_") and c != "gate": continue
                got = m[lab].get(kk)
                if got != v: bad.append(f"{C}.{lab}.{k}: expected {v}, rig {got}")
        for k in ["ask", "askDenominator", "wrongDispatch", "noAction"]:
            if e[k] != m[k]: bad.append(f"{C}.{k}: expected {e[k]}, rig {m[k]}")
        if "vsC1" in e:
            for k in ["fixed", "broken"]:
                if e["vsC1"][k] != m["vsLora"][k]: bad.append(f"{C}.vsC1.{k}: expected {e['vsC1'][k]}, rig {m['vsLora'][k]}")
    return bad


# 1. evaluator parity on X7's own input (val: X7 marks step-1-only rows by args fields; keep the same denominators)
rig_ref = [to_rig(r) for r in ref_in]
res1 = E.evaluate(rig_ref, *E.T_FROZEN, ["base", "x6"])
report["1_evaluator_on_x7_input"] = {"mismatches": compare_to_expected(res1, ref_exp),
                                     "kevAlone_op": res1["configs"]["kev"]["all"]["op"],
                                     "kevAlone_byStyle": {s: res1["configs"]["kev"][s]["op"] for s in ("natural", "paraphrase") if s in res1["configs"]["kev"]}}

if run == "-":   # evaluator parity only (no rig run needed)
    print(json.dumps(report, indent=1)); sys.exit(0)

# 2. producer parity per item
rows = {r["id"]: r for r in map(json.loads, filter(str.strip, open(f"{run}/rows.jsonl")))}
REF = {r["id"]: r for r in ref_in}
p = {"n": 0, "missingInRig": [], "pickDiff": [], "maxAbsDeltaLoraExact": 0.0, "maxAbsDeltaKev": 0.0, "argsDiff": [], "optsDiff": []}
deltas = []
for i, x in REF.items():
    if i not in rows: p["missingInRig"].append(i); continue
    r = rows[i]; p["n"] += 1
    if r["opts"] != x["opts"]: p["optsDiff"].append(i); continue
    if r["loraPick"] != x["loraPick"]: p["pickDiff"].append(f"{i}: x7 {x['loraPick']} rig {r['loraPick']}")
    d = max(abs(r["loraExact"][o] - x["loraExact"][o]) for o in x["opts"]); deltas.append((d, i))
    p["maxAbsDeltaLoraExact"] = max(p["maxAbsDeltaLoraExact"], d)
    if "kev" in r: p["maxAbsDeltaKev"] = max(p["maxAbsDeltaKev"], max(abs(r["kev"][o] - x["kev_q4"][o]) for o in x["opts"]))
    for a, b in VMAP.items():
        if x.get("args") and a in x["args"] and b in r["args"] and x["args"][a] != r["args"][b]:
            p["argsDiff"].append(f"{i}: {a} x7 {x['args'][a]} rig {r['args'][b]}")
deltas.sort(reverse=True)
p["top5DeltaLoraExact"] = [[round(d, 4), i] for d, i in deltas[:5]]
p["itemsDeltaOver0.05"] = sum(d > 0.05 for d, _ in deltas)
report["2_producer_parity_vs_x7"] = p

# 3. untouched frozen evaluator on rig rows
tmp = tempfile.NamedTemporaryFile("w", suffix=".jsonl", delete=False)
for i, x in REF.items():
    r = rows[i]
    a = r["args"]
    tmp.write(json.dumps({"id": i, "style": r["style"], "multi": r["multi"], "gold": r["gold"], "goldOps": r["goldOps"], "opts": r["opts"],
                          "loraPick": r["loraPick"], "loraExact": r["loraExact"], "kev_q4": r["kev"],
                          "args": {"base": a.get("base", True), "ship": a.get("x6", True), "base_norm": a.get("base_norm", True), "ship_norm": a.get("x6_norm", True)}}) + "\n")
tmp.close()
if which == "val":
    report["3_frozen_prereg_eval_on_rig_rows"] = "skipped for val (X7's val fully-correct uses only the 107 step-2 rows; compare section 4 instead)"
else:
    got = json.loads(subprocess.run([sys.executable, f"{HERE}/prereg_eval.py", tmp.name], check=True, capture_output=True, text=True).stdout)
    diffs = []
    def walk(a, b, path=""):
        if isinstance(a, dict):
            for k in a: walk(a[k], b.get(k) if isinstance(b, dict) else None, f"{path}.{k}")
        elif a != b and not (isinstance(a, float) and isinstance(b, float) and abs(a - b) < 1e-12): diffs.append(f"{path}: expected {a}, rig {b}")
    walk(ref_exp, got)
    report["3_frozen_prereg_eval_on_rig_rows"] = {"diffs": diffs, "C1_op": got["C1"]["all"]["op"], "C2_op": got["C2"]["all"]["op"], "C3_goldInOffered": got["C3"]["all"]["goldInOffered"], "C3_ask": got["C3"]["ask"]}
os.unlink(tmp.name)


# 4. args per item vs stored step-2 outputs
def canon(v):
    if isinstance(v, list): return [canon(x) for x in v]
    if isinstance(v, dict): return {k: canon(v[k]) for k in sorted(v) if v[k] is not None}
    return v


A = {}
for lv in E.LEVELS:
    f = f"{run}/args-{lv}.jsonl"
    if os.path.exists(f): A[lv] = {r["id"]: r for r in map(json.loads, filter(str.strip, open(f)))}
refs = {"base": f"{EXP}/x6-args/out/base.json", "x6": f"{EXP}/x6-args/out/ship-v1.json", "x9": f"{EXP}/x9-args2/out/combo.patched.json"}
sets = {"dev": ("h3", "h4"), "val": ("val",)}[which]
s4 = {}
for lv, path in refs.items():
    if lv not in A: continue
    R = {r["id"]: r for r in json.load(open(path))["rows"] if r["set"] in sets}
    d = {"n": 0, "missing": [], "okDiff": [], "okNDiff": [], "argsDiff": [], "refStrict": sum(r["ok"] for r in R.values()),
         "refNorm": sum(r["okN"] for r in R.values()) if all("okN" in r for r in R.values()) else None,
         "rigStrict": 0, "rigNorm": 0}
    for i, x in R.items():
        y = A[lv].get(i)
        if not y: d["missing"].append(i); continue
        d["n"] += 1; d["rigStrict"] += y["ok"]; d["rigNorm"] += y["okN"]
        if y["ok"] != x["ok"]: d["okDiff"].append(f"{i}: ref {x['ok']} rig {y['ok']}")
        if "okN" in x and y["okN"] != x["okN"]: d["okNDiff"].append(i)
        if json.dumps(canon(y["args"])) != json.dumps(canon(x["args"])): d["argsDiff"].append(i)
    s4[lv] = d
report["4_args_vs_x6_x9"] = s4
json.dump(report, open(outp, "w"), indent=1)
print(json.dumps(report, indent=1)[:6000])
