"""bai/vault-config singleton handler. No cross-refs."""
import datetime

from lib.id_map import IdMap


DIMENSION_KEYS = [
    "granularity", "organization", "linking", "processing",
    "navigation", "maintenance", "schema", "automation",
]

VOCABULARY_KEYS = [
    "notes", "inbox", "reduce", "reflect", "reweave",
    "verify", "rethink", "topicMap", "description",
]

MAINTENANCE_KEYS = [
    "orphanThreshold", "danglingThreshold", "inboxPressure",
    "observationAccumulation", "tensionAccumulation", "mocOversize",
    "staleNoteDays",
]


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

    if state.get("name") or state.get("domain"):
        scalar.append(_act("INITIALIZE_CONFIG", {
            "name": state.get("name") or "knowledge-vault",
            "domain": state.get("domain") or "",
            "updatedAt": now,
        }))

    dims = state.get("dimensions") or {}
    for k in DIMENSION_KEYS:
        d = dims.get(k)
        if not d:
            continue
        inp: dict = {
            "dimension": k,
            "value": int(d.get("value") or 0),
            "confidence": float(d.get("confidence") or 0),
            "updatedAt": now,
        }
        if d.get("rationale"):
            inp["rationale"] = d["rationale"]
        scalar.append(_act("UPDATE_DIMENSION", inp))

    vocab = state.get("vocabulary") or {}
    for k in VOCABULARY_KEYS:
        v = vocab.get(k)
        if v is not None:
            scalar.append(_act("UPDATE_VOCABULARY", {"key": k, "value": v, "updatedAt": now}))

    pipe = state.get("pipeline")
    if pipe:
        inp = {"updatedAt": now}
        for k in ("depth", "autoChain", "extractionSelectivity"):
            if pipe.get(k) is not None:
                inp[k] = pipe[k]
        if len(inp) > 1:
            scalar.append(_act("UPDATE_PIPELINE_CONFIG", inp))

    maint = state.get("maintenance") or {}
    for k in MAINTENANCE_KEYS:
        v = maint.get(k)
        if v is not None:
            scalar.append(_act("UPDATE_MAINTENANCE_THRESHOLD", {
                "condition": k, "threshold": int(v), "updatedAt": now,
            }))

    for cat in state.get("extractionCategories") or []:
        scalar.append(_act("ADD_EXTRACTION_CATEGORY", {
            "id": cat["id"],
            "name": cat.get("name") or "",
            "description": cat.get("description") or "",
            "active": bool(cat.get("active", True)),
        }))

    for feat in state.get("features") or []:
        # `features` is a list of enabled feature names
        scalar.append(_act("TOGGLE_FEATURE", {"feature": feat, "enabled": True}))

    return scalar, crossref
