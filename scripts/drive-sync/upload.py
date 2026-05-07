#!/usr/bin/env python3
"""Phases 1-4: create drive, folders, documents on the active local switchboard,
and apply state via per-type handlers.

Pre-requisite: switchboard CLI's active profile must point to the local target.
The wrapper `upload.sh` enforces this with `assert_profile local`.

Output: writes id-map.json into the data dir as it progresses.

Usage:
    python3 scripts/drive-sync/upload.py \
        --data scripts/drive-sync/data/powerhouse-vault \
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
from handlers import (
    knowledge_note,
    moc as moc_handler,
    source as source_handler,
    knowledge_graph,
    pipeline_queue,
    health_report,
    vault_config,
)


HANDLERS = {
    "bai/knowledge-note": knowledge_note,
    "bai/moc": moc_handler,
    "bai/source": source_handler,
    "bai/knowledge-graph": knowledge_graph,
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
    "bai/knowledge-graph": 3,
    "bai/pipeline-queue": 4,
    "bai/health-report": 5,
    "bai/vault-config": 6,
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
    if args.existing_drive:
        drive_id = args.existing_drive
        out = sb.sb("drives", "get", drive_id)
        info = json.loads(out)
        drive_slug = info.get("slug", drive_id)
        print(f"  ✓ using existing drive: {info.get('name')} ({drive_id})")
    else:
        drive_id, drive_slug = sb.drives_create(args.drive_name, preferred_editor=args.preferred_editor)
        print(f"  ✓ created drive: {args.drive_name} ({drive_id}, slug={drive_slug}, editor={args.preferred_editor})")
    # Wait for drive to be queryable
    for attempt in range(5):
        time.sleep(1)
        try:
            sb.sb("drives", "get", drive_id)
            break
        except Exception:
            if attempt == 4:
                raise
    # Folders, parents-first
    sorted_folders = topo_sort_folders(manifest["folders"])
    actions = []
    for f in sorted_folders:
        new_id = str(uuid.uuid4())
        id_map.set(f["id"], new_id)
        inp: dict = {"id": new_id, "name": f["name"]}
        parent = f.get("parentFolder")
        if parent:
            inp["parentFolder"] = id_map.resolve(parent)
        actions.append({"type": "ADD_FOLDER", "input": inp, "scope": "global"})
    if actions:
        sb.apply_actions(drive_id, actions)
    print(f"  ✓ created {len(actions)} folders")
    return drive_id, drive_slug


def phase_2_create_documents(args, manifest: dict, id_map: IdMap, drive_id: str) -> None:
    print("\n━━━ Phase 2: create documents ━━━")
    docs = list(manifest["documents"])
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
        # CLI quoting: replace name if it could choke the CLI (commas, double-quotes).
        # Title is set later via setTitle in Phase 3, so this name is purely a placeholder.
        safe_name = d["name"]
        if any(ch in safe_name for ch in (",", '"', "\\")):
            safe_name = "doc-" + d["id"][:8]
        try:
            new_id = sb.docs_create(d["type"], safe_name, drive_id)
            id_map.set(d["id"], new_id)
            print(f"  [{i}/{len(docs)}] ✓ {d['type']:24s} {safe_name[:50]} → {new_id}")
        except Exception as e:
            failed.append((d["id"], str(e)[:200]))
            print(f"  [{i}/{len(docs)}] ✗ {d['type']} {d['name'][:50]} — {e}", file=sys.stderr)

    if failed:
        print(f"\n  ! Phase 2 had {len(failed)} failures (re-run upload to retry — already-created docs are skipped):", file=sys.stderr)
        for did, msg in failed[:10]:
            print(f"    {did}: {msg}", file=sys.stderr)

    # MOVE_NODE batch: place each doc into its remapped parent folder
    move_actions = []
    for d in manifest["documents"]:
        new_doc = id_map.get(d["id"])
        parent_old = d.get("parentFolder")
        if not new_doc or not parent_old:
            continue
        new_parent = id_map.get(parent_old)
        if not new_parent:
            continue
        move_actions.append({
            "type": "MOVE_NODE",
            "input": {"srcFolder": new_doc, "targetParentFolder": new_parent},
            "scope": "global",
        })
    if move_actions:
        sb.apply_actions(drive_id, move_actions)
        print(f"  ✓ placed {len(move_actions)} docs into folders")


def phase_3_apply_state(args, manifest: dict, id_map: IdMap, drive_id: str) -> dict:
    """Apply scalar (non-cross-ref) actions per doc. Returns a dict of
    {new_doc_id: [crossref_actions]} for use in Phase 4."""
    print("\n━━━ Phase 3: apply state ━━━")
    deferred: dict[str, list[dict]] = {}
    failed: list[tuple[str, str]] = []
    data = Path(args.data)

    # Re-sort with same key as Phase 2 so dependent state lands in order.
    docs = list(manifest["documents"])
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
                sb.apply_actions(new_id, scalars)
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
        try:
            sb.apply_actions(doc_id, actions)
            applied += len(actions)
            print(f"  [{i}/{len(deferred)}] ✓ {doc_id} +{len(actions)} refs")
        except Exception as e:
            failed.append((doc_id, str(e)[:200]))
            print(f"  ✗ {doc_id}: {e}", file=sys.stderr)
    print(f"  → applied {applied}/{total} cross-ref actions")


def main() -> int:
    args = parse_args()
    data_dir = Path(args.data)
    manifest = json.loads((data_dir / "manifest.json").read_text())
    id_map = IdMap(data_dir / "id-map.json")

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
