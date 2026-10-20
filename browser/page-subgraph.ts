/**
 * The subgraph the package's resolvers and REST routes see inside the page:
 * the in-page engine's client and relational database, ids resolved by the
 * client, and an authorization service for a vault with exactly one user —
 * the visitor, who may read and write everything and administer nothing.
 */
import type { BaseSubgraph } from "@powerhousedao/reactor-api";
import type { IReactorClient } from "@powerhousedao/reactor";
import type { IRelationalDb } from "@powerhousedao/shared/processors";
import type { PHDocument } from "document-model";

/** Who the routes see as the caller. */
export const VISITOR = {
  address: "browser-visitor",
  chainId: 0,
  networkId: "local",
  appKey: "knowledge-vault-web",
};

export function createPageSubgraph(client: IReactorClient, relationalDb: IRelationalDb): BaseSubgraph {
  const yes = () => Promise.resolve(true);
  const subgraph = {
    name: "browser-vault",
    reactorClient: client,
    relationalDb,
    assertCanRead: () => Promise.resolve(),
    assertCanWrite: () => Promise.resolve(),
    resolveCanonicalDocumentId: async (identifier: string) =>
      (await client.get<PHDocument>(identifier)).header.id,
    authorizationService: {
      canRead: yes,
      canWrite: yes,
      canMutate: yes,
      // Nobody administers a vault that lives in one browser.
      canManage: () => Promise.resolve(false),
      isSupremeAdmin: () => false,
    },
  };
  return subgraph as unknown as BaseSubgraph;
}
