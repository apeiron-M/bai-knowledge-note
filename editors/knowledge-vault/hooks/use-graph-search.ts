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

export type SearchMode = "hybrid" | "semantic" | "keyword";

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

function loadSearchState(): { query: string; mode: SearchMode } {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { query?: string; mode?: string };
      return {
        query: parsed.query ?? "",
        mode: "hybrid",
      };
    }
  } catch {
    // ignore
  }
  return { query: "", mode: "semantic" };
}

function saveSearchState(query: string, mode: SearchMode): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ query, mode }));
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
  const [searchMode, setSearchModeRaw] = useState<SearchMode>(
    saved.current.mode,
  );
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const endpoint = useMemo(() => resolveKnowledgeGraphEndpoint(), []);
  const { embed, error: embedderError } = useEmbedder();

  // Persist query and mode to sessionStorage
  const setQuery = useCallback(
    (q: string) => {
      setQueryRaw(q);
      saveSearchState(q, searchMode);
    },
    [searchMode],
  );

  const setSearchMode = useCallback(
    (m: SearchMode) => {
      setSearchModeRaw(m);
      saveSearchState(query, m);
    },
    [query],
  );

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

  // Debounced search
  const executeSearch = useCallback(
    async (q: string, mode: SearchMode) => {
      if (!driveId || !q.trim()) {
        setResults([]);
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      if (mode === "hybrid" || mode === "semantic") {
        // Embed the query in-browser; fall back to keyword if embedder unavailable
        let embedding: number[] | null = null;
        if (!embedderError) {
          try {
            embedding = await embed(q);
          } catch {
            embedding = null;
          }
        }

        if (!embedding) {
          // Embedder unavailable — fall back to keyword silently
          const data = await graphqlFetch<{
            knowledgeGraphFullSearch: SearchResult[];
          }>(endpoint, KEYWORD_SEARCH_QUERY, { driveId, query: q, limit: 20 });
          if (data?.knowledgeGraphFullSearch) {
            setResults(data.knowledgeGraphFullSearch);
          } else {
            setResults([]);
            setError("Search failed.");
          }
        } else {
          const apiMode = mode === "semantic" ? "SEMANTIC" : "HYBRID";
          const data = await graphqlFetch<{
            knowledgeGraphSearchByEmbedding: Array<{
              node: Omit<SearchResult, "similarity" | "matchedBy">;
              similarity: number;
            }>;
          }>(endpoint, SEARCH_BY_EMBEDDING_QUERY, {
            driveId,
            query: q,
            embedding,
            mode: apiMode,
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
            setError(
              mode === "semantic"
                ? "Semantic search unavailable. Try keyword mode."
                : "Hybrid search unavailable. Try keyword mode.",
            );
          }
        }
      } else {
        const data = await graphqlFetch<{
          knowledgeGraphFullSearch: SearchResult[];
        }>(endpoint, KEYWORD_SEARCH_QUERY, { driveId, query: q, limit: 20 });

        if (data?.knowledgeGraphFullSearch) {
          setResults(data.knowledgeGraphFullSearch);
        } else {
          setResults([]);
          setError("Search failed.");
        }
      }

      setLoading(false);
    },
    [driveId, endpoint, embed, embedderError],
  );

  // Trigger debounced search on query or mode change
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!query.trim()) {
      setResults([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    debounceRef.current = setTimeout(() => {
      void executeSearch(query, searchMode);
    }, DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, searchMode, executeSearch]);

  return {
    query,
    setQuery,
    results,
    topics,
    loading,
    error,
    searchMode,
    setSearchMode,
  };
}
