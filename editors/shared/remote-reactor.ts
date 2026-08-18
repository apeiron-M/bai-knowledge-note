/**
 * Direct GraphQL reads/writes against the Switchboard reactor.
 *
 * The vault is a server-authoritative app: its 1,500+ documents are
 * written by agents against the reactor and read back through the
 * `knowledgeGraph` subgraph. Replicating the whole drive into the
 * browser reactor is what these helpers replace — a fresh sync of this
 * vault serialises past Chrome's 127 MiB-per-IndexedDB-value cap, so
 * the local replica can never durably finish loading (measured: 1,012
 * failed persists and ~40k `Document not found` warnings in 16 minutes
 * on a clean profile).
 *
 * Writes here use the same two GraphQL surfaces the (extensively
 * proven) `scripts/drive-sync/lib/gql.py` uses:
 *
 *  - `/graphql`   — namespaced `createDocument` (e.g. `Source {
 *    createDocument }`), the only path that materialises header +
 *    initial state + drive node in one call.
 *  - `/graphql/r` — `mutateDocument` / `deleteDocument`.
 *
 * Every mutation ends by announcing itself on the window event the
 * `GraphQLClientDocumentCache` listens for, so any open editor showing
 * the document refetches.
 */
import { resolveReactorEndpoint } from "./subgraph-endpoint.js";

/** Reactor read/mutate endpoint (`/graphql/r`) for the current host. */
export function resolveReactorReadEndpoint(): string {
  return `${resolveReactorEndpoint()}/r`;
}

/**
 * GraphQL namespace per document type on the supergraph, verified by
 * introspection against the running reactor. `bai/wbs` is the one
 * non-obvious mapping — the model's name is "Work Breakdown Structure".
 */
const NAMESPACE_BY_TYPE: Record<string, string> = {
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
  "bai/project": "Project",
  "bai/wbs": "WorkBreakdownStructure",
};

type GraphQLResponse<T> = {
  data?: T;
  errors?: { message?: string }[];
};

async function gqlRequest<T>(
  endpoint: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} from ${endpoint}`);
  }
  const json = (await res.json()) as GraphQLResponse<T>;
  if (json.errors?.length) {
    throw new Error(json.errors.map((e) => e.message ?? "?").join("; "));
  }
  if (!json.data) throw new Error("GraphQL response carried no data");
  return json.data;
}

export type VaultAction = {
  type: string;
  input: Record<string, unknown>;
  scope?: string;
};

/**
 * Fill in the envelope fields `mutateDocument` requires but callers
 * shouldn't have to invent. An action persisted without an `id` breaks
 * the sync stream for every client (non-nullable `Action.id`), which is
 * exactly the incident the Python tooling guards against — keep the two
 * implementations in lockstep.
 */
function toEnvelope(action: VaultAction): Record<string, unknown> {
  return {
    id: crypto.randomUUID(),
    timestampUtcMs: new Date().toISOString(),
    scope: action.scope ?? "global",
    type: action.type,
    input: action.input,
  };
}

/**
 * Tell the GraphQL document cache (and through it, any open editor)
 * that a document changed server-side. Uses the exact window events
 * `GraphQLClientDocumentCache` subscribes to.
 */
export function announceDocumentMutation(identifier: string): void {
  window.dispatchEvent(
    new CustomEvent("MutateDocument", { detail: { identifier } }),
  );
}

/**
 * Apply a batch of actions to one document on the server. The reactor
 * commits the whole batch or rolls back — no partial application.
 */
export async function mutateDocumentRemote(
  documentId: string,
  actions: VaultAction[],
): Promise<void> {
  if (actions.length === 0) return;
  await gqlRequest(
    resolveReactorReadEndpoint(),
    `mutation VaultMutate($id: String!, $actions: [JSONObject!]!) {
       mutateDocument(documentIdentifier: $id, actions: $actions) { documentType }
     }`,
    { id: documentId, actions: actions.map(toEnvelope) },
  );
  announceDocumentMutation(documentId);
}

/**
 * Create a fully-materialised document on the server — header, initial
 * state AND drive node — then optionally move it into a folder.
 * Verified empirically: the namespaced create adds the node to the
 * drive's tree, and the (documentId-filtered) sync channel delivers
 * that tree change to the local replica, so the sidebar updates without
 * any local dispatch.
 */
/**
 * Resolve a folder path like "knowledge/notes" against the SERVER's
 * drive tree. Client snapshots can lag or be mid-hydration; the server
 * tree is the truth in remote-first mode, and a create that lands in
 * the wrong folder is worse than one extra read.
 */
async function resolveFolderIdByPath(
  driveId: string,
  path: string,
): Promise<string | undefined> {
  const data = await gqlRequest<{
    document?: { document?: { state?: unknown } };
  }>(
    resolveReactorReadEndpoint(),
    `query VaultTree($id: String!) { document(identifier: $id) { document { state } } }`,
    { id: driveId },
  );
  let state = data.document?.document?.state as
    | { global?: { nodes?: Array<Record<string, unknown>> } }
    | string
    | undefined;
  if (typeof state === "string") state = JSON.parse(state) as typeof state;
  const nodes = (typeof state === "object" ? state?.global?.nodes : []) ?? [];
  const folders = nodes.filter((n) => n.kind === "folder");
  const byId = new Map(folders.map((f) => [f.id as string, f]));
  for (const folder of folders) {
    const parts: string[] = [];
    let current: Record<string, unknown> | undefined = folder;
    while (current) {
      parts.unshift(current.name as string);
      current = current.parentFolder
        ? byId.get(current.parentFolder as string)
        : undefined;
    }
    if (parts.join("/") === path) return folder.id as string;
  }
  return undefined;
}

export async function createDocumentRemote(options: {
  documentType: string;
  name: string;
  driveId: string;
  parentFolderId?: string | null;
  /** Fallback: resolve this path against the server tree. */
  targetFolderPath?: string;
}): Promise<string> {
  const ns = NAMESPACE_BY_TYPE[options.documentType];
  if (!ns) {
    throw new Error(
      `No GraphQL namespace known for ${options.documentType} — cannot create remotely`,
    );
  }
  const data = await gqlRequest<
    Record<string, { createDocument?: { id?: string } }>
  >(
    resolveReactorEndpoint(),
    `mutation VaultCreate($name: String!, $parentIdentifier: String) {
       ${ns} { createDocument(name: $name, parentIdentifier: $parentIdentifier) { id } }
     }`,
    { name: options.name, parentIdentifier: options.driveId },
  );
  const newId = data[ns]?.createDocument?.id;
  if (!newId) throw new Error("createDocument returned no id");

  let parentFolderId = options.parentFolderId ?? undefined;
  if (!parentFolderId && options.targetFolderPath) {
    try {
      parentFolderId = await resolveFolderIdByPath(
        options.driveId,
        options.targetFolderPath,
      );
    } catch {
      // Root placement beats a failed create; the tree can be tidied.
    }
  }
  if (parentFolderId) {
    // Placement is a drive-document operation. `srcFolder` is the
    // reactor's field name for the moved node, folder or file alike.
    await gqlRequest(
      resolveReactorEndpoint(),
      `mutation VaultMove($docId: PHID!, $input: DocumentDrive_MoveNodeInput!) {
         DocumentDrive { moveNode(docId: $docId, input: $input) { id } }
       }`,
      {
        docId: options.driveId,
        input: {
          srcFolder: newId,
          targetParentFolder: parentFolderId,
        },
      },
    );
  }
  announceDocumentMutation(options.driveId);
  return newId;
}

/**
 * Add a folder node to the drive **on the server**.
 *
 * The counterpart to `createDocumentRemote` for the other half of a
 * drive tree. reactor-browser's `addFolder` writes to the local replica,
 * which under remote-first never syncs anywhere — so vault
 * initialisation has to go through here or it produces a folder tree
 * that only exists in one browser tab.
 *
 * Unlike document creation, the node id is chosen by the caller (the
 * mutation's `input.id` is non-null), so the new id is returned straight
 * back rather than read out of the response.
 */
export async function createFolderRemote(options: {
  driveId: string;
  name: string;
  parentFolderId?: string | null;
}): Promise<string> {
  const id = crypto.randomUUID();
  await gqlRequest(
    resolveReactorEndpoint(),
    `mutation VaultAddFolder($docId: PHID!, $input: DocumentDrive_AddFolderInput!) {
       DocumentDrive { addFolder(docId: $docId, input: $input) { id } }
     }`,
    {
      docId: options.driveId,
      input: {
        id,
        name: options.name,
        parentFolder: options.parentFolderId ?? null,
      },
    },
  );
  announceDocumentMutation(options.driveId);
  return id;
}

/**
 * Delete a document server-side. Removes both the document and its
 * drive node (verified empirically against the running reactor).
 */
export async function deleteDocumentRemote(
  documentId: string,
  driveId?: string,
): Promise<void> {
  await gqlRequest(
    resolveReactorReadEndpoint(),
    `mutation VaultDelete($id: String!) { deleteDocument(identifier: $id) }`,
    { id: documentId },
  );
  announceDocumentMutation(documentId);
  if (driveId) announceDocumentMutation(driveId);
}
