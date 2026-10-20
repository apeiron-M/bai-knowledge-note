/**
 * Validates source rows as the runtime would act on them: the canonical
 * vocabularies (`chat/core/vocabularies.ts`, which zod does not see: the
 * fields are `String`), zod via `buildAction` (the generated creator), then
 * reducer replay on a fresh document after any `fixture` steps; a row
 * fails on `operation.error`.
 *
 *   npx --no-install tsx training/gen/validate-rows.ts <rows.jsonl> <out.json> [valid.jsonl]
 *
 * Failing rows are dropped from `valid.jsonl`; exits 1 only if none pass.
 */
import { readFileSync, writeFileSync } from "node:fs";
import type { Action, PHDocument } from "document-model";
import { CATALOG_MODELS } from "../../editors/knowledge-vault/chat/core/catalog-models.js";
import { buildAction } from "../../editors/knowledge-vault/chat/core/envelope.js";
import type { CatalogEntry } from "../../editors/knowledge-vault/chat/core/op-catalog.js";
import { buildTrainingCatalog } from "./prompt-format.js";

interface FixtureStep {
  op: string;
  args: Record<string, unknown>;
  refIds?: Record<string, string | string[]>;
}

interface Row {
  id: string;
  op: string | null;
  args?: Record<string, unknown>;
  refIds?: Record<string, string | string[]>;
  fixture?: FixtureStep[];
}

type Reducer = (doc: PHDocument, action: Action) => PHDocument;

interface Replayer {
  reducer: Reducer;
  createDocument: () => PHDocument;
}

function isReducer(v: unknown): v is Reducer {
  return typeof v === "function";
}

function replayers(): Map<string, Replayer> {
  const map = new Map<string, Replayer>();
  for (const { module, schemas } of CATALOG_MODELS) {
    const utils = schemas.utils as { createDocument?: () => PHDocument };
    const reducer = schemas.reducer;
    if (!isReducer(reducer) || typeof utils.createDocument !== "function") {
      throw new Error(`no reducer/utils for ${module.documentModel.global.id}`);
    }
    map.set(module.documentModel.global.id, {
      reducer,
      createDocument: utils.createDocument,
    });
  }
  return map;
}

/** The first vocabulary-constrained value outside its canonical list. */
function vocabularyError(
  entry: CatalogEntry,
  args: Record<string, unknown>,
): string | null {
  for (const [path, values] of Object.entries(entry.vocabulary)) {
    let v: unknown = args;
    for (const k of path.split("."))
      v =
        typeof v === "object" && v !== null
          ? new Map<string, unknown>(Object.entries(v)).get(k)
          : undefined;
    if (v === undefined || v === null) continue;
    for (const x of Array.isArray(v) ? v : [v])
      if (typeof x !== "string" || !values.includes(x))
        return `${path} ${JSON.stringify(x)} is not one of ${values.join(", ")}`;
  }
  return null;
}

let counter = 0;
const ctx = (refIds?: Record<string, string | string[]>) => ({
  generateId: () =>
    `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`,
  now: () => "2026-10-20T12:00:00.000Z",
  actor: "training",
  refIds,
});

function apply(
  doc: PHDocument,
  r: Replayer,
  entry: CatalogEntry,
  args: Record<string, unknown>,
  refIds?: Record<string, string | string[]>,
): { doc: PHDocument; error?: string; stage?: "zod" | "replay" } {
  const built = buildAction(entry, args, ctx(refIds));
  if (!built.ok) return { doc, error: built.error, stage: "zod" };
  const next = r.reducer(doc, built.action);
  const err = next.operations.global.at(-1)?.error;
  return err ? { doc: next, error: err, stage: "replay" } : { doc: next };
}

function main(): void {
  const [inFile, outFile, validFile] = process.argv.slice(2);
  const catalog = new Map(buildTrainingCatalog().map((e) => [e.key, e]));
  const reps = replayers();
  const rows = readFileSync(inFile, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as Row);
  const results = rows.map((row) => {
    if (!row.op) return { id: row.id, ok: true, note: "no-action" };
    const entry = catalog.get(row.op);
    if (!entry)
      return {
        id: row.id,
        ok: false,
        stage: "catalog",
        error: `unknown op ${row.op}`,
      };
    const r = reps.get(entry.docType);
    if (!r)
      return {
        id: row.id,
        ok: false,
        stage: "catalog",
        error: `no reducer ${entry.docType}`,
      };
    let doc = r.createDocument();
    for (const f of row.fixture ?? []) {
      const fe = catalog.get(f.op);
      const res = fe
        ? apply(doc, r, fe, f.args, f.refIds)
        : {
            doc,
            error: `unknown fixture op ${f.op}`,
            stage: "fixture" as const,
          };
      if (res.error)
        return { id: row.id, ok: false, stage: "fixture", error: res.error };
      doc = res.doc;
    }
    const vocab = vocabularyError(entry, row.args ?? {});
    if (vocab)
      return { id: row.id, ok: false, stage: "vocabulary", error: vocab };
    const res = apply(doc, r, entry, row.args ?? {}, row.refIds);
    return res.error
      ? { id: row.id, ok: false, stage: res.stage, error: res.error }
      : { id: row.id, ok: true };
  });
  const failed = results.filter((r) => !r.ok);
  const summary = {
    rows: results.length,
    ok: results.length - failed.length,
    failed,
  };
  if (outFile)
    writeFileSync(
      outFile,
      JSON.stringify({ summary, results }, null, 2) + "\n",
    );
  console.log(JSON.stringify(summary, null, 2));
  if (validFile) {
    const bad = new Set(failed.map((r) => r.id));
    writeFileSync(
      validFile,
      rows
        .filter((r) => !bad.has(r.id))
        .map((r) => JSON.stringify(r) + "\n")
        .join(""),
    );
  }
  process.exit(results.length > failed.length ? 0 : 1);
}

main();
