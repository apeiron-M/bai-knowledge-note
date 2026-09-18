/* eslint-disable @typescript-eslint/no-empty-object-type */
/* eslint-disable @typescript-eslint/no-unused-vars */
import * as z from "zod";
import type {
  AddLinkInput,
  AddTopicInput,
  ApproveNoteInput,
  ArchiveNoteInput,
  KnowledgeNoteLocalState,
  KnowledgeNoteState,
  LifecycleEvent,
  LinkType,
  NoteLink,
  NoteStatus,
  PatchContentInput,
  PersonalTag,
  Provenance,
  RejectNoteInput,
  RemoveLinkInput,
  RemoveTopicInput,
  RestoreNoteInput,
  SetContentInput,
  SetDescriptionInput,
  SetLastViewedInput,
  SetMetadataFieldInput,
  SetMetadataListFieldInput,
  SetNoteTypeInput,
  SetProvenanceInput,
  SetTitleInput,
  SourceOrigin,
  SubmitForReviewInput,
  Topic,
  UpdateLinkTypeInput,
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

export const LinkTypeSchema = z.enum([
  "BUILDS_ON",
  "CONTRADICTS",
  "DERIVED_FROM",
  "RELATES_TO",
  "SUPERSEDES",
]);

export const NoteStatusSchema = z.enum([
  "ARCHIVED",
  "CANONICAL",
  "DRAFT",
  "IN_REVIEW",
]);

export const SourceOriginSchema = z.enum([
  "DERIVED",
  "IMPORT",
  "MANUAL",
  "SESSION_MINE",
]);

export function AddLinkInputSchema(): z.ZodObject<Properties<AddLinkInput>> {
  return z.object({
    id: z.string(),
    linkType: LinkTypeSchema,
    targetDocumentId: z.string(),
    targetTitle: z.string().nullish(),
  });
}

export function AddTopicInputSchema(): z.ZodObject<Properties<AddTopicInput>> {
  return z.object({
    id: z.string(),
    name: z.string(),
    topicDocumentId: z.string().nullish(),
  });
}

export function ApproveNoteInputSchema(): z.ZodObject<
  Properties<ApproveNoteInput>
> {
  return z.object({
    actor: z.string(),
    comment: z.string().nullish(),
    id: z.string(),
    timestamp: z.iso.datetime(),
  });
}

export function ArchiveNoteInputSchema(): z.ZodObject<
  Properties<ArchiveNoteInput>
> {
  return z.object({
    actor: z.string(),
    comment: z.string(),
    id: z.string(),
    timestamp: z.iso.datetime(),
  });
}

export function KnowledgeNoteLocalStateSchema(): z.ZodObject<
  Properties<KnowledgeNoteLocalState>
> {
  return z.object({
    __typename: z.literal("KnowledgeNoteLocalState").optional(),
    lastViewedAt: z.iso.datetime().nullish(),
    personalTags: z.array(z.lazy(() => PersonalTagSchema())),
  });
}

export function KnowledgeNoteStateSchema(): z.ZodObject<
  Properties<KnowledgeNoteState>
> {
  return z.object({
    __typename: z.literal("KnowledgeNoteState").optional(),
    alternatives: z.array(z.string()),
    cardinality: z.string().nullish(),
    computes: z.string().nullish(),
    confidence: z.string().nullish(),
    consequences: z.array(z.string()),
    consumedBy: z.array(z.string()),
    content: z.string().nullish(),
    context: z.string().nullish(),
    correctPattern: z.string().nullish(),
    decisionStatus: z.string().nullish(),
    description: z.string().nullish(),
    dispatchTargets: z.array(z.string()),
    editor: z.string().nullish(),
    errorMessage: z.string().nullish(),
    filePath: z.string().nullish(),
    hooksUsed: z.array(z.string()),
    inputs: z.array(z.string()),
    lifecycleEvents: z.array(z.lazy(() => LifecycleEventSchema())),
    links: z.array(z.lazy(() => NoteLinkSchema())),
    model: z.string().nullish(),
    modelId: z.string().nullish(),
    models: z.array(z.string()),
    modules: z.array(z.string()),
    noteType: z.string().nullish(),
    outputs: z.array(z.string()),
    provenance: z.lazy(() => ProvenanceSchema().nullish()),
    relationType: z.string().nullish(),
    rootCause: z.string().nullish(),
    scope: z.string().nullish(),
    severity: z.string().nullish(),
    sourceType: z.string().nullish(),
    status: NoteStatusSchema.nullish(),
    targetType: z.string().nullish(),
    title: z.string().nullish(),
    topics: z.array(z.lazy(() => TopicSchema())),
    version: z.string().nullish(),
  });
}

export function LifecycleEventSchema(): z.ZodObject<
  Properties<LifecycleEvent>
> {
  return z.object({
    __typename: z.literal("LifecycleEvent").optional(),
    actor: z.string().nullish(),
    comment: z.string().nullish(),
    fromStatus: NoteStatusSchema.nullish(),
    id: z.string(),
    timestamp: z.iso.datetime().nullish(),
    toStatus: NoteStatusSchema.nullish(),
  });
}

export function NoteLinkSchema(): z.ZodObject<Properties<NoteLink>> {
  return z.object({
    __typename: z.literal("NoteLink").optional(),
    id: z.string(),
    linkType: LinkTypeSchema.nullish(),
    targetDocumentId: z.string().nullish(),
    targetTitle: z.string().nullish(),
  });
}

export function PatchContentInputSchema(): z.ZodObject<
  Properties<PatchContentInput>
> {
  return z.object({
    insert: z.string(),
    offset: z.number(),
    removeCount: z.number(),
    updatedAt: z.iso.datetime(),
  });
}

export function PersonalTagSchema(): z.ZodObject<Properties<PersonalTag>> {
  return z.object({
    __typename: z.literal("PersonalTag").optional(),
    id: z.string(),
    name: z.string(),
  });
}

export function ProvenanceSchema(): z.ZodObject<Properties<Provenance>> {
  return z.object({
    __typename: z.literal("Provenance").optional(),
    author: z.string().nullish(),
    createdAt: z.iso.datetime().nullish(),
    sessionId: z.string().nullish(),
    sourceOrigin: SourceOriginSchema.nullish(),
    updatedAt: z.iso.datetime().nullish(),
  });
}

export function RejectNoteInputSchema(): z.ZodObject<
  Properties<RejectNoteInput>
> {
  return z.object({
    actor: z.string(),
    comment: z.string(),
    id: z.string(),
    timestamp: z.iso.datetime(),
  });
}

export function RemoveLinkInputSchema(): z.ZodObject<
  Properties<RemoveLinkInput>
> {
  return z.object({
    id: z.string(),
  });
}

export function RemoveTopicInputSchema(): z.ZodObject<
  Properties<RemoveTopicInput>
> {
  return z.object({
    id: z.string(),
  });
}

export function RestoreNoteInputSchema(): z.ZodObject<
  Properties<RestoreNoteInput>
> {
  return z.object({
    actor: z.string(),
    comment: z.string().nullish(),
    id: z.string(),
    timestamp: z.iso.datetime(),
  });
}

export function SetContentInputSchema(): z.ZodObject<
  Properties<SetContentInput>
> {
  return z.object({
    content: z.string(),
    updatedAt: z.iso.datetime(),
  });
}

export function SetDescriptionInputSchema(): z.ZodObject<
  Properties<SetDescriptionInput>
> {
  return z.object({
    description: z.string(),
    updatedAt: z.iso.datetime(),
  });
}

export function SetLastViewedInputSchema(): z.ZodObject<
  Properties<SetLastViewedInput>
> {
  return z.object({
    lastViewedAt: z.iso.datetime(),
  });
}

export function SetMetadataFieldInputSchema(): z.ZodObject<
  Properties<SetMetadataFieldInput>
> {
  return z.object({
    field: z.string(),
    updatedAt: z.iso.datetime(),
    value: z.string().nullish(),
  });
}

export function SetMetadataListFieldInputSchema(): z.ZodObject<
  Properties<SetMetadataListFieldInput>
> {
  return z.object({
    field: z.string(),
    updatedAt: z.iso.datetime(),
    values: z.array(z.string()),
  });
}

export function SetNoteTypeInputSchema(): z.ZodObject<
  Properties<SetNoteTypeInput>
> {
  return z.object({
    noteType: z.string(),
    updatedAt: z.iso.datetime(),
  });
}

export function SetProvenanceInputSchema(): z.ZodObject<
  Properties<SetProvenanceInput>
> {
  return z.object({
    author: z.string(),
    createdAt: z.iso.datetime(),
    sessionId: z.string().nullish(),
    sourceOrigin: SourceOriginSchema,
  });
}

export function SetTitleInputSchema(): z.ZodObject<Properties<SetTitleInput>> {
  return z.object({
    title: z.string(),
    updatedAt: z.iso.datetime(),
  });
}

export function SubmitForReviewInputSchema(): z.ZodObject<
  Properties<SubmitForReviewInput>
> {
  return z.object({
    actor: z.string(),
    comment: z.string().nullish(),
    id: z.string(),
    timestamp: z.iso.datetime(),
  });
}

export function TopicSchema(): z.ZodObject<Properties<Topic>> {
  return z.object({
    __typename: z.literal("Topic").optional(),
    id: z.string(),
    name: z.string(),
    topicDocumentId: z.string().nullish(),
  });
}

export function UpdateLinkTypeInputSchema(): z.ZodObject<
  Properties<UpdateLinkTypeInput>
> {
  return z.object({
    id: z.string(),
    linkType: LinkTypeSchema,
  });
}
