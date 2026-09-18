import type { KnowledgeNoteContentOperations } from "document-models/knowledge-note/v2";
import {
  DescriptionTooLongError,
  InvalidMetadataFieldError,
  InvalidMetadataListFieldError,
  InvalidMetadataValueError,
  PatchOutOfBoundsError,
} from "../../gen/content/error.js";

// Metadata fields with a closed vocabulary. Everything else is free text.
const METADATA_VALUES: Record<string, readonly string[]> = {
  confidence: ["grounded", "established", "speculative"],
  severity: ["critical", "warning", "info"],
  decisionStatus: ["proposed", "accepted", "rejected", "superseded"],
};

export const knowledgeNoteContentOperations: KnowledgeNoteContentOperations = {
  setTitleOperation(state, action) {
    state.title = action.input.title;
    state.updatedAt = action.input.updatedAt;
    if (state.provenance) {
      state.provenance.updatedAt = action.input.updatedAt;
    }
  },
  setDescriptionOperation(state, action) {
    if (action.input.description.length > 200) {
      throw new DescriptionTooLongError("Description exceeds 200 characters");
    }
    state.description = action.input.description;
    state.updatedAt = action.input.updatedAt;
    if (state.provenance) {
      state.provenance.updatedAt = action.input.updatedAt;
    }
  },
  setNoteTypeOperation(state, action) {
    state.noteType = action.input.noteType;
    state.updatedAt = action.input.updatedAt;
    if (state.provenance) {
      state.provenance.updatedAt = action.input.updatedAt;
    }
  },
  setContentOperation(state, action) {
    state.content = action.input.content;
    state.updatedAt = action.input.updatedAt;
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
    state.updatedAt = action.input.updatedAt;
    if (state.provenance) {
      state.provenance.updatedAt = action.input.updatedAt;
    }
  },
  setMetadataFieldOperation(state, action) {
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
    ] as const;
    const { field, value } = action.input;
    const stringField = STRING_METADATA_FIELDS.find((f) => f === field);
    if (!stringField) {
      throw new InvalidMetadataFieldError(
        `"${field}" is not a recognized string metadata field`,
      );
    }
    const allowed = METADATA_VALUES[stringField];
    if (allowed && value && !allowed.includes(value)) {
      throw new InvalidMetadataValueError(
        `"${value}" is not a valid ${stringField}; expected one of ${allowed.join(", ")}`,
      );
    }
    state[stringField] = value || null;
    state.updatedAt = action.input.updatedAt;
    if (state.provenance) {
      state.provenance.updatedAt = action.input.updatedAt;
    }
  },
  setMetadataListFieldOperation(state, action) {
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
    ] as const;
    const { field, values } = action.input;
    const listField = LIST_METADATA_FIELDS.find((f) => f === field);
    if (!listField) {
      throw new InvalidMetadataListFieldError(
        `"${field}" is not a recognized list metadata field`,
      );
    }
    state[listField] = values;
    state.updatedAt = action.input.updatedAt;
    if (state.provenance) {
      state.provenance.updatedAt = action.input.updatedAt;
    }
  },
};
