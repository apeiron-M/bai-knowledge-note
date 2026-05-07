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


def apply_actions(doc_id: str, actions: Iterable[dict], retries: int = 3) -> None:
    """Apply a batch of actions via `docs apply --wait`.

    Each action: {"type": "...", "input": {...}, "scope": "global"} — the
    function injects `id` (UUID) and `timestampUtcMs` (ISO) if missing.
    Blocks until the reactor confirms the job completed.
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
        last_err = ""
        for attempt in range(retries):
            r = subprocess.run(
                ["switchboard", "docs", "apply", doc_id,
                 "--file", tmp, "--wait", "--format", "json"],
                capture_output=True, text=True, timeout=120,
            )
            if r.returncode == 0:
                return
            last_err = r.stderr[:300]
            if attempt < retries - 1:
                time.sleep((attempt + 1) * 3)
        raise RuntimeError(f"apply on {doc_id} failed after {retries} attempts: {last_err}")
    finally:
        os.unlink(tmp)


def mutate(doc_id: str, op: str, input_data: dict, retries: int = 3) -> None:
    """Single-action mutation via `docs mutate --op <camelCase>`."""
    with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
        json.dump(input_data, f)
        tmp = f.name
    try:
        last_err = ""
        for attempt in range(retries):
            r = subprocess.run(
                ["switchboard", "docs", "mutate", doc_id, "--op", op,
                 "--input-file", tmp, "--quiet", "--format", "json"],
                capture_output=True, text=True, timeout=30,
            )
            if r.returncode == 0:
                return
            last_err = r.stderr[:300]
            if attempt < retries - 1:
                time.sleep((attempt + 1) * 2)
        raise RuntimeError(f"mutate {doc_id} --op {op} failed: {last_err}")
    finally:
        os.unlink(tmp)


def docs_create(doc_type: str, name: str, drive: str, retries: int = 3) -> str:
    """Create a document, return its new id."""
    last_err = ""
    for attempt in range(retries):
        r = subprocess.run(
            ["switchboard", "docs", "create",
             "--type", doc_type, "--name", name, "--drive", drive,
             "--format", "json"],
            capture_output=True, text=True, timeout=30,
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
