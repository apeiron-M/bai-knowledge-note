/* eslint-disable @typescript-eslint/no-empty-object-type */

import * as z from "zod";
import type {
  AddEdgeInput,
  AddNodeInput,
  GraphEdge,
  GraphEdgeInput,
  GraphNode,
  GraphNodeInput,
  KnowledgeGraphState,
  RemoveEdgeInput,
  RemoveNodeInput,
  SyncGraphInput,
  UpdateEdgeInput,
  UpdateNodeInput,
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

export function AddEdgeInputSchema(): z.ZodObject<Properties<AddEdgeInput>> {
  return z.object({
    id: z.string(),
    linkType: z.string().nullish(),
    sourceDocumentId: z.string(),
    targetDocumentId: z.string(),
  });
}

export function AddNodeInputSchema(): z.ZodObject<Properties<AddNodeInput>> {
  return z.object({
    documentId: z.string(),
    id: z.string(),
    noteType: z.string().nullish(),
    status: z.string().nullish(),
    title: z.string().nullish(),
  });
}

export function GraphEdgeSchema(): z.ZodObject<Properties<GraphEdge>> {
  return z.object({
    __typename: z.literal("GraphEdge").optional(),
    id: z.string(),
    linkType: z.string().nullish(),
    sourceDocumentId: z.string(),
    targetDocumentId: z.string(),
  });
}

export function GraphEdgeInputSchema(): z.ZodObject<
  Properties<GraphEdgeInput>
> {
  return z.object({
    id: z.string(),
    linkType: z.string().nullish(),
    sourceDocumentId: z.string(),
    targetDocumentId: z.string(),
  });
}

export function GraphNodeSchema(): z.ZodObject<Properties<GraphNode>> {
  return z.object({
    __typename: z.literal("GraphNode").optional(),
    documentId: z.string(),
    id: z.string(),
    noteType: z.string().nullish(),
    status: z.string().nullish(),
    title: z.string().nullish(),
  });
}

export function GraphNodeInputSchema(): z.ZodObject<
  Properties<GraphNodeInput>
> {
  return z.object({
    documentId: z.string(),
    id: z.string(),
    noteType: z.string().nullish(),
    status: z.string().nullish(),
    title: z.string().nullish(),
  });
}

export function KnowledgeGraphStateSchema(): z.ZodObject<
  Properties<KnowledgeGraphState>
> {
  return z.object({
    __typename: z.literal("KnowledgeGraphState").optional(),
    edges: z.array(z.lazy(() => GraphEdgeSchema())),
    lastSyncedAt: z.iso.datetime().nullish(),
    nodes: z.array(z.lazy(() => GraphNodeSchema())),
  });
}

export function RemoveEdgeInputSchema(): z.ZodObject<
  Properties<RemoveEdgeInput>
> {
  return z.object({
    id: z.string(),
  });
}

export function RemoveNodeInputSchema(): z.ZodObject<
  Properties<RemoveNodeInput>
> {
  return z.object({
    documentId: z.string(),
  });
}

export function SyncGraphInputSchema(): z.ZodObject<
  Properties<SyncGraphInput>
> {
  return z.object({
    edges: z.array(z.lazy(() => GraphEdgeInputSchema())),
    nodes: z.array(z.lazy(() => GraphNodeInputSchema())),
    syncedAt: z.iso.datetime(),
  });
}

export function UpdateEdgeInputSchema(): z.ZodObject<
  Properties<UpdateEdgeInput>
> {
  return z.object({
    id: z.string(),
    linkType: z.string().nullish(),
  });
}

export function UpdateNodeInputSchema(): z.ZodObject<
  Properties<UpdateNodeInput>
> {
  return z.object({
    documentId: z.string(),
    noteType: z.string().nullish(),
    status: z.string().nullish(),
    title: z.string().nullish(),
  });
}
