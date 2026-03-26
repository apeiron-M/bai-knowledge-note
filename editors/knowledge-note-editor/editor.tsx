import { useState, useCallback } from "react";
import { DocumentToolbar } from "@powerhousedao/design-system/connect";
import {
  useSelectedKnowledgeNoteDocument,
  actions,
} from "knowledge-note/document-models/knowledge-note";
import { StatusBar } from "./components/status-bar.js";
import { TopicsBar } from "./components/topics-bar.js";
import { LinksSection } from "./components/links-section.js";
import { ProvenanceInfo } from "./components/provenance-info.js";
import { LifecycleTimeline } from "./components/lifecycle-timeline.js";
import { MetadataPanel } from "./components/metadata-panel.js";
import { MarkdownPreview } from "./components/markdown-preview.js";

const NOTE_TYPES = [
  "concept", "decision", "pattern", "observation", "procedure",
  "architecture", "bug-pattern", "integration", "workflow", "reference",
] as const;

function timestamp() {
  return new Date().toISOString();
}

export default function Editor() {
  const [document, dispatch] = useSelectedKnowledgeNoteDocument();
  const [activeTab, setActiveTab] = useState<"content" | "links" | "history">("content");
  const [contentMode, setContentMode] = useState<"preview" | "edit">("preview");

  const state = document.state.global;

  const handleSetTitle = useCallback(
    (title: string) => {
      if (title && title !== state.title) {
        dispatch(actions.setTitle({ title, updatedAt: timestamp() }));
      }
    },
    [dispatch, state.title],
  );

  const handleSetDescription = useCallback(
    (description: string) => {
      if (description !== (state.description ?? "")) {
        dispatch(actions.setDescription({ description, updatedAt: timestamp() }));
      }
    },
    [dispatch, state.description],
  );

  const handleSetNoteType = useCallback(
    (noteType: string) => {
      dispatch(actions.setNoteType({ noteType, updatedAt: timestamp() }));
    },
    [dispatch],
  );

  const handleSetContent = useCallback(
    (content: string) => {
      dispatch(actions.setContent({ content, updatedAt: timestamp() }));
    },
    [dispatch],
  );

  const handleSetMetadataField = useCallback(
    (field: string, value: string | null) => {
      dispatch(actions.setMetadataField({ field, value: value ?? undefined, updatedAt: timestamp() }));
    },
    [dispatch],
  );

  const handleSetMetadataListField = useCallback(
    (field: string, values: string[]) => {
      dispatch(actions.setMetadataListField({ field, values, updatedAt: timestamp() }));
    },
    [dispatch],
  );

  return (
    <div className="min-h-screen bg-[#1e1e2e] text-gray-200">
      <div className="mx-auto max-w-6xl">
        <DocumentToolbar
          className={[
            "!bg-[#181825] !border-white/10",
            "[&_button]:!bg-[#1e1e2e] [&_button]:!border-white/10",
            "[&_button:hover]:!bg-[#313244]",
            "[&_button_svg]:!text-gray-400 [&_button:hover_svg]:!text-gray-200",
            "[&_span]:!text-gray-400 [&_button:hover_span]:!text-gray-200",
            "[&_h1]:!text-gray-400 [&_h1:hover]:!text-gray-200",
          ].join(" ")}
        />

        <div className="flex gap-6 p-6 pb-12">
          {/* Main content area */}
          <div className="min-w-0 flex-1 space-y-5 rounded-xl bg-[#181825] p-6 ring-1 ring-white/10">
            {/* Status + Title */}
            <div className="space-y-3">
              <StatusBar
                status={state.status ?? null}
                provenanceAuthor={state.provenance?.author ?? null}
                hasProvenance={!!state.provenance}
                onSubmitForReview={(id, actor, ts, comment) =>
                  dispatch(actions.submitForReview({ id, actor, timestamp: ts, comment }))
                }
                onApprove={(id, actor, ts, comment) =>
                  dispatch(actions.approveNote({ id, actor, timestamp: ts, comment }))
                }
                onReject={(id, actor, ts, comment) =>
                  dispatch(actions.rejectNote({ id, actor, timestamp: ts, comment }))
                }
                onArchive={(id, actor, ts, comment) =>
                  dispatch(actions.archiveNote({ id, actor, timestamp: ts, comment }))
                }
                onRestore={(id, actor, ts, comment) =>
                  dispatch(actions.restoreNote({ id, actor, timestamp: ts, comment }))
                }
              />

              <input
                type="text"
                defaultValue={state.title ?? ""}
                placeholder="Untitled Note"
                onBlur={(e) => handleSetTitle(e.target.value.trim())}
                onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
                className="w-full border-0 bg-transparent text-2xl font-bold text-gray-100 outline-none placeholder:text-gray-600"
              />
            </div>

            {/* Description */}
            <textarea
              defaultValue={state.description ?? ""}
              placeholder="Brief description (max 200 chars)..."
              maxLength={200}
              rows={2}
              onBlur={(e) => handleSetDescription(e.target.value.trim())}
              className="w-full resize-none rounded-lg border border-white/10 bg-[#1e1e2e] px-3 py-2 text-sm text-gray-300 outline-none placeholder:text-gray-600 focus:border-[#cba6f7]/50"
            />

            {/* Note type + Topics */}
            <div className="flex items-center gap-3">
              <select
                value={state.noteType ?? ""}
                onChange={(e) => handleSetNoteType(e.target.value)}
                className="rounded-lg border border-white/10 bg-[#1e1e2e] px-3 py-1.5 text-sm text-gray-300 outline-none focus:border-[#cba6f7]/50"
              >
                <option value="" disabled>Note type...</option>
                {NOTE_TYPES.map((t) => (<option key={t} value={t}>{t}</option>))}
              </select>
              <div className="h-4 w-px bg-white/10" />
              <TopicsBar
                topics={state.topics}
                onAddTopic={(id, name) => dispatch(actions.addTopic({ id, name }))}
                onRemoveTopic={(id) => dispatch(actions.removeTopic({ id }))}
              />
            </div>

            {/* Tab bar */}
            <div className="flex gap-1 border-b border-white/10">
              {([["content", "Content"], ["links", "Links"], ["history", "History"]] as const).map(([key, label]) => (
                <button key={key} type="button" onClick={() => setActiveTab(key)}
                  className={`border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
                    activeTab === key
                      ? "border-[#cba6f7] text-[#cba6f7]"
                      : "border-transparent text-gray-500 hover:border-gray-600 hover:text-gray-400"
                  }`}>
                  {label}
                  {key === "links" && state.links.length > 0 && (
                    <span className="ml-1.5 rounded-full bg-[#313244] px-1.5 py-0.5 text-xs text-gray-400">{state.links.length}</span>
                  )}
                </button>
              ))}
            </div>

            {/* Tab content */}
            {activeTab === "content" && (
              <div>
                {/* Preview / Edit toggle */}
                <div className="mb-3 flex gap-1">
                  <button type="button" onClick={() => setContentMode("preview")}
                    className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${contentMode === "preview" ? "bg-[#313244] text-[#cba6f7]" : "text-gray-500 hover:text-gray-400"}`}>
                    Preview
                  </button>
                  <button type="button" onClick={() => setContentMode("edit")}
                    className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${contentMode === "edit" ? "bg-[#313244] text-[#cba6f7]" : "text-gray-500 hover:text-gray-400"}`}>
                    Edit
                  </button>
                </div>

                {contentMode === "preview" ? (
                  <div
                    className="min-h-[400px] cursor-text rounded-lg border border-white/10 bg-[#11111b] px-4 py-3"
                    onClick={() => setContentMode("edit")}
                  >
                    {state.content ? (
                      <MarkdownPreview content={state.content} />
                    ) : (
                      <p className="text-sm italic text-gray-600">Click to start writing...</p>
                    )}
                  </div>
                ) : (
                  <textarea
                    defaultValue={state.content ?? ""}
                    placeholder="Write your note content here... (supports markdown)"
                    rows={20}
                    autoFocus
                    onBlur={(e) => {
                      handleSetContent(e.target.value);
                      setContentMode("preview");
                    }}
                    className="w-full resize-y rounded-lg border border-white/10 bg-[#11111b] px-4 py-3 font-mono text-sm leading-relaxed text-gray-300 outline-none placeholder:text-gray-600 focus:border-[#cba6f7]/50"
                  />
                )}
              </div>
            )}

            {activeTab === "links" && (
              <LinksSection
                links={state.links}
                currentDocId={document.header.id}
                onAddLink={(id, targetDocumentId, targetTitle, linkType) =>
                  dispatch(actions.addLink({ id, targetDocumentId, targetTitle, linkType }))}
                onRemoveLink={(id) => dispatch(actions.removeLink({ id }))}
                onUpdateLinkType={(id, linkType) => dispatch(actions.updateLinkType({ id, linkType }))}
              />
            )}

            {activeTab === "history" && (
              <LifecycleTimeline events={state.lifecycleEvents} />
            )}
          </div>

          {/* Right sidebar */}
          <div className="w-64 shrink-0 space-y-6 self-start rounded-xl bg-[#181825] p-5 ring-1 ring-white/10">
            <div>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">Provenance</h4>
              <ProvenanceInfo
                provenance={state.provenance ?? null}
                onSetProvenance={(author, sourceOrigin) =>
                  dispatch(actions.setProvenance({ author, sourceOrigin, createdAt: timestamp() }))}
              />
            </div>
            <hr className="border-white/10" />
            <MetadataPanel state={state} onSetField={handleSetMetadataField} onSetListField={handleSetMetadataListField} />
          </div>
        </div>
      </div>
    </div>
  );
}
