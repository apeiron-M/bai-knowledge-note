"""In-browser parity fixture for configuration C: 20 dev items (held-out-3/4 only) with the rig's stored
outputs, from tests/fixtures/chat-c. Writes editors/knowledge-vault/chat/dev/parity-c-items.json.

  python3 scripts/chat/gen-parity-c-items.py
"""
import json, os

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
FX = os.path.join(REPO, "tests", "fixtures", "chat-c")
jl = lambda f: [json.loads(l) for l in open(os.path.join(FX, f)) if l.strip()]
items = {r["id"]: r for r in jl("items.jsonl")}
s1 = {r["id"]: r for r in jl("step1.jsonl")}
kev = {r["id"]: r for r in jl("kev.jsonl")}
args = {r["id"]: r for r in jl("args-x9.jsonl")}
exp = json.load(open(os.path.join(FX, "expected-decisions.json")))
gate = {m: {d["id"]: d["gate"] for d in exp["modes"][m]["decisions"]} for m in ("exact", "branch")}

# M5 (m2bv): src3-02 no longer asks; der3-02 (asked under X5 and m2bv) takes its place.
GATED = ["kn3-14", "prj3-12", "wbs3-05", "der3-02", "hr4-02"]
NO_ACTION = [i for i in items if items[i]["gold"] == "none" and s1[i]["loraPick"] == "none"][:2]
SPECIAL = ["prj3-05", "moc3-08", "moc4-10", "moc4-07", "prj3-15"]
OTHERS = ["kn3-01", "kn3-02", "obs3-01", "ten3-01", "rc3-01", "pq3-01", "vc3-01", "der3-01"]
ids = GATED + NO_ACTION + SPECIAL + OTHERS
assert len(ids) == 20 and len(set(ids)) == 20, ids
assert all(gate["branch"][i]["asked"] for i in GATED)
out = []
for i in ids:
    it, s, k = items[i], s1[i], kev[i]
    a = args.get(i)
    out.append({
        "id": i, "docType": it["docType"], "utterance": it["utterance"], "state": it["state"], "ctx": it["ctx"],
        "refCandidates": it["refCandidates"], "today": it["today"], "gold": it["gold"], "hasStep2": it["hasStep2"],
        "stored": {
            "loraPick": s["loraPick"], "loraExact": s["loraExact"], "loraBranch": s["loraBranch"],
            "kevProbs": k["oneStage"]["probs"], "gate": {"exact": gate["exact"].get(i), "branch": gate["branch"].get(i)},
            "args": None if a is None else {"args": a["args"], "raw": a["raw"], "dateFixed": a["dateFixed"], "listsCompleted": a["listsCompleted"]},
        },
    })
with open(os.path.join(REPO, "editors", "knowledge-vault", "chat", "dev", "parity-c-items.json"), "w") as f:
    json.dump({"source": "tests/fixtures/chat-c (dev: held-out-3 + held-out-4)", "items": out}, f, separators=(",", ":"))
    f.write("\n")
print(len(out), ids)
