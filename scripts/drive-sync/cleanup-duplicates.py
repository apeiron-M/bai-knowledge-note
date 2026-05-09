#!/usr/bin/env python3
"""One-off cleanup: remove duplicate folders + singleton documents from a
drive that vault-init populated on top of an existing layout.

Logic:
- Folders whose name matches `<name> (copy) N` are deleted (and their
  subtrees pruned by the reactor automatically). Their original
  counterpart (without the suffix) is kept.
- Among singleton documents (one-of-each types: bai/knowledge-graph,
  bai/pipeline-queue, bai/health-report, bai/vault-config), keep the
  oldest one (by id alphabetic — stable, deterministic) and delete
  the rest.

Usage:
    python3 scripts/drive-sync/cleanup-duplicates.py --drive my-fav-vault
"""
import argparse
import json
import re
import subprocess
import sys
import time

SINGLETON_TYPES = {
    "bai/knowledge-graph",
    "bai/pipeline-queue",
    "bai/health-report",
    "bai/vault-config",
}

COPY_SUFFIX = re.compile(r"\s*\(copy\)\s*\d+\s*$", re.IGNORECASE)


def sb(*args: str) -> str:
    cmd = ["switchboard", *args, "--format", "json"]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
    if r.returncode != 0:
        raise RuntimeError(f"command failed: {' '.join(cmd)}\n{r.stderr[:500]}")
    return r.stdout


def get_tree(drive: str) -> list[dict]:
    out = sb("docs", "tree", drive)
    data = json.loads(out)
    try:
        return data["document"]["state"]["global"]["nodes"]
    except (KeyError, TypeError):
        return data.get("nodes", [])


def delete_nodes(drive: str, ids: list[str]) -> None:
    if not ids:
        return
    actions = [
        {
            "type": "DELETE_NODE",
            "input": {"id": node_id},
            "scope": "global",
        }
        for node_id in ids
    ]
    import tempfile, os, uuid, datetime
    iso = (
        datetime.datetime.now(datetime.timezone.utc)
        .strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3]
        + "Z"
    )
    for a in actions:
        a["id"] = str(uuid.uuid4())
        a["timestampUtcMs"] = iso

    with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
        json.dump(actions, f)
        path = f.name
    try:
        r = subprocess.run(
            [
                "switchboard",
                "docs",
                "apply",
                drive,
                "--file",
                path,
                "--wait",
                "--format",
                "json",
            ],
            capture_output=True,
            text=True,
            timeout=120,
        )
        if r.returncode != 0:
            raise RuntimeError(f"delete batch failed: {r.stderr[:500]}")
    finally:
        os.unlink(path)


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--drive", required=True)
    p.add_argument("--dry-run", action="store_true")
    args = p.parse_args()

    nodes = get_tree(args.drive)
    folders = [n for n in nodes if n.get("kind") == "folder"]
    files = [n for n in nodes if n.get("kind") == "file"]

    # Phase 1: identify "(copy) N" folders.
    copy_folders = [f for f in folders if COPY_SUFFIX.search(f["name"])]
    copy_folder_ids = {f["id"] for f in copy_folders}

    # Phase 2: also include any folder/file whose ancestor is a "(copy)" folder.
    # The reactor's DELETE_NODE may or may not cascade — explicitly enumerate.
    folder_by_id = {f["id"]: f for f in folders}

    def ancestors(node):
        cur = node
        while cur:
            yield cur
            parent_id = cur.get("parentFolder")
            cur = folder_by_id.get(parent_id) if parent_id else None

    ids_under_copy: set[str] = set()
    for n in nodes:
        for anc in ancestors(n):
            if anc["id"] in copy_folder_ids:
                ids_under_copy.add(n["id"])
                break

    # Phase 3: duplicate singletons among files NOT already scheduled for
    # deletion via the (copy) subtree pass. Otherwise we'd risk picking
    # an under-copy doc as "the keeper" and then also deleting it via the
    # subtree pass — wiping the type entirely from the drive.
    surviving = [f for f in files if f["id"] not in ids_under_copy]
    singletons_by_type: dict[str, list[dict]] = {}
    for f in surviving:
        t = f.get("documentType")
        if t in SINGLETON_TYPES:
            singletons_by_type.setdefault(t, []).append(f)

    duplicate_singleton_ids: set[str] = set()
    for t, group in singletons_by_type.items():
        if len(group) <= 1:
            continue
        group_sorted = sorted(group, key=lambda x: x["id"])
        for dup in group_sorted[1:]:
            duplicate_singleton_ids.add(dup["id"])

    to_delete = ids_under_copy | duplicate_singleton_ids

    print(f"[cleanup] drive: {args.drive}")
    print(f"[cleanup] (copy) folders: {len(copy_folders)}")
    print(f"[cleanup] nodes under (copy) subtrees: {len(ids_under_copy)}")
    print(f"[cleanup] duplicate singletons: {len(duplicate_singleton_ids)}")
    print(f"[cleanup] total nodes to delete: {len(to_delete)}")
    if not to_delete:
        print("[cleanup] nothing to do")
        return 0

    if args.dry_run:
        print("[cleanup] DRY RUN — no changes")
        return 0

    # Reactor batches are best kept small to avoid wait timeouts.
    batch = 30
    ids = list(to_delete)
    for i in range(0, len(ids), batch):
        chunk = ids[i : i + batch]
        try:
            delete_nodes(args.drive, chunk)
            print(f"  deleted {min(i+batch, len(ids))}/{len(ids)}")
        except Exception as e:
            print(f"  ✗ batch {i}: {e}", file=sys.stderr)
        time.sleep(0.3)

    print("[cleanup] done")
    return 0


if __name__ == "__main__":
    sys.exit(main())
