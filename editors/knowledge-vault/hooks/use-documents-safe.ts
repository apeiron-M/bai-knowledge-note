import { useEffect, useRef, useState } from "react";
import {
  useDispatch,
  useFileNodesInSelectedDrive,
  useGetDocument,
  useGetDocumentAsync,
} from "@powerhousedao/reactor-browser";
import type { Action, PHDocument } from "document-model";
import type { DocumentDispatch } from "@powerhousedao/reactor-browser";

/**
 * Concurrency cap for batched fetches. Chrome limits HTTP/1.1 connections
 * to ~6 per host; firing 348 docs in parallel triggers
 * `ERR_INSUFFICIENT_RESOURCES`. 6 keeps us safely below the cap while still
 * draining a 348-doc drive in roughly the same wall-clock time.
 */
const FETCH_CONCURRENCY = 6;

/**
 * Run an array of async tasks with a fixed in-flight cap. Resolves to the
 * settled results in input order — same shape as `Promise.allSettled`
 * conceptually, but never floods the connection pool.
 */
async function pMapLimited<T, U>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<U>,
): Promise<PromiseSettledResult<U>[]> {
  const results: PromiseSettledResult<U>[] = items.map(() => ({
    status: "rejected",
    reason: new Error("not run"),
  }));
  let next = 0;
  const runners = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      for (;;) {
        const i = next++;
        if (i >= items.length) return;
        try {
          results[i] = { status: "fulfilled", value: await worker(items[i]) };
        } catch (reason) {
          results[i] = { status: "rejected", reason };
        }
      }
    },
  );
  await Promise.all(runners);
  return results;
}

/**
 * Drop-in replacement for `useDocumentsInSelectedDrive` that works around
 * Connect's stalled per-doc polling.
 *
 * Connect's in-browser cache populates from a polling channel
 * (`pollSyncEnvelopes`). For large drives, the per-document payloads can
 * stall — drive doc syncs but individual notes don't. `documentCache.get(id)`
 * then either returns nothing or rejects with `Document not found`,
 * which manifests as render-crashes through Suspense (CONNECT_BUGS §Bug 2).
 *
 * The escape hatch: call `documentCache.get(id, true)` — the `true` flag
 * forces a fresh fetch via Connect's reactor client (whichever URL it's
 * already configured for, dev or prod). This bypasses the stalled cache
 * without us hardcoding a reactor URL.
 *
 * Concurrency-capped at 6 so we don't trip Chrome's HTTP/1.1 connection
 * limit and get `ERR_INSUFFICIENT_RESOURCES`.
 */
export function useDocumentsSafe(): PHDocument[] {
  const fileNodes = useFileNodesInSelectedDrive();
  const getDocument = useGetDocument();
  const [docs, setDocs] = useState<PHDocument[]>([]);
  const lastIdsRef = useRef<string>("");

  useEffect(() => {
    const ids = (fileNodes ?? []).map((n) => n.id);
    if (!ids.length) {
      if (docs.length) setDocs([]);
      return;
    }
    const idsKey = ids.join(",");
    if (idsKey === lastIdsRef.current) return;
    lastIdsRef.current = idsKey;

    let cancelled = false;
    void pMapLimited(ids, FETCH_CONCURRENCY, (id) => getDocument(id)).then(
      (results) => {
        if (cancelled) return;
        const ok = results
          .filter(
            (r): r is PromiseFulfilledResult<PHDocument> =>
              r.status === "fulfilled",
          )
          .map((r) => r.value)
          .filter((d): d is PHDocument => !!d);
        setDocs(ok);
      },
    );

    return () => {
      cancelled = true;
    };
  }, [fileNodes, getDocument, docs.length]);

  return docs;
}

/**
 * Non-suspending alternative to `useDocumentById`. Wraps
 * `useGetDocumentAsync` (which exposes a loading state instead of
 * throwing on missing docs) and pairs it with `useDispatch` to keep the
 * `[doc, dispatch]` tuple shape callers expect.
 */
export function useDocumentByIdSafe<
  T extends PHDocument = PHDocument,
  A extends Action = Action,
>(
  id: string | null | undefined,
): [T, DocumentDispatch<A>] | [undefined, undefined] {
  const { data } = useGetDocumentAsync(id ?? null);
  const [, dispatch] = useDispatch(data);
  if (!data) return [undefined, undefined];
  return [data as T, dispatch as DocumentDispatch<A>];
}
