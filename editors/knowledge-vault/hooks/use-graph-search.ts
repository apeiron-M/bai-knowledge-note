import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useSelectedDriveId } from "@powerhousedao/reactor-browser";
import { resolveKnowledgeGraphEndpoint } from "./subgraph-endpoint.js";
import { useEmbedder } from "./use-embedder.js";

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

const SEARCH_BY_EMBEDDING_QUERY = `
  query SearchByEmbedding($driveId: ID!, $query: String!, $embedding: [Float!]!, $mode: SearchMode!, $limit: Int) {
    knowledgeGraphSearchByEmbedding(driveId: $driveId, query: $query, embedding: $embedding, mode: $mode, limit: $limit) {
      node { documentId title description noteType status topics }
      similarity
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
  const { embed, error: embedderError } = useEmbedder();

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

  // Debounced search. Always runs hybrid (semantic + keyword fused)
  // when the embedder is available; falls back to keyword silently
  // if the embedder fails. Mode is no longer a user choice — hybrid
  // dominates both other strategies for typical "find me notes about X"
  // queries, and the keyword fallback handles the rare embedder-unavailable
  // case without breaking the search box.
  const executeSearch = useCallback(
    async (q: string) => {
      if (!driveId || !q.trim()) {
        setResults([]);
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      let embedding: number[] | null = null;
      if (!embedderError) {
        try {
          embedding = await embed(q);
        } catch {
          embedding = null;
        }
      }

      if (!embedding) {
        // Embedder unavailable — silent keyword fallback
        const data = await graphqlFetch<{
          knowledgeGraphFullSearch: SearchResult[];
        }>(endpoint, KEYWORD_SEARCH_QUERY, { driveId, query: q, limit: 20 });
        if (data?.knowledgeGraphFullSearch) {
          setResults(data.knowledgeGraphFullSearch);
        } else {
          setResults([]);
          setError("Search failed.");
        }
        setLoading(false);
        return;
      }

      const data = await graphqlFetch<{
        knowledgeGraphSearchByEmbedding: Array<{
          node: Omit<SearchResult, "similarity" | "matchedBy">;
          similarity: number;
        }>;
      }>(endpoint, SEARCH_BY_EMBEDDING_QUERY, {
        driveId,
        query: q,
        embedding,
        mode: "HYBRID",
        limit: 20,
      });

      if (data?.knowledgeGraphSearchByEmbedding) {
        setResults(
          data.knowledgeGraphSearchByEmbedding.map((r) => ({
            ...r.node,
            similarity: r.similarity,
          })),
        );
      } else {
        setResults([]);
        setError("Search failed.");
      }
      setLoading(false);
    },
    [driveId, endpoint, embed, embedderError],
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
