// TODO: remove eslint-disable rules once refactor is done
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
import type { StateReducer } from "document-model";
import { isDocumentAction, createReducer } from "document-model/core";
import type { KnowledgeNotePHState } from "@powerhousedao/knowledge-note/document-models/knowledge-note/v1";

import { knowledgeNoteContentOperations } from "../src/reducers/content.js";
import { knowledgeNoteProvenanceOperations } from "../src/reducers/provenance.js";
import { knowledgeNoteLinkingOperations } from "../src/reducers/linking.js";
import { knowledgeNoteLifecycleOperations } from "../src/reducers/lifecycle.js";
import { knowledgeNoteLocalOperations } from "../src/reducers/local.js";

import {
  SetTitleInputSchema,
  SetDescriptionInputSchema,
  SetNoteTypeInputSchema,
  SetContentInputSchema,
  PatchContentInputSchema,
  SetMetadataFieldInputSchema,
  SetMetadataListFieldInputSchema,
  SetProvenanceInputSchema,
  AddLinkInputSchema,
  RemoveLinkInputSchema,
  UpdateLinkTypeInputSchema,
  AddTopicInputSchema,
  RemoveTopicInputSchema,
  SubmitForReviewInputSchema,
  ApproveNoteInputSchema,
  RejectNoteInputSchema,
  ArchiveNoteInputSchema,
  RestoreNoteInputSchema,
  SetLastViewedInputSchema,
} from "./schema/zod.js";

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
      SetTitleInputSchema().parse(action.input);

      knowledgeNoteContentOperations.setTitleOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "SET_DESCRIPTION": {
      SetDescriptionInputSchema().parse(action.input);

      knowledgeNoteContentOperations.setDescriptionOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "SET_NOTE_TYPE": {
      SetNoteTypeInputSchema().parse(action.input);

      knowledgeNoteContentOperations.setNoteTypeOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "SET_CONTENT": {
      SetContentInputSchema().parse(action.input);

      knowledgeNoteContentOperations.setContentOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "PATCH_CONTENT": {
      PatchContentInputSchema().parse(action.input);

      knowledgeNoteContentOperations.patchContentOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "SET_METADATA_FIELD": {
      SetMetadataFieldInputSchema().parse(action.input);

      knowledgeNoteContentOperations.setMetadataFieldOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "SET_METADATA_LIST_FIELD": {
      SetMetadataListFieldInputSchema().parse(action.input);

      knowledgeNoteContentOperations.setMetadataListFieldOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "SET_PROVENANCE": {
      SetProvenanceInputSchema().parse(action.input);

      knowledgeNoteProvenanceOperations.setProvenanceOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "ADD_LINK": {
      AddLinkInputSchema().parse(action.input);

      knowledgeNoteLinkingOperations.addLinkOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "REMOVE_LINK": {
      RemoveLinkInputSchema().parse(action.input);

      knowledgeNoteLinkingOperations.removeLinkOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "UPDATE_LINK_TYPE": {
      UpdateLinkTypeInputSchema().parse(action.input);

      knowledgeNoteLinkingOperations.updateLinkTypeOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "ADD_TOPIC": {
      AddTopicInputSchema().parse(action.input);

      knowledgeNoteLinkingOperations.addTopicOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "REMOVE_TOPIC": {
      RemoveTopicInputSchema().parse(action.input);

      knowledgeNoteLinkingOperations.removeTopicOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "SUBMIT_FOR_REVIEW": {
      SubmitForReviewInputSchema().parse(action.input);

      knowledgeNoteLifecycleOperations.submitForReviewOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "APPROVE_NOTE": {
      ApproveNoteInputSchema().parse(action.input);

      knowledgeNoteLifecycleOperations.approveNoteOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "REJECT_NOTE": {
      RejectNoteInputSchema().parse(action.input);

      knowledgeNoteLifecycleOperations.rejectNoteOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "ARCHIVE_NOTE": {
      ArchiveNoteInputSchema().parse(action.input);

      knowledgeNoteLifecycleOperations.archiveNoteOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "RESTORE_NOTE": {
      RestoreNoteInputSchema().parse(action.input);

      knowledgeNoteLifecycleOperations.restoreNoteOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "SET_LAST_VIEWED": {
      SetLastViewedInputSchema().parse(action.input);

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

export const reducer = createReducer<KnowledgeNotePHState>(stateReducer);
