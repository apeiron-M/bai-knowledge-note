import { useState } from "react";
import { setSelectedNode } from "@powerhousedao/reactor-browser";
import {
  useGraphSearch,
  type SearchResult,
  type TopicInfo,
} from "../hooks/use-graph-search.js";
import type { CSSProperties } from "react";

/* ------------------------------------------------------------------ */
/*  Constants                                                         */
/* ------------------------------------------------------------------ */

const STATUS_COLORS: Record<string, CSSProperties> = {
  DRAFT: {
    background: "rgba(245, 158, 11, 0.2)",
    color: "rgba(252, 211, 77, 1)",
    borderColor: "rgba(245, 158, 11, 0.3)",
  },
  IN_REVIEW: {
    background: "rgba(59, 130, 246, 0.2)",
    color: "rgba(147, 197, 253, 1)",
    borderColor: "rgba(59, 130, 246, 0.3)",
  },
  CANONICAL: {
    background: "rgba(16, 185, 129, 0.2)",
    color: "rgba(110, 231, 183, 1)",
    borderColor: "rgba(16, 185, 129, 0.3)",
  },
  ARCHIVED: {
    background: "var(--bai-hover)",
    color: "var(--bai-text-muted)",
    borderColor: "var(--bai-border)",
  },
};

function similarityColor(score: number): string {
  if (score >= 0.8) return "#10b981";
  if (score >= 0.6) return "#f59e0b";
  return "#6b7280";
}

/* ------------------------------------------------------------------ */
/*  Component                                                         */
/* ------------------------------------------------------------------ */

export function SearchView() {
  const { query, setQuery, results, topics, loading, error } = useGraphSearch();

  return (
    <div className="flex h-full flex-col p-4">
      {/* Search bar */}
      <div className="mb-4 flex items-center gap-3">
        <div
          className="relative flex-1"
          style={{ color: "var(--bai-text-muted)" }}
        >
          <svg
            className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
          </svg>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search knowledge vault..."
            className="w-full rounded-lg border py-2.5 pl-10 pr-10 text-sm outline-none transition-colors"
            style={{
              backgroundColor: "var(--bai-surface)",
              borderColor: "var(--bai-border)",
              color: "var(--bai-text)",
            }}
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-0.5 transition-colors hover:opacity-80"
              style={{ color: "var(--bai-text-muted)" }}
            >
              <svg
                className="h-4 w-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Status line */}
      {query.trim() && (
        <div
          className="mb-3 flex items-center gap-2 text-xs"
          style={{ color: "var(--bai-text-muted)" }}
        >
          {loading ? (
            <span>Searching...</span>
          ) : (
            <>
              <span>
                {results.length} result{results.length !== 1 ? "s" : ""}
              </span>
              {results.length > 0 && (
                <span style={{ opacity: 0.6 }}>
                  — relevance combines meaning + keyword match
                </span>
              )}
            </>
          )}
          {error && <span style={{ color: "#ef4444" }}>{error}</span>}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {!query.trim() ? (
          <EmptyState topics={topics} onTopicClick={setQuery} />
        ) : (
          <ResultList results={results} />
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Empty state                                                       */
/* ------------------------------------------------------------------ */

function EmptyState({
  topics,
  onTopicClick,
}: {
  topics: TopicInfo[];
  onTopicClick: (topic: string) => void;
}) {
  const [showTopics, setShowTopics] = useState(false);

  return (
    <div className="flex flex-col items-center pt-16">
      {/* Search icon */}
      <svg
        className="mb-4 h-12 w-12"
        style={{ color: "var(--bai-text-faint)", opacity: 0.5 }}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      >
        <circle cx="11" cy="11" r="8" />
        <path d="m21 21-4.35-4.35" />
      </svg>

      <h2
        className="mb-2 text-lg font-semibold"
        style={{ color: "var(--bai-text)" }}
      >
        Search the Knowledge Vault
      </h2>
      <p
        className="mb-6 max-w-md text-center text-sm leading-relaxed"
        style={{ color: "var(--bai-text-muted)" }}
      >
        Ask a question in natural language or type keywords. Semantic search
        understands meaning — try "how does storage work?" or "legal setup for
        organizations".
      </p>

      {/* Explore topics button */}
      {topics.length > 0 && (
        <div className="flex flex-col items-center">
          <button
            type="button"
            onClick={() => setShowTopics((s) => !s)}
            className="mb-4 rounded-lg border px-5 py-2.5 text-sm font-medium transition-colors"
            style={{
              borderColor: "var(--bai-border)",
              color: "var(--bai-accent)",
              backgroundColor: "var(--bai-surface)",
            }}
          >
            {showTopics ? "Hide Topics" : `Explore ${topics.length} Topics`}
          </button>

          {showTopics && (
            <div className="max-w-2xl">
              <div className="flex flex-wrap justify-center gap-2">
                {topics.map((t) => (
                  <button
                    key={t.name}
                    type="button"
                    onClick={() => onTopicClick(t.name)}
                    className="rounded-full px-3 py-1.5 text-xs transition-colors"
                    style={{
                      backgroundColor: "var(--bai-hover)",
                      color: "var(--bai-accent)",
                    }}
                  >
                    {t.name}
                    <span
                      className="ml-1.5 opacity-50"
                      style={{ color: "var(--bai-text-muted)" }}
                    >
                      {t.noteCount}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Result list                                                       */
/* ------------------------------------------------------------------ */

function ResultList({ results }: { results: SearchResult[] }) {
  if (results.length === 0) {
    return (
      <div
        className="py-12 text-center text-sm"
        style={{ color: "var(--bai-text-muted)" }}
      >
        No results found
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {results.map((result) => (
        <ResultCard
          key={result.documentId}
          result={result}
          showSimilarity={typeof result.similarity === "number"}
        />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Result card                                                       */
/* ------------------------------------------------------------------ */

function ResultCard({
  result,
  showSimilarity,
}: {
  result: SearchResult;
  showSimilarity: boolean;
}) {
  const status = result.status ?? "DRAFT";
  const badgeStyle = STATUS_COLORS[status] ?? STATUS_COLORS.DRAFT;

  return (
    <button
      type="button"
      onClick={() => setSelectedNode(result.documentId)}
      className="group flex w-full items-start gap-3 rounded-xl border p-4 text-left transition-all border-[var(--bai-border)] bg-[var(--bai-surface)] hover:border-[var(--bai-accent)] hover:bg-[var(--bai-hover)]"
    >
      {/* Similarity score */}
      {showSimilarity && result.similarity != null && (
        <div
          className="shrink-0 rounded-md px-2 py-1 text-center font-mono text-xs font-bold"
          title="Relevance score — how closely this note matches your query (higher is better)"
          style={{
            color: similarityColor(result.similarity),
            backgroundColor: `${similarityColor(result.similarity)}15`,
          }}
        >
          {(result.similarity * 100).toFixed(0)}%
        </div>
      )}

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-start justify-between gap-2">
          <h4 className="truncate text-sm font-semibold text-[var(--bai-text)] group-hover:text-[var(--bai-accent)]">
            {result.title ?? "Untitled"}
          </h4>
          <span
            className="shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium"
            style={badgeStyle}
          >
            {status.replace("_", " ")}
          </span>
        </div>

        {result.description && (
          <p
            className="mb-2 line-clamp-2 text-xs leading-relaxed"
            style={{ color: "var(--bai-text-muted)" }}
          >
            {result.description}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-1.5">
          {result.noteType && (
            <span
              className="rounded px-1.5 py-0.5 text-[10px] font-medium"
              style={{
                background: "var(--bai-hover)",
                color: "var(--bai-text-muted)",
              }}
            >
              {result.noteType}
            </span>
          )}
          {result.topics?.slice(0, 4).map((topic) => (
            <span
              key={topic}
              className="text-[10px]"
              style={{ color: "var(--bai-accent)", opacity: 0.6 }}
            >
              #{topic}
            </span>
          ))}
          {result.matchedBy && result.matchedBy.length > 0 && (
            <span className="ml-auto flex gap-1">
              {result.matchedBy.map((m) => (
                <span
                  key={m}
                  className="rounded px-1.5 py-0.5 text-[9px] font-medium"
                  style={{
                    background:
                      m === "semantic"
                        ? "rgba(139, 92, 246, 0.15)"
                        : "rgba(59, 130, 246, 0.15)",
                    color:
                      m === "semantic"
                        ? "rgba(167, 139, 250, 1)"
                        : "rgba(147, 197, 253, 1)",
                  }}
                >
                  {m}
                </span>
              ))}
            </span>
          )}
        </div>
      </div>

      {/* Navigate arrow */}
      <svg
        className="mt-1 h-4 w-4 shrink-0 opacity-0 transition-opacity group-hover:opacity-60"
        style={{ color: "var(--bai-text-muted)" }}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <path d="M9 18l6-6-6-6" />
      </svg>
    </button>
  );
}
