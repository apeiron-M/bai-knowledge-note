"""powerhouse/scopeofwork handler."""
from lib.id_map import IdMap
from handlers.scope_of_work import build_actions


def _idmap(tmp_path):
    return IdMap(tmp_path / "id-map.json")


def _state(**over):
    s = {"title": "SoW", "description": "d", "status": "DRAFT",
         "contributors": [{"id": "agent-1", "name": "Frank", "description": "x", "icon": None}],
         "deliverables": [{"id": "d1", "code": "C-01", "title": "T", "description": "D",
                           "owner": "agent-1", "status": "TODO", "keyResults": [],
                           "workProgress": {"done": False, "total": None, "value": None,
                                            "completed": None},
                           "budgetAnchor": {}, "goalRef": None}],
         "projects": [], "roadmaps": []}
    s.update(over); return s


def _types(actions):
    return [a["type"] for a in actions]


def test_edit_scope_of_work_first_then_agents_then_deliverables(tmp_path):
    scalars, _ = build_actions(_state(), _idmap(tmp_path))
    t = _types(scalars)
    assert t[0] == "EDIT_SCOPE_OF_WORK"
    assert t.index("ADD_AGENT") < t.index("ADD_DELIVERABLE")


def test_status_reapplied_after_progress_because_progress_derives_status(tmp_path):
    """SET_DELIVERABLE_PROGRESS forces DELIVERED/IN_PROGRESS, so a TODO would
    be overwritten unless the real status is restated afterwards."""
    scalars, _ = build_actions(_state(), _idmap(tmp_path))
    t = _types(scalars)
    assert t.index("SET_DELIVERABLE_PROGRESS") < t.index("EDIT_DELIVERABLE")
    edit = scalars[t.index("EDIT_DELIVERABLE")]
    assert edit["input"] == {"id": "d1", "status": "TODO"}


def test_membership_uses_add_deliverable_in_set_not_the_create_ops(tmp_path):
    """ADD_PROJECT_DELIVERABLE / ADD_MILESTONE_DELIVERABLE *create* a
    deliverable and reject an existing id, losing every membership row."""
    st = _state(projects=[{"id": "p1", "code": "P", "title": "Proj",
                           "scope": {"deliverables": ["d1"], "status": "DRAFT",
                                     "deliverablesCompleted": {"total": 1, "completed": 0}}}],
                roadmaps=[{"id": "r1", "title": "R", "milestones": [
                    {"id": "m1", "title": "M", "scope": {"deliverables": ["d1"]}}]}])
    scalars, _ = build_actions(st, _idmap(tmp_path))
    t = _types(scalars)
    assert "ADD_PROJECT_DELIVERABLE" not in t and "ADD_MILESTONE_DELIVERABLE" not in t
    sets = [a["input"] for a in scalars if a["type"] == "ADD_DELIVERABLE_IN_SET"]
    assert {"projectId": "p1", "deliverableId": "d1"} in sets
    assert {"milestoneId": "m1", "deliverableId": "d1"} in sets
    # membership must precede the totals that describe it
    assert t.index("ADD_DELIVERABLE_IN_SET") < t.index("EDIT_DELIVERABLES_SET")


def test_knowledge_refs_remapped_and_wbs_ref_skipped_when_unmapped(tmp_path):
    id_map = _idmap(tmp_path); id_map.set("note-old", "note-new")
    st = _state(projects=[{"id": "p1", "code": "P", "title": "Proj", "scope": {},
                           "wbsRef": "wbs-not-restored",
                           "knowledgeRefs": ["note-old", "missing-note"]}])
    _, crossrefs = build_actions(st, id_map, drop_unmapped=True)
    assert [a["type"] for a in crossrefs] == ["ADD_PROJECT_KNOWLEDGE_REF"]
    assert crossrefs[0]["input"] == {"projectId": "p1", "ref": "note-new"}


def _with_goal(wbs_ref):
    """A deliverable whose goal lives in the WBS behind `wbs_ref`, wired the
    way the model does it: deliverable -> budgetAnchor.project -> envelope."""
    d = dict(_state()["deliverables"][0], goalRef="goal-1",
             budgetAnchor={"project": "p1"})
    return _state(deliverables=[d],
                  projects=[{"id": "p1", "code": "P", "title": "Proj",
                             "scope": {}, "wbsRef": wbs_ref}])


def test_goal_ref_kept_verbatim_and_gated_on_the_wbs_being_restored(tmp_path):
    """A goalRef is an intra-WBS OID, so it is never remapped — but it is only
    written when the envelope's WBS was restored, otherwise it dangles."""
    id_map = _idmap(tmp_path); id_map.set("wbs-old", "wbs-new")
    scalars, _ = build_actions(_with_goal("wbs-old"), id_map)
    linked = [a for a in scalars if a["type"] == "LINK_DELIVERABLE_GOAL"]
    assert linked, "goal link missing while its WBS is restorable"
    # verbatim: NOT id_map'd, or every scope-of-work goalRef breaks
    assert linked[0]["input"] == {"deliverableId": "d1", "goalRef": "goal-1"}


def test_goal_ref_skipped_when_its_wbs_is_not_restorable(tmp_path):
    scalars, _ = build_actions(_with_goal("wbs-never-uploaded"), _idmap(tmp_path))
    assert "LINK_DELIVERABLE_GOAL" not in _types(scalars)


def test_no_goal_link_without_a_goal_ref(tmp_path):
    scalars, _ = build_actions(_state(), _idmap(tmp_path))
    assert "LINK_DELIVERABLE_GOAL" not in _types(scalars)


def test_none_and_empty_values_are_dropped_from_inputs(tmp_path):
    scalars, _ = build_actions(_state(), _idmap(tmp_path))
    for a in scalars:
        assert not any(v in (None, "") for v in a["input"].values()), a
