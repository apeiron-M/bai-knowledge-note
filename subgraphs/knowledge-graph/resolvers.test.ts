import { describe, expect, it, vi } from "vitest";
import type { BaseSubgraph } from "@powerhousedao/reactor-api";
import { assertOncePerRequest } from "./resolvers.js";

function subgraph(
  assertCanRead = vi.fn(async () => ({}) as never),
  assertCanWrite = vi.fn(async () => ({}) as never),
) {
  return {
    subgraph: { assertCanRead, assertCanWrite } as unknown as BaseSubgraph,
    assertCanRead,
    assertCanWrite,
  };
}

describe("assertOncePerRequest", () => {
  it("checks once for repeated aliases in one request", async () => {
    const { subgraph: s, assertCanRead } = subgraph();
    const ctx = {};
    await Promise.all([
      assertOncePerRequest(s, ctx, "drive", false),
      assertOncePerRequest(s, ctx, "drive", false),
      assertOncePerRequest(s, ctx, "drive", false),
    ]);
    expect(assertCanRead).toHaveBeenCalledTimes(1);
  });

  it("does NOT share a decision between requests", async () => {
    const { subgraph: s, assertCanRead } = subgraph();
    await assertOncePerRequest(s, {}, "drive", false);
    await assertOncePerRequest(s, {}, "drive", false);
    // Different ctx objects are different requests, and therefore possibly
    // different identities. A shared decision here would be a auth bypass.
    expect(assertCanRead).toHaveBeenCalledTimes(2);
  });

  it("still refuses an unauthorized drive, and refuses every alias", async () => {
    const denied = vi.fn(async () => {
      throw new Error("Forbidden");
    });
    const { subgraph: s } = subgraph(denied as never);
    const ctx = {};
    await expect(
      assertOncePerRequest(s, ctx, "drive", false),
    ).rejects.toThrow("Forbidden");
    // the memoized rejection must not turn into a pass for a later alias
    await expect(
      assertOncePerRequest(s, ctx, "drive", false),
    ).rejects.toThrow("Forbidden");
    expect(denied).toHaveBeenCalledTimes(1);
  });

  it("keeps read and write decisions separate", async () => {
    const { subgraph: s, assertCanRead, assertCanWrite } = subgraph();
    const ctx = {};
    await assertOncePerRequest(s, ctx, "drive", false);
    await assertOncePerRequest(s, ctx, "drive", true);
    // A read grant must never satisfy a privileged resolver.
    expect(assertCanRead).toHaveBeenCalledTimes(1);
    expect(assertCanWrite).toHaveBeenCalledTimes(1);
  });

  it("keeps decisions separate per drive", async () => {
    const { subgraph: s, assertCanRead } = subgraph();
    const ctx = {};
    await assertOncePerRequest(s, ctx, "drive-a", false);
    await assertOncePerRequest(s, ctx, "drive-b", false);
    expect(assertCanRead).toHaveBeenCalledTimes(2);
  });

  it("falls back to an unmemoized check when ctx is not an object", async () => {
    const { subgraph: s, assertCanRead } = subgraph();
    await assertOncePerRequest(s, undefined, "drive", false);
    await assertOncePerRequest(s, undefined, "drive", false);
    expect(assertCanRead).toHaveBeenCalledTimes(2);
  });
});
