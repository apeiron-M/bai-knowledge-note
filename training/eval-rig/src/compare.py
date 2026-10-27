"""Side-by-side table of several rig runs (same set), one args level.
  python3 compare.py --level x9 [--block refit|frozen|explicit|dev-cv|headline] [--latency label=dir ...] label=run-dir ...
Latency: median / p90 of step-1 generation, exact trie and step-2 wall ms from the run's own rows
(native llama-server; absolute values depend on machine load, compare runs made back to back)."""
import json, os, statistics, sys
a = sys.argv[1:]
def take(k, d=None):
    if k in a:
        i = a.index(k); v = a[i + 1]; del a[i:i + 2]; return v
    return d
level, block = take("--level", "x9"), take("--block", "headline")
lat = []
while "--latency" in a: lat.append(take("--latency"))
runs = [x.split("=", 1) for x in a]
NAMES = {"lora": "alone", "kev": "Kev alone", "lora_x_kev": "x Kev (PoE)", "gate": "x Kev + gate tau 0.5"}
L = []
hdr = ["Model", "Config", "temps T_L / T_K", "Op", "natural", "paraphrase", f"fully {level} STRICT", f"fully {level} NORM", "eff (gate) STRICT / NORM", "vs alone", "gold-in-choices", "ask", "wrong"]
L += ["| " + " | ".join(hdr) + " |", "|" + "---|" * len(hdr)]
for lab, d in runs:
    R = json.load(open(f"{d}/results.json")); b = R["headline"] if block == "headline" else block
    res = R["blocks"][b]; t = res["temps"]
    for c, e in res["configs"].items():
        if c == "kev" and lab != runs[0][0]: continue   # Kev alone is LoRA-independent except for the none rule
        x = e["all"]; n = x["n"]
        st = [s for s in e if s not in ("all", "ask", "askDenominator", "askByStyle", "wrongDispatch", "noAction", "vsLora")]
        eff = f"{x['eff_' + level]} / {x['eff_' + level + '_norm']}" if c == "gate" else "-"
        vs = f"+{e['vsLora']['fixed']}/-{e['vsLora']['broken']} (p {e['vsLora']['mcnemarOneSidedP']:.2g})" if "vsLora" in e else "-"
        L.append("| " + " | ".join([lab, NAMES[c], f"{t['T_lora']} / {t['T_kev']} ({b})", f"{x['op']}/{n} ({100*x['op']/n:.1f}%)"]
              + [f"{e[s]['op']}/{e[s]['n']}" for s in ("natural", "paraphrase")]
              + [str(x["fully_" + level]), str(x["fully_" + level + "_norm"]), eff, vs,
                 f"{x['goldInChoices']} ({100*x['goldInChoices']/n:.1f}%)", f"{e['ask']}/{e['askDenominator']}", str(e["wrongDispatch"])]) + " |")
    L.append(f"| {lab} | args on gold op | | | | | {res['argsOnGold'][level]} | {res['argsOnGold'][level + '_norm']} | | | | | |")
if lat:
    def q(xs, p): xs = sorted(xs); return xs[min(len(xs) - 1, int(p * len(xs)))] if xs else None
    L += ["", "| Model (latency run) | step-1 gen ms med / p90 | exact trie ms med / p90 | step 1 total (gen + exact) med | step-2 wall ms med / p90 | n |", "|---|---|---|---|---|---|"]
    for x in lat:
        lab, d = x.split("=", 1)
        s1 = [json.loads(l) for l in open(f"{d}/step1.jsonl") if l.strip()]
        s2f = f"{d}/args-{level}.jsonl"; s2 = [json.loads(l) for l in open(s2f) if l.strip()] if os.path.exists(s2f) else []
        g = [r["genMs"] for r in s1]; ex = [r["exactMs"] for r in s1]; tot = [r["genMs"] + r["exactMs"] for r in s1]; w = [r["wallMs"] for r in s2 if "wallMs" in r]
        L.append(f"| {lab} | {statistics.median(g):.0f} / {q(g, .9)} | {statistics.median(ex):.0f} / {q(ex, .9)} | {statistics.median(tot):.0f} | "
                 + (f"{statistics.median(w):.0f} / {q(w, .9)}" if w else "n/a") + f" | {len(s1)} / {len(w)} |")
print("\n".join(L))
