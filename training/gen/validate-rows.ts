/**
 * Validates rows as the runtime would act on them: canonical vocabularies
 * (zod does not see them: the fields are `String`), zod via `buildAction`,
 * then reducer replay after any `fixture` steps (fails on
 * `operation.error`). Ref-op rows also need candidates equal to the
 * replayed state's, ref args among them, and the recipe's post-condition.
 * Failing rows are dropped from `valid.jsonl`; exits 1 only if none pass.
 *
 *   npx --no-install tsx training/gen/validate-rows.ts <rows.jsonl> <out.json> [valid.jsonl]
 */
import { readFileSync, writeFileSync } from "node:fs";
import type { CatalogEntry } from "../../editors/knowledge-vault/chat/core/op-catalog.js";
import { buildTrainingCatalog } from "./prompt-format.js";
import {
  candidatesFor,
  RECIPES,
  refPaths,
  stateOf,
  type Cand,
  type CtxItem,
} from "./ref-scenarios.js";
import { apply, IdSource, replayers, replayFixture, type FixtureStep } from "./replay.js";

interface Row {
  id: string;
  op: string | null;
  args?: Record<string, unknown>;
  refIds?: Record<string, string | string[]>;
  fixture?: FixtureStep[];
  refCandidates?: Record<string, Cand[]>;
  /** Set on rows built from a ref scenario; turns on the ref checks. */
  refContext?: CtxItem[];
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

/** Ref-op checks before replay: candidates match the state, args among them. */
function refError(
  row: Row,
  entry: CatalogEntry,
  state: Record<string, unknown>,
): string | null {
  if (!RECIPES[entry.key] || !row.refContext) return null;
  const want = candidatesFor(entry.key, state, row.refContext ?? []);
  if (JSON.stringify(want) !== JSON.stringify(row.refCandidates ?? {}))
    return "refCandidates differ from the replayed state's candidates";
  for (const path of refPaths(entry)) {
    const v = row.args?.[path];
    if (v === undefined || v === null) continue;
    const ids = new Set((want[path] ?? []).map((c) => c.id));
    for (const x of Array.isArray(v) ? v : [v])
      if (typeof x !== "string" || !ids.has(x))
        return `${path} ${JSON.stringify(x)} is not a candidate id`;
  }
  return null;
}

type Result = { id: string; ok: boolean; stage?: string; error?: string; note?: string };

function main(): void {
  const [inFile, outFile, validFile] = process.argv.slice(2);
  const catalog = new Map(buildTrainingCatalog().map((e) => [e.key, e]));
  const reps = replayers();
  const rows = readFileSync(inFile, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as Row);
  const results = rows.map((row): Result => {
    if (!row.op) return { id: row.id, ok: true, note: "no-action" };
    const entry = catalog.get(row.op);
    if (!entry)
      return { id: row.id, ok: false, stage: "catalog", error: `unknown op ${row.op}` };
    const r = reps.get(entry.docType);
    if (!r)
      return { id: row.id, ok: false, stage: "catalog", error: `no reducer ${entry.docType}` };
    const ids = new IdSource();
    const fx = replayFixture(catalog, reps, entry.docType, row.fixture ?? [], ids);
    if (fx.error) return { id: row.id, ok: false, stage: "fixture", error: fx.error };
    const vocab = vocabularyError(entry, row.args ?? {});
    if (vocab) return { id: row.id, ok: false, stage: "vocabulary", error: vocab };
    const before = stateOf(fx.doc);
    const ref = refError(row, entry, before);
    if (ref) return { id: row.id, ok: false, stage: "ref-target", error: ref };
    const res = apply(fx.doc, r, entry, row.args ?? {}, ids, row.refIds);
    if (res.error) return { id: row.id, ok: false, stage: res.stage, error: res.error };
    const effect = row.refContext
      ? RECIPES[entry.key]?.check(before, stateOf(res.doc), res.input ?? {})
      : null;
    return effect
      ? { id: row.id, ok: false, stage: "ref-effect", error: effect }
      : { id: row.id, ok: true };
  });
  const failed = results.filter((r) => !r.ok);
  const summary = {
    rows: results.length,
    ok: results.length - failed.length,
    failed,
  };
  if (outFile)
    writeFileSync(outFile, JSON.stringify({ summary, results }, null, 2) + "\n");
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
