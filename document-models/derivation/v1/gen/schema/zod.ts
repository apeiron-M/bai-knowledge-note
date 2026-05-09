/* eslint-disable @typescript-eslint/no-empty-object-type */

import * as z from "zod";
import type {
  AddReseedEntryInput,
  AddSignalInput,
  ClaimReference,
  CoherenceCheck,
  DerivationSignal,
  DerivationState,
  DimensionRationale,
  FeatureDecision,
  InitializeDerivationInput,
  ReseedEntry,
  UpdateDimensionRationaleInput,
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

export function AddReseedEntryInputSchema(): z.ZodObject<
  Properties<AddReseedEntryInput>
> {
  return z.object({
    changes: z.array(z.string()),
    id: z.string(),
    reason: z.string(),
    reseededAt: z.iso.datetime(),
  });
}

export function AddSignalInputSchema(): z.ZodObject<
  Properties<AddSignalInput>
> {
  return z.object({
    id: z.string(),
    influencedDimensions: z.array(z.string()),
    interpretation: z.string(),
    utterance: z.string(),
  });
}

export function ClaimReferenceSchema(): z.ZodObject<
  Properties<ClaimReference>
> {
  return z.object({
    __typename: z.literal("ClaimReference").optional(),
    claimRef: z.string(),
    id: z.string(),
    strength: z.string(),
    supportsDecision: z.string(),
  });
}

export function CoherenceCheckSchema(): z.ZodObject<
  Properties<CoherenceCheck>
> {
  return z.object({
    __typename: z.literal("CoherenceCheck").optional(),
    coherent: z.boolean(),
    dimensionPair: z.array(z.string()),
    explanation: z.string(),
  });
}

export function DerivationSignalSchema(): z.ZodObject<
  Properties<DerivationSignal>
> {
  return z.object({
    __typename: z.literal("DerivationSignal").optional(),
    id: z.string(),
    influencedDimensions: z.array(z.string()),
    interpretation: z.string(),
    utterance: z.string(),
  });
}

export function DerivationStateSchema(): z.ZodObject<
  Properties<DerivationState>
> {
  return z.object({
    __typename: z.literal("DerivationState").optional(),
    claimReferences: z.array(z.lazy(() => ClaimReferenceSchema())),
    coherenceResults: z.array(z.lazy(() => CoherenceCheckSchema())),
    derivedAt: z.iso.datetime().nullish(),
    dimensionRationale: z.array(z.lazy(() => DimensionRationaleSchema())),
    engineVersion: z.string().nullish(),
    featureDecisions: z.array(z.lazy(() => FeatureDecisionSchema())),
    reseedHistory: z.array(z.lazy(() => ReseedEntrySchema())),
    signals: z.array(z.lazy(() => DerivationSignalSchema())),
  });
}

export function DimensionRationaleSchema(): z.ZodObject<
  Properties<DimensionRationale>
> {
  return z.object({
    __typename: z.literal("DimensionRationale").optional(),
    confidence: z.number(),
    dimension: z.string(),
    failureModes: z.array(z.string()),
    position: z.number(),
    rationale: z.string(),
    supportingClaims: z.array(z.string()),
  });
}

export function FeatureDecisionSchema(): z.ZodObject<
  Properties<FeatureDecision>
> {
  return z.object({
    __typename: z.literal("FeatureDecision").optional(),
    enabled: z.boolean(),
    feature: z.string(),
    rationale: z.string(),
    supportingClaims: z.array(z.string()),
  });
}

export function InitializeDerivationInputSchema(): z.ZodObject<
  Properties<InitializeDerivationInput>
> {
  return z.object({
    derivedAt: z.iso.datetime(),
    engineVersion: z.string(),
  });
}

export function ReseedEntrySchema(): z.ZodObject<Properties<ReseedEntry>> {
  return z.object({
    __typename: z.literal("ReseedEntry").optional(),
    changes: z.array(z.string()),
    id: z.string(),
    reason: z.string(),
    reseededAt: z.iso.datetime(),
  });
}

export function UpdateDimensionRationaleInputSchema(): z.ZodObject<
  Properties<UpdateDimensionRationaleInput>
> {
  return z.object({
    confidence: z.number(),
    dimension: z.string(),
    failureModes: z.array(z.string()),
    position: z.number(),
    rationale: z.string(),
    supportingClaims: z.array(z.string()),
  });
}
