import { BaseSubgraph } from "@powerhousedao/reactor-api";
import type { DocumentNode } from "graphql";
import { registerHttpRoutes } from "./register.js";
import { getResolvers } from "./resolvers.js";
import { schema } from "./schema.js";

export class HttpSubgraph extends BaseSubgraph {
  name = "http";
  typeDefs: DocumentNode = schema;
  resolvers = getResolvers(this);
  additionalContextFields = {};

  async onSetup(): Promise<void> {
    try {
      registerHttpRoutes(this.http, this);
    } catch (error) {
      // An UnroutableScope throws here; the GraphQL surface must survive it.
      console.warn(
        `[http] route registration skipped: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async onDisconnect(): Promise<void> {}
}
