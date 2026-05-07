"""bai/moc handler."""
import datetime

from lib.id_map import IdMap


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
    scalar: list[dict] = []
    crossref: list[dict] = []
    now = _now_iso()

    # createMoc must come first; tier is required by schema (default TOPIC)
    create_input = {
        "title": state.get("title") or "",
        "description": state.get("description") or "",
        "orientation": state.get("orientation") or "",
        "tier": state.get("tier") or "TOPIC",
        "createdAt": (state.get("createdAt") or now),
    }
    parent_ref = state.get("parentRef")
    if parent_ref:
        # ParentRef points to another moc — by Phase 3 ordering it should be in id_map
        create_input["parentRef"] = id_map.resolve(parent_ref)
    scalar.append(_act("CREATE_MOC", create_input))

    # Open questions are scalar — no cross-refs
    for q in state.get("openQuestions") or []:
        scalar.append(_act("ADD_OPEN_QUESTION", {"question": q}))

    # Core ideas reference notes — defer
    for ci in state.get("coreIdeas") or []:
        note_old = ci.get("noteRef")
        note_new = id_map.get(note_old) if note_old else None
        if note_new is None:
            if drop_unmapped:
                continue
            note_new = note_old
        crossref.append(_act("ADD_CORE_IDEA", {
            "id": ci["id"],
            "noteRef": note_new,
            "contextPhrase": ci.get("contextPhrase") or "",
            "sortOrder": int(ci.get("sortOrder") or 0),
            "addedAt": ci.get("addedAt") or now,
            **({"addedBy": ci["addedBy"]} if ci.get("addedBy") else {}),
        }))

    # Tensions reference multiple docs — defer; remap each ref individually,
    # passing through unmapped refs
    for t in state.get("tensions") or []:
        refs = t.get("involvedRefs") or []
        remapped = [id_map.resolve(r) for r in refs]
        crossref.append(_act("ADD_TENSION", {
            "id": t["id"],
            "description": t.get("description") or "",
            "involvedRefs": remapped,
            "addedAt": t.get("addedAt") or now,
        }))

    # Child mocs reference other mocs — defer; drop if unmapped
    for child in state.get("childRefs") or []:
        new_child = id_map.get(child)
        if new_child is None:
            if drop_unmapped:
                continue
            new_child = child
        crossref.append(_act("ADD_CHILD_MOC", {"childRef": new_child}))

    return scalar, crossref


def sort_mocs_for_creation(docs: list[dict], states: dict[str, dict]) -> list[str]:
    """Topologically order moc doc IDs so that a moc's parentRef (if any) is
    created before the moc itself.

    Returns a list of doc ids in creation order. Cycles are broken by visit-once.
    """
    moc_ids = {d["id"] for d in docs if d.get("type") == "bai/moc"}
    visited: set[str] = set()
    order: list[str] = []

    def visit(doc_id: str) -> None:
        if doc_id in visited or doc_id not in moc_ids:
            return
        visited.add(doc_id)
        parent = (states.get(doc_id) or {}).get("parentRef")
        if parent and parent in moc_ids:
            visit(parent)
        order.append(doc_id)

    for d in docs:
        if d.get("type") == "bai/moc":
            visit(d["id"])
    return order
