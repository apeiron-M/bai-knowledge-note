import { BaseSubgraph } from "@powerhousedao/reactor-api";
import type { DocumentNode } from "graphql";
import { schema } from "./schema.js";
import { getResolvers } from "./resolvers.js";

/**
 * Answers "who has access to what" for a whole drive in one query.
 *
 * Separate from the knowledgeGraph subgraph on purpose: that one serves vault
 * content and is gated per drive for READ, while this serves the access list
 * itself and is gated for ADMIN. Different data, different audience, different
 * blast radius if the gate is wrong — so they do not share a wrapper.
 *
 * The name must not collide with a core subgraph (analytics, auth, example,
 * packages, r, system): reactor-api reserves those and rejects a package
 * subgraph that reuses one.
 */
export class VaultAccessSubgraph extends BaseSubgraph {
  name = "vaultAccess";
  typeDefs: DocumentNode = schema;
  resolvers = getResolvers(this);
  additionalContextFields = {};
  async onSetup() {}
  async onDisconnect() {}
}
