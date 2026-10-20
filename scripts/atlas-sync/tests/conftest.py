"""Adds scripts/atlas-sync to sys.path so tests can import atlaslib.

Importing atlaslib in turn puts scripts/drive-sync on sys.path, which is
how `lib.id_map` and the shared handlers resolve.
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
