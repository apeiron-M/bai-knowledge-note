import { describe, expect, it, vi } from "vitest";
import type { RouteContext } from "@powerhousedao/shared/processors";
import { createFakeReactorClient } from "../../../tests/helpers/fake-reactor-client.js";
import type { LlmsRouteDeps } from "./llms.js";
import { createLlmsRoute } from "./llms.js";

function ctx(user: boolean): RouteContext {
  return {
    user: user
      ? {
          address: "0xabc",
          chainId: 1,
          networkId: "eip155",
          appKey: "did:key:z",
        }
      : undefined,
    params: {},
    authEnabled: true,
    transport: { proto: "http", host: "h", prefix: "", baseUrl: "http://h" },
  } as unknown as RouteContext;
}

function deps(canReadAnonymous = true): LlmsRouteDeps {
  return {
    reactorClient: createFakeReactorClient(),
    resolveCanonicalDocumentId: vi.fn(async () => "drive") as never,
    authorization: {
      canRead: vi.fn(async () => canReadAnonymous),
      canWrite: vi.fn(async () => true),
      canMutate: vi.fn(async () => true),
      isSupremeAdmin: vi.fn(() => false),
    },
    now: () => new Date(),
    uuid: () => "u",
    getQuery: () =>
      ({
        nodesByStatus: vi.fn(async (status: string) =>
          status === "MOC"
            ? [
                {
                  documentId: "h1",
                  title: "Everything",
                  noteType: "MOC (HUB)",
                  content: null,
                  description: null,
                },
              ]
            : [
                {
                  documentId: "n1",
                  title: "A claim",
                  noteType: "concept",
                  content: "body",
                  description: null,
                },
              ],
        ),
        nodesByDocumentType: vi.fn(async (documentType: string) =>
          documentType === "bai/knowledge-note"
            ? [
                {
                  documentId: "d1",
                  title: "A draft claim",
                  noteType: "concept",
                  status: "DRAFT",
                  content: "draft body",
                  description: null,
                },
                {
                  documentId: "a1",
                  title: "An archived claim",
                  noteType: "concept",
                  status: "ARCHIVED",
                  content: "old",
                  description: null,
                },
              ]
            : [],
        ),
      }) as never,
  };
}

describe("llms routes", () => {
  it("serves MoC titles to an anonymous reader when the drive is open", async () => {
    const res = await createLlmsRoute(deps(), false)(
      new Request("http://h/llms.txt?drive=d"),
      ctx(false),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/plain");
    expect(await res.text()).toContain("h1.md?drive=d");
  });

  it("refuses the full index anonymously", async () => {
    const res = await createLlmsRoute(deps(), true)(
      new Request("http://h/llms-full.txt?drive=d"),
      ctx(false),
    );
    expect(res.status).toBe(401);
  });

  it("refuses when the drive is not anonymously readable", async () => {
    const res = await createLlmsRoute(deps(false), false)(
      new Request("http://h/llms.txt?drive=d"),
      ctx(false),
    );
    expect(res.status).toBe(401);
  });

  it("serves the full index to a signed-in reader", async () => {
    const res = await createLlmsRoute(deps(), true)(
      new Request("http://h/llms-full.txt?drive=d"),
      ctx(true),
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("# A claim");
  });

  it("excludes draft notes from the full index by default", async () => {
    const res = await createLlmsRoute(deps(), true)(
      new Request("http://h/llms-full.txt?drive=d"),
      ctx(true),
    );
    expect(await res.text()).not.toContain("# A draft claim");
  });

  it("includes non-archived notes with includeDrafts=1", async () => {
    const res = await createLlmsRoute(deps(), true)(
      new Request("http://h/llms-full.txt?drive=d&includeDrafts=1"),
      ctx(true),
    );
    const text = await res.text();
    expect(text).toContain("# A draft claim");
    expect(text).not.toContain("# An archived claim");
  });
});