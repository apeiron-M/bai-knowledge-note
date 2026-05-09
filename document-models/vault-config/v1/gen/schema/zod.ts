/* eslint-disable @typescript-eslint/no-empty-object-type */

import * as z from "zod";
import type {
  AddExtractionCategoryInput,
  DimensionConfig,
  DimensionPosition,
  ExtractionCategory,
  InitializeConfigInput,
  MaintenanceConfig,
  MocSchemaConfig,
  NoteSchemaConfig,
  PipelineConfig,
  ToggleExtractionCategoryInput,
  ToggleFeatureInput,
  UpdateDimensionInput,
  UpdateMaintenanceThresholdInput,
  UpdatePipelineConfigInput,
  UpdateVocabularyInput,
  VaultConfigState,
  VocabularyMap,
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

export function AddExtractionCategoryInputSchema(): z.ZodObject<
  Properties<AddExtractionCategoryInput>
> {
  return z.object({
    active: z.boolean(),
    description: z.string(),
    id: z.string(),
    name: z.string(),
  });
}

export function DimensionConfigSchema(): z.ZodObject<
  Properties<DimensionConfig>
> {
  return z.object({
    __typename: z.literal("DimensionConfig").optional(),
    automation: z.lazy(() => DimensionPositionSchema()),
    granularity: z.lazy(() => DimensionPositionSchema()),
    linking: z.lazy(() => DimensionPositionSchema()),
    maintenance: z.lazy(() => DimensionPositionSchema()),
    navigation: z.lazy(() => DimensionPositionSchema()),
    organization: z.lazy(() => DimensionPositionSchema()),
    processing: z.lazy(() => DimensionPositionSchema()),
    schema: z.lazy(() => DimensionPositionSchema()),
  });
}

export function DimensionPositionSchema(): z.ZodObject<
  Properties<DimensionPosition>
> {
  return z.object({
    __typename: z.literal("DimensionPosition").optional(),
    confidence: z.number(),
    rationale: z.string().nullish(),
    value: z.number(),
  });
}

export function ExtractionCategorySchema(): z.ZodObject<
  Properties<ExtractionCategory>
> {
  return z.object({
    __typename: z.literal("ExtractionCategory").optional(),
    active: z.boolean(),
    description: z.string(),
    id: z.string(),
    name: z.string(),
  });
}

export function InitializeConfigInputSchema(): z.ZodObject<
  Properties<InitializeConfigInput>
> {
  return z.object({
    domain: z.string(),
    name: z.string(),
    updatedAt: z.iso.datetime(),
  });
}

export function MaintenanceConfigSchema(): z.ZodObject<
  Properties<MaintenanceConfig>
> {
  return z.object({
    __typename: z.literal("MaintenanceConfig").optional(),
    danglingThreshold: z.number(),
    inboxPressure: z.number(),
    mocOversize: z.number(),
    observationAccumulation: z.number(),
    orphanThreshold: z.number(),
    staleNoteDays: z.number(),
    tensionAccumulation: z.number(),
  });
}

export function MocSchemaConfigSchema(): z.ZodObject<
  Properties<MocSchemaConfig>
> {
  return z.object({
    __typename: z.literal("MocSchemaConfig").optional(),
    requiredFields: z.array(z.string()),
    tierValues: z.array(z.string()),
  });
}

export function NoteSchemaConfigSchema(): z.ZodObject<
  Properties<NoteSchemaConfig>
> {
  return z.object({
    __typename: z.literal("NoteSchemaConfig").optional(),
    confidenceValues: z.array(z.string()),
    kindValues: z.array(z.string()),
    optionalFields: z.array(z.string()),
    requiredFields: z.array(z.string()),
  });
}

export function PipelineConfigSchema(): z.ZodObject<
  Properties<PipelineConfig>
> {
  return z.object({
    __typename: z.literal("PipelineConfig").optional(),
    autoChain: z.boolean(),
    depth: z.string(),
    extractionSelectivity: z.number(),
  });
}

export function ToggleExtractionCategoryInputSchema(): z.ZodObject<
  Properties<ToggleExtractionCategoryInput>
> {
  return z.object({
    active: z.boolean(),
    id: z.string(),
  });
}

export function ToggleFeatureInputSchema(): z.ZodObject<
  Properties<ToggleFeatureInput>
> {
  return z.object({
    enabled: z.boolean(),
    feature: z.string(),
  });
}

export function UpdateDimensionInputSchema(): z.ZodObject<
  Properties<UpdateDimensionInput>
> {
  return z.object({
    confidence: z.number(),
    dimension: z.string(),
    rationale: z.string().nullish(),
    updatedAt: z.iso.datetime(),
    value: z.number(),
  });
}

export function UpdateMaintenanceThresholdInputSchema(): z.ZodObject<
  Properties<UpdateMaintenanceThresholdInput>
> {
  return z.object({
    condition: z.string(),
    threshold: z.number(),
    updatedAt: z.iso.datetime(),
  });
}

export function UpdatePipelineConfigInputSchema(): z.ZodObject<
  Properties<UpdatePipelineConfigInput>
> {
  return z.object({
    autoChain: z.boolean().nullish(),
    depth: z.string().nullish(),
    extractionSelectivity: z.number().nullish(),
    updatedAt: z.iso.datetime(),
  });
}

export function UpdateVocabularyInputSchema(): z.ZodObject<
  Properties<UpdateVocabularyInput>
> {
  return z.object({
    key: z.string(),
    updatedAt: z.iso.datetime(),
    value: z.string(),
  });
}

export function VaultConfigStateSchema(): z.ZodObject<
  Properties<VaultConfigState>
> {
  return z.object({
    __typename: z.literal("VaultConfigState").optional(),
    dimensions: z.lazy(() => DimensionConfigSchema().nullish()),
    domain: z.string().nullish(),
    extractionCategories: z.array(z.lazy(() => ExtractionCategorySchema())),
    features: z.array(z.string()),
    maintenance: z.lazy(() => MaintenanceConfigSchema().nullish()),
    mocSchema: z.lazy(() => MocSchemaConfigSchema().nullish()),
    name: z.string().nullish(),
    noteSchema: z.lazy(() => NoteSchemaConfigSchema().nullish()),
    pipeline: z.lazy(() => PipelineConfigSchema().nullish()),
    updatedAt: z.iso.datetime().nullish(),
    vocabulary: z.lazy(() => VocabularyMapSchema().nullish()),
  });
}

export function VocabularyMapSchema(): z.ZodObject<Properties<VocabularyMap>> {
  return z.object({
    __typename: z.literal("VocabularyMap").optional(),
    description: z.string(),
    inbox: z.string(),
    notes: z.string(),
    reduce: z.string(),
    reflect: z.string(),
    rethink: z.string(),
    reweave: z.string(),
    topicMap: z.string(),
    verify: z.string(),
  });
}
