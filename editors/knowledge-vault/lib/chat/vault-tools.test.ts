import "../../../shared/test/browser-globals.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DOCUMENT_TYPES, VAULT_TOOLS, executeTool, resetVaultDocumentListing } from "./vault-tools.js";

const CTX = { driveId: "drive-1" };

function mockGql(data: unknown) {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ data }),
  }) as unknown as typeof fetch;
}
function mockGqlSequence(...payloads: unknown[]) {
  const fn = vi.fn();
  for (const p of payloads) {
    fn.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(p) });
  }
  globalThis.fetch = fn as unknown as typeof fetch;
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
  it("exposes exactly the eleven read-only tools", () => {
    expect(VAULT_TOOLS.map((t) => t.function.name).sort()).toEqual([
      "linked_notes",
      "list_documents",
      "list_projects",
      "list_topics",
      "notes_by_topic",
      "read_document",
      "read_note",
      "recent_changes",
      "related_notes",
      "search_vault",
      "vault_stats",
    ]);
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

  it("search_vault projects content and topics away and hits the graph endpoint", async () => {
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
    const { url, body } = lastRequest();
    expect(url).toContain("/graphql/knowledgeGraph");
    expect(body.query).not.toMatch(/\bcontent\b/);
    expect(body.query).not.toMatch(/\btopics\b/);
    expect(body.variables).toMatchObject({
      driveId: "drive-1",
      query: "audit trails",
      limit: 8,
    });
    if (r.ok) {
      expect(r.summary).toContain("audit trails");
      expect(r.summary).toContain("1");
      expect((r.data as { documentId: string }[])[0].documentId).toBe("n1");
    }
  });

  it("search_vault caps the limit at 20 and rejects an empty query", async () => {
    mockGql({ knowledgeGraphSemanticSearch: [] });
    await executeTool("search_vault", { query: "x", limit: 500 }, CTX);
    expect(lastRequest().body.variables.limit).toBe(20);

    globalThis.fetch = vi.fn() as unknown as typeof fetch;
    expect((await executeTool("search_vault", { query: "   " }, CTX)).ok).toBe(
      false,
    );
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("read_note truncates a long body and says so", async () => {
    mockGql({
      knowledgeGraphNodeByDocumentId: {
        documentId: "n1",
        title: "T",
        content: "x".repeat(9000),
        topics: ["a"],
      },
    });
    const r = await executeTool("read_note", { documentId: "n1" }, CTX);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const d = r.data as {
        content: string;
        truncated: boolean;
        topics: string[];
      };
      expect(d.content.length).toBe(6000);
      expect(d.truncated).toBe(true);
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
        { documentId: "i1", title: "In one", linkType: "BUILDS_ON" },
        { documentId: "i2", title: "In two", linkType: "RELATES_TO" },
      ]);
    }
    expect(
      (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls,
    ).toHaveLength(2);
  });

  it("vault_stats combines stats and density in one request", async () => {
    mockGql({
      knowledgeGraphStats: {
        nodeCount: 521,
        edgeCount: 2211,
        orphanCount: 146,
      },
      knowledgeGraphDensity: 0.0081,
    });
    const r = await executeTool("vault_stats", {}, CTX);
    expect(r.ok).toBe(true);
    if (r.ok)
      expect(r.data).toEqual({
        nodeCount: 521,
        edgeCount: 2211,
        orphanCount: 146,
        density: 0.0081,
      });
    expect(
      (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls,
    ).toHaveLength(1);
  });

  it("list_documents hits the reactor endpoint and rejects an unknown type", async () => {
    mockGql({
      findDocuments: {
        totalCount: 18,
        items: [{ id: "s1", name: "Src", documentType: "bai/source" }],
      },
    });
    const r = await executeTool(
      "list_documents",
      { documentType: "bai/source" },
      CTX,
    );
    expect(r.ok).toBe(true);
    const { url, body } = lastRequest();
    expect(url).toMatch(/\/graphql$/);
    expect(body.variables).toMatchObject({ type: "bai/source", limit: 50 });
    if (r.ok) expect((r.data as { total: number }).total).toBe(18);

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
      { data: { findDocuments: { totalCount: 1, items: [{ id: "s1", name: "Powerhouse PMF" }] } } },
      docResponse("s1", "powerhouse/scopeofwork", "Powerhouse PMF", scope),
    );
    const r = await executeTool("list_projects", {}, CTX);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.error);
    const d = r.data as { total: number; scopes: number; projects: Record<string, unknown>[] };
    expect(d.scopes).toBe(1);
    expect(d.total).toBe(1);
    // documentId + title name the SCOPE (what the citation chip shows and
    // opens); the envelope's own identity is nested.
    expect(d.projects[0]).toMatchObject({
      documentId: "s1",
      documentType: "powerhouse/scopeofwork",
      title: "Powerhouse PMF",
      envelope: { id: "env1", code: "PPD", title: "Paperless demo", owner: "Frank", status: "IN_PROGRESS", cite: "[[s1#env1]]" },
      progress: { delivered: 1, total: 2, pct: 50 },
      budget: { type: "OPEX", currency: "USD", budget: 0, targetBudget: null },
      knowledgeRefs: 1,
      wbs: { documentId: "w9", documentType: "bai/wbs", title: "Work breakdown for Paperless demo" },
    });
    expect(r.summary).toBe("listed 1 envelope across 1 scope");
  });

  it("read_document on a scope joins deliverables to their goals and names the wbs", async () => {
    mockGqlSequence(
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
        totalCount: 3,
        items: [
          { id: "s1", name: "Swarm Protocol Reference", documentType: "bai/source" },
          { id: "s2", name: "Book of Powerhouse — overview", documentType: "bai/source" },
          { id: "s3", name: "How Connect Swarm Integration Works", documentType: "bai/source" },
        ],
      },
    },
  };

  it("filters by title over the largest page and says how much it scanned", async () => {
    mockGqlSequence(page);
    const r = await executeTool("list_documents", { documentType: "bai/source", nameContains: "swarm" }, CTX);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.error);
    expect(requestAt(0).body.variables).toEqual({ type: "bai/source", limit: 100 });
    expect(r.data).toEqual({
      total: 3,
      scanned: 3,
      matched: 2,
      items: [
        { documentId: "s1", title: "Swarm Protocol Reference", documentType: "bai/source" },
        { documentId: "s3", title: "How Connect Swarm Integration Works", documentType: "bai/source" },
      ],
    });
    expect(r.summary).toBe('listed 2 of 2 bai/source whose title contains "swarm" (scanned 3 of 3)');
  });

  it("still honours limit on the filtered list and behaves as before without a filter", async () => {
    mockGqlSequence(page);
    const filtered = await executeTool("list_documents", { documentType: "bai/source", nameContains: "swarm", limit: 1 }, CTX);
    if (!filtered.ok) throw new Error(filtered.error);
    expect((filtered.data as { items: unknown[] }).items).toHaveLength(1);

    mockGqlSequence(page);
    const plain = await executeTool("list_documents", { documentType: "bai/source", limit: 2 }, CTX);
    if (!plain.ok) throw new Error(plain.error);
    expect(requestAt(0).body.variables).toEqual({ type: "bai/source", limit: 2 });
    expect(plain.data).not.toHaveProperty("matched");
    // The mock ignores paging, so the page holds 3; the tool still trims to the limit.
    expect(plain.summary).toBe("listed 2 of 3 bai/source");
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
          { id: "n1", lastModifiedAtUtcIso: "2026-09-01T00:00:00.000Z" },
          { id: "stranger", lastModifiedAtUtcIso: "2026-09-05T00:00:00.000Z" }, // another drive: not in the tree
        ],
      },
    },
  };
  const indexed = {
    data: {
      knowledgeGraphRecent: [
        // The index saw a later edit of n1 than the reactor listing did.
        { documentId: "n1", title: "A real title", noteType: "concept", status: "CANONICAL", updatedAt: "2026-09-03T10:00:00.000Z" },
      ],
    },
  };

  beforeEach(() => resetVaultDocumentListing());

  it("merges the drive tree with both time sources, newest first, and counts documents with no known edit time", async () => {
    mockGqlSequence(tree, contained, indexed);
    const r = await executeTool("recent_changes", {}, CTX);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.error);
    const d = r.data as { items: { documentId: string; title: string; documentType: string; lastModifiedAt: string; noteType: string | null }[]; undated: number };
    expect(d.items.map((i) => i.documentId)).toEqual(["hr", "s-new", "n1"]);
    expect(d.items[0]).toEqual({ documentId: "hr", title: "HealthReport", documentType: "bai/health-report", lastModifiedAt: "2026-09-04T16:00:00.000Z", noteType: null, status: null });
    // The later of the two stamps wins, and the index supplies the note's real title.
    expect(d.items[2]).toMatchObject({ documentId: "n1", title: "A real title", lastModifiedAt: "2026-09-03T10:00:00.000Z", noteType: "concept" });
    // s-old and elsewhere are in the vault but have no edit time anywhere; stranger is not in the vault.
    expect(d.undated).toBe(2);
    expect(r.summary).toBe("listed the 3 most recently edited documents of 3 (2 more have no recorded edit time)");
    // Membership came from the tree, times from the two listings.
    expect(requestAt(0).body.query).toContain("document(identifier");
    expect(requestAt(1).body.variables).toEqual({ parentId: "d1" });
    expect(requestAt(2).body.query).toContain("knowledgeGraphRecent");
  });

  it("filters by type and by since, and serves repeat calls from the cache", async () => {
    mockGqlSequence(tree, contained, indexed);
    const sources = await executeTool("recent_changes", { documentType: "bai/source" }, CTX);
    if (!sources.ok) throw new Error(sources.error);
    expect((sources.data as { items: { documentId: string }[] }).items.map((i) => i.documentId)).toEqual(["s-new"]);
    expect(sources.summary).toContain("bai/source document of 3");

    const recent = await executeTool("recent_changes", { since: "2026-09-04", limit: 1 }, CTX);
    if (!recent.ok) throw new Error(recent.error);
    expect((recent.data as { items: { documentId: string }[] }).items.map((i) => i.documentId)).toEqual(["hr"]);
    expect(recent.summary).toContain("since 2026-09-04");
    // Three requests in total — the second call did not refetch.
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(3);
  });

  it("rejects a date it cannot read and an unknown type", async () => {
    const bad = await executeTool("recent_changes", { since: "yesterday" }, CTX);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toContain("ISO 8601");
    const badType = await executeTool("recent_changes", { documentType: "evil/type" }, CTX);
    expect(badType.ok).toBe(false);
  });

  it("still answers when one time source fails", async () => {
    mockGqlSequence(tree, { errors: [{ message: "boom" }] }, indexed);
    const r = await executeTool("recent_changes", {}, CTX);
    if (!r.ok) throw new Error(r.error);
    expect((r.data as { items: { documentId: string }[] }).items.map((i) => i.documentId)).toEqual(["n1"]);
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
