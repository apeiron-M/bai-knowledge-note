"""bai/pipeline-queue singleton handler."""
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
    drop_unmapped: bool = True,
) -> tuple[list[dict], list[dict]]:
    scalar: list[dict] = []
    crossref: list[dict] = []
    now = _now_iso()

    # `phaseOrder` lives in initialValue; we don't migrate it (it's project-level config).
    # We migrate task entries.
    for t in state.get("tasks") or []:
        # documentRef may reference a knowledge-note — remap (drop if unmapped)
        doc_ref = t.get("documentRef")
        new_ref = id_map.get(doc_ref) if doc_ref else None
        if doc_ref and new_ref is None and drop_unmapped:
            # skip the task entirely if it references a missing doc
            continue

        add_inp: dict = {
            "id": t["id"],
            "taskType": t.get("taskType") or "claim",
            "target": t.get("target") or "",
            "createdAt": t.get("createdAt") or now,
        }
        if t.get("batchId"):
            add_inp["batchId"] = t["batchId"]
        if doc_ref:
            add_inp["documentRef"] = new_ref or doc_ref
        if t.get("currentPhase"):
            add_inp["currentPhase"] = t["currentPhase"]
        # addTask is treated as a crossref (it has a doc dependency in some cases);
        # keep all task ops in crossref phase for consistent ordering.
        crossref.append(_act("ADD_TASK", add_inp))

        if t.get("assignedTo"):
            crossref.append(_act("ASSIGN_TASK", {
                "taskId": t["id"], "assignedTo": t["assignedTo"], "updatedAt": now,
            }))

        status = t.get("status")
        upd = t.get("updatedAt") or now
        if status == "DONE":
            crossref.append(_act("COMPLETE_TASK", {"taskId": t["id"], "updatedAt": upd}))
        elif status == "FAILED":
            crossref.append(_act("FAIL_TASK", {
                "taskId": t["id"], "reason": "migrated from source", "updatedAt": upd,
            }))
        elif status == "BLOCKED":
            crossref.append(_act("BLOCK_TASK", {
                "taskId": t["id"], "reason": "migrated from source", "updatedAt": upd,
            }))

    return scalar, crossref
