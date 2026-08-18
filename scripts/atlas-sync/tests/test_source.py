"""bai/source override: extracted-claim de-duplication."""
import pytest

from atlaslib import source
from lib.id_map import IdMap


@pytest.fixture
def id_map(tmp_path):
    m = IdMap(tmp_path / "id-map.json")
    for old in ("c1", "c2", "c3"):
        m.set(old, f"new-{old}")
    return m


def _state(claims):
    return {"title": "A.2 The Support Scope", "content": "body", "extractedClaims": claims}


def _refs(crossref):
    return [
        a["input"]["claimRef"] for a in crossref if a["type"] == "ADD_EXTRACTED_CLAIM"
    ]


def test_repeated_claims_are_collapsed(id_map):
    _, crossref = source.build_actions(_state(["c1", "c2", "c1", "c3", "c2"]), id_map)
    assert _refs(crossref) == ["new-c1", "new-c2", "new-c3"], "first-seen order preserved"


def test_already_unique_claims_are_untouched(id_map):
    _, crossref = source.build_actions(_state(["c1", "c2", "c3"]), id_map)
    assert _refs(crossref) == ["new-c1", "new-c2", "new-c3"]


def test_scalar_actions_still_come_from_the_base_handler(id_map):
    scalar, _ = source.build_actions(_state([]), id_map)
    assert scalar[0]["type"] == "INGEST_SOURCE"
    assert scalar[0]["input"]["title"] == "A.2 The Support Scope"


def test_unmapped_claims_are_dropped_before_deduping(id_map):
    _, crossref = source.build_actions(
        _state(["c1", "ghost", "ghost"]), id_map, drop_unmapped=True
    )
    assert _refs(crossref) == ["new-c1"]
