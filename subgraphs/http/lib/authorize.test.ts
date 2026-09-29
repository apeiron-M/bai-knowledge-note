import { describe, expect, it, vi } from "vitest";
import type { RouteContext } from "@powerhousedao/shared/processors";
import type { HttpRouteDeps } from "./deps.js";
import { canonicalForRead, canonicalForWrite, requireUser } from "./authorize.js";

const ctx = {
  user: {
    address: "0xabc",
    chainId: 1,
    networkId: "eip155",
    appKey: "did:key:zTest",
  },
  params: {},
  authEnabled: true,
  transport: { proto: "http", host: "x", prefix: "", baseUrl: "http://x" },
} as unknown as RouteContext;

function deps(overrides: Partial<HttpRouteDeps> = {}): HttpRouteDeps {
  return {
    reactorClient: {} as HttpRouteDeps["reactorClient"],
    resolveCanonicalDocumentId: vi.fn(
      async () => "canonical-id",
    ) as unknown as HttpRouteDeps["resolveCanonicalDocumentId"],
    authorization: {
      canRead: vi.fn(async () => true),
      canWrite: vi.fn(async () => true),
      canMutate: vi.fn(async () => true),
      isSupremeAdmin: vi.fn(() => false),
    },
    now: () => new Date("2026-09-13T12:00:00.000Z"),
    uuid: () => "uuid",
    ...overrides,
  };
}

describe("authorize", () => {
  it("throws 401 when no user is present", () => {
    expect(() =>
      requireUser({ ...ctx, user: undefined } as unknown as RouteContext),
    ).toThrowError(
      expect.objectContaining({ status: 401, code: "UNAUTHENTICATED" }),
    );
  });

  it("returns the canonical id when the caller may read", async () => {
    await expect(canonicalForRead(deps(), "doc", ctx)).resolves.toBe(
      "canonical-id",
    );
  });

  it("throws 403 when canRead is false", async () => {
    const d = deps();
    d.authorization.canRead = vi.fn(async () => false);
    await expect(canonicalForRead(d, "doc", ctx)).rejects.toMatchObject({
      status: 403,
      code: "FORBIDDEN",
    });
  });

  it("throws 404 instead of 403 when the refused document was deleted", async () => {
    const deleted = Object.assign(new Error("Document abc was deleted at 2026-09-28T19:00:00.000Z"), { name: "DocumentDeletedError" });
    const d = deps({ reactorClient: { get: vi.fn(async () => { throw deleted; }) } as unknown as HttpRouteDeps["reactorClient"] });
    d.authorization.canRead = vi.fn(async () => false);
    await expect(canonicalForRead(d, "doc", ctx)).rejects.toMatchObject({ status: 404, code: "NOT_FOUND" });
    d.authorization.canWrite = vi.fn(async () => false);
    await expect(canonicalForWrite(d, "doc", ctx)).rejects.toMatchObject({ status: 404, code: "NOT_FOUND" });
  });

  it("keeps 403 for a document that exists but may not be read", async () => {
    const d = deps({ reactorClient: { get: vi.fn(async () => ({})) } as unknown as HttpRouteDeps["reactorClient"] });
    d.authorization.canRead = vi.fn(async () => false);
    await expect(canonicalForRead(d, "doc", ctx)).rejects.toMatchObject({ status: 403, code: "FORBIDDEN" });
    const missing = Object.assign(new Error("Document doc not found"), { name: "DocumentNotFoundError" });
    d.reactorClient.get = vi.fn(async () => { throw missing; }) as never;
    await expect(canonicalForRead(d, "doc", ctx)).rejects.toMatchObject({ status: 404 });
    d.reactorClient.get = vi.fn(async () => { throw new Error("database unavailable"); }) as never;
    await expect(canonicalForRead(d, "doc", ctx)).rejects.toMatchObject({ status: 403 });
  });

  it("throws 403 when canWrite is false", async () => {
    const d = deps();
    d.authorization.canWrite = vi.fn(async () => false);
    await expect(canonicalForWrite(d, "doc", ctx)).rejects.toMatchObject({
      status: 403,
      code: "FORBIDDEN",
    });
  });
});
