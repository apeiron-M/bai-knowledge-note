#!/usr/bin/env python3
"""Phases 1-4: create drive, folders, documents on the active local switchboard,
and apply state via per-type handlers.

Pre-requisite: switchboard CLI's active profile must point to the local target.
The wrapper `upload.sh` enforces this with `assert_profile local`.

Output: writes id-map.json into the data dir as it progresses.

Usage:
    python3 scripts/drive-sync/upload.py \
        --data scripts/drive-sync/data/knowledge-vault \
        --drive-name "knowledge vault"
"""
import argparse
import json
import sys
import time
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from lib.id_map import IdMap
from lib import sb
from lib import gql
from handlers import (
    knowledge_note,
    moc as moc_handler,
    source as source_handler,
    pipeline_queue,
    health_report,
    vault_config,
)


HANDLERS = {
    "bai/knowledge-note": knowledge_note,
    "bai/moc": moc_handler,
    "bai/source": source_handler,
    "bai/pipeline-queue": pipeline_queue,
    "bai/health-report": health_report,
    "bai/vault-config": vault_config,
}

# Order Phase 2 doc creation by type so cross-doc refs resolve naturally:
# sources → knowledge-notes → mocs (parents-then-children) → singletons.
TYPE_ORDER = {
    "bai/source": 0,
    "bai/knowledge-note": 1,
    "bai/moc": 2,
    "bai/pipeline-queue": 3,
    "bai/health-report": 4,
    "bai/vault-config": 5,
}


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--data", required=True, help="data dir (output of download.py)")
    p.add_argument("--drive-name", default="knowledge vault")
    p.add_argument("--preferred-editor", default="knowledge-vault",
                   help="drive-level editor module (default: knowledge-vault)")
    p.add_argument("--existing-drive", default=None, help="upload into existing drive id (skip creation)")
    p.add_argument("--throttle-ms", type=int, default=0, help="sleep between mutations to ease backpressure")
    return p.parse_args()


def load_state(data_dir: Path, doc_id: str) -> dict | None:
    p = data_dir / "states" / f"{doc_id}.json"
    if not p.exists():
        return None
    return json.loads(p.read_text())


def _safe_cli_name(name: str, fallback: str) -> str:
    """Return `name` if safe to pass as `--name <value>` to the switchboard
    CLI; otherwise return `fallback`. Unsafe cases:
      - empty / None
      - leading '-' (parsed as a flag by argparse-style CLIs)
      - any control character (NUL, newline, tab, etc. — including DEL 0x7F)
      - characters known to confuse downstream parsers (',', '"', backslash)
    The original title is reapplied via SET_TITLE in Phase 3, so the placeholder
    name is invisible to end users.
    """
    if not name:
        return fallback
    if name.startswith("-"):
        return fallback
    if any(ord(ch) < 32 or ord(ch) == 127 for ch in name):
        return fallback
    if any(ch in name for ch in (",", '"', "\\")):
        return fallback
    return name


def topo_sort_folders(folders: list[dict]) -> list[dict]:
    by_id = {f["id"]: f for f in folders}
    visited: set[str] = set()
    out: list[dict] = []
    def visit(f: dict) -> None:
        if f["id"] in visited:
            return
        parent = f.get("parentFolder")
        if parent and parent in by_id:
            visit(by_id[parent])
        visited.add(f["id"])
        out.append(f)
    for f in folders:
        visit(f)
    return out


def phase_1_create_drive_and_folders(args, manifest: dict, id_map: IdMap) -> tuple[str, str]:
    print("\n━━━ Phase 1: drive + folders ━━━")
    # Everything here goes over the pooled GraphQL client rather than the
    # switchboard CLI. Each CLI call is a separate process doing its own TLS
    # handshake against the ingress, which is the exact cost that makes remote
    # uploads fail (see lib/gql._connection). The CLI also imposes its own
    # subprocess timeouts that kill the whole run on one slow call.
    if args.existing_drive:
        drive_id = args.existing_drive
        info = gql.get_drive_info(drive_id)
        drive_slug = info.get("slug") or drive_id
        print(f"  ✓ using existing drive: {info.get('name')} ({drive_id})")
    else:
        drive_id, drive_slug = gql.create_drive(
            args.drive_name, preferred_editor=args.preferred_editor
        )
        print(f"  ✓ created drive: {args.drive_name} ({drive_id}, slug={drive_slug}, editor={args.preferred_editor})")
    # Wait for the drive to become queryable.
    for attempt in range(5):
        try:
            gql.get_drive_info(drive_id)
            break
        except Exception:
            if attempt == 4:
                raise
            time.sleep(1)
    # Folders, parents-first.
    #
    # The knowledge-vault drive app seeds the same folder tree (ops/, self/,
    # knowledge/, sources/, ...) the moment a drive is opened in Connect, so
    # uploading into a drive that has ever been opened would otherwise create a
    # second, parallel set of identically-named folders. Reuse any folder that
    # already exists at the same (name, parent); only create what is missing.
    existing = [n for n in gql.get_drive_nodes(drive_id) if n.get("kind") == "folder"]
    by_key = {(n.get("name"), n.get("parentFolder") or None): n["id"] for n in existing}

    sorted_folders = topo_sort_folders(manifest["folders"])
    actions = []
    reused = 0
    for f in sorted_folders:
        parent = f.get("parentFolder")
        parent_new = id_map.resolve(parent) if parent else None
        hit = by_key.get((f["name"], parent_new))
        if hit:
            id_map.set(f["id"], hit)
            reused += 1
            continue
        new_id = str(uuid.uuid4())
        id_map.set(f["id"], new_id)
        inp: dict = {"id": new_id, "name": f["name"]}
        if parent_new:
            inp["parentFolder"] = parent_new
        actions.append({"type": "ADD_FOLDER", "input": inp, "scope": "global"})
        # Newly created folders are themselves valid parents for later rows.
        by_key[(f["name"], parent_new)] = new_id
    if actions:
        gql.mutate_document(drive_id, actions)
    print(f"  ✓ folders: {len(actions)} created, {reused} reused")
    return drive_id, drive_slug


def phase_2_create_documents(args, manifest: dict, id_map: IdMap, drive_id: str) -> None:
    print("\n━━━ Phase 2: create documents ━━━")
    # Filter out docs whose type no longer has a handler — currently
    # `bai/knowledge-graph`, which is part of the drive-override migration.
    # Leaving these in would crash CREATE_DOCUMENT against a model the
    # reactor no longer recognises.
    docs = [d for d in manifest["documents"] if d.get("type") in HANDLERS]
    skipped = len(manifest["documents"]) - len(docs)
    if skipped:
        print(f"  (skipping {skipped} doc(s) with no registered handler)")

    # The vault app also seeds one instance of each singleton type
    # (vault-config, pipeline-queue, health-report) on first open. Those are
    # one-per-drive by definition, so map the dataset's copy onto the existing
    # document rather than creating a duplicate the app would then ignore.
    SINGLETONS = {"bai/vault-config", "bai/pipeline-queue", "bai/health-report"}
    present: dict[str, str] = {}
    for n in gql.get_drive_nodes(drive_id):
        t = n.get("documentType")
        if t in SINGLETONS and t not in present:
            present[t] = n["id"]
    if present:
        adopted = 0
        remaining = []
        for d in docs:
            t = d.get("type")
            if t in present and not id_map.get(d["id"]):
                id_map.set(d["id"], present[t])
                adopted += 1
                continue
            remaining.append(d)
        docs = remaining
        print(f"  (adopted {adopted} existing singleton(s): {', '.join(sorted(present))})")
    # Within bai/moc, parent mocs must be created before children. Compute the
    # moc-internal ordering up front using the source state files (parentRef).
    moc_states = {d["id"]: load_state(Path(args.data), d["id"]) or {}
                  for d in docs if d.get("type") == "bai/moc"}
    moc_creation_order = moc_handler.sort_mocs_for_creation(docs, moc_states)
    moc_rank = {doc_id: i for i, doc_id in enumerate(moc_creation_order)}

    def sort_key(d: dict):
        type_rank = TYPE_ORDER.get(d.get("type") or "?", 99)
        sub_rank = moc_rank.get(d["id"], 0) if d.get("type") == "bai/moc" else 0
        return (type_rank, sub_rank, d.get("name") or "")

    docs.sort(key=sort_key)

    failed: list[tuple[str, str]] = []
    for i, d in enumerate(docs, start=1):
        if id_map.get(d["id"]):
            continue  # already created on a prior run
        # Name is a placeholder — Phase 3 overrides via SET_TITLE. We
        # used to sanitise it for CLI subprocess argv quoting; with the
        # GraphQL bypass that constraint is gone, but we still keep the
        # fallback for empty/weird names so the drive's node list stays
        # readable.
        safe_name = _safe_cli_name(d["name"], fallback="doc-" + d["id"][:8])
        parent_old = d.get("parentFolder")
        parent_folder = id_map.get(parent_old) if parent_old else None
        try:
            # The reactor's namespaced createDocument always creates the
            # doc at the drive root (parentIdentifier accepts only a
            # real document — folders aren't documents). Follow with
            # moveNode to slot the doc into its target folder. This is
            # the same two-step the CLI does internally; we just skip
            # the CLI's subprocess overhead by talking directly to the
            # supergraph endpoint.
            new_id = gql.create_document(d["type"], safe_name, drive_id)
            if parent_folder:
                gql.move_node(drive_id, new_id, parent_folder)
            id_map.set(d["id"], new_id)
            print(f"  [{i}/{len(docs)}] ✓ {d['type']:24s} {safe_name[:50]} → {new_id}")
        except Exception as e:
            failed.append((d["id"], str(e)[:200]))
            print(f"  [{i}/{len(docs)}] ✗ {d['type']} {d['name'][:50]} — {e}", file=sys.stderr)

    if failed:
        print(f"\n  ! Phase 2 had {len(failed)} failures (re-run upload to retry — already-created docs are skipped):", file=sys.stderr)
        for did, msg in failed[:10]:
            print(f"    {did}: {msg}", file=sys.stderr)
    placed = sum(1 for d in docs if id_map.get(d["id"]) and d.get("parentFolder"))
    print(f"  ✓ created+placed {placed} docs (create+move inline, no separate MOVE_NODE batch)")


def phase_3_apply_state(args, manifest: dict, id_map: IdMap, drive_id: str) -> dict:
    """Apply scalar (non-cross-ref) actions per doc. Returns a dict of
    {new_doc_id: [crossref_actions]} for use in Phase 4."""
    print("\n━━━ Phase 3: apply state ━━━")
    deferred: dict[str, list[dict]] = {}
    failed: list[tuple[str, str]] = []
    data = Path(args.data)

    # Re-sort with same key as Phase 2 so dependent state lands in order.
    # Same filter as Phase 2 — drop unhandled types.
    docs = [d for d in manifest["documents"] if d.get("type") in HANDLERS]
    moc_states = {d["id"]: load_state(data, d["id"]) or {}
                  for d in docs if d.get("type") == "bai/moc"}
    moc_creation_order = moc_handler.sort_mocs_for_creation(docs, moc_states)
    moc_rank = {doc_id: i for i, doc_id in enumerate(moc_creation_order)}

    def sort_key(d: dict):
        return (TYPE_ORDER.get(d.get("type") or "?", 99),
                moc_rank.get(d["id"], 0) if d.get("type") == "bai/moc" else 0,
                d.get("name") or "")
    docs.sort(key=sort_key)

    for i, d in enumerate(docs, start=1):
        new_id = id_map.get(d["id"])
        if not new_id:
            continue
        handler = HANDLERS.get(d["type"])
        if not handler:
            print(f"  [{i}/{len(docs)}] ! no handler for {d['type']} — skipped", file=sys.stderr)
            continue
        state = load_state(data, d["id"])
        if not state:
            continue
        try:
            scalars, crossrefs = handler.build_actions(state, id_map, drop_unmapped=True)
            if scalars:
                # gql.mutate_document handles `id`, `timestampUtcMs`, `scope`
                # defaults — the handler's action dicts only need `type`
                # and `input`.
                gql.mutate_document(new_id, scalars)
            if crossrefs:
                deferred[new_id] = crossrefs
            tag = f"[{i}/{len(docs)}]"
            print(f"  {tag} ✓ {d['type'][-20:]:>20s}  {(d['name'] or '')[:40]:40s}  +{len(scalars)} scalar  +{len(crossrefs)} ref")
            if args.throttle_ms > 0:
                time.sleep(args.throttle_ms / 1000)
        except Exception as e:
            failed.append((new_id, str(e)[:200]))
            print(f"  ✗ {d['name']} ({new_id}): {e}", file=sys.stderr)

    if failed:
        print(f"\n  ! Phase 3 had {len(failed)} failures", file=sys.stderr)
    return deferred


def phase_4_apply_crossrefs(deferred: dict[str, list[dict]]) -> None:
    print("\n━━━ Phase 4: cross-references ━━━")
    if not deferred:
        print("  (none)")
        return
    total = sum(len(a) for a in deferred.values())
    applied = 0
    failed: list[tuple[str, str]] = []
    for i, (doc_id, actions) in enumerate(deferred.items(), start=1):
        # Two dispatch paths for ADD_RELATIONSHIP:
        #
        # 1. Native `addRelationship(source, target, type)` GraphQL
        #    mutation — one HTTP call per ref. Produces a different sync
        #    envelope shape than dispatching ADD_RELATIONSHIP through the
        #    action queue, which may avoid the reactor-browser's
        #    `skip:1 CREATE_DOCUMENT` synthesis bug.
        #
        # 2. Fallback: route through `mutate_document` with the
        #    ADD_RELATIONSHIP action shape (the old behaviour). Cheaper
        #    network-wise (one call per source doc instead of N) but
        #    susceptible to the dead-letter pattern.
        #
        # We use path 1 to maximise the chance that the dead-letter bug
        # doesn't reproduce; the per-doc HTTP cost is negligible against
        # the python script's overall runtime.
        doc_failed = 0
        doc_applied = 0
        for a in actions:
            if a.get("type") == "ADD_RELATIONSHIP":
                inp = a.get("input") or {}
                # A cross-ref that reaches here without an explicit type
                # is a caller bug. Defaulting to "child" (the reactor's
                # drive-containment type) would silently exclude the edge
                # from the knowledge graph, since the graph indexer only
                # projects the seven knowledge relationship types. Fall
                # back to the weakest knowledge type and say so loudly.
                rel_type = inp.get("relationshipType")
                if not rel_type:
                    rel_type = "RELATES_TO"
                    print(
                        f"  WARN {doc_id} -> {inp['targetId']}: "
                        "ADD_RELATIONSHIP had no relationshipType; "
                        "defaulting to RELATES_TO"
                    )
                try:
                    gql.add_relationship(doc_id, inp["targetId"], rel_type)
                    doc_applied += 1
                except Exception as e:
                    doc_failed += 1
                    failed.append((doc_id, str(e)[:160]))
            else:
                # Non-RELATIONSHIP cross-refs (e.g. ADD_TENSION on MoCs)
                # — keep the mutateDocument path.
                try:
                    gql.mutate_document(doc_id, [a])
                    doc_applied += 1
                except Exception as e:
                    doc_failed += 1
                    failed.append((doc_id, str(e)[:160]))
        applied += doc_applied
        suffix = f" ({doc_failed} failed)" if doc_failed else ""
        print(f"  [{i}/{len(deferred)}] ✓ {doc_id} +{doc_applied} refs{suffix}")
    print(f"  → applied {applied}/{total} cross-ref actions ({len(failed)} failures)")
    for doc_id, msg in failed[:5]:
        print(f"    {doc_id}: {msg}", file=sys.stderr)


def main() -> int:
    args = parse_args()
    data_dir = Path(args.data)
    manifest = json.loads((data_dir / "manifest.json").read_text())
    # See IdMap: a mapping only means anything against the target it was
    # built for. Bind it here so a reused --data directory fails loudly
    # instead of skipping documents it never created on this reactor.
    target = f"{gql.SUPERGRAPH_ENDPOINT}#{getattr(args, 'existing_drive', None) or args.drive_name}"
    id_map = IdMap(data_dir / "id-map.json", target=target)

    print(f"[upload] data:        {data_dir}")
    print(f"[upload] drive name:  {args.drive_name}")
    print(f"[upload] folders:     {len(manifest['folders'])}")
    print(f"[upload] documents:   {len(manifest['documents'])}")
    print(f"[upload] id-map size: {len(id_map.all())} (resuming if non-zero)")

    drive_id, drive_slug = phase_1_create_drive_and_folders(args, manifest, id_map)
    phase_2_create_documents(args, manifest, id_map, drive_id)
    deferred = phase_3_apply_state(args, manifest, id_map, drive_id)
    phase_4_apply_crossrefs(deferred)

    # Write a final summary
    summary = {
        "driveId": drive_id,
        "driveSlug": drive_slug,
        "totalDocs": len(manifest["documents"]),
        "createdDocs": sum(1 for d in manifest["documents"] if id_map.get(d["id"])),
    }
    (data_dir / "upload-summary.json").write_text(json.dumps(summary, indent=2))
    print(f"\n[upload] done — drive: {drive_id} ({drive_slug})")
    print(f"[upload] created {summary['createdDocs']}/{summary['totalDocs']} documents")
    return 0


if __name__ == "__main__":
    sys.exit(main())
