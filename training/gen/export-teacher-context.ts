/**
 * Per-op context for the teacher prompts: description, input SDL, the
 * semantic-field schema, reducer source, sibling ops and an empty document
 * state. Eval utterances are never read here.
 *
 *   npx --no-install tsx training/gen/export-teacher-context.ts <out.json>
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CATALOG_MODELS } from "../../editors/knowledge-vault/chat/core/catalog-models.js";
import { buildTrainingCatalog } from "./prompt-format.js";

const repo = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

interface SpecLike {
  modules: {
    name: string;
    operations: { name?: string | null; schema?: string | null }[];
  }[];
}

function modelDirFor(docType: string): string | null {
  const root = path.join(repo, "document-models");
  for (const dir of readdirSync(root)) {
    const spec = path.join(root, dir, `${dir}.json`);
    if (
      existsSync(spec) &&
      readFileSync(spec, "utf8").includes(`"${docType}"`)
    ) {
      return dir;
    }
  }
  return null;
}

function reducerSource(dir: string | null, moduleName: string): string | null {
  if (!dir) return null;
  const kebab = moduleName.replace(/[\s_]+/g, "-").toLowerCase();
  for (const name of [moduleName, kebab]) {
    const file = path.join(
      repo,
      "document-models",
      dir,
      "v1/src/reducers",
      `${name}.ts`,
    );
    if (existsSync(file)) return readFileSync(file, "utf8");
  }
  return null;
}

function main(): void {
  const [outFile] = process.argv.slice(2);
  const catalog = buildTrainingCatalog().filter((e) => e.scope === "global");
  const sdl = new Map<string, string>();
  const state = new Map<string, unknown>();
  for (const { module, schemas } of CATALOG_MODELS) {
    const docType = module.documentModel.global.id;
    const spec = module.documentModel.global.specifications[0] as SpecLike;
    for (const m of spec.modules)
      for (const op of m.operations)
        if (op.name) sdl.set(`${docType}:${op.name}`, op.schema ?? "");
    const utils = schemas.utils as {
      createDocument?: () => { state: { global: unknown } };
    };
    state.set(docType, utils.createDocument?.().state.global ?? null);
  }
  const dirs = new Map<string, string | null>();
  const ops = catalog.map((e) => {
    if (!dirs.has(e.docType)) dirs.set(e.docType, modelDirFor(e.docType));
    return {
      key: e.key,
      model: e.model,
      docType: e.docType,
      opName: e.opName,
      module: e.module,
      description: e.description,
      inputSdl: sdl.get(`${e.docType}:${e.opName}`) ?? "",
      modelSchema: e.modelSchema,
      appFilledFields: e.fields
        .filter((f) => f.fieldClass !== "semantic")
        .map((f) => `${f.path.join(".")} (${f.fieldClass})`),
      reducerSource: reducerSource(dirs.get(e.docType) ?? null, e.module),
      siblings: catalog
        .filter((s) => s.docType === e.docType && s.key !== e.key)
        .map((s) => ({ key: s.key, description: s.description })),
      emptyState: state.get(e.docType) ?? null,
    };
  });
  writeFileSync(outFile, JSON.stringify(ops, null, 1) + "\n");
  const missing = ops.filter((o) => !o.reducerSource).map((o) => o.key);
  console.log(JSON.stringify({ ops: ops.length, missingReducer: missing }));
}

main();
