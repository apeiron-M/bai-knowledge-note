"""bai/pipeline-queue handler — drive-sync's, plus task de-duplication.

`ADD_TASK` pushes onto `state.tasks` with no duplicate-id guard, while
every other queue operation resolves its target with
`state.tasks.find(t => t.id === taskId)` — which always returns the
*first* match. A second task sharing an id is therefore unreachable
forever: it can never be assigned, advanced, completed or failed, and it
inflates `activeCount` permanently.

The local rehearsal drive acquired one such ghost. Replaying a snapshot
would faithfully recreate it on the remote, so tasks are collapsed by id
here, keeping the first occurrence.

The underlying model should reject the duplicate outright (an
`ADD_TASK` / `DuplicateTaskIdError` pair); until it does, this keeps the
rebuild clean.
"""
from handlers import pipeline_queue as base


def build_actions(state, id_map, drop_unmapped: bool = True):
    seen: set[str] = set()
    tasks = []
    for task in state.get("tasks") or []:
        task_id = task.get("id")
        if task_id in seen:
            continue
        seen.add(task_id)
        tasks.append(task)

    return base.build_actions({**state, "tasks": tasks}, id_map, drop_unmapped)
