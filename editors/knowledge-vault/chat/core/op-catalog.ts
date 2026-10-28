/**
 * Operation catalog for the in-browser chat. The machinery moved to
 * nl-runtime (core/op-catalog) in M1; the vault keeps its field overrides
 * and binds them in `buildCatalog`, so the old signature still applies them.
 */
import {
  buildCatalog as coreBuildCatalog,
  type BuildCatalogOptions,
  type CatalogEntry,
  type CatalogModelInput,
  type FieldClass,
} from "nl-runtime";
import { chatManifest } from "../../../../chat-manifest/index.js";

export {
  type ActionCreator,
  type BuildCatalogOptions,
  buildModelSchema,
  type CatalogEntry,
  type CatalogField,
  type CatalogModelInput,
  type CatalogModuleLike,
  type FieldClass,
  type JsonSchema,
  leafFields,
  modelFromDocType,
  type ModelSchemaOptions,
  opToCamel,
  opToPascal,
  parseInputSdl,
  semanticFieldNames,
} from "nl-runtime";

/**
 * Exceptions to the prefix rules, verified against the reducers. M2: all 7
 * derive from the reducers (`nl-generate`); this is the generated manifest's
 * table (`chat-manifest/`).
 * - knowledge-note lifecycle transitions push `id` as a new lifecycle event.
 * - wbs ADD_NOTE creates a note with `noteId`.
 * - wbs ADD_DEPENDENCIES' `id` is the existing goal being modified.
 */
export const DEFAULT_FIELD_OVERRIDES: Readonly<Record<string, FieldClass>> =
  chatManifest.fieldOverrides;

/** The core catalog with the vault's overrides under `options.overrides`. */
export function buildCatalog(
  models: CatalogModelInput[],
  options: BuildCatalogOptions = {},
): CatalogEntry[] {
  return coreBuildCatalog(models, {
    ...options,
    overrides: { ...DEFAULT_FIELD_OVERRIDES, ...options.overrides },
  });
}
