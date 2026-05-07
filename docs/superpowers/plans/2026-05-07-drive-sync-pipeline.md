# Drive Sync Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a state-based migration pipeline that downloads the canonical `powerhouse-vault` drive via GraphQL and uploads it to a local switchboard via the `switchboard` CLI, reconstructing each document's state through current-schema mutations rather than replaying historical operations.

**Architecture:** Bash entry points (`upload.sh`, `reindex.sh`) wrap Python implementations. Python is split into a pure-function core (state → mutation tuples, ID remapping, GraphQL parsing) and IO shells (subprocess wrappers, HTTP). Per-type handlers live in `handlers/<type>.py`; pure logic is unit-tested with pytest, IO is verified by running against a real local switchboard.

**Tech Stack:** Bash, Python 3.10+, `switchboard` CLI (Powerhouse), `urllib`/`requests` for GraphQL, `pytest` for unit tests. No bun, no node — sidesteps the bun spawnSync env-leak.

**Reference:** `/home/p/Powerhouse/demos/contributor-billing/scripts/drive-sync/` is the working pattern this plan adapts.

**Spec:** [docs/superpowers/specs/2026-05-07-drive-sync-pipeline-design.md](../specs/2026-05-07-drive-sync-pipeline-design.md)

---

## File Structure

```
scripts/drive-sync/
├── lib/
│   ├── common.sh           # bash logging + preflight (sourced by upload.sh / reindex.sh)
│   ├── sb.py               # switchboard CLI subprocess wrappers (apply, mutate, create, retry, batch)
│   ├── graphql.py          # GraphQL HTTP client (POST query/variables, parse data/errors)
│   └── id_map.py           # persistent old-id → new-id mapping with atomic write
├── handlers/
│   ├── __init__.py
│   ├── knowledge_note.py   # build + apply actions for bai/knowledge-note
│   ├── moc.py              # bai/moc
│   ├── source.py           # bai/source
│   ├── knowledge_graph.py  # bai/knowledge-graph (singleton)
│   ├── pipeline_queue.py   # bai/pipeline-queue (singleton)
│   ├── health_report.py    # bai/health-report (singleton)
│   └── vault_config.py     # bai/vault-config (singleton)
├── download.py             # Phase 0
├── compare.py              # Phase 0.5
├── upload.py               # Phases 1-4 orchestrator
├── upload.sh               # bash wrapper around upload.py
├── reindex.py              # Phase 5
├── reindex.sh              # bash wrapper around reindex.py
├── tests/
│   ├── conftest.py
│   ├── test_id_map.py
│   ├── test_graphql.py
│   ├── test_compare.py
│   ├── test_handler_knowledge_note.py
│   ├── test_handler_moc.py
│   └── test_handler_source.py
└── data/                   # output, .gitignore'd
    └── .gitkeep
```

**Boundary principle:** every handler exposes a pure `build_actions(state, id_map) -> (scalar_actions, crossref_actions)` function plus a thin `apply(...)` IO wrapper. Tests target the pure layer.

---

## Conventions used throughout

- All paths absolute from the project root: `scripts/drive-sync/...`.
- All commits use `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.
- Run all `python` invocations as `python3` (project doesn't pin a venv for these scripts).
- Tests run from project root: `python3 -m pytest scripts/drive-sync/tests/ -v`.
- `switchboard` CLI is invoked with the user's `local` profile already active (preflight asserts this).
- Action shape sent to `switchboard docs apply`: `{"type": "<UPPER_SNAKE>", "input": {...}, "scope": "global", "id": "<uuid>", "timestampUtcMs": "<iso>"}`.
- Mutation shape sent to `switchboard docs mutate`: `--op <camelCase>` + JSON input (no `id`, no `timestampUtcMs` injection — switchboard adds those).

---

## Task 1: Scaffold the directory + .gitignore

**Files:**
- Create: `scripts/drive-sync/data/.gitkeep`
- Create: `scripts/drive-sync/.gitignore`
- Create: `scripts/drive-sync/handlers/__init__.py`
- Create: `scripts/drive-sync/tests/__init__.py`
- Create: `scripts/drive-sync/tests/conftest.py`

- [ ] **Step 1: Create the directory layout**

```bash
mkdir -p scripts/drive-sync/lib scripts/drive-sync/handlers scripts/drive-sync/tests scripts/drive-sync/data
touch scripts/drive-sync/data/.gitkeep
touch scripts/drive-sync/handlers/__init__.py
touch scripts/drive-sync/tests/__init__.py
```

- [ ] **Step 2: Create .gitignore**

Contents of `scripts/drive-sync/.gitignore`:

```
data/*
!data/.gitkeep
__pycache__/
*.pyc
.pytest_cache/
```

- [ ] **Step 3: Create conftest.py**

Contents of `scripts/drive-sync/tests/conftest.py`:

```python
"""Pytest config — adds scripts/drive-sync to sys.path so tests can import lib/ and handlers/."""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
```

- [ ] **Step 4: Verify pytest can import**

Run: `python3 -m pytest scripts/drive-sync/tests/ -v --collect-only`
Expected: `no tests ran in 0.0Xs` (no errors).

- [ ] **Step 5: Commit**

```bash
git add scripts/drive-sync/
git commit -m "$(cat <<'EOF'
chore: scaffold scripts/drive-sync/ directory

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: lib/common.sh — bash logging + preflight

**Files:**
- Create: `scripts/drive-sync/lib/common.sh`

- [ ] **Step 1: Write common.sh**

Contents of `scripts/drive-sync/lib/common.sh`:

```bash
#!/usr/bin/env bash
###############################################################################
# common.sh — Shared helpers for drive-sync scripts (sourced, not executed)
###############################################################################

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log()  { echo -e "${GREEN}  ✓${NC} $*"; }
warn() { echo -e "${YELLOW}  !${NC} $*"; }
err()  { echo -e "${RED}  ✗${NC} $*" >&2; }
step() { echo -e "\n${CYAN}━━━ $* ━━━${NC}"; }
die()  { err "$@"; exit 1; }

# Assert all required tools exist and switchboard is reachable on the active profile.
preflight() {
  command -v switchboard >/dev/null 2>&1 || die "switchboard CLI not found"
  command -v python3     >/dev/null 2>&1 || die "python3 not found"
  switchboard ping --format json >/dev/null 2>&1 || die "Switchboard not reachable"
  log "Switchboard reachable"
}

# Print active profile name + url.
get_active_profile() {
  switchboard config show --format json 2>/dev/null \
    | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('name','?'), d.get('url','?'))" 2>/dev/null
}

# Refuse to proceed unless the active profile equals $1.
assert_profile() {
  local expected="$1"
  local info actual_name
  info=$(get_active_profile)
  actual_name=$(echo "$info" | cut -d' ' -f1)
  if [ "$actual_name" != "$expected" ]; then
    die "Expected profile '$expected' but active profile is '$actual_name'. Aborting."
  fi
  log "Profile: $actual_name"
}
```

- [ ] **Step 2: Test it sources without error**

```bash
bash -c 'source scripts/drive-sync/lib/common.sh && step "test" && log "ok"'
```

Expected: prints a cyan "━━━ test ━━━" header and a green "✓ ok".

- [ ] **Step 3: Commit**

```bash
git add scripts/drive-sync/lib/common.sh
git commit -m "$(cat <<'EOF'
feat(drive-sync): lib/common.sh — bash logging + preflight

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: lib/id_map.py — persistent ID remapping

**Files:**
- Create: `scripts/drive-sync/lib/id_map.py`
- Create: `scripts/drive-sync/lib/__init__.py`
- Create: `scripts/drive-sync/tests/test_id_map.py`

- [ ] **Step 1: Write the failing test**

Contents of `scripts/drive-sync/tests/test_id_map.py`:

```python
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
```

- [ ] **Step 2: Create the empty lib/__init__.py and run the test to confirm failure**

```bash
touch scripts/drive-sync/lib/__init__.py
python3 -m pytest scripts/drive-sync/tests/test_id_map.py -v
```

Expected: `ModuleNotFoundError: No module named 'lib.id_map'`.

- [ ] **Step 3: Implement id_map.py**

Contents of `scripts/drive-sync/lib/id_map.py`:

```python
"""Persistent old-id → new-id mapping for cross-drive migration.

Writes are atomic (write-to-tmp + os.replace) so a crash mid-run leaves
either the previous state or the new state on disk — never partial.
"""
import json
import os
import tempfile
from pathlib import Path
from typing import Optional


class IdMap:
    def __init__(self, path: Path):
        self.path = Path(path)
        if self.path.exists():
            self._data = json.loads(self.path.read_text())
        else:
            self._data = {}

    def get(self, old_id: str) -> Optional[str]:
        return self._data.get(old_id)

    def set(self, old_id: str, new_id: str) -> None:
        self._data[old_id] = new_id
        self._flush()

    def resolve(self, old_id: Optional[str]) -> Optional[str]:
        """Map old → new if known, else return input unchanged. None and '' pass through."""
        if not old_id:
            return old_id
        return self._data.get(old_id, old_id)

    def all(self) -> dict:
        return dict(self._data)

    def _flush(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(
            mode="w", dir=str(self.path.parent), delete=False, suffix=".tmp"
        ) as f:
            json.dump(self._data, f, indent=2)
            tmp = f.name
        os.replace(tmp, self.path)
```

- [ ] **Step 4: Run the tests and verify they pass**

```bash
python3 -m pytest scripts/drive-sync/tests/test_id_map.py -v
```

Expected: `6 passed`.

- [ ] **Step 5: Commit**

```bash
git add scripts/drive-sync/lib/__init__.py scripts/drive-sync/lib/id_map.py scripts/drive-sync/tests/test_id_map.py
git commit -m "$(cat <<'EOF'
feat(drive-sync): lib/id_map.py with atomic-write persistence + tests

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: lib/graphql.py — HTTP client for source switchboard

**Files:**
- Create: `scripts/drive-sync/lib/graphql.py`
- Create: `scripts/drive-sync/tests/test_graphql.py`

- [ ] **Step 1: Write the failing test**

Contents of `scripts/drive-sync/tests/test_graphql.py`:

```python
"""Tests for GraphQL client — uses urllib mocking so no network needed."""
import json
from unittest.mock import patch, MagicMock
import pytest
from lib.graphql import GraphQLClient, GraphQLError


def _mock_urlopen(payload, status=200):
    resp = MagicMock()
    resp.read.return_value = json.dumps(payload).encode()
    resp.status = status
    resp.__enter__ = lambda self: self
    resp.__exit__ = lambda self, *a: None
    return resp


def test_query_returns_data_field():
    client = GraphQLClient("https://example.test/graphql")
    with patch("lib.graphql.urlopen", return_value=_mock_urlopen({"data": {"foo": 1}})):
        result = client.query("{ foo }")
    assert result == {"foo": 1}


def test_query_raises_on_graphql_errors():
    client = GraphQLClient("https://example.test/graphql")
    payload = {"errors": [{"message": "bad query"}]}
    with patch("lib.graphql.urlopen", return_value=_mock_urlopen(payload)):
        with pytest.raises(GraphQLError) as exc:
            client.query("{ broken }")
    assert "bad query" in str(exc.value)


def test_query_passes_variables():
    captured = {}
    def fake_urlopen(req, **kw):
        captured["body"] = json.loads(req.data.decode())
        return _mock_urlopen({"data": {"ok": True}})
    client = GraphQLClient("https://example.test/graphql")
    with patch("lib.graphql.urlopen", side_effect=fake_urlopen):
        client.query("query Q($id: String!) { document(identifier: $id) { id } }", {"id": "abc"})
    assert captured["body"]["query"].startswith("query Q")
    assert captured["body"]["variables"] == {"id": "abc"}


def test_query_includes_operation_name_when_provided():
    captured = {}
    def fake_urlopen(req, **kw):
        captured["body"] = json.loads(req.data.decode())
        return _mock_urlopen({"data": {"ok": True}})
    client = GraphQLClient("https://example.test/graphql")
    with patch("lib.graphql.urlopen", side_effect=fake_urlopen):
        client.query("{ ok }", operation_name="GetOk")
    assert captured["body"]["operationName"] == "GetOk"
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
python3 -m pytest scripts/drive-sync/tests/test_graphql.py -v
```

Expected: `ModuleNotFoundError: No module named 'lib.graphql'`.

- [ ] **Step 3: Implement graphql.py**

Contents of `scripts/drive-sync/lib/graphql.py`:

```python
"""Minimal GraphQL client built on stdlib urllib — no third-party deps.

Used to fetch from the source switchboard. The `switchboard` CLI is not
involved on the source side: this script reads only via GraphQL so it can
target any switchboard that exposes a GraphQL endpoint.
"""
import json
from typing import Optional
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError


class GraphQLError(RuntimeError):
    pass


class GraphQLClient:
    def __init__(self, endpoint: str, timeout: float = 60.0):
        self.endpoint = endpoint
        self.timeout = timeout

    def query(
        self,
        query: str,
        variables: Optional[dict] = None,
        operation_name: Optional[str] = None,
    ) -> dict:
        body = {"query": query}
        if variables is not None:
            body["variables"] = variables
        if operation_name is not None:
            body["operationName"] = operation_name

        req = Request(
            self.endpoint,
            data=json.dumps(body).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )

        try:
            with urlopen(req, timeout=self.timeout) as resp:
                payload = json.loads(resp.read().decode())
        except HTTPError as e:
            raise GraphQLError(f"HTTP {e.code} from {self.endpoint}: {e.reason}") from e
        except URLError as e:
            raise GraphQLError(f"Network error to {self.endpoint}: {e.reason}") from e

        errors = payload.get("errors")
        if errors:
            messages = "; ".join(e.get("message", "?") for e in errors)
            raise GraphQLError(f"GraphQL errors: {messages}")

        return payload.get("data", {})
```

- [ ] **Step 4: Run the tests and verify they pass**

```bash
python3 -m pytest scripts/drive-sync/tests/test_graphql.py -v
```

Expected: `4 passed`.

- [ ] **Step 5: Commit**

```bash
git add scripts/drive-sync/lib/graphql.py scripts/drive-sync/tests/test_graphql.py
git commit -m "$(cat <<'EOF'
feat(drive-sync): lib/graphql.py — stdlib-only GraphQL client + tests

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: lib/sb.py — switchboard CLI subprocess wrappers

**Files:**
- Create: `scripts/drive-sync/lib/sb.py`

This module is mostly IO, so unit tests are skipped — it's verified by the integration runs in later tasks.

- [ ] **Step 1: Write sb.py**

Contents of `scripts/drive-sync/lib/sb.py`:

```python
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
```

- [ ] **Step 2: Smoke test the import**

Run: `python3 -c "from scripts.drive_sync.lib import sb; print(sb._now_iso())"`

(Note: this works only if you add a `__init__.py` to `scripts/`. If you don't want that, run from inside `scripts/drive-sync/`: `cd scripts/drive-sync && python3 -c "from lib import sb; print(sb._now_iso())"`.)

Expected: prints an ISO-8601 timestamp.

- [ ] **Step 3: Commit**

```bash
git add scripts/drive-sync/lib/sb.py
git commit -m "$(cat <<'EOF'
feat(drive-sync): lib/sb.py — switchboard CLI wrappers (apply, mutate, create)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: download.py — Phase 0 (GraphQL fetch)

**Files:**
- Create: `scripts/drive-sync/download.py`

- [ ] **Step 1: Write download.py**

Contents of `scripts/drive-sync/download.py`:

```python
#!/usr/bin/env python3
"""Phase 0: download a drive from a source switchboard via GraphQL.

Output layout:
    <output-dir>/
        manifest.json
        drive-info.json
        states/<doc-id>.json     — state.global per document
        ops/<doc-id>.json        — operation history (informational; not replayed)

Idempotent: skips per-doc fetch if state file already exists.

Usage:
    python3 scripts/drive-sync/download.py \
        --endpoint https://switchboard-dev.powerhouse.xyz/graphql \
        --drive powerhouse-vault \
        --out scripts/drive-sync/data/powerhouse-vault
"""
import argparse
import datetime
import json
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

# Allow running as a script: add this dir to sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent))

from lib.graphql import GraphQLClient, GraphQLError


DRIVE_TREE_QUERY = """
query DriveTree($id: String!) {
  document(identifier: $id) {
    id
    name
    state {
      global
    }
  }
}
"""

DOC_STATE_QUERY = """
query DocState($id: String!) {
  document(identifier: $id) {
    id
    state {
      global
    }
    operations(scope: "global") {
      index
      type
      input
      timestampUtcMs
      hash
    }
  }
}
"""


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--endpoint", required=True)
    p.add_argument("--drive", required=True, help="drive slug or UUID")
    p.add_argument("--out", required=True, help="output directory")
    p.add_argument("--concurrency", type=int, default=5)
    p.add_argument("--limit", type=int, default=None, help="for testing; cap doc fetches")
    return p.parse_args()


def fetch_drive(client: GraphQLClient, identifier: str) -> dict:
    data = client.query(DRIVE_TREE_QUERY, {"id": identifier})
    doc = data.get("document")
    if not doc:
        raise RuntimeError(f"drive '{identifier}' not found at {client.endpoint}")
    return doc


def extract_nodes(drive_doc: dict) -> list[dict]:
    state = drive_doc.get("state", {})
    g = state.get("global", {})
    if isinstance(g, str):
        # Some servers return state.global as JSON-encoded string
        g = json.loads(g)
    return g.get("nodes", [])


def fetch_doc(client: GraphQLClient, doc_id: str) -> tuple[dict, list]:
    data = client.query(DOC_STATE_QUERY, {"id": doc_id})
    doc = data.get("document")
    if not doc:
        raise RuntimeError(f"document {doc_id} not found")
    state = doc.get("state", {})
    g = state.get("global", {})
    if isinstance(g, str):
        g = json.loads(g)
    ops = doc.get("operations", []) or []
    return g, ops


def main() -> int:
    args = parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    (out / "states").mkdir(exist_ok=True)
    (out / "ops").mkdir(exist_ok=True)

    client = GraphQLClient(args.endpoint)

    print(f"[download] endpoint: {args.endpoint}")
    print(f"[download] drive:    {args.drive}")
    print(f"[download] output:   {out}")

    drive_doc = fetch_drive(client, args.drive)
    nodes = extract_nodes(drive_doc)
    folders = [n for n in nodes if n.get("kind") == "folder"]
    files = [n for n in nodes if n.get("kind") == "file"]
    print(f"[download] tree: {len(folders)} folders, {len(files)} documents")

    drive_info = {
        "id": drive_doc.get("id"),
        "slug": args.drive,
        "name": drive_doc.get("name"),
    }
    (out / "drive-info.json").write_text(json.dumps(drive_info, indent=2))
    (out / "tree.json").write_text(json.dumps({"nodes": nodes}, indent=2))

    if args.limit is not None:
        files = files[: args.limit]
        print(f"[download] (limited to {len(files)} for testing)")

    states_dir = out / "states"
    ops_dir = out / "ops"

    def fetch_one(idx: int, total: int, node: dict) -> tuple[str, bool, str]:
        doc_id = node["id"]
        state_path = states_dir / f"{doc_id}.json"
        ops_path = ops_dir / f"{doc_id}.json"
        if state_path.exists() and ops_path.exists():
            return (doc_id, True, "cached")
        try:
            g, ops = fetch_doc(client, doc_id)
            state_path.write_text(json.dumps(g, indent=2))
            ops_path.write_text(json.dumps(ops, indent=2))
            return (doc_id, True, f"{len(ops)} ops")
        except Exception as e:
            return (doc_id, False, str(e)[:160])

    succeeded = 0
    failed = 0
    start = time.time()
    with ThreadPoolExecutor(max_workers=args.concurrency) as ex:
        futures = {
            ex.submit(fetch_one, i, len(files), n): (i, n)
            for i, n in enumerate(files, start=1)
        }
        for fut in as_completed(futures):
            i, n = futures[fut]
            doc_id, ok, info = fut.result()
            tag = f"[{i}/{len(files)}]"
            if ok:
                succeeded += 1
                print(f"  {tag} ✓ {n.get('name','?')[:60]} — {info}")
            else:
                failed += 1
                print(f"  {tag} ✗ {n.get('name','?')[:60]} — {info}", file=sys.stderr)

    manifest = {
        "source": {
            "endpoint": args.endpoint,
            "drive": args.drive,
            "driveId": drive_info["id"],
            "driveName": drive_info["name"],
            "downloadedAt": datetime.datetime.now(datetime.timezone.utc).strftime(
                "%Y-%m-%dT%H:%M:%S.000Z"
            ),
        },
        "folders": [
            {
                "id": f["id"],
                "name": f["name"],
                "parentFolder": f.get("parentFolder"),
            }
            for f in folders
        ],
        "documents": [
            {
                "id": f["id"],
                "name": f["name"],
                "type": f.get("documentType") or f.get("type") or "unknown",
                "parentFolder": f.get("parentFolder"),
            }
            for f in files
        ],
    }
    (out / "manifest.json").write_text(json.dumps(manifest, indent=2))

    elapsed = time.time() - start
    print(f"[download] done in {elapsed:.1f}s — {succeeded} ok, {failed} failed")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 2: Test it can parse args**

```bash
python3 scripts/drive-sync/download.py --help
```

Expected: argparse help text with `--endpoint`, `--drive`, `--out`, `--concurrency`, `--limit`.

- [ ] **Step 3: Run it against switchboard-dev with --limit 2**

```bash
python3 scripts/drive-sync/download.py \
    --endpoint https://switchboard-dev.powerhouse.xyz/graphql \
    --drive powerhouse-vault \
    --out /tmp/drive-sync-smoke \
    --limit 2
```

Expected: prints `tree: 11 folders, 398 documents`, then `(limited to 2 for testing)`, then 2 successful per-doc lines, then `done in <seconds>s — 2 ok, 0 failed`.

- [ ] **Step 4: Verify output structure**

```bash
ls /tmp/drive-sync-smoke/
ls /tmp/drive-sync-smoke/states/ | wc -l
python3 -c "import json; m=json.load(open('/tmp/drive-sync-smoke/manifest.json')); print('docs:', len(m['documents']), 'folders:', len(m['folders']))"
```

Expected: shows `manifest.json drive-info.json ops/ states/ tree.json`, `2` states, manifest reports `docs: 398, folders: 11`.

- [ ] **Step 5: Commit**

```bash
git add scripts/drive-sync/download.py
git commit -m "$(cat <<'EOF'
feat(drive-sync): download.py — Phase 0 GraphQL fetch from source switchboard

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Run a real download

**Files:** none — this is a pipeline run task that produces `scripts/drive-sync/data/powerhouse-vault/`.

- [ ] **Step 1: Full download**

```bash
python3 scripts/drive-sync/download.py \
    --endpoint https://switchboard-dev.powerhouse.xyz/graphql \
    --drive powerhouse-vault \
    --out scripts/drive-sync/data/powerhouse-vault \
    --concurrency 5
```

Expected: 398 successful per-doc lines, takes 2-5 minutes, ends with `done in <s>s — 398 ok, 0 failed`. If any fail with `network error` re-run (it's idempotent — already-downloaded docs are skipped via the `cached` path).

- [ ] **Step 2: Verify counts**

```bash
ls scripts/drive-sync/data/powerhouse-vault/states/ | wc -l
ls scripts/drive-sync/data/powerhouse-vault/ops/ | wc -l
python3 -c "
import json
m = json.load(open('scripts/drive-sync/data/powerhouse-vault/manifest.json'))
from collections import Counter
print('total docs:', len(m['documents']))
print(Counter(d['type'] for d in m['documents']))
"
```

Expected: `398` states, `398` ops, type counts matching the spec (348 knowledge-note, 27 moc, 19 source, 4 singletons).

---

## Task 8: compare.py — Phase 0.5 (diff fresh vs canonical)

**Files:**
- Create: `scripts/drive-sync/compare.py`
- Create: `scripts/drive-sync/tests/test_compare.py`

- [ ] **Step 1: Write the failing test**

Contents of `scripts/drive-sync/tests/test_compare.py`:

```python
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
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
python3 -m pytest scripts/drive-sync/tests/test_compare.py -v
```

Expected: `ModuleNotFoundError: No module named 'compare'`.

- [ ] **Step 3: Implement compare.py**

Contents of `scripts/drive-sync/compare.py`:

```python
#!/usr/bin/env python3
"""Phase 0.5: compare two drive-sync dumps for drift/loss detection.

Compares manifest doc lists + selected fields in each state file. Outputs a
human-readable report. Exit 0 always — this is a sanity gate, not a guard.

Usage:
    python3 scripts/drive-sync/compare.py \
        --left scripts/drive-sync/data/powerhouse-vault \
        --right scripts/vault-dump-canonical
"""
import argparse
import json
import sys
from pathlib import Path

# Fields whose value (or count for lists) we compare
TEXT_FIELDS = ["title", "description", "noteType", "content", "status",
               "orientation", "tier", "url", "sourceType"]
COUNT_FIELDS = ["links", "topics", "coreIdeas", "childRefs", "extractedClaims",
                "checks", "nodes", "edges", "tasks"]


def load_states(root: Path) -> dict[str, dict]:
    """Load every state file. Some dumps put state under states/, others in
    type-named subfolders (vault-dump-canonical layout). Probe both."""
    states_dir = root / "states"
    by_id: dict[str, dict] = {}
    if states_dir.exists():
        for p in states_dir.glob("*.json"):
            data = json.loads(p.read_text())
            # Some files may wrap with state.global; canonicalize to global only
            if isinstance(data, dict) and "state" in data and isinstance(data["state"], dict):
                data = data["state"].get("global", data)
            by_id[p.stem] = data
        return by_id
    # Fallback: vault-dump-canonical layout has type-named subfolders with
    # filenames like `<name>_<short-uuid>.json` and full doc shape (id+state)
    for p in root.rglob("*.json"):
        if p.name in {"manifest.json", "drive.json", "id-mapping.json", "tree.json", "drive-info.json"}:
            continue
        try:
            data = json.loads(p.read_text())
        except Exception:
            continue
        if not isinstance(data, dict) or "id" not in data:
            continue
        g = data.get("state", {}).get("global") if isinstance(data.get("state"), dict) else data
        if g:
            by_id[data["id"]] = g
    return by_id


def load_manifest_docs(root: Path) -> dict[str, dict]:
    m = json.loads((root / "manifest.json").read_text())
    return {d["id"]: d for d in m.get("documents", [])}


def field_diffs(left: dict, right: dict) -> list[str]:
    diffs: list[str] = []
    for f in TEXT_FIELDS:
        if (left or {}).get(f) != (right or {}).get(f):
            diffs.append(f)
    for f in COUNT_FIELDS:
        l = len((left or {}).get(f) or [])
        r = len((right or {}).get(f) or [])
        if l != r:
            diffs.append(f"{f}_count")
    return diffs


def compare_dumps(left: Path, right: Path) -> dict:
    left_docs = load_manifest_docs(left)
    right_docs = load_manifest_docs(right)
    left_states = load_states(left)
    right_states = load_states(right)

    only_left = sorted(set(left_docs) - set(right_docs))
    only_right = sorted(set(right_docs) - set(left_docs))

    divergent = []
    for doc_id in sorted(set(left_docs) & set(right_docs)):
        l = left_states.get(doc_id) or {}
        r = right_states.get(doc_id) or {}
        fields = field_diffs(l, r)
        if fields:
            divergent.append({"id": doc_id, "name": left_docs[doc_id].get("name"), "fields": fields})

    return {
        "left": str(left),
        "right": str(right),
        "left_total": len(left_docs),
        "right_total": len(right_docs),
        "only_in_left": only_left,
        "only_in_right": only_right,
        "divergent": divergent,
    }


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--left", required=True)
    p.add_argument("--right", required=True)
    p.add_argument("--json", action="store_true", help="print full JSON report")
    args = p.parse_args()

    report = compare_dumps(Path(args.left), Path(args.right))

    if args.json:
        print(json.dumps(report, indent=2))
        return 0

    print(f"[compare] left:  {report['left']} ({report['left_total']} docs)")
    print(f"[compare] right: {report['right']} ({report['right_total']} docs)")
    print(f"[compare] only in left:  {len(report['only_in_left'])}")
    print(f"[compare] only in right: {len(report['only_in_right'])}")
    print(f"[compare] divergent:     {len(report['divergent'])}")
    if report["only_in_left"]:
        print("  Only in left (first 10):")
        for i in report["only_in_left"][:10]:
            print(f"    {i}")
    if report["only_in_right"]:
        print("  Only in right (first 10):")
        for i in report["only_in_right"][:10]:
            print(f"    {i}")
    if report["divergent"]:
        print("  Divergent (first 10):")
        for d in report["divergent"][:10]:
            print(f"    {d['id']}: {d['fields']} — {d.get('name','')}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 4: Run the tests and verify they pass**

```bash
python3 -m pytest scripts/drive-sync/tests/test_compare.py -v
```

Expected: `4 passed`.

- [ ] **Step 5: Run compare against canonical dump**

```bash
python3 scripts/drive-sync/compare.py \
    --left scripts/drive-sync/data/powerhouse-vault \
    --right scripts/vault-dump-canonical
```

Expected: report listing counts. Some divergence is expected (the dump is from 2026-05-06; source may have evolved). User reviews and decides to proceed.

- [ ] **Step 6: Commit**

```bash
git add scripts/drive-sync/compare.py scripts/drive-sync/tests/test_compare.py
git commit -m "$(cat <<'EOF'
feat(drive-sync): compare.py — Phase 0.5 dump diff for drift detection

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: handlers/knowledge_note.py

**Files:**
- Create: `scripts/drive-sync/handlers/knowledge_note.py`
- Create: `scripts/drive-sync/tests/test_handler_knowledge_note.py`

This handler maps `bai/knowledge-note` state to the operations defined in `document-models/knowledge-note/knowledge-note.json` (verified during plan authoring).

**Operation reference:**
- Content module: `setTitle{title,updatedAt}`, `setDescription{description,updatedAt}`, `setNoteType{noteType,updatedAt}`, `setContent{content,updatedAt}`, `setMetadataField{field,value,updatedAt}`, `setMetadataListField{field,values,updatedAt}`
- Provenance: `setProvenance{author,sourceOrigin,sessionId?,createdAt}`
- Linking: `addLink{id,targetDocumentId,targetTitle?,linkType}`, `addTopic{id,name,topicDocumentId?}`
- Lifecycle: skip — status is set by approval flow, not bulk-replayable. Status field is set via no-op (the initialValue is `DRAFT`, advancing to `CANONICAL` requires a multi-step approval that can't be reconstructed from state alone).

**Metadata fields** (knowledge-note state has many optional scalar/list fields beyond title/description/content): handled via `setMetadataField` + `setMetadataListField`. List of metadata scalar fields: `scope`, `confidence`, `severity`, `editor`, `modelId`, `version`, `filePath`, `computes`, `context`, `decisionStatus`, `model`, `sourceType`, `targetType`, `relationType`, `cardinality`, `errorMessage`, `rootCause`, `correctPattern`. List of metadata list fields: `models`, `hooksUsed`, `dispatchTargets`, `modules`, `inputs`, `outputs`, `consumedBy`, `alternatives`, `consequences`.

- [ ] **Step 1: Write the failing test**

Contents of `scripts/drive-sync/tests/test_handler_knowledge_note.py`:

```python
import pytest
from lib.id_map import IdMap
from handlers.knowledge_note import build_actions


def _new_id_map(tmp_path):
    return IdMap(tmp_path / "id-map.json")


def test_title_produces_set_title_action(tmp_path):
    state = {"title": "Hello", "links": [], "topics": []}
    scalars, crossrefs = build_actions(state, _new_id_map(tmp_path))
    types = [a["type"] for a in scalars]
    assert "SET_TITLE" in types
    title_action = next(a for a in scalars if a["type"] == "SET_TITLE")
    assert title_action["input"]["title"] == "Hello"
    assert "updatedAt" in title_action["input"]


def test_empty_string_title_skipped(tmp_path):
    state = {"title": "", "links": [], "topics": []}
    scalars, _ = build_actions(state, _new_id_map(tmp_path))
    assert all(a["type"] != "SET_TITLE" for a in scalars)


def test_topics_become_add_topic_actions(tmp_path):
    state = {
        "topics": [
            {"id": "t1", "name": "alpha", "topicDocumentId": None},
            {"id": "t2", "name": "beta", "topicDocumentId": "doc-x"},
        ],
        "links": [],
    }
    scalars, _ = build_actions(state, _new_id_map(tmp_path))
    topic_actions = [a for a in scalars if a["type"] == "ADD_TOPIC"]
    assert len(topic_actions) == 2
    assert topic_actions[0]["input"] == {"id": "t1", "name": "alpha", "topicDocumentId": None}
    assert topic_actions[1]["input"]["topicDocumentId"] == "doc-x"


def test_links_are_returned_as_crossrefs_not_scalars(tmp_path):
    state = {
        "links": [
            {"id": "l1", "targetDocumentId": "old-id", "linkType": "BUILDS_ON", "targetTitle": "t"},
        ],
        "topics": [],
    }
    scalars, crossrefs = build_actions(state, _new_id_map(tmp_path))
    assert all(a["type"] != "ADD_LINK" for a in scalars)
    assert len(crossrefs) == 1
    assert crossrefs[0]["type"] == "ADD_LINK"


def test_crossref_link_remaps_target_id(tmp_path):
    id_map = _new_id_map(tmp_path)
    id_map.set("old-id", "NEW-ID")
    state = {
        "links": [{"id": "l1", "targetDocumentId": "old-id", "linkType": "BUILDS_ON"}],
        "topics": [],
    }
    _, crossrefs = build_actions(state, id_map)
    assert crossrefs[0]["input"]["targetDocumentId"] == "NEW-ID"


def test_crossref_link_drops_when_target_unmapped_and_unmapped_is_required(tmp_path):
    """If a link points to a doc that isn't in the id-map, the link is dropped
    with an entry in the 'dropped' list returned alongside crossrefs."""
    id_map = _new_id_map(tmp_path)
    state = {
        "links": [{"id": "l1", "targetDocumentId": "nope", "linkType": "BUILDS_ON"}],
        "topics": [],
    }
    _, crossrefs = build_actions(state, id_map, drop_unmapped=True)
    assert crossrefs == []


def test_provenance_produces_set_provenance(tmp_path):
    state = {
        "topics": [],
        "links": [],
        "provenance": {
            "author": "alice",
            "sourceOrigin": "MANUAL",
            "sessionId": "s-1",
            "createdAt": "2026-01-01T00:00:00.000Z",
        },
    }
    scalars, _ = build_actions(state, _new_id_map(tmp_path))
    prov = next(a for a in scalars if a["type"] == "SET_PROVENANCE")
    assert prov["input"]["author"] == "alice"
    assert prov["input"]["sourceOrigin"] == "MANUAL"
    assert prov["input"]["createdAt"] == "2026-01-01T00:00:00.000Z"


def test_metadata_scalar_field_emits_set_metadata_field(tmp_path):
    state = {"topics": [], "links": [], "scope": "narrow", "confidence": "high"}
    scalars, _ = build_actions(state, _new_id_map(tmp_path))
    md = [a for a in scalars if a["type"] == "SET_METADATA_FIELD"]
    fields = {a["input"]["field"]: a["input"]["value"] for a in md}
    assert fields["scope"] == "narrow"
    assert fields["confidence"] == "high"


def test_metadata_list_field_emits_set_metadata_list_field(tmp_path):
    state = {"topics": [], "links": [], "models": ["a", "b"], "inputs": ["x"]}
    scalars, _ = build_actions(state, _new_id_map(tmp_path))
    md = [a for a in scalars if a["type"] == "SET_METADATA_LIST_FIELD"]
    fields = {a["input"]["field"]: a["input"]["values"] for a in md}
    assert fields["models"] == ["a", "b"]
    assert fields["inputs"] == ["x"]


def test_empty_state_produces_no_actions(tmp_path):
    state = {"topics": [], "links": []}
    scalars, crossrefs = build_actions(state, _new_id_map(tmp_path))
    assert scalars == []
    assert crossrefs == []
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
python3 -m pytest scripts/drive-sync/tests/test_handler_knowledge_note.py -v
```

Expected: `ModuleNotFoundError: No module named 'handlers.knowledge_note'`.

- [ ] **Step 3: Implement the handler**

Contents of `scripts/drive-sync/handlers/knowledge_note.py`:

```python
"""Translates bai/knowledge-note state into a sequence of action dicts.

Two return lists:
  - scalar_actions: applied in Phase 3 (no cross-doc refs).
  - crossref_actions: applied in Phase 4 after all docs exist.
"""
import datetime
from typing import Optional

from lib.id_map import IdMap


METADATA_SCALAR_FIELDS = [
    "scope", "confidence", "severity", "editor", "modelId", "version",
    "filePath", "computes", "context", "decisionStatus", "model",
    "sourceType", "targetType", "relationType", "cardinality",
    "errorMessage", "rootCause", "correctPattern",
]

METADATA_LIST_FIELDS = [
    "models", "hooksUsed", "dispatchTargets", "modules",
    "inputs", "outputs", "consumedBy", "alternatives", "consequences",
]


def _now_iso() -> str:
    n = datetime.datetime.now(datetime.timezone.utc)
    return n.strftime("%Y-%m-%dT%H:%M:%S.000Z")


def _act(op_type: str, input_data: dict) -> dict:
    return {"type": op_type, "input": input_data, "scope": "global"}


def build_actions(
    state: dict,
    id_map: IdMap,
    drop_unmapped: bool = True,
) -> tuple[list[dict], list[dict]]:
    """Return (scalar_actions, crossref_actions) for one knowledge-note state."""
    scalar: list[dict] = []
    crossref: list[dict] = []
    now = _now_iso()

    # Title / description / noteType / content — only emit if present and non-empty
    if state.get("title"):
        scalar.append(_act("SET_TITLE", {"title": state["title"], "updatedAt": now}))
    if state.get("description"):
        scalar.append(_act("SET_DESCRIPTION", {"description": state["description"], "updatedAt": now}))
    if state.get("noteType"):
        scalar.append(_act("SET_NOTE_TYPE", {"noteType": state["noteType"], "updatedAt": now}))
    if state.get("content"):
        scalar.append(_act("SET_CONTENT", {"content": state["content"], "updatedAt": now}))

    # Metadata scalar fields
    for f in METADATA_SCALAR_FIELDS:
        v = state.get(f)
        if v is not None and v != "":
            scalar.append(_act("SET_METADATA_FIELD", {"field": f, "value": v, "updatedAt": now}))

    # Metadata list fields
    for f in METADATA_LIST_FIELDS:
        v = state.get(f)
        if v:
            scalar.append(_act("SET_METADATA_LIST_FIELD", {"field": f, "values": list(v), "updatedAt": now}))

    # Provenance
    prov = state.get("provenance")
    if prov and (prov.get("author") or prov.get("sourceOrigin")):
        inp = {
            "author": prov.get("author") or "unknown",
            "sourceOrigin": prov.get("sourceOrigin") or "MANUAL",
            "createdAt": prov.get("createdAt") or now,
        }
        if prov.get("sessionId"):
            inp["sessionId"] = prov["sessionId"]
        scalar.append(_act("SET_PROVENANCE", inp))

    # Topics — no cross-doc dependency, applied in scalar phase
    for t in state.get("topics") or []:
        inp: dict = {"id": t["id"], "name": t.get("name") or ""}
        # topicDocumentId may reference another doc; remap if mapped, else pass through
        tdoc = t.get("topicDocumentId")
        if tdoc is not None:
            inp["topicDocumentId"] = id_map.resolve(tdoc)
        else:
            inp["topicDocumentId"] = None
        scalar.append(_act("ADD_TOPIC", inp))

    # Links — cross-doc, deferred to phase 4
    for ln in state.get("links") or []:
        target_old = ln.get("targetDocumentId")
        target_new = id_map.get(target_old) if target_old else None
        if target_new is None:
            if drop_unmapped:
                continue
            target_new = target_old
        inp = {
            "id": ln["id"],
            "targetDocumentId": target_new,
            "linkType": ln.get("linkType") or "RELATES_TO",
        }
        if ln.get("targetTitle"):
            inp["targetTitle"] = ln["targetTitle"]
        crossref.append(_act("ADD_LINK", inp))

    return scalar, crossref


def apply(doc_id: str, state: dict, id_map: IdMap, sb_module) -> int:
    """IO wrapper: builds scalar actions and dispatches via apply_actions.
    Returns the number of scalar actions applied. Cross-refs are returned
    by build_actions but applied separately in Phase 4."""
    scalars, _ = build_actions(state, id_map, drop_unmapped=True)
    if scalars:
        sb_module.apply_actions(doc_id, scalars)
    return len(scalars)
```

- [ ] **Step 4: Run the tests and verify they pass**

```bash
python3 -m pytest scripts/drive-sync/tests/test_handler_knowledge_note.py -v
```

Expected: `10 passed`.

- [ ] **Step 5: Commit**

```bash
git add scripts/drive-sync/handlers/knowledge_note.py scripts/drive-sync/tests/test_handler_knowledge_note.py
git commit -m "$(cat <<'EOF'
feat(drive-sync): handlers/knowledge_note.py with build_actions + tests

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: handlers/moc.py

**Files:**
- Create: `scripts/drive-sync/handlers/moc.py`
- Create: `scripts/drive-sync/tests/test_handler_moc.py`

**Operation reference (verified):**
- `createMoc{title,description,orientation,tier,parentRef?,createdAt}` — must run first; `tier` is required (`HUB|DOMAIN|TOPIC`).
- `updateOrientation{orientation,updatedAt}`, `updateDescription{description,updatedAt}`
- `addCoreIdea{id,noteRef,contextPhrase,sortOrder,addedAt,addedBy?}` — references a knowledge-note; deferred.
- `addTension{id,description,involvedRefs,addedAt}` — `involvedRefs` are doc refs; deferred.
- `addOpenQuestion{question}`
- `addChildMoc{childRef}` — references another moc; deferred.

The state's `parentRef` (referencing parent moc) must be remapped at `createMoc` time, but `createMoc` runs in Phase 3 *before* all mocs exist. Mitigation: emit `createMoc` with `parentRef=null` first, then a `setMocParent`-equivalent in cross-refs… **but the model has no setParent op**. Workaround: defer mocs that have a `parentRef` to a second pass within Phase 3, after parent mocs are created. Document this in the implementation.

Actually simpler: mocs are only 27 docs. We sort them topologically (root mocs first, then children) within Phase 3 ordering, and pass the parent's *new* id directly into `createMoc` if mapped — else set null. The id_map is updated as docs are created in Phase 2, but mocs need the *moc-doc* id_map, which is populated during Phase 2 of upload. So at Phase 3 entry, all moc doc IDs are known; we just need to topologically sort moc-state application within the moc batch.

- [ ] **Step 1: Write the failing test**

Contents of `scripts/drive-sync/tests/test_handler_moc.py`:

```python
import pytest
from lib.id_map import IdMap
from handlers.moc import build_actions, sort_mocs_for_creation


def _idmap(tmp_path):
    return IdMap(tmp_path / "id-map.json")


def test_create_moc_emitted_first(tmp_path):
    state = {"title": "T", "description": "D", "orientation": "O", "tier": "HUB",
             "coreIdeas": [], "tensions": [], "openQuestions": [], "childRefs": []}
    scalars, crossrefs = build_actions(state, _idmap(tmp_path))
    assert scalars[0]["type"] == "CREATE_MOC"
    assert scalars[0]["input"]["title"] == "T"
    assert scalars[0]["input"]["tier"] == "HUB"


def test_default_tier_is_topic_when_missing(tmp_path):
    state = {"title": "T", "description": "D", "orientation": "O",
             "coreIdeas": [], "tensions": [], "openQuestions": [], "childRefs": []}
    scalars, _ = build_actions(state, _idmap(tmp_path))
    assert scalars[0]["input"]["tier"] == "TOPIC"


def test_parent_ref_resolves_via_id_map(tmp_path):
    id_map = _idmap(tmp_path)
    id_map.set("old-parent", "NEW-PARENT")
    state = {"title": "T", "description": "D", "orientation": "O", "tier": "DOMAIN",
             "parentRef": "old-parent", "coreIdeas": [], "tensions": [],
             "openQuestions": [], "childRefs": []}
    scalars, _ = build_actions(state, id_map)
    assert scalars[0]["input"].get("parentRef") == "NEW-PARENT"


def test_open_questions_emitted_in_scalar_phase(tmp_path):
    state = {"title": "T", "description": "D", "orientation": "O", "tier": "TOPIC",
             "coreIdeas": [], "tensions": [],
             "openQuestions": ["q1?", "q2?"], "childRefs": []}
    scalars, _ = build_actions(state, _idmap(tmp_path))
    qs = [a for a in scalars if a["type"] == "ADD_OPEN_QUESTION"]
    assert [a["input"]["question"] for a in qs] == ["q1?", "q2?"]


def test_core_ideas_in_crossref_phase(tmp_path):
    id_map = _idmap(tmp_path)
    id_map.set("note-old", "note-new")
    state = {"title": "T", "description": "D", "orientation": "O", "tier": "TOPIC",
             "coreIdeas": [
                 {"id": "ci1", "noteRef": "note-old", "contextPhrase": "p", "sortOrder": 0,
                  "addedAt": "2026-01-01T00:00:00.000Z", "addedBy": "a"},
             ],
             "tensions": [], "openQuestions": [], "childRefs": []}
    scalars, crossrefs = build_actions(state, id_map)
    assert all(a["type"] != "ADD_CORE_IDEA" for a in scalars)
    assert len(crossrefs) == 1
    assert crossrefs[0]["type"] == "ADD_CORE_IDEA"
    assert crossrefs[0]["input"]["noteRef"] == "note-new"


def test_child_mocs_in_crossref_phase(tmp_path):
    id_map = _idmap(tmp_path)
    id_map.set("child-old", "child-new")
    state = {"title": "T", "description": "D", "orientation": "O", "tier": "HUB",
             "coreIdeas": [], "tensions": [], "openQuestions": [],
             "childRefs": ["child-old", "unknown"]}
    _, crossrefs = build_actions(id_map=id_map, state=state)
    children = [a for a in crossrefs if a["type"] == "ADD_CHILD_MOC"]
    # 'unknown' is dropped by default
    assert [a["input"]["childRef"] for a in children] == ["child-new"]


def test_tensions_in_crossref_phase_remapped(tmp_path):
    id_map = _idmap(tmp_path)
    id_map.set("a", "A"); id_map.set("b", "B")
    state = {"title": "T", "description": "D", "orientation": "O", "tier": "TOPIC",
             "coreIdeas": [], "openQuestions": [], "childRefs": [],
             "tensions": [
                 {"id": "t1", "description": "x", "involvedRefs": ["a", "b", "missing"],
                  "addedAt": "2026-01-01T00:00:00.000Z"},
             ]}
    _, crossrefs = build_actions(state, id_map)
    tens = next(a for a in crossrefs if a["type"] == "ADD_TENSION")
    # involvedRefs are kept (no drop) but remapped where possible
    assert tens["input"]["involvedRefs"] == ["A", "B", "missing"]


def test_sort_mocs_for_creation_parents_before_children():
    docs = [
        {"id": "child1", "type": "bai/moc", "name": "c1"},
        {"id": "root",   "type": "bai/moc", "name": "r"},
        {"id": "child2", "type": "bai/moc", "name": "c2"},
    ]
    states = {
        "child1": {"parentRef": "root"},
        "child2": {"parentRef": "child1"},
        "root":   {},
    }
    sorted_ids = sort_mocs_for_creation(docs, states)
    assert sorted_ids.index("root") < sorted_ids.index("child1")
    assert sorted_ids.index("child1") < sorted_ids.index("child2")
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
python3 -m pytest scripts/drive-sync/tests/test_handler_moc.py -v
```

Expected: `ModuleNotFoundError`.

- [ ] **Step 3: Implement handlers/moc.py**

Contents of `scripts/drive-sync/handlers/moc.py`:

```python
"""bai/moc handler."""
import datetime

from lib.id_map import IdMap


def _now_iso() -> str:
    n = datetime.datetime.now(datetime.timezone.utc)
    return n.strftime("%Y-%m-%dT%H:%M:%S.000Z")


def _act(op_type: str, input_data: dict) -> dict:
    return {"type": op_type, "input": input_data, "scope": "global"}


def build_actions(
    state: dict,
    id_map: IdMap,
    drop_unmapped: bool = True,
) -> tuple[list[dict], list[dict]]:
    scalar: list[dict] = []
    crossref: list[dict] = []
    now = _now_iso()

    # createMoc must come first; tier is required by schema (default TOPIC)
    create_input = {
        "title": state.get("title") or "",
        "description": state.get("description") or "",
        "orientation": state.get("orientation") or "",
        "tier": state.get("tier") or "TOPIC",
        "createdAt": (state.get("createdAt") or now),
    }
    parent_ref = state.get("parentRef")
    if parent_ref:
        # ParentRef points to another moc — by Phase 3 ordering it should be in id_map
        create_input["parentRef"] = id_map.resolve(parent_ref)
    scalar.append(_act("CREATE_MOC", create_input))

    # Open questions are scalar — no cross-refs
    for q in state.get("openQuestions") or []:
        scalar.append(_act("ADD_OPEN_QUESTION", {"question": q}))

    # Core ideas reference notes — defer
    for ci in state.get("coreIdeas") or []:
        note_old = ci.get("noteRef")
        note_new = id_map.get(note_old) if note_old else None
        if note_new is None:
            if drop_unmapped:
                continue
            note_new = note_old
        crossref.append(_act("ADD_CORE_IDEA", {
            "id": ci["id"],
            "noteRef": note_new,
            "contextPhrase": ci.get("contextPhrase") or "",
            "sortOrder": int(ci.get("sortOrder") or 0),
            "addedAt": ci.get("addedAt") or now,
            **({"addedBy": ci["addedBy"]} if ci.get("addedBy") else {}),
        }))

    # Tensions reference multiple docs — defer; remap each ref individually
    for t in state.get("tensions") or []:
        refs = t.get("involvedRefs") or []
        remapped = [id_map.resolve(r) for r in refs]
        crossref.append(_act("ADD_TENSION", {
            "id": t["id"],
            "description": t.get("description") or "",
            "involvedRefs": remapped,
            "addedAt": t.get("addedAt") or now,
        }))

    # Child mocs reference other mocs — defer; drop if unmapped
    for child in state.get("childRefs") or []:
        new_child = id_map.get(child)
        if new_child is None:
            if drop_unmapped:
                continue
            new_child = child
        crossref.append(_act("ADD_CHILD_MOC", {"childRef": new_child}))

    return scalar, crossref


def sort_mocs_for_creation(docs: list[dict], states: dict[str, dict]) -> list[str]:
    """Topologically order moc doc IDs so that a moc's parentRef (if any) is
    created before the moc itself.

    Returns a list of doc ids in creation order. Cycles are broken by visit-once.
    """
    moc_ids = {d["id"] for d in docs if d.get("type") == "bai/moc"}
    visited: set[str] = set()
    order: list[str] = []

    def visit(doc_id: str) -> None:
        if doc_id in visited or doc_id not in moc_ids:
            return
        visited.add(doc_id)
        parent = (states.get(doc_id) or {}).get("parentRef")
        if parent and parent in moc_ids:
            visit(parent)
        order.append(doc_id)

    for d in docs:
        if d.get("type") == "bai/moc":
            visit(d["id"])
    return order
```

- [ ] **Step 4: Run the tests and verify they pass**

```bash
python3 -m pytest scripts/drive-sync/tests/test_handler_moc.py -v
```

Expected: `8 passed`.

- [ ] **Step 5: Commit**

```bash
git add scripts/drive-sync/handlers/moc.py scripts/drive-sync/tests/test_handler_moc.py
git commit -m "$(cat <<'EOF'
feat(drive-sync): handlers/moc.py with topo-sort for parent-first creation

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: handlers/source.py

**Files:**
- Create: `scripts/drive-sync/handlers/source.py`
- Create: `scripts/drive-sync/tests/test_handler_source.py`

**Operation reference:**
- `ingestSource{title,content,sourceType,description?,url?,author?,publishedAt?,method?,tool?,createdAt,createdBy?}` — required first call.
- `setSourceStatus{status}`
- `addExtractedClaim{claimRef}` — references a knowledge-note or claim doc; deferred.
- `recordExtractionStats{claimCount,skippedCount,skipRate,extractedAt,extractedBy?}`

- [ ] **Step 1: Write the failing test**

Contents of `scripts/drive-sync/tests/test_handler_source.py`:

```python
from lib.id_map import IdMap
from handlers.source import build_actions


def _idmap(tmp_path):
    return IdMap(tmp_path / "id-map.json")


def test_ingest_source_emitted_first(tmp_path):
    state = {
        "title": "T", "content": "C", "sourceType": "ARTICLE",
        "extractedClaims": [], "createdAt": "2026-01-01T00:00:00.000Z",
    }
    scalars, _ = build_actions(state, _idmap(tmp_path))
    assert scalars[0]["type"] == "INGEST_SOURCE"
    assert scalars[0]["input"]["sourceType"] == "ARTICLE"


def test_default_source_type_is_manual_entry(tmp_path):
    state = {"title": "T", "content": "C", "extractedClaims": []}
    scalars, _ = build_actions(state, _idmap(tmp_path))
    assert scalars[0]["input"]["sourceType"] == "MANUAL_ENTRY"


def test_provenance_fields_flatten_into_ingest_source(tmp_path):
    state = {
        "title": "T", "content": "C", "sourceType": "WEB_PAGE",
        "extractedClaims": [],
        "provenance": {"url": "https://x", "author": "a", "publishedAt": "2026-01-01T00:00:00.000Z",
                       "method": "scrape", "tool": "puppeteer"},
    }
    scalars, _ = build_actions(state, _idmap(tmp_path))
    inp = scalars[0]["input"]
    assert inp["url"] == "https://x"
    assert inp["author"] == "a"
    assert inp["method"] == "scrape"


def test_status_emitted_when_present(tmp_path):
    state = {"title": "T", "content": "C", "status": "EXTRACTED", "extractedClaims": []}
    scalars, _ = build_actions(state, _idmap(tmp_path))
    statuses = [a for a in scalars if a["type"] == "SET_SOURCE_STATUS"]
    assert len(statuses) == 1
    assert statuses[0]["input"]["status"] == "EXTRACTED"


def test_extraction_stats_emitted_when_present(tmp_path):
    state = {
        "title": "T", "content": "C", "extractedClaims": [],
        "extractionStats": {"claimCount": 10, "skippedCount": 2, "skipRate": 0.2,
                            "extractedAt": "2026-01-01T00:00:00.000Z"},
    }
    scalars, _ = build_actions(state, _idmap(tmp_path))
    stats = [a for a in scalars if a["type"] == "RECORD_EXTRACTION_STATS"]
    assert len(stats) == 1
    assert stats[0]["input"]["claimCount"] == 10


def test_extracted_claims_deferred_to_crossrefs(tmp_path):
    id_map = _idmap(tmp_path)
    id_map.set("c1", "C1")
    state = {"title": "T", "content": "C", "extractedClaims": ["c1", "missing"]}
    _, crossrefs = build_actions(state, id_map)
    assert len(crossrefs) == 1
    assert crossrefs[0]["input"]["claimRef"] == "C1"
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
python3 -m pytest scripts/drive-sync/tests/test_handler_source.py -v
```

Expected: `ModuleNotFoundError`.

- [ ] **Step 3: Implement handlers/source.py**

Contents of `scripts/drive-sync/handlers/source.py`:

```python
"""bai/source handler."""
import datetime

from lib.id_map import IdMap


def _now_iso() -> str:
    n = datetime.datetime.now(datetime.timezone.utc)
    return n.strftime("%Y-%m-%dT%H:%M:%S.000Z")


def _act(op_type: str, input_data: dict) -> dict:
    return {"type": op_type, "input": input_data, "scope": "global"}


def build_actions(
    state: dict,
    id_map: IdMap,
    drop_unmapped: bool = True,
) -> tuple[list[dict], list[dict]]:
    scalar: list[dict] = []
    crossref: list[dict] = []
    now = _now_iso()

    # ingestSource: title and content are required
    inp = {
        "title": state.get("title") or "",
        "content": state.get("content") or "",
        "sourceType": state.get("sourceType") or "MANUAL_ENTRY",
        "createdAt": state.get("createdAt") or now,
    }
    if state.get("description"):
        inp["description"] = state["description"]
    if state.get("createdBy"):
        inp["createdBy"] = state["createdBy"]

    prov = state.get("provenance") or {}
    for k in ("url", "author", "publishedAt", "method", "tool"):
        if prov.get(k):
            inp[k] = prov[k]

    scalar.append(_act("INGEST_SOURCE", inp))

    if state.get("status"):
        scalar.append(_act("SET_SOURCE_STATUS", {"status": state["status"]}))

    stats = state.get("extractionStats")
    if stats and stats.get("claimCount") is not None:
        s_inp = {
            "claimCount": int(stats["claimCount"]),
            "skippedCount": int(stats.get("skippedCount") or 0),
            "skipRate": float(stats.get("skipRate") or 0),
            "extractedAt": stats.get("extractedAt") or now,
        }
        if stats.get("extractedBy"):
            s_inp["extractedBy"] = stats["extractedBy"]
        scalar.append(_act("RECORD_EXTRACTION_STATS", s_inp))

    # extractedClaims reference notes/claims — defer
    for claim in state.get("extractedClaims") or []:
        new_ref = id_map.get(claim)
        if new_ref is None:
            if drop_unmapped:
                continue
            new_ref = claim
        crossref.append(_act("ADD_EXTRACTED_CLAIM", {"claimRef": new_ref}))

    return scalar, crossref
```

- [ ] **Step 4: Run the tests and verify they pass**

```bash
python3 -m pytest scripts/drive-sync/tests/test_handler_source.py -v
```

Expected: `6 passed`.

- [ ] **Step 5: Commit**

```bash
git add scripts/drive-sync/handlers/source.py scripts/drive-sync/tests/test_handler_source.py
git commit -m "$(cat <<'EOF'
feat(drive-sync): handlers/source.py + tests

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: handlers/knowledge_graph.py (singleton)

**Files:**
- Create: `scripts/drive-sync/handlers/knowledge_graph.py`

**Operation reference:**
- `addNode{id,documentId,title?,noteType?,status?}`
- `addEdge{id,sourceDocumentId,targetDocumentId,linkType?}`

The singleton's state is `{nodes: [...], edges: [...]}`. Every node references a doc — so all node/edge actions are crossrefs.

- [ ] **Step 1: Write the file**

Contents of `scripts/drive-sync/handlers/knowledge_graph.py`:

```python
"""bai/knowledge-graph singleton handler. All actions are cross-refs since
every node/edge references documents in the drive."""
from lib.id_map import IdMap


def _act(op_type: str, input_data: dict) -> dict:
    return {"type": op_type, "input": input_data, "scope": "global"}


def build_actions(
    state: dict,
    id_map: IdMap,
    drop_unmapped: bool = True,
) -> tuple[list[dict], list[dict]]:
    scalar: list[dict] = []
    crossref: list[dict] = []

    for n in state.get("nodes") or []:
        old = n.get("documentId")
        new = id_map.get(old) if old else None
        if new is None:
            if drop_unmapped:
                continue
            new = old
        inp: dict = {"id": n["id"], "documentId": new}
        for k in ("title", "noteType", "status"):
            if n.get(k) is not None:
                inp[k] = n[k]
        crossref.append(_act("ADD_NODE", inp))

    for e in state.get("edges") or []:
        s_old = e.get("sourceDocumentId")
        t_old = e.get("targetDocumentId")
        s_new = id_map.get(s_old) if s_old else None
        t_new = id_map.get(t_old) if t_old else None
        if s_new is None or t_new is None:
            if drop_unmapped:
                continue
            s_new = s_new or s_old
            t_new = t_new or t_old
        inp = {
            "id": e["id"],
            "sourceDocumentId": s_new,
            "targetDocumentId": t_new,
        }
        if e.get("linkType"):
            inp["linkType"] = e["linkType"]
        crossref.append(_act("ADD_EDGE", inp))

    return scalar, crossref
```

- [ ] **Step 2: Smoke test the import**

```bash
cd scripts/drive-sync && python3 -c "from handlers import knowledge_graph; print('ok')"
cd -
```

Expected: prints `ok`.

- [ ] **Step 3: Commit**

```bash
git add scripts/drive-sync/handlers/knowledge_graph.py
git commit -m "$(cat <<'EOF'
feat(drive-sync): handlers/knowledge_graph.py singleton

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: handlers/pipeline_queue.py (singleton)

**Files:**
- Create: `scripts/drive-sync/handlers/pipeline_queue.py`

**Operation reference:**
- `addTask{id,taskType,target,batchId?,documentRef?,currentPhase?,createdAt}`
- `assignTask{taskId,assignedTo,updatedAt}` (only when status indicates assignment)
- `completeTask{taskId,updatedAt}` / `failTask{taskId,reason,updatedAt}` / `blockTask{taskId,reason,updatedAt}` — applied when status is DONE/FAILED/BLOCKED.

Tasks may reference docs via `documentRef`; that's a crossref.

State structure: `{schemaVersion, phaseOrder, tasks[], completedCount, activeCount, lastProcessedAt}`. We don't reconstruct counters (they're derived); we just emit `addTask` for each, then status-transition ops as needed.

- [ ] **Step 1: Write the handler**

Contents of `scripts/drive-sync/handlers/pipeline_queue.py`:

```python
"""bai/pipeline-queue singleton handler."""
import datetime

from lib.id_map import IdMap


def _now_iso() -> str:
    n = datetime.datetime.now(datetime.timezone.utc)
    return n.strftime("%Y-%m-%dT%H:%M:%S.000Z")


def _act(op_type: str, input_data: dict) -> dict:
    return {"type": op_type, "input": input_data, "scope": "global"}


def build_actions(
    state: dict,
    id_map: IdMap,
    drop_unmapped: bool = True,
) -> tuple[list[dict], list[dict]]:
    scalar: list[dict] = []
    crossref: list[dict] = []
    now = _now_iso()

    # `phaseOrder` lives in initialValue; we don't migrate it (it's project-level config).
    # We migrate task entries.
    for t in state.get("tasks") or []:
        # documentRef may reference a knowledge-note — remap (drop if unmapped)
        doc_ref = t.get("documentRef")
        new_ref = id_map.get(doc_ref) if doc_ref else None
        if doc_ref and new_ref is None and drop_unmapped:
            # skip the task entirely if it references a missing doc
            continue

        add_inp: dict = {
            "id": t["id"],
            "taskType": t.get("taskType") or "claim",
            "target": t.get("target") or "",
            "createdAt": t.get("createdAt") or now,
        }
        if t.get("batchId"):
            add_inp["batchId"] = t["batchId"]
        if doc_ref:
            add_inp["documentRef"] = new_ref or doc_ref
        if t.get("currentPhase"):
            add_inp["currentPhase"] = t["currentPhase"]
        # addTask is treated as a crossref (it has a doc dependency in some cases);
        # keep all task ops in crossref phase for consistent ordering.
        crossref.append(_act("ADD_TASK", add_inp))

        if t.get("assignedTo"):
            crossref.append(_act("ASSIGN_TASK", {
                "taskId": t["id"], "assignedTo": t["assignedTo"], "updatedAt": now,
            }))

        status = t.get("status")
        upd = t.get("updatedAt") or now
        if status == "DONE":
            crossref.append(_act("COMPLETE_TASK", {"taskId": t["id"], "updatedAt": upd}))
        elif status == "FAILED":
            crossref.append(_act("FAIL_TASK", {
                "taskId": t["id"], "reason": "migrated from source", "updatedAt": upd,
            }))
        elif status == "BLOCKED":
            crossref.append(_act("BLOCK_TASK", {
                "taskId": t["id"], "reason": "migrated from source", "updatedAt": upd,
            }))

    return scalar, crossref
```

- [ ] **Step 2: Smoke test the import**

```bash
cd scripts/drive-sync && python3 -c "from handlers import pipeline_queue; print('ok')"
cd -
```

Expected: prints `ok`.

- [ ] **Step 3: Commit**

```bash
git add scripts/drive-sync/handlers/pipeline_queue.py
git commit -m "$(cat <<'EOF'
feat(drive-sync): handlers/pipeline_queue.py singleton

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 14: handlers/health_report.py (singleton)

**Files:**
- Create: `scripts/drive-sync/handlers/health_report.py`

**Operation reference:**
- `generateReport{generatedAt,generatedBy?,mode,overallStatus,graphMetrics,recommendations[]}`
- `addCheck{id,category,status,message,affectedItems[]}`

No cross-refs — `affectedItems` are document IDs but the schema declares them as plain strings. We pass through (with optional remap).

- [ ] **Step 1: Write the handler**

Contents of `scripts/drive-sync/handlers/health_report.py`:

```python
"""bai/health-report singleton handler. No cross-refs (affectedItems are
opaque strings in the schema; we pass them through with optional remap)."""
import datetime

from lib.id_map import IdMap


def _now_iso() -> str:
    n = datetime.datetime.now(datetime.timezone.utc)
    return n.strftime("%Y-%m-%dT%H:%M:%S.000Z")


def _act(op_type: str, input_data: dict) -> dict:
    return {"type": op_type, "input": input_data, "scope": "global"}


def build_actions(
    state: dict,
    id_map: IdMap,
    drop_unmapped: bool = True,
) -> tuple[list[dict], list[dict]]:
    scalar: list[dict] = []
    crossref: list[dict] = []
    now = _now_iso()

    metrics = state.get("graphMetrics") or {}
    if state.get("generatedAt") or metrics:
        gm_input = {
            "noteCount": int(metrics.get("noteCount") or 0),
            "mocCount": int(metrics.get("mocCount") or 0),
            "connectionCount": int(metrics.get("connectionCount") or 0),
            "density": float(metrics.get("density") or 0),
            "orphanCount": int(metrics.get("orphanCount") or 0),
            "danglingLinkCount": int(metrics.get("danglingLinkCount") or 0),
            "mocCoverage": float(metrics.get("mocCoverage") or 0),
            "averageLinksPerNote": float(metrics.get("averageLinksPerNote") or 0),
        }
        scalar.append(_act("GENERATE_REPORT", {
            "generatedAt": state.get("generatedAt") or now,
            "mode": state.get("mode") or "FULL",
            "overallStatus": state.get("overallStatus") or "PASS",
            "graphMetrics": gm_input,
            "recommendations": list(state.get("recommendations") or []),
            **({"generatedBy": state["generatedBy"]} if state.get("generatedBy") else {}),
        }))

    for c in state.get("checks") or []:
        # affectedItems may include doc IDs — remap where possible
        items = c.get("affectedItems") or []
        remapped = [id_map.resolve(x) for x in items]
        scalar.append(_act("ADD_CHECK", {
            "id": c["id"],
            "category": c.get("category") or "SCHEMA_COMPLIANCE",
            "status": c.get("status") or "PASS",
            "message": c.get("message") or "",
            "affectedItems": remapped,
        }))

    return scalar, crossref
```

- [ ] **Step 2: Smoke test the import**

```bash
cd scripts/drive-sync && python3 -c "from handlers import health_report; print('ok')"
cd -
```

Expected: prints `ok`.

- [ ] **Step 3: Commit**

```bash
git add scripts/drive-sync/handlers/health_report.py
git commit -m "$(cat <<'EOF'
feat(drive-sync): handlers/health_report.py singleton

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 15: handlers/vault_config.py (singleton)

**Files:**
- Create: `scripts/drive-sync/handlers/vault_config.py`

**Operation reference (verified):**
- `initializeConfig{name,domain,updatedAt}` — must run first.
- `updateDimension{dimension,value,confidence,rationale?,updatedAt}` (per dimension key)
- `updateVocabulary{key,value,updatedAt}` (per vocabulary key)
- `updatePipelineConfig{depth?,autoChain?,extractionSelectivity?,updatedAt}`
- `updateMaintenanceThreshold{condition,threshold,updatedAt}` (per maintenance key)
- `addExtractionCategory{id,name,description,active}`
- `toggleFeature{feature,enabled}` (per feature flag)

No cross-refs.

- [ ] **Step 1: Write the handler**

Contents of `scripts/drive-sync/handlers/vault_config.py`:

```python
"""bai/vault-config singleton handler. No cross-refs."""
import datetime

from lib.id_map import IdMap


DIMENSION_KEYS = [
    "granularity", "organization", "linking", "processing",
    "navigation", "maintenance", "schema", "automation",
]

VOCABULARY_KEYS = [
    "notes", "inbox", "reduce", "reflect", "reweave",
    "verify", "rethink", "topicMap", "description",
]

MAINTENANCE_KEYS = [
    "orphanThreshold", "danglingThreshold", "inboxPressure",
    "observationAccumulation", "tensionAccumulation", "mocOversize",
    "staleNoteDays",
]


def _now_iso() -> str:
    n = datetime.datetime.now(datetime.timezone.utc)
    return n.strftime("%Y-%m-%dT%H:%M:%S.000Z")


def _act(op_type: str, input_data: dict) -> dict:
    return {"type": op_type, "input": input_data, "scope": "global"}


def build_actions(
    state: dict,
    id_map: IdMap,
    drop_unmapped: bool = True,
) -> tuple[list[dict], list[dict]]:
    scalar: list[dict] = []
    crossref: list[dict] = []
    now = _now_iso()

    if state.get("name") or state.get("domain"):
        scalar.append(_act("INITIALIZE_CONFIG", {
            "name": state.get("name") or "knowledge-vault",
            "domain": state.get("domain") or "",
            "updatedAt": now,
        }))

    dims = state.get("dimensions") or {}
    for k in DIMENSION_KEYS:
        d = dims.get(k)
        if not d:
            continue
        inp: dict = {
            "dimension": k,
            "value": int(d.get("value") or 0),
            "confidence": float(d.get("confidence") or 0),
            "updatedAt": now,
        }
        if d.get("rationale"):
            inp["rationale"] = d["rationale"]
        scalar.append(_act("UPDATE_DIMENSION", inp))

    vocab = state.get("vocabulary") or {}
    for k in VOCABULARY_KEYS:
        v = vocab.get(k)
        if v is not None:
            scalar.append(_act("UPDATE_VOCABULARY", {"key": k, "value": v, "updatedAt": now}))

    pipe = state.get("pipeline")
    if pipe:
        inp = {"updatedAt": now}
        for k in ("depth", "autoChain", "extractionSelectivity"):
            if pipe.get(k) is not None:
                inp[k] = pipe[k]
        if len(inp) > 1:
            scalar.append(_act("UPDATE_PIPELINE_CONFIG", inp))

    maint = state.get("maintenance") or {}
    for k in MAINTENANCE_KEYS:
        v = maint.get(k)
        if v is not None:
            scalar.append(_act("UPDATE_MAINTENANCE_THRESHOLD", {
                "condition": k, "threshold": int(v), "updatedAt": now,
            }))

    for cat in state.get("extractionCategories") or []:
        scalar.append(_act("ADD_EXTRACTION_CATEGORY", {
            "id": cat["id"],
            "name": cat.get("name") or "",
            "description": cat.get("description") or "",
            "active": bool(cat.get("active", True)),
        }))

    for feat in state.get("features") or []:
        # `features` is a list of enabled feature names
        scalar.append(_act("TOGGLE_FEATURE", {"feature": feat, "enabled": True}))

    return scalar, crossref
```

- [ ] **Step 2: Smoke test the import**

```bash
cd scripts/drive-sync && python3 -c "from handlers import vault_config; print('ok')"
cd -
```

Expected: prints `ok`.

- [ ] **Step 3: Commit**

```bash
git add scripts/drive-sync/handlers/vault_config.py
git commit -m "$(cat <<'EOF'
feat(drive-sync): handlers/vault_config.py singleton

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 16: upload.py — Phases 1, 2, 3, 4 orchestrator

**Files:**
- Create: `scripts/drive-sync/upload.py`
- Create: `scripts/drive-sync/upload.sh`

This is the largest file; the work is split across multiple steps so each is a digestible review unit.

- [ ] **Step 1: Write upload.py — header, args, helpers, drive creation**

Contents of `scripts/drive-sync/upload.py` (initial — incomplete):

```python
#!/usr/bin/env python3
"""Phases 1-4: create drive, folders, documents on the active local switchboard,
and apply state via per-type handlers.

Pre-requisite: switchboard CLI's active profile must point to the local target.
The wrapper `upload.sh` enforces this with `assert_profile local`.

Output: writes id-map.json into the data dir as it progresses.

Usage:
    python3 scripts/drive-sync/upload.py \
        --data scripts/drive-sync/data/powerhouse-vault \
        --drive-name "knowledge vault"
"""
import argparse
import json
import sys
import time
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from lib.id_map import IdMap
from lib import sb
from handlers import (
    knowledge_note,
    moc as moc_handler,
    source as source_handler,
    knowledge_graph,
    pipeline_queue,
    health_report,
    vault_config,
)


HANDLERS = {
    "bai/knowledge-note": knowledge_note,
    "bai/moc": moc_handler,
    "bai/source": source_handler,
    "bai/knowledge-graph": knowledge_graph,
    "bai/pipeline-queue": pipeline_queue,
    "bai/health-report": health_report,
    "bai/vault-config": vault_config,
}

# Order Phase 2 doc creation by type so cross-doc refs resolve naturally:
# sources → knowledge-notes → mocs (parents-then-children) → singletons.
TYPE_ORDER = {
    "bai/source": 0,
    "bai/knowledge-note": 1,
    "bai/moc": 2,
    "bai/knowledge-graph": 3,
    "bai/pipeline-queue": 4,
    "bai/health-report": 5,
    "bai/vault-config": 6,
}


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--data", required=True, help="data dir (output of download.py)")
    p.add_argument("--drive-name", default="knowledge vault")
    p.add_argument("--preferred-editor", default="knowledge-vault",
                   help="drive-level editor module (default: knowledge-vault)")
    p.add_argument("--existing-drive", default=None, help="upload into existing drive id (skip creation)")
    p.add_argument("--throttle-ms", type=int, default=0, help="sleep between mutations to ease backpressure")
    return p.parse_args()


def load_state(data_dir: Path, doc_id: str) -> dict | None:
    p = data_dir / "states" / f"{doc_id}.json"
    if not p.exists():
        return None
    return json.loads(p.read_text())


def topo_sort_folders(folders: list[dict]) -> list[dict]:
    by_id = {f["id"]: f for f in folders}
    visited: set[str] = set()
    out: list[dict] = []
    def visit(f: dict) -> None:
        if f["id"] in visited:
            return
        parent = f.get("parentFolder")
        if parent and parent in by_id:
            visit(by_id[parent])
        visited.add(f["id"])
        out.append(f)
    for f in folders:
        visit(f)
    return out


def phase_1_create_drive_and_folders(args, manifest: dict, id_map: IdMap) -> tuple[str, str]:
    print("\n━━━ Phase 1: drive + folders ━━━")
    if args.existing_drive:
        drive_id = args.existing_drive
        out = sb.sb("drives", "get", drive_id)
        info = json.loads(out)
        drive_slug = info.get("slug", drive_id)
        print(f"  ✓ using existing drive: {info.get('name')} ({drive_id})")
    else:
        drive_id, drive_slug = sb.drives_create(args.drive_name, preferred_editor=args.preferred_editor)
        print(f"  ✓ created drive: {args.drive_name} ({drive_id}, slug={drive_slug}, editor={args.preferred_editor})")
    # Wait for drive to be queryable
    for attempt in range(5):
        time.sleep(1)
        try:
            sb.sb("drives", "get", drive_id)
            break
        except Exception:
            if attempt == 4:
                raise
    # Folders, parents-first
    sorted_folders = topo_sort_folders(manifest["folders"])
    actions = []
    for f in sorted_folders:
        new_id = str(uuid.uuid4())
        id_map.set(f["id"], new_id)
        inp: dict = {"id": new_id, "name": f["name"]}
        parent = f.get("parentFolder")
        if parent:
            inp["parentFolder"] = id_map.resolve(parent)
        actions.append({"type": "ADD_FOLDER", "input": inp, "scope": "global"})
    if actions:
        sb.apply_actions(drive_id, actions)
    print(f"  ✓ created {len(actions)} folders")
    return drive_id, drive_slug
```

- [ ] **Step 2: Append Phase 2 (doc creation) to upload.py**

Append to `scripts/drive-sync/upload.py`:

```python
def phase_2_create_documents(args, manifest: dict, id_map: IdMap, drive_id: str) -> None:
    print("\n━━━ Phase 2: create documents ━━━")
    docs = list(manifest["documents"])
    # Within bai/moc, parent mocs must be created before children. Compute the
    # moc-internal ordering up front using the source state files (parentRef).
    moc_states = {d["id"]: load_state(Path(args.data), d["id"]) or {}
                  for d in docs if d.get("type") == "bai/moc"}
    moc_creation_order = moc_handler.sort_mocs_for_creation(docs, moc_states)
    moc_rank = {doc_id: i for i, doc_id in enumerate(moc_creation_order)}

    def sort_key(d: dict):
        type_rank = TYPE_ORDER.get(d.get("type") or "?", 99)
        sub_rank = moc_rank.get(d["id"], 0) if d.get("type") == "bai/moc" else 0
        return (type_rank, sub_rank, d.get("name") or "")

    docs.sort(key=sort_key)

    failed: list[tuple[str, str]] = []
    for i, d in enumerate(docs, start=1):
        if id_map.get(d["id"]):
            continue  # already created on a prior run
        # CLI quoting: replace name if it could choke the CLI (commas, double-quotes).
        # Title is set later via setTitle in Phase 3, so this name is purely a placeholder.
        safe_name = d["name"]
        if any(ch in safe_name for ch in (",", '"', "\\")):
            safe_name = "doc-" + d["id"][:8]
        try:
            new_id = sb.docs_create(d["type"], safe_name, drive_id)
            id_map.set(d["id"], new_id)
            print(f"  [{i}/{len(docs)}] ✓ {d['type']:24s} {safe_name[:50]} → {new_id}")
        except Exception as e:
            failed.append((d["id"], str(e)[:200]))
            print(f"  [{i}/{len(docs)}] ✗ {d['type']} {d['name'][:50]} — {e}", file=sys.stderr)

    if failed:
        print(f"\n  ! Phase 2 had {len(failed)} failures (re-run upload to retry — already-created docs are skipped):", file=sys.stderr)
        for did, msg in failed[:10]:
            print(f"    {did}: {msg}", file=sys.stderr)

    # MOVE_NODE batch: place each doc into its remapped parent folder
    move_actions = []
    for d in manifest["documents"]:
        new_doc = id_map.get(d["id"])
        parent_old = d.get("parentFolder")
        if not new_doc or not parent_old:
            continue
        new_parent = id_map.get(parent_old)
        if not new_parent:
            continue
        move_actions.append({
            "type": "MOVE_NODE",
            "input": {"srcFolder": new_doc, "targetParentFolder": new_parent},
            "scope": "global",
        })
    if move_actions:
        sb.apply_actions(drive_id, move_actions)
        print(f"  ✓ placed {len(move_actions)} docs into folders")
```

- [ ] **Step 3: Append Phase 3 (state apply) to upload.py**

Append to `scripts/drive-sync/upload.py`:

```python
def phase_3_apply_state(args, manifest: dict, id_map: IdMap, drive_id: str) -> dict:
    """Apply scalar (non-cross-ref) actions per doc. Returns a dict of
    {new_doc_id: [crossref_actions]} for use in Phase 4."""
    print("\n━━━ Phase 3: apply state ━━━")
    deferred: dict[str, list[dict]] = {}
    failed: list[tuple[str, str]] = []
    data = Path(args.data)

    # Re-sort with same key as Phase 2 so dependent state lands in order.
    docs = list(manifest["documents"])
    moc_states = {d["id"]: load_state(data, d["id"]) or {}
                  for d in docs if d.get("type") == "bai/moc"}
    moc_creation_order = moc_handler.sort_mocs_for_creation(docs, moc_states)
    moc_rank = {doc_id: i for i, doc_id in enumerate(moc_creation_order)}

    def sort_key(d: dict):
        return (TYPE_ORDER.get(d.get("type") or "?", 99),
                moc_rank.get(d["id"], 0) if d.get("type") == "bai/moc" else 0,
                d.get("name") or "")
    docs.sort(key=sort_key)

    for i, d in enumerate(docs, start=1):
        new_id = id_map.get(d["id"])
        if not new_id:
            continue
        handler = HANDLERS.get(d["type"])
        if not handler:
            print(f"  [{i}/{len(docs)}] ! no handler for {d['type']} — skipped", file=sys.stderr)
            continue
        state = load_state(data, d["id"])
        if not state:
            continue
        try:
            scalars, crossrefs = handler.build_actions(state, id_map, drop_unmapped=True)
            if scalars:
                sb.apply_actions(new_id, scalars)
            if crossrefs:
                deferred[new_id] = crossrefs
            tag = f"[{i}/{len(docs)}]"
            print(f"  {tag} ✓ {d['type'][-20:]:>20s}  {(d['name'] or '')[:40]:40s}  +{len(scalars)} scalar  +{len(crossrefs)} ref")
            if args.throttle_ms > 0:
                time.sleep(args.throttle_ms / 1000)
        except Exception as e:
            failed.append((new_id, str(e)[:200]))
            print(f"  ✗ {d['name']} ({new_id}): {e}", file=sys.stderr)

    if failed:
        print(f"\n  ! Phase 3 had {len(failed)} failures", file=sys.stderr)
    return deferred


def phase_4_apply_crossrefs(deferred: dict[str, list[dict]]) -> None:
    print("\n━━━ Phase 4: cross-references ━━━")
    if not deferred:
        print("  (none)")
        return
    total = sum(len(a) for a in deferred.values())
    applied = 0
    failed: list[tuple[str, str]] = []
    for i, (doc_id, actions) in enumerate(deferred.items(), start=1):
        try:
            sb.apply_actions(doc_id, actions)
            applied += len(actions)
            print(f"  [{i}/{len(deferred)}] ✓ {doc_id} +{len(actions)} refs")
        except Exception as e:
            failed.append((doc_id, str(e)[:200]))
            print(f"  ✗ {doc_id}: {e}", file=sys.stderr)
    print(f"  → applied {applied}/{total} cross-ref actions")
```

- [ ] **Step 4: Append main() to upload.py**

Append to `scripts/drive-sync/upload.py`:

```python
def main() -> int:
    args = parse_args()
    data_dir = Path(args.data)
    manifest = json.loads((data_dir / "manifest.json").read_text())
    id_map = IdMap(data_dir / "id-map.json")

    print(f"[upload] data:        {data_dir}")
    print(f"[upload] drive name:  {args.drive_name}")
    print(f"[upload] folders:     {len(manifest['folders'])}")
    print(f"[upload] documents:   {len(manifest['documents'])}")
    print(f"[upload] id-map size: {len(id_map.all())} (resuming if non-zero)")

    drive_id, drive_slug = phase_1_create_drive_and_folders(args, manifest, id_map)
    phase_2_create_documents(args, manifest, id_map, drive_id)
    deferred = phase_3_apply_state(args, manifest, id_map, drive_id)
    phase_4_apply_crossrefs(deferred)

    # Write a final summary
    summary = {
        "driveId": drive_id,
        "driveSlug": drive_slug,
        "totalDocs": len(manifest["documents"]),
        "createdDocs": sum(1 for d in manifest["documents"] if id_map.get(d["id"])),
    }
    (data_dir / "upload-summary.json").write_text(json.dumps(summary, indent=2))
    print(f"\n[upload] done — drive: {drive_id} ({drive_slug})")
    print(f"[upload] created {summary['createdDocs']}/{summary['totalDocs']} documents")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 5: Write upload.sh**

Contents of `scripts/drive-sync/upload.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

###############################################################################
# upload.sh — bash entry for upload.py
#
# Asserts that the active switchboard profile is `local` (safety guard against
# accidental remote uploads), then delegates to upload.py.
#
# Usage:
#   bash scripts/drive-sync/upload.sh <data-dir> [drive-name]
#
# Env:
#   PROFILE            override profile name to assert (default: local)
#   PREFERRED_EDITOR   drive-level editor module (default: knowledge-vault)
#   EXISTING_DRIVE     drive id to upload into (skip drive creation)
#   THROTTLE_MS        sleep between mutations
###############################################################################

DATA_DIR="${1:?Usage: $0 <data-dir> [drive-name]}"
DRIVE_NAME="${2:-knowledge vault}"
PROFILE="${PROFILE:-local}"
PREFERRED_EDITOR="${PREFERRED_EDITOR:-knowledge-vault}"
EXISTING_DRIVE="${EXISTING_DRIVE:-}"
THROTTLE_MS="${THROTTLE_MS:-0}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/common.sh"

step "Preflight"
preflight
assert_profile "$PROFILE"

step "Running upload.py"
EXTRA=()
[ -n "$EXISTING_DRIVE" ] && EXTRA+=(--existing-drive "$EXISTING_DRIVE")
[ "$THROTTLE_MS" != "0" ] && EXTRA+=(--throttle-ms "$THROTTLE_MS")

python3 "$SCRIPT_DIR/upload.py" \
    --data "$DATA_DIR" \
    --drive-name "$DRIVE_NAME" \
    --preferred-editor "$PREFERRED_EDITOR" \
    "${EXTRA[@]}"
```

```bash
chmod +x scripts/drive-sync/upload.sh
```

- [ ] **Step 6: Validate Python syntax**

Run: `python3 -c "import ast; ast.parse(open('scripts/drive-sync/upload.py').read())"`
Expected: no output (parses cleanly).

Run: `bash -n scripts/drive-sync/upload.sh`
Expected: no output (valid bash).

- [ ] **Step 7: Commit**

```bash
git add scripts/drive-sync/upload.py scripts/drive-sync/upload.sh
git commit -m "$(cat <<'EOF'
feat(drive-sync): upload.py + upload.sh — Phases 1-4 orchestrator

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 17: reindex.py + reindex.sh — Phase 5

**Files:**
- Create: `scripts/drive-sync/reindex.py`
- Create: `scripts/drive-sync/reindex.sh`

The reindex mutation is exposed by the local switchboard's `knowledge-graph` subgraph. The endpoint URL is derived from the active profile.

- [ ] **Step 1: Write reindex.py**

Contents of `scripts/drive-sync/reindex.py`:

```python
#!/usr/bin/env python3
"""Phase 5: trigger reindexDrive on the local switchboard's knowledge-graph subgraph.

The reindex mutation is defined in subgraphs/knowledge-graph/helpers/reindex.ts.
It walks all bai/knowledge-note + bai/moc docs and rebuilds the per-drive PGlite
index used by semantic search.
"""
import argparse
import json
import sys
import urllib.error
from pathlib import Path
from urllib.request import Request, urlopen


REINDEX_MUTATION = """
mutation Reindex($driveId: String!) {
  reindexDrive(driveId: $driveId) {
    indexedNodes
    indexedEdges
    errors
  }
}
"""


def reindex(endpoint: str, drive_id: str) -> dict:
    body = {"query": REINDEX_MUTATION, "variables": {"driveId": drive_id}}
    req = Request(endpoint, data=json.dumps(body).encode(),
                  headers={"Content-Type": "application/json"}, method="POST")
    with urlopen(req, timeout=300) as resp:
        payload = json.loads(resp.read().decode())
    if payload.get("errors"):
        msgs = "; ".join(e.get("message", "?") for e in payload["errors"])
        raise RuntimeError(f"GraphQL errors: {msgs}")
    return payload["data"]["reindexDrive"]


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--endpoint", required=True,
                   help="local subgraph URL, e.g. http://localhost:4001/graphql/knowledgeGraph")
    p.add_argument("--drive-id", default=None,
                   help="explicit drive UUID; if omitted, reads from upload-summary.json")
    p.add_argument("--data", default=None,
                   help="data dir (used when --drive-id not given)")
    args = p.parse_args()

    drive_id = args.drive_id
    if not drive_id:
        if not args.data:
            print("error: pass --drive-id or --data", file=sys.stderr)
            return 2
        summary_path = Path(args.data) / "upload-summary.json"
        if not summary_path.exists():
            print(f"error: {summary_path} not found — pass --drive-id explicitly", file=sys.stderr)
            return 2
        drive_id = json.loads(summary_path.read_text())["driveId"]

    print(f"[reindex] endpoint: {args.endpoint}")
    print(f"[reindex] drive id: {drive_id}")
    try:
        result = reindex(args.endpoint, drive_id)
    except urllib.error.URLError as e:
        print(f"[reindex] network error: {e}", file=sys.stderr)
        return 1
    print(f"[reindex] indexed {result['indexedNodes']} nodes, {result['indexedEdges']} edges")
    if result.get("errors"):
        print(f"[reindex] {len(result['errors'])} errors:")
        for e in result["errors"][:10]:
            print(f"  - {e}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 2: Write reindex.sh**

Contents of `scripts/drive-sync/reindex.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

###############################################################################
# reindex.sh — Phase 5 wrapper. Triggers reindex on the local switchboard's
# knowledge-graph subgraph. Reads drive id from upload-summary.json.
#
# Usage:
#   bash scripts/drive-sync/reindex.sh <data-dir>
#
# Env:
#   ENDPOINT  override subgraph URL (default: http://localhost:4001/graphql/knowledgeGraph)
###############################################################################

DATA_DIR="${1:?Usage: $0 <data-dir>}"
ENDPOINT="${ENDPOINT:-http://localhost:4001/graphql/knowledgeGraph}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/common.sh"

step "Phase 5: reindex"
python3 "$SCRIPT_DIR/reindex.py" \
    --endpoint "$ENDPOINT" \
    --data "$DATA_DIR"
```

```bash
chmod +x scripts/drive-sync/reindex.sh
```

- [ ] **Step 3: Validate syntax**

Run: `python3 -c "import ast; ast.parse(open('scripts/drive-sync/reindex.py').read())"`
Run: `bash -n scripts/drive-sync/reindex.sh`
Expected: no output for both.

- [ ] **Step 4: Commit**

```bash
git add scripts/drive-sync/reindex.py scripts/drive-sync/reindex.sh
git commit -m "$(cat <<'EOF'
feat(drive-sync): reindex.py + reindex.sh — Phase 5 trigger

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 18: Run the full pipeline (smoke run)

**Files:** none — this is an integration run.

This task verifies everything works end-to-end against the local switchboard. The user must have `ph vetra` running on `http://localhost:4001` and the switchboard CLI's `local` profile pointing there.

- [ ] **Step 1: Verify prerequisites**

```bash
switchboard config show --format json | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['name'], d['url'])"
```

Expected: `local http://localhost:4001/graphql` (or matching values). If not, run `switchboard config use local`.

```bash
switchboard ping --format json
```

Expected: returns ok. If fails, ask the user to start `ph vetra`.

- [ ] **Step 2: Run all unit tests one more time**

```bash
python3 -m pytest scripts/drive-sync/tests/ -v
```

Expected: all tests pass (`id_map: 6, graphql: 4, compare: 4, knowledge_note: 10, moc: 8, source: 6` — total 38).

- [ ] **Step 3: Run the upload (data already downloaded in Task 7)**

```bash
bash scripts/drive-sync/upload.sh scripts/drive-sync/data/powerhouse-vault "knowledge vault"
```

Expected output skeleton:
- Phase 1: prints `created drive: knowledge vault (...)` and `created 11 folders`.
- Phase 2: 398 lines, mostly green checkmarks. If any red `✗` lines appear they'll have errors — note them.
- Phase 3: 398 lines reporting `+N scalar +M ref` per doc.
- Phase 4: ~200-300 cross-ref entries, all green.
- Final: `[upload] created 398/398 documents`.

If Phase 2 fails for some docs, just re-run the same command — already-created docs are skipped via `id-map.json`.

- [ ] **Step 4: Run the reindex**

```bash
bash scripts/drive-sync/reindex.sh scripts/drive-sync/data/powerhouse-vault
```

Expected: `indexed 375 nodes, ~672 edges` (matching what the deployed pre-fix state showed). If the count is way off, something's wrong.

- [ ] **Step 5: Open Connect locally and verify rendering**

Manually open `http://localhost:3000` (or wherever Connect runs). Navigate to the new "knowledge vault" drive.

Verify:
- [ ] Drive shows the 11 folders with correct names.
- [ ] Click a knowledge-note: title and description visible, topics/tags shown, content body rendered.
- [ ] Click a `BUILDS_ON` link inside a note: navigates to the linked note (no "document not found").
- [ ] Open a MoC: title, description, core ideas list visible.
- [ ] Search bar: type a phrase from a note → result returned by semantic search.

If any of these fail, capture the error and the affected doc id, then triage.

- [ ] **Step 6: Commit any updated test fixtures, output snippets, or fixes**

If the smoke run revealed a handler bug, fix it (the unit test that proves the fix is the gate to commit) and re-run upload.sh. If everything works, no commit is needed for this task.

---

## Self-Review

**1. Spec coverage:**

| Spec section | Plan task |
|---|---|
| Phase 0 download via GraphQL | Task 4 (graphql.py), Task 6 (download.py), Task 7 (run) |
| Phase 0.5 compare | Task 8 |
| Phase 1 drive + folders | Task 16 step 1 (`phase_1_create_drive_and_folders`) |
| Phase 2 doc creation + folder placement | Task 16 step 2 (`phase_2_create_documents`) |
| Phase 3 per-type handlers | Tasks 9, 10, 11, 12, 13, 14, 15 (one per type) |
| Phase 4 cross-refs | Task 16 step 3 (`phase_4_apply_crossrefs`) |
| Phase 5 reindex | Task 17 |
| Failure modes (id-map persistence) | Task 3 (atomic write tests) |
| CLI quoting workaround | Task 16 step 2 (replace `,"\\` with placeholder) |
| Verification | Task 18 step 5 |

**2. Placeholder scan:** None. All steps include exact code, exact commands, exact expected output. The "no handler for X" line in `phase_3_apply_state` is a runtime warning for unexpected types, not a plan placeholder — every type listed in the spec has a handler task.

**3. Type consistency:**
- `IdMap.get` / `IdMap.set` / `IdMap.resolve` — used consistently across handlers.
- Action shape `{type, input, scope}` — consistent across all handlers.
- `build_actions(state, id_map, drop_unmapped=True) -> (scalars, crossrefs)` signature is identical in all 7 handlers.
- `sb.apply_actions(doc_id, actions)` and `sb.docs_create(doc_type, name, drive)` — used consistently between sb.py and upload.py.
- `data_dir / "states" / f"{doc_id}.json"` path is used consistently in download.py, compare.py, upload.py.

No issues found.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-07-drive-sync-pipeline.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration. Good for an 18-task plan because each subagent gets a clean context window.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints. Faster for short plans but this one is large enough that the main context will fill up.

Which approach?
