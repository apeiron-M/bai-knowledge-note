/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import {
  BaseDocumentHeaderSchema,
  BaseDocumentStateSchema,
} from "document-model";
import { z } from "zod";
import { projectDocumentType } from "./document-type.js";
import { ProjectStateSchema } from "./schema/zod.js";
import type { ProjectDocument, ProjectPHState } from "./types.js";

/** Schema for validating the header object of a Project document */
export const ProjectDocumentHeaderSchema = BaseDocumentHeaderSchema.extend({
  documentType: z.literal(projectDocumentType),
});

/** Schema for validating the state object of a Project document */
export const ProjectPHStateSchema = BaseDocumentStateSchema.extend({
  global: ProjectStateSchema(),
});

export const ProjectDocumentSchema = z.object({
  header: ProjectDocumentHeaderSchema,
  state: ProjectPHStateSchema,
  initialState: ProjectPHStateSchema,
});

/** Simple helper function to check if a state object is a Project document state object */
export function isProjectState(state: unknown): state is ProjectPHState {
  return ProjectPHStateSchema.safeParse(state).success;
}

/** Simple helper function to assert that a document state object is a Project document state object */
export function assertIsProjectState(
  state: unknown,
): asserts state is ProjectPHState {
  ProjectPHStateSchema.parse(state);
}

/** Simple helper function to check if a document is a Project document */
export function isProjectDocument(
  document: unknown,
): document is ProjectDocument {
  return ProjectDocumentSchema.safeParse(document).success;
}

/** Simple helper function to assert that a document is a Project document */
export function assertIsProjectDocument(
  document: unknown,
): asserts document is ProjectDocument {
  ProjectDocumentSchema.parse(document);
}
