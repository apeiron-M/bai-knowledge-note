import { useState, useCallback } from "react";
import { generateId } from "document-model/core";
import { DocumentToolbar } from "@powerhousedao/design-system/connect";
import {
  setSelectedNode,
  useDocumentsInSelectedDrive,
} from "@powerhousedao/reactor-browser";
import {
  useSelectedMocDocument,
  actions,
} from "@powerhousedao/knowledge-note/document-models/moc";
import { TOOLBAR_CLASS } from "../shared/theme-context.js";

const TIERS = ["HUB", "DOMAIN", "TOPIC"] as const;
const TIER_COLORS: Record<string, string> = {
  HUB: "bg-purple-500/20 text-purple-300 border-purple-500/30",
  DOMAIN: "bg-blue-500/20 text-blue-300 border-blue-500/30",
  TOPIC: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
};
function ts() {
  return new Date().toISOString();
}

export default function Editor() {
  const [document, dispatch] = useSelectedMocDocument();
  const state = document.state.global;
  const allDocs = useDocumentsInSelectedDrive();
  const [newQuestion, setNewQuestion] = useState("");
  const [newIdeaRef, setNewIdeaRef] = useState("");
  const [newIdeaPhrase, setNewIdeaPhrase] = useState("");
  const initialized = !!state.title;

  if (!initialized) {
    return <InitForm dispatch={dispatch} />;
  }

  return (
    <div
      className="min-h-screen"
      style={{ backgroundColor: "var(--bai-bg)", color: "var(--bai-text)" }}
    >
      <div className="mx-auto max-w-5xl">
        <DocumentToolbar className={TOOLBAR_CLASS} />
        <div className="p-6 space-y-6">
          {/* Header */}
          <div
            className="rounded-xl p-6"
            style={{
              backgroundColor: "var(--bai-surface)",
              border: "1px solid var(--bai-border)",
            }}
          >
            <div className="flex items-center gap-3 mb-3">
              <span
                className={`rounded-full border px-3 py-1 text-xs font-semibold ${TIER_COLORS[state.tier ?? "TOPIC"]}`}
              >
                {state.tier}
              </span>
              <span
                className="text-xs"
                style={{ color: "var(--bai-text-muted)" }}
              >
                {state.noteCount ?? 0} notes
              </span>
            </div>
            <h1
              className="text-2xl font-bold"
              style={{ color: "var(--bai-text)" }}
            >
              {state.title}
            </h1>
            <textarea
              defaultValue={state.description ?? ""}
              placeholder="Description..."
              onBlur={(e) =>
                dispatch(
                  actions.updateDescription({
                    description: e.target.value.trim(),
                    updatedAt: ts(),
                  }),
                )
              }
              className="mt-2 w-full resize-none rounded-lg px-3 py-2 text-sm outline-none placeholder:opacity-50 focus:border-[#cba6f7]/50"
              rows={2}
              style={{
                backgroundColor: "var(--bai-bg)",
                color: "var(--bai-text-secondary)",
                border: "1px solid var(--bai-border)",
              }}
            />
          </div>

          {/* Orientation */}
          <div
            className="rounded-xl p-6"
            style={{
              backgroundColor: "var(--bai-surface)",
              border: "1px solid var(--bai-border)",
            }}
          >
            <h3
              className="mb-2 text-xs font-semibold uppercase tracking-wider"
              style={{ color: "var(--bai-text-muted)" }}
            >
              Orientation
            </h3>
            <p
              className="mb-1.5 text-[10px]"
              style={{ color: "var(--bai-text-faint)" }}
            >
              A synthesis paragraph explaining what this topic covers, key
              themes, and how the core ideas relate to each other.
            </p>
            <textarea
              defaultValue={state.orientation ?? ""}
              placeholder="Write a 2-3 paragraph synthesis of this topic area — what are the key themes, how do the core ideas connect, and what's the current state of understanding..."
              onBlur={(e) =>
                dispatch(
                  actions.updateOrientation({
                    orientation: e.target.value.trim(),
                    updatedAt: ts(),
                  }),
                )
              }
              className="w-full resize-y rounded-lg px-4 py-3 text-sm leading-relaxed outline-none placeholder:opacity-50 focus:border-[#cba6f7]/50"
              rows={10}
              style={{
                backgroundColor: "var(--bai-deep)",
                color: "var(--bai-text-secondary)",
                border: "1px solid var(--bai-border)",
                minHeight: "160px",
              }}
            />
          </div>

          <div className="grid grid-cols-2 gap-6">
            {/* Core Ideas */}
            <div
              className="rounded-xl p-6"
              style={{
                backgroundColor: "var(--bai-surface)",
                border: "1px solid var(--bai-border)",
              }}
            >
              <h3
                className="mb-3 text-xs font-semibold uppercase tracking-wider"
                style={{ color: "var(--bai-text-muted)" }}
              >
                Core Ideas ({(state.coreIdeas ?? []).length})
              </h3>
              <div className="space-y-2">
                {(state.coreIdeas ?? []).map((idea) => {
                  const linkedDoc = (allDocs ?? []).find(
                    (d) => d.header.id === idea.noteRef,
                  );
                  const noteTitle = linkedDoc
                    ? ((
                        linkedDoc.state as unknown as {
                          global: { title?: string };
                        }
                      ).global.title ?? linkedDoc.header.name)
                    : null;
                  return (
                    <div
                      key={idea.id}
                      className="group flex items-start gap-2 rounded-lg px-3 py-2"
                      style={{
                        backgroundColor: "var(--bai-bg)",
                        boxShadow: "0 0 0 1px var(--bai-ring)",
                      }}
                    >
                      <div className="flex-1 min-w-0">
                        <p
                          className="text-xs"
                          style={{ color: "var(--bai-text-secondary)" }}
                        >
                          {idea.contextPhrase}
                        </p>
                        {idea.noteRef &&
                          (noteTitle ? (
                            <button
                              type="button"
                              onClick={() => setSelectedNode(idea.noteRef)}
                              className="mt-0.5 text-[10px] text-left truncate max-w-full transition-colors hover:underline"
                              style={{ color: "var(--bai-accent)" }}
                              title={`Open note: ${noteTitle}`}
                            >
                              {noteTitle}
                              <svg
                                className="ml-1 inline h-2.5 w-2.5"
                                style={{ color: "var(--bai-text-faint)" }}
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                              >
                                <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
                                <path d="M15 3h6v6" />
                                <path d="M10 14L21 3" />
                              </svg>
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setSelectedNode(idea.noteRef)}
                              className="mt-0.5 text-[10px] font-mono text-left truncate max-w-full transition-colors hover:underline"
                              style={{ color: "var(--bai-text-faint)" }}
                              title={`Open document: ${idea.noteRef}`}
                            >
                              {idea.noteRef.slice(0, 12)}...
                            </button>
                          ))}
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          dispatch(actions.removeCoreIdea({ id: idea.id }))
                        }
                        className="opacity-0 hover:text-red-400 group-hover:opacity-100"
                        style={{ color: "var(--bai-text-faint)" }}
                      >
                        &times;
                      </button>
                    </div>
                  );
                })}
                <form
                  className="flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!newIdeaRef.trim() || !newIdeaPhrase.trim()) return;
                    dispatch(
                      actions.addCoreIdea({
                        id: generateId(),
                        noteRef: newIdeaRef.trim(),
                        contextPhrase: newIdeaPhrase.trim(),
                        sortOrder: (state.coreIdeas ?? []).length,
                        addedAt: ts(),
                      }),
                    );
                    setNewIdeaRef("");
                    setNewIdeaPhrase("");
                  }}
                >
                  <input
                    type="text"
                    value={newIdeaRef}
                    onChange={(e) => setNewIdeaRef(e.target.value)}
                    placeholder="Note ID..."
                    className="w-24 rounded px-2 py-1 text-xs font-mono outline-none focus:border-[#cba6f7]/50"
                    style={{
                      backgroundColor: "var(--bai-deep)",
                      color: "var(--bai-text-tertiary)",
                      border: "1px solid var(--bai-border)",
                    }}
                  />
                  <input
                    type="text"
                    value={newIdeaPhrase}
                    onChange={(e) => setNewIdeaPhrase(e.target.value)}
                    placeholder="Why it matters here..."
                    className="flex-1 rounded px-2 py-1 text-xs outline-none focus:border-[#cba6f7]/50"
                    style={{
                      backgroundColor: "var(--bai-deep)",
                      color: "var(--bai-text-secondary)",
                      border: "1px solid var(--bai-border)",
                    }}
                  />
                  <button
                    type="submit"
                    className="rounded px-2 py-1 text-xs font-medium"
                    style={{
                      backgroundColor: "var(--bai-accent)",
                      color: "var(--bai-accent-text)",
                    }}
                  >
                    Add
                  </button>
                </form>
              </div>
            </div>

            {/* Tensions + Questions */}
            <div className="space-y-6">
              <div
                className="rounded-xl p-6"
                style={{
                  backgroundColor: "var(--bai-surface)",
                  border: "1px solid var(--bai-border)",
                }}
              >
                <h3
                  className="mb-3 text-xs font-semibold uppercase tracking-wider"
                  style={{ color: "var(--bai-text-muted)" }}
                >
                  Tensions
                </h3>
                {(state.tensions ?? []).map((t) => (
                  <div
                    key={t.id}
                    className="group flex items-center gap-2 rounded-lg px-3 py-2 mb-1"
                    style={{
                      backgroundColor: "var(--bai-bg)",
                      boxShadow: "0 0 0 1px var(--bai-ring)",
                    }}
                  >
                    <span className="h-2 w-2 shrink-0 rounded-full bg-red-400" />
                    <span
                      className="flex-1 text-xs"
                      style={{ color: "var(--bai-text-secondary)" }}
                    >
                      {t.description}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        dispatch(actions.removeTension({ id: t.id }))
                      }
                      className="opacity-0 hover:text-red-400 group-hover:opacity-100"
                      style={{ color: "var(--bai-text-faint)" }}
                    >
                      &times;
                    </button>
                  </div>
                ))}
              </div>
              <div
                className="rounded-xl p-6"
                style={{
                  backgroundColor: "var(--bai-surface)",
                  border: "1px solid var(--bai-border)",
                }}
              >
                <h3
                  className="mb-3 text-xs font-semibold uppercase tracking-wider"
                  style={{ color: "var(--bai-text-muted)" }}
                >
                  Open Questions
                </h3>
                {(state.openQuestions ?? []).map((q, i) => (
                  <div
                    key={i}
                    className="group flex items-center gap-2 rounded-lg px-3 py-2 mb-1"
                    style={{
                      backgroundColor: "var(--bai-bg)",
                      boxShadow: "0 0 0 1px var(--bai-ring)",
                    }}
                  >
                    <span
                      className="flex-1 text-xs"
                      style={{ color: "var(--bai-text-secondary)" }}
                    >
                      {q}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        dispatch(actions.removeOpenQuestion({ question: q }))
                      }
                      className="opacity-0 hover:text-red-400 group-hover:opacity-100"
                      style={{ color: "var(--bai-text-faint)" }}
                    >
                      &times;
                    </button>
                  </div>
                ))}
                <form
                  className="flex gap-2 mt-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!newQuestion.trim()) return;
                    dispatch(
                      actions.addOpenQuestion({ question: newQuestion.trim() }),
                    );
                    setNewQuestion("");
                  }}
                >
                  <input
                    type="text"
                    value={newQuestion}
                    onChange={(e) => setNewQuestion(e.target.value)}
                    placeholder="Add question..."
                    className="flex-1 rounded px-2 py-1 text-xs outline-none focus:border-[#cba6f7]/50"
                    style={{
                      backgroundColor: "var(--bai-deep)",
                      color: "var(--bai-text-secondary)",
                      border: "1px solid var(--bai-border)",
                    }}
                  />
                  <button
                    type="submit"
                    className="rounded px-2 py-1 text-xs font-medium"
                    style={{
                      backgroundColor: "var(--bai-accent)",
                      color: "var(--bai-accent-text)",
                    }}
                  >
                    Add
                  </button>
                </form>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function InitForm({
  dispatch,
}: {
  dispatch: (action: ReturnType<typeof actions.createMoc>) => void;
}) {
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [orient, setOrient] = useState("");
  const [tier, setTier] = useState<string>("TOPIC");
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
              Create Map of Content
            </h2>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="MOC Title"
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
              placeholder="Description"
              className="w-full rounded-lg px-3 py-2 text-sm outline-none focus:border-[#cba6f7]/50"
              style={{
                backgroundColor: "var(--bai-bg)",
                color: "var(--bai-text-secondary)",
                border: "1px solid var(--bai-border)",
              }}
            />
            <textarea
              value={orient}
              onChange={(e) => setOrient(e.target.value)}
              placeholder="Orientation (2-3 sentences)"
              rows={3}
              className="w-full rounded-lg px-3 py-2 text-sm outline-none focus:border-[#cba6f7]/50"
              style={{
                backgroundColor: "var(--bai-bg)",
                color: "var(--bai-text-secondary)",
                border: "1px solid var(--bai-border)",
              }}
            />
            <select
              value={tier}
              onChange={(e) => setTier(e.target.value)}
              className="rounded-lg px-3 py-2 text-sm"
              style={{
                backgroundColor: "var(--bai-bg)",
                color: "var(--bai-text-secondary)",
                border: "1px solid var(--bai-border)",
              }}
            >
              {TIERS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={!title.trim() || !desc.trim() || !orient.trim()}
              onClick={() =>
                dispatch(
                  actions.createMoc({
                    title,
                    description: desc,
                    orientation: orient,
                    tier: tier as "HUB" | "DOMAIN" | "TOPIC",
                    createdAt: ts(),
                  }),
                )
              }
              className="rounded-lg px-4 py-2 text-sm font-medium hover:opacity-80 disabled:opacity-40"
              style={{
                backgroundColor: "var(--bai-accent)",
                color: "var(--bai-accent-text)",
              }}
            >
              Create MOC
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
