"""Second MoC wave + a hub, so no lead note is unreachable.

Wave 1 clustered by tool. That left 95 notes unattached, because the
corpus also organises by screening stage, geography, buyer type and — a
category worth having — commentary on how the leads were scored. Those
clusters are derived from the topics that actually appeared, not guessed
in advance.

Anything still unattached after the topic pass hangs off the hub
directly: a note nobody can navigate to is a note that does not exist.
"""
import json, sys, time, uuid, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "drive-sync"))
from lib import gql

W = "https://light-colt-c497cfbd-switchboard.vetra.io/graphql"
R = W + "/r"
D = "c5893e1b-854b-49b1-b8aa-6b133ab87969"
KNOWLEDGE_FOLDER = "ee107acb-6386-4f18-901b-5a7c12a49774"

CREATE = 'mutation($name:String!,$parent:String){ Moc { createDocument(name:$name, parentIdentifier:$parent){ id } } }'
MOVE = 'mutation($docId:PHID!,$input:DocumentDrive_MoveNodeInput!){ DocumentDrive { moveNode(docId:$docId, input:$input){ id } } }'
MUT = 'mutation($id:String!,$actions:[JSONObject!]!){ mutateDocument(documentIdentifier:$id, actions:$actions){ documentType } }'
REL = 'mutation($s:String!,$t:String!,$ty:String!){ addRelationship(sourceIdentifier:$s, targetIdentifier:$t, relationshipType:$ty, branch:"main"){ documentType } }'

WAVE2 = {
    "open-source-screening": ("Leads awaiting an open-source portfolio screen",
        "The largest cohort in the corpus is not qualified or disqualified — it is unscreened. These "
        "rows were rescored mechanically on size and slot occupancy, with the open-source screen "
        "still outstanding, yet they sit in the same priority column as judged rows. Treat a "
        "priority here as provisional."),
    "scoring-provenance": ("How the lead corpus was scored, and where that is unreliable",
        "Notes about the corpus rather than the companies in it: rows rescored mechanically and "
        "presented like assessments, exclusions that cite an evidence step never run, ownership "
        "facts carried unverified for two decades, and revenue figures without currency or date. "
        "Read this before trusting a priority."),
    "netherlands": ("Dutch leads", "TOPIC-GEO"),
    "public-sector": ("Public-sector leads", "TOPIC-SECTOR"),
    "denmark": ("Danish leads", "TOPIC-GEO"),
    "design-partner": ("Candidate design partners",
        "Leads where the record supports more than a pitch — an identified integration point, an "
        "aligned practice, or a buyer whose incentives already match. The shortlist worth spending "
        "build time on."),
    "digital-sovereignty": ("Digital sovereignty and Common Ground as a buying driver",
        "A cluster where the purchase rationale is sovereignty or a shared public standard rather "
        "than a feature gap. The integration argument is the same; the budget line is different."),
    "mendix": ("Low-code platforms occupying the slot",
        "Leads where a low-code platform already holds the position Powerhouse would take. "
        "Displacement rather than complement — which changes the conversation from integration to "
        "replacement."),
}
GEO_SECTOR = {
    "TOPIC-GEO": "Leads grouped by geography. Useful for planning outreach in one trip or one "
                 "language, and for seeing where the corpus is thin.",
    "TOPIC-SECTOR": "Leads grouped by the sector they sell into, where the buying rationale and the "
                    "compliance pressure are shared regardless of which tool they run.",
}

def now(): return datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z")
def act(t, i): return {"id": str(uuid.uuid4()), "timestampUtcMs": now(), "scope": "global", "type": t, "input": i}

def post(q, v, ep, attempts=3):
    last = None
    for k in range(attempts):
        try: return gql.post(q, v, endpoint=ep, timeout=120)
        except Exception as e:
            last = e; time.sleep(1.5 * (k + 1))
    raise last

def make_moc(title, orientation, tier="TOPIC"):
    mid = post(CREATE, {"name": title[:90], "parent": D}, W)["Moc"]["createDocument"]["id"]
    post(MOVE, {"docId": D, "input": {"srcFolder": mid, "targetParentFolder": KNOWLEDGE_FOLDER}}, W)
    post(MUT, {"id": mid, "actions": [act("CREATE_MOC", {
        "title": title, "description": orientation[:200], "orientation": orientation,
        "tier": tier, "createdAt": now()})]}, R)
    return mid

def main():
    gn = post('{ knowledgeGraphNodes(driveId:"%s"){ documentId topics } }' % D, {}, W)["knowledgeGraphNodes"]
    lead = {n["documentId"]: (n.get("topics") or []) for n in gn if "leads" in (n.get("topics") or [])}
    edges = post('{ knowledgeGraphEdges(driveId:"%s"){ sourceDocumentId targetDocumentId linkType } }' % D, {}, W)["knowledgeGraphEdges"]
    attached = {e["targetDocumentId"] for e in edges if e["linkType"] == "CORE_IDEA"}
    made = []
    for topic, spec in WAVE2.items():
        title, second = spec[0], spec[1]
        orientation = GEO_SECTOR.get(second, second)
        members = [k for k, ts in lead.items() if topic in ts]
        if len(members) < 3:
            print(f"  skip '{topic}': {len(members)} notes"); continue
        mid = make_moc(title, orientation)
        for m in members:
            post(REL, {"s": mid, "t": m, "ty": "CORE_IDEA"}, R)
            attached.add(m)
        made.append((title, len(members), mid))
        print(f"  ✓ {title}: {len(members)} core ideas", flush=True)

    hub = make_moc("The Powerhouse lead corpus",
        "201 leads researched for demo-building on the Powerhouse stack, extracted into claims rather "
        "than one note per company: many leads share byte-identical research text, so a claim carries "
        "DERIVED_FROM edges to every lead that shares it. Start with the capability gaps by tool, then "
        "the demo designs — the same integration recurs across engines. Read the scoring-provenance "
        "MoC before trusting any priority: a large part of the corpus is rescored, not assessed.",
        tier="DOMAIN")
    print(f"  ✓ hub -> {hub}")
    existing_mocs = [n for n in gn if (n.get("topics") or []) == [] ]  # not used; children resolved below
    # children: every lead MoC created in either wave
    moc_nodes = post('{ knowledgeGraphNodes(driveId:"%s"){ documentId title noteType } }' % D, {}, W)["knowledgeGraphNodes"]
    child_titles = {t for t, *_ in made} | {"Leads running Flowable", "Leads running Camunda",
        "Leads running Alfresco", "Leads not to pitch, and why",
        "Demo designs across the lead corpus", "Federated buyers as a channel pattern"}
    kids = [n for n in moc_nodes if n.get("title") in child_titles and str(n.get("noteType") or "").startswith("MOC")]
    for k in kids:
        post(REL, {"s": hub, "t": k["documentId"], "ty": "CHILD_MOC"}, R)
    print(f"  ✓ hub children: {len(kids)}")

    strays = [k for k in lead if k not in attached]
    for s in strays:
        post(REL, {"s": hub, "t": s, "ty": "CORE_IDEA"}, R)
    print(f"  ✓ attached {len(strays)} remaining notes directly to the hub")
    print(f"\nDONE: {len(made)} topic MoCs + 1 hub")

if __name__ == "__main__":
    main()
