import "../../../shared/test/browser-globals.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CHAT_TOOLS,
  DOCUMENT_TYPES,
  VAULT_TOOLS,
  WEB_TOOLS,
  executeTool,
  resetVaultDocumentListing,
} from "./vault-tools.js";
import { resetEnsCache } from "./ens.js";

const CTX = { driveId: "drive-1" };

function mockGql(data: unknown) {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ data }),
  }) as unknown as typeof fetch;
}
// Drive membership and resolved names are cached across calls by design;
// between tests they must not be, or the first test to look decides what the
// rest of the file believes the vault contains.
beforeEach(() => {
  resetVaultDocumentListing();
  resetEnsCache();
});

function mockGqlSequence(...payloads: unknown[]) {
  const fn = vi.fn();
  for (const p of payloads) {
    fn.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(p) });
  }
  globalThis.fetch = fn as unknown as typeof fetch;
}
/**
 * The drive's own file list — what `driveMembers` reads to decide whether a
 * document is still in the vault. Tools that ask the reactor by id or by type
 * check it first, so a mocked sequence has to include it.
 */
function driveTree(...ids: string[]) {
  return {
    data: {
      document: {
        document: {
          state: {
            global: {
              nodes: ids.map((id) => ({ id, kind: "file", name: id, documentType: "bai/knowledge-note" })),
            },
          },
        },
      },
    },
  };
}

function requestAt(i: number) {
  const calls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls;
  const [url, init] = calls[i] as [string, RequestInit];
  return {
    url,
    body: JSON.parse(init.body as string) as {
      query: string;
      variables: Record<string, unknown>;
    },
  };
}
const lastRequest = () =>
  requestAt(
    (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length - 1,
  );

afterEach(() => vi.restoreAllMocks());

describe("VAULT_TOOLS", () => {
  it("exposes exactly the nineteen read-only tools", () => {
    expect(VAULT_TOOLS.map((t) => t.function.name).sort()).toEqual([
      "document_history",
      "keyword_search",
      "linked_notes",
      "list_contradictions",
      "list_documents",
      "list_projects",
      "list_sources",
      "list_topics",
      "notes_by_status",
      "notes_by_topic",
      "read_document",
      "read_note",
      "read_notes",
      "recent_changes",
      "related_notes",
      "search_vault",
      "topic_maps",
      "vault_editors",
      "vault_stats",
    ]);
  });

  it("adds the outside-the-vault tools to the chat's set, but not to what the vault offers Connect", () => {
    expect(WEB_TOOLS.map((t) => t.function.name)).toEqual(["search_web", "ens_lookup", "read_url"]);
    expect(CHAT_TOOLS).toHaveLength(VAULT_TOOLS.length + WEB_TOOLS.length);
    // aiTools (Connect's assistant) is built from VAULT_TOOLS alone.
    expect(VAULT_TOOLS.some((t) => t.function.name.includes("web"))).toBe(false);
  });

  it("declares no mutation anywhere", () => {
    expect(JSON.stringify(VAULT_TOOLS)).not.toMatch(/mutation|reindex|upsert/i);
  });

  it("every tool has a description and an object parameter schema", () => {
    for (const t of VAULT_TOOLS) {
      expect(t.function.description.length).toBeGreaterThan(20);
      expect(t.function.parameters.type).toBe("object");
    }
  });

  it("list_documents enumerates the valid document types in its schema", () => {
    const tool = VAULT_TOOLS.find((t) => t.function.name === "list_documents")!;
    const props = (
      tool.function.parameters as {
        properties: Record<string, { enum?: string[] }>;
      }
    ).properties;
    expect(props.documentType.enum).toEqual([...DOCUMENT_TYPES]);
  });
});

describe("executeTool", () => {
  it("rejects an unknown tool instead of guessing", async () => {
    globalThis.fetch = vi.fn() as unknown as typeof fetch;
    const r = await executeTool("delete_everything", {}, CTX);
    expect(r.ok).toBe(false);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("search_vault reads text for the top hits only, never topics, and hits the graph endpoint", async () => {
    mockGql({
      knowledgeGraphSemanticSearch: [
        {
          similarity: 0.9,
          matchedBy: ["semantic"],
          node: {
            documentId: "n1",
            title: "T",
            description: "D",
            noteType: "PATTERN",
            status: "CANONICAL",
          },
        },
      ],
    });
    const r = await executeTool("search_vault", { query: "audit trails" }, CTX);
    expect(r.ok).toBe(true);
    const { url, body } = requestAt(0);
    expect(url).toContain("/graphql/knowledgeGraph");
    // The text is read for the top hits to answer from; topics, a resolver
    // per row, never are.
    expect(body.query).toMatch(/node \{[^}]*\bcontent\b/);
    expect(body.query).not.toMatch(/\btopics\b/);
    expect(body.variables).toMatchObject({
      driveId: "drive-1",
      query: "audit trails",
      limit: 8,
    });
    if (r.ok) {
      expect(r.summary).toContain("audit trails");
      expect(r.summary).toContain("1");
      const d = r.data as { hits: { documentId: string }[] };
      expect(d.hits[0].documentId).toBe("n1");
    }
  });

  it("search_vault asks for the neighbourhood and the edges between hits", async () => {
    mockGql({ knowledgeGraphSemanticSearch: [] });
    await executeTool("search_vault", { query: "x" }, CTX);
    const { body } = requestAt(0);
    expect(body.query).toMatch(/related\(limit: 15\)/);
    expect(body.query).toMatch(/linkedHits/);
  });

  it("search_vault hands over the text of its top three hits, each once per answer", async () => {
    const hit = (id: string, content: string) => ({ similarity: 0.9, matchedBy: ["semantic"], node: { documentId: id, title: id, content } });
    mockGql({
      knowledgeGraphSemanticSearch: [
        hit("a", "Body A"),
        hit("b", "x".repeat(5000)),
        hit("c", ""),
        hit("d", "Body D"),
        hit("e", "Body E"),
      ],
    });
    const first = await executeTool("search_vault", { query: "q" }, CTX);
    const hitsOf = (r: typeof first) => (r.ok ? (r.data as { hits: Record<string, unknown>[] }).hits : []);
    expect(hitsOf(first).map((h) => [h.documentId, typeof h.content === "string" ? h.content.length : null, h.contentTruncated ?? false])).toEqual([
      ["a", 6, false],
      ["b", 3000, true],
      ["c", null, false], // nothing to send
      ["d", 6, false],
      ["e", null, false], // three already given
    ]);
    // The same search again in this answer: those bodies are not sent twice.
    const again = await executeTool("search_vault", { query: "q" }, CTX);
    expect(hitsOf(again).map((h) => [h.documentId, typeof h.content === "string"])).toEqual([
      ["a", false],
      ["b", false],
      ["c", false],
      ["d", false],
      ["e", true],
    ]);
  });

  it("search_vault merges a neighbour several hits point at into one row", async () => {
    const shared = {
      documentId: "shared",
      title: "Shared",
      noteType: "CONCEPT",
      documentType: "bai/knowledge-note",
      hitCount: 2,
    };
    mockGql({
      knowledgeGraphSemanticSearch: [
        {
          similarity: 0.9,
          matchedBy: ["semantic"],
          node: { documentId: "n1", title: "One" },
          related: [
            { ...shared, via: [{ from: "n1", to: "shared", linkType: "BUILDS_ON", reason: null }] },
          ],
          linkedHits: [],
        },
        {
          similarity: 0.8,
          matchedBy: ["semantic"],
          node: { documentId: "n2", title: "Two" },
          related: [
            { ...shared, via: [{ from: "n2", to: "shared", linkType: "RELATES_TO", reason: null }] },
          ],
          linkedHits: [],
        },
      ],
    });
    const r = await executeTool("search_vault", { query: "x" }, CTX);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const d = r.data as { related: { documentId: string; via: unknown[] }[] };
    // one row, not two — and it carries BOTH edges that reached it
    expect(d.related).toHaveLength(1);
    expect(d.related[0].documentId).toBe("shared");
    expect(d.related[0].via).toHaveLength(2);
    expect(r.summary).toContain("1 connected");
  });

  it("search_vault reports a hit contradicted by ANOTHER HIT", async () => {
    // The case `related` structurally cannot carry: both ends are hits, so the
    // edge only ever arrives through linkedHits.
    mockGql({
      knowledgeGraphSemanticSearch: [
        {
          similarity: 0.91,
          matchedBy: ["semantic"],
          node: { documentId: "claim", title: "The broad claim" },
          related: [],
          linkedHits: [
            { from: "correction", to: "claim", linkType: "CONTRADICTS", reason: "wildcard is documentId-only" },
          ],
        },
        {
          similarity: 0.86,
          matchedBy: ["semantic"],
          node: { documentId: "correction", title: "The correction" },
          related: [],
          linkedHits: [
            { from: "correction", to: "claim", linkType: "CONTRADICTS", reason: "wildcard is documentId-only" },
          ],
        },
      ],
    });
    const r = await executeTool("search_vault", { query: "x" }, CTX);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const d = r.data as { contested: Record<string, unknown>[] };
    // both ends are hits, so both are reported, with direction distinguishing them
    expect(d.contested).toHaveLength(2);
    expect(d.contested).toContainEqual({
      documentId: "claim",
      title: "The broad claim",
      linkType: "CONTRADICTS",
      direction: "incoming",
      otherDocumentId: "correction",
      otherTitle: "The correction",
      reason: "wildcard is documentId-only",
    });
    expect(r.summary).toContain("CONTESTED");
  });

  it("search_vault finds a contradiction the per-hit ranking would have buried", async () => {
    // Per-hit lists inherit the GLOBAL ranking, so a note several hits point
    // at weakly outranks a note one hit contradicts. Detection must run over
    // everything that was read, and the trim must happen after it.
    const filler = (n: number) => ({
      documentId: `pop${n}`,
      title: `Popular ${n}`,
      noteType: "CONCEPT",
      documentType: "bai/knowledge-note",
      hitCount: 5,
      via: [{ from: "n1", to: `pop${n}`, linkType: "RELATES_TO", reason: null }],
    });
    mockGql({
      knowledgeGraphSemanticSearch: [
        {
          similarity: 0.9,
          matchedBy: ["semantic"],
          node: { documentId: "n1", title: "The claim" },
          // 12 convergent neighbours ahead of the disputer, as the server
          // would order them
          related: [
            ...Array.from({ length: 12 }, (_, i) => filler(i)),
            {
              documentId: "disputer",
              title: "The objection",
              noteType: "PATTERN",
              documentType: "bai/knowledge-note",
              hitCount: 1,
              via: [{ from: "disputer", to: "n1", linkType: "CONTRADICTS", reason: "measured the opposite" }],
            },
          ],
          linkedHits: [],
        },
      ],
    });
    const r = await executeTool("search_vault", { query: "x" }, CTX);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const d = r.data as {
      related: { documentId: string }[];
      contested: { documentId: string; otherDocumentId: string }[];
    };
    // found despite sitting 13th
    expect(d.contested).toHaveLength(1);
    expect(d.contested[0]).toMatchObject({ documentId: "n1", otherDocumentId: "disputer" });
    // and pinned into view, not trimmed away
    expect(d.related[0].documentId).toBe("disputer");
    expect(d.related).toHaveLength(12);
    expect(r.summary).toContain("CONTESTED");
  });

  it("search_vault survives a Switchboard that has neither field", async () => {
    mockGql({
      knowledgeGraphSemanticSearch: [
        { similarity: 0.9, matchedBy: ["semantic"], node: { documentId: "n1", title: "T" } },
      ],
    });
    const r = await executeTool("search_vault", { query: "x" }, CTX);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const d = r.data as { hits: unknown[]; related: unknown[]; contested: unknown[] };
    expect(d.hits).toHaveLength(1);
    expect(d.related).toEqual([]);
    expect(d.contested).toEqual([]);
    expect(r.summary).not.toContain("CONTESTED");
  });

  it("search_vault caps the limit at 20 and rejects an empty query", async () => {
    mockGql({ knowledgeGraphSemanticSearch: [] });
    await executeTool("search_vault", { query: "x", limit: 500 }, CTX);
    expect(requestAt(0).body.variables.limit).toBe(20);

    globalThis.fetch = vi.fn() as unknown as typeof fetch;
    expect((await executeTool("search_vault", { query: "   " }, CTX)).ok).toBe(
      false,
    );
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("read_note returns the whole body, however long", async () => {
    mockGql({
      knowledgeGraphNodeByDocumentId: {
        documentId: "n1",
        title: "T",
        content: `${"x".repeat(20_000)} — the caveat at the end`,
        topics: ["a"],
      },
    });
    const r = await executeTool("read_note", { documentId: "n1" }, CTX);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const d = r.data as Record<string, unknown>;
      expect(d.content).toMatch(/the caveat at the end$/);
      expect((d.content as string).length).toBe(20_000 + " — the caveat at the end".length);
      expect(d).not.toHaveProperty("truncated");
      expect(d.topics).toEqual(["a"]);
    }
  });

  it("read_note reports a missing note as a failure", async () => {
    mockGql({ knowledgeGraphNodeByDocumentId: null });
    expect(
      (await executeTool("read_note", { documentId: "nope" }, CTX)).ok,
    ).toBe(false);
  });

  it("list_topics slices client-side because the server has no limit", async () => {
    mockGql({
      knowledgeGraphTopics: Array.from({ length: 613 }, (_, i) => ({
        name: `t${i}`,
        noteCount: i,
      })),
    });
    const r = await executeTool("list_topics", {}, CTX);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const d = r.data as { name: string; noteCount: number }[];
      expect(d.length).toBe(40);
      expect(d[0].noteCount).toBe(612); // sorted by count, descending
    }
  });

  it("notes_by_topic projects content away and slices", async () => {
    mockGql({
      knowledgeGraphByTopic: Array.from({ length: 80 }, (_, i) => ({
        documentId: `n${i}`,
        title: `T${i}`,
      })),
    });
    const r = await executeTool("notes_by_topic", { topic: "leads" }, CTX);
    expect(lastRequest().body.query).not.toMatch(/\bcontent\b/);
    if (r.ok) expect((r.data as unknown[]).length).toBe(25);
  });

  it("linked_notes returns both directions, capped, with incoming titles resolved in one batch", async () => {
    mockGqlSequence(
      driveTree("n1"),
      {
        data: {
          out: Array.from({ length: 20 }, (_, i) => ({
            targetDocumentId: `o${i}`,
            linkType: "RELATES_TO",
            targetTitle: `Out ${i}`,
          })),
          inc: [
            { sourceDocumentId: "i1", linkType: "BUILDS_ON" },
            { sourceDocumentId: "i2", linkType: "RELATES_TO" },
          ],
        },
      },
      { data: { n0: { title: "In one" }, n1: { title: "In two" } } },
    );
    const r = await executeTool("linked_notes", { documentId: "n1" }, CTX);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const d = r.data as {
        outgoing: unknown[];
        incoming: {
          documentId: string;
          title: string | null;
          linkType: string;
        }[];
      };
      expect(d.outgoing).toHaveLength(15);
      expect(d.incoming).toEqual([
        { documentId: "i1", title: "In one", documentType: null, linkType: "BUILDS_ON" },
        { documentId: "i2", title: "In two", documentType: null, linkType: "RELATES_TO" },
      ]);
    }
    // The drive tree, the links, and one batch of titles.
    expect(
      (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls,
    ).toHaveLength(3);
  });

  it("linked_notes names the source at the end of a DERIVED_FROM link, so it can be cited", async () => {
    mockGqlSequence(
      {
        data: {
          document: {
            document: {
              state: {
                global: {
                  nodes: [
                    { id: "n1", kind: "file", name: "n1", documentType: "bai/knowledge-note" },
                    { id: "src-1", kind: "file", name: "State of AI 2026 — Part 2", documentType: "bai/source" },
                  ],
                },
              },
            },
          },
        },
      },
      {
        data: {
          out: [
            {
              targetDocumentId: "src-1",
              linkType: "DERIVED_FROM",
              targetTitle: null,
              reason: "Section 3, the paragraph on turbine backlogs",
            },
          ],
          inc: [],
        },
      },
    );
    const r = await executeTool("linked_notes", { documentId: "n1" }, CTX);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect((r.data as { outgoing: unknown[] }).outgoing).toEqual([
        {
          documentId: "src-1",
          title: "State of AI 2026 — Part 2",
          documentType: "bai/source",
          linkType: "DERIVED_FROM",
          reason: "Section 3, the paragraph on turbine backlogs",
        },
      ]);
    }
  });

  it("list_documents hits the reactor endpoint and rejects an unknown type", async () => {
    mockGql({
      findDocuments: {
        hasNextPage: false,
        items: [{ id: "s1", name: "Src", documentType: "bai/source" }],
      },
    });
    const r = await executeTool(
      "list_documents",
      { documentType: "bai/source" },
      CTX,
    );
    expect(r.ok).toBe(true);
    // Request 0 is the listing; the membership check follows it.
    const { url, body } = requestAt(0);
    expect(url).toMatch(/\/graphql$/);
    expect(body.variables).toMatchObject({ type: "bai/source", limit: 50 });
    // The reactor no longer reports a total (dev.26, #3107): what it served,
    // and whether it had more, is the honest answer.
    if (r.ok) expect(r.data).toMatchObject({ total: 1, more: false });

    globalThis.fetch = vi.fn() as unknown as typeof fetch;
    expect(
      (await executeTool("list_documents", { documentType: "evil/type" }, CTX))
        .ok,
    ).toBe(false);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("read_document pages a long body and reports the remainder", async () => {
    mockGql({
      document: {
        document: {
          id: "s1",
          name: "Src",
          documentType: "bai/source",
          state: {
            global: {
              title: "Src",
              status: "EXTRACTED",
              content: "y".repeat(20000),
              extractedClaims: Array.from({ length: 30 }, (_, i) => `c${i}`),
            },
          },
        },
      },
    });
    const r = await executeTool("read_document", { documentId: "s1" }, CTX);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const d = r.data as {
        text: string;
        totalChars: number;
        hasMore: boolean;
        offset: number;
        nextOffset: number | null;
        meta: Record<string, unknown>;
      };
      expect(d.text.length).toBe(8000);
      expect(d.totalChars).toBe(20000);
      expect(d.hasMore).toBe(true);
      expect(d.offset).toBe(0);
      expect(d.nextOffset).toBe(8000);
      expect(d.meta.status).toBe("EXTRACTED");
      expect(d.meta.extractedClaims).toEqual({
        count: 30,
        first: Array.from({ length: 20 }, (_, i) => `c${i}`),
      });
      expect(d.meta).not.toHaveProperty("content");
    }
  });

  it("read_document honours offset and falls back to orientation for a MoC", async () => {
    mockGql({
      document: {
        document: {
          id: "m1",
          name: "MoC",
          documentType: "bai/moc",
          state: {
            global: {
              title: "MoC",
              orientation: "abcdefghij",
              description: "ignored",
            },
          },
        },
      },
    });
    const r = await executeTool(
      "read_document",
      { documentId: "m1", offset: 4 },
      CTX,
    );
    if (r.ok) {
      const d = r.data as {
        text: string;
        hasMore: boolean;
        nextOffset: number | null;
        textField: string;
      };
      expect(d.text).toBe("efghij");
      expect(d.hasMore).toBe(false);
      expect(d.nextOffset).toBeNull();
      expect(d.textField).toBe("orientation");
    }
  });

  it("read_document treats an explicit offset of 0 as 0, not 1", async () => {
    mockGql({
      document: {
        document: {
          id: "m1",
          name: "M",
          documentType: "bai/moc",
          state: { global: { orientation: "abc" } },
        },
      },
    });
    const r = await executeTool(
      "read_document",
      { documentId: "m1", offset: 0 },
      CTX,
    );
    if (r.ok)
      expect((r.data as { text: string; offset: number }).text).toBe("abc");
    if (r.ok) expect((r.data as { offset: number }).offset).toBe(0);
  });

  it("read_document reports missing and transport failures as failed tools", async () => {
    mockGql({ document: null });
    expect(
      (await executeTool("read_document", { documentId: "x" }, CTX)).ok,
    ).toBe(false);

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      json: () => Promise.resolve({}),
    }) as unknown as typeof fetch;
    const r = await executeTool("read_document", { documentId: "x" }, CTX);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/502/);
  });

  it("surfaces a GraphQL error as a failed tool rather than throwing", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ errors: [{ message: "boom" }] }),
    }) as unknown as typeof fetch;
    const r = await executeTool("vault_stats", {}, CTX);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("boom");
  });
});

describe("scope of work envelopes", () => {
  const CTX = { driveId: "d1" };
  const scope = {
    title: "Powerhouse PMF",
    description: "Scoping approaches",
    status: "DRAFT",
    contributors: [{ id: "a-frank", name: "Frank", icon: null, description: "" }],
    projects: [
      {
        id: "env1",
        slug: "ppd",
        code: "PPD",
        title: "Paperless demo",
        projectOwner: "a-frank",
        abstract: "First demo",
        imageUrl: null,
        scope: { deliverables: ["d1", "d2"], status: "IN_PROGRESS", progress: { value: 50, total: null, completed: null, done: null }, deliverablesCompleted: { total: 2, completed: 1 } },
        budgetType: "OPEX",
        currency: "USD",
        budget: 0,
        targetBudget: null,
        expenditure: { percentage: 0, actuals: 0, cap: 0 },
        wbsRef: "w9",
        knowledgeRefs: ["n-a"],
        references: ["https://example.com"],
      },
    ],
    deliverables: [
      { id: "d1", owner: "a-frank", icon: null, title: "Configured instance", code: "PPD-01", description: "", status: "DELIVERED", workProgress: { done: true, value: null, total: null, completed: null }, keyResults: [{ id: "k", title: "Shipped", link: "https://x.example" }], budgetAnchor: null, goalRef: "g1" },
      { id: "d2", owner: null, icon: null, title: "Payments", code: "PPD-02", description: "", status: "TODO", workProgress: null, keyResults: [], budgetAnchor: null, goalRef: "g2" },
    ],
    roadmaps: [{ id: "r", slug: "r", title: "H2", description: "", milestones: [{ id: "m1", sequenceCode: "M1", title: "Demo ready", description: "", deliveryTarget: "2026-08-28", scope: { deliverables: ["d1", "d2"], status: "DRAFT", progress: { value: 0, total: null, completed: null, done: null }, deliverablesCompleted: { total: 2, completed: 1 } }, coordinators: ["a-frank"], budget: 0 }] }],
  };
  const wbs = {
    projectRef: null,
    sowRef: "s1",
    sowProjectId: "env1",
    owner: "Frank",
    references: [],
    goals: [
      { id: "g1", description: "Step 1", status: "COMPLETED", parentId: null, assignee: "Frank", dependencies: [], blockReason: null, outcome: null, notes: [] },
      { id: "g2", description: "Step 5", status: "TODO", parentId: null, assignee: null, dependencies: [], blockReason: null, outcome: null, notes: [] },
    ],
  };
  const docResponse = (id: string, documentType: string, name: string, global: unknown) => ({
    data: { document: { document: { id, name, documentType, state: { global } } } },
  });

  it("list_projects lists every envelope of every scope, citing the scope document", async () => {
    mockGqlSequence(
      { data: { findDocuments: { hasNextPage: false, items: [{ id: "s1", name: "Powerhouse PMF" }] } } },
      driveTree("s1"),
      docResponse("s1", "powerhouse/scopeofwork", "Powerhouse PMF", scope),
    );
    const r = await executeTool("list_projects", {}, CTX);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.error);
    const d = r.data as { total: number; scopes: number; projects: Record<string, unknown>[] };
    expect(d.scopes).toBe(1);
    expect(d.total).toBe(1);
    // One row is ONE PROJECT and the PROJECT names it. The scope keeps its
    // {documentId, title} pair — the citation harvester needs it to label a
    // [[scopeId]] chip — but nested, so several projects sharing a scope no
    // longer arrive carrying the scope's title as their own.
    expect(d.projects[0]).toMatchObject({
      project: "Paperless demo",
      code: "PPD",
      owner: "Frank",
      status: "IN_PROGRESS",
      cite: "[[s1#env1]]",
      envelopeId: "env1",
      scope: { documentId: "s1", documentType: "powerhouse/scopeofwork", title: "Powerhouse PMF" },
      // Anchored on the SCOPE with a wbs: prefix, so the breakdown opens
      // inside the scope rather than as a standalone document.
      wbs: {
        documentId: "w9",
        documentType: "bai/wbs",
        title: "Work breakdown for Paperless demo",
        cite: "[[s1#wbs:env1]]",
      },
      progress: { delivered: 1, total: 2, pct: 50 },
      budget: { type: "OPEX", currency: "USD", budget: 0, targetBudget: null },
      knowledgeRefs: 1,
    });
    // and nothing at the top level can be mistaken for the project's name
    expect(d.projects[0]).not.toHaveProperty("title");
    // The summary names every project, so a model that lists nine of ten has
    // the omission staring at it in the same line that states the total.
    expect(r.summary).toBe("listed 1 project across 1 scope — PPD");
  });

  it("list_projects names every project and says how many to answer with", async () => {
    // A model listed nine of ten and still wrote "all ten projects". The
    // codes make an omission visible in the line that states the total.
    mockGqlSequence(
      { data: { findDocuments: { hasNextPage: false, items: [{ id: "s1", name: "Powerhouse PMF" }] } } },
      driveTree("s1"),
      docResponse("s1", "powerhouse/scopeofwork", "Powerhouse PMF", {
        ...scope,
        projects: [
          scope.projects[0],
          { ...scope.projects[0], id: "env2", code: "UMH", title: "UMH demo" },
        ],
      }),
    );
    const r = await executeTool("list_projects", {}, CTX);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.summary).toBe(
      "listed 2 projects across 1 scope — PPD, UMH. Answer with all 2.",
    );
  });

  it("read_document on a scope joins deliverables to their goals and names the wbs", async () => {
    mockGqlSequence(
      driveTree("s1", "w9"),
      docResponse("s1", "powerhouse/scopeofwork", "Powerhouse PMF", scope),
      docResponse("w9", "bai/wbs", "PPD — WBS", wbs),
      { data: { n0: { title: "A note" } } },
    );
    const r = await executeTool("read_document", { documentId: "s1" }, CTX);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.error);
    const d = r.data as {
      text: string;
      envelopes: { code: string; goals: { completed: number; total: number } | null; deliverables: { goal: string | null }[]; wbs: unknown }[];
      unfundedDeliverables: unknown[];
      deliverables: { delivered: number; total: number };
    };
    expect(d.text.split("\n")[0]).toBe("# Scope of work: Powerhouse PMF — DRAFT [[s1]]");
    expect(d.text).toContain("### PPD · Paperless demo — owner Frank (IN_PROGRESS)");
    expect(d.text).toContain("[[s1#env1]]"); // anchored marker the model can copy to cite this envelope
    expect(d.text).toContain("[DELIVERED] PPD-01 Configured instance — goal: Step 1 (COMPLETED)");
    expect(d.text).toContain("Work breakdown [[w9]]: 1/2 goals completed");
    expect(d.text).toContain("A note [[n-a]]");
    expect(d.envelopes[0]?.goals).toEqual({ completed: 1, total: 2, byStatus: { COMPLETED: 1, TODO: 1 } });
    expect(d.envelopes[0]?.deliverables.map((x) => x.goal)).toEqual(["Step 1", "Step 5"]);
    expect(d.deliverables).toEqual({ delivered: 1, total: 2 });
    // The whole scope in one read: schedule and people too, and the WBS as a
    // citable object so a [[w9]] marker resolves to a titled chip.
    expect(d.text).toContain("## Schedule");
    expect(d.text).toContain("- M1 Demo ready — 2026-08-28 (DRAFT); 1/2 delivered · 50%; coordinators Frank");
    expect(d.text).toContain("- Frank (a-frank)");
    expect(d.envelopes[0]?.wbs).toEqual({
      documentId: "w9",
      documentType: "bai/wbs",
      title: "Work breakdown for Paperless demo",
    });
    expect(d.unfundedDeliverables).toEqual([]);
    expect(r.summary).toContain("1 envelopes, 1/2 delivered");
  });

  it("read_document on a WBS renders the goal tree and names the envelope it delivers", async () => {
    mockGqlSequence(
      driveTree("w9", "s1"),
      docResponse("w9", "bai/wbs", "PPD — WBS", wbs),
      docResponse("s1", "powerhouse/scopeofwork", "Powerhouse PMF", scope),
    );
    const r = await executeTool("read_document", { documentId: "w9" }, CTX);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.error);
    const d = r.data as { text: string; goalCount: number; documentType: string };
    expect(d.documentType).toBe("bai/wbs");
    expect(d.text.split("\n")[0]).toBe("# Work breakdown for Paperless demo [[w9]]");
    expect(d.text).toContain("[COMPLETED] Step 1");
    expect(d.goalCount).toBe(2);
    expect(r.summary).toContain('for "Paperless demo"');
  });
});

describe("list_documents nameContains", () => {
  const CTX = { driveId: "d1" };
  const page = {
    data: {
      findDocuments: {
        hasNextPage: false,
        items: [
          { id: "s1", name: "Swarm Protocol Reference", documentType: "bai/source" },
          { id: "s2", name: "Book of Powerhouse — overview", documentType: "bai/source" },
          { id: "s3", name: "How Connect Swarm Integration Works", documentType: "bai/source" },
        ],
      },
    },
  };

  it("filters by title over the largest page and says how much it scanned", async () => {
    mockGqlSequence(page, driveTree("s1", "s2", "s3"));
    const r = await executeTool("list_documents", { documentType: "bai/source", nameContains: "swarm" }, CTX);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.error);
    expect(requestAt(0).body.variables).toEqual({ type: "bai/source", limit: 100 });
    expect(r.data).toEqual({
      total: 3,
      scanned: 3,
      matched: 2,
      more: false,
      items: [
        { documentId: "s1", title: "Swarm Protocol Reference", documentType: "bai/source" },
        { documentId: "s3", title: "How Connect Swarm Integration Works", documentType: "bai/source" },
      ],
    });
    expect(r.summary).toBe(
      'listed 2 of 2 bai/source whose title contains "swarm" (scanned 3 in the vault of 3 the reactor served)',
    );
  });

  it("still honours limit on the filtered list and behaves as before without a filter", async () => {
    mockGqlSequence(page, driveTree("s1", "s2", "s3"));
    const filtered = await executeTool("list_documents", { documentType: "bai/source", nameContains: "swarm", limit: 1 }, CTX);
    if (!filtered.ok) throw new Error(filtered.error);
    expect((filtered.data as { items: unknown[] }).items).toHaveLength(1);

    mockGqlSequence(page, driveTree("s1", "s2", "s3"));
    const plain = await executeTool("list_documents", { documentType: "bai/source", limit: 2 }, CTX);
    if (!plain.ok) throw new Error(plain.error);
    expect(requestAt(0).body.variables).toEqual({ type: "bai/source", limit: 2 });
    expect(plain.data).not.toHaveProperty("matched");
    // The mock ignores paging, so the page holds 3; the tool still trims to the limit.
    // "in the vault" is only claimed when membership was actually read.
    expect(plain.summary).toBe("listed 2 of 3 bai/source in the vault");
  });
});

describe("recent_changes — every document in the vault by last edit", () => {
  const CTX = { driveId: "d1" };
  const tree = {
    data: {
      document: {
        document: {
          state: {
            global: {
              nodes: [
                { id: "f1", kind: "folder", name: "sources" },
                { id: "s-old", kind: "file", name: "Old import", documentType: "bai/source" },
                { id: "s-new", kind: "file", name: "Board minutes 2026-09", documentType: "bai/source" },
                { id: "n1", kind: "file", name: "a-slug", documentType: "bai/knowledge-note" },
                { id: "hr", kind: "file", name: "HealthReport", documentType: "bai/health-report" },
                { id: "elsewhere", kind: "file", name: "not stamped", documentType: "bai/moc" },
              ],
            },
          },
        },
      },
    },
  };
  const contained = {
    data: {
      findDocuments: {
        items: [
          { id: "s-new", lastModifiedAtUtcIso: "2026-09-04T09:00:00.000Z" },
          { id: "hr", lastModifiedAtUtcIso: "2026-09-04T16:00:00.000Z" },
          { id: "n1", lastModifiedAtUtcIso: "2026-09-03T10:00:00.000Z" },
          { id: "stranger", lastModifiedAtUtcIso: "2026-09-05T00:00:00.000Z" }, // left the tree: still in the reactor
        ],
      },
    },
  };
  const indexed = {
    data: {
      knowledgeGraphRecent: [
        // The index supplies the human title; its own stamp lags a reindex
        // behind the reactor's, which is why the reactor's is used.
        { documentId: "n1", title: "A real title", noteType: "concept", status: "CANONICAL", updatedAt: "2026-09-02T08:00:00.000Z" },
        // Indexed but absent from the reactor listing: the index stands in.
        { documentId: "s-old", title: "Old import", noteType: null, status: null, updatedAt: "2026-08-01T00:00:00.000Z" },
      ],
    },
  };

  /** One document's last operation, as `lastOperationOf` asks for it. */
  const lastOp = (type: string, input: Record<string, unknown>, address: string | null, app: string) => ({
    data: {
      documentOperations: {
        items: [
          { index: 3, action: { type, input, context: { signer: { user: { address }, app: { name: app } } } } },
          // An earlier operation at the same instant: the highest index wins.
          { index: 2, action: { type: "SET_TITLE", input: { title: "older" }, context: { signer: { user: { address }, app: { name: app } } } } },
        ],
      },
    },
  });
  const ens = (name: string) => ({ address: A, ens_primary: name });
  const A = "0xadbA7C2F82139031D7564D18aC22D09B12A0BcA4";

  beforeEach(() => {
    resetVaultDocumentListing();
    resetEnsCache();
  });

  it("merges the drive tree with both time sources, newest first, and counts documents with no known edit time", async () => {
    mockGqlSequence(
      tree,
      contained,
      indexed,
      // one per returned row, in order
      lastOp("SET_STATUS", { status: "CANONICAL" }, A, "switchboard"),
      lastOp("SET_TITLE", { title: "Board minutes" }, A, "connect"),
      lastOp("SET_CONTENT", { content: "x".repeat(40) }, null, "switchboard"),
      lastOp("ADD_TOPIC", { name: "ingestion" }, A, "connect"),
      ens("liberuum.eth"), // the one ENS lookup all three signed rows share
    );
    const r = await executeTool("recent_changes", {}, CTX);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.error);
    const d = r.data as { items: { documentId: string; title: string; documentType: string; lastModifiedAt: string; noteType: string | null; change?: string; by?: string | null; via?: string | null }[]; undated: number };
    expect(d.items.map((i) => i.documentId)).toEqual(["hr", "s-new", "n1", "s-old"]);
    expect(d.items[0]).toMatchObject({ documentId: "hr", title: "HealthReport", documentType: "bai/health-report", lastModifiedAt: "2026-09-04T16:00:00.000Z", noteType: null, status: null });
    // The reactor's stamp wins over the index's older one; the index still
    // supplies the note's human title in place of its slug.
    expect(d.items[2]).toMatchObject({ documentId: "n1", title: "A real title", lastModifiedAt: "2026-09-03T10:00:00.000Z", noteType: "concept" });
    // s-old is missing from the reactor listing, so its index stamp stands in.
    expect(d.items[3]).toMatchObject({ documentId: "s-old", lastModifiedAt: "2026-08-01T00:00:00.000Z" });
    // Each row answers who / what / when / where in one call.
    expect(d.items[0]).toMatchObject({
      documentType: "bai/health-report",
      change: "Status changed to CANONICAL",
      action: "SET_STATUS",
      by: A,
      byName: "liberuum.eth",
      byShort: "0xadbA…BcA4",
      via: "switchboard",
    });
    // An unsigned operation names the app and nobody else.
    expect(d.items[2]).toMatchObject({ change: "Content updated (40 chars)", by: null, via: "switchboard" });
    // `elsewhere` is in the vault but no source knows a time; `stranger` has
    // left the drive tree, so it is not the vault's any more.
    expect(d.undated).toBe(1);
    // The summary alone answers who and what for the newest change.
    expect(r.summary).toBe(
      "listed the 4 most recently edited documents of 4 (1 more has no recorded edit time); newest: liberuum.eth — Status changed to CANONICAL",
    );
    // Membership came from the tree, times from the two listings.
    expect(requestAt(0).body.query).toContain("document(idOrSlug");
    expect(requestAt(1).body.variables).toEqual({ parentId: "d1" });
    expect(requestAt(2).body.query).toContain("knowledgeGraphRecent");
  });

  it("filters by type and by since, and serves repeat calls from the cache", async () => {
    mockGqlSequence(
      tree,
      contained,
      indexed,
      lastOp("INGEST_SOURCE", {}, A, "switchboard"),
      lastOp("INGEST_SOURCE", {}, A, "switchboard"),
      ens("liberuum.eth"),
      lastOp("SET_STATUS", { status: "CANONICAL" }, A, "switchboard"),
    );
    const sources = await executeTool("recent_changes", { documentType: "bai/source" }, CTX);
    if (!sources.ok) throw new Error(sources.error);
    expect((sources.data as { items: { documentId: string }[] }).items.map((i) => i.documentId)).toEqual(["s-new", "s-old"]);
    expect(sources.summary).toContain("bai/source documents of 4");

    const recent = await executeTool("recent_changes", { since: "2026-09-04", limit: 1 }, CTX);
    if (!recent.ok) throw new Error(recent.error);
    expect((recent.data as { items: { documentId: string }[] }).items.map((i) => i.documentId)).toEqual(["hr"]);
    expect(recent.summary).toContain("since 2026-09-04");
    // The listing itself was fetched once: the second call reused it and
    // only asked for the rows' last operations.
    const urls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.map((c) => (c as [string])[0]);
    expect(urls.filter((u) => u.includes("/graphql/knowledgeGraph"))).toHaveLength(1);
  });

  it("keeps the row when its last operation cannot be fetched", async () => {
    mockGqlSequence(tree, contained, indexed, { errors: [{ message: "nope" }] });
    const r = await executeTool("recent_changes", { limit: 1 }, CTX);
    if (!r.ok) throw new Error(r.error);
    const item = (r.data as { items: Record<string, unknown>[] }).items[0];
    expect(item.documentId).toBe("hr");
    expect(item.change).toBeUndefined();
  });

  it("rejects a date it cannot read and an unknown type", async () => {
    const bad = await executeTool("recent_changes", { since: "yesterday" }, CTX);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toContain("ISO 8601");
    const badType = await executeTool("recent_changes", { documentType: "evil/type" }, CTX);
    expect(badType.ok).toBe(false);
  });

  it("still answers when one time source fails", async () => {
    mockGqlSequence(
      tree,
      { errors: [{ message: "boom" }] },
      indexed,
      lastOp("SET_TITLE", { title: "t" }, A, "connect"),
      lastOp("SET_TITLE", { title: "t" }, A, "connect"),
      ens("liberuum.eth"),
    );
    const r = await executeTool("recent_changes", {}, CTX);
    if (!r.ok) throw new Error(r.error);
    expect((r.data as { items: { documentId: string }[] }).items.map((i) => i.documentId)).toEqual(["n1", "s-old"]);
  });
});

describe("tool arguments a model wraps in citation syntax", () => {
  it("read_note unwraps a [[documentId]] before asking the graph", async () => {
    mockGqlSequence({ data: { knowledgeGraphNodeByDocumentId: { documentId: "n1", title: "T", content: "body", topics: [] } } });
    const r = await executeTool("read_note", { documentId: "[[n1]]" }, { driveId: "d1" });
    expect(r.ok).toBe(true);
    expect(requestAt(0).body.variables).toEqual({ driveId: "d1", documentId: "n1" });
  });
});

describe("document_history — who changed a document, and what", () => {
  const CTX = { driveId: "d1" };
  const ADDRESS = "0x1AD3d72e54Fb0eB46e87F82f77B284FC8a66b16C";
  const head = (revision: number) => ({
    data: {
      document: {
        document: {
          id: "w9",
          name: "Treasury Management — WBS",
          documentType: "bai/wbs",
          createdAtUtcIso: "2026-09-05T10:14:34.900Z",
          lastModifiedAtUtcIso: "2026-09-05T12:13:25.697Z",
          revisionsList: [
            { scope: "document", revision: 2 },
            { scope: "global", revision },
          ],
        },
      },
    },
  });
  const signer = (address: string, app: string) => ({
    signer: { user: { address }, app: { name: app } },
  });
  const ops = {
    data: {
      documentOperations: {
        items: [
          {
            index: 83,
            timestampUtcMs: "2026-09-05T11:51:14.100Z",
            error: null,
            action: { type: "ASSIGN_GOAL", input: { assignee: "vault-harness" }, context: signer(ADDRESS, "powerhouse-knowledge") },
          },
          {
            index: 84,
            timestampUtcMs: "2026-09-05T12:13:25.697Z",
            error: null,
            action: { type: "SET_GOAL_STATUS", input: { status: "IN_REVIEW" }, context: signer(ADDRESS, "powerhouse-knowledge") },
          },
        ],
      },
    },
  };

  it("selects the tail by revision (offset is ignored by the reactor) and returns it newest first", async () => {
    mockGqlSequence(driveTree("w9"), head(85), ops);
    const r = await executeTool("document_history", { documentId: "w9", limit: 2 }, CTX);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.error);
    // 85 operations, 2 wanted → everything from revision 83 on.
    // request 0 is the membership check, 1 the document, 2 its operations
    expect(requestAt(2).body.variables).toEqual({ id: "w9", since: 83, limit: 2 });
    const d = r.data as { revision: number; title: string; changes: Record<string, unknown>[] };
    expect(d.revision).toBe(85);
    expect(d.changes.map((c) => c.action)).toEqual(["SET_GOAL_STATUS", "ASSIGN_GOAL"]);
    // Each change reads in the vault's own vocabulary, with who and how.
    expect(d.changes[0]).toEqual({
      revision: 85,
      at: "2026-09-05T12:13:25.697Z",
      action: "SET_GOAL_STATUS",
      change: "Goal IN_REVIEW",
      by: ADDRESS,
      // No ENS name for this signer in the mocked resolver.
      byName: null,
      byShort: "0x1AD3…b16C",
      via: "powerhouse-knowledge",
    });
    expect(r.summary).toBe(
      'read the last 2 of 85 changes to "Treasury Management — WBS" — newest: Goal IN_REVIEW by 0x1AD3…b16C via powerhouse-knowledge',
    );
  });

  it("asks for everything when the document has fewer operations than the limit", async () => {
    mockGqlSequence(driveTree("w9"), head(2), { data: { documentOperations: { items: ops.data.documentOperations.items.slice(0, 1) } } });
    const r = await executeTool("document_history", { documentId: "w9" }, CTX);
    if (!r.ok) throw new Error(r.error);
    expect(requestAt(2).body.variables).toEqual({ id: "w9", since: 0, limit: 10 });
  });

  it("reports an unsigned operation as the app that made it, with no person", async () => {
    mockGqlSequence(driveTree("w9"), head(1), {
      data: {
        documentOperations: {
          items: [
            { index: 0, timestampUtcMs: "2026-08-14T11:35:17.301Z", error: null, action: { type: "SET_DRIVE_NAME", input: { name: "powerhouse-knowledge" }, context: signer("", "switchboard") } },
          ],
        },
      },
    });
    const r = await executeTool("document_history", { documentId: "w9" }, CTX);
    if (!r.ok) throw new Error(r.error);
    const c = (r.data as { changes: { by: unknown; byShort: unknown; via: unknown }[] }).changes[0];
    expect(c).toMatchObject({ by: null, byShort: null, via: "switchboard" });
    expect(r.summary).toContain("via switchboard");
  });

  it("records a rejected operation as failed, and needs a documentId", async () => {
    mockGqlSequence(driveTree("w9"), head(1), {
      data: {
        documentOperations: {
          items: [
            { index: 0, timestampUtcMs: "2026-09-01T00:00:00.000Z", error: "Description exceeds 200 characters", action: { type: "SET_DESCRIPTION", input: { description: "x" }, context: signer(ADDRESS, "connect") } },
          ],
        },
      },
    });
    const r = await executeTool("document_history", { documentId: "w9" }, CTX);
    if (!r.ok) throw new Error(r.error);
    expect((r.data as { changes: { failed?: string }[] }).changes[0].failed).toBe("Description exceeds 200 characters");

    const missing = await executeTool("document_history", {}, CTX);
    expect(missing.ok).toBe(false);
  });

  it("says so when the document does not exist", async () => {
    mockGqlSequence(driveTree("nope"), { data: { document: null } });
    const r = await executeTool("document_history", { documentId: "nope" }, CTX);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("no document with id nope");
  });
});

describe("search_web / read_url", () => {
  const CTX = { driveId: "d1" };
  const READER = `Title: Example Domain\n\nMarkdown Content:\n# Example Domain\n\nThis domain is for use in illustrative examples. You may use this domain in literature without prior coordination or asking for permission.`;

  beforeEach(() => localStorage.clear());

  it("searches the keyless path and labels the result as outside the vault", async () => {
    const ddg = (u: string) => `https://duckduckgo.com/l/?uddg=${encodeURIComponent(u)}`;
    mockGqlSequence(); // no GraphQL here; the tool talks to the reader
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () =>
        Promise.resolve(
          `Markdown Content:\n## [Alan Turing - Wikipedia](${ddg("https://en.wikipedia.org/wiki/Alan_Turing")})\n\n[English mathematician.](${ddg("https://en.wikipedia.org/wiki/Alan_Turing")})`,
        ),
    }) as unknown as typeof fetch;
    const r = await executeTool("search_web", { query: "alan turing", limit: 3 }, CTX);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.error);
    const d = r.data as { via: string; outsideTheVault: boolean; results: { url: string }[] };
    expect(d.via).toBe("duckduckgo");
    expect(d.outsideTheVault).toBe(true);
    expect(d.results[0].url).toBe("https://en.wikipedia.org/wiki/Alan_Turing");
    expect(r.summary).toBe('searched the web for "alan turing" via DuckDuckGo → 1 result');
  });

  it("reads a page and reports a failure in the model's terms", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, text: () => Promise.resolve(READER) }) as unknown as typeof fetch;
    const r = await executeTool("read_url", { url: "https://example.com" }, CTX);
    if (!r.ok) throw new Error(r.error);
    expect(r.summary).toBe('read "Example Domain"');
    expect((r.data as { outsideTheVault: boolean }).outsideTheVault).toBe(true);

    const bad = await executeTool("read_url", { url: "http://localhost:11434" }, CTX);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toContain("private address");

    const missing = await executeTool("search_web", {}, CTX);
    expect(missing.ok).toBe(false);
  });

  it("uses a Tavily key when this browser has one stored", async () => {
    localStorage.setItem("bai-chat-web:v1", JSON.stringify({ tavilyKey: "tvly-x" }));
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ answer: "a", results: [{ title: "t", url: "https://x.example", content: "c" }] }),
    }) as unknown as typeof fetch;
    const r = await executeTool("search_web", { query: "q" }, CTX);
    if (!r.ok) throw new Error(r.error);
    expect((r.data as { via: string }).via).toBe("tavily");
    expect(r.summary).toContain("via Tavily");
  });
});

describe("read_url surfaces a useless page in the trail", () => {
  it("says nothing usable rather than reading out a 404", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve("Title: t\n\nMarkdown Content:\n## 404\n\n## This page could not be found."),
    }) as unknown as typeof fetch;
    const r = await executeTool("read_url", { url: "https://example.com/gone" }, { driveId: "d1" });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.error);
    expect(r.summary).toBe("read https://example.com/gone — nothing usable: This is a not-found page, not content");
    expect((r.data as { warning?: string }).warning).toMatch(/not-found page/);
  });
});

describe("ens_lookup", () => {
  const ADDRESS = "0xadbA7C2F82139031D7564D18aC22D09B12A0BcA4";

  it("answers who an address is, in one line the model can quote", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ address: ADDRESS, ens: "liberuum.eth", ens_primary: "liberuum.eth" }),
    }) as unknown as typeof fetch;
    const r = await executeTool("ens_lookup", { query: ADDRESS }, { driveId: "d1" });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.error);
    expect(r.summary).toBe(`liberuum.eth is the ENS name of ${ADDRESS}`);
    expect((r.data as { name: string }).name).toBe("liberuum.eth");
  });

  it("says plainly when an address has no name, and needs a query", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: () => Promise.resolve({ error: true, message: "Unable to resolve 0x…dead because it's not registered. Register at app.ens.domains" }),
    }) as unknown as typeof fetch;
    const r = await executeTool("ens_lookup", { query: "0x000000000000000000000000000000000000dEaD" }, { driveId: "d1" });
    if (!r.ok) throw new Error(r.error);
    expect(r.summary).toMatch(/has no ENS name — Unable to resolve/);
    expect((r.data as { name: string | null }).name).toBeNull();

    expect((await executeTool("ens_lookup", {}, { driveId: "d1" })).ok).toBe(false);
  });
});

describe("vault_editors", () => {
  const CTX = { driveId: "d1" };
  const A = "0xadbA7C2F82139031D7564D18aC22D09B12A0BcA4";
  const B = "0x1AD3d72e54Fb0eB46e87F82f77B284FC8a66b16C";
  const op = (signerAddress: string | null, signerApp: string, documentId: string, timestamp: string) => ({
    documentId,
    timestamp,
    signerAddress,
    signerApp,
  });
  const activity = {
    data: {
      knowledgeGraphActivity: [
        op(A, "switchboard", "n1", "2026-09-01T10:00:00.000Z"),
        op(A, "powerhouse-knowledge", "n2", "2026-09-04T10:00:00.000Z"),
        op(A, "powerhouse-knowledge", "n2", "2026-09-05T10:00:00.000Z"),
        op(B, "powerhouse-knowledge", "n3", "2026-09-03T10:00:00.000Z"),
        op("", "switchboard", "n4", "2026-08-30T10:00:00.000Z"),
      ],
    },
  };

  beforeEach(() => {
    resetEnsCache();
    localStorage.clear();
  });

  it("groups by person — one address through two apps is one editor, not two", async () => {
    mockGqlSequence(activity);
    // The ENS lookups that follow the GraphQL call.
    const gqlFetch = globalThis.fetch as ReturnType<typeof vi.fn>;
    gqlFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ address: A, ens_primary: "liberuum.eth" }),
    });
    const r = await executeTool("vault_editors", {}, CTX);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.error);
    const d = r.data as {
      editors: { name: string | null; address: string; operations: number; apps: Record<string, number>; documents: number; firstEdit: string; lastEdit: string }[];
      signedOperations: number;
      unsignedOperations: number;
      countedOperations: number;
      coverage: string;
    };
    expect(d.editors).toHaveLength(2);
    expect(d.editors[0]).toMatchObject({
      address: A,
      operations: 3,
      documents: 2,
      apps: { switchboard: 1, "powerhouse-knowledge": 2 },
    });
    expect(d.editors[0].firstEdit).toBe("2026-09-01T10:00:00.000Z");
    expect(d.editors[0].lastEdit).toBe("2026-09-05T10:00:00.000Z");
    // Unsigned operations are counted, never attributed to somebody.
    expect(d.unsignedOperations).toBe(1);
    expect(d.signedOperations).toBe(4);
    expect(d.countedOperations).toBe(5);
    expect(d.coverage).toContain("graph index");
    expect(r.summary).toMatch(/^2 editors across 5 recorded operations \(1 unsigned\); most active: /);
  });

  it("rejects a date it cannot read", async () => {
    const r = await executeTool("vault_editors", { since: "lately" }, CTX);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("ISO 8601");
  });
});

describe("tool name aliases", () => {
  it("answers the names other harnesses use instead of refusing", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve("Title: Example\n\nMarkdown Content:\n" + "Real page text about a subject. ".repeat(10)),
    }) as unknown as typeof fetch;
    // A proxy that injects its own web tools calls them web_search / web_fetch.
    const fetched = await executeTool("web_fetch", { url: "https://example.com" }, { driveId: "d1" });
    expect(fetched.ok).toBe(true);
    const unknown = await executeTool("definitely_not_a_tool", {}, { driveId: "d1" });
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.error).toContain('unknown tool "definitely_not_a_tool"');
  });
});

describe("a deleted document is not the vault's", () => {
  const CTX = { driveId: "d1" };
  // The drive tree holds one scope; the reactor still answers for both.
  const tree = {
    data: {
      document: {
        document: {
          state: {
            global: {
              nodes: [
                { id: "live-sow", kind: "file", name: "Powerhouse PMF", documentType: "powerhouse/scopeofwork" },
                { id: "n1", kind: "file", name: "a-note", documentType: "bai/knowledge-note" },
              ],
            },
          },
        },
      },
    },
  };
  const byType = (items: { id: string; name: string; documentType?: string }[]) => ({
    data: { findDocuments: { hasNextPage: false, items } },
  });
  const scope = {
    title: "Sow of the year",
    description: "",
    status: "SUBMITTED",
    contributors: [],
    projects: [],
    deliverables: [],
    roadmaps: [],
  };

  beforeEach(() => {
    resetVaultDocumentListing();
    resetEnsCache();
  });

  it("list_projects reports a failed scope query instead of an empty vault", async () => {
    // A reactor error used to be swallowed into "listed 0 envelopes across 0
    // scopes", which the model reads as "this vault has no projects".
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ errors: [{ message: "reactor unavailable" }] }),
    }) as unknown as typeof fetch;
    const r = await executeTool("list_projects", {}, CTX);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("reactor unavailable");
  });

  it("list_projects skips a scope the drive tree no longer holds", async () => {
    mockGqlSequence(
      byType([
        { id: "live-sow", name: "Powerhouse PMF" },
        { id: "ghost-sow", name: "test sowi" },
      ]),
      tree,
      { data: { document: { document: { id: "live-sow", name: "Powerhouse PMF", documentType: "powerhouse/scopeofwork", state: { global: { ...scope, title: "Powerhouse PMF" } } } } } },
    );
    const r = await executeTool("list_projects", {}, CTX);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.error);
    const d = r.data as { scopes: number; projects: unknown[] };
    expect(d.scopes).toBe(1);
    // The ghost was never read: only the live scope's document was fetched.
    const reads = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls
      .map((c) => JSON.parse(((c as [string, RequestInit])[1].body as string)) as { variables: Record<string, unknown> })
      .filter((b) => b.variables.id === "ghost-sow");
    expect(reads).toHaveLength(0);
  });

  it("list_documents counts what the vault holds, not what the reactor remembers", async () => {
    mockGqlSequence(
      byType([
        { id: "n1", name: "a-note", documentType: "bai/knowledge-note" },
        { id: "deleted", name: "gone", documentType: "bai/knowledge-note" },
      ]),
      tree,
    );
    const r = await executeTool("list_documents", { documentType: "bai/knowledge-note" }, CTX);
    if (!r.ok) throw new Error(r.error);
    expect((r.data as { items: { documentId: string }[] }).items.map((i) => i.documentId)).toEqual(["n1"]);
    expect(r.summary).toBe("listed 1 of 1 bai/knowledge-note in the vault");
  });

  it("read_document and document_history refuse a document the vault no longer holds", async () => {
    mockGqlSequence(tree, tree);
    const read = await executeTool("read_document", { documentId: "ghost-sow" }, CTX);
    expect(read.ok).toBe(false);
    if (!read.ok) expect(read.error).toMatch(/not in this vault — it was deleted/);

    const history = await executeTool("document_history", { documentId: "ghost-sow" }, CTX);
    expect(history.ok).toBe(false);
    if (!history.ok) expect(history.error).toMatch(/not in this vault/);
  });

  it("lets everything through when membership cannot be established", async () => {
    // The drive tree failed: hiding the whole vault would be worse than
    // occasionally showing a document that has left it.
    mockGqlSequence(
      { errors: [{ message: "drive unreachable" }] },
      { data: { document: { document: { id: "ghost-doc", name: "gone", documentType: "bai/source", state: { global: { title: "x", content: "y" } } } } } },
    );
    const r = await executeTool("read_document", { documentId: "ghost-doc" }, CTX);
    expect(r.ok).toBe(true);
  });
});

describe("sources: vault_stats and list_sources", () => {
  const tree = {
    data: {
      document: {
        document: {
          state: {
            global: {
              nodes: [
                { id: "f-src", kind: "folder", name: "sources", parentFolder: null },
                { id: "f-ai", kind: "folder", name: "AI Reports", parentFolder: "f-src" },
                { id: "f-soa", kind: "folder", name: "State of AI 2026", parentFolder: "f-ai" },
                { id: "s1", kind: "file", name: "part-1", documentType: "bai/source", parentFolder: "f-soa" },
                { id: "s2", kind: "file", name: "part-2", documentType: "bai/source", parentFolder: "f-soa" },
                { id: "s3", kind: "file", name: "pasted", documentType: "bai/source", parentFolder: "f-src" },
              ],
            },
          },
        },
      },
    },
  };
  const sources = {
    data: {
      findDocuments: {
        hasNextPage: false,
        items: [
          {
            id: "s1",
            name: "part-1",
            createdAtUtcIso: "2026-10-01T00:00:00.000Z",
            lastModifiedAtUtcIso: "2026-10-02T00:00:00.000Z",
            // The reactor may hand state back as a string; both are read.
            state: JSON.stringify({
              global: {
                title: "State of AI 2026 — Part 1",
                status: "EXTRACTED",
                sourceType: "PAPER",
                originalFileName: "state-of-ai.pdf",
                content: "x".repeat(50_000),
                extractedClaims: ["n1", "n2"],
              },
            }),
          },
          {
            id: "s2",
            name: "part-2",
            state: {
              global: {
                title: "State of AI 2026 — Part 2",
                status: "INBOX",
                sourceType: "PAPER",
                originalFileName: "state-of-ai.pdf",
                extractedClaims: [],
              },
            },
          },
          { id: "s3", name: "pasted", state: { global: { title: "Pasted notes", status: "EXTRACTING" } } },
          // Deleted from the drive, still in the reactor.
          { id: "gone", name: "gone", state: { global: { title: "Gone", status: "EXTRACTED" } } },
        ],
      },
    },
  };
  const graph = {
    data: {
      knowledgeGraphStats: {
        nodeCount: 221,
        noteCount: 217,
        mocCount: 14,
        scopeCount: 0,
        edgeCount: 638,
        orphanCount: 0,
        openTensionCount: 2,
      },
      knowledgeGraphDensity: 0.013,
    },
  };

  /** Answers each request by which query it is, since vault_stats sends them in parallel. */
  function mockVault(overrides: { graph?: unknown; sources?: unknown } = {}) {
    globalThis.fetch = vi.fn((_url: string, init: RequestInit) => {
      const { query } = JSON.parse(init.body as string) as { query: string };
      const body = query.includes("DriveTree")
        ? tree
        : query.includes("query Sources")
          ? (overrides.sources ?? sources)
          : (overrides.graph ?? graph);
      return Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
    }) as unknown as typeof fetch;
  }
  const queries = () =>
    (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => (JSON.parse((c[1] as RequestInit).body as string) as { query: string; variables: Record<string, unknown> }),
    );

  it("vault_stats adds how many sources there are, of what kinds, in which folders", async () => {
    mockVault();
    const r = await executeTool("vault_stats", {}, CTX);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const d = r.data as Record<string, unknown> & { sources: Record<string, unknown> };
    expect(d).toMatchObject({ noteCount: 217, edgeCount: 638, density: 0.013 });
    expect(d.sources).toMatchObject({
      total: 3,
      byStatus: { EXTRACTED: 1, INBOX: 1, EXTRACTING: 1 },
      bySourceType: { PAPER: 2, "not set": 1 },
      byFileType: { PDF: 2, "no original file": 1 },
      notesExtracted: 2,
      folderCount: 2,
      inSourcesRoot: 1,
      folders: [{ folderId: "f-ai", name: "AI Reports", path: "AI Reports", sources: 2, subfolders: 1 }],
    });
    expect(r.summary).toBe("vault: 217 notes, 14 maps, 0 scopes of work, 638 links, 0 orphans, 2 open tensions; 3 sources in 2 folders");
    // One request for every source, narrowed to this drive and to sources —
    // and none of their text reaches the model.
    const sourcesQuery = queries().find((q) => q.query.includes("query Sources"));
    expect(sourcesQuery?.query).toMatch(/type: "bai\/source", parentId: \$parentId/);
    expect(sourcesQuery?.variables).toMatchObject({ parentId: "drive-1" });
    expect(JSON.stringify(r.data)).not.toContain("xxxxxxxxxx");
  });

  it("vault_stats still counts the sources when the graph index does not answer", async () => {
    mockVault({ graph: { errors: [{ message: "relation graph_nodes does not exist" }] } });
    const r = await executeTool("vault_stats", {}, CTX);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data).toMatchObject({ graphError: "relation graph_nodes does not exist", sources: { total: 3 } });
      expect(r.summary).toMatch(/graph index did not answer .*; 3 sources in 2 folders/);
    }
  });

  it("vault_stats keeps the graph counts when the sources cannot be read", async () => {
    mockVault({ sources: { errors: [{ message: "reactor busy" }] } });
    const r = await executeTool("vault_stats", {}, CTX);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data).toMatchObject({ noteCount: 217, sources: null, sourcesError: "reactor busy" });
      expect(r.summary).toMatch(/; sources could not be counted$/);
    }
  });

  it("list_sources opens a folder by name and lists citable rows", async () => {
    mockVault();
    const r = await executeTool("list_sources", { folder: "State of AI 2026" }, CTX);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const d = r.data as { folder: { path: string }; sources: Record<string, unknown>[] };
    expect(d.folder.path).toBe("AI Reports/State of AI 2026");
    expect(d.sources.map((s) => [s.documentId, s.title, s.documentType, s.status])).toEqual([
      ["s1", "State of AI 2026 — Part 1", "bai/source", "EXTRACTED"],
      ["s2", "State of AI 2026 — Part 2", "bai/source", "INBOX"],
    ]);
    expect(r.summary).toBe("opened /sources/AI Reports/State of AI 2026: 0 folders, 2 sources");
  });

  it("list_sources reads the vault once for several calls in one answer", async () => {
    mockVault();
    await executeTool("vault_stats", {}, CTX);
    await executeTool("list_sources", {}, CTX);
    await executeTool("list_sources", { status: "INBOX", recursive: true }, CTX);
    expect(queries().filter((q) => q.query.includes("query Sources"))).toHaveLength(1);
  });

  it("list_sources reports a folder that does not exist, with the ones that do", async () => {
    mockVault();
    const r = await executeTool("list_sources", { folder: "Biology" }, CTX);
    expect(r).toEqual({
      ok: false,
      error: 'No folder "Biology" under /sources. The folders there are: AI Reports.',
    });
  });
});

describe("structure tools: keyword_search, notes_by_status, list_contradictions, topic_maps", () => {
  type Handler = (variables: Record<string, unknown>, query: string) => unknown;
  /** Answers each request by its operation name: `query K(` → handlers.K. */
  function mockByOperation(handlers: Partial<Record<string, Handler>>) {
    globalThis.fetch = vi.fn((_url: string, init: RequestInit) => {
      const { query, variables } = JSON.parse(init.body as string) as {
        query: string;
        variables: Record<string, unknown>;
      };
      const op = /query\s+(\w+)/.exec(query)?.[1] ?? "";
      const handler = handlers[op];
      if (!handler) throw new Error(`no handler for query ${op}`);
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: handler(variables, query) }) });
    }) as unknown as typeof fetch;
  }
  const sent = () =>
    (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => JSON.parse((c[1] as RequestInit).body as string) as { query: string; variables: Record<string, unknown> },
    );

  it("keyword_search finds a phrase, cuts a snippet, and never sends the body on", async () => {
    mockByOperation({
      K: () => ({
        knowledgeGraphFullSearch: [
          {
            documentId: "n1",
            title: "Turbine orders exceed build capacity",
            documentType: "bai/knowledge-note",
            content: `${"Context. ".repeat(80)}Backlog orders of 220 GW outpace the build rate.${" More.".repeat(80)}`,
          },
        ],
      }),
    });
    const r = await executeTool("keyword_search", { query: '"220 GW"' }, CTX);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const d = r.data as { match: string; hits: Record<string, unknown>[] };
    expect(d.match).toBe("phrase");
    expect(d.hits[0]).toMatchObject({ documentId: "n1", matchedIn: "content" });
    expect(d.hits[0].snippet).toMatch(/Backlog orders of 220 GW outpace/);
    expect(d.hits[0]).not.toHaveProperty("content");
    // The user's own quotation marks are not part of what was searched for.
    expect(r.summary).toBe('"220 GW" appears in 1 document');
    expect(sent()[0].variables).toMatchObject({ query: "220 gw" });
  });

  it("keyword_search looks for the words separately when the phrase is nowhere", async () => {
    mockByOperation({
      K: (v) =>
        v.query === "customer money offers"
          ? { knowledgeGraphFullSearch: [] }
          : {
              knowledgeGraphFullSearch: [
                { documentId: "a", title: "Offers a customer pays for", description: "money", documentType: "bai/knowledge-note" },
                { documentId: "b", title: "Customer retention", description: "nothing else", documentType: "bai/knowledge-note" },
              ],
            },
    });
    const r = await executeTool("keyword_search", { query: "customer money offers" }, CTX);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const d = r.data as { match: string; hits: { documentId: string }[] };
    expect(d.match).toBe("all words");
    expect(d.hits.map((h) => h.documentId)).toEqual(["a"]);
    // The second look is for the most telling word, widely.
    expect(sent()[1].variables).toMatchObject({ query: "customer", limit: 100 });
  });

  it("notes_by_status counts every stage in one request and lists the queue newest first", async () => {
    const note = (id: string, updatedAt: string) => ({
      documentId: id,
      title: `Note ${id}`,
      documentType: "bai/knowledge-note",
      status: "IN_REVIEW",
      updatedAt,
    });
    mockByOperation({
      NS: () => ({
        DRAFT: [{ documentId: "d1", documentType: "bai/knowledge-note" }],
        IN_REVIEW: [note("old", "2026-09-01T00:00:00Z"), note("new", "2026-10-01T00:00:00Z"), note("mid", "2026-09-15T00:00:00Z")],
        // A research claim is CANONICAL by construction — not an approval.
        CANONICAL: [
          { documentId: "c1", documentType: "bai/knowledge-note" },
          { documentId: "rc", documentType: "bai/research-claim" },
        ],
        ARCHIVED: [],
        inTopic: [{ documentId: "old" }, { documentId: "mid" }, { documentId: "c1" }],
      }),
    });
    const r = await executeTool("notes_by_status", { limit: 2 }, CTX);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const d = r.data as { counts: Record<string, number>; total: number; notes: { documentId: string }[] };
      expect(d.counts).toEqual({ DRAFT: 1, IN_REVIEW: 3, CANONICAL: 1, ARCHIVED: 0 });
      expect(d.total).toBe(3);
      expect(d.notes.map((n) => n.documentId)).toEqual(["new", "mid"]);
      expect(r.summary).toBe("3 notes waiting for review — 1 drafts, 3 waiting for review, 1 approved, 0 archived");
    }
    expect(sent()).toHaveLength(1);
    expect(sent()[0].query).not.toContain("inTopic");

    const byTopic = await executeTool("notes_by_status", { topic: "pricing", since: "2026-09-10" }, CTX);
    if (byTopic.ok) {
      const d = byTopic.data as { counts: Record<string, number>; notes: { documentId: string }[] };
      expect(d.notes.map((n) => n.documentId)).toEqual(["mid"]);
      expect(d.counts).toEqual({ DRAFT: 0, IN_REVIEW: 2, CANONICAL: 1, ARCHIVED: 0 });
    }
    expect(sent()[1].variables).toMatchObject({ topic: "pricing" });
    expect((await executeTool("notes_by_status", { status: "APPROVED" }, CTX)).ok).toBe(false);
  });

  it("list_contradictions names both notes, filling a title the edge did not carry", async () => {
    mockByOperation({
      C: () => ({
        knowledgeGraphNodesByType: [
          { documentId: "t1", title: "Contradiction on pricing", status: "OPEN", updatedAt: "2026-10-01" },
          { documentId: "t2", title: "Contradiction on turbines", status: "RESOLVED", updatedAt: "2026-10-02" },
        ],
      }),
      FL: () => ({
        l0: [
          { targetDocumentId: "a", linkType: "INVOLVES", targetTitle: "Claim A" },
          { targetDocumentId: "b", linkType: "INVOLVES", targetTitle: null },
        ],
      }),
      NT: () => ({ n0: { title: "Claim B" } }),
    });
    const r = await executeTool("list_contradictions", {}, CTX);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const d = r.data as { counts: Record<string, number>; contradictions: { documentId: string; notes: unknown[] }[] };
      expect(d.counts).toEqual({ OPEN: 1, RESOLVED: 1, DISSOLVED: 0 });
      expect(d.contradictions).toHaveLength(1);
      expect(d.contradictions[0]).toMatchObject({
        documentId: "t1",
        status: "OPEN",
        notes: [
          { documentId: "a", title: "Claim A" },
          { documentId: "b", title: "Claim B" },
        ],
      });
      expect(r.summary).toBe("1 open, 1 resolved, 0 dissolved contradictions; listed 1 open");
    }
  });

  it("topic_maps builds the hierarchy from one request per hundred maps, then opens one", async () => {
    mockByOperation({
      M: () => ({
        knowledgeGraphNodesByStatus: [
          { documentId: "hub", title: "Vault", noteType: "MOC (HUB)", description: "Entry point" },
          { documentId: "money", title: "Money Models", noteType: "MOC (DOMAIN)", description: "Offers" },
          { documentId: "upsell", title: "Upsell Offers", noteType: "MOC (TOPIC)", description: null },
        ],
      }),
      FL: (v) => {
        const edges: Record<string, unknown[]> = {
          hub: [{ targetDocumentId: "money", linkType: "CHILD_MOC", targetTitle: "Money Models" }],
          money: [
            { targetDocumentId: "upsell", linkType: "CHILD_MOC", targetTitle: "Upsell Offers" },
            { targetDocumentId: "n1", linkType: "CORE_IDEA", targetTitle: "Sequencing offers compounds revenue" },
          ],
          upsell: [{ targetDocumentId: "n2", linkType: "CORE_IDEA", targetTitle: null }],
        };
        return Object.fromEntries(Object.keys(v).filter((k) => k.startsWith("d")).map((k) => [`l${k.slice(1)}`, edges[v[k] as string] ?? []]));
      },
      NT: () => ({ n0: { title: "Upsells raise order value" } }),
      DriveTree: () => ({
        document: { document: { state: { global: { nodes: [{ id: "n2", kind: "file", name: "n2", documentType: "bai/knowledge-note" }] } } } },
      }),
    });
    const all = await executeTool("topic_maps", {}, CTX);
    expect(all.ok).toBe(true);
    if (all.ok) {
      const d = all.data as { maps: { title: string; depth: number; notesBeneath: number }[]; totalMaps: number };
      expect(d.maps.map((m) => [m.title, m.depth, m.notesBeneath])).toEqual([
        ["Vault", 0, 2],
        ["Money Models", 1, 2],
        ["Upsell Offers", 2, 1],
      ]);
      expect(all.summary).toBe("3 maps of content — 1 hub, 1 area, 1 topic — holding 2 notes");
    }
    const one = await executeTool("topic_maps", { map: "upsell" }, CTX);
    expect(one.ok).toBe(true);
    if (one.ok) {
      expect(one.data).toMatchObject({
        map: { documentId: "upsell", tier: "TOPIC" },
        path: [
          { documentId: "hub", title: "Vault" },
          { documentId: "money", title: "Money Models" },
        ],
        notes: [{ documentId: "n2", title: "Upsells raise order value", documentType: "bai/knowledge-note" }],
        notesTotal: 1,
      });
    }
    expect((await executeTool("topic_maps", { map: "biology" }, CTX)).ok).toBe(false);
  });
});

describe("tool definitions every kind of model accepts", () => {
  it("declares each tool in the subset of JSON Schema OpenAI, Anthropic, Gemini, xAI, ChatGPT and local servers all take", () => {
    for (const tool of CHAT_TOOLS) {
      const { name, parameters } = tool.function;
      // OpenAI and others require a name like this; Anthropic caps it at 64.
      expect(name).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
      const p = parameters as { type: string; properties?: Record<string, { type?: string; enum?: unknown[]; items?: unknown }>; required?: string[] };
      expect(p.type).toBe("object");
      // OpenAI wants `properties` present; Gemini refuses it empty — and with
      // it the whole request. So every tool has at least one.
      expect(Object.keys(p.properties ?? {}).length, `${name} has no parameters`).toBeGreaterThan(0);
      for (const [key, prop] of Object.entries(p.properties ?? {})) {
        expect(["string", "integer", "number", "boolean", "array"], `${name}.${key}`).toContain(prop.type);
        // A list is a list of strings, its item type stated — Gemini requires `items`.
        if (prop.type === "array") expect((prop as { items?: { type?: string } }).items?.type, `${name}.${key}`).toBe("string");
        // Gemini takes enums on strings only.
        if (prop.enum) {
          expect(prop.type, `${name}.${key}`).toBe("string");
          expect(prop.enum.every((v) => typeof v === "string")).toBe(true);
        }
      }
      for (const r of p.required ?? []) expect(p.properties).toHaveProperty(r);
    }
  });
});

describe("the optional parameters of vault_stats and list_projects", () => {
  it("vault_stats skips reading the sources when asked to", async () => {
    globalThis.fetch = vi.fn((_url: string, init: RequestInit) => {
      const { query } = JSON.parse(init.body as string) as { query: string };
      expect(query).not.toContain("query Sources");
      expect(query).not.toContain("DriveTree");
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ data: { knowledgeGraphStats: { nodeCount: 3, noteCount: 3, mocCount: 1, scopeCount: 0, edgeCount: 2, orphanCount: 0, openTensionCount: 0 }, knowledgeGraphDensity: 0.1 } }),
      });
    }) as unknown as typeof fetch;
    const r = await executeTool("vault_stats", { sources: false }, CTX);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data).not.toHaveProperty("sources");
      expect(r.summary).toBe("vault: 3 notes, 1 maps, 0 scopes of work, 2 links, 0 orphans, 0 open tensions; sources not counted");
    }
  });

  it("list_projects keeps only the projects in the state asked for, and says how many there are in all", async () => {
    const scope = {
      data: {
        document: {
          document: {
            id: "sow-1",
            name: "Platform 2027",
            documentType: "powerhouse/scopeofwork",
            state: {
              global: {
                title: "Platform 2027",
                status: "IN_PROGRESS",
                projects: [
                  { id: "e1", code: "P1", title: "Search", scope: { status: "IN_PROGRESS", deliverables: [] }, knowledgeRefs: [] },
                  { id: "e2", code: "P2", title: "Sync", scope: { status: "FINISHED", deliverables: [] }, knowledgeRefs: [] },
                ],
                deliverables: [],
                roadmaps: [],
                contributors: [],
              },
            },
          },
        },
      },
    };
    globalThis.fetch = vi.fn((_url: string, init: RequestInit) => {
      const { query } = JSON.parse(init.body as string) as { query: string };
      const body = query.includes("findDocuments")
        ? { data: { findDocuments: { items: [{ id: "sow-1", name: "Platform 2027" }] } } }
        : query.includes("DriveTree")
          ? driveTree("sow-1")
          : scope;
      return Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
    }) as unknown as typeof fetch;
    const r = await executeTool("list_projects", { status: "finished" }, CTX);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect((r.data as { projects: { project: string }[] }).projects.map((p) => p.project)).toEqual(["Sync"]);
      expect(r.summary).toBe("listed 1 FINISHED project of 2 across 1 scope — P2");
    }
    expect((await executeTool("list_projects", { status: "LATE" }, CTX)).ok).toBe(false);
  });
});

describe("reading for an answer", () => {
  type Handler = (variables: Record<string, unknown>, query: string) => unknown;
  function byOperation(handlers: Partial<Record<string, Handler>>) {
    globalThis.fetch = vi.fn((_url: string, init: RequestInit) => {
      const { query, variables } = JSON.parse(init.body as string) as { query: string; variables: Record<string, unknown> };
      const op = /query\s+(\w+)/.exec(query)?.[1] ?? "";
      const handler = handlers[op];
      if (!handler) throw new Error(`no handler for ${op}`);
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: handler(variables, query) }) });
    }) as unknown as typeof fetch;
  }

  it("read_notes reads several notes in one request, says which were not found, and how many are left", async () => {
    const ids = ["a", "b", "gone", "c", "d", "e", "f", "g", "h", "i"];
    byOperation({
      RN: (v) =>
        Object.fromEntries(
          Object.entries(v)
            .filter(([k]) => k.startsWith("d"))
            .map(([k, id]) => [`n${k.slice(1)}`, id === "gone" ? null : { documentId: id, title: `Note ${String(id)}`, content: `Body ${String(id)}` }]),
        ),
    });
    const r = await executeTool("read_notes", { documentIds: [...ids, "[[a]]"] }, CTX);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const d = r.data as { notes: { documentId: string; content: string }[]; missing: string[]; notRead: string[] };
    expect(d.notes.map((n) => n.documentId)).toEqual(["a", "b", "c", "d", "e", "f", "g"]);
    expect(d.notes[0].content).toBe("Body a");
    expect(d.missing).toEqual(["gone"]);
    // Eight per call; the [[a]] copied from prose was the same note, read once.
    expect(d.notRead).toEqual(["h", "i"]);
    expect(r.summary).toMatch(/^read 7 notes: "Note a", "Note b", .*; 1 not found; 2 left for another call$/);
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
    expect((await executeTool("read_notes", { documentIds: [] }, CTX)).ok).toBe(false);
  });

  it("search_vault names the source each top hit was extracted from", async () => {
    byOperation({
      S: () => ({
        knowledgeGraphSemanticSearch: [
          { similarity: 0.9, matchedBy: ["semantic"], node: { documentId: "n1", title: "Batching raises throughput", content: "Body" } },
          { similarity: 0.8, matchedBy: ["semantic"], node: { documentId: "n2", title: "Hand-written note" } },
        ],
      }),
      FL: () => ({
        l0: [
          { targetDocumentId: "src-4", linkType: "DERIVED_FROM", targetTitle: null },
          { targetDocumentId: "n9", linkType: "BUILDS_ON", targetTitle: "Other" },
        ],
        l1: [],
      }),
      DriveTree: () => ({
        document: { document: { state: { global: { nodes: [{ id: "src-4", kind: "file", name: "Chapter 4 Software", documentType: "bai/source" }] } } } },
      }),
    });
    const r = await executeTool("search_vault", { query: "how to start" }, CTX);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const hits = (r.data as { hits: Record<string, unknown>[] }).hits;
    expect(hits[0].source).toEqual({ documentId: "src-4", title: "Chapter 4 Software", documentType: "bai/source" });
    expect(hits[1]).not.toHaveProperty("source");
  });
});
