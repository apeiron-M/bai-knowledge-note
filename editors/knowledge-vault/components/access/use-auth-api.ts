/**
 * The whole of the Switchboard's document-permission API, in one place.
 *
 * Everything the host's authorization model can express is here and nothing
 * else is: five queries and six mutations against the core `auth` subgraph,
 * which is registered only when `DOCUMENT_PERMISSIONS_ENABLED=true`. Every call
 * therefore tolerates the endpoint being absent rather than assuming it.
 *
 * Semantics worth knowing before reading the callers:
 *
 *  - **Allow-only.** There is no deny. Removing access means revoking a row.
 *  - **READ < WRITE < ADMIN is a rank**, so granting WRITE replaces READ for
 *    that address; the mutation upserts on (documentId, userAddress).
 *  - **Protection and grants inherit** down the node tree: a document is
 *    protected if it *or any ancestor* is, and a grant is honoured if it sits
 *    on the document or any ancestor. This is why drive-level rows are the
 *    normal way to run a vault.
 *  - **Per-operation grants do NOT inherit.** `isOperationRestricted` is keyed
 *    by documentId with no ancestor walk, and it is allow-list-by-existence:
 *    the *first* grant for an operation silently restricts that operation to
 *    the named addresses for everyone else. Both facts have to be surfaced at
 *    the point of use, not documented elsewhere.
 */
import { authHeaders } from "../../../shared/authed-fetch.js";
import {
  resolveAuthEndpoint,
  resolveReactorEndpoint,
} from "../../../shared/subgraph-endpoint.js";

export type Level = "READ" | "WRITE" | "ADMIN";
export const LEVEL_RANK: Record<Level, number> = {
  READ: 1,
  WRITE: 2,
  ADMIN: 3,
};

export type Grant = {
  documentId: string;
  userAddress: string;
  permission: Level;
  grantedBy: string;
  createdAt: string;
};

export type OperationGrant = {
  documentId: string;
  operationType: string;
  userAddress: string;
  grantedBy: string;
};

export type Protection = {
  documentId: string;
  protected: boolean;
  ownerAddress: string | null;
};

export type DriveNode = {
  id: string;
  name: string;
  kind: string;
  parentFolder: string | null;
  documentType?: string | null;
};

export type ApiResult<T> = { data?: T; error?: string; forbidden?: boolean };

async function call<T>(
  endpoint: string,
  query: string,
  variables: Record<string, unknown> = {},
): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers: await authHeaders(),
      body: JSON.stringify({ query, variables }),
    });
  } catch (err) {
    return {
      error: `Could not reach the Switchboard: ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }
  if (res.status === 401) {
    return { error: "Not signed in, or the session expired.", forbidden: true };
  }
  if (!res.ok) return { error: `Switchboard returned HTTP ${res.status}.` };

  const json = (await res.json()) as {
    data?: T;
    errors?: { message?: string; extensions?: { code?: string } }[];
  };
  const err = json.errors?.[0];
  if (err) {
    return {
      error: err.message ?? "Request refused.",
      forbidden: err.extensions?.code === "FORBIDDEN",
    };
  }
  return { data: json.data };
}

const auth = <T>(q: string, v?: Record<string, unknown>) =>
  call<T>(resolveAuthEndpoint(), q, v);
const reactor = <T>(q: string, v?: Record<string, unknown>) =>
  call<T>(resolveReactorEndpoint(), q, v);

/* ── reads ─────────────────────────────────────────────────────── */

/** The caller's own grants. The one query a would-be reader may run. */
export function myPermissions() {
  return auth<{ userDocumentPermissions: Grant[] }>(
    `query { userDocumentPermissions { documentId permission grantedBy createdAt userAddress } }`,
  );
}

/** Grants ON one document. Requires ADMIN of that document. */
export function documentAccess(documentId: string) {
  return auth<{ documentAccess: { documentId: string; permissions: Grant[] } }>(
    `query A($id: String!) { documentAccess(documentId: $id) {
       documentId permissions { documentId userAddress permission grantedBy createdAt } } }`,
    { id: documentId },
  );
}

export function documentProtection(documentId: string) {
  return auth<{ documentProtection: Protection }>(
    `query P($id: String!) { documentProtection(documentId: $id) {
       documentId protected ownerAddress } }`,
    { id: documentId },
  );
}

export function operationPermissions(documentId: string, operationType: string) {
  return auth<{
    operationPermissions: {
      documentId: string;
      operationType: string;
      userPermissions: OperationGrant[];
    };
  }>(
    `query O($id: String!, $op: String!) {
       operationPermissions(documentId: $id, operationType: $op) {
         documentId operationType
         userPermissions { documentId operationType userAddress grantedBy } } }`,
    { id: documentId, op: operationType },
  );
}

/** Whether the CALLER may execute one operation. Performs nothing. */
export function canExecuteOperation(documentId: string, operationType: string) {
  return auth<{ canExecuteOperation: boolean }>(
    `query C($id: String!, $op: String!) {
       canExecuteOperation(documentId: $id, operationType: $op) }`,
    { id: documentId, op: operationType },
  );
}

/** The drive's node tree, read from the reactor rather than the auth subgraph. */
export async function driveNodes(driveId: string): Promise<ApiResult<DriveNode[]>> {
  const res = await reactor<{
    document?: { document?: { state?: { global?: { nodes?: DriveNode[] } } } };
  }>(
    `query T($id: String!) { document(identifier: $id) { document { state } } }`,
    { id: driveId },
  );
  if (res.error) return { error: res.error, forbidden: res.forbidden };
  return { data: res.data?.document?.document?.state?.global?.nodes ?? [] };
}

/**
 * Operation names per document type, discovered from the deployed models so
 * the picker covers whatever this Switchboard actually runs. Falls back to the
 * drive's own operations, which is the set that governs creating, moving and
 * deleting documents.
 */
export async function operationTypes(): Promise<Record<string, string[]>> {
  const DRIVE_OPS = [
    "ADD_FILE",
    "ADD_FOLDER",
    "DELETE_NODE",
    "UPDATE_FILE",
    "UPDATE_NODE",
    "COPY_NODE",
    "MOVE_NODE",
  ];
  const fallback = { "powerhouse/document-drive": DRIVE_OPS };
  const res = await reactor<{
    documentModels?: { items?: { id: string; specification?: unknown }[] };
  }>(`query { documentModels(paging: { limit: 200 }) { items { id specification } } }`);
  const items = res.data?.documentModels?.items;
  if (!items) return fallback;

  const out: Record<string, string[]> = { ...fallback };
  for (const item of items) {
    const spec = item.specification as
      | { modules?: { operations?: { name?: string }[] }[] }
      | undefined;
    const names = (spec?.modules ?? [])
      .flatMap((m) => m.operations ?? [])
      .map((o) => o.name)
      .filter((n): n is string => typeof n === "string" && n.length > 0);
    if (names.length) out[item.id] = names;
  }
  return out;
}

/* ── writes ────────────────────────────────────────────────────── */

export function grantDocument(id: string, addr: string, perm: Level) {
  return auth<unknown>(
    `mutation G($id: String!, $a: String!, $p: DocumentPermissionLevel!) {
       grantDocumentPermission(documentId: $id, userAddress: $a, permission: $p) {
         userAddress permission } }`,
    { id, a: addr, p: perm },
  );
}

export function revokeDocument(id: string, addr: string) {
  return auth<unknown>(
    `mutation R($id: String!, $a: String!) {
       revokeDocumentPermission(documentId: $id, userAddress: $a) }`,
    { id, a: addr },
  );
}

export function setProtection(id: string, isProtected: boolean) {
  return auth<{ setDocumentProtection: Protection }>(
    `mutation S($id: String!, $p: Boolean!) {
       setDocumentProtection(documentId: $id, protected: $p) {
         documentId protected ownerAddress } }`,
    { id, p: isProtected },
  );
}

export function transferOwnership(id: string, addr: string) {
  return auth<{ transferDocumentOwnership: Protection }>(
    `mutation T($id: String!, $a: String!) {
       transferDocumentOwnership(documentId: $id, newOwnerAddress: $a) {
         documentId protected ownerAddress } }`,
    { id, a: addr },
  );
}

export function grantOperation(id: string, op: string, addr: string) {
  return auth<unknown>(
    `mutation GO($id: String!, $op: String!, $a: String!) {
       grantOperationPermission(documentId: $id, operationType: $op, userAddress: $a) {
         userAddress operationType } }`,
    { id, op, a: addr },
  );
}

export function revokeOperation(id: string, op: string, addr: string) {
  return auth<unknown>(
    `mutation RO($id: String!, $op: String!, $a: String!) {
       revokeOperationPermission(documentId: $id, operationType: $op, userAddress: $a) }`,
    { id, op, a: addr },
  );
}
