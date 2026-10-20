"""Compare a live drive against the snapshot that produced it.

The rebuild is only trustworthy if it is checked against the source
rather than against the log of what we *dispatched* — a 502 whose
commit lands after the client gives up looks identical to a success in
a dispatch log, and that is exactly how the live vault ended up with a
MoC whose CREATE_MOC never applied.

Three independent checks:

  documents  every snapshot doc has a live counterpart of the same type
  fields     title / description / content / noteType / topics match
  edges      the relationship set matches after id remapping
"""
import json
from pathlib import Path
from typing import Callable

from .snapshot import build_state_query, chunks, fetch_edges, parse_state_batch

COMPARED_FIELDS = ("title", "description", "content", "noteType", "status")


def load_id_map(data: Path, manifest: dict) -> dict[str, str]:
    """Snapshot-id → live-id mapping.

    `upload` writes `id-map.json` because a replay assigns new ids. A
    snapshot taken *from* the drive being checked has no such file and
    needs none: its ids are already the live ids. Falling back to
    identity is what makes "verify a drive against a snapshot of itself"
    work, which is the shape of every post-reindex repair.
    """
    path = data / "id-map.json"
    if path.exists():
        return json.loads(path.read_text())
    return {d["id"]: d["id"] for d in manifest["documents"]}


def snapshot_edges(data: Path, manifest: dict) -> set[tuple[str, str, str]]:
    """(source, target, type) triples the snapshot says should exist."""
    edges: set[tuple[str, str, str]] = set()
    for doc in manifest["documents"]:
        path = data / "states" / f"{doc['id']}.json"
        if not path.exists():
            continue
        state = json.loads(path.read_text())
        for link in state.get("links") or []:
            target = link.get("targetDocumentId")
            if target:
                edges.add((doc["id"], target, link.get("linkType") or "RELATES_TO"))
        for ci in state.get("coreIdeas") or []:
            if ci.get("noteRef"):
                edges.add((doc["id"], ci["noteRef"], "CORE_IDEA"))
        for child in state.get("childRefs") or []:
            edges.add((doc["id"], child, "CHILD_MOC"))
    return edges


def live_states(gql, doc_ids: list[str], batch: int = 20) -> dict[str, dict]:
    out: dict[str, dict] = {}
    for group in chunks(doc_ids, batch):
        data = gql.post(build_state_query(group), endpoint=gql.READ_ENDPOINT, timeout=120)
        out.update(parse_state_batch(group, data))
    return out


def live_edges(gql, endpoint: str, drive_id: str) -> set[tuple[str, str, str]]:
    """Same single-query reader the snapshot uses, so the two sides can't
    be truncated into false agreement."""
    return {
        (src, tid, rel)
        for src, per_type in fetch_edges(gql, endpoint, drive_id).items()
        for rel, targets in per_type.items()
        for tid in targets
    }


def compare_fields(expected: dict, actual: dict) -> list[str]:
    diffs = []
    for field in COMPARED_FIELDS:
        want, got = expected.get(field), actual.get(field)
        # Absent-in-snapshot means the handler never emitted a setter, so
        # whatever the model's initial value is counts as a match.
        if not want:
            continue
        if want != got:
            diffs.append(
                f"{field}: expected {len(str(want))} chars, got "
                f"{len(str(got)) if got else 'nothing'}"
            )
    want_topics = len(expected.get("topics") or [])
    got_topics = len(actual.get("topics") or [])
    if want_topics != got_topics:
        diffs.append(f"topics: expected {want_topics}, got {got_topics}")
    return diffs


def verify(
    gql,
    endpoint: str,
    data: Path,
    drive: str,
    sample: int | None = None,
    log: Callable[[str], None] = print,
) -> dict:
    from .snapshot import fetch_drive, state_global

    data = Path(data)
    manifest = json.loads((data / "manifest.json").read_text())
    id_map = load_id_map(data, manifest)

    drive_doc = fetch_drive(gql, drive)
    nodes = (state_global(drive_doc).get("nodes")) or []
    live_by_id = {n["id"]: n for n in nodes if n.get("kind") == "file"}
    log(f"[verify] live drive {drive_doc.get('name')} — {len(live_by_id)} documents")

    # ── documents ───────────────────────────────────────────────────
    missing, mistyped, pairs = [], [], []
    for doc in manifest["documents"]:
        new_id = id_map.get(doc["id"])
        if not new_id or new_id not in live_by_id:
            missing.append(doc)
            continue
        if live_by_id[new_id].get("documentType") != doc["type"]:
            mistyped.append((doc, live_by_id[new_id].get("documentType")))
        pairs.append((doc, new_id))
    log(f"[verify] documents: {len(pairs)} matched, {len(missing)} missing, {len(mistyped)} wrong type")
    for doc in missing[:5]:
        log(f"    missing: {doc['type']} {doc['name'][:60]}")

    # ── fields ──────────────────────────────────────────────────────
    checked = pairs if sample is None else pairs[:sample]
    actual = live_states(gql, [nid for _, nid in checked])
    field_diffs: list[tuple[str, str, list[str]]] = []
    for doc, new_id in checked:
        path = data / "states" / f"{doc['id']}.json"
        if not path.exists():
            continue
        diffs = compare_fields(json.loads(path.read_text()), actual.get(new_id) or {})
        if diffs:
            field_diffs.append((doc["name"], new_id, diffs))
    log(f"[verify] fields: {len(checked) - len(field_diffs)}/{len(checked)} documents match")
    for name, new_id, diffs in field_diffs[:5]:
        log(f"    {name[:50]} ({new_id[:8]}): {'; '.join(diffs)}")

    # ── edges ───────────────────────────────────────────────────────
    expected_edges = {
        (id_map[s], id_map[t], rel)
        for s, t, rel in snapshot_edges(data, manifest)
        if s in id_map and t in id_map
    }
    found_edges = live_edges(gql, endpoint, drive_doc["id"])
    only_expected = expected_edges - found_edges
    only_found = found_edges - expected_edges
    log(
        f"[verify] edges: {len(expected_edges & found_edges)} matched, "
        f"{len(only_expected)} missing, {len(only_found)} unexpected"
    )
    by_type_missing: dict[str, int] = {}
    for _, _, rel in only_expected:
        by_type_missing[rel] = by_type_missing.get(rel, 0) + 1
    if by_type_missing:
        log(f"    missing by type: {json.dumps(by_type_missing, sort_keys=True)}")

    ok = not missing and not mistyped and not field_diffs and not only_expected
    log(f"[verify] {'PASS' if ok else 'FAIL'}")
    return {
        "ok": ok,
        "documents": {"matched": len(pairs), "missing": len(missing), "mistyped": len(mistyped)},
        "fields": {"checked": len(checked), "mismatched": len(field_diffs)},
        "edges": {
            "expected": len(expected_edges),
            "matched": len(expected_edges & found_edges),
            "missing": len(only_expected),
            "unexpected": len(only_found),
            "missingByType": by_type_missing,
        },
    }
