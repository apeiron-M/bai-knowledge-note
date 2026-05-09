import { useState } from "react";
import { DocumentToolbar } from "@powerhousedao/design-system/connect";
import { useSelectedSourceDocument, actions } from "document-models/source";
import { MarkdownPreview } from "../shared/markdown-preview.js";
import { useFileNodesInSelectedDrive } from "@powerhousedao/reactor-browser";
import { generateId } from "document-model/core";
import { usePipelineQueueDocumentById } from "../../document-models/pipeline-queue/v1/hooks.js";
import { actions as pipelineActions } from "document-models/pipeline-queue";
import { TOOLBAR_CLASS } from "../shared/theme-context.js";

const SOURCE_TYPES = [
  "ARTICLE",
  "PAPER",
  "BOOK_CHAPTER",
  "TRANSCRIPT",
  "DOCUMENTATION",
  "CONVERSATION",
  "WEB_PAGE",
  "MANUAL_ENTRY",
] as const;
const STATUS_COLORS: Record<string, string> = {
  INBOX: "bg-amber-500/20 text-amber-300 border-amber-500/30",
  EXTRACTING: "bg-blue-500/20 text-blue-300 border-blue-500/30",
  EXTRACTED: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
  ARCHIVED: "bg-gray-500/20 text-gray-400 border-gray-500/30",
};

function ts() {
  return new Date().toISOString();
}

export default function Editor() {
  const [document, dispatch] = useSelectedSourceDocument();
  const state = document.state.global;
  const initialized = !!state.title;

  // All hooks before early return
  const fileNodes = useFileNodesInSelectedDrive();
  const pipelineNodeId = (fileNodes ?? []).find(
    (n) => n.documentType === "bai/pipeline-queue",
  )?.id;
  const [pipelineDoc, pipelineDispatch] =
    usePipelineQueueDocumentById(pipelineNodeId);
  const [queued, setQueued] = useState(false);
  const [editing, setEditing] = useState(false);

  if (!initialized) {
    return <IngestForm dispatch={dispatch} />;
  }

  const stats = state.extractionStats;

  // Check if a pipeline task already exists for this source
  const pipelineState = pipelineDoc?.state?.global;
  const existingTask = pipelineState?.tasks?.find(
    (t: { documentRef?: string | null; status?: string }) =>
      t.documentRef === document.header.id,
  );
  const hasActiveTask =
    existingTask &&
    existingTask.status !== "DONE" &&
    existingTask.status !== "FAILED";

  function handleQueueForProcessing() {
    if (!pipelineDispatch || !document.header.id) return;

    if (hasActiveTask) {
      // Task already exists — just reset status so the agent re-processes the latest state
      dispatch(actions.setSourceStatus({ status: "EXTRACTING" }));
      setQueued(true);
      return;
    }

    // No existing task — create one
    pipelineDispatch(
      pipelineActions.addTask({
        id: generateId(),
        taskType: "claim",
        target: state.title ?? "Untitled source",
        documentRef: document.header.id,
        createdAt: ts(),
      }),
    );
    dispatch(actions.setSourceStatus({ status: "EXTRACTING" }));
    setQueued(true);
  }

  const canQueue = state.status === "INBOX" && !!pipelineDispatch && !queued;

  if (editing) {
    return (
      <EditForm
        state={state}
        dispatch={dispatch}
        onDone={() => setEditing(false)}
      />
    );
  }

  return (
    <div
      className="min-h-screen"
      style={{ backgroundColor: "var(--bai-bg)", color: "var(--bai-text)" }}
    >
      <div className="mx-auto max-w-5xl">
        <DocumentToolbar className={TOOLBAR_CLASS} />
        <div className="flex gap-6 p-6">
          {/* Main */}
          <div
            className="min-w-0 flex-1 space-y-5 rounded-xl p-6"
            style={{
              backgroundColor: "var(--bai-surface)",
              border: "1px solid var(--bai-border)",
            }}
          >
            <div className="flex items-center gap-3">
              <span
                className={`rounded-full border px-3 py-1 text-xs font-semibold ${STATUS_COLORS[state.status ?? "INBOX"]}`}
              >
                {state.status}
              </span>
              {state.sourceType && (
                <span
                  className="rounded px-2 py-0.5 text-xs"
                  style={{
                    backgroundColor: "var(--bai-hover)",
                    color: "var(--bai-text-tertiary)",
                  }}
                >
                  {state.sourceType}
                </span>
              )}
              <div className="ml-auto flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="rounded px-3 py-1 text-xs hover:opacity-80"
                  style={{
                    backgroundColor: "var(--bai-hover)",
                    color: "var(--bai-text-tertiary)",
                  }}
                >
                  Edit
                </button>
                {canQueue && (
                  <button
                    type="button"
                    onClick={handleQueueForProcessing}
                    className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold hover:opacity-80"
                    style={{
                      backgroundColor: "var(--bai-accent)",
                      color: "var(--bai-accent-text)",
                    }}
                  >
                    <svg
                      className="h-3.5 w-3.5"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                    >
                      <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
                    </svg>
                    Queue for Processing
                  </button>
                )}
                {queued && (
                  <span className="text-xs text-emerald-400">
                    Queued — run /pipeline in Claude Code
                  </span>
                )}
                {!canQueue && !queued && (
                  <select
                    value={state.status ?? "INBOX"}
                    onChange={(e) =>
                      dispatch(
                        actions.setSourceStatus({
                          status: e.target.value as
                            | "INBOX"
                            | "EXTRACTING"
                            | "EXTRACTED"
                            | "ARCHIVED",
                        }),
                      )
                    }
                    className="rounded px-2 py-1 text-xs"
                    style={{
                      backgroundColor: "var(--bai-bg)",
                      color: "var(--bai-text-tertiary)",
                      border: "1px solid var(--bai-border)",
                    }}
                  >
                    {["INBOX", "EXTRACTING", "EXTRACTED", "ARCHIVED"].map(
                      (s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ),
                    )}
                  </select>
                )}
              </div>
            </div>
            <h1
              className="text-2xl font-bold"
              style={{ color: "var(--bai-text)" }}
            >
              {state.title}
            </h1>
            {state.description && (
              <p
                className="text-sm"
                style={{ color: "var(--bai-text-tertiary)" }}
              >
                {state.description}
              </p>
            )}

            {/* Content */}
            <div>
              <h3
                className="mb-2 text-xs font-semibold uppercase tracking-wider"
                style={{ color: "var(--bai-text-muted)" }}
              >
                Source Content
              </h3>
              <div
                className="max-h-[600px] overflow-y-auto rounded-lg px-5 py-4 scrollbar-thin"
                style={{
                  backgroundColor: "var(--bai-deep)",
                  border: "1px solid var(--bai-border)",
                }}
              >
                {state.content ? (
                  <MarkdownPreview content={state.content} />
                ) : (
                  <p
                    className="text-sm"
                    style={{ color: "var(--bai-text-muted)" }}
                  >
                    No content
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Sidebar */}
          <div
            className="w-64 shrink-0 space-y-6 self-start rounded-xl p-5"
            style={{
              backgroundColor: "var(--bai-surface)",
              border: "1px solid var(--bai-border)",
            }}
          >
            <div>
              <h4
                className="mb-2 text-xs font-semibold uppercase tracking-wider"
                style={{ color: "var(--bai-text-muted)" }}
              >
                Provenance
              </h4>
              <div
                className="space-y-1.5 text-xs"
                style={{ color: "var(--bai-text-tertiary)" }}
              >
                {state.provenance?.author && (
                  <div className="flex justify-between">
                    <span style={{ color: "var(--bai-text-faint)" }}>
                      Author
                    </span>
                    <span style={{ color: "var(--bai-text-secondary)" }}>
                      {state.provenance.author}
                    </span>
                  </div>
                )}
                {state.provenance?.url && (
                  <div className="flex justify-between">
                    <span style={{ color: "var(--bai-text-faint)" }}>URL</span>
                    <span
                      className="truncate max-w-[120px]"
                      style={{ color: "var(--bai-text-secondary)" }}
                      title={state.provenance.url}
                    >
                      {state.provenance.url}
                    </span>
                  </div>
                )}
                {state.provenance?.method && (
                  <div className="flex justify-between">
                    <span style={{ color: "var(--bai-text-faint)" }}>
                      Method
                    </span>
                    <span>{state.provenance.method}</span>
                  </div>
                )}
                {state.createdBy && (
                  <div className="flex justify-between">
                    <span style={{ color: "var(--bai-text-faint)" }}>
                      Ingested by
                    </span>
                    <span>{state.createdBy}</span>
                  </div>
                )}
              </div>
            </div>

            {stats && (
              <>
                <hr style={{ borderColor: "var(--bai-border)" }} />
                <div>
                  <h4
                    className="mb-2 text-xs font-semibold uppercase tracking-wider"
                    style={{ color: "var(--bai-text-muted)" }}
                  >
                    Extraction
                  </h4>
                  <div className="space-y-1.5 text-xs">
                    <div className="flex justify-between">
                      <span style={{ color: "var(--bai-text-faint)" }}>
                        Claims
                      </span>
                      <span className="text-emerald-400 font-bold">
                        {stats.claimCount}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span style={{ color: "var(--bai-text-faint)" }}>
                        Skipped
                      </span>
                      <span style={{ color: "var(--bai-text-tertiary)" }}>
                        {stats.skippedCount}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span style={{ color: "var(--bai-text-faint)" }}>
                        Skip rate
                      </span>
                      <span
                        className={
                          stats.skipRate > 0.1
                            ? "text-red-400"
                            : "text-emerald-400"
                        }
                      >
                        {(stats.skipRate * 100).toFixed(1)}%
                      </span>
                    </div>
                  </div>
                </div>
              </>
            )}

            <hr style={{ borderColor: "var(--bai-border)" }} />
            <div>
              <h4
                className="mb-2 text-xs font-semibold uppercase tracking-wider"
                style={{ color: "var(--bai-text-muted)" }}
              >
                Extracted Claims ({(state.extractedClaims ?? []).length})
              </h4>
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {(state.extractedClaims ?? []).map((ref, i) => (
                  <p
                    key={i}
                    className="truncate text-[10px] font-mono"
                    style={{ color: "var(--bai-text-faint)" }}
                  >
                    {ref}
                  </p>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Edit form — re-dispatches INGEST_SOURCE with updated values */
function EditForm({
  state,
  dispatch,
  onDone,
}: {
  state: ReturnType<typeof useSelectedSourceDocument>[0]["state"]["global"];
  dispatch: ReturnType<typeof useSelectedSourceDocument>[1];
  onDone: () => void;
}) {
  const [title, setTitle] = useState(state.title ?? "");
  const [desc, setDesc] = useState(state.description ?? "");
  const [content, setContent] = useState(state.content ?? "");
  const [sourceType, setSourceType] = useState(
    (state.sourceType ?? "ARTICLE") as string,
  );
  const [author, setAuthor] = useState(state.provenance?.author ?? "");
  const [url, setUrl] = useState(state.provenance?.url ?? "");

  function handleSave() {
    // Re-ingest with updated values
    dispatch(
      actions.ingestSource({
        title,
        content,
        sourceType: sourceType as "ARTICLE",
        description: desc || undefined,
        author: author || undefined,
        url: url || undefined,
        createdAt: state.createdAt ?? ts(),
        createdBy: state.createdBy || undefined,
      }),
    );
    // Reset to INBOX so it can be re-queued for processing
    dispatch(actions.setSourceStatus({ status: "INBOX" }));
    onDone();
  }

  return (
    <div
      className="min-h-screen"
      style={{ backgroundColor: "var(--bai-bg)", color: "var(--bai-text)" }}
    >
      <div className="mx-auto max-w-3xl">
        <DocumentToolbar className={TOOLBAR_CLASS} />
        <div className="p-6">
          <div
            className="rounded-xl p-8 space-y-4"
            style={{
              backgroundColor: "var(--bai-surface)",
              border: "1px solid var(--bai-border)",
            }}
          >
            <div className="flex items-center justify-between">
              <h2
                className="text-lg font-bold"
                style={{ color: "var(--bai-text)" }}
              >
                Edit Source
              </h2>
              <button
                type="button"
                onClick={onDone}
                className="rounded px-3 py-1 text-xs hover:opacity-80"
                style={{
                  backgroundColor: "var(--bai-hover)",
                  color: "var(--bai-text-tertiary)",
                }}
              >
                Cancel
              </button>
            </div>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Source title"
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
              placeholder="Brief description (optional)"
              className="w-full rounded-lg px-3 py-2 text-sm outline-none focus:border-[#cba6f7]/50"
              style={{
                backgroundColor: "var(--bai-bg)",
                color: "var(--bai-text-secondary)",
                border: "1px solid var(--bai-border)",
              }}
            />
            <div className="grid grid-cols-3 gap-3">
              <select
                value={sourceType}
                onChange={(e) => setSourceType(e.target.value)}
                className="rounded-lg px-3 py-2 text-sm"
                style={{
                  backgroundColor: "var(--bai-bg)",
                  color: "var(--bai-text-secondary)",
                  border: "1px solid var(--bai-border)",
                }}
              >
                {SOURCE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              <input
                type="text"
                value={author}
                onChange={(e) => setAuthor(e.target.value)}
                placeholder="Author"
                className="w-full rounded-lg px-3 py-2 text-sm outline-none focus:border-[#cba6f7]/50"
                style={{
                  backgroundColor: "var(--bai-bg)",
                  color: "var(--bai-text-secondary)",
                  border: "1px solid var(--bai-border)",
                }}
              />
              <input
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="URL (optional)"
                className="w-full rounded-lg px-3 py-2 text-sm outline-none focus:border-[#cba6f7]/50"
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
              placeholder="Source content..."
              rows={16}
              className="w-full rounded-lg px-4 py-3 font-mono text-sm outline-none focus:border-[#cba6f7]/50"
              style={{
                backgroundColor: "var(--bai-deep)",
                color: "var(--bai-text-secondary)",
                border: "1px solid var(--bai-border)",
              }}
            />
            <button
              type="button"
              disabled={!title.trim() || !content.trim()}
              onClick={handleSave}
              className="rounded-lg px-4 py-2 text-sm font-medium hover:opacity-80 disabled:opacity-40"
              style={{
                backgroundColor: "var(--bai-accent)",
                color: "var(--bai-accent-text)",
              }}
            >
              Save Changes
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Initial form for new (empty) source documents */
function IngestForm({
  dispatch,
}: {
  dispatch: (action: ReturnType<typeof actions.ingestSource>) => void;
}) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [sourceType, setSourceType] = useState("ARTICLE" as string);
  const [desc, setDesc] = useState("");
  const [url, setUrl] = useState("");
  const [author, setAuthor] = useState("");

  return (
    <div
      className="min-h-screen"
      style={{ backgroundColor: "var(--bai-bg)", color: "var(--bai-text)" }}
    >
      <div className="mx-auto max-w-3xl">
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
              Add Source Material
            </h2>
            <p className="text-xs" style={{ color: "var(--bai-text-muted)" }}>
              Paste raw content here — articles, notes, transcripts. The AI
              agent will extract atomic claims from it.
            </p>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Source title"
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
              placeholder="Brief description (optional)"
              className="w-full rounded-lg px-3 py-2 text-sm outline-none focus:border-[#cba6f7]/50"
              style={{
                backgroundColor: "var(--bai-bg)",
                color: "var(--bai-text-secondary)",
                border: "1px solid var(--bai-border)",
              }}
            />
            <div className="grid grid-cols-3 gap-3">
              <select
                value={sourceType}
                onChange={(e) => setSourceType(e.target.value)}
                className="rounded-lg px-3 py-2 text-sm"
                style={{
                  backgroundColor: "var(--bai-bg)",
                  color: "var(--bai-text-secondary)",
                  border: "1px solid var(--bai-border)",
                }}
              >
                {SOURCE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              <input
                type="text"
                value={author}
                onChange={(e) => setAuthor(e.target.value)}
                placeholder="Author"
                className="w-full rounded-lg px-3 py-2 text-sm outline-none focus:border-[#cba6f7]/50"
                style={{
                  backgroundColor: "var(--bai-bg)",
                  color: "var(--bai-text-secondary)",
                  border: "1px solid var(--bai-border)",
                }}
              />
              <input
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="URL (optional)"
                className="w-full rounded-lg px-3 py-2 text-sm outline-none focus:border-[#cba6f7]/50"
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
              placeholder="Paste source content here..."
              rows={12}
              className="w-full rounded-lg px-4 py-3 font-mono text-sm outline-none focus:border-[#cba6f7]/50"
              style={{
                backgroundColor: "var(--bai-deep)",
                color: "var(--bai-text-secondary)",
                border: "1px solid var(--bai-border)",
              }}
            />
            <button
              type="button"
              disabled={!title.trim() || !content.trim()}
              onClick={() =>
                dispatch(
                  actions.ingestSource({
                    title,
                    content,
                    sourceType: sourceType as "ARTICLE",
                    description: desc || undefined,
                    author: author || undefined,
                    url: url || undefined,
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
              Ingest Source
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
