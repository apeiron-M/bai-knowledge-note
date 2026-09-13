import type { BaseSubgraph } from "@powerhousedao/reactor-api";
import type { HttpRouteDeps } from "./lib/deps.js";

export function buildHttpRouteDeps(subgraph: BaseSubgraph): HttpRouteDeps {
  return {
    reactorClient: subgraph.reactorClient,
    resolveCanonicalDocumentId: (identifier, ctx) =>
      subgraph.resolveCanonicalDocumentId(identifier, ctx),
    authorization: subgraph.authorizationService,
    now: () => new Date(),
    uuid: () => crypto.randomUUID(),
  };
}