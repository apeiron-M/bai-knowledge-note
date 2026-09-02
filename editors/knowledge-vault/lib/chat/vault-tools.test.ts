import "../../../shared/test/browser-globals.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DOCUMENT_TYPES, VAULT_TOOLS, executeTool } from "./vault-tools.js";

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
  it("exposes exactly the ten read-only tools", () => {
    expect(VAULT_TOOLS.map((t) => t.function.name).sort()).toEqual([
      "linked_notes",
      "list_documents",
      "list_projects",
      "list_topics",
      "notes_by_topic",
      "read_document",
      "read_note",
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

describe("projects and work breakdowns", () => {
  const project = {
    name: "Vault chat",
    description: "d",
    status: "ACTIVE",
    owner: "liberuum",
    targetDate: "2026-09-15T00:00:00.000Z",
    wbsRef: "w1",
    team: [{ id: "t1", name: "liberuum", role: "Lead", kind: "HUMAN" }],
    deliverables: [
      {
        id: "d1",
        title: "Chat tab",
        description: null,
        status: "DELIVERED",
        goalRef: "g1",
        url: null,
        deliveredAt: null,
      },
      {
        id: "d2",
        title: "Docs",
        description: null,
        status: "PLANNED",
        goalRef: "g2",
        url: null,
        deliveredAt: null,
      },
    ],
    knowledgeRefs: ["n-a"],
    references: [],
    createdAt: null,
  };
  const wbs = {
    projectRef: "p1",
    owner: "liberuum",
    references: [],
    goals: [
      {
        id: "g1",
        description: "Ship it",
        status: "COMPLETED",
        parentId: null,
        assignee: null,
        dependencies: [],
        blockReason: null,
        outcome: null,
        notes: [],
      },
      {
        id: "g2",
        description: "Document it",
        status: "TODO",
        parentId: null,
        assignee: null,
        dependencies: [],
        blockReason: null,
        outcome: null,
        notes: [],
      },
    ],
  };
  const docResponse = (
    id: string,
    documentType: string,
    name: string,
    global: unknown,
  ) => ({
    data: {
      document: { document: { id, name, documentType, state: { global } } },
    },
  });

  it("list_projects reads each project's state and summarises it", async () => {
    mockGqlSequence(
      {
        data: {
          findDocuments: {
            totalCount: 1,
            items: [{ id: "p1", name: "Vault chat" }],
          },
        },
      },
      docResponse("p1", "bai/project", "Vault chat", project),
    );
    const r = await executeTool("list_projects", {}, CTX);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const d = r.data as {
        total: number;
        projects: Record<string, unknown>[];
      };
      expect(d.total).toBe(1);
      // The citation contract: documentId + title + documentType, so a
      // project is citable as [[documentId]] exactly like a note.
      expect(d.projects[0]).toMatchObject({
        documentId: "p1",
        title: "Vault chat",
        documentType: "bai/project",
        status: "ACTIVE",
        owner: "liberuum",
        targetDate: "2026-09-15",
        deliverables: { delivered: 1, total: 2 },
        teamSize: 1,
        wbs: { documentId: "w1", documentType: "bai/wbs" },
      });
      expect(d.projects[0]).not.toHaveProperty("id");
      expect(r.summary).toContain("1 of 1 projects");
    }
    expect(requestAt(0).url).toMatch(/\/graphql$/);
  });

  it("read_document on a project joins its WBS and resolves knowledge titles in one outline", async () => {
    mockGqlSequence(
      docResponse("p1", "bai/project", "Vault chat", project),
      docResponse("w1", "bai/wbs", "WBS", wbs),
      { data: { n0: { title: "A note about chat" } } },
    );
    const r = await executeTool("read_document", { documentId: "p1" }, CTX);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const d = r.data as {
        documentId: string;
        title: string;
        documentType: string;
        text: string;
        status: string;
        deliverables: { goal: { description: string } | null }[];
        goals: { completed: number; total: number };
      };
      expect(d).toMatchObject({ documentId: "p1", title: "Vault chat", documentType: "bai/project" });
      expect(d.status).toBe("ACTIVE");
      // The outline opens with its own citation marker, so the model cites
      // the document it read rather than a label it made up.
      expect(d.text.split("\n")[0]).toBe("# Project: Vault chat — ACTIVE [[p1]]");
      expect(d.text).toContain(
        "[DELIVERED] Chat tab — goal: Ship it (COMPLETED)",
      );
      expect(d.text).toContain("[TODO] Document it");
      expect(d.text).toContain("A note about chat [[n-a]]");
      expect(d.deliverables[0].goal?.description).toBe("Ship it");
      expect(d.goals).toEqual({
        completed: 1,
        total: 2,
        byStatus: { COMPLETED: 1, TODO: 1 },
      });
      expect(r.summary).toContain("1/2 goals done");
    }
    // project + wbs on the reactor endpoint, titles on the graph endpoint
    expect(requestAt(0).url).toMatch(/\/graphql$/);
    expect(requestAt(1).url).toMatch(/\/graphql$/);
    expect(requestAt(2).url).toContain("/graphql/knowledgeGraph");
  });

  it("read_document on a project survives a missing WBS", async () => {
    mockGqlSequence(
      docResponse("p1", "bai/project", "Vault chat", project),
      { errors: [{ message: "not found" }] },
      { data: {} },
    );
    const r = await executeTool("read_document", { documentId: "p1" }, CTX);
    expect(r.ok).toBe(true);
    if (r.ok)
      expect((r.data as { text: string }).text).toContain(
        "No work breakdown linked",
      );
  });

  it("read_document on a WBS renders the goal tree and names its project", async () => {
    mockGqlSequence(
      docResponse("w1", "bai/wbs", "WBS", wbs),
      docResponse("p1", "bai/project", "Vault chat", project),
    );
    const r = await executeTool("read_document", { documentId: "w1" }, CTX);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const d = r.data as {
        documentId: string;
        title: string;
        documentType: string;
        text: string;
        goalCount: number;
      };
      expect(d).toMatchObject({ documentId: "w1", title: "WBS", documentType: "bai/wbs" });
      expect(d.text.split("\n")[0]).toBe("# Work breakdown for Vault chat [[w1]]");
      expect(d.text).toContain("[COMPLETED] Ship it");
      expect(d.goalCount).toBe(2);
    }
  });

  it("list_documents returns the citation contract for every kind", async () => {
    mockGql({
      findDocuments: {
        totalCount: 1,
        items: [{ id: "s1", name: "Src", documentType: "bai/source" }],
      },
    });
    const r = await executeTool("list_documents", { documentType: "bai/source" }, CTX);
    expect(r.ok).toBe(true);
    if (r.ok)
      expect((r.data as { items: unknown[] }).items).toEqual([
        { documentId: "s1", title: "Src", documentType: "bai/source" },
      ]);
  });

  it("read_document on a source carries documentId and its title", async () => {
    mockGql({
      document: {
        document: {
          id: "s1",
          name: "Src file",
          documentType: "bai/source",
          state: { global: { title: "The Source", content: "body" } },
        },
      },
    });
    const r = await executeTool("read_document", { documentId: "s1" }, CTX);
    expect(r.ok).toBe(true);
    if (r.ok)
      expect(r.data).toMatchObject({ documentId: "s1", title: "The Source", documentType: "bai/source" });
  });
});
