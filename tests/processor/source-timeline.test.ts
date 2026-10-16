import { describe, expect, it } from "vitest";
import {
  buildSourceTimeline,
  findSourcesRoot,
  isNoteGroup,
  sourceFromDocument,
  type TimelineAddition,
  type TimelineInput,
  type TimelineNode,
  type TimelineSource,
} from "../../processors/graph-indexer/source-timeline.js";

const ROOT = "sources-root";
const at = (iso: string) => `2026-10-${iso}Z`;

function source(id: string, over: Partial<TimelineSource> = {}): TimelineSource {
  return {
    id,
    parentFolder: ROOT,
    addedAt: at("10T20:00:00.000"),
    batchAt: null,
    title: `Source ${id}`,
    status: "EXTRACTED",
    addedBy: "did:key:me",
    sourceType: "ARTICLE",
    fileName: null,
    mimeType: null,
    sizeBytes: null,
    method: null,
    tool: null,
    url: null,
    claimIds: [],
    ...over,
  };
}

function note(documentId: string, over: Partial<TimelineNode> = {}): TimelineNode {
  const addedAt = over.addedAt === undefined ? at("10T20:05:00.000") : over.addedAt;
  return {
    documentId,
    documentType: "bai/knowledge-note",
    title: `Note ${documentId}`,
    status: "IN_REVIEW",
    noteType: "concept",
    topics: [],
    addedAt,
    createdAt: addedAt,
    sourceOrigin: "DERIVED",
    ...over,
  };
}

function topic(documentId: string, addedAt: string, title = `Topic ${documentId}`): TimelineNode {
  return note(documentId, { documentType: "bai/moc", title, noteType: "MOC (TOPIC)", status: "MOC", addedAt, createdAt: addedAt });
}

function input(over: Partial<TimelineInput>): TimelineInput {
  return { sourcesFolderId: ROOT, folders: [], sources: [], nodes: [], edges: [], ...over };
}

const derived = (noteId: string, sourceId: string) => ({ source: noteId, target: sourceId, type: "DERIVED_FROM" });

describe("buildSourceTimeline: what an addition is", () => {
  it("makes one addition of a file's folder, with its counts and file facts", () => {
    const folders = [{ id: "f-book", name: "Machine-Learning-Systems-Vol1", parentFolder: ROOT }];
    const file = { fileName: "Machine-Learning-Systems-Vol1.pdf", mimeType: "application/pdf", sizeBytes: 12_197_035, method: "converted", tool: "docling.rs" };
    const sources = [
      source("s1", { parentFolder: "f-book", addedAt: at("15T19:04:00.000"), status: "EXTRACTED", ...file }),
      source("s2", { parentFolder: "f-book", addedAt: at("15T19:07:00.000"), status: "EXTRACTING", ...file }),
      source("s3", { parentFolder: "f-book", addedAt: at("15T19:11:00.000"), status: "INBOX", ...file }),
    ];
    const t = buildSourceTimeline(input({ folders, sources }));
    expect(t.additions).toHaveLength(1);
    const [a] = t.additions;
    expect(a).toMatchObject({
      kind: "file",
      title: "Machine-Learning-Systems-Vol1",
      folderId: "f-book",
      addedAt: at("15T19:04:00.000"),
      lastAddedAt: at("15T19:11:00.000"),
      addedBy: "did:key:me",
      fileName: "Machine-Learning-Systems-Vol1.pdf",
      mimeType: "application/pdf",
      sizeBytes: 12_197_035,
      sources: 3,
      extracted: 1,
      waiting: 2,
      archived: 0,
      sourceIds: ["s1", "s2", "s3"],
    });
  });

  it("splits a folder where arrivals are more than an hour apart", () => {
    const folders = [{ id: "feeds", name: "Feeds", parentFolder: ROOT }];
    const rss = { method: "workflow", tool: "rss" };
    const sources = [
      source("p1", { parentFolder: "feeds", addedAt: at("14T08:00:00.000"), ...rss }),
      source("p2", { parentFolder: "feeds", addedAt: at("14T08:20:00.000"), ...rss }),
      source("p3", { parentFolder: "feeds", addedAt: at("15T08:00:00.000"), ...rss }),
    ];
    const t = buildSourceTimeline(input({ folders, sources }));
    expect(t.additions.map((a) => [a.kind, a.tool, a.sourceIds])).toEqual([
      ["feed", "rss", ["p1", "p2"]],
      ["feed", "rss", ["p3"]],
    ]);
    expect(new Set(t.additions.map((a) => a.id)).size).toBe(2);
  });

  it("keeps a source directly in /sources as its own addition, unless a batch shares one instant", () => {
    const sources = [
      source("pasted", { addedAt: at("10T19:20:00.000"), batchAt: at("10T19:20:00.000"), title: "How Knowledge Vault works" }),
      source("b1", { addedAt: at("11T09:00:00.001"), batchAt: at("11T09:00:00.000"), title: "Call notes" }),
      source("b2", { addedAt: at("11T09:00:00.002"), batchAt: at("11T09:00:00.000"), title: "Board memo" }),
      source("loose", { parentFolder: null, addedAt: at("12T09:00:00.000") }),
    ];
    const t = buildSourceTimeline(input({ sources }));
    expect(t.additions.map((a) => [a.kind, a.title, a.sourceIds])).toEqual([
      ["text", "How Knowledge Vault works", ["pasted"]],
      ["text", "Call notes and 1 more", ["b1", "b2"]],
      ["text", "Source loose", ["loose"]],
    ]);
    // they belong to no folder of their own: /sources is everything
    expect(t.additions.map((a) => a.folderId)).toEqual([null, null, null]);
  });

  it("names the kind from the file, the workflow tool or the agent", () => {
    const folders = [{ id: "f1", name: "Inference Engineering", parentFolder: ROOT }, { id: "f2", name: "bai-knowledge-note — how it works", parentFolder: ROOT }];
    const sources = [
      source("e", { parentFolder: "f1", mimeType: "application/epub+zip", method: "converted", addedAt: at("15T12:48:00.000") }),
      source("g", { parentFolder: "f2", method: "repository analysis at git 5086cab", tool: "knowledge-agent (Claude Code + powerhouse-knowledge plugin)", addedAt: at("15T16:26:00.000") }),
      source("m", { method: "workflow", tool: "granola", addedAt: at("15T17:00:00.000") }),
    ];
    const t = buildSourceTimeline(input({ folders, sources }));
    expect(t.additions.map((a) => a.kind)).toEqual(["file", "agent", "feed"]);
  });
});

describe("buildSourceTimeline: what each addition became", () => {
  const folders = [{ id: "f-ai", name: "State-of-AI-Report-2026", parentFolder: ROOT }, { id: "f-ml", name: "ML Systems", parentFolder: ROOT }];
  const sources = [
    source("ai1", { parentFolder: "f-ai", addedAt: at("10T20:14:00.000"), mimeType: "application/pdf", claimIds: ["n-claimed"] }),
    source("ml1", { parentFolder: "f-ml", addedAt: at("15T19:04:00.000"), mimeType: "application/pdf" }),
  ];
  const nodes = [
    note("n-ai", { addedAt: at("10T20:15:00.000"), topics: ["Safety", "Vault growth"] }),
    note("n-claimed", { addedAt: at("10T20:16:00.000"), topics: ["Safety"] }),
    note("n-ml1", { addedAt: at("15T19:06:00.000"), topics: ["ML systems", "Safety"] }),
    note("n-ml2", { addedAt: null, createdAt: at("15T19:09:00.000"), topics: ["ML systems"] }),
    note("n-old", { addedAt: at("15T14:20:00.000"), createdAt: "2026-09-17T11:10:22.000Z", sourceOrigin: "IMPORT" }),
    note("n-orphan1", { addedAt: at("15T13:58:09.000"), sourceOrigin: "DERIVED" }),
    note("n-orphan2", { addedAt: at("15T13:58:10.000"), sourceOrigin: "DERIVED" }),
    note("n-mine", { addedAt: at("16T09:00:00.000"), sourceOrigin: "MANUAL" }),
    topic("t-ai", at("10T20:19:00.000"), "AI safety"),
    topic("t-ml", at("15T19:30:00.000"), "ML Systems Reasoning"),
    topic("t-hub", at("10T19:24:00.000"), "Liberuum"),
  ];
  const edges = [
    derived("n-ai", "ai1"),
    derived("n-ml1", "ml1"),
    derived("n-ml2", "ml1"),
    { source: "t-ai", target: "n-ai", type: "CORE_IDEA" },
    { source: "t-ai", target: "n-claimed", type: "CORE_IDEA" },
    { source: "t-ml", target: "n-ml1", type: "CORE_IDEA" },
    { source: "t-ml", target: "n-ml2", type: "CORE_IDEA" },
    { source: "t-ml", target: "n-ai", type: "CORE_IDEA" },
    { source: "t-hub", target: "t-ai", type: "CHILD_MOC" },
    { source: "n-ml1", target: "n-ml2", type: "BUILDS_ON" },
    { source: "n-ml1", target: "n-ai", type: "RELATES_TO" },
    { source: "n-ml2", target: "n-ai", type: "BUILDS_ON" },
    { source: "n-ai", target: "n-claimed", type: "SUPERSEDES" },
  ];
  const t = buildSourceTimeline(input({ folders, sources, nodes, edges }));
  const byTitle = (title: string) => t.additions.find((a) => a.title === title)!;

  it("finds a note's addition by DERIVED_FROM, then by the source's extracted claims", () => {
    expect(byTitle("State-of-AI-Report-2026").notes).toBe(2);
    expect(byTitle("ML Systems").notes).toBe(2);
    const arrival = Object.fromEntries(t.notes.map((n) => [n.documentId, n.additionId]));
    expect(arrival["n-claimed"]).toBe(byTitle("State-of-AI-Report-2026").id);
    expect(arrival["n-ml2"]).toBe(byTitle("ML Systems").id);
  });

  it("dates notes by arrival, falling back to the written date, and keeps both", () => {
    const n = Object.fromEntries(t.notes.map((x) => [x.documentId, x]));
    expect(n["n-ml2"]).toMatchObject({ addedAt: at("15T19:09:00.000"), writtenAt: at("15T19:09:00.000") });
    expect(n["n-old"]).toMatchObject({ addedAt: at("15T14:20:00.000"), writtenAt: "2026-09-17T11:10:22.000Z" });
    expect(byTitle("ML Systems")).toMatchObject({ firstNoteAt: at("15T19:06:00.000"), lastNoteAt: at("15T19:09:00.000") });
  });

  it("groups notes without a source by origin: no recorded source, imported, or written here", () => {
    const loose = t.additions.filter((a) => isNoteGroup(a));
    expect(loose.map((a) => [a.kind, a.notes])).toEqual([
      ["unsourced", 2],
      ["imported", 1],
      ["written", 1],
    ]);
    expect(loose[0]).toMatchObject({ sources: 0, sourceIds: [], addedAt: at("15T13:58:09.000") });
  });

  it("splits notes without a source where they arrived more than an hour apart", () => {
    const late = buildSourceTimeline(input({ nodes: [note("o1", { addedAt: at("15T10:00:00.000") }), note("o2", { addedAt: at("15T12:30:00.000") })] }));
    expect(late.additions.map((a) => [a.kind, a.notes])).toEqual([
      ["unsourced", 1],
      ["unsourced", 1],
    ]);
  });

  it("says when an addition's notes were written a day or more before they arrived", () => {
    const imported = t.additions.find((a) => a.kind === "imported")!;
    expect(imported.writtenFrom).toBe("2026-09-17T11:10:22.000Z");
    expect(byTitle("ML Systems").writtenFrom).toBeNull();
  });

  it("credits a topic to the addition most of its notes came from, else the latest one before it", () => {
    expect(byTitle("State-of-AI-Report-2026").topicIds).toEqual(["t-ai"]);
    expect(byTitle("ML Systems").topicIds).toEqual(["t-ml"]);
    const hub = t.topics.find((x) => x.documentId === "t-hub")!;
    expect(hub).toMatchObject({ title: "Liberuum", additionId: null, addedAt: at("10T19:24:00.000") });
  });

  it("counts links among an addition's notes and to earlier additions' notes", () => {
    const ml = byTitle("ML Systems");
    expect(ml.linksWithin).toBe(1);
    expect(ml.linksToEarlier).toBe(2);
    expect(ml.earlier).toEqual([{ additionId: byTitle("State-of-AI-Report-2026").id, links: 2 }]);
    expect(byTitle("State-of-AI-Report-2026")).toMatchObject({ linksWithin: 1, linksToEarlier: 0, earlier: [] });
    expect(t.totals).toEqual({ sources: 2, notes: 8, topics: 3, links: 4 });
  });

  it("lists an addition's top tags and its most linked notes", () => {
    expect(byTitle("ML Systems").tags).toEqual([
      { name: "ML systems", count: 2 },
      { name: "Safety", count: 1 },
    ]);
    expect(byTitle("State-of-AI-Report-2026").topNotes.map((x) => x.documentId)).toEqual(["n-ai", "n-claimed"]);
  });

  it("orders additions by arrival", () => {
    expect(t.additions.map((a) => a.title)).toEqual([
      "State-of-AI-Report-2026",
      "Notes with no recorded source",
      "Imported notes",
      "ML Systems",
      "Notes written in the vault",
    ]);
  });
});

describe("buildSourceTimeline: edges of the input", () => {
  it("returns an empty timeline for an empty vault", () => {
    expect(buildSourceTimeline(input({}))).toEqual({
      additions: [],
      notes: [],
      topics: [],
      totals: { sources: 0, notes: 0, topics: 0, links: 0 },
    });
  });

  it("treats a source in a folder outside /sources like a folder addition, and nested folders by their own folder", () => {
    const folders = [
      { id: "papers", name: "Papers", parentFolder: ROOT },
      { id: "rag", name: "RAG", parentFolder: "papers" },
    ];
    const sources = [source("x", { parentFolder: "rag", addedAt: at("12T10:00:00.000") }), source("y", { parentFolder: "elsewhere", addedAt: at("12T11:30:00.000") })];
    const t = buildSourceTimeline(input({ folders, sources }));
    expect(t.additions.map((a) => [a.title, a.folderId])).toEqual([
      ["RAG", "rag"],
      ["Source y", "elsewhere"],
    ]);
  });

  it("counts archived sources apart from those waiting", () => {
    const folders = [{ id: "f", name: "Old", parentFolder: ROOT }];
    const sources = [source("a", { parentFolder: "f", status: "ARCHIVED" }), source("b", { parentFolder: "f", status: "INBOX" })];
    const [a] = buildSourceTimeline(input({ folders, sources })).additions;
    expect(a).toMatchObject({ archived: 1, waiting: 1, extracted: 0 });
  });
});

describe("reading the vault's tree and documents the same way everywhere", () => {
  it("finds /sources as the vault does: the top-level folder named exactly sources", () => {
    expect(findSourcesRoot([{ id: "a", name: "Sources", parentFolder: null }, { id: "b", name: "sources", parentFolder: null }])).toBe("b");
    expect(findSourcesRoot([{ id: "c", name: "sources", parentFolder: "x" }])).toBeNull();
  });

  it("reads a source document's header and state into what the timeline needs", () => {
    const doc = {
      header: { id: "s1", name: "chapter-1", createdAtUtcIso: "2026-10-15T19:04:00.000Z" },
      state: {
        global: {
          title: "Chapter 1",
          status: "EXTRACTING",
          createdAt: "2026-10-15T19:04:00.000Z",
          createdBy: "did:key:me",
          sourceType: "BOOK_CHAPTER",
          provenance: { method: "converted", tool: "docling.rs", url: "https://example.org" },
          originalFileName: "book.pdf",
          originalMimeType: "application/pdf",
          originalSizeBytes: 1000,
          extractedClaims: ["n1", { claimRef: "n2" }, { other: true }, 7],
        },
      },
    };
    expect(sourceFromDocument(doc, "f")).toEqual({
      id: "s1", parentFolder: "f", addedAt: "2026-10-15T19:04:00.000Z", batchAt: "2026-10-15T19:04:00.000Z", title: "Chapter 1",
      status: "EXTRACTING", addedBy: "did:key:me", sourceType: "BOOK_CHAPTER", fileName: "book.pdf", mimeType: "application/pdf",
      sizeBytes: 1000, method: "converted", tool: "docling.rs", url: "https://example.org", claimIds: ["n1", "n2"],
    });
  });

  it("falls back to the header's name and INBOX, and refuses what is not a document", () => {
    const bare = sourceFromDocument({ header: { id: "s2", name: "pasted", createdAtUtcIso: "2026-10-10T19:20:00.000Z" }, state: { global: { provenance: null } } }, null);
    expect(bare).toMatchObject({ title: "pasted", status: "INBOX", batchAt: null, method: null, claimIds: [] });
    expect(sourceFromDocument(null, null)).toBeNull();
    expect(sourceFromDocument({ header: { id: "s3" } }, null)).toBeNull();
  });
});

describe("buildSourceTimeline: ties and limits", () => {
  const folders = [{ id: "f", name: "Book", parentFolder: ROOT }, { id: "g", name: "Report", parentFolder: ROOT }];

  it("gives the same ids whatever order the reactor returned the sources in, even when times tie", () => {
    const same = at("15T19:04:00.000");
    const a = [source("s-b", { parentFolder: "f", addedAt: same }), source("s-a", { parentFolder: "f", addedAt: same })];
    const one = buildSourceTimeline(input({ folders, sources: a })).additions.map((x) => x.id);
    const two = buildSourceTimeline(input({ folders, sources: [...a].reverse() })).additions.map((x) => x.id);
    expect(one).toEqual(two);
    expect(one).toEqual(["folder:f:s-a"]);
  });

  it("credits a note derived from sources of two additions to the earlier one, and on a tie to the lower id", () => {
    const sources = [source("s1", { parentFolder: "f", addedAt: at("10T20:00:00.000") }), source("s2", { parentFolder: "g", addedAt: at("12T20:00:00.000") })];
    const edges = [derived("n", "s2"), derived("n", "s1")];
    const t = buildSourceTimeline(input({ folders, sources, nodes: [note("n")], edges }));
    expect(t.notes[0].additionId).toBe("folder:f:s1");
    const tied = [source("t1", { parentFolder: "g", addedAt: at("10T20:00:00.000") }), source("t2", { parentFolder: "f", addedAt: at("10T20:00:00.000") })];
    const forward = buildSourceTimeline(input({ folders, sources: tied, nodes: [note("n")], edges: [derived("n", "t1"), derived("n", "t2")] }));
    const backward = buildSourceTimeline(input({ folders, sources: tied, nodes: [note("n")], edges: [derived("n", "t2"), derived("n", "t1")] }));
    expect(forward.notes[0].additionId).toBe(backward.notes[0].additionId);
  });

  it("trusts DERIVED_FROM over a source's claims when they disagree", () => {
    const sources = [source("s1", { parentFolder: "f", addedAt: at("10T20:00:00.000"), claimIds: ["n"] }), source("s2", { parentFolder: "g", addedAt: at("12T20:00:00.000") })];
    const t = buildSourceTimeline(input({ folders, sources, nodes: [note("n")], edges: [derived("n", "s2")] }));
    expect(t.notes[0].additionId).toBe("folder:g:s2");
  });

  it("credits a topic without a majority to the latest addition that arrived before it", () => {
    const sources = [source("s1", { parentFolder: "f", addedAt: at("10T20:00:00.000") }), source("s2", { parentFolder: "g", addedAt: at("12T20:00:00.000") })];
    const nodes = [note("a", { addedAt: at("10T20:05:00.000") }), note("b", { addedAt: at("12T20:05:00.000") }), topic("m", at("13T09:00:00.000"))];
    const edges = [derived("a", "s1"), derived("b", "s2"), { source: "m", target: "a", type: "CORE_IDEA" }, { source: "m", target: "b", type: "CORE_IDEA" }];
    const t = buildSourceTimeline(input({ folders, sources, nodes, edges }));
    expect(t.topics[0].additionId).toBe("folder:g:s2");
  });

  it("keeps the five most used tags and the three most linked notes", () => {
    const sources = [source("s1", { parentFolder: "f" })];
    const tags = ["a", "b", "c", "d", "e", "f"];
    const nodes = tags.map((tag, i) => note(`n${i}`, { topics: tags.slice(0, i + 1) }));
    const edges = [
      ...nodes.map((n) => derived(n.documentId, "s1")),
      { source: "n0", target: "n1", type: "RELATES_TO" },
      { source: "n0", target: "n2", type: "RELATES_TO" },
      { source: "n0", target: "n3", type: "RELATES_TO" },
      { source: "n1", target: "n2", type: "BUILDS_ON" },
    ];
    const [a] = buildSourceTimeline(input({ folders, sources, nodes, edges })).additions;
    expect(a.tags.map((t) => t.name)).toEqual(["a", "b", "c", "d", "e"]);
    expect(a.topNotes.map((n) => n.documentId)).toEqual(["n0", "n1", "n2"]);
  });

  it("says a note was written earlier only from a full day before it arrived", () => {
    const sources = [source("s1", { parentFolder: "f", addedAt: at("15T12:00:00.000") })];
    const exactly = buildSourceTimeline(input({ folders, sources, nodes: [note("n", { addedAt: at("15T12:01:00.000"), createdAt: at("14T12:00:00.000") })], edges: [derived("n", "s1")] }));
    expect(exactly.additions[0].writtenFrom).toBe(at("14T12:00:00.000"));
    const almost = buildSourceTimeline(input({ folders, sources, nodes: [note("n", { addedAt: at("15T12:01:00.000"), createdAt: at("14T12:00:00.001") })], edges: [derived("n", "s1")] }));
    expect(almost.additions[0].writtenFrom).toBeNull();
  });

  it("gives every topic its written date beside its arrival", () => {
    const t = buildSourceTimeline(input({ nodes: [{ ...topic("m", at("13T09:00:00.000")), createdAt: "2026-09-17T12:00:00.000Z" }] }));
    expect(t.topics[0]).toMatchObject({ addedAt: at("13T09:00:00.000"), writtenAt: "2026-09-17T12:00:00.000Z" });
  });

  it("leaves out a source that has no time at all", () => {
    expect(sourceFromDocument({ header: { id: "s", name: "x" }, state: { global: { title: "No time" } } }, null)).toBeNull();
  });
});

describe("review fixes", () => {
  it("credits a topic to the addition it arrived with, not to a later one that filled it", () => {
    const early = source("early", { parentFolder: "f-early", addedAt: at("01T10:00:00.000") });
    const book = source("book", { parentFolder: "f-book", addedAt: at("15T19:00:00.000") });
    const earlyNotes = ["e1", "e2"].map((id) => note(id, { addedAt: at("01T10:05:00.000") }));
    const bookNotes = ["b1", "b2", "b3", "b4", "b5"].map((id) => note(id, { addedAt: at("15T19:10:00.000") }));
    const old = topic("t-old", at("01T10:06:00.000"));
    const fresh = topic("t-new", at("15T19:20:00.000"));
    const t = buildSourceTimeline(
      input({
        folders: [{ id: "f-early", name: "Early", parentFolder: ROOT }, { id: "f-book", name: "Book", parentFolder: ROOT }],
        sources: [early, book],
        nodes: [...earlyNotes, ...bookNotes, old, fresh],
        edges: [
          ...earlyNotes.map((n) => derived(n.documentId, "early")),
          ...bookNotes.map((n) => derived(n.documentId, "book")),
          ...[...earlyNotes, ...bookNotes].map((n) => ({ source: "t-old", target: n.documentId, type: "CORE_IDEA" })),
          ...bookNotes.slice(0, 3).map((n) => ({ source: "t-new", target: n.documentId, type: "CORE_IDEA" })),
        ],
      }),
    );
    const byTitle = new Map(t.additions.map((a) => [a.title, a]));
    expect(byTitle.get("Early")?.topicIds).toEqual(["t-old"]);
    expect(byTitle.get("Book")?.topicIds).toEqual(["t-new"]);
  });

  it("keeps imported notes apart from notes whose source is missing, and both apart from notes written here", () => {
    const t = buildSourceTimeline(
      input({
        nodes: [
          note("imp1", { sourceOrigin: "IMPORT", addedAt: at("11T09:00:00.000") }),
          note("imp2", { sourceOrigin: "IMPORT", addedAt: at("11T09:01:00.000") }),
          note("lost", { sourceOrigin: "DERIVED", addedAt: at("11T09:02:00.000") }),
          note("mine", { sourceOrigin: "MANUAL", addedAt: at("11T09:03:00.000") }),
        ],
      }),
    );
    const kinds: Partial<Record<string, TimelineAddition>> = Object.fromEntries(t.additions.map((a) => [a.kind, a]));
    expect(kinds.imported?.title).toBe("Imported notes");
    expect(kinds.imported?.notes).toBe(2);
    expect(kinds.unsourced?.notes).toBe(1);
    expect(kinds.written?.notes).toBe(1);
    expect(t.additions.filter((a) => isNoteGroup(a)).map((a) => a.kind).sort()).toEqual(["imported", "unsourced", "written"]);
  });

  it("orders ties by plain code units, so a server and a browser in different locales agree", () => {
    const same = at("12T08:00:00.000");
    const one = buildSourceTimeline(input({ sources: [source("a-low", { addedAt: same, batchAt: same }), source("Z-up", { addedAt: same, batchAt: same })] }));
    const two = buildSourceTimeline(input({ sources: [source("Z-up", { addedAt: same, batchAt: same }), source("a-low", { addedAt: same, batchAt: same })] }));
    expect(one.additions[0].id).toBe("batch:Z-up");
    expect(two.additions[0].id).toBe("batch:Z-up");
  });

  it("breaks ties among an addition's most linked notes by id, whatever order the index returns", () => {
    const s = source("s1", { parentFolder: "f", addedAt: at("12T08:00:00.000") });
    const same = at("12T08:05:00.000");
    const ns = ["x4", "x2", "x3", "x1"].map((id) => note(id, { addedAt: same }));
    const edges = ns.map((n) => derived(n.documentId, "s1"));
    const folders = [{ id: "f", name: "F", parentFolder: ROOT }];
    const forward = buildSourceTimeline(input({ folders, sources: [s], nodes: ns, edges }));
    const reversed = buildSourceTimeline(input({ folders, sources: [s], nodes: [...ns].reverse(), edges }));
    expect(forward.additions[0].topNotes.map((n) => n.documentId)).toEqual(["x1", "x2", "x3"]);
    expect(reversed.additions[0].topNotes.map((n) => n.documentId)).toEqual(["x1", "x2", "x3"]);
  });
});

describe("second review", () => {
  it("credits a topic made moments before its notes to those notes' addition, not to an older one", () => {
    const old = source("old", { parentFolder: "f-old", addedAt: at("10T09:00:00.000") });
    const imported = ["i1", "i2"].map((id, k) => note(id, { sourceOrigin: "IMPORT", addedAt: at(`15T14:20:0${k}.000`) }));
    const moc = topic("m-import", at("15T14:19:58.000"));
    const t = buildSourceTimeline(
      input({
        folders: [{ id: "f-old", name: "Old book", parentFolder: ROOT }],
        sources: [old],
        nodes: [note("o1", { addedAt: at("10T09:05:00.000") }), ...imported, moc],
        edges: [derived("o1", "old"), ...imported.map((n) => ({ source: "m-import", target: n.documentId, type: "CORE_IDEA" }))],
      }),
    );
    const byKind = new Map(t.additions.map((a) => [a.kind, a]));
    expect(byKind.get("imported")?.topicIds).toEqual(["m-import"]);
    expect(t.additions.find((a) => a.title === "Old book")?.topicIds).toEqual([]);
  });
});
