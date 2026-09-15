import { describe, expect, it, vi } from "vitest";
import type { RouteContext } from "@powerhousedao/shared/processors";
import { createFakeReactorClient } from "../../../tests/helpers/fake-reactor-client.js";
import type { SearchRouteDeps } from "./search.js";
import { createSearchRoute } from "./search.js";

const ctx = {
  user: {
    address: "0xabc",
    chainId: 1,
    networkId: "eip155",
    appKey: "did:key:z",
  },
  params: {},
  authEnabled: true,
  transport: { proto: "http", host: "h", prefix: "", baseUrl: "http://h" },
} as unknown as RouteContext;

function deps(overrides: Partial<SearchRouteDeps> = {}): SearchRouteDeps {
  return {
    reactorClient: createFakeReactorClient(),
    resolveCanonicalDocumentId: vi.fn(async () => "drive") as never,
    authorization: {
      canRead: vi.fn(async () => true),
      canWrite: vi.fn(async () => true),
      canMutate: vi.fn(async () => true),
      isSupremeAdmin: vi.fn(() => false),
    },
    now: () => new Date(),
    uuid: () => "u",
    search: vi.fn(async () => [
      {
        node: { documentId: "n1", title: "T", content: "body" },
        similarity: 0.9,
        score: 0.03,
        matchedBy: ["semantic"],
      },
    ]),
    neighbourhood: vi.fn(async () => ({
      related: [],
      byHit: {},
      links: [],
      totalRelated: 0,
      truncated: false,
    })),
    ...overrides,
  };
}

describe("GET search", () => {
  it("400s without drive or q", async () => {
    const res = await createSearchRoute(deps())(
      new Request("http://h/search?q=x"),
      ctx,
    );
    expect(res.status).toBe(400);
  });

  it("strips content unless content=1", async () => {
    const res = await createSearchRoute(deps())(
      new Request("http://h/search?drive=d&q=x"),
      ctx,
    );
    const body = (await res.json()) as {
      hits: { node: Record<string, unknown> }[];
    };
    expect(body.hits[0].node).not.toHaveProperty("content");
  });

  it("passes content through with content=1", async () => {
    const res = await createSearchRoute(deps())(
      new Request("http://h/search?drive=d&q=x&content=1"),
      ctx,
    );
    const body = (await res.json()) as {
      hits: { node: Record<string, unknown> }[];
    };
    expect(body.hits[0].node.content).toBe("body");
  });

  it("renders markdown when asked", async () => {
    const res = await createSearchRoute(deps())(
      new Request("http://h/search?drive=d&q=x&content=1", {
        headers: { accept: "text/markdown" },
      }),
      ctx,
    );
    expect(res.headers.get("content-type")).toContain("text/markdown");
    expect(await res.text()).toContain("# Search: x");
  });

  it("returns 403 when the caller cannot read the drive", async () => {
    const d = deps();
    d.authorization.canRead = vi.fn(async () => false);
    const res = await createSearchRoute(d)(
      new Request("http://h/search?drive=d&q=x"),
      ctx,
    );
    expect(res.status).toBe(403);
  });

  it("expands the neighbourhood by default and reports the budget", async () => {
    const neighbourhood = vi.fn(async () => ({
      related: [
        {
          documentId: "n2",
          title: "Neighbour",
          description: "desc",
          noteType: "concept",
          status: "CANONICAL",
          documentType: "bai/knowledge-note",
          hitCount: 1,
          score: 1.08,
          via: [
            {
              from: "n1",
              fromTitle: "T",
              to: "n2",
              toTitle: "Neighbour",
              linkType: "BUILDS_ON",
              reason: "because it extends the claim",
              confidence: "grounded",
            },
          ],
        },
      ],
      byHit: {},
      links: [],
      totalRelated: 42,
      truncated: true,
    }));
    const d = deps({ neighbourhood });
    const res = await createSearchRoute(d)(
      new Request("http://h/search?drive=d&q=x"),
      ctx,
    );
    const body = (await res.json()) as {
      related: { documentId: string }[];
      expansion: { relatedTotal: number; relatedShown: number; truncated: boolean; hops: number };
    };
    expect(neighbourhood).toHaveBeenCalledWith("d", expect.any(Array), {
      limit: 10,
      includeArchived: false,
    });
    expect(body.related[0].documentId).toBe("n2");
    expect(body.expansion).toEqual({
      hops: 1,
      relatedTotal: 42,
      relatedShown: 1,
      truncated: true,
    });
  });

  it("skips expansion entirely with related=0", async () => {
    const neighbourhood = vi.fn(async () => ({
      related: [],
      byHit: {},
      links: [],
      totalRelated: 0,
      truncated: false,
    }));
    const res = await createSearchRoute(deps({ neighbourhood }))(
      new Request("http://h/search?drive=d&q=x&related=0"),
      ctx,
    );
    const body = (await res.json()) as { related: unknown[] };
    expect(neighbourhood).not.toHaveBeenCalled();
    expect(body.related).toEqual([]);
  });

  it("caps related at 50", async () => {
    const neighbourhood = vi.fn(async () => ({
      related: [],
      byHit: {},
      links: [],
      totalRelated: 0,
      truncated: false,
    }));
    await createSearchRoute(deps({ neighbourhood }))(
      new Request("http://h/search?drive=d&q=x&related=999"),
      ctx,
    );
    expect(neighbourhood).toHaveBeenCalledWith("d", expect.any(Array), {
      limit: 50,
      includeArchived: false,
    });
  });

  it("still answers when expansion throws", async () => {
    const d = deps({
      neighbourhood: vi.fn(async () => {
        throw new Error("graph unavailable");
      }),
    });
    const res = await createSearchRoute(d)(
      new Request("http://h/search?drive=d&q=x"),
      ctx,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      hits: unknown[];
      related: unknown[];
    };
    expect(body.hits).toHaveLength(1);
    expect(body.related).toEqual([]);
  });

  it("renders related notes and their links into the markdown", async () => {
    const d = deps({
      neighbourhood: vi.fn(async () => ({
        related: [
          {
            documentId: "n2",
            title: "Neighbour",
            description: "desc",
            noteType: "concept",
            status: "CANONICAL",
            documentType: "bai/knowledge-note",
            hitCount: 1,
            score: 1.08,
            via: [
              {
                from: "n1",
                fromTitle: "T",
                to: "n2",
                toTitle: "Neighbour",
                linkType: "BUILDS_ON",
                reason: "it extends the claim",
                confidence: "grounded",
              },
            ],
          },
        ],
        byHit: {},
        links: [
          {
            from: "n1",
            fromTitle: "T",
            to: "n3",
            toTitle: "Other hit",
            linkType: "RELATES_TO",
            reason: null,
            confidence: null,
          },
        ],
        totalRelated: 1,
        truncated: false,
      })),
    });
    const res = await createSearchRoute(d)(
      new Request("http://h/search?drive=d&q=x", {
        headers: { accept: "text/markdown" },
      }),
      ctx,
    );
    const text = await res.text();
    expect(text).toContain("## How these results connect to each other");
    expect(text).toContain("## Related notes (1 of 1");
    expect(text).toContain("**Neighbour**");
    // The edge is rendered from the related node's side, naming both ends so
    // there is no direction left to infer: n1 -> n2 is incoming here.
    expect(text).toContain("← *T* BUILDS_ON this note — it extends the claim");
    expect(text).toContain("GET notes/{id}");
  });

  it("warns when a related note contradicts a result", async () => {
    const contradicting = {
      documentId: "n9",
      title: "Disputed",
      description: "d",
      noteType: "concept",
      status: "CANONICAL",
      documentType: "bai/knowledge-note",
      hitCount: 1,
      score: 2,
      via: [
        {
          from: "n9",
          fromTitle: "Disputed",
          to: "n1",
          toTitle: "T",
          linkType: "CONTRADICTS",
          reason: null,
          confidence: null,
        },
      ],
    };
    const res = await createSearchRoute(
      deps({
        neighbourhood: vi.fn(async () => ({
          related: [contradicting],
          byHit: {},
          links: [],
          totalRelated: 1,
          truncated: false,
        })),
      }),
    )(
      new Request("http://h/search?drive=d&q=x", {
        headers: { accept: "text/markdown" },
      }),
      ctx,
    );
    const text = await res.text();
    expect(text).toContain(
      "**Caution: 1 of these contradict or supersede a result above.",
    );
    expect(text).toContain("→ this note CONTRADICTS *T*");
  });
});
