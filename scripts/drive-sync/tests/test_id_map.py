import json
from pathlib import Path
import pytest
from lib.id_map import IdMap


def test_get_returns_none_for_unknown(tmp_path):
    m = IdMap(tmp_path / "id-map.json")
    assert m.get("nope") is None


def test_set_and_get(tmp_path):
    m = IdMap(tmp_path / "id-map.json")
    m.set("old", "new")
    assert m.get("old") == "new"


def test_set_persists_immediately(tmp_path):
    path = tmp_path / "id-map.json"
    m = IdMap(path)
    m.set("a", "1")
    on_disk = json.loads(path.read_text())
    assert on_disk == {"a": "1"}


def test_load_existing_file(tmp_path):
    path = tmp_path / "id-map.json"
    path.write_text(json.dumps({"x": "y"}))
    m = IdMap(path)
    assert m.get("x") == "y"


def test_resolve_returns_input_if_unmapped(tmp_path):
    m = IdMap(tmp_path / "id-map.json")
    m.set("known", "mapped")
    assert m.resolve("known") == "mapped"
    assert m.resolve("unknown") == "unknown"
    assert m.resolve(None) is None
    assert m.resolve("") == ""


def test_atomic_write_no_partial_file_on_crash(tmp_path, monkeypatch):
    """If os.replace fails mid-write, the original file remains untouched."""
    path = tmp_path / "id-map.json"
    path.write_text(json.dumps({"a": "1"}))
    m = IdMap(path)

    import os
    real_replace = os.replace
    def fail(src, dst):
        raise OSError("simulated crash")
    monkeypatch.setattr(os, "replace", fail)

    with pytest.raises(OSError):
        m.set("b", "2")

    monkeypatch.setattr(os, "replace", real_replace)
    on_disk = json.loads(path.read_text())
    assert on_disk == {"a": "1"}, "file should be untouched after failed atomic write"
