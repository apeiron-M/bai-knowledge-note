"""atlas-sync — snapshot / rebuild / verify the Atlas knowledge vault.

Why this exists separately from `scripts/drive-sync`
----------------------------------------------------
`drive-sync` owns the *Powerhouse* knowledge vault dataset and its
runbook. The Atlas vault is a different corpus (1,533 docs mined from
next-gen-atlas) with two extra requirements drive-sync doesn't have:

  1. `bai/tension` documents, which drive-sync has no handler for.
  2. A **history-clean rebuild**. The live Atlas drive accumulated
     ADD_RELATIONSHIP → REMOVE_RELATIONSHIP churn (4,396 edges added
     then purged) that Connect's inbox scheduler chokes on. Replaying a
     snapshot into a fresh drive reproduces the *state* without the
     churn, so each document ends up with a linear op history.

Everything else — the GraphQL transport, the id-map, the per-type
handlers, the four upload phases — is imported from `drive-sync`
rather than copied. This module puts `drive-sync` on `sys.path` so
`from lib import gql` and `from handlers import ...` resolve to the
proven implementations. Our own code lives under the distinct
`atlaslib` package name so there is no import shadowing.
"""
import re
import sys
from pathlib import Path

# ── Import bootstrap ────────────────────────────────────────────────
# drive-sync's modules are laid out as top-level `lib` / `handlers`
# packages inside a hyphenated directory, so they can only be reached
# via sys.path (a hyphen is not a legal Python identifier).
DRIVE_SYNC = Path(__file__).resolve().parents[1].parent / "drive-sync"
if not (DRIVE_SYNC / "lib" / "gql.py").exists():  # pragma: no cover
    raise ImportError(f"drive-sync not found next to atlas-sync (looked in {DRIVE_SYNC})")
if str(DRIVE_SYNC) not in sys.path:
    sys.path.insert(0, str(DRIVE_SYNC))


# ── Targets ─────────────────────────────────────────────────────────
# Named endpoints so nobody has to paste a URL and risk pointing a
# rebuild at the wrong reactor. Anything that looks like a URL is
# accepted verbatim.
TARGETS: dict[str, str] = {
    "local": "http://localhost:4001/graphql",
    "remote": "https://jade-bat-19425107-switchboard.vetra.io/graphql",
}

# Known drive identifiers per target, used as the default for --drive.
DRIVES: dict[str, str] = {
    "remote": "688dbf68-f979-44fc-98ab-605b75675d1f",
}

DEFAULT_DATA = Path(__file__).resolve().parents[1] / "data" / "atlas-vault"

_UUID_RE = re.compile(r"^[0-9a-fA-F-]{8,64}$")


def resolve_endpoint(target: str) -> str:
    """Map a target name (`local`, `remote`) or a raw URL to a /graphql URL."""
    if target in TARGETS:
        return TARGETS[target]
    if target.startswith("http://") or target.startswith("https://"):
        return target.rstrip("/")
    raise SystemExit(
        f"unknown target {target!r}; use one of {sorted(TARGETS)} or a full URL"
    )


def use_endpoint(url: str):
    """Point drive-sync's `lib.gql` at `url` and return the module.

    `lib.gql` reads PH_GRAPHQL_ENDPOINT once at import time into three
    module constants. Rebinding them here means callers can switch
    targets in-process (and tests can point at a stub) without having
    to arrange the environment before the first import.
    """
    from lib import gql

    gql.DEFAULT_ENDPOINT = url
    gql.SUPERGRAPH_ENDPOINT = url
    gql.READ_ENDPOINT = url.replace("/graphql", "/graphql/r")
    # `post`'s `endpoint` is a keyword-only argument whose default was
    # bound to the old DEFAULT_ENDPOINT when the function was defined,
    # so rebinding the constant alone would silently leave every
    # endpoint-less call (e.g. gql.get_drive_info) pointing at the
    # original target. Patch the stored default too.
    if gql.post.__kwdefaults__ is not None:
        gql.post.__kwdefaults__["endpoint"] = url
    return gql


def safe_identifier(doc_id: str) -> str:
    """Guard ids that get inlined into a GraphQL document.

    The batched readers build one query with hundreds of aliases, so ids
    are interpolated into the query string rather than passed as
    variables. Every id we handle is a UUID; refusing anything else
    keeps that interpolation from becoming an injection point.
    """
    if not _UUID_RE.match(doc_id or ""):
        raise ValueError(f"refusing to inline non-uuid identifier: {doc_id!r}")
    return doc_id


def instrument_connections(gql) -> dict[str, int]:
    """Count the TCP connections a run actually opens.

    `lib/gql` keeps one keep-alive connection per (scheme, host) in a
    module-level pool and reconnects only when the server drops the
    socket. That is the difference between a working bulk run and a
    failing one: 20 sequential requests over fresh connections took 48s
    with ~15% `handshake operation timed out`, versus 1.2s and zero
    failures pooled.

    Because `post` resolves `_connection` / `_drop` as module globals,
    wrapping them here is enough to observe every open. The counts are
    printed at the end of a run so "one connection, held open" is a
    checked claim rather than an assumed one.
    """
    counts = {"opened": 0, "reconnects": 0, "requests": 0}
    connect, drop, post = gql._connection, gql._drop, gql.post

    def counting_connection(endpoint):
        before = len(gql._POOL)
        result = connect(endpoint)
        if len(gql._POOL) > before:
            counts["opened"] += 1
        return result

    def counting_drop(key):
        if key in gql._POOL:
            counts["reconnects"] += 1
        return drop(key)

    def counting_post(*args, **kwargs):
        counts["requests"] += 1
        return post(*args, **kwargs)

    gql._connection = counting_connection
    gql._drop = counting_drop
    gql.post = counting_post
    return counts
