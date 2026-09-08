"""bai/wbs handler — a work-breakdown goal tree.

`goals` is a flat list carrying `parentId`, so it has to be emitted
parents-first: `CREATE_GOAL` resolves its `parentId` against goals that
already exist and a child sent early is rejected. `sort_goals_for_creation`
does that ordering, breaking cycles by visit-once (a self-parent or a cycle
survives as a root rather than failing the document).

Goal ids are **intra-document OIDs, not document ids**, so they are restored
verbatim and never passed through `id_map`. That is what makes a scope of
work's `goalRef` valid again after its WBS is restored — the reference is to
a goal id that this handler preserves exactly.

Only two fields are document references: `projectRef` and `sowRef`, both
remapped. `sowProjectId` is an envelope id *inside* the scope of work, so it
travels verbatim alongside `sowRef`.

Status is a separate operation from creation: `CREATE_GOAL` starts a goal in
its default state, and `SET_GOAL_STATUS` moves it, carrying `blockReason` for
BLOCKED and `outcome` for a terminal status.
"""

from lib.id_map import IdMap


def _act(op_type: str, input_data: dict) -> dict:
    return {"type": op_type, "input": input_data, "scope": "global"}


def sort_goals_for_creation(goals: list[dict]) -> list[dict]:
    """Order goals so every parent precedes its children."""
    by_id = {g["id"]: g for g in goals if g.get("id")}
    visited: set[str] = set()
    order: list[dict] = []

    def visit(gid: str) -> None:
        if gid in visited or gid not in by_id:
            return
        visited.add(gid)
        parent = by_id[gid].get("parentId")
        if parent and parent in by_id and parent != gid:
            visit(parent)
        order.append(by_id[gid])

    for g in goals:
        if g.get("id"):
            visit(g["id"])
    return order


def build_actions(
    state: dict,
    id_map: IdMap,
    drop_unmapped: bool = False,
) -> tuple[list[dict], list[dict]]:
    scalar: list[dict] = []
    crossref: list[dict] = []

    if state.get("owner"):
        scalar.append(_act("SET_OWNER", {"owner": state["owner"]}))
    if state.get("references"):
        scalar.append(_act("SET_REFERENCES", {"references": state["references"]}))

    goals = sort_goals_for_creation(state.get("goals") or [])
    for g in goals:
        gid = g["id"]
        create = {"id": gid, "description": g.get("description") or ""}
        # A parentId pointing outside this document would be rejected; the
        # sort above guarantees an in-document parent already exists.
        if g.get("parentId"):
            create["parentId"] = g["parentId"]
        if g.get("assignee"):
            create["assignee"] = g["assignee"]
        scalar.append(_act("CREATE_GOAL", create))

        if g.get("status"):
            st = {"id": gid, "status": g["status"]}
            if g.get("blockReason"):
                st["blockReason"] = g["blockReason"]
            if g.get("outcome"):
                st["outcome"] = g["outcome"]
            scalar.append(_act("SET_GOAL_STATUS", st))
        elif g.get("outcome"):
            scalar.append(_act("SET_OUTCOME", {"id": gid, "outcome": g["outcome"]}))

        for n in g.get("notes") or []:
            note = {"goalId": gid, "noteId": n["id"], "note": n.get("note") or ""}
            if n.get("author"):
                note["author"] = n["author"]
            if n.get("timestamp"):
                note["timestamp"] = n["timestamp"]
            scalar.append(_act("ADD_NOTE", note))

    # Dependencies reference sibling goals, so every goal must exist first.
    for g in goals:
        deps = [d for d in (g.get("dependencies") or []) if d]
        if deps:
            scalar.append(_act("ADD_DEPENDENCIES", {"id": g["id"], "dependencies": deps}))

    # Document-to-document references, remapped.
    project_new = id_map.get(state["projectRef"]) if state.get("projectRef") else None
    if project_new:
        crossref.append(_act("SET_PROJECT_REF", {"projectRef": project_new}))
    sow_new = id_map.get(state["sowRef"]) if state.get("sowRef") else None
    if sow_new:
        # sowProjectId is an envelope id inside that scope of work — verbatim.
        inp = {"sowRef": sow_new}
        if state.get("sowProjectId"):
            inp["sowProjectId"] = state["sowProjectId"]
        crossref.append(_act("SET_SOW_PROJECT_REF", inp))

    return scalar, crossref


def apply(doc_id: str, state: dict, id_map: IdMap, sb_module) -> int:
    scalars, _ = build_actions(state, id_map, drop_unmapped=True)
    if scalars:
        sb_module.apply_actions(doc_id, scalars)
    return len(scalars)
