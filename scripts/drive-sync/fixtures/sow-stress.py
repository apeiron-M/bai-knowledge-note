#!/usr/bin/env python3
"""sow-stress.py — a large, plausible scope of work for UI stress testing.

Creates ONE powerhouse/scopeofwork document plus the bai/wbs documents its
envelopes link to, populated far beyond a normal plan so every editor surface
meets its defaults: long and empty titles, unassigned owners, unfunded and
unscheduled deliverables, all seven deliverable statuses, four currencies,
fixed and derived budgets, an overspent envelope, a roadmap with twelve
milestones and one with none, goal trees from nine to a few hundred goals.

Deterministic (seeded), so a re-run produces the same plan. Writes through the
same handlers upload.py uses, so the create-vs-link and progress-vs-status
traps stay encoded in one place. Targets PH_GRAPHQL_ENDPOINT (default local).

    PH_GRAPHQL_ENDPOINT=http://localhost:4001/graphql \
    python3 scripts/drive-sync/fixtures/sow-stress.py --drive <uuid> --folder <projects-folder-uuid>
"""
import argparse, datetime, json, os, random, sys, tempfile, uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from lib import gql                       # noqa: E402
from lib.id_map import IdMap              # noqa: E402
from handlers import scope_of_work, wbs as wbs_h  # noqa: E402

TODAY = datetime.date(2026, 9, 8)
rng = random.Random(2027)
uid = lambda: str(uuid.uuid4())  # noqa: E731
CHUNK = 60


def chunked(doc_id, actions, label):
    for i in range(0, len(actions), CHUNK):
        gql.mutate_document(doc_id, actions[i:i + CHUNK])
    print(f"  {label}: {len(actions)} actions in {-(-len(actions) // CHUNK)} call(s)")


# ── people ─────────────────────────────────────────────────────────────────
AGENTS = [
    ("Frank", "Reactor core, storage backends"), ("liberuum", "Vault, indexer, demos"),
    ("Teep", "Authorization and identity"), ("Apeiron", "Connect and editors"),
    ("Fable 5.1", "Research spikes, synthesis"), ("Wouter", "Deployments and observability"),
    ("Callum", "Go-to-market and partners"), ("Nuno", "Sync and swarm"),
    ("Ruben", "Design system"), ("Prometheus", "Knowledge agent"),
    ("Sky Ops", "Shared operations rota"), ("Ars Contexta bot", None),
]
agents = [{"id": uid(), "name": n, "description": d, "icon": None} for n, d in AGENTS]
A = {a["name"]: a["id"] for a in agents}

# ── envelopes ──────────────────────────────────────────────────────────────
LONG_TITLE = ("Connect and editor experience across the vault, scope-of-work and "
              "work-breakdown apps, including the collapsible outline rail, inspector "
              "layouts and copyable identifiers")
LONG_ABSTRACT = ("Everything below the document API: the operation store, the write cache, "
                 "stream ordering guarantees and the storage backends we still run in parallel. "
                 "This envelope pays for the work that every other envelope silently depends on, "
                 "which is why its budget is fixed rather than derived — the quotes underneath it "
                 "are always incomplete.")
ENVELOPES = [
    # code, title, type, currency, fixed budget, owner, abstract, wbs profile, refs, krefs, expenditure
    ("CORE", "Reactor core, storage and the write cache", "OPEX", "USD", 180000, "Frank", LONG_ABSTRACT, "deep", 3, 4, (61000, 0)),
    ("SYNC", "Sync, channels and swarm replication", "OPEX", "USD", None, "Nuno",
     "Convergent replication across reactors: channel filters, envelope repair and the swarm feed.", "medium", 2, 2, None),
    ("AUTH", "Authorization, identity and signed operations", "CAPEX", "EUR", 95000, "Teep",
     "Two systems today — host permission tables and document auth scopes — and a plan to fold the first into the second. "
     "Fixed budget, twelve percent margin applied to every unpinned quote.", "stress", 4, 3, None),
    ("UX", LONG_TITLE, "OPEX", "USD", None, None, "", None, 0, 0, None),
    ("DATA", "Knowledge vault, graph indexer and semantic search", "OPEX", "USDS", None, "liberuum",
     "The read model behind the vault app: nodes, edges, embeddings, and the subgraph that serves them.", "shallow", 1, 5, None),
    ("OPS", "Deployments, observability and release engineering", "OVERHEAD", "DAI", 40000, "Wouter",
     "Switchboard fleets, Connect deploys, telemetry.", None, 2, 0, (52000, 40000)),
    ("GTM", "Go-to-market: partner demos, outreach and materials", "OPEX", "USD", None, "Callum",
     "Companion-software demos on partner stacks, and the materials that follow each one.", "flat", 3, 2, (12000, 0)),
    ("RND", "Research spikes and experiments", "CONTINGENCY", "EUR", None, "Fable 5.1", "Time-boxed spikes. Nothing here is scheduled.", None, 0, 1, None),
]
DELIVERABLES = {
    "CORE": ["Write cache rebuild reuses the stored hash", "Stream-order pre-flight for the auth scope",
             "Snapshot ordering by revision, not insertion", "PGlite in-memory mode for local vetra",
             "Storage backend selection: pglite-fs vs postgres", "Operation store compaction job",
             "Dead-letter queue inspector", "Sync envelope split fix, phase 2", "Reactor 6.3 API freeze notes",
             "Cutover rehearsal on a production snapshot", "Replay benchmark harness", "Queue bench: cost per job",
             "Event bus sync/async ratio bench", "Attachment read model ordinal-gap repair",
             "Document meta cache retirement", "Revision sweep operator entry point",
             "Kysely write cache: stored-hash reuse", "Job executor worker isolation",
             "Reactor ⇄ Switchboard handshake (v2) — «edge case» coverage",
             "Bench records viewer", "Integrity service strict mode", "GA release checklist"],
    "SYNC": ["Channel filter sentinel for remote-first drives", "Live change feed with liveness TTL",
             "Debounce ceiling under a write firehose", "Swarm feed owner-only writes", "Envelope repair tooling",
             "Per-poll subject on replication channels", "Forced channel per opened document (lazy sync)",
             "Sync health monitor recipe", "Convergence timing bench", "Cross-reactor contention isolation",
             "Dead-letter recovery: repair-file mode for upload.py", "Split-envelope regression suite",
             "Replication channel id vs identity", "Sync serving gate on the policy", "Hypercore transport spike",
             "Backpressure throttle on bulk import"],
    "AUTH": ["RESOLVE_CALLER_IDENTITY on the hosted Switchboard", "REQUIRE_AUTHENTICATED_CALLER rollout plan",
             "assertCanRead in the knowledgeGraph resolvers", "Admin-only reindex and debug endpoints",
             "Authorization header on every vault fetch", "CORS allow-headers: authorization",
             "Signer-backed reviewer identity in the lifecycle reducer", "INITIALIZE_AUTH on pipeline-created notes",
             "Reviewer roster as a group principal", "Creator carve-out audit for CLI-signed documents",
             "Read-model owner column and processor auth-scope filter", "useCanExecute in the note editor",
             "evaluateActions preflight in the SoW editor", "Signature verifier injection on the fleet",
             "Renown credential expiry warnings", "Group roster document for the vault team",
             "Auth policy version 1 caps documented", "Retention check benchmark (T-001) closed",
             "authGroups flag flip rehearsal", "authConditions: where-clause on APPROVE_NOTE",
             "Migration of host permission tables into grants", "Retire ADMIN_ONLY for the vault fleet",
             "Audit log of refused operations", "Security review with an external party"],
    "UX": ["Collapsible outline rail", "Inspector layout preference: modal or sidebar", "Copyable ids in every eyebrow",
           "Goal details as a modal", "Dependencies picker with search", "Owner column in the deliverable table",
           "Roadmaps view", "Overview roadmaps summary", "Graph view semantic layout", "Note list virtualisation",
           "Chat citations deep-link into scopes", "Bring-your-own-model endpoint picker",
           "Health dashboard redesign", "Keyboard navigation audit"],
    "DATA": ["Server-side embeddings in the indexer", "Hybrid search rescaled to 0–1", "Tension auto-creation on CONTRADICTS",
             "Scope and WBS outline indexing", "Edge metadata: reason and confidence", "Drive membership gate",
             "Reindex mutation hardening", "Missing-embeddings sweep", "Topic vocabulary cleanup",
             "Orphan detection honesty pass", "Snapshot and restore pipeline", "Semantic neighbour quality bench"],
    "OPS": ["Switchboard fleet upgrade to 6.2.2-dev.82", "Stop serving stale Connect builds after deploy",
            "OpenTelemetry traces for reactor jobs", "Pyroscope profiling on the hosted fleet",
            "Backup rotation for PGlite volumes", "Release gating on the test suite", "Registry publish workflow",
            "Sentry alert routing", "Cost report per environment", "On-call runbook"],
    "GTM": ["Paperless billing demo", "UMH factory demo", "Odoo companion demo", "Demo runbook and fidelity table",
            "Presentation deck and narration script", "YouTube recordings", "Blog and LinkedIn posts",
            "Enterprise landing page", "Integration partner outreach"],
    "RND": ["Attribute-based access control spike", "x402 usage-revenue experiment", "Hypercore replication spike"],
}
# a few deliberately awkward titles
DELIVERABLES["CORE"][2] = ("Snapshot ordering by revision rather than insertion so that a document loaded from a "
                           "backup carries the same head every replica computed, even when two operations share a "
                           "millisecond and the tiebreak has to be the revision itself and never the row id")
DELIVERABLES["UX"][8] = ""  # untitled deliverable

STATUS_MIX = ["DELIVERED"] * 7 + ["IN_PROGRESS"] * 5 + ["TODO"] * 4 + ["BLOCKED"] * 2 + ["DRAFT"] + ["CANCELED"] + ["WONT_DO"]


def kr(title, link=None):
    return {"id": uid(), "title": title, "link": link}


def progress_for(status, unit):
    if status == "DELIVERED":
        return rng.choice([{"done": True}, {"value": 100}, {"total": 21, "completed": 21}])
    if status in ("IN_PROGRESS", "BLOCKED"):
        if unit == "StoryPoints":
            t = rng.choice([8, 13, 21, 34]); return {"total": t, "completed": rng.randint(1, t - 1)}
        return {"value": rng.choice([10, 25, 40, 55, 70, 85])}
    return {}  # never write progress on unstarted or closed work


# ── build the envelopes and their deliverables ─────────────────────────────
projects, deliverables, wbs_docs = [], [], {}
for code, title, btype, cur, fixed, owner, abstract, profile, nrefs, nkrefs, exp in ENVELOPES:
    pid = uid()
    ds = []
    for i, dtitle in enumerate(DELIVERABLES[code]):
        status = rng.choice(STATUS_MIX)
        unit = rng.choice(["Hours", "Hours", "StoryPoints"])
        pinned = rng.random() < 0.5
        d = {
            "id": uid(), "code": "" if (code == "SYNC" and i == 5) else f"{code}-{i + 1:02d}",
            "title": dtitle, "owner": rng.choice([None, owner, owner, rng.choice(list(A.values()))]) if owner else rng.choice([None, rng.choice(list(A.values()))]),
            "description": "" if i % 4 == 3 else f"{dtitle}. Acceptance: reviewed, shipped behind a flag, and documented in the runbook.",
            "status": status, "keyResults": [], "goalRef": None,
            "workProgress": progress_for(status, unit),
            "budgetAnchor": {"project": pid, "unit": unit,
                             "unitCost": rng.choice([90, 110, 140, 160]) if unit == "Hours" else rng.choice([120, 150, 180]),
                             "quantity": rng.choice([8, 16, 24, 40, 80, 120]) if unit == "Hours" else rng.choice([3, 5, 8, 13, 21, 40]),
                             "margin": rng.choice([0, 10, 15, 20, 35]), "marginPinned": pinned},
        }
        if d["owner"] and d["owner"] not in A.values(): d["owner"] = A[d["owner"]]
        if status == "DELIVERED":
            d["keyResults"] = [kr("Shipped", f"https://github.com/powerhouse-inc/powerhouse/pull/{2900 + rng.randint(1, 99)}")] + \
                              ([kr("Release notes", "https://github.com/powerhouse-inc/powerhouse/releases")] if rng.random() < 0.4 else [])
        elif status == "IN_PROGRESS" and rng.random() < 0.3:
            d["keyResults"] = [kr("Draft PR")]
        ds.append(d)
    deliverables += ds
    ids = [d["id"] for d in ds]
    done = sum(1 for d in ds if d["status"] == "DELIVERED")
    live = [d["status"] for d in ds]
    set_status = ("FINISHED" if done == len(ds) else "IN_PROGRESS" if "IN_PROGRESS" in live or "BLOCKED" in live
                  else "TODO" if "TODO" in live else "DRAFT")
    p = {
        "id": pid, "code": code, "title": title, "slug": f"{code.lower()}-{title.split()[0].lower().strip(',:')}",
        "projectOwner": A[owner] if owner else None, "abstract": abstract, "imageUrl": None,
        "budgetType": btype, "currency": cur, "budget": fixed,
        "scope": {"deliverables": ids, "status": set_status, "deliverablesCompleted": {"total": len(ids), "completed": done}},
        "expenditure": {"actuals": exp[0], "cap": exp[1]} if exp else None,
        "references": ["https://github.com/powerhouse-inc/powerhouse", "https://academy.powerhouse.inc",
                       "https://github.com/powerhouse-inc/recipes", "https://github.com/liberuum/powerhouse-knowledge"][:nrefs],
        "wbsRef": None, "knowledgeRefs": [], "_nkrefs": nkrefs, "_profile": profile,
    }
    projects.append(p)

# four unfunded deliverables: no payer, in no envelope scope
for t in ["Cross-cutting: API deprecation sweep", "Cross-cutting: accessibility audit",
          "Cross-cutting: licence and notice review", "Cross-cutting: dependency upgrade train"]:
    deliverables.append({"id": uid(), "code": "", "title": t, "owner": None, "description": "",
                         "status": rng.choice(["TODO", "DRAFT", "IN_PROGRESS"]), "keyResults": [], "goalRef": None,
                         "workProgress": {}, "budgetAnchor": {}})
for d in deliverables:
    if not d["budgetAnchor"] and d["status"] == "IN_PROGRESS": d["workProgress"] = {"value": 30}

# ── roadmaps and milestones ────────────────────────────────────────────────
def ms(seq, title, target, desc=""):
    return {"id": uid(), "sequenceCode": seq, "title": title, "deliveryTarget": target, "description": desc,
            "coordinators": rng.sample(list(A.values()), rng.choice([0, 1, 1, 2, 3])), "scope": {"deliverables": []}}

ROADMAPS = [
    ("Platform 2027 — first half", "platform-2027-h1", "Reactor 6.3: freeze, storage decision, cutover, GA.", [
        ms("M1", "Write cache and stream-order hardening", "2026-07-15"),
        ms("M2", "Sync envelope repair and dead-letter recovery", "2026-08-31"),
        ms("M3", "Reactor 6.3 feature freeze", "2026-10-15", "Nothing new lands after this date without a waiver."),
        ms("M4", "Storage backend selection", "2026-11-30"),
        ms("M5", "Cutover rehearsal", "2027-01-31"),
        ms("M6", "Reactor 6.3 GA", "2027-03-15"),
        ms("M7", "Post-GA stabilisation", "2027-04-30")], ["CORE", "SYNC", "OPS"]),
    ("Platform 2027 — second half", "platform-2027-h2", "", [
        ms("M1", "Worker-process executors", "2027-06-30"), ms("M2", "", "2027-08-15"),
        ms("M3", "Storage migration complete", "2027-09-30"), ms("M4", "Operation store compaction on by default", "2027-10-31"),
        ms("M5", "Hypercore transport decision", "2027-11-30"), ms("M6", "Reactor 6.4 freeze", "2027-12-15"),
        ms("M7", "Year-end release", "2027-12-31")], ["CORE", "SYNC"]),
    ("Authorization rollout", "authorization-rollout", "Identity first, then read gates, then document policies, then groups, then the fleet.", [
        ms("M1", "Identity resolution on Switchboard", "2026-09-30"), ms("M2", "Subgraph read gates", "2026-10-31"),
        ms("M3", "Auth scope policies on notes", "2026-12-15"), ms("M4", "Group principals and rosters", "2027-02-28"),
        ms("M5", "Fleet-wide enforcement", "2027-05-31", "All four flags on, every node together.")], ["AUTH"]),
    ("Vault and indexer", "vault-and-indexer", "One milestone a month; the indexer ships continuously.", [
        ms(f"M{i + 1}", t, f"{y}-{m:02d}-{28 if m == 2 else 30}") for i, (t, y, m) in enumerate([
            ("Embeddings server-side", 2026, 8), ("Hybrid search", 2026, 9), ("Tension automation", 2026, 10),
            ("Scope and WBS indexing", 2026, 11), ("Edge metadata everywhere", 2026, 12), ("Owner column", 2027, 1),
            ("Restore pipeline v2", 2027, 2), ("Roadmaps view", 2027, 3), ("Graph layout", 2027, 4),
            ("Chat deep links", 2027, 5), ("Health redesign", 2027, 6), ("Keyboard audit", 2027, 7)])], ["DATA", "UX"]),
    ("Partner demos", "partner-demos", "Companion-software demos, one partner stack at a time.", [
        ms("M1", "Paperless billing demo", "2026-08-28"), ms("M2", "UMH factory demo", "2026-10-10"),
        ms("M3", "Odoo companion demo", "2027-01-20"), ms("M4", "Integration partner summit", "2027-04-10")], ["GTM", "OPS"]),
    ("Research track", "research-track", "Spikes are time-boxed and unscheduled by design.", [], []),
]
roadmaps = []
for title, slug, desc, milestones, codes in ROADMAPS:
    roadmaps.append({"id": uid(), "title": title, "slug": slug, "description": desc, "milestones": milestones, "_codes": codes})

# schedule: each envelope's deliverables round-robin over its roadmaps' milestones; every 11th stays unscheduled
by_code = {p["code"]: p for p in projects}
for p in projects:
    pool = [m for r in roadmaps if p["code"] in r["_codes"] for m in r["milestones"]]
    if not pool: continue
    for i, did in enumerate(p["scope"]["deliverables"]):
        if i % 11 == 10: continue
        pool[(i * 7) % len(pool)]["scope"]["deliverables"].append(did)
# two of the unfunded ones get a milestone too
unfunded = [d for d in deliverables if not d["budgetAnchor"]]
roadmaps[0]["milestones"][2]["scope"]["deliverables"].append(unfunded[0]["id"])
roadmaps[3]["milestones"][5]["scope"]["deliverables"].append(unfunded[1]["id"])

# past milestones read as done: everything scheduled before today is DELIVERED
D = {d["id"]: d for d in deliverables}
for r in roadmaps:
    for m in r["milestones"]:
        if m["deliveryTarget"] < TODAY.isoformat():
            for did in m["scope"]["deliverables"]:
                d = D[did]; d["status"] = "DELIVERED"; d["workProgress"] = {"done": True}
                if not d["keyResults"]: d["keyResults"] = [kr("Shipped", "https://github.com/powerhouse-inc/powerhouse/releases")]
        ids = m["scope"]["deliverables"]
        done = sum(1 for i in ids if D[i]["status"] == "DELIVERED")
        m["scope"]["status"] = "FINISHED" if ids and done == len(ids) else "IN_PROGRESS" if any(D[i]["status"] in ("IN_PROGRESS", "BLOCKED") for i in ids) else "TODO"
        m["scope"]["deliverablesCompleted"] = {"total": len(ids), "completed": done}
for p in projects:  # recompute envelope sets after the status pass
    ids = p["scope"]["deliverables"]; done = sum(1 for i in ids if D[i]["status"] == "DELIVERED")
    p["scope"]["deliverablesCompleted"] = {"total": len(ids), "completed": done}
    if done == len(ids): p["scope"]["status"] = "FINISHED"

# ── WBS goal trees for the envelopes that have one ─────────────────────────
SUB = ["Design and agree the approach", "Implement behind a feature flag", "Tests: happy path and every error code",
       "Document in the runbook", "Review with the owning team", "Ship and watch the metrics for a week",
       "Benchmark before and after", "Migration notes for existing data"]
PROFILE = {"deep": (2, 4, 0.6, 0.2), "medium": (0, 2, 0.2, 0.0), "stress": (3, 5, 0.9, 0.5), "shallow": (0, 1, 0.0, 0.0), "flat": (0, 0, 0.0, 0.0)}
GSTATUS = {"DELIVERED": "COMPLETED", "IN_PROGRESS": "IN_PROGRESS", "BLOCKED": "BLOCKED", "TODO": "TODO",
           "DRAFT": "TODO", "CANCELED": "WONT_DO", "WONT_DO": "WONT_DO"}
NOTE_TEXT = ["Verified against the dev.82 build; the earlier repro no longer reproduces.",
             "Blocked on the fleet flag decision — see the authorization rollout M5.",
             "Reviewed with Frank; two follow-ups filed as child goals.", "Shipped behind a flag; metrics look flat, which is the goal."]


def goal(desc, parent, dstatus, assignee, depth):
    st = GSTATUS[dstatus]
    if st == "IN_PROGRESS" and depth > 0: st = rng.choice(["IN_PROGRESS", "TODO", "COMPLETED", "IN_REVIEW"])
    if st == "BLOCKED" and depth > 0: st = rng.choice(["BLOCKED", "TODO", "COMPLETED"])
    g = {"id": uid(), "description": desc, "parentId": parent, "assignee": assignee if rng.random() < 0.8 else None,
         "status": st, "blockReason": "Waiting on the fleet-wide flag decision" if st == "BLOCKED" else None,
         "outcome": f"Done — {desc[:40].rstrip()}." if st == "COMPLETED" and rng.random() < 0.7 else None,
         "notes": [], "dependencies": []}
    if st == "COMPLETED" and rng.random() < 0.3:
        g["notes"] = [{"id": uid(), "note": rng.choice(NOTE_TEXT), "author": rng.choice(["knowledge-agent", "liberuum", "Frank"]),
                       "timestamp": f"2026-0{rng.randint(6, 9)}-{rng.randint(10, 28):02d}T{rng.randint(8, 18):02d}:00:00.000Z"}
                      for _ in range(rng.choice([1, 1, 2]))]
    return g


for p in projects:
    prof = p["_profile"]
    if not prof: continue
    lo, hi, p_grand, p_great = PROFILE[prof]
    owner_name = next((a["name"] for a in agents if a["id"] == p["projectOwner"]), None)
    goals = []
    for did in p["scope"]["deliverables"]:
        d = D[did]
        root = goal(d["title"] or "Untitled deliverable", None, d["status"], owner_name, 0)
        d["goalRef"] = root["id"]; goals.append(root)
        kids = []
        for s in rng.sample(SUB, rng.randint(lo, hi)):
            k = goal(s, root["id"], d["status"], rng.choice([owner_name, rng.choice([a["name"] for a in agents])]), 1)
            goals.append(k); kids.append(k)
            if rng.random() < p_grand:
                for s2 in rng.sample(SUB, rng.randint(1, 3)):
                    gk = goal(f"{s2} ({s.split()[0].lower()})", k["id"], d["status"], k["assignee"], 2); goals.append(gk)
                    if rng.random() < p_great:
                        goals.append(goal("Follow-up from review", gk["id"], d["status"], gk["assignee"], 3))
        for a, b in zip(kids, kids[1:]):  # each sibling depends on the previous one
            if rng.random() < 0.5: b["dependencies"] = [a["id"]]
    wbs_docs[p["code"]] = {"goals": goals, "owner": owner_name, "references": p["references"][:2],
                           "sowRef": None, "sowProjectId": p["id"], "projectRef": None}


# ── knowledge refs from the live vault ─────────────────────────────────────
def fetch_note_ids(drive, n):
    try:
        q = '{ knowledgeGraphNodesByType(driveId: "%s", documentType: "bai/knowledge-note") { documentId } }' % drive
        r = gql.post(q, {}, endpoint=gql.SUPERGRAPH_ENDPOINT)
        return [x["documentId"] for x in r["knowledgeGraphNodesByType"]][:n]
    except Exception as e:  # noqa: BLE001
        print(f"  (knowledgeRefs skipped: {str(e)[:80]})"); return []


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--drive", required=True); ap.add_argument("--folder", required=True)
    args = ap.parse_args()
    print(f"endpoint: {gql.SUPERGRAPH_ENDPOINT}\ndrive: {args.drive}\n")

    # 1. shells first, so every cross-reference points at an id that exists
    sow_id = gql.create_document("powerhouse/scopeofwork", "Powerhouse Platform 2027 — stress fixture", args.drive)
    gql.move_node(args.drive, sow_id, args.folder)
    print(f"scope   {sow_id}")
    for code, w in wbs_docs.items():
        w["_id"] = gql.create_document("bai/wbs", f"{by_code[code]['title'][:60]} — WBS", args.drive)
        gql.move_node(args.drive, w["_id"], args.folder)
        by_code[code]["wbsRef"] = w["_id"]; w["sowRef"] = sow_id
        print(f"wbs     {w['_id']}  {code} ({len(w['goals'])} goals)")

    notes = fetch_note_ids(args.drive, 12)
    for p in projects:
        p["knowledgeRefs"] = rng.sample(notes, min(p.pop("_nkrefs"), len(notes))) if notes else []
        p.pop("_profile")
    for r in roadmaps: r.pop("_codes")

    id_map = IdMap(Path(tempfile.mkdtemp()) / "id-map.json")
    for w in wbs_docs.values(): id_map.set(w["_id"], w["_id"])
    for n in notes: id_map.set(n, n)
    id_map.set(sow_id, sow_id)

    state = {"title": "Powerhouse Platform 2027 — stress fixture", "status": "IN_PROGRESS",
             "description": ("A synthetic plan sized to stress every surface of the scope-of-work editor: eight envelopes, "
                             "six roadmaps, a hundred-odd deliverables in every status, and goal trees up to four deep. "
                             "Nothing in it is a commitment."),
             "contributors": agents, "deliverables": deliverables, "projects": projects, "roadmaps": roadmaps}

    # 2. the scope, in order, in chunks
    scalars, crossrefs = scope_of_work.build_actions(state, id_map, drop_unmapped=True)
    auth = by_code["AUTH"]["id"]
    scalars.append({"type": "SET_PROJECT_MARGIN", "scope": "global", "input": {"projectId": auth, "margin": 12}})
    chunked(sow_id, scalars, "scope scalars")
    chunked(sow_id, crossrefs, "scope links (wbs + knowledge refs)")

    # 3. the WBS documents
    for code, w in wbs_docs.items():
        st = {k: v for k, v in w.items() if not k.startswith("_")}
        s, c = wbs_h.build_actions(st, id_map, drop_unmapped=True)
        chunked(w["_id"], s, f"wbs {code} goals"); chunked(w["_id"], c, f"wbs {code} back-link")

    json.dump({"scope": sow_id, "wbs": {c: w["_id"] for c, w in wbs_docs.items()}}, open("/tmp/sow-stress-ids.json", "w"), indent=1)
    print("\nids -> /tmp/sow-stress-ids.json")
    print(f"planned: {len(agents)} agents, {len(projects)} envelopes, {len(deliverables)} deliverables, "
          f"{len(roadmaps)} roadmaps, {sum(len(r['milestones']) for r in roadmaps)} milestones, "
          f"{sum(len(w['goals']) for w in wbs_docs.values())} goals in {len(wbs_docs)} WBS")


if __name__ == "__main__":
    main()
