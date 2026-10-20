/**
 * "Save as note" under a finished answer — the chat's only write, and only
 * ever on the person's word.
 *
 * Closed, it is one quiet button beside the answer's sources: the answer stays
 * what the eye lands on. Open, it unfolds in place, under the answer it
 * saves, so the reader never leaves the conversation. The form asks the
 * questions in the order a person answers them — is this the claim? what does
 * it leave out? what does it build on? where does it live? — with the help for
 * each where it is asked, and says before the button what saving changes and
 * what it does not. Nothing is written until "Save note".
 */
import { useEffect, useId, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import type { StoredMessage } from "../../lib/chat/chat-storage.js";
import {
  DESCRIPTION_MAX,
  NOTE_KINDS,
  NOTE_KIND_LABEL,
  draftFromAnswer,
  draftProblems,
  parseTopics,
  type AnswerDraft,
  type NoteKind,
} from "../../lib/chat/save-answer.js";
import {
  useSaveAnswer,
  useSaveOptions,
  type SaveOptions,
  type SaveState,
  type SaveStep,
} from "../../hooks/use-save-answer.js";
import { useVaultIdentity } from "../../../shared/use-vault-identity.js";
import { MarkdownPreview } from "../../../shared/markdown-preview.js";
import { openCitation } from "./ChatCitation.js";

const STEP_LABEL: Record<SaveStep, string> = {
  create: "Creating the note…",
  content: "Writing it…",
  links: "Linking it…",
  map: "Filing it…",
};

const LINK_LABEL = { BUILDS_ON: "Builds on", DERIVED_FROM: "From source" } as const;

const fieldStyle = {
  backgroundColor: "var(--bai-bg)",
  border: "1px solid var(--bai-border)",
  color: "var(--bai-text)",
} as const;
const fieldClass =
  "w-full rounded-lg px-3 py-2 text-sm outline-none focus:border-[var(--bai-accent)] focus-visible:ring-2 focus-visible:ring-[var(--bai-ring)]";

function Label({ htmlFor, children, aside }: { htmlFor: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-1 flex items-baseline justify-between gap-3">
      <label htmlFor={htmlFor} className="text-[13px] font-semibold" style={{ color: "var(--bai-text)" }}>
        {children}
      </label>
      {aside}
    </div>
  );
}

function Hint({ id, children, tone }: { id?: string; children: ReactNode; tone?: "danger" }) {
  return (
    <p
      id={id}
      className="mt-1 text-[12px] leading-snug"
      style={{ color: tone === "danger" ? "var(--bai-danger)" : "var(--bai-text-muted)" }}
    >
      {children}
    </p>
  );
}

export function SaveAnswer({
  message,
  question,
  driveId,
  threadId,
}: {
  message: StoredMessage;
  /** What the answer replied to: closes the note's body, and backs a link's reason. */
  question: string;
  driveId: string;
  threadId: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<AnswerDraft | null>(null);
  const [topicsText, setTopicsText] = useState("");
  const [mapId, setMapId] = useState<string>("");
  const [touched, setTouched] = useState(false);
  const { state, save, reset } = useSaveAnswer();
  const identity = useVaultIdentity();
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const citedIds = useMemo(
    () => (draft?.links ?? []).filter((l) => l.linkType === "BUILDS_ON").map((l) => l.documentId),
    [draft],
  );
  const options = useSaveOptions(driveId, citedIds, open);

  const begin = () => {
    setDraft(draftFromAnswer(message, question));
    setTopicsText("");
    setMapId("");
    preselected.current = false;
    setTouched(false);
    reset();
    setOpen(true);
  };
  const close = () => {
    if (state.status === "saving") return;
    setOpen(false);
  };

  // A map the answer itself cited is the likely home: chosen once when the
  // maps arrive, and never again — "Nowhere yet" is an answer too.
  const cited = draft?.maps[0]?.documentId;
  const preselected = useRef(false);
  useEffect(() => {
    if (!open || preselected.current || !cited) return;
    if (options.maps.some((m) => m.documentId === cited)) {
      preselected.current = true;
      setMapId(cited);
    }
  }, [open, cited, options.maps]);

  useEffect(() => {
    if (open) titleRef.current?.focus();
  }, [open]);

  if (!open || !draft) {
    if (state.status === "done" && state.outcome.ok) {
      const o = state.outcome;
      const map = options.maps.find((m) => m.documentId === mapId);
      return (
        <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]" role="status" style={{ color: "var(--bai-text-secondary)" }}>
          <span aria-hidden style={{ color: "var(--bai-ok)" }}>✓</span>
          <span>Saved as a draft note{o.linked ? `, linked to ${o.linked} document${o.linked === 1 ? "" : "s"}` : ""}{o.placed && map ? `, filed under ${map.title}` : ""}.</span>
          <button
            type="button"
            className="font-medium underline-offset-2 hover:underline"
            style={{ color: "var(--bai-accent)" }}
            onClick={() => openCitation({ documentId: o.noteId, documentType: "bai/knowledge-note" })}
          >
            Open note
          </button>
        </p>
      );
    }
    return (
      <div className="mt-3">
        <button
          type="button"
          onClick={begin}
          className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12.5px] font-medium transition-colors hover:bg-[var(--bai-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--bai-ring)]"
          style={{ color: "var(--bai-text-secondary)", border: "1px solid var(--bai-border)" }}
        >
          <svg aria-hidden width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
          </svg>
          Save as note
        </button>
      </div>
    );
  }

  const topics = parseTopics(topicsText);
  const problems = draftProblems(draft);
  const saving = state.status === "saving";

  const submit = async () => {
    setTouched(true);
    if (problems.length > 0 || saving) return;
    const outcome = await save(
      { ...draft, topics },
      {
        driveId,
        author: identity.ensName ?? identity.address ?? "the vault chat",
        sessionId: threadId ? `chat:${threadId}` : null,
        mapId: mapId || null,
      },
    );
    if (outcome.ok) setOpen(false);
  };

  return (
    <SaveAnswerForm
      draft={draft}
      onDraft={setDraft}
      topicsText={topicsText}
      onTopicsText={setTopicsText}
      mapId={mapId}
      onMapId={setMapId}
      options={options}
      state={state}
      touched={touched}
      onSubmit={() => void submit()}
      onClose={close}
      titleRef={titleRef}
    />
  );
}

/**
 * The open form, as a pure function of its props — so every state it can be
 * in (a fresh draft, a description over the limit, saving, a failed step) is
 * rendered and checked without a browser.
 */
export function SaveAnswerForm({
  draft,
  onDraft: setDraft,
  topicsText,
  onTopicsText: setTopicsText,
  mapId,
  onMapId: setMapId,
  options,
  state,
  touched,
  onSubmit,
  onClose: close,
  titleRef,
}: {
  draft: AnswerDraft;
  onDraft: (d: AnswerDraft) => void;
  topicsText: string;
  onTopicsText: (t: string) => void;
  mapId: string;
  onMapId: (id: string) => void;
  options: SaveOptions;
  state: SaveState;
  touched: boolean;
  onSubmit: () => void;
  onClose: () => void;
  titleRef?: RefObject<HTMLTextAreaElement | null>;
}) {
  const headingId = useId();
  const titleId = useId();
  const descId = useId();
  const descHint = useId();
  const kindId = useId();
  const topicsId = useId();
  const mapSelectId = useId();
  const topics = parseTopics(topicsText);
  const problems = draftProblems(draft);
  const problemFor = (field: "title" | "description") => problems.find((p) => p.field === field)?.message;
  const length = draft.description.trim().length;
  const saving = state.status === "saving";
  const failure = state.status === "done" && !state.outcome.ok ? state.outcome : null;
  /** A failed save that got as far as creating the note: it exists, and must not be made twice. */
  const made = failure !== null && failure.noteId !== null;
  const included = draft.links.filter((l) => l.include).length;
  const chosenMap = options.maps.find((m) => m.documentId === mapId) ?? null;
  const suggestions = options.suggestedTopics.filter(
    (t) => !topics.some((x) => x.toLowerCase() === t.toLowerCase()),
  );

  return (
    <section
      aria-labelledby={headingId}
      className="mt-4 rounded-xl p-4 sm:p-5"
      style={{ backgroundColor: "var(--bai-surface)", border: "1px solid var(--bai-border)" }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          close();
        }
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 id={headingId} className="text-[15px] font-semibold" style={{ color: "var(--bai-text)" }}>
            Save this answer as a note
          </h3>
          <p className="mt-0.5 text-[12.5px]" style={{ color: "var(--bai-text-muted)" }}>
            A note holds one claim. Make the title say exactly the one thing worth keeping.
          </p>
        </div>
        <button
          type="button"
          onClick={close}
          disabled={saving}
          aria-label="Close without saving"
          className="rounded-md p-1 hover:bg-[var(--bai-hover)] disabled:opacity-40"
          style={{ color: "var(--bai-text-muted)" }}
        >
          <svg aria-hidden width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="mt-4 space-y-4">
        <div>
          <Label htmlFor={titleId}>Claim</Label>
          <textarea
            id={titleId}
            ref={titleRef}
            rows={2}
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            className={`${fieldClass} resize-y`}
            style={fieldStyle}
            aria-invalid={touched && !!problemFor("title")}
          />
          {touched && problemFor("title") && <Hint tone="danger">{problemFor("title")}</Hint>}
        </div>

        <div>
          <Label
            htmlFor={descId}
            aside={
              <span
                className="text-[12px] tabular-nums"
                style={{ color: length > DESCRIPTION_MAX ? "var(--bai-danger)" : "var(--bai-text-muted)" }}
                aria-live="polite"
              >
                {length}/{DESCRIPTION_MAX}
              </span>
            }
          >
            Description
          </Label>
          <textarea
            id={descId}
            rows={3}
            value={draft.description}
            onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            className={`${fieldClass} resize-y`}
            style={fieldStyle}
            aria-describedby={descHint}
            aria-invalid={(touched || length > DESCRIPTION_MAX) && !!problemFor("description")}
          />
          {(touched || length > DESCRIPTION_MAX) && problemFor("description") ? (
            <Hint id={descHint} tone="danger">{problemFor("description")}</Hint>
          ) : (
            <Hint id={descHint}>What the claim leaves out. Search and the chat read it before the body.</Hint>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)]">
          <div>
            <Label htmlFor={kindId}>Kind</Label>
            <select
              id={kindId}
              value={draft.kind}
              onChange={(e) => setDraft({ ...draft, kind: e.target.value as NoteKind })}
              className={fieldClass}
              style={fieldStyle}
            >
              {NOTE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {NOTE_KIND_LABEL[k]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor={topicsId}>Topics</Label>
            <input
              id={topicsId}
              value={topicsText}
              onChange={(e) => setTopicsText(e.target.value)}
              placeholder="e.g. pricing, retention"
              className={fieldClass}
              style={fieldStyle}
            />
            {suggestions.length > 0 && (
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <span className="text-[12px]" style={{ color: "var(--bai-text-muted)" }}>
                  The cited notes use:
                </span>
                {suggestions.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTopicsText(topics.length ? `${topics.join(", ")}, ${t}` : t)}
                    className="rounded-full px-2 py-0.5 text-[12px] hover:bg-[var(--bai-accent-soft)]"
                    style={{ backgroundColor: "var(--bai-hover)", color: "var(--bai-accent)" }}
                    aria-label={`Add topic ${t}`}
                  >
                    + #{t}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div>
          <Label htmlFor={mapSelectId}>File under</Label>
          <select
            id={mapSelectId}
            value={mapId}
            onChange={(e) => setMapId(e.target.value)}
            className={fieldClass}
            style={fieldStyle}
            disabled={options.loading && options.maps.length === 0}
          >
            <option value="">{options.loading && options.maps.length === 0 ? "Loading the maps…" : "Nowhere yet"}</option>
            {options.maps.map((m) => (
              <option key={m.documentId} value={m.documentId}>
                {`${" ".repeat(Math.min(m.depth, 3))}${m.title}`}
              </option>
            ))}
          </select>
          <Hint>The map it appears in, among your topics. You can file it later from the note.</Hint>
        </div>

        <fieldset>
          <legend className="mb-1 text-[13px] font-semibold" style={{ color: "var(--bai-text)" }}>
            Links {draft.links.length > 0 && <span style={{ color: "var(--bai-text-muted)", fontWeight: 400 }}>· {included} of {draft.links.length}</span>}
          </legend>
          {draft.links.length === 0 ? (
            <Hint>The answer cites no notes or sources, so the note will have no links yet.</Hint>
          ) : (
            <ul className="space-y-1.5">
              {draft.links.map((l, i) => (
                <li key={l.documentId}>
                  <label className="flex cursor-pointer items-start gap-2.5 rounded-lg p-2 hover:bg-[var(--bai-hover)]">
                    <input
                      type="checkbox"
                      checked={l.include}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          links: draft.links.map((x, j) => (j === i ? { ...x, include: e.target.checked } : x)),
                        })
                      }
                      className="mt-0.5 shrink-0"
                      style={{ accentColor: "var(--bai-accent)" }}
                    />
                    <span className="min-w-0 text-[13px] leading-snug">
                      <span className="mr-1.5 font-medium" style={{ color: "var(--bai-text-secondary)" }}>
                        {LINK_LABEL[l.linkType]}
                      </span>
                      <span style={{ color: "var(--bai-text)" }}>{l.title}</span>
                      <span className="mt-0.5 block text-[12px]" style={{ color: "var(--bai-text-muted)" }}>
                        {l.reason}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          {draft.notLinked.length > 0 && (
            <Hint>
              {draft.notLinked.length === 1 ? "One cited document is" : `${draft.notLinked.length} cited documents are`} named in the
              text only: {draft.notLinked.map((c) => c.title).join("; ")}.
            </Hint>
          )}
        </fieldset>

        <details className="rounded-lg" style={{ border: "1px solid var(--bai-border)" }}>
          <summary className="cursor-pointer px-3 py-2 text-[13px] font-medium" style={{ color: "var(--bai-text-secondary)" }}>
            The note's text — the answer, with its sources named
          </summary>
          <div className="max-h-72 overflow-y-auto px-3 pb-3">
            <MarkdownPreview content={draft.content} />
          </div>
        </details>
      </div>

      {failure && (
        <div
          role="alert"
          className="mt-4 rounded-lg px-3 py-2.5 text-[13px] leading-snug"
          style={{ backgroundColor: "var(--bai-danger-soft)", color: "var(--bai-text)" }}
        >
          {failure.error}
          {failure.noteId && (
            <>
              {" "}
              <button
                type="button"
                className="font-medium underline underline-offset-2"
                style={{ color: "var(--bai-accent)" }}
                onClick={() => openCitation({ documentId: failure.noteId!, documentType: "bai/knowledge-note" })}
              >
                Open the note to finish it
              </button>
            </>
          )}
        </div>
      )}

      {/* What saving changes is read before the button, at every width: one
          wrapping row, so a narrow window puts the sentence above the buttons.
          A flex-col that turns into a row at sm: would lose to the copy of
          .flex-col that Connect's stylesheet adds after the vault's. */}
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <p className="min-w-[16rem] flex-1 text-[12px] leading-snug" style={{ color: "var(--bai-text-muted)" }}>
          {made
            ? "The note exists as a draft with what did save. Open it to finish; saving again would make a second note."
            : `Adds one draft note${included ? ` and ${included} link${included === 1 ? "" : "s"}` : ""}${chosenMap ? `, filed under ${chosenMap.title}` : ""}. The documents it cites are not edited.`}
        </p>
        <div className="ml-auto flex shrink-0 gap-2">
          <button
            type="button"
            onClick={close}
            disabled={saving}
            className="rounded-lg px-3.5 py-2 text-[13px] font-medium hover:bg-[var(--bai-hover)] disabled:opacity-50"
            style={{ color: "var(--bai-text-secondary)" }}
          >
            {made ? "Close" : "Cancel"}
          </button>
          {!made && (
            <button
              type="button"
              onClick={onSubmit}
              disabled={saving}
              className="rounded-lg px-4 py-2 text-[13px] font-semibold transition-colors hover:bg-[var(--bai-accent-hover)] disabled:opacity-60"
              style={{ backgroundColor: "var(--bai-accent)", color: "var(--bai-accent-text)" }}
            >
              {saving ? STEP_LABEL[state.step] : failure ? "Try again" : "Save note"}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
