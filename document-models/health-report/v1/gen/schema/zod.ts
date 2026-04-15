/* eslint-disable @typescript-eslint/no-empty-object-type */
import * as z from "zod";
import type {
  AddCheckInput,
  GenerateReportInput,
  GraphMetrics,
  GraphMetricsInput,
  HealthCategory,
  HealthCheck,
  HealthReportState,
  HealthStatus,
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

export const HealthCategorySchema = z.enum([
  "DESCRIPTION_QUALITY",
  "LINK_HEALTH",
  "MOC_COHERENCE",
  "ORPHAN_DETECTION",
  "PROCESSING_THROUGHPUT",
  "SCHEMA_COMPLIANCE",
  "STALE_NOTES",
  "THREE_SPACE_BOUNDARIES",
]);

export const HealthStatusSchema = z.enum(["FAIL", "PASS", "WARN"]);

export function AddCheckInputSchema(): z.ZodObject<Properties<AddCheckInput>> {
  return z.object({
    affectedItems: z.array(z.string()),
    category: HealthCategorySchema,
    id: z.string(),
    message: z.string(),
    status: HealthStatusSchema,
  });
}

export function GenerateReportInputSchema(): z.ZodObject<
  Properties<GenerateReportInput>
> {
  return z.object({
    generatedAt: z.iso.datetime(),
    generatedBy: z.string().nullish(),
    graphMetrics: z.lazy(() => GraphMetricsInputSchema()),
    mode: z.string(),
    overallStatus: HealthStatusSchema,
    recommendations: z.array(z.string()),
  });
}

export function GraphMetricsSchema(): z.ZodObject<Properties<GraphMetrics>> {
  return z.object({
    __typename: z.literal("GraphMetrics").optional(),
    averageLinksPerNote: z.number(),
    connectionCount: z.number(),
    danglingLinkCount: z.number(),
    density: z.number(),
    mocCount: z.number(),
    mocCoverage: z.number(),
    noteCount: z.number(),
    orphanCount: z.number(),
  });
}

export function GraphMetricsInputSchema(): z.ZodObject<
  Properties<GraphMetricsInput>
> {
  return z.object({
    averageLinksPerNote: z.number(),
    connectionCount: z.number(),
    danglingLinkCount: z.number(),
    density: z.number(),
    mocCount: z.number(),
    mocCoverage: z.number(),
    noteCount: z.number(),
    orphanCount: z.number(),
  });
}

export function HealthCheckSchema(): z.ZodObject<Properties<HealthCheck>> {
  return z.object({
    __typename: z.literal("HealthCheck").optional(),
    affectedItems: z.array(z.string()),
    category: HealthCategorySchema,
    id: z.string(),
    message: z.string(),
    status: HealthStatusSchema,
  });
}

export function HealthReportStateSchema(): z.ZodObject<
  Properties<HealthReportState>
> {
  return z.object({
    __typename: z.literal("HealthReportState").optional(),
    checks: z.array(z.lazy(() => HealthCheckSchema())),
    generatedAt: z.iso.datetime().nullish(),
    generatedBy: z.string().nullish(),
    graphMetrics: z.lazy(() => GraphMetricsSchema().nullish()),
    mode: z.string().nullish(),
    overallStatus: HealthStatusSchema.nullish(),
    recommendations: z.array(z.string()),
  });
}
