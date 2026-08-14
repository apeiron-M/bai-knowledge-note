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
 */

let unavailableReason: string | null = null;

export async function embedQuery(text: string): Promise<number[] | null> {
  if (unavailableReason) return null;
  try {
    const { generateEmbedding } = await import(
      "../../../processors/graph-indexer/embedder.js"
    );
    return await generateEmbedding(text);
  } catch (err) {
    // Remember the failure so every search afterwards skips the model path
    // instantly instead of re-timing-out; a restart retries.
    unavailableReason = err instanceof Error ? err.message : String(err);
    console.warn(
      `[knowledgeGraph] query embedder unavailable, falling back to keyword search: ${unavailableReason}`,
    );
    return null;
  }
}
