// pieces/knowledge-vault/test/convergence.test.ts
import { describe, expect, it } from "vitest";
import { madeBySource, sourceNotes } from "../lib/agent/connect.js";
import { readVerifyNotes } from "../lib/agent/verify.js";
import type { KnowledgeVaultClient } from "../lib/common/client.js";

const vault = (docs: Record<string, unknown>) =>
  ({
    request: async ({ path }: { path: string }) => {
      const id = decodeURIComponent(path.replace(/^notes\//, ""));
      if (!(id in docs)) throw new Error(`no ${path}`);
      return docs[id];
    },
  }) as unknown as KnowledgeVaultClient;
const derived = (...from: string[]) => from.map((documentId) => ({ direction: "out", documentId, linkType: "DERIVED_FROM" }) as { direction: string; documentId: string; linkType: string; reason?: string });
const withReason = (edges: ReturnType<typeof derived>, to: string, reason: string) => edges.map((e) => (e.documentId === to ? { ...e, reason } : e));
const CONVERGED = 'Also argued in "Chapter 3" (p2): "…"';
const ORDINARY = "From section 2, paragraph 1 …";
const note = (title: string, edges: ReturnType<typeof derived>, status = "IN_REVIEW") => ({ name: title, state: { global: { title, status, description: "d" } }, edges });

describe("the notes a source made", () => {
  const docs = {
    src: { name: "src", state: { global: { title: "Chapter 3", status: "EXTRACTED", extractedClaims: ["mine", "theirs", "gone", "concurrent", "twoTools", "bare"] } } },
    mine: note("Mine", derived("src")),
    theirs: note("Theirs", withReason(derived("older", "src"), "src", CONVERGED)),
    concurrent: note("Concurrent", withReason(derived("src", "later"), "later", CONVERGED).map((e) => (e.documentId === "src" ? { ...e, reason: ORDINARY } : e))),
    twoTools: note("Two tools", withReason(withReason(derived("src", "other"), "src", ORDINARY), "other", ORDINARY)),
    bare: note("Bare", derived("src")),
    gone: note("Gone", derived("src"), "ARCHIVED"),
    empty: { name: "empty", state: { global: { title: "Further reading", status: "ARCHIVED", extractedClaims: [] } } },
  };
  it("tells a note this source made from one it found already in the vault", () => {
    expect(madeBySource(docs.mine.edges, "src")).toBe(true);
    expect(madeBySource(docs.theirs.edges, "src")).toBe(false);
    expect(madeBySource(undefined, "src")).toBe(true);
    expect(madeBySource(docs.concurrent.edges, "src")).toBe(true);
    expect(madeBySource(docs.twoTools.edges, "src")).toBe(true);
    expect(madeBySource(docs.bare.edges, "src")).toBe(true);
  });
  it("gives Connect and Place only the notes this source made", async () => {
    expect((await sourceNotes(vault(docs), "d", "src")).notes.map((n) => n.id)).toEqual(["mine", "concurrent", "twoTools", "bare"]);
  });
  it("gives Verify only the notes this source made", async () => {
    expect((await readVerifyNotes(vault(docs), "d", "src")).notes.map((n) => n.id)).toEqual(["mine", "concurrent", "twoTools", "bare"]);
  });
  it("treats a source archived as holding no knowledge as finished, with no notes", async () => {
    expect((await sourceNotes(vault(docs), "d", "empty")).notes).toEqual([]);
  });
});
