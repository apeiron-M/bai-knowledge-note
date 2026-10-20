/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
import type { Reducer, StateReducer } from "document-model";
import { createReducer, isDocumentAction } from "document-model";
import type { KnowledgeNotePHState } from "document-models/knowledge-note/v2";

import { knowledgeNoteContentOperations } from "../src/reducers/content.js";
import { knowledgeNoteLifecycleOperations } from "../src/reducers/lifecycle.js";
import { knowledgeNoteLinkingOperations } from "../src/reducers/linking.js";
import { knowledgeNoteLocalOperations } from "../src/reducers/local.js";
import { knowledgeNoteProvenanceOperations } from "../src/reducers/provenance.js";

import {
  AddLinkInputSchema,
  AddTopicInputSchema,
  ApproveNoteInputSchema,
  ArchiveNoteInputSchema,
  PatchContentInputSchema,
  RejectNoteInputSchema,
  RemoveLinkInputSchema,
  RemoveTopicInputSchema,
  RestoreNoteInputSchema,
  SetContentInputSchema,
  SetDescriptionInputSchema,
  SetLastViewedInputSchema,
  SetMetadataFieldInputSchema,
  SetMetadataListFieldInputSchema,
  SetNoteTypeInputSchema,
  SetProvenanceInputSchema,
  SetTitleInputSchema,
  SubmitForReviewInputSchema,
  UpdateLinkTypeInputSchema,
} from "./schema/zod.js";

const schemaMemo = new Map<() => unknown, unknown>();

function memoizedSchema<T>(makeSchema: () => T): T {
  let schema = schemaMemo.get(makeSchema) as T | undefined;
  if (schema === undefined) {
    schema = makeSchema();
    schemaMemo.set(makeSchema, schema);
  }
  return schema;
}

const stateReducer: StateReducer<KnowledgeNotePHState> = (
  state,
  action,
  dispatch,
) => {
  if (isDocumentAction(action)) {
    return state;
  }
  switch (action.type) {
    case "SET_TITLE": {
      memoizedSchema(SetTitleInputSchema).parse(action.input);

      knowledgeNoteContentOperations.setTitleOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "SET_DESCRIPTION": {
      memoizedSchema(SetDescriptionInputSchema).parse(action.input);

      knowledgeNoteContentOperations.setDescriptionOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "SET_NOTE_TYPE": {
      memoizedSchema(SetNoteTypeInputSchema).parse(action.input);

      knowledgeNoteContentOperations.setNoteTypeOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "SET_CONTENT": {
      memoizedSchema(SetContentInputSchema).parse(action.input);

      knowledgeNoteContentOperations.setContentOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "PATCH_CONTENT": {
      memoizedSchema(PatchContentInputSchema).parse(action.input);

      knowledgeNoteContentOperations.patchContentOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "SET_METADATA_FIELD": {
      memoizedSchema(SetMetadataFieldInputSchema).parse(action.input);

      knowledgeNoteContentOperations.setMetadataFieldOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "SET_METADATA_LIST_FIELD": {
      memoizedSchema(SetMetadataListFieldInputSchema).parse(action.input);

      knowledgeNoteContentOperations.setMetadataListFieldOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "SET_PROVENANCE": {
      memoizedSchema(SetProvenanceInputSchema).parse(action.input);

      knowledgeNoteProvenanceOperations.setProvenanceOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "ADD_LINK": {
      memoizedSchema(AddLinkInputSchema).parse(action.input);

      knowledgeNoteLinkingOperations.addLinkOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "REMOVE_LINK": {
      memoizedSchema(RemoveLinkInputSchema).parse(action.input);

      knowledgeNoteLinkingOperations.removeLinkOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "UPDATE_LINK_TYPE": {
      memoizedSchema(UpdateLinkTypeInputSchema).parse(action.input);

      knowledgeNoteLinkingOperations.updateLinkTypeOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "ADD_TOPIC": {
      memoizedSchema(AddTopicInputSchema).parse(action.input);

      knowledgeNoteLinkingOperations.addTopicOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "REMOVE_TOPIC": {
      memoizedSchema(RemoveTopicInputSchema).parse(action.input);

      knowledgeNoteLinkingOperations.removeTopicOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "SUBMIT_FOR_REVIEW": {
      memoizedSchema(SubmitForReviewInputSchema).parse(action.input);

      knowledgeNoteLifecycleOperations.submitForReviewOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "APPROVE_NOTE": {
      memoizedSchema(ApproveNoteInputSchema).parse(action.input);

      knowledgeNoteLifecycleOperations.approveNoteOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "REJECT_NOTE": {
      memoizedSchema(RejectNoteInputSchema).parse(action.input);

      knowledgeNoteLifecycleOperations.rejectNoteOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "ARCHIVE_NOTE": {
      memoizedSchema(ArchiveNoteInputSchema).parse(action.input);

      knowledgeNoteLifecycleOperations.archiveNoteOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "RESTORE_NOTE": {
      memoizedSchema(RestoreNoteInputSchema).parse(action.input);

      knowledgeNoteLifecycleOperations.restoreNoteOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "SET_LAST_VIEWED": {
      memoizedSchema(SetLastViewedInputSchema).parse(action.input);

      knowledgeNoteLocalOperations.setLastViewedOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    default:
      return state;
  }
};

export const reducer: Reducer<KnowledgeNotePHState> =
  createReducer(stateReducer);
