/**
 * Applying a proposal: what is created, linked and changed, in which order,
 * and what the person is told when a change is refused. The fake vault below
 * applies the actions with the models' own reducers, so the tests check the
 * documents that result, not only the calls.
 */
import "../../shared/test/browser-globals.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { reducer as sowReducer, utils as sowUtils } from "document-models/scope-of-work";
import { reducer as wbsReducer, utils as wbsUtils } from "document-models/work-breakdown-structure";
import type { WorkDeps } from "./use-work-proposal.js";

vi.mock("@powerhousedao/reactor-browser", () => ({ dispatchActions: vi.fn() }));

const { applyWorkProposal, editProposal, removeFromProposal } = await import("./use-work-proposal.js");
const { checkProposal, formToChanges, FORM_EXAMPLE, SCOPE_TYPE, WBS_TYPE } = await import("../lib/chat/work-changes.js");
const { linkedWorkDocs, loadedWorkDocs, scopeState, wbsState } = await import("../lib/chat/test/work-fixtures.js");

afterEach(() => vi.useRealTimers());

interface Held {
  type: string;
  doc: { state: { global: Record<string, unknown> }; operations: { global: { error?: string }[] } };
}

/** A vault in memory: documents created, changed by the real reducers, deleted. */
class FakeVault {
  docs = new Map<string, Held>();
  calls: string[] = [];
  private n = 0;
  /** Refuse a write before it reaches the reducer — as the network or access rules would. */
  refuse: ((documentId: string, types: string[]) => string | null) | null = null;

  constructor(seed = true) {
    if (!seed) return;
    this.docs.set("scope-1", { type: SCOPE_TYPE, doc: sowUtils.createDocument({ global: scopeState() } as never) as never });
    this.docs.set("wbs-1", { type: WBS_TYPE, doc: wbsUtils.createDocument({ global: wbsState() } as never) as never });
  }
  state(id: string) {
    return this.docs.get(id)!.doc.state.global as Record<string, unknown> & Record<string, never>;
  }
  deps: WorkDeps = {
    // An edit is checked as the tool checks a form — here against the fixture documents.
    check: (form, _driveId, keep) =>
      Promise.resolve(
        ((r) => (r.ok ? { ok: true as const, proposal: { ...r.proposal, form, ...(keep.edited.length ? { edited: [...keep.edited] } : {}) } } : r))(
          checkProposal({ summary: form.summary, changes: formToChanges(form) }, loadedWorkDocs(), () => keep.createdAt, () => keep.id, keep.edited),
        ),
      ),
    createDocument: ({ documentType, name, driveId }) => {
      const id = `doc-${++this.n}`;
      const doc = (documentType === SCOPE_TYPE ? sowUtils : wbsUtils).createDocument() as never;
      this.docs.set(id, { type: documentType, doc });
      this.calls.push(`create ${documentType} “${name}” in ${driveId} → ${id}`);
      return Promise.resolve(id);
    },
    apply: (actions, documentId) => {
      const types = (actions as { type: string }[]).map((a) => a.type);
      this.calls.push(`apply ${types.join("+")} → ${documentId}`);
      const refused = this.refuse?.(documentId, types);
      if (refused) return Promise.resolve([refused]);
      const held = this.docs.get(documentId);
      if (!held) return Promise.resolve(["The vault could not find the document to change."]);
      for (const a of actions) {
        const before = held.doc.operations.global.length;
        held.doc = (held.type === SCOPE_TYPE ? sowReducer : wbsReducer)(held.doc as never, a as never) as never;
        const error = held.doc.operations.global[before]?.error;
        if (error) return Promise.resolve([error]);
      }
      return Promise.resolve([]);
    },
    deleteDocument: (documentId, driveId) => {
      this.calls.push(`delete ${documentId} in ${driveId}`);
      this.docs.delete(documentId);
      return Promise.resolve();
    },
    refresh: () => {
      this.calls.push("refresh");
    },
  };
}

function proposalOf(changes: unknown[]) {
  const r = checkProposal({ summary: "Plan the work", changes }, loadedWorkDocs(), () => "2026-10-15T12:00:00.000Z", () => "p-1");
  if (!r.ok) throw new Error(r.errors.join(" | "));
  return r.proposal;
}
const minter = () => {
  let k = 0;
  return () => `id-${++k}`;
};

describe("applying a proposal", () => {
  it("creates a scope with a project and its breakdown, links them both ways, and sends each document's changes as one batch", async () => {
    const proposal = proposalOf([
      { kind: "create_scope", ref: "new:ops", title: "Operations 2027", description: "Running the vault in production" },
      { kind: "operation", document: "new:ops", type: "ADD_AGENT", input: { id: "new:bob", name: "Bob" } },
      { kind: "operation", document: "new:ops", type: "ADD_PROJECT", input: { id: "new:infra", code: "INF", title: "Infrastructure", projectOwner: "new:bob", budgetType: "OPEX", currency: "EUR" } },
      { kind: "create_wbs", ref: "new:infra-wbs", name: "Infrastructure breakdown", scope: "new:ops", project: "new:infra", owner: "Bob" },
      { kind: "operation", document: "new:infra-wbs", type: "CREATE_GOAL", input: { id: "new:servers", description: "Provision servers" } },
      { kind: "operation", document: "new:infra-wbs", type: "CREATE_GOAL", input: { id: "new:dns", description: "Point the domain", parentId: "new:servers" } },
    ]);
    const vault = new FakeVault(false);
    const progress: string[] = [];
    const outcome = await applyWorkProposal(proposal, "drive-1", vault.deps, (from, to) => progress.push(`${from}-${to}`), minter());

    expect(vault.calls).toEqual([
      "create powerhouse/scopeofwork “Operations 2027” in drive-1 → doc-1",
      "apply EDIT_SCOPE_OF_WORK → doc-1",
      "apply ADD_AGENT+ADD_PROJECT → doc-1",
      "create bai/wbs “Infrastructure breakdown” in drive-1 → doc-2",
      "apply LINK_PROJECT_WBS → doc-1",
      "apply SET_SOW_PROJECT_REF+SET_OWNER → doc-2",
      "apply CREATE_GOAL+CREATE_GOAL → doc-2",
      "refresh",
    ]);
    expect(progress).toEqual(["0-0", "1-2", "3-3", "4-5"]);

    // The documents that result: every new:<name> became one real id, used everywhere it was named.
    const scope = vault.state("doc-1") as unknown as { title: string; description: string; status: string; contributors: { id: string; name: string }[]; projects: { id: string; code: string; projectOwner: string; budgetType: string; currency: string; wbsRef: string }[] };
    expect(scope).toMatchObject({ title: "Operations 2027", description: "Running the vault in production", status: "DRAFT" });
    expect(scope.contributors).toEqual([expect.objectContaining({ id: "id-1", name: "Bob" })]);
    expect(scope.projects).toEqual([expect.objectContaining({ id: "id-2", code: "INF", projectOwner: "id-1", budgetType: "OPEX", currency: "EUR", wbsRef: "doc-2" })]);
    const breakdown = vault.state("doc-2") as unknown as { sowRef: string; sowProjectId: string; owner: string; goals: { id: string; description: string; parentId: string | null }[] };
    expect(breakdown).toMatchObject({ sowRef: "doc-1", sowProjectId: "id-2", owner: "Bob" });
    expect(breakdown.goals.map((g) => [g.id, g.description, g.parentId ?? null])).toEqual([
      ["id-3", "Provision servers", null],
      ["id-4", "Point the domain", "id-3"],
    ]);
    expect(JSON.stringify([scope, breakdown])).not.toContain("new:");

    expect(outcome.status).toBe("applied");
    expect(outcome.results.map((r) => r.status)).toEqual(["done", "done", "done", "done", "done", "done"]);
    expect(outcome.created).toEqual([
      { documentId: "doc-1", documentType: SCOPE_TYPE, title: "Operations 2027" },
      { documentId: "doc-2", documentType: WBS_TYPE, title: "Infrastructure breakdown" },
    ]);
    expect(outcome.touched).toEqual([]); // both documents are new: they are in `created`
  });

  it("changes existing documents, and names them by title to open afterwards", async () => {
    const proposal = proposalOf([
      { kind: "operation", document: "scope-1", type: "UPDATE_PROJECT", input: { id: "proj-kv", title: "Vault" } },
      { kind: "operation", document: "wbs-1", type: "SET_GOAL_STATUS", input: { id: "g-a", status: "IN_PROGRESS" } },
    ]);
    const vault = new FakeVault();
    const outcome = await applyWorkProposal(proposal, "drive-1", vault.deps, undefined, minter());
    expect(outcome.status).toBe("applied");
    expect((vault.state("scope-1") as unknown as { projects: { title: string }[] }).projects[0].title).toBe("Vault");
    expect(outcome.touched).toEqual([
      { documentId: "scope-1", documentType: SCOPE_TYPE, title: "Powerhouse 2026" },
      { documentId: "wbs-1", documentType: WBS_TYPE, title: "Knowledge Vault breakdown" },
    ]);
  });

  it("links a new breakdown to an existing scope's project, and stamps a goal note when it is written", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-15T15:30:00.000Z"));
    const proposal = proposalOf([
      { kind: "create_wbs", ref: "new:kvw", name: "Vault delivery", scope: "scope-1", project: "proj-kv" },
      { kind: "operation", document: "new:kvw", type: "CREATE_GOAL", input: { id: "new:g", description: "Launch" } },
      { kind: "operation", document: "new:kvw", type: "ADD_NOTE", input: { goalId: "new:g", noteId: "new:n", note: "Kick-off on Monday" } },
    ]);
    const vault = new FakeVault();
    const outcome = await applyWorkProposal(proposal, "drive-1", vault.deps, undefined, minter());
    expect(outcome.status).toBe("applied");
    expect((vault.state("scope-1") as unknown as { projects: { id: string; wbsRef: string }[] }).projects[0]).toMatchObject({ id: "proj-kv", wbsRef: "doc-1" });
    const goal = (vault.state("doc-1") as unknown as { goals: { notes: { note: string; timestamp: string; author: string | null }[] }[] }).goals[0];
    expect(goal.notes).toEqual([expect.objectContaining({ note: "Kick-off on Monday", timestamp: "2026-10-15T15:30:00.000Z" })]);
    expect(goal.notes[0].author ?? null).toBeNull();
    expect(outcome.touched).toEqual([{ documentId: "scope-1", documentType: SCOPE_TYPE, title: "Powerhouse 2026" }]);
  });

  it("deletes a document in the drive, and offers nothing to open for it", async () => {
    const proposal = proposalOf([
      { kind: "operation", document: "wbs-1", type: "SET_OWNER", input: { owner: "Alice" } },
      { kind: "delete_document", document: "wbs-1" },
    ]);
    const vault = new FakeVault();
    const outcome = await applyWorkProposal(proposal, "drive-1", vault.deps, undefined, minter());
    expect(vault.calls).toEqual(["apply SET_OWNER → wbs-1", "delete wbs-1 in drive-1", "refresh"]);
    expect(vault.docs.has("wbs-1")).toBe(false);
    expect(outcome).toMatchObject({ status: "applied", touched: [] });
  });
});

describe("applying the form a model writes", () => {
  it("adds the owner once, the project, the breakdown linked both ways, and the goals nested — every name one id", async () => {
    const r = checkProposal({ summary: "x", changes: formToChanges(FORM_EXAMPLE) }, loadedWorkDocs(), () => "t", () => "p-form");
    if (!r.ok) throw new Error(r.errors.join(" | "));
    const vault = new FakeVault(false);
    const outcome = await applyWorkProposal(r.proposal, "drive-1", vault.deps, undefined, minter());
    expect(vault.calls).toEqual([
      "create powerhouse/scopeofwork “Operations 2027” in drive-1 → doc-1",
      "apply EDIT_SCOPE_OF_WORK → doc-1",
      "apply ADD_AGENT+ADD_PROJECT → doc-1",
      "create bai/wbs “Infrastructure plan” in drive-1 → doc-2",
      "apply LINK_PROJECT_WBS → doc-1",
      "apply SET_SOW_PROJECT_REF → doc-2",
      "apply CREATE_GOAL+CREATE_GOAL → doc-2",
      "apply ADD_PROJECT_DELIVERABLE+EDIT_DELIVERABLE+ADD_ROADMAP+ADD_MILESTONE+ADD_DELIVERABLE_IN_SET → doc-1",
      "refresh",
    ]);
    const scope = vault.state("doc-1") as unknown as { contributors: { id: string; name: string }[]; projects: { id: string; code: string; projectOwner: string; wbsRef: string }[] };
    expect(scope.contributors).toEqual([expect.objectContaining({ id: "id-1", name: "Bob" })]);
    expect(scope.projects).toEqual([expect.objectContaining({ id: "id-2", code: "INF", projectOwner: "id-1", wbsRef: "doc-2" })]);
    const plan = vault.state("doc-2") as unknown as { sowRef: string; sowProjectId: string; goals: { id: string; description: string; parentId: string | null }[] };
    expect(plan).toMatchObject({ sowRef: "doc-1", sowProjectId: "id-2" });
    expect(plan.goals.map((g) => [g.description, g.parentId ?? null])).toEqual([
      ["Provision servers", null],
      ["Point the domain", plan.goals[0].id],
    ]);
    expect(outcome.status).toBe("applied");
  });

  it("unlinks a breakdown from its project, then deletes it", async () => {
    const docs = linkedWorkDocs();
    const r = checkProposal({ summary: "x", changes: formToChanges({ deletions: [{ document: "wbs-1" }] }) }, docs);
    if (!r.ok) throw new Error(r.errors.join(" | "));
    const vault = new FakeVault(false);
    vault.docs.set("scope-1", { type: SCOPE_TYPE, doc: sowUtils.createDocument({ global: docs.get("scope-1")!.state } as never) as never });
    vault.docs.set("wbs-1", { type: WBS_TYPE, doc: wbsUtils.createDocument({ global: docs.get("wbs-1")!.state } as never) as never });
    const outcome = await applyWorkProposal(r.proposal, "drive-1", vault.deps, undefined, minter());
    expect(vault.calls).toEqual(["apply LINK_PROJECT_WBS → scope-1", "delete wbs-1 in drive-1", "refresh"]);
    expect((vault.state("scope-1") as unknown as { projects: { wbsRef: string | null }[] }).projects[0].wbsRef ?? null).toBeNull();
    expect(vault.docs.has("wbs-1")).toBe(false);
    expect(outcome.status).toBe("applied");
  });

  it("turns only the proposal's own names into ids: a description that starts with new: is saved as written", async () => {
    const r = checkProposal(
      { summary: "x", changes: formToChanges({ operations: [{ document: "scope-1", type: "EDIT_DELIVERABLE", input: { id: "del-1", description: "new:approach to search" } }] }) },
      loadedWorkDocs(),
    );
    if (!r.ok) throw new Error(r.errors.join(" | "));
    const vault = new FakeVault();
    await applyWorkProposal(r.proposal, "drive-1", vault.deps, undefined, minter());
    const del = (vault.state("scope-1") as unknown as { deliverables: { id: string; description: string }[] }).deliverables.find((d) => d.id === "del-1");
    expect(del?.description).toBe("new:approach to search");
  });
});

describe("when a change is refused", () => {
  it("stops there, says what was made, and makes nothing after it", async () => {
    const proposal = proposalOf([
      { kind: "operation", document: "scope-1", type: "UPDATE_PROJECT", input: { id: "proj-kv", title: "Vault" } },
      { kind: "operation", document: "wbs-1", type: "SET_GOAL_STATUS", input: { id: "g-a", status: "IN_PROGRESS" } },
      { kind: "operation", document: "scope-1", type: "EDIT_DELIVERABLE", input: { id: "del-1", status: "TODO" } },
    ]);
    const vault = new FakeVault();
    vault.refuse = (id) => (id === "wbs-1" ? "Forbidden: insufficient permissions to execute operation" : null);
    const outcome = await applyWorkProposal(proposal, "drive-1", vault.deps, undefined, minter());
    expect(vault.calls).toEqual(["apply UPDATE_PROJECT → scope-1", "apply SET_GOAL_STATUS → wbs-1", "refresh"]);
    expect(outcome.status).toBe("partial");
    expect(outcome.results).toEqual([
      { status: "done" },
      { status: "failed", error: "Forbidden: insufficient permissions to execute operation" },
      { status: "skipped" },
    ]);
    expect(outcome.touched).toEqual([{ documentId: "scope-1", documentType: SCOPE_TYPE, title: "Powerhouse 2026" }]);
  });

  it("marks a refused batch at its first change, and the rest of the batch as not made", async () => {
    const proposal = proposalOf([
      { kind: "operation", document: "scope-1", type: "UPDATE_PROJECT", input: { id: "proj-kv", title: "Vault" } },
      { kind: "operation", document: "scope-1", type: "EDIT_DELIVERABLE", input: { id: "del-1", status: "TODO" } },
    ]);
    const vault = new FakeVault();
    vault.refuse = () => "No answer from the vault yet. The change may still arrive; check that the vault is reachable.";
    const outcome = await applyWorkProposal(proposal, "drive-1", vault.deps, undefined, minter());
    expect(outcome.status).toBe("failed");
    expect(outcome.results.map((r) => r.status)).toEqual(["failed", "skipped"]);
  });

  it("puts a thrown failure in plain words", async () => {
    const proposal = proposalOf([{ kind: "create_scope", ref: "new:s", title: "Ops" }]);
    const vault = new FakeVault(false);
    vault.deps.createDocument = () => Promise.reject(new Error("Forbidden: insufficient permissions to execute operation \"ADD_FILE\""));
    const outcome = await applyWorkProposal(proposal, "drive-1", vault.deps, undefined, minter());
    expect(outcome).toMatchObject({ status: "failed", created: [] });
    expect(outcome.results[0]).toEqual({ status: "failed", error: "You don't have permission to change this vault. Ask its administrator for write access." });
  });

  it("says when a scope was made but its title did not save, and still offers it to open", async () => {
    const proposal = proposalOf([{ kind: "create_scope", ref: "new:s", title: "Ops" }]);
    const vault = new FakeVault(false);
    vault.refuse = () => "Something went wrong";
    const outcome = await applyWorkProposal(proposal, "drive-1", vault.deps, undefined, minter());
    expect(outcome.results[0].error).toBe("The scope was created, but its title and status did not save: Something went wrong");
    expect(outcome.created).toEqual([{ documentId: "doc-1", documentType: SCOPE_TYPE, title: "Ops" }]);
  });
});

describe("editing a proposal before it is applied", () => {
  /** The example form, checked as the tool checks it — form kept, as the card receives it. */
  function example() {
    const r = checkProposal({ summary: "x", changes: formToChanges(FORM_EXAMPLE) }, loadedWorkDocs(), () => "t", () => "p-ed");
    if (!r.ok) throw new Error(r.errors.join(" | "));
    return { ...r.proposal, form: FORM_EXAMPLE as unknown as Record<string, unknown> };
  }

  it("checks the edit again, rewrites every sentence that names the thing, and marks the entry edited", async () => {
    const r = await editProposal(example(), "projects[0]", { title: "Core infrastructure" }, "drive-1", new FakeVault().deps.check);
    if (!r.ok) throw new Error(r.error);
    expect(r.proposal).toMatchObject({ id: "p-ed", createdAt: "t", edited: ["projects[0]"] });
    expect(r.proposal.changes.map((c) => c.says).slice(1, 3)).toEqual([
      "Add project INF “Core infrastructure” to the new scope “Operations 2027”, owned by Bob (added as a contributor), OPEX budget, in EUR",
      "Create work breakdown “Infrastructure plan”, linked both ways to project INF “Core infrastructure”",
    ]);
    // A second edit of another entry keeps the first marked.
    const r2 = await editProposal(r.proposal, "goals[0]", { description: "Provision the servers" }, "drive-1", new FakeVault().deps.check);
    expect(r2.ok && r2.proposal.edited).toEqual(["projects[0]", "goals[0]"]);
  });

  it("applies the proposal as edited", async () => {
    const r = await editProposal(example(), "projects[0]", { title: "Core infrastructure", code: "CORE" }, "drive-1", new FakeVault().deps.check);
    if (!r.ok) throw new Error(r.error);
    const vault = new FakeVault(false);
    await applyWorkProposal(r.proposal, "drive-1", vault.deps, undefined, minter());
    expect((vault.state("doc-1") as unknown as { projects: { code: string; title: string }[] }).projects[0]).toMatchObject({ code: "CORE", title: "Core infrastructure" });
  });

  it("refuses an edit that leaves out what is needed, before checking anything", async () => {
    const check = vi.fn();
    expect(await editProposal(example(), "projects[0]", { title: " " }, "drive-1", check)).toEqual({ ok: false, error: "Title is needed." });
    expect(check).not.toHaveBeenCalled();
  });

  it("takes a change out — but not one others depend on, and not the last", async () => {
    const check = new FakeVault().deps.check;
    const r1 = await removeFromProposal(example(), "goals[1]", "drive-1", check);
    expect(r1.ok && r1.proposal.changes.filter((c) => c.kind === "add_goal").map((c) => c.says)).toEqual(["Add goal “Provision servers” to the new work breakdown “Infrastructure plan”"]);
    expect(await removeFromProposal(example(), "projects[0]", "drive-1", check)).toEqual({
      ok: false,
      error: "Other changes in the proposal depend on this one, so it cannot go on its own.",
    });
    const single = checkProposal({ summary: "x", changes: formToChanges({ scopes: [{ title: "Solo" }] }) }, loadedWorkDocs());
    if (!single.ok) throw new Error("expected a proposal");
    expect(await removeFromProposal({ ...single.proposal, form: { scopes: [{ title: "Solo" }] } }, "scopes[0]", "drive-1", check)).toEqual({
      ok: false,
      error: "This is the only change: cancel the proposal instead.",
    });
  });

  it("says a proposal made before cards could be edited cannot be", async () => {
    const { form: _form, ...old } = example();
    expect(await editProposal(old, "projects[0]", { title: "x" }, "drive-1", vi.fn())).toEqual({
      ok: false,
      error: "This proposal was made before cards could be edited: ask the chat for it again.",
    });
  });
});

describe("applying a roadmap", () => {
  it("adds the roadmap, its milestones with their dates, scheduled deliverables and coordinators", async () => {
    const r = checkProposal(
      {
        summary: "x",
        changes: formToChanges({
          roadmaps: [{ scope: "scope-1", ref: "new:r27", title: "2027" }],
          milestones: [{ roadmap: "new:r27", code: "M1", title: "Search live", target: "2027-02-15", deliverables: ["Search", "del-2"], coordinator: "Dana" }],
        }),
      },
      loadedWorkDocs(),
    );
    if (!r.ok) throw new Error(r.errors.join(" | "));
    const vault = new FakeVault();
    const outcome = await applyWorkProposal(r.proposal, "drive-1", vault.deps, undefined, minter());
    expect(vault.calls).toEqual(["apply ADD_ROADMAP+ADD_MILESTONE+ADD_DELIVERABLE_IN_SET+ADD_DELIVERABLE_IN_SET+ADD_AGENT+ADD_COORDINATOR → scope-1", "refresh"]);
    const g = vault.state("scope-1") as unknown as {
      roadmaps: { id: string; title: string; milestones: { sequenceCode: string; title: string; deliveryTarget: string; coordinators: string[]; scope: { deliverables: string[] } }[] }[];
      contributors: { id: string; name: string }[];
    };
    const road = g.roadmaps.find((x) => x.title === "2027")!;
    expect(road.milestones).toHaveLength(1);
    expect(road.milestones[0]).toMatchObject({ sequenceCode: "M1", title: "Search live", deliveryTarget: "2027-02-15", coordinators: ["id-3"] });
    expect(road.milestones[0].scope.deliverables).toEqual(["del-1", "del-2"]);
    expect(g.contributors.find((c) => c.name === "Dana")?.id).toBe("id-3");
    expect(outcome.status).toBe("applied");
  });
});
