import pytest
from lib.id_map import IdMap
from handlers.knowledge_note import build_actions


def _new_id_map(tmp_path):
    return IdMap(tmp_path / "id-map.json")


def test_title_produces_set_title_action(tmp_path):
    state = {"title": "Hello", "links": [], "topics": []}
    scalars, crossrefs = build_actions(state, _new_id_map(tmp_path))
    types = [a["type"] for a in scalars]
    assert "SET_TITLE" in types
    title_action = next(a for a in scalars if a["type"] == "SET_TITLE")
    assert title_action["input"]["title"] == "Hello"
    assert "updatedAt" in title_action["input"]


def test_empty_string_title_skipped(tmp_path):
    state = {"title": "", "links": [], "topics": []}
    scalars, _ = build_actions(state, _new_id_map(tmp_path))
    assert all(a["type"] != "SET_TITLE" for a in scalars)


def test_topics_become_add_topic_actions(tmp_path):
    state = {
        "topics": [
            {"id": "t1", "name": "alpha", "topicDocumentId": None},
            {"id": "t2", "name": "beta", "topicDocumentId": "doc-x"},
        ],
        "links": [],
    }
    scalars, _ = build_actions(state, _new_id_map(tmp_path))
    topic_actions = [a for a in scalars if a["type"] == "ADD_TOPIC"]
    assert len(topic_actions) == 2
    assert topic_actions[0]["input"] == {"id": "t1", "name": "alpha", "topicDocumentId": None}
    assert topic_actions[1]["input"]["topicDocumentId"] == "doc-x"


def test_links_are_returned_as_crossrefs_not_scalars(tmp_path):
    state = {
        "links": [
            {"id": "l1", "targetDocumentId": "old-id", "linkType": "BUILDS_ON", "targetTitle": "t"},
        ],
        "topics": [],
    }
    scalars, crossrefs = build_actions(state, _new_id_map(tmp_path))
    assert all(a["type"] != "ADD_LINK" for a in scalars)
    assert len(crossrefs) == 1
    assert crossrefs[0]["type"] == "ADD_LINK"


def test_crossref_link_remaps_target_id(tmp_path):
    id_map = _new_id_map(tmp_path)
    id_map.set("old-id", "NEW-ID")
    state = {
        "links": [{"id": "l1", "targetDocumentId": "old-id", "linkType": "BUILDS_ON"}],
        "topics": [],
    }
    _, crossrefs = build_actions(state, id_map)
    assert crossrefs[0]["input"]["targetDocumentId"] == "NEW-ID"


def test_crossref_link_drops_when_target_unmapped_and_unmapped_is_required(tmp_path):
    """If a link points to a doc that isn't in the id-map, the link is dropped
    with an entry in the 'dropped' list returned alongside crossrefs."""
    id_map = _new_id_map(tmp_path)
    state = {
        "links": [{"id": "l1", "targetDocumentId": "nope", "linkType": "BUILDS_ON"}],
        "topics": [],
    }
    _, crossrefs = build_actions(state, id_map, drop_unmapped=True)
    assert crossrefs == []


def test_provenance_produces_set_provenance(tmp_path):
    state = {
        "topics": [],
        "links": [],
        "provenance": {
            "author": "alice",
            "sourceOrigin": "MANUAL",
            "sessionId": "s-1",
            "createdAt": "2026-01-01T00:00:00.000Z",
        },
    }
    scalars, _ = build_actions(state, _new_id_map(tmp_path))
    prov = next(a for a in scalars if a["type"] == "SET_PROVENANCE")
    assert prov["input"]["author"] == "alice"
    assert prov["input"]["sourceOrigin"] == "MANUAL"
    assert prov["input"]["createdAt"] == "2026-01-01T00:00:00.000Z"


def test_metadata_scalar_field_emits_set_metadata_field(tmp_path):
    state = {"topics": [], "links": [], "scope": "narrow", "confidence": "high"}
    scalars, _ = build_actions(state, _new_id_map(tmp_path))
    md = [a for a in scalars if a["type"] == "SET_METADATA_FIELD"]
    fields = {a["input"]["field"]: a["input"]["value"] for a in md}
    assert fields["scope"] == "narrow"
    assert fields["confidence"] == "high"


def test_metadata_list_field_emits_set_metadata_list_field(tmp_path):
    state = {"topics": [], "links": [], "models": ["a", "b"], "inputs": ["x"]}
    scalars, _ = build_actions(state, _new_id_map(tmp_path))
    md = [a for a in scalars if a["type"] == "SET_METADATA_LIST_FIELD"]
    fields = {a["input"]["field"]: a["input"]["values"] for a in md}
    assert fields["models"] == ["a", "b"]
    assert fields["inputs"] == ["x"]


def test_empty_state_produces_no_actions(tmp_path):
    state = {"topics": [], "links": []}
    scalars, crossrefs = build_actions(state, _new_id_map(tmp_path))
    assert scalars == []
    assert crossrefs == []
