"""Relationship allow-list filtering and handler registration."""
from types import SimpleNamespace

from atlaslib.push import STRUCTURAL_LINK_TYPES, filter_crossrefs, register_handlers


def _rel(target, rel_type):
    return {
        "type": "ADD_RELATIONSHIP",
        "scope": "document",
        "input": {"targetId": target, "relationshipType": rel_type},
    }


DEFERRED = {
    "note-a": [_rel("src-1", "DERIVED_FROM"), _rel("note-b", "RELATES_TO")],
    "moc-a": [_rel("note-a", "CORE_IDEA")],
    "note-b": [_rel("note-a", "RELATES_TO")],
    "source-a": [{"type": "ADD_EXTRACTED_CLAIM", "input": {"claimRef": "note-a"}}],
}


def test_allow_none_keeps_everything():
    out, dropped = filter_crossrefs(DEFERRED, None)
    assert out is DEFERRED and dropped == {}


def test_structural_only_drops_similarity_edges():
    out, dropped = filter_crossrefs(DEFERRED, STRUCTURAL_LINK_TYPES)
    assert dropped == {"RELATES_TO": 2}
    assert [a["input"]["relationshipType"] for a in out["note-a"]] == ["DERIVED_FROM"]
    assert "note-b" not in out, "documents left with no actions are dropped entirely"


def test_non_relationship_crossrefs_always_survive():
    out, _ = filter_crossrefs(DEFERRED, ("CORE_IDEA",))
    assert out["source-a"][0]["type"] == "ADD_EXTRACTED_CLAIM"


def test_register_handlers_adds_tension_after_notes_and_mocs():
    upload = SimpleNamespace(
        HANDLERS={"bai/knowledge-note": object()},
        TYPE_ORDER={"bai/knowledge-note": 1, "bai/moc": 2},
    )
    register_handlers(upload)
    assert "bai/tension" in upload.HANDLERS
    assert upload.TYPE_ORDER["bai/tension"] > upload.TYPE_ORDER["bai/moc"]
