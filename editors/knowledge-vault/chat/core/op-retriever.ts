// v1 only (leaves the graph in M1; deleted in M3). `tokenize`,
// `retrievalText` and `RetrievedOp` moved to nl-runtime (core/op-retriever).
import {
  type CatalogEntry,
  retrievalText,
  type RetrievedOp,
  tokenize,
} from "nl-runtime";

export { retrievalText, type RetrievedOp, tokenize } from "nl-runtime";

export interface RetrieveOptions {
  k?: number;
  /** Restrict candidates to one document type (the selected document's). */
  docType?: string;
}

export interface OpRetriever {
  retrieve(query: string, opts?: RetrieveOptions): RetrievedOp[];
  /** The text each op is indexed under (for debugging / the results file). */
  indexText(key: string): string | undefined;
}

export interface RetrieverOptions {
  /** Extra retrieval text per op key, e.g. synonyms. */
  extraText?: Record<string, string>;
  k1?: number;
  b?: number;
}

/** In-memory BM25 over the op catalog. Local-scope ops are excluded. */
export function createOpRetriever(
  catalog: CatalogEntry[],
  options: RetrieverOptions = {},
): OpRetriever {
  const k1 = options.k1 ?? 1.2;
  const b = options.b ?? 0.75;
  const docs = catalog
    .filter((e) => e.scope === "global")
    .map((entry) => {
      const text = retrievalText(entry, options.extraText);
      const tokens = tokenize(text);
      const tf = new Map<string, number>();
      for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
      return { entry, text, tf, len: tokens.length };
    });
  const df = new Map<string, number>();
  for (const d of docs)
    for (const t of d.tf.keys()) df.set(t, (df.get(t) ?? 0) + 1);
  const avgLen = docs.reduce((s, d) => s + d.len, 0) / Math.max(docs.length, 1);
  const n = docs.length;

  function idf(term: string): number {
    const f = df.get(term) ?? 0;
    return Math.log(1 + (n - f + 0.5) / (f + 0.5));
  }

  return {
    retrieve(query, opts = {}) {
      const k = opts.k ?? 5;
      const terms = [...new Set(tokenize(query))];
      const scored: RetrievedOp[] = [];
      for (const d of docs) {
        if (opts.docType && d.entry.docType !== opts.docType) continue;
        let score = 0;
        for (const t of terms) {
          const f = d.tf.get(t);
          if (!f) continue;
          score +=
            (idf(t) * f * (k1 + 1)) / (f + k1 * (1 - b + (b * d.len) / avgLen));
        }
        scored.push({ entry: d.entry, score });
      }
      // Stable order for ties: catalog order.
      return scored
        .map((s, i) => ({ s, i }))
        .sort((x, y) => y.s.score - x.s.score || x.i - y.i)
        .slice(0, k)
        .map(({ s }) => s);
    },
    indexText(key) {
      return docs.find((d) => d.entry.key === key)?.text;
    },
  };
}
