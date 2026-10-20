import { afterEach, describe, expect, it, vi } from "vitest";
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

  it("throws 403 when canWrite is false", async () => {
    const d = deps();
    d.authorization.canWrite = vi.fn(async () => false);
    await expect(canonicalForWrite(d, "doc", ctx)).rejects.toMatchObject({
      status: 403,
      code: "FORBIDDEN",
    });
  });
});

/**
 * Open mode: a desktop host's local engine runs with authentication off and
 * declares `KNOWLEDGE_VAULT_OPEN_MODE=1`; the anonymous caller is then the
 * engine's owner. A hosted deployment that merely has auth switched off
 * declares nothing and stays closed.
 */
describe("open mode", () => {
  const anonymous = (authEnabled: boolean) =>
    ({ ...ctx, user: undefined, authEnabled }) as unknown as RouteContext;
  afterEach(() => vi.unstubAllEnvs());

  it("still throws 401 when the host has auth disabled but open mode was not declared", () => {
    vi.stubEnv("KNOWLEDGE_VAULT_OPEN_MODE", "");
    expect(() => requireUser(anonymous(false))).toThrowError(
      expect.objectContaining({ status: 401, code: "UNAUTHENTICATED" }),
    );
  });

  it("returns the engine's owner for an anonymous caller when the host declared open mode", () => {
    vi.stubEnv("KNOWLEDGE_VAULT_OPEN_MODE", "1");
    vi.stubEnv("KNOWLEDGE_VAULT_OPEN_MODE_ADDRESS", "did:key:z6MkEngine");
    expect(requireUser(anonymous(false))).toEqual({
      address: "did:key:z6MkEngine",
      chainId: 0,
      networkId: "local",
      appKey: "desktop-knowledge-vault",
    });
  });

  it("falls back to 'local' when the host named no address", () => {
    vi.stubEnv("KNOWLEDGE_VAULT_OPEN_MODE", "1");
    vi.stubEnv("KNOWLEDGE_VAULT_OPEN_MODE_ADDRESS", "");
    expect(requireUser(anonymous(false)).address).toBe("local");
  });

  it("never opens when the host enforces authentication, whatever the environment says", () => {
    vi.stubEnv("KNOWLEDGE_VAULT_OPEN_MODE", "1");
    expect(() => requireUser(anonymous(true))).toThrowError(
      expect.objectContaining({ status: 401 }),
    );
  });

  it("hands a real user through unchanged in open mode", () => {
    vi.stubEnv("KNOWLEDGE_VAULT_OPEN_MODE", "1");
    expect(
      requireUser({ ...ctx, authEnabled: false } as unknown as RouteContext),
    ).toEqual(ctx.user);
  });
});
