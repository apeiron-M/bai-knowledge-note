"""bai/knowledge-graph singleton handler. All actions are cross-refs since
every node/edge references documents in the drive."""
from lib.id_map import IdMap


def _act(op_type: str, input_data: dict) -> dict:
    return {"type": op_type, "input": input_data, "scope": "global"}


def build_actions(
    state: dict,
    id_map: IdMap,
    drop_unmapped: bool = True,
) -> tuple[list[dict], list[dict]]:
    scalar: list[dict] = []
    crossref: list[dict] = []

    for n in state.get("nodes") or []:
        old = n.get("documentId")
        new = id_map.get(old) if old else None
        if new is None:
            if drop_unmapped:
                continue
            new = old
        inp: dict = {"id": n["id"], "documentId": new}
        for k in ("title", "noteType", "status"):
            if n.get(k) is not None:
                inp[k] = n[k]
        crossref.append(_act("ADD_NODE", inp))

    for e in state.get("edges") or []:
        s_old = e.get("sourceDocumentId")
        t_old = e.get("targetDocumentId")
        s_new = id_map.get(s_old) if s_old else None
        t_new = id_map.get(t_old) if t_old else None
        if s_new is None or t_new is None:
            if drop_unmapped:
                continue
            s_new = s_new or s_old
            t_new = t_new or t_old
        inp = {
            "id": e["id"],
            "sourceDocumentId": s_new,
            "targetDocumentId": t_new,
        }
        if e.get("linkType"):
            inp["linkType"] = e["linkType"]
        crossref.append(_act("ADD_EDGE", inp))

    return scalar, crossref
