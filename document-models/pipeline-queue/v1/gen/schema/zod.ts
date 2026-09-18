/* eslint-disable @typescript-eslint/no-empty-object-type */
/* eslint-disable @typescript-eslint/no-unused-vars */
import * as z from "zod";
import type {
  AddTaskInput,
  AdvancePhaseInput,
  AssignTaskInput,
  BlockTaskInput,
  CompleteTaskInput,
  FailTaskInput,
  LearningCategory,
  PhaseHandoff,
  PhaseHandoffInput,
  PhaseLearning,
  PhaseOrderEntry,
  PipelineQueueState,
  PipelineTask,
  TaskStatus,
  UnblockTaskInput,
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

export const LearningCategorySchema = z.enum([
  "FRICTION",
  "METHODOLOGY",
  "PROCESS_GAP",
  "SURPRISE",
]);

export const TaskStatusSchema = z.enum([
  "BLOCKED",
  "DONE",
  "FAILED",
  "IN_PROGRESS",
  "PENDING",
]);

export function AddTaskInputSchema(): z.ZodObject<Properties<AddTaskInput>> {
  return z.object({
    batchId: z.string().nullish(),
    createdAt: z.iso.datetime(),
    currentPhase: z.string().nullish(),
    documentRef: z.string().nullish(),
    id: z.string(),
    target: z.string(),
    taskType: z.string(),
  });
}

export function AdvancePhaseInputSchema(): z.ZodObject<
  Properties<AdvancePhaseInput>
> {
  return z.object({
    handoff: z.lazy(() => PhaseHandoffInputSchema()),
    taskId: z.string(),
    updatedAt: z.iso.datetime(),
  });
}

export function AssignTaskInputSchema(): z.ZodObject<
  Properties<AssignTaskInput>
> {
  return z.object({
    assignedTo: z.string(),
    taskId: z.string(),
    updatedAt: z.iso.datetime(),
  });
}

export function BlockTaskInputSchema(): z.ZodObject<
  Properties<BlockTaskInput>
> {
  return z.object({
    reason: z.string(),
    taskId: z.string(),
    updatedAt: z.iso.datetime(),
  });
}

export function CompleteTaskInputSchema(): z.ZodObject<
  Properties<CompleteTaskInput>
> {
  return z.object({
    taskId: z.string(),
    updatedAt: z.iso.datetime(),
  });
}

export function FailTaskInputSchema(): z.ZodObject<Properties<FailTaskInput>> {
  return z.object({
    reason: z.string(),
    taskId: z.string(),
    updatedAt: z.iso.datetime(),
  });
}

export function PhaseHandoffSchema(): z.ZodObject<Properties<PhaseHandoff>> {
  return z.object({
    __typename: z.literal("PhaseHandoff").optional(),
    completedAt: z.iso.datetime(),
    completedBy: z.string().nullish(),
    filesModified: z.array(z.string()),
    id: z.string(),
    learnings: z.array(z.lazy(() => PhaseLearningSchema())),
    phase: z.string(),
    workDone: z.string(),
  });
}

export function PhaseHandoffInputSchema(): z.ZodObject<
  Properties<PhaseHandoffInput>
> {
  return z.object({
    completedAt: z.iso.datetime(),
    completedBy: z.string().nullish(),
    filesModified: z.array(z.string()),
    id: z.string(),
    phase: z.string(),
    workDone: z.string(),
  });
}

export function PhaseLearningSchema(): z.ZodObject<Properties<PhaseLearning>> {
  return z.object({
    __typename: z.literal("PhaseLearning").optional(),
    category: LearningCategorySchema,
    description: z.string(),
    id: z.string(),
  });
}

export function PhaseOrderEntrySchema(): z.ZodObject<
  Properties<PhaseOrderEntry>
> {
  return z.object({
    __typename: z.literal("PhaseOrderEntry").optional(),
    phases: z.array(z.string()),
    taskType: z.string(),
  });
}

export function PipelineQueueStateSchema(): z.ZodObject<
  Properties<PipelineQueueState>
> {
  return z.object({
    __typename: z.literal("PipelineQueueState").optional(),
    activeCount: z.number(),
    completedCount: z.number(),
    lastProcessedAt: z.iso.datetime().nullish(),
    phaseOrder: z.array(z.lazy(() => PhaseOrderEntrySchema())),
    schemaVersion: z.number(),
    tasks: z.array(z.lazy(() => PipelineTaskSchema())),
  });
}

export function PipelineTaskSchema(): z.ZodObject<Properties<PipelineTask>> {
  return z.object({
    __typename: z.literal("PipelineTask").optional(),
    assignedTo: z.string().nullish(),
    batchId: z.string().nullish(),
    completedPhases: z.array(z.string()),
    createdAt: z.iso.datetime(),
    currentPhase: z.string().nullish(),
    documentRef: z.string().nullish(),
    handoffs: z.array(z.lazy(() => PhaseHandoffSchema())),
    id: z.string(),
    status: TaskStatusSchema,
    target: z.string(),
    taskType: z.string(),
    updatedAt: z.iso.datetime().nullish(),
  });
}

export function UnblockTaskInputSchema(): z.ZodObject<
  Properties<UnblockTaskInput>
> {
  return z.object({
    taskId: z.string(),
    updatedAt: z.iso.datetime(),
  });
}
