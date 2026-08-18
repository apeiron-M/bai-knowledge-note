"""Edge repair after a lossy reindex."""
import json

import pytest

from atlaslib.push import repair_edges


class RepairGql:
    """Serves a live edge set and records addRelationship calls."""

    READ_ENDPOINT = "http://stub/graphql/r"

    def __init__(self, live):
        self.live = list(live)
        self.added = []
        self.fail_on = set()

    def post(self, query, variables=None, endpoint=None, timeout=None):
        return {
            "knowledgeGraphEdges": [
                {"sourceDocumentId": s, "targetDocumentId": t, "linkType": r}
                for s, t, r in self.live
            ]
        }

    def add_relationship(self, source_id, target_id, relationship_type, branch="main"):
        if (source_id, target_id, relationship_type) in self.fail_on:
            raise RuntimeError("boom")
        self.added.append((source_id, target_id, relationship_type))


@pytest.fixture
def dataset(tmp_path):
    """A MoC with three core ideas, all present in the snapshot."""
    (tmp_path / "states").mkdir()
    manifest = {"documents": [{"id": "moc", "type": "bai/moc"}]}
    (tmp_path / "manifest.json").write_text(json.dumps(manifest))
    (tmp_path / "states" / "moc.json").write_text(
        json.dumps({"coreIdeas": [{"noteRef": n} for n in ("n1", "n2", "n3")]})
    )
    (tmp_path / "id-map.json").write_text(
        json.dumps({"moc": "MOC", "n1": "N1", "n2": "N2", "n3": "N3"})
    )
    return tmp_path


def test_only_missing_edges_are_redispatched(dataset):
    gql = RepairGql([("MOC", "N1", "CORE_IDEA")])
    result = repair_edges(gql, "http://stub/graphql", dataset, "drive", log=lambda _m: None)
    assert sorted(gql.added) == [("MOC", "N2", "CORE_IDEA"), ("MOC", "N3", "CORE_IDEA")]
    assert result == {"missing": 2, "restored": 2, "failed": 0}


def test_a_complete_graph_dispatches_nothing(dataset):
    gql = RepairGql([("MOC", n, "CORE_IDEA") for n in ("N1", "N2", "N3")])
    result = repair_edges(gql, "http://stub/graphql", dataset, "drive", log=lambda _m: None)
    assert gql.added == []
    assert result == {"missing": 0, "restored": 0, "failed": 0}


def test_extracted_claims_are_never_redispatched(dataset, tmp_path):
    # ADD_EXTRACTED_CLAIM appends unconditionally and has no removal
    # operation, so repair must touch relationships only.
    (dataset / "manifest.json").write_text(
        json.dumps({"documents": [{"id": "src", "type": "bai/source"}]})
    )
    (dataset / "states" / "src.json").write_text(
        json.dumps({"extractedClaims": ["n1", "n2"], "links": []})
    )
    gql = RepairGql([])
    repair_edges(gql, "http://stub/graphql", dataset, "drive", log=lambda _m: None)
    assert gql.added == [], "extractedClaims are not edges"


def test_a_failed_dispatch_is_counted_without_aborting_the_batch(dataset):
    gql = RepairGql([])
    gql.fail_on = {("MOC", "N2", "CORE_IDEA")}
    result = repair_edges(gql, "http://stub/graphql", dataset, "drive", log=lambda _m: None)
    assert result == {"missing": 3, "restored": 2, "failed": 1}
    assert ("MOC", "N3", "CORE_IDEA") in gql.added, "later edges still attempted"


def test_edges_whose_endpoints_are_unmapped_are_skipped(dataset):
    (dataset / "id-map.json").write_text(json.dumps({"moc": "MOC", "n1": "N1"}))
    gql = RepairGql([])
    result = repair_edges(gql, "http://stub/graphql", dataset, "drive", log=lambda _m: None)
    assert gql.added == [("MOC", "N1", "CORE_IDEA")]
    assert result["missing"] == 1
