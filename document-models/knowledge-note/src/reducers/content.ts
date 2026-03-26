import {
  DescriptionTooLongError,
  PatchOutOfBoundsError,
  InvalidMetadataFieldError,
  InvalidMetadataListFieldError,
} from "../../gen/content/error.js";
import type { KnowledgeNoteContentOperations } from "knowledge-note/document-models/knowledge-note";

const STRING_METADATA_FIELDS = [
  "scope",
  "confidence",
  "severity",
  "editor",
  "modelId",
  "version",
  "filePath",
  "computes",
  "context",
  "decisionStatus",
  "model",
  "sourceType",
  "targetType",
  "relationType",
  "cardinality",
  "errorMessage",
  "rootCause",
  "correctPattern",
];

const LIST_METADATA_FIELDS = [
  "models",
  "hooksUsed",
  "dispatchTargets",
  "modules",
  "inputs",
  "outputs",
  "consumedBy",
  "alternatives",
  "consequences",
];

export const knowledgeNoteContentOperations: KnowledgeNoteContentOperations = {
  setTitleOperation(state, action) {
    state.title = action.input.title;
    if (state.provenance) {
      state.provenance.updatedAt = action.input.updatedAt;
    }
  },
  setDescriptionOperation(state, action) {
    if (action.input.description.length > 200) {
      throw new DescriptionTooLongError("Description exceeds 200 characters");
    }
    state.description = action.input.description;
    if (state.provenance) {
      state.provenance.updatedAt = action.input.updatedAt;
    }
  },
  setNoteTypeOperation(state, action) {
    state.noteType = action.input.noteType;
    if (state.provenance) {
      state.provenance.updatedAt = action.input.updatedAt;
    }
  },
  setContentOperation(state, action) {
    state.content = action.input.content;
    if (state.provenance) {
      state.provenance.updatedAt = action.input.updatedAt;
    }
  },
  patchContentOperation(state, action) {
    const content = state.content || "";
    const { offset, removeCount, insert } = action.input;
    if (offset < 0 || offset + removeCount > content.length) {
      throw new PatchOutOfBoundsError(
        "Offset + removeCount exceeds content length",
      );
    }
    state.content =
      content.slice(0, offset) + insert + content.slice(offset + removeCount);
    if (state.provenance) {
      state.provenance.updatedAt = action.input.updatedAt;
    }
  },
  setMetadataFieldOperation(state, action) {
    const { field, value } = action.input;
    if (!STRING_METADATA_FIELDS.includes(field)) {
      throw new InvalidMetadataFieldError(
        `"${field}" is not a recognized string metadata field`,
      );
    }
    (state as Record<string, unknown>)[field] = value || null;
    if (state.provenance) {
      state.provenance.updatedAt = action.input.updatedAt;
    }
  },
  setMetadataListFieldOperation(state, action) {
    const { field, values } = action.input;
    if (!LIST_METADATA_FIELDS.includes(field)) {
      throw new InvalidMetadataListFieldError(
        `"${field}" is not a recognized list metadata field`,
      );
    }
    (state as Record<string, unknown>)[field] = values;
    if (state.provenance) {
      state.provenance.updatedAt = action.input.updatedAt;
    }
  },
};
