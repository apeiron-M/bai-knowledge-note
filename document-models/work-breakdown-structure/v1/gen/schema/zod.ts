/* eslint-disable @typescript-eslint/no-empty-object-type */
/* eslint-disable @typescript-eslint/no-unused-vars */
import * as z from "zod";
import type {
  AddDependenciesInput,
  AddNoteInput,
  AssignGoalInput,
  CreateGoalInput,
  DeleteGoalInput,
  Goal,
  GoalStatus,
  Note,
  RemoveDependenciesInput,
  RemoveNoteInput,
  ReorderInput,
  SetGoalStatusInput,
  SetOutcomeInput,
  SetOwnerInput,
  SetProjectRefInput,
  SetReferencesInput,
  UpdateGoalDescriptionInput,
  WorkBreakdownStructureState,
} from "./types.js";

type Properties<T> = Required<{
  [K in keyof T]: z.ZodType<T[K]>;
}>;

type definedNonNullAny = {};

export const isDefinedNonNullAny = (v: any): v is definedNonNullAny =>
  v !== undefined && v !== null;

export const definedNonNullAnySchema = z
  .any()
  .refine((v) => isDefinedNonNullAny(v));

export const GoalStatusSchema = z.enum([
  "BLOCKED",
  "COMPLETED",
  "IN_PROGRESS",
  "IN_REVIEW",
  "TODO",
  "WONT_DO",
]);

export function AddDependenciesInputSchema(): z.ZodObject<
  Properties<AddDependenciesInput>
> {
  return z.object({
    dependencies: z.array(z.string()),
    id: z.string(),
  });
}

export function AddNoteInputSchema(): z.ZodObject<Properties<AddNoteInput>> {
  return z.object({
    author: z.string().nullish(),
    goalId: z.string(),
    note: z.string(),
    noteId: z.string(),
    timestamp: z.iso.datetime().nullish(),
  });
}

export function AssignGoalInputSchema(): z.ZodObject<
  Properties<AssignGoalInput>
> {
  return z.object({
    assignee: z.string().nullish(),
    id: z.string(),
  });
}

export function CreateGoalInputSchema(): z.ZodObject<
  Properties<CreateGoalInput>
> {
  return z.object({
    assignee: z.string().nullish(),
    description: z.string(),
    id: z.string(),
    insertBefore: z.string().nullish(),
    parentId: z.string().nullish(),
  });
}

export function DeleteGoalInputSchema(): z.ZodObject<
  Properties<DeleteGoalInput>
> {
  return z.object({
    id: z.string(),
  });
}

export function GoalSchema(): z.ZodObject<Properties<Goal>> {
  return z.object({
    __typename: z.literal("Goal").optional(),
    assignee: z.string().nullish(),
    blockReason: z.string().nullish(),
    dependencies: z.array(z.string()),
    description: z.string(),
    id: z.string(),
    notes: z.array(z.lazy(() => NoteSchema())),
    outcome: z.string().nullish(),
    parentId: z.string().nullish(),
    status: GoalStatusSchema,
  });
}

export function NoteSchema(): z.ZodObject<Properties<Note>> {
  return z.object({
    __typename: z.literal("Note").optional(),
    author: z.string().nullish(),
    id: z.string(),
    note: z.string(),
    timestamp: z.iso.datetime().nullish(),
  });
}

export function RemoveDependenciesInputSchema(): z.ZodObject<
  Properties<RemoveDependenciesInput>
> {
  return z.object({
    dependencies: z.array(z.string()),
    id: z.string(),
  });
}

export function RemoveNoteInputSchema(): z.ZodObject<
  Properties<RemoveNoteInput>
> {
  return z.object({
    goalId: z.string(),
    noteId: z.string(),
  });
}

export function ReorderInputSchema(): z.ZodObject<Properties<ReorderInput>> {
  return z.object({
    id: z.string(),
    insertBefore: z.string().nullish(),
    parentId: z.string().nullish(),
  });
}

export function SetGoalStatusInputSchema(): z.ZodObject<
  Properties<SetGoalStatusInput>
> {
  return z.object({
    blockReason: z.string().nullish(),
    id: z.string(),
    outcome: z.string().nullish(),
    status: GoalStatusSchema,
  });
}

export function SetOutcomeInputSchema(): z.ZodObject<
  Properties<SetOutcomeInput>
> {
  return z.object({
    id: z.string(),
    outcome: z.string().nullish(),
  });
}

export function SetOwnerInputSchema(): z.ZodObject<Properties<SetOwnerInput>> {
  return z.object({
    owner: z.string().nullish(),
  });
}

export function SetProjectRefInputSchema(): z.ZodObject<
  Properties<SetProjectRefInput>
> {
  return z.object({
    projectRef: z.string().nullish(),
  });
}

export function SetReferencesInputSchema(): z.ZodObject<
  Properties<SetReferencesInput>
> {
  return z.object({
    references: z.array(z.url()),
  });
}

export function UpdateGoalDescriptionInputSchema(): z.ZodObject<
  Properties<UpdateGoalDescriptionInput>
> {
  return z.object({
    description: z.string(),
    id: z.string(),
  });
}

export function WorkBreakdownStructureStateSchema(): z.ZodObject<
  Properties<WorkBreakdownStructureState>
> {
  return z.object({
    __typename: z.literal("WorkBreakdownStructureState").optional(),
    goals: z.array(z.lazy(() => GoalSchema())),
    owner: z.string().nullish(),
    projectRef: z.string().nullish(),
    references: z.array(z.url()),
  });
}
