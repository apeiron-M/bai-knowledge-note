/**
 * Operation history of one document, from the reactor.
 *
 * Refetches when the document's global revision changes (the editor's own
 * dispatches and background revalidations both move it) and when the live
 * change feed announces an update to this document — so an agent's edit
 * shows up in a History tab within a second of landing.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchDocumentOperations,
  type DocumentOperation,
} from "./document-revisions.js";
import { resolveReactorEndpoint } from "./subgraph-endpoint.js";
import { debounced, onVaultRemoteChange } from "./vault-live.js";

export type UseDocumentRevisionsResult = {
  operations: DocumentOperation[];
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
};

export function useDocumentRevisions(
  documentId: string | undefined,
  revisionKey: number,
): UseDocumentRevisionsResult {
  const [operations, setOperations] = useState<DocumentOperation[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const lastDocRef = useRef<string | undefined>(undefined);

  const refetch = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!documentId) {
      setOperations([]);
      return;
    }
    let cancelled = false;
    // Only blank the list when switching documents; a refetch of the same
    // document keeps the previous history on screen while the new one loads.
    if (lastDocRef.current !== documentId) {
      setOperations([]);
      lastDocRef.current = documentId;
    }
    setIsLoading(true);
    setError(null);
    fetchDocumentOperations(resolveReactorEndpoint(), documentId)
      .then((ops) => {
        if (cancelled) return;
        setOperations(ops);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [documentId, revisionKey, tick]);

  useEffect(() => {
    if (!documentId) return;
    // One history read is up to 20 sequential pages carrying every
    // operation's full input — for a source that includes the entire source
    // text. An agent's `docs apply` announces one event PER OPERATION, so
    // refetching per event meant tens of paged reads for a single write
    // burst. `debounced` carries a max-wait ceiling, so a sustained firehose
    // still refreshes on a steady cadence rather than starving the trailing
    // edge forever (the failure e4f5f94 fixed for the change feed).
    const refetchSoon = debounced(() => setTick((t) => t + 1), 1_000);
    return onVaultRemoteChange((change) => {
      if (change.documents.some((d) => d.id === documentId)) refetchSoon();
    });
  }, [documentId]);

  return { operations, isLoading, error, refetch };
}
