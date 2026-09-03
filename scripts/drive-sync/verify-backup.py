#!/usr/bin/env python3
"""Verify a download.py snapshot against the live source drive.

Read-only. Checks completeness (every manifest document has a state, ops and
auth entry), reconstructs per-type edge totals from the state files and
compares them with edges.json, and spot-checks the relationship TABLE
(documentOutgoingRelationships) against the graph dump on a random sample —
the dump is a projection, so this is the check that it did not lag the table.
"""
import argparse, json, random, sys, collections
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from lib.graphql import GraphQLClient

TYPES = ("RELATES_TO","BUILDS_ON","CONTRADICTS","SUPERSEDES","DERIVED_FROM","CORE_IDEA","CHILD_MOC","INVOLVES")
Q = """query O($sid: String!, $t: String!){ documentOutgoingRelationships(sourceIdentifier:$sid, relationshipType:$t){ items { id } } }"""

ap = argparse.ArgumentParser()
ap.add_argument("--data", required=True); ap.add_argument("--endpoint", required=True)
ap.add_argument("--sample", type=int, default=12); ap.add_argument("--seed", type=int, default=7)
a = ap.parse_args()
root = Path(a.data); bad = 0
def fail(msg):
    global bad; bad += 1; print("  FAIL", msg)

man = json.loads((root/"manifest.json").read_text())
docs = man["documents"]; ids = {d["id"] for d in docs}
states = {p.stem for p in (root/"states").glob("*.json")}
ops = {p.stem for p in (root/"ops").glob("*.json")}
auth = json.loads((root/"auth.json").read_text()) if (root/"auth.json").exists() else {}
edges = json.loads((root/"edges.json").read_text()) if (root/"edges.json").exists() else []
print(f"manifest: {len(docs)} documents, {len(man['folders'])} folders; source {man['source'].get('endpoint')} @ {man['source'].get('downloadedAt')}")
print(f"states {len(states)}  ops {len(ops)}  auth {len(auth)}  edges {len(edges)}")
if states != ids: fail(f"states != manifest: missing {len(ids-states)}, extra {len(states-ids)}")
if ops != ids: fail(f"ops != manifest: missing {len(ids-ops)}")
if set(auth) != ids: fail(f"auth != manifest: missing {len(ids-set(auth))}")
by_type = collections.Counter(d["type"] for d in docs)
print("by type: " + ", ".join(f"{t.split('/')[-1]}={n}" for t,n in by_type.most_common()))
init = sum(1 for v in auth.values() if (v or {}).get("version"))
print(f"auth policies initialized: {init} of {len(auth)} (expect 0 on an unpoliced vault)")

# edges.json vs reconstructed state arrays
ec = collections.Counter(e["linkType"] for e in edges)
recon = collections.Counter(); with_reason = 0
for d in docs:
    st = json.loads((root/"states"/f"{d['id']}.json").read_text())
    for ln in st.get("links") or []:
        recon[ln["linkType"]] += 1; with_reason += 1 if ln.get("reason") else 0
    if d["type"] == "bai/moc":
        recon["CORE_IDEA"] += len(st.get("coreIdeas") or []); recon["CHILD_MOC"] += len(st.get("childRefs") or [])
for t in TYPES:
    if t == "INVOLVES": continue  # not reconstructed into state (no handler); lives in edges.json only
    if ec[t] != recon[t]: fail(f"{t}: edges.json {ec[t]} vs reconstructed {recon[t]}")
print(f"reconstructed links carrying a reason: {with_reason} (edges.json has {sum(1 for e in edges if e.get('reason'))} incl. CORE_IDEA/INVOLVES)")

# sample parity: relationship table vs graph dump
random.seed(a.seed); sample = random.sample(docs, min(a.sample, len(docs)))
cl = GraphQLClient(a.endpoint); dump = collections.defaultdict(collections.Counter)
for e in edges: dump[e["sourceDocumentId"]][e["linkType"]] += 1
mism = 0
for d in sample:
    for t in TYPES:
        items = (cl.query(Q, {"sid": d["id"], "t": t}).get("documentOutgoingRelationships") or {}).get("items") or []
        if len(items) != dump[d["id"]][t]:
            mism += 1; fail(f"table vs dump {d['name'][:40]} {t}: {len(items)} vs {dump[d['id']][t]}")
print(f"table-vs-dump sample: {len(sample)} docs x {len(TYPES)} types, {mism} mismatches")
print("\nRESULT:", "OK" if bad == 0 else f"{bad} problems")
sys.exit(1 if bad else 0)
