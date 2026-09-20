import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { generateId } from "document-model/core";
import { DocumentToolbar } from "@powerhousedao/design-system/connect";
import {
  setSelectedNode,
  dispatchActions,
} from "@powerhousedao/reactor-browser";
import { useVaultDocIndex } from "../shared/use-vault-doc-index.js";
import { useSelectedMocDocument, actions } from "document-models/moc";
import { TOOLBAR_CLASS } from "../shared/theme-context.js";
import { useKnowledgeMocs } from "../knowledge-vault/hooks/use-knowledge-mocs.js";
import {
  RevisionOperationList,
  RevisionScrubber,
  RevisionSnapshotPanel,
} from "../shared/revision-history.js";
import { useRevisionHistory } from "../shared/use-revision-history.js";
import { MOC_REVISION_MODEL } from "./lib/revision-model.js";

const TIERS = ["HUB", "DOMAIN", "TOPIC"] as const;
const CORE_IDEAS_PREVIEW = 5;

type View = "map" | "details" | "history" | "edit";
type DetailTab = "ideas" | "questions" | "tensions" | "about";

const PILL_TONE: Record<string, { background: string; color: string }> = {
  HUB: { background: "var(--bai-accent)", color: "var(--bai-accent-text)" },
  DOMAIN: { background: "var(--bai-ok-soft)", color: "var(--bai-ok)" },
  TOPIC: { background: "var(--bai-hover)", color: "var(--bai-text-tertiary)" },
};

/**
 * Chrome copied from the source editor so a map and a source occupy the same
 * visual object: header card, underline tabs, sheet that continues the card.
 * Prefix is `.moc-ed` so the two stylesheets never fight if both mount.
 */
const STYLES = `
.moc-ed { height: 100%; display: flex; flex-direction: column; background: var(--bai-bg); color: var(--bai-text); }
.moc-ed .moc-body { position: relative; flex: 1; min-height: 0; display: flex; }
.moc-ed .moc-reader { flex: 1; min-width: 0; overflow-y: auto; }
.moc-ed .moc-progress { position: absolute; top: 0; left: 0; z-index: 7; height: 2px; background: var(--bai-accent); }
.moc-ed .pagewrap { padding: 0 26px 64px; }
.moc-ed .history, .moc-ed .detailsview { margin-top: 0; }

.moc-ed .dochead { max-width: 64rem; margin: 20px auto 0; padding: 18px 20px 0; background: var(--bai-surface); border: 1px solid var(--bai-border); overflow: hidden; border-radius: 14px 14px 0 0; border-bottom: 0; }
.moc-ed .headrow { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.moc-ed .pill { display: inline-flex; align-items: center; gap: 6px; padding: 4px 12px; border-radius: 999px; font-size: 11.5px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; }
.moc-ed .chip { display: inline-flex; align-items: center; padding: 4px 10px; border-radius: 7px; font-size: 11.5px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; background: var(--bai-hover); color: var(--bai-text-tertiary); }
.moc-ed .cta { display: inline-flex; align-items: center; gap: 7px; padding: 4px 10px; border-radius: 7px; background: none; border: 1px dashed var(--bai-border); color: var(--bai-text-secondary); font-size: 12px; cursor: pointer; }
.moc-ed .cta:hover { border-color: var(--bai-accent); color: var(--bai-text); }
.moc-ed .cta b { font-size: 10px; font-weight: 600; letter-spacing: .05em; text-transform: uppercase; color: var(--bai-text-faint); }
.moc-ed .cta:hover b { color: var(--bai-accent); }
.moc-ed .crumb { margin: 12px 0 0; font-size: 12px; color: var(--bai-text-muted); }
.moc-ed .crumb button { background: none; border: 0; padding: 0; color: var(--bai-accent); cursor: pointer; font: inherit; }
.moc-ed .crumb button:hover { text-decoration: underline; }
.moc-ed .dochead h1 { margin: 10px 0 0; font-size: 27px; line-height: 1.22; font-weight: 700; color: var(--bai-text); }
.moc-ed .lede { margin: 8px 0 0; font-size: 13.5px; line-height: 1.5; color: var(--bai-text-tertiary); }
.moc-ed .tabs { display: flex; margin: 18px -20px 0; padding: 0 20px; border-bottom: 1px solid var(--bai-border); }
.moc-ed .tabs button { border: 0; background: none; margin: 0 24px -1px 0; padding: 9px 2px 11px; font-size: 13.5px; font-weight: 500; color: var(--bai-text-muted); border-bottom: 2px solid transparent; cursor: pointer; }
.moc-ed .tabs button:hover { color: var(--bai-text-secondary); }
.moc-ed .tabs button.on { color: var(--bai-accent); border-bottom-color: var(--bai-accent); }

.moc-ed .moc-sheet { display: block; width: 100%; max-width: 64rem; margin: 0 auto; padding: 32px 48px; border-radius: 0 0 14px 14px; min-height: 60vh; background: var(--bai-deep); border: 1px solid var(--bai-border); border-top: 0; }
.moc-ed .empty { margin: 0; color: var(--bai-text-muted); font-size: 14px; }
.moc-ed .plbl { margin: 0 0 12px; font-size: 10px; letter-spacing: .08em; text-transform: uppercase; color: var(--bai-text-faint); }
.moc-ed .orient { margin: 0 0 28px; font-size: 15px; line-height: 1.65; color: var(--bai-text-secondary); text-wrap: pretty; }
.moc-ed .block { margin-top: 28px; }
.moc-ed .block:first-child { margin-top: 0; }

.moc-ed .idea, .moc-ed .child { display: block; width: 100%; text-align: left; padding: 11px 12px; margin-bottom: 8px; border-radius: 10px; background: var(--bai-surface); border: 1px solid var(--bai-border); color: var(--bai-text-secondary); font-size: 13px; cursor: pointer; }
.moc-ed .idea:hover, .moc-ed .child:hover { border-color: var(--bai-accent); color: var(--bai-text); }
.moc-ed .idea .meta, .moc-ed .child .meta { display: block; margin-top: 3px; font-size: 11px; color: var(--bai-text-faint); }
.moc-ed .idea-row { display: flex; align-items: flex-start; gap: 8px; margin-bottom: 8px; }
.moc-ed .idea-row .idea { flex: 1; margin-bottom: 0; }
.moc-ed .x { flex: 0 0 auto; width: 28px; height: 28px; margin-top: 6px; border-radius: 8px; background: transparent; border: 1px solid transparent; color: var(--bai-text-faint); cursor: pointer; opacity: 0; }
.moc-ed .idea-row:hover .x { opacity: 1; }
.moc-ed .x:hover { color: #f38ba8; border-color: var(--bai-border); }
.moc-ed .more { display: block; width: 100%; text-align: left; padding: 8px 2px; border: 0; background: none; color: var(--bai-accent); font-size: 12.5px; font-weight: 500; cursor: pointer; }
.moc-ed .more:hover { text-decoration: underline; }

.moc-ed .add { display: flex; gap: 8px; margin-top: 12px; }
.moc-ed .add input { flex: 1; min-width: 0; padding: 6px 9px; border-radius: 8px; background: var(--bai-surface); border: 1px solid var(--bai-border); color: var(--bai-text); font: inherit; font-size: 12.5px; }
.moc-ed .add input.mono { flex: 0 0 7.5rem; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.moc-ed .add input:focus { outline: none; border-color: var(--bai-accent); }
.moc-ed .add button { padding: 6px 12px; border-radius: 8px; background: var(--bai-accent); border: 1px solid var(--bai-accent); color: var(--bai-accent-text); font-size: 12.5px; font-weight: 600; cursor: pointer; }

.moc-ed .editmeta { width: 100%; max-width: 64rem; margin: 0 auto; padding: 14px 20px; background: var(--bai-surface); border: 1px solid var(--bai-border); border-top: 0; }
.moc-ed .em-row { display: flex; align-items: flex-start; gap: 10px; margin-bottom: 9px; }
.moc-ed .em-row label { padding-top: 7px; flex: 0 0 auto; width: 88px; font-size: 11px; color: var(--bai-text-faint); }
.moc-ed .em-row input, .moc-ed .em-row select, .moc-ed .em-row textarea { flex: 1; min-width: 0; padding: 6px 9px; border-radius: 8px; background: var(--bai-surface); border: 1px solid var(--bai-border); color: var(--bai-text); font: inherit; font-size: 12.5px; }
.moc-ed .em-row textarea { line-height: 1.5; resize: none; overflow: hidden; }
.moc-ed .em-row input:focus, .moc-ed .em-row select:focus, .moc-ed .em-row textarea:focus { outline: none; border-color: var(--bai-accent); }
.moc-ed .em-foot { display: flex; align-items: center; gap: 10px; margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--bai-border); }
.moc-ed .em-foot span { flex: 1; font-size: 11.5px; line-height: 1.5; color: var(--bai-text-muted); }
.moc-ed .em-save { padding: 5px 12px; border-radius: 7px; background: var(--bai-accent); border: 1px solid var(--bai-accent); color: var(--bai-accent-text); font-size: 12.5px; font-weight: 600; cursor: pointer; }
.moc-ed .em-save:disabled { background: var(--bai-hover); border-color: var(--bai-border); color: var(--bai-text-faint); cursor: not-allowed; }
.moc-ed .em-cancel { padding: 5px 10px; border-radius: 7px; background: var(--bai-surface); border: 1px solid var(--bai-border); color: var(--bai-text-tertiary); font-size: 12.5px; cursor: pointer; }
.moc-ed .mdedit { display: block; width: 100%; max-width: 64rem; margin: 0 auto; padding: 32px 48px; border-radius: 0 0 14px 14px; min-height: 60vh; background: var(--bai-deep); border: 1px solid var(--bai-border); border-top: 0; color: var(--bai-text); font: 15px/1.65 ui-sans-serif, system-ui, sans-serif; resize: vertical; outline: none; }

.moc-ed .history, .moc-ed .detailsview { max-width: 64rem; margin: 0 auto; border: 1px solid var(--bai-border); border-top: 0; border-radius: 0 0 14px 14px; background: var(--bai-surface); }
.moc-ed .detailsview { padding: 0 20px 40px; }
.moc-ed .history { padding: 22px 20px 40px; }
.moc-ed .hgrid { display: grid; grid-template-columns: minmax(0, 1fr) 336px; align-items: start; gap: 0; }
.moc-ed .hmain { min-width: 0; display: flex; flex-direction: column; gap: 16px; }
.moc-ed .hside { align-self: start; border-left: 1px solid var(--bai-border); padding-left: 16px; max-height: 70vh; display: flex; flex-direction: column; overflow: hidden; }
.moc-ed .dhead { display: flex; gap: 2px; padding: 18px 0 0; border-bottom: 1px solid var(--bai-border); }
.moc-ed .dhead button { padding: 7px 10px; border: 0; background: none; color: var(--bai-text-tertiary); font-size: 12px; border-bottom: 2px solid transparent; cursor: pointer; }
.moc-ed .dhead button.on { color: var(--bai-text); border-bottom-color: var(--bai-accent); }
.moc-ed .dhead button span { color: var(--bai-text-faint); margin-left: 4px; }
.moc-ed .pane { padding: 20px 0 0; }
.moc-ed .row { display: flex; justify-content: space-between; gap: 12px; padding: 7px 0; border-bottom: 1px solid var(--bai-border); font-size: 12.5px; }
.moc-ed .row dt { color: var(--bai-text-muted); margin: 0; flex: 0 0 auto; }
.moc-ed .row dd { margin: 0; min-width: 0; color: var(--bai-text-secondary); text-align: right; word-break: break-word; }
.moc-ed .narr { margin: 10px 0 0; font-size: 12px; color: var(--bai-text-muted); line-height: 1.6; }
.moc-ed .q { display: flex; align-items: flex-start; gap: 8px; padding: 10px 0; border-bottom: 1px solid var(--bai-border); }
.moc-ed .q p { flex: 1; margin: 0; font-size: 13px; color: var(--bai-text-secondary); }
.moc-ed .q button { background: none; border: 0; color: var(--bai-text-faint); cursor: pointer; opacity: 0; }
.moc-ed .q:hover button { opacity: 1; }

.moc-ed .iform { max-width: 660px; margin: 0 auto; padding: 40px 32px 80px; }
.moc-ed .iform h2 { margin: 0 0 6px; font-size: 19px; color: var(--bai-text); font-weight: 600; }
.moc-ed .iform .lede { margin: 0 0 26px; font-size: 13px; color: var(--bai-text-tertiary); line-height: 1.6; }
.moc-ed .iform label { display: block; font-size: 12px; color: var(--bai-text-tertiary); margin: 0 0 6px; }
.moc-ed .iform input, .moc-ed .iform select, .moc-ed .iform textarea { width: 100%; padding: 9px 11px; border-radius: 9px; background: var(--bai-bg); border: 1px solid var(--bai-border); color: var(--bai-text); font: inherit; font-size: 13.5px; }
.moc-ed .iform textarea { min-height: 120px; resize: vertical; font-size: 13px; line-height: 1.6; }
.moc-ed .iform .two { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 16px; }
.moc-ed .iform .one { margin-bottom: 16px; }
.moc-ed .iform .foot { display: flex; align-items: center; gap: 12px; margin-top: 22px; }
.moc-ed .iform button.submit { padding: 8px 16px; border-radius: 9px; background: var(--bai-accent); border: 1px solid var(--bai-accent); color: var(--bai-accent-text); font-size: 13px; font-weight: 600; cursor: pointer; }
.moc-ed .iform button.submit:disabled { background: var(--bai-hover); border-color: var(--bai-border); color: var(--bai-text-faint); cursor: not-allowed; }
.moc-ed .iform .hint { font-size: 11.5px; color: var(--bai-text-faint); }
`;

function ts() {
  return new Date().toISOString();
}

function formatWhen(value?: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export default function Editor() {
  const [document, dispatch] = useSelectedMocDocument();
  const state = document.state.global;
  const { mocs, mocMap } = useKnowledgeMocs();
  const mocProj = mocMap.get(document.header.id);
  const coreIdeas: { noteRef: string; contextPhrase: string }[] =
    mocProj?.coreIdeas ?? [];
  const childMocs = (mocProj?.childRefs ?? [])
    .map((ref) => mocMap.get(ref))
    .filter((m): m is NonNullable<typeof m> => !!m);
  const parentMocs = mocs.filter((m) =>
    m.childRefs.includes(document.header.id),
  );
  const { byId } = useVaultDocIndex();

  const [view, setView] = useState<View>("map");
  const [detailTab, setDetailTab] = useState<DetailTab>("ideas");
  const [showAllIdeas, setShowAllIdeas] = useState(false);
  const [newQuestion, setNewQuestion] = useState("");
  const [newIdeaRef, setNewIdeaRef] = useState("");
  const [newIdeaPhrase, setNewIdeaPhrase] = useState("");
  const [progress, setProgress] = useState(0);
  const reader = useRef<HTMLDivElement>(null);

  const history = useRevisionHistory(
    view === "history" ? document.header.id : "",
    document.header.revision.global ?? 0,
    state,
    MOC_REVISION_MODEL,
  );
  const initialized = !!state.title;

  useEffect(() => {
    setView("map");
    setDetailTab("ideas");
    setShowAllIdeas(false);
  }, [document.header.id]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      setView("map");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!initialized) {
    return <InitForm dispatch={dispatch} />;
  }

  const tier = state.tier ?? "TOPIC";
  const questions = state.openQuestions;
  const tensions = state.tensions;
  const visibleIdeas = showAllIdeas
    ? coreIdeas
    : coreIdeas.slice(0, CORE_IDEAS_PREVIEW);

  const go = (next: View) => {
    setView(next);
    reader.current?.scrollTo({ top: 0 });
  };

  const onScroll = () => {
    const el = reader.current;
    if (!el) return;
    const max = el.scrollHeight - el.clientHeight;
    setProgress(max > 0 ? (el.scrollTop / max) * 100 : 0);
  };

  const removeIdea = (noteRef: string) => {
    void dispatchActions(
      [
        {
          id: generateId(),
          type: "REMOVE_RELATIONSHIP",
          scope: "document",
          timestampUtcMs: ts(),
          input: {
            sourceId: document.header.id,
            targetId: noteRef,
            relationshipType: "CORE_IDEA",
          },
        } as never,
      ],
      document.header.id,
    );
  };

  const addIdea = () => {
    if (!newIdeaRef.trim()) return;
    void dispatchActions(
      [
        {
          id: generateId(),
          type: "ADD_RELATIONSHIP",
          scope: "document",
          timestampUtcMs: ts(),
          input: {
            sourceId: document.header.id,
            targetId: newIdeaRef.trim(),
            relationshipType: "CORE_IDEA",
          },
        } as never,
      ],
      document.header.id,
    );
    setNewIdeaRef("");
    setNewIdeaPhrase("");
  };

  return (
    <div className="moc-ed" data-view={view}>
      <style aria-hidden="true">{STYLES}</style>
      <DocumentToolbar toolbarClassName={TOOLBAR_CLASS} />
      <div className="moc-body">
        <span className="moc-progress" style={{ width: `${progress}%` }} />
        <main className="moc-reader" ref={reader} onScroll={onScroll}>
          <div className="pagewrap">
            <header className="dochead">
              <div className="headrow">
                <span className="pill" style={PILL_TONE[tier] ?? PILL_TONE.TOPIC}>
                  {tier}
                </span>
                {state.version ? (
                  <span className="chip" title="Stack release this map is registered against">
                    {state.version}
                  </span>
                ) : null}
                <button
                  type="button"
                  className="cta"
                  onClick={() => {
                    setDetailTab("ideas");
                    go("details");
                  }}
                >
                  Core ideas{" "}
                  <b>
                    {coreIdeas.length} {coreIdeas.length === 1 ? "note" : "notes"}
                  </b>
                </button>
                {childMocs.length > 0 && (
                  <button
                    type="button"
                    className="cta"
                    onClick={() => go("map")}
                  >
                    Child maps{" "}
                    <b>
                      {childMocs.length} {childMocs.length === 1 ? "map" : "maps"}
                    </b>
                  </button>
                )}
              </div>

              {parentMocs.length > 0 && (
                <p className="crumb">
                  Part of{" "}
                  {parentMocs.map((m, i) => (
                    <span key={m.id}>
                      {i > 0 ? " · " : null}
                      <button type="button" onClick={() => setSelectedNode(m.id)}>
                        {m.title}
                      </button>
                    </span>
                  ))}
                </p>
              )}

              <h1>{state.title}</h1>
              {state.description ? (
                <p className="lede">{state.description}</p>
              ) : null}

              <div className="tabs">
                {(
                  [
                    ["map", "Map"],
                    ["details", "Details"],
                    ["history", "History"],
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

            {view === "map" && (
              <div className="moc-sheet">
                {state.orientation ? (
                  <p className="orient">{state.orientation}</p>
                ) : (
                  <p className="empty">
                    No orientation yet. Open Edit to write what this map covers.
                  </p>
                )}

                <div className="block">
                  <p className="plbl">
                    Core ideas · {coreIdeas.length}
                  </p>
                  {coreIdeas.length === 0 && childMocs.length > 0 && (
                    <p className="empty">This map groups child maps, not notes.</p>
                  )}
                  {coreIdeas.length === 0 && childMocs.length === 0 && (
                    <p className="empty">No core ideas yet.</p>
                  )}
                  {visibleIdeas.map((idea) => {
                    const noteTitle = byId.get(idea.noteRef)?.title ?? null;
                    return (
                      <button
                        key={`${document.header.id}-${idea.noteRef}`}
                        type="button"
                        className="idea"
                        onClick={() => setSelectedNode(idea.noteRef)}
                        title={
                          noteTitle
                            ? `Open note: ${noteTitle}`
                            : `Open document: ${idea.noteRef}`
                        }
                      >
                        {noteTitle ?? idea.noteRef}
                        <span className="meta">
                          {idea.contextPhrase ||
                            (noteTitle
                              ? "knowledge note"
                              : "unresolved reference")}
                        </span>
                      </button>
                    );
                  })}
                  {coreIdeas.length > CORE_IDEAS_PREVIEW && (
                    <button
                      type="button"
                      className="more"
                      onClick={() => setShowAllIdeas((v) => !v)}
                    >
                      {showAllIdeas
                        ? "Show fewer"
                        : `Show all ${coreIdeas.length}`}
                    </button>
                  )}
                </div>

                {childMocs.length > 0 && (
                  <div className="block">
                    <p className="plbl">Child maps · {childMocs.length}</p>
                    {childMocs.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        className="child"
                        onClick={() => setSelectedNode(m.id)}
                        aria-label={`${m.tier ?? "MoC"}, ${m.title}, ${m.noteCount} notes`}
                      >
                        {m.title}
                        <span className="meta">
                          {m.tier ?? "MoC"} · {m.noteCount} notes
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {view === "edit" && (
              <EditInPlace
                state={state}
                dispatch={dispatch}
                onDone={() => go("map")}
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
                      ["ideas", "Ideas", coreIdeas.length],
                      ["questions", "Questions", questions.length],
                      ["tensions", "Tensions", tensions.length],
                      ["about", "About", null],
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

                {detailTab === "ideas" && (
                  <div className="pane">
                    <p className="plbl">Notes this map hangs on</p>
                    {coreIdeas.length === 0 && (
                      <p className="narr" style={{ marginTop: 0 }}>
                        {childMocs.length > 0
                          ? "This map groups child maps, not notes."
                          : "Nothing linked yet. Paste a note id below."}
                      </p>
                    )}
                    {coreIdeas.map((idea) => {
                      const noteTitle = byId.get(idea.noteRef)?.title ?? null;
                      return (
                        <div
                          className="idea-row"
                          key={`${document.header.id}-${idea.noteRef}`}
                        >
                          <button
                            type="button"
                            className="idea"
                            onClick={() => setSelectedNode(idea.noteRef)}
                          >
                            {noteTitle ?? idea.noteRef}
                            <span className="meta">
                              {idea.contextPhrase ||
                                (noteTitle
                                  ? "knowledge note"
                                  : "unresolved reference")}
                            </span>
                          </button>
                          <button
                            type="button"
                            className="x"
                            aria-label="Remove core idea"
                            onClick={() => removeIdea(idea.noteRef)}
                          >
                            ×
                          </button>
                        </div>
                      );
                    })}
                    <form
                      className="add"
                      onSubmit={(e) => {
                        e.preventDefault();
                        addIdea();
                      }}
                    >
                      <input
                        className="mono"
                        value={newIdeaRef}
                        onChange={(e) => setNewIdeaRef(e.target.value)}
                        placeholder="Note ID"
                        aria-label="Note ID"
                      />
                      <input
                        value={newIdeaPhrase}
                        onChange={(e) => setNewIdeaPhrase(e.target.value)}
                        placeholder="Why it matters here (not saved yet)"
                        aria-label="Why it matters here"
                      />
                      <button type="submit" aria-label="Add core idea">
                        Add
                      </button>
                    </form>
                  </div>
                )}

                {detailTab === "questions" && (
                  <div className="pane">
                    <p className="plbl">Open questions</p>
                    {questions.length === 0 && (
                      <p className="narr" style={{ marginTop: 0 }}>
                        No open questions on this map.
                      </p>
                    )}
                    {questions.map((q) => (
                      <div className="q" key={q}>
                        <p>{q}</p>
                        <button
                          type="button"
                          aria-label="Remove question"
                          onClick={() =>
                            dispatch(
                              actions.removeOpenQuestion({ question: q }),
                            )
                          }
                        >
                          ×
                        </button>
                      </div>
                    ))}
                    <form
                      className="add"
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (!newQuestion.trim()) return;
                        dispatch(
                          actions.addOpenQuestion({
                            question: newQuestion.trim(),
                          }),
                        );
                        setNewQuestion("");
                      }}
                    >
                      <input
                        value={newQuestion}
                        onChange={(e) => setNewQuestion(e.target.value)}
                        placeholder="Add a question"
                        aria-label="Add a question"
                      />
                      <button type="submit" aria-label="Add open question">
                        Add
                      </button>
                    </form>
                  </div>
                )}

                {detailTab === "tensions" && (
                  <div className="pane">
                    <p className="plbl">Tensions</p>
                    {tensions.length === 0 && (
                      <p className="narr" style={{ marginTop: 0 }}>
                        No tensions recorded. They appear here when a conflict
                        between notes is worth keeping on the map.
                      </p>
                    )}
                    {tensions.map((t) => (
                      <div className="q" key={t.id}>
                        <p>{t.description}</p>
                        <button
                          type="button"
                          aria-label="Remove tension"
                          onClick={() =>
                            dispatch(actions.removeTension({ id: t.id }))
                          }
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {detailTab === "about" && (
                  <div className="pane">
                    <Row label="Tier" value={tier} />
                    <Row label="Version" value={state.version} />
                    <Row label="Created" value={formatWhen(state.createdAt)} />
                    <Row label="Updated" value={formatWhen(state.updatedAt)} />
                    <Row
                      label="Notes"
                      value={String(coreIdeas.length)}
                    />
                    <Row
                      label="Child maps"
                      value={
                        childMocs.length ? String(childMocs.length) : null
                      }
                    />
                    <p className="narr">
                      Title and tier are set when the map is created. Description
                      and orientation live under Edit.
                    </p>
                  </div>
                )}
              </section>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
}: {
  label: string;
  value?: string | null;
}) {
  if (!value) return null;
  return (
    <div className="row">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function EditInPlace({
  state,
  dispatch,
  onDone,
}: {
  state: ReturnType<typeof useSelectedMocDocument>[0]["state"]["global"];
  dispatch: ReturnType<typeof useSelectedMocDocument>[1];
  onDone: () => void;
}) {
  const [desc, setDesc] = useState(state.description ?? "");
  const [orient, setOrient] = useState(state.orientation ?? "");
  const [version, setVersion] = useState(state.version ?? "");
  const descRef = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = descRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [desc]);

  const dirty =
    desc.trim() !== (state.description ?? "").trim() ||
    orient.trim() !== (state.orientation ?? "").trim() ||
    version.trim() !== (state.version ?? "").trim();

  function handleSave() {
    const now = ts();
    if (desc.trim() !== (state.description ?? "").trim()) {
      dispatch(
        actions.updateDescription({
          description: desc.trim(),
          updatedAt: now,
        }),
      );
    }
    if (orient.trim() !== (state.orientation ?? "").trim()) {
      dispatch(
        actions.updateOrientation({
          orientation: orient.trim(),
          updatedAt: now,
        }),
      );
    }
    if (version.trim() !== (state.version ?? "").trim()) {
      dispatch(
        actions.setMetadataField({
          field: "version",
          value: version.trim() || null,
          updatedAt: now,
        }),
      );
    }
    onDone();
  }

  return (
    <>
      <div className="editmeta">
        <div className="em-row">
          <label htmlFor="moc-desc">Description</label>
          <textarea
            id="moc-desc"
            ref={descRef}
            rows={1}
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            placeholder="One-line summary of this map"
          />
        </div>
        <div className="em-row">
          <label htmlFor="moc-ver">Version</label>
          <input
            id="moc-ver"
            value={version}
            onChange={(e) => setVersion(e.target.value)}
            placeholder="Optional stack version"
          />
        </div>
        <div className="em-foot">
          <span>
            Title and tier cannot change after create. Orientation is the
            reading copy on Map.
          </span>
          <button type="button" className="em-cancel" onClick={onDone}>
            Cancel
          </button>
          <button
            type="button"
            className="em-save"
            disabled={!dirty}
            onClick={handleSave}
          >
            Save changes
          </button>
        </div>
      </div>
      <textarea
        className="mdedit"
        value={orient}
        onChange={(e) => setOrient(e.target.value)}
        placeholder="What this map covers, how the pieces relate, and where understanding stands."
      />
    </>
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
    <div className="moc-ed">
      <style aria-hidden="true">{STYLES}</style>
      <DocumentToolbar toolbarClassName={TOOLBAR_CLASS} />
      <div className="moc-body">
        <main className="moc-reader">
          <div className="iform">
            <h2>Create a map of content</h2>
            <p className="lede">
              A map orients a cluster of notes. Title, description and a short
              orientation are enough to start.
            </p>
            <div className="two">
              <div>
                <label htmlFor="moc-in-title">Title</label>
                <input
                  id="moc-in-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Map title"
                />
              </div>
              <div>
                <label htmlFor="moc-in-tier">Tier</label>
                <select
                  id="moc-in-tier"
                  value={tier}
                  onChange={(e) => setTier(e.target.value)}
                >
                  {TIERS.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="one">
              <label htmlFor="moc-in-desc">Description</label>
              <input
                id="moc-in-desc"
                value={desc}
                onChange={(e) => setDesc(e.target.value)}
                placeholder="One-line summary"
              />
            </div>
            <div className="one">
              <label htmlFor="moc-in-orient">Orientation</label>
              <textarea
                id="moc-in-orient"
                value={orient}
                onChange={(e) => setOrient(e.target.value)}
                placeholder="What this map covers (2–3 sentences)"
              />
            </div>
            <div className="foot">
              <button
                type="button"
                className="submit"
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
              >
                Create map
              </button>
              <span className="hint">Title, description and orientation are required.</span>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
