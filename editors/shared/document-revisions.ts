/**
 * Time travel over any document's operation log.
 *
 * The reactor never exposes "state as of revision N" over GraphQL — its
 * `view` filter takes only `branch` and `scopes`, and the browser client
 * throws on a `revision` by design. What it does expose is every operation
 * with its full action input, in order, with the signer who made it. And an
 * editor always holds its own document model's reducer. So a revision is a
 * pure function: replay operations 0…N through the reducer.
 *
 * Nothing here knows which document model it is replaying: `replayOperations`
 * takes the model's `createDocument` and `reducer`. Per-model modules
 * (`<editor>/lib/revisions.ts`) add only the one-line operation summaries.
 */
import {
  garbageCollect,
  sortOperations,
} from "@powerhousedao/shared/document-model";

export type OperationSigner = {
  user: { address: string; networkId: string; chainId: number } | null;
  app: { name: string; key: string } | null;
  signatures: string[];
};

/** One operation as the reactor returns it (`PHDocument.operations.items`). */
export type DocumentOperation = {
  index: number;
  skip: number;
  timestampUtcMs: string;
  hash: string;
  error: string | null;
  action: {
    id: string;
    type: string;
    scope: string;
    timestampUtcMs: string;
    input: Record<string, unknown>;
    context: { signer: OperationSigner | null } | null;
  };
};

/**
 * One page of the wire shape (`PHDocument.operations`).
 *
 * `totalCount` is deliberately not selected: the reactor returns the count
 * of the *page*, not of the log (`paging: { limit: 1 }` answers 1 for a
 * document with twelve operations), so it cannot be used to size a history.
 * Paging follows `hasNextPage`/`cursor` instead.
 */
export type DocumentOperationsPage = {
  items: DocumentOperation[];
  hasNextPage: boolean;
  cursor: string | null;
};

export const DOCUMENT_OPERATIONS_QUERY = `
  query DocumentOperations($id: String!, $cursor: String) {
    document(identifier: $id, view: { branch: "main" }) {
      document {
        operations(
          filter: { scopes: ["global"] }
          paging: { limit: 200, cursor: $cursor }
        ) {
          items {
            index
            skip
            timestampUtcMs
            hash
            error
            action {
              id
              type
              scope
              timestampUtcMs
              input
              context {
                signer {
                  user { address networkId chainId }
                  app { name key }
                  signatures
                }
              }
            }
          }
          hasNextPage
          cursor
        }
      }
    }
  }
`;

/**
 * Fetch every global-scope operation of a document, oldest first. Pages
 * through the reactor's cursor; the loop is bounded rather than trusting
 * `hasNextPage`, so a server that keeps saying "more" cannot hang the tab.
 */
export async function fetchDocumentOperations(
  endpoint: string,
  documentId: string,
  fetchImpl: typeof fetch = fetch,
  maxPages = 20,
): Promise<DocumentOperation[]> {
  const all: DocumentOperation[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < maxPages; page++) {
    const res = await fetchImpl(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query: DOCUMENT_OPERATIONS_QUERY,
        variables: { id: documentId, cursor },
      }),
    });
    if (!res.ok) throw new Error(`operations fetch failed: HTTP ${res.status}`);
    const json = (await res.json()) as {
      data?: {
        document?: { document?: { operations?: DocumentOperationsPage } };
      };
      errors?: Array<{ message?: string }>;
    };
    if (json.errors?.length) {
      throw new Error(json.errors[0]?.message ?? "operations fetch failed");
    }
    const pageData = json.data?.document?.document?.operations;
    if (!pageData) break;
    all.push(...pageData.items);
    if (!pageData.hasNextPage || !pageData.cursor) break;
    cursor = pageData.cursor;
  }
  return sortOperations(all);
}

/**
 * The operations that are actually in effect: `skip` (undo) folded in, so a
 * replay applies exactly what the reactor applied.
 */
export function effectiveOperations(
  ops: DocumentOperation[],
): DocumentOperation[] {
  return garbageCollect(sortOperations(ops));
}

/** An operation the reducer refused during replay. */
export type ReplayFailure = { index: number; type: string; reason: string };

export type ReplayResult<TDocument> = {
  document: TDocument;
  failures: ReplayFailure[];
};

/**
 * The two functions a document model must supply to be replayable: a fresh
 * empty document, and its reducer. Both come from the model's barrel
 * (`utils.createDocument` and `reducer`).
 */
export type ReplayModel<TDocument> = {
  createDocument: () => TDocument;
  reducer: (document: TDocument, action: never) => TDocument;
};

/**
 * The part of a document this module reads back after applying an action.
 * `PHDocument.operations` is a `Record<string, Operation[]>` — `global` is
 * reached through the index signature, not a declared property, so the
 * constraint has to be written the same way.
 */
type WithOperationLog = {
  operations: Record<string, ReadonlyArray<{ error?: string }> | undefined>;
};

/**
 * Replay operations with index ≤ `upToIndex` (inclusive) from an empty
 * document. Reducer errors are recorded and skipped, matching the reactor
 * (an errored operation is stored but does not mutate state).
 */
export function replayDocumentOperations<TDocument extends WithOperationLog>(
  ops: DocumentOperation[],
  upToIndex: number,
  model: ReplayModel<TDocument>,
): ReplayResult<TDocument> {
  let document = model.createDocument();
  const failures: ReplayFailure[] = [];
  for (const op of effectiveOperations(ops)) {
    if (op.index > upToIndex) break;
    // An operation the reactor already refused changed nothing then either.
    if (op.error) {
      failures.push({ index: op.index, type: op.action.type, reason: op.error });
      continue;
    }
    try {
      const before = document.operations.global?.length ?? 0;
      document = model.reducer(document, op.action as never);
      const applied = document.operations.global?.[before];
      if (applied?.error) {
        failures.push({
          index: op.index,
          type: op.action.type,
          reason: applied.error,
        });
      }
    } catch (e) {
      failures.push({
        index: op.index,
        type: op.action.type,
        reason: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return { document, failures };
}

/* ------------------------------------------------------------------ */
/*  Presentation helpers                                              */
/* ------------------------------------------------------------------ */

/** A string input field, clipped for a one-line summary. */
export function str(v: unknown, max = 60): string {
  if (typeof v !== "string") return "";
  return v.length > max ? `${v.slice(0, max)}…` : v;
}

/** Fallback summary for an operation type a model module does not name. */
export function humanizeOperationType(type: string): string {
  return type
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/^\w/, (c) => c.toUpperCase());
}

/**
 * Which part of a document an operation touched — drives a colour dot, and
 * one kind carries a contract: `content` must be exactly the operations that
 * write the document's text (title, description, body), because the history
 * scrubber's steppers navigate between text changes by it.
 */
export type OperationKind =
  | "content"
  | "lifecycle"
  | "links"
  | "topics"
  | "annotation"
  | "metadata"
  | "other";

export const OPERATION_KIND_COLOR: Record<OperationKind, string> = {
  content: "#cba6f7",
  lifecycle: "#a6e3a1",
  links: "#89b4fa",
  topics: "#f9e2af",
  annotation: "#eba0ac",
  metadata: "#94e2d5",
  other: "#6c7086",
};

/** The last signature on an operation, or null when unsigned. */
export function lastSignature(op: DocumentOperation): string | null {
  const sigs = op.action.context?.signer?.signatures;
  if (!sigs || sigs.length === 0) return null;
  return sigs[sigs.length - 1] ?? null;
}
