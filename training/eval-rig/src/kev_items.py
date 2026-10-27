"""Kev input items in decide.mjs's shape (as heldout5-run1/build-kev-items.py and X7's items-r8val.json).
candidates = the LoRA step-1 scoped list (catalog order, none NOT included; decide.mjs appends __none__ last),
asserted to be in $RIG_KEV/data/catalog.json order (default training/kev) with one model (== context.model when the set gives one).
  python3 kev_items.py <items.jsonl> <step1.jsonl> <kev-items.json>"""
import json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
items_p, s1_p, out_p = sys.argv[1:4]
cat = json.load(open(os.path.join(os.environ.get("RIG_KEV") or os.path.join(HERE, "..", "..", "kev"), "data", "catalog.json")))
S1 = {r["id"]: r for r in map(json.loads, filter(str.strip, open(s1_p)))}
out = []
for it in map(json.loads, filter(str.strip, open(items_p))):
    if it["id"] not in S1: continue
    keys = S1[it["id"]]["candidates"]
    c = [e for e in cat if e["key"] in set(keys)]
    assert [e["key"] for e in c] == keys, it["id"]
    models = {e["model"] for e in c}
    assert len(models) == 1 and (it.get("model") in (None, *models)), (it["id"], models, it.get("model"))
    out.append({"id": it["id"], "set": it["set"], "fold": it["group"], "style": it["style"], "difficulty": it.get("difficulty"),
                "tags": it.get("tags"), "utterance": it["utterance"], "model": models.pop(), "candidates": keys,
                "expectedOp": it["gold"] if it["gold"] not in (None, "none") else None, "expectedOps": it.get("goldOps"), "baseline": None})
json.dump(out, open(out_p, "w"), indent=0)
print(json.dumps({"kevItems": len(out)}))
