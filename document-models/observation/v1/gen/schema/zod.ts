/* eslint-disable @typescript-eslint/no-empty-object-type */
import * as z from "zod";
import type {
  ArchiveObservationInput,
  CreateObservationInput,
  ImplementObservationInput,
  ObservationCategory,
  ObservationState,
  ObservationStatus,
  PromoteObservationInput,
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

export const ObservationCategorySchema = z.enum([
  "FRICTION",
  "METHODOLOGY",
  "PROCESS",
  "QUALITY",
  "SURPRISE",
]);

export const ObservationStatusSchema = z.enum([
  "ARCHIVED",
  "IMPLEMENTED",
  "PENDING",
  "PROMOTED",
]);

export function ArchiveObservationInputSchema(): z.ZodObject<
  Properties<ArchiveObservationInput>
> {
  return z.object({
    updatedAt: z.iso.datetime(),
  });
}

export function CreateObservationInputSchema(): z.ZodObject<
  Properties<CreateObservationInput>
> {
  return z.object({
    category: ObservationCategorySchema,
    content: z.string().nullish(),
    description: z.string(),
    observedAt: z.iso.datetime(),
    observedBy: z.string().nullish(),
    title: z.string(),
  });
}

export function ImplementObservationInputSchema(): z.ZodObject<
  Properties<ImplementObservationInput>
> {
  return z.object({
    updatedAt: z.iso.datetime(),
  });
}

export function ObservationStateSchema(): z.ZodObject<
  Properties<ObservationState>
> {
  return z.object({
    __typename: z.literal("ObservationState").optional(),
    category: ObservationCategorySchema.nullish(),
    content: z.string().nullish(),
    description: z.string().nullish(),
    observedAt: z.iso.datetime().nullish(),
    observedBy: z.string().nullish(),
    promotedAt: z.iso.datetime().nullish(),
    promotedTo: z.string().nullish(),
    status: ObservationStatusSchema.nullish(),
    title: z.string().nullish(),
  });
}

export function PromoteObservationInputSchema(): z.ZodObject<
  Properties<PromoteObservationInput>
> {
  return z.object({
    promotedAt: z.iso.datetime(),
    promotedTo: z.string(),
  });
}
