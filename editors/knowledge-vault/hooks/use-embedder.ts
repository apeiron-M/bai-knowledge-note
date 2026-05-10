import { useState, useEffect, useCallback } from "react";
import { generateEmbedding } from "../../../processors/graph-indexer/embedder.js";

/**
 * Browser-side embedder.
 *
 * Loads @huggingface/transformers + the gte-small ONNX model on first
 * call (~50 MB cached after first load). Subsequent embeds are <100ms
 * for typical query strings.
 *
 * Module-level cache so multiple consumers share one warm pipeline.
 */
type EmbedFn = (text: string) => Promise<number[]>;
type EmbedderState = {
  ready: boolean;
  error: Error | null;
};

let warming: Promise<void> | null = null;
let cachedReady = false;
let cachedError: Error | null = null;
const subscribers = new Set<(s: EmbedderState) => void>();

function broadcast() {
  const state = { ready: cachedReady, error: cachedError };
  for (const sub of subscribers) sub(state);
}

function startWarmup(): Promise<void> {
  if (warming) return warming;
  warming = generateEmbedding("warm")
    .then(() => {
      cachedReady = true;
      broadcast();
    })
    .catch((err: unknown) => {
      const e = err instanceof Error ? err : new Error(String(err));
      cachedError = e;
      broadcast();
    });
  return warming;
}

export function useEmbedder(): {
  ready: boolean;
  error: Error | null;
  embed: EmbedFn;
} {
  const [state, setState] = useState<EmbedderState>({
    ready: cachedReady,
    error: cachedError,
  });

  useEffect(() => {
    subscribers.add(setState);
    if (!cachedReady && !cachedError) {
      void startWarmup();
    }
    return () => {
      subscribers.delete(setState);
    };
  }, []);

  const embed = useCallback<EmbedFn>(async (text) => {
    if (cachedError) throw cachedError;
    if (!cachedReady) await startWarmup();
    // Re-read after await — cachedError may have been set during warmup.
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    if (cachedError) throw cachedError;
    return generateEmbedding(text);
  }, []);

  return { ready: state.ready, error: state.error, embed };
}
