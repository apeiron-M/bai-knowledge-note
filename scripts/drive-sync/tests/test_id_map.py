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


# --- target scoping -------------------------------------------------------
#
# Regression: a snapshot directory reused across targets carried its old
# id-map. phase_2 skips any document that already has an entry, so the run
# skipped 1526 documents it had never created on that reactor, reported
# "created+placed 1528 docs" from the map's size, and then timed out in
# phase 3 mutating ids that did not exist there. Only 2 documents landed.


def test_binds_target_on_first_use(tmp_path):
    from lib.id_map import IdMap, TARGET_KEY
    import json as _json

    m = IdMap(tmp_path / "id-map.json", target="https://a/graphql#drive-1")
    m.set("old", "new")

    written = _json.loads((tmp_path / "id-map.json").read_text())
    assert written[TARGET_KEY] == "https://a/graphql#drive-1"
    assert written["old"] == "new"


def test_reopening_with_the_same_target_is_fine(tmp_path):
    from lib.id_map import IdMap

    IdMap(tmp_path / "id-map.json", target="https://a/graphql#d1").set("old", "new")
    again = IdMap(tmp_path / "id-map.json", target="https://a/graphql#d1")

    assert again.get("old") == "new"
    assert "__target__" not in again.all()


def test_refuses_a_map_built_for_another_target(tmp_path):
    import pytest as _pytest
    from lib.id_map import IdMap

    IdMap(tmp_path / "id-map.json", target="https://local/graphql#d1").set("old", "new")

    with _pytest.raises(RuntimeError, match="was built against"):
        IdMap(tmp_path / "id-map.json", target="https://remote/graphql#d2")


def test_refuses_a_populated_map_with_no_target_stamp(tmp_path):
    """Legacy maps predate the stamp; they cannot be proven safe."""
    import json as _json
    import pytest as _pytest
    from lib.id_map import IdMap

    (tmp_path / "id-map.json").write_text(_json.dumps({"old": "new"}))

    with _pytest.raises(RuntimeError, match="records no target"):
        IdMap(tmp_path / "id-map.json", target="https://remote/graphql#d2")


def test_adopts_an_empty_legacy_map(tmp_path):
    import json as _json
    from lib.id_map import IdMap

    (tmp_path / "id-map.json").write_text(_json.dumps({}))
    m = IdMap(tmp_path / "id-map.json", target="https://remote/graphql#d2")
    m.set("a", "b")

    assert m.get("a") == "b"
