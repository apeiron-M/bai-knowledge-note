"""bai/tension handler.

A tension records a contradiction between claims. Restoring one is almost
all scalar work — `CREATE_TENSION` carries the whole thing — plus the
terminal transition, because status is not a settable field: `RESOLVE_TENSION`
(one side was right) and `DISSOLVE_TENSION` (both turned out compatible) are
the only ways to leave OPEN, and each demands the resolution text.

`involvedRefs` are vault document ids and go through `id_map`. They are also
where the graph's `INVOLVES` edges come from — the indexer derives them from
this state rather than from a relationship row — so a ref dropped here is an
edge that never appears.

One ordering note for whole-vault restores: the graph-indexer opens a tension
of its own for every `CONTRADICTS` pair not already covered by one. Because
`upload.py` creates documents (Phase 2/3) before it writes relationships
(Phase 4), a clean run installs these tensions first and the indexer then
suppresses its own. Restoring into a drive that *already* carries
indexer-created tensions duplicates the overlapping pairs instead.
"""

from lib.id_map import IdMap


def _act(op_type: str, input_data: dict) -> dict:
    return {"type": op_type, "input": input_data, "scope": "global"}


def build_actions(
    state: dict,
    id_map: IdMap,
    drop_unmapped: bool = False,
) -> tuple[list[dict], list[dict]]:
    scalar: list[dict] = []
    crossref: list[dict] = []

    refs: list[str] = []
    for r in state.get("involvedRefs") or []:
        new = id_map.get(r)
        if new is None:
            if drop_unmapped:
                continue
            new = r
        refs.append(new)

    create = {
        "title": state.get("title") or "",
        "description": state.get("description") or "",
        # CREATE_TENSION takes involvedRefs inline; anything that only
        # resolves later is added by ADD_INVOLVED_REF in Phase 4.
        "involvedRefs": refs,
        "observedAt": state.get("observedAt") or "1970-01-01T00:00:00.000Z",
    }
    if state.get("content"):
        create["content"] = state["content"]
    if state.get("observedBy"):
        create["observedBy"] = state["observedBy"]
    scalar.append(_act("CREATE_TENSION", create))

    # Status is derived from the terminal transition, never assigned.
    status = state.get("status")
    if status in ("RESOLVED", "DISSOLVED"):
        op = "RESOLVE_TENSION" if status == "RESOLVED" else "DISSOLVE_TENSION"
        scalar.append(_act(op, {
            "resolution": state.get("resolution") or "",
            "resolvedAt": (state.get("resolvedAt") or state.get("observedAt")
                           or "1970-01-01T00:00:00.000Z"),
        }))

    return scalar, crossref


def apply(doc_id: str, state: dict, id_map: IdMap, sb_module) -> int:
    scalars, _ = build_actions(state, id_map, drop_unmapped=True)
    if scalars:
        sb_module.apply_actions(doc_id, scalars)
    return len(scalars)
