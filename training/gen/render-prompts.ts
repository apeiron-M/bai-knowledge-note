/**
 * Source rows (JSONL) -> step-1 / step-2 chat messages, runtime grammars
 * and canonical targets (JSONL), plus a manifest. Every target is checked
 * against the grammar the runtime decodes (or scores) that step with.
 *
 *   npx --no-install tsx training/gen/render-prompts.ts <rows.jsonl> <out.jsonl>
 *
 * Source row: {id, utterance, docType, op: key | null, args?, refCandidates?, scoped?}
 * (`refCandidates`: path -> ids or {id, label}; `args` hold ref ids).
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  opEmbeddingHash,
  opEmbeddingInputs,
} from "../../editors/knowledge-vault/chat/core/op-embedding-index.js";
import { accepts } from "./gbnf-check.js";
import {
  buildTrainingCatalog,
  PROMPT_FORMAT_VERSION,
  scopedCandidates,
  step1Prompt,
  step1Target,
  step2Prompt,
  step2Target,
  UNSCOPED_K,
  unscopedCandidates,
  type RowRefs,
  type StepPrompt,
} from "./prompt-format.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../..");

export interface SourceRow {
  id: string;
  utterance: string;
  docType: string;
  op: string | null;
  args?: Record<string, unknown>;
  refCandidates?: RowRefs;
  /** Default true: all ops of the row's docType, as the Chat tab scopes. */
  scoped?: boolean;
  meta?: Record<string, unknown>;
}

export interface RenderedStep {
  id: string;
  step: 1 | 2;
  op: string | null;
  messages: StepPrompt["messages"];
  schema: StepPrompt["schema"];
  grammar: string;
  target: string | null;
  /** Why the row has no target (it is kept for the record, not trained on). */
  skip?: string;
  /** Target is derivable from `grammar` (null: no target). */
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

function git(args: string[]): string {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
}

async function main(): Promise<void> {
  const [inFile, outFile] = process.argv.slice(2);
  if (!inFile || !outFile) {
    console.error("usage: render-prompts.ts <rows.jsonl> <out.jsonl>");
    process.exit(2);
  }
  const catalog = buildTrainingCatalog();
  const byKey = new Map(catalog.map((e) => [e.key, e]));
  const out: RenderedStep[] = [];

  for (const row of readJsonl<SourceRow>(inFile)) {
    const gold = row.op ? byKey.get(row.op) : undefined;
    if (row.op && !gold) throw new Error(`${row.id}: unknown op ${row.op}`);
    const candidates =
      row.scoped === false
        ? await unscopedCandidates(catalog, row.utterance)
        : scopedCandidates(catalog, row.docType);
    const rank = gold ? candidates.findIndex((c) => c.key === gold.key) : -1;
    const s1 = step1Prompt(row.utterance, candidates);
    const t1 = step1Target(row.op, candidates);
    out.push({
      id: row.id,
      step: 1,
      op: row.op,
      ...s1,
      target: t1,
      skip: t1 === null ? "gold-not-retrieved" : undefined,
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
        messages: s2.messages,
        schema: s2.schema,
        grammar: s2.grammar,
        target: step2Target(s2, row.args ?? {}),
        targetAccepted: null,
        meta: row.meta,
      });
    }
  }

  for (const r of out)
    r.targetAccepted = r.target === null ? null : accepts(r.grammar, r.target);

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
    step1Candidates: `scoped: all global ops of the docType; unscoped: gte-small top ${UNSCOPED_K}`,
    catalogHash,
    opEmbeddingsHash: await opEmbeddingHash(opEmbeddingInputs(catalog)),
    catalogOps: catalog.length,
    gitHead: git(["rev-parse", "HEAD"]),
    chatCoreDirty: dirty ? dirty.split("\n") : [],
    grammarTool:
      "chat core argsGrammar / forcedOpsText + training/gen/gbnf-check.ts",
    rows: out.length,
    step1: out.filter((r) => r.step === 1).length,
    step2: out.filter((r) => r.step === 2).length,
    noActionTargets: out.filter((r) => r.step === 1 && r.op === null).length,
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

await main();
