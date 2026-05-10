import { useEffect, useRef, useState } from "react";
import { useSelectedDriveId } from "@powerhousedao/reactor-browser";
import { useEmbedder } from "./use-embedder.js";
import { resolveKnowledgeGraphEndpoint } from "./subgraph-endpoint.js";

const MISSING_QUERY = `
  query Missing($driveId: ID!) {
    knowledgeGraphMissingEmbeddings(driveId: $driveId)
  }
`;

const NODE_QUERY = `
  query NodeText($driveId: ID!) {
    knowledgeGraphNodes(driveId: $driveId) {
      documentId title description
    }
  }
`;

const UPSERT_MUTATION = `
  mutation Upsert($documentId: ID!, $embedding: [Float!]!) {
    knowledgeGraphUpsertEmbedding(documentId: $documentId, embedding: $embedding) { ok }
  }
`;

const CONCURRENCY = 5;

async function gqlFetch<T>(
  endpoint: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<T | null> {
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { data?: T };
    return json.data ?? null;
  } catch {
    return null;
  }
}

function idle(): Promise<void> {
  return new Promise((resolve) => {
    type IdleCb = () => void;
    type Idle = (cb: IdleCb, opts?: { timeout?: number }) => number;
    const ric = (globalThis as unknown as { requestIdleCallback?: Idle })
      .requestIdleCallback;
    if (ric) ric(() => resolve(), { timeout: 200 });
    else setTimeout(() => resolve(), 16);
  });
}

export function useEmbeddingBackfill(): {
  total: number;
  done: number;
  running: boolean;
} {
  const driveId = useSelectedDriveId();
  const { ready, error, embed } = useEmbedder();
  const [progress, setProgress] = useState({
    total: 0,
    done: 0,
    running: false,
  });
  const startedRef = useRef<string | null>(null); // last drive we started for

  useEffect(() => {
    if (!driveId || !ready || error) return;
    if (startedRef.current === driveId) return;
    startedRef.current = driveId;

    let cancelled = false;
    void (async () => {
      const endpoint = resolveKnowledgeGraphEndpoint();

      const missingData = await gqlFetch<{
        knowledgeGraphMissingEmbeddings: string[];
      }>(endpoint, MISSING_QUERY, { driveId });
      const missing = missingData?.knowledgeGraphMissingEmbeddings ?? [];
      if (missing.length === 0) return;

      const nodesData = await gqlFetch<{
        knowledgeGraphNodes: Array<{
          documentId: string;
          title: string | null;
          description: string | null;
        }>;
      }>(endpoint, NODE_QUERY, { driveId });
      const byId = new Map<
        string,
        { title: string | null; description: string | null }
      >();
      for (const n of nodesData?.knowledgeGraphNodes ?? [])
        byId.set(n.documentId, n);

      const targets = missing.filter((id) => byId.has(id));
      if (cancelled) return;

      setProgress({ total: targets.length, done: 0, running: true });

      let next = 0;
      let done = 0;
      const workers = Array.from(
        { length: Math.min(CONCURRENCY, targets.length) },
        async () => {
          for (;;) {
            if (cancelled) return;
            const i = next++;
            if (i >= targets.length) return;
            const id = targets[i];
            const meta = byId.get(id);
            const text = [meta?.title, meta?.description]
              .filter(Boolean)
              .join(" ")
              .trim();
            if (!text) {
              done++;
              setProgress((p) => ({ ...p, done }));
              continue;
            }

            await idle();
            try {
              const v = await embed(text);
              if (cancelled) return;
              await gqlFetch(endpoint, UPSERT_MUTATION, {
                documentId: id,
                embedding: v,
              });
            } catch {
              // skip on error; can retry next session
            }
            done++;
            setProgress((p) => ({ ...p, done }));
          }
        },
      );
      await Promise.all(workers);
      if (!cancelled) setProgress((p) => ({ ...p, running: false }));
    })();

    return () => {
      cancelled = true;
    };
  }, [driveId, ready, error, embed]);

  return progress;
}
