import type { RouteContext } from "@powerhousedao/shared/processors";
import { afterEach, describe, expect, it, vi } from "vitest";
import { requireUser } from "./authorize.js";

/** Mirrors `subgraphs/http/lib/authorize.test.ts` — the guard is mirrored too. */
const user = {
  address: "0xabc",
  chainId: 1,
  networkId: "eip155",
  appKey: "did:key:zTest",
};
const ctx = (over: Partial<RouteContext>): RouteContext =>
  ({ params: {}, user, authEnabled: true, ...over }) as unknown as RouteContext;

describe("convert requireUser", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("throws 401 for an anonymous caller when the host enforces authentication", () => {
    expect(() => requireUser(ctx({ user: undefined }))).toThrowError(
      expect.objectContaining({ status: 401, code: "UNAUTHENTICATED" }),
    );
  });

  it("throws 401 with auth disabled when open mode was not declared — conversion is compute", () => {
    vi.stubEnv("KNOWLEDGE_VAULT_OPEN_MODE", "");
    expect(() =>
      requireUser(ctx({ user: undefined, authEnabled: false })),
    ).toThrowError(expect.objectContaining({ status: 401 }));
  });

  it("returns the engine's owner for an anonymous caller in declared open mode", () => {
    vi.stubEnv("KNOWLEDGE_VAULT_OPEN_MODE", "1");
    vi.stubEnv("KNOWLEDGE_VAULT_OPEN_MODE_ADDRESS", "did:key:z6MkEngine");
    expect(requireUser(ctx({ user: undefined, authEnabled: false }))).toEqual({
      address: "did:key:z6MkEngine",
      chainId: 0,
      networkId: "local",
      appKey: "desktop-knowledge-vault",
    });
  });

  it("never opens when the host enforces authentication", () => {
    vi.stubEnv("KNOWLEDGE_VAULT_OPEN_MODE", "1");
    expect(() => requireUser(ctx({ user: undefined }))).toThrowError(
      expect.objectContaining({ status: 401 }),
    );
  });

  it("hands a real user through unchanged", () => {
    vi.stubEnv("KNOWLEDGE_VAULT_OPEN_MODE", "1");
    expect(requireUser(ctx({ authEnabled: false }))).toEqual(user);
  });
});
