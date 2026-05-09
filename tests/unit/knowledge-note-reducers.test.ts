import { describe, it, expect } from "vitest";
import { reducer, utils, actions } from "document-models/knowledge-note/v1";

// ─── Content Module ──────────────────────────────────────────────────────────

describe("Content module — state mutations", () => {
  it("SET_TITLE — updates state.global.title", () => {
    const document = utils.createDocument();

    const updated = reducer(
      document,
      actions.setTitle({
        title: "My Note Title",
        updatedAt: "2026-01-01T00:00:00Z",
      }),
    );

    expect(updated.state.global.title).toBe("My Note Title");
  });

  it("SET_DESCRIPTION — updates state.global.description", () => {
    const document = utils.createDocument();

    const updated = reducer(
      document,
      actions.setDescription({
        description: "A short description",
        updatedAt: "2026-01-01T00:00:00Z",
      }),
    );

    expect(updated.state.global.description).toBe("A short description");
  });

  it("SET_DESCRIPTION with >200 chars — records error and leaves state unchanged", () => {
    const document = utils.createDocument();
    const longDescription = "x".repeat(201);

    const updated = reducer(
      document,
      actions.setDescription({
        description: longDescription,
        updatedAt: "2026-01-01T00:00:00Z",
      }),
    );

    expect(updated.operations.global[0].error).toBeTruthy();
    expect(updated.state.global.description).toBeNull();
  });

  it("SET_CONTENT — updates state.global.content", () => {
    const document = utils.createDocument();

    const updated = reducer(
      document,
      actions.setContent({
        content: "Hello world",
        updatedAt: "2026-01-01T00:00:00Z",
      }),
    );

    expect(updated.state.global.content).toBe("Hello world");
  });

  it("PATCH_CONTENT — splices content at the given offset", () => {
    const document = utils.createDocument();

    // First set some content
    const withContent = reducer(
      document,
      actions.setContent({
        content: "Hello world",
        updatedAt: "2026-01-01T00:00:00Z",
      }),
    );

    // Patch: replace " world" (offset 5, removeCount 6) with " there"
    const patched = reducer(
      withContent,
      actions.patchContent({
        offset: 5,
        removeCount: 6,
        insert: " there",
        updatedAt: "2026-01-02T00:00:00Z",
      }),
    );

    expect(patched.state.global.content).toBe("Hello there");
  });

  it("PATCH_CONTENT out-of-bounds — records error and leaves content unchanged", () => {
    const document = utils.createDocument();

    // Set content first (op index 0)
    const withContent = reducer(
      document,
      actions.setContent({
        content: "Hi",
        updatedAt: "2026-01-01T00:00:00Z",
      }),
    );

    // Patch beyond content length (op index 1)
    const patched = reducer(
      withContent,
      actions.patchContent({
        offset: 100,
        removeCount: 1,
        insert: "x",
        updatedAt: "2026-01-02T00:00:00Z",
      }),
    );

    expect(patched.operations.global[1].error).toBeTruthy();
    expect(patched.state.global.content).toBe("Hi");
  });

  it("SET_NOTE_TYPE — updates state.global.noteType", () => {
    const document = utils.createDocument();

    const updated = reducer(
      document,
      actions.setNoteType({
        noteType: "concept",
        updatedAt: "2026-01-01T00:00:00Z",
      }),
    );

    expect(updated.state.global.noteType).toBe("concept");
  });

  it("SET_METADATA_FIELD with valid field — updates state.global.confidence", () => {
    const document = utils.createDocument();

    const updated = reducer(
      document,
      actions.setMetadataField({
        field: "confidence",
        value: "high",
        updatedAt: "2026-01-01T00:00:00Z",
      }),
    );

    expect(updated.state.global.confidence).toBe("high");
  });

  it("SET_METADATA_FIELD with invalid field — records error and leaves state unchanged", () => {
    const document = utils.createDocument();

    const updated = reducer(
      document,
      actions.setMetadataField({
        field: "nonExistentField",
        value: "someValue",
        updatedAt: "2026-01-01T00:00:00Z",
      }),
    );

    expect(updated.operations.global[0].error).toBeTruthy();
    // confidence should remain at its initial null value
    expect(updated.state.global.confidence).toBeNull();
  });

  it("SET_TITLE with existing provenance — updates provenance.updatedAt", () => {
    const document = utils.createDocument();

    // Establish provenance first
    const withProvenance = reducer(
      document,
      actions.setProvenance({
        author: "Alice",
        sourceOrigin: "MANUAL",
        createdAt: "2026-01-01T00:00:00Z",
      }),
    );

    // Now update title — provenance.updatedAt should be bumped
    const updated = reducer(
      withProvenance,
      actions.setTitle({
        title: "Updated Title",
        updatedAt: "2026-02-01T00:00:00Z",
      }),
    );

    expect(updated.state.global.title).toBe("Updated Title");
    expect(updated.state.global.provenance?.updatedAt).toBe(
      "2026-02-01T00:00:00Z",
    );
  });
});

// ─── Linking Module ──────────────────────────────────────────────────────────

describe("Linking module — state mutations", () => {
  it("ADD_LINK — adds a link entry to state.global.links", () => {
    const document = utils.createDocument();

    const updated = reducer(
      document,
      actions.addLink({
        id: "link-001",
        targetDocumentId: "doc-abc",
        targetTitle: "Target Note",
        linkType: "RELATES_TO",
      }),
    );

    expect(updated.state.global.links).toHaveLength(1);
    expect(updated.state.global.links[0]).toMatchObject({
      id: "link-001",
      targetDocumentId: "doc-abc",
      targetTitle: "Target Note",
      linkType: "RELATES_TO",
    });
  });

  it("ADD_LINK with duplicate ID — records error and leaves links unchanged", () => {
    const document = utils.createDocument();

    const withLink = reducer(
      document,
      actions.addLink({
        id: "link-001",
        targetDocumentId: "doc-abc",
        linkType: "BUILDS_ON",
      }),
    );

    // Second ADD_LINK with same id (op index 1)
    const withDuplicate = reducer(
      withLink,
      actions.addLink({
        id: "link-001",
        targetDocumentId: "doc-xyz",
        linkType: "CONTRADICTS",
      }),
    );

    expect(withDuplicate.operations.global[1].error).toBeTruthy();
    expect(withDuplicate.state.global.links).toHaveLength(1);
  });

  it("REMOVE_LINK — removes the link from state.global.links", () => {
    const document = utils.createDocument();

    const withLink = reducer(
      document,
      actions.addLink({
        id: "link-001",
        targetDocumentId: "doc-abc",
        linkType: "RELATES_TO",
      }),
    );

    const withRemoval = reducer(
      withLink,
      actions.removeLink({ id: "link-001" }),
    );

    expect(withRemoval.state.global.links).toHaveLength(0);
  });

  it("REMOVE_LINK for nonexistent ID — records error", () => {
    const document = utils.createDocument();

    const updated = reducer(
      document,
      actions.removeLink({ id: "does-not-exist" }),
    );

    expect(updated.operations.global[0].error).toBeTruthy();
  });

  it("UPDATE_LINK_TYPE — changes the linkType of an existing link", () => {
    const document = utils.createDocument();

    const withLink = reducer(
      document,
      actions.addLink({
        id: "link-001",
        targetDocumentId: "doc-abc",
        linkType: "RELATES_TO",
      }),
    );

    const updated = reducer(
      withLink,
      actions.updateLinkType({ id: "link-001", linkType: "SUPERSEDES" }),
    );

    expect(updated.state.global.links[0].linkType).toBe("SUPERSEDES");
  });

  it("ADD_TOPIC — adds a topic entry to state.global.topics", () => {
    const document = utils.createDocument();

    const updated = reducer(
      document,
      actions.addTopic({
        id: "topic-001",
        name: "TypeScript",
        topicDocumentId: "topic-doc-1",
      }),
    );

    expect(updated.state.global.topics).toHaveLength(1);
    expect(updated.state.global.topics[0]).toMatchObject({
      id: "topic-001",
      name: "TypeScript",
      topicDocumentId: "topic-doc-1",
    });
  });

  it("ADD_TOPIC with duplicate name — records error and leaves topics unchanged", () => {
    const document = utils.createDocument();

    const withTopic = reducer(
      document,
      actions.addTopic({ id: "topic-001", name: "TypeScript" }),
    );

    // Second ADD_TOPIC with same name (op index 1)
    const withDuplicate = reducer(
      withTopic,
      actions.addTopic({ id: "topic-002", name: "TypeScript" }),
    );

    expect(withDuplicate.operations.global[1].error).toBeTruthy();
    expect(withDuplicate.state.global.topics).toHaveLength(1);
  });
});

// ─── Provenance Module ───────────────────────────────────────────────────────

describe("Provenance module — state mutations", () => {
  it("SET_PROVENANCE — populates all provenance fields", () => {
    const document = utils.createDocument();

    const updated = reducer(
      document,
      actions.setProvenance({
        author: "Alice",
        sourceOrigin: "SESSION_MINE",
        sessionId: "session-xyz",
        createdAt: "2026-01-01T00:00:00Z",
      }),
    );

    const provenance = updated.state.global.provenance;
    expect(provenance).not.toBeNull();
    expect(provenance?.author).toBe("Alice");
    expect(provenance?.sourceOrigin).toBe("SESSION_MINE");
    expect(provenance?.sessionId).toBe("session-xyz");
    expect(provenance?.createdAt).toBe("2026-01-01T00:00:00Z");
    // updatedAt is initialised to createdAt by the reducer
    expect(provenance?.updatedAt).toBe("2026-01-01T00:00:00Z");
  });
});
