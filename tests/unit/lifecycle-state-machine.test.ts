import { describe, it, expect } from "vitest";
import { reducer, utils, actions } from "document-models/knowledge-note/v1";

// Helper: build a document with provenance set (author "alice") and a title set.
// provenance = op 0, title = op 1 — lifecycle ops start at index 2.
function makeNoteWithProvenance() {
  const doc = utils.createDocument();

  const withProvenance = reducer(
    doc,
    actions.setProvenance({
      author: "alice",
      sourceOrigin: "MANUAL",
      createdAt: "2026-01-01T00:00:00Z",
    }),
  );

  return reducer(
    withProvenance,
    actions.setTitle({
      title: "Test Note",
      updatedAt: "2026-01-01T00:00:00Z",
    }),
  );
}

describe("Lifecycle state machine — DRAFT → IN_REVIEW → CANONICAL → ARCHIVED", () => {
  // ── Test 1 ──────────────────────────────────────────────────────────────────
  it("SUBMIT_FOR_REVIEW transitions status from DRAFT to IN_REVIEW", () => {
    const doc = makeNoteWithProvenance();
    expect(doc.state.global.status).toBe("DRAFT");

    const updated = reducer(
      doc,
      actions.submitForReview({
        id: "evt-1",
        actor: "alice",
        timestamp: "2026-01-01T01:00:00Z",
      }),
    );

    expect(updated.state.global.status).toBe("IN_REVIEW");
    // A lifecycle event was appended
    expect(updated.state.global.lifecycleEvents).toHaveLength(1);
    expect(updated.state.global.lifecycleEvents[0]).toMatchObject({
      id: "evt-1",
      fromStatus: "DRAFT",
      toStatus: "IN_REVIEW",
      actor: "alice",
    });
  });

  // ── Test 2 ──────────────────────────────────────────────────────────────────
  it("APPROVE_NOTE transitions status from IN_REVIEW to CANONICAL when actor differs from author", () => {
    const doc = makeNoteWithProvenance();

    const inReview = reducer(
      doc,
      actions.submitForReview({
        id: "evt-1",
        actor: "alice",
        timestamp: "2026-01-01T01:00:00Z",
      }),
    );

    // actor "bob" ≠ author "alice"
    const approved = reducer(
      inReview,
      actions.approveNote({
        id: "evt-2",
        actor: "bob",
        timestamp: "2026-01-01T02:00:00Z",
      }),
    );

    expect(approved.state.global.status).toBe("CANONICAL");
    expect(approved.state.global.lifecycleEvents).toHaveLength(2);
    expect(approved.state.global.lifecycleEvents[1]).toMatchObject({
      id: "evt-2",
      fromStatus: "IN_REVIEW",
      toStatus: "CANONICAL",
      actor: "bob",
    });
  });

  // ── Test 3 ──────────────────────────────────────────────────────────────────
  it("APPROVE_NOTE with same actor as author records error 'Actor cannot approve their own note', status stays IN_REVIEW", () => {
    const doc = makeNoteWithProvenance();

    const inReview = reducer(
      doc,
      actions.submitForReview({
        id: "evt-1",
        actor: "alice",
        timestamp: "2026-01-01T01:00:00Z",
      }),
    );

    // actor "alice" == author "alice" → self-approval error
    // provenance(0), title(1), submitForReview(2), approveNote(3)
    const selfApproved = reducer(
      inReview,
      actions.approveNote({
        id: "evt-2",
        actor: "alice",
        timestamp: "2026-01-01T02:00:00Z",
      }),
    );

    expect(selfApproved.operations.global[3].error).toBeTruthy();
    expect(selfApproved.operations.global[3].error).toContain(
      "Actor cannot approve their own note",
    );
    expect(selfApproved.state.global.status).toBe("IN_REVIEW");
  });

  // ── Test 4 ──────────────────────────────────────────────────────────────────
  it("REJECT_NOTE transitions status from IN_REVIEW back to DRAFT (comment required)", () => {
    const doc = makeNoteWithProvenance();

    const inReview = reducer(
      doc,
      actions.submitForReview({
        id: "evt-1",
        actor: "alice",
        timestamp: "2026-01-01T01:00:00Z",
      }),
    );

    const rejected = reducer(
      inReview,
      actions.rejectNote({
        id: "evt-2",
        actor: "bob",
        comment: "Needs more context",
        timestamp: "2026-01-01T02:00:00Z",
      }),
    );

    expect(rejected.state.global.status).toBe("DRAFT");
    expect(rejected.state.global.lifecycleEvents).toHaveLength(2);
    expect(rejected.state.global.lifecycleEvents[1]).toMatchObject({
      id: "evt-2",
      fromStatus: "IN_REVIEW",
      toStatus: "DRAFT",
      actor: "bob",
      comment: "Needs more context",
    });
  });

  // ── Test 5 ──────────────────────────────────────────────────────────────────
  it("ARCHIVE_NOTE transitions status from CANONICAL to ARCHIVED (comment required)", () => {
    const doc = makeNoteWithProvenance();

    const inReview = reducer(
      doc,
      actions.submitForReview({
        id: "evt-1",
        actor: "alice",
        timestamp: "2026-01-01T01:00:00Z",
      }),
    );

    const canonical = reducer(
      inReview,
      actions.approveNote({
        id: "evt-2",
        actor: "bob",
        timestamp: "2026-01-01T02:00:00Z",
      }),
    );

    const archived = reducer(
      canonical,
      actions.archiveNote({
        id: "evt-3",
        actor: "bob",
        comment: "Superseded by new note",
        timestamp: "2026-01-01T03:00:00Z",
      }),
    );

    expect(archived.state.global.status).toBe("ARCHIVED");
    expect(archived.state.global.lifecycleEvents).toHaveLength(3);
    expect(archived.state.global.lifecycleEvents[2]).toMatchObject({
      id: "evt-3",
      fromStatus: "CANONICAL",
      toStatus: "ARCHIVED",
      actor: "bob",
      comment: "Superseded by new note",
    });
  });

  // ── Test 6 ──────────────────────────────────────────────────────────────────
  it("RESTORE_NOTE transitions status from ARCHIVED back to DRAFT", () => {
    const doc = makeNoteWithProvenance();

    const inReview = reducer(
      doc,
      actions.submitForReview({
        id: "evt-1",
        actor: "alice",
        timestamp: "2026-01-01T01:00:00Z",
      }),
    );

    const canonical = reducer(
      inReview,
      actions.approveNote({
        id: "evt-2",
        actor: "bob",
        timestamp: "2026-01-01T02:00:00Z",
      }),
    );

    const archived = reducer(
      canonical,
      actions.archiveNote({
        id: "evt-3",
        actor: "bob",
        comment: "Archiving this note",
        timestamp: "2026-01-01T03:00:00Z",
      }),
    );

    const restored = reducer(
      archived,
      actions.restoreNote({
        id: "evt-4",
        actor: "alice",
        timestamp: "2026-01-01T04:00:00Z",
      }),
    );

    expect(restored.state.global.status).toBe("DRAFT");
    expect(restored.state.global.lifecycleEvents).toHaveLength(4);
    expect(restored.state.global.lifecycleEvents[3]).toMatchObject({
      id: "evt-4",
      fromStatus: "ARCHIVED",
      toStatus: "DRAFT",
      actor: "alice",
    });
  });

  // ── Test 7 ──────────────────────────────────────────────────────────────────
  it("APPROVE_NOTE from DRAFT (invalid transition) records an error and status stays DRAFT", () => {
    const doc = makeNoteWithProvenance();
    // doc is in DRAFT — trying to approve directly is invalid
    // provenance(0), title(1), approveNote(2)
    const updated = reducer(
      doc,
      actions.approveNote({
        id: "evt-1",
        actor: "bob",
        timestamp: "2026-01-01T01:00:00Z",
      }),
    );

    expect(updated.operations.global[2].error).toBeTruthy();
    expect(updated.operations.global[2].error).toContain(
      "Can only approve from IN_REVIEW status",
    );
    expect(updated.state.global.status).toBe("DRAFT");
    expect(updated.state.global.lifecycleEvents).toHaveLength(0);
  });

  // ── Test 8 ──────────────────────────────────────────────────────────────────
  it("Full lifecycle DRAFT→IN_REVIEW→CANONICAL→ARCHIVED→DRAFT produces 4 lifecycle events", () => {
    const doc = makeNoteWithProvenance();

    const inReview = reducer(
      doc,
      actions.submitForReview({
        id: "evt-1",
        actor: "alice",
        timestamp: "2026-01-01T01:00:00Z",
      }),
    );

    const canonical = reducer(
      inReview,
      actions.approveNote({
        id: "evt-2",
        actor: "bob",
        timestamp: "2026-01-01T02:00:00Z",
      }),
    );

    const archived = reducer(
      canonical,
      actions.archiveNote({
        id: "evt-3",
        actor: "bob",
        comment: "Archiving",
        timestamp: "2026-01-01T03:00:00Z",
      }),
    );

    const restored = reducer(
      archived,
      actions.restoreNote({
        id: "evt-4",
        actor: "alice",
        timestamp: "2026-01-01T04:00:00Z",
      }),
    );

    expect(restored.state.global.status).toBe("DRAFT");
    expect(restored.state.global.lifecycleEvents).toHaveLength(4);

    const events = restored.state.global.lifecycleEvents;
    expect(events[0]).toMatchObject({
      fromStatus: "DRAFT",
      toStatus: "IN_REVIEW",
    });
    expect(events[1]).toMatchObject({
      fromStatus: "IN_REVIEW",
      toStatus: "CANONICAL",
    });
    expect(events[2]).toMatchObject({
      fromStatus: "CANONICAL",
      toStatus: "ARCHIVED",
    });
    expect(events[3]).toMatchObject({
      fromStatus: "ARCHIVED",
      toStatus: "DRAFT",
    });
  });
});
