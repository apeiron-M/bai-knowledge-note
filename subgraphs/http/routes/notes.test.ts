import { describe, expect, it, vi } from "vitest";
import type { RouteContext } from "@powerhousedao/shared/processors";
import { createFakeReactorClient } from "../../../tests/helpers/fake-reactor-client.js";
import type { NotesRouteDeps } from "./notes.js";
import { createNotesRoute } from "./notes.js";

function ctxFor(id: string): RouteContext {
  return {
    user: {
      address: "0xabc",
      chainId: 1,
      networkId: "eip155",
      appKey: "did:key:z",
    },
    params: { id },
    authEnabled: true,
    transport: { proto: "http", host: "h", prefix: "", baseUrl: "http://h" },
  } as unknown as RouteContext;
}

function deps(overrides: Partial<NotesRouteDeps> = {}): NotesRouteDeps {
  return {
    reactorClient: createFakeReactorClient(),
    resolveCanonicalDocumentId: vi.fn(async () => "n1") as never,
    authorization: {
      canRead: vi.fn(async () => true),
      canWrite: vi.fn(async () => true),
      canMutate: vi.fn(async () => true),
      isSupremeAdmin: vi.fn(() => false),
    },
    now: () => new Date(),
    uuid: () => "u",
    edges: vi.fn(async () => []),
    ...overrides,
  };
}

describe("GET notes/:id", () => {
  it("requires a drive", async () => {
    const res = await createNotesRoute(deps())(
      new Request("http://h/notes/n1"),
      ctxFor("n1"),
    );
    expect(res.status).toBe(400);
  });

  it("returns JSON state and edges", async () => {
    const edge = {
      direction: "out" as const,
      documentId: "n2",
      linkType: "BUILDS_ON",
      title: "Other",
      reason: "Extends the claim",
      confidence: "grounded",
    };
    const res = await createNotesRoute(deps({ edges: vi.fn(async () => [edge]) }))(
      new Request("http://h/notes/n1?drive=d"),
      ctxFor("n1"),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      id: string;
      documentType: string;
      edges: unknown[];
    };
    expect(body.id).toBe("doc");
    expect(body.documentType).toBe("bai/source");
    expect(body.edges).toHaveLength(1);
  });

  it("renders markdown for notes/:id.md", async () => {
    const res = await createNotesRoute(deps(), true)(
      new Request("http://h/notes/n1.md?drive=d"),
      ctxFor("n1"),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/markdown");
    expect(await res.text()).toContain("---");
  });

  it("404s when the document cannot be resolved", async () => {
    const notFound = new Error("missing");
    notFound.name = "CanonicalDocumentIdResolutionError";
    const d = deps({
      resolveCanonicalDocumentId: vi.fn(async () => {
        throw notFound;
      }) as never,
    });
    const res = await createNotesRoute(d)(
      new Request("http://h/notes/nope?drive=d"),
      ctxFor("nope"),
    );
    expect(res.status).toBe(404);
  });

  it("403s without read access", async () => {
    const d = deps();
    d.authorization.canRead = vi.fn(async () => false);
    const res = await createNotesRoute(d)(
      new Request("http://h/notes/n1?drive=d"),
      ctxFor("n1"),
    );
    expect(res.status).toBe(403);
  });
});