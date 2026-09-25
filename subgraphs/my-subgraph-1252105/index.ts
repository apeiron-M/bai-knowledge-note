import { BaseSubgraph } from "@powerhousedao/reactor-api";
import type { DocumentNode } from "graphql";
import { getResolvers } from "./resolvers.js";
import { schema } from "./schema.js";

export class MySubgraph_1252105Subgraph extends BaseSubgraph {
  name = "my-subgraph-1252105";
  typeDefs: DocumentNode = schema;
  resolvers = getResolvers(this);
  additionalContextFields = {};
  async onSetup() {}
  async onDisconnect() {}
}
