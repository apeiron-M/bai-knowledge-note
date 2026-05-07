import pytest
from lib.id_map import IdMap
from handlers.moc import build_actions, sort_mocs_for_creation


def _idmap(tmp_path):
    return IdMap(tmp_path / "id-map.json")


def test_create_moc_emitted_first(tmp_path):
    state = {"title": "T", "description": "D", "orientation": "O", "tier": "HUB",
             "coreIdeas": [], "tensions": [], "openQuestions": [], "childRefs": []}
    scalars, crossrefs = build_actions(state, _idmap(tmp_path))
    assert scalars[0]["type"] == "CREATE_MOC"
    assert scalars[0]["input"]["title"] == "T"
    assert scalars[0]["input"]["tier"] == "HUB"


def test_default_tier_is_topic_when_missing(tmp_path):
    state = {"title": "T", "description": "D", "orientation": "O",
             "coreIdeas": [], "tensions": [], "openQuestions": [], "childRefs": []}
    scalars, _ = build_actions(state, _idmap(tmp_path))
    assert scalars[0]["input"]["tier"] == "TOPIC"


def test_parent_ref_resolves_via_id_map(tmp_path):
    id_map = _idmap(tmp_path)
    id_map.set("old-parent", "NEW-PARENT")
    state = {"title": "T", "description": "D", "orientation": "O", "tier": "DOMAIN",
             "parentRef": "old-parent", "coreIdeas": [], "tensions": [],
             "openQuestions": [], "childRefs": []}
    scalars, _ = build_actions(state, id_map)
    assert scalars[0]["input"].get("parentRef") == "NEW-PARENT"


def test_open_questions_emitted_in_scalar_phase(tmp_path):
    state = {"title": "T", "description": "D", "orientation": "O", "tier": "TOPIC",
             "coreIdeas": [], "tensions": [],
             "openQuestions": ["q1?", "q2?"], "childRefs": []}
    scalars, _ = build_actions(state, _idmap(tmp_path))
    qs = [a for a in scalars if a["type"] == "ADD_OPEN_QUESTION"]
    assert [a["input"]["question"] for a in qs] == ["q1?", "q2?"]


def test_core_ideas_in_crossref_phase(tmp_path):
    id_map = _idmap(tmp_path)
    id_map.set("note-old", "note-new")
    state = {"title": "T", "description": "D", "orientation": "O", "tier": "TOPIC",
             "coreIdeas": [
                 {"id": "ci1", "noteRef": "note-old", "contextPhrase": "p", "sortOrder": 0,
                  "addedAt": "2026-01-01T00:00:00.000Z", "addedBy": "a"},
             ],
             "tensions": [], "openQuestions": [], "childRefs": []}
    scalars, crossrefs = build_actions(state, id_map)
    assert all(a["type"] != "ADD_CORE_IDEA" for a in scalars)
    assert len(crossrefs) == 1
    assert crossrefs[0]["type"] == "ADD_CORE_IDEA"
    assert crossrefs[0]["input"]["noteRef"] == "note-new"


def test_child_mocs_in_crossref_phase(tmp_path):
    """Default behavior drops childRefs whose target isn't in the id_map."""
    id_map = _idmap(tmp_path)
    id_map.set("child-old", "child-new")
    state = {"title": "T", "description": "D", "orientation": "O", "tier": "HUB",
             "coreIdeas": [], "tensions": [], "openQuestions": [],
             "childRefs": ["child-old", "unknown"]}
    _, crossrefs = build_actions(id_map=id_map, state=state, drop_unmapped=True)
    children = [a for a in crossrefs if a["type"] == "ADD_CHILD_MOC"]
    assert [a["input"]["childRef"] for a in children] == ["child-new"]


def test_tensions_in_crossref_phase_remapped(tmp_path):
    id_map = _idmap(tmp_path)
    id_map.set("a", "A"); id_map.set("b", "B")
    state = {"title": "T", "description": "D", "orientation": "O", "tier": "TOPIC",
             "coreIdeas": [], "openQuestions": [], "childRefs": [],
             "tensions": [
                 {"id": "t1", "description": "x", "involvedRefs": ["a", "b", "missing"],
                  "addedAt": "2026-01-01T00:00:00.000Z"},
             ]}
    _, crossrefs = build_actions(state, id_map)
    tens = next(a for a in crossrefs if a["type"] == "ADD_TENSION")
    # involvedRefs are kept (no drop) but remapped where possible
    assert tens["input"]["involvedRefs"] == ["A", "B", "missing"]


def test_sort_mocs_for_creation_parents_before_children():
    docs = [
        {"id": "child1", "type": "bai/moc", "name": "c1"},
        {"id": "root",   "type": "bai/moc", "name": "r"},
        {"id": "child2", "type": "bai/moc", "name": "c2"},
    ]
    states = {
        "child1": {"parentRef": "root"},
        "child2": {"parentRef": "child1"},
        "root":   {},
    }
    sorted_ids = sort_mocs_for_creation(docs, states)
    assert sorted_ids.index("root") < sorted_ids.index("child1")
    assert sorted_ids.index("child1") < sorted_ids.index("child2")
