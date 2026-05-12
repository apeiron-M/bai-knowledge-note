"""Translates bai/knowledge-note state into a sequence of action dicts.

Two return lists:
  - scalar_actions: applied in Phase 3 (no cross-doc refs).
  - crossref_actions: applied in Phase 4 after all docs exist.
"""
import datetime
from typing import Optional

from lib.id_map import IdMap


METADATA_SCALAR_FIELDS = [
    "scope", "confidence", "severity", "editor", "modelId", "version",
    "filePath", "computes", "context", "decisionStatus", "model",
    "sourceType", "targetType", "relationType", "cardinality",
    "errorMessage", "rootCause", "correctPattern",
]

METADATA_LIST_FIELDS = [
    "models", "hooksUsed", "dispatchTargets", "modules",
    "inputs", "outputs", "consumedBy", "alternatives", "consequences",
]


def _now_iso() -> str:
    n = datetime.datetime.now(datetime.timezone.utc)
    return n.strftime("%Y-%m-%dT%H:%M:%S.000Z")


def _act(op_type: str, input_data: dict) -> dict:
    return {"type": op_type, "input": input_data, "scope": "global"}


def build_actions(
    state: dict,
    id_map: IdMap,
    drop_unmapped: bool = False,
) -> tuple[list[dict], list[dict]]:
    """Return (scalar_actions, crossref_actions) for one knowledge-note state."""
    scalar: list[dict] = []
    crossref: list[dict] = []
    now = _now_iso()

    # Title / description / noteType / content — only emit if present and non-empty
    if state.get("title"):
        scalar.append(_act("SET_TITLE", {"title": state["title"], "updatedAt": now}))
    if state.get("description"):
        scalar.append(_act("SET_DESCRIPTION", {"description": state["description"], "updatedAt": now}))
    if state.get("noteType"):
        scalar.append(_act("SET_NOTE_TYPE", {"noteType": state["noteType"], "updatedAt": now}))
    if state.get("content"):
        scalar.append(_act("SET_CONTENT", {"content": state["content"], "updatedAt": now}))

    # Metadata scalar fields
    for f in METADATA_SCALAR_FIELDS:
        v = state.get(f)
        if v is not None and v != "":
            scalar.append(_act("SET_METADATA_FIELD", {"field": f, "value": v, "updatedAt": now}))

    # Metadata list fields
    for f in METADATA_LIST_FIELDS:
        v = state.get(f)
        if v:
            scalar.append(_act("SET_METADATA_LIST_FIELD", {"field": f, "values": list(v), "updatedAt": now}))

    # Provenance
    prov = state.get("provenance")
    if prov and (prov.get("author") or prov.get("sourceOrigin")):
        inp = {
            "author": prov.get("author") or "unknown",
            "sourceOrigin": prov.get("sourceOrigin") or "MANUAL",
            "createdAt": prov.get("createdAt") or now,
        }
        if prov.get("sessionId"):
            inp["sessionId"] = prov["sessionId"]
        scalar.append(_act("SET_PROVENANCE", inp))

    # Topics: emitted in scalar phase. `topicDocumentId` is `String` (not OID/PHID)
    # in the schema — opaque, not validated as a real cross-ref. When it does
    # happen to point to another doc, remap is safe here because Phase 2 in
    # upload.py finishes creating ALL docs before Phase 3 starts, so id_map is
    # fully populated by the time any handler runs.
    for t in state.get("topics") or []:
        inp: dict = {"id": t["id"], "name": t.get("name") or ""}
        tdoc = t.get("topicDocumentId")
        if tdoc is not None:
            inp["topicDocumentId"] = id_map.resolve(tdoc)
        else:
            inp["topicDocumentId"] = None
        scalar.append(_act("ADD_TOPIC", inp))

    # Links — dispatched as reactor-native ADD_RELATIONSHIP system actions
    # (scope: "document"). Phase 4 fills in sourceId at dispatch time so the
    # action input matches the dispatch target. The reactor writes one row to
    # DocumentRelationship per action and `documentOutgoingRelationships`
    # serves the read path — no per-note state bloat.
    for ln in state.get("links") or []:
        target_old = ln.get("targetDocumentId")
        target_new = id_map.get(target_old) if target_old else None
        if target_new is None:
            if drop_unmapped:
                continue
            target_new = target_old
        crossref.append({
            "type": "ADD_RELATIONSHIP",
            "scope": "document",
            "input": {
                # sourceId injected by upload.py phase 4
                "targetId": target_new,
                "relationshipType": ln.get("linkType") or "RELATES_TO",
            },
        })

    return scalar, crossref


def apply(doc_id: str, state: dict, id_map: IdMap, sb_module) -> int:
    """IO wrapper: builds scalar actions and dispatches via apply_actions.
    Returns the number of scalar actions applied. Cross-refs are returned
    by build_actions but applied separately in Phase 4."""
    scalars, _ = build_actions(state, id_map, drop_unmapped=True)
    if scalars:
        sb_module.apply_actions(doc_id, scalars)
    return len(scalars)
