/**
 * Source rows (JSONL) -> step-1 / step-2 chat messages, runtime schemas,
 * llama.cpp grammars and canonical targets (JSONL), plus a manifest.
 *
 *   npx --no-install tsx training/gen/render-prompts.ts <rows.jsonl> <out.jsonl>
 *
 * Source row: {id, utterance, docType, op: key | null, args?, refCandidates?, scoped?}
 */
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createOpRetriever } from "../../editors/knowledge-vault/chat/core/op-retriever.js";
import { accepts } from "./gbnf-check.js";
import {
  buildTrainingCatalog,
  PROMPT_FORMAT_VERSION,
  RETRIEVE_K,
  step1Prompt,
  step1Target,
  step2Prompt,
  step2Target,
  type StepPrompt,
} from "./prompt-format.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../..");
// Native tools live outside the repo so the root tsconfig/vitest globs never see llama.cpp's sources.
const TOOLS =
  process.env.BAI_TRAINING_TOOLS ?? path.join(homedir(), ".cache/bai-training");
const SCHEMA2GBNF = path.join(TOOLS, "schema2gbnf");

export interface SourceRow {
  id: string;
  utterance: string;
  docType: string;
  op: string | null;
  args?: Record<string, unknown>;
  refCandidates?: Record<string, string[]>;
  /** Default true: retrieve within the row's docType, as the Chat tab does. */
  scoped?: boolean;
  meta?: Record<string, unknown>;
}

export interface RenderedStep {
  id: string;
  step: 1 | 2;
  op: string | null;
  messages: StepPrompt["messages"];
  schema: StepPrompt["schema"];
  grammar: string | null;
  target: string | null;
  /** Why the row has no target (it is kept for the record, not trained on). */
  skip?: string;
  /** Target is derivable from the runtime grammar (null: not checked). */
  targetAccepted: boolean | null;
  candidates?: string[];
  goldRank?: number | null;
  meta?: Record<string, unknown>;
}

function readJsonl<T>(file: string): T[] {
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as T);
}

function grammarsFor(schemas: unknown[]): (string | null)[] {
  if (!existsSync(SCHEMA2GBNF)) return schemas.map(() => null);
  const res = spawnSync(SCHEMA2GBNF, {
    input: schemas.map((s) => JSON.stringify(s)).join("\n") + "\n",
    encoding: "utf8",
    maxBuffer: 1 << 28,
  });
  if (res.status !== 0) throw new Error(`schema2gbnf failed: ${res.stderr}`);
  return res.stdout
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => {
      const v: unknown = JSON.parse(l);
      return typeof v === "string" ? v : null;
    });
}

function git(args: string[]): string {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
}

function main(): void {
  const [inFile, outFile] = process.argv.slice(2);
  if (!inFile || !outFile) {
    console.error("usage: render-prompts.ts <rows.jsonl> <out.jsonl>");
    process.exit(2);
  }
  const catalog = buildTrainingCatalog();
  const byKey = new Map(catalog.map((e) => [e.key, e]));
  const retriever = createOpRetriever(catalog);
  const out: RenderedStep[] = [];

  for (const row of readJsonl<SourceRow>(inFile)) {
    const gold = row.op ? byKey.get(row.op) : undefined;
    if (row.op && !gold) throw new Error(`${row.id}: unknown op ${row.op}`);
    const candidates = retriever
      .retrieve(row.utterance, {
        k: RETRIEVE_K,
        docType: row.scoped === false ? undefined : row.docType,
      })
      .map((h) => h.entry);
    const rank = gold ? candidates.findIndex((c) => c.key === gold.key) : -1;
    const s1 = step1Prompt(row.utterance, candidates);
    const t1 = step1Target(row.op, candidates);
    out.push({
      id: row.id,
      step: 1,
      op: row.op,
      ...s1,
      grammar: null,
      target: t1,
      skip: t1 ? undefined : row.op ? "gold-not-retrieved" : "no-action",
      targetAccepted: null,
      candidates: candidates.map((c) => c.key),
      goldRank: rank >= 0 ? rank + 1 : null,
      meta: row.meta,
    });
    // Step 2 is trained for the gold op even when retrieval missed it: the
    // app can reach it through a retry or a manual pick.
    const s2 = gold
      ? step2Prompt(row.utterance, gold, row.refCandidates)
      : null;
    if (gold && s2) {
      out.push({
        id: row.id,
        step: 2,
        op: row.op,
        ...s2,
        grammar: null,
        target: step2Target(s2.schema, row.args ?? {}),
        targetAccepted: null,
        meta: row.meta,
      });
    }
  }

  const grammars = grammarsFor(out.map((r) => r.schema));
  out.forEach((r, i) => {
    r.grammar = grammars[i] ?? null;
    r.targetAccepted =
      r.grammar && r.target !== null ? accepts(r.grammar, r.target) : null;
  });

  writeFileSync(outFile, out.map((r) => JSON.stringify(r)).join("\n") + "\n");
  const catalogHash = createHash("sha256")
    .update(
      JSON.stringify(
        catalog.map((e) => [e.key, e.description, e.modelSchema, e.scope]),
      ),
    )
    .digest("hex");
  const dirty = git([
    "status",
    "--porcelain",
    "--",
    "editors/knowledge-vault/chat",
  ]);
  const manifest = {
    promptFormatVersion: PROMPT_FORMAT_VERSION,
    retrieveK: RETRIEVE_K,
    catalogHash,
    catalogOps: catalog.length,
    gitHead: git(["rev-parse", "HEAD"]),
    chatCoreDirty: dirty ? dirty.split("\n") : [],
    grammarTool: existsSync(SCHEMA2GBNF)
      ? "schema2gbnf (llama.cpp b11364)"
      : null,
    rows: out.length,
    step1: out.filter((r) => r.step === 1).length,
    step2: out.filter((r) => r.step === 2).length,
    skipped: out.filter((r) => r.skip).length,
    targetRejected: out
      .filter((r) => r.targetAccepted === false)
      .map((r) => `${r.id}#${r.step}`),
  };
  writeFileSync(
    outFile.replace(/\.jsonl$/, "") + ".manifest.json",
    JSON.stringify(manifest, null, 2) + "\n",
  );
  console.log(JSON.stringify(manifest));
}

main();
