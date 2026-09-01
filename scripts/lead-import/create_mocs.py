"""Create MoCs over the lead corpus and attach notes as core ideas.

MoCs are built from what actually landed in the vault, not from the CSV:
notes are matched by their `leads` topic plus a tool/theme topic, so a
cluster only exists if notes were really written for it. Building from
intent instead would produce MoCs pointing at nothing.

CORE_IDEA edges are written with addRelationship — the graph subgraph
indexes the relationship table, not a MoC's in-state array.
"""
import json, sys, time, uuid, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "drive-sync"))
from lib import gql

W = "https://light-colt-c497cfbd-switchboard.vetra.io/graphql"
R = W + "/r"
DRIVE = "c5893e1b-854b-49b1-b8aa-6b133ab87969"
KNOWLEDGE_FOLDER = "ee107acb-6386-4f18-901b-5a7c12a49774"

CREATE = 'mutation($name:String!,$parent:String){ Moc { createDocument(name:$name, parentIdentifier:$parent){ id } } }'
MOVE = 'mutation($docId:PHID!,$input:DocumentDrive_MoveNodeInput!){ DocumentDrive { moveNode(docId:$docId, input:$input){ id } } }'
MUT = 'mutation($id:String!,$actions:[JSONObject!]!){ mutateDocument(documentIdentifier:$id, actions:$actions){ documentType } }'
REL = 'mutation($s:String!,$t:String!,$ty:String!){ addRelationship(sourceIdentifier:$s, targetIdentifier:$t, relationshipType:$ty, branch:"main"){ documentType } }'

# topic -> (title, tier, orientation)
CLUSTERS = {
    "flowable": ("Leads running Flowable", "TOPIC",
        "Flowable leads share one capability gap: the engine orchestrates when things happen while "
        "the decision record stays mutable and purgeable. Read the fit note first, then the demo "
        "design — a Camunda delegate and a Flowable listener are the same integration twice."),
    "camunda": ("Leads running Camunda", "TOPIC",
        "The Camunda cohort mirrors the Flowable one: same gap between orchestration and an "
        "attributed record, same dispatch-at-task-boundary integration shape. Differences between "
        "the two cohorts are mostly commercial, not technical."),
    "odoo": ("Leads running Odoo", "TOPIC",
        "Odoo is already the system of record for what it covers, so the pitch is not 'a second "
        "database' — it is field-level attribution on records Odoo owns. Read these against the "
        "orchestrator cohorts, where the gap is structural rather than granular."),
    "alfresco": ("Leads running Alfresco", "TOPIC",
        "Alfresco records document events — versions, uploads, moves — but not the business "
        "decision behind them. The demo turns an approval into a typed operation."),
    "n8n": ("Leads running n8n", "TOPIC",
        "Automation-tool leads where a webhook or hook dispatches a typed operation. The integration "
        "is cheap; the question these leads raise is whether the buyer values attribution."),
    "disqualified": ("Leads not to pitch, and why", "TOPIC",
        "Negative findings are the most reusable part of a lead corpus: they stop the same "
        "conversation being reopened. Most disqualifications here turn on scale, competing product "
        "IP, or a slot already occupied — not on technical misfit."),
    "demo-design": ("Demo designs across the lead corpus", "TOPIC",
        "The demo scenarios repeat across tools because the move is the same: dispatch a typed "
        "operation at a decision boundary, then destroy the originating system's state and replay "
        "the chain from Powerhouse. Build one, ship several."),
    "federated-buyer": ("Federated buyers as a channel pattern", "TOPIC",
        "Several leads are not single firms but federations buying on behalf of members. The "
        "structure changes the sale: one integration reaches many operators, and the reference "
        "value compounds."),
}

def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z")

def act(t, inp):
    return {"id": str(uuid.uuid4()), "timestampUtcMs": now(), "scope": "global", "type": t, "input": inp}

def post(q, v, ep, attempts=3):
    last = None
    for i in range(attempts):
        try:
            return gql.post(q, v, endpoint=ep, timeout=120)
        except Exception as e:
            last = e
            time.sleep(1.5 * (i + 1))
    raise last

def main():
    nodes = post('{ knowledgeGraphNodes(driveId:"%s"){ documentId title topics noteType } }' % DRIVE, {}, W)["knowledgeGraphNodes"]
    lead_notes = [n for n in nodes if "leads" in (n.get("topics") or [])]
    print(f"lead notes found in vault: {len(lead_notes)}")
    created = []
    for topic, (title, tier, orientation) in CLUSTERS.items():
        members = [n for n in lead_notes if topic in (n.get("topics") or [])]
        if len(members) < 3:
            print(f"  skip '{topic}': only {len(members)} notes (a MoC over <3 notes is noise)")
            continue
        mid = post(CREATE, {"name": title[:90], "parent": DRIVE}, W)["Moc"]["createDocument"]["id"]
        post(MOVE, {"docId": DRIVE, "input": {"srcFolder": mid, "targetParentFolder": KNOWLEDGE_FOLDER}}, W)
        post(MUT, {"id": mid, "actions": [act("CREATE_MOC", {
            "title": title,
            "description": orientation[:200],
            "orientation": orientation,
            "tier": tier,
            "createdAt": now()})]}, R)
        for n in members:
            post(REL, {"s": mid, "t": n["documentId"], "ty": "CORE_IDEA"}, R)
        created.append((title, len(members), mid))
        print(f"  ✓ {title}: {len(members)} core ideas -> {mid}", flush=True)
    print(f"\nDONE: {len(created)} MoCs created")

if __name__ == "__main__":
    main()
