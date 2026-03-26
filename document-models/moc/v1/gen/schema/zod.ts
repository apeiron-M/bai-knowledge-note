import * as z from "zod";
import type {
  AddChildMocInput,
  AddCoreIdeaInput,
  AddOpenQuestionInput,
  AddTensionInput,
  CreateMocInput,
  MocEntry,
  MocState,
  MocTensionEntry,
  MocTier,
  RemoveChildMocInput,
  RemoveCoreIdeaInput,
  RemoveOpenQuestionInput,
  RemoveTensionInput,
  ReorderCoreIdeasInput,
  UpdateCoreIdeaInput,
  UpdateDescriptionInput,
  UpdateOrientationInput,
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

export const MocTierSchema = z.enum(["DOMAIN", "HUB", "TOPIC"]);

export function AddChildMocInputSchema(): z.ZodObject<
  Properties<AddChildMocInput>
> {
  return z.object({
    childRef: z.string(),
  });
}

export function AddCoreIdeaInputSchema(): z.ZodObject<
  Properties<AddCoreIdeaInput>
> {
  return z.object({
    addedAt: z.iso.datetime(),
    addedBy: z.string().nullish(),
    contextPhrase: z.string(),
    id: z.string(),
    noteRef: z.string(),
    sortOrder: z.number(),
  });
}

export function AddOpenQuestionInputSchema(): z.ZodObject<
  Properties<AddOpenQuestionInput>
> {
  return z.object({
    question: z.string(),
  });
}

export function AddTensionInputSchema(): z.ZodObject<
  Properties<AddTensionInput>
> {
  return z.object({
    addedAt: z.iso.datetime(),
    description: z.string(),
    id: z.string(),
    involvedRefs: z.array(z.string()),
  });
}

export function CreateMocInputSchema(): z.ZodObject<
  Properties<CreateMocInput>
> {
  return z.object({
    createdAt: z.iso.datetime(),
    description: z.string(),
    orientation: z.string(),
    parentRef: z.string().nullish(),
    tier: MocTierSchema,
    title: z.string(),
  });
}

export function MocEntrySchema(): z.ZodObject<Properties<MocEntry>> {
  return z.object({
    __typename: z.literal("MocEntry").optional(),
    addedAt: z.iso.datetime().nullish(),
    addedBy: z.string().nullish(),
    contextPhrase: z.string(),
    id: z.string(),
    noteRef: z.string(),
    sortOrder: z.number(),
  });
}

export function MocStateSchema(): z.ZodObject<Properties<MocState>> {
  return z.object({
    __typename: z.literal("MocState").optional(),
    agentNotes: z.array(z.string()),
    childRefs: z.array(z.string()),
    coreIdeas: z.array(z.lazy(() => MocEntrySchema())),
    createdAt: z.iso.datetime().nullish(),
    description: z.string().nullish(),
    noteCount: z.number().nullish(),
    openQuestions: z.array(z.string()),
    orientation: z.string().nullish(),
    parentRef: z.string().nullish(),
    tensions: z.array(z.lazy(() => MocTensionEntrySchema())),
    tier: MocTierSchema.nullish(),
    title: z.string().nullish(),
    updatedAt: z.iso.datetime().nullish(),
  });
}

export function MocTensionEntrySchema(): z.ZodObject<
  Properties<MocTensionEntry>
> {
  return z.object({
    __typename: z.literal("MocTensionEntry").optional(),
    addedAt: z.iso.datetime().nullish(),
    description: z.string(),
    id: z.string(),
    involvedRefs: z.array(z.string()),
  });
}

export function RemoveChildMocInputSchema(): z.ZodObject<
  Properties<RemoveChildMocInput>
> {
  return z.object({
    childRef: z.string(),
  });
}

export function RemoveCoreIdeaInputSchema(): z.ZodObject<
  Properties<RemoveCoreIdeaInput>
> {
  return z.object({
    id: z.string(),
  });
}

export function RemoveOpenQuestionInputSchema(): z.ZodObject<
  Properties<RemoveOpenQuestionInput>
> {
  return z.object({
    question: z.string(),
  });
}

export function RemoveTensionInputSchema(): z.ZodObject<
  Properties<RemoveTensionInput>
> {
  return z.object({
    id: z.string(),
  });
}

export function ReorderCoreIdeasInputSchema(): z.ZodObject<
  Properties<ReorderCoreIdeasInput>
> {
  return z.object({
    ids: z.array(z.string()),
  });
}

export function UpdateCoreIdeaInputSchema(): z.ZodObject<
  Properties<UpdateCoreIdeaInput>
> {
  return z.object({
    contextPhrase: z.string().nullish(),
    id: z.string(),
    sortOrder: z.number().nullish(),
  });
}

export function UpdateDescriptionInputSchema(): z.ZodObject<
  Properties<UpdateDescriptionInput>
> {
  return z.object({
    description: z.string(),
    updatedAt: z.iso.datetime(),
  });
}

export function UpdateOrientationInputSchema(): z.ZodObject<
  Properties<UpdateOrientationInput>
> {
  return z.object({
    orientation: z.string(),
    updatedAt: z.iso.datetime(),
  });
}
