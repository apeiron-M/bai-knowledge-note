import { useState } from "react";
import { DocumentToolbar } from "@powerhousedao/design-system/connect";
import {
  useSelectedObservationDocument,
  actions,
} from "@powerhousedao/knowledge-note/document-models/observation";
import { MarkdownPreview } from "../shared/markdown-preview.js";
import { TOOLBAR_CLASS } from "../shared/theme-context.js";

const CATEGORIES = [
  "METHODOLOGY",
  "PROCESS",
  "FRICTION",
  "SURPRISE",
  "QUALITY",
] as const;
const CAT_COLORS: Record<string, string> = {
  METHODOLOGY: "bg-purple-500/20 text-purple-300",
  PROCESS: "bg-blue-500/20 text-blue-300",
  FRICTION: "bg-amber-500/20 text-amber-300",
  SURPRISE: "bg-cyan-500/20 text-cyan-300",
  QUALITY: "bg-emerald-500/20 text-emerald-300",
};
const STATUS_COLORS: Record<string, string> = {
  PENDING: "bg-amber-500/20 text-amber-300 border-amber-500/30",
  PROMOTED: "bg-blue-500/20 text-blue-300 border-blue-500/30",
  IMPLEMENTED: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
  ARCHIVED: "bg-gray-500/20 text-gray-400 border-gray-500/30",
};
function ts() {
  return new Date().toISOString();
}

export default function Editor() {
  const [document, dispatch] = useSelectedObservationDocument();
  const state = document.state.global;
  const initialized = !!state.title;

  if (!initialized) {
    return <CreateForm dispatch={dispatch} />;
  }

  return (
    <div
      className="min-h-screen"
      style={{ backgroundColor: "var(--bai-bg)", color: "var(--bai-text)" }}
    >
      <div className="mx-auto max-w-3xl">
        <DocumentToolbar className={TOOLBAR_CLASS} />
        <div className="p-6 space-y-6">
          <div
            className="rounded-xl p-6 space-y-4"
            style={{
              backgroundColor: "var(--bai-surface)",
              border: "1px solid var(--bai-border)",
            }}
          >
            <div className="flex items-center gap-3">
              <span
                className={`rounded-full border px-3 py-1 text-xs font-semibold ${STATUS_COLORS[state.status ?? "PENDING"]}`}
              >
                {state.status}
              </span>
              {state.category && (
                <span
                  className={`rounded px-2 py-0.5 text-xs font-medium ${CAT_COLORS[state.category] ?? ""}`}
                >
                  {state.category}
                </span>
              )}
              {state.observedBy && (
                <span
                  className="text-xs"
                  style={{ color: "var(--bai-text-faint)" }}
                >
                  by {state.observedBy}
                </span>
              )}
              {state.observedAt && (
                <span
                  className="text-xs"
                  style={{ color: "var(--bai-text-faint)" }}
                >
                  {new Date(state.observedAt).toLocaleDateString()}
                </span>
              )}
            </div>
            <h1
              className="text-xl font-bold"
              style={{ color: "var(--bai-text)" }}
            >
              {state.title}
            </h1>
            <p
              className="text-sm"
              style={{ color: "var(--bai-text-tertiary)" }}
            >
              {state.description}
            </p>
            {state.content && (
              <div
                className="max-h-[600px] overflow-y-auto rounded-lg px-5 py-4 scrollbar-thin"
                style={{
                  backgroundColor: "var(--bai-deep)",
                  border: "1px solid var(--bai-border)",
                }}
              >
                <MarkdownPreview content={state.content} />
              </div>
            )}

            {state.promotedTo && (
              <div className="flex items-center gap-2 rounded-lg bg-blue-500/10 px-3 py-2 text-xs text-blue-300">
                Promoted to:{" "}
                <span className="font-mono">{state.promotedTo}</span>
              </div>
            )}

            {/* Actions */}
            <div
              className="flex gap-2 pt-2"
              style={{ borderTop: "1px solid var(--bai-border)" }}
            >
              {state.status === "PENDING" && (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      const ref = prompt("Promoted to note ID:");
                      if (ref)
                        dispatch(
                          actions.promoteObservation({
                            promotedTo: ref,
                            promotedAt: ts(),
                          }),
                        );
                    }}
                    className="rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700"
                  >
                    Promote
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      dispatch(
                        actions.implementObservation({ updatedAt: ts() }),
                      )
                    }
                    className="rounded bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-700"
                  >
                    Implement
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      dispatch(actions.archiveObservation({ updatedAt: ts() }))
                    }
                    className="rounded bg-gray-600 px-3 py-1 text-xs font-medium text-white hover:bg-gray-700"
                  >
                    Archive
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function CreateForm({
  dispatch,
}: {
  dispatch: (action: ReturnType<typeof actions.createObservation>) => void;
}) {
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [content, setContent] = useState("");
  const [category, setCategory] = useState<string>("FRICTION");
  const [observer, setObserver] = useState("");

  return (
    <div
      className="min-h-screen"
      style={{ backgroundColor: "var(--bai-bg)", color: "var(--bai-text)" }}
    >
      <div className="mx-auto max-w-2xl">
        <DocumentToolbar className={TOOLBAR_CLASS} />
        <div className="p-6">
          <div
            className="rounded-xl p-8 space-y-4"
            style={{
              backgroundColor: "var(--bai-surface)",
              border: "1px solid var(--bai-border)",
            }}
          >
            <h2
              className="text-lg font-bold"
              style={{ color: "var(--bai-text)" }}
            >
              Capture Observation
            </h2>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What did you observe?"
              className="w-full rounded-lg px-3 py-2 text-sm outline-none focus:border-[#cba6f7]/50"
              style={{
                backgroundColor: "var(--bai-bg)",
                color: "var(--bai-text-secondary)",
                border: "1px solid var(--bai-border)",
              }}
            />
            <input
              type="text"
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              placeholder="Brief summary"
              className="w-full rounded-lg px-3 py-2 text-sm outline-none focus:border-[#cba6f7]/50"
              style={{
                backgroundColor: "var(--bai-bg)",
                color: "var(--bai-text-secondary)",
                border: "1px solid var(--bai-border)",
              }}
            />
            <div className="flex gap-3">
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="rounded-lg px-3 py-2 text-sm"
                style={{
                  backgroundColor: "var(--bai-bg)",
                  color: "var(--bai-text-secondary)",
                  border: "1px solid var(--bai-border)",
                }}
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <input
                type="text"
                value={observer}
                onChange={(e) => setObserver(e.target.value)}
                placeholder="Observer (optional)"
                className="flex-1 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#cba6f7]/50"
                style={{
                  backgroundColor: "var(--bai-bg)",
                  color: "var(--bai-text-secondary)",
                  border: "1px solid var(--bai-border)",
                }}
              />
            </div>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Details (optional)"
              rows={4}
              className="w-full rounded-lg px-4 py-3 text-sm outline-none focus:border-[#cba6f7]/50"
              style={{
                backgroundColor: "var(--bai-deep)",
                color: "var(--bai-text-secondary)",
                border: "1px solid var(--bai-border)",
              }}
            />
            <button
              type="button"
              disabled={!title.trim() || !desc.trim()}
              onClick={() =>
                dispatch(
                  actions.createObservation({
                    title,
                    description: desc,
                    content: content || undefined,
                    category: category as "FRICTION",
                    observedAt: ts(),
                    observedBy: observer || undefined,
                  }),
                )
              }
              className="rounded-lg px-4 py-2 text-sm font-medium hover:opacity-80 disabled:opacity-40"
              style={{
                backgroundColor: "var(--bai-accent)",
                color: "var(--bai-accent-text)",
              }}
            >
              Capture
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
