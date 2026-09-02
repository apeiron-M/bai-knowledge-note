/**
 * Operation history of one note, from the reactor.
 *
 * Refetches when the document's global revision changes (the editor's own
 * dispatches and background revalidations both move it) and when the live
 * change feed announces an update to this document — so an agent's edit
 * shows up in the History tab within a second of landing.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { resolveReactorEndpoint } from "../../shared/subgraph-endpoint.js";
import { onVaultRemoteChange } from "../../shared/vault-live.js";
import { fetchNoteOperations, type NoteOperation } from "../lib/revisions.js";

export type UseNoteRevisionsResult = {
  operations: NoteOperation[];
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
};

export function useNoteRevisions(
  documentId: string | undefined,
  revisionKey: number,
): UseNoteRevisionsResult {
  const [operations, setOperations] = useState<NoteOperation[]>([]);
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
    // note keeps the previous history on screen while the new one loads.
    if (lastDocRef.current !== documentId) {
      setOperations([]);
      lastDocRef.current = documentId;
    }
    setIsLoading(true);
    setError(null);
    fetchNoteOperations(resolveReactorEndpoint(), documentId)
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
    return onVaultRemoteChange((change) => {
      if (change.documents.some((d) => d.id === documentId)) refetch();
    });
  }, [documentId, refetch]);

  return { operations, isLoading, error, refetch };
}
