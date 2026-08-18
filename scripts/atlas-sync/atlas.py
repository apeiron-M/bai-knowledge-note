#!/usr/bin/env python3
"""atlas-sync — snapshot, rebuild and verify the Atlas knowledge vault.

    # snapshot the live remote vault to disk
    python3 scripts/atlas-sync/atlas.py download --from remote

    # rebuild it on the local reactor (structural edges only)
    python3 scripts/atlas-sync/atlas.py upload --to local --structural-only

    # prove the rebuild matches the snapshot
    python3 scripts/atlas-sync/atlas.py verify --at local

Targets are named (`local`, `remote`) so a rebuild can't be pointed at
the wrong reactor by a mistyped URL; a full https:// URL is also
accepted.
"""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from atlaslib import DEFAULT_DATA, DRIVES, TARGETS, resolve_endpoint, use_endpoint
from atlaslib.push import STRUCTURAL_LINK_TYPES


def _drive_for(target: str, explicit: str | None, data: Path) -> str:
    if explicit:
        return explicit
    if target in DRIVES:
        return DRIVES[target]
    summary = data / "upload-summary.json"
    if summary.exists():
        drive_id = json.loads(summary.read_text()).get("driveId")
        if drive_id:
            return drive_id
    raise SystemExit(
        f"no drive known for target {target!r} — pass --drive <uuid> "
        f"(or run `upload` first so upload-summary.json records one)"
    )


def cmd_download(args) -> int:
    from atlaslib.snapshot import download

    endpoint = resolve_endpoint(args.source)
    gql = use_endpoint(endpoint)
    drive = _drive_for(args.source, args.drive, Path(args.out))
    download(gql, endpoint, drive, Path(args.out), batch=args.batch)
    return 0


def cmd_upload(args) -> int:
    from atlaslib.push import upload

    endpoint = resolve_endpoint(args.target)
    use_endpoint(endpoint)
    link_types = None
    if args.structural_only:
        link_types = STRUCTURAL_LINK_TYPES
    elif args.link_types:
        link_types = tuple(t.strip().upper() for t in args.link_types.split(",") if t.strip())
    upload(
        endpoint=endpoint,
        data=Path(args.data),
        drive_name=args.drive_name,
        existing_drive=args.existing_drive,
        preferred_editor=args.preferred_editor,
        throttle_ms=args.throttle_ms,
        link_types=link_types,
    )
    return 0


def cmd_verify(args) -> int:
    from atlaslib.verify import verify

    endpoint = resolve_endpoint(args.target)
    gql = use_endpoint(endpoint)
    data = Path(args.data)
    drive = _drive_for(args.target, args.drive, data)
    result = verify(gql, endpoint, data, drive, sample=args.sample)
    return 0 if result["ok"] else 1


def cmd_repair(args) -> int:
    from atlaslib.push import repair_edges

    endpoint = resolve_endpoint(args.target)
    gql = use_endpoint(endpoint)
    data = Path(args.data)
    drive = _drive_for(args.target, args.drive, data)
    result = repair_edges(gql, endpoint, data, drive)
    return 0 if result["failed"] == 0 else 1


def cmd_stats(args) -> int:
    """Counts straight off a live drive — the cheapest sanity check."""
    import collections

    from atlaslib.snapshot import fetch_drive, state_global

    endpoint = resolve_endpoint(args.target)
    gql = use_endpoint(endpoint)
    drive = _drive_for(args.target, args.drive, Path(args.data))
    drive_doc = fetch_drive(gql, drive)
    nodes = (state_global(drive_doc).get("nodes")) or []
    files = [n for n in nodes if n.get("kind") == "file"]
    folders = [n for n in nodes if n.get("kind") == "folder"]
    print(f"drive:     {drive_doc.get('name')} ({drive_doc['id']})")
    print(f"endpoint:  {endpoint}")
    print(f"folders:   {len(folders)}")
    print(f"documents: {len(files)}")
    for doc_type, count in sorted(
        collections.Counter(f.get("documentType") for f in files).items()
    ):
        print(f"  {doc_type:24s} {count}")
    return 0


def cmd_reindex(args) -> int:
    endpoint = resolve_endpoint(args.target)
    gql = use_endpoint(endpoint)
    drive = _drive_for(args.target, args.drive, Path(args.data))
    data = gql.post(
        # driveId is ID!, not String! — the subgraph rejects String!
        "mutation($id: ID!){ knowledgeGraphReindex(driveId:$id)"
        "{ indexedNodes indexedEdges errors } }",
        {"id": drive},
        endpoint=endpoint + "/knowledgeGraph",
        timeout=300,
    )
    print(json.dumps(data.get("knowledgeGraphReindex"), indent=2))
    return 0


def main() -> int:
    p = argparse.ArgumentParser(
        prog="atlas.py",
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument(
        "--data",
        default=str(DEFAULT_DATA),
        help=f"dataset directory (default: {DEFAULT_DATA})",
    )
    sub = p.add_subparsers(dest="command", required=True)

    d = sub.add_parser("download", help="snapshot a live drive to disk")
    d.add_argument("--from", dest="source", default="remote", help=f"{sorted(TARGETS)} or URL")
    d.add_argument("--drive", default=None)
    d.add_argument("--out", default=str(DEFAULT_DATA))
    d.add_argument("--batch", type=int, default=20, help="documents per GraphQL request")
    d.set_defaults(func=cmd_download)

    u = sub.add_parser("upload", help="replay a snapshot into a reactor")
    u.add_argument("--to", dest="target", required=True, help=f"{sorted(TARGETS)} or URL")
    u.add_argument("--drive-name", default="Atlas Vault")
    u.add_argument("--existing-drive", default=None, help="upload into this drive instead of creating one")
    u.add_argument("--preferred-editor", default="knowledge-vault")
    u.add_argument("--throttle-ms", type=int, default=0)
    u.add_argument(
        "--structural-only",
        action="store_true",
        help=f"replay only {', '.join(STRUCTURAL_LINK_TYPES)} edges",
    )
    u.add_argument("--link-types", default=None, help="comma-separated relationship allow-list")
    u.set_defaults(func=cmd_upload)

    v = sub.add_parser("verify", help="diff a live drive against the snapshot")
    v.add_argument("--at", dest="target", required=True)
    v.add_argument("--drive", default=None)
    v.add_argument("--sample", type=int, default=None, help="only field-check the first N docs")
    v.set_defaults(func=cmd_verify)

    rp = sub.add_parser("repair", help="re-dispatch edges missing from the graph projection")
    rp.add_argument("--at", dest="target", required=True)
    rp.add_argument("--drive", default=None)
    rp.set_defaults(func=cmd_repair)

    s = sub.add_parser("stats", help="document counts on a live drive")
    s.add_argument("--at", dest="target", required=True)
    s.add_argument("--drive", default=None)
    s.set_defaults(func=cmd_stats)

    r = sub.add_parser("reindex", help="rebuild the graph projection from the relationship table")
    r.add_argument("--at", dest="target", required=True)
    r.add_argument("--drive", default=None)
    r.add_argument(
        "--force",
        action="store_true",
        help="accepted for compatibility; reindex no longer needs acknowledging",
    )
    r.set_defaults(func=cmd_reindex)

    args = p.parse_args()
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
