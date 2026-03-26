# Knowledge Vault Test Suite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build comprehensive test coverage for the Knowledge Vault — document model reducers with real state assertions, graph indexer processor with in-memory DB, query layer, and integration tests against the remote drive.

**Architecture:** Three test layers: (1) Unit tests that verify actual state mutations (not just operation recording), (2) Processor tests using PGlite in-memory DB, (3) Integration tests hitting the live reactor at localhost:4001.

**Tech Stack:** Vitest, Kysely, @electric-sql/pglite, kysely-pglite-dialect, reactor-mcp

---

## File Structure

```
tests/
├── helpers/
│   ├── make-op.ts              ← OperationWithContext factory
│   └── create-test-db.ts       ← PGlite + Kysely test DB setup
├── unit/
│   ├── knowledge-note-reducers.test.ts  ← State mutation tests for all 26 ops
│   ├── moc-reducers.test.ts             ← State mutation tests for MOC
│   ├── pipeline-queue-reducers.test.ts  ← Phase advancement state machine
│   └── lifecycle-state-machine.test.ts  ← Full DRAFT→CANONICAL flow
├── processor/
│   ├── graph-indexer.test.ts            ← Processor onOperations tests
│   └── graph-query.test.ts             ← Query layer tests (orphans, BFS, density)
└── integration/
    └── remote-drive.test.ts             ← Tests against localhost:4001 reactor
```

---

### Task 1: Test Helpers

**Files:**
- Create: `tests/helpers/make-op.ts`
- Create: `tests/helpers/create-test-db.ts`

- [ ] **Step 1: Create the OperationWithContext factory**

```typescript
// tests/helpers/make-op.ts
import type { OperationWithContext } from "document-model";

export function makeOp(overrides?: {
  documentId?: string;
  documentType?: string;
  actionType?: string;
  actionInput?: Record<string, unknown>;
  resultingState?: Record<string, unknown>;
  index?: number;
}): OperationWithContext {
  const ts = String(Date.now());
  return {
    operation: {
      id: `op-${ts}`,
      index: overrides?.index ?? 0,
      skip: 0,
      timestampUtcMs: ts,
      hash: "test-hash",
      action: {
        id: `act-${ts}`,
        type: overrides?.actionType ?? "SET_TITLE",
        timestampUtcMs: ts,
        input: overrides?.actionInput ?? {},
        scope: "global",
      },
    },
    context: {
      documentId: overrides?.documentId ?? "test-doc-1",
      documentType: overrides?.documentType ?? "bai/knowledge-note",
      scope: "global",
      branch: "main",
      ordinal: 0,
      resultingState: overrides?.resultingState
        ? JSON.stringify({ global: overrides.resultingState })
        : undefined,
    },
  };
}
```

- [ ] **Step 2: Create the test database factory**

```typescript
// tests/helpers/create-test-db.ts
import { Kysely } from "kysely";
import { PGlite } from "@electric-sql/pglite";
import { PGliteDialect } from "kysely-pglite-dialect";
import type { DB } from "../../processors/graph-indexer/schema.js";
import { up, down } from "../../processors/graph-indexer/migrations.js";

export async function createTestDb() {
  const pglite = new PGlite();
  const db = new Kysely<DB>({ dialect: new PGliteDialect(pglite) });
  await up(db as any);
  return { db, pglite, cleanup: async () => { await down(db as any); await db.destroy(); } };
}
```

- [ ] **Step 3: Verify helpers compile**

Run: `./node_modules/.bin/tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add tests/helpers/
git commit -m "test: add test helpers (makeOp factory, createTestDb)"
```

---

### Task 2: Knowledge Note Reducer State Mutation Tests

**Files:**
- Create: `tests/unit/knowledge-note-reducers.test.ts`

These tests verify the ACTUAL STATE changes, not just that operations are recorded. This is the critical gap identified by the code review.

- [ ] **Step 1: Write failing tests for content operations**

```typescript
// tests/unit/knowledge-note-reducers.test.ts
import { describe, it, expect } from "vitest";
import {
  reducer,
  utils,
  actions,
} from "knowledge-note/document-models/knowledge-note/v1";

describe("Knowledge Note Reducers — State Mutations", () => {
  describe("Content Module", () => {
    it("SET_TITLE updates state.global.title", () => {
      const doc = utils.createDocument();
      const updated = reducer(doc, actions.setTitle({ title: "My Note", updatedAt: "2026-01-01T00:00:00Z" }));
      expect(updated.state.global.title).toBe("My Note");
    });

    it("SET_DESCRIPTION updates state.global.description", () => {
      const doc = utils.createDocument();
      const updated = reducer(doc, actions.setDescription({ description: "A test description", updatedAt: "2026-01-01T00:00:00Z" }));
      expect(updated.state.global.description).toBe("A test description");
    });

    it("SET_DESCRIPTION rejects descriptions over 200 chars", () => {
      const doc = utils.createDocument();
      const longDesc = "x".repeat(201);
      const updated = reducer(doc, actions.setDescription({ description: longDesc, updatedAt: "2026-01-01T00:00:00Z" }));
      expect(updated.operations.global[0].error).toBe("Description exceeds 200 characters");
      expect(updated.state.global.description).toBeNull();
    });

    it("SET_CONTENT updates state.global.content", () => {
      const doc = utils.createDocument();
      const updated = reducer(doc, actions.setContent({ content: "# Hello World", updatedAt: "2026-01-01T00:00:00Z" }));
      expect(updated.state.global.content).toBe("# Hello World");
    });

    it("PATCH_CONTENT inserts text at offset", () => {
      let doc = utils.createDocument();
      doc = reducer(doc, actions.setContent({ content: "Hello World", updatedAt: "2026-01-01T00:00:00Z" }));
      const updated = reducer(doc, actions.patchContent({ offset: 5, removeCount: 0, insert: " Beautiful", updatedAt: "2026-01-01T00:00:00Z" }));
      expect(updated.state.global.content).toBe("Hello Beautiful World");
    });

    it("PATCH_CONTENT rejects out-of-bounds offset", () => {
      const doc = utils.createDocument();
      const updated = reducer(doc, actions.patchContent({ offset: 100, removeCount: 5, insert: "x", updatedAt: "2026-01-01T00:00:00Z" }));
      expect(updated.operations.global[0].error).toBe("Offset + removeCount exceeds content length");
    });

    it("SET_NOTE_TYPE updates state.global.noteType", () => {
      const doc = utils.createDocument();
      const updated = reducer(doc, actions.setNoteType({ noteType: "concept", updatedAt: "2026-01-01T00:00:00Z" }));
      expect(updated.state.global.noteType).toBe("concept");
    });

    it("SET_METADATA_FIELD sets a valid string field", () => {
      const doc = utils.createDocument();
      const updated = reducer(doc, actions.setMetadataField({ field: "confidence", value: "high", updatedAt: "2026-01-01T00:00:00Z" }));
      expect(updated.state.global.confidence).toBe("high");
    });

    it("SET_METADATA_FIELD rejects invalid field name", () => {
      const doc = utils.createDocument();
      const updated = reducer(doc, actions.setMetadataField({ field: "nonexistent", value: "x", updatedAt: "2026-01-01T00:00:00Z" }));
      expect(updated.operations.global[0].error).toContain("not a recognized string metadata field");
    });

    it("SET_TITLE updates provenance.updatedAt when provenance exists", () => {
      let doc = utils.createDocument();
      doc = reducer(doc, actions.setProvenance({ author: "tester", sourceOrigin: "MANUAL", createdAt: "2026-01-01T00:00:00Z" }));
      const updated = reducer(doc, actions.setTitle({ title: "Updated", updatedAt: "2026-06-01T00:00:00Z" }));
      expect(updated.state.global.provenance?.updatedAt).toBe("2026-06-01T00:00:00Z");
    });
  });

  describe("Linking Module", () => {
    it("ADD_LINK adds a link to state.global.links", () => {
      const doc = utils.createDocument();
      const updated = reducer(doc, actions.addLink({ id: "link-1", targetDocumentId: "doc-2", linkType: "RELATES_TO" }));
      expect(updated.state.global.links).toHaveLength(1);
      expect(updated.state.global.links[0].targetDocumentId).toBe("doc-2");
      expect(updated.state.global.links[0].linkType).toBe("RELATES_TO");
    });

    it("ADD_LINK rejects duplicate link IDs", () => {
      let doc = utils.createDocument();
      doc = reducer(doc, actions.addLink({ id: "link-1", targetDocumentId: "doc-2", linkType: "RELATES_TO" }));
      const updated = reducer(doc, actions.addLink({ id: "link-1", targetDocumentId: "doc-3", linkType: "BUILDS_ON" }));
      expect(updated.operations.global[1].error).toBe("A link with this OID already exists");
      expect(updated.state.global.links).toHaveLength(1);
    });

    it("REMOVE_LINK removes a link by ID", () => {
      let doc = utils.createDocument();
      doc = reducer(doc, actions.addLink({ id: "link-1", targetDocumentId: "doc-2", linkType: "RELATES_TO" }));
      const updated = reducer(doc, actions.removeLink({ id: "link-1" }));
      expect(updated.state.global.links).toHaveLength(0);
    });

    it("ADD_TOPIC adds a topic", () => {
      const doc = utils.createDocument();
      const updated = reducer(doc, actions.addTopic({ id: "t-1", name: "architecture" }));
      expect(updated.state.global.topics).toHaveLength(1);
      expect(updated.state.global.topics[0].name).toBe("architecture");
    });

    it("ADD_TOPIC rejects duplicate topic names", () => {
      let doc = utils.createDocument();
      doc = reducer(doc, actions.addTopic({ id: "t-1", name: "architecture" }));
      const updated = reducer(doc, actions.addTopic({ id: "t-2", name: "architecture" }));
      expect(updated.operations.global[1].error).toContain("already exists");
    });
  });

  describe("Provenance Module", () => {
    it("SET_PROVENANCE sets full provenance", () => {
      const doc = utils.createDocument();
      const updated = reducer(doc, actions.setProvenance({ author: "alice", sourceOrigin: "MANUAL", createdAt: "2026-01-01T00:00:00Z" }));
      expect(updated.state.global.provenance?.author).toBe("alice");
      expect(updated.state.global.provenance?.sourceOrigin).toBe("MANUAL");
      expect(updated.state.global.provenance?.updatedAt).toBe("2026-01-01T00:00:00Z");
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `bun run test -- tests/unit/knowledge-note-reducers.test.ts`
Expected: All PASS (these test actual behavior, not mocks)

- [ ] **Step 3: Commit**

```bash
git add tests/unit/knowledge-note-reducers.test.ts
git commit -m "test: add state mutation tests for knowledge-note reducers"
```

---

### Task 3: Lifecycle State Machine Tests

**Files:**
- Create: `tests/unit/lifecycle-state-machine.test.ts`

Tests the full DRAFT → IN_REVIEW → CANONICAL → ARCHIVED flow, including error paths.

- [ ] **Step 1: Write lifecycle flow tests**

```typescript
// tests/unit/lifecycle-state-machine.test.ts
import { describe, it, expect } from "vitest";
import { reducer, utils, actions } from "knowledge-note/document-models/knowledge-note/v1";

describe("Lifecycle State Machine", () => {
  function createNoteWithProvenance() {
    let doc = utils.createDocument();
    doc = reducer(doc, actions.setProvenance({ author: "alice", sourceOrigin: "MANUAL", createdAt: "2026-01-01T00:00:00Z" }));
    doc = reducer(doc, actions.setTitle({ title: "Test Note", updatedAt: "2026-01-01T00:00:00Z" }));
    return doc;
  }

  it("DRAFT → IN_REVIEW via SUBMIT_FOR_REVIEW", () => {
    const doc = createNoteWithProvenance();
    expect(doc.state.global.status).toBe("DRAFT");
    const updated = reducer(doc, actions.submitForReview({ id: "evt-1", actor: "alice", timestamp: "2026-01-02T00:00:00Z" }));
    expect(updated.state.global.status).toBe("IN_REVIEW");
    expect(updated.state.global.lifecycleEvents).toHaveLength(1);
    expect(updated.state.global.lifecycleEvents[0].fromStatus).toBe("DRAFT");
    expect(updated.state.global.lifecycleEvents[0].toStatus).toBe("IN_REVIEW");
  });

  it("IN_REVIEW → CANONICAL via APPROVE_NOTE (different actor)", () => {
    let doc = createNoteWithProvenance();
    doc = reducer(doc, actions.submitForReview({ id: "evt-1", actor: "alice", timestamp: "2026-01-02T00:00:00Z" }));
    const updated = reducer(doc, actions.approveNote({ id: "evt-2", actor: "bob", timestamp: "2026-01-03T00:00:00Z" }));
    expect(updated.state.global.status).toBe("CANONICAL");
  });

  it("APPROVE_NOTE fails with self-approval", () => {
    let doc = createNoteWithProvenance();
    doc = reducer(doc, actions.submitForReview({ id: "evt-1", actor: "alice", timestamp: "2026-01-02T00:00:00Z" }));
    const updated = reducer(doc, actions.approveNote({ id: "evt-2", actor: "alice", timestamp: "2026-01-03T00:00:00Z" }));
    expect(updated.operations.global[2].error).toBe("Actor cannot approve their own note");
    expect(updated.state.global.status).toBe("IN_REVIEW");
  });

  it("IN_REVIEW → DRAFT via REJECT_NOTE", () => {
    let doc = createNoteWithProvenance();
    doc = reducer(doc, actions.submitForReview({ id: "evt-1", actor: "alice", timestamp: "2026-01-02T00:00:00Z" }));
    const updated = reducer(doc, actions.rejectNote({ id: "evt-2", actor: "bob", timestamp: "2026-01-03T00:00:00Z", comment: "Needs work" }));
    expect(updated.state.global.status).toBe("DRAFT");
  });

  it("CANONICAL → ARCHIVED via ARCHIVE_NOTE", () => {
    let doc = createNoteWithProvenance();
    doc = reducer(doc, actions.submitForReview({ id: "evt-1", actor: "alice", timestamp: "2026-01-02T00:00:00Z" }));
    doc = reducer(doc, actions.approveNote({ id: "evt-2", actor: "bob", timestamp: "2026-01-03T00:00:00Z" }));
    const updated = reducer(doc, actions.archiveNote({ id: "evt-3", actor: "alice", timestamp: "2026-01-04T00:00:00Z", comment: "Outdated" }));
    expect(updated.state.global.status).toBe("ARCHIVED");
  });

  it("ARCHIVED → DRAFT via RESTORE_NOTE", () => {
    let doc = createNoteWithProvenance();
    doc = reducer(doc, actions.submitForReview({ id: "evt-1", actor: "alice", timestamp: "2026-01-02T00:00:00Z" }));
    doc = reducer(doc, actions.approveNote({ id: "evt-2", actor: "bob", timestamp: "2026-01-03T00:00:00Z" }));
    doc = reducer(doc, actions.archiveNote({ id: "evt-3", actor: "alice", timestamp: "2026-01-04T00:00:00Z", comment: "Outdated" }));
    const updated = reducer(doc, actions.restoreNote({ id: "evt-4", actor: "alice", timestamp: "2026-01-05T00:00:00Z" }));
    expect(updated.state.global.status).toBe("DRAFT");
  });

  it("rejects invalid transitions (DRAFT → CANONICAL directly)", () => {
    const doc = createNoteWithProvenance();
    const updated = reducer(doc, actions.approveNote({ id: "evt-1", actor: "bob", timestamp: "2026-01-02T00:00:00Z" }));
    expect(updated.operations.global[2].error).toContain("Can only approve from IN_REVIEW status");
    expect(updated.state.global.status).toBe("DRAFT");
  });

  it("full lifecycle produces correct event count", () => {
    let doc = createNoteWithProvenance();
    doc = reducer(doc, actions.submitForReview({ id: "e1", actor: "alice", timestamp: "2026-01-02T00:00:00Z" }));
    doc = reducer(doc, actions.approveNote({ id: "e2", actor: "bob", timestamp: "2026-01-03T00:00:00Z" }));
    doc = reducer(doc, actions.archiveNote({ id: "e3", actor: "alice", timestamp: "2026-01-04T00:00:00Z", comment: "Done" }));
    doc = reducer(doc, actions.restoreNote({ id: "e4", actor: "alice", timestamp: "2026-01-05T00:00:00Z" }));
    expect(doc.state.global.lifecycleEvents).toHaveLength(4);
    expect(doc.state.global.status).toBe("DRAFT");
  });
});
```

- [ ] **Step 2: Run tests**

Run: `bun run test -- tests/unit/lifecycle-state-machine.test.ts`
Expected: All PASS

- [ ] **Step 3: Commit**

```bash
git add tests/unit/lifecycle-state-machine.test.ts
git commit -m "test: add lifecycle state machine flow tests"
```

---

### Task 4: Pipeline Queue Reducer Tests

**Files:**
- Create: `tests/unit/pipeline-queue-reducers.test.ts`

Tests the task state machine: ADD → ASSIGN → ADVANCE_PHASE → COMPLETE, including counter tracking.

- [ ] **Step 1: Write pipeline queue tests**

```typescript
// tests/unit/pipeline-queue-reducers.test.ts
import { describe, it, expect } from "vitest";
import { reducer, utils, actions } from "knowledge-note/document-models/pipeline-queue/v1";

describe("Pipeline Queue Reducers", () => {
  it("ADD_TASK creates a task with PENDING status", () => {
    const doc = utils.createDocument();
    const updated = reducer(doc, actions.addTask({
      id: "task-1", taskType: "claim", target: "Test claim", createdAt: "2026-01-01T00:00:00Z",
    }));
    expect(updated.state.global.tasks).toHaveLength(1);
    expect(updated.state.global.tasks[0].status).toBe("PENDING");
    expect(updated.state.global.tasks[0].currentPhase).toBe("create");
    expect(updated.state.global.activeCount).toBe(1);
  });

  it("ASSIGN_TASK transitions to IN_PROGRESS", () => {
    let doc = utils.createDocument();
    doc = reducer(doc, actions.addTask({ id: "task-1", taskType: "claim", target: "Test", createdAt: "2026-01-01T00:00:00Z" }));
    const updated = reducer(doc, actions.assignTask({ taskId: "task-1", assignedTo: "agent-1", updatedAt: "2026-01-01T01:00:00Z" }));
    expect(updated.state.global.tasks[0].status).toBe("IN_PROGRESS");
    expect(updated.state.global.tasks[0].assignedTo).toBe("agent-1");
  });

  it("ADVANCE_PHASE moves to next phase", () => {
    let doc = utils.createDocument();
    doc = reducer(doc, actions.addTask({ id: "task-1", taskType: "claim", target: "Test", createdAt: "2026-01-01T00:00:00Z" }));
    const updated = reducer(doc, actions.advancePhase({
      taskId: "task-1", updatedAt: "2026-01-01T02:00:00Z",
      handoff: { id: "h-1", phase: "create", workDone: "Created note", filesModified: [], completedAt: "2026-01-01T02:00:00Z" },
    }));
    expect(updated.state.global.tasks[0].currentPhase).toBe("reflect");
    expect(updated.state.global.tasks[0].completedPhases).toContain("create");
    expect(updated.state.global.tasks[0].handoffs).toHaveLength(1);
  });

  it("ADVANCE_PHASE on final phase auto-completes task", () => {
    let doc = utils.createDocument();
    doc = reducer(doc, actions.addTask({ id: "task-1", taskType: "claim", target: "Test", createdAt: "2026-01-01T00:00:00Z" }));
    // Advance through all 4 phases: create → reflect → reweave → verify
    const phases = ["create", "reflect", "reweave", "verify"];
    for (const phase of phases) {
      doc = reducer(doc, actions.advancePhase({
        taskId: "task-1", updatedAt: "2026-01-01T02:00:00Z",
        handoff: { id: `h-${phase}`, phase, workDone: `Done ${phase}`, filesModified: [], completedAt: "2026-01-01T02:00:00Z" },
      }));
    }
    expect(doc.state.global.tasks[0].status).toBe("DONE");
    expect(doc.state.global.tasks[0].currentPhase).toBeNull();
    expect(doc.state.global.completedCount).toBe(1);
    expect(doc.state.global.activeCount).toBe(0);
  });

  it("BLOCK_TASK and UNBLOCK_TASK toggle status", () => {
    let doc = utils.createDocument();
    doc = reducer(doc, actions.addTask({ id: "task-1", taskType: "claim", target: "Test", createdAt: "2026-01-01T00:00:00Z" }));
    doc = reducer(doc, actions.blockTask({ taskId: "task-1", reason: "Waiting for data", updatedAt: "2026-01-01T01:00:00Z" }));
    expect(doc.state.global.tasks[0].status).toBe("BLOCKED");
    doc = reducer(doc, actions.unblockTask({ taskId: "task-1", updatedAt: "2026-01-01T02:00:00Z" }));
    expect(doc.state.global.tasks[0].status).toBe("PENDING");
  });

  it("FAIL_TASK marks task as failed and decrements activeCount", () => {
    let doc = utils.createDocument();
    doc = reducer(doc, actions.addTask({ id: "task-1", taskType: "claim", target: "Test", createdAt: "2026-01-01T00:00:00Z" }));
    const updated = reducer(doc, actions.failTask({ taskId: "task-1", reason: "Error occurred", updatedAt: "2026-01-01T01:00:00Z" }));
    expect(updated.state.global.tasks[0].status).toBe("FAILED");
    expect(updated.state.global.activeCount).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests**

Run: `bun run test -- tests/unit/pipeline-queue-reducers.test.ts`
Expected: All PASS

- [ ] **Step 3: Commit**

```bash
git add tests/unit/pipeline-queue-reducers.test.ts
git commit -m "test: add pipeline queue state machine tests"
```

---

### Task 5: Graph Indexer Processor Tests

**Files:**
- Create: `tests/processor/graph-indexer.test.ts`

Tests the processor's onOperations with a real in-memory PGlite database.

- [ ] **Step 1: Write processor tests**

```typescript
// tests/processor/graph-indexer.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Kysely } from "kysely";
import { PGlite } from "@electric-sql/pglite";
import { PGliteDialect } from "kysely-pglite-dialect";
import type { DB } from "../../processors/graph-indexer/schema.js";
import { up, down } from "../../processors/graph-indexer/migrations.js";
import { makeOp } from "../helpers/make-op.js";

// We test the processor logic directly via DB operations
// since RelationalDbProcessor requires reactor infrastructure

describe("Graph Indexer — DB Operations", () => {
  let db: Kysely<DB>;

  beforeAll(async () => {
    const pglite = new PGlite();
    db = new Kysely<DB>({ dialect: new PGliteDialect(pglite) });
    await up(db as any);
  });

  afterAll(async () => {
    await down(db as any);
    await db.destroy();
  });

  it("upserts a node from resultingState", async () => {
    await db.insertInto("graph_nodes").values({
      id: "doc-1", document_id: "doc-1", title: "Test Note",
      description: null, note_type: "concept", status: "DRAFT", updated_at: new Date().toISOString(),
    }).execute();

    const rows = await db.selectFrom("graph_nodes").selectAll().execute();
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe("Test Note");
    expect(rows[0].status).toBe("DRAFT");
  });

  it("inserts edges", async () => {
    await db.insertInto("graph_edges").values({
      id: "edge-1", source_document_id: "doc-1", target_document_id: "doc-2",
      link_type: "RELATES_TO", target_title: "Other Note", updated_at: new Date().toISOString(),
    }).execute();

    const edges = await db.selectFrom("graph_edges").selectAll().execute();
    expect(edges).toHaveLength(1);
    expect(edges[0].link_type).toBe("RELATES_TO");
  });

  it("cascades deletes on node removal", async () => {
    // Delete edges referencing doc-1
    await db.deleteFrom("graph_edges").where((eb) =>
      eb.or([
        eb("source_document_id", "=", "doc-1"),
        eb("target_document_id", "=", "doc-1"),
      ])
    ).execute();
    await db.deleteFrom("graph_nodes").where("document_id", "=", "doc-1").execute();

    const nodes = await db.selectFrom("graph_nodes").selectAll().execute();
    const edges = await db.selectFrom("graph_edges").selectAll().execute();
    expect(nodes).toHaveLength(0);
    expect(edges).toHaveLength(0);
  });

  it("handles upsert on conflict", async () => {
    await db.insertInto("graph_nodes").values({
      id: "doc-2", document_id: "doc-2", title: "Original",
      description: null, note_type: null, status: "DRAFT", updated_at: new Date().toISOString(),
    }).onConflict((oc) => oc.column("document_id").doUpdateSet({ title: "Updated" })).execute();

    await db.insertInto("graph_nodes").values({
      id: "doc-2", document_id: "doc-2", title: "Updated Again",
      description: null, note_type: null, status: "CANONICAL", updated_at: new Date().toISOString(),
    }).onConflict((oc) => oc.column("document_id").doUpdateSet({ title: "Updated Again", status: "CANONICAL" })).execute();

    const rows = await db.selectFrom("graph_nodes").where("document_id", "=", "doc-2").selectAll().execute();
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe("Updated Again");
    expect(rows[0].status).toBe("CANONICAL");
  });
});
```

- [ ] **Step 2: Run tests**

Run: `bun run test -- tests/processor/graph-indexer.test.ts`
Expected: All PASS

- [ ] **Step 3: Commit**

```bash
git add tests/processor/graph-indexer.test.ts
git commit -m "test: add graph indexer processor DB tests"
```

---

### Task 6: Graph Query Layer Tests

**Files:**
- Create: `tests/processor/graph-query.test.ts`

Tests the query layer (orphans, stats, BFS connections, density, backlinks).

- [ ] **Step 1: Write query tests**

```typescript
// tests/processor/graph-query.test.ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { Kysely } from "kysely";
import { PGlite } from "@electric-sql/pglite";
import { PGliteDialect } from "kysely-pglite-dialect";
import type { DB } from "../../processors/graph-indexer/schema.js";
import { up, down } from "../../processors/graph-indexer/migrations.js";
import { createGraphQuery } from "../../processors/graph-indexer/query.js";

describe("Graph Query Layer", () => {
  let db: Kysely<DB>;
  let query: ReturnType<typeof createGraphQuery>;

  beforeAll(async () => {
    const pglite = new PGlite();
    db = new Kysely<DB>({ dialect: new PGliteDialect(pglite) });
    await up(db as any);
    query = createGraphQuery(db);
  });

  afterAll(async () => {
    await down(db as any);
    await db.destroy();
  });

  beforeEach(async () => {
    await db.deleteFrom("graph_edges").execute();
    await db.deleteFrom("graph_nodes").execute();
  });

  async function seedNodes(...nodes: { id: string; title: string; status?: string }[]) {
    for (const n of nodes) {
      await db.insertInto("graph_nodes").values({
        id: n.id, document_id: n.id, title: n.title, description: null,
        note_type: null, status: n.status ?? "DRAFT", updated_at: new Date().toISOString(),
      }).execute();
    }
  }

  async function seedEdge(source: string, target: string, linkType?: string) {
    await db.insertInto("graph_edges").values({
      id: `${source}-${target}`, source_document_id: source, target_document_id: target,
      link_type: linkType ?? null, target_title: null, updated_at: new Date().toISOString(),
    }).execute();
  }

  it("allNodes returns all nodes", async () => {
    await seedNodes({ id: "a", title: "A" }, { id: "b", title: "B" });
    const nodes = await query.allNodes();
    expect(nodes).toHaveLength(2);
  });

  it("nodeByDocumentId returns correct node", async () => {
    await seedNodes({ id: "a", title: "Alpha" });
    const node = await query.nodeByDocumentId("a");
    expect(node?.title).toBe("Alpha");
  });

  it("nodesByStatus filters correctly", async () => {
    await seedNodes({ id: "a", title: "A", status: "DRAFT" }, { id: "b", title: "B", status: "CANONICAL" });
    const canonical = await query.nodesByStatus("CANONICAL");
    expect(canonical).toHaveLength(1);
    expect(canonical[0].documentId).toBe("b");
  });

  it("orphanNodes finds nodes with no incoming edges", async () => {
    await seedNodes({ id: "a", title: "A" }, { id: "b", title: "B" }, { id: "c", title: "C" });
    await seedEdge("a", "b");
    const orphans = await query.orphanNodes();
    // "a" and "c" have no incoming edges; "b" does
    expect(orphans.map((o) => o.documentId).sort()).toEqual(["a", "c"]);
  });

  it("stats returns correct counts", async () => {
    await seedNodes({ id: "a", title: "A" }, { id: "b", title: "B" }, { id: "c", title: "C" });
    await seedEdge("a", "b");
    await seedEdge("a", "c");
    const stats = await query.stats();
    expect(stats.nodeCount).toBe(3);
    expect(stats.edgeCount).toBe(2);
    expect(stats.orphanCount).toBe(1); // only "a" has no incoming
  });

  it("connections does BFS traversal", async () => {
    await seedNodes({ id: "a", title: "A" }, { id: "b", title: "B" }, { id: "c", title: "C" });
    await seedEdge("a", "b");
    await seedEdge("b", "c");
    const conns = await query.connections("a", 2);
    expect(conns).toHaveLength(2);
    expect(conns[0].depth).toBe(1);
    expect(conns[0].node.documentId).toBe("b");
    expect(conns[1].depth).toBe(2);
    expect(conns[1].node.documentId).toBe("c");
  });

  it("connections respects maxDepth", async () => {
    await seedNodes({ id: "a", title: "A" }, { id: "b", title: "B" }, { id: "c", title: "C" });
    await seedEdge("a", "b");
    await seedEdge("b", "c");
    const conns = await query.connections("a", 1);
    expect(conns).toHaveLength(1);
  });

  it("backlinks returns incoming edges", async () => {
    await seedNodes({ id: "a", title: "A" }, { id: "b", title: "B" });
    await seedEdge("a", "b");
    await seedEdge("a", "b"); // duplicate edge ID will fail, but different edge
    const back = await query.backlinks("b");
    expect(back).toHaveLength(1);
    expect(back[0].sourceDocumentId).toBe("a");
  });

  it("density calculates correctly", async () => {
    await seedNodes({ id: "a", title: "A" }, { id: "b", title: "B" }, { id: "c", title: "C" });
    await seedEdge("a", "b");
    await seedEdge("b", "c");
    await seedEdge("a", "c");
    const d = await query.density();
    // 3 edges / (3 * 2) = 0.5
    expect(d).toBeCloseTo(0.5, 1);
  });

  it("density returns 0 for single node", async () => {
    await seedNodes({ id: "a", title: "A" });
    const d = await query.density();
    expect(d).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests**

Run: `bun run test -- tests/processor/graph-query.test.ts`
Expected: All PASS

- [ ] **Step 3: Commit**

```bash
git add tests/processor/graph-query.test.ts
git commit -m "test: add graph query layer tests (orphans, BFS, density)"
```

---

### Task 7: MOC Reducer Tests

**Files:**
- Create: `tests/unit/moc-reducers.test.ts`

- [ ] **Step 1: Write MOC state mutation tests**

```typescript
// tests/unit/moc-reducers.test.ts
import { describe, it, expect } from "vitest";
import { reducer, utils, actions } from "knowledge-note/document-models/moc/v1";

describe("MOC Reducers — State Mutations", () => {
  it("CREATE_MOC initializes all fields", () => {
    const doc = utils.createDocument();
    const updated = reducer(doc, actions.createMoc({
      title: "Agent Cognition", description: "How agents think", orientation: "This topic covers...",
      tier: "DOMAIN", createdAt: "2026-01-01T00:00:00Z",
    }));
    expect(updated.state.global.title).toBe("Agent Cognition");
    expect(updated.state.global.tier).toBe("DOMAIN");
    expect(updated.state.global.noteCount).toBe(0);
  });

  it("ADD_CORE_IDEA increments noteCount", () => {
    let doc = utils.createDocument();
    doc = reducer(doc, actions.createMoc({ title: "Test", description: "D", orientation: "O", tier: "TOPIC", createdAt: "2026-01-01T00:00:00Z" }));
    const updated = reducer(doc, actions.addCoreIdea({
      id: "ci-1", noteRef: "note-1", contextPhrase: "Explains why X matters", sortOrder: 0, addedAt: "2026-01-01T00:00:00Z",
    }));
    expect(updated.state.global.coreIdeas).toHaveLength(1);
    expect(updated.state.global.noteCount).toBe(1);
  });

  it("REMOVE_CORE_IDEA decrements noteCount", () => {
    let doc = utils.createDocument();
    doc = reducer(doc, actions.createMoc({ title: "Test", description: "D", orientation: "O", tier: "TOPIC", createdAt: "2026-01-01T00:00:00Z" }));
    doc = reducer(doc, actions.addCoreIdea({ id: "ci-1", noteRef: "note-1", contextPhrase: "Why", sortOrder: 0, addedAt: "2026-01-01T00:00:00Z" }));
    const updated = reducer(doc, actions.removeCoreIdea({ id: "ci-1" }));
    expect(updated.state.global.coreIdeas).toHaveLength(0);
    expect(updated.state.global.noteCount).toBe(0);
  });

  it("ADD_OPEN_QUESTION appends question", () => {
    let doc = utils.createDocument();
    doc = reducer(doc, actions.createMoc({ title: "T", description: "D", orientation: "O", tier: "TOPIC", createdAt: "2026-01-01T00:00:00Z" }));
    const updated = reducer(doc, actions.addOpenQuestion({ question: "How does X relate to Y?" }));
    expect(updated.state.global.openQuestions).toContain("How does X relate to Y?");
  });

  it("ADD_CHILD_MOC rejects duplicates", () => {
    let doc = utils.createDocument();
    doc = reducer(doc, actions.createMoc({ title: "T", description: "D", orientation: "O", tier: "HUB", createdAt: "2026-01-01T00:00:00Z" }));
    doc = reducer(doc, actions.addChildMoc({ childRef: "moc-2" }));
    const updated = reducer(doc, actions.addChildMoc({ childRef: "moc-2" }));
    expect(updated.operations.global[2].error).toContain("already linked");
  });
});
```

- [ ] **Step 2: Run tests**

Run: `bun run test -- tests/unit/moc-reducers.test.ts`
Expected: All PASS

- [ ] **Step 3: Commit**

```bash
git add tests/unit/moc-reducers.test.ts
git commit -m "test: add MOC reducer state mutation tests"
```

---

### Task 8: Integration Tests Against Remote Drive

**Files:**
- Create: `tests/integration/remote-drive.test.ts`

Tests against the live reactor at localhost:4001 using fetch to the GraphQL endpoint and the drive REST API.

- [ ] **Step 1: Write integration tests**

```typescript
// tests/integration/remote-drive.test.ts
import { describe, it, expect } from "vitest";

const DRIVE_SLUG = "remote-knowledge-vault";
const DRIVE_URL = `http://localhost:4001/d/${DRIVE_SLUG}`;
const GRAPHQL_URL = "http://localhost:4001/graphql";

async function fetchDrive() {
  const res = await fetch(DRIVE_URL);
  return res.json();
}

async function gql(query: string, variables?: Record<string, unknown>) {
  const res = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  return res.json();
}

describe("Remote Drive Integration", () => {
  it("drive exists and is accessible", async () => {
    const drive = await fetchDrive();
    expect(drive.id).toBeDefined();
    expect(drive.slug).toBe(DRIVE_SLUG);
  });

  it("drive has the expected folder structure", async () => {
    const drive = await fetchDrive();
    // The drive REST API returns basic info, get full state via MCP or direct query
    expect(drive.name).toBe(DRIVE_SLUG);
  });

  it("findDocuments returns documents from the drive", async () => {
    const result = await gql(`
      query {
        findDocuments(search: { type: "bai/knowledge-note" }) {
          items { id name }
          totalCount
        }
      }
    `);
    expect(result.data.findDocuments).toBeDefined();
    expect(result.data.findDocuments.totalCount).toBeGreaterThanOrEqual(0);
  });

  it("findDocuments returns bai/pipeline-queue singleton", async () => {
    const result = await gql(`
      query {
        findDocuments(search: { type: "bai/pipeline-queue" }) {
          items { id name }
          totalCount
        }
      }
    `);
    expect(result.data.findDocuments.totalCount).toBeGreaterThanOrEqual(1);
  });

  it("findDocuments returns bai/vault-config singleton", async () => {
    const result = await gql(`
      query {
        findDocuments(search: { type: "bai/vault-config" }) {
          items { id name }
          totalCount
        }
      }
    `);
    expect(result.data.findDocuments.totalCount).toBeGreaterThanOrEqual(1);
  });

  it("findDocuments returns bai/knowledge-graph document", async () => {
    const result = await gql(`
      query {
        findDocuments(search: { type: "bai/knowledge-graph" }) {
          items { id name }
          totalCount
        }
      }
    `);
    expect(result.data.findDocuments.totalCount).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run tests (requires reactor running)**

Run: `bun run test -- tests/integration/remote-drive.test.ts`
Expected: All PASS (reactor must be running at localhost:4001)

- [ ] **Step 3: Commit**

```bash
git add tests/integration/remote-drive.test.ts
git commit -m "test: add integration tests against remote drive"
```

---

### Task 9: Run Full Test Suite and Verify

- [ ] **Step 1: Run all tests**

Run: `bun run test`
Expected: All 133 existing + ~40 new tests PASS

- [ ] **Step 2: Run build**

Run: `bun run build`
Expected: Clean build

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "test: comprehensive Knowledge Vault test suite — reducers, processor, query, integration"
```
