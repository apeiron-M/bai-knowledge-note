import { describe, expect, it, vi } from "vitest";
import type { RouteContext } from "@powerhousedao/shared/processors";
import { createFakeReactorClient } from "../../../tests/helpers/fake-reactor-client.js";
import type { HttpRouteDeps } from "../lib/deps.js";
import { createRelationshipRoute } from "./relationships.js";

const ctx = {
  user: {
    address: "0xabc",
    chainId: 1,
    networkId: "eip155",
    appKey: "did:key:z",
  },
  params: {},
  authEnabled: true,
  signal: undefined,
  transport: { proto: "http", host: "h", prefix: "", baseUrl: "http://h" },
} as unknown as RouteContext;

const noteDocument = {
  header: {
    id: "doc",
    documentType: "bai/knowledge-note",
    revision: { global: 1, document: 2 },
  },
  state: { global: { status: "DRAFT" } },
};

function deps(overrides: Partial<HttpRouteDeps> = {}): HttpRouteDeps {
  return {
    reactorClient: createFakeReactorClient({
      get: vi.fn(async () => noteDocument) as never,
    } as never),
    resolveCanonicalDocumentId: vi.fn(async (identifier: string) =>
      identifier === "src" ? "src-canonical" : "tgt-canonical",
    ) as never,
    authorization: {
      canRead: vi.fn(async () => true),
      canWrite: vi.fn(async () => true),
      canMutate: vi.fn(async () => true),
      isSupremeAdmin: vi.fn(() => false),
    },
    now: () => new Date("2026-09-13T12:00:00.000Z"),
    uuid: () => "uuid-1",
    ...overrides,
  };
}

function request(method: string, body: unknown): Request {
  return new Request("http://h/relationships", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const validReason =
  "The source extends the target's claim about edge metadata to this route.";

describe("relationship routes", () => {
  it("400s on a bare knowledge edge (articulation)", async () => {
    const d = deps();
    const res = await createRelationshipRoute(d, "POST")(
      request("POST", { source: "src", target: "tgt", type: "BUILDS_ON" }),
      ctx,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("LINT_CONVENTION");
    expect(d.reactorClient.executeAsync).not.toHaveBeenCalled();
  });

  it("dispatches ADD_RELATIONSHIP in document scope with metadata", async () => {
    const executeAsync = vi.fn(async () => ({ id: "job-1" }));
    const d = deps({
      reactorClient: createFakeReactorClient({
        get: vi.fn(async () => noteDocument) as never,
        executeAsync: executeAsync as never,
      } as never),
    });
    const res = await createRelationshipRoute(d, "POST")(
      request("POST", {
        source: "src",
        target: "tgt",
        type: "BUILDS_ON",
        reason: validReason,
        confidence: "grounded",
      }),
      ctx,
    );
    expect(res.status).toBe(200);
    const [, , actions] = executeAsync.mock.calls[0] as unknown as [
      string,
      string,
      { type: string; scope: string; input: Record<string, unknown> }[],
    ];
    expect(actions[0].type).toBe("ADD_RELATIONSHIP");
    expect(actions[0].scope).toBe("document");
    expect(actions[0].input).toMatchObject({
      sourceId: "src-canonical",
      targetId: "tgt-canonical",
      relationshipType: "BUILDS_ON",
      metadata: { reason: validReason, confidence: "grounded" },
    });
  });

  it("allows a bare CORE_IDEA", async () => {
    const d = deps();
    const res = await createRelationshipRoute(d, "POST")(
      request("POST", { source: "src", target: "tgt", type: "CORE_IDEA" }),
      ctx,
    );
    expect(res.status).toBe(200);
  });

  it("PATCH sends UPDATE_RELATIONSHIP", async () => {
    const executeAsync = vi.fn(async () => ({ id: "job-1" }));
    const d = deps({
      reactorClient: createFakeReactorClient({
        get: vi.fn(async () => noteDocument) as never,
        executeAsync: executeAsync as never,
      } as never),
    });
    await createRelationshipRoute(d, "PATCH")(
      request("PATCH", {
        source: "src",
        target: "tgt",
        type: "BUILDS_ON",
        reason: validReason,
      }),
      ctx,
    );
    const [, , actions] = executeAsync.mock.calls[0] as unknown as [
      string,
      string,
      { type: string }[],
    ];
    expect(actions[0].type).toBe("UPDATE_RELATIONSHIP");
  });

  it("DELETE sends REMOVE_RELATIONSHIP and needs no reason", async () => {
    const executeAsync = vi.fn(async () => ({ id: "job-1" }));
    const d = deps({
      reactorClient: createFakeReactorClient({
        get: vi.fn(async () => noteDocument) as never,
        executeAsync: executeAsync as never,
      } as never),
    });
    const res = await createRelationshipRoute(d, "DELETE")(
      request("DELETE", { source: "src", target: "tgt", type: "BUILDS_ON" }),
      ctx,
    );
    expect(res.status).toBe(200);
    const [, , actions] = executeAsync.mock.calls[0] as unknown as [
      string,
      string,
      { type: string; input: Record<string, unknown> }[],
    ];
    expect(actions[0].type).toBe("REMOVE_RELATIONSHIP");
    expect(actions[0].input).not.toHaveProperty("metadata");
  });

  it("400s when source, target or type is missing", async () => {
    const res = await createRelationshipRoute(deps(), "POST")(
      request("POST", { source: "src" }),
      ctx,
    );
    expect(res.status).toBe(400);
  });
});