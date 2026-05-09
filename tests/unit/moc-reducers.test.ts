import { describe, it, expect } from "vitest";
import { reducer, utils, actions } from "document-models/moc/v1";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Create a fresh MOC document with CREATE_MOC already applied. */
function makeInitialisedMoc() {
  const doc = utils.createDocument();
  return reducer(
    doc,
    actions.createMoc({
      title: "Test MOC",
      description: "Test description",
      orientation: "Test orientation",
      tier: "TOPIC",
      createdAt: "2026-01-01T00:00:00Z",
    }),
  );
}

/** Create a MOC document with one core idea already added. */
function makeDocWithCoreIdea(ideaId = "idea-001", noteRef = "note://abc") {
  const moc = makeInitialisedMoc();
  return reducer(
    moc,
    actions.addCoreIdea({
      id: ideaId,
      noteRef,
      contextPhrase: "A central concept",
      sortOrder: 0,
      addedAt: "2026-01-02T00:00:00Z",
    }),
  );
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe("MOC — CREATE_MOC", () => {
  it("initialises title, description, orientation, tier, createdAt and noteCount = 0", () => {
    const doc = utils.createDocument();

    const moc = reducer(
      doc,
      actions.createMoc({
        title: "My Hub",
        description: "Hub description",
        orientation: "North-South",
        tier: "HUB",
        createdAt: "2026-01-01T00:00:00Z",
      }),
    );

    const g = moc.state.global;
    expect(g.title).toBe("My Hub");
    expect(g.description).toBe("Hub description");
    expect(g.orientation).toBe("North-South");
    expect(g.tier).toBe("HUB");
    expect(g.createdAt).toBe("2026-01-01T00:00:00Z");
    expect(g.noteCount).toBe(0);
  });

  it("stores an optional parentRef when provided", () => {
    const doc = utils.createDocument();
    const moc = reducer(
      doc,
      actions.createMoc({
        title: "Child MOC",
        description: "D",
        orientation: "O",
        tier: "TOPIC",
        createdAt: "2026-01-01T00:00:00Z",
        parentRef: "moc://parent-hub",
      }),
    );
    expect(moc.state.global.parentRef).toBe("moc://parent-hub");
  });
});

// ─── ADD_CORE_IDEA ────────────────────────────────────────────────────────────

describe("MOC — ADD_CORE_IDEA", () => {
  it("increments noteCount and appends to coreIdeas", () => {
    const moc = makeInitialisedMoc();

    const updated = reducer(
      moc,
      actions.addCoreIdea({
        id: "idea-001",
        noteRef: "note://abc",
        contextPhrase: "Core concept",
        sortOrder: 0,
        addedAt: "2026-01-02T00:00:00Z",
      }),
    );

    expect(updated.state.global.noteCount).toBe(1);
    expect(updated.state.global.coreIdeas).toHaveLength(1);
    expect(updated.state.global.coreIdeas[0]).toMatchObject({
      id: "idea-001",
      noteRef: "note://abc",
      contextPhrase: "Core concept",
      sortOrder: 0,
      addedAt: "2026-01-02T00:00:00Z",
    });
  });

  it("adding a second idea increments noteCount to 2", () => {
    const withOne = makeDocWithCoreIdea();

    const updated = reducer(
      withOne,
      actions.addCoreIdea({
        id: "idea-002",
        noteRef: "note://def",
        contextPhrase: "Another concept",
        sortOrder: 1,
        addedAt: "2026-01-03T00:00:00Z",
      }),
    );

    expect(updated.state.global.noteCount).toBe(2);
    expect(updated.state.global.coreIdeas).toHaveLength(2);
  });

  it("duplicate noteRef — records error and leaves state unchanged", () => {
    const withOne = makeDocWithCoreIdea("idea-001", "note://abc");

    // Second ADD_CORE_IDEA for the same noteRef (op index 2 — CREATE_MOC is 0, ADD_CORE_IDEA is 1)
    const withDuplicate = reducer(
      withOne,
      actions.addCoreIdea({
        id: "idea-002",
        noteRef: "note://abc", // same noteRef
        contextPhrase: "Duplicate",
        sortOrder: 1,
        addedAt: "2026-01-03T00:00:00Z",
      }),
    );

    expect(withDuplicate.operations.global[2].error).toBeTruthy();
    expect(withDuplicate.state.global.coreIdeas).toHaveLength(1);
    expect(withDuplicate.state.global.noteCount).toBe(1);
  });
});

// ─── REMOVE_CORE_IDEA ─────────────────────────────────────────────────────────

describe("MOC — REMOVE_CORE_IDEA", () => {
  it("decrements noteCount and removes the idea from the array", () => {
    const withOne = makeDocWithCoreIdea("idea-001");

    const updated = reducer(
      withOne,
      actions.removeCoreIdea({ id: "idea-001" }),
    );

    expect(updated.state.global.noteCount).toBe(0);
    expect(updated.state.global.coreIdeas).toHaveLength(0);
  });

  it("nonexistent ID — records error and leaves state unchanged", () => {
    const moc = makeInitialisedMoc();

    // First op is CREATE_MOC (index 0), REMOVE_CORE_IDEA is index 1
    const updated = reducer(
      moc,
      actions.removeCoreIdea({ id: "does-not-exist" }),
    );

    expect(updated.operations.global[1].error).toBeTruthy();
    expect(updated.state.global.coreIdeas).toHaveLength(0);
    expect(updated.state.global.noteCount).toBe(0);
  });
});

// ─── ADD_OPEN_QUESTION ────────────────────────────────────────────────────────

describe("MOC — ADD_OPEN_QUESTION", () => {
  it("appends question to openQuestions array", () => {
    const moc = makeInitialisedMoc();

    const updated = reducer(
      moc,
      actions.addOpenQuestion({ question: "What is the core tension here?" }),
    );

    expect(updated.state.global.openQuestions).toContain(
      "What is the core tension here?",
    );
    expect(updated.state.global.openQuestions).toHaveLength(1);
  });

  it("multiple questions accumulate in order", () => {
    const moc = makeInitialisedMoc();

    const withFirst = reducer(
      moc,
      actions.addOpenQuestion({ question: "Question one?" }),
    );
    const withSecond = reducer(
      withFirst,
      actions.addOpenQuestion({ question: "Question two?" }),
    );

    expect(withSecond.state.global.openQuestions).toEqual([
      "Question one?",
      "Question two?",
    ]);
  });
});

// ─── REMOVE_OPEN_QUESTION ─────────────────────────────────────────────────────

describe("MOC — REMOVE_OPEN_QUESTION", () => {
  it("removes the matching question from openQuestions", () => {
    const moc = makeInitialisedMoc();

    const withQ = reducer(
      moc,
      actions.addOpenQuestion({ question: "To remove?" }),
    );
    const removed = reducer(
      withQ,
      actions.removeOpenQuestion({ question: "To remove?" }),
    );

    expect(removed.state.global.openQuestions).toHaveLength(0);
  });

  it("removing a non-existent question leaves the array unchanged", () => {
    const moc = makeInitialisedMoc();
    const withQ = reducer(
      moc,
      actions.addOpenQuestion({ question: "Stays here" }),
    );

    const unchanged = reducer(
      withQ,
      actions.removeOpenQuestion({ question: "Not present" }),
    );

    expect(unchanged.state.global.openQuestions).toEqual(["Stays here"]);
  });
});

// ─── ADD_CHILD_MOC ────────────────────────────────────────────────────────────

describe("MOC — ADD_CHILD_MOC", () => {
  it("adds childRef to childRefs array", () => {
    const moc = makeInitialisedMoc();

    const updated = reducer(
      moc,
      actions.addChildMoc({ childRef: "moc://child-topic-1" }),
    );

    expect(updated.state.global.childRefs).toContain("moc://child-topic-1");
    expect(updated.state.global.childRefs).toHaveLength(1);
  });

  it("duplicate childRef — records error and leaves childRefs unchanged", () => {
    const moc = makeInitialisedMoc();

    const withChild = reducer(
      moc,
      actions.addChildMoc({ childRef: "moc://child-topic-1" }),
    );

    // Second ADD_CHILD_MOC with same ref (op index 2)
    const withDuplicate = reducer(
      withChild,
      actions.addChildMoc({ childRef: "moc://child-topic-1" }),
    );

    expect(withDuplicate.operations.global[2].error).toBeTruthy();
    expect(withDuplicate.state.global.childRefs).toHaveLength(1);
  });
});

// ─── UPDATE_ORIENTATION ───────────────────────────────────────────────────────

describe("MOC — UPDATE_ORIENTATION", () => {
  it("changes orientation field", () => {
    const moc = makeInitialisedMoc();

    const updated = reducer(
      moc,
      actions.updateOrientation({
        orientation: "East-West",
        updatedAt: "2026-02-01T00:00:00Z",
      }),
    );

    expect(updated.state.global.orientation).toBe("East-West");
    expect(updated.state.global.updatedAt).toBe("2026-02-01T00:00:00Z");
  });
});

// ─── UPDATE_DESCRIPTION ───────────────────────────────────────────────────────

describe("MOC — UPDATE_DESCRIPTION", () => {
  it("changes description field", () => {
    const moc = makeInitialisedMoc();

    const updated = reducer(
      moc,
      actions.updateDescription({
        description: "New and improved description",
        updatedAt: "2026-02-01T00:00:00Z",
      }),
    );

    expect(updated.state.global.description).toBe(
      "New and improved description",
    );
    expect(updated.state.global.updatedAt).toBe("2026-02-01T00:00:00Z");
  });
});
