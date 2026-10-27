#!/usr/bin/env python3
"""Builds retarget-dev.json (the M0 retarget and deictic dev set).

Source of truth for the set. Written from the model specs, reducers, op-catalog
field classes and vocabularies only.
Usage: python3 build.py [out.json]   (default: ../retarget-dev.json)
"""
import hashlib
import json
import sys
import os
HERE = os.path.dirname(os.path.abspath(__file__))
EVAL_DIR = os.path.dirname(HERE)
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(EVAL_DIR)))

TODAY = "2026-10-27"

MODEL_OF_TYPE = {
    "bai/knowledge-note": "knowledge-note", "bai/moc": "moc", "bai/project": "project",
    "bai/wbs": "wbs", "bai/tension": "tension", "bai/research-claim": "research-claim",
    "bai/source": "source", "bai/observation": "observation", "bai/vault-config": "vault-config",
    "bai/health-report": "health-report", "bai/pipeline-queue": "pipeline-queue",
    "bai/derivation": "derivation",
}
TYPE_OF_MODEL = {v: k for k, v in MODEL_OF_TYPE.items()}


def uid(*parts):
    h = hashlib.sha256(":".join(parts).encode()).hexdigest()
    return f"{h[0:8]}-{h[8:12]}-4{h[13:16]}-a{h[17:20]}-{h[20:32]}"


def oid(*parts):
    return hashlib.sha256(("oid:" + ":".join(parts)).encode()).hexdigest()[:12]


# ---------------------------------------------------------------- drives
# key -> (title, model, state)
def kn(title, noteType="concept", status="DRAFT", author="sam", topics=(), links=()):
    return {"title": title, "noteType": noteType, "status": status,
            "provenance": {"author": author, "sourceOrigin": "MANUAL"},
            "topics": [{"id": oid(title, "t", t), "name": t} for t in topics],
            "links": list(links)}


def moc(title, tier="TOPIC", core=(), children=(), questions=()):
    return {"title": title, "tier": tier,
            "coreIdeas": [{"id": oid(title, "ci", n), "noteRef": n, "contextPhrase": cp, "sortOrder": i}
                          for i, (n, cp) in enumerate(core)],
            "childRefs": list(children), "openQuestions": list(questions), "tensions": []}


def project(name, status="ACTIVE", krefs=(), wbsRef=None, team=()):
    return {"name": name, "status": status, "knowledgeRefs": list(krefs), "wbsRef": wbsRef,
            "team": list(team), "deliverables": [], "references": []}


def wbs(goals=(), projectRef=None):
    return {"projectRef": projectRef, "goals": [
        {"id": gid, "description": d, "status": s, "parentId": p, "dependencies": [], "notes": []}
        for gid, d, s, p in goals]}


def tension(title, involved=(), status="OPEN"):
    return {"title": title, "status": status, "involvedRefs": list(involved)}


def claim(title, kind="research", connections=()):
    return {"title": title, "kind": kind, "methodology": [], "sources": [], "topics": [],
            "connections": list(connections)}


def source(title, sourceType="ARTICLE", status="INBOX", extracted=()):
    return {"title": title, "sourceType": sourceType, "status": status,
            "extractedClaims": list(extracted)}


def observation(title, category="PROCESS", status="PENDING"):
    return {"title": title, "category": category, "status": status}


DRIVES = {}


def drive(key, name, docs):
    did = uid("drive", key)
    out = {}
    for k, (title, model, state) in docs.items():
        out[k] = {"id": uid(key, k, title), "title": title, "model": model,
                  "docType": TYPE_OF_MODEL[model], "state": state}
    DRIVES[key] = {"id": did, "name": name, "docs": out}


drive("fl", "Fermentation Lab", {
    "lab": ("Lactic Acid Bacteria Prefer Low Oxygen", "knowledge-note",
            kn("Lactic Acid Bacteria Prefer Low Oxygen", status="CANONICAL", author="ines")),
    "salt": ("Salt Concentration Controls Kraut Texture", "knowledge-note",
             kn("Salt Concentration Controls Kraut Texture")),
    "koji": ("Koji Needs High Humidity", "knowledge-note", kn("Koji Needs High Humidity")),
    "brine": ("Brine Temperature Log Format", "knowledge-note",
              kn("Brine Temperature Log Format", noteType="procedure")),
    "fermoc": ("Fermentation", "moc", moc("Fermentation", tier="HUB",
               children=("Vegetable Ferments",))),
    "veg": ("Vegetable Ferments", "moc", moc("Vegetable Ferments", core=(
        ("Salt Concentration Controls Kraut Texture", "how much salt and why"),
        ("Crock Weights Prevent Surface Mold", "keeping vegetables under brine")))),
    "kojimoc": ("Koji and Molds", "moc", moc("Koji and Molds")),
    "proj": ("Pantry Ferment Workshop", "project", project("Pantry Ferment Workshop")),
    "plan": ("Pantry Ferment Workshop Plan", "wbs", wbs(goals=(
        (oid("fl", "g1"), "Book the community kitchen", "IN_PROGRESS", None),))),
    "ten": ("Salt Ratios Disagree Across Sources", "tension",
            tension("Salt Ratios Disagree Across Sources")),
    "claim": ("Lower Salt Speeds Souring", "research-claim", claim("Lower Salt Speeds Souring")),
    "obs": ("Kahm Yeast Shows Up After Day Five", "observation",
            observation("Kahm Yeast Shows Up After Day Five", category="SURPRISE")),
    "hr": ("Weekly Health Check", "health-report", {"checks": []}),
})

drive("ds", "Distributed Systems Notes", {
    "vc": ("Vector Clocks Order Causality", "knowledge-note", kn("Vector Clocks Order Causality")),
    "lww": ("Last Writer Wins Loses Updates", "knowledge-note",
            kn("Last Writer Wins Loses Updates", status="CANONICAL", topics=("replication",))),
    "gossip": ("Gossip Protocols Converge Slowly", "knowledge-note",
               kn("Gossip Protocols Converge Slowly")),
    "raft": ("Raft", "knowledge-note", kn("Raft", noteType="reference")),
    "rle": ("Raft Leader Election", "knowledge-note",
            kn("Raft Leader Election", status="IN_REVIEW", author="dana")),
    "crdts": ("CRDTs", "moc", moc("CRDTs", core=(
        ("Grow-Only Counters", "the simplest convergent type"),
        ("Observed-Remove Sets", "deletes without lost adds")))),
    "cons": ("Consensus", "moc", moc("Consensus")),
    "dsmoc": ("Distributed Systems", "moc", moc("Distributed Systems", tier="HUB",
              children=("CRDTs",))),
    "proj": ("Sync Engine Rewrite", "project", project("Sync Engine Rewrite",
             team=({"id": oid("ds", "m1"), "name": "Tomas", "role": "lead", "kind": "HUMAN"},))),
    "plan": ("Sync Engine Rewrite Plan", "wbs", wbs()),
    "ten": ("Strong Consistency vs Offline Edits", "tension",
            tension("Strong Consistency vs Offline Edits", involved=("Vector Clocks Order Causality",))),
    "claim": ("Delta CRDTs Cut Bandwidth", "research-claim", claim("Delta CRDTs Cut Bandwidth")),
    "src": ("Notes from the Replication Talk", "source",
            source("Notes from the Replication Talk", sourceType="TRANSCRIPT")),
    "vcfg": ("Vault Settings", "vault-config", {"name": "Vault Settings",
             "maintenance": {"inboxPressure": 25}}),
})

drive("uc", "Urban Cycling Study", {
    "lanes": ("Protected Lanes Raise Ridership", "research-claim",
              claim("Protected Lanes Raise Ridership")),
    "helmet": ("Helmet Laws Reduce Cycling", "research-claim", claim("Helmet Laws Reduce Cycling")),
    "counter": ("City Counter Data 2025", "source",
                source("City Counter Data 2025", sourceType="DOCUMENTATION", status="EXTRACTED")),
    "courier": ("Interview with a Courier", "source",
                source("Interview with a Courier", sourceType="TRANSCRIPT")),
    "ten": ("Ridership Counts vs Survey Answers", "tension",
            tension("Ridership Counts vs Survey Answers")),
    "obs": ("Counters Miss E-Scooters", "observation",
            observation("Counters Miss E-Scooters", category="FRICTION")),
    "induced": ("Induced Demand", "knowledge-note", kn("Induced Demand", status="CANONICAL")),
    "dock": ("Bike Share Docking Gaps", "knowledge-note", kn("Bike Share Docking Gaps")),
    "street": ("Street Design", "moc", moc("Street Design")),
    "proj": ("Corridor Count Study", "project", project("Corridor Count Study")),
    "plan": ("Corridor Count Study Plan", "wbs", wbs()),
    "queue": ("Processing Queue", "pipeline-queue", {"tasks": [
        {"id": oid("uc", "task1"), "taskType": "claim", "target": "Interview with a Courier",
         "status": "IN_PROGRESS", "currentPhase": "create"},
        {"id": oid("uc", "task2"), "taskType": "enrichment", "target": "Induced Demand",
         "status": "PENDING", "currentPhase": "enrich"},
        {"id": oid("uc", "task3"), "taskType": "claim", "target": "City Counter Data 2025",
         "status": "DONE", "currentPhase": "verify"}]}),
})

drive("cs", "Choir Season", {
    "spring": ("Spring Concert 2027", "project", project("Spring Concert 2027", status="PLANNING")),
    "winter": ("Winter Carols 2026", "project", project("Winter Carols 2026")),
    "splan": ("Spring Concert Plan", "wbs", wbs(goals=(
        (oid("cs", "g1"), "Venue", "IN_PROGRESS", None),
        (oid("cs", "g2"), "Repertoire", "TODO", None),
        (oid("cs", "g3"), "Sign the hall contract", "TODO", oid("cs", "g1"))))),
    "wplan": ("Winter Carols Plan", "wbs", wbs()),
    "warm": ("Warmups Before Sectionals", "knowledge-note", kn("Warmups Before Sectionals")),
    "breath": ("Breathing Exercises", "knowledge-note", kn("Breathing Exercises")),
    "rep1": ("Repertoire Notes", "knowledge-note", kn("Repertoire Notes", status="CANONICAL")),
    "rep2": ("Repertoire Notes", "knowledge-note", kn("Repertoire Notes", status="CANONICAL")),
    "rmoc": ("Rehearsal Practice", "moc", moc("Rehearsal Practice")),
    "obs": ("Altos Rush the Bridge", "observation", observation("Altos Rush the Bridge")),
    "ten": ("Tempo vs Diction", "tension", tension("Tempo vs Diction")),
    "deriv": ("Vault Derivation", "derivation", {"signals": []}),
})

drive("ce", "Coastal Erosion Fieldwork", {
    "tide": ("Tide Gauge Export March", "source",
             source("Tide Gauge Export March", sourceType="DOCUMENTATION", status="EXTRACTING")),
    "dune": ("Dune Grass Holds Sand", "knowledge-note", kn("Dune Grass Holds Sand")),
    "dunes2": ("Dune Restoration Costs", "knowledge-note", kn("Dune Restoration Costs")),
    "storm": ("Storm Surge Timing", "knowledge-note", kn("Storm Surge Timing")),
    "fmkn": ("Field Methods", "knowledge-note", kn("Field Methods")),
    "fmmoc": ("Field Methods", "moc", moc("Field Methods")),
    "shore": ("Shoreline Processes", "moc", moc("Shoreline Processes", core=(
        ("Seawalls Accelerate Beach Loss", "what hard defences do downdrift"),
        ("Storm Surge Timing", "when the big losses happen")))),
    "proj": ("Bay Survey 2027", "project", project("Bay Survey 2027")),
    "seawall": ("Seawalls Accelerate Beach Loss", "research-claim",
                claim("Seawalls Accelerate Beach Loss")),
    "sed": ("Sediment Budget Doesn't Close", "tension", tension("Sediment Budget Doesn't Close")),
})

# ---------------------------------------------------------------- items
# Compact item spec. Keys:
#  id, cat, style (natural|paraphrase), wording (plain|messy), u (utterance), d (drive),
#  open (doc key or None), gold (doc key the change lands on; None = unknowable),
#  among (doc keys, when gold is None), ctx (doc key for context, defaults to gold),
#  res (keep|switch|ask-two|ask-top3), via, intentClear, alt [(doc key, op)],
#  op, args, amb, ref {field: doc key | ("goal", gid) | ("core", noteRef) | ("task", tid)},
#  match, req, diff, tags, conf, why, notes, vis (query, [doc keys]), cand (ref candidate kind)
I = []


def item(**kw):
    I.append(kw)


# ---- switch: one other verbatim title, no pointer
item(id="rt-sw-01", cat="switch-verbatim", style="paraphrase", wording="plain", d="ds", open="gossip",
     gold="crdts", res="switch", via="verbatim",
     u="Something CRDTs still has to answer: do we ever garbage-collect tombstones?",
     op="moc:ADD_OPEN_QUESTION", args={"question": "Do we ever garbage-collect tombstones?"},
     match={"question": "fuzzy"}, diff="easy", tags=["verbatim-title", "moc"])
item(id="rt-sw-02", cat="switch-verbatim", style="natural", wording="messy", d="fl", open="proj",
     gold="koji", res="switch", via="verbatim",
     u="Koji Needs High Humidity is a pattern note not a concept, fix the type pls",
     op="knowledge-note:SET_NOTE_TYPE", args={"noteType": "pattern"}, diff="medium",
     tags=["verbatim-title", "enum"])
item(id="rt-sw-03", cat="switch-verbatim", style="natural", wording="messy", d="cs", open="breath",
     gold="splan", res="switch", via="verbatim",
     u="Spring Concert Plan - new goal: book the church hall for the dress rehearsal",
     op="wbs:CREATE_GOAL", args={"description": "Book the church hall for the dress rehearsal"},
     match={"description": "fuzzy"}, diff="medium", tags=["verbatim-title", "top-level"],
     notes="Top level: parentId is absent. 'Spring Concert 2027' (a project) is not mentioned.")
item(id="rt-sw-04", cat="switch-verbatim", style="natural", wording="plain", d="ce", open="shore",
     gold="sed", res="switch", via="verbatim",
     u="Sediment Budget Doesn't Close is resolved: the missing sand was going into the offshore bar.",
     op="tension:RESOLVE_TENSION",
     args={"resolution": "The missing sand was going into the offshore bar."},
     match={"resolution": "fuzzy"}, diff="hard", tags=["verbatim-title", "apostrophe"],
     conf=["tension:DISSOLVE_TENSION"],
     why="An explanation was found, so the tension is resolved, not dissolved.")
item(id="rt-sw-05", cat="switch-verbatim", style="paraphrase", wording="plain", d="ds", open="plan",
     gold="rle", res="switch", via="verbatim",
     u="Raft Leader Election reads well, sign off on the review.",
     op="knowledge-note:APPROVE_NOTE", args={}, amb={"comment": None},
     diff="hard", tags=["verbatim-title", "substring-title", "lifecycle"],
     conf=["knowledge-note:SUBMIT_FOR_REVIEW"],
     why="'review' suggests submitting; the note is already IN_REVIEW, so this is the approval. "
         "The note 'Raft' is only inside the longer mentioned title and does not count.")
item(id="rt-sw-06", cat="switch-verbatim", style="natural", wording="messy", d="uc", open="ten",
     gold="obs", res="switch", via="verbatim",
     u="Counters Miss E-Scooters got implemented, the new protocol counts them separately",
     op="observation:IMPLEMENT_OBSERVATION", args={}, diff="medium", tags=["verbatim-title", "no-args"])
item(id="rt-sw-07", cat="switch-verbatim", style="paraphrase", wording="messy", d="cs", open="spring",
     gold="warm", res="switch", via="verbatim",
     u="Warmups Before Sectionals — tag w/ vocal health",
     op="knowledge-note:ADD_TOPIC", args={"name": "vocal health"}, match={"name": "ci"},
     diff="medium", tags=["verbatim-title"])
item(id="rt-sw-08", cat="switch-verbatim", style="paraphrase", wording="plain", d="ce", open="dune",
     gold="tide", res="switch", via="verbatim",
     u="Tide Gauge Export March is fully mined: 14 claims kept and 6 skipped.",
     op="source:RECORD_EXTRACTION_STATS", args={"claimCount": 14, "skippedCount": 6, "skipRate": 0.3},
     diff="hard", tags=["verbatim-title", "computed-number"],
     conf=["source:SET_SOURCE_STATUS"],
     why="'fully mined' could read as a status change to EXTRACTED; the counts make it the stats op. "
         "skipRate is 6 of 20.")
item(id="rt-sw-09", cat="switch-verbatim", style="natural", wording="plain", d="ds", open="claim",
     gold="crdts", res="switch", via="verbatim",
     u="CRDTs should list Delta CRDTs Cut Bandwidth among its core ideas.",
     op="moc:ADD_CORE_IDEA", args={"noteRef": "Delta CRDTs Cut Bandwidth"},
     amb={"sortOrder": 2}, match={"noteRef": "ci"}, req=["noteRef", "contextPhrase", "sortOrder"],
     diff="hard", tags=["verbatim-title", "open-title-mentioned", "exact-copy"],
     conf=["research-claim:ADD_RESEARCH_CONNECTION"],
     why="The open claim's own title (which contains 'CRDTs') is named too; only the standalone "
         "'CRDTs' is another document, so the MOC is the target and the claim is the noteRef.")
item(id="rt-sw-10", cat="switch-verbatim", style="paraphrase", wording="messy", d="ds", open="lww",
     gold="vcfg", res="switch", via="verbatim",
     u="Vault Settings: inbox pressure shouldnt warn until 40",
     op="vault-config:UPDATE_MAINTENANCE_THRESHOLD",
     args={"condition": "inboxPressure", "threshold": 40}, diff="medium",
     tags=["verbatim-title", "enum"])
item(id="rt-sw-11", cat="switch-verbatim", style="natural", wording="messy", d="fl", open="fermoc",
     gold="hr", res="switch", via="verbatim",
     u="log a WARN in Weekly Health Check: Fermentation has like 40 core ideas, way too big",
     op="health-report:ADD_CHECK",
     args={"category": "MOC_COHERENCE", "status": "WARN",
           "message": "Fermentation has about 40 core ideas, which is too big",
           "affectedItems": ["Fermentation"]},
     match={"message": "fuzzy", "affectedItems": "ci"}, diff="hard",
     tags=["verbatim-title", "open-title-mentioned", "enum", "list"],
     conf=["health-report:GENERATE_REPORT"],
     why="The open MOC's own title is named as the affected item; the only other title is the "
         "health report, which is the target.")
item(id="rt-sw-12", cat="switch-verbatim", style="natural", wording="messy", d="uc", open="street",
     gold="queue", res="switch", via="verbatim",
     u="Processing Queue: fail the courier claim task, transcript is unreadable",
     op="pipeline-queue:FAIL_TASK", args={"reason": "The transcript is unreadable"},
     ref={"taskId": ("task", "task1")}, match={"reason": "fuzzy"}, diff="medium",
     tags=["verbatim-title", "ref-id"],
     notes="'courier' is not a title; the source is 'Interview with a Courier'.")

item(id="rt-sw-13", cat="switch-verbatim", style="natural", wording="messy", d="cs", open="spring",
     gold="splan", res="switch", via="verbatim",
     u="mark this goal done in Spring Concert Plan - sign the hall contract",
     op="wbs:SET_GOAL_STATUS", args={"status": "COMPLETED"}, ref={"id": ("goal", "g3")},
     diff="medium", tags=["verbatim-title", "item-pointer", "ref-id", "enum"],
     notes="'this goal' points at an item, not at the open project, so it does not block the switch.")

# ---- controls: no other title, act on the open document
item(id="rt-ct-01", cat="control", style="paraphrase", wording="messy", d="ds", open="lww", gold="lww",
     res="keep", via="none", u="tag this note w/ data loss",
     op="knowledge-note:ADD_TOPIC", args={"name": "data loss"}, match={"name": "ci"}, diff="easy",
     tags=["pointer-only"])
item(id="rt-ct-02", cat="control", style="natural", wording="messy", d="fl", open="veg", gold="veg",
     res="keep", via="none",
     u="orientation should say: start here for anything brined or dry-salted",
     op="moc:UPDATE_ORIENTATION",
     args={"orientation": "Start here for anything brined or dry-salted"},
     match={"orientation": "fuzzy"}, diff="easy", tags=["no-pointer"])
item(id="rt-ct-03", cat="control", style="paraphrase", wording="messy", d="uc", open="courier",
     gold="courier", res="keep", via="none", u="ok started mining claims from the courier transcript",
     op="source:SET_SOURCE_STATUS", args={"status": "EXTRACTING"}, diff="hard",
     tags=["no-pointer", "enum", "described-not-named"], conf=["source:ADD_EXTRACTED_CLAIM"],
     why="'pulling claims out' names the work in progress, not one extracted claim.")
item(id="rt-ct-04", cat="control", style="natural", wording="plain", d="cs", open="splan",
     gold="splan", res="keep", via="none", u="Add a goal under Venue: confirm the piano tuning.",
     op="wbs:CREATE_GOAL", args={"description": "Confirm the piano tuning"},
     ref={"parentId": ("goal", "g1")}, match={"description": "fuzzy"}, diff="medium",
     tags=["no-pointer", "ref-id"], notes="'Venue' is a goal in the open plan, not a document.")
item(id="rt-ct-05", cat="control", style="natural", wording="plain", d="ce", open="sed", gold="sed",
     res="keep", via="none", u="Dissolve this, we were comparing two different survey years.",
     op="tension:DISSOLVE_TENSION",
     args={"resolution": "We were comparing two different survey years."},
     match={"resolution": "fuzzy"}, diff="easy", tags=["pointer-only"])
item(id="rt-ct-06", cat="control", style="paraphrase", wording="plain", d="uc", open="helmet",
     gold="helmet", res="keep", via="none",
     u="Helmet Laws Reduce Cycling: the body should now say the drop was mostly among teenagers",
     op="research-claim:UPDATE_CLAIM_CONTENT",
     args={"content": "The drop was mostly among teenagers."}, match={"content": "fuzzy"},
     diff="hard", tags=["open-title-mentioned"], conf=["research-claim:CREATE_CLAIM"],
     why="The only title named is the open claim's own, which is not another document.")
item(id="rt-ct-07", cat="control", style="paraphrase", wording="plain", d="cs", open="spring",
     gold="spring", res="keep", via="none", u="Push the deadline to April 25.",
     op="project:SET_TARGET_DATE", args={"targetDate": "2027-04-25T00:00:00Z"},
     match={"targetDate": "date"}, diff="medium", tags=["no-pointer", "date"],
     notes="Today is 2026-10-27, so April 25 is 2027-04-25.")

# ---- pointer plus one verbatim name: ask which of the two
item(id="rt-pn-01", cat="pointer-plus-name", style="natural", wording="messy", d="ds", open="vc",
     gold="vc", res="ask-two", via="pointer-plus-name", intentClear=True,
     u="can u link this note to Last Writer Wins Loses Updates",
     op="knowledge-note:ADD_LINK", args={}, ref={"targetDocumentId": "lww"},
     amb={"linkType": "RELATES_TO", "targetTitle": "Last Writer Wins Loses Updates"},
     req=["linkType"], diff="hard", tags=["intent-open", "ref-id"],
     conf=["moc:ADD_CORE_IDEA"],
     why="The named document is a note, and 'link this note' makes the open note the subject.")
item(id="rt-pn-02", cat="pointer-plus-name", style="natural", wording="messy", d="ds", open="vc",
     gold="crdts", res="ask-two", via="pointer-plus-name", intentClear=True,
     u="add this to CRDTs real quick",
     op="moc:ADD_CORE_IDEA", args={}, amb={"noteRef": "Vector Clocks Order Causality", "sortOrder": 2},
     req=["noteRef", "contextPhrase", "sortOrder"], diff="hard", tags=["intent-named"],
     conf=["knowledge-note:ADD_TOPIC", "knowledge-note:ADD_LINK"],
     why="'add this to <MOC>' changes the MOC; the open note is the entry, not the changed document.")
item(id="rt-pn-03", cat="pointer-plus-name", style="paraphrase", wording="plain", d="fl", open="salt",
     gold="salt", res="ask-two", via="pointer-plus-name", intentClear=True,
     u="This contradicts Lactic Acid Bacteria Prefer Low Oxygen.",
     op="knowledge-note:ADD_LINK", args={"linkType": "CONTRADICTS"}, ref={"targetDocumentId": "lab"},
     amb={"targetTitle": "Lactic Acid Bacteria Prefer Low Oxygen"}, diff="hard",
     tags=["intent-open", "ref-id", "enum"], conf=["knowledge-note:UPDATE_LINK_TYPE"],
     why="No link exists yet, so it is a new link with a stated type.")
item(id="rt-pn-04", cat="pointer-plus-name", style="paraphrase", wording="messy", d="fl", open="koji",
     gold="kojimoc", res="ask-two", via="pointer-plus-name", intentClear=True,
     u="stick this under Koji and Molds pls",
     op="moc:ADD_CORE_IDEA", args={}, amb={"noteRef": "Koji Needs High Humidity", "sortOrder": 0},
     req=["noteRef", "contextPhrase", "sortOrder"], diff="hard", tags=["intent-named"],
     conf=["moc:ADD_CHILD_MOC", "knowledge-note:ADD_TOPIC"],
     why="The open document is a note, so it goes in as an entry, not a child MOC. "
         "Both titles start with 'Koji'.")
item(id="rt-pn-05", cat="pointer-plus-name", style="paraphrase", wording="plain", d="uc",
     open="induced", gold="proj", res="ask-two", via="pointer-plus-name", intentClear=True,
     u="Attach this note to Corridor Count Study.",
     op="project:ADD_KNOWLEDGE_REF", args={}, ref={"ref": "induced"}, diff="hard",
     tags=["intent-named", "ref-id", "open-doc-as-ref"], conf=["knowledge-note:ADD_LINK"],
     why="A note attached to a project is the project's knowledge ref; the open note is the ref.")
item(id="rt-pn-06", cat="pointer-plus-name", style="natural", wording="plain", d="uc", open="proj",
     gold="proj", res="ask-two", via="pointer-plus-name", intentClear=True,
     u="this project should reference Induced Demand",
     op="project:ADD_KNOWLEDGE_REF", args={}, ref={"ref": "induced"}, diff="hard",
     tags=["intent-open", "ref-id"], conf=["project:SET_REFERENCES"],
     why="References are URLs; a vault note is a knowledge ref.")
item(id="rt-pn-07", cat="pointer-plus-name", style="paraphrase", wording="messy", d="cs", open="splan",
     gold="splan", res="ask-two", via="pointer-plus-name", intentClear=False,
     alt=[("spring", "project:LINK_WBS", {"wbsRef": "splan"}, {})],
     u="hook this plan up to Spring Concert 2027",
     op="wbs:SET_PROJECT_REF", args={}, ref={"projectRef": "spring"}, diff="hard",
     tags=["intent-unclear", "ref-id"], conf=["project:LINK_WBS"],
     why="Either side of the plan-project link can be set; both are acceptable.")
item(id="rt-pn-08", cat="pointer-plus-name", style="paraphrase", wording="messy", d="ds", open="dsmoc",
     gold="dsmoc", res="ask-two", via="pointer-plus-name", intentClear=True,
     u="nest Consensus under this one",
     op="moc:ADD_CHILD_MOC", args={"childRef": "Consensus"}, match={"childRef": "ci"},
     diff="medium", tags=["intent-open", "exact-copy"], conf=["moc:ADD_CORE_IDEA"])
item(id="rt-pn-09", cat="pointer-plus-name", style="paraphrase", wording="plain", d="ds", open="proj",
     gold="rle", res="ask-two", via="pointer-plus-name", intentClear=True,
     u="Raft Leader Election looks right to me, sign it off.",
     op="knowledge-note:APPROVE_NOTE", args={}, amb={"comment": None}, diff="hard",
     tags=["intent-named", "anaphora-it", "lifecycle"], conf=["project:SET_PROJECT_STATUS"],
     why="'it' follows the name, so it points back at the named note; the rule still asks.")
item(id="rt-pn-10", cat="pointer-plus-name", style="paraphrase", wording="messy", d="fl", open="veg",
     gold="veg", res="ask-two", via="pointer-plus-name", intentClear=True,
     u="drop Salt Concentration Controls Kraut Texture from here",
     op="moc:REMOVE_CORE_IDEA", args={},
     ref={"id": ("core", "Salt Concentration Controls Kraut Texture")}, diff="hard",
     tags=["intent-open", "ref-id"], conf=["moc:REMOVE_CHILD_MOC"],
     why="The named note is a core idea of the open MOC, not a child MOC.")
item(id="rt-pn-11", cat="pointer-plus-name", style="natural", wording="plain", d="ce", open="dune",
     gold="seawall", res="ask-two", via="pointer-plus-name", intentClear=False,
     alt=[("dune", "knowledge-note:ADD_LINK", {"targetDocumentId": "seawall"}, {"linkType": "RELATES_TO"})],
     u="Seawalls Accelerate Beach Loss backs this up; record the connection.",
     op="research-claim:ADD_RESEARCH_CONNECTION", args={},
     amb={"targetRef": "Dune Grass Holds Sand"}, req=["targetRef", "contextPhrase"],
     diff="hard", tags=["intent-unclear"], conf=["knowledge-note:ADD_LINK"],
     why="The connection can live on the claim or as a link on the open note; both are acceptable.")
item(id="rt-pn-12", cat="pointer-plus-name", style="paraphrase", wording="plain", d="cs", open="obs",
     gold="obs", res="ask-two", via="pointer-plus-name", intentClear=True,
     u="Escalate this into Tempo vs Diction.",
     op="observation:PROMOTE_OBSERVATION", args={"promotedTo": "Tempo vs Diction"},
     match={"promotedTo": "ci"}, diff="hard", tags=["intent-open", "exact-copy"],
     conf=["tension:ADD_INVOLVED_REF"],
     why="Promotion changes the observation; the tension only receives it.")
item(id="rt-pn-13", cat="pointer-plus-name", style="paraphrase", wording="messy", d="cs", open="ten",
     gold="ten", res="ask-two", via="pointer-plus-name", intentClear=True,
     u="Altos Rush the Bridge feeds into this one too",
     op="tension:ADD_INVOLVED_REF", args={"ref": "Altos Rush the Bridge"}, match={"ref": "ci"},
     diff="hard", tags=["intent-open", "exact-copy"], conf=["observation:PROMOTE_OBSERVATION"],
     why="The open tension gains an involved item; nothing is said about the observation's status.")
item(id="rt-pn-14", cat="pointer-plus-name", style="paraphrase", wording="plain", d="ds", open="rle",
     gold="rle", res="ask-two", via="pointer-plus-name", intentClear=True,
     u="This builds on Consensus.",
     op="knowledge-note:ADD_LINK", args={"linkType": "BUILDS_ON"}, ref={"targetDocumentId": "cons"},
     amb={"targetTitle": "Consensus"}, diff="hard", tags=["intent-open", "ref-id", "enum"],
     conf=["moc:ADD_CORE_IDEA"],
     why="A typed relation from the open note; a MOC entry would be 'add this to Consensus'.")
item(id="rt-pn-15", cat="pointer-plus-name", style="paraphrase", wording="plain", d="ds", open="lww",
     gold="ten", res="ask-two", via="pointer-plus-name", intentClear=False,
     alt=[("lww", "knowledge-note:ADD_LINK", {"targetDocumentId": "ten"}, {"linkType": "RELATES_TO"})],
     u="this and Strong Consistency vs Offline Edits are the same problem",
     op="tension:ADD_INVOLVED_REF", args={}, amb={"ref": "Last Writer Wins Loses Updates"},
     req=["ref"], diff="hard", tags=["intent-unclear"], conf=["knowledge-note:ADD_LINK"],
     why="Either the tension gains the note or the note links to the tension; both are acceptable.")

# ---- several names: Q1 keeps the open document
item(id="rt-mn-01", cat="several-names", style="paraphrase", wording="plain", d="ds", open="vc",
     gold="vc", res="keep", via="several-names",
     u="This builds on Raft Leader Election more than on Gossip Protocols Converge Slowly.",
     op="knowledge-note:ADD_LINK", args={"linkType": "BUILDS_ON"}, ref={"targetDocumentId": "rle"},
     amb={"targetTitle": "Raft Leader Election"}, diff="hard", tags=["ref-id", "enum", "contrast"],
     conf=["knowledge-note:UPDATE_LINK_TYPE"], why="Only the first named note is linked.")
item(id="rt-mn-02", cat="several-names", style="natural", wording="messy", d="ds", open="proj",
     gold="crdts", res="keep", via="several-names",
     u="core ideas for CRDTs - Last Writer Wins Loses Updates belongs there",
     op="moc:ADD_CORE_IDEA", args={"noteRef": "Last Writer Wins Loses Updates"},
     amb={"sortOrder": 2}, match={"noteRef": "ci"}, req=["noteRef", "contextPhrase", "sortOrder"],
     diff="hard", tags=["q1-mistarget", "exact-copy"], conf=["project:ADD_KNOWLEDGE_REF"],
     why="Q1 keeps the open project, which has no matching op; the MOC is meant.")
item(id="rt-mn-03", cat="several-names", style="natural", wording="plain", d="fl", open="plan",
     gold="koji", res="keep", via="several-names",
     u="Koji Needs High Humidity should link to Brine Temperature Log Format",
     op="knowledge-note:ADD_LINK", args={}, ref={"targetDocumentId": "brine"},
     amb={"linkType": "RELATES_TO", "targetTitle": "Brine Temperature Log Format"},
     req=["linkType"], diff="hard", tags=["q1-mistarget", "ref-id"], conf=["moc:ADD_CORE_IDEA"],
     why="Q1 keeps the open plan; the subject note is meant.")
item(id="rt-mn-04", cat="several-names", style="paraphrase", wording="plain", d="uc", open="induced",
     gold="induced", res="keep", via="several-names",
     alt=[("lanes", "research-claim:ADD_RESEARCH_CONNECTION", {}, {"targetRef": "Induced Demand"})],
     u="Mark Protected Lanes Raise Ridership as contradicting this, not Helmet Laws Reduce Cycling.",
     op="knowledge-note:ADD_LINK", args={"linkType": "CONTRADICTS"}, ref={"targetDocumentId": "lanes"},
     amb={"targetTitle": "Protected Lanes Raise Ridership"}, diff="hard",
     tags=["ref-id", "enum", "contrast", "pointer"], conf=["research-claim:ADD_RESEARCH_CONNECTION"],
     why="Grammatically the claim is the subject, but the pointer and Q1 both land on the open note.")
item(id="rt-mn-05", cat="several-names", style="paraphrase", wording="messy", d="ce", open="shore",
     gold="shore", res="keep", via="several-names",
     u="Dune Grass Holds Sand goes in here next to Seawalls Accelerate Beach Loss",
     op="moc:ADD_CORE_IDEA", args={"noteRef": "Dune Grass Holds Sand"}, amb={"sortOrder": 1},
     match={"noteRef": "ci"}, req=["noteRef", "contextPhrase", "sortOrder"], diff="hard",
     tags=["pointer", "exact-copy"], conf=["moc:REORDER_CORE_IDEAS"],
     why="'next to' gives a position for a new entry; nothing existing moves.")

# ---- two documents sharing a name: Q1 keeps the open document
item(id="rt-sn-01", cat="shared-name", style="natural", wording="plain", d="cs", open="breath",
     gold=None, among=["rep1", "rep2"], ctx="rep1", res="keep", via="shared-name",
     u="Add the topic sight reading to Repertoire Notes",
     op="knowledge-note:ADD_TOPIC", args={"name": "sight reading"}, match={"name": "ci"},
     diff="hard", tags=["q1-mistarget", "duplicate-title"], conf=["knowledge-note:SET_METADATA_LIST_FIELD"],
     why="Two notes are titled 'Repertoire Notes'; neither can be picked, and Q1 keeps the open note. "
         "The op and args are the same on either note.")
item(id="rt-sn-02", cat="shared-name", style="natural", wording="plain", d="ce", open="proj",
     gold="fmmoc", res="keep", via="shared-name",
     u="Field Methods needs an open question: how often do we re-stake the transects?",
     op="moc:ADD_OPEN_QUESTION", args={"question": "How often do we re-stake the transects?"},
     match={"question": "fuzzy"}, diff="hard", tags=["q1-mistarget", "duplicate-title"],
     conf=["project:UPDATE_PROJECT_INFO"],
     why="A note and a MOC share the title; only the MOC has open questions.")
item(id="rt-sn-03", cat="shared-name", style="paraphrase", wording="plain", d="ce", open="fmkn",
     gold="fmkn", res="keep", via="shared-name",
     u="Field Methods reads like a how-to, so make its kind procedure.",
     op="knowledge-note:SET_NOTE_TYPE", args={"noteType": "procedure"}, diff="hard",
     tags=["duplicate-title", "open-title-mentioned", "enum"], conf=["knowledge-note:SET_DESCRIPTION"],
     why="The named title is the open note's own; the same-named MOC has no note type.")
item(id="rt-sn-04", cat="shared-name", style="paraphrase", wording="plain", d="cs", open="rep1",
     gold="rep1", res="keep", via="shared-name",
     u="This supersedes the other Repertoire Notes.",
     op="knowledge-note:ADD_LINK", args={"linkType": "SUPERSEDES"}, ref={"targetDocumentId": "rep2"},
     amb={"targetTitle": "Repertoire Notes"}, diff="hard",
     tags=["duplicate-title", "open-title-mentioned", "ref-id", "enum"],
     conf=["knowledge-note:ARCHIVE_NOTE"],
     why="'the other' picks the same-named note that is not open as the link target.")

# ---- non-verbatim mention: ask with the top 3
item(id="rt-nm-01", cat="near-miss", style="natural", wording="messy", d="ds", open="vc", gold="crdts",
     res="ask-top3", via="near-miss", u="throw this in the CRDT moc",
     op="moc:ADD_CORE_IDEA", args={}, amb={"noteRef": "Vector Clocks Order Causality", "sortOrder": 2},
     req=["noteRef", "contextPhrase", "sortOrder"], diff="hard", tags=["intent-named"],
     conf=["knowledge-note:ADD_TOPIC"], why="'CRDT MOC' is not the title 'CRDTs'.")
item(id="rt-nm-02", cat="near-miss", style="paraphrase", wording="messy", d="fl", open="proj",
     gold="koji", res="ask-top3", via="near-miss", u="the koji humidity one is a pattern, not a concept",
     op="knowledge-note:SET_NOTE_TYPE", args={"noteType": "pattern"}, diff="medium",
     tags=["enum"], notes="'Koji and Molds' is a plausible distractor in the top 3.")
item(id="rt-nm-03", cat="near-miss", style="natural", wording="plain", d="uc", open="counter",
     gold="obs", res="ask-top3", via="near-miss", u="the e-scooter observation is implemented now",
     op="observation:IMPLEMENT_OBSERVATION", args={}, diff="medium", tags=["no-args"])
item(id="rt-nm-04", cat="near-miss", style="natural", wording="messy", d="cs", open="warm",
     gold="splan", res="ask-top3", via="near-miss", u="add a goal to the spring plan: print the programs",
     op="wbs:CREATE_GOAL", args={"description": "Print the programs"}, match={"description": "fuzzy"},
     diff="medium", tags=["top-level"],
     notes="'Spring Concert 2027' and 'Winter Carols Plan' are distractors.")
item(id="rt-nm-05", cat="near-miss", style="natural", wording="plain", d="ce", open="seawall",
     gold="sed", res="ask-top3", via="near-miss",
     u="resolve the sediment tension: the missing volume went into the offshore bars",
     op="tension:RESOLVE_TENSION", args={"resolution": "The missing volume went into the offshore bars."},
     match={"resolution": "fuzzy"}, diff="medium", tags=[])
item(id="rt-nm-06", cat="near-miss", style="paraphrase", wording="plain", d="fl", open="lab",
     gold="veg", res="ask-top3", via="near-miss", u="This belongs in the veg ferments map.",
     op="moc:ADD_CORE_IDEA", args={},
     amb={"noteRef": "Lactic Acid Bacteria Prefer Low Oxygen", "sortOrder": 2},
     req=["noteRef", "contextPhrase", "sortOrder"], diff="hard", tags=["pointer", "intent-named"],
     conf=["knowledge-note:ADD_TOPIC"],
     why="A pointer plus a non-verbatim name gives the top-3 ask, not the two-way ask.")
item(id="rt-nm-07", cat="near-miss", style="paraphrase", wording="messy", d="uc", open="dock",
     gold="proj", res="ask-top3", via="near-miss", u="corridor study is done, wrap it up",
     op="project:SET_PROJECT_STATUS", args={"status": "COMPLETED"}, diff="medium",
     tags=["pointer", "enum"], notes="'Corridor Count Study Plan' is a distractor.")

# ---- nothing open (drive level)
item(id="rt-dl-01", cat="drive-level", style="paraphrase", wording="messy", d="ds", open=None,
     gold="lww", res="switch", via="drive-level-name",
     u="tag it with offline-first: Last Writer Wins Loses Updates",
     op="knowledge-note:ADD_TOPIC", args={"name": "offline-first"}, match={"name": "ci"},
     diff="medium", tags=["pointer-no-referent"])
item(id="rt-dl-02", cat="drive-level", style="natural", wording="plain", d="fl", open=None,
     gold="kojimoc", res="switch", via="drive-level-name",
     u="This one needs an open question. Koji and Molds: does rice koji tolerate 40°C?",
     op="moc:ADD_OPEN_QUESTION", args={"question": "Does rice koji tolerate 40°C?"},
     match={"question": "fuzzy"}, diff="medium", tags=["pointer-no-referent"])
item(id="rt-dl-03", cat="drive-level", style="paraphrase", wording="plain", d="uc", open=None,
     gold="proj", res="switch", via="drive-level-name",
     u="Corridor Count Study is wrapping up, mark it completed.",
     op="project:SET_PROJECT_STATUS", args={"status": "COMPLETED"}, diff="medium",
     tags=["pointer-no-referent", "enum", "prefix-title"],
     notes="'Corridor Count Study Plan' is longer and not mentioned.")
item(id="rt-dl-04", cat="drive-level", style="natural", wording="messy", d="cs", open=None,
     gold="ten", res="switch", via="drive-level-name",
     u="Tempo vs Diction - dissolve it, conductor thinks the two never actually clashed",
     op="tension:DISSOLVE_TENSION", args={"resolution": "The conductor thinks the two never actually clashed"},
     match={"resolution": "fuzzy"}, diff="medium", tags=["pointer-no-referent"])
item(id="rt-dl-05", cat="drive-level", style="natural", wording="messy", d="ce", open=None,
     gold="shore", res="ask-top3", via="near-miss",
     u="shoreline map needs a question abt storm frequency",
     op="moc:ADD_OPEN_QUESTION", args={}, amb={"question": "How often do storms hit?"},
     req=["question"], diff="medium", tags=["near-miss"])
item(id="rt-dl-06", cat="drive-level", style="natural", wording="plain", d="cs", open=None,
     gold="deriv", res="switch", via="drive-level-name",
     u="Vault Derivation gets a new signal: quote 'old notes just rot, I never go back', it bears on maintenance.",
     op="derivation:ADD_SIGNAL",
     args={"utterance": "old notes just rot, I never go back", "influencedDimensions": ["maintenance"]},
     amb={"interpretation": "Old notes are not revisited, so maintenance needs attention."},
     match={"utterance": "ci", "influencedDimensions": "ci"}, req=["interpretation"], diff="hard",
     tags=["exact-copy", "list"], conf=["derivation:UPDATE_DIMENSION_RATIONALE"],
     why="A new signal, not a rationale rewrite for the dimension.")

# ---- ordinal and deictic over visible results
item(id="rt-or-01", cat="ordinal", style="natural", wording="messy", d="ds", open="gossip", gold="rle",
     res="switch", via="ordinal", vis=("search", "raft", ["raft", "rle", "cons"]),
     u="approve the 2nd result", op="knowledge-note:APPROVE_NOTE", args={}, amb={"comment": None},
     diff="medium", tags=["ordinal"])
item(id="rt-or-02", cat="ordinal", style="paraphrase", wording="messy", d="fl", open="fermoc",
     gold="ten", res="switch", via="ordinal", vis=("search", "salt", ["ten", "salt", "claim"]),
     u="first one's settled — we standardised on 2% salt by weight",
     op="tension:RESOLVE_TENSION", args={"resolution": "We standardised on 2% salt by weight."},
     match={"resolution": "fuzzy"}, diff="hard", tags=["ordinal"], conf=["tension:DISSOLVE_TENSION"],
     why="A decision settled it, so it is resolved, not dissolved.")
item(id="rt-or-03", cat="ordinal", style="natural", wording="plain", d="uc", open="induced",
     gold="induced", res="keep", via="ordinal-ref", vis=("search", "cycling", ["lanes", "counter", "helmet"]),
     u="link this note to the third result",
     op="knowledge-note:ADD_LINK", args={}, ref={"targetDocumentId": "helmet"},
     amb={"linkType": "RELATES_TO", "targetTitle": "Helmet Laws Reduce Cycling"}, req=["linkType"],
     diff="hard", tags=["ordinal", "ref-id"], conf=["research-claim:ADD_RESEARCH_CONNECTION"],
     why="The ordinal picks the ref, not the target; the pointer keeps the open note.")
item(id="rt-or-04", cat="ordinal", style="natural", wording="messy", d="cs", open="rmoc", gold="rep2",
     res="switch", via="ordinal", vis=("graph-focus", None, ["warm", "breath", "rep2"]),
     u="archive the last one, we dropped that piece",
     op="knowledge-note:ARCHIVE_NOTE", args={"comment": "We dropped that piece"},
     match={"comment": "fuzzy"}, diff="medium", tags=["ordinal", "duplicate-title"],
     notes="The visible list fixes which of the two 'Repertoire Notes' is meant.")
item(id="rt-or-05", cat="ordinal", style="paraphrase", wording="plain", d="ce", open="shore", gold="shore",
     res="keep", via="ordinal-ref", vis=("search", "dune", ["dunes2", "dune", "sed"]),
     u="Put the top hit on this map.",
     op="moc:ADD_CORE_IDEA", args={"noteRef": "Dune Restoration Costs"}, amb={"sortOrder": 2},
     match={"noteRef": "ci"}, req=["noteRef", "contextPhrase", "sortOrder"], diff="hard",
     tags=["ordinal", "pointer"], conf=["moc:ADD_CHILD_MOC"],
     why="The ordinal names the entry; 'this map' keeps the open MOC.")
item(id="rt-or-06", cat="ordinal", style="natural", wording="messy", d="ds", open=None, gold="vc",
     res="switch", via="ordinal", vis=("search", "clocks", ["lww", "vc", "gossip"]),
     u="ok send the second result off for review",
     op="knowledge-note:SUBMIT_FOR_REVIEW", args={}, amb={"comment": None}, diff="medium",
     tags=["ordinal", "drive-level", "lifecycle"])
item(id="rt-or-07", cat="ordinal", style="natural", wording="plain", d="uc", open="counter", gold="obs",
     res="switch", via="ordinal", vis=("search", "scooter", ["obs", "ten", "lanes"]),
     u="Promote the first result into Ridership Counts vs Survey Answers.",
     op="observation:PROMOTE_OBSERVATION", args={"promotedTo": "Ridership Counts vs Survey Answers"},
     match={"promotedTo": "ci"}, diff="hard", tags=["ordinal", "verbatim-title", "exact-copy"],
     conf=["tension:ADD_INVOLVED_REF"],
     why="Ordinal resolution runs before the verbatim-title step; the named tension is the "
         "promotion target value.")

# ---------------------------------------------------------------- noAction / multiAction
NA = [
    dict(id="rt-na-01", style="natural", wording="plain", d="ds", open="vc", ruleRes="switch",
         u="what does CRDTs say about tombstones?", reason="A question about another document."),
    dict(id="rt-na-02", style="natural", wording="messy", d="fl", open="proj", ruleRes="keep",
         u="which notes are hooked up to this project rn?", reason="A question about the open project."),
    dict(id="rt-na-03", style="paraphrase", wording="plain", d="cs", open=None, ruleRes="switch",
         u="Is Spring Concert Plan behind schedule?", reason="A status question at drive level."),
    dict(id="rt-na-04", style="paraphrase", wording="plain", d="uc", open="helmet", ruleRes="ask-two",
         u="How is this different from Protected Lanes Raise Ridership?",
         reason="A comparison question. The pointer-plus-name rule would still ask before the models "
                "run; that ask is pure cost."),
    dict(id="rt-na-05", style="natural", wording="messy", d="ce", open="shore", ruleRes="keep",
         vis=("search", "dune", ["dunes2", "dune", "sed"]),
         u="open the second result", reason="Navigation, not a document change."),
    dict(id="rt-na-06", style="paraphrase", wording="messy", d="ds", open="lww", ruleRes="keep",
         u="thx thats right", reason="An acknowledgement."),
]

MA = [
    dict(id="rt-ma-01", style="paraphrase", wording="plain", d="cs", open="spring", gold="spring",
         res="keep", via="several-names",
         u="Breathing Exercises and Warmups Before Sectionals both belong on this project.",
         steps=[("project:ADD_KNOWLEDGE_REF", "breath"), ("project:ADD_KNOWLEDGE_REF", "warm")],
         notes="Two names plus a pointer: Q1 keeps the open project, which is right here. "
               "Order does not matter."),
]

# ---------------------------------------------------------------- assembly
REF_KIND = {  # op field -> which drive docs are candidates
    "knowledge-note:ADD_LINK:targetDocumentId": "any",
    "project:ADD_KNOWLEDGE_REF:ref": "knowledge",
    "project:LINK_WBS:wbsRef": "bai/wbs",
    "wbs:SET_PROJECT_REF:projectRef": "bai/project",
}
KNOWLEDGE_TYPES = {"bai/knowledge-note", "bai/moc", "bai/research-claim", "bai/tension",
                   "bai/observation", "bai/source"}


def rotate(lst, gold_id, pos):
    rest = [c for c in lst if c["id"] != gold_id]
    gold = [c for c in lst if c["id"] == gold_id]
    pos = min(pos, len(rest))
    return rest[:pos] + gold + rest[pos:]


def doc_brief(doc):
    return {"id": doc["id"], "title": doc["title"], "docType": doc["docType"]}


def frame_for(spec):
    dr = DRIVES[spec["d"]]
    docs = dr["docs"]
    open_key = spec.get("open")
    if open_key:
        od = docs[open_key]
        target = {"kind": "document", "id": od["id"], "driveId": dr["id"], "title": od["title"],
                  "docType": od["docType"]}
    else:
        target = {"kind": "drive", "id": dr["id"], "name": dr["name"]}
    others = [doc_brief(d) for k, d in docs.items() if k != open_key]
    # deterministic shuffle so list order carries no signal
    others.sort(key=lambda c: hashlib.sha256((spec["id"] + c["id"]).encode()).hexdigest())
    fr = {"drive": {"id": dr["id"], "name": dr["name"]}, "target": target, "documents": others}
    if spec.get("vis"):
        src, q, keys = spec["vis"]
        fr["visibleResults"] = {"source": src, "query": q,
                                "items": [doc_brief(docs[k]) for k in keys]}
    return fr


def ref_candidates(spec, gold_doc, op, field, n):
    dr = DRIVES[spec["d"]]
    docs = dr["docs"]
    kind = REF_KIND[f"{op}:{field}"]
    pool = []
    for k, d in docs.items():
        if d["id"] == gold_doc["id"]:
            continue
        if kind == "any" and d["docType"] in KNOWLEDGE_TYPES:
            pool.append(d)
        elif kind == "knowledge" and d["docType"] in KNOWLEDGE_TYPES:
            pool.append(d)
        elif kind == d["docType"]:
            pool.append(d)
    pool.sort(key=lambda d: hashlib.sha256((spec["id"] + d["id"]).encode()).hexdigest())
    return [{"id": d["id"], "label": d["title"]} for d in pool[:10]]


def build_item(spec, n):
    dr = DRIVES[spec["d"]]
    docs = dr["docs"]
    ctx_key = spec.get("ctx") or spec["gold"]
    cdoc = docs[ctx_key]
    state = json.loads(json.dumps(cdoc["state"]))
    op = spec["op"]
    model = op.split(":")[0]
    assert model == cdoc["model"], (spec["id"], model, cdoc["model"])
    ref_args, cands = {}, []
    for field, v in (spec.get("ref") or {}).items():
        if isinstance(v, tuple) and v[0] == "goal":
            gid = oid(spec["d"], v[1])
            ref_args[field] = gid
            cands = [{"id": g["id"], "label": g["description"]} for g in state["goals"]]
        elif isinstance(v, tuple) and v[0] == "core":
            cands = [{"id": c["id"], "label": c["noteRef"]} for c in state["coreIdeas"]]
            ref_args[field] = next(c["id"] for c in state["coreIdeas"] if c["noteRef"] == v[1])
        elif isinstance(v, tuple) and v[0] == "task":
            cands = [{"id": t["id"], "label": f'{t["taskType"]}: {t["target"]}'} for t in state["tasks"]]
            ref_args[field] = oid(spec["d"], v[1])
        else:
            ref_args[field] = docs[v]["id"]
            cands = ref_candidates(spec, cdoc, op, field, n)
        # place the gold candidate: first in about one item in seven, otherwise further down
        h = int(hashlib.sha256(spec["id"].encode()).hexdigest(), 16)
        pos = 0 if h % 7 == 0 else 1 + (h // 7) % max(1, len(cands) - 1)
        cands = rotate(cands, ref_args[field], pos)
    gold_key = spec["gold"]
    tgt = {"resolution": spec["res"], "via": spec["via"]}
    if gold_key:
        g = docs[gold_key]
        tgt.update({"documentId": g["id"], "title": g["title"], "docType": g["docType"]})
    else:
        tgt.update({"documentId": None, "intendedAmong": [docs[k]["id"] for k in spec["among"]]})
    open_key = spec.get("open")
    if spec["res"] == "keep" and open_key:
        tgt["ruleDocumentId"] = docs[open_key]["id"]
        tgt["q1Mistarget"] = (gold_key != open_key)
    elif spec["res"] == "switch":
        tgt["ruleDocumentId"] = docs[gold_key]["id"]
        tgt["q1Mistarget"] = False
    else:
        tgt["q1Mistarget"] = False
    if spec["res"] == "ask-two":
        named = gold_key if gold_key != open_key else None
        if named is None:
            # the named document is the other one in the utterance
            named = next(k for k, d in docs.items() if k != open_key and d["title"] in spec["u"])
        tgt["options"] = [docs[open_key]["id"], docs[named]["id"]]
        tgt["intentClear"] = spec["intentClear"]
        tgt["intentChanges"] = "open" if gold_key == open_key else "named"
    if spec["res"] == "ask-top3":
        tgt["mustInclude"] = [docs[gold_key]["id"]]
    if spec.get("alt"):
        tgt["acceptable"] = []
        for k, aop, aref, aamb in spec["alt"]:
            tgt["acceptable"].append({"documentId": docs[k]["id"], "op": aop, "ambiguousArgs": aamb,
                                      "refArgs": {f: docs[v]["id"] for f, v in aref.items()}})
    expected = {"target": tgt, "op": op, "args": spec.get("args", {}),
                "ambiguousArgs": spec.get("amb", {}), "refArgs": ref_args,
                "argMatch": spec.get("match", {}), "requiredPresent": spec.get("req", [])}
    out = {"id": spec["id"], "category": spec["cat"], "style": spec["style"],
           "wording": spec["wording"], "utterance": spec["u"],
           "context": {"docType": cdoc["docType"], "model": cdoc["model"], "title": cdoc["title"],
                       "documentId": cdoc["id"], "state": state, "refCandidates": cands,
                       "frame": frame_for(spec)},
           "expected": expected, "difficulty": spec["diff"], "tags": spec.get("tags", [])}
    if spec.get("conf"):
        out["hardCase"] = {"confusableWith": spec["conf"], "why": spec.get("why", "")}
    out["notes"] = spec.get("notes", "")
    return out


def build_na(spec):
    docs = DRIVES[spec["d"]]["docs"]
    ok = spec.get("open")
    ctx = {"frame": frame_for(spec)}
    if ok:
        d = docs[ok]
        ctx.update({"docType": d["docType"], "model": d["model"], "title": d["title"],
                    "documentId": d["id"], "state": d["state"]})
    else:
        ctx.update({"docType": None, "model": None})
    return {"id": spec["id"], "style": spec["style"], "wording": spec["wording"],
            "utterance": spec["u"], "context": ctx, "ruleResolution": spec["ruleRes"],
            "reason": spec["reason"]}


def build_ma(spec):
    docs = DRIVES[spec["d"]]["docs"]
    g = docs[spec["gold"]]
    steps = []
    for op, refk in spec["steps"]:
        steps.append({"op": op, "args": {}, "ambiguousArgs": {}, "refArgs": {"ref": docs[refk]["id"]},
                      "argMatch": {}, "requiredPresent": []})
    cands = ref_candidates(spec, g, "project:ADD_KNOWLEDGE_REF", "ref", 0)
    return {"id": spec["id"], "style": spec["style"], "wording": spec["wording"],
            "utterance": spec["u"],
            "context": {"docType": g["docType"], "model": g["model"], "title": g["title"],
                        "documentId": g["id"], "state": g["state"], "refCandidates": cands,
                        "frame": frame_for(spec)},
            "target": {"resolution": spec["res"], "via": spec["via"], "documentId": g["id"],
                       "title": g["title"], "docType": g["docType"],
                       "ruleDocumentId": g["id"], "q1Mistarget": False},
            "expected": steps, "orderSensitive": False, "notes": spec["notes"]}


CONVENTIONS = {
    "today": TODAY,
    "scoped": True,
    "opKey": "<model>:<OP>; the work-breakdown-structure model is 'wbs'.",
    "appFilled": "new-id, DateTime and actor (actor, *By) fields never appear in args.",
    "refArgs": "Ref-id fields (OID/PHID and *Id names) only; values are ids from context.refCandidates.",
    "semanticRefs": "String refs (noteRef, childRef, targetRef, ref on tension, promotedTo, claimRef) "
                    "are args when the user typed the title, ambiguousArgs when they pointed ('this').",
    "ambiguousArgs": "Fair values a model may fill; not scored for equality. A null value means the field "
                     "may be omitted or filled with anything.",
    "requiredPresent": "Fields that must be present with any value.",
    "argMatch": "Per-field comparison: exact (default), ci (case-insensitive), fuzzy (free text, judged on "
                "meaning), date (same calendar day). Lists in args compare in order unless argMatch says ci, "
                "which compares as a case-insensitive set.",
    "context": "context.{docType, model, title, documentId, state, refCandidates} describe the gold target "
               "document after target resolution: the document the models run on. For rt-sn-01, whose "
               "target cannot be known, it is the first of the two same-named notes.",
    "frame": {
        "drive": "{id, name}",
        "target": "The tag: {kind:'document', id, driveId, title, docType} with a document open, or "
                  "{kind:'drive', id, name} with none open.",
        "documents": "The other documents in the drive: [{id, title, docType}], in no meaningful order.",
        "visibleResults": "Optional: {source: 'search'|'graph-focus', query, items:[{id, title, docType}]} "
                          "in display order, for ordinal and deictic items.",
    },
    "target": {
        "resolution": "What the overview's Q1 rule does before the models run: keep (act on the open "
                      "document), switch (act on another document without asking), ask-two (ask 'change "
                      "open or named'), ask-top3 (ask with a top-3 picker).",
        "via": "verbatim | pointer-plus-name | several-names | shared-name | near-miss | drive-level-name | "
               "ordinal (the ordinal picks the target) | ordinal-ref (the ordinal picks a ref; the target "
               "stays) | none.",
        "documentId": "The document the user means to change: the gold for the card and for Confirm, after "
                      "any ask is answered as the user intends. null when no answer can be known "
                      "(intendedAmong lists the candidates).",
        "ruleDocumentId": "For keep and switch: the document Q1 acts on.",
        "q1Mistarget": "true when Q1 keeps or switches to a document other than documentId.",
        "options": "ask-two only: [open document id, named document id].",
        "intentChanges": "ask-two only: 'open' or 'named', which option the intent picks.",
        "intentClear": "ask-two only: false when either answer is a fair reading.",
        "acceptable": "Other {documentId, op, refArgs} answers scored as correct (unclear-intent items).",
        "mustInclude": "ask-top3 only: ids that must be among the three options. The ranking is not "
                       "prescribed.",
    },
    "style": "natural | paraphrase (paraphrase items avoid the op name's own words), 50/50.",
    "wording": "plain | messy (lower case, shorthand, dashes, missing punctuation, filler).",
}


def main():
    out_path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(EVAL_DIR, "retarget-dev.json")
    items = [build_item(s, i) for i, s in enumerate(I)]
    data = {
        "name": "retarget-dev",
        "description": "M0 retarget and deictic dev set for the knowledge-vault chat. Each item carries a "
                       "context frame and scores the target resolution, the target document and the op.",
        "conventions": CONVENTIONS,
        "items": items,
        "noAction": [build_na(s) for s in NA],
        "multiAction": [build_ma(s) for s in MA],
    }
    with open(out_path, "w") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write("\n")
    print(f"wrote {len(items)} items, {len(NA)} noAction, {len(MA)} multiAction")


if __name__ == "__main__":
    main()
