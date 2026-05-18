"""Direct GraphQL bypass of the switchboard CLI.

The CLI's `docs create --parent-folder` does CREATE_DOCUMENT (on the drive
as parent) then MOVE_NODE in two sequential subprocess invocations. With
~400 docs this adds:
  - ~200ms × 2 subprocesses per doc → ~3 min of overhead alone
  - the inability to batch state/relationship dispatches with the create

Talking to `/graphql/r` directly removes the subprocess overhead and gives
us a single keep-alive HTTP connection over which we can pipeline many
mutations. The CLI's two-op pattern (CREATE then MOVE) is structurally
required by the reactor — `createDocument` only accepts a document as
`parentIdentifier`, not a folder — so we still emit one MOVE_NODE per
doc. We just emit it faster, and we batch the doc-scope state and
relationship dispatches that follow.

We use the model-namespaced `createDocument` (e.g. `KnowledgeNote {
createDocument(name, parentIdentifier) }`) because that's the only path
that materialises the full document (header + initial state + drive
node). The drive-level `DocumentDrive.addFile` only inserts a node into
the drive's tree — it does NOT create the underlying document — so a
doc created that way is unreachable via `document(identifier)` and
mutateDocument throws on it.

For relationships we use the dedicated `addRelationship` /
`removeRelationship` mutations on `/graphql/r` instead of dispatching
ADD_RELATIONSHIP / REMOVE_RELATIONSHIP system actions through
`mutateDocument`. The native mutations may produce different sync
envelopes that don't trigger the browser's `skip:1 CREATE_DOCUMENT`
synthesis bug.
"""
import json
import os
import uuid
from typing import Any
from urllib import request
from urllib.error import HTTPError, URLError


DEFAULT_ENDPOINT = os.environ.get(
    "PH_GRAPHQL_ENDPOINT", "http://localhost:4001/graphql"
)


class GraphQLError(RuntimeError):
    """A GraphQL request returned errors."""


def post(
    query: str,
    variables: dict[str, Any] | None = None,
    *,
    endpoint: str = DEFAULT_ENDPOINT,
    timeout: float = 30.0,
) -> dict[str, Any]:
    """Issue a POST request to a GraphQL endpoint and return `data`.

    Raises GraphQLError if the response includes `errors`. Caller
    handles retries — none here.
    """
    payload = json.dumps({
        "query": query,
        **({"variables": variables} if variables else {}),
    }).encode("utf-8")
    req = request.Request(
        endpoint,
        data=payload,
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
        method="POST",
    )
    try:
        with request.urlopen(req, timeout=timeout) as resp:
            body = json.loads(resp.read().decode("utf-8"))
    except HTTPError as e:
        body = json.loads(e.read().decode("utf-8")) if e.fp else {}
        raise GraphQLError(
            f"HTTP {e.code}: {json.dumps(body)[:300]}"
        ) from e
    except URLError as e:
        raise GraphQLError(f"network: {e.reason}") from e

    if body.get("errors"):
        msg = body["errors"][0].get("message", "unknown")
        raise GraphQLError(msg)
    return body.get("data") or {}


# ────────────────────────────────────────────────────────────────────────
# Document creation — namespaced createDocument on /graphql (supergraph)
# ────────────────────────────────────────────────────────────────────────

# Model id → namespace mapping. The CLI keeps this in an introspection
# cache; we hardcode the mappings we know are needed for the upload to
# avoid a separate introspection round-trip on every script run.
NAMESPACE_BY_TYPE: dict[str, str] = {
    "bai/knowledge-note": "KnowledgeNote",
    "bai/moc": "Moc",
    "bai/source": "Source",
    "bai/pipeline-queue": "PipelineQueue",
    "bai/health-report": "HealthReport",
    "bai/vault-config": "VaultConfig",
    "bai/observation": "Observation",
    "bai/tension": "Tension",
    "bai/derivation": "Derivation",
    "bai/research-claim": "ResearchClaim",
}

SUPERGRAPH_ENDPOINT = DEFAULT_ENDPOINT  # /graphql
READ_ENDPOINT = DEFAULT_ENDPOINT.replace("/graphql", "/graphql/r")


def create_document(
    doc_type: str,
    name: str,
    drive_id: str,
) -> str:
    """Create a fully-materialised document at the drive root.

    Returns the new document id. Caller should follow with `move_node`
    if the doc needs to land inside a folder — the namespaced
    `createDocument` only takes a document (the drive) as `parentIdentifier`.
    """
    ns = NAMESPACE_BY_TYPE.get(doc_type)
    if not ns:
        raise GraphQLError(f"no namespace mapping for {doc_type}")
    query = (
        f"mutation($name: String!, $parentIdentifier: String) "
        f"{{ {ns} {{ createDocument(name: $name, parentIdentifier: $parentIdentifier) {{ id }} }} }}"
    )
    data = post(query, {"name": name, "parentIdentifier": drive_id}, endpoint=SUPERGRAPH_ENDPOINT)
    new_id = (data.get(ns) or {}).get("createDocument", {}).get("id")
    if not new_id:
        raise GraphQLError(f"createDocument returned no id: {json.dumps(data)[:200]}")
    return new_id


def move_node(drive_id: str, src_folder_or_doc_id: str, target_parent_folder: str) -> None:
    """Place a doc/folder inside a parent folder via DocumentDrive.moveNode.

    Note: the input field is `srcFolder` regardless of whether the moved
    item is a folder or a file — that's the reactor's naming, not a typo.
    """
    query = (
        "mutation($docId: PHID!, $input: DocumentDrive_MoveNodeInput!) "
        "{ DocumentDrive { moveNode(docId: $docId, input: $input) { id } } }"
    )
    variables = {
        "docId": drive_id,
        "input": {
            "srcFolder": src_folder_or_doc_id,
            "targetParentFolder": target_parent_folder,
        },
    }
    post(query, variables, endpoint=SUPERGRAPH_ENDPOINT)


# ────────────────────────────────────────────────────────────────────────
# Reactor read endpoint — mutateDocument + relationships
# ────────────────────────────────────────────────────────────────────────


def _now_iso() -> str:
    import datetime
    return datetime.datetime.now(datetime.timezone.utc).strftime(
        "%Y-%m-%dT%H:%M:%S.000Z"
    )


def _ensure_action_envelope(action: dict[str, Any]) -> dict[str, Any]:
    """Inject the fields mutateDocument needs but per-action callers omit."""
    out = dict(action)
    out.setdefault("id", str(uuid.uuid4()))
    out.setdefault("timestampUtcMs", _now_iso())
    out.setdefault("scope", "global")
    if "input" not in out:
        out["input"] = {}
    return out


def mutate_document(document_id: str, actions: list[dict[str, Any]]) -> None:
    """Apply a batch of actions to one document atomically via
    `mutateDocument`. The reactor commits the whole batch or rolls back —
    no partial application.
    """
    if not actions:
        return
    envelopes = [_ensure_action_envelope(a) for a in actions]
    # Schema declares `actions: [JSONObject!]!` even though there's an
    # ActionInput type — JSONObject lets the resolver accept arbitrary
    # actions without per-type validation, which is what we want.
    # `mutateDocument` returns `PHDocument!` and requires a subfield
    # selection — we don't need the body but GraphQL won't let us omit
    # one, so we ask for the cheapest scalar (`documentType`).
    query = (
        "mutation($id: String!, $actions: [JSONObject!]!) "
        "{ mutateDocument(documentIdentifier: $id, actions: $actions) { documentType } }"
    )
    post(
        query,
        {"id": document_id, "actions": envelopes},
        endpoint=READ_ENDPOINT,
    )


def add_relationship(
    source_id: str,
    target_id: str,
    relationship_type: str,
    branch: str = "main",
) -> None:
    """Use the dedicated `addRelationship` mutation rather than
    dispatching an ADD_RELATIONSHIP system action through
    mutateDocument. The native mutation may produce a different sync
    envelope shape; under the reactor-browser sync-executor bug that
    synthesises skip:1 CREATE_DOCUMENTs, this is the cleanest path we
    have on the client side.
    """
    query = (
        "mutation($source: String!, $target: String!, $type: String!, $branch: String) "
        "{ addRelationship(sourceIdentifier: $source, targetIdentifier: $target, "
        "relationshipType: $type, branch: $branch) { documentType } }"
    )
    post(
        query,
        {
            "source": source_id,
            "target": target_id,
            "type": relationship_type,
            "branch": branch,
        },
        endpoint=READ_ENDPOINT,
    )


# ────────────────────────────────────────────────────────────────────────
# Drive lifecycle (one-shot — kept here so the script doesn't need sb.py
# at all for the hot path)
# ────────────────────────────────────────────────────────────────────────


def create_drive(name: str, preferred_editor: str = "knowledge-vault") -> tuple[str, str]:
    """Create a new drive via the DocumentDrive subgraph. Returns
    (drive_id, drive_slug).

    Note: dev.246+ dropped the `meta: JSONObject` argument and exposed
    `preferredEditor` directly. Previously this was nested as
    `meta: { preferredEditor }`.
    """
    query = (
        "mutation($name: String!, $preferredEditor: String) "
        "{ DocumentDrive { createDocument(name: $name, preferredEditor: $preferredEditor) { id slug } } }"
    )
    data = post(
        query,
        {"name": name, "preferredEditor": preferred_editor},
        endpoint=SUPERGRAPH_ENDPOINT,
    )
    info = (data.get("DocumentDrive") or {}).get("createDocument") or {}
    drive_id = info.get("id")
    slug = info.get("slug") or drive_id
    if not drive_id:
        raise GraphQLError(f"drive create returned no id: {json.dumps(data)[:200]}")
    return drive_id, slug


def get_drive_nodes(drive_id: str) -> list[dict[str, Any]]:
    """Fetch the drive's full node tree (folders + files) from the read
    endpoint. Used by phase 2 to confirm placement and by phase 1 to
    discover existing folder ids on a resumed run.
    """
    query = (
        "query($id: String!) { document(identifier: $id) { document { state } } }"
    )
    data = post(query, {"id": drive_id}, endpoint=READ_ENDPOINT)
    doc = ((data.get("document") or {}).get("document") or {})
    state = doc.get("state") or {}
    if isinstance(state, str):
        state = json.loads(state)
    return ((state.get("global") or {}).get("nodes") or [])
