import { useEffect, useRef, useState } from "react";
import { DocumentToolbar } from "@powerhousedao/design-system/connect";
import { useSelectedSourceDocument, actions } from "document-models/source";
import { MarkdownPreview } from "../shared/markdown-preview.js";
import {
  OriginalFileRow,
  OriginalFileViewer,
} from "../knowledge-vault/components/OriginalFilePanel.js";
import { formatFileSize } from "../knowledge-vault/lib/mime.js";
import {
  useAttachmentLoader,
  useAttachmentPort,
} from "../knowledge-vault/lib/attachments.js";
import {
  setSelectedNode,
  useFileNodesInSelectedDrive,
} from "@powerhousedao/reactor-browser";
import { useVaultDocIndex } from "../shared/use-vault-doc-index.js";
import { generateId } from "document-model/core";
import { usePipelineQueueDocumentById } from "document-models/pipeline-queue";
import { actions as pipelineActions } from "document-models/pipeline-queue";
import { TOOLBAR_CLASS } from "../shared/theme-context.js";
import {
  RevisionOperationList,
  RevisionScrubber,
  RevisionSnapshotPanel,
} from "../shared/revision-history.js";
import { useRevisionHistory } from "../shared/use-revision-history.js";
import { SOURCE_REVISION_MODEL } from "./lib/revision-model.js";

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

type SourceStatus = "INBOX" | "EXTRACTING" | "EXTRACTED" | "ARCHIVED";

/** The pill only reports; these are its tones, from the vault's own tokens. */
const PILL_TONE: Record<SourceStatus, { background: string; color: string }> = {
  INBOX: { background: "var(--bai-hover)", color: "var(--bai-text-tertiary)" },
  EXTRACTING: { background: "var(--bai-warn-soft)", color: "var(--bai-warn)" },
  EXTRACTED: { background: "var(--bai-ok-soft)", color: "var(--bai-ok)" },
  ARCHIVED: { background: "var(--bai-hover)", color: "var(--bai-text-muted)" },
};

/**
 * Mirrors `ALLOWED_TRANSITIONS` in the source reducer. A select that offered
 * every status looked as though it worked and silently did nothing: the
 * reducer throws `InvalidSourceStatusTransitionError`, which is recorded on
 * the operation and leaves the state alone. Only reachable statuses are
 * offered, so the control never lies about what it can do.
 */
const NEXT_STATUS: Record<SourceStatus, readonly SourceStatus[]> = {
  INBOX: ["EXTRACTING", "ARCHIVED"],
  EXTRACTING: ["EXTRACTED", "INBOX", "ARCHIVED"],
  EXTRACTED: ["ARCHIVED", "EXTRACTING"],
  ARCHIVED: ["INBOX"],
};

type View = "content" | "history" | "details" | "edit";
type DetailTab = "claims" | "prov" | "extr";

function ts() {
  return new Date().toISOString();
}

function formatWhen(value?: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

/**
 * The design's stylesheet (docs/design/source-editor/final.html), scoped to
 * this editor. Two things it settles that the mock left open:
 *
 * - The **sheet** is full-bleed but the **prose inside it** is held to 78ch —
 *   the mock draws the first and the README argues for the second, and both
 *   are true at once: the page is the reading surface, the lines are not.
 * - The **toolbar is Connect's**, untouched, sitting above a body that owns
 *   its own scroll — which is what lets the progress line mean anything.
 */
const STYLES = `
.src-ed { height: 100%; display: flex; flex-direction: column; background: var(--bai-bg); color: var(--bai-text); }
.src-ed .src-body { position: relative; flex: 1; min-height: 0; display: flex; }
.src-ed .src-reader { flex: 1; min-width: 0; overflow-y: auto; }
.src-ed .src-progress { position: absolute; top: 0; left: 0; z-index: 7; height: 2px; background: var(--bai-accent); }
.src-ed .pagewrap { padding: 0 26px 64px; }
/* History and Details continue the header card as one surface: the card loses
   its bottom rounding and border, and the view picks them up. No gap, no seam
   — the tabs' own rule is the divider. */
.src-ed .history, .src-ed .detailsview { margin-top: 0; }

.src-ed .dochead { max-width: 64rem; margin: 20px auto 0; padding: 18px 20px 0; background: var(--bai-surface); border: 1px solid var(--bai-border); border-radius: 14px; overflow: hidden; }
.src-ed[data-view="history"] .dochead, .src-ed[data-view="details"] .dochead { border-radius: 14px 14px 0 0; border-bottom: 0; }
.src-ed .headrow { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.src-ed .pill { display: inline-flex; align-items: center; gap: 6px; padding: 4px 12px; border-radius: 999px; font-size: 11.5px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; }
.src-ed .chip { display: inline-flex; align-items: center; padding: 4px 10px; border-radius: 7px; font-size: 11.5px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; background: var(--bai-hover); color: var(--bai-text-tertiary); }
.src-ed .cta { display: inline-flex; align-items: center; gap: 7px; padding: 4px 10px; border-radius: 7px; background: none; border: 1px dashed var(--bai-border); color: var(--bai-text-secondary); font-size: 12px; cursor: pointer; }
.src-ed .cta:hover { border-color: var(--bai-accent); color: var(--bai-text); }
.src-ed .cta b { font-size: 10px; font-weight: 600; letter-spacing: .05em; text-transform: uppercase; color: var(--bai-text-faint); }
.src-ed .cta:hover b { color: var(--bai-accent); }
.src-ed .hbtn { display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; border-radius: 8px; background: var(--bai-hover); border: 1px solid transparent; color: var(--bai-text-tertiary); font-size: 12.5px; cursor: pointer; }
.src-ed .hbtn:hover { background: var(--bai-border); color: var(--bai-text); }
.src-ed .hbtn.primary { background: var(--bai-accent); border-color: var(--bai-accent); color: var(--bai-accent-text); font-weight: 600; }
.src-ed .hbtn.primary:hover { filter: brightness(1.07); }
.src-ed .queued { font-size: 12.5px; color: var(--bai-ok); }
.src-ed .dochead h1 { margin: 14px 0 0; font-size: 27px; line-height: 1.22; font-weight: 700; color: var(--bai-text); }
.src-ed .tabs { display: flex; margin: 18px -20px 0; padding: 0 20px; border-bottom: 1px solid var(--bai-border); }
.src-ed .tabs button { border: 0; background: none; margin: 0 24px -1px 0; padding: 9px 2px 11px; font-size: 13.5px; font-weight: 500; color: var(--bai-text-muted); border-bottom: 2px solid transparent; cursor: pointer; }
.src-ed .tabs button:hover { color: var(--bai-text-secondary); }
.src-ed .tabs button.on { color: var(--bai-accent); border-bottom-color: var(--bai-accent); }

/* The reading surface and the editing surface are the same sheet: same width,
   same padding, same ground. Switching between Content and Edit then moves
   nothing on the page — the text stays exactly where the eye left it.
   The ground is --bai-deep, a step below the header card's --bai-surface:
   sharing the card's tone left the page with no separation at all, the two
   reading as one flat panel.

   The sheet is a div, not an <article>, on purpose. style.css normalises
   unknown markup inside a bai/* editor with a rule that forces every article
   to background-color: var(--bai-bg) !important, which repainted the reading
   surface in the page's own colour
   while the textarea beside it — not an article — kept the right one. An
   !important on a bare element cannot be outbid from here, so the sheet stays
   out of its way. */
.src-ed .src-sheet, .src-ed .mdedit { width: 100%; margin: 16px 0 0; padding: 32px 48px; border-radius: 16px; min-height: 60vh; background: var(--bai-deep); border: 1px solid var(--bai-border); }
.src-ed .empty { margin: 0; color: var(--bai-text-muted); font-size: 14px; }

.src-ed .editmeta { width: 100%; margin: 16px auto 0; max-width: 64rem; }
.src-ed .em-row { display: flex; align-items: center; gap: 10px; margin-bottom: 9px; }
.src-ed .em-row label { flex: 0 0 auto; width: 74px; font-size: 11px; color: var(--bai-text-faint); }
.src-ed .em-row input, .src-ed .em-row select { flex: 1; min-width: 0; padding: 6px 9px; border-radius: 8px; background: var(--bai-surface); border: 1px solid var(--bai-border); color: var(--bai-text); font: inherit; font-size: 12.5px; }
.src-ed .em-row input:focus, .src-ed .em-row select:focus { outline: none; border-color: var(--bai-accent); }
.src-ed .em-foot { display: flex; align-items: center; gap: 10px; margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--bai-border); }
.src-ed .em-foot span { flex: 1; font-size: 11.5px; line-height: 1.5; color: var(--bai-text-muted); }
.src-ed .em-save { padding: 5px 12px; border-radius: 7px; background: var(--bai-accent); border: 1px solid var(--bai-accent); color: var(--bai-accent-text); font-size: 12.5px; font-weight: 600; cursor: pointer; }
.src-ed .em-save:disabled { background: var(--bai-hover); border-color: var(--bai-border); color: var(--bai-text-faint); cursor: not-allowed; }
.src-ed .em-cancel { padding: 5px 10px; border-radius: 7px; background: var(--bai-surface); border: 1px solid var(--bai-border); color: var(--bai-text-tertiary); font-size: 12.5px; cursor: pointer; }
.src-ed .mdedit { color: var(--bai-text); font: 13.5px/1.7 ui-monospace, SFMono-Regular, Menlo, monospace; resize: vertical; outline: none; }

.src-ed .history, .src-ed .detailsview { max-width: 64rem; margin: 0 auto; border: 1px solid var(--bai-border); border-top: 0; border-radius: 0 0 14px 14px; background: var(--bai-surface); }
.src-ed .detailsview { padding: 0 20px 40px; }
.src-ed .history { padding: 22px 20px 40px; }
.src-ed .hgrid { display: grid; grid-template-columns: minmax(0, 1fr) 336px; align-items: start; gap: 0; }
.src-ed .hmain { min-width: 0; display: flex; flex-direction: column; gap: 16px; }
.src-ed .hside { align-self: start; border-left: 1px solid var(--bai-border); padding-left: 16px; max-height: 70vh; display: flex; flex-direction: column; overflow: hidden; }
.src-ed .dhead { display: flex; gap: 2px; padding: 18px 0 0; border-bottom: 1px solid var(--bai-border); }
.src-ed .dhead button { padding: 7px 10px; border: 0; background: none; color: var(--bai-text-tertiary); font-size: 12px; border-bottom: 2px solid transparent; cursor: pointer; }
.src-ed .dhead button.on { color: var(--bai-text); border-bottom-color: var(--bai-accent); }
.src-ed .dhead button span { color: var(--bai-text-faint); margin-left: 4px; }
.src-ed .pane { padding: 20px 0 0; }
.src-ed .plbl { margin: 0 0 10px; font-size: 10px; letter-spacing: .08em; text-transform: uppercase; color: var(--bai-text-faint); }
.src-ed .claim { display: block; width: 100%; text-align: left; padding: 11px 12px; margin-bottom: 8px; border-radius: 10px; background: var(--bai-deep); border: 1px solid var(--bai-border); color: var(--bai-text-secondary); font-size: 13px; cursor: pointer; }
.src-ed .claim:hover { border-color: var(--bai-accent); color: var(--bai-text); }
.src-ed .claim .meta { display: block; margin-top: 3px; font-size: 11px; color: var(--bai-text-faint); }
.src-ed .row { display: flex; justify-content: space-between; gap: 12px; padding: 7px 0; border-bottom: 1px solid var(--bai-border); font-size: 12.5px; }
.src-ed .row dt { color: var(--bai-text-muted); margin: 0; flex: 0 0 auto; }
.src-ed .row dd { margin: 0; min-width: 0; color: var(--bai-text-secondary); text-align: right; word-break: break-word; }
.src-ed .row dd a { color: var(--bai-accent); text-decoration: none; }
.src-ed .row dd a:hover { text-decoration: underline; }
.src-ed .att-row { margin-top: 10px; padding: 12px; border-radius: 10px; background: var(--bai-deep); border: 1px solid var(--bai-border); }
.src-ed .att-row .fn { font-size: 12.5px; color: var(--bai-text-secondary); word-break: break-all; }
.src-ed .att-row .fm { font-size: 11px; color: var(--bai-text-faint); margin-top: 3px; }
.src-ed .narr { margin: 10px 0 0; font-size: 12px; color: var(--bai-text-muted); line-height: 1.6; }
.src-ed .selrow { display: flex; align-items: center; justify-content: space-between; margin-top: 16px; padding-top: 14px; border-top: 1px solid var(--bai-border); }
.src-ed .selrow label { font-size: 12px; color: var(--bai-text-muted); }
.src-ed .selrow select { background: var(--bai-surface); border: 1px solid var(--bai-border); color: var(--bai-text-secondary); border-radius: 7px; padding: 4px 8px; font: inherit; font-size: 12px; }

.src-ed .overlay { position: fixed; inset: 0; z-index: 50; }
.src-ed .scrim { position: absolute; inset: 0; background: rgba(0,0,0,.6); }
.src-ed .sheet { position: relative; z-index: 10; margin: 4vh auto 0; width: min(880px, 92vw); max-height: 88vh; display: flex; flex-direction: column; border-radius: 16px; background: var(--bai-surface); border: 1px solid var(--bai-border); box-shadow: 0 25px 50px -12px rgba(0,0,0,.6); }
.src-ed .sheet header { display: flex; align-items: center; gap: 10px; padding: 14px 18px; border-bottom: 1px solid var(--bai-border); }
.src-ed .sheet header .t { font-size: 13px; color: var(--bai-text); }
.src-ed .sheet header .f { font-size: 11.5px; color: var(--bai-text-faint); }
.src-ed .sheet header .x { margin-left: auto; width: 28px; height: 28px; border-radius: 8px; background: var(--bai-bg); border: 1px solid var(--bai-border); color: var(--bai-text-tertiary); cursor: pointer; }
.src-ed .sheet .body2 { padding: 18px; overflow-y: auto; }

.src-ed .iform { max-width: 660px; margin: 0 auto; padding: 40px 32px 80px; }
.src-ed .iform h2 { margin: 0 0 6px; font-size: 19px; color: var(--bai-text); font-weight: 600; }
.src-ed .iform .lede { margin: 0 0 26px; font-size: 13px; color: var(--bai-text-tertiary); line-height: 1.6; }
.src-ed .iform label { display: block; font-size: 12px; color: var(--bai-text-tertiary); margin: 0 0 6px; }
.src-ed .iform input, .src-ed .iform select, .src-ed .iform textarea { width: 100%; padding: 9px 11px; border-radius: 9px; background: var(--bai-bg); border: 1px solid var(--bai-border); color: var(--bai-text); font: inherit; font-size: 13.5px; }
.src-ed .iform textarea { min-height: 240px; resize: vertical; font-size: 13px; line-height: 1.6; }
.src-ed .iform .two { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 16px; }
.src-ed .iform .one { margin-bottom: 16px; }
.src-ed .iform .foot { display: flex; align-items: center; gap: 12px; margin-top: 22px; }
.src-ed .iform button.submit { padding: 8px 16px; border-radius: 9px; background: var(--bai-accent); border: 1px solid var(--bai-accent); color: var(--bai-accent-text); font-size: 13px; font-weight: 600; cursor: pointer; }
.src-ed .iform button.submit:disabled { background: var(--bai-hover); border-color: var(--bai-border); color: var(--bai-text-faint); cursor: not-allowed; }
.src-ed .iform .hint { font-size: 11.5px; color: var(--bai-text-faint); }
`;

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
  const [view, setView] = useState<View>("content");
  const [detailTab, setDetailTab] = useState<DetailTab>("claims");
  const [viewerOpen, setViewerOpen] = useState(false);
  const [progress, setProgress] = useState(0);
  const reader = useRef<HTMLDivElement>(null);

  // History is fetched only while its tab is open: passing an empty id
  // keeps the hook mounted (rules-of-hooks) without hitting the reactor.
  const history = useRevisionHistory(
    view === "history" ? document.header.id : "",
    document.header.revision.global ?? 0,
    state,
    SOURCE_REVISION_MODEL,
  );

  // Resolve extracted claim PHIDs → titles via the lightweight index
  // (subgraph + drive tree) instead of loading full document states.
  const { byId } = useVaultDocIndex();
  // The original the source was converted from, when there is one. Installed
  // at mount so the client resolved by this render is the one the panel uses.
  const loadOriginal = useAttachmentLoader();
  // Manual attach/re-attach: the same hash-first port the intake batch uses,
  // but dispatched straight onto this document rather than through
  // `POST actions` — a source whose original was lost or never attached (the
  // intake's publish step degrades gracefully when the attachment step
  // fails) is not stuck that way.
  const attachOriginal = useAttachmentPort();
  const [attaching, setAttaching] = useState(false);
  const [attachError, setAttachError] = useState<string | undefined>(undefined);
  const handleAttach = (file: File) => {
    setAttaching(true);
    setAttachError(undefined);
    void (async () => {
      try {
        const prepared = await attachOriginal.prepare({
          name: file.name,
          mimeType: file.type || "application/octet-stream",
          bytes: new Uint8Array(await file.arrayBuffer()),
        });
        dispatch(
          actions.attachOriginalFile({
            // The port returns the ref as a plain string (it also serves the
            // REST publish path, which sends it as JSON); the branded format
            // (`attachment://v<n>:<hex>`) is what the attachment service
            // actually produces, so the cast reflects a real invariant.
            originalFile: prepared.ref as NonNullable<
              typeof state.originalFile
            >,
            originalFileName: file.name,
            originalMimeType: file.type || "application/octet-stream",
            originalSizeBytes: file.size,
            convertedBy: null,
            attachedAt: new Date().toISOString(),
          }),
        );
        await attachOriginal.upload(prepared);
      } catch (error) {
        setAttachError(error instanceof Error ? error.message : String(error));
      } finally {
        setAttaching(false);
      }
    })();
  };

  // Esc returns to the content — the viewer first, so one press never skips a
  // level. Ignored while a field has focus, so it cannot interrupt typing, and
  // it never calls preventDefault, so Connect's own handlers still see it.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (viewerOpen) setViewerOpen(false);
      else setView("content");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [viewerOpen]);

  if (!initialized) {
    return <IngestForm dispatch={dispatch} />;
  }

  const stats = state.extractionStats;
  const status = (state.status ?? "INBOX") as SourceStatus;
  const claims = state.extractedClaims ?? [];
  const attachments = state.attachments ?? [];

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

  const canQueue = status === "INBOX" && !!pipelineDispatch && !queued;

  const onScroll = () => {
    const el = reader.current;
    if (!el) return;
    const max = el.scrollHeight - el.clientHeight;
    setProgress(max > 0 ? (el.scrollTop / max) * 100 : 0);
  };

  const go = (next: View) => {
    setView(next);
    reader.current?.scrollTo({ top: 0 });
  };

  return (
    <div className="src-ed" data-view={view}>
      <style>{STYLES}</style>
      <DocumentToolbar toolbarClassName={TOOLBAR_CLASS} />
      <div className="src-body">
        <span className="src-progress" style={{ width: `${progress}%` }} />
        <main className="src-reader" ref={reader} onScroll={onScroll}>
          <div className="pagewrap">
            <header className="dochead">
              <div className="headrow">
                <span className="pill" style={PILL_TONE[status]}>
                  {status}
                </span>
                {state.sourceType && (
                  <span className="chip">{state.sourceType}</span>
                )}
                <button
                  type="button"
                  className="cta"
                  onClick={() => {
                    setDetailTab("claims");
                    go("details");
                  }}
                >
                  See what it produced{" "}
                  <b>
                    {claims.length} {claims.length === 1 ? "note" : "notes"}
                  </b>
                </button>
                <span style={{ flex: 1 }} />
                {canQueue && (
                  <button
                    type="button"
                    className="hbtn primary"
                    onClick={handleQueueForProcessing}
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                    >
                      <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
                    </svg>
                    Queue for processing
                  </button>
                )}
                {queued && (
                  <span className="queued">
                    Queued — run /pipeline in Claude Code
                  </span>
                )}
              </div>

              <h1>{state.title}</h1>

              <OriginalFileRow
                source={state}
                load={loadOriginal}
                onView={() => setViewerOpen(true)}
                onAttach={handleAttach}
                attaching={attaching}
                attachError={attachError}
              />

              <div className="tabs">
                {(
                  [
                    ["content", "Content"],
                    ["history", "History"],
                    ["details", "Details"],
                    ["edit", "Edit"],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    className={view === key ? "on" : undefined}
                    onClick={() => go(key)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </header>

            {view === "content" && (
              <div className="src-sheet">
                {state.content ? (
                  <MarkdownPreview content={state.content} scale="reading" />
                ) : (
                  <p className="empty">No content</p>
                )}
              </div>
            )}

            {view === "edit" && (
              <EditInPlace
                state={state}
                dispatch={dispatch}
                onDone={() => go("content")}
              />
            )}

            {view === "history" && (
              <section className="history">
                <div className="hgrid">
                  <div className="hmain">
                    <RevisionScrubber history={history} />
                    <RevisionSnapshotPanel history={history} />
                  </div>
                  <aside className="hside">
                    <RevisionOperationList history={history} />
                  </aside>
                </div>
              </section>
            )}

            {view === "details" && (
              <section className="detailsview">
                <div className="dhead">
                  {(
                    [
                      ["claims", "Claims", claims.length],
                      ["prov", "Provenance", null],
                      ["extr", "Extraction", null],
                    ] as const
                  ).map(([key, label, count]) => (
                    <button
                      key={key}
                      type="button"
                      className={detailTab === key ? "on" : undefined}
                      onClick={() => setDetailTab(key)}
                    >
                      {label}
                      {count !== null && <span>{count}</span>}
                    </button>
                  ))}
                </div>

                {detailTab === "claims" && (
                  <div className="pane">
                    <p className="plbl">Notes derived from this source</p>
                    {claims.length === 0 && (
                      <p className="narr" style={{ marginTop: 0 }}>
                        Nothing has been extracted from this source yet.
                      </p>
                    )}
                    {claims.map((ref) => {
                      const noteTitle = byId.get(ref)?.title ?? null;
                      return (
                        <button
                          key={ref}
                          type="button"
                          className="claim"
                          onClick={() => setSelectedNode(ref)}
                          title={
                            noteTitle
                              ? `Open note: ${noteTitle}`
                              : `Open document: ${ref}`
                          }
                          style={
                            noteTitle
                              ? undefined
                              : { color: "var(--bai-text-muted)" }
                          }
                        >
                          {noteTitle ?? ref}
                          <span className="meta">
                            {noteTitle
                              ? "knowledge note"
                              : "an unresolved reference — this note is not in this drive, so the editor shows the ref it holds"}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}

                {detailTab === "prov" && (
                  <div className="pane">
                    {state.description && (
                      <>
                        <p className="plbl">What this source is</p>
                        <p
                          className="narr"
                          style={{
                            marginTop: 0,
                            marginBottom: 20,
                            fontSize: 12.5,
                            color: "var(--bai-text-tertiary)",
                          }}
                        >
                          {state.description}
                        </p>
                      </>
                    )}

                    <p className="plbl">Where it came from</p>
                    <dl style={{ margin: 0 }}>
                      <Row label="Source type" value={state.sourceType} />
                      <Row label="Author" value={state.provenance?.author} />
                      <Row
                        label="Published"
                        value={formatWhen(state.provenance?.publishedAt)}
                      />
                      <Row
                        label="URL"
                        value={state.provenance?.url}
                        href={state.provenance?.url}
                      />
                      <Row label="Method" value={state.provenance?.method} />
                      <Row label="Tool" value={state.provenance?.tool} />
                    </dl>

                    <p className="plbl" style={{ margin: "18px 0 0" }}>
                      Who put it here
                    </p>
                    <dl style={{ margin: 0 }}>
                      <Row label="Ingested by" value={state.createdBy} />
                      <Row
                        label="Ingested"
                        value={formatWhen(state.createdAt)}
                      />
                    </dl>

                    <p className="plbl" style={{ margin: "18px 0 0" }}>
                      The text itself
                    </p>
                    <dl style={{ margin: 0 }}>
                      <Row
                        label="Characters"
                        value={(state.content ?? "").length.toLocaleString()}
                      />
                      <Row label="Converted by" value={state.convertedBy} />
                    </dl>
                    <p className="narr">
                      The character count is counted from the text, not stored —
                      the model keeps the text, not a size for it.
                    </p>

                    {attachments.length > 0 && (
                      <>
                        <p className="plbl" style={{ margin: "18px 0 0" }}>
                          Attachments — the parts of the page the text points at
                        </p>
                        {attachments.map((a) => (
                          <div className="att-row" key={a.id}>
                            <div className="fn">
                              {a.fileName ?? a.id}
                              {a.role ? ` · ${a.role}` : ""}
                            </div>
                            <div className="fm">
                              {[
                                a.page ? `page ${a.page}` : null,
                                a.mimeType,
                                a.sizeBytes
                                  ? formatFileSize(a.sizeBytes)
                                  : null,
                                a.width && a.height
                                  ? `${a.width}×${a.height}`
                                  : null,
                              ]
                                .filter(Boolean)
                                .join(" · ")}
                            </div>
                            {a.alt && <div className="fm">alt: “{a.alt}”</div>}
                          </div>
                        ))}
                        <p className="narr">
                          Listed here to be checkable — every figure cut out of
                          the original accounted for. They are not drawn here:
                          they render in the text, at the paragraph that
                          references them.
                        </p>
                      </>
                    )}

                    <p className="plbl" style={{ margin: "18px 0 0" }}>
                      Original document
                    </p>
                    <OriginalFileRow
                      source={state}
                      load={loadOriginal}
                      onView={() => setViewerOpen(true)}
                      onAttach={handleAttach}
                      attaching={attaching}
                      attachError={attachError}
                    />
                    {state.originalAttachedAt && (
                      <p className="narr">
                        Attached {formatWhen(state.originalAttachedAt)}. The
                        bytes are not fetched until you ask.
                      </p>
                    )}
                  </div>
                )}

                {detailTab === "extr" && (
                  <div className="pane">
                    <p className="plbl">What extraction did</p>
                    {stats ? (
                      <>
                        <dl style={{ margin: 0 }}>
                          <Row
                            label="Claims"
                            value={String(stats.claimCount)}
                          />
                          <Row
                            label="Skipped"
                            value={String(stats.skippedCount)}
                          />
                          <Row
                            label="Skip rate"
                            value={`${(stats.skipRate * 100).toFixed(1)}%`}
                          />
                          <Row
                            label="Extracted"
                            value={formatWhen(stats.extractedAt)}
                          />
                          <Row label="Extracted by" value={stats.extractedBy} />
                        </dl>
                        <p className="narr">
                          {stats.skippedCount} of{" "}
                          {stats.claimCount + stats.skippedCount} passages were
                          not taken. That is a measurement, not a shortfall — a
                          recap chapter can genuinely yield nothing.
                        </p>
                      </>
                    ) : (
                      <p className="narr" style={{ marginTop: 0 }}>
                        This source has not been through extraction yet.
                      </p>
                    )}

                    <div className="selrow">
                      <label htmlFor="src-status">Status</label>
                      <select
                        id="src-status"
                        value={status}
                        onChange={(e) =>
                          dispatch(
                            actions.setSourceStatus({
                              status: e.target.value as SourceStatus,
                            }),
                          )
                        }
                      >
                        <option value={status}>{status}</option>
                        {NEXT_STATUS[status].map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                    </div>
                    <p className="narr">
                      A status change is a rare, deliberate act, so it lives
                      here rather than beside the pill that reports it. Only the
                      statuses this source can actually move to are offered.
                    </p>
                  </div>
                )}
              </section>
            )}
          </div>
        </main>
      </div>

      {viewerOpen && state.originalFile && (
        <div className="overlay" role="dialog" aria-modal="true">
          <div className="scrim" onClick={() => setViewerOpen(false)} />
          <div className="sheet">
            <header>
              <div>
                <div className="t">
                  {state.originalFileName ?? "Original document"}
                </div>
                <div className="f">
                  {[
                    state.originalMimeType,
                    state.originalSizeBytes
                      ? formatFileSize(state.originalSizeBytes)
                      : null,
                    state.convertedBy
                      ? `converted by ${state.convertedBy}`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
              </div>
              <button
                type="button"
                className="x"
                onClick={() => setViewerOpen(false)}
                title="Close"
                aria-label="Close"
              >
                ✕
              </button>
            </header>
            <div className="body2">
              <OriginalFileViewer source={state} load={loadOriginal} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** One `label → value` line in Details; renders nothing when there is no value. */
function Row({
  label,
  value,
  href,
}: {
  label: string;
  value?: string | null;
  href?: string | null;
}) {
  if (!value) return null;
  return (
    <div className="row">
      <dt>{label}</dt>
      <dd>
        {href ? (
          <a href={href} target="_blank" rel="noreferrer" title={value}>
            {value}
          </a>
        ) : (
          value
        )}
      </dd>
    </div>
  );
}

/**
 * Editing, in place. The same fields the full-page form carried, with the
 * header, status, claims and the view switch still on screen.
 *
 * The save is unchanged: `bai/source` has no field-level operation, so an edit
 * is a fresh `INGEST_SOURCE` — whose reducer sets the status back to `INBOX`.
 * Claims, extraction stats, attachments and the original file are untouched by
 * it. The footer says exactly that, rather than promising the status survives.
 */
function EditInPlace({
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
    onDone();
  }

  return (
    <>
      <div className="editmeta">
        <div className="em-row">
          <label htmlFor="ed-title">Title</label>
          <input
            id="ed-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Source title"
          />
          <label htmlFor="ed-type" style={{ width: 40 }}>
            Type
          </label>
          <select
            id="ed-type"
            value={sourceType}
            onChange={(e) => setSourceType(e.target.value)}
          >
            {SOURCE_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <div className="em-row">
          <label htmlFor="ed-desc">Description</label>
          <input
            id="ed-desc"
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            placeholder="Brief description (optional)"
          />
        </div>
        <div className="em-row">
          <label htmlFor="ed-author">Author</label>
          <input
            id="ed-author"
            value={author}
            onChange={(e) => setAuthor(e.target.value)}
            placeholder="Author"
          />
          <label htmlFor="ed-url" style={{ width: 40 }}>
            URL
          </label>
          <input
            id="ed-url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="URL (optional)"
          />
        </div>
        <div className="em-foot">
          <span>
            Claims, extraction stats and the original file are kept. Saving
            re-ingests the text, which returns the source to INBOX so it can be
            processed again.
          </span>
          <button type="button" className="em-cancel" onClick={onDone}>
            Cancel
          </button>
          <button
            type="button"
            className="em-save"
            disabled={!title.trim() || !content.trim()}
            onClick={handleSave}
          >
            Save changes
          </button>
        </div>
      </div>
      <textarea
        className="mdedit"
        spellCheck={false}
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="Source content…"
      />
    </>
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
    <div className="src-ed">
      <style>{STYLES}</style>
      <DocumentToolbar toolbarClassName={TOOLBAR_CLASS} />
      <div className="src-body">
        <main className="src-reader">
          <div className="iform">
            <h2>Add Source Material</h2>
            <p className="lede">
              Paste raw content here — articles, notes, transcripts. The AI
              agent will extract atomic claims from it.
            </p>
            <div className="two">
              <div>
                <label htmlFor="in-title">Title</label>
                <input
                  id="in-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Source title"
                />
              </div>
              <div>
                <label htmlFor="in-type">Source type</label>
                <select
                  id="in-type"
                  value={sourceType}
                  onChange={(e) => setSourceType(e.target.value)}
                >
                  {SOURCE_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="one">
              <label htmlFor="in-desc">Description</label>
              <input
                id="in-desc"
                value={desc}
                onChange={(e) => setDesc(e.target.value)}
                placeholder="Brief description (optional)"
              />
            </div>
            <div className="two">
              <div>
                <label htmlFor="in-author">Author</label>
                <input
                  id="in-author"
                  value={author}
                  onChange={(e) => setAuthor(e.target.value)}
                  placeholder="Author"
                />
              </div>
              <div>
                <label htmlFor="in-url">URL</label>
                <input
                  id="in-url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="URL (optional)"
                />
              </div>
            </div>
            <div className="one">
              <label htmlFor="in-content">Content</label>
              <textarea
                id="in-content"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="Paste source content here..."
              />
            </div>
            <div className="foot">
              <button
                type="button"
                className="submit"
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
              >
                Ingest Source
              </button>
              <span className="hint">Title and content are required.</span>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
