"""Configuration C: expected gate decisions on the committed dev oracle.

  python3 scripts/chat/c-expected.py

Reads tests/fixtures/chat-c/{items,step1,kev,args-x9}.jsonl (rig outputs on held-out-3 + held-out-4,
dev only) and runs the rig's own evaluator (training/eval-rig/src/evaluate.py, imported read-only) at the
registered temperatures T_L 1.63 / T_K 4.0, once on the exact trie scores (loraExact, as registered) and once
on the branch-only trie scores (loraBranch substituted for loraExact, the shipped default).
Writes tests/fixtures/chat-c/expected-decisions.json: per single-action/no-action row the lora pick, the
fused pick, the gate (pick, asked, offered in order) and the fused p over opts, plus the evaluator's
dev-cv metrics for both modes (the exact-mode block must equal the rig's results.json dev-cv block).
"""
import json, math, os, sys

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, os.path.join(REPO, "training", "eval-rig", "src"))
import evaluate as ev  # noqa: E402

FX = os.path.join(REPO, "tests", "fixtures", "chat-c")
TL, TK = 1.63, 4.0


def fused_p(it):
    L, K = ev.lsm(it["loraExact"], TL), ev.lsm(it["kev"], TK)
    s = {o: ev.W_LORA * L[o] + ev.W_KEV * K[o] for o in it["opts"]}
    m = max(s.values()); Z = sum(math.exp(v - m) for v in s.values())
    return {o: math.exp(s[o] - m) / Z for o in it["opts"]}


rows, missing, levels = ev.assemble(FX)
assert not missing, missing
out = {"temps": {"T_lora": TL, "T_kev": TK}, "tau": ev.TAU, "kOffer": ev.K_OFFER, "modes": {}}
for mode in ("exact", "branch"):
    rs = [dict(r, loraExact=r["loraExact"] if mode == "exact" else r["loraBranch"]) for r in rows]
    single = [r for r in rs if not r["multi"]]
    dec = []
    for r in single:
        d = ev.decide(r, TL, TK)
        e = {"id": r["id"], "gold": r["gold"], "loraPick": d["lora"][0], "fusedPick": d["lora_x_kev"][0],
             "gate": {"pick": d["gate"][0], "asked": d["gate"][1], "offered": d["gate"][2]}}
        if r["loraPick"] != "none":
            e["p"] = fused_p(r)
        dec.append(e)
    res = ev.evaluate(rs, TL, TK, levels)
    out["modes"][mode] = {"decisions": dec, "metrics": res["configs"]["gate"], "argsOnGold": res["argsOnGold"]}

ex, br = out["modes"]["exact"]["decisions"], out["modes"]["branch"]["decisions"]
same = sum(a["gate"] == b["gate"] for a, b in zip(ex, br))
out["exactVsBranchGateIdentical"] = f"{same}/{len(ex)}"
with open(os.path.join(FX, "expected-decisions.json"), "w") as f:
    json.dump(out, f, separators=(",", ":"))
    f.write("\n")
g = out["modes"]["exact"]["metrics"]
print(f"rows {len(ex)}; exact gate op {g['all']['op']} ask {g['ask']} wrong {g['wrongDispatch']} eff {g['all']['eff_x9_norm']}; "
      f"exact vs branch gate identical {same}/{len(ex)}")
