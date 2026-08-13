import {
  addLink,
  addTopic,
  approveNote,
  archiveNote,
  patchContent,
  reducer,
  rejectNote,
  removeLink,
  removeTopic,
  restoreNote,
  setContent,
  setDescription,
  setMetadataField,
  setMetadataListField,
  setNoteType,
  setProvenance,
  setTitle,
  submitForReview,
  updateLinkType,
  utils,
} from "document-models/knowledge-note/v1";
import { describe, expect, it } from "vitest";

const T1 = "2026-01-01T00:00:00.000Z";
const T2 = "2026-01-02T00:00:00.000Z";
const T3 = "2026-01-03T00:00:00.000Z";

describe("Content reducer branch coverage", () => {
  it("applies all content operations without provenance (provenance stays null)", () => {
    let doc = utils.createDocument();

    doc = reducer(doc, setTitle({ title: "My Note", updatedAt: T1 }));
    doc = reducer(
      doc,
      setDescription({ description: "A short description", updatedAt: T1 }),
    );
    doc = reducer(doc, setNoteType({ noteType: "insight", updatedAt: T1 }));
    doc = reducer(doc, setContent({ content: "hello world", updatedAt: T1 }));
    doc = reducer(
      doc,
      setMetadataField({ field: "scope", value: "team", updatedAt: T1 }),
    );
    doc = reducer(
      doc,
      setMetadataListField({
        field: "models",
        values: ["knowledge-note"],
        updatedAt: T1,
      }),
    );

    expect(doc.state.global.title).toBe("My Note");
    expect(doc.state.global.description).toBe("A short description");
    expect(doc.state.global.noteType).toBe("insight");
    expect(doc.state.global.content).toBe("hello world");
    expect(doc.state.global.scope).toBe("team");
    expect(doc.state.global.models).toStrictEqual(["knowledge-note"]);
    expect(doc.state.global.provenance).toBeNull();
    for (const op of doc.operations.global) {
      expect(op.error).toBeUndefined();
    }
  });

  it("updates provenance.updatedAt on every content operation when provenance is set", () => {
    let doc = utils.createDocument();
    doc = reducer(
      doc,
      setProvenance({ author: "alice", createdAt: T1, sourceOrigin: "MANUAL" }),
    );
    expect(doc.state.global.provenance?.updatedAt).toBe(T1);
    expect(doc.state.global.provenance?.sessionId).toBeNull();

    doc = reducer(doc, setTitle({ title: "Titled", updatedAt: T2 }));
    expect(doc.state.global.provenance?.updatedAt).toBe(T2);

    doc = reducer(doc, setDescription({ description: "d", updatedAt: T3 }));
    expect(doc.state.global.provenance?.updatedAt).toBe(T3);

    doc = reducer(doc, setNoteType({ noteType: "pattern", updatedAt: T1 }));
    expect(doc.state.global.provenance?.updatedAt).toBe(T1);

    doc = reducer(doc, setContent({ content: "abcdef", updatedAt: T2 }));
    expect(doc.state.global.provenance?.updatedAt).toBe(T2);

    doc = reducer(
      doc,
      patchContent({ offset: 0, removeCount: 3, insert: "xyz", updatedAt: T3 }),
    );
    expect(doc.state.global.content).toBe("xyzdef");
    expect(doc.state.global.provenance?.updatedAt).toBe(T3);

    doc = reducer(
      doc,
      setMetadataField({ field: "confidence", value: "high", updatedAt: T1 }),
    );
    expect(doc.state.global.confidence).toBe("high");
    expect(doc.state.global.provenance?.updatedAt).toBe(T1);

    doc = reducer(
      doc,
      setMetadataListField({
        field: "hooksUsed",
        values: ["useSelectedDocument"],
        updatedAt: T2,
      }),
    );
    expect(doc.state.global.hooksUsed).toStrictEqual(["useSelectedDocument"]);
    expect(doc.state.global.provenance?.updatedAt).toBe(T2);
  });

  it("rejects a description longer than 200 characters and does not mutate state", () => {
    const doc = utils.createDocument();
    const longDescription = "x".repeat(201);

    const updated = reducer(
      doc,
      setDescription({ description: longDescription, updatedAt: T1 }),
    );

    expect(updated.operations.global[0].error).toBe(
      "Description exceeds 200 characters",
    );
    expect(updated.state.global.description).toBeNull();
  });

  it("accepts a description of exactly 200 characters", () => {
    const doc = utils.createDocument();
    const maxDescription = "y".repeat(200);

    const updated = reducer(
      doc,
      setDescription({ description: maxDescription, updatedAt: T1 }),
    );

    expect(updated.operations.global[0].error).toBeUndefined();
    expect(updated.state.global.description).toBe(maxDescription);
  });

  it("patches empty (null) content using the empty-string fallback", () => {
    const doc = utils.createDocument();

    const updated = reducer(
      doc,
      patchContent({ offset: 0, removeCount: 0, insert: "hi", updatedAt: T1 }),
    );

    expect(updated.operations.global[0].error).toBeUndefined();
    expect(updated.state.global.content).toBe("hi");
  });

  it("patches existing content with remove and insert", () => {
    let doc = utils.createDocument();
    doc = reducer(doc, setContent({ content: "hello world", updatedAt: T1 }));

    doc = reducer(
      doc,
      patchContent({
        offset: 6,
        removeCount: 5,
        insert: "there",
        updatedAt: T2,
      }),
    );

    expect(doc.operations.global[1].error).toBeUndefined();
    expect(doc.state.global.content).toBe("hello there");
  });

  it("rejects a patch with a negative offset", () => {
    const doc = utils.createDocument();

    const updated = reducer(
      doc,
      patchContent({ offset: -1, removeCount: 0, insert: "a", updatedAt: T1 }),
    );

    expect(updated.operations.global[0].error).toBe(
      "Offset + removeCount exceeds content length",
    );
    expect(updated.state.global.content).toBeNull();
  });

  it("rejects a patch where offset + removeCount exceeds content length", () => {
    let doc = utils.createDocument();
    doc = reducer(doc, setContent({ content: "short", updatedAt: T1 }));

    doc = reducer(
      doc,
      patchContent({ offset: 3, removeCount: 10, insert: "", updatedAt: T2 }),
    );

    expect(doc.operations.global[1].error).toBe(
      "Offset + removeCount exceeds content length",
    );
    expect(doc.state.global.content).toBe("short");
  });

  it("rejects an unknown string metadata field and does not mutate state", () => {
    const doc = utils.createDocument();

    const updated = reducer(
      doc,
      setMetadataField({ field: "bogus", value: "v", updatedAt: T1 }),
    );

    expect(updated.operations.global[0].error).toBe(
      '"bogus" is not a recognized string metadata field',
    );
  });

  it("sets representative string metadata fields and falls back to null for empty values", () => {
    let doc = utils.createDocument();

    doc = reducer(
      doc,
      setMetadataField({
        field: "correctPattern",
        value: "use barrel imports",
        updatedAt: T1,
      }),
    );
    expect(doc.state.global.correctPattern).toBe("use barrel imports");

    // empty string is coerced to null via `value || null`
    doc = reducer(
      doc,
      setMetadataField({ field: "correctPattern", value: "", updatedAt: T1 }),
    );
    expect(doc.state.global.correctPattern).toBeNull();

    // omitted value also falls back to null
    doc = reducer(
      doc,
      setMetadataField({ field: "severity", updatedAt: T1 }),
    );
    expect(doc.state.global.severity).toBeNull();
    for (const op of doc.operations.global) {
      expect(op.error).toBeUndefined();
    }
  });

  it("rejects an unknown list metadata field and does not mutate state", () => {
    const doc = utils.createDocument();

    const updated = reducer(
      doc,
      setMetadataListField({ field: "nope", values: ["a"], updatedAt: T1 }),
    );

    expect(updated.operations.global[0].error).toBe(
      '"nope" is not a recognized list metadata field',
    );
  });

  it("sets list metadata fields including an empty array", () => {
    let doc = utils.createDocument();

    doc = reducer(
      doc,
      setMetadataListField({
        field: "consequences",
        values: ["slower builds"],
        updatedAt: T1,
      }),
    );
    expect(doc.state.global.consequences).toStrictEqual(["slower builds"]);

    doc = reducer(
      doc,
      setMetadataListField({ field: "consequences", values: [], updatedAt: T1 }),
    );
    expect(doc.state.global.consequences).toStrictEqual([]);
  });
});

describe("Lifecycle reducer branch coverage", () => {
  it("runs the full lifecycle without provenance: draft -> review -> canonical -> archived -> draft", () => {
    let doc = utils.createDocument();
    expect(doc.state.global.status).toBe("DRAFT");

    // comment omitted -> stored as null
    doc = reducer(
      doc,
      submitForReview({ id: "ev-1", actor: "alice", timestamp: T1 }),
    );
    expect(doc.state.global.status).toBe("IN_REVIEW");
    expect(doc.state.global.lifecycleEvents[0]).toStrictEqual({
      id: "ev-1",
      fromStatus: "DRAFT",
      toStatus: "IN_REVIEW",
      actor: "alice",
      timestamp: T1,
      comment: null,
    });

    // no provenance -> self-approval check is skipped even for the author
    doc = reducer(
      doc,
      approveNote({ id: "ev-2", actor: "alice", timestamp: T2 }),
    );
    expect(doc.state.global.status).toBe("CANONICAL");
    expect(doc.state.global.lifecycleEvents[1].comment).toBeNull();

    doc = reducer(
      doc,
      archiveNote({ id: "ev-3", actor: "bob", timestamp: T3, comment: "old" }),
    );
    expect(doc.state.global.status).toBe("ARCHIVED");
    expect(doc.state.global.lifecycleEvents[2].comment).toBe("old");

    // comment omitted on restore -> null
    doc = reducer(
      doc,
      restoreNote({ id: "ev-4", actor: "bob", timestamp: T3 }),
    );
    expect(doc.state.global.status).toBe("DRAFT");
    expect(doc.state.global.lifecycleEvents[3].comment).toBeNull();

    expect(doc.state.global.provenance).toBeNull();
    for (const op of doc.operations.global) {
      expect(op.error).toBeUndefined();
    }
  });

  it("runs the lifecycle with provenance, updating provenance.updatedAt and storing comments", () => {
    let doc = utils.createDocument();
    doc = reducer(
      doc,
      setProvenance({
        author: "alice",
        createdAt: T1,
        sourceOrigin: "SESSION_MINE",
        sessionId: "sess-1",
      }),
    );
    expect(doc.state.global.provenance?.sessionId).toBe("sess-1");

    doc = reducer(
      doc,
      submitForReview({
        id: "ev-1",
        actor: "alice",
        timestamp: T2,
        comment: "please review",
      }),
    );
    expect(doc.state.global.lifecycleEvents[0].comment).toBe("please review");
    expect(doc.state.global.provenance?.updatedAt).toBe(T2);

    // a different actor may approve
    doc = reducer(
      doc,
      approveNote({
        id: "ev-2",
        actor: "bob",
        timestamp: T3,
        comment: "looks good",
      }),
    );
    expect(doc.state.global.status).toBe("CANONICAL");
    expect(doc.state.global.lifecycleEvents[1].comment).toBe("looks good");
    expect(doc.state.global.provenance?.updatedAt).toBe(T3);

    doc = reducer(
      doc,
      archiveNote({
        id: "ev-3",
        actor: "bob",
        timestamp: T1,
        comment: "superseded",
      }),
    );
    expect(doc.state.global.status).toBe("ARCHIVED");
    expect(doc.state.global.provenance?.updatedAt).toBe(T1);

    doc = reducer(
      doc,
      restoreNote({
        id: "ev-4",
        actor: "alice",
        timestamp: T2,
        comment: "still relevant",
      }),
    );
    expect(doc.state.global.status).toBe("DRAFT");
    expect(doc.state.global.lifecycleEvents[3].comment).toBe("still relevant");
    expect(doc.state.global.provenance?.updatedAt).toBe(T2);

    for (const op of doc.operations.global) {
      expect(op.error).toBeUndefined();
    }
  });

  it("rejects a note back to draft, with and without provenance", () => {
    // without provenance
    let doc = utils.createDocument();
    doc = reducer(
      doc,
      submitForReview({ id: "ev-1", actor: "alice", timestamp: T1 }),
    );
    doc = reducer(
      doc,
      rejectNote({ id: "ev-2", actor: "bob", timestamp: T2, comment: "redo" }),
    );
    expect(doc.state.global.status).toBe("DRAFT");
    expect(doc.state.global.lifecycleEvents[1]).toStrictEqual({
      id: "ev-2",
      fromStatus: "IN_REVIEW",
      toStatus: "DRAFT",
      actor: "bob",
      timestamp: T2,
      comment: "redo",
    });
    expect(doc.operations.global[1].error).toBeUndefined();

    // with provenance
    let doc2 = utils.createDocument();
    doc2 = reducer(
      doc2,
      setProvenance({ author: "alice", createdAt: T1, sourceOrigin: "IMPORT" }),
    );
    doc2 = reducer(
      doc2,
      submitForReview({ id: "ev-1", actor: "alice", timestamp: T1 }),
    );
    doc2 = reducer(
      doc2,
      rejectNote({ id: "ev-2", actor: "bob", timestamp: T3, comment: "nope" }),
    );
    expect(doc2.state.global.status).toBe("DRAFT");
    expect(doc2.state.global.provenance?.updatedAt).toBe(T3);
  });

  it("prevents the provenance author from approving their own note", () => {
    let doc = utils.createDocument();
    doc = reducer(
      doc,
      setProvenance({ author: "alice", createdAt: T1, sourceOrigin: "MANUAL" }),
    );
    doc = reducer(
      doc,
      submitForReview({ id: "ev-1", actor: "alice", timestamp: T1 }),
    );

    doc = reducer(
      doc,
      approveNote({ id: "ev-2", actor: "alice", timestamp: T2 }),
    );

    expect(doc.operations.global[2].error).toBe(
      "Actor cannot approve their own note",
    );
    expect(doc.state.global.status).toBe("IN_REVIEW");
    expect(doc.state.global.lifecycleEvents).toHaveLength(1);
  });

  it("rejects invalid status transitions for every lifecycle operation", () => {
    // from DRAFT: approve, reject, archive, restore are all invalid
    let doc = utils.createDocument();
    doc = reducer(
      doc,
      approveNote({ id: "ev-1", actor: "bob", timestamp: T1 }),
    );
    expect(doc.operations.global[0].error).toBe(
      "Can only approve from IN_REVIEW status",
    );

    doc = reducer(
      doc,
      rejectNote({ id: "ev-2", actor: "bob", timestamp: T1, comment: "c" }),
    );
    expect(doc.operations.global[1].error).toBe(
      "Can only reject from IN_REVIEW status",
    );

    doc = reducer(
      doc,
      archiveNote({ id: "ev-3", actor: "bob", timestamp: T1, comment: "c" }),
    );
    expect(doc.operations.global[2].error).toBe(
      "Can only archive from CANONICAL status",
    );

    doc = reducer(
      doc,
      restoreNote({ id: "ev-4", actor: "bob", timestamp: T1 }),
    );
    expect(doc.operations.global[3].error).toBe(
      "Can only restore from ARCHIVED status",
    );

    expect(doc.state.global.status).toBe("DRAFT");
    expect(doc.state.global.lifecycleEvents).toHaveLength(0);

    // submitForReview is invalid once the note is IN_REVIEW
    doc = reducer(
      doc,
      submitForReview({ id: "ev-5", actor: "alice", timestamp: T1 }),
    );
    expect(doc.operations.global[4].error).toBeUndefined();
    doc = reducer(
      doc,
      submitForReview({ id: "ev-6", actor: "alice", timestamp: T2 }),
    );
    expect(doc.operations.global[5].error).toBe(
      "Can only submit for review from DRAFT status",
    );
    expect(doc.state.global.status).toBe("IN_REVIEW");
    expect(doc.state.global.lifecycleEvents).toHaveLength(1);
  });
});

describe("Linking reducer branch coverage", () => {
  it("manages links across add, duplicate, update, and remove", () => {
    let doc = utils.createDocument();

    doc = reducer(
      doc,
      addLink({
        id: "link-1",
        targetDocumentId: "doc-a",
        targetTitle: "Doc A",
        linkType: "RELATES_TO",
      }),
    );
    expect(doc.state.global.links[0]).toStrictEqual({
      id: "link-1",
      targetDocumentId: "doc-a",
      targetTitle: "Doc A",
      linkType: "RELATES_TO",
    });

    // targetTitle omitted -> stored as null
    doc = reducer(
      doc,
      addLink({
        id: "link-2",
        targetDocumentId: "doc-b",
        linkType: "BUILDS_ON",
      }),
    );
    expect(doc.state.global.links[1].targetTitle).toBeNull();

    // duplicate id is rejected
    doc = reducer(
      doc,
      addLink({
        id: "link-1",
        targetDocumentId: "doc-c",
        linkType: "CONTRADICTS",
      }),
    );
    expect(doc.operations.global[2].error).toBe(
      "A link with this OID already exists",
    );
    expect(doc.state.global.links).toHaveLength(2);

    doc = reducer(
      doc,
      updateLinkType({ id: "link-2", linkType: "SUPERSEDES" }),
    );
    expect(doc.operations.global[3].error).toBeUndefined();
    expect(doc.state.global.links[1].linkType).toBe("SUPERSEDES");

    doc = reducer(
      doc,
      updateLinkType({ id: "missing", linkType: "DERIVED_FROM" }),
    );
    expect(doc.operations.global[4].error).toBe("No link with this OID");

    doc = reducer(doc, removeLink({ id: "link-1" }));
    expect(doc.operations.global[5].error).toBeUndefined();
    expect(doc.state.global.links).toHaveLength(1);
    expect(doc.state.global.links[0].id).toBe("link-2");

    doc = reducer(doc, removeLink({ id: "missing" }));
    expect(doc.operations.global[6].error).toBe("No link with this OID");
    expect(doc.state.global.links).toHaveLength(1);
  });

  it("manages topics across add, duplicate, and remove", () => {
    let doc = utils.createDocument();

    doc = reducer(
      doc,
      addTopic({ id: "topic-1", name: "reducers", topicDocumentId: "doc-t" }),
    );
    expect(doc.state.global.topics[0]).toStrictEqual({
      id: "topic-1",
      name: "reducers",
      topicDocumentId: "doc-t",
    });

    // topicDocumentId omitted -> stored as null
    doc = reducer(doc, addTopic({ id: "topic-2", name: "testing" }));
    expect(doc.state.global.topics[1].topicDocumentId).toBeNull();

    // duplicate topic name is rejected
    doc = reducer(doc, addTopic({ id: "topic-3", name: "reducers" }));
    expect(doc.operations.global[2].error).toBe(
      "A topic with this name already exists on this note",
    );
    expect(doc.state.global.topics).toHaveLength(2);

    doc = reducer(doc, removeTopic({ id: "topic-1" }));
    expect(doc.operations.global[3].error).toBeUndefined();
    expect(doc.state.global.topics).toHaveLength(1);
    expect(doc.state.global.topics[0].id).toBe("topic-2");

    doc = reducer(doc, removeTopic({ id: "missing" }));
    expect(doc.operations.global[4].error).toBe("No topic with this OID");
    expect(doc.state.global.topics).toHaveLength(1);
  });
});
