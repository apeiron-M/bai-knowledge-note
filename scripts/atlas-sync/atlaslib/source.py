"""bai/source handler — drive-sync's, plus claim de-duplication.

`ADD_EXTRACTED_CLAIM` appends to a list with no uniqueness check and
there is no `REMOVE_EXTRACTED_CLAIM` operation, so a duplicate can never
be undone in place. The live Atlas vault has 19 of them on one source:
a close-out batch was retried after a 502 whose commit landed anyway, so
the second attempt appended refs that were already there.

Replaying a snapshot is the only opportunity to drop them, so this
wrapper collapses repeats while preserving first-seen order. Linking the
same claim to the same source twice carries no information, so nothing
is lost.
"""
from handlers import source as base


def build_actions(state, id_map, drop_unmapped: bool = False):
    scalar, crossref = base.build_actions(state, id_map, drop_unmapped)

    seen: set[str] = set()
    deduped = []
    for action in crossref:
        if action.get("type") == "ADD_EXTRACTED_CLAIM":
            ref = (action.get("input") or {}).get("claimRef")
            if ref in seen:
                continue
            seen.add(ref)
        deduped.append(action)
    return scalar, deduped
