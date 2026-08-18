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
 * Results are cached module-level per drive with a short TTL and shared
 * across every consumer, so opening five editors costs the same two
 * requests as opening one.
 */
import { useEffect, useMemo, useState } from "react";
import { useSelectedDriveId } from "@powerhousedao/reactor-browser";
import {
  resolveKnowledgeGraphEndpoint,
  resolveReactorEndpoint,
} from "./subgraph-endpoint.js";

export type VaultDocSummary = {
  id: string;
  /** Best-known title: subgraph title, else the drive-tree node name. */
  title: string;
  documentType: string;
  noteType: string | null;
};

export type VaultDocIndex = {
  /** Knowledge-notes and MoCs with real titles — picker material. */
  knowledgeDocs: VaultDocSummary[];
  /** Every document in the drive, by id. */
  byId: Map<string, VaultDocSummary>;
  isLoading: boolean;
  refresh: () => void;
};

const TTL_MS = 30_000;

type CacheEntry = {
  at: number;
  promise: Promise<{ knowledgeDocs: VaultDocSummary[]; all: VaultDocSummary[] }>;
};

const cache = new Map<string, CacheEntry>();

async function fetchIndex(
  driveId: string,
): Promise<{ knowledgeDocs: VaultDocSummary[]; all: VaultDocSummary[] }> {
  const [graphRes, treeRes]: [unknown, unknown] = await Promise.all([
    fetch(resolveKnowledgeGraphEndpoint(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: `query VaultIndex($driveId: ID!) {
          knowledgeGraphNodes(driveId: $driveId) { documentId title noteType }
        }`,
        variables: { driveId },
      }),
    }).then((r): Promise<unknown> | null => (r.ok ? (r.json() as Promise<unknown>) : null)),
    fetch(resolveReactorEndpoint(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
  const titleById = new Map(
    graphNodes.map((n) => [n.documentId, n] as const),
  );

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

function readCached(driveId: string, force: boolean): CacheEntry {
  const existing = cache.get(driveId);
  if (existing && !force && Date.now() - existing.at < TTL_MS) return existing;
  const entry: CacheEntry = { at: Date.now(), promise: fetchIndex(driveId) };
  // A failed fetch must not poison the cache for the TTL window.
  entry.promise.catch(() => {
    if (cache.get(driveId) === entry) cache.delete(driveId);
  });
  cache.set(driveId, entry);
  return entry;
}

export function useVaultDocIndex(): VaultDocIndex {
  const driveId = useSelectedDriveId();
  const [data, setData] = useState<{
    knowledgeDocs: VaultDocSummary[];
    all: VaultDocSummary[];
  } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!driveId) return;
    let cancelled = false;
    setIsLoading(true);
    readCached(driveId, tick > 0)
      .promise.then((result) => {
        if (!cancelled) setData(result);
      })
      .catch(() => {
        /* stale data (if any) stays on screen; next tick retries */
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [driveId, tick]);

  const byId = useMemo(
    () => new Map((data?.all ?? []).map((d) => [d.id, d] as const)),
    [data],
  );

  return {
    knowledgeDocs: data?.knowledgeDocs ?? [],
    byId,
    isLoading,
    refresh: () => setTick((t) => t + 1),
  };
}
