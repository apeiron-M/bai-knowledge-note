"""Replay a snapshot into a target reactor.

This is a thin driver over `drive-sync/upload.py`'s four phases rather
than a reimplementation — that code already handles folder reuse,
singleton adoption, MoC parent-before-child ordering, and resume via
id-map.json. We add three Atlas-specific things:

  1. Register the `bai/tension` handler (drive-sync has no such type).
  2. Optionally drop relationship types from the replay, so a rebuild
     can restore the structural graph (DERIVED_FROM / CORE_IDEA /
     CHILD_MOC) without re-adding the 4,396 similarity edges that were
     purged from the live drive.
  3. Emit a machine-readable summary for `atlas.py verify`.

The resulting op history per document is linear — create, move, one
state batch, then N addRelationship calls, with no removes.
"""
import json
from argparse import Namespace
from pathlib import Path
from typing import Callable

from . import instrument_connections
from . import pipeline_queue as queue_handler
from . import source as source_handler
from . import tension as tension_handler

STRUCTURAL_LINK_TYPES = ("DERIVED_FROM", "CORE_IDEA", "CHILD_MOC")


def register_handlers(upload):
    """Teach drive-sync's upload module about bai/tension."""
    upload.HANDLERS["bai/tension"] = tension_handler
    # Override drive-sync's handlers with the de-duplicating ones.
    upload.HANDLERS["bai/source"] = source_handler
    upload.HANDLERS["bai/pipeline-queue"] = queue_handler
    # Tensions cite notes, so they must be created after them. Notes are
    # rank 1 and mocs rank 2; 6 puts tensions last among known types.
    upload.TYPE_ORDER.setdefault("bai/tension", 6)
    return upload


def filter_crossrefs(
    deferred: dict[str, list[dict]],
    allow: tuple[str, ...] | None,
) -> tuple[dict[str, list[dict]], dict[str, int]]:
    """Keep only ADD_RELATIONSHIP actions whose type is in `allow`.

    `allow=None` keeps everything. Non-relationship cross-refs (e.g. a
    MoC's ADD_TENSION, a Source's ADD_EXTRACTED_CLAIM) are always kept —
    they carry state, not graph edges.
    """
    dropped: dict[str, int] = {}
    if allow is None:
        return deferred, dropped
    out: dict[str, list[dict]] = {}
    for doc_id, actions in deferred.items():
        kept = []
        for a in actions:
            if a.get("type") == "ADD_RELATIONSHIP":
                rel = (a.get("input") or {}).get("relationshipType") or "RELATES_TO"
                if rel not in allow:
                    dropped[rel] = dropped.get(rel, 0) + 1
                    continue
            kept.append(a)
        if kept:
            out[doc_id] = kept
    return out, dropped


def upload(
    endpoint: str,
    data: Path,
    drive_name: str = "Atlas Vault",
    existing_drive: str | None = None,
    preferred_editor: str = "knowledge-vault",
    throttle_ms: int = 0,
    link_types: tuple[str, ...] | None = None,
    log: Callable[[str], None] = print,
) -> dict:
    import upload as upload_mod  # drive-sync/upload.py, on sys.path via atlaslib

    register_handlers(upload_mod)

    from lib import gql
    from lib.id_map import IdMap

    conns = instrument_connections(gql)

    data = Path(data)
    manifest = json.loads((data / "manifest.json").read_text())
    # Scope the id-map to this exact reactor+drive. Reusing a snapshot
    # directory across targets silently skips every document that the
    # PREVIOUS target created, which is indistinguishable from success
    # until phase 3 starts mutating ids that do not exist here.
    target = f"{endpoint}#{existing_drive or drive_name or 'new-drive'}"
    id_map = IdMap(data / "id-map.json", target=target)

    args = Namespace(
        data=str(data),
        drive_name=drive_name,
        preferred_editor=preferred_editor,
        existing_drive=existing_drive,
        throttle_ms=throttle_ms,
    )

    log(f"[upload] endpoint:   {endpoint}")
    log(f"[upload] data:       {data}")
    log(f"[upload] folders:    {len(manifest['folders'])}")
    log(f"[upload] documents:  {len(manifest['documents'])}")
    log(f"[upload] id-map:     {len(id_map.all())} entries (resuming if non-zero)")
    log(f"[upload] link types: {'all' if link_types is None else ', '.join(link_types)}")

    drive_id, drive_slug = upload_mod.phase_1_create_drive_and_folders(args, manifest, id_map)
    upload_mod.phase_2_create_documents(args, manifest, id_map, drive_id)
    deferred = upload_mod.phase_3_apply_state(args, manifest, id_map, drive_id)

    deferred, dropped = filter_crossrefs(deferred, link_types)
    if dropped:
        log(f"[upload] skipped edge types: {json.dumps(dropped, sort_keys=True)}")

    upload_mod.phase_4_apply_crossrefs(deferred)

    summary = {
        "endpoint": endpoint,
        "driveId": drive_id,
        "driveSlug": drive_slug,
        "totalDocs": len(manifest["documents"]),
        "createdDocs": sum(1 for d in manifest["documents"] if id_map.get(d["id"])),
        "linkTypes": list(link_types) if link_types else "all",
        "skippedEdges": dropped,
    }
    (data / "upload-summary.json").write_text(json.dumps(summary, indent=2))
    summary["transport"] = dict(conns)
    (data / "upload-summary.json").write_text(json.dumps(summary, indent=2))
    log(f"\n[upload] done — drive {drive_id} ({drive_slug})")
    log(f"[upload] created {summary['createdDocs']}/{summary['totalDocs']} documents")
    log(
        f"[upload] transport: {conns['requests']} requests over "
        f"{conns['opened']} connection(s), {conns['reconnects']} reconnect(s)"
    )
    return summary


def repair_edges(
    gql,
    endpoint: str,
    data: Path,
    drive_id: str,
    log: Callable[[str], None] = print,
) -> dict:
    """Re-dispatch the edges the live graph projection is missing.

    Needed because `knowledgeGraphReindex` is lossy: it rebuilds
    `graph_edges` through the same read path that clamps at 100 rows per
    (source, type), so every MoC with more than 100 core ideas comes back
    truncated. A drive that verified clean before a reindex will fail
    after one. The `DocumentRelationship` rows survive — only the
    projection is damaged — and re-sending `addRelationship` re-triggers
    the incremental indexer, which is not truncated.

    Only relationships are re-sent. `ADD_EXTRACTED_CLAIM` is *not*
    idempotent (it appends unconditionally, with no removal operation),
    so replaying a whole phase 4 would duplicate every claim.
    """
    import json as _json

    from .verify import live_edges, load_id_map, snapshot_edges

    manifest = _json.loads((Path(data) / "manifest.json").read_text())
    id_map = load_id_map(Path(data), manifest)

    expected = {
        (id_map[s], id_map[t], rel)
        for s, t, rel in snapshot_edges(Path(data), manifest)
        if s in id_map and t in id_map
    }
    missing = sorted(expected - live_edges(gql, endpoint, drive_id))
    if not missing:
        log("[repair] nothing to do — live graph already matches the snapshot")
        return {"missing": 0, "restored": 0, "failed": 0}

    by_type: dict[str, int] = {}
    for _, _, rel in missing:
        by_type[rel] = by_type.get(rel, 0) + 1
    log(f"[repair] {len(missing)} missing edge(s): {_json.dumps(by_type, sort_keys=True)}")

    restored, failures = 0, []
    for i, (src, tgt, rel) in enumerate(missing, start=1):
        try:
            gql.add_relationship(src, tgt, rel)
            restored += 1
        except Exception as exc:  # noqa: BLE001 — report, don't abort the batch
            failures.append((src, tgt, rel, str(exc)[:120]))
        if i % 250 == 0:
            log(f"  {i}/{len(missing)}")

    log(f"[repair] restored {restored}/{len(missing)} ({len(failures)} failed)")
    for src, tgt, rel, msg in failures[:5]:
        log(f"    {src[:8]} -{rel}-> {tgt[:8]}: {msg}")
    return {"missing": len(missing), "restored": restored, "failed": len(failures)}
