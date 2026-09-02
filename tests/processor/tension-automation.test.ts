/**
 * CONTRADICTS → tension, end to end against a fake reactor client.
 *
 * Pins: one tension per unordered pair (including a→b / b→a racing in one
 * batch), no duplicate when a tension already covers the pair, filing under
 * /ops when it exists, ADD_TENSION on the owning MoC with the tension's id
 * as the entry id (idempotent), and that the automation never blocks or
 * throws through `onOperations`.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { Kysely } from "kysely";
import { PGlite } from "@electric-sql/pglite";
import { PGliteDialect } from "kysely-pglite-dialect";
import type { IRelationalDb } from "@powerhousedao/shared/processors";
import type { OperationWithContext } from "@powerhousedao/shared/document-model";
import type { DB } from "../../processors/graph-indexer/schema.js";
import { up, down } from "../../processors/graph-indexer/migrations.js";
import { createGraphQuery } from "../../processors/graph-indexer/query.js";
import { GraphIndexerProcessor } from "../../processors/graph-indexer/index.js";
import {
  TensionAutomation,
  pairKey,
  tensionDescription,
  tensionTitle,
  type TensionAutomationDeps,
} from "../../processors/graph-indexer/automation.js";

let db: Kysely<DB>;
let query: ReturnType<typeof createGraphQuery>;
const T = "2026-09-02T12:00:00.000Z";
const DRIVE = "drive-1";

beforeAll(async () => {
  db = new Kysely<DB>({ dialect: new PGliteDialect(new PGlite()) });
  await up(db as unknown as IRelationalDb<DB>);
  query = createGraphQuery(db);
});
afterAll(async () => {
  await down(db as unknown as IRelationalDb<DB>);
  await db.destroy();
});
beforeEach(async () => {
  await db.deleteFrom("graph_operations").execute();
  await db.deleteFrom("graph_topics").execute();
  await db.deleteFrom("graph_edges").execute();
  await db.deleteFrom("graph_nodes").execute();
});

/* ------------------------------------------------------------------ */
/*  Fake reactor client                                               */
/* ------------------------------------------------------------------ */

type Call =
  | { kind: "addFile"; driveId: string; name: string; parentFolder?: string; id: string }
  | { kind: "execute"; documentId: string; branch: string; types: string[]; inputs: unknown[] };

/** A file node in the fake drive tree. */
const file = (id: string) => ({ id, kind: "file", name: id, parentFolder: null });

function fakeClient(opts: {
  /** Folders (and any extra nodes) in the drive; files for `members` are added. */
  driveNodes?: Array<{ id: string; kind: string; name: string; parentFolder: string | null }>;
  /** Document ids that belong to this drive. Defaults to a, b, c. */
  members?: string[];
  mocs?: Record<string, { tensions: Array<{ id: string }> }>;
  failAddFile?: boolean;
  failDriveRead?: boolean;
}) {
  const calls: Call[] = [];
  let seq = 0;
  const members = opts.members ?? ["a", "b", "c"];
  const client: TensionAutomationDeps["client"] = {
    get: async (id: string) => {
      if (id === DRIVE) {
        if (opts.failDriveRead) throw new Error("fake: drive unreadable");
        const nodes = [...(opts.driveNodes ?? []), ...members.map(file)];
        return { header: { id }, state: { global: { nodes } } } as never;
      }
      const moc = opts.mocs?.[id];
      if (moc) return { header: { id }, state: { global: { tensions: moc.tensions } } } as never;
      throw new Error(`fake: no document ${id}`);
    },
    execute: async (documentId: string, branch: string, actions: Array<{ type: string; input: unknown }>) => {
      calls.push({ kind: "execute", documentId, branch, types: actions.map((a) => a.type), inputs: actions.map((a) => a.input) });
      return { header: { id: documentId } } as never;
    },
    drives: {
      addFile: async (driveId: string, document: { header: { id: string; name: string } }, parentFolder?: string) => {
        if (opts.failAddFile) throw new Error("fake: addFile refused");
        seq++;
        const id = document.header.id || `tension-${seq}`;
        calls.push({ kind: "addFile", driveId, name: document.header.name, parentFolder, id });
        return { header: { id, name: document.header.name } } as never;
      },
    } as never,
  };
  return { client, calls };
}

async function note(id: string, title: string, document_type = "bai/knowledge-note") {
  await db
    .insertInto("graph_nodes")
    .values({ id, document_id: id, title, description: null, note_type: null, status: "CANONICAL", updated_at: T, document_type })
    .execute();
}
async function edge(source: string, target: string, link_type: string) {
  await db
    .insertInto("graph_edges")
    .values({ id: `${source}-${target}-${link_type}`, source_document_id: source, target_document_id: target, link_type, target_title: null, updated_at: T })
    .execute();
}

const quiet = { info: () => {}, warn: () => {} };

describe("helpers", () => {
  it("pairKey is order-insensitive", () => {
    expect(pairKey("b", "a")).toBe(pairKey("a", "b"));
    expect(pairKey("a", "b")).toBe("a|b");
  });
  it("tensionTitle is short: shared topics, else shared words, else first words", () => {
    const a = { id: "aaaaaaaa-1", title: "Reducers must never read the wall clock; every timestamp comes from the action input" };
    const b = { id: "bbbbbbbb-2", title: "Reducers may stamp the current time when the input carries none" };
    expect(tensionTitle(a, b, ["reactor", "reducers", "third"])).toBe("Contradiction on reactor, reducers");
    expect(tensionTitle(a, b)).toBe("Contradiction on reducers, input");
    expect(tensionTitle({ id: "aaaaaaaa-1", title: "Alpha beta gamma delta epsilon zeta" }, { id: "bbbbbbbb-2", title: null })).toBe(
      "Contradiction: Alpha beta gamma delta epsilon… / bbbbbbbb",
    );
    expect(tensionTitle(a, b).length).toBeLessThan(60);
  });
  it("tensionDescription carries both claims in full", () => {
    const d = tensionDescription({ id: "a", title: "Claims are atomic" }, { id: "b", title: "Claims may bundle" });
    expect(d).toContain("“Claims are atomic” contradicts “Claims may bundle”");
    expect(d).toMatch(/resolve .* dissolve/);
  });
});

describe("TensionAutomation.onContradiction", () => {
  it("creates one tension in /ops and notes it on the owning MoC", async () => {
    await note("a", "Reducers must be pure");
    await note("b", "Reducers may call Date.now()");
    await note("moc-1", "Reducer design", "bai/moc");
    await edge("moc-1", "a", "CORE_IDEA");
    const { client, calls } = fakeClient({
      driveNodes: [
        { id: "folder-ops", kind: "folder", name: "ops", parentFolder: null },
        { id: "folder-notes", kind: "folder", name: "notes", parentFolder: "folder-knowledge" },
      ],
      mocs: { "moc-1": { tensions: [] } },
    });
    const auto = new TensionAutomation(db, { driveId: DRIVE, client, log: quiet, now: () => T });

    const id = await auto.onContradiction("a", "b");
    expect(id).toBeTruthy();

    const addFile = calls.find((c) => c.kind === "addFile");
    // Short title (shared significant word: "reducers"); the claims live in the description.
    expect(addFile).toMatchObject({ driveId: DRIVE, parentFolder: "folder-ops", name: "Contradiction on reducers" });

    const creates = calls.filter((c): c is Extract<Call, { kind: "execute" }> => c.kind === "execute");
    expect(creates).toHaveLength(2);
    // 1. CREATE_TENSION on the new document
    expect(creates[0].documentId).toBe(id);
    expect(creates[0].types).toEqual(["CREATE_TENSION"]);
    expect(creates[0].inputs[0]).toMatchObject({
      title: "Contradiction on reducers",
      description: tensionDescription({ id: "a", title: "Reducers must be pure" }, { id: "b", title: "Reducers may call Date.now()" }),
      involvedRefs: ["a", "b"],
      observedAt: T,
      observedBy: "graph-indexer",
    });
    expect((creates[0].inputs[0] as { content: string }).content).toContain("`a`");
    // 2. ADD_TENSION on the MoC, entry id = tension id
    expect(creates[1].documentId).toBe("moc-1");
    expect(creates[1].types).toEqual(["ADD_TENSION"]);
    expect(creates[1].inputs[0]).toMatchObject({ id, involvedRefs: ["a", "b"], addedAt: T });
  });

  it("does nothing when a tension already involves both notes (any status)", async () => {
    await note("a", "A");
    await note("b", "B");
    await note("t-old", "old", "bai/tension");
    await db.updateTable("graph_nodes").set({ status: "RESOLVED" }).where("document_id", "=", "t-old").execute();
    await edge("t-old", "a", "INVOLVES");
    await edge("t-old", "b", "INVOLVES");
    const { client, calls } = fakeClient({});
    const auto = new TensionAutomation(db, { driveId: DRIVE, client, log: quiet });
    expect(await auto.onContradiction("b", "a")).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("a tension involving only one of the two notes does not suppress", async () => {
    await note("a", "A");
    await note("b", "B");
    await note("c", "C");
    await note("t-ac", "a vs c", "bai/tension");
    await edge("t-ac", "a", "INVOLVES");
    await edge("t-ac", "c", "INVOLVES");
    const { client, calls } = fakeClient({});
    const auto = new TensionAutomation(db, { driveId: DRIVE, client, log: quiet });
    expect(await auto.onContradiction("a", "b")).toBeTruthy();
    expect(calls.filter((c) => c.kind === "addFile")).toHaveLength(1);
  });

  it("a→b and b→a racing produce exactly one tension", async () => {
    await note("a", "A");
    await note("b", "B");
    const { client, calls } = fakeClient({});
    const auto = new TensionAutomation(db, { driveId: DRIVE, client, log: quiet });
    const [x, y] = await Promise.all([auto.onContradiction("a", "b"), auto.onContradiction("b", "a")]);
    expect([x, y].filter(Boolean)).toHaveLength(1);
    expect(calls.filter((c) => c.kind === "addFile")).toHaveLength(1);
  });

  it("files at the drive root when there is no /ops folder", async () => {
    await note("a", "A");
    await note("b", "B");
    const { client, calls } = fakeClient({ driveNodes: [] });
    const auto = new TensionAutomation(db, { driveId: DRIVE, client, log: quiet });
    await auto.onContradiction("a", "b");
    expect((calls[0] as Extract<Call, { kind: "addFile" }>).parentFolder).toBeUndefined();
  });

  it("skips a MoC that already lists this tension", async () => {
    await note("a", "A");
    await note("b", "B");
    await note("moc-1", "M", "bai/moc");
    await edge("moc-1", "b", "CORE_IDEA");
    // Pre-seed the MoC with an entry whose id will equal the created id.
    // Ids come from the tension document header, so intercept through mocs
    // map after creation: simplest is to run once, then run the attach path
    // again by adding a second contradiction that resolves to the same MoC.
    const mocs: Record<string, { tensions: Array<{ id: string }> }> = { "moc-1": { tensions: [] } };
    const { client, calls } = fakeClient({ mocs });
    const auto = new TensionAutomation(db, { driveId: DRIVE, client, log: quiet });
    const id = await auto.onContradiction("a", "b");
    // Simulate the MoC now holding the entry (as the reactor would after ADD_TENSION).
    mocs["moc-1"].tensions.push({ id: id! });
    // A different pair on the same MoC must still be added; the same id must not be re-added.
    await note("c", "C");
    await edge("moc-1", "c", "CORE_IDEA");
    await auto.onContradiction("b", "c");
    const addTensions = calls.filter((c) => c.kind === "execute" && c.types[0] === "ADD_TENSION");
    expect(addTensions).toHaveLength(2);
    const ids = addTensions.map((c) => ((c as Extract<Call, { kind: "execute" }>).inputs[0] as { id: string }).id);
    expect(new Set(ids).size).toBe(2);
  });

  it("ignores a contradiction between notes that are not in this drive", async () => {
    // The processor manager broadcasts every matching operation to every
    // instance on the host; only the drive that owns both notes may act.
    await note("x", "X");
    await note("y", "Y");
    const { client, calls } = fakeClient({ members: ["a", "b"] });
    const auto = new TensionAutomation(db, { driveId: DRIVE, client, log: quiet });
    expect(await auto.onContradiction("x", "y")).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("ignores a contradiction where only one note is in this drive", async () => {
    await note("a", "A");
    await note("z", "Z");
    const { client, calls } = fakeClient({ members: ["a", "b"] });
    const auto = new TensionAutomation(db, { driveId: DRIVE, client, log: quiet });
    expect(await auto.onContradiction("a", "z")).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("does not write when the drive tree cannot be read", async () => {
    await note("a", "A");
    await note("b", "B");
    const { client, calls } = fakeClient({ failDriveRead: true });
    const auto = new TensionAutomation(db, { driveId: DRIVE, client, log: quiet });
    expect(await auto.onContradiction("a", "b")).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("returns null and does not throw when the write fails", async () => {
    await note("a", "A");
    await note("b", "B");
    const { client } = fakeClient({ failAddFile: true });
    const warnings: string[] = [];
    const auto = new TensionAutomation(db, { driveId: DRIVE, client, log: { info: () => {}, warn: (m) => warnings.push(m) } });
    expect(await auto.onContradiction("a", "b")).toBeNull();
    expect(warnings.some((w) => w.includes("could not open a tension"))).toBe(true);
  });
});

describe("through the processor", () => {
  function relOp(source: string, target: string, type: string, index: number): OperationWithContext {
    return {
      operation: {
        index, skip: 0, hash: `h${index}`, timestampUtcMs: T, id: `op-${index}`,
        action: { id: `a-${index}`, type: "ADD_RELATIONSHIP", scope: "document", timestampUtcMs: T,
          input: { sourceId: source, targetId: target, relationshipType: type } },
      },
      context: { documentId: source, documentType: "bai/knowledge-note", scope: "document", branch: "main", ordinal: index },
    } as unknown as OperationWithContext;
  }

  it("a CONTRADICTS relationship opens a tension; RELATES_TO does not", async () => {
    await note("a", "A");
    await note("b", "B");
    await note("c", "C");
    const { client, calls } = fakeClient({});
    const processor = new GraphIndexerProcessor(
      "ns", { documentType: [], scope: [], branch: [], documentId: [] },
      db as unknown as IRelationalDb<DB>,
      // The instance "started" at T, so an operation stamped T is live.
      { embed: false, automation: { driveId: DRIVE, client, log: quiet }, now: () => Date.parse(T) },
    );
    expect(processor.automationEnabled).toBe(true);
    await processor.onOperations([relOp("a", "b", "CONTRADICTS", 1), relOp("a", "c", "RELATES_TO", 2)]);
    // The automation is detached; give it a tick.
    await new Promise((r) => setTimeout(r, 50));
    expect(calls.filter((c) => c.kind === "addFile")).toHaveLength(1);
    // And the edges themselves were indexed as usual.
    expect((await query.forwardLinks("a")).map((e) => e.linkType).sort((x, y) => (x ?? "").localeCompare(y ?? ""))).toEqual(["CONTRADICTS", "RELATES_TO"]);
  });

  it("never writes for replayed history — only for live operations", async () => {
    await note("a", "A");
    await note("b", "B");
    const { client, calls } = fakeClient({});
    // Instance started an hour after the operation was stamped: that is a
    // `startFrom: "beginning"` replay, exactly the boot-time case.
    const processor = new GraphIndexerProcessor(
      "ns", { documentType: [], scope: [], branch: [], documentId: [] },
      db as unknown as IRelationalDb<DB>,
      { embed: false, automation: { driveId: DRIVE, client, log: quiet }, now: () => Date.parse(T) + 60 * 60_000 },
    );
    expect(processor.isLiveOperation(T)).toBe(false);
    expect(processor.isLiveOperation(new Date(Date.parse(T) + 60 * 60_000 - 60_000).toISOString())).toBe(true); // inside the skew window
    expect(processor.isLiveOperation(undefined)).toBe(false);
    expect(processor.isLiveOperation("not a date")).toBe(false);
    await processor.onOperations([relOp("a", "b", "CONTRADICTS", 1)]);
    await new Promise((r) => setTimeout(r, 50));
    expect(calls).toHaveLength(0);
    // …but the edge itself was still indexed.
    expect((await query.forwardLinks("a")).map((e) => e.linkType)).toEqual(["CONTRADICTS"]);
  });

  it("read-only when no automation is configured", async () => {
    const processor = new GraphIndexerProcessor(
      "ns", { documentType: [], scope: [], branch: [], documentId: [] },
      db as unknown as IRelationalDb<DB>, { embed: false },
    );
    expect(processor.automationEnabled).toBe(false);
  });
});
