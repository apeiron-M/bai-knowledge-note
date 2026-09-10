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
/**
 * Does the caller administer `documentId`? Resolves the canonical id first
 * (see above), then asks the host. Returns the canonical id alongside so a
 * caller that goes on to read can use the same one.
 */
async function callerCanManage(
  subgraph: BaseSubgraph,
  documentId: string,
  ctx: unknown,
): Promise<{ canonical: string; canManage: boolean }> {
  const canonical = await subgraph.resolveCanonicalDocumentId(
    documentId,
    ctx as object,
  );
  const address = (ctx as { user?: { address?: string } }).user?.address;
  const canManage = await subgraph.authorizationService.canManage(
    canonical,
    address,
  );
  return { canonical, canManage };
}

export const getResolvers = (subgraph: BaseSubgraph): Record<string, unknown> => ({
  Query: {
    accessMap: async (_: unknown, args: { driveId: string }, ctx: unknown) => {
      const { canonical, canManage } = await callerCanManage(
        subgraph,
        args.driveId,
        ctx,
      );
      if (!canManage) {
        throw new GraphQLError(
          "Forbidden: accessMap requires ADMIN of this drive",
          { extensions: { code: "FORBIDDEN" } },
        );
      }
      return readAccessMap(subgraph, canonical);
    },

    // Deliberately a plain answer, never a refusal: the whole point is that
    // asking must not produce an error anywhere, for anyone.
    canManage: async (_: unknown, args: { documentId: string }, ctx: unknown) =>
      (await callerCanManage(subgraph, args.documentId, ctx)).canManage,
  },
});
