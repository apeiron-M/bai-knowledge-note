"""powerhouse/scopeofwork handler.

A scope of work is one document holding four intertwined collections:
contributors (agents), deliverables, projects (the envelopes), and roadmaps
with their milestones. Ordering matters more here than for any other type,
because most operations resolve a target that an earlier operation had to
create:

    EDIT_SCOPE_OF_WORK -> ADD_AGENT -> ADD_DELIVERABLE -> progress/budget/
    key results -> ADD_PROJECT -> project membership -> ADD_ROADMAP ->
    ADD_MILESTONE -> milestone membership

Two traps are worth stating, because both fail silently rather than loudly:

1. `SET_DELIVERABLE_PROGRESS` *derives* status — it forces DELIVERED when
   the progress reads complete and IN_PROGRESS otherwise. Applying it after
   ADD_DELIVERABLE therefore overwrites a TODO or WONT_DO status with
   IN_PROGRESS. The authoritative status is re-applied with EDIT_DELIVERABLE
   afterwards, so the restored status always matches the snapshot.

2. Only `knowledgeRefs` are vault document ids and go through `id_map`.
   `wbsRef` points at a `bai/wbs` document and `goalRef` at a goal *inside*
   one; neither is restorable while the WBS documents have no handler, so
   both are emitted only when the id actually maps and skipped otherwise
   rather than written as a dangling reference.
"""

from lib.id_map import IdMap


def _act(op_type: str, input_data: dict) -> dict:
    return {"type": op_type, "input": input_data, "scope": "global"}


def _clean(d: dict) -> dict:
    """Drop None/"" values: the reducers treat an explicit null as "unset"
    for some fields and reject it for others, and a create action carrying
    a null optional is the difference between a stored blank and an error
    operation."""
    return {k: v for k, v in d.items() if v not in (None, "")}


def build_actions(
    state: dict,
    id_map: IdMap,
    drop_unmapped: bool = False,
) -> tuple[list[dict], list[dict]]:
    scalar: list[dict] = []
    crossref: list[dict] = []

    # ── The document's own fields ────────────────────────────────────────
    scalar.append(_act("EDIT_SCOPE_OF_WORK", _clean({
        "title": state.get("title"),
        "description": state.get("description"),
        "status": state.get("status") or "DRAFT",
    })))

    # ── Contributors, before anything that names an owner ────────────────
    for a in state.get("contributors") or []:
        scalar.append(_act("ADD_AGENT", _clean({
            "id": a["id"],
            "name": a.get("name") or "",
            "icon": a.get("icon"),
            "description": a.get("description"),
        })))

    # ── Deliverables ────────────────────────────────────────────────────
    for d in state.get("deliverables") or []:
        did = d["id"]
        scalar.append(_act("ADD_DELIVERABLE", _clean({
            "id": did,
            "owner": d.get("owner"),
            "title": d.get("title"),
            "code": d.get("code"),
            "description": d.get("description"),
            "status": d.get("status"),
        })))

        for kr in d.get("keyResults") or []:
            scalar.append(_act("ADD_KEY_RESULT", _clean({
                "id": kr["id"],
                "deliverableId": did,
                "title": kr.get("title") or "",
                "link": kr.get("link"),
            })))

        # Progress, then status again — see trap 1 in the module docstring.
        wp = d.get("workProgress") or {}
        prog = None
        if wp.get("value") is not None:
            prog = {"percentage": round(float(wp["value"]), 2)}
        elif wp.get("total") is not None and wp.get("completed") is not None:
            prog = {"storyPoints": {"total": int(wp["total"]),
                                    "completed": int(wp["completed"])}}
        elif wp.get("done") is not None:
            prog = {"done": bool(wp["done"])}
        if prog is not None:
            scalar.append(_act("SET_DELIVERABLE_PROGRESS",
                               {"id": did, "workProgress": prog}))
            if d.get("status"):
                scalar.append(_act("EDIT_DELIVERABLE",
                                   {"id": did, "status": d["status"]}))

        ba = d.get("budgetAnchor") or {}
        if ba.get("project"):
            scalar.append(_act("SET_DELIVERABLE_BUDGET_ANCHOR_PROJECT", _clean({
                "deliverableId": did,
                "project": ba.get("project"),
                "unit": ba.get("unit"),
                "unitCost": ba.get("unitCost"),
                "quantity": ba.get("quantity"),
                "margin": ba.get("margin"),
                "marginPinned": ba.get("marginPinned"),
            })))

        # A goal lives inside a bai/wbs document. Its id is an intra-document
        # OID that handlers/wbs.py restores verbatim, so it is NOT remapped —
        # passing it through id_map would drop every one of them. What has to
        # hold is that the WBS carrying the goal was restored, which is true
        # exactly when the owning envelope's wbsRef maps; the deliverable
        # names its envelope through budgetAnchor.project.
        if d.get("goalRef"):
            owner_project = (d.get("budgetAnchor") or {}).get("project")
            wbs_ref = next((p.get("wbsRef") for p in state.get("projects") or []
                            if p.get("id") == owner_project), None)
            if wbs_ref and id_map.get(wbs_ref):
                scalar.append(_act("LINK_DELIVERABLE_GOAL",
                                   {"deliverableId": did, "goalRef": d["goalRef"]}))

    # ── Projects (the envelopes) ─────────────────────────────────────────
    for p in state.get("projects") or []:
        pid = p["id"]
        scalar.append(_act("ADD_PROJECT", _clean({
            "id": pid,
            "code": p.get("code") or "",
            "title": p.get("title") or "",
            "slug": p.get("slug"),
            "projectOwner": p.get("projectOwner"),
            "abstract": p.get("abstract"),
            "imageUrl": p.get("imageUrl"),
            "budgetType": p.get("budgetType"),
            "currency": p.get("currency"),
            "budget": p.get("budget"),
        })))

        sc = p.get("scope") or {}
        # ADD_DELIVERABLE_IN_SET links an EXISTING deliverable. The
        # similarly named ADD_PROJECT_DELIVERABLE *creates* one and rejects
        # an id that already exists ("Deliverable with ID … already
        # exists"), so using it here loses every membership row while the
        # surrounding actions still apply.
        for ref in sc.get("deliverables") or []:
            scalar.append(_act("ADD_DELIVERABLE_IN_SET", {
                "projectId": pid,
                "deliverableId": ref,
            }))

        done = sc.get("deliverablesCompleted") or {}
        if sc.get("status") or done.get("total") is not None:
            scalar.append(_act("EDIT_DELIVERABLES_SET", _clean({
                "projectId": pid,
                "status": sc.get("status"),
                "deliverablesCompleted": (
                    {"total": int(done["total"]), "completed": int(done.get("completed") or 0)}
                    if done.get("total") is not None else None
                ),
            })))

        exp = p.get("expenditure") or {}
        if exp.get("actuals") is not None or exp.get("cap") is not None:
            scalar.append(_act("SET_PROJECT_EXPENDITURE", _clean({
                "projectId": pid,
                "actuals": exp.get("actuals"),
                "cap": exp.get("cap"),
            })))

        if p.get("references"):
            scalar.append(_act("SET_PROJECT_REFERENCES",
                               {"projectId": pid, "references": p["references"]}))

        # A WBS is a separate document; link it only once it is restorable.
        wbs_new = id_map.get(p["wbsRef"]) if p.get("wbsRef") else None
        if wbs_new:
            crossref.append(_act("LINK_PROJECT_WBS",
                                 {"projectId": pid, "wbsRef": wbs_new}))

        # knowledgeRefs ARE vault documents — remap them.
        for ref in p.get("knowledgeRefs") or []:
            new_ref = id_map.get(ref)
            if new_ref is None:
                if drop_unmapped:
                    continue
                new_ref = ref
            crossref.append(_act("ADD_PROJECT_KNOWLEDGE_REF",
                                 {"projectId": pid, "ref": new_ref}))

    # ── Roadmaps and milestones ─────────────────────────────────────────
    for r in state.get("roadmaps") or []:
        rid = r["id"]
        scalar.append(_act("ADD_ROADMAP", _clean({
            "id": rid,
            "title": r.get("title") or "",
            "slug": r.get("slug"),
            "description": r.get("description"),
        })))
        for ms in r.get("milestones") or []:
            mid = ms["id"]
            scalar.append(_act("ADD_MILESTONE", _clean({
                "id": mid,
                "roadmapId": rid,
                "sequenceCode": ms.get("sequenceCode"),
                "title": ms.get("title"),
                "description": ms.get("description"),
                "deliveryTarget": ms.get("deliveryTarget"),
            })))
            for c in ms.get("coordinators") or []:
                cid = c["id"] if isinstance(c, dict) else c
                scalar.append(_act("ADD_COORDINATOR",
                                   {"id": cid, "milestoneId": mid}))
            msc = ms.get("scope") or {}
            # Same rule as the project set above: link, do not create.
            for ref in msc.get("deliverables") or []:
                scalar.append(_act("ADD_DELIVERABLE_IN_SET", {
                    "milestoneId": mid,
                    "deliverableId": ref,
                }))
            done = msc.get("deliverablesCompleted") or {}
            if msc.get("status") or done.get("total") is not None:
                scalar.append(_act("EDIT_DELIVERABLES_SET", _clean({
                    "milestoneId": mid,
                    "status": msc.get("status"),
                    "deliverablesCompleted": (
                        {"total": int(done["total"]), "completed": int(done.get("completed") or 0)}
                        if done.get("total") is not None else None
                    ),
                })))

    return scalar, crossref


def apply(doc_id: str, state: dict, id_map: IdMap, sb_module) -> int:
    scalars, _ = build_actions(state, id_map, drop_unmapped=True)
    if scalars:
        sb_module.apply_actions(doc_id, scalars)
    return len(scalars)
