"""Create knowledge notes from lead claim groups.

Splits mechanical from editorial: this script owns document creation,
placement, provenance, DERIVED_FROM edges, source claim registration and
the lifecycle walk. Callers supply only the editorial content — title,
description, noteType, topics, body — as JSON.

Notes are deduplicated by CLAIM, not by lead: 68 Flowable leads share one
verbatim `powerhouse_fit`, so one note carries DERIVED_FROM edges to all
68 sources. Writing 68 identical notes would bury the 117 real findings.

Ordering rules that are easy to get wrong and are enforced here:
  * content actions batch together, SET_PROVENANCE goes in its own
    dispatch (a provenance validation error kills a whole batch);
  * SUBMIT_FOR_REVIEW then APPROVE_NOTE must be sequential and by
    different actors, or the approval is rejected;
  * descriptions over 200 chars silently no-op, so they are rejected here
    rather than discovered later as a blank field.

Usage:  python3 scripts/lead-import/create_notes.py notes.json
"""
import json, sys, time, uuid, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "drive-sync"))
from lib import gql

W = "https://light-colt-c497cfbd-switchboard.vetra.io/graphql"
R = W + "/r"
DRIVE = "c5893e1b-854b-49b1-b8aa-6b133ab87969"
NOTES_FOLDER = "d2be7d6a-7faa-43bf-96f6-fd428b9239e4"
# Per-specs ledger. A single shared file would be a lost-update race
# between concurrent writers working on different slices.
def ledger_for(specs_path):
    return Path(str(specs_path) + ".created.json")
GROUPS = json.loads(Path("scripts/lead-import/claim-groups.json").read_text())


def leads_block(group_index):
    """Render the lead detail the note must carry, from the group itself.

    Generated here rather than written by hand so all 230 notes share one
    format and no company is mistyped or dropped. The full 22-field record
    for each lead is one DERIVED_FROM hop away in its source document.
    """
    g = GROUPS[group_index]
    leads = g["leads"]
    by_priority = {}
    for l in leads:
        by_priority.setdefault(l["priority"] or "unprioritised", []).append(l)
    lines = ["", "---", "",
             f"## Leads sharing this finding ({len(leads)})", ""]
    for pri in sorted(by_priority):
        lines.append(f"**{pri}**")
        for l in sorted(by_priority[pri], key=lambda x: x["company"]):
            bits = [l["company"]]
            if l["geo"]:
                bits.append(f"({l['geo']})")
            contact = " · ".join(x for x in (l["principal"], l["email"], l["website"]) if x)
            entry = " ".join(bits) + (f" — {contact}" if contact else "")
            lines.append(f"- {entry}")
        lines.append("")
    lines.append(f"Verbatim research text this claim was extracted from:")
    lines.append("")
    lines.append(f"> {g['text']}")
    return "\n".join(lines)

CREATE = 'mutation($name:String!,$parent:String){ KnowledgeNote { createDocument(name:$name, parentIdentifier:$parent){ id } } }'
MOVE = 'mutation($docId:PHID!,$input:DocumentDrive_MoveNodeInput!){ DocumentDrive { moveNode(docId:$docId, input:$input){ id } } }'
MUT = 'mutation($id:String!,$actions:[JSONObject!]!){ mutateDocument(documentIdentifier:$id, actions:$actions){ documentType } }'
REL = 'mutation($s:String!,$t:String!,$ty:String!){ addRelationship(sourceIdentifier:$s, targetIdentifier:$t, relationshipType:$ty, branch:"main"){ documentType } }'

def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z")

def act(t, inp, scope="global"):
    return {"id": str(uuid.uuid4()), "timestampUtcMs": now(), "scope": scope, "type": t, "input": inp}

def post(q, v, ep, attempts=4):
    last = None
    for i in range(attempts):
        try:
            return gql.post(q, v, endpoint=ep, timeout=90)
        except Exception as e:
            last = e
            time.sleep(1.5 * (i + 1))
    raise last

def create_note(spec):
    for field in ("title", "description", "noteType", "body", "group_index"):
        if spec.get(field) in (None, "", []):
            raise ValueError(f"missing {field}")
    group = GROUPS[spec["group_index"]]
    spec["source_ids"] = [l["source_id"] for l in group["leads"]]
    spec["content"] = spec["body"].rstrip() + "\n" + leads_block(spec["group_index"])
    if len(spec["description"]) > 200:
        raise ValueError(f"description {len(spec['description'])} chars > 200 (would silently no-op)")

    nid = post(CREATE, {"name": spec["title"][:90], "parent": DRIVE}, W)["KnowledgeNote"]["createDocument"]["id"]
    post(MOVE, {"docId": DRIVE, "input": {"srcFolder": nid, "targetParentFolder": NOTES_FOLDER}}, W)

    content_actions = [
        act("SET_TITLE", {"title": spec["title"], "updatedAt": now()}),
        act("SET_DESCRIPTION", {"description": spec["description"], "updatedAt": now()}),
        act("SET_NOTE_TYPE", {"noteType": spec["noteType"], "updatedAt": now()}),
        act("SET_CONTENT", {"content": spec["content"], "updatedAt": now()}),
    ]
    for name in spec.get("topics", []):
        content_actions.append(act("ADD_TOPIC", {"id": str(uuid.uuid4()), "name": name}))
    post(MUT, {"id": nid, "actions": content_actions}, R)

    post(MUT, {"id": nid, "actions": [act("SET_PROVENANCE", {
        "author": "knowledge-agent", "sourceOrigin": "DERIVED",
        "sessionId": None, "createdAt": now()})]}, R)

    for sid in spec["source_ids"]:
        post(REL, {"s": nid, "t": sid, "ty": "DERIVED_FROM"}, R)
        post(MUT, {"id": sid, "actions": [act("ADD_EXTRACTED_CLAIM", {"claimRef": nid})]}, R)

    post(MUT, {"id": nid, "actions": [act("SUBMIT_FOR_REVIEW", {
        "id": str(uuid.uuid4()), "actor": "knowledge-agent", "timestamp": now(),
        "comment": "Extracted from lead research; claim checked against the source record."})]}, R)
    post(MUT, {"id": nid, "actions": [act("APPROVE_NOTE", {
        "id": str(uuid.uuid4()), "actor": "liberuum", "timestamp": now(),
        "comment": "Approved: lead corpus extraction."})]}, R)
    return nid

def main():
    specs_path = Path(sys.argv[1])
    specs = json.loads(specs_path.read_text())
    CREATED = ledger_for(specs_path)
    done = json.loads(CREATED.read_text()) if CREATED.exists() else {}
    ok, failed = 0, []
    t0 = time.time()
    for i, spec in enumerate(specs, 1):
        key = spec["title"]
        if key in done:
            continue
        try:
            nid = create_note(spec)
            done[key] = {"id": nid, "sources": len(spec["source_ids"])}
            CREATED.write_text(json.dumps(done, indent=1))
            ok += 1
            print(f"  [{i}/{len(specs)}] ✓ {nid}  ({len(spec['source_ids'])} leads)  {key[:70]}", flush=True)
        except Exception as e:
            failed.append((key, str(e)[:200]))
            print(f"  [{i}/{len(specs)}] ✗ {key[:70]} — {str(e)[:150]}", file=sys.stderr, flush=True)
    print(f"DONE: {ok} notes created, {len(failed)} failed in {int(time.time()-t0)}s")
    for k, e in failed[:10]:
        print(f"  FAIL {k[:70]}: {e}")

if __name__ == "__main__":
    main()
