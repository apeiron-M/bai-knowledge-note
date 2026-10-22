"""Round 10: groups of easily confused sibling ops, for contrastive teacher data.

    training/.venv/bin/python training/py/sibling_groups.py --context <context.json> --out <groups.json>

Groups come from the op catalog's structure, per model:
  - entity: ops on the same entity (the op name minus its leading verb and a
    trailing STATUS/TYPE/INFO/... qualifier, singular), e.g. ADD_/UPDATE_/
    SET_..._STATUS/REMOVE_DELIVERABLE;
  - lifecycle: status and lifecycle ops (a lifecycle verb, or STATUS in the name);
  - text: ops that set a free-text property (TITLE, DESCRIPTION, CONTENT,
    ORIENTATION, INFO, OUTCOME in the name).
A group that is a subset of another is dropped, and two groups that differ by
at most one op each way are merged. Then observed confusion pairs
(same model) that no group holds yet are unioned in: into a group that holds
one of the pair (the smallest such, if it stays at most MAX_SIZE), else as a
new pair group. Pair sources: the Round 9 results doc (aggregate R2c sibling
confusions on held-out-3, as listed there), Round 8's error analysis on the
retired held-out-1/2 (C3 k=5) and the dev runs of Rounds 8-9. No held-out-3
or held-out-4 item is read.
"""
from __future__ import annotations

import argparse
import glob
import json
import re
from collections import defaultdict
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
VERBS = {"ADD", "REMOVE", "UPDATE", "SET", "CREATE", "DELETE", "TOGGLE", "LINK", "ASSIGN", "RECORD", "INGEST",
         "GENERATE", "INITIALIZE", "PROMOTE", "IMPLEMENT", "ARCHIVE", "RESTORE", "SUBMIT", "APPROVE", "REJECT",
         "RESOLVE", "DISSOLVE", "COMPLETE", "FAIL", "BLOCK", "UNBLOCK", "ADVANCE", "REORDER", "PATCH"}
LIFECYCLE = {"SUBMIT", "APPROVE", "REJECT", "ARCHIVE", "RESTORE", "RESOLVE", "DISSOLVE", "COMPLETE", "FAIL",
             "BLOCK", "UNBLOCK", "PROMOTE", "IMPLEMENT", "ADVANCE"}
QUALIFIERS = {"STATUS", "TYPE", "INFO", "DESCRIPTION", "CONTENT", "FIELD", "LIST", "REF", "REFS"}
TEXT_RE = re.compile(r"TITLE|DESCRIPTION|CONTENT|ORIENTATION|INFO|OUTCOME")
MAX_SIZE = 6

# Round 9 results doc, "Remaining op misses by cause": R2c's sibling confusions
# on held-out-3 (aggregate, gold -> picked), as listed in the doc.
R9_DOC_PAIRS = [
    ("moc:UPDATE_ORIENTATION", "moc:UPDATE_DESCRIPTION"), ("moc:UPDATE_CORE_IDEA", "moc:UPDATE_DESCRIPTION"),
    ("moc:REMOVE_OPEN_QUESTION", "moc:REMOVE_TENSION"),
    ("project:SET_PROJECT_STATUS", "project:SET_DELIVERABLE_STATUS"),
    ("project:SET_DELIVERABLE_STATUS", "project:UPDATE_DELIVERABLE"),
    ("project:SET_REFERENCES", "project:ADD_KNOWLEDGE_REF"), ("wbs:SET_GOAL_STATUS", "wbs:SET_OUTCOME"),
    ("source:INGEST_SOURCE", "source:ADD_EXTRACTED_CLAIM"), ("pipeline-queue:FAIL_TASK", "pipeline-queue:BLOCK_TASK"),
]
# The vault-config quartet ("among themselves" in the doc).
R9_DOC_SETS = [["vault-config:UPDATE_VOCABULARY", "vault-config:ADD_EXTRACTION_CATEGORY",
                "vault-config:UPDATE_PIPELINE_CONFIG", "vault-config:TOGGLE_FEATURE"]]
# Round 8 error analysis (training/artifacts/round8/errors-C3-k5.json, held-out-1/2, retired).
R8_PAIRS = [
    ("source:SET_SOURCE_STATUS", "source:ADD_EXTRACTED_CLAIM"), ("moc:REMOVE_OPEN_QUESTION", "moc:REMOVE_TENSION"),
    ("project:SET_REFERENCES", "project:ADD_KNOWLEDGE_REF"), ("wbs:SET_GOAL_STATUS", "wbs:ADD_DEPENDENCIES"),
    ("wbs:SET_OWNER", "wbs:ASSIGN_GOAL"), ("wbs:SET_OUTCOME", "wbs:SET_GOAL_STATUS"),
    ("knowledge-note:SET_METADATA_LIST_FIELD", "knowledge-note:SET_METADATA_FIELD"),
    ("moc:UPDATE_ORIENTATION", "moc:UPDATE_CORE_IDEA"), ("source:INGEST_SOURCE", "source:RECORD_EXTRACTION_STATS"),
    ("project:SET_PROJECT_STATUS", "project:SET_DELIVERABLE_STATUS"), ("project:ADD_MEMBER", "project:UPDATE_MEMBER"),
    ("wbs:ASSIGN_GOAL", "wbs:REMOVE_DEPENDENCIES"), ("observation:PROMOTE_OBSERVATION", "observation:CREATE_OBSERVATION"),
    ("vault-config:ADD_EXTRACTION_CATEGORY", "vault-config:TOGGLE_EXTRACTION_CATEGORY"),
    ("vault-config:UPDATE_PIPELINE_CONFIG", "vault-config:TOGGLE_EXTRACTION_CATEGORY"),
]


def entity(op: str) -> str:
    t = op.split("_")
    if t[0] in VERBS:
        t = t[1:]
    while len(t) > 1 and t[-1] in QUALIFIERS:
        t = t[:-1]
    t = [re.sub(r"(IE)?S$", lambda m: "Y" if m.group(1) else "", w) if len(w) > 3 else w for w in t]
    return "_".join(t) or op


def dev_pairs() -> list[tuple[str, str]]:
    """Same-model confusions in the committed dev runs of Rounds 8-9 (dev only)."""
    out = set()
    for f in sorted(glob.glob(str(REPO / "spike/llm-harness/eval/results-r9-*-dev.json"))):
        for r in json.loads(Path(f).read_text()).get("rows", []):
            g, p = r.get("expectedOp"), r.get("loraPick")
            if g and isinstance(p, str) and ":" in p and p != g and p.split(":")[0] == g.split(":")[0]:
                out.add((g, p))
    return sorted(out)


def derive(ctx: list[dict]) -> dict:
    by_model: dict[str, list[str]] = defaultdict(list)
    for o in ctx:
        by_model[o["model"]].append(o["key"])
    groups: list[dict] = []
    for m, keys in by_model.items():
        names = {k: k.split(":")[1] for k in keys}
        ent: dict[str, list[str]] = defaultdict(list)
        for k in keys:
            ent[entity(names[k])].append(k)
        for e, g in ent.items():
            if len(g) > 1:
                groups.append({"model": m, "rule": f"entity:{e}", "ops": g})
        life = [k for k in keys if names[k].split("_")[0] in LIFECYCLE or "STATUS" in names[k]]
        if len(life) > 1:
            groups.append({"model": m, "rule": "lifecycle", "ops": life})
        txt = [k for k in keys if TEXT_RE.search(names[k])]
        if len(txt) > 1:
            groups.append({"model": m, "rule": "text", "ops": txt})
    # Drop a group that is a subset of another (keep the first of equal sets).
    kept = []
    for i, g in enumerate(groups):
        s = set(g["ops"])
        if any((s < set(h["ops"])) or (s == set(h["ops"]) and j < i) for j, h in enumerate(groups) if j != i):
            continue
        kept.append(g)
    groups = kept
    # Merge two groups of a model that differ by at most one op each way
    # (knowledge-note's "NOTE" entity is its lifecycle plus SET_NOTE_TYPE).
    merged = True
    while merged:
        merged = False
        for i, g in enumerate(groups):
            for h in groups[i + 1:]:
                a, b = set(g["ops"]), set(h["ops"])
                if g["model"] == h["model"] and len(a - b) <= 1 and len(b - a) <= 1 and len(a | b) <= MAX_SIZE:
                    g["ops"] += [k for k in h["ops"] if k not in a]
                    g["rule"] = f"{g['rule']}+{h['rule']}"
                    groups.remove(h)
                    merged = True
                    break
            if merged:
                break
    order = {o["key"]: i for i, o in enumerate(ctx)}
    sources = ([(p, "round9-doc") for p in R9_DOC_PAIRS] + [(p, "round8-errors") for p in R8_PAIRS]
               + [(p, "dev") for p in dev_pairs()])
    for ops in R9_DOC_SETS:
        groups.append({"model": ops[0].split(":")[0], "rule": "observed:round9-doc", "ops": ops})
    added = []
    for (a, b), src in sources:
        if a.split(":")[0] != b.split(":")[0]:
            continue
        if any(a in g["ops"] and b in g["ops"] for g in groups):
            continue
        hosts = sorted((g for g in groups if (a in g["ops"]) != (b in g["ops"]) and len(g["ops"]) < MAX_SIZE),
                       key=lambda g: len(g["ops"]))
        if hosts:
            g = hosts[0]
            new = b if a in g["ops"] else a
            g["ops"].append(new)
            g.setdefault("added", []).append({"op": new, "pair": [a, b], "source": src})
        else:
            groups.append({"model": a.split(":")[0], "rule": f"observed:{src}", "ops": [a, b]})
        added.append({"pair": [a, b], "source": src})
    for i, g in enumerate(groups):
        g["ops"] = sorted(set(g["ops"]), key=order.__getitem__)
        g["id"] = f"g{i + 1:02d}"
    covered = [{"pair": [a, b], "source": s, "covered": any(a in g["ops"] and b in g["ops"] for g in groups)}
               for (a, b), s in sources]
    return {"rules": __doc__.strip().split("\n\n", 2)[1:], "maxSize": MAX_SIZE, "groups": groups,
            "pairsUnioned": added, "pairCoverage": covered,
            "summary": {"groups": len(groups), "memberships": sum(len(g["ops"]) for g in groups),
                        "distinctOps": len({k for g in groups for k in g["ops"]}),
                        "pairsCovered": f"{sum(c['covered'] for c in covered)}/{len(covered)}"}}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--context", required=True)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    res = derive(json.loads(Path(a.context).read_text()))
    Path(a.out).parent.mkdir(parents=True, exist_ok=True)
    Path(a.out).write_text(json.dumps(res, indent=1) + "\n")
    print(json.dumps(res["summary"]))
    for g in res["groups"]:
        print(g["id"], g["model"], g["rule"], " ".join(k.split(":")[1] for k in g["ops"]))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
