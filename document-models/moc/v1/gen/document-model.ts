import type { DocumentModelGlobalState } from "document-model";

export const documentModel: DocumentModelGlobalState = {
  author: {
    name: "BAI",
    website: "https://bai.powerhouse.io/",
  },
  description:
    "Map of Content \u2014 navigation and synthesis document organizing knowledge notes by topic. Hub \u2192 domain \u2192 topic hierarchy with core ideas, tensions, and traversal hints",
  extension: "",
  id: "bai/moc",
  name: "Moc",
  specifications: [
    {
      changeLog: [],
      modules: [
        {
          description: "MOC lifecycle and content operations",
          id: "moc-management",
          name: "moc-management",
          operations: [
            {
              description: "Initialize a new Map of Content",
              errors: [],
              examples: [],
              id: "create-moc",
              name: "CREATE_MOC",
              reducer:
                "state.title = action.input.title;\nstate.description = action.input.description;\nstate.orientation = action.input.orientation;\nstate.tier = action.input.tier;\nstate.parentRef = action.input.parentRef || null;\nstate.createdAt = action.input.createdAt;\nstate.updatedAt = action.input.createdAt;",
              schema:
                "input CreateMocInput {\n    title: String!\n    description: String!\n    orientation: String!\n    tier: MocTier!\n    parentRef: String\n    createdAt: DateTime!\n}",
              template: "Initialize a new Map of Content",
              scope: "global",
            },
            {
              description: "Update the synthesis paragraph",
              errors: [],
              examples: [],
              id: "update-orientation",
              name: "UPDATE_ORIENTATION",
              reducer:
                "state.orientation = action.input.orientation;\nstate.updatedAt = action.input.updatedAt;",
              schema:
                "input UpdateOrientationInput {\n    orientation: String!\n    updatedAt: DateTime!\n}",
              template: "Update the synthesis paragraph",
              scope: "global",
            },
            {
              description: "Update the progressive disclosure summary",
              errors: [],
              examples: [],
              id: "update-description",
              name: "UPDATE_DESCRIPTION",
              reducer:
                "state.description = action.input.description;\nstate.updatedAt = action.input.updatedAt;",
              schema:
                "input UpdateDescriptionInput {\n    description: String!\n    updatedAt: DateTime!\n}",
              template: "Update the progressive disclosure summary",
              scope: "global",
            },
            {
              description: "Add a note to Core Ideas with context phrase",
              errors: [
                {
                  code: "DUPLICATE_CORE_IDEA",
                  description: "This note is already in Core Ideas",
                  id: "err-duplicate-core-idea",
                  name: "DuplicateCoreIdeaError",
                  template: "",
                },
              ],
              examples: [],
              id: "add-core-idea",
              name: "ADD_CORE_IDEA",
              reducer:
                'const existing = state.coreIdeas.find(c => c.noteRef === action.input.noteRef);\nif (existing) {\n    throw new DuplicateCoreIdeaError("This note is already in Core Ideas");\n}\nstate.coreIdeas.push({\n    id: action.input.id,\n    noteRef: action.input.noteRef,\n    contextPhrase: action.input.contextPhrase,\n    sortOrder: action.input.sortOrder,\n    addedAt: action.input.addedAt,\n    addedBy: action.input.addedBy || null,\n});\nstate.noteCount = (state.noteCount || 0) + 1;',
              schema:
                "input AddCoreIdeaInput {\n    id: OID!\n    noteRef: String!\n    contextPhrase: String!\n    sortOrder: Int!\n    addedAt: DateTime!\n    addedBy: String\n}",
              template: "Add a note to Core Ideas with context phrase",
              scope: "global",
            },
            {
              description: "Update a core idea's context phrase or order",
              errors: [
                {
                  code: "CORE_IDEA_NOT_FOUND",
                  description: "Core idea not found",
                  id: "err-core-idea-not-found-update",
                  name: "CoreIdeaNotFoundError",
                  template: "",
                },
              ],
              examples: [],
              id: "update-core-idea",
              name: "UPDATE_CORE_IDEA",
              reducer:
                'const idea = state.coreIdeas.find(c => c.id === action.input.id);\nif (!idea) {\n    throw new CoreIdeaNotFoundError("Core idea not found");\n}\nif (action.input.contextPhrase) idea.contextPhrase = action.input.contextPhrase;\nif (action.input.sortOrder !== undefined && action.input.sortOrder !== null) idea.sortOrder = action.input.sortOrder;',
              schema:
                "input UpdateCoreIdeaInput {\n    id: OID!\n    contextPhrase: String\n    sortOrder: Int\n}",
              template: "Update a core idea's context phrase or order",
              scope: "global",
            },
            {
              description: "Remove a note from Core Ideas",
              errors: [
                {
                  code: "CORE_IDEA_NOT_FOUND",
                  description: "Core idea not found",
                  id: "err-core-idea-not-found-remove",
                  name: "CoreIdeaNotFoundError",
                  template: "",
                },
              ],
              examples: [],
              id: "remove-core-idea",
              name: "REMOVE_CORE_IDEA",
              reducer:
                'const index = state.coreIdeas.findIndex(c => c.id === action.input.id);\nif (index === -1) {\n    throw new CoreIdeaNotFoundError("Core idea not found");\n}\nstate.coreIdeas.splice(index, 1);\nstate.noteCount = Math.max(0, (state.noteCount || 0) - 1);',
              schema: "input RemoveCoreIdeaInput {\n    id: OID!\n}",
              template: "Remove a note from Core Ideas",
              scope: "global",
            },
            {
              description: "Reorder core ideas by providing ordered IDs",
              errors: [],
              examples: [],
              id: "reorder-core-ideas",
              name: "REORDER_CORE_IDEAS",
              reducer:
                "const reordered = action.input.ids.map((id, i) => {\n    const idea = state.coreIdeas.find(c => c.id === id);\n    if (idea) idea.sortOrder = i;\n    return idea;\n}).filter(Boolean);\nstate.coreIdeas = reordered;",
              schema: "input ReorderCoreIdeasInput {\n    ids: [OID!]!\n}",
              template: "Reorder core ideas by providing ordered IDs",
              scope: "global",
            },
            {
              description: "Add an unresolved tension",
              errors: [],
              examples: [],
              id: "add-tension",
              name: "ADD_TENSION",
              reducer:
                "state.tensions.push({\n    id: action.input.id,\n    description: action.input.description,\n    involvedRefs: action.input.involvedRefs,\n    addedAt: action.input.addedAt,\n});",
              schema:
                "input AddTensionInput {\n    id: OID!\n    description: String!\n    involvedRefs: [String!]!\n    addedAt: DateTime!\n}",
              template: "Add an unresolved tension",
              scope: "global",
            },
            {
              description: "Remove a resolved or dissolved tension",
              errors: [
                {
                  code: "TENSION_NOT_FOUND",
                  description: "Tension not found",
                  id: "err-tension-not-found",
                  name: "TensionNotFoundError",
                  template: "",
                },
              ],
              examples: [],
              id: "remove-tension",
              name: "REMOVE_TENSION",
              reducer:
                'const index = state.tensions.findIndex(t => t.id === action.input.id);\nif (index === -1) {\n    throw new TensionNotFoundError("Tension not found");\n}\nstate.tensions.splice(index, 1);',
              schema: "input RemoveTensionInput {\n    id: OID!\n}",
              template: "Remove a resolved or dissolved tension",
              scope: "global",
            },
            {
              description: "Add an unexplored direction",
              errors: [],
              examples: [],
              id: "add-open-question",
              name: "ADD_OPEN_QUESTION",
              reducer: "state.openQuestions.push(action.input.question);",
              schema: "input AddOpenQuestionInput {\n    question: String!\n}",
              template: "Add an unexplored direction",
              scope: "global",
            },
            {
              description: "Remove an open question",
              errors: [],
              examples: [],
              id: "remove-open-question",
              name: "REMOVE_OPEN_QUESTION",
              reducer:
                "state.openQuestions = state.openQuestions.filter(q => q !== action.input.question);",
              schema:
                "input RemoveOpenQuestionInput {\n    question: String!\n}",
              template: "Remove an open question",
              scope: "global",
            },
            {
              description: "Add a child MOC reference",
              errors: [
                {
                  code: "DUPLICATE_CHILD_MOC",
                  description: "This child MOC is already linked",
                  id: "err-duplicate-child-moc",
                  name: "DuplicateChildMocError",
                  template: "",
                },
              ],
              examples: [],
              id: "add-child-moc",
              name: "ADD_CHILD_MOC",
              reducer:
                'if (state.childRefs.includes(action.input.childRef)) {\n    throw new DuplicateChildMocError("This child MOC is already linked");\n}\nstate.childRefs.push(action.input.childRef);',
              schema: "input AddChildMocInput {\n    childRef: String!\n}",
              template: "Add a child MOC reference",
              scope: "global",
            },
            {
              description: "Remove a child MOC reference",
              errors: [],
              examples: [],
              id: "remove-child-moc",
              name: "REMOVE_CHILD_MOC",
              reducer:
                "state.childRefs = state.childRefs.filter(r => r !== action.input.childRef);",
              schema: "input RemoveChildMocInput {\n    childRef: String!\n}",
              template: "Remove a child MOC reference",
              scope: "global",
            },
          ],
        },
      ],
      state: {
        global: {
          examples: [],
          initialValue:
            '{\n    "title": null,\n    "description": null,\n    "orientation": null,\n    "tier": null,\n    "coreIdeas": [],\n    "tensions": [],\n    "openQuestions": [],\n    "agentNotes": [],\n    "parentRef": null,\n    "childRefs": [],\n    "noteCount": 0,\n    "createdAt": null,\n    "updatedAt": null\n}',
          schema:
            "enum MocTier {\n    HUB\n    DOMAIN\n    TOPIC\n}\n\ntype MocEntry {\n    id: OID!\n    noteRef: String!\n    contextPhrase: String!\n    sortOrder: Int!\n    addedAt: DateTime\n    addedBy: String\n}\n\ntype MocTensionEntry {\n    id: OID!\n    description: String!\n    involvedRefs: [String!]!\n    addedAt: DateTime\n}\n\ntype MocState {\n    title: String\n    description: String\n    orientation: String\n    tier: MocTier\n    coreIdeas: [MocEntry!]!\n    tensions: [MocTensionEntry!]!\n    openQuestions: [String!]!\n    agentNotes: [String!]!\n    parentRef: String\n    childRefs: [String!]!\n    noteCount: Int\n    createdAt: DateTime\n    updatedAt: DateTime\n}",
        },
        local: {
          examples: [],
          initialValue: "",
          schema: "",
        },
      },
      version: 1,
    },
  ],
};
