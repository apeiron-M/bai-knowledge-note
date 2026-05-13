#!/usr/bin/env python3
"""Phase 0: download a drive from a source switchboard via GraphQL.

Output layout:
    <output-dir>/
        manifest.json
        drive-info.json
        states/<doc-id>.json     — state.global per document
        ops/<doc-id>.json        — operation history (informational; not replayed)

Idempotent: skips per-doc fetch if state file already exists.

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
            g, ops = fetch_doc(client, doc_id)
            # Reconstruct relationship-driven state fields from the
            # reactor's DocumentRelationship table so the next upload
            # can replay them via ADD_RELATIONSHIP.
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

    manifest = {
        "source": {
            "endpoint": args.endpoint,
            "drive": args.drive,
            "driveId": drive_info["id"],
            "driveName": drive_info["name"],
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
