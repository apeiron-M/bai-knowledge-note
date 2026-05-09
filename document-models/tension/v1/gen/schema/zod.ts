/* eslint-disable @typescript-eslint/no-empty-object-type */
/* eslint-disable @typescript-eslint/no-unused-vars */
import * as z from "zod";
import type {
  AddInvolvedRefInput,
  CreateTensionInput,
  DissolveTensionInput,
  ResolveTensionInput,
  TensionState,
  TensionStatus,
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

export const TensionStatusSchema = z.enum(["DISSOLVED", "OPEN", "RESOLVED"]);

export function AddInvolvedRefInputSchema(): z.ZodObject<
  Properties<AddInvolvedRefInput>
> {
  return z.object({
    ref: z.string(),
  });
}

export function CreateTensionInputSchema(): z.ZodObject<
  Properties<CreateTensionInput>
> {
  return z.object({
    content: z.string().nullish(),
    description: z.string(),
    involvedRefs: z.array(z.string()),
    observedAt: z.iso.datetime(),
    observedBy: z.string().nullish(),
    title: z.string(),
  });
}

export function DissolveTensionInputSchema(): z.ZodObject<
  Properties<DissolveTensionInput>
> {
  return z.object({
    resolution: z.string(),
    resolvedAt: z.iso.datetime(),
  });
}

export function ResolveTensionInputSchema(): z.ZodObject<
  Properties<ResolveTensionInput>
> {
  return z.object({
    resolution: z.string(),
    resolvedAt: z.iso.datetime(),
  });
}

export function TensionStateSchema(): z.ZodObject<Properties<TensionState>> {
  return z.object({
    __typename: z.literal("TensionState").optional(),
    content: z.string().nullish(),
    description: z.string().nullish(),
    involvedRefs: z.array(z.string()),
    observedAt: z.iso.datetime().nullish(),
    observedBy: z.string().nullish(),
    resolution: z.string().nullish(),
    resolvedAt: z.iso.datetime().nullish(),
    status: TensionStatusSchema.nullish(),
    title: z.string().nullish(),
  });
}
