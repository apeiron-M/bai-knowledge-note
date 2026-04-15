/* eslint-disable @typescript-eslint/no-empty-object-type */
import * as z from "zod";
import type {
  AddExtractedClaimInput,
  ExtractionStats,
  IngestSourceInput,
  RecordExtractionStatsInput,
  SetSourceStatusInput,
  SourceProvenance,
  SourceState,
  SourceStatus,
  SourceType,
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

export const SourceStatusSchema = z.enum([
  "ARCHIVED",
  "EXTRACTED",
  "EXTRACTING",
  "INBOX",
]);

export const SourceTypeSchema = z.enum([
  "ARTICLE",
  "BOOK_CHAPTER",
  "CONVERSATION",
  "DOCUMENTATION",
  "MANUAL_ENTRY",
  "PAPER",
  "TRANSCRIPT",
  "WEB_PAGE",
]);

export function AddExtractedClaimInputSchema(): z.ZodObject<
  Properties<AddExtractedClaimInput>
> {
  return z.object({
    claimRef: z.string(),
  });
}

export function ExtractionStatsSchema(): z.ZodObject<
  Properties<ExtractionStats>
> {
  return z.object({
    __typename: z.literal("ExtractionStats").optional(),
    claimCount: z.number(),
    extractedAt: z.iso.datetime().nullish(),
    extractedBy: z.string().nullish(),
    skipRate: z.number(),
    skippedCount: z.number(),
  });
}

export function IngestSourceInputSchema(): z.ZodObject<
  Properties<IngestSourceInput>
> {
  return z.object({
    author: z.string().nullish(),
    content: z.string(),
    createdAt: z.iso.datetime(),
    createdBy: z.string().nullish(),
    description: z.string().nullish(),
    method: z.string().nullish(),
    publishedAt: z.iso.datetime().nullish(),
    sourceType: SourceTypeSchema,
    title: z.string(),
    tool: z.string().nullish(),
    url: z.string().nullish(),
  });
}

export function RecordExtractionStatsInputSchema(): z.ZodObject<
  Properties<RecordExtractionStatsInput>
> {
  return z.object({
    claimCount: z.number(),
    extractedAt: z.iso.datetime(),
    extractedBy: z.string().nullish(),
    skipRate: z.number(),
    skippedCount: z.number(),
  });
}

export function SetSourceStatusInputSchema(): z.ZodObject<
  Properties<SetSourceStatusInput>
> {
  return z.object({
    status: SourceStatusSchema,
  });
}

export function SourceProvenanceSchema(): z.ZodObject<
  Properties<SourceProvenance>
> {
  return z.object({
    __typename: z.literal("SourceProvenance").optional(),
    author: z.string().nullish(),
    method: z.string().nullish(),
    publishedAt: z.iso.datetime().nullish(),
    tool: z.string().nullish(),
    url: z.string().nullish(),
  });
}

export function SourceStateSchema(): z.ZodObject<Properties<SourceState>> {
  return z.object({
    __typename: z.literal("SourceState").optional(),
    content: z.string().nullish(),
    createdAt: z.iso.datetime().nullish(),
    createdBy: z.string().nullish(),
    description: z.string().nullish(),
    extractedClaims: z.array(z.string()),
    extractionStats: z.lazy(() => ExtractionStatsSchema().nullish()),
    provenance: z.lazy(() => SourceProvenanceSchema().nullish()),
    sourceType: SourceTypeSchema.nullish(),
    status: SourceStatusSchema.nullish(),
    title: z.string().nullish(),
  });
}
