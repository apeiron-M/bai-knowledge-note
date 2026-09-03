#!/usr/bin/env python3
"""Phase 0: download a drive from a source switchboard via GraphQL.

Output layout:
    <output-dir>/
        manifest.json
        drive-info.json
        tree.json                — the drive's node tree
        edges.json               — every knowledge edge in the drive, with
                                   reason/confidence, from ONE knowledgeGraphEdges
                                   call (source of the per-doc link arrays below)
        auth.json                — {doc-id: state.auth} for every document, so a
                                   restored vault can be compared policy-for-policy
        states/<doc-id>.json     — state.global per document, with links[] /
                                   coreIdeas[] / childRefs[] reconstructed from edges
        ops/<doc-id>.json        — operation history (informational; not replayed)

Idempotent: skips per-doc fetch if state file already exists.

Relationships come from the graph subgraph's whole-drive edge dump by default
(`--relationships graph`): one request instead of seven per document, and it is
the only read path that carries each edge's `reason` and `confidence` —
`documentOutgoingRelationships` returns documents, not edge rows, so the older
per-type fan-out (`--relationships table`) cannot see them. The fan-out is kept
as a fallback for a Switchboard without the knowledgeGraph subgraph.

Usage:
    python3 scripts/drive-sync/download.py \
        --endpoint https://switchboard.eager-hen-55.vetra.io/graphql/r \
        --drive knowledge-vault \
        --out scripts/drive-sync/data/knowledge-vault
"""
import argparse
import datetime
import json
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

# Allow running as a script: add this dir to sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent))

from lib.graphql import GraphQLClient, GraphQLError


DRIVE_TREE_QUERY = """
query DriveTree($id: String!) {
  document(identifier: $id) {
    document {
      id
      name
      state
    }
  }
}
"""

DOC_STATE_QUERY = """
query DocState($id: String!, $cursor: String) {
  document(identifier: $id) {
    document {
      id
      state
      operations(paging: {limit: 200, cursor: $cursor}) {
        items {
          index
          hash
          timestampUtcMs
          action {
            type
            input
            timestampUtcMs
          }
        }
        hasNextPage
        cursor
        totalCount
      }
    }
  }
}
"""

# Relationship types supported by the document-relationship system.
# Since the drive-override migration, edges between documents live in the
# reactor's DocumentRelationship table — not in the per-doc state's
# `links[]` array. The handlers in upload.py still read state.links /
# state.coreIdeas / state.childRefs, so on download we fan out per type
# and reconstruct those state fields from the live relationship rows.
KNOWLEDGE_NOTE_LINK_TYPES = (
    "RELATES_TO", "BUILDS_ON", "CONTRADICTS", "SUPERSEDES", "DERIVED_FROM",
)
MOC_LINK_TYPES = ("CORE_IDEA", "CHILD_MOC")
ALL_LINK_TYPES = KNOWLEDGE_NOTE_LINK_TYPES + MOC_LINK_TYPES

OUTGOING_RELATIONSHIPS_QUERY = """
query Outgoing($sid: String!, $type: String!) {
  documentOutgoingRelationships(sourceIdentifier: $sid, relationshipType: $type) {
    items { id }
  }
}
"""


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--endpoint", required=True)
    p.add_argument("--drive", required=True, help="drive slug or UUID")
    p.add_argument("--out", required=True, help="output directory")
    p.add_argument("--concurrency", type=int, default=5)
    p.add_argument("--limit", type=int, default=None, help="for testing; cap doc fetches")
    p.add_argument("--relationships", choices=("graph", "table"), default="graph",
                   help="graph: one knowledgeGraphEdges call with reason/confidence (default); "
                        "table: per-doc per-type documentOutgoingRelationships fan-out")
    p.add_argument("--graph-endpoint", default=None,
                   help="endpoint serving knowledgeGraphEdges; default derives "
                        "<endpoint without /r>/knowledgeGraph")
    return p.parse_args()


def fetch_drive(client: GraphQLClient, identifier: str) -> dict:
    data = client.query(DRIVE_TREE_QUERY, {"id": identifier})
    wrapper = data.get("document")
    if not wrapper:
        raise RuntimeError(f"drive '{identifier}' not found at {client.endpoint}")
    doc = wrapper.get("document") or wrapper
    return doc


def _parse_state_global(doc: dict) -> dict:
    """Extract state.global from a PHDocument response.

    The server returns state as a JSONObject scalar with shape:
        { "global": {...}, "local": {...}, ... }
    """
    state = doc.get("state", {})
    if isinstance(state, str):
        state = json.loads(state)
    g = state.get("global", {})
    if isinstance(g, str):
        g = json.loads(g)
    return g or {}


def extract_nodes(drive_doc: dict) -> list[dict]:
    g = _parse_state_global(drive_doc)
    return g.get("nodes", [])


def fetch_doc(client: GraphQLClient, doc_id: str) -> tuple[dict, list]:
    """Fetch a document's global state and all operations (paginates if needed)."""
    all_ops: list[dict] = []
    cursor: str | None = None
    g: dict = {}

    while True:
        variables: dict = {"id": doc_id}
        if cursor is not None:
            variables["cursor"] = cursor
        data = client.query(DOC_STATE_QUERY, variables)
        wrapper = data.get("document")
        if not wrapper:
            raise RuntimeError(f"document {doc_id} not found")
        doc = wrapper.get("document") or wrapper

        if not g:
            g = _parse_state_global(doc)

        ops_page = doc.get("operations") or {}
        items = ops_page.get("items") or []
        all_ops.extend(items)

        if ops_page.get("hasNextPage"):
            cursor = ops_page.get("cursor")
        else:
            break

    return g, all_ops


def _parse_state_auth(doc: dict) -> dict:
    state = doc.get("state", {})
    if isinstance(state, str):
        state = json.loads(state)
    a = state.get("auth") or {}
    if isinstance(a, str):
        a = json.loads(a)
    return a or {}


def fetch_doc_full(client: GraphQLClient, doc_id: str) -> tuple[dict, list, dict]:
    """fetch_doc plus the document's auth scope (its access policy)."""
    all_ops: list[dict] = []
    cursor: str | None = None
    g: dict = {}
    auth: dict = {}
    while True:
        variables: dict = {"id": doc_id}
        if cursor is not None:
            variables["cursor"] = cursor
        data = client.query(DOC_STATE_QUERY, variables)
        wrapper = data.get("document")
        if not wrapper:
            raise RuntimeError(f"document {doc_id} not found")
        doc = wrapper.get("document") or wrapper
        if not g:
            g = _parse_state_global(doc)
            auth = _parse_state_auth(doc)
        ops_page = doc.get("operations") or {}
        all_ops.extend(ops_page.get("items") or [])
        if ops_page.get("hasNextPage"):
            cursor = ops_page.get("cursor")
        else:
            break
    return g, all_ops, auth


def fetch_outgoing_relationships(
    client: GraphQLClient, source_id: str, rel_type: str
) -> list[str]:
    """Return target document IDs for one (source, type) pair."""
    data = client.query(
        OUTGOING_RELATIONSHIPS_QUERY,
        {"sid": source_id, "type": rel_type},
    )
    items = (data.get("documentOutgoingRelationships") or {}).get("items") or []
    out: list[str] = []
    for it in items:
        tid = it.get("id")
        if tid:
            out.append(tid)
    return out


def attach_relationships_to_state(
    client: GraphQLClient,
    doc_id: str,
    doc_type: str,
    state: dict,
    title_by_id: dict[str, str],
) -> None:
    """Fan out per relationship type and populate the state fields the
    upload-script handlers consume:

      knowledge-note: state.links[]   = [{id, linkType, targetDocumentId, targetTitle}]
      moc:            state.coreIdeas[] (CORE_IDEA targets)
                      state.childRefs[] (CHILD_MOC targets — IDs only)

    This is purely informational — the source of truth on the remote is
    the DocumentRelationship table. We reconstruct here so the next
    `upload.py` run can replay ADD_RELATIONSHIP through the existing
    handler logic without changes.
    """
    links: list[dict] = []
    core_ideas: list[dict] = []
    child_refs: list[str] = []
    is_moc = doc_type == "bai/moc"

    for rel_type in ALL_LINK_TYPES:
        targets = fetch_outgoing_relationships(client, doc_id, rel_type)
        for tid in targets:
            if rel_type in KNOWLEDGE_NOTE_LINK_TYPES:
                links.append({
                    "id": f"lnk-{tid[:8]}-{rel_type[:3].lower()}",
                    "linkType": rel_type,
                    "targetDocumentId": tid,
                    "targetTitle": title_by_id.get(tid, ""),
                })
            elif rel_type == "CORE_IDEA" and is_moc:
                core_ideas.append({
                    "id": f"ci-{tid[:8]}",
                    "noteRef": tid,
                    "contextPhrase": "",
                    "sortOrder": len(core_ideas),
                    "addedAt": _now_iso(),
                    "addedBy": "knowledge-agent",
                })
            elif rel_type == "CHILD_MOC" and is_moc:
                child_refs.append(tid)

    # Overwrite the state fields. We deliberately replace any stale
    # arrays from the source state with the live relationship graph.
    state["links"] = links
    if is_moc:
        state["coreIdeas"] = core_ideas
        state["childRefs"] = child_refs


def _now_iso() -> str:
    return datetime.datetime.now(datetime.timezone.utc).strftime(
        "%Y-%m-%dT%H:%M:%S.000Z"
    )


EDGES_QUERY = """
query Edges($driveId: ID!) {
  knowledgeGraphEdges(driveId: $driveId) {
    sourceDocumentId
    targetDocumentId
    linkType
    reason
    confidence
  }
}
"""


def derive_graph_endpoint(endpoint: str) -> str:
    """`.../graphql/r` -> `.../graphql/knowledgeGraph`; `.../graphql` likewise."""
    base = endpoint[:-2] if endpoint.endswith("/r") else endpoint
    return base.rstrip("/") + "/knowledgeGraph"


def fetch_all_edges(client: GraphQLClient, drive_id: str) -> list[dict]:
    """Every knowledge edge in the drive in one call, reason/confidence included."""
    data = client.query(EDGES_QUERY, {"driveId": drive_id})
    return data.get("knowledgeGraphEdges") or []


def attach_relationships_from_edges(
    doc_id: str,
    doc_type: str,
    state: dict,
    edges_by_source: dict[str, list[dict]],
    title_by_id: dict[str, str],
) -> None:
    """Same state fields as attach_relationships_to_state, built from the
    edge dump instead of seven queries. Link entries additionally carry the
    edge's `reason` and `confidence`; the upload handlers ignore fields they
    do not know, so this stays compatible while losing nothing."""
    links: list[dict] = []
    core_ideas: list[dict] = []
    child_refs: list[str] = []
    is_moc = doc_type == "bai/moc"
    for e in edges_by_source.get(doc_id, []):
        rel_type = e.get("linkType") or ""
        tid = e.get("targetDocumentId")
        if not tid:
            continue
        if rel_type in KNOWLEDGE_NOTE_LINK_TYPES:
            entry = {
                "id": f"lnk-{tid[:8]}-{rel_type[:3].lower()}",
                "linkType": rel_type,
                "targetDocumentId": tid,
                "targetTitle": title_by_id.get(tid, ""),
            }
            if e.get("reason"):
                entry["reason"] = e["reason"]
            if e.get("confidence"):
                entry["confidence"] = e["confidence"]
            links.append(entry)
        elif rel_type == "CORE_IDEA" and is_moc:
            core_ideas.append({
                "id": f"ci-{tid[:8]}",
                "noteRef": tid,
                "contextPhrase": e.get("reason") or "",
                "sortOrder": len(core_ideas),
                "addedAt": _now_iso(),
                "addedBy": "knowledge-agent",
            })
        elif rel_type == "CHILD_MOC" and is_moc:
            child_refs.append(tid)
        # Other types (INVOLVES from tensions, ...) stay in edges.json only;
        # no upload handler consumes them yet.
    state["links"] = links
    if is_moc:
        state["coreIdeas"] = core_ideas
        state["childRefs"] = child_refs


def _retry_read(fn, attempts: int = 3):
    """Reads are idempotent, so a 5xx from the ingress is safe to retry.
    lib.gql deliberately does not retry GraphQL/HTTP-level errors because it
    also carries mutations; this wrapper is for read-only fetches only."""
    last: Exception | None = None
    for i in range(attempts):
        try:
            return fn()
        except Exception as e:  # GraphQLError("HTTP 502: ...") and friends
            msg = str(e)
            if "HTTP 5" not in msg and "network:" not in msg:
                raise
            last = e
            if i < attempts - 1:
                time.sleep(1.0 * (2 ** i))
    assert last is not None
    raise last


def main() -> int:
    args = parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    (out / "states").mkdir(exist_ok=True)
    (out / "ops").mkdir(exist_ok=True)

    client = GraphQLClient(args.endpoint)

    print(f"[download] endpoint: {args.endpoint}")
    print(f"[download] drive:    {args.drive}")
    print(f"[download] output:   {out}")

    drive_doc = fetch_drive(client, args.drive)
    nodes = extract_nodes(drive_doc)
    folders = [n for n in nodes if n.get("kind") == "folder"]
    files = [n for n in nodes if n.get("kind") == "file"]
    print(f"[download] tree: {len(folders)} folders, {len(files)} documents")

    drive_info = {
        "id": drive_doc.get("id"),
        "slug": args.drive,
        "name": drive_doc.get("name"),
    }
    (out / "drive-info.json").write_text(json.dumps(drive_info, indent=2))
    (out / "tree.json").write_text(json.dumps({"nodes": nodes}, indent=2))

    all_files = files  # keep full list for manifest
    if args.limit is not None:
        files = files[: args.limit]
        print(f"[download] (limited to {len(files)} for testing)")

    states_dir = out / "states"
    ops_dir = out / "ops"

    edges_by_source: dict[str, list[dict]] = {}
    use_graph = args.relationships == "graph"
    if use_graph:
        graph_ep = args.graph_endpoint or derive_graph_endpoint(args.endpoint)
        graph_client = GraphQLClient(graph_ep)
        drive_ident = drive_info["id"] or args.drive
        try:
            edges = _retry_read(lambda: fetch_all_edges(graph_client, drive_ident))
        except Exception as e:
            print(f"[download] edge dump failed at {graph_ep} ({str(e)[:120]}); "
                  f"falling back to per-type fan-out", file=sys.stderr)
            use_graph = False
            edges = []
        if use_graph:
            (out / "edges.json").write_text(json.dumps(edges, indent=1))
            for e in edges:
                edges_by_source.setdefault(e.get("sourceDocumentId") or "", []).append(e)
            by_type: dict[str, int] = {}
            for e in edges:
                by_type[e.get("linkType") or "?"] = by_type.get(e.get("linkType") or "?", 0) + 1
            with_reason = sum(1 for e in edges if e.get("reason"))
            print(f"[download] edges: {len(edges)} from {graph_ep} "
                  f"({with_reason} with reason) "
                  + ", ".join(f"{k}={v}" for k, v in sorted(by_type.items(), key=lambda kv: -kv[1])))

    auth_by_id: dict[str, dict] = {}
    auth_lock = __import__("threading").Lock()

    # Build a {id → title} map from the drive's file nodes so we can
    # fill in `targetTitle` on synthesized link entries without an extra
    # round-trip per relationship.
    title_by_id: dict[str, str] = {f["id"]: f.get("name") or "" for f in all_files}
    type_by_id: dict[str, str] = {
        f["id"]: (f.get("documentType") or f.get("type") or "unknown") for f in all_files
    }

    def fetch_one(idx: int, total: int, node: dict) -> tuple[str, bool, str]:
        doc_id = node["id"]
        state_path = states_dir / f"{doc_id}.json"
        ops_path = ops_dir / f"{doc_id}.json"
        if state_path.exists() and ops_path.exists():
            return (doc_id, True, "cached")
        try:
            g, ops, auth = _retry_read(lambda: fetch_doc_full(client, doc_id))
            with auth_lock:
                auth_by_id[doc_id] = auth
            # Reconstruct relationship-driven state fields so the next
            # upload can replay them via ADD_RELATIONSHIP.
            if use_graph:
                attach_relationships_from_edges(
                    doc_id, type_by_id.get(doc_id, "unknown"), g, edges_by_source, title_by_id
                )
            else:
                attach_relationships_to_state(
                    client, doc_id, type_by_id.get(doc_id, "unknown"), g, title_by_id
                )
            state_path.write_text(json.dumps(g, indent=2))
            ops_path.write_text(json.dumps(ops, indent=2))
            n_links = len(g.get("links") or [])
            n_core = len(g.get("coreIdeas") or [])
            n_child = len(g.get("childRefs") or [])
            return (
                doc_id,
                True,
                f"{len(ops)} ops, {n_links} links, {n_core} core, {n_child} children",
            )
        except Exception as e:
            return (doc_id, False, str(e)[:160])

    succeeded = 0
    failed = 0
    start = time.time()
    with ThreadPoolExecutor(max_workers=args.concurrency) as ex:
        futures = {
            ex.submit(fetch_one, i, len(files), n): (i, n)
            for i, n in enumerate(files, start=1)
        }
        for fut in as_completed(futures):
            i, n = futures[fut]
            doc_id, ok, info = fut.result()
            tag = f"[{i}/{len(files)}]"
            if ok:
                succeeded += 1
                print(f"  {tag} ✓ {n.get('name','?')[:60]} — {info}")
            else:
                failed += 1
                print(f"  {tag} ✗ {n.get('name','?')[:60]} — {info}", file=sys.stderr)

    # Merge with any auth.json from a previous (cached) run so a resumed
    # download still ends with one entry per document.
    auth_path = out / "auth.json"
    if auth_path.exists():
        try:
            prev = json.loads(auth_path.read_text())
            prev.update(auth_by_id)
            auth_by_id = prev
        except Exception:
            pass
    auth_path.write_text(json.dumps(auth_by_id, indent=1, sort_keys=True))
    initialized = sum(1 for a in auth_by_id.values() if (a or {}).get("version", 0))
    print(f"[download] auth: {len(auth_by_id)} policies saved, {initialized} initialized")

    manifest = {
        "source": {
            "endpoint": args.endpoint,
            "drive": args.drive,
            "driveId": drive_info["id"],
            "driveName": drive_info["name"],
            "relationships": "graph" if use_graph else "table",
            "downloadedAt": datetime.datetime.now(datetime.timezone.utc).strftime(
                "%Y-%m-%dT%H:%M:%S.000Z"
            ),
        },
        "folders": [
            {
                "id": f["id"],
                "name": f["name"],
                "parentFolder": f.get("parentFolder"),
            }
            for f in folders
        ],
        "documents": [
            {
                "id": f["id"],
                "name": f["name"],
                "type": f.get("documentType") or f.get("type") or "unknown",
                "parentFolder": f.get("parentFolder"),
            }
            for f in all_files
        ],
    }
    (out / "manifest.json").write_text(json.dumps(manifest, indent=2))

    elapsed = time.time() - start
    print(f"[download] done in {elapsed:.1f}s — {succeeded} ok, {failed} failed")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
