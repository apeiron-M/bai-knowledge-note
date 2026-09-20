import { useState, useCallback, useMemo, useLayoutEffect, useRef } from "react";
import { DocumentToolbar } from "@powerhousedao/design-system/connect";
import { generateId } from "document-model/core";
import { dispatchActions } from "@powerhousedao/reactor-browser";
import {
  useSelectedKnowledgeNoteDocument,
  actions,
  NoteTypeSchema,
} from "document-models/knowledge-note";
import type { NoteType } from "document-models/knowledge-note";
import { StatusBar } from "./components/status-bar.js";
import { TopicsBar } from "./components/topics-bar.js";
import { LinksSection } from "./components/links-section.js";
import { SupersededBanner } from "./components/superseded-banner.js";
import { supersededBy as findSupersededBy } from "../knowledge-vault/lib/supersession.js";
import {
  articulationToMetadata,
  isEdgeConfidence,
} from "../shared/edge-articulation.js";
import { ProvenanceInfo } from "./components/provenance-info.js";
import { LifecycleTimeline } from "./components/lifecycle-timeline.js";
import {
  RevisionOperationList,
  RevisionScrubber,
  RevisionSnapshotPanel,
} from "../shared/revision-history.js";
import { useRevisionHistory } from "../shared/use-revision-history.js";
import { NOTE_REVISION_MODEL } from "./lib/revision-model.js";
import { MetadataPanel } from "./components/metadata-panel.js";
import { MarkdownPreview } from "../shared/markdown-preview.js";
import { useGraphMetadata } from "../knowledge-vault/hooks/use-graph-metadata.js";
import { neighbourhood } from "./lib/neighbourhood.js";
import { IncomingLinks, WhereThisSits } from "./components/graph-position.js";
import { TOOLBAR_CLASS } from "../shared/theme-context.js";
import { useKnowledgeNotes } from "../knowledge-vault/hooks/use-knowledge-notes.js";

type NoteLinkLite = {
  id: string;
  targetDocumentId: string | null;
  targetTitle: string | null;
  linkType: string | null;
  reason: string | null;
  confidence: string | null;
};

// The ten values come from the model's NoteType enum; the reducer rejects
// anything else, so the picker must offer exactly this set.
const NOTE_TYPES = NoteTypeSchema.options;
const noteTypeLabel = (t: NoteType) => t.toLowerCase().replace(/_/g, " ");

const STYLES = `
.note-ed { height: 100%; display: flex; flex-direction: column; background: var(--bai-bg); color: var(--bai-text); overflow-anchor: none; }
.note-ed .ne-body { position: relative; flex: 1; min-height: 0; display: flex; }
.note-ed .ne-reader { flex: 1; min-width: 0; overflow-y: auto; overflow-anchor: none; }
.note-ed .pagewrap { padding: 0 26px 64px; }

/* The card is the top of one column in every view: top rounding only, no
   bottom border — the tabs' own rule is the divider and whatever follows picks
   up the rounded foot. Same furniture as the source editor, on purpose: a
   reader moving between a source and the notes drawn from it should not have
   to learn a second layout. */
.note-ed .dochead { max-width: 64rem; margin: 20px auto 0; padding: 18px 20px 0; background: var(--bai-surface); border: 1px solid var(--bai-border); border-radius: 14px 14px 0 0; border-bottom: 0; }
.note-ed .chipsel { padding: 4px 8px 4px 10px; border-radius: 7px; background: var(--bai-hover); border: 0; color: var(--bai-text-tertiary); font: inherit; font-size: 11.5px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; cursor: pointer; }
.note-ed .chipsel:focus { outline: none; color: var(--bai-text); }

/* the claim: a note's title is its claim, so it is typed as a sentence */
.note-ed .claim { display: block; width: 100%; margin: 14px 0 0; padding: 0; border: 0; background: none; color: var(--bai-text); font: 600 22px/1.35 inherit; resize: none; outline: none; overflow: hidden; }
.note-ed .claim::placeholder { color: var(--bai-text-faint); font-weight: 500; }
.note-ed .claimhint { margin: 6px 0 0; font-size: 11px; color: var(--bai-text-faint); }
.note-ed .desc { display: block; width: 100%; margin-top: 14px; padding: 9px 12px; border-radius: 10px; background: var(--bai-deep); border: 1px solid var(--bai-border); color: var(--bai-text-secondary); font: inherit; font-size: 13px; line-height: 1.55; resize: none; outline: none; overflow: hidden; min-height: 3.5rem; }
.note-ed .desc:focus { border-color: var(--bai-accent); }
.note-ed .descfoot { display: flex; align-items: center; gap: 8px; margin-top: 5px; }
.note-ed .descfoot .lbl { flex: 1; font-size: 11px; color: var(--bai-text-faint); }
.note-ed .budget { font-size: 11px; font-variant-numeric: tabular-nums; color: var(--bai-text-muted); }
.note-ed .budget.near { color: var(--bai-warn); }
.note-ed .topicrow { margin-top: 14px; }

.note-ed .tabs { display: flex; align-items: center; margin: 18px -20px 0; padding: 0 20px; border-bottom: 1px solid var(--bai-border); }
.note-ed .tabs button.tab { border: 0; background: none; margin: 0 24px -1px 0; padding: 9px 2px 11px; font-size: 13.5px; font-weight: 500; color: var(--bai-text-muted); border-bottom: 2px solid transparent; display: inline-flex; align-items: center; gap: 7px; cursor: pointer; }
.note-ed .tabs button.tab:hover { color: var(--bai-text-secondary); }
.note-ed .tabs button.tab.on { color: var(--bai-accent); border-bottom-color: var(--bai-accent); }
.note-ed .tabs .count { padding: 1px 6px; border-radius: 999px; background: var(--bai-hover); color: var(--bai-text-tertiary); font-size: 10.5px; font-weight: 600; }
.note-ed .tabs button.tab.on .count { background: var(--bai-accent-soft); color: var(--bai-accent); }
.note-ed .tabs .spacer { flex: 1; }
.note-ed .modetoggle { margin-bottom: 6px; border: 0; border-radius: 7px; padding: 4px 10px; background: var(--bai-hover); color: var(--bai-text-tertiary); font-size: 11.5px; font-weight: 500; cursor: pointer; }
.note-ed .modetoggle:hover { color: var(--bai-text); }
.note-ed .modetoggle.on { background: var(--bai-accent-soft); color: var(--bai-accent); }

/* the body: reading and editing share one surface, so switching moves nothing */
.note-ed .ne-sheet, .note-ed .ne-sheetedit { display: block; width: 100%; max-width: 64rem; margin: 0 auto; padding: 28px 40px; min-height: 40vh; background: var(--bai-deep); border: 1px solid var(--bai-border); border-top: 0; }
.note-ed .ne-sheetedit { color: var(--bai-text); font: 13.5px/1.7 ui-monospace, SFMono-Regular, Menlo, monospace; resize: vertical; outline: none; }
.note-ed .ne-empty { margin: 0; font-style: italic; color: var(--bai-text-faint); font-size: 14px; }

/* where this sits: the graph position, on the page rather than behind a tab */
.note-ed .ne-sits { max-width: 64rem; margin: 0 auto; padding: 16px 20px; background: var(--bai-surface); border: 1px solid var(--bai-border); border-top: 0; border-radius: 0 0 14px 14px; }
.note-ed .ne-sits h4 { margin: 0 0 12px; font-size: 11px; font-weight: 600; color: var(--bai-text-muted); }
.note-ed .ne-sits .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 14px; }
.note-ed .ne-sits .k { font-size: 11px; color: var(--bai-text-faint); }
.note-ed .ne-sits .v { margin-top: 5px; font-size: 12.5px; line-height: 1.55; color: var(--bai-text-secondary); }
.note-ed .ne-sits .v.tallies { margin-top: 8px; }
.note-ed .ne-sits .moclink { display: inline-flex; align-items: center; gap: 6px; margin: 3px 5px 0 0; padding: 3px 9px; border-radius: 7px; background: var(--bai-deep); border: 1px solid var(--bai-border); color: var(--bai-text-secondary); font-size: 12px; text-align: left; cursor: pointer; }
.note-ed .ne-sits .moclink:hover { border-color: var(--bai-accent); color: var(--bai-text); }
.note-ed .ne-sits .moclink b { font-size: 9.5px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--bai-text-faint); }
.note-ed .ne-sits .tally { display: inline-flex; align-items: baseline; gap: 5px; margin-right: 14px; }
.note-ed .ne-sits .tally b { font-size: 17px; font-weight: 600; color: var(--bai-text); font-variant-numeric: tabular-nums; }
.note-ed .ne-sits .tally span { font-size: 11.5px; color: var(--bai-text-muted); }
.note-ed .ne-sits .more { margin: 12px 0 0; padding-top: 11px; border-top: 1px solid var(--bai-border); font-size: 11.5px; color: var(--bai-text-faint); }
.note-ed .ne-sits .more button { border: 0; background: none; padding: 0; color: var(--bai-accent); font-size: 11.5px; cursor: pointer; }

/* the other views continue the card the same way */
.note-ed .ne-view { max-width: 64rem; margin: 0 auto; padding: 22px 20px 40px; background: var(--bai-surface); border: 1px solid var(--bai-border); border-top: 0; border-radius: 0 0 14px 14px; }
.note-ed .ne-plbl { margin: 0 0 10px; font-size: 10px; letter-spacing: .08em; text-transform: uppercase; color: var(--bai-text-faint); }
.note-ed .ne-plbl.mt { margin-top: 26px; }
.note-ed .ne-narr { margin: 10px 0 0; font-size: 11.5px; line-height: 1.6; color: var(--bai-text-muted); }
.note-ed .ne-edge { padding: 11px 13px; margin-bottom: 8px; border-radius: 10px; background: var(--bai-deep); border: 1px solid var(--bai-border); }
.note-ed .ne-edge .top { display: flex; align-items: center; gap: 9px; }
.note-ed .ne-edge .etype { flex: 0 0 auto; padding: 2px 8px; border-radius: 6px; font-size: 10px; font-weight: 600; letter-spacing: .05em; text-transform: uppercase; }
.note-ed .ne-edge .t { flex: 1; min-width: 0; padding: 0; border: 0; background: none; color: var(--bai-text-secondary); font: inherit; font-size: 13px; text-align: left; cursor: pointer; }
.note-ed .ne-edge .t:hover { color: var(--bai-text); text-decoration: underline; }
.note-ed .ne-edge .kind { flex: 0 0 auto; padding: 1px 6px; border-radius: 4px; background: var(--bai-hover); color: var(--bai-text-muted); font-size: 9px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; }
.note-ed .ne-edge .why { display: flex; align-items: flex-start; gap: 7px; margin-top: 7px; font-size: 11.5px; line-height: 1.55; }
.note-ed .ne-edge .why .b { flex: 0 0 auto; color: var(--bai-text-faint); }
.note-ed .ne-edge .why .r { flex: 1; min-width: 0; font-style: italic; color: var(--bai-text-tertiary); }
.note-ed .ne-edge .conf { flex: 0 0 auto; font-size: 10px; }

.note-ed .hgrid { display: grid; grid-template-columns: minmax(0, 1fr) 320px; align-items: start; gap: 0; }
.note-ed .hmain { min-width: 0; display: flex; flex-direction: column; gap: 16px; }
.note-ed .hside { align-self: start; border-left: 1px solid var(--bai-border); padding-left: 16px; max-height: 70vh; display: flex; flex-direction: column; overflow: hidden; }
.note-ed .hside h4 { margin: 0 0 9px; font-size: 11px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--bai-text-muted); }
`;

function timestamp() {
  return new Date().toISOString();
}

export default function Editor() {
  const [document, dispatch] = useSelectedKnowledgeNoteDocument();
  const [view, setView] = useState<"note" | "links" | "details" | "history">(
    "note",
  );
  // The description's 200 characters are the one hard limit in the model, and
  // it was invisible until the field stopped accepting keystrokes.
  const [descLen, setDescLen] = useState<number | null>(null);
  const [descFocused, setDescFocused] = useState(false);
  const [contentMode, setContentMode] = useState<"preview" | "edit">("preview");

  // Links now live in the reactor's DocumentRelationship table; read
  // the current note's outgoing edges from the subgraph projection
  // (already populated drive-wide for the sidebar).
  const { noteMap } = useKnowledgeNotes();
  const { edges, nodeMap } = useGraphMetadata();
  const links: NoteLinkLite[] = useMemo(() => {
    if (!document) return [];
    return noteMap.get(document.header.id)?.links ?? [];
  }, [noteMap, document]);
  // Incoming SUPERSEDES edges: the notes that retired this one, if any.
  const supersededBy = useMemo(
    () =>
      document ? findSupersededBy(noteMap.values(), document.header.id) : [],
    [noteMap, document],
  );

  // Read state optionally here so the callbacks below can be declared
  // unconditionally (rules-of-hooks) even while the doc is still loading.
  const globalState = document?.state.global;
  const stateTitle = globalState?.title;
  const stateDescription = globalState?.description;

  // History is fetched only while its tab is open: passing an empty id
  // keeps the hook mounted (rules-of-hooks) without hitting the reactor.
  const history = useRevisionHistory(
    view === "history" ? (document?.header.id ?? "") : "",
    document?.header.revision.global ?? 0,
    globalState,
    NOTE_REVISION_MODEL,
  );

  // The title textarea grows with its content. Growing it from a `ref` callback
  // meant reading `scrollHeight` and writing `height` on EVERY render — a forced
  // reflow per render, above everything else on the page — and a height change
  // above the scroll anchor is one of the ways a scroll position moves on its
  // own. Measure when the value changes instead.
  const titleRef = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [stateTitle]);

  // The description grows the same way, and for the same reason: 200 characters
  // is three lines at this width on a narrow window, and `rows={2}` clipped the
  // third behind an inner scrollbar the `resize-none` box gave no way to reach.
  const descRef = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = descRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [stateDescription]);

  const handleSetTitle = useCallback(
    (title: string) => {
      if (title && title !== stateTitle) {
        dispatch?.(actions.setTitle({ title, updatedAt: timestamp() }));
      }
    },
    [dispatch, stateTitle],
  );

  const handleSetDescription = useCallback(
    (description: string) => {
      if (description !== (stateDescription ?? "")) {
        dispatch?.(
          actions.setDescription({ description, updatedAt: timestamp() }),
        );
      }
    },
    [dispatch, stateDescription],
  );

  const handleSetNoteType = useCallback(
    (value: string) => {
      const parsed = NoteTypeSchema.safeParse(value);
      if (!parsed.success) return; // only enum values reach the reducer
      dispatch?.(
        actions.setNoteType({ noteType: parsed.data, updatedAt: timestamp() }),
      );
    },
    [dispatch],
  );

  const handleSetContent = useCallback(
    (content: string) => {
      dispatch?.(actions.setContent({ content, updatedAt: timestamp() }));
    },
    [dispatch],
  );

  const handleSetMetadataField = useCallback(
    (field: string, value: string | null) => {
      dispatch?.(
        actions.setMetadataField({
          field,
          value: value ?? undefined,
          updatedAt: timestamp(),
        }),
      );
    },
    [dispatch],
  );

  const handleSetMetadataListField = useCallback(
    (field: string, values: string[]) => {
      dispatch?.(
        actions.setMetadataListField({ field, values, updatedAt: timestamp() }),
      );
    },
    [dispatch],
  );

  // Guard: useSelectedDocumentSafe returns undefined when Connect's
  // local cache doesn't yet have this doc. Show a loading state
  // instead of crashing the render with the error boundary.
  if (!document || !dispatch) {
    return (
      <div
        className="flex h-full items-center justify-center"
        style={{ color: "var(--bai-text-faint)" }}
      >
        <div className="text-center text-sm">
          <div>Loading note…</div>
          <div className="mt-1 text-[11px]">
            If this persists, the document may not have synced from the reactor
            yet — try refreshing.
          </div>
        </div>
      </div>
    );
  }

  const state = document.state.global;
  const graph = neighbourhood(document.header.id, edges, nodeMap);
  const edgeCount = graph.outgoing.length + graph.incoming.length;
  const described = descLen ?? (state.description ?? "").length;

  return (
    <div className="note-ed" data-view={view}>
      <style aria-hidden="true">{STYLES}</style>
      <DocumentToolbar toolbarClassName={TOOLBAR_CLASS} />
      <div className="ne-body">
        <main className="ne-reader">
          <div className="pagewrap">
            <SupersededBanner
              status={state.status ?? null}
              supersededBy={supersededBy}
            />

            <header className="dochead">
              <StatusBar
                status={state.status ?? null}
                provenanceAuthor={state.provenance?.author ?? null}
                hasProvenance={!!state.provenance}
                showActions={view === "details"}
                slot={
                  <select
                    className="chipsel"
                    value={state.noteType ?? ""}
                    onChange={(e) => handleSetNoteType(e.target.value)}
                    aria-label="Note type"
                  >
                    <option value="" disabled>
                      note type…
                    </option>
                    {NOTE_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {noteTypeLabel(t)}
                      </option>
                    ))}
                  </select>
                }
                onSubmitForReview={(id, actor, ts, comment) =>
                  dispatch(
                    actions.submitForReview({
                      id,
                      actor,
                      timestamp: ts,
                      comment,
                    }),
                  )
                }
                onApprove={(id, actor, ts, comment) =>
                  dispatch(
                    actions.approveNote({ id, actor, timestamp: ts, comment }),
                  )
                }
                onReject={(id, actor, ts, comment) =>
                  dispatch(
                    actions.rejectNote({ id, actor, timestamp: ts, comment }),
                  )
                }
                onArchive={(id, actor, ts, comment) =>
                  dispatch(
                    actions.archiveNote({ id, actor, timestamp: ts, comment }),
                  )
                }
                onRestore={(id, actor, ts, comment) =>
                  dispatch(
                    actions.restoreNote({ id, actor, timestamp: ts, comment }),
                  )
                }
              />

              {/* The title is the claim: one declarative sentence a reader can
                  agree or disagree with. It grows with what is typed. */}
              <textarea
                className="claim"
                defaultValue={state.title ?? ""}
                placeholder="State the claim in one sentence…"
                ref={titleRef}
                rows={1}
                onBlur={(e) => handleSetTitle(e.target.value.trim())}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) e.currentTarget.blur();
                }}
                onInput={(e) => {
                  const el = e.currentTarget;
                  el.style.height = "auto";
                  el.style.height = `${el.scrollHeight}px`;
                }}
              />
              <p className="claimhint">
                The title is the claim. One sentence, declarative — a reader
                should be able to agree or disagree with it.
              </p>

              <textarea
                className="desc"
                defaultValue={state.description ?? ""}
                placeholder="What the claim leaves out…"
                maxLength={200}
                rows={2}
                ref={descRef}
                onFocus={() => setDescFocused(true)}
                onInput={(e) => {
                  const el = e.currentTarget;
                  el.style.height = "auto";
                  el.style.height = `${el.scrollHeight}px`;
                  setDescLen(el.value.length);
                }}
                onBlur={(e) => {
                  setDescFocused(false);
                  handleSetDescription(e.target.value.trim());
                }}
              />
              <div className="descfoot">
                <span className="lbl">
                  The description adds what the claim leaves out — it is what
                  search and the agent read first.
                </span>
                {descFocused && (
                  <span className={described > 170 ? "budget near" : "budget"}>
                    {described} / 200
                  </span>
                )}
              </div>

              <div className="topicrow">
                <TopicsBar
                  topics={state.topics}
                  editable={contentMode === "edit"}
                  onAddTopic={(id, name) =>
                    dispatch(actions.addTopic({ id, name }))
                  }
                  onRemoveTopic={(id) => dispatch(actions.removeTopic({ id }))}
                />
              </div>

              <div className="tabs">
                {(
                  [
                    ["note", "Note", null],
                    ["links", "Links", edgeCount],
                    ["details", "Details", null],
                    ["history", "History", null],
                  ] as const
                ).map(([key, label, count]) => (
                  <button
                    key={key}
                    type="button"
                    className={view === key ? "tab on" : "tab"}
                    aria-label={
                      count !== null && count > 0
                        ? `${label}, ${count}`
                        : label
                    }
                    onClick={() => setView(key)}
                  >
                    {label}
                    {count !== null && count > 0 && (
                      <span className="count">{count}</span>
                    )}
                  </button>
                ))}
                <span className="spacer" />
                {view === "note" && (
                  <button
                    type="button"
                    className={
                      contentMode === "edit" ? "modetoggle on" : "modetoggle"
                    }
                    onClick={() =>
                      setContentMode(
                        contentMode === "edit" ? "preview" : "edit",
                      )
                    }
                  >
                    {contentMode === "edit" ? "Done" : "Edit"}
                  </button>
                )}
              </div>
            </header>

            {view === "note" &&
              (contentMode === "preview" ? (
                // Read-only on purpose: a click handler here made selecting
                // text or following a link swap the note for a textarea, so it
                // could not be read calmly. Only the Edit button changes mode.
                <div className="ne-sheet">
                  {state.content ? (
                    <MarkdownPreview content={state.content} scale="reading" />
                  ) : (
                    <p className="ne-empty">
                      No content yet — choose Edit to start writing.
                    </p>
                  )}
                </div>
              ) : (
                <textarea
                  className="ne-sheetedit"
                  defaultValue={state.content ?? ""}
                  placeholder="Write your note content here... (supports markdown)"
                  rows={20}
                  autoFocus
                  onBlur={(e) => {
                    handleSetContent(e.target.value);
                    setContentMode("preview");
                  }}
                />
              ))}

            {view === "note" && (
              <WhereThisSits
                graph={graph}
                onOpenLinks={() => setView("links")}
              />
            )}

            {view === "links" && (
              <section className="ne-view">
                <p className="ne-plbl">
                  What this note says about others — {links.length} outgoing
                </p>
                <LinksSection
                  links={links}
                  currentDocId={document.header.id}
                  onAddLink={(
                    _id,
                    targetDocumentId,
                    _targetTitle,
                    linkType,
                    articulation,
                  ) => {
                    // ADD_RELATIONSHIP is a reactor system action (scope:
                    // "document") on the SOURCE document. The reactor
                    // writes one row to DocumentRelationship — with the
                    // articulation as its `metadata` — and the
                    // graph-indexer mirrors both into graph_edges.
                    const metadata = articulationToMetadata(articulation);
                    void dispatchActions(
                      [
                        {
                          id: generateId(),
                          type: "ADD_RELATIONSHIP",
                          scope: "document",
                          timestampUtcMs: timestamp(),
                          input: {
                            sourceId: document.header.id,
                            targetId: targetDocumentId,
                            relationshipType: linkType,
                            ...(metadata ? { metadata } : {}),
                          },
                        } as never,
                      ],
                      document.header.id,
                    );
                  }}
                  onArticulate={(id, articulation) => {
                    // UPDATE_RELATIONSHIP replaces the edge's metadata in
                    // place, keeping its createdAt ordering.
                    const link = links.find((l) => l.id === id);
                    if (!link?.targetDocumentId) return;
                    void dispatchActions(
                      [
                        {
                          id: generateId(),
                          type: "UPDATE_RELATIONSHIP",
                          scope: "document",
                          timestampUtcMs: timestamp(),
                          input: {
                            sourceId: document.header.id,
                            targetId: link.targetDocumentId,
                            relationshipType: link.linkType ?? "RELATES_TO",
                            metadata:
                              articulationToMetadata(articulation) ?? null,
                          },
                        } as never,
                      ],
                      document.header.id,
                    );
                  }}
                  onRemoveLink={(id) => {
                    // The subgraph link id is composite: `${source}-${target}-${type}`.
                    // Extract the parts so we can issue the corresponding
                    // REMOVE_RELATIONSHIP with the right args.
                    const link = links.find((l) => l.id === id);
                    if (!link?.targetDocumentId) return;
                    void dispatchActions(
                      [
                        {
                          id: generateId(),
                          type: "REMOVE_RELATIONSHIP",
                          scope: "document",
                          timestampUtcMs: timestamp(),
                          input: {
                            sourceId: document.header.id,
                            targetId: link.targetDocumentId,
                            relationshipType: link.linkType ?? "RELATES_TO",
                          },
                        } as never,
                      ],
                      document.header.id,
                    );
                  }}
                  onUpdateLinkType={(id, linkType) => {
                    // The type is part of the relationship's identity
                    // (source, target, type), so a type change is remove +
                    // add. UPDATE_RELATIONSHIP only touches metadata. The
                    // articulation travels with the pair.
                    const link = links.find((l) => l.id === id);
                    if (!link?.targetDocumentId) return;
                    const now = timestamp();
                    const metadata = articulationToMetadata({
                      reason: link.reason ?? "",
                      confidence: isEdgeConfidence(link.confidence)
                        ? link.confidence
                        : null,
                    });
                    void dispatchActions(
                      [
                        {
                          id: generateId(),
                          type: "REMOVE_RELATIONSHIP",
                          scope: "document",
                          timestampUtcMs: now,
                          input: {
                            sourceId: document.header.id,
                            targetId: link.targetDocumentId,
                            relationshipType: link.linkType ?? "RELATES_TO",
                          },
                        } as never,
                        {
                          id: generateId(),
                          type: "ADD_RELATIONSHIP",
                          scope: "document",
                          timestampUtcMs: now,
                          input: {
                            sourceId: document.header.id,
                            targetId: link.targetDocumentId,
                            relationshipType: linkType,
                            ...(metadata ? { metadata } : {}),
                          },
                        } as never,
                      ],
                      document.header.id,
                    );
                  }}
                />
                <IncomingLinks graph={graph} />
              </section>
            )}

            {view === "details" && (
              <section className="ne-view">
                <p className="ne-plbl">Provenance</p>
                <ProvenanceInfo
                  provenance={state.provenance ?? null}
                  onSetProvenance={(author, sourceOrigin) =>
                    dispatch(
                      actions.setProvenance({
                        author,
                        sourceOrigin,
                        // createdAt is immutable once set: pass it back
                        createdAt: state.provenance?.createdAt ?? timestamp(),
                      }),
                    )
                  }
                />
                <p className="ne-plbl mt">Metadata</p>
                <MetadataPanel
                  state={state}
                  onSetField={handleSetMetadataField}
                  onSetListField={handleSetMetadataListField}
                />
              </section>
            )}

            {view === "history" && (
              <section className="ne-view">
                <div className="hgrid">
                  <div className="hmain">
                    <RevisionScrubber history={history} />
                    <RevisionSnapshotPanel history={history} />
                  </div>
                  <aside className="hside">
                    {state.lifecycleEvents.length > 0 && (
                      <div className="shrink-0">
                        <h4>Lifecycle</h4>
                        <LifecycleTimeline events={state.lifecycleEvents} />
                        <hr
                          className="mb-4 mt-2"
                          style={{ borderColor: "var(--bai-border)" }}
                        />
                      </div>
                    )}
                    <RevisionOperationList history={history} />
                  </aside>
                </div>
              </section>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
