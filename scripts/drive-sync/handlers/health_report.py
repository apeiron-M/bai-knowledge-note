"""bai/health-report singleton handler. No cross-refs (affectedItems are
opaque strings in the schema; we pass them through with optional remap)."""
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

    metrics = state.get("graphMetrics") or {}
    if state.get("generatedAt") or metrics:
        gm_input = {
            "noteCount": int(metrics.get("noteCount") or 0),
            "mocCount": int(metrics.get("mocCount") or 0),
            "connectionCount": int(metrics.get("connectionCount") or 0),
            "density": float(metrics.get("density") or 0),
            "orphanCount": int(metrics.get("orphanCount") or 0),
            "danglingLinkCount": int(metrics.get("danglingLinkCount") or 0),
            "mocCoverage": float(metrics.get("mocCoverage") or 0),
            "averageLinksPerNote": float(metrics.get("averageLinksPerNote") or 0),
        }
        scalar.append(_act("GENERATE_REPORT", {
            "generatedAt": state.get("generatedAt") or now,
            "mode": state.get("mode") or "FULL",
            "overallStatus": state.get("overallStatus") or "PASS",
            "graphMetrics": gm_input,
            "recommendations": list(state.get("recommendations") or []),
            **({"generatedBy": state["generatedBy"]} if state.get("generatedBy") else {}),
        }))

    for c in state.get("checks") or []:
        # affectedItems may include doc IDs — remap where possible
        items = c.get("affectedItems") or []
        remapped = [id_map.resolve(x) for x in items]
        scalar.append(_act("ADD_CHECK", {
            "id": c["id"],
            "category": c.get("category") or "SCHEMA_COMPLIANCE",
            "status": c.get("status") or "PASS",
            "message": c.get("message") or "",
            "affectedItems": remapped,
        }))

    return scalar, crossref
