"""X7 pre-registered evaluator (frozen; self-contained, stdlib only).

Input: a JSONL file, one row per item, schema
  id, style ("natural" | "paraphrase" | other), multi (bool), gold (op key | "none"; null for multi),
  goldOps (list, multi only), opts (scoped op keys in catalog order + "none" last),
  loraPick (LoRA R8 native greedy step-1 pick, "none" for {"ops": []}),
  loraExact {opt: canonical trie exact_sum logprob}  (X3 trieScore, every scoped op + none),
  kev_q4 {opt: Kev-0.8B Q4_K_M one-stage logprobsT1} (X4 decide.mjs W3/desc, servedT 2.3510959148406982;
         Kev's candidates are in the same order as opts, and its "__none__" key is renamed "none"),
  args {"base": bool, "ship": bool, "base_norm": bool, "ship_norm": bool}
       step 2 run on the GOLD op (temperature 0) under the baseline pipeline / X6 ship patch,
       scored STRICT (harness scoreArgRow: exact !== false && refExact !== false) or NORMALISED.
Usage: prereg_eval.py items.jsonl [label]
"""
import json, math, sys

T_LORA, T_KEV = 1.80, 1.00          # frozen
W_LORA, W_KEV = 0.5, 0.5            # frozen (PoE, equal weights)
TAU = 0.5                           # frozen fused-margin gate threshold
K_OFFER = 3                         # frozen

def lsm(d, T):
    m = max(v / T for v in d.values()); z = math.log(sum(math.exp(v / T - m) for v in d.values())) + m
    return {k: v / T - z for k, v in d.items()}

def decide(it):
    """returns dict config -> (dispatch, asked, offered)"""
    assert set(it["loraExact"]) == set(it["kev_q4"]) == set(it["opts"]), it["id"]
    assert it["opts"][-1] == "none" and it["loraPick"] in it["opts"], it["id"]
    ops = [o for o in it["opts"] if o != "none"]
    lp = it["loraPick"]
    out = {"C1": (lp, False, [])}
    if lp == "none":
        out["C2"] = out["C3"] = ("none", False, []); return out
    L, K = lsm(it["loraExact"], T_LORA), lsm(it["kev_q4"], T_KEV)
    s = {o: W_LORA * L[o] + W_KEV * K[o] for o in it["opts"]}
    m = max(s.values()); Z = sum(math.exp(v - m) for v in s.values()); p = {o: math.exp(s[o] - m) / Z for o in it["opts"]}
    r = sorted(ops, key=lambda o: (-p[o], it["opts"].index(o)))
    out["C2"] = (r[0], False, [])
    asked = len(r) > 1 and p[r[0]] - p[r[1]] < TAU
    out["C3"] = (r[0], asked, r[:K_OFFER] if asked else [])
    return out

def evaluate(rows):
    single = [r for r in rows if not r.get("multi")]
    act = [r for r in single if r["gold"] != "none"]; na = [r for r in single if r["gold"] == "none"]
    D = {r["id"]: decide(r) for r in single}
    res = {"nAction": len(act), "nNoAction": len(na), "nMulti": len(rows) - len(single)}
    for c in ["C1", "C2", "C3"]:
        def final(r):
            d, a, off = D[r["id"]][c]
            return d if not a else (r["gold"] if r["gold"] in off else "none-of-these")
        e = {}
        for lab, sub in [("all", act), ("natural", [r for r in act if r["style"] == "natural"]), ("paraphrase", [r for r in act if r["style"] == "paraphrase"])]:
            x = {"n": len(sub), "op": sum(D[r["id"]][c][0] == r["gold"] for r in sub)}
            for v in ["base", "ship", "base_norm", "ship_norm"]:
                x["fully_" + v] = sum(D[r["id"]][c][0] == r["gold"] and r["args"][v] for r in sub)
                x["eff_" + v] = sum(final(r) == r["gold"] and r["args"][v] for r in sub)
            x["goldInOffered"] = sum((r["gold"] in D[r["id"]][c][2]) if D[r["id"]][c][1] else D[r["id"]][c][0] == r["gold"] for r in sub)
            e[lab] = x
        e["ask"] = sum(D[r["id"]][c][1] for r in single); e["askDenominator"] = len(single)
        e["wrongDispatch"] = sum(final(r) not in (r["gold"], "none-of-these") for r in act) + sum(final(r) not in ("none", "none-of-these") for r in na)
        e["noAction"] = {"tp": sum(final(r) == "none" for r in na), "predNone": sum(final(r) == "none" for r in single), "n": len(na)}
        if c != "C1":
            c1 = {r["id"]: D[r["id"]]["C1"][0] == r["gold"] for r in act}; me = {r["id"]: D[r["id"]][c][0] == r["gold"] for r in act}
            fx = sum(me[k] and not c1[k] for k in c1); br = sum(c1[k] and not me[k] for k in c1)
            # one-sided exact binomial (McNemar) p for fixed > broken
            n = fx + br; pv = sum(math.comb(n, k) for k in range(fx, n + 1)) / 2 ** n if n else 1.0
            e["vsC1"] = {"fixed": fx, "broken": br, "mcnemarOneSidedP": pv}
        res[c] = e
    M = [r for r in rows if r.get("multi")]
    res["multi"] = {"n": len(M), "C1 pick in goldOps": sum(r["loraPick"] in (r.get("goldOps") or []) for r in M),
                    "C2 pick in goldOps": sum(decide(r)["C2"][0] in (r.get("goldOps") or []) for r in M)}
    return res

if __name__ == "__main__":
    rows = [json.loads(l) for l in open(sys.argv[1]) if l.strip()]
    res = evaluate(rows)
    print(json.dumps(res, indent=1))
