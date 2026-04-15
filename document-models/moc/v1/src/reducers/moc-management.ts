import {
  DuplicateCoreIdeaError,
  CoreIdeaNotFoundError,
  TensionNotFoundError,
  DuplicateChildMocError,
} from "../../gen/moc-management/error.js";
import type { MocMocManagementOperations } from "document-models/moc/v1";

export const mocMocManagementOperations: MocMocManagementOperations = {
  createMocOperation(state, action) {
    state.title = action.input.title;
    state.description = action.input.description;
    state.orientation = action.input.orientation;
    state.tier = action.input.tier;
    state.parentRef = action.input.parentRef || null;
    state.createdAt = action.input.createdAt;
    state.updatedAt = action.input.createdAt;
  },
  updateOrientationOperation(state, action) {
    state.orientation = action.input.orientation;
    state.updatedAt = action.input.updatedAt;
  },
  updateDescriptionOperation(state, action) {
    state.description = action.input.description;
    state.updatedAt = action.input.updatedAt;
  },
  addCoreIdeaOperation(state, action) {
    const existing = state.coreIdeas.find(
      (c) => c.noteRef === action.input.noteRef,
    );
    if (existing) {
      throw new DuplicateCoreIdeaError("This note is already in Core Ideas");
    }
    state.coreIdeas.push({
      id: action.input.id,
      noteRef: action.input.noteRef,
      contextPhrase: action.input.contextPhrase,
      sortOrder: action.input.sortOrder,
      addedAt: action.input.addedAt,
      addedBy: action.input.addedBy || null,
    });
    state.noteCount = (state.noteCount || 0) + 1;
  },
  updateCoreIdeaOperation(state, action) {
    const idea = state.coreIdeas.find((c) => c.id === action.input.id);
    if (!idea) {
      throw new CoreIdeaNotFoundError("Core idea not found");
    }
    if (action.input.contextPhrase)
      idea.contextPhrase = action.input.contextPhrase;
    if (action.input.sortOrder !== undefined && action.input.sortOrder !== null)
      idea.sortOrder = action.input.sortOrder;
  },
  removeCoreIdeaOperation(state, action) {
    const index = state.coreIdeas.findIndex((c) => c.id === action.input.id);
    if (index === -1) {
      throw new CoreIdeaNotFoundError("Core idea not found");
    }
    state.coreIdeas.splice(index, 1);
    state.noteCount = Math.max(0, (state.noteCount || 0) - 1);
  },
  reorderCoreIdeasOperation(state, action) {
    const reordered = action.input.ids
      .map((id, i) => {
        const idea = state.coreIdeas.find((c) => c.id === id);
        if (idea) idea.sortOrder = i;
        return idea;
      })
      .filter((idea): idea is NonNullable<typeof idea> => Boolean(idea));
    state.coreIdeas = reordered;
  },
  addTensionOperation(state, action) {
    state.tensions.push({
      id: action.input.id,
      description: action.input.description,
      involvedRefs: action.input.involvedRefs,
      addedAt: action.input.addedAt,
    });
  },
  removeTensionOperation(state, action) {
    const index = state.tensions.findIndex((t) => t.id === action.input.id);
    if (index === -1) {
      throw new TensionNotFoundError("Tension not found");
    }
    state.tensions.splice(index, 1);
  },
  addOpenQuestionOperation(state, action) {
    state.openQuestions.push(action.input.question);
  },
  removeOpenQuestionOperation(state, action) {
    state.openQuestions = state.openQuestions.filter(
      (q) => q !== action.input.question,
    );
  },
  addChildMocOperation(state, action) {
    if (state.childRefs.includes(action.input.childRef)) {
      throw new DuplicateChildMocError("This child MOC is already linked");
    }
    state.childRefs.push(action.input.childRef);
  },
  removeChildMocOperation(state, action) {
    state.childRefs = state.childRefs.filter(
      (r) => r !== action.input.childRef,
    );
  },
};
