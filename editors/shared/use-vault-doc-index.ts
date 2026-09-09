/**
 * Lightweight document index for the vault's document editors.
 *
 * Every document editor used to call `useDocumentsInSelectedDrive()` to
 * resolve titles for pickers and reference lookups. That hook loads the
 * FULL state of every document in the drive — ~1,500 reads for what is
 * a `{id, title, type}` lookup. Under the vault's remote-first mode
 * those reads go to the Switchboard, so opening any editor triggered a
 * corpus-sized fetch burst.
 *
 * This hook answers the same questions from two cheap round-trips:
 *
 *  1. `knowledgeGraphNodes` — the subgraph projection: real titles and
 *     note types for knowledge-notes and MoCs (the types every picker
 *     actually lists).
 *  2. The drive tree from the reactor — id/name/documentType for every
 *     other document, so `byId` can resolve any reference (a tension's
 *     involvedRefs, a source's extractedClaims) to at least its node
 *     name.
 *
 * Caching, deduplication and invalidation live in `vault-doc-index-store.ts`
 * so they can be tested without a renderer; this file is the network call
 * plus the React binding. Two things the binding guarantees:
 *
 *  - **A stable return value.** Everything handed back keeps its identity
 *    across renders while the data is unchanged, including the empty
 *    values. A hook that returns a fresh `[]` on every render is a trap:
 *    a consumer that lists it in a dependency array (as
 *    `scope-of-work/views/project/ExecutionSections.tsx` does) then
 *    recomputes forever.
 *
 *  - **It updates itself.** Agents write to the vault over GraphQL, which
 *    fires no browser event, so the index subscribes to the Switchboard's
 *    change feed and invalidates on the changes that can actually alter
 *    it. Without this the titles a picker shows were fixed at mount.
 */
import { authHeaders } from "./authed-fetch.js";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSelectedDriveId } from "@powerhousedao/reactor-browser";
import {
  resolveKnowledgeGraphEndpoint,
  resolveReactorEndpoint,
} from "./subgraph-endpoint.js";
import {
  createDocIndexStore,
  indexAffected,
  type IndexData,
  type VaultDocSummary,
} from "./vault-doc-index-store.js";
import { debounced, isVaultLive, onVaultRemoteChange } from "./vault-live.js";

export type { VaultDocSummary } from "./vault-doc-index-store.js";

export type VaultDocIndex = {
  /** Knowledge-notes and MoCs with real titles — picker material. */
  knowledgeDocs: VaultDocSummary[];
  /** Every document in the drive, by id. */
  byId: Map<string, VaultDocSummary>;
  isLoading: boolean;
  /** Drop the cached index and refetch — shared, so this costs one request. */
  refresh: () => void;
};

/**
 * An agent's `docs apply` lands many operations in a few milliseconds and
 * the graph projection behind them is rebuilt asynchronously. Coalesce, and
 * give the indexer a moment, rather than refetching per event.
 */
const INVALIDATE_DEBOUNCE_MS = 1_500;

/** Shared so `?? EMPTY` never hands back a fresh array. */
const EMPTY: VaultDocSummary[] = [];
const EMPTY_BY_ID: Map<string, VaultDocSummary> = new Map();

async function fetchIndex(driveId: string): Promise<IndexData> {
  const [graphRes, treeRes]: [unknown, unknown] = await Promise.all([
    fetch(resolveKnowledgeGraphEndpoint(), {
      method: "POST",
      headers: await authHeaders(),
      body: JSON.stringify({
        query: `query VaultIndex($driveId: ID!) {
          knowledgeGraphNodes(driveId: $driveId) { documentId title noteType }
        }`,
        variables: { driveId },
      }),
    }).then((r): Promise<unknown> | null => (r.ok ? (r.json() as Promise<unknown>) : null)),
    fetch(resolveReactorEndpoint(), {
      method: "POST",
      headers: await authHeaders(),
      body: JSON.stringify({
        query: `query VaultIndexTree($id: String!) {
          document(identifier: $id) { document { state } }
        }`,
        variables: { id: driveId },
      }),
    }).then((r): Promise<unknown> | null => (r.ok ? (r.json() as Promise<unknown>) : null)),
  ]);

  type GraphNode = {
    documentId: string;
    title: string | null;
    noteType: string | null;
  };
  const graphNodes: GraphNode[] =
    (graphRes as {
      data?: { knowledgeGraphNodes?: GraphNode[] };
    } | null)?.data?.knowledgeGraphNodes ?? [];
  const titleById = new Map(graphNodes.map((n) => [n.documentId, n] as const));

  let state = (
    treeRes as {
      data?: { document?: { document?: { state?: unknown } } };
    } | null
  )?.data?.document?.document?.state as
    | { global?: { nodes?: Array<Record<string, unknown>> } }
    | string
    | undefined;
  if (typeof state === "string") state = JSON.parse(state) as typeof state;
  const treeNodes =
    (typeof state === "object" ? state?.global?.nodes : undefined) ?? [];

  const all: VaultDocSummary[] = [];
  for (const node of treeNodes) {
    if (node.kind !== "file") continue;
    const id = node.id as string;
    const projected = titleById.get(id);
    all.push({
      id,
      title: projected?.title ?? (node.name as string) ?? id,
      documentType: (node.documentType as string) ?? "unknown",
      noteType: projected?.noteType ?? null,
    });
  }
  const knowledgeDocs = all.filter(
    (d) =>
      d.documentType === "bai/knowledge-note" || d.documentType === "bai/moc",
  );
  return { knowledgeDocs, all };
}

const store = createDocIndexStore({ fetch: fetchIndex, isLive: isVaultLive });

/**
 * One change-feed listener for the whole process, ref-counted by mounted
 * consumers — not one per hook instance, which would invalidate the shared
 * entry N times for one remote write.
 */
let remoteConsumers = 0;
let stopRemote: (() => void) | null = null;
const perDriveInvalidator = new Map<string, () => void>();

function attachRemoteListener(): void {
  remoteConsumers++;
  if (stopRemote) return;
  stopRemote = onVaultRemoteChange((change) => {
    if (!indexAffected(change)) return;
    let soon = perDriveInvalidator.get(change.driveId);
    if (!soon) {
      soon = debounced(
        () => store.invalidate(change.driveId),
        INVALIDATE_DEBOUNCE_MS,
      );
      perDriveInvalidator.set(change.driveId, soon);
    }
    soon();
  });
}

function detachRemoteListener(): void {
  remoteConsumers = Math.max(0, remoteConsumers - 1);
  if (remoteConsumers > 0) return;
  stopRemote?.();
  stopRemote = null;
  perDriveInvalidator.clear();
}

export function useVaultDocIndex(): VaultDocIndex {
  const driveId = useSelectedDriveId();
  // Keyed by drive so switching drives shows nothing rather than the
  // previous drive's titles, and so a settled-but-empty result is
  // distinguishable from "still loading".
  const [loaded, setLoaded] = useState<{
    driveId: string;
    data: IndexData | null;
  } | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    attachRemoteListener();
    return detachRemoteListener;
  }, []);

  // Re-read when the shared entry is dropped, by whichever consumer notices.
  useEffect(() => {
    if (!driveId) return;
    return store.subscribe(driveId, () => setTick((t) => t + 1));
  }, [driveId]);

  useEffect(() => {
    if (!driveId) return;
    let cancelled = false;
    store
      .read(driveId)
      .then((data) => {
        if (!cancelled) setLoaded({ driveId, data });
      })
      .catch(() => {
        // Keep whatever is on screen; mark settled only if we have nothing,
        // so `isLoading` cannot spin forever on a failing endpoint.
        if (!cancelled) {
          setLoaded((prev) =>
            prev?.driveId === driveId ? prev : { driveId, data: null },
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [driveId, tick]);

  const current = loaded?.driveId === driveId ? loaded : null;
  const data = current?.data ?? null;
  const isLoading = !!driveId && current === null;

  const byId = useMemo(() => {
    if (!data) return EMPTY_BY_ID;
    const map = new Map<string, VaultDocSummary>();
    for (const doc of data.all) map.set(doc.id, doc);
    return map;
  }, [data]);

  const refresh = useCallback(() => {
    if (driveId) store.invalidate(driveId);
  }, [driveId]);

  return useMemo(
    () => ({
      knowledgeDocs: data?.knowledgeDocs ?? EMPTY,
      byId,
      isLoading,
      refresh,
    }),
    [data, byId, isLoading, refresh],
  );
}
