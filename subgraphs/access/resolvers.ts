import { GraphQLError } from "graphql";
import type { BaseSubgraph } from "@powerhousedao/reactor-api";
import { readAccessMap } from "./access-map.js";

/**
 * One ADMIN-gated read: the drive's whole access list.
 *
 * The check lives in the resolver rather than in a shared wrapper,
 * deliberately. This query publishes every address against every document, so
 * it must not be protected by a wrapper that could fail to be applied
 * elsewhere in the file. That failure mode is not hypothetical — this
 * package's knowledgeGraph subgraph served unguarded for a while after a
 * wrapper that had been verified working silently stopped taking effect.
 *
 * Two properties of the check matter:
 *
 *  - It resolves the drive to its **canonical id first**, so naming the drive
 *    by slug cannot route around the gate. Slugs are guessable; the permission
 *    tables are keyed by id.
 *  - It asks **canManage** — the host's own "administers this document"
 *    predicate: supreme admin, owner, or an ADMIN grant. Not canRead, which a
 *    mere reader passes, and not isSupremeAdmin, which answers true for
 *    everyone including anonymous callers when authorization is switched off.
 */
export const getResolvers = (subgraph: BaseSubgraph): Record<string, unknown> => ({
  Query: {
    accessMap: async (_: unknown, args: { driveId: string }, ctx: unknown) => {
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
          "Forbidden: accessMap requires ADMIN of this drive",
          { extensions: { code: "FORBIDDEN" } },
        );
      }
      return readAccessMap(subgraph, canonical);
    },
  },
});
