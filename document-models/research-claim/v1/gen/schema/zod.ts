/* eslint-disable @typescript-eslint/no-empty-object-type */
import * as z from "zod";
import type {
  AddResearchConnectionInput,
  CreateClaimInput,
  RemoveResearchConnectionInput,
  ResearchClaimState,
  ResearchConnection,
  UpdateClaimContentInput,
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

export function AddResearchConnectionInputSchema(): z.ZodObject<
  Properties<AddResearchConnectionInput>
> {
  return z.object({
    contextPhrase: z.string(),
    id: z.string(),
    targetRef: z.string(),
  });
}

export function CreateClaimInputSchema(): z.ZodObject<
  Properties<CreateClaimInput>
> {
  return z.object({
    content: z.string(),
    description: z.string(),
    kind: z.string(),
    methodology: z.array(z.string()),
    sources: z.array(z.string()),
    title: z.string(),
    topics: z.array(z.string()),
  });
}

export function RemoveResearchConnectionInputSchema(): z.ZodObject<
  Properties<RemoveResearchConnectionInput>
> {
  return z.object({
    id: z.string(),
  });
}

export function ResearchClaimStateSchema(): z.ZodObject<
  Properties<ResearchClaimState>
> {
  return z.object({
    __typename: z.literal("ResearchClaimState").optional(),
    connections: z.array(z.lazy(() => ResearchConnectionSchema())),
    content: z.string().nullish(),
    description: z.string().nullish(),
    kind: z.string().nullish(),
    methodology: z.array(z.string()),
    sources: z.array(z.string()),
    title: z.string().nullish(),
    topics: z.array(z.string()),
  });
}

export function ResearchConnectionSchema(): z.ZodObject<
  Properties<ResearchConnection>
> {
  return z.object({
    __typename: z.literal("ResearchConnection").optional(),
    contextPhrase: z.string(),
    id: z.string(),
    targetRef: z.string(),
  });
}

export function UpdateClaimContentInputSchema(): z.ZodObject<
  Properties<UpdateClaimContentInput>
> {
  return z.object({
    content: z.string(),
  });
}
