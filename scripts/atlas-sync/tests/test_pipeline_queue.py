"""bai/pipeline-queue override: task de-duplication."""
import pytest

from atlaslib import pipeline_queue
from lib.id_map import IdMap


@pytest.fixture
def id_map(tmp_path):
    return IdMap(tmp_path / "id-map.json")


def _task(tid, target, **kw):
    return {"id": tid, "taskType": "claim", "target": target,
            "createdAt": "2026-01-01T00:00:00.000Z", **kw}


def _added(crossref):
    return [a["input"]["target"] for a in crossref if a["type"] == "ADD_TASK"]


def test_duplicate_task_ids_are_collapsed(id_map):
    # Every queue op resolves by `tasks.find(id)`, so a second task with
    # the same id is unreachable forever and only inflates activeCount.
    _, crossref = pipeline_queue.build_actions(
        {"tasks": [_task("t1", "real run"), _task("t1", "ghost")]}, id_map
    )
    assert _added(crossref) == ["real run"], "first occurrence wins"


def test_distinct_tasks_all_survive(id_map):
    _, crossref = pipeline_queue.build_actions(
        {"tasks": [_task("t1", "a"), _task("t2", "b")]}, id_map
    )
    assert _added(crossref) == ["a", "b"]


def test_task_lifecycle_still_replays(id_map):
    _, crossref = pipeline_queue.build_actions(
        {"tasks": [_task("t1", "a", assignedTo="knowledge-agent", status="DONE")]}, id_map
    )
    assert [a["type"] for a in crossref] == ["ADD_TASK", "ASSIGN_TASK", "COMPLETE_TASK"]


def test_empty_queue_produces_nothing(id_map):
    assert pipeline_queue.build_actions({"tasks": []}, id_map) == ([], [])
