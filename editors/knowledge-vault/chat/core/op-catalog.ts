/**
 * Operation catalog for the in-browser chat (spike). Each op records which
 * input fields the LLM may fill (`semantic`) and which the app supplies
 * (`new-id`, `timestamp`, `actor`, and `ref-id` when candidates are known).
 * Barrels are injected by `catalog-models.ts`; nothing here imports a model.
 */
import * as z from "zod";
import type { Action } from "document-model";

export type FieldClass =
  | "new-id"
  | "ref-id"
  | "timestamp"
  | "actor"
  | "semantic";

export interface CatalogField {
  /** Path from the input root, e.g. ["handoff", "completedAt"]. */
  path: string[];
  name: string;
  /** Bare GraphQL type name (no `!` / `[]`). */
  gqlType: string;
  list: boolean;
  required: boolean;
  fieldClass: FieldClass;
  /** Child fields when `gqlType` is another input object. */
  children?: CatalogField[];
}

export type JsonSchema = Record<string, unknown>;

export type ActionCreator = (input: Record<string, unknown>) => Action;

export interface CatalogEntry {
  /** `<model>:<OP>`, e.g. `knowledge-note:ADD_TOPIC`. */
  key: string;
  /** docType without the `bai/` prefix, e.g. `knowledge-note`, `wbs`. */
  model: string;
  docType: string;
  opName: string;
  creatorName: string;
  description: string;
  module: string;
  scope: string;
  fields: CatalogField[];
  /** JSON Schema of the semantic fields only, without ref-id candidates. */
  modelSchema: JsonSchema;
  /** Full JSON Schema of the operation input (as zod sees it). */
  inputJsonSchema: JsonSchema;
  zod: z.ZodType;
  creator: ActionCreator;
}

/* ------------------------------------------------------------------ */
/* Injected model shape                                                 */
/* ------------------------------------------------------------------ */

interface OperationSpecLike {
  name?: string | null;
  description?: string | null;
  schema?: string | null;
  scope?: string | null;
}

interface ModuleSpecLike {
  name: string;
  operations: readonly OperationSpecLike[];
}

export interface CatalogModuleLike {
  documentModel: {
    global: {
      id: string;
      specifications: readonly { modules: readonly ModuleSpecLike[] }[];
    };
  };
  actions: Record<string, unknown>;
}

export interface CatalogModelInput {
  /** The `DocumentModelModule` (e.g. `KN.KnowledgeNote`). */
  module: CatalogModuleLike;
  /** The barrel namespace, used to look up `<Op>InputSchema` functions. */
  schemas: Record<string, unknown>;
}

export interface BuildCatalogOptions {
  /** Field-class overrides keyed `<model>:<OP>:<dotted.path>`. */
  overrides?: Partial<Record<string, FieldClass>>;
  /** Collapse `anyOf: [X, {type: null}]` to plain optional `X`. */
  collapseNullable?: boolean;
}

/**
 * Exceptions to the prefix rules, verified against the reducers:
 * - knowledge-note lifecycle transitions push `id` as a new lifecycle event.
 * - wbs ADD_NOTE creates a note with `noteId`.
 * - wbs ADD_DEPENDENCIES' `id` is the existing goal being modified.
 */
export const DEFAULT_FIELD_OVERRIDES: Record<string, FieldClass> = {
  "knowledge-note:SUBMIT_FOR_REVIEW:id": "new-id",
  "knowledge-note:APPROVE_NOTE:id": "new-id",
  "knowledge-note:REJECT_NOTE:id": "new-id",
  "knowledge-note:ARCHIVE_NOTE:id": "new-id",
  "knowledge-note:RESTORE_NOTE:id": "new-id",
  "wbs:ADD_NOTE:noteId": "new-id",
  "wbs:ADD_DEPENDENCIES:id": "ref-id",
};

/* ------------------------------------------------------------------ */
/* Name helpers                                                         */
/* ------------------------------------------------------------------ */

export function opToCamel(op: string): string {
  return op
    .toLowerCase()
    .replace(/_([a-z0-9])/g, (_m, c: string) => c.toUpperCase());
}

export function opToPascal(op: string): string {
  const camel = opToCamel(op);
  return camel.charAt(0).toUpperCase() + camel.slice(1);
}

export function modelFromDocType(docType: string): string {
  const slash = docType.indexOf("/");
  return slash === -1 ? docType : docType.slice(slash + 1);
}

/* ------------------------------------------------------------------ */
/* GraphQL SDL parsing (input types only)                               */
/* ------------------------------------------------------------------ */

interface SdlField {
  name: string;
  type: string;
}

export function parseInputSdl(sdl: string): Map<string, SdlField[]> {
  const types = new Map<string, SdlField[]>();
  const re = /input\s+(\w+)\s*\{([^}]*)\}/g;
  for (const m of sdl.matchAll(re)) {
    const fields: SdlField[] = [];
    for (const line of m[2].split(/\n|,/)) {
      const fm = /^\s*(\w+)\s*:\s*([\w[\]!]+)/.exec(line);
      if (fm) fields.push({ name: fm[1], type: fm[2] });
    }
    types.set(m[1], fields);
  }
  return types;
}

function classifyField(
  model: string,
  opName: string,
  path: string[],
  gqlType: string,
  overrides: Partial<Record<string, FieldClass>>,
): FieldClass {
  const override = overrides[`${model}:${opName}:${path.join(".")}`];
  if (override) return override;
  const name = path[path.length - 1];
  if (gqlType === "DateTime") return "timestamp";
  if (name === "actor" || /By$/.test(name)) return "actor";
  if (gqlType === "OID") {
    if (name === "id") {
      // A nested input object is always a new record (e.g. a phase handoff).
      if (path.length > 1) return "new-id";
      if (/^(ADD|CREATE)_/.test(opName)) return "new-id";
    }
    return "ref-id";
  }
  if (gqlType === "PHID") return "ref-id";
  if (/Id$/.test(name)) return "ref-id";
  return "semantic";
}

function buildFields(
  model: string,
  opName: string,
  typeName: string,
  types: Map<string, SdlField[]>,
  overrides: Partial<Record<string, FieldClass>>,
  parentPath: string[],
): CatalogField[] {
  const sdlFields = types.get(typeName) ?? [];
  return sdlFields.map((f) => {
    const list = f.type.includes("[");
    const required = f.type.endsWith("!");
    const gqlType = f.type.replace(/[[\]!]/g, "");
    const path = [...parentPath, f.name];
    const nested = types.get(gqlType);
    if (nested) {
      return {
        path,
        name: f.name,
        gqlType,
        list,
        required,
        fieldClass: "semantic" as const,
        children: buildFields(model, opName, gqlType, types, overrides, path),
      };
    }
    return {
      path,
      name: f.name,
      gqlType,
      list,
      required,
      fieldClass: classifyField(model, opName, path, gqlType, overrides),
    };
  });
}

/** Depth-first list of leaf fields (nested containers are not leaves). */
export function leafFields(fields: CatalogField[]): CatalogField[] {
  return fields.flatMap((f) => (f.children ? leafFields(f.children) : [f]));
}

/* ------------------------------------------------------------------ */
/* Model-facing JSON Schema                                             */
/* ------------------------------------------------------------------ */

export interface ModelSchemaOptions {
  /** Candidate ids per ref-id field, keyed by dotted path. */
  refCandidates?: Record<string, string[]>;
  collapseNullable?: boolean;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function collapseNull(schema: unknown): unknown {
  if (!isRecord(schema)) return schema;
  const anyOf = schema.anyOf;
  if (Array.isArray(anyOf)) {
    const nonNull = anyOf.filter((s) => !(isRecord(s) && s.type === "null"));
    if (nonNull.length === 1) return nonNull[0];
  }
  return schema;
}

function enumSchema(field: CatalogField, ids: string[]): JsonSchema {
  const item: JsonSchema = { type: "string", enum: ids };
  return field.list ? { type: "array", items: item } : item;
}

function projectObject(
  fields: CatalogField[],
  jsonSchema: JsonSchema,
  opts: ModelSchemaOptions,
): JsonSchema | null {
  const props = isRecord(jsonSchema.properties) ? jsonSchema.properties : {};
  const required = Array.isArray(jsonSchema.required)
    ? jsonSchema.required.filter((r): r is string => typeof r === "string")
    : [];
  const outProps: Record<string, unknown> = {};
  for (const field of fields) {
    const sub = props[field.name];
    const key = field.path.join(".");
    if (field.children) {
      const inner = collapseNull(sub);
      if (!isRecord(inner)) continue;
      const projected = projectObject(field.children, inner, opts);
      if (projected) outProps[field.name] = projected;
      continue;
    }
    if (field.fieldClass === "semantic") {
      outProps[field.name] = opts.collapseNullable ? collapseNull(sub) : sub;
    } else if (field.fieldClass === "ref-id") {
      const ids = opts.refCandidates?.[key];
      if (ids && ids.length > 0) outProps[field.name] = enumSchema(field, ids);
    }
  }
  const names = Object.keys(outProps);
  if (names.length === 0) return null;
  return {
    type: "object",
    properties: outProps,
    required: required.filter((r) => names.includes(r)),
    additionalProperties: false,
  };
}

/**
 * JSON Schema the constrained decoder sees: only semantic fields, plus
 * ref-id fields turned into enums when candidates are supplied. Always an
 * object (possibly with no properties).
 */
export function buildModelSchema(
  entry: Pick<CatalogEntry, "fields" | "inputJsonSchema">,
  opts: ModelSchemaOptions = {},
): JsonSchema {
  return (
    projectObject(entry.fields, entry.inputJsonSchema, opts) ?? {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    }
  );
}

export function semanticFieldNames(entry: Pick<CatalogEntry, "modelSchema">) {
  const props = entry.modelSchema.properties;
  return isRecord(props) ? Object.keys(props) : [];
}

/* ------------------------------------------------------------------ */
/* Catalog                                                              */
/* ------------------------------------------------------------------ */

function isCreator(v: unknown): v is ActionCreator {
  return typeof v === "function";
}

function isSchemaFactory(v: unknown): v is () => unknown {
  return typeof v === "function";
}

export function buildCatalog(
  models: CatalogModelInput[],
  options: BuildCatalogOptions = {},
): CatalogEntry[] {
  const overrides = { ...DEFAULT_FIELD_OVERRIDES, ...options.overrides };
  const entries: CatalogEntry[] = [];
  for (const { module, schemas } of models) {
    const docType = module.documentModel.global.id;
    const model = modelFromDocType(docType);
    const spec = module.documentModel.global.specifications[0];
    for (const mod of spec.modules) {
      for (const op of mod.operations) {
        const opName = op.name;
        if (!opName) continue;
        const pascal = opToPascal(opName);
        const creatorName = opToCamel(opName);
        const factory = schemas[`${pascal}InputSchema`];
        const creator = module.actions[creatorName];
        if (!isSchemaFactory(factory) || !isCreator(creator)) {
          throw new Error(`catalog: missing schema or creator for ${opName}`);
        }
        const zod = factory();
        if (!(zod instanceof z.ZodType)) {
          throw new Error(`catalog: ${pascal}InputSchema is not a zod schema`);
        }
        const types = parseInputSdl(op.schema ?? "");
        const fields = buildFields(
          model,
          opName,
          `${pascal}Input`,
          types,
          overrides,
          [],
        );
        const full = z.toJSONSchema(zod, { io: "input" }) as JsonSchema;
        const { $schema: _drop, ...inputJsonSchema } = full;
        const base = { fields, inputJsonSchema };
        entries.push({
          key: `${model}:${opName}`,
          model,
          docType,
          opName,
          creatorName,
          description: op.description ?? "",
          module: mod.name,
          scope: op.scope ?? "global",
          fields,
          inputJsonSchema,
          modelSchema: buildModelSchema(base, {
            collapseNullable: options.collapseNullable,
          }),
          zod,
          creator,
        });
      }
    }
  }
  return entries;
}
