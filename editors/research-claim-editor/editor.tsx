import { useState } from "react";
import { DocumentToolbar } from "@powerhousedao/design-system/connect";
import {
  useSelectedResearchClaimDocument,
  actions,
} from "document-models/research-claim";
import { generateId } from "document-model/core";
import { MarkdownPreview } from "../shared/markdown-preview.js";
import { TOOLBAR_CLASS } from "../shared/theme-context.js";

const KIND_COLORS: Record<string, string> = {
  research: "bg-purple-500/20 text-purple-300 border-purple-500/30",
  example: "bg-cyan-500/20 text-cyan-300 border-cyan-500/30",
  foundation: "bg-blue-500/20 text-blue-300 border-blue-500/30",
  methodology: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
  principle: "bg-amber-500/20 text-amber-300 border-amber-500/30",
};

export default function Editor() {
  const [document, dispatch] = useSelectedResearchClaimDocument();
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
        <DocumentToolbar toolbarClassName={TOOLBAR_CLASS} />
        <div className="p-6 space-y-6">
          {/* Header */}
          <div
            className="rounded-xl p-6 space-y-4"
            style={{
              backgroundColor: "var(--bai-surface)",
              border: "1px solid var(--bai-border)",
            }}
          >
            <div className="flex items-center gap-3 flex-wrap">
              {state.kind && (
                <span
                  className={`rounded-full border px-3 py-1 text-xs font-semibold ${KIND_COLORS[state.kind] ?? "bg-gray-500/20 text-gray-300 border-gray-500/30"}`}
                >
                  {state.kind}
                </span>
              )}
              {state.methodology.map((m) => (
                <span
                  key={m}
                  className="rounded px-2 py-0.5 text-[10px]"
                  style={{
                    backgroundColor: "var(--bai-hover)",
                    color: "var(--bai-text-tertiary)",
                  }}
                >
                  {m}
                </span>
              ))}
            </div>
            <h1
              className="text-xl font-bold"
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
          </div>

          {/* Content */}
          {state.content && (
            <div
              className="rounded-xl p-6"
              style={{
                backgroundColor: "var(--bai-surface)",
                border: "1px solid var(--bai-border)",
              }}
            >
              <div className="mb-3 flex items-center justify-between">
                <h3
                  className="text-xs font-semibold uppercase tracking-wider"
                  style={{ color: "var(--bai-text-muted)" }}
                >
                  Content
                </h3>
                <EditContentButton
                  content={state.content}
                  dispatch={dispatch}
                />
              </div>
              <div
                className="max-h-[600px] overflow-y-auto rounded-lg px-5 py-4 scrollbar-thin"
                style={{
                  backgroundColor: "var(--bai-deep)",
                  border: "1px solid var(--bai-border)",
                }}
              >
                <MarkdownPreview content={state.content} />
              </div>
            </div>
          )}

          {/* Topics & Sources */}
          <div className="grid grid-cols-2 gap-4">
            <div
              className="rounded-xl p-4"
              style={{
                backgroundColor: "var(--bai-surface)",
                border: "1px solid var(--bai-border)",
              }}
            >
              <h3
                className="mb-2 text-xs font-semibold uppercase tracking-wider"
                style={{ color: "var(--bai-text-muted)" }}
              >
                Topics ({state.topics.length})
              </h3>
              <div className="flex flex-wrap gap-1">
                {state.topics.map((t) => (
                  <span
                    key={t}
                    className="rounded px-2 py-0.5 text-xs"
                    style={{
                      backgroundColor: "var(--bai-accent-soft)",
                      color: "var(--bai-accent)",
                    }}
                  >
                    {t}
                  </span>
                ))}
                {state.topics.length === 0 && (
                  <span
                    className="text-xs"
                    style={{ color: "var(--bai-text-faint)" }}
                  >
                    No topics
                  </span>
                )}
              </div>
            </div>
            <div
              className="rounded-xl p-4"
              style={{
                backgroundColor: "var(--bai-surface)",
                border: "1px solid var(--bai-border)",
              }}
            >
              <h3
                className="mb-2 text-xs font-semibold uppercase tracking-wider"
                style={{ color: "var(--bai-text-muted)" }}
              >
                Sources ({state.sources.length})
              </h3>
              <div className="flex flex-wrap gap-1">
                {state.sources.map((s) => (
                  <span
                    key={s}
                    className="rounded bg-cyan-500/10 px-2 py-0.5 text-xs text-cyan-400"
                  >
                    {s}
                  </span>
                ))}
                {state.sources.length === 0 && (
                  <span
                    className="text-xs"
                    style={{ color: "var(--bai-text-faint)" }}
                  >
                    No sources
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Connections */}
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
              Connections ({state.connections.length})
            </h3>
            {state.connections.length > 0 ? (
              <div className="space-y-2">
                {state.connections.map((conn) => (
                  <div
                    key={conn.id}
                    className="flex items-start gap-3 rounded-lg px-4 py-3"
                    style={{
                      backgroundColor: "var(--bai-bg)",
                      boxShadow: "0 0 0 1px var(--bai-ring)",
                    }}
                  >
                    <div className="min-w-0 flex-1">
                      <p
                        className="text-xs"
                        style={{ color: "var(--bai-text-tertiary)" }}
                      >
                        {conn.contextPhrase}
                      </p>
                      <p
                        className="mt-1 font-mono text-[10px] truncate"
                        style={{ color: "var(--bai-text-faint)" }}
                      >
                        {conn.targetRef}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        dispatch(
                          actions.removeResearchConnection({ id: conn.id }),
                        )
                      }
                      className="shrink-0 rounded px-2 py-1 text-[10px] text-red-400 hover:bg-red-500/10"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs" style={{ color: "var(--bai-text-faint)" }}>
                No connections yet
              </p>
            )}
            <AddConnectionForm dispatch={dispatch} />
          </div>
        </div>
      </div>
    </div>
  );
}

function EditContentButton({
  content,
  dispatch,
}: {
  content: string;
  dispatch: ReturnType<typeof useSelectedResearchClaimDocument>[1];
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(content);

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          setText(content);
          setEditing(true);
        }}
        className="rounded px-3 py-1 text-xs hover:opacity-80"
        style={{
          backgroundColor: "var(--bai-hover)",
          color: "var(--bai-text-tertiary)",
        }}
      >
        Edit
      </button>
    );
  }

  return (
    <div className="w-full space-y-2">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={8}
        className="w-full rounded-lg px-4 py-3 text-sm outline-none focus:border-[#cba6f7]/50"
        style={{
          backgroundColor: "var(--bai-deep)",
          color: "var(--bai-text-secondary)",
          border: "1px solid var(--bai-border)",
        }}
      />
      <div className="flex gap-2 justify-end">
        <button
          type="button"
          onClick={() => setEditing(false)}
          className="rounded px-3 py-1 text-xs hover:opacity-80"
          style={{
            backgroundColor: "var(--bai-hover)",
            color: "var(--bai-text-tertiary)",
          }}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => {
            dispatch(actions.updateClaimContent({ content: text }));
            setEditing(false);
          }}
          className="rounded px-3 py-1 text-xs font-medium hover:opacity-80"
          style={{
            backgroundColor: "var(--bai-accent)",
            color: "var(--bai-accent-text)",
          }}
        >
          Save
        </button>
      </div>
    </div>
  );
}

function AddConnectionForm({
  dispatch,
}: {
  dispatch: ReturnType<typeof useSelectedResearchClaimDocument>[1];
}) {
  const [open, setOpen] = useState(false);
  const [targetRef, setTargetRef] = useState("");
  const [contextPhrase, setContextPhrase] = useState("");

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-3 rounded px-3 py-1.5 text-xs hover:opacity-80"
        style={{
          backgroundColor: "var(--bai-hover)",
          color: "var(--bai-text-tertiary)",
        }}
      >
        + Add Connection
      </button>
    );
  }

  return (
    <div
      className="mt-3 rounded-lg p-4 space-y-3"
      style={{
        backgroundColor: "var(--bai-bg)",
        border: "1px solid var(--bai-border)",
      }}
    >
      <input
        type="text"
        value={targetRef}
        onChange={(e) => setTargetRef(e.target.value)}
        placeholder="Target document ID or reference"
        className="w-full rounded-lg px-3 py-2 text-sm outline-none focus:border-[#cba6f7]/50"
        style={{
          backgroundColor: "var(--bai-deep)",
          color: "var(--bai-text-secondary)",
          border: "1px solid var(--bai-border)",
        }}
      />
      <input
        type="text"
        value={contextPhrase}
        onChange={(e) => setContextPhrase(e.target.value)}
        placeholder="Context phrase describing the connection"
        className="w-full rounded-lg px-3 py-2 text-sm outline-none focus:border-[#cba6f7]/50"
        style={{
          backgroundColor: "var(--bai-deep)",
          color: "var(--bai-text-secondary)",
          border: "1px solid var(--bai-border)",
        }}
      />
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded px-3 py-1 text-xs hover:opacity-80"
          style={{
            backgroundColor: "var(--bai-hover)",
            color: "var(--bai-text-tertiary)",
          }}
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={!targetRef.trim() || !contextPhrase.trim()}
          onClick={() => {
            dispatch(
              actions.addResearchConnection({
                id: generateId(),
                targetRef: targetRef.trim(),
                contextPhrase: contextPhrase.trim(),
              }),
            );
            setTargetRef("");
            setContextPhrase("");
            setOpen(false);
          }}
          className="rounded px-3 py-1 text-xs font-medium hover:opacity-80 disabled:opacity-40"
          style={{
            backgroundColor: "var(--bai-accent)",
            color: "var(--bai-accent-text)",
          }}
        >
          Add
        </button>
      </div>
    </div>
  );
}

function CreateForm({
  dispatch,
}: {
  dispatch: ReturnType<typeof useSelectedResearchClaimDocument>[1];
}) {
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [content, setContent] = useState("");
  const [kind, setKind] = useState("research");

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
              Create Research Claim
            </h2>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Claim title (a clear, declarative statement)"
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
              placeholder="Brief description of the claim"
              className="w-full rounded-lg px-3 py-2 text-sm outline-none focus:border-[#cba6f7]/50"
              style={{
                backgroundColor: "var(--bai-bg)",
                color: "var(--bai-text-secondary)",
                border: "1px solid var(--bai-border)",
              }}
            />
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value)}
              className="rounded-lg px-3 py-2 text-sm"
              style={{
                backgroundColor: "var(--bai-bg)",
                color: "var(--bai-text-secondary)",
                border: "1px solid var(--bai-border)",
              }}
            >
              <option value="research">Research</option>
              <option value="foundation">Foundation</option>
              <option value="methodology">Methodology</option>
              <option value="principle">Principle</option>
              <option value="example">Example</option>
            </select>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Full claim content (markdown supported)"
              rows={6}
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
                  actions.createClaim({
                    title: title.trim(),
                    description: desc.trim(),
                    content: content.trim(),
                    kind,
                    methodology: [],
                    sources: [],
                    topics: [],
                  }),
                )
              }
              className="rounded-lg px-4 py-2 text-sm font-medium hover:opacity-80 disabled:opacity-40"
              style={{
                backgroundColor: "var(--bai-accent)",
                color: "var(--bai-accent-text)",
              }}
            >
              Create Claim
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
