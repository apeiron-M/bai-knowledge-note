#!/usr/bin/env python3
"""Read and write the Switchboard's document-permission grants for a drive.

Grants are written on the DRIVE, deliberately. The host's authorization service
walks the parent chain when it looks for a grant (`#hasGrantInHierarchy`
"...on the document or any ancestor"), so one row per person covers every
document in the vault. Writing per-document rows for 1,000+ documents would be
both slower and impossible to audit.

Two properties of the underlying model shape this tool:

  * It is ALLOW-ONLY. There is no deny, so removing access means revoking a row,
    and a person's effective level is the highest grant they hold in the chain.
  * READ < WRITE < ADMIN is a rank, not a set. Granting WRITE replaces READ for
    that address rather than adding to it (`grantDocumentPermission` upserts on
    (documentId, userAddress)).

Requires ADMIN on the drive: `documentAccess` and the grant mutations are
themselves gated. Export a bearer first:

    export PH_ACCESS_TOKEN="$(ph access-token | tail -1)"

Usage:
    # show who has access
    python3 scripts/drive-sync/grants.py --drive <id> --list

    # dry run is the default; nothing is written without --apply
    python3 scripts/drive-sync/grants.py --drive <id> --read 0xabc… --write 0xdef…
    python3 scripts/drive-sync/grants.py --drive <id> --read 0xabc… --apply

    python3 scripts/drive-sync/grants.py --drive <id> --revoke 0xabc… --apply
"""
import argparse
import json
import os
import re
import sys
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

ADDRESS_RE = re.compile(r"^0x[0-9a-fA-F]{40}$")
RANK = {"READ": 1, "WRITE": 2, "ADMIN": 3}


def auth_endpoint() -> str:
    """The core `auth` subgraph, derived from the same env var the rest of
    drive-sync uses so one export points every script at one Switchboard."""
    base = os.environ.get("PH_GRAPHQL_ENDPOINT", "http://localhost:4001/graphql")
    return base.rsplit("/graphql", 1)[0] + "/graphql/auth"


def post(query: str, variables: dict) -> dict:
    token = os.environ.get("PH_ACCESS_TOKEN", "").strip()
    if not token:
        sys.exit(
            'No PH_ACCESS_TOKEN. Managing grants requires ADMIN, so a bearer is\n'
            'mandatory here (unlike reads on an open host):\n'
            '  export PH_ACCESS_TOKEN="$(ph access-token | tail -1)"'
        )
    body = json.dumps({"query": query, "variables": variables}).encode()
    req = Request(
        auth_endpoint(),
        data=body,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {token}",
        },
        method="POST",
    )
    try:
        with urlopen(req, timeout=30) as res:
            payload = json.loads(res.read())
    except HTTPError as err:
        if err.code == 401:
            sys.exit("401 from the Switchboard: the token is invalid or expired "
                     "(they last 7 days — mint a new one with `ph access-token`).")
        sys.exit(f"HTTP {err.code} from {auth_endpoint()}: {err.read()[:300]!r}")
    except URLError as err:
        sys.exit(f"Could not reach {auth_endpoint()}: {err.reason}")

    if payload.get("errors"):
        msg = payload["errors"][0].get("message", "?")
        if "admin" in msg.lower() or "forbidden" in msg.lower():
            sys.exit(f"Refused: {msg}\n"
                     "Managing access needs ADMIN on the drive, or membership of "
                     "the server's ADMINS list.")
        sys.exit(f"GraphQL error: {msg}")
    return payload.get("data") or {}


ACCESS_Q = """query Access($id: String!) {
  documentAccess(documentId: $id) {
    permissions { userAddress permission grantedBy createdAt }
  }
}"""
PROTECTION_Q = """query Protection($id: String!) {
  documentProtection(documentId: $id) { protected ownerAddress }
}"""
GRANT_M = """mutation Grant($id: String!, $addr: String!, $perm: DocumentPermissionLevel!) {
  grantDocumentPermission(documentId: $id, userAddress: $addr, permission: $perm) {
    userAddress permission
  }
}"""
REVOKE_M = """mutation Revoke($id: String!, $addr: String!) {
  revokeDocumentPermission(documentId: $id, userAddress: $addr)
}"""


def current(drive: str) -> dict[str, str]:
    data = post(ACCESS_Q, {"id": drive})
    rows = data["documentAccess"]["permissions"]
    return {r["userAddress"].lower(): r["permission"] for r in rows}


def show(drive: str) -> None:
    prot = post(PROTECTION_Q, {"id": drive})["documentProtection"]
    held = current(drive)
    state = "PROTECTED" if prot["protected"] else "UNPROTECTED — anyone can read AND write"
    print(f"drive {drive}\n  {state}")
    if prot.get("ownerAddress"):
        print(f"  owner {prot['ownerAddress']} (implicit ADMIN)")
    if not held:
        print("  no grants — only the server's ADMINS list can reach it")
        return
    print(f"  {len(held)} grant(s), inherited by every document in the drive:")
    for addr, perm in sorted(held.items(), key=lambda kv: (-RANK[kv[1]], kv[0])):
        print(f"    {perm:<6} {addr}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--drive", required=True, help="drive document id")
    ap.add_argument("--read", nargs="*", default=[], metavar="ADDR")
    ap.add_argument("--write", nargs="*", default=[], metavar="ADDR")
    ap.add_argument("--admin", nargs="*", default=[], metavar="ADDR")
    ap.add_argument("--revoke", nargs="*", default=[], metavar="ADDR")
    ap.add_argument("--list", action="store_true", help="show access and exit")
    ap.add_argument("--apply", action="store_true",
                    help="actually write (default is a dry run)")
    args = ap.parse_args()

    if args.list:
        show(args.drive)
        return

    wanted: dict[str, str] = {}
    for level, addrs in (("READ", args.read), ("WRITE", args.write), ("ADMIN", args.admin)):
        for a in addrs:
            if not ADDRESS_RE.match(a):
                sys.exit(f"Not an Ethereum address: {a!r} (expected 0x + 40 hex)")
            prior = wanted.get(a.lower())
            if prior and prior != level:
                sys.exit(f"{a} given two levels ({prior} and {level}); pick one.")
            wanted[a.lower()] = level
    for a in args.revoke:
        if not ADDRESS_RE.match(a):
            sys.exit(f"Not an Ethereum address: {a!r}")
        if a.lower() in wanted:
            sys.exit(f"{a} is both granted and revoked in one run; pick one.")

    if not wanted and not args.revoke:
        show(args.drive)
        sys.exit("\nNothing to do. Pass --read/--write/--admin/--revoke, or --list.")

    held = current(drive := args.drive)

    # Idempotent: a grant already at the requested level is skipped, so a
    # re-run is a no-op rather than a duplicate write.
    plan: list[tuple[str, str, str]] = []
    for addr, level in wanted.items():
        if held.get(addr) == level:
            plan.append(("skip", addr, level))
        else:
            plan.append(("grant", addr, level))
    for addr in (a.lower() for a in args.revoke):
        plan.append(("revoke", addr, held.get(addr, "—")) if addr in held
                    else ("skip-revoke", addr, "—"))

    print(f"drive {drive}")
    for action, addr, level in plan:
        was = held.get(addr, "none")
        if action == "grant":
            print(f"  GRANT   {addr}  {was} -> {level}")
        elif action == "revoke":
            print(f"  REVOKE  {addr}  {was} -> none")
        elif action == "skip":
            print(f"  ok      {addr}  already {level}")
        else:
            print(f"  ok      {addr}  holds no grant, nothing to revoke")

    if not args.apply:
        print("\nDry run. Re-run with --apply to write.")
        return

    for action, addr, level in plan:
        if action == "grant":
            post(GRANT_M, {"id": drive, "addr": addr, "perm": level})
        elif action == "revoke":
            post(REVOKE_M, {"id": drive, "addr": addr})
    print("\nApplied. Result:")
    show(drive)


if __name__ == "__main__":
    main()
