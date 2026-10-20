"""Snapshot-vs-live comparison logic."""
import json

from atlaslib.verify import compare_fields, snapshot_edges


def test_matching_fields_report_no_difference():
    doc = {"title": "T", "description": "D", "content": "C", "noteType": "concept"}
    assert compare_fields(doc, dict(doc)) == []


def test_missing_content_is_reported():
    diffs = compare_fields({"title": "T", "content": "long body"}, {"title": "T"})
    assert len(diffs) == 1 and diffs[0].startswith("content:")


def test_fields_absent_from_the_snapshot_are_not_required_live():
    # The handlers only emit a setter when the snapshot has a value, so a
    # live default must not be counted as drift.
    assert compare_fields({"title": "T"}, {"title": "T", "status": "DRAFT"}) == []


def test_topic_count_drift_is_reported():
    diffs = compare_fields({"topics": [{"id": "1"}, {"id": "2"}]}, {"topics": [{"id": "1"}]})
    assert diffs == ["topics: expected 2, got 1"]


def test_snapshot_edges_reads_all_three_state_shapes(tmp_path):
    (tmp_path / "states").mkdir()
    manifest = {"documents": [{"id": "note", "type": "bai/knowledge-note"}, {"id": "moc", "type": "bai/moc"}]}
    (tmp_path / "states" / "note.json").write_text(
        json.dumps({"links": [{"targetDocumentId": "src", "linkType": "DERIVED_FROM"}]})
    )
    (tmp_path / "states" / "moc.json").write_text(
        json.dumps({"coreIdeas": [{"noteRef": "note"}], "childRefs": ["moc2"]})
    )
    assert snapshot_edges(tmp_path, manifest) == {
        ("note", "src", "DERIVED_FROM"),
        ("moc", "note", "CORE_IDEA"),
        ("moc", "moc2", "CHILD_MOC"),
    }


def test_snapshot_edges_skips_documents_with_no_state_file(tmp_path):
    (tmp_path / "states").mkdir()
    assert snapshot_edges(tmp_path, {"documents": [{"id": "gone"}]}) == set()


# ── id-map fallback ─────────────────────────────────────────────────

from atlaslib.verify import load_id_map  # noqa: E402


def test_id_map_is_read_when_a_replay_produced_one(tmp_path):
    (tmp_path / "id-map.json").write_text(json.dumps({"old": "new"}))
    assert load_id_map(tmp_path, {"documents": [{"id": "old"}]}) == {"old": "new"}


def test_a_self_snapshot_falls_back_to_identity(tmp_path):
    # A snapshot taken from the drive being checked has no id-map and
    # needs none — its ids are already the live ids. This is the shape
    # of every post-reindex repair.
    manifest = {"documents": [{"id": "a"}, {"id": "b"}]}
    assert load_id_map(tmp_path, manifest) == {"a": "a", "b": "b"}
