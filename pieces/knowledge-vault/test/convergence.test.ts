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
const derived = (...from: string[]) => from.map((documentId) => ({ direction: "out", documentId, linkType: "DERIVED_FROM" }));
const note = (title: string, edges: ReturnType<typeof derived>, status = "IN_REVIEW") => ({ name: title, state: { global: { title, status, description: "d" } }, edges });

describe("the notes a source made", () => {
  const docs = {
    src: { name: "src", state: { global: { title: "Chapter 3", status: "EXTRACTED", extractedClaims: ["mine", "theirs", "gone"] } } },
    mine: note("Mine", derived("src")),
    theirs: note("Theirs", derived("older", "src")),
    gone: note("Gone", derived("src"), "ARCHIVED"),
    empty: { name: "empty", state: { global: { title: "Further reading", status: "ARCHIVED", extractedClaims: [] } } },
  };
  it("tells a note this source made from one it found already in the vault", () => {
    expect(madeBySource(docs.mine.edges, "src")).toBe(true);
    expect(madeBySource(docs.theirs.edges, "src")).toBe(false);
    expect(madeBySource(undefined, "src")).toBe(true);
  });
  it("gives Connect and Place only the notes this source made", async () => {
    expect((await sourceNotes(vault(docs), "d", "src")).notes.map((n) => n.id)).toEqual(["mine"]);
  });
  it("gives Verify only the notes this source made", async () => {
    expect((await readVerifyNotes(vault(docs), "d", "src")).notes.map((n) => n.id)).toEqual(["mine"]);
  });
  it("treats a source archived as holding no knowledge as finished, with no notes", async () => {
    expect((await sourceNotes(vault(docs), "d", "empty")).notes).toEqual([]);
  });
});
