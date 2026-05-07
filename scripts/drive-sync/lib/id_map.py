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
