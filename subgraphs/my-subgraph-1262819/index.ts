import { BaseSubgraph } from "@powerhousedao/reactor-api";
import type { DocumentNode } from "graphql";
import { getResolvers } from "./resolvers.js";
import { schema } from "./schema.js";

export class MySubgraph_1262819Subgraph extends BaseSubgraph {
  name = "my-subgraph-1262819";
  typeDefs: DocumentNode = schema;
  resolvers = getResolvers(this);
  additionalContextFields = {};
  async onSetup() {}
  async onDisconnect() {}
}
