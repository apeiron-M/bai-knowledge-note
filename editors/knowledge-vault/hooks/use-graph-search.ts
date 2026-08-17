import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useSelectedDriveId } from "@powerhousedao/reactor-browser";
import { resolveKnowledgeGraphEndpoint } from "./subgraph-endpoint.js";

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

export type SearchResult = {
  documentId: string;
  title: string | null;
  description: string | null;
  noteType: string | null;
  status: string | null;
  topics: string[];
  similarity?: number;
  matchedBy?: string[];
};

export type TopicInfo = {
  name: string;
  noteCount: number;
};

/* ------------------------------------------------------------------ */
/*  GraphQL helpers                                                   */
/* ------------------------------------------------------------------ */

const DEBOUNCE_MS = 300;

async function graphqlFetch<T>(
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
    const json = (await res.json()) as { data?: T; errors?: unknown[] };
    if (json.errors) {
      console.warn("[useGraphSearch] GraphQL errors:", json.errors);
    }
    return json.data ?? null;
  } catch (err) {
    console.warn("[useGraphSearch] Fetch failed:", err);
    return null;
  }
}

/* ------------------------------------------------------------------ */
/*  Queries                                                           */
/* ------------------------------------------------------------------ */

// The query is embedded SERVER-side — the browser never loads the model.
// This resolver degrades to keyword search internally when the server's
// embedder or the drive's embeddings are unavailable, so one call covers
// every deployment state.
const SEMANTIC_SEARCH_QUERY = `
  query SemanticSearch($driveId: ID!, $query: String!, $limit: Int) {
    knowledgeGraphSemanticSearch(driveId: $driveId, query: $query, mode: HYBRID, limit: $limit) {
      node { documentId title description noteType status topics }
      similarity
      matchedBy
    }
  }
`;

const KEYWORD_SEARCH_QUERY = `
  query FullSearch($driveId: ID!, $query: String!, $limit: Int) {
    knowledgeGraphFullSearch(driveId: $driveId, query: $query, limit: $limit) {
      documentId title description noteType status topics
    }
  }
`;

const TOPICS_QUERY = `
  query Topics($driveId: ID!) {
    knowledgeGraphTopics(driveId: $driveId) { name noteCount }
  }
`;

/* ------------------------------------------------------------------ */
/*  Hook                                                              */
/* ------------------------------------------------------------------ */

const STORAGE_KEY = "bai-search-state";

function loadSearchState(): { query: string } {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { query?: string };
      return { query: parsed.query ?? "" };
    }
  } catch {
    // ignore
  }
  return { query: "" };
}

function saveSearchState(query: string): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ query }));
  } catch {
    // ignore
  }
}

export function useGraphSearch() {
  const driveId = useSelectedDriveId();
  const saved = useRef(loadSearchState());
  const [query, setQueryRaw] = useState(saved.current.query);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [topics, setTopics] = useState<TopicInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const endpoint = useMemo(() => resolveKnowledgeGraphEndpoint(), []);

  // Persist query to sessionStorage
  const setQuery = useCallback((q: string) => {
    setQueryRaw(q);
    saveSearchState(q);
  }, []);

  // Fetch topics on mount for empty-state overview
  useEffect(() => {
    if (!driveId) return;
    void graphqlFetch<{ knowledgeGraphTopics: TopicInfo[] }>(
      endpoint,
      TOPICS_QUERY,
      { driveId },
    ).then((data) => {
      if (data?.knowledgeGraphTopics) {
        setTopics(data.knowledgeGraphTopics);
      }
    });
  }, [driveId, endpoint]);

  // Debounced search. One server call: knowledgeGraphSemanticSearch embeds
  // the query on the Switchboard (hybrid semantic+keyword fusion) and itself
  // degrades to keyword search when embeddings are unavailable. The browser
  // never loads the embedding model. The client-side keyword fallback below
  // only covers deployments too old to have the semanticSearch field.
  const executeSearch = useCallback(
    async (q: string) => {
      if (!driveId || !q.trim()) {
        setResults([]);
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      const data = await graphqlFetch<{
        knowledgeGraphSemanticSearch: Array<{
          node: Omit<SearchResult, "similarity" | "matchedBy">;
          similarity: number;
          matchedBy: string[];
        }>;
      }>(endpoint, SEMANTIC_SEARCH_QUERY, { driveId, query: q, limit: 20 });

      if (data?.knowledgeGraphSemanticSearch) {
        setResults(
          data.knowledgeGraphSemanticSearch.map((r) => ({
            ...r.node,
            // Already a 0..1 relevance for every mode — the server rescales
            // its fused rank score before returning it.
            similarity: r.similarity,
            matchedBy: r.matchedBy,
          })),
        );
        setLoading(false);
        return;
      }

      // Older deployment without the field — keyword fallback.
      const kw = await graphqlFetch<{
        knowledgeGraphFullSearch: SearchResult[];
      }>(endpoint, KEYWORD_SEARCH_QUERY, { driveId, query: q, limit: 20 });
      if (kw?.knowledgeGraphFullSearch) {
        setResults(kw.knowledgeGraphFullSearch);
      } else {
        setResults([]);
        setError("Search failed.");
      }
      setLoading(false);
    },
    [driveId, endpoint],
  );

  // Trigger debounced search on query change
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!query.trim()) {
      setResults([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    debounceRef.current = setTimeout(() => {
      void executeSearch(query);
    }, DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, executeSearch]);

  return {
    query,
    setQuery,
    results,
    topics,
    loading,
    error,
  };
}
