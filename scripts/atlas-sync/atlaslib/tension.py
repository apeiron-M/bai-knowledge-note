"""bai/tension handler — the one document type drive-sync doesn't cover.

Same contract as `drive-sync/handlers/*`: `build_actions(state, id_map,
drop_unmapped)` returns `(scalar_actions, crossref_actions)`.

`involvedRefs` are document ids, but they are a *required* argument of
CREATE_TENSION, so unlike the note/moc handlers they cannot be deferred
to phase 4. Remapping them during phase 3 is safe because upload.py
finishes creating every document in phase 2 before phase 3 dispatches
anything — the id-map is complete by then. Refs that still don't
resolve are dropped rather than written through as dangling ids.
"""
import datetime

DOC_TYPE = "bai/tension"


def _now_iso() -> str:
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")


def _act(op_type: str, input_data: dict) -> dict:
    return {"type": op_type, "input": input_data, "scope": "global"}


def build_actions(state, id_map, drop_unmapped: bool = False):
    scalar: list[dict] = []
    crossref: list[dict] = []
    now = _now_iso()

    refs: list[str] = []
    for ref in state.get("involvedRefs") or []:
        mapped = id_map.get(ref)
        if mapped is None:
            if drop_unmapped:
                continue
            mapped = ref
        refs.append(mapped)

    scalar.append(
        _act(
            "CREATE_TENSION",
            {
                # title/description are non-null in the schema; a tension
                # with neither is meaningless but must still round-trip.
                "title": state.get("title") or "Untitled tension",
                "description": state.get("description") or "",
                "content": state.get("content") or "",
                "involvedRefs": refs,
                "observedAt": state.get("observedAt") or now,
                "observedBy": state.get("observedBy") or "atlas-sync",
            },
        )
    )

    # CREATE_TENSION opens the tension; replay the closing transition (if
    # any) so status survives the rebuild. RESOLVED = one side was right,
    # DISSOLVED = the contradiction was only apparent.
    status = state.get("status")
    if status in ("RESOLVED", "DISSOLVED"):
        op = "RESOLVE_TENSION" if status == "RESOLVED" else "DISSOLVE_TENSION"
        scalar.append(
            _act(
                op,
                {
                    "resolution": state.get("resolution") or "",
                    "resolvedAt": state.get("resolvedAt") or now,
                },
            )
        )

    return scalar, crossref
