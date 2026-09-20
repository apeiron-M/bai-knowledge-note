import { useEffect, useRef, useState } from "react";
import { DocumentToolbar } from "@powerhousedao/design-system/connect";
import { useSelectedTensionDocument, actions } from "document-models/tension";
import { setSelectedNode } from "@powerhousedao/reactor-browser";
import { useVaultDocIndex } from "../shared/use-vault-doc-index.js";
import { MarkdownPreview } from "../shared/markdown-preview.js";
import { TOOLBAR_CLASS } from "../shared/theme-context.js";

type View = "analysis" | "details";
type CloseKind = "resolve" | "dissolve";

const PILL_TONE: Record<string, { background: string; color: string }> = {
  OPEN: { background: "var(--bai-warn-soft)", color: "var(--bai-warn)" },
  RESOLVED: { background: "var(--bai-ok-soft)", color: "var(--bai-ok)" },
  DISSOLVED: { background: "var(--bai-hover)", color: "var(--bai-text-muted)" },
};

/**
 * Same chrome as the source and MoC editors: header card, underline tabs,
 * sheet that continues the card. Prefix `.ten-ed` so the stylesheets never
 * collide if more than one editor is in the tree.
 */
const STYLES = `
.ten-ed { height: 100%; display: flex; flex-direction: column; background: var(--bai-bg); color: var(--bai-text); }
.ten-ed .ten-body { position: relative; flex: 1; min-height: 0; display: flex; }
.ten-ed .ten-reader { flex: 1; min-width: 0; overflow-y: auto; }
.ten-ed .ten-progress { position: absolute; top: 0; left: 0; z-index: 7; height: 2px; background: var(--bai-accent); }
.ten-ed .pagewrap { padding: 0 26px 64px; }
.ten-ed .detailsview { margin-top: 0; }

.ten-ed .dochead { max-width: 64rem; margin: 20px auto 0; padding: 18px 20px 0; background: var(--bai-surface); border: 1px solid var(--bai-border); overflow: hidden; border-radius: 14px 14px 0 0; border-bottom: 0; }
.ten-ed .headrow { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.ten-ed .pill { display: inline-flex; align-items: center; gap: 6px; padding: 4px 12px; border-radius: 999px; font-size: 11.5px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; }
.ten-ed .chip { display: inline-flex; align-items: center; padding: 4px 10px; border-radius: 7px; font-size: 11.5px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; background: var(--bai-hover); color: var(--bai-text-tertiary); }
.ten-ed .cta { display: inline-flex; align-items: center; gap: 7px; padding: 4px 10px; border-radius: 7px; background: none; border: 1px dashed var(--bai-border); color: var(--bai-text-secondary); font-size: 12px; cursor: pointer; }
.ten-ed .cta:hover { border-color: var(--bai-accent); color: var(--bai-text); }
.ten-ed .cta b { font-size: 10px; font-weight: 600; letter-spacing: .05em; text-transform: uppercase; color: var(--bai-text-faint); }
.ten-ed .cta:hover b { color: var(--bai-accent); }
.ten-ed .hbtn { display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; border-radius: 8px; background: var(--bai-hover); border: 1px solid transparent; color: var(--bai-text-tertiary); font-size: 12.5px; cursor: pointer; }
.ten-ed .hbtn:hover { background: var(--bai-border); color: var(--bai-text); }
.ten-ed .hbtn.primary { background: var(--bai-accent); border-color: var(--bai-accent); color: var(--bai-accent-text); font-weight: 600; }
.ten-ed .hbtn.primary:hover { filter: brightness(1.07); }
.ten-ed .dochead h1 { margin: 14px 0 0; font-size: 27px; line-height: 1.22; font-weight: 700; color: var(--bai-text); }
.ten-ed .lede { margin: 8px 0 0; font-size: 13.5px; line-height: 1.5; color: var(--bai-text-tertiary); }
.ten-ed .tabs { display: flex; margin: 18px -20px 0; padding: 0 20px; border-bottom: 1px solid var(--bai-border); }
.ten-ed .tabs button { border: 0; background: none; margin: 0 24px -1px 0; padding: 9px 2px 11px; font-size: 13.5px; font-weight: 500; color: var(--bai-text-muted); border-bottom: 2px solid transparent; cursor: pointer; }
.ten-ed .tabs button:hover { color: var(--bai-text-secondary); }
.ten-ed .tabs button.on { color: var(--bai-accent); border-bottom-color: var(--bai-accent); }

.ten-ed .ten-sheet { display: block; width: 100%; max-width: 64rem; margin: 0 auto; padding: 32px 48px; border-radius: 0 0 14px 14px; min-height: 60vh; background: var(--bai-deep); border: 1px solid var(--bai-border); border-top: 0; }
.ten-ed .empty { margin: 0; color: var(--bai-text-muted); font-size: 14px; }
.ten-ed .plbl { margin: 0 0 12px; font-size: 10px; letter-spacing: .08em; text-transform: uppercase; color: var(--bai-text-faint); }
.ten-ed .claim { display: block; width: 100%; text-align: left; padding: 11px 12px; margin-bottom: 8px; border-radius: 10px; background: var(--bai-deep); border: 1px solid var(--bai-border); color: var(--bai-text-secondary); font-size: 13px; cursor: pointer; }
.ten-ed .claim:hover { border-color: var(--bai-accent); color: var(--bai-text); }
.ten-ed .claim .meta { display: block; margin-top: 3px; font-size: 11px; color: var(--bai-text-faint); }
.ten-ed .claim.dead { cursor: default; color: var(--bai-text-muted); }
.ten-ed .add { display: flex; gap: 8px; margin-top: 12px; }
.ten-ed .add input, .ten-ed .add textarea { flex: 1; min-width: 0; padding: 6px 9px; border-radius: 8px; background: var(--bai-surface); border: 1px solid var(--bai-border); color: var(--bai-text); font: inherit; font-size: 12.5px; }
.ten-ed .add input:focus, .ten-ed .add textarea:focus { outline: none; border-color: var(--bai-accent); }
.ten-ed .add button { padding: 6px 12px; border-radius: 8px; background: var(--bai-accent); border: 1px solid var(--bai-accent); color: var(--bai-accent-text); font-size: 12.5px; font-weight: 600; cursor: pointer; }
.ten-ed .add button.ghost { background: var(--bai-surface); border-color: var(--bai-border); color: var(--bai-text-tertiary); font-weight: 500; }
.ten-ed .closebox { margin-top: 22px; padding: 16px; border-radius: 10px; background: var(--bai-deep); border: 1px solid var(--bai-border); }
.ten-ed .closebox textarea { width: 100%; min-height: 88px; resize: vertical; padding: 8px 10px; border-radius: 8px; background: var(--bai-surface); border: 1px solid var(--bai-border); color: var(--bai-text); font: inherit; font-size: 13px; line-height: 1.5; }
.ten-ed .closebox textarea:focus { outline: none; border-color: var(--bai-accent); }
.ten-ed .closebox .foot { display: flex; align-items: center; gap: 8px; margin-top: 10px; }
.ten-ed .closebox .hint { flex: 1; font-size: 11.5px; color: var(--bai-text-muted); line-height: 1.5; }

.ten-ed .detailsview { max-width: 64rem; margin: 0 auto; border: 1px solid var(--bai-border); border-top: 0; border-radius: 0 0 14px 14px; background: var(--bai-surface); padding: 22px 20px 40px; }
.ten-ed .row { display: flex; justify-content: space-between; gap: 12px; padding: 7px 0; border-bottom: 1px solid var(--bai-border); font-size: 12.5px; }
.ten-ed .row dt { color: var(--bai-text-muted); margin: 0; flex: 0 0 auto; }
.ten-ed .row dd { margin: 0; min-width: 0; color: var(--bai-text-secondary); text-align: right; word-break: break-word; }
.ten-ed .narr { margin: 10px 0 0; font-size: 12px; color: var(--bai-text-muted); line-height: 1.6; }
.ten-ed .block { margin-top: 22px; }
.ten-ed .block:first-child { margin-top: 0; }

.ten-ed .iform { max-width: 660px; margin: 0 auto; padding: 40px 32px 80px; }
.ten-ed .iform h2 { margin: 0 0 6px; font-size: 19px; color: var(--bai-text); font-weight: 600; }
.ten-ed .iform .lede { margin: 0 0 26px; font-size: 13px; color: var(--bai-text-tertiary); line-height: 1.6; }
.ten-ed .iform label { display: block; font-size: 12px; color: var(--bai-text-tertiary); margin: 0 0 6px; }
.ten-ed .iform input, .ten-ed .iform textarea { width: 100%; padding: 9px 11px; border-radius: 9px; background: var(--bai-bg); border: 1px solid var(--bai-border); color: var(--bai-text); font: inherit; font-size: 13.5px; }
.ten-ed .iform textarea { min-height: 160px; resize: vertical; font-size: 13px; line-height: 1.6; }
.ten-ed .iform .one { margin-bottom: 16px; }
.ten-ed .iform .foot { display: flex; align-items: center; gap: 12px; margin-top: 22px; }
.ten-ed .iform button.submit { padding: 8px 16px; border-radius: 9px; background: var(--bai-accent); border: 1px solid var(--bai-accent); color: var(--bai-accent-text); font-size: 13px; font-weight: 600; cursor: pointer; }
.ten-ed .iform button.submit:disabled { background: var(--bai-hover); border-color: var(--bai-border); color: var(--bai-text-faint); cursor: not-allowed; }
.ten-ed .iform .hint { font-size: 11.5px; color: var(--bai-text-faint); }
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
  const [document, dispatch] = useSelectedTensionDocument();
  const state = document.state.global;
  const { byId } = useVaultDocIndex();
  const initialized = !!state.title;

  const [view, setView] = useState<View>("analysis");
  const [closing, setClosing] = useState<CloseKind | null>(null);
  const [resolution, setResolution] = useState("");
  const [newRef, setNewRef] = useState("");
  const [progress, setProgress] = useState(0);
  const reader = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setView("analysis");
    setClosing(null);
    setResolution("");
  }, [document.header.id]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (closing) {
        setClosing(null);
        return;
      }
      setView("analysis");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closing]);

  if (!initialized) {
    return <CreateForm dispatch={dispatch} />;
  }

  const status = state.status ?? "OPEN";
  const involved = state.involvedRefs.map((ref) => {
    const doc = byId.get(ref);
    return {
      ref,
      title: doc?.title ?? null,
      exists: !!doc,
    };
  });

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

  const startClose = (kind: CloseKind) => {
    setClosing(kind);
    setResolution("");
    go("details");
  };

  const confirmClose = () => {
    if (!resolution.trim()) return;
    const payload = { resolution: resolution.trim(), resolvedAt: ts() };
    if (closing === "dissolve") dispatch(actions.dissolveTension(payload));
    else dispatch(actions.resolveTension(payload));
    setClosing(null);
    setResolution("");
  };

  return (
    <div className="ten-ed" data-view={view}>
      <style aria-hidden="true">{STYLES}</style>
      <DocumentToolbar toolbarClassName={TOOLBAR_CLASS} />
      <div className="ten-body">
        <span className="ten-progress" style={{ width: `${progress}%` }} />
        <main className="ten-reader" ref={reader} onScroll={onScroll}>
          <div className="pagewrap">
            <header className="dochead">
              <div className="headrow">
                <span className="pill" style={PILL_TONE[status] ?? PILL_TONE.OPEN}>
                  {status}
                </span>
                {state.observedBy ? (
                  <span className="chip">by {state.observedBy}</span>
                ) : null}
                <button
                  type="button"
                  className="cta"
                  onClick={() => go("details")}
                >
                  Involved{" "}
                  <b>
                    {involved.length} {involved.length === 1 ? "note" : "notes"}
                  </b>
                </button>
                <span style={{ flex: 1 }} />
                {status === "OPEN" && (
                  <>
                    <button
                      type="button"
                      className="hbtn primary"
                      onClick={() => startClose("resolve")}
                    >
                      Resolve
                    </button>
                    <button
                      type="button"
                      className="hbtn"
                      onClick={() => startClose("dissolve")}
                    >
                      Dissolve
                    </button>
                  </>
                )}
              </div>

              <h1>{state.title}</h1>
              {state.description ? (
                <p className="lede">{state.description}</p>
              ) : null}

              <div className="tabs">
                {(
                  [
                    ["analysis", "Analysis"],
                    ["details", "Details"],
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

            {view === "analysis" && (
              <div className="ten-sheet">
                {state.content ? (
                  <MarkdownPreview content={state.content} scale="reading" />
                ) : (
                  <p className="empty">No analysis written for this tension.</p>
                )}
              </div>
            )}

            {view === "details" && (
              <section className="detailsview">
                <div className="block">
                  <p className="plbl">Notes in conflict</p>
                  {involved.length === 0 && (
                    <p className="narr" style={{ marginTop: 0 }}>
                      No notes linked yet. Paste a note id to attach one.
                    </p>
                  )}
                  {involved.map((note) =>
                    note.exists ? (
                      <button
                        key={note.ref}
                        type="button"
                        className="claim"
                        onClick={() => setSelectedNode(note.ref)}
                        title={`Open note: ${note.title}`}
                      >
                        {note.title}
                        <span className="meta">knowledge note</span>
                      </button>
                    ) : (
                      <div key={note.ref} className="claim dead">
                        {note.ref}
                        <span className="meta">
                          unresolved reference — this note is not in this drive
                        </span>
                      </div>
                    ),
                  )}
                  {status === "OPEN" && (
                    <form
                      className="add"
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (!newRef.trim()) return;
                        dispatch(actions.addInvolvedRef({ ref: newRef.trim() }));
                        setNewRef("");
                      }}
                    >
                      <input
                        value={newRef}
                        onChange={(e) => setNewRef(e.target.value)}
                        placeholder="Note ID"
                        aria-label="Note ID"
                      />
                      <button type="submit" aria-label="Add involved note">
                        Add
                      </button>
                    </form>
                  )}
                </div>

                {state.resolution && (
                  <div className="block">
                    <p className="plbl">
                      {status === "DISSOLVED" ? "Why it was not real" : "How it was resolved"}
                    </p>
                    <p className="narr" style={{ marginTop: 0, fontSize: 13.5, color: "var(--bai-text-secondary)" }}>
                      {state.resolution}
                    </p>
                    {state.resolvedAt && (
                      <p className="narr">
                        {status === "DISSOLVED" ? "Dissolved" : "Resolved"}{" "}
                        {formatWhen(state.resolvedAt)}
                      </p>
                    )}
                  </div>
                )}

                {status === "OPEN" && closing && (
                  <div className="closebox">
                    <p className="plbl">
                      {closing === "dissolve"
                        ? "Why this tension is apparent, not real"
                        : "How this was resolved (one side is correct)"}
                    </p>
                    <textarea
                      value={resolution}
                      onChange={(e) => setResolution(e.target.value)}
                      placeholder={
                        closing === "dissolve"
                          ? "The conflict only looked real because…"
                          : "The claim that stands is…"
                      }
                    />
                    <div className="foot">
                      <span className="hint">
                        This cannot be undone. The tension stays in the vault
                        as {closing === "dissolve" ? "dissolved" : "resolved"}.
                      </span>
                      <button
                        type="button"
                        className="hbtn"
                        onClick={() => setClosing(null)}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        className="hbtn primary"
                        disabled={!resolution.trim()}
                        onClick={confirmClose}
                      >
                        {closing === "dissolve" ? "Dissolve" : "Resolve"}
                      </button>
                    </div>
                  </div>
                )}

                <div className="block">
                  <p className="plbl">About</p>
                  <Row label="Status" value={status} />
                  <Row label="Observed by" value={state.observedBy} />
                  <Row label="Observed" value={formatWhen(state.observedAt)} />
                  <p className="narr">
                    Title, description and analysis are set when the tension is
                    created. Closing it is the only later write besides linking
                    notes.
                  </p>
                </div>
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

function CreateForm({
  dispatch,
}: {
  dispatch: ReturnType<typeof useSelectedTensionDocument>[1];
}) {
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [content, setContent] = useState("");
  const [observer, setObserver] = useState("");

  return (
    <div className="ten-ed">
      <style aria-hidden="true">{STYLES}</style>
      <DocumentToolbar toolbarClassName={TOOLBAR_CLASS} />
      <div className="ten-body">
        <main className="ten-reader">
          <div className="iform">
            <h2>Identify a tension</h2>
            <p className="lede">
              Record a contradiction between two or more claims. The analysis
              is the reading copy; linking the notes comes after create.
            </p>
            <div className="one">
              <label htmlFor="ten-title">Contradiction</label>
              <input
                id="ten-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="What’s in conflict"
              />
            </div>
            <div className="one">
              <label htmlFor="ten-desc">Summary</label>
              <input
                id="ten-desc"
                value={desc}
                onChange={(e) => setDesc(e.target.value)}
                placeholder="One-line summary of the conflict"
              />
            </div>
            <div className="one">
              <label htmlFor="ten-content">Analysis</label>
              <textarea
                id="ten-content"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="Why it matters, what’s at stake"
              />
            </div>
            <div className="one">
              <label htmlFor="ten-by">Observed by</label>
              <input
                id="ten-by"
                value={observer}
                onChange={(e) => setObserver(e.target.value)}
                placeholder="Optional"
              />
            </div>
            <div className="foot">
              <button
                type="button"
                className="submit"
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
              >
                Create tension
              </button>
              <span className="hint">Title and summary are required.</span>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
