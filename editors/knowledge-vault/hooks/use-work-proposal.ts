/**
 * Applying a proposal the chat made to scopes of work, projects and work
 * breakdowns (lib/chat/work-changes.ts) — only when the person presses Apply.
 *
 * The writes go the way the scope-of-work editor's own go: documents are
 * created on the server in /projects (`createDocumentRemote`, as the editor
 * creates a project's work breakdown), every operation is a signed
 * `dispatchActions` batch, and a deletion is `deleteDocumentRemote`. Changes
 * run in order; consecutive operations on one document go as one batch; the
 * first failure stops the rest, and the result says which changes were made.
 *
 * `new:<name>` references become real ids here: a document's from its
 * creation, anything inside one (a project, a deliverable, a goal) minted on
 * first use and reused wherever the same name appears.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { generateId } from "document-model/core";
import { createDocumentRemote, deleteDocumentRemote } from "../lib/remote-reactor.js";
import { triggerVaultPull } from "./use-remote-first.js";
import { applyAndWait } from "./use-save-answer.js";
import { writeErrorText } from "../../shared/use-doc-write.js";
import {
  SCOPE_TYPE,
  WBS_TYPE,
  buildAction,
  forThePerson,
  formToChanges,
  isNewRef,
  missingIn,
  withEdit,
  withoutEntry,
  type CheckResult,
  type ProposedChange,
  type WorkProposal,
} from "../lib/chat/work-changes.js";
import { checkWorkProposal } from "../lib/chat/vault-tools.js";
import { readEdited, readOutcome, writeEdited, writeOutcome, type ChangeStatus, type WorkOutcome } from "../lib/chat/proposal-outcomes.js";

export type { ChangeStatus, WorkOutcome } from "../lib/chat/proposal-outcomes.js";

export interface WorkDeps {
  /** Check a form again — the person's edit — as the chat's tool checks the model's. */
  check: (form: Record<string, unknown>, driveId: string, keep: { id: string; createdAt: string; edited: readonly string[] }) => Promise<CheckResult>;
  createDocument: (o: { documentType: string; name: string; driveId: string }) => Promise<string>;
  /** Apply actions to one document; resolves with its errors, empty when all landed. */
  apply: (actions: unknown[], documentId: string) => Promise<string[]>;
  deleteDocument: (documentId: string, driveId: string) => Promise<void>;
  refresh: () => void;
}

export const REAL_WORK_DEPS: WorkDeps = {
  check: checkWorkProposal,
  createDocument: ({ documentType, name, driveId }) =>
    createDocumentRemote({ documentType, name, driveId, targetFolderPath: "projects" }),
  apply: applyAndWait,
  deleteDocument: (documentId, driveId) => deleteDocumentRemote(documentId, driveId),
  refresh: triggerVaultPull,
};

/**
 * Every `new:` name the proposal declares, resolved: documents from their
 * creation, everything else minted once. A value that only looks like a name
 * — a title that happens to start "new:" — is left as written.
 */
class Ids {
  private map = new Map<string, string>();
  constructor(
    private mint: () => string,
    private declared: ReadonlySet<string>,
  ) {}
  set(ref: string, id: string) {
    this.map.set(ref, id);
  }
  of(value: string): string {
    if (!isNewRef(value) || !this.declared.has(value)) return value;
    let id = this.map.get(value);
    if (!id) {
      id = this.mint();
      this.map.set(value, id);
    }
    return id;
  }
  resolve(v: unknown): unknown {
    if (typeof v === "string") return this.of(v);
    if (Array.isArray(v)) return v.map((x) => this.resolve(x));
    if (v && typeof v === "object") {
      return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, this.resolve(x)]));
    }
    return v;
  }
}

/** Where a failure is reported: the first error, in plain words. */
const firstError = (errors: string[]) => errors[0] ?? "The vault did not accept this change.";

/**
 * Make the proposal's changes, in order. `onChange(from, to)` says which
 * changes are being made now — one, or a batch on one document; every change
 * before `from` is made.
 */
export async function applyWorkProposal(
  proposal: WorkProposal,
  driveId: string,
  deps: WorkDeps = REAL_WORK_DEPS,
  onChange?: (from: number, to: number) => void,
  mint: () => string = generateId,
): Promise<WorkOutcome> {
  const ids = new Ids(mint, new Set(proposal.refs));
  const results: WorkOutcome["results"] = proposal.changes.map(() => ({ status: "skipped" as ChangeStatus }));
  const created: WorkOutcome["created"] = [];
  // Existing documents changed — a created one is already in `created`.
  const touchedIds = new Set<string>();
  const isCreated = (id: string) => created.some((d) => d.documentId === id);
  const touch = (id: string) => {
    if (!isCreated(id)) touchedIds.add(id);
  };
  const touched = (): WorkOutcome["touched"] =>
    [...touchedIds].map((documentId) => ({
      documentId,
      documentType: proposal.documents[documentId]?.documentType ?? SCOPE_TYPE,
      title: proposal.documents[documentId]?.title ?? documentId,
    }));
  const done = (from: number, to: number) => {
    for (let k = from; k <= to; k++) results[k] = { status: "done" };
  };
  const failAt = (k: number, error: string): WorkOutcome => {
    results[k] = { status: "failed", error };
    deps.refresh();
    const any = results.some((r) => r.status === "done");
    return { status: any ? "partial" : "failed", results, created, touched: touched(), at: new Date().toISOString() };
  };

  const changes = proposal.changes;
  for (let k = 0; k < changes.length; k++) {
    const c: ProposedChange = changes[k];
    // A creation or deletion is one change at a time; steps report their batch below.
    if (c.steps === undefined) onChange?.(k, k);
    try {
      if (c.kind === "create_scope") {
        const id = await deps.createDocument({ documentType: SCOPE_TYPE, name: c.title ?? "Scope of work", driveId });
        ids.set(c.ref!, id);
        created.push({ documentId: id, documentType: SCOPE_TYPE, title: c.title ?? "Scope of work" });
        const errors = await deps.apply(
          [buildAction(SCOPE_TYPE, "EDIT_SCOPE_OF_WORK", { title: c.title, ...(c.description ? { description: c.description } : {}), status: c.status ?? "DRAFT" })],
          id,
        );
        if (errors.length) return failAt(k, `The scope was created, but its title and status did not save: ${firstError(errors)}`);
        done(k, k);
        continue;
      }
      if (c.kind === "create_wbs") {
        const id = await deps.createDocument({ documentType: WBS_TYPE, name: c.name ?? "Work breakdown", driveId });
        ids.set(c.ref!, id);
        created.push({ documentId: id, documentType: WBS_TYPE, title: c.name ?? "Work breakdown" });
        if (c.scope && c.project) {
          // Both ways, as the scope editor links them: the project points at
          // the breakdown, the breakdown back at the scope and the project.
          const scopeId = ids.of(c.scope);
          const projectId = ids.of(c.project);
          const forward = await deps.apply([buildAction(SCOPE_TYPE, "LINK_PROJECT_WBS", { projectId, wbsRef: id })], scopeId);
          if (forward.length) return failAt(k, `The work breakdown was created, but the project could not be linked to it: ${firstError(forward)}`);
          const back = await deps.apply(
            [
              buildAction(WBS_TYPE, "SET_SOW_PROJECT_REF", { sowRef: scopeId, sowProjectId: projectId }),
              ...(c.owner ? [buildAction(WBS_TYPE, "SET_OWNER", { owner: c.owner })] : []),
            ],
            id,
          );
          if (back.length) return failAt(k, `The work breakdown was created and the project points at it, but its link back did not save: ${firstError(back)}`);
          touch(scopeId);
        } else if (c.owner) {
          const owner = await deps.apply([buildAction(WBS_TYPE, "SET_OWNER", { owner: c.owner })], id);
          if (owner.length) return failAt(k, `The work breakdown was created, but its owner did not save: ${firstError(owner)}`);
        }
        done(k, k);
        continue;
      }
      if (c.kind === "delete_document") {
        const gone = ids.of(c.document!);
        await deps.deleteDocument(gone, driveId);
        touchedIds.delete(gone); // nothing left to open
        done(k, k);
        continue;
      }
      // Steps: this change's and those of the changes after it on the same document, as one batch.
      const docId = ids.of(c.document!);
      const runsSteps = (x: ProposedChange) => x.steps !== undefined && x.kind !== "delete_document";
      let end = k;
      while (end + 1 < changes.length && runsSteps(changes[end + 1]) && ids.of(changes[end + 1].document!) === docId) end++;
      const batch = changes.slice(k, end + 1).flatMap((x) =>
        (x.steps ?? []).map((step) => {
          const input = ids.resolve(step.input) as Record<string, unknown>;
          // A goal note is stamped when it is written, as the breakdown editor stamps one.
          if (step.type === "ADD_NOTE" && !input.timestamp) input.timestamp = new Date().toISOString();
          return buildAction(x.documentType as typeof SCOPE_TYPE, step.type, input);
        }),
      );
      onChange?.(k, end);
      const errors = await deps.apply(batch, docId);
      if (errors.length) {
        // A batch either lands or names what it refused; which of its changes, it does not say.
        for (let j = k + 1; j <= end; j++) results[j] = { status: "skipped" };
        return failAt(k, firstError(errors));
      }
      touch(docId);
      done(k, end);
      k = end;
    } catch (err) {
      return failAt(k, writeErrorText([err]));
    }
  }
  deps.refresh();
  return { status: "applied", results, created, touched: touched(), at: new Date().toISOString() };
}

/** An edit, checked: the proposal as it now reads — or why not, in words for the person. */
export type EditResult = { ok: true; proposal: WorkProposal } | { ok: false; error: string };

/**
 * One entry's words changed by the person, then the whole proposal checked
 * and rehearsed again — the same rules the chat's own proposal met.
 */
export async function editProposal(p: WorkProposal, at: string, values: Record<string, string>, driveId: string, check: WorkDeps["check"]): Promise<EditResult> {
  if (!p.form) return { ok: false, error: "This proposal was made before cards could be edited: ask the chat for it again." };
  const missing = missingIn(p.form, at, values);
  if (missing) return { ok: false, error: missing };
  const edited = p.edited?.includes(at) ? p.edited : [...(p.edited ?? []), at];
  const r = await check(withEdit(p.form, at, values), driveId, { id: p.id, createdAt: p.createdAt, edited });
  return r.ok ? { ok: true, proposal: r.proposal } : { ok: false, error: r.errors.map(forThePerson).join(" ") };
}

/** One entry taken out of the proposal — refused when other changes depend on it, or when it is the last. */
export async function removeFromProposal(p: WorkProposal, at: string, driveId: string, check: WorkDeps["check"]): Promise<EditResult> {
  if (!p.form) return { ok: false, error: "This proposal was made before cards could be edited: ask the chat for it again." };
  const { form, edited } = withoutEntry(p.form, at, p.edited ?? []);
  if (formToChanges(form).length === 0) return { ok: false, error: "This is the only change: cancel the proposal instead." };
  const r = await check(form, driveId, { id: p.id, createdAt: p.createdAt, edited });
  return r.ok ? { ok: true, proposal: r.proposal } : { ok: false, error: "Other changes in the proposal depend on this one, so it cannot go on its own." };
}

export type ProposalState =
  | { phase: "pending" }
  /** Changes `from`..`to` are being made; every change before `from` is made. */
  | { phase: "applying"; from: number; to: number }
  | { phase: "settled"; outcome: WorkOutcome };

/**
 * The card's state: the proposal as the person last edited it, pending until
 * applied or cancelled, then the outcome — all remembered in this browser.
 */
export function useWorkProposal(original: WorkProposal, driveId: string | undefined, deps: WorkDeps = REAL_WORK_DEPS) {
  const [proposal, setProposal] = useState<WorkProposal>(() => readEdited(original.id) ?? original);
  const [state, setState] = useState<ProposalState>(() => {
    const o = readOutcome(original.id);
    return o ? { phase: "settled", outcome: o } : { phase: "pending" };
  });
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const apply = useCallback(async () => {
    if (!driveId) return;
    setState({ phase: "applying", from: 0, to: 0 });
    const outcome = await applyWorkProposal(proposal, driveId, deps, (from, to) => {
      if (alive.current) setState({ phase: "applying", from, to });
    });
    writeOutcome(proposal.id, outcome);
    if (alive.current) setState({ phase: "settled", outcome });
  }, [proposal, driveId, deps]);
  const cancel = useCallback(() => {
    const outcome: WorkOutcome = { status: "cancelled", results: [], created: [], touched: [], at: new Date().toISOString() };
    writeOutcome(proposal.id, outcome);
    setState({ phase: "settled", outcome });
  }, [proposal.id]);
  /** A cancelled proposal can still be applied: the person changed their mind. */
  const reopen = useCallback(() => setState({ phase: "pending" }), []);
  /** Settle an edit: keep the proposal as it now reads, or hand back why not. */
  const settle = useCallback((r: EditResult): string | null => {
    if (!r.ok) return r.error;
    writeEdited(r.proposal);
    if (alive.current) setProposal(r.proposal);
    return null;
  }, []);
  const edit = useCallback(
    async (at: string, values: Record<string, string>) => (driveId ? settle(await editProposal(proposal, at, values, driveId, deps.check)) : "The vault is not open."),
    [proposal, driveId, deps, settle],
  );
  const remove = useCallback(
    async (at: string) => (driveId ? settle(await removeFromProposal(proposal, at, driveId, deps.check)) : "The vault is not open."),
    [proposal, driveId, deps, settle],
  );
  return { proposal, state, apply, cancel, reopen, edit, remove };
}
