"""switchboard CLI subprocess wrappers.

Conventions:
  - apply_actions: dispatches a list of typed actions via `docs apply --wait`
    (one network call). Injects `id` and `timestampUtcMs` per action.
  - mutate: single-action via `docs mutate --op <camelCase>` for cases where
    apply isn't appropriate (rare — prefer apply_actions for batching).
  - All callers use timeouts, retries, and surface stderr on failure.
"""
import datetime
import json
import os
import subprocess
import tempfile
import time
import uuid
from typing import Any, Iterable


def _now_iso() -> str:
    n = datetime.datetime.now(datetime.timezone.utc)
    return n.strftime("%Y-%m-%dT%H:%M:%S.") + f"{n.microsecond // 1000:03d}Z"


def sb(*args: str, check: bool = True, timeout: float = 60.0) -> str:
    """Run `switchboard <args> --format json`, return stdout."""
    cmd = ["switchboard", *args, "--format", "json"]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    if check and result.returncode != 0:
        raise RuntimeError(f"command failed: {' '.join(cmd)}\n{result.stderr[:500]}")
    return result.stdout


def sb_query(query: str) -> Any:
    """Run a raw GraphQL query against the active switchboard via the CLI."""
    cmd = ["switchboard", "query", query, "--format", "json"]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
    if result.returncode != 0:
        raise RuntimeError(f"sb query failed: {result.stderr[:500]}")
    return json.loads(result.stdout) if result.stdout.strip() else None


def wait_for_doc(doc_id: str, timeout: int = 15) -> bool:
    """Poll `docs get` until the doc is visible or the timeout elapses."""
    for _ in range(timeout):
        r = subprocess.run(
            ["switchboard", "docs", "get", doc_id, "--format", "json"],
            capture_output=True, text=True, timeout=10,
        )
        if r.returncode == 0:
            return True
        time.sleep(1)
    return False


def apply_actions(doc_id: str, actions: Iterable[dict]) -> None:
    """Apply a batch of actions via `docs apply --wait`.

    Each action: {"type": "...", "input": {...}, "scope": "global"} — the
    function injects `id` (UUID) and `timestampUtcMs` (ISO) if missing.
    Blocks until the reactor confirms the job completed.

    No retries: a partial failure mid-batch would double-apply the
    successful prefix on retry, creating duplicate ADD_TOPIC / ADD_LINK /
    ADD_CHECK / ADD_NODE entries with the same OID. The orchestrator in
    upload.py catches per-doc failures and continues; on a transient blip
    the user re-runs the upload (Phase 2 is idempotent via id-map).
    """
    actions = list(actions)
    if not actions:
        return
    iso = _now_iso()
    for a in actions:
        a.setdefault("id", str(uuid.uuid4()))
        a.setdefault("timestampUtcMs", iso)
        a.setdefault("scope", "global")

    with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
        json.dump(actions, f)
        tmp = f.name
    try:
        r = subprocess.run(
            ["switchboard", "docs", "apply", doc_id,
             "--file", tmp, "--wait", "--format", "json"],
            capture_output=True, text=True, timeout=120,
        )
        if r.returncode != 0:
            raise RuntimeError(f"apply on {doc_id} failed: {r.stderr[:300]}")
    finally:
        os.unlink(tmp)


def mutate(doc_id: str, op: str, input_data: dict) -> None:
    """Single-action mutation via `docs mutate --op <camelCase>`.

    No retries: same partial-application risk as apply_actions. Single
    actions are less likely to partially apply, but the schema-level
    invariants (e.g., unique OID) make double-dispatch unsafe.
    """
    with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
        json.dump(input_data, f)
        tmp = f.name
    try:
        r = subprocess.run(
            ["switchboard", "docs", "mutate", doc_id, "--op", op,
             "--input-file", tmp, "--quiet", "--format", "json"],
            capture_output=True, text=True, timeout=30,
        )
        if r.returncode != 0:
            raise RuntimeError(f"mutate {doc_id} --op {op} failed: {r.stderr[:300]}")
    finally:
        os.unlink(tmp)


def docs_create(
    doc_type: str,
    name: str,
    drive: str,
    parent_folder: str | None = None,
    retries: int = 3,
) -> str:
    """Create a document, return its new id.

    When `parent_folder` is set, the document is created INSIDE that folder
    on the drive — no follow-up MOVE_NODE batch is needed. Skipping the
    post-create move drops ~3.4× MOVE_NODE ops per document from the drive's
    own op log (the drive's reducer reshuffles its `nodes[]` array on each
    move) and roughly halves the drive doc's keyframe footprint.
    """
    last_err = ""
    base_args = ["switchboard", "docs", "create",
                 "--type", doc_type, "--name", name, "--drive", drive,
                 "--format", "json"]
    if parent_folder:
        base_args += ["--parent-folder", parent_folder]
    for attempt in range(retries):
        r = subprocess.run(
            base_args, capture_output=True, text=True, timeout=30,
        )
        if r.returncode == 0:
            data = json.loads(r.stdout)
            new_id = _find_id(data)
            if not new_id:
                raise RuntimeError(f"could not parse id from: {json.dumps(data)[:200]}")
            wait_for_doc(new_id)
            return new_id
        last_err = r.stderr[:300]
        if attempt < retries - 1:
            time.sleep((attempt + 1) * 3)
    raise RuntimeError(f"docs create '{name}' failed after {retries} attempts: {last_err}")


def _find_id(obj: Any) -> str | None:
    """Recursively find the first 'id' string field in a parsed JSON response."""
    if isinstance(obj, dict):
        if isinstance(obj.get("id"), str):
            return obj["id"]
        for v in obj.values():
            r = _find_id(v)
            if r:
                return r
    elif isinstance(obj, list):
        for v in obj:
            r = _find_id(v)
            if r:
                return r
    return None


def drives_create(name: str, preferred_editor: str | None = None) -> tuple[str, str]:
    """Create a drive, return (id, slug).

    `preferred_editor` is the drive-level editor module name. The Knowledge
    Vault is a custom drive that needs `preferred_editor='knowledge-vault'`
    for Connect to mount the right drive editor.
    """
    args = ["drives", "create", "--name", name]
    if preferred_editor:
        args += ["--preferred-editor", preferred_editor]
    out = sb(*args)
    data = json.loads(out)
    return data["id"], data["slug"]


def get_drive_tree_nodes(drive_id_or_slug: str) -> list[dict]:
    """Return the drive's tree node list (folders + files) via local switchboard."""
    out = sb("docs", "tree", drive_id_or_slug)
    tree = json.loads(out)
    try:
        return tree["document"]["state"]["global"]["nodes"]
    except (KeyError, TypeError):
        return tree.get("nodes", [])
