"""Pytest config — adds scripts/drive-sync to sys.path so tests can import lib/ and handlers/."""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
