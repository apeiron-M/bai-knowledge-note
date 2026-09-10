import { describe, expect, it, vi } from "vitest";
import type { BaseSubgraph } from "@powerhousedao/reactor-api";
import { getResolvers } from "./resolvers.js";

/**
 * A subgraph stub with exactly the two host services the resolvers touch.
 * `resolveCanonicalDocumentId` maps a slug to an id so the tests can prove the
 * permission check runs against the canonical id, never the caller's string.
 */
function stubSubgraph(admins: Set<string>) {
  const canManage = vi.fn(
    (id: string, address?: string) =>
      Promise.resolve(id === "drive-uuid" && !!address && admins.has(address)),
  );
  const subgraph = {
    resolveCanonicalDocumentId: vi.fn((id: string) =>
      Promise.resolve(id === "drive-slug" ? "drive-uuid" : id),
    ),
    authorizationService: { canManage },
  } as unknown as BaseSubgraph;
  return { subgraph, canManage };
}

type Query = {
  canManage: (_: unknown, args: { documentId: string }, ctx: unknown) => Promise<boolean>;
  accessMap: (_: unknown, args: { driveId: string }, ctx: unknown) => Promise<unknown>;
};

function queries(subgraph: BaseSubgraph): Query {
  return (getResolvers(subgraph) as { Query: Query }).Query;
}

const asUser = (address: string) => ({ user: { address } });

describe("Query.canManage", () => {
  it("is true for an address the host says administers the document", async () => {
    const { subgraph } = stubSubgraph(new Set(["0xadmin"]));
    await expect(
      queries(subgraph).canManage({}, { documentId: "drive-uuid" }, asUser("0xadmin")),
    ).resolves.toBe(true);
  });

  it("is false — not an error — for a reader", async () => {
    const { subgraph } = stubSubgraph(new Set(["0xadmin"]));
    await expect(
      queries(subgraph).canManage({}, { documentId: "drive-uuid" }, asUser("0xreader")),
    ).resolves.toBe(false);
  });

  it("is false — not an error — for an anonymous caller", async () => {
    const { subgraph } = stubSubgraph(new Set(["0xadmin"]));
    await expect(
      queries(subgraph).canManage({}, { documentId: "drive-uuid" }, {}),
    ).resolves.toBe(false);
  });

  it("checks the CANONICAL id, so a slug cannot route around the answer", async () => {
    const { subgraph, canManage } = stubSubgraph(new Set(["0xadmin"]));
    await queries(subgraph).canManage({}, { documentId: "drive-slug" }, asUser("0xadmin"));
    expect(canManage).toHaveBeenCalledWith("drive-uuid", "0xadmin");
  });
});

describe("Query.accessMap gate (unchanged by the refactor)", () => {
  it("still refuses a reader with a FORBIDDEN error", async () => {
    const { subgraph } = stubSubgraph(new Set(["0xadmin"]));
    await expect(
      queries(subgraph).accessMap({}, { driveId: "drive-uuid" }, asUser("0xreader")),
    ).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
  });

  it("still refuses an anonymous caller", async () => {
    const { subgraph } = stubSubgraph(new Set(["0xadmin"]));
    await expect(
      queries(subgraph).accessMap({}, { driveId: "drive-uuid" }, {}),
    ).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
  });
});
