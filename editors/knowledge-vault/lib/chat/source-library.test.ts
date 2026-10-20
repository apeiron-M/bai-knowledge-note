import { describe, expect, it } from "vitest";
import type { TreeNode } from "../source-tree.js";
import {
  browseSources,
  buildSourceLibrary,
  fileTypeOf,
  summarizeSources,
  type SourceDocument,
} from "./source-library.js";

/**
 * A small vault, shaped like a real one:
 *
 *   /sources
 *     AI Reports/                       (topic folder)
 *       State of AI 2026/               (one original file, split into parts)
 *         Part 2, Part 10               PDF, EXTRACTED
 *       Model cards                     Word, INBOX
 *     Crypto/
 *       Stablecoins                     web page, EXTRACTED
 *     Pasted notes                      no original, EXTRACTING   (in no folder)
 *   /inbox
 *     Stray                             PDF, INBOX                (outside /sources)
 *
 * plus one source the reactor still returns but the tree no longer lists.
 */
const nodes: TreeNode[] = [
  { id: "f-src", name: "sources", kind: "folder", parentFolder: null },
  { id: "f-ai", name: "AI Reports", kind: "folder", parentFolder: "f-src" },
  { id: "f-soa", name: "State of AI 2026", kind: "folder", parentFolder: "f-ai" },
  { id: "f-crypto", name: "Crypto", kind: "folder", parentFolder: "f-src" },
  { id: "f-inbox", name: "inbox", kind: "folder", parentFolder: null },
  { id: "s-p10", name: "part-10", kind: "file", documentType: "bai/source", parentFolder: "f-soa" },
  { id: "s-p2", name: "part-2", kind: "file", documentType: "bai/source", parentFolder: "f-soa" },
  { id: "s-cards", name: "model-cards", kind: "file", documentType: "bai/source", parentFolder: "f-ai" },
  { id: "s-stable", name: "stablecoins", kind: "file", documentType: "bai/source", parentFolder: "f-crypto" },
  { id: "s-paste", name: "pasted", kind: "file", documentType: "bai/source", parentFolder: "f-src" },
  { id: "s-stray", name: "stray", kind: "file", documentType: "bai/source", parentFolder: "f-inbox" },
];

function source(id: string, global: Record<string, unknown>): SourceDocument {
  return { id, name: id, createdAtUtcIso: "2026-10-01T00:00:00.000Z", global };
}

const documents: SourceDocument[] = [
  source("s-p10", {
    title: "State of AI 2026 — Part 10",
    status: "EXTRACTED",
    sourceType: "PAPER",
    originalFileName: "state-of-ai-2026.pdf",
    extractedClaims: ["n1", "n2", "n3"],
  }),
  source("s-p2", {
    title: "State of AI 2026 — Part 2",
    status: "EXTRACTED",
    sourceType: "PAPER",
    originalFileName: "state-of-ai-2026.pdf",
    extractedClaims: ["n4"],
  }),
  source("s-cards", {
    title: "Model cards",
    description: "How labs document their models, with a section on gas turbines.",
    status: "INBOX",
    sourceType: "DOCUMENTATION",
    originalFileName: "Model Cards.DOCX",
    extractedClaims: [],
  }),
  source("s-stable", {
    title: "Stablecoins in Europe",
    status: "EXTRACTED",
    sourceType: "WEB_PAGE",
    originalMimeType: "text/html; charset=utf-8",
    provenance: { url: "https://example.org/stablecoins", author: "ECB" },
    extractedClaims: ["n5", "n6"],
  }),
  source("s-paste", {
    title: "Pasted notes",
    status: "EXTRACTING",
    extractedClaims: [],
  }),
  source("s-stray", {
    title: "Stray report",
    status: "INBOX",
    sourceType: "ARTICLE",
    originalMimeType: "application/pdf",
    extractedClaims: [],
  }),
  // Deleted from the drive; the reactor still answers for it.
  source("s-deleted", { title: "Deleted", status: "EXTRACTED", extractedClaims: ["n9"] }),
];

const lib = buildSourceLibrary(nodes, documents);

describe("fileTypeOf", () => {
  it("names the original by its extension, then by its MIME type", () => {
    expect(fileTypeOf({ originalFileName: "report.PDF" })).toBe("PDF");
    expect(fileTypeOf({ originalFileName: "deck.pptx" })).toBe("PowerPoint");
    expect(fileTypeOf({ originalMimeType: "text/html; charset=utf-8" })).toBe("web pages");
    expect(fileTypeOf({ originalMimeType: "image/png" })).toBe("images");
    expect(fileTypeOf({ originalFileName: "data.parquet" })).toBe("parquet");
    expect(fileTypeOf({ originalFileName: "Fwd report.eml", originalMimeType: "message/rfc822" })).toBe("email");
    expect(fileTypeOf({ originalMimeType: "message/rfc822" })).toBe("email");
    expect(fileTypeOf({})).toBeNull();
  });
});

describe("summarizeSources", () => {
  const s = summarizeSources(lib);

  it("counts the sources the vault holds, not the ones the reactor remembers", () => {
    expect(s.total).toBe(6);
    expect(s.notesExtracted).toBe(6);
  });

  it("splits them by status, kind and original file type", () => {
    expect(s.byStatus).toEqual({ EXTRACTED: 3, INBOX: 2, EXTRACTING: 1 });
    expect(s.bySourceType).toEqual({ PAPER: 2, ARTICLE: 1, DOCUMENTATION: 1, "not set": 1, WEB_PAGE: 1 });
    expect(s.byFileType).toEqual({ PDF: 3, "no original file": 1, "web pages": 1, Word: 1 });
  });

  it("lists the folders under /sources with what each holds, as the Sources view counts them", () => {
    expect(s.folders).toEqual([
      {
        folderId: "f-ai",
        name: "AI Reports",
        path: "AI Reports",
        sources: 3,
        byStatus: { EXTRACTED: 2, INBOX: 1 },
        subfolders: 1,
      },
      {
        folderId: "f-crypto",
        name: "Crypto",
        path: "Crypto",
        sources: 1,
        byStatus: { EXTRACTED: 1 },
        subfolders: 0,
      },
    ]);
    expect(s.folderCount).toBe(3);
    expect(s.inSourcesRoot).toBe(1);
    expect(s.outsideSources).toBe(1);
  });
});

describe("browseSources", () => {
  it("opens /sources: its folders and the sources in no folder", () => {
    const r = browseSources(lib, { limit: 50 });
    if (!r.ok) throw new Error(r.error);
    expect(r.folder).toEqual({ folderId: null, name: "Sources", path: "" });
    expect(r.subfolders.map((f) => f.name)).toEqual(["AI Reports", "Crypto"]);
    expect(r.sources.map((x) => x.title)).toEqual(["Pasted notes"]);
    expect(r.totalBeneath).toBe(6);
  });

  it("opens a folder by name, in natural order, with rows the chat can cite", () => {
    const r = browseSources(lib, { folder: "state of ai 2026", limit: 50 });
    if (!r.ok) throw new Error(r.error);
    expect(r.folder.path).toBe("AI Reports/State of AI 2026");
    expect(r.breadcrumb).toEqual(["Sources", "AI Reports", "State of AI 2026"]);
    expect(r.sources.map((x) => x.title)).toEqual([
      "State of AI 2026 — Part 2",
      "State of AI 2026 — Part 10",
    ]);
    expect(r.sources[0]).toMatchObject({
      documentId: "s-p2",
      documentType: "bai/source",
      status: "EXTRACTED",
      sourceType: "PAPER",
      fileType: "PDF",
      claimCount: 1,
      folder: "AI Reports/State of AI 2026",
    });
  });

  it("opens a folder by path or id, and recursive lists everything beneath it", () => {
    const direct = browseSources(lib, { folder: "/sources/AI Reports/", limit: 50 });
    if (!direct.ok) throw new Error(direct.error);
    expect(direct.sources.map((x) => x.documentId)).toEqual(["s-cards"]);
    expect(direct.subfolders.map((f) => f.path)).toEqual(["AI Reports/State of AI 2026"]);

    const all = browseSources(lib, { folder: "f-ai", recursive: true, limit: 50 });
    if (!all.ok) throw new Error(all.error);
    expect(all.sources.map((x) => x.documentId)).toEqual(["s-cards", "s-p2", "s-p10"]);
  });

  it("filters by status and kind, and searches descriptions beneath the folder", () => {
    const inbox = browseSources(lib, { recursive: true, status: "inbox", limit: 50 });
    if (!inbox.ok) throw new Error(inbox.error);
    expect(inbox.sources.map((x) => x.documentId).sort()).toEqual(["s-cards", "s-stray"]);

    const papers = browseSources(lib, { folder: "AI Reports", recursive: true, sourceType: "PAPER", limit: 1 });
    if (!papers.ok) throw new Error(papers.error);
    expect(papers.matched).toBe(2);
    expect(papers.sources).toHaveLength(1);

    const turbines = browseSources(lib, { query: "gas turbines", limit: 50 });
    if (!turbines.ok) throw new Error(turbines.error);
    expect(turbines.sources.map((x) => x.documentId)).toEqual(["s-cards"]);
  });

  it("finds a split document by its folder's name, and names the folder", () => {
    // The parts are titled by section; only the folder carries the document's name.
    const r = browseSources(lib, { query: "state of ai", limit: 50 });
    if (!r.ok) throw new Error(r.error);
    expect(r.subfolders.map((f) => f.path)).toEqual(["AI Reports/State of AI 2026"]);
    expect(r.sources.map((x) => x.documentId)).toEqual(["s-p2", "s-p10"]);
    const reports = browseSources(lib, { query: "reports", limit: 50 });
    if (!reports.ok) throw new Error(reports.error);
    expect(reports.subfolders.map((f) => f.path)).toEqual(["AI Reports", "AI Reports/State of AI 2026"]);
    expect(reports.sources).toHaveLength(3);
  });

  it("says which folders exist when the one named does not", () => {
    const r = browseSources(lib, { folder: "Biology", limit: 50 });
    expect(r).toEqual({
      ok: false,
      error: 'No folder "Biology" under /sources. The folders there are: AI Reports; Crypto.',
    });
  });

  it("asks for a path when a name matches two folders", () => {
    const twins = buildSourceLibrary(
      [
        ...nodes,
        { id: "f-ai-old", name: "Archive", kind: "folder", parentFolder: "f-ai" },
        { id: "f-crypto-old", name: "Archive", kind: "folder", parentFolder: "f-crypto" },
      ],
      documents,
    );
    const r = browseSources(twins, { folder: "Archive", limit: 50 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('"Archive" names 2 folders: AI Reports/Archive; Crypto/Archive. Pass one of these paths.');
    // A top-level folder's name is its path, so it is never ambiguous.
    const top = browseSources(twins, { folder: "crypto/archive", limit: 50 });
    expect(top.ok && top.folder.folderId).toBe("f-crypto-old");
  });
});
