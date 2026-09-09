import { GraphQLError } from "graphql";
import type { BaseSubgraph } from "@powerhousedao/reactor-api";
import { readAccessMap } from "./access-map.js";

/**
 * The whole resolver surface of this subgraph: one ADMIN-gated read.
 *
 * The check lives in the resolver rather than in a shared wrapper,
 * deliberately. This query publishes the vault's entire access list — every
 * address against every document — so it must not be protected by a wrapper
 * that could be applied incorrectly, or fail to load, somewhere else in the
 * file. That failure mode is not hypothetical: it happened to this package's
 * other subgraph, which served unguarded for a while after a wrapper I had
 * verified working silently stopped being applied.
 *
 * Two properties of the check matter:
 *
 *  - It resolves the drive to its **canonical id first**, so naming the drive
 *    by slug cannot route around the gate. Slugs are guessable; ids are the
 *    only thing the permission tables are keyed by.
 *  - It asks **canManage**, the host's own "administers this document"
 *    predicate — supreme admin, owner, or an ADMIN grant. Not canRead, which a
 *    mere reader passes, and not isSupremeAdmin, which answers true for
 *    everyone including anonymous callers when authorization is switched off.
 */
export const getResolvers = (subgraph: BaseSubgraph): Record<string, unknown> => ({
  Query: {
    vaultAccessMap: async (
      _: unknown,
      args: { driveId: string },
      ctx: unknown,
    ) => {
      const canonical = await subgraph.resolveCanonicalDocumentId(
        args.driveId,
        ctx as object,
      );
      const address = (ctx as { user?: { address?: string } }).user?.address;
      const canManage = await subgraph.authorizationService.canManage(
        canonical,
        address,
      );
      if (!canManage) {
        throw new GraphQLError(
          "Forbidden: vaultAccessMap requires ADMIN of this drive",
          { extensions: { code: "FORBIDDEN" } },
        );
      }
      return readAccessMap(subgraph, canonical);
    },
  },
});
