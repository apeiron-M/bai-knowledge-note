/**
 * Server-side query embedding for the knowledgeGraph subgraph.
 *
 * Thin wrapper over the graph-indexer's shared embedder (the same instance
 * that embeds documents in the processor), so queries and documents are
 * guaranteed to use the same model, quantization and runtime — and the model
 * is only ever loaded once per process. Measured: ~500ms one-time load,
 * 12–26ms per query.
 *
 * This exists so the BROWSER never has to load the model: Connect sends the
 * plain query text and the Switchboard does the embedding. Returns null on
 * any failure (missing model files, no network for a hub fallback) — callers
 * degrade to keyword search rather than erroring, because a search box must
 * never be the thing that breaks.
 *
 * Failure is remembered so that the next search does not pay the same
 * timeout again, but it EXPIRES. It used to latch for the life of the
 * process: one failure — including a transient one inside a single
 * `generateEmbedding` call — permanently downgraded semantic search to
 * keyword for every drive on the host until someone restarted it. The
 * embedder is a process-wide singleton, so a genuinely missing model does
 * affect everyone, and backing off further each time keeps that case cheap;
 * but a blip must not be indistinguishable from it.
 */

/** First cooldown after a failure. */
export const EMBEDDER_RETRY_BASE_MS = 30_000;
/** Ceiling on the doubling, so a permanently missing model settles here. */
export const EMBEDDER_RETRY_MAX_MS = 15 * 60_000;

type Health = {
  reason: string;
  /** Epoch ms before which the model path is skipped. */
  until: number;
  /** Consecutive failures, for the backoff. */
  failures: number;
};

let health: Health | null = null;

/** Test seam: forget any recorded failure. */
export function resetQueryEmbedderHealth(): void {
  health = null;
}

/**
 * How long the model path stays skipped after `failures` consecutive
 * failures: 30s, 1m, 2m, 4m … capped at 15m.
 */
function backoffFor(failures: number): number {
  const grown = EMBEDDER_RETRY_BASE_MS * 2 ** (failures - 1);
  return Math.min(grown, EMBEDDER_RETRY_MAX_MS);
}

export async function embedQuery(
  text: string,
  now: () => number = Date.now,
): Promise<number[] | null> {
  const at = now();
  if (health && at < health.until) return null;
  try {
    const { generateEmbedding } = await import(
      "../../../processors/graph-indexer/embedder.js"
    );
    const embedding = await generateEmbedding(text);
    // Recovered: drop the backoff so the next failure starts from the
    // shortest cooldown rather than wherever the last streak ended.
    health = null;
    return embedding;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    const failures = (health?.failures ?? 0) + 1;
    const wait = backoffFor(failures);
    health = { reason, until: at + wait, failures };
    // One line per ATTEMPT, and attempts are one per cooldown — so this is
    // bounded however long the outage lasts, and it says when it will retry
    // rather than implying a restart is needed.
    console.warn(
      `[knowledgeGraph] query embedder unavailable (attempt ${failures}), ` +
        `falling back to keyword search; retrying in ${Math.round(wait / 1000)}s: ${reason}`,
    );
    return null;
  }
}
