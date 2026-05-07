"""bai/source handler."""
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

    # ingestSource: title and content are required
    inp = {
        "title": state.get("title") or "",
        "content": state.get("content") or "",
        "sourceType": state.get("sourceType") or "MANUAL_ENTRY",
        "createdAt": state.get("createdAt") or now,
    }
    if state.get("description"):
        inp["description"] = state["description"]
    if state.get("createdBy"):
        inp["createdBy"] = state["createdBy"]

    prov = state.get("provenance") or {}
    for k in ("url", "author", "publishedAt", "method", "tool"):
        if prov.get(k):
            inp[k] = prov[k]

    scalar.append(_act("INGEST_SOURCE", inp))

    if state.get("status"):
        scalar.append(_act("SET_SOURCE_STATUS", {"status": state["status"]}))

    stats = state.get("extractionStats")
    if stats and stats.get("claimCount") is not None:
        s_inp = {
            "claimCount": int(stats["claimCount"]),
            "skippedCount": int(stats.get("skippedCount") or 0),
            "skipRate": float(stats.get("skipRate") or 0),
            "extractedAt": stats.get("extractedAt") or now,
        }
        if stats.get("extractedBy"):
            s_inp["extractedBy"] = stats["extractedBy"]
        scalar.append(_act("RECORD_EXTRACTION_STATS", s_inp))

    # extractedClaims reference notes/claims — defer
    for claim in state.get("extractedClaims") or []:
        new_ref = id_map.get(claim)
        if new_ref is None:
            if drop_unmapped:
                continue
            new_ref = claim
        crossref.append(_act("ADD_EXTRACTED_CLAIM", {"claimRef": new_ref}))

    return scalar, crossref
