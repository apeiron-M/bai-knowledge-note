"""bai/wbs handler."""
from lib.id_map import IdMap
from handlers.wbs import build_actions, sort_goals_for_creation


def _idmap(tmp_path):
    return IdMap(tmp_path / "id-map.json")


def _goal(gid, **over):
    g = {"id": gid, "description": f"goal {gid}", "status": None, "parentId": None,
         "assignee": None, "outcome": None, "blockReason": None,
         "notes": [], "dependencies": []}
    g.update(over); return g


def _types(actions):
    return [a["type"] for a in actions]


def test_parents_emitted_before_children():
    goals = [_goal("c", parentId="b"), _goal("b", parentId="a"), _goal("a")]
    assert [g["id"] for g in sort_goals_for_creation(goals)] == ["a", "b", "c"]


def test_cycle_does_not_hang_and_keeps_every_goal():
    goals = [_goal("x", parentId="y"), _goal("y", parentId="x"), _goal("z", parentId="z")]
    out = sort_goals_for_creation(goals)
    assert {g["id"] for g in out} == {"x", "y", "z"}


def test_create_goal_ordering_respects_parents(tmp_path):
    st = {"goals": [_goal("child", parentId="root"), _goal("root")]}
    scalars, _ = build_actions(st, _idmap(tmp_path))
    creates = [a["input"] for a in scalars if a["type"] == "CREATE_GOAL"]
    assert [c["id"] for c in creates] == ["root", "child"]
    assert "parentId" not in creates[0]
    assert creates[1]["parentId"] == "root"


def test_status_is_a_separate_operation_carrying_outcome(tmp_path):
    st = {"goals": [_goal("g", status="COMPLETED", outcome="done")]}
    scalars, _ = build_actions(st, _idmap(tmp_path))
    t = _types(scalars)
    assert t.index("CREATE_GOAL") < t.index("SET_GOAL_STATUS")
    s = scalars[t.index("SET_GOAL_STATUS")]["input"]
    assert s == {"id": "g", "status": "COMPLETED", "outcome": "done"}


def test_block_reason_travels_with_blocked_status(tmp_path):
    st = {"goals": [_goal("g", status="BLOCKED", blockReason="waiting")]}
    scalars, _ = build_actions(st, _idmap(tmp_path))
    s = next(a["input"] for a in scalars if a["type"] == "SET_GOAL_STATUS")
    assert s["blockReason"] == "waiting"


def test_notes_and_dependencies_restored(tmp_path):
    st = {"goals": [
        _goal("a", notes=[{"id": "n1", "note": "hi", "author": "me",
                           "timestamp": "2026-01-01T00:00:00.000Z"}]),
        _goal("b", dependencies=["a"]),
    ]}
    scalars, _ = build_actions(st, _idmap(tmp_path))
    note = next(a["input"] for a in scalars if a["type"] == "ADD_NOTE")
    assert note == {"goalId": "a", "noteId": "n1", "note": "hi", "author": "me",
                    "timestamp": "2026-01-01T00:00:00.000Z"}
    dep = next(a["input"] for a in scalars if a["type"] == "ADD_DEPENDENCIES")
    assert dep == {"id": "b", "dependencies": ["a"]}
    # dependencies must come after every CREATE_GOAL
    t = _types(scalars)
    assert t.index("ADD_DEPENDENCIES") > max(i for i, x in enumerate(t) if x == "CREATE_GOAL")


def test_goal_ids_are_never_remapped(tmp_path):
    """Goal ids are intra-document OIDs. Remapping them would break every
    scope-of-work goalRef that points at them."""
    id_map = _idmap(tmp_path)
    id_map.set("g", "SOMETHING-ELSE")
    scalars, _ = build_actions({"goals": [_goal("g")]}, id_map)
    assert next(a["input"]["id"] for a in scalars if a["type"] == "CREATE_GOAL") == "g"


def test_document_refs_remapped_and_sow_project_id_kept_verbatim(tmp_path):
    id_map = _idmap(tmp_path)
    id_map.set("sow-old", "sow-new")
    st = {"goals": [], "sowRef": "sow-old", "sowProjectId": "envelope-1",
          "projectRef": "unmapped"}
    _, crossrefs = build_actions(st, id_map, drop_unmapped=True)
    assert [a["type"] for a in crossrefs] == ["SET_SOW_PROJECT_REF"]
    assert crossrefs[0]["input"] == {"sowRef": "sow-new", "sowProjectId": "envelope-1"}


def test_owner_and_references_emitted(tmp_path):
    st = {"goals": [], "owner": "liberuum", "references": ["https://example.test/a"]}
    scalars, _ = build_actions(st, _idmap(tmp_path))
    assert scalars[0]["input"] == {"owner": "liberuum"}
    assert scalars[1]["input"] == {"references": ["https://example.test/a"]}
