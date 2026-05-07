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
