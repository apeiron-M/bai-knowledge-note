"""bai/tension handler."""
from lib.id_map import IdMap
from handlers.tension import build_actions


def _idmap(tmp_path):
    return IdMap(tmp_path / "id-map.json")


def _state(**over):
    s = {"title": "T", "description": "D", "content": "body",
         "involvedRefs": ["a-old", "b-old"], "status": "OPEN",
         "observedAt": "2026-01-01T00:00:00.000Z", "observedBy": "agent",
         "resolution": None, "resolvedAt": None}
    s.update(over); return s


def test_create_tension_carries_refs_remapped(tmp_path):
    im = _idmap(tmp_path); im.set("a-old", "A"); im.set("b-old", "B")
    scalars, _ = build_actions(_state(), im)
    assert [a["type"] for a in scalars] == ["CREATE_TENSION"]
    inp = scalars[0]["input"]
    assert inp["involvedRefs"] == ["A", "B"]
    assert inp["observedBy"] == "agent"
    assert inp["content"] == "body"


def test_unmapped_refs_dropped_when_requested(tmp_path):
    im = _idmap(tmp_path); im.set("a-old", "A")
    scalars, _ = build_actions(_state(), im, drop_unmapped=True)
    assert scalars[0]["input"]["involvedRefs"] == ["A"]


def test_resolved_status_emits_resolve_transition(tmp_path):
    im = _idmap(tmp_path)
    scalars, _ = build_actions(_state(status="RESOLVED", resolution="a won",
                                      resolvedAt="2026-02-02T00:00:00.000Z"), im)
    assert [a["type"] for a in scalars] == ["CREATE_TENSION", "RESOLVE_TENSION"]
    assert scalars[1]["input"] == {"resolution": "a won",
                                   "resolvedAt": "2026-02-02T00:00:00.000Z"}


def test_dissolved_status_emits_dissolve_transition(tmp_path):
    scalars, _ = build_actions(_state(status="DISSOLVED", resolution="compatible",
                                      resolvedAt="2026-03-03T00:00:00.000Z"), _idmap(tmp_path))
    assert scalars[1]["type"] == "DISSOLVE_TENSION"


def test_open_tension_has_no_transition(tmp_path):
    scalars, _ = build_actions(_state(), _idmap(tmp_path))
    assert not any(a["type"].endswith("_TENSION") and a["type"] != "CREATE_TENSION"
                   for a in scalars)


def test_resolved_without_resolved_at_falls_back_to_observed_at(tmp_path):
    scalars, _ = build_actions(_state(status="RESOLVED", resolution="r"), _idmap(tmp_path))
    assert scalars[1]["input"]["resolvedAt"] == "2026-01-01T00:00:00.000Z"
