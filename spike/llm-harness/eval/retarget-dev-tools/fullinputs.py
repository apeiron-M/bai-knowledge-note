"""Writes the full zod inputs (args + refArgs + ambiguousArgs + app-filled placeholders).

Usage: python3 fullinputs.py [set.json] [repo-root] [out.json]
(defaults: ../retarget-dev.json, the repo root, ./full-inputs.json). Then, from the repo root:
  npx --no-install tsx spike/llm-harness/eval/retarget-dev-tools/zodcheck.mts <out.json>
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
out_path = sys.argv[3] if len(sys.argv) > 3 else os.path.join(HERE, "full-inputs.json")
sys.argv = sys.argv[:3]
# reuse the validator's op table (OPS) and loaded set (S); stop before its checks
exec(open(os.path.join(HERE, "validate.py")).read().split("raw = open")[0])
PH = {"String": "x", "Int": 0, "Float": 0.5, "Boolean": True, "OID": "x-oid", "PHID": "x-phid",
      "DateTime": "2026-10-27T00:00:00Z", "URL": "https://example.org", "Date": "2026-10-27T00:00:00Z"}
rows = []
def full(op, ex, iid):
    fields = OPS[op]
    inp = {}
    for f, (g, cls, req) in fields.items():
        if cls in ("new-id", "timestamp", "actor") and req:
            inp[f] = PH[g] if g in PH else "x"
    for b in ("ambiguousArgs",):
        for k, v in ex[b].items():
            if v is not None: inp[k] = v
    inp.update(ex["args"]); inp.update(ex["refArgs"])
    for f in ex["requiredPresent"]:
        if f not in inp:
            g = fields[f][0]; inp[f] = PH.get(g, "x")
    rows.append({"id": iid, "op": op, "input": inp})
for it in S["items"]:
    full(it["expected"]["op"], it["expected"], it["id"])
    for a in it["expected"]["target"].get("acceptable", []):
        full(a["op"], {"args": {}, "ambiguousArgs": a["ambiguousArgs"], "refArgs": a["refArgs"], "requiredPresent": [f for f,(g,c,r) in OPS[a["op"]].items() if r and c=="semantic"]}, it["id"]+"/alt")
for ma in S["multiAction"]:
    for i, st in enumerate(ma["expected"]):
        full(st["op"], st, f'{ma["id"]}/{i}')
json.dump(rows, open(out_path, "w"), indent=1)
print(len(rows), "inputs")
