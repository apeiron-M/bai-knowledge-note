/**
 * The card under an answer that proposed changes to scopes of work, projects
 * or work breakdowns: each change in a sentence, what it also removes when it
 * removes anything, and nothing written until the person presses Apply.
 *
 * Reads top to bottom the way the decision is made: what the chat wants to do
 * (its summary), each change (the ones that remove something marked, with
 * what else goes), what applying means, then the two buttons. Before applying
 * the person can open any change and edit its words — a title, a code, a goal,
 * an owner — or take it out; the proposal is checked again as a whole, and an
 * edited change is marked. Deleting a whole scope of work asks for its title
 * to be typed first. While it applies, each line shows its own progress;
 * after, the card says what was made and opens what it made.
 */
import { useSelectedDriveId } from "@powerhousedao/reactor-browser";
import { useId, useState, type FormEvent, type KeyboardEvent } from "react";
import { SCOPE_TYPE, editableFields, type EditableField, type WorkProposal } from "../../lib/chat/work-changes.js";
import { useWorkProposal, type ProposalState, type WorkOutcome } from "../../hooks/use-work-proposal.js";
import { TypeToConfirmDialog } from "../TypeToConfirmDialog.js";
import { openCitation } from "./ChatCitation.js";

/** The change open for editing: its entry, the values as typed, and how the last Done went. */
export interface EditingState {
  at: string;
  values: Record<string, string>;
  error?: string | null;
  busy?: false | "checking" | "removing";
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function Mark({ status, current, number }: { status: "done" | "failed" | "skipped" | "pending"; current: boolean; number: number }) {
  const base = "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold tabular-nums";
  if (current) {
    return (
      <span className={`${base} animate-pulse`} style={{ backgroundColor: "var(--bai-accent-soft)", color: "var(--bai-accent)" }} aria-label="in progress">
        {number}
      </span>
    );
  }
  if (status === "done") return <span className={base} style={{ backgroundColor: "var(--bai-ok-soft)", color: "var(--bai-ok)" }} aria-label="done">✓</span>;
  if (status === "failed") return <span className={base} style={{ backgroundColor: "var(--bai-danger-soft)", color: "var(--bai-danger)" }} aria-label="failed">✗</span>;
  return (
    <span className={base} style={{ backgroundColor: "var(--bai-hover)", color: "var(--bai-text-secondary)" }}>
      {number}
    </span>
  );
}

/** "Open “Operations 2027”" for each document the proposal made or changed — the made ones first. */
function OpenLinks({ outcome, onOpen }: { outcome: WorkOutcome; onOpen: (documentId: string, documentType: string) => void }) {
  const links = [...outcome.created, ...outcome.touched.filter((t) => !outcome.created.some((c) => c.documentId === t.documentId))];
  if (links.length === 0) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {links.slice(0, 3).map((l) => (
        <button
          key={l.documentId}
          type="button"
          onClick={() => onOpen(l.documentId, l.documentType)}
          className="rounded-md px-2 py-1 text-[12.5px] font-medium hover:bg-[var(--bai-hover)]"
          style={{ color: "var(--bai-accent)" }}
        >
          Open “{l.title}”
        </button>
      ))}
    </span>
  );
}

/** "One of them removes something" — or nothing, when none does. */
function removalNote(deletions: number, total: number): string {
  if (deletions === 0) return "";
  if (total === 1) return " It removes something, marked ⚠.";
  return deletions === 1 ? " One of them removes something, marked ⚠." : ` ${deletions} of them remove something, marked ⚠.`;
}

const fieldStyle = { backgroundColor: "var(--bai-surface)", border: "1px solid var(--bai-border)", color: "var(--bai-text)" };
const fieldClass = "mt-1 w-full rounded-md px-2.5 py-1.5 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-[var(--bai-accent)]";

/** One field of the open change, labelled; long text full width, the rest side by side as the width allows. */
function Field({ id, field, value, autoFocus, onChange }: { id: string; field: EditableField; value: string; autoFocus: boolean; onChange: (v: string) => void }) {
  const control =
    field.type === "long" ? (
      <textarea id={id} rows={3} value={value} autoFocus={autoFocus} onChange={(e) => onChange(e.target.value)} className={`${fieldClass} resize-y leading-snug`} style={fieldStyle} />
    ) : field.type === "select" ? (
      <select id={id} value={value} autoFocus={autoFocus} onChange={(e) => onChange(e.target.value)} className={fieldClass} style={fieldStyle}>
        <option value="">—</option>
        {(field.options ?? []).map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    ) : (
      <input
        id={id}
        value={value}
        autoFocus={autoFocus}
        inputMode={field.type === "number" ? "decimal" : undefined}
        autoComplete="off"
        onChange={(e) => onChange(e.target.value)}
        className={fieldClass}
        style={fieldStyle}
      />
    );
  return (
    <div className={field.type === "long" ? "basis-full" : "min-w-[9.5rem] flex-1"}>
      <label htmlFor={id} className="block text-[11.5px] font-medium" style={{ color: "var(--bai-text-secondary)" }}>
        {field.label}
        {field.required ? "" : <span style={{ color: "var(--bai-text-muted)" }}> · optional</span>}
      </label>
      {control}
    </div>
  );
}

/** The open change: its words as fields, why the last Done was refused, and Remove · Cancel · Done. */
function ChangeEditor({
  form,
  editing,
  onEditField,
  onDone,
  onCancel,
  onRemove,
}: {
  form: Record<string, unknown>;
  editing: EditingState;
  onEditField: (key: string, value: string) => void;
  onDone: () => void;
  onCancel: () => void;
  onRemove: () => void;
}) {
  const base = useId();
  const fields = editableFields(form, editing.at);
  const busy = Boolean(editing.busy);
  return (
    <form
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        if (!busy && fields.length) onDone();
      }}
      onKeyDown={(e: KeyboardEvent) => {
        if (e.key === "Escape" && !busy) {
          e.stopPropagation();
          onCancel();
        }
      }}
      className="ml-7 mt-2 rounded-lg p-3"
      style={{ backgroundColor: "var(--bai-deep)", border: "1px solid var(--bai-border)" }}
    >
      {fields.length === 0 ? (
        <p className="text-[12.5px]" style={{ color: "var(--bai-text-secondary)" }}>
          Nothing to edit in this change — you can take it out of the proposal.
        </p>
      ) : (
        <div className="flex flex-wrap gap-x-3 gap-y-2.5">
          {fields.map(({ field }, i) => (
            <Field
              key={field.key}
              id={`${base}-${field.key}`}
              field={field}
              value={editing.values[field.key] ?? ""}
              autoFocus={i === 0}
              onChange={(v) => onEditField(field.key, v)}
            />
          ))}
        </div>
      )}
      {editing.error && (
        <p role="alert" className="mt-2.5 text-[12.5px] leading-snug" style={{ color: "var(--bai-danger)" }}>
          {editing.error}
        </p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onRemove}
          disabled={busy}
          className="mr-auto rounded-md px-2 py-1 text-[12.5px] font-medium hover:bg-[var(--bai-danger-soft)] disabled:opacity-50"
          style={{ color: "var(--bai-danger)" }}
        >
          {editing.busy === "removing" ? "Removing…" : "Remove this change"}
        </button>
        <button type="button" onClick={onCancel} disabled={busy} className="rounded-md px-3 py-1.5 text-[12.5px] font-medium hover:bg-[var(--bai-hover)] disabled:opacity-50" style={{ color: "var(--bai-text-secondary)" }}>
          Cancel
        </button>
        {fields.length > 0 && (
          <button
            type="submit"
            disabled={busy}
            className="rounded-md px-3.5 py-1.5 text-[12.5px] font-semibold hover:bg-[var(--bai-accent-hover)] disabled:opacity-60"
            style={{ backgroundColor: "var(--bai-accent)", color: "var(--bai-accent-text)" }}
          >
            {editing.busy === "checking" ? "Checking…" : "Done"}
          </button>
        )}
      </div>
    </form>
  );
}

export function WorkProposalView({
  proposal,
  state,
  onApply,
  onCancel,
  onReopen,
  onOpen,
  editing = null,
  onStartEdit,
  onEditField,
  onDoneEdit,
  onCancelEdit,
  onRemove,
}: {
  proposal: WorkProposal;
  state: ProposalState;
  onApply: () => void;
  onCancel: () => void;
  onReopen: () => void;
  onOpen: (documentId: string, documentType: string) => void;
  editing?: EditingState | null;
  onStartEdit?: (at: string) => void;
  onEditField?: (key: string, value: string) => void;
  onDoneEdit?: () => void;
  onCancelEdit?: () => void;
  onRemove?: () => void;
}) {
  const headingId = useId();
  const n = proposal.changes.length;
  const outcome = state.phase === "settled" ? state.outcome : null;
  const statusOf = (k: number): "done" | "failed" | "skipped" | "pending" => {
    if (state.phase === "applying") return k < state.from ? "done" : "pending";
    return outcome && outcome.status !== "cancelled" ? (outcome.results[k]?.status ?? "pending") : "pending";
  };
  const inFlight = (k: number) => state.phase === "applying" && k >= state.from && k <= state.to;
  const made = outcome ? outcome.results.filter((r) => r.status === "done").length : 0;
  const failedAt = outcome ? outcome.results.findIndex((r) => r.status === "failed") : -1;
  const form = proposal.form;
  const canEdit = state.phase === "pending" && form !== undefined && onStartEdit !== undefined;
  const editingOpen = canEdit && editing !== null;

  return (
    <section
      aria-labelledby={headingId}
      className="mt-4 rounded-xl p-4"
      style={{ backgroundColor: "var(--bai-surface)", border: "1px solid var(--bai-border)" }}
    >
      <div className="flex items-baseline justify-between gap-3">
        <h3 id={headingId} className="text-[14px] font-semibold" style={{ color: "var(--bai-text)" }}>
          Proposed changes to your work
        </h3>
        <span className="shrink-0 text-[12px]" style={{ color: "var(--bai-text-muted)" }}>
          {plural(n, "change")}
        </span>
      </div>
      <p className="mt-1 text-[13px] leading-snug" style={{ color: "var(--bai-text-secondary)" }}>
        {proposal.summary}
      </p>

      <ol className="mt-3 space-y-2">
        {proposal.changes.map((c, k) => {
          const editable = canEdit && !c.derived && c.at !== undefined;
          const isEdited = !c.derived && c.at !== undefined && (proposal.edited ?? []).includes(c.at);
          const open = editable && editing?.at === c.at;
          return (
            <li key={k}>
              <div className="flex items-start gap-2.5 text-[13px] leading-snug">
                <Mark status={statusOf(k)} current={inFlight(k)} number={k + 1} />
                <span className="min-w-0 flex-1">
                  <span style={{ color: "var(--bai-text)" }}>
                    {c.warning && (
                      <span aria-hidden style={{ color: "var(--bai-warn)" }}>
                        ⚠{" "}
                      </span>
                    )}
                    {c.says}
                  </span>
                  {isEdited && (
                    <span className="ml-1.5 text-[11.5px] font-medium" style={{ color: "var(--bai-accent)" }}>
                      edited
                    </span>
                  )}
                  {c.warning && c.warning !== "a deletion" && c.warning !== "a removal" && (
                    <span className="block text-[12px]" style={{ color: "var(--bai-warn)" }}>
                      {c.warning}
                    </span>
                  )}
                  {outcome?.results[k]?.status === "failed" && outcome.results[k].error && (
                    <span className="block text-[12px]" style={{ color: "var(--bai-danger)" }}>
                      {outcome.results[k].error}
                    </span>
                  )}
                </span>
                {editable && !editingOpen && (
                  <button
                    type="button"
                    onClick={() => onStartEdit(c.at!)}
                    aria-label={`Edit change ${k + 1}`}
                    className="-my-0.5 shrink-0 rounded-md px-2 py-0.5 text-[12px] font-medium hover:bg-[var(--bai-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--bai-accent)]"
                    style={{ color: "var(--bai-text-muted)" }}
                  >
                    Edit
                  </button>
                )}
              </div>
              {open && editing && (
                <ChangeEditor
                  form={form}
                  editing={editing}
                  onEditField={(key, v) => onEditField?.(key, v)}
                  onDone={() => onDoneEdit?.()}
                  onCancel={() => onCancelEdit?.()}
                  onRemove={() => onRemove?.()}
                />
              )}
            </li>
          );
        })}
      </ol>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {state.phase === "pending" && (
          <>
            <p className="min-w-[14rem] flex-1 text-[12px] leading-snug" style={{ color: "var(--bai-text-muted)" }}>
              {editingOpen
                ? "Finish editing the open change to apply."
                : `Nothing changes until you apply.${canEdit ? " You can edit any change first." : ""}${removalNote(proposal.deletions, n)}`}
            </p>
            <span className="ml-auto flex shrink-0 gap-2">
              <button
                type="button"
                onClick={onCancel}
                disabled={editingOpen}
                className="rounded-lg px-3.5 py-2 text-[13px] font-medium hover:bg-[var(--bai-hover)] disabled:opacity-50"
                style={{ color: "var(--bai-text-secondary)" }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onApply}
                disabled={editingOpen}
                className="rounded-lg px-4 py-2 text-[13px] font-semibold transition-colors hover:bg-[var(--bai-accent-hover)] disabled:cursor-not-allowed disabled:opacity-50"
                style={{ backgroundColor: "var(--bai-accent)", color: "var(--bai-accent-text)" }}
              >
                Apply {plural(n, "change")}
              </button>
            </span>
          </>
        )}
        {state.phase === "applying" && (
          <p className="text-[12.5px]" role="status" style={{ color: "var(--bai-text-secondary)" }}>
            Applying {state.from === state.to ? `change ${state.from + 1}` : `changes ${state.from + 1}–${state.to + 1}`} of {n}…
          </p>
        )}
        {outcome?.status === "applied" && (
          <>
            <p className="flex-1 text-[12.5px]" role="status" style={{ color: "var(--bai-text-secondary)" }}>
              <span style={{ color: "var(--bai-ok)" }}>✓</span> Applied {n === 1 ? "the change" : `all ${n} changes`}.
            </p>
            <OpenLinks outcome={outcome} onOpen={onOpen} />
          </>
        )}
        {(outcome?.status === "partial" || outcome?.status === "failed") && (
          <>
            <p className="flex-1 text-[12.5px] leading-snug" role="alert" style={{ color: "var(--bai-text)" }}>
              Stopped at change {failedAt + 1}.{" "}
              {made > 0 ? `${made === 1 ? "Change 1 was" : `Changes 1–${made} were`} made; the rest were not.` : "Nothing was changed."}
            </p>
            <OpenLinks outcome={outcome} onOpen={onOpen} />
          </>
        )}
        {outcome?.status === "cancelled" && (
          <>
            <p className="flex-1 text-[12.5px]" style={{ color: "var(--bai-text-muted)" }}>
              Cancelled — nothing was changed.
            </p>
            <button
              type="button"
              onClick={onReopen}
              className="rounded-md px-2 py-1 text-[12.5px] font-medium hover:bg-[var(--bai-hover)]"
              style={{ color: "var(--bai-accent)" }}
            >
              Apply after all
            </button>
          </>
        )}
      </div>
    </section>
  );
}

/** The titles of the scopes of work a proposal deletes whole — what the person types to confirm. */
export function scopesDeletedBy(p: WorkProposal): string[] {
  return p.changes
    .filter((c) => c.kind === "delete_document" && c.documentType === SCOPE_TYPE && c.document)
    .map((c) => p.documents[c.document!]?.title ?? c.document!);
}

export function WorkProposalCard({ proposal: original }: { proposal: WorkProposal }) {
  const driveId = useSelectedDriveId();
  const { proposal, state, apply, cancel, reopen, edit, remove } = useWorkProposal(original, driveId);
  const [editing, setEditing] = useState<EditingState | null>(null);
  const [confirming, setConfirming] = useState(false);
  const doomed = scopesDeletedBy(proposal);
  const n = proposal.changes.length;

  const startEdit = (at: string) => {
    if (!proposal.form) return;
    setEditing({ at, values: Object.fromEntries(editableFields(proposal.form, at).map(({ field, value }) => [field.key, value])), error: null, busy: false });
  };
  const finish = async (how: "checking" | "removing") => {
    if (!editing || editing.busy) return;
    const current = editing;
    setEditing({ ...current, busy: how, error: null });
    const error = how === "checking" ? await edit(current.at, current.values) : await remove(current.at);
    setEditing(error ? { ...current, busy: false, error } : null);
  };

  return (
    <>
      <WorkProposalView
        proposal={proposal}
        state={state}
        onApply={() => (doomed.length ? setConfirming(true) : void apply())}
        onCancel={cancel}
        onReopen={reopen}
        onOpen={(documentId, documentType) => openCitation({ documentId, documentType })}
        editing={editing}
        onStartEdit={startEdit}
        onEditField={(key, value) => setEditing((e) => (e ? { ...e, values: { ...e.values, [key]: value } } : e))}
        onDoneEdit={() => void finish("checking")}
        onCancelEdit={() => setEditing(null)}
        onRemove={() => void finish("removing")}
      />
      {confirming && (
        <TypeToConfirmDialog
          title={doomed.length === 1 ? `Delete “${doomed[0]}”?` : `Delete ${doomed.length} scopes of work?`}
          name={doomed.length === 1 ? doomed[0] : "delete"}
          nameLabel={doomed.length === 1 ? "the scope's title" : "the word"}
          confirmLabel={`Apply ${plural(n, "change")}`}
          busyLabel="Applying…"
          onConfirm={() => {
            setConfirming(false);
            void apply();
          }}
          onCancel={() => setConfirming(false)}
        >
          <p>
            {doomed.length === 1 ? "This proposal deletes the whole scope of work" : `This proposal deletes ${doomed.length} whole scopes of work`} — envelopes, deliverables,
            milestones and contributors. It cannot be undone.
          </p>
        </TypeToConfirmDialog>
      )}
    </>
  );
}
