import { generateMock } from "document-model";
import {
  addChildMoc,
  AddChildMocInputSchema,
  addCoreIdea,
  AddCoreIdeaInputSchema,
  addOpenQuestion,
  AddOpenQuestionInputSchema,
  addTension,
  AddTensionInputSchema,
  createMoc,
  CreateMocInputSchema,
  isMocDocument,
  reducer,
  removeChildMoc,
  RemoveChildMocInputSchema,
  removeCoreIdea,
  RemoveCoreIdeaInputSchema,
  removeOpenQuestion,
  RemoveOpenQuestionInputSchema,
  removeTension,
  RemoveTensionInputSchema,
  reorderCoreIdeas,
  ReorderCoreIdeasInputSchema,
  setMetadataField,
  SetMetadataFieldInputSchema,
  updateCoreIdea,
  UpdateCoreIdeaInputSchema,
  updateDescription,
  UpdateDescriptionInputSchema,
  updateOrientation,
  UpdateOrientationInputSchema,
  utils,
} from "document-models/moc/v1";
import { describe, expect, it } from "vitest";

describe("MocManagementOperations", () => {
  it("should handle createMoc operation", () => {
    const document = utils.createDocument();
    const input = generateMock(CreateMocInputSchema());

    const updatedDocument = reducer(document, createMoc(input));

    expect(isMocDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe("CREATE_MOC");
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle updateOrientation operation", () => {
    const document = utils.createDocument();
    const input = generateMock(UpdateOrientationInputSchema());

    const updatedDocument = reducer(document, updateOrientation(input));

    expect(isMocDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "UPDATE_ORIENTATION",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle updateDescription operation", () => {
    const document = utils.createDocument();
    const input = generateMock(UpdateDescriptionInputSchema());

    const updatedDocument = reducer(document, updateDescription(input));

    expect(isMocDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "UPDATE_DESCRIPTION",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle addCoreIdea operation", () => {
    const document = utils.createDocument();
    const input = generateMock(AddCoreIdeaInputSchema());

    const updatedDocument = reducer(document, addCoreIdea(input));

    expect(isMocDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "ADD_CORE_IDEA",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle updateCoreIdea operation", () => {
    const document = utils.createDocument();
    const input = generateMock(UpdateCoreIdeaInputSchema());

    const updatedDocument = reducer(document, updateCoreIdea(input));

    expect(isMocDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "UPDATE_CORE_IDEA",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle removeCoreIdea operation", () => {
    const document = utils.createDocument();
    const input = generateMock(RemoveCoreIdeaInputSchema());

    const updatedDocument = reducer(document, removeCoreIdea(input));

    expect(isMocDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "REMOVE_CORE_IDEA",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle reorderCoreIdeas operation", () => {
    const document = utils.createDocument();
    const input = generateMock(ReorderCoreIdeasInputSchema());

    const updatedDocument = reducer(document, reorderCoreIdeas(input));

    expect(isMocDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "REORDER_CORE_IDEAS",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle addTension operation", () => {
    const document = utils.createDocument();
    const input = generateMock(AddTensionInputSchema());

    const updatedDocument = reducer(document, addTension(input));

    expect(isMocDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "ADD_TENSION",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle removeTension operation", () => {
    const document = utils.createDocument();
    const input = generateMock(RemoveTensionInputSchema());

    const updatedDocument = reducer(document, removeTension(input));

    expect(isMocDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "REMOVE_TENSION",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle addOpenQuestion operation", () => {
    const document = utils.createDocument();
    const input = generateMock(AddOpenQuestionInputSchema());

    const updatedDocument = reducer(document, addOpenQuestion(input));

    expect(isMocDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "ADD_OPEN_QUESTION",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle removeOpenQuestion operation", () => {
    const document = utils.createDocument();
    const input = generateMock(RemoveOpenQuestionInputSchema());

    const updatedDocument = reducer(document, removeOpenQuestion(input));

    expect(isMocDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "REMOVE_OPEN_QUESTION",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle addChildMoc operation", () => {
    const document = utils.createDocument();
    const input = generateMock(AddChildMocInputSchema());

    const updatedDocument = reducer(document, addChildMoc(input));

    expect(isMocDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "ADD_CHILD_MOC",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle removeChildMoc operation", () => {
    const document = utils.createDocument();
    const input = generateMock(RemoveChildMocInputSchema());

    const updatedDocument = reducer(document, removeChildMoc(input));

    expect(isMocDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "REMOVE_CHILD_MOC",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle setMetadataField operation", () => {
    const document = utils.createDocument();
    const input = generateMock(SetMetadataFieldInputSchema(), {
      updatedAt: "2024-01-01T00:00:00.000Z",
    });

    const updatedDocument = reducer(document, setMetadataField(input));

    expect(isMocDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "SET_METADATA_FIELD",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });
});

describe("MocManagementOperations scenarios", () => {
  const ts = "2026-08-07T00:00:00.000Z";
  const laterTs = "2026-08-07T01:00:00.000Z";

  it("should create a MOC without parentRef and default it to null", () => {
    const document = utils.createDocument();

    const updatedDocument = reducer(
      document,
      createMoc({
        title: "Knowledge Systems",
        description: "Top-level map",
        orientation: "Start here",
        tier: "DOMAIN",
        createdAt: ts,
      }),
    );

    expect(updatedDocument.state.global.title).toBe("Knowledge Systems");
    expect(updatedDocument.state.global.description).toBe("Top-level map");
    expect(updatedDocument.state.global.orientation).toBe("Start here");
    expect(updatedDocument.state.global.tier).toBe("DOMAIN");
    expect(updatedDocument.state.global.parentRef).toBe(null);
    expect(updatedDocument.state.global.createdAt).toBe(ts);
    expect(updatedDocument.state.global.updatedAt).toBe(ts);
  });

  it("should create a MOC with a parentRef and update orientation and description", () => {
    let document = utils.createDocument();

    document = reducer(
      document,
      createMoc({
        title: "Sub Topic",
        description: "Child map",
        orientation: "Narrow scope",
        tier: "TOPIC",
        parentRef: "parent-moc",
        createdAt: ts,
      }),
    );
    expect(document.state.global.parentRef).toBe("parent-moc");

    document = reducer(
      document,
      updateOrientation({ orientation: "Wider scope", updatedAt: laterTs }),
    );
    expect(document.state.global.orientation).toBe("Wider scope");
    expect(document.state.global.updatedAt).toBe(laterTs);

    document = reducer(
      document,
      updateDescription({ description: "Refined child map", updatedAt: ts }),
    );
    expect(document.state.global.description).toBe("Refined child map");
    expect(document.state.global.updatedAt).toBe(ts);
  });

  it("should manage core ideas across add, duplicate, update and remove", () => {
    let document = utils.createDocument();

    // op 0: add with addedBy
    document = reducer(
      document,
      addCoreIdea({
        id: "idea-1",
        noteRef: "note-1",
        contextPhrase: "why granularity matters",
        sortOrder: 0,
        addedAt: ts,
        addedBy: "agent",
      }),
    );
    expect(document.state.global.coreIdeas).toHaveLength(1);
    expect(document.state.global.coreIdeas[0].addedBy).toBe("agent");
    expect(document.state.global.noteCount).toBe(1);

    // op 1: add without addedBy -> defaults to null, noteCount increments
    document = reducer(
      document,
      addCoreIdea({
        id: "idea-2",
        noteRef: "note-2",
        contextPhrase: "linking density",
        sortOrder: 1,
        addedAt: ts,
      }),
    );
    expect(document.state.global.coreIdeas[1].addedBy).toBe(null);
    expect(document.state.global.noteCount).toBe(2);

    // op 2: duplicate noteRef -> error recorded, state unchanged
    document = reducer(
      document,
      addCoreIdea({
        id: "idea-3",
        noteRef: "note-1",
        contextPhrase: "duplicate",
        sortOrder: 2,
        addedAt: ts,
      }),
    );
    expect(document.operations.global[2].error).toBe(
      "This note is already in Core Ideas",
    );
    expect(document.state.global.coreIdeas).toHaveLength(2);
    expect(document.state.global.noteCount).toBe(2);

    // op 3: update contextPhrase only
    document = reducer(
      document,
      updateCoreIdea({ id: "idea-1", contextPhrase: "updated phrase" }),
    );
    expect(document.state.global.coreIdeas[0].contextPhrase).toBe(
      "updated phrase",
    );
    expect(document.state.global.coreIdeas[0].sortOrder).toBe(0);

    // op 4: sortOrder 0 is falsy-but-valid and applied, empty contextPhrase ignored
    document = reducer(
      document,
      updateCoreIdea({ id: "idea-2", contextPhrase: "", sortOrder: 0 }),
    );
    expect(document.state.global.coreIdeas[1].contextPhrase).toBe(
      "linking density",
    );
    expect(document.state.global.coreIdeas[1].sortOrder).toBe(0);

    // op 5: explicit null sortOrder and no contextPhrase -> nothing changes
    document = reducer(
      document,
      updateCoreIdea({ id: "idea-1", sortOrder: null }),
    );
    expect(document.state.global.coreIdeas[0].contextPhrase).toBe(
      "updated phrase",
    );
    expect(document.state.global.coreIdeas[0].sortOrder).toBe(0);

    // op 6: update a missing idea -> error recorded, state unchanged
    document = reducer(
      document,
      updateCoreIdea({ id: "missing", contextPhrase: "nope" }),
    );
    expect(document.operations.global[6].error).toBe("Core idea not found");

    // op 7: remove an existing idea decrements noteCount
    document = reducer(document, removeCoreIdea({ id: "idea-2" }));
    expect(document.state.global.coreIdeas).toHaveLength(1);
    expect(document.state.global.noteCount).toBe(1);

    // op 8: remove the same idea again -> error recorded, state unchanged
    document = reducer(document, removeCoreIdea({ id: "idea-2" }));
    expect(document.operations.global[8].error).toBe("Core idea not found");
    expect(document.state.global.coreIdeas).toHaveLength(1);
    expect(document.state.global.noteCount).toBe(1);

    // op 9: remove the last idea -> noteCount floors at 0
    document = reducer(document, removeCoreIdea({ id: "idea-1" }));
    expect(document.state.global.coreIdeas).toHaveLength(0);
    expect(document.state.global.noteCount).toBe(0);
  });

  it("should floor noteCount at 0 when removing a core idea while noteCount is null", () => {
    const document = utils.createDocument({
      global: {
        ...utils.createDocument().state.global,
        coreIdeas: [
          {
            id: "idea-1",
            noteRef: "note-1",
            contextPhrase: "phrase",
            sortOrder: 0,
            addedAt: null,
            addedBy: null,
          },
        ],
        noteCount: null,
      },
    });

    const updatedDocument = reducer(document, removeCoreIdea({ id: "idea-1" }));

    expect(updatedDocument.state.global.coreIdeas).toHaveLength(0);
    expect(updatedDocument.state.global.noteCount).toBe(0);
  });

  it("should treat a null noteCount as 0 when adding a core idea", () => {
    const document = utils.createDocument({
      global: { ...utils.createDocument().state.global, noteCount: null },
    });

    const updatedDocument = reducer(
      document,
      addCoreIdea({
        id: "idea-1",
        noteRef: "note-1",
        contextPhrase: "phrase",
        sortOrder: 0,
        addedAt: ts,
      }),
    );

    expect(updatedDocument.state.global.noteCount).toBe(1);
  });

  it("should reorder core ideas and drop ids that do not match", () => {
    let document = utils.createDocument();
    document = reducer(
      document,
      addCoreIdea({
        id: "a",
        noteRef: "note-a",
        contextPhrase: "a",
        sortOrder: 0,
        addedAt: ts,
      }),
    );
    document = reducer(
      document,
      addCoreIdea({
        id: "b",
        noteRef: "note-b",
        contextPhrase: "b",
        sortOrder: 1,
        addedAt: ts,
      }),
    );

    // reorder with an unknown id in the middle: known ideas keep their new
    // positions as sortOrder, the unknown id is dropped from the result
    document = reducer(
      document,
      reorderCoreIdeas({ ids: ["b", "ghost", "a"] }),
    );

    expect(document.state.global.coreIdeas.map((c) => c.id)).toStrictEqual([
      "b",
      "a",
    ]);
    expect(document.state.global.coreIdeas[0].sortOrder).toBe(0);
    expect(document.state.global.coreIdeas[1].sortOrder).toBe(2);
  });

  it("should add and remove tensions and record an error for a missing tension", () => {
    let document = utils.createDocument();

    // op 0: add a tension
    document = reducer(
      document,
      addTension({
        id: "tension-1",
        description: "atomicity vs context",
        involvedRefs: ["note-1", "note-2"],
        addedAt: ts,
      }),
    );
    expect(document.state.global.tensions).toStrictEqual([
      {
        id: "tension-1",
        description: "atomicity vs context",
        involvedRefs: ["note-1", "note-2"],
        addedAt: ts,
      },
    ]);

    // op 1: remove a missing tension -> error recorded, state unchanged
    document = reducer(document, removeTension({ id: "missing" }));
    expect(document.operations.global[1].error).toBe("Tension not found");
    expect(document.state.global.tensions).toHaveLength(1);

    // op 2: remove the existing tension
    document = reducer(document, removeTension({ id: "tension-1" }));
    expect(document.state.global.tensions).toHaveLength(0);
  });

  it("should add and remove open questions", () => {
    let document = utils.createDocument();

    document = reducer(
      document,
      addOpenQuestion({ question: "What is the right granularity?" }),
    );
    document = reducer(
      document,
      addOpenQuestion({ question: "How dense should links be?" }),
    );
    expect(document.state.global.openQuestions).toHaveLength(2);

    // removing a question that does not exist leaves the list unchanged
    document = reducer(
      document,
      removeOpenQuestion({ question: "Not a question" }),
    );
    expect(document.state.global.openQuestions).toHaveLength(2);

    document = reducer(
      document,
      removeOpenQuestion({ question: "What is the right granularity?" }),
    );
    expect(document.state.global.openQuestions).toStrictEqual([
      "How dense should links be?",
    ]);
  });

  it("should add and remove child MOCs and reject duplicates", () => {
    let document = utils.createDocument();

    // op 0: add a child MOC
    document = reducer(document, addChildMoc({ childRef: "child-1" }));
    expect(document.state.global.childRefs).toStrictEqual(["child-1"]);

    // op 1: adding the same child again -> error recorded, state unchanged
    document = reducer(document, addChildMoc({ childRef: "child-1" }));
    expect(document.operations.global[1].error).toBe(
      "This child MOC is already linked",
    );
    expect(document.state.global.childRefs).toStrictEqual(["child-1"]);

    // op 2: removing a missing child leaves the list unchanged
    document = reducer(document, removeChildMoc({ childRef: "missing" }));
    expect(document.state.global.childRefs).toStrictEqual(["child-1"]);

    // op 3: remove the existing child
    document = reducer(document, removeChildMoc({ childRef: "child-1" }));
    expect(document.state.global.childRefs).toStrictEqual([]);
  });

  it("should set, clear and reject metadata fields", () => {
    let document = utils.createDocument();
    const ts = "2026-08-13T12:00:00.000Z";

    expect(document.state.global.version).toBeNull();

    // op 0: set the whitelisted `version` field
    document = reducer(
      document,
      setMetadataField({
        field: "version",
        value: "v6.2.2-dev.45",
        updatedAt: ts,
      }),
    );
    expect(document.state.global.version).toBe("v6.2.2-dev.45");
    expect(document.state.global.updatedAt).toBe(ts);

    // op 1: an unknown field is rejected and leaves state untouched
    document = reducer(
      document,
      setMetadataField({ field: "confidence", value: "high", updatedAt: ts }),
    );
    expect(document.operations.global[1].error).toBe(
      '"confidence" is not a recognized string metadata field',
    );
    expect(document.state.global.version).toBe("v6.2.2-dev.45");

    // op 2: a null value clears the field rather than storing null-ish text
    const later = "2026-08-13T13:00:00.000Z";
    document = reducer(
      document,
      setMetadataField({ field: "version", value: null, updatedAt: later }),
    );
    expect(document.state.global.version).toBeNull();
    expect(document.state.global.updatedAt).toBe(later);

    // op 3: an empty string is treated the same as absent
    document = reducer(
      document,
      setMetadataField({ field: "version", value: "", updatedAt: later }),
    );
    expect(document.state.global.version).toBeNull();
  });
});
