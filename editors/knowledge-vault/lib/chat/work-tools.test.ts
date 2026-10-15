/**
 * The chat's two work tools, run against a fake engine: work_operations
 * lists what can be changed, propose_work_changes reads the documents a
 * proposal names and returns it checked — or what to fix — and writes nothing.
 */
import "../../../shared/test/browser-globals.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { executeTool, resetVaultDocumentListing } from "./vault-tools.js";
import { SCOPE_TYPE, WBS_TYPE, WORK_OPERATIONS, type WorkProposal } from "./work-changes.js";
import { linkedWorkDocs, scopeState, wbsState } from "./test/work-fixtures.js";

const CTX = { driveId: "drive-1" };

type VaultDoc = { documentType: string; name: string; global: Record<string, unknown> };
/** The vault's documents, by id. */
const VAULT: Record<string, VaultDoc> = {
  "scope-1": { documentType: SCOPE_TYPE, name: "powerhouse-2026", global: scopeState() },
  "wbs-1": { documentType: WBS_TYPE, name: "Knowledge Vault breakdown", global: wbsState() },
  "note-1": { documentType: "bai/knowledge-note", name: "a-note", global: { title: "A note" } },
};

/**
 * Every request the tools make goes through document(idOrSlug): the drive's
 * id gets its file list (`inTree` — the engine keeps deleted documents, and
 * the tree is what says what is in the vault), any other id that document.
 */
function fakeEngine(vault: Partial<Record<string, VaultDoc>> = VAULT, inTree: string[] = Object.keys(vault)) {
  const reads: string[] = [];
  const respond = (data: unknown) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ data }) });
  globalThis.fetch = vi.fn((_url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string) as { query: string; variables?: { id?: string } };
    const id = body.variables?.id ?? "";
    if (/mutation/i.test(body.query)) throw new Error(`a tool wrote to the vault: ${body.query}`);
    if (id === CTX.driveId) {
      const nodes = inTree.flatMap((nid) => {
        const held = vault[nid];
        return held ? [{ id: nid, kind: "file", name: held.name, documentType: held.documentType }] : [];
      });
      return respond({ document: { document: { state: { global: { nodes } } } } });
    }
    reads.push(id);
    const d = vault[id];
    if (!d) return respond({ document: null });
    return respond({ document: { document: { id, name: d.name, documentType: d.documentType, state: { global: d.global, local: {} } } } });
  }) as unknown as typeof fetch;
  return reads;
}

beforeEach(() => resetVaultDocumentListing());
afterEach(() => vi.restoreAllMocks());

describe("work_operations", () => {
  it("lists every operation the chat may propose, read from the models, without touching the vault", async () => {
    globalThis.fetch = vi.fn() as unknown as typeof fetch;
    const r = await executeTool("work_operations", {}, CTX);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const data = r.data as { operations: { type: string }[]; changes: Record<string, string> };
    expect(data.operations).toHaveLength(WORK_OPERATIONS[SCOPE_TYPE].length + WORK_OPERATIONS[WBS_TYPE].length);
    expect(r.summary).toBe(`listed ${data.operations.length} operations on scopes of work and work breakdowns`);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("narrows to one area", async () => {
    const r = await executeTool("work_operations", { area: "wbs" }, CTX);
    expect(r.ok && (r.data as { operations: unknown[] }).operations).toHaveLength(WORK_OPERATIONS[WBS_TYPE].length);
  });
});

describe("propose_work_changes", () => {
  it("reads the documents the proposal names, and returns it checked and described — writing nothing", async () => {
    const reads = fakeEngine();
    const r = await executeTool(
      "propose_work_changes",
      {
        summary: "Start the launch work",
        scopes: [{ ref: "new:ops", title: "Operations 2027" }],
        deliverables: [{ scope: "scope-1", project: "proj-kv", ref: "new:launch", title: "Launch" }],
        operations: [{ document: "wbs-1", type: "SET_GOAL_STATUS", input: '{"id":"g-b","status":"IN_PROGRESS"}' }],
      },
      CTX,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(reads.sort()).toEqual(["scope-1", "wbs-1"]); // never a new:<name>
    const { proposal, shown } = r.data as { proposal: WorkProposal; shown: string };
    expect(proposal.summary).toBe("Start the launch work");
    expect(proposal.changes.map((c) => c.says)).toEqual([
      "Create scope of work “Operations 2027” in /projects",
      "Add deliverable “Launch” to project KV “Knowledge Vault”",
      "Set goal “Build” to IN_PROGRESS",
    ]);
    expect(proposal.documents).toEqual({
      "scope-1": { title: "Powerhouse 2026", documentType: SCOPE_TYPE },
      "wbs-1": { title: "Knowledge Vault breakdown", documentType: WBS_TYPE },
    });
    expect(shown).toMatch(/^The person now sees these changes as a card under your answer, with Apply and Cancel, and can edit them first\. Nothing has changed yet/);
    // The card keeps the whole proposal, its form included; the model reads only what it proposed, in words.
    expect(proposal.form).toMatchObject({ summary: "Start the launch work" });
    expect(r.forModel).toEqual({ proposed: proposal.changes.map((c) => c.says), shown });
    expect(r.summary).toBe(
      "proposed 3 changes: Create scope of work “Operations 2027” in /projects; Add deliverable “Launch” to project KV “Knowledge Vault”; Set goal “Build” to IN_PROGRESS",
    );
  });

  it("counts what a proposal removes in its summary", async () => {
    fakeEngine();
    const r = await executeTool("propose_work_changes", { summary: "Drop KV", operations: [{ document: "scope-1", type: "REMOVE_PROJECT", input: '{"projectId":"proj-kv"}' }] }, CTX);
    expect(r.ok && r.summary).toBe("proposed 1 change (1 removing something): Delete project KV “Knowledge Vault” from “Powerhouse 2026”");
  });

  it("sends a proposal the vault would refuse back to the model with what to fix, and shows nothing", async () => {
    fakeEngine();
    const r = await executeTool(
      "propose_work_changes",
      { summary: "Rename", operations: [{ document: "scope-1", type: "UPDATE_PROJECT", input: '{"id":"proj-nope","title":"x"}' }] },
      CTX,
    );
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toBe(
      "Nothing was proposed. Fix these and propose again: operations[0]: UPDATE_PROJECT would be refused by document scope-1 — Project not found. Add the project first (projects), or use a project id from read_document.",
    );
  });

  it("treats a document missing from the vault's tree as not in the vault, even when the engine still holds it", async () => {
    const reads = fakeEngine(VAULT, ["scope-1", "note-1"]); // wbs-1 deleted: still held, no longer in the tree
    const r = await executeTool("propose_work_changes", { summary: "x", deletions: [{ document: "wbs-1" }] }, CTX);
    expect(reads).toEqual([]); // never read
    expect(!r.ok && r.error).toMatch(/delete_document needs the documentId of a scope of work or work breakdown in this vault/);
  });

  it("reads the work breakdown a goal names, and the scope a project names", async () => {
    const reads = fakeEngine();
    const r = await executeTool(
      "propose_work_changes",
      { summary: "More work", goals: [{ wbs: "wbs-1", description: "Write the docs", parent: "g-b" }], projects: [{ scope: "scope-1", code: "DOC", title: "Docs", owner: "Alice" }] },
      CTX,
    );
    expect(reads.sort()).toEqual(["scope-1", "wbs-1"]);
    expect(r.ok && (r.data as { proposal: WorkProposal }).proposal.changes.map((c) => c.says)).toEqual([
      "Add project DOC “Docs” to “Powerhouse 2026”, owned by Alice",
      "Add goal “Write the docs” to “Knowledge Vault breakdown”, under goal “Build”",
    ]);
  });

  it("reads the scope that holds a breakdown to delete, so the project is unlinked first", async () => {
    const linked = linkedWorkDocs();
    const reads = fakeEngine({
      ...VAULT,
      "scope-1": { ...VAULT["scope-1"], global: linked.get("scope-1")!.state! },
      "wbs-1": { ...VAULT["wbs-1"], global: linked.get("wbs-1")!.state! },
    });
    const r = await executeTool("propose_work_changes", { summary: "Remove the breakdown", deletions: [{ document: "wbs-1" }] }, CTX);
    expect(reads).toEqual(["wbs-1", "scope-1"]);
    expect(r.ok && (r.data as { proposal: WorkProposal }).proposal.changes.map((c) => c.says)).toEqual([
      "Unlink project KV “Knowledge Vault” from work breakdown “Knowledge Vault breakdown”, which is deleted next",
      "Delete work breakdown “Knowledge Vault breakdown”",
    ]);
  });

  it("refuses to change anything but work", async () => {
    fakeEngine();
    const r = await executeTool("propose_work_changes", { summary: "x", operations: [{ document: "note-1", type: "EDIT_SCOPE_OF_WORK", input: "{}" }] }, CTX);
    expect(!r.ok && r.error).toMatch(/note-1 is a bai\/knowledge-note; only scopes of work and work breakdowns can be changed from the chat/);
  });
});
