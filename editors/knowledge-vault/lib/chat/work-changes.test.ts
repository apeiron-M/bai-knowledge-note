/**
 * The checker behind propose_work_changes: the form a model fills in, how a
 * proposal is checked and rehearsed before the person sees it, the sentences
 * the card shows — and the slips a small model makes, each read the one way
 * it can be read or sent back with its own change rewritten.
 *
 * The fixtures are built with the models' own reducers (test/work-fixtures),
 * so a loaded document here is what read_document returns from a vault.
 */
import { describe, expect, it } from "vitest";
import { actions as sow } from "document-models/scope-of-work";
import { actions as wbs } from "document-models/work-breakdown-structure";
import { linkedWorkDocs, loadedWorkDocs, pointingWorkDocs } from "./test/work-fixtures.js";
import {
  FORM_EXAMPLE,
  FORM_LISTS,
  SCOPE_TYPE,
  WBS_TYPE,
  WORK_OPERATIONS,
  checkProposal,
  creatorName,
  editableFields,
  forThePerson,
  formToChanges,
  missingIn,
  operationHome,
  withEdit,
  withoutEntry,
  workCatalog,
  type LoadedDocument,
  type WorkProposal,
} from "./work-changes.js";

const NOW = "2026-10-15T12:00:00.000Z";
const docs = loadedWorkDocs();

/** Check a form, as the tool does. */
const checkForm = (form: Record<string, unknown>, from: Map<string, LoadedDocument> = docs) =>
  checkProposal({ summary: form.summary ?? "Plan the work", changes: formToChanges(form) }, from, () => NOW, () => "p-test");
function proposalOf(form: Record<string, unknown>): WorkProposal {
  const r = checkForm(form);
  if (!r.ok) throw new Error(`expected a proposal, got: ${r.errors.join(" | ")}`);
  return r.proposal;
}
function errorsOf(form: Record<string, unknown>, from?: Map<string, LoadedDocument>): string[] {
  const r = checkForm(form, from);
  if (r.ok) throw new Error(`expected the proposal to be refused; it was: ${r.proposal.changes.map((c) => c.says).join(" | ")}`);
  return r.errors;
}
const says = (p: WorkProposal) => p.changes.map((c) => c.says);
const stepsOf = (p: WorkProposal) => p.changes.map((c) => (c.steps ?? []).map((s) => s.type));

describe("the operations the chat may propose", () => {
  it("are every operation of the two models but the base ones and the legacy SET_PROJECT_REF — so a new one is not left out unnoticed", () => {
    const listed = (t: typeof SCOPE_TYPE | typeof WBS_TYPE) => new Set(WORK_OPERATIONS[t].map(creatorName));
    const base = ["setName", "setPreferredEditor", "undo", "redo", "noop"];
    expect(Object.keys(sow).filter((k) => !listed(SCOPE_TYPE).has(k)).sort()).toEqual([...base].sort());
    expect(Object.keys(wbs).filter((k) => !listed(WBS_TYPE).has(k)).sort()).toEqual([...base, "setProjectRef"].sort());
  });

  it("each belong to one document type", () => {
    expect(operationHome("ADD_PROJECT")).toBe(SCOPE_TYPE);
    expect(operationHome("CREATE_GOAL")).toBe(WBS_TYPE);
    expect(operationHome("SET_PROJECT_REF")).toBeNull();
  });

  it("are described from the models' validators — required fields marked, enums spelled out, traps noted — beside the form and its example", () => {
    const all = workCatalog();
    expect(all.operations).toHaveLength(WORK_OPERATIONS[SCOPE_TYPE].length + WORK_OPERATIONS[WBS_TYPE].length);
    for (const op of all.operations) expect(op.input, op.type).not.toBe("");
    const addProject = all.operations.find((o) => o.type === "ADD_PROJECT")!;
    expect(addProject.input).toContain("code!: string");
    expect(addProject.input).toContain("budgetType: CAPEX|CONTINGENCY|OPEX|OVERHEAD");
    expect(all.operations.find((o) => o.type === "REMOVE_PROJECT")!.note).toMatch(/AND the deliverables it funds/);
    expect(Object.keys(all.form)).toEqual(FORM_LISTS.map(([list]) => list));
    expect(all.example).toBe(FORM_EXAMPLE);
    expect(new Set(workCatalog("wbs").operations.map((o) => o.document))).toEqual(new Set([WBS_TYPE]));
  });

  it("include an example that checks out as it is", () => {
    const p = proposalOf(FORM_EXAMPLE);
    expect(says(p)).toEqual([
      "Create scope of work “Operations 2027” in /projects",
      "Add project INF “Infrastructure” to the new scope “Operations 2027”, owned by Bob (added as a contributor), OPEX budget, in EUR",
      "Create work breakdown “Infrastructure plan”, linked both ways to project INF “Infrastructure”",
      "Add goal “Provision servers” to the new work breakdown “Infrastructure plan”",
      "Add goal “Point the domain” to the new work breakdown “Infrastructure plan”, under goal “Provision servers”",
      "Add deliverable INF-1 “Servers in production” to project INF “Infrastructure”",
      "Add roadmap “2027 launch” to the new scope “Operations 2027”",
      "Add milestone M1 “Servers live” to roadmap “2027 launch”, due 2027-03-31; scheduling deliverable INF-1 “Servers in production”",
    ]);
  });
});

describe("the form", () => {
  it("is read list by list, in the order work is planned, each entry named by its place", () => {
    const changes = formToChanges({
      deletions: ["wbs-1"],
      goals: [{ wbs: "wbs-1", description: "x" }],
      scopes: [{ title: "S" }],
      changes: [{ kind: "operation", document: "scope-1" }],
    });
    expect(changes.map((c) => [c.kind, c.at])).toEqual([
      ["create_scope", "scopes[0]"],
      ["add_goal", "goals[0]"],
      ["delete_document", "deletions[0]"],
      ["operation", "changes[0]"],
    ]);
    expect(changes[2]).toMatchObject({ document: "wbs-1" });
  });

  it("builds a project in steps: its owner added as a contributor first, or the contributor of that name reused", () => {
    const p = proposalOf({
      projects: [
        { scope: "scope-1", ref: "new:ops", code: "OPS", title: "Operations", owner: "Bob", budgetType: "opex", currency: "eur", budget: 25000 },
        { scope: "scope-1", ref: "new:docs", code: "DOC", title: "Docs", owner: "alice" },
      ],
    });
    expect(says(p)).toEqual([
      "Add project OPS “Operations” to “Powerhouse 2026”, owned by Bob (added as a contributor), OPEX budget, in EUR, budget 25000",
      "Add project DOC “Docs” to “Powerhouse 2026”, owned by alice",
    ]);
    expect(stepsOf(p)).toEqual([["ADD_AGENT", "ADD_PROJECT"], ["ADD_PROJECT"]]);
    expect(p.changes[0].steps![1].input).toEqual({ id: "new:ops", code: "OPS", title: "Operations", projectOwner: "new:person Bob", budgetType: "OPEX", currency: "EUR", budget: 25000 });
    expect(p.changes[1].steps![0].input).toMatchObject({ projectOwner: "agent-alice" }); // Alice is already a contributor
    expect(p.refs).toEqual(["new:person Bob", "new:ops", "new:docs"]);
  });

  it("adds a person once, however many things they own", () => {
    const p = proposalOf({
      projects: [{ scope: "scope-1", ref: "new:ops", code: "OPS", title: "Operations", owner: "Bob" }],
      deliverables: [{ scope: "scope-1", project: "new:ops", title: "Runbook", code: "OPS-1", owner: "Bob", status: "todo" }],
    });
    expect(stepsOf(p)).toEqual([["ADD_AGENT", "ADD_PROJECT"], ["ADD_PROJECT_DELIVERABLE", "EDIT_DELIVERABLE"]]);
    expect(p.changes[1].steps![1].input).toEqual({ id: "new:Runbook", code: "OPS-1", owner: "new:person Bob", status: "TODO" });
    expect(says(p)[1]).toBe("Add deliverable OPS-1 “Runbook” to project OPS “Operations”, owned by Bob, status TODO");
  });

  it("ignores a budget of 0 — a model's filler, which would fix the envelope at nothing", () => {
    const p = proposalOf({ projects: [{ scope: "scope-1", code: "Z", title: "Zero", budget: 0 }] });
    expect(p.changes[0].steps![0].input).not.toHaveProperty("budget");
  });

  it("puts a goal under its parent, and names the parent on the card", () => {
    const p = proposalOf({
      goals: [
        { wbs: "wbs-1", ref: "new:docs", description: "Write the docs", parent: "g-b", assignee: "Alice" },
        { wbs: "wbs-1", description: "Proofread", parent: "new:docs" },
      ],
    });
    expect(says(p)).toEqual([
      "Add goal “Write the docs” to “Knowledge Vault breakdown”, under goal “Build”, assigned to Alice",
      "Add goal “Proofread” to “Knowledge Vault breakdown”, under goal “Write the docs”",
    ]);
    expect(p.changes[1].steps![0].input).toEqual({ id: "new:Proofread", description: "Proofread", parentId: "new:docs" });
  });

  it("still takes any operation, and says what an edit sets", () => {
    const p = proposalOf({
      operations: [
        { document: "scope-1", type: "update_project", input: '{"id":"proj-kv","title":"Vault","budgetType":"CAPEX","abstract":null,"budget":null}' },
        { document: "scope-1", type: "EDIT_DELIVERABLE", input: { id: "del-1", status: "TODO", owner: "agent-alice", description: null } },
        { document: "scope-1", type: "EDIT_SCOPE_OF_WORK", input: { status: "CANCELED" } },
        { document: "scope-1", type: "ADD_MILESTONE", input: { roadmapId: "road-1", id: "new:ga", sequenceCode: "M2", title: "GA", deliveryTarget: "2027-03-01" } },
        { document: "scope-1", type: "EDIT_MILESTONE", input: { id: "ms-1", roadmapId: "road-1", deliveryTarget: "2026-12-01" } },
        { document: "wbs-1", type: "UPDATE_GOAL_DESCRIPTION", input: { id: "g-a", description: "Design system" } },
        { document: "wbs-1", type: "SET_GOAL_STATUS", input: { id: "g-b", status: "BLOCKED", blockReason: "Waiting on research" } },
      ],
    });
    expect(says(p)).toEqual([
      "Update project KV “Knowledge Vault”: title → “Vault”, budget type → CAPEX, abstract cleared, budget from its deliverables' quotes",
      "Edit deliverable “Search”: status → TODO, owner → Alice",
      "Edit scope “Powerhouse 2026”: status → CANCELED",
      "Add milestone M2 “GA” to roadmap “2026”, due 2027-03-01",
      "Edit milestone M1 “Beta”: target date → “2026-12-01”",
      "Rename goal “Design” to “Design system”",
      "Set goal “Build” to BLOCKED",
    ]);
    // A null that clears a field is kept; one that would blank a field nobody meant to touch is dropped.
    expect(p.changes[0].steps![0]).toEqual({ type: "UPDATE_PROJECT", input: { id: "proj-kv", title: "Vault", budgetType: "CAPEX", abstract: null, budget: null } });
    expect(p.changes[1].steps![0].input).toEqual({ id: "del-1", status: "TODO", owner: "agent-alice" });
  });

  it("leaves a goal note's author to the person: the change is signed as them", () => {
    const p = proposalOf({ operations: [{ document: "wbs-1", type: "ADD_NOTE", input: { goalId: "g-a", noteId: "new:n1", note: "Started" } }] });
    expect(p.changes[0].steps![0].input).toEqual({ goalId: "g-a", noteId: "new:n1", note: "Started" });
    expect(says(p)).toEqual(["Note on goal “Design”: “Started”"]);
  });

  it("warns what a removal takes with it, and counts the changes that remove something", () => {
    const p = proposalOf({
      operations: [
        { document: "scope-1", type: "REMOVE_PROJECT", input: { projectId: "proj-kv" } },
        { document: "wbs-1", type: "DELETE_GOAL", input: { id: "g-b" } },
        { document: "wbs-1", type: "DELETE_GOAL", input: { id: "g-a" } },
      ],
      deletions: [{ document: "scope-1" }],
    });
    expect(p.changes.map((c) => [c.says, c.warning])).toEqual([
      ["Delete project KV “Knowledge Vault” from “Powerhouse 2026”", "also deletes the 2 deliverables it funds"],
      ["Delete goal “Build”", "also deletes the 1 goal beneath it"],
      ["Delete goal “Design”", "a deletion"],
      ["Delete scope of work “Powerhouse 2026”", "deletes the whole document"],
    ]);
    expect(p.deletions).toBe(4);
  });

  it("unlinks a deleted breakdown from its project first, as its own line — a project must not point at a document that is gone", () => {
    const r = checkForm({ deletions: [{ document: "wbs-1" }] }, linkedWorkDocs());
    if (!r.ok) throw new Error(r.errors.join(" | "));
    expect(r.proposal.changes.map((c) => [c.says, c.warning])).toEqual([
      ["Unlink project KV “Knowledge Vault” from work breakdown “Knowledge Vault breakdown”, which is deleted next", undefined],
      ["Delete work breakdown “Knowledge Vault breakdown”", "deletes the whole document"],
    ]);
    expect(r.proposal.changes[0]).toMatchObject({ document: "scope-1", steps: [{ type: "LINK_PROJECT_WBS", input: { projectId: "proj-kv", wbsRef: null } }] });
    expect(r.proposal.deletions).toBe(1);
    // An unlinked breakdown is deleted on its own.
    expect(says(proposalOf({ deletions: [{ document: "wbs-1" }] }))).toEqual(["Delete work breakdown “Knowledge Vault breakdown”"]);
  });

  it("unlinks a deleted scope's breakdowns first, one line each — they stay, outside any scope", () => {
    const r = checkForm({ deletions: [{ document: "scope-1" }] }, linkedWorkDocs());
    if (!r.ok) throw new Error(r.errors.join(" | "));
    expect(r.proposal.changes.map((c) => [c.says, c.warning, c.derived ?? false])).toEqual([
      ["Unlink work breakdown “Knowledge Vault breakdown” — it stays, outside any scope", undefined, true],
      ["Delete scope of work “Powerhouse 2026”", "deletes the whole document", false],
    ]);
    expect(r.proposal.changes[0]).toMatchObject({
      document: "wbs-1",
      documentType: WBS_TYPE,
      steps: [{ type: "SET_SOW_PROJECT_REF", input: { sowRef: null, sowProjectId: null } }],
    });
    expect(r.proposal.deletions).toBe(1);
  });

  it("unlinks a breakdown that names the scope even when no project holds it", () => {
    const r = checkForm({ deletions: [{ document: "scope-1" }] }, pointingWorkDocs());
    expect(r.ok && says(r.proposal)).toEqual([
      "Unlink work breakdown “Knowledge Vault breakdown” — it stays, outside any scope",
      "Delete scope of work “Powerhouse 2026”",
    ]);
  });

  it("never deletes a breakdown it was not asked to — one named for deletion is deleted, not unlinked", () => {
    for (const order of [["scope-1", "wbs-1"], ["wbs-1", "scope-1"]]) {
      const r = checkForm({ deletions: order.map((document) => ({ document })) }, linkedWorkDocs());
      if (!r.ok) throw new Error(r.errors.join(" | "));
      expect(says(r.proposal).sort()).toEqual(["Delete scope of work “Powerhouse 2026”", "Delete work breakdown “Knowledge Vault breakdown”"]);
      expect(r.proposal.deletions).toBe(2);
    }
  });

  it("names the documents it touches, for the card's Open links", () => {
    const p = proposalOf({ goals: [{ wbs: "wbs-1", description: "x" }], operations: [{ document: "scope-1", type: "EDIT_SCOPE_OF_WORK", input: { status: "IN_PROGRESS" } }] });
    expect(p.documents).toEqual({
      "wbs-1": { title: "Knowledge Vault breakdown", documentType: WBS_TYPE },
      "scope-1": { title: "Powerhouse 2026", documentType: SCOPE_TYPE },
    });
    expect(p).toMatchObject({ id: "p-test", summary: "Plan the work", createdAt: NOW, deletions: 0 });
  });
});

describe("a small model's slips, read the one way they can be", () => {
  it("names a creation without a ref after its title, and finds it whatever the case or prefix", () => {
    const p = proposalOf({
      scopes: [{ title: "Vault operations 2027" }],
      projects: [{ scope: "Vault operations 2027", code: "OPS", title: "Operations" }],
      breakdowns: [{ name: "Operations plan", scope: "new:vault operations 2027", project: "new:ops" }],
    });
    expect(says(p)).toEqual([
      "Create scope of work “Vault operations 2027” in /projects",
      "Add project OPS “Operations” to the new scope “Vault operations 2027”",
      "Create work breakdown “Operations plan”, linked both ways to project OPS “Operations”",
    ]);
    expect(p.changes[2]).toMatchObject({ scope: "new:Vault operations 2027", project: "new:OPS" });
  });

  it("gives a reference that names nothing to the one thing of its kind the proposal makes — as the live model wrote it", () => {
    // gpt-oss-20b, 2026-10-15: no refs on the project or the breakdown, then invented names for both.
    const p = proposalOf({
      scopes: [{ title: "Vault operations 2027", ref: "new:ops2027" }],
      projects: [{ scope: "new:ops2027", code: "OPS", title: "Operations", owner: "Alice", budgetType: "OPEX", currency: "EUR", budget: 0 }],
      breakdowns: [{ name: "Operations plan", scope: "new:ops2027", project: "new:proj1", owner: "Alice" }],
      goals: [
        { wbs: "new:ops2027#new:proj1", description: "Plan the rollout", ref: "new:plan" },
        { wbs: "new:ops2027#new:proj1", description: "Write the runbook", parent: "new:plan" },
      ],
    });
    expect(p.changes[2]).toMatchObject({ kind: "create_wbs", scope: "new:ops2027", project: "new:OPS" });
    expect(p.changes[3].document).toBe("new:Operations plan");
    expect(says(p)[4]).toBe("Add goal “Write the runbook” to the new work breakdown “Operations plan”, under goal “Plan the rollout”");
  });

  it("links a breakdown that names no project to the proposal's one project", () => {
    const p = proposalOf({
      scopes: [{ ref: "new:s", title: "S" }],
      projects: [{ scope: "new:s", ref: "new:p", code: "P", title: "P" }],
      breakdowns: [{ name: "Plan" }],
    });
    expect(p.changes[2]).toMatchObject({ scope: "new:s", project: "new:p" });
    // With two projects there is no one reading: it asks.
    expect(errorsOf({
      scopes: [{ ref: "new:s", title: "S" }],
      projects: [{ scope: "new:s", ref: "new:p", code: "P", title: "P" }, { scope: "new:s", ref: "new:q", code: "Q", title: "Q" }],
      breakdowns: [{ name: "Plan" }],
    })).toEqual(['breakdowns[0]: create_wbs names no project, and this proposal adds 2. Give scope and project for the one it delivers — e.g. "scope":"new:s","project":"new:p".']);
  });

  it("takes a goal's text from title or name, and owner as its assignee", () => {
    const p = proposalOf({ goals: [{ wbs: "wbs-1", title: "Ship it", owner: "Bob" }] });
    expect(p.changes[0].steps![0].input).toEqual({ id: "new:Ship it", description: "Ship it", assignee: "Bob" });
  });
});

describe("what goes back to the model instead of a card", () => {
  it("a missing field, with the model's own entry rewritten and what it wrote that is not read", () => {
    expect(errorsOf({ projects: [{ scope: "scope-1", code: "OPS", owner: "Alice", status: "TODO" }] })).toEqual([
      'projects[0]: add_project has no title — the project\'s name. Write it like this: {"scope":"scope-1","code":"OPS","owner":"Alice","title":"<the project\'s name>"} (status is not read in projects).',
    ]);
    expect(errorsOf({ goals: [{ wbs: "wbs-1", code: "PLAN", owner: "Alice", status: "TODO" }] })).toEqual([
      'goals[0]: add_goal has no description — the goal itself, in a sentence. Write it like this: {"wbs":"wbs-1","owner":"Alice","description":"<the goal, in a sentence>"} (code, status are not read in goals).',
    ]);
  });

  it("a goal built as a breakdown, and a project named before it is added — the right list shown", () => {
    const errors = errorsOf({
      scopes: [{ ref: "new:s", title: "S" }],
      breakdowns: [
        { ref: "new:w", name: "Plan", scope: "new:s", project: "new:p" },
        { ref: "new:g", name: "First goal", scope: "new:w", project: "new:p" },
      ],
      projects: [{ scope: "new:s", ref: "new:x", code: "X", title: "X" }, { scope: "new:s", ref: "new:y", code: "Y", title: "Y" }],
    });
    expect(errors[0]).toBe(
      'breakdowns[0]: no project new:p is added before this. A project lives inside the scope: put it in projects — {"scope":"new:s","ref":"new:<name>","code":"<CODE>","title":"<title>"} — then give its ref as project here.',
    );
    expect(errors[1]).toBe('breakdowns[1]: new:w is a work breakdown, not a scope — a goal is not a work breakdown. Goals go in a breakdown: put them in goals — {"wbs":"new:w","description":"First goal"}.');
  });

  it("goals in a scope, a project in a breakdown, and documents that are not there", () => {
    expect(errorsOf({ goals: [{ wbs: "scope-1", description: "x" }] })[0]).toMatch(/^goals\[0\]: scope-1 is a scope of work; goals belong to a work breakdown/);
    expect(errorsOf({ projects: [{ scope: "wbs-1", code: "P", title: "P" }] })[0]).toBe("projects[0]: scope wbs-1 is a work breakdown, not a scope of work. A project belongs to a scope of work.");
    expect(errorsOf({ projects: [{ scope: "gone-1", code: "P", title: "P" }] })[0]).toBe("projects[0]: scope gone-1 is not a scope of work in this vault. A project belongs to a scope of work.");
    expect(errorsOf({ operations: [{ document: "note-1", type: "EDIT_SCOPE_OF_WORK", input: "{}" }] })[0]).toMatch(/note-1 is a bai\/knowledge-note; only scopes of work and work breakdowns can be changed/);
    expect(errorsOf({ deletions: [{ document: "note-1" }] })[0]).toMatch(/only a scope of work or a work breakdown can be deleted from the chat/);
  });

  it("an operation that is not one, or not on that document, or with an input its validator refuses", () => {
    const errors = errorsOf({
      operations: [
        { document: "scope-1", type: "CREATE_GOAL", input: { id: "x", description: "y" } },
        { document: "scope-1", type: "ADD_PROJECT", input: { title: "No code" } },
        { document: "scope-1", type: "ADD_AGENT", input: "{not json" },
        { document: "wbs-1", type: "SET_GOAL_STATUS", input: { id: "g-a", status: "BLOCKED" } },
        { document: "scope-1", type: "ADD_DELIVERABLE_IN_SET", input: { deliverableId: "del-1", milestoneId: "ms-1", projectId: "proj-kv" } },
      ],
    });
    expect(errors[0]).toMatch(/^operations\[0\]: CREATE_GOAL is not an operation on a powerhouse\/scopeofwork — it belongs to a bai\/wbs/);
    expect(errors[1]).toMatch(/^operations\[1\]: ADD_PROJECT input refused — .*code.*Expected \{ .*code!: string/);
    expect(errors[2]).toBe("operations[2]: input must be a JSON object.");
    expect(errors[3]).toMatch(/BLOCKED needs a blockReason/);
    expect(errors[4]).toMatch(/exactly one of milestoneId and projectId/);
  });

  it("an empty proposal, a name used twice, a document used before it is created", () => {
    expect(checkProposal({ changes: [] }, docs).ok).toBe(false);
    expect(errorsOf({ scopes: [{ ref: "new:s", title: "S" }, { ref: "new:s", title: "T" }] })).toEqual(["scopes[1]: new:s is already used in this proposal — give this one its own ref."]);
    expect(errorsOf({ changes: [{ kind: "operation", document: "new:s", type: "EDIT_SCOPE_OF_WORK", input: { title: "x" } }, { kind: "create_scope", ref: "new:s", title: "S" }] })[0]).toMatch(
      /^changes\[0\]: new:s is created later in this proposal — put that change first/,
    );
    expect(errorsOf({ changes: [{ kind: "rename" }] })).toEqual(["changes[0]: kind must be one of create_scope, add_project, add_deliverable, create_wbs, add_goal, add_roadmap, add_milestone, delete_document, operation."]);
  });
});

describe("the rehearsal: each proposal applied in memory, by the models' reducers, before the person sees it", () => {
  it("refuses an id that is not there, with the reducer's own words and what to do", () => {
    expect(errorsOf({ operations: [{ document: "scope-1", type: "UPDATE_PROJECT", input: { id: "proj-nope", title: "x" } }] })).toEqual([
      "operations[0]: UPDATE_PROJECT would be refused by document scope-1 — Project not found. Add the project first (projects), or use a project id from read_document.",
    ]);
    expect(errorsOf({ operations: [{ document: "scope-1", type: "ADD_MILESTONE", input: { roadmapId: "road-nope", id: "new:m2", title: "GA" } }] })[0]).toMatch(/Roadmap not found/);
    expect(errorsOf({ goals: [{ wbs: "wbs-1", description: "x", parent: "g-nope" }] })[0]).toMatch(/^goals\[0\]: CREATE_GOAL would be refused by document wbs-1 — Parent goal not found\. Add that goal first \(goals\)/);
  });

  it("refuses an id that is already taken", () => {
    // A ref written without "new:" gets it, so it cannot clash with an existing id…
    expect(checkForm({ projects: [{ scope: "scope-1", ref: "proj-kv", code: "KV2", title: "Again" }] }).ok).toBe(true);
    // …but an operation that reuses one is refused by the reducer.
    expect(errorsOf({ operations: [{ document: "scope-1", type: "ADD_PROJECT", input: { id: "proj-kv", code: "KV2", title: "Again" } }] })[0]).toMatch(
      /^operations\[0\]: ADD_PROJECT would be refused by document scope-1 — Project with ID proj-kv already exists\. Give the new one its own new:<name>/,
    );
  });

  it("refuses to link a breakdown to a project the scope does not have", () => {
    expect(errorsOf({ breakdowns: [{ ref: "new:w", name: "W", scope: "scope-1", project: "proj-nope" }] })[0]).toBe(
      "breakdowns[0]: the scope refused to link project proj-nope to the new work breakdown — Project proj-nope not found. Add the project first (projects), or use a project id from read_document.",
    );
  });

  it("refuses a change to a document the proposal deletes first", () => {
    expect(errorsOf({ changes: [{ kind: "delete_document", document: "scope-1" }, { kind: "operation", document: "scope-1", type: "EDIT_SCOPE_OF_WORK", input: { title: "x" } }] })).toEqual([
      "changes[1]: scope-1 is deleted by changes[0] — act on it before deleting it, or not at all.",
    ]);
  });

  it("reports one refusal at a time: later changes build on earlier ones", () => {
    const errors = errorsOf({
      operations: [
        { document: "scope-1", type: "UPDATE_PROJECT", input: { id: "proj-nope", title: "x" } },
        { document: "scope-1", type: "EDIT_DELIVERABLE", input: { id: "del-nope", title: "y" } },
      ],
    });
    expect(errors).toHaveLength(1);
  });

  it("does not rehearse a document it could not read — that change is checked when applied — and leaves the loaded ones as they were", () => {
    const unread = new Map(docs);
    unread.set("scope-1", { ...docs.get("scope-1")!, state: null });
    expect(checkForm({ operations: [{ document: "scope-1", type: "UPDATE_PROJECT", input: { id: "proj-nope", title: "x" } }] }, unread).ok).toBe(true);
    const before = JSON.stringify(docs.get("scope-1")!.state);
    proposalOf({ operations: [{ document: "scope-1", type: "REMOVE_PROJECT", input: { projectId: "proj-kv" } }] });
    expect(JSON.stringify(docs.get("scope-1")!.state)).toBe(before);
  });
});

describe("placeholders go back to the model — the person's own words do not", () => {
  it("refuses a slot the model did not fill, and a name that names nothing", () => {
    expect(errorsOf({ projects: [{ scope: "scope-1", code: "NP01", title: "Docs", owner: "<your name>" }] })).toEqual([
      "projects[0]: owner is a placeholder (<your name>), not the person's words — ask them, or leave the field out.",
    ]);
    expect(errorsOf({ scopes: [{ title: "New Project Scope" }] })).toEqual([
      'scopes[0]: "New Project Scope" is a placeholder, not a name — ask the person what the work is and what it is called before proposing it.',
    ]);
    expect(errorsOf({ breakdowns: [{ name: "New project plan" }] })[0]).toMatch(/is a placeholder, not a name/);
    // A model that copies the checker's own example back is caught too.
    expect(errorsOf({ projects: [{ scope: "scope-1", code: "<CODE>", title: "Docs" }] })[0]).toMatch(/code is a placeholder \(<CODE>\)/);
  });

  it("lets a name stand that only starts like one", () => {
    expect(checkForm({ scopes: [{ title: "New Project Intake 2027" }] }).ok).toBe(true);
  });

  it("takes what the person typed as theirs", () => {
    expect(checkProposal({ changes: formToChanges({ scopes: [{ title: "New Project" }] }) }, docs, () => NOW, () => "p", ["scopes[0]"]).ok).toBe(true);
  });
});

describe("lines the checker adds, and the goal a link names", () => {
  it("marks the unlink before a breakdown's deletion as the checker's, so it is not edited on its own", () => {
    const r = checkForm({ deletions: [{ document: "wbs-1" }] }, linkedWorkDocs());
    expect(r.ok && r.proposal.changes.map((c) => [c.derived ?? false, c.at])).toEqual([
      [true, "deletions[0]"],
      [false, "deletions[0]"],
    ]);
  });

  it("names the goal a deliverable is linked to — one the proposal adds, or one already there", () => {
    const p = proposalOf({
      goals: [{ wbs: "wbs-1", ref: "new:guide", description: "Write the guide" }],
      operations: [
        { document: "scope-1", type: "LINK_DELIVERABLE_GOAL", input: { deliverableId: "del-1", goalRef: "new:guide" } },
        { document: "scope-1", type: "LINK_DELIVERABLE_GOAL", input: { deliverableId: "del-2", goalRef: "g-b" } },
      ],
    });
    expect(says(p).slice(1)).toEqual(["Link deliverable “Search” to goal “Write the guide”", "Link deliverable “Chat” to goal “Build”"]);
  });
});

describe("editing on the card", () => {
  const form = {
    summary: "s",
    scopes: [{ ref: "new:ops", title: "Ops" }],
    projects: [{ scope: "new:ops", ref: "new:infra", code: "INF", title: "Infra", owner: "Bob", budget: 500 }],
    goals: [{ wbs: "wbs-1", title: "Ship", owner: "Alice" }],
    operations: [{ document: "scope-1", type: "UPDATE_PROJECT", input: '{"id":"proj-kv","title":"Vault","abstract":"Old words"}' }],
    deletions: ["wbs-1"],
  };
  const shown = (at: string) => editableFields(form, at).map(({ field, value }) => [field.key, value]);

  it("offers each kind's words with their values now — never an id", () => {
    expect(shown("scopes[0]")).toEqual([["title", "Ops"], ["description", ""]]);
    expect(shown("projects[0]")).toEqual([["code", "INF"], ["title", "Infra"], ["owner", "Bob"], ["budgetType", ""], ["currency", ""], ["budget", "500"]]);
    // A goal's text and assignee, read from where the model put them — as the checker reads them.
    expect(shown("goals[0]")).toEqual([["description", "Ship"], ["assignee", "Alice"]]);
    // An operation offers only the words it carries.
    expect(shown("operations[0]")).toEqual([["title", "Vault"], ["abstract", "Old words"]]);
    expect(shown("deletions[0]")).toEqual([]);
    expect(shown("projects[9]")).toEqual([]);
    expect(editableFields(form, "projects[0]").find((f) => f.field.key === "budgetType")!.field.options).toEqual(["OPEX", "CAPEX", "CONTINGENCY", "OVERHEAD"]);
    // A budget of 0 is not applied, so it is not shown either.
    expect(editableFields({ projects: [{ scope: "s", code: "C", title: "T", budget: 0 }] }, "projects[0]").find((f) => f.field.key === "budget")!.value).toBe("");
  });

  it("changes only the words: empty is not given, a budget a number, an operation's ids untouched", () => {
    const projects = withEdit(form, "projects[0]", { code: "INF", title: "Infrastructure", owner: "", budgetType: "OPEX", currency: "", budget: "750" }).projects;
    expect(projects).toEqual([{ scope: "new:ops", ref: "new:infra", code: "INF", title: "Infrastructure", budgetType: "OPEX", budget: 750 }]);
    expect(withEdit(form, "goals[0]", { description: "Ship it", assignee: "Bob" }).goals).toEqual([{ wbs: "wbs-1", description: "Ship it", assignee: "Bob" }]);
    expect(withEdit(form, "operations[0]", { title: "Knowledge Vault", abstract: "" }).operations).toEqual([
      { document: "scope-1", type: "UPDATE_PROJECT", input: { id: "proj-kv", title: "Knowledge Vault" } },
    ]);
    // The form it was given is left as it was.
    expect(form.projects[0].title).toBe("Infra");
  });

  it("says what is missing before anything is checked", () => {
    expect(missingIn(form, "projects[0]", { title: "  " })).toBe("Title is needed.");
    expect(missingIn(form, "goals[0]", { description: "" })).toBe("Goal is needed.");
    expect(missingIn(form, "projects[0]", { title: "Infra", owner: "" })).toBeNull();
  });

  it("takes an entry out, and moves the later edits of its list one place up", () => {
    const r = withoutEntry({ goals: [{ description: "a" }, { description: "b" }, { description: "c" }] }, "goals[0]", ["goals[0]", "goals[2]", "projects[0]"]);
    expect((r.form.goals as { description: string }[]).map((g) => g.description)).toEqual(["b", "c"]);
    expect(r.edited).toEqual(["goals[1]", "projects[0]"]);
  });

  it("puts a checker's message in the person's words", () => {
    expect(forThePerson('projects[0]: add_project has no title — the project\'s name. Write it like this: {"code":"X"}.')).toBe("The project has no title — the project's name.");
    expect(forThePerson("operations[0]: UPDATE_PROJECT would be refused by document scope-1 — Project not found. Add the project first (projects), or use a project id from read_document.")).toMatch(/^UPDATE_PROJECT would be refused/);
  });
});

describe("roadmaps and milestones: the schedule a scope keeps", () => {
  it("adds a roadmap to an existing scope, with milestones that schedule its deliverables — named by code, title or id", () => {
    const p = proposalOf({
      roadmaps: [{ scope: "scope-1", ref: "new:r27", title: "2027" }],
      milestones: [
        { roadmap: "new:r27", ref: "new:m1", code: "M1", title: "Search live", target: "2027-02-15", deliverables: ["del-1"], coordinator: "Alice" },
        { roadmap: "new:r27", code: "M2", title: "Chat live", target: "2027-03-31T00:00:00Z", deliverables: ["chat"], coordinator: "Dana" },
      ],
    });
    expect(says(p)).toEqual([
      "Add roadmap “2027” to “Powerhouse 2026”",
      "Add milestone M1 “Search live” to roadmap “2027”, due 2027-02-15; scheduling deliverable “Search”; coordinated by Alice",
      "Add milestone M2 “Chat live” to roadmap “2027”, due 2027-03-31; scheduling deliverable “Chat”; coordinated by Dana (added as a contributor)",
    ]);
    expect(stepsOf(p)).toEqual([
      ["ADD_ROADMAP"],
      ["ADD_MILESTONE", "ADD_DELIVERABLE_IN_SET", "ADD_COORDINATOR"],
      ["ADD_MILESTONE", "ADD_DELIVERABLE_IN_SET", "ADD_AGENT", "ADD_COORDINATOR"],
    ]);
    expect(p.changes[1].steps![0].input).toEqual({ roadmapId: "new:r27", id: "new:m1", title: "Search live", sequenceCode: "M1", deliveryTarget: "2027-02-15" });
    expect(p.changes[1].steps![2].input).toEqual({ id: "agent-alice", milestoneId: "new:m1" });
    expect(p.changes[2].steps![0].input).toMatchObject({ deliveryTarget: "2027-03-31" }); // the time dropped
  });

  it("schedules deliverables the same proposal adds, by ref or by title", () => {
    const p = proposalOf({
      scopes: [{ ref: "new:ops", title: "Ops" }],
      projects: [{ scope: "new:ops", ref: "new:p", code: "P", title: "P" }],
      deliverables: [
        { scope: "new:ops", project: "new:p", ref: "new:a", code: "P-1", title: "Alpha" },
        { scope: "new:ops", project: "new:p", code: "P-2", title: "Beta" },
      ],
      roadmaps: [{ scope: "new:ops", title: "Plan" }],
      // An invented roadmap name, in a proposal that adds one roadmap: it is that one.
      milestones: [{ roadmap: "new:the-plan", title: "First release", deliverables: ["new:a", "beta", "P-2"] }],
    });
    expect(says(p).at(-1)).toBe("Add milestone “First release” to roadmap “Plan”, scheduling deliverable P-1 “Alpha”, deliverable P-2 “Beta”");
    expect(p.changes.at(-1)!.steps!.slice(1).map((st) => st.input.deliverableId)).toEqual(["new:a", "new:Beta"]); // Beta named twice, scheduled once
  });

  it("goes back to the model for a date that is not one, a deliverable it cannot find, and a roadmap that is something else", () => {
    expect(errorsOf({ milestones: [{ roadmap: "road-1", scope: "scope-1", title: "GA", target: "end of March" }] })).toEqual([
      'milestones[0]: target "end of March" is not a date — give it as YYYY-MM-DD, or leave it out for the person to set.',
    ]);
    expect(errorsOf({ milestones: [{ roadmap: "road-1", scope: "scope-1", title: "GA", target: "2027-02-30" }] })[0]).toBe('milestones[0]: target "2027-02-30" is not a real date.');
    expect(errorsOf({ milestones: [{ roadmap: "road-1", scope: "scope-1", title: "GA", deliverables: ["Nonexistent"] }] })[0]).toBe(
      'milestones[0]: no deliverable "Nonexistent" in this scope or proposal — name it by its ref, id, code or title, or add it in deliverables first.',
    );
    expect(errorsOf({ projects: [{ scope: "scope-1", ref: "new:x", code: "X", title: "X" }], milestones: [{ roadmap: "new:x", scope: "scope-1", title: "GA" }] })[0]).toMatch(
      /^milestones\[0\]: new:x is a project, not a roadmap\. Add the roadmap first: put it in roadmaps/,
    );
    expect(errorsOf({ milestones: [{ roadmap: "road-1", title: "GA" }] })[0]).toBe("milestones[0]: add_milestone on roadmap road-1 has no scope — give the scope's documentId as scope.");
    expect(errorsOf({ roadmaps: [{ scope: "wbs-1", title: "R" }] })[0]).toBe("roadmaps[0]: scope wbs-1 is a work breakdown, not a scope of work. A roadmap belongs to a scope of work.");
  });

  it("puts a milestone on a roadmap the scope already has, and the rehearsal refuses one it does not", () => {
    expect(says(proposalOf({ milestones: [{ roadmap: "road-1", scope: "scope-1", code: "M2", title: "GA", deliverables: ["Chat"] }] }))).toEqual([
      "Add milestone M2 “GA” to roadmap “2026”, scheduling deliverable “Chat”",
    ]);
    expect(errorsOf({ milestones: [{ roadmap: "road-nope", scope: "scope-1", title: "GA" }] })[0]).toMatch(/Roadmap not found/);
  });

  it("offers a roadmap's and a milestone's words for editing", () => {
    const form = { roadmaps: [{ scope: "scope-1", title: "2027" }], milestones: [{ roadmap: "new:2027", title: "GA", code: "M1", target: "2027-03-01", owner: "Alice", deliverables: ["Chat"] }] };
    expect(editableFields(form, "roadmaps[0]").map(({ field, value }) => [field.key, value])).toEqual([["title", "2027"], ["description", ""]]);
    expect(editableFields(form, "milestones[0]").map(({ field, value }) => [field.key, value])).toEqual([["code", "M1"], ["title", "GA"], ["target", "2027-03-01"], ["coordinator", ""], ["description", ""]]);
    expect(withEdit(form, "milestones[0]", { target: "2027-04-15" }).milestones).toEqual([{ roadmap: "new:2027", title: "GA", code: "M1", target: "2027-04-15", owner: "Alice", deliverables: ["Chat"] }]);
  });
});
