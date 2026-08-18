"""Batched-alias read path: query construction, parsing, state projection."""
import pytest

from atlaslib import safe_identifier
from atlaslib.snapshot import (
    attach_relationships,
    build_state_query,
    chunks,
    parse_state_batch,
    state_global,
)

A = "11111111-1111-1111-1111-111111111111"
B = "22222222-2222-2222-2222-222222222222"


def test_chunks_covers_every_item_without_overlap():
    items = list(range(25))
    out = list(chunks(items, 10))
    assert [len(c) for c in out] == [10, 10, 5]
    assert [i for c in out for i in c] == items


def test_state_query_aliases_each_document():
    q = build_state_query([A, B])
    assert f'd0: document(identifier: "{A}")' in q
    assert f'd1: document(identifier: "{B}")' in q


def test_identifiers_are_validated_before_being_inlined():
    # Ids are interpolated into the query string rather than passed as
    # variables, so anything that isn't a uuid must be refused.
    with pytest.raises(ValueError):
        safe_identifier('" ) { __schema { types { name } } } #')
    with pytest.raises(ValueError):
        build_state_query(["not-a-uuid-!!"])


def test_state_batch_tolerates_missing_and_string_encoded_states():
    data = {
        "d0": {"document": {"id": A, "state": {"global": {"title": "kept"}}}},
        "d1": {"document": None},
        "d2": {"document": {"id": B, "state": '{"global": {"title": "decoded"}}'}},
    }
    parsed = parse_state_batch([A, "missing", B], data)
    assert parsed[A]["title"] == "kept"
    assert parsed[B]["title"] == "decoded"
    assert "missing" not in parsed


def test_state_global_handles_absent_state():
    assert state_global({}) == {}


def test_note_relationships_become_links():
    state = attach_relationships(
        {}, "bai/knowledge-note", {"DERIVED_FROM": [B]}, {B: "The Source"}
    )
    assert state["links"] == [
        {
            "id": f"lnk-{B[:8]}-der",
            "linkType": "DERIVED_FROM",
            "targetDocumentId": B,
            "targetTitle": "The Source",
        }
    ]
    assert "coreIdeas" not in state, "only mocs carry coreIdeas"


def test_moc_relationships_split_into_core_ideas_and_children():
    state = attach_relationships(
        {}, "bai/moc", {"CORE_IDEA": [A, B], "CHILD_MOC": [B]}, {}
    )
    assert [c["noteRef"] for c in state["coreIdeas"]] == [A, B]
    assert [c["sortOrder"] for c in state["coreIdeas"]] == [0, 1]
    assert state["childRefs"] == [B]


def test_stale_state_arrays_are_replaced_by_the_live_graph():
    # The relationship table is authoritative; a document's own state may
    # still carry links from before the drive-override migration.
    state = attach_relationships(
        {"links": [{"targetDocumentId": "stale"}]}, "bai/knowledge-note", {}, {}
    )
    assert state["links"] == []


# ── Edge reading ────────────────────────────────────────────────────
# Edges come from one knowledgeGraphEdges query rather than per-document
# lookups: documentOutgoingRelationships clamps limit to 100, ignores
# offset, and then reports totalCount:100 / hasNextPage:false, so a MoC
# with 374 core ideas silently looks complete at 100.

from atlaslib.snapshot import fetch_edges  # noqa: E402


class EdgeGql:
    def __init__(self, edges):
        self.edges = edges
        self.endpoints = []

    def post(self, query, variables=None, endpoint=None, timeout=None):
        self.endpoints.append(endpoint)
        return {"knowledgeGraphEdges": self.edges}


def test_fetch_edges_groups_by_source_and_type():
    gql = EdgeGql(
        [
            {"sourceDocumentId": "moc", "targetDocumentId": A, "linkType": "CORE_IDEA"},
            {"sourceDocumentId": "moc", "targetDocumentId": B, "linkType": "CORE_IDEA"},
            {"sourceDocumentId": "moc", "targetDocumentId": "moc2", "linkType": "CHILD_MOC"},
        ]
    )
    assert fetch_edges(gql, "http://stub/graphql", "drive") == {
        "moc": {"CORE_IDEA": [A, B], "CHILD_MOC": ["moc2"]}
    }
    assert gql.endpoints == ["http://stub/graphql/knowledgeGraph"]


def test_fetch_edges_drops_reactor_containment_edges():
    # The projection also carries `child` edges (drive -> document).
    # They are not knowledge edges and no handler emits them.
    gql = EdgeGql(
        [
            {"sourceDocumentId": "drive", "targetDocumentId": A, "linkType": "child"},
            {"sourceDocumentId": A, "targetDocumentId": B, "linkType": "DERIVED_FROM"},
        ]
    )
    assert fetch_edges(gql, "http://stub/graphql", "drive") == {A: {"DERIVED_FROM": [B]}}


def test_fetch_edges_tolerates_an_empty_graph():
    assert fetch_edges(EdgeGql([]), "http://stub/graphql", "drive") == {}


# --- clear_stale_snapshot -------------------------------------------------
#
# Regression: `download` used to write into whatever was already in the
# output directory. Snapshotting a second drive into a used directory left
# 3061 state files (the union of both drives), and the leftover
# `id-map.json` from an earlier rebuild made `verify` report 0/1528
# matched — a false total-loss result on a perfectly good snapshot.


def _snapshot_dir(tmp_path, states=(), artifacts=()):
    (tmp_path / "states").mkdir(parents=True, exist_ok=True)
    for name in states:
        (tmp_path / "states" / f"{name}.json").write_text("{}")
    for name in artifacts:
        (tmp_path / name).write_text("{}")
    return tmp_path


def test_clear_stale_snapshot_removes_previous_state_files(tmp_path):
    from atlaslib.snapshot import clear_stale_snapshot

    out = _snapshot_dir(tmp_path, states=[A, B])
    removed, artifacts = clear_stale_snapshot(out, log=lambda _m: None)

    assert removed == 2
    assert artifacts == []
    assert list((out / "states").glob("*.json")) == []


def test_clear_stale_snapshot_removes_rebuild_artifacts(tmp_path):
    """`id-map.json` is the one that silently breaks `verify`."""
    from atlaslib.snapshot import clear_stale_snapshot

    out = _snapshot_dir(
        tmp_path, states=[A], artifacts=["id-map.json", "upload-summary.json"]
    )
    removed, artifacts = clear_stale_snapshot(out, log=lambda _m: None)

    assert removed == 1
    assert sorted(artifacts) == ["id-map.json", "upload-summary.json"]
    assert not (out / "id-map.json").exists()
    assert not (out / "upload-summary.json").exists()


def test_clear_stale_snapshot_keeps_files_download_rewrites(tmp_path):
    """drive-info/tree/manifest are overwritten wholesale; leave them be."""
    from atlaslib.snapshot import clear_stale_snapshot

    out = _snapshot_dir(tmp_path, artifacts=["drive-info.json", "tree.json"])
    clear_stale_snapshot(out, log=lambda _m: None)

    assert (out / "drive-info.json").exists()
    assert (out / "tree.json").exists()


def test_clear_stale_snapshot_is_quiet_and_safe_on_a_fresh_dir(tmp_path):
    from atlaslib.snapshot import clear_stale_snapshot

    out = _snapshot_dir(tmp_path)
    messages: list[str] = []
    removed, artifacts = clear_stale_snapshot(out, log=messages.append)

    assert (removed, artifacts) == (0, [])
    assert messages == []
