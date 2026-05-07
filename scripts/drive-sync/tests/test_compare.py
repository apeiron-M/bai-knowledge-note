import json
from pathlib import Path
from compare import compare_dumps


def _write_dump(root: Path, manifest_docs: list, states: dict):
    """Helper to set up a synthetic dump directory."""
    (root / "states").mkdir(parents=True, exist_ok=True)
    (root / "manifest.json").write_text(json.dumps({"documents": manifest_docs, "folders": []}))
    for doc_id, state in states.items():
        (root / "states" / f"{doc_id}.json").write_text(json.dumps(state))


def test_identical_dumps_report_no_diffs(tmp_path):
    a = tmp_path / "a"
    b = tmp_path / "b"
    docs = [{"id": "1", "name": "n", "type": "bai/knowledge-note", "parentFolder": None}]
    states = {"1": {"title": "t", "links": []}}
    _write_dump(a, docs, states)
    _write_dump(b, docs, states)

    report = compare_dumps(a, b)
    assert report["only_in_left"] == []
    assert report["only_in_right"] == []
    assert report["divergent"] == []


def test_doc_only_in_left_is_reported(tmp_path):
    a = tmp_path / "a"
    b = tmp_path / "b"
    _write_dump(a, [{"id": "1", "name": "x", "type": "t", "parentFolder": None}], {"1": {}})
    _write_dump(b, [], {})

    report = compare_dumps(a, b)
    assert report["only_in_left"] == ["1"]
    assert report["only_in_right"] == []


def test_divergent_field_is_reported_with_field_name(tmp_path):
    a = tmp_path / "a"
    b = tmp_path / "b"
    docs = [{"id": "1", "name": "n", "type": "bai/knowledge-note", "parentFolder": None}]
    _write_dump(a, docs, {"1": {"title": "old", "content": "same", "links": []}})
    _write_dump(b, docs, {"1": {"title": "new", "content": "same", "links": []}})

    report = compare_dumps(a, b)
    assert len(report["divergent"]) == 1
    diff = report["divergent"][0]
    assert diff["id"] == "1"
    assert "title" in diff["fields"]
    assert "content" not in diff["fields"]


def test_link_count_difference_is_reported(tmp_path):
    a = tmp_path / "a"
    b = tmp_path / "b"
    docs = [{"id": "1", "name": "n", "type": "bai/knowledge-note", "parentFolder": None}]
    _write_dump(a, docs, {"1": {"title": "x", "links": [{"id": "a"}, {"id": "b"}]}})
    _write_dump(b, docs, {"1": {"title": "x", "links": [{"id": "a"}]}})

    report = compare_dumps(a, b)
    assert report["divergent"][0]["fields"] == ["links_count"]
