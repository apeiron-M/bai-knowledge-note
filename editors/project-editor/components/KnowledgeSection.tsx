import { useMemo, useState } from "react";
import { setSelectedNode } from "@powerhousedao/reactor-browser";
import { useVaultDocIndex } from "../../shared/use-vault-doc-index.js";
import type { DocumentDispatch } from "@powerhousedao/reactor-browser";
import { actions } from "document-models/project";
import type {
  ProjectAction,
  ProjectGlobalState,
} from "document-models/project";

type Dispatch = DocumentDispatch<ProjectAction>;

// Candidate documents for linking are knowledge notes and MOCs,
// served by the lightweight vault doc index (subgraph + drive tree)
// rather than full-state loads of the whole drive.
const MAX_RESULTS = 8;

type KnowledgeSectionProps = {
  state: ProjectGlobalState;
  dispatch: Dispatch;
};

export function KnowledgeSection({ state, dispatch }: KnowledgeSectionProps) {
  const { knowledgeDocs, byId } = useVaultDocIndex();
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);

  const titleById = useMemo(() => {
    const map = new Map<string, string>();
    for (const d of byId.values()) map.set(d.id, d.title);
    return map;
  }, [byId]);

  const candidates = knowledgeDocs;

  const linkedSet = useMemo(
    () => new Set(state.knowledgeRefs),
    [state.knowledgeRefs],
  );

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return candidates
      .filter((d) => d.title.toLowerCase().includes(q))
      .slice(0, MAX_RESULTS)
      .map((d) => ({
        id: d.id,
        title: d.title,
        alreadyLinked: linkedSet.has(d.id),
      }));
  }, [candidates, query, linkedSet]);

  function handlePick(id: string) {
    dispatch(actions.addKnowledgeRef({ ref: id }));
    setQuery("");
    setAdding(false);
  }

  return (
    <div
      className="rounded-xl p-5"
      style={{
        backgroundColor: "var(--bai-surface)",
        border: "1px solid var(--bai-border)",
      }}
    >
      <h3
        className="mb-3 text-xs font-semibold uppercase tracking-wider"
        style={{ color: "var(--bai-text-muted)" }}
      >
        Knowledge ({state.knowledgeRefs.length})
      </h3>

      {state.knowledgeRefs.length > 0 && (
        <div className="mb-2 space-y-1">
          {state.knowledgeRefs.map((ref) => (
            <KnowledgeRow
              key={ref}
              refId={ref}
              title={titleById.get(ref) ?? null}
              dispatch={dispatch}
            />
          ))}
        </div>
      )}

      {adding ? (
        <div className="space-y-1.5">
          <input
            autoFocus
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setAdding(false);
                setQuery("");
              }
            }}
            placeholder="Search notes and MOCs by title..."
            className="w-full rounded-md px-2 py-1 text-xs outline-none"
            style={{
              backgroundColor: "var(--bai-bg)",
              color: "var(--bai-text-secondary)",
              border: "1px solid var(--bai-border)",
            }}
          />
          {query.trim() && (
            <div
              className="max-h-48 space-y-0.5 overflow-y-auto rounded-lg p-1"
              style={{ border: "1px solid var(--bai-border)" }}
            >
              {results.length === 0 ? (
                <p
                  className="px-2 py-1.5 text-xs"
                  style={{ color: "var(--bai-text-faint)" }}
                >
                  No matches
                </p>
              ) : (
                results.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    disabled={r.alreadyLinked}
                    onClick={() => handlePick(r.id)}
                    className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-white/5 disabled:opacity-40"
                    style={{ color: "var(--bai-text-secondary)" }}
                  >
                    <span className="min-w-0 flex-1 truncate">{r.title}</span>
                    {r.alreadyLinked && (
                      <span
                        className="shrink-0 text-[10px]"
                        style={{ color: "var(--bai-text-faint)" }}
                      >
                        Linked
                      </span>
                    )}
                  </button>
                ))
              )}
            </div>
          )}
          <button
            type="button"
            onClick={() => {
              setAdding(false);
              setQuery("");
            }}
            className="text-xs"
            style={{ color: "var(--bai-text-faint)" }}
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="flex w-full items-center gap-1.5 rounded-lg px-3 py-2 text-xs transition-colors hover:bg-white/5"
          style={{
            color: "var(--bai-text-faint)",
            border: "1px dashed var(--bai-border)",
          }}
        >
          <svg
            className="h-3 w-3"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
          Link knowledge
        </button>
      )}
    </div>
  );
}

function KnowledgeRow({
  refId,
  title,
  dispatch,
}: {
  refId: string;
  title: string | null;
  dispatch: Dispatch;
}) {
  return (
    <div
      className="group flex items-center gap-2 rounded-lg px-3 py-1.5"
      style={{
        backgroundColor: "var(--bai-bg)",
        border: "1px solid var(--bai-border)",
      }}
    >
      <button
        type="button"
        onClick={() => setSelectedNode(refId)}
        className="min-w-0 flex-1 truncate text-left text-sm hover:underline"
        style={{ color: "var(--bai-text-secondary)" }}
      >
        {title ?? <span className="font-mono text-[10px]">{refId}</span>}
      </button>
      <button
        type="button"
        onClick={() => dispatch(actions.removeKnowledgeRef({ ref: refId }))}
        className="shrink-0 rounded p-1 opacity-0 transition-all hover:bg-red-500/10 hover:text-red-400 group-hover:opacity-100"
        style={{ color: "var(--bai-text-faint)" }}
        title="Unlink"
      >
        <svg
          className="h-3.5 w-3.5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M18 6L6 18M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}
