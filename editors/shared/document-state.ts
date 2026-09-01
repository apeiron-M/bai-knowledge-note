/**
 * Read one document's full state from the reactor.
 *
 * This is the transport half of `fetchDocOutcome` in `use-reactor-docs`,
 * lifted out so the chat's `read_document` tool and the caching hook issue the
 * same query. Two copies of this query would drift the moment either grew a
 * field.
 *
 * Two failure modes are kept distinct on purpose:
 *
 *  - **Transport failure** (network error, non-2xx) → *throws*. The caching
 *    hook treats this as "unreachable" and keeps the last good body, so a
 *    connection blip does not blank a row.
 *  - **Missing** (GraphQL error, no document, no state) → resolves `null`.
 *    The hook evicts on this, so a deleted document cannot ghost.
 *
 * Collapsing both into `null` would make a 502 look like a deletion.
 */
import { resolveReactorEndpoint } from "./subgraph-endpoint.js";

export interface RawDocument {
  id: string;
  name: string | null;
  documentType: string | null;
  createdAtUtcIso: string | null;
  lastModifiedAtUtcIso: string | null;
  state: Record<string, unknown>;
}

const DOC_QUERY = `
  query DocState($id: String!) {
    document(identifier: $id) {
      document {
        id
        name
        documentType
        createdAtUtcIso
        lastModifiedAtUtcIso
        state
      }
    }
  }
`;

type Payload = {
  data?: {
    document?: {
      document?: {
        id?: string;
        name?: string | null;
        documentType?: string | null;
        createdAtUtcIso?: string | null;
        lastModifiedAtUtcIso?: string | null;
        state?: unknown;
      } | null;
    } | null;
  };
  errors?: unknown[];
};

export async function fetchDocumentState(
  id: string,
): Promise<RawDocument | null> {
  const res = await fetch(resolveReactorEndpoint(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: DOC_QUERY, variables: { id } }),
  });
  if (!res.ok) throw new Error(`reactor responded HTTP ${res.status}`);
  const json = (await res.json()) as Payload;

  if (json.errors?.length) return null;
  const doc = json.data?.document?.document;
  if (!doc?.state) return null;

  // Some reactor builds serialise `state` as a JSON string; others send an
  // object. Normalise so callers never have to check.
  let state: Record<string, unknown>;
  if (typeof doc.state === "string") {
    try {
      state = JSON.parse(doc.state) as Record<string, unknown>;
    } catch {
      return null;
    }
  } else {
    state = doc.state as Record<string, unknown>;
  }

  return {
    id: doc.id ?? id,
    name: doc.name ?? null,
    documentType: doc.documentType ?? null,
    createdAtUtcIso: doc.createdAtUtcIso ?? null,
    lastModifiedAtUtcIso: doc.lastModifiedAtUtcIso ?? null,
    state,
  };
}
