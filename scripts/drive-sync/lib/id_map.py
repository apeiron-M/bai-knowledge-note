"""Persistent old-id → new-id mapping for cross-drive migration.

Writes are atomic (write-to-tmp + os.replace) so a crash mid-run leaves
either the previous state or the new state on disk — never partial.
"""
import json
import os
import tempfile
from pathlib import Path
from typing import Optional


# Reserved key recording which reactor+drive this map was built against.
# Not a document id, so it cannot collide with a real entry.
TARGET_KEY = "__target__"


class IdMap:
    """snapshot-id → target-id mapping, scoped to ONE target.

    A mapping is only meaningful relative to the (endpoint, drive) it was
    produced against. Reusing a snapshot directory across targets silently
    destroys an upload: `phase_2_create_documents` skips any document that
    already has an entry ("already created on a prior run"), so a map left
    over from a previous target makes the run skip nearly everything, then
    report success from the map's size, then fail in phase 3 applying state
    to ids that do not exist on this reactor. Observed exactly that: 1526
    documents skipped, 2 created, "created+placed 1528 docs", then timeouts.

    So the map now records its target and refuses to be used against a
    different one.
    """

    def __init__(self, path: Path, target: Optional[str] = None):
        self.path = Path(path)
        if self.path.exists():
            self._data = json.loads(self.path.read_text())
        else:
            self._data = {}
        self._target = self._data.pop(TARGET_KEY, None)
        if target is not None:
            self.ensure_target(target)

    def ensure_target(self, target: str) -> None:
        """Bind this map to `target`, or refuse if it belongs to another."""
        if self._target == target:
            return
        if self._target is None and not self._data:
            self._target = target
            self._flush()
            return
        if self._target is None:
            raise RuntimeError(
                f"{self.path} holds {len(self._data)} mappings but records no target, "
                f"so it cannot be proven to belong to {target}. Delete it (or use a "
                f"fresh --data directory) before uploading."
            )
        raise RuntimeError(
            f"{self.path} was built against {self._target}, not {target}. "
            f"Uploading with another target's id-map skips documents that were "
            f"never created here. Delete it (or use a fresh --data directory)."
        )

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
            payload = dict(self._data)
            if self._target is not None:
                payload[TARGET_KEY] = self._target
            json.dump(payload, f, indent=2)
            tmp = f.name
        os.replace(tmp, self.path)
