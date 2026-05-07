/**
 * Direct-from-reactor document fetcher.
 *
 * Connect's documentCache (and its underlying KyselyDocumentView) is
 * the canonical source for document state, but we've observed it
 * persistently throwing `Document not found` for IDs that exist on the
 * server. The browser's local replica of Connect's read store can be
 * arbitrarily stale or fail to backfill some docs entirely.
 *
 * This hook bypasses the cache and asks the reactor's GraphQL endpoint
 * directly for each document's full state. Used by VaultSidebar to
 * populate MoC / observation / tension / vault-config lists.
 *
 * Cost: N independent fetches (concurrency-capped) on every distinct
 * id list. Acceptable for the tens-of-docs ranges these views cover.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { PHDocument } from "document-model";

const FETCH_CONCURRENCY = 6;

const DOC_QUERY = `
  query DocState($id: String!) {
    document(identifier: $id) {
      document { state }
    }
  }
`;

type RawDocResponse = {
  data?: {
    document?: {
      document?: {
        state?: { global?: Record<string, unknown> };
      };
    };
  };
  errors?: { message?: string }[];
};

function reactorEndpoint(): string {
  const hostname = globalThis.window?.location?.hostname;
  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return "http://localhost:4001/graphql";
  }
  if (hostname && /^connect\..+\.vetra\.io$/.test(hostname)) {
    const sbHost = hostname.replace(/^connect\./, "switchboard.");
    return `https://${sbHost}/graphql`;
  }
  return "/graphql";
}

async function fetchDocState(id: string): Promise<PHDocument | null> {
  const res = await fetch(reactorEndpoint(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: DOC_QUERY, variables: { id } }),
  });
  if (!res.ok) return null;
  const json = (await res.json()) as RawDocResponse;
  if (json.errors?.length) return null;
  const state = json.data?.document?.document?.state;
  if (!state) return null;
  // Synthesize a PHDocument-shaped object that the existing call sites
  // (which read `d.header.documentType`, `d.state.global`, `d.header.id`)
  // can handle. Header type/id are stitched in by the caller via the
  // typeOf / idOf helpers — see useReactorDocs below.
  return { state } as unknown as PHDocument;
}

async function pMap<T, U>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<U>,
): Promise<U[]> {
  const results: U[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (;;) {
        const i = next++;
        if (i >= items.length) return;
        results[i] = await worker(items[i]);
      }
    }),
  );
  return results;
}

export type ReactorDocSpec = {
  id: string;
  documentType: string;
  name?: string;
};

/**
 * Returns full document state objects for the given specs, fetched
 * directly from the reactor (one GraphQL call per id, concurrency-
 * capped). Each returned object has the shape Connect's PHDocument
 * roughly conforms to: `{ header: { id, documentType, name }, state }`.
 * Failed fetches are filtered out of the result.
 */
export function useReactorDocs(specs: ReactorDocSpec[]): PHDocument[] {
  const [docs, setDocs] = useState<PHDocument[]>([]);
  const lastKeyRef = useRef<string>("");

  // Stable string key for the dep array (specs identity changes per render).
  const key = useMemo(
    () => specs.map((s) => `${s.id}:${s.documentType}`).join(","),
    [specs],
  );

  useEffect(() => {
    if (specs.length === 0) {
      if (docs.length) setDocs([]);
      return;
    }
    if (key === lastKeyRef.current) return;
    lastKeyRef.current = key;

    let cancelled = false;
    void pMap(specs, FETCH_CONCURRENCY, async (spec) => {
      const doc = await fetchDocState(spec.id);
      if (!doc) return null;
      // Stitch a header so callers can read header.id / header.documentType.
      return {
        header: {
          id: spec.id,
          documentType: spec.documentType,
          name: spec.name ?? spec.id,
        },
        state: (doc as unknown as { state: unknown }).state,
      } as unknown as PHDocument;
    }).then((results) => {
      if (cancelled) return;
      const ok = results.filter((d): d is PHDocument => d !== null);
      setDocs(ok);
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return docs;
}
