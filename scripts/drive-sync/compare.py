#!/usr/bin/env python3
"""Phase 0.5: compare two drive-sync dumps for drift/loss detection.

Compares manifest doc lists + selected fields in each state file. Outputs a
human-readable report. Exit 0 always — this is a sanity gate, not a guard.

Usage:
    python3 scripts/drive-sync/compare.py \
        --left scripts/drive-sync/data/knowledge-vault \
        --right /path/to/another-dump
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
