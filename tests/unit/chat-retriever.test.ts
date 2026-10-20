import { describe, expect, it } from "vitest";
import { buildVaultCatalog } from "../../editors/knowledge-vault/chat/core/catalog-models.js";
import {
  createOpRetriever,
  tokenize,
} from "../../editors/knowledge-vault/chat/core/op-retriever.js";
import seed from "../../spike/llm-harness/eval/seed-utterances.json" with { type: "json" };

interface SeedItem {
  utterance: string;
  expectedKey: string;
  docType: string;
  expectedArgs?: Record<string, unknown>;
}

const items: SeedItem[] = seed;
const catalog = buildVaultCatalog();
const retriever = createOpRetriever(catalog);

function rank(item: SeedItem, scoped: boolean): number {
  const hits = retriever.retrieve(item.utterance, {
    k: 100,
    docType: scoped ? item.docType : undefined,
  });
  const i = hits.findIndex((h) => h.entry.key === item.expectedKey);
  return i === -1 ? Infinity : i + 1;
}

function recall(scoped: boolean, k: number): number {
  return items.filter((it) => rank(it, scoped) <= k).length / items.length;
}

describe("op retriever", () => {
  it("tokenizes camelCase, punctuation and plurals", () => {
    expect(tokenize("ADD_TOPIC topicDocumentId tags")).toEqual([
      "add",
      "topic",
      "topic",
      "document",
      "id",
      "tag",
    ]);
  });

  it("never returns local-scope ops", () => {
    const hits = retriever.retrieve("update the last viewed timestamp", {
      k: 100,
    });
    expect(hits.map((h) => h.entry.key)).not.toContain(
      "knowledge-note:SET_LAST_VIEWED",
    );
  });

  it("seed set covers >= 25 utterances, ~10 ops, >= 4 models", () => {
    expect(items.length).toBeGreaterThanOrEqual(25);
    expect(
      new Set(items.map((i) => i.expectedKey)).size,
    ).toBeGreaterThanOrEqual(10);
    expect(new Set(items.map((i) => i.docType)).size).toBeGreaterThanOrEqual(4);
    const keys = new Set(catalog.map((e) => e.key));
    for (const i of items) expect(keys, i.expectedKey).toContain(i.expectedKey);
  });

  it("reaches scoped recall@5 >= 90% on the seed set", () => {
    const table = [false, true].map((scoped) => ({
      mode: scoped ? "scoped" : "unscoped",
      "r@1": recall(scoped, 1),
      "r@5": recall(scoped, 5),
      "r@10": recall(scoped, 10),
    }));
    const misses = items
      .map((it) => ({
        u: it.utterance,
        scoped: rank(it, true),
        unscoped: rank(it, false),
      }))
      .filter((m) => m.scoped > 1 || m.unscoped > 5);
    process.stdout.write(
      `\nRETRIEVAL ${JSON.stringify(table)}\nMISSES ${JSON.stringify(misses)}\n`,
    );
    expect(recall(true, 5)).toBeGreaterThanOrEqual(0.9);
  });
});
