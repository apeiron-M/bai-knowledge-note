"""bai/tension handler — the type drive-sync doesn't cover."""
import pytest

from atlaslib import tension
from lib.id_map import IdMap


@pytest.fixture
def id_map(tmp_path):
    m = IdMap(tmp_path / "id-map.json")
    m.set("old-note-1", "new-note-1")
    m.set("old-note-2", "new-note-2")
    return m


def _create(actions):
    return next(a for a in actions if a["type"] == "CREATE_TENSION")


def test_create_tension_remaps_involved_refs(id_map):
    scalar, crossref = tension.build_actions(
        {
            "title": "SCRR cap is contested",
            "description": "Two notes disagree on whether a cap exists.",
            "content": "body",
            "involvedRefs": ["old-note-1", "old-note-2"],
            "observedAt": "2026-01-01T00:00:00.000Z",
            "observedBy": "knowledge-agent",
        },
        id_map,
    )
    assert crossref == [], "involvedRefs are required by CREATE_TENSION, so nothing defers"
    inp = _create(scalar)["input"]
    assert inp["involvedRefs"] == ["new-note-1", "new-note-2"]
    assert inp["observedBy"] == "knowledge-agent"


def test_unmapped_refs_are_dropped_not_written_through(id_map):
    scalar, _ = tension.build_actions(
        {"title": "t", "description": "d", "involvedRefs": ["old-note-1", "ghost"]},
        id_map,
        drop_unmapped=True,
    )
    assert _create(scalar)["input"]["involvedRefs"] == ["new-note-1"]


def test_unmapped_refs_pass_through_when_not_dropping(id_map):
    scalar, _ = tension.build_actions(
        {"title": "t", "description": "d", "involvedRefs": ["ghost"]},
        id_map,
        drop_unmapped=False,
    )
    assert _create(scalar)["input"]["involvedRefs"] == ["ghost"]


def test_required_fields_have_defaults_for_an_empty_tension(id_map):
    scalar, _ = tension.build_actions({}, id_map)
    inp = _create(scalar)["input"]
    assert inp["title"] and inp["description"] == "" and inp["involvedRefs"] == []
    assert inp["observedAt"].endswith("Z")


@pytest.mark.parametrize(
    "status,expected",
    [("RESOLVED", "RESOLVE_TENSION"), ("DISSOLVED", "DISSOLVE_TENSION")],
)
def test_closing_transition_is_replayed(id_map, status, expected):
    scalar, _ = tension.build_actions(
        {
            "title": "t",
            "description": "d",
            "involvedRefs": [],
            "status": status,
            "resolution": "settled",
            "resolvedAt": "2026-02-02T00:00:00.000Z",
        },
        id_map,
    )
    assert [a["type"] for a in scalar] == ["CREATE_TENSION", expected]
    assert scalar[1]["input"] == {
        "resolution": "settled",
        "resolvedAt": "2026-02-02T00:00:00.000Z",
    }


def test_open_tension_emits_no_closing_transition(id_map):
    scalar, _ = tension.build_actions(
        {"title": "t", "description": "d", "involvedRefs": [], "status": "OPEN"}, id_map
    )
    assert [a["type"] for a in scalar] == ["CREATE_TENSION"]
