import { BaseSubgraph } from "@powerhousedao/reactor-api";
import type { DocumentNode } from "graphql";
import { searchVault } from "../knowledge-graph/helpers/search.js";
import { buildHttpRouteDeps } from "./live-deps.js";
import { getResolvers } from "./resolvers.js";
import { createSearchRoute } from "./routes/search.js";
import { schema } from "./schema.js";

export class HttpSubgraph extends BaseSubgraph {
  name = "http";
  typeDefs: DocumentNode = schema;
  resolvers = getResolvers(this);
  additionalContextFields = {};

  async onSetup(): Promise<void> {
    try {
      const deps = buildHttpRouteDeps(this);
      this.http.get("ping", { auth: "renown" }, (_request, ctx) =>
        Response.json({
          ok: true,
          subgraph: "http",
          user: ctx.user?.address ?? null,
        }),
      );
      this.http.get(
        "search",
        { auth: "renown" },
        createSearchRoute({
          ...deps,
          search: (driveId, query, mode, limit, includeArchived) =>
            searchVault(this, driveId, query, mode, limit, includeArchived),
        }),
      );
    } catch (error) {
      // An UnroutableScope throws here; the GraphQL surface must survive it.
      console.warn(
        `[http] route registration skipped: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async onDisconnect(): Promise<void> {}
}
