"""Download the Atlas vault into a replayable on-disk dataset.

Layout produced (same shape drive-sync's upload.py consumes):

    <out>/
        drive-info.json      id / slug / name of the source drive
        tree.json            raw node list
        manifest.json        folders[] + documents[] (id, name, type, parentFolder)
        states/<id>.json     state.global, with links[]/coreIdeas[]/childRefs[]
                             reconstructed from the DocumentRelationship table

Deliberately **no** `ops/`. drive-sync records operation history for
reference; for Atlas the whole point of the rebuild is to leave the
old history behind, so downloading it would only be misleading weight.

Request shape
-------------
The naive download is 1 state query + 7 relationship queries per
document — ~12,000 round trips for this vault, which is where the
earlier attempt spent (and lost) its time. GraphQL aliases let us ask
for many documents in one request, so this reads the whole vault in
~150 requests over a single keep-alive connection.
"""
import datetime
import json
import time
from pathlib import Path
from typing import Any, Callable, Iterable

from . import safe_identifier

# Relationship types held in the reactor's DocumentRelationship table.
NOTE_LINK_TYPES = ("RELATES_TO", "BUILDS_ON", "CONTRADICTS", "SUPERSEDES", "DERIVED_FROM")
MOC_LINK_TYPES = ("CORE_IDEA", "CHILD_MOC")
ALL_LINK_TYPES = NOTE_LINK_TYPES + MOC_LINK_TYPES


def _now_iso() -> str:
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")


def _as_dict(value: Any) -> dict:
    if isinstance(value, str):
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return {}
    return value or {}


def state_global(doc: dict) -> dict:
    """Pull state.global out of a PHDocument payload (str or object)."""
    return _as_dict(_as_dict(doc.get("state")).get("global"))


def chunks(items: list, size: int) -> Iterable[list]:
    for i in range(0, len(items), size):
        yield items[i : i + size]


# ── Batched readers ─────────────────────────────────────────────────

def build_state_query(doc_ids: list[str]) -> str:
    parts = [
        f' d{i}: document(identifier: "{safe_identifier(d)}") {{ document {{ id state }} }}'
        for i, d in enumerate(doc_ids)
    ]
    return "query{" + "".join(parts) + "}"


def fetch_edges(gql, endpoint: str, drive_id: str) -> dict[str, dict[str, list[str]]]:
    """Every knowledge edge in the drive, grouped by source document.

    One query. The per-document alternative,
    `documentOutgoingRelationships`, is unusable for large sets: it clamps
    `paging.limit` to 100, ignores `paging.offset`, and then reports
    `totalCount: 100` / `hasNextPage: false` — so a MoC with 374 core
    ideas returns 100 rows and claims that is all of them, with no
    signal that anything was dropped.

    `linkType` also carries the reactor's own `child` containment edges
    (drive → document); those aren't knowledge edges and no handler
    emits them, so they're filtered out.
    """
    data = gql.post(
        "query($id: ID!){ knowledgeGraphEdges(driveId: $id)"
        "{ sourceDocumentId targetDocumentId linkType } }",
        {"id": drive_id},
        endpoint=endpoint.rstrip("/") + "/knowledgeGraph",
        timeout=300,
    )
    per_doc: dict[str, dict[str, list[str]]] = {}
    for edge in data.get("knowledgeGraphEdges") or []:
        rel = edge.get("linkType")
        src, tgt = edge.get("sourceDocumentId"), edge.get("targetDocumentId")
        if rel not in ALL_LINK_TYPES or not src or not tgt:
            continue
        per_doc.setdefault(src, {}).setdefault(rel, []).append(tgt)
    return per_doc


def parse_state_batch(doc_ids: list[str], data: dict) -> dict[str, dict]:
    out: dict[str, dict] = {}
    for i, doc_id in enumerate(doc_ids):
        wrapper = (data.get(f"d{i}") or {}).get("document")
        if wrapper:
            out[doc_id] = state_global(wrapper)
    return out


def parse_relationship_batch(
    doc_ids: list[str], data: dict, types: tuple[str, ...] = ALL_LINK_TYPES
) -> dict[str, dict[str, list[str]]]:
    out: dict[str, dict[str, list[str]]] = {}
    for i, doc_id in enumerate(doc_ids):
        per_type: dict[str, list[str]] = {}
        for j, rel in enumerate(types):
            items = ((data.get(f"r{i}_{j}") or {}).get("items")) or []
            targets = [it["id"] for it in items if it.get("id")]
            if targets:
                per_type[rel] = targets
        out[doc_id] = per_type
    return out


# ── Relationship → state projection ─────────────────────────────────

def attach_relationships(
    state: dict,
    doc_type: str,
    per_type: dict[str, list[str]],
    title_by_id: dict[str, str],
) -> dict:
    """Write links[]/coreIdeas[]/childRefs[] onto `state` in place.

    drive-sync's handlers read edges from these state arrays and re-emit
    them as ADD_RELATIONSHIP during upload phase 4. The live source of
    truth is the DocumentRelationship table, so we always overwrite
    whatever stale arrays the document's own state happens to carry.
    """
    is_moc = doc_type == "bai/moc"
    links: list[dict] = []
    core_ideas: list[dict] = []
    child_refs: list[str] = []

    for rel_type in ALL_LINK_TYPES:
        for tid in per_type.get(rel_type, []):
            if rel_type in NOTE_LINK_TYPES:
                links.append(
                    {
                        "id": f"lnk-{tid[:8]}-{rel_type[:3].lower()}",
                        "linkType": rel_type,
                        "targetDocumentId": tid,
                        "targetTitle": title_by_id.get(tid, ""),
                    }
                )
            elif rel_type == "CORE_IDEA" and is_moc:
                core_ideas.append(
                    {
                        "id": f"ci-{tid[:8]}",
                        "noteRef": tid,
                        "contextPhrase": "",
                        "sortOrder": len(core_ideas),
                        "addedAt": _now_iso(),
                        "addedBy": "atlas-sync",
                    }
                )
            elif rel_type == "CHILD_MOC" and is_moc:
                child_refs.append(tid)

    state["links"] = links
    if is_moc:
        state["coreIdeas"] = core_ideas
        state["childRefs"] = child_refs
    return state


# ── Driver ──────────────────────────────────────────────────────────

DRIVE_QUERY = "query($id: String!){ document(identifier:$id){ document { id slug name state } } }"


def fetch_drive(gql, drive: str) -> dict:
    data = gql.post(DRIVE_QUERY, {"id": drive}, endpoint=gql.READ_ENDPOINT)
    doc = ((data.get("document") or {}).get("document")) or {}
    if not doc.get("id"):
        raise SystemExit(f"drive {drive!r} not found at {gql.READ_ENDPOINT}")
    return doc


def download(
    gql,
    endpoint: str,
    drive: str,
    out: Path,
    batch: int = 20,
    log: Callable[[str], None] = print,
) -> dict:
    out = Path(out)
    (out / "states").mkdir(parents=True, exist_ok=True)
    start = time.time()

    drive_doc = fetch_drive(gql, drive)
    nodes = (state_global(drive_doc).get("nodes")) or []
    folders = [n for n in nodes if n.get("kind") == "folder"]
    files = [n for n in nodes if n.get("kind") == "file"]
    log(f"[download] drive {drive_doc.get('name')} ({drive_doc['id']})")
    log(f"[download] {len(folders)} folders, {len(files)} documents")

    (out / "drive-info.json").write_text(
        json.dumps(
            {"id": drive_doc["id"], "slug": drive_doc.get("slug"), "name": drive_doc.get("name")},
            indent=2,
        )
    )
    (out / "tree.json").write_text(json.dumps({"nodes": nodes}, indent=2))

    title_by_id = {f["id"]: f.get("name") or "" for f in files}
    type_by_id = {f["id"]: (f.get("documentType") or f.get("type") or "unknown") for f in files}
    doc_ids = [f["id"] for f in files]

    # Pass 1 — states.
    states: dict[str, dict] = {}
    for n, group in enumerate(chunks(doc_ids, batch), start=1):
        data = gql.post(build_state_query(group), endpoint=gql.READ_ENDPOINT, timeout=120)
        states.update(parse_state_batch(group, data))
        if n % 20 == 0:
            log(f"  states {len(states)}/{len(doc_ids)}")
    missing = [d for d in doc_ids if d not in states]
    log(f"[download] states: {len(states)}/{len(doc_ids)}" + (f" ({len(missing)} unreadable)" if missing else ""))

    # Pass 2 — relationships, in a single query.
    per_doc = fetch_edges(gql, endpoint, drive_doc["id"])
    edge_count = 0
    by_type: dict[str, int] = {}
    for doc_id, per_type in per_doc.items():
        if doc_id not in states:
            continue
        attach_relationships(states[doc_id], type_by_id.get(doc_id, ""), per_type, title_by_id)
        for rel, targets in per_type.items():
            edge_count += len(targets)
            by_type[rel] = by_type.get(rel, 0) + len(targets)
    log(f"[download] edges: {edge_count} " + json.dumps(by_type, sort_keys=True))

    for doc_id, state in states.items():
        (out / "states" / f"{doc_id}.json").write_text(json.dumps(state, indent=2))

    manifest = {
        "source": {
            "endpoint": gql.READ_ENDPOINT,
            "drive": drive,
            "driveId": drive_doc["id"],
            "driveName": drive_doc.get("name"),
            "downloadedAt": _now_iso(),
            "includesOperationHistory": False,
        },
        "counts": {
            "folders": len(folders),
            "documents": len(files),
            "states": len(states),
            "edges": edge_count,
            "edgesByType": by_type,
        },
        "folders": [
            {"id": f["id"], "name": f["name"], "parentFolder": f.get("parentFolder")}
            for f in folders
        ],
        "documents": [
            {
                "id": f["id"],
                "name": f["name"],
                "type": f.get("documentType") or f.get("type") or "unknown",
                "parentFolder": f.get("parentFolder"),
            }
            for f in files
        ],
    }
    (out / "manifest.json").write_text(json.dumps(manifest, indent=2))
    log(f"[download] done in {time.time() - start:.1f}s → {out}")
    if missing:
        log(f"[download] WARNING {len(missing)} documents returned no state: {missing[:5]}")
    return manifest
