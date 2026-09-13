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
});