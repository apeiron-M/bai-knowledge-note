import { BaseSubgraph } from "@powerhousedao/reactor-api";
import type { DocumentNode } from "graphql";
import { getQuery } from "../knowledge-graph/helpers/db.js";
import { searchVault } from "../knowledge-graph/helpers/search.js";
import { buildHttpRouteDeps, buildStructureRouteDeps } from "./live-deps.js";
import { getResolvers } from "./resolvers.js";
import { createActionsRoute } from "./routes/actions.js";
import { createNotesRoute } from "./routes/notes.js";
import { createRelationshipRoute } from "./routes/relationships.js";
import { registerStructureRoutes } from "./routes/structure.js";
import { createClaimRoute } from "./routes/tasks.js";
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
      const notesDeps = {
        ...deps,
        edges: async (driveId: string, documentId: string) => {
          const query = getQuery(this, driveId);
          const [out, incoming] = await Promise.all([
            query.forwardLinks(documentId),
            query.backlinks(documentId),
          ]);
          return [
            ...out.map((edge) => ({
              direction: "out" as const,
              documentId: edge.targetDocumentId,
              linkType: edge.linkType ?? "",
              title: edge.targetTitle,
              reason: edge.reason,
              confidence: edge.confidence,
            })),
            ...incoming.map((edge) => ({
              direction: "in" as const,
              documentId: edge.sourceDocumentId,
              linkType: edge.linkType ?? "",
              title: null,
              reason: edge.reason,
              confidence: edge.confidence,
            })),
          ];
        },
      };
      this.http.get(
        "notes/:id.md",
        { auth: "renown" },
        createNotesRoute(notesDeps),
      );
      this.http.get("notes/:id", { auth: "renown" }, createNotesRoute(notesDeps));
      this.http.post(
        "actions",
        { auth: "renown", body: "parsed", maxBodyBytes: 2 * 1024 * 1024 },
        createActionsRoute(deps),
      );
      this.http.post(
        "relationships",
        { auth: "renown", body: "parsed" },
        createRelationshipRoute(deps, "POST"),
      );
      this.http.patch(
        "relationships",
        { auth: "renown", body: "parsed" },
        createRelationshipRoute(deps, "PATCH"),
      );
      this.http.delete(
        "relationships",
        { auth: "renown", body: "parsed" },
        createRelationshipRoute(deps, "DELETE"),
      );
      this.http.post(
        "tasks/:id/claim",
        { auth: "renown", body: "parsed" },
        createClaimRoute(deps),
      );
      registerStructureRoutes(this.http, buildStructureRouteDeps(this));
    } catch (error) {
      // An UnroutableScope throws here; the GraphQL surface must survive it.
      console.warn(
        `[http] route registration skipped: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async onDisconnect(): Promise<void> {}
}
