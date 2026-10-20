import { describe, expect, it } from "vitest";
import {
  bestPassage,
  claimBefore,
  cleanPassage,
  collectEvidence,
  contentWords,
  indexPassages,
  parseMarker,
} from "./evidence.js";

const N1 = "cd5a7a91-a92d-48cd-874c-87d1c180703f";
const S1 = "8360bb12-3c20-4a31-88cf-7258d957c24b";

const noteRead = {
  tool: "read_note",
  ok: true,
  summary: "",
  data: {
    documentId: N1,
    title: "The reactor stores operations in PGlite",
    documentType: "bai/knowledge-note",
    content:
      "# Storage\n\nThe reactor persists every operation in a PGlite database, one row per operation. " +
      "Documents are replayed from those rows on boot. **Snapshots** are an optimisation, not the source of truth.\n" +
      "- Read models are derived caches under `.ph/read-storage`.",
  },
};

const scopeRead = {
  tool: "read_document",
  ok: true,
  summary: "",
  data: {
    documentId: S1,
    title: "Powerhouse PMF",
    documentType: "powerhouse/scopeofwork",
    text:
      `# Scope of work: Powerhouse PMF — IN_PROGRESS [[${S1}]]\n\n## Projects (envelopes)\n\n` +
      `### PPD · Paperless demo — owner Frank (IN_PROGRESS) · 1/2 delivered · 50% [[${S1}#e1]]\n` +
      `Budget: 1,320 USD (OPEX), derived from 1 quoted deliverable\n` +
      `- [DELIVERED] PPD-01 Configured instance — owner Frank; done [[${S1}#d1]]\n` +
      `- [TODO] PPD-02 Payments — 3/8 SP [[${S1}#d2]]\n`,
  },
};

const searchHit = {
  tool: "search_vault",
  ok: true,
  summary: "",
  data: [
    {
      documentId: "n2",
      title: "Unrelated",
      description: "Embeddings are computed server-side by the graph indexer processor.",
    },
  ],
};

describe("parseMarker", () => {
  it("splits documentId#itemId and tolerates a bare id or an empty anchor", () => {
    expect(parseMarker(`${S1}#e1`)).toEqual({ documentId: S1, anchor: "e1" });
    expect(parseMarker(S1)).toEqual({ documentId: S1, anchor: null });
    expect(parseMarker(`${S1}#`)).toEqual({ documentId: S1, anchor: null });
    expect(parseMarker(" n1 # g1 ")).toEqual({ documentId: "n1", anchor: "g1" });
  });
});

describe("cleanPassage / contentWords", () => {
  it("strips markdown decoration, bullets, headings and markers", () => {
    expect(cleanPassage(`### PPD · Demo — owner **Frank** [[${S1}#e1]]`)).toBe("PPD · Demo — owner Frank");
    expect(cleanPassage("- Read models are *derived* caches under `.ph/read-storage`.")).toBe(
      "Read models are derived caches under .ph/read-storage.",
    );
    expect(cleanPassage("1. first  \t item")).toBe("first item");
  });

  it("keeps topic words only", () => {
    expect([...contentWords("The reactor stores every operation in a PGlite database.")]).toEqual([
      "reactor", "stores", "operation", "pglite", "database",
    ]);
  });
});

describe("claimBefore", () => {
  it("takes the sentence up to the marker, dropping its terminal punctuation", () => {
    const text = "Intro sentence. Operations are stored in PGlite, one row each [[n1]]. Next.";
    expect(claimBefore(text, text.indexOf("[[n1]]"))).toBe("Operations are stored in PGlite, one row each");
  });

  it("starts after the previous marker when two claims share a sentence", () => {
    const text = "Storage is PGlite [[n1]] and replay rebuilds state from operations [[n2]].";
    expect(claimBefore(text, text.indexOf("[[n2]]"))).toBe("and replay rebuilds state from operations");
  });

  it("uses the whole line when the fragment is too short to match on", () => {
    const text = "- Snapshots are an optimisation. Yes [[n1]]";
    expect(claimBefore(text, text.indexOf("[[n1]]"))).toBe("Snapshots are an optimisation. Yes");
  });
});

describe("bestPassage", () => {
  const passages = [
    "The reactor persists every operation in a PGlite database, one row per operation.",
    "Documents are replayed from those rows on boot.",
    "Snapshots are an optimisation, not the source of truth.",
  ];

  it("picks the passage sharing the most content words", () => {
    expect(bestPassage("Every operation is persisted in PGlite as one row", passages)).toBe(passages[0]);
    expect(bestPassage("State is rebuilt by replaying rows at boot", passages)).toBe(passages[1]);
  });

  it("refuses a match on one coincidental word", () => {
    expect(bestPassage("The database is the reactor", passages)).toBe(passages[0]); // two shared words
    expect(bestPassage("A snapshot of the weather", passages)).toBeNull();
    expect(bestPassage("", passages)).toBeNull();
  });
});

describe("indexPassages", () => {
  it("collects prose fields per document and the line carrying each anchored marker", () => {
    const idx = indexPassages([noteRead, scopeRead, searchHit, { ok: false, data: { documentId: "x", content: "ignored failure text here" } }]);
    expect(idx.byDocument.get(N1)).toEqual([
      "The reactor persists every operation in a PGlite database, one row per operation.",
      "Documents are replayed from those rows on boot.",
      "Snapshots are an optimisation, not the source of truth.",
      "Read models are derived caches under .ph/read-storage.",
    ]);
    expect(idx.byDocument.get("n2")).toEqual(["Embeddings are computed server-side by the graph indexer processor."]);
    expect(idx.byDocument.has("x")).toBe(false);
    expect(idx.anchored.get(`${S1}#e1`)).toBe("PPD · Paperless demo — owner Frank (IN_PROGRESS) · 1/2 delivered · 50%");
    expect(idx.anchored.get(`${S1}#d2`)).toBe("[TODO] PPD-02 Payments — 3/8 SP");
  });
});

describe("collectEvidence", () => {
  it("returns one entry per marker in order, with the supporting passage of the cited document", () => {
    const text =
      `Operations are persisted in PGlite, one row each [[${N1}]]. ` +
      `Payments is still at 3 of 8 story points [[${S1}#d2]]. ` +
      `Embeddings run on the server [[n2]]. Nothing about this [[zzzz]].`;
    expect(collectEvidence(text, [noteRead, scopeRead, searchHit])).toEqual([
      { documentId: N1, anchor: null, quote: "The reactor persists every operation in a PGlite database, one row per operation." },
      { documentId: S1, anchor: "d2", quote: "[TODO] PPD-02 Payments — 3/8 SP" },
      { documentId: "n2", anchor: null, quote: "Embeddings are computed server-side by the graph indexer processor." },
      { documentId: "zzzz", anchor: null, quote: null },
    ]);
  });

  it("falls back to lexical matching when an anchor is unknown, and to null when the claim matches nothing", () => {
    const text = `The demo envelope is half delivered [[${S1}#nope]]. Cats are nice [[${N1}]].`;
    const e = collectEvidence(text, [noteRead, scopeRead]);
    expect(e[0]).toEqual({ documentId: S1, anchor: "nope", quote: "PPD · Paperless demo — owner Frank (IN_PROGRESS) · 1/2 delivered · 50%" });
    expect(e[1]).toEqual({ documentId: N1, anchor: null, quote: null });
  });

  it("is empty for text without markers", () => {
    expect(collectEvidence("No citations here.", [noteRead])).toEqual([]);
  });
});
