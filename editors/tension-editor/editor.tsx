import { useState, useMemo } from "react";
import { DocumentToolbar } from "@powerhousedao/design-system/connect";
import { useSelectedTensionDocument, actions } from "document-models/tension";
import {
  setSelectedNode,
  useDocumentsInSelectedDrive,
} from "@powerhousedao/reactor-browser";
import { TOOLBAR_CLASS } from "../shared/theme-context.js";

const STATUS_COLORS: Record<string, string> = {
  OPEN: "bg-red-500/20 text-red-300 border-red-500/30",
  RESOLVED: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
  DISSOLVED: "bg-blue-500/20 text-blue-300 border-blue-500/30",
};

function ts() {
  return new Date().toISOString();
}

export default function Editor() {
  const [document, dispatch] = useSelectedTensionDocument();
  const state = document.state.global;
  // reactor-browser dev.239+ — useDocumentsInSelectedDrive is now
  // tolerant of per-doc fetch failures; filter client-side.
  const allDriveDocs = useDocumentsInSelectedDrive();
  const allDocs = useMemo(
    () =>
      (allDriveDocs ?? []).filter(
        (d) =>
          d.header.documentType === "bai/knowledge-note" ||
          d.header.documentType === "bai/moc",
      ),
    [allDriveDocs],
  );
  const initialized = !!state.title;

  if (!initialized) {
    return <CreateForm dispatch={dispatch} />;
  }

  // Resolve involved refs to note titles
  const involvedNotes = (state.involvedRefs ?? []).map((ref) => {
    const doc = (allDocs ?? []).find((d) => d.header.id === ref);
    const title = doc
      ? ((doc.state as unknown as { global: { title?: string } }).global
          .title ?? doc.header.name)
      : ref.slice(0, 12);
    return { ref, title, exists: !!doc };
  });

  return (
    <div
      className="min-h-screen"
      style={{ backgroundColor: "var(--bai-bg)", color: "var(--bai-text)" }}
    >
      <div className="mx-auto max-w-3xl">
        <DocumentToolbar toolbarClassName={TOOLBAR_CLASS} />
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
                className={`rounded-full border px-3 py-1 text-xs font-semibold ${STATUS_COLORS[state.status ?? "OPEN"]}`}
              >
                {state.status}
              </span>
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
            {state.description && (
              <p
                className="mt-2 text-sm"
                style={{ color: "var(--bai-text-tertiary)" }}
              >
                {state.description}
              </p>
            )}
          </div>

          {/* Content — the full analysis of the contradiction */}
          {state.content && (
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
                Analysis
              </h3>
              <div
                className="rounded-lg px-4 py-3"
                style={{
                  backgroundColor: "var(--bai-deep)",
                  border: "1px solid var(--bai-border)",
                }}
              >
                <pre
                  className="whitespace-pre-wrap text-sm leading-relaxed"
                  style={{ color: "var(--bai-text-secondary)" }}
                >
                  {state.content}
                </pre>
              </div>
            </div>
          )}

          {/* Involved notes */}
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
              Involved Notes ({involvedNotes.length})
            </h3>
            <div className="space-y-2">
              {involvedNotes.map((note) => (
                <div
                  key={note.ref}
                  className="flex items-center gap-3 rounded-lg px-4 py-3"
                  style={{
                    backgroundColor: "var(--bai-bg)",
                    border: "1px solid var(--bai-border)",
                  }}
                >
                  <span className="h-2 w-2 shrink-0 rounded-full bg-red-400" />
                  {note.exists ? (
                    <button
                      type="button"
                      onClick={() => setSelectedNode(note.ref)}
                      className="flex-1 text-left text-xs transition-colors truncate"
                      style={{ color: "var(--bai-accent)" }}
                    >
                      {note.title}
                    </button>
                  ) : (
                    <span
                      className="flex-1 text-xs font-mono truncate"
                      style={{ color: "var(--bai-text-faint)" }}
                    >
                      {note.ref}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Resolution */}
          {state.resolution && (
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
                Resolution
              </h3>
              <p
                className="text-sm leading-relaxed"
                style={{ color: "var(--bai-text-secondary)" }}
              >
                {state.resolution}
              </p>
              {state.resolvedAt && (
                <p
                  className="mt-2 text-[10px]"
                  style={{ color: "var(--bai-text-faint)" }}
                >
                  Resolved {new Date(state.resolvedAt).toLocaleString()}
                </p>
              )}
            </div>
          )}

          {/* Actions */}
          {state.status === "OPEN" && (
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => {
                  const resolution = prompt(
                    "How was this resolved? (one side is correct)",
                  );
                  if (resolution)
                    dispatch(
                      actions.resolveTension({ resolution, resolvedAt: ts() }),
                    );
                }}
                className="rounded-lg px-4 py-2 text-sm font-medium"
                style={{
                  backgroundColor: "var(--bai-accent)",
                  color: "var(--bai-accent-text)",
                }}
              >
                Resolve
              </button>
              <button
                type="button"
                onClick={() => {
                  const resolution = prompt(
                    "Why is this tension apparent, not real?",
                  );
                  if (resolution)
                    dispatch(
                      actions.dissolveTension({ resolution, resolvedAt: ts() }),
                    );
                }}
                className="rounded-lg px-4 py-2 text-sm font-medium"
                style={{
                  backgroundColor: "var(--bai-hover)",
                  color: "var(--bai-text-secondary)",
                }}
              >
                Dissolve
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CreateForm({
  dispatch,
}: {
  dispatch: ReturnType<typeof useSelectedTensionDocument>[1];
}) {
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [content, setContent] = useState("");
  const [observer, setObserver] = useState("");
  const INPUT =
    "w-full rounded-lg px-3 py-2 text-sm outline-none focus:border-[#cba6f7]/50";

  return (
    <div
      className="min-h-screen"
      style={{ backgroundColor: "var(--bai-bg)", color: "var(--bai-text)" }}
    >
      <div className="mx-auto max-w-2xl">
        <DocumentToolbar toolbarClassName={TOOLBAR_CLASS} />
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
              Identify Tension
            </h2>
            <p className="text-xs" style={{ color: "var(--bai-text-muted)" }}>
              Record a contradiction between two or more claims in the vault
            </p>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What's the contradiction? (e.g., 'vault as tool vs vault as cognitive infrastructure')"
              className={INPUT}
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
              placeholder="Brief summary of the conflict"
              className={INPUT}
              style={{
                backgroundColor: "var(--bai-bg)",
                color: "var(--bai-text-secondary)",
                border: "1px solid var(--bai-border)",
              }}
            />
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Full analysis of the contradiction — why it matters, what's at stake..."
              rows={6}
              className={INPUT}
              style={{
                backgroundColor: "var(--bai-deep)",
                color: "var(--bai-text-secondary)",
                border: "1px solid var(--bai-border)",
              }}
            />
            <input
              type="text"
              value={observer}
              onChange={(e) => setObserver(e.target.value)}
              placeholder="Observed by (optional)"
              className={INPUT}
              style={{
                backgroundColor: "var(--bai-bg)",
                color: "var(--bai-text-secondary)",
                border: "1px solid var(--bai-border)",
              }}
            />
            <button
              type="button"
              disabled={!title.trim() || !desc.trim()}
              onClick={() =>
                dispatch(
                  actions.createTension({
                    title,
                    description: desc,
                    content: content || undefined,
                    involvedRefs: [],
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
              Create Tension
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
