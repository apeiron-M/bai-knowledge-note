import { gql } from "graphql-tag";
import {
  BaseSubgraph,
  type SubgraphArgs,
} from "@powerhousedao/reactor-api";
import { MethodologyIndexerProcessor } from "../../processors/methodology-indexer/index.js";
import { createMethodologyQuery } from "../../processors/methodology-indexer/query.js";
import type { MethodologyDB } from "../../processors/methodology-indexer/schema.js";
import type { Kysely } from "kysely";

export class MethodologySubgraph extends BaseSubgraph {
  override name = "methodology";

  override typeDefs = gql`
    type MethodologyClaim {
      id: String!
      documentId: String!
      title: String
      description: String
      kind: String
      topics: [String!]!
      methodology: [String!]!
      updatedAt: String!
    }

    type MethodologyConnection {
      id: String!
      sourceDocumentId: String!
      targetRef: String!
      contextPhrase: String
      updatedAt: String!
    }

    type MethodologyStats {
      claimCount: Int!
      connectionCount: Int!
      kindDistribution: JSONObject
    }

    extend type Query {
      methodologySearch(driveId: ID!, query: String!, limit: Int): [MethodologyClaim!]!
      methodologyClaims(driveId: ID!): [MethodologyClaim!]!
      methodologyClaimsByKind(driveId: ID!, kind: String!): [MethodologyClaim!]!
      methodologyClaimsByTopic(driveId: ID!, topic: String!): [MethodologyClaim!]!
      methodologyClaimById(driveId: ID!, documentId: String!): MethodologyClaim
      methodologyStats(driveId: ID!): MethodologyStats!
      methodologyConnectionsFrom(driveId: ID!, documentId: String!): [MethodologyConnection!]!
      methodologyConnectionsTo(driveId: ID!, targetRef: String!): [MethodologyConnection!]!
    }
  `;

  override resolvers = {
    Query: {
      methodologySearch: async (
        _: unknown,
        args: { driveId: string; query: string; limit?: number },
      ) => {
        const query = this.getQuery(args.driveId);
        return query.searchClaims(args.query, args.limit ?? 50);
      },

      methodologyClaims: async (
        _: unknown,
        args: { driveId: string },
      ) => {
        const query = this.getQuery(args.driveId);
        return query.allClaims();
      },

      methodologyClaimsByKind: async (
        _: unknown,
        args: { driveId: string; kind: string },
      ) => {
        const query = this.getQuery(args.driveId);
        return query.claimsByKind(args.kind);
      },

      methodologyClaimsByTopic: async (
        _: unknown,
        args: { driveId: string; topic: string },
      ) => {
        const query = this.getQuery(args.driveId);
        return query.claimsByTopic(args.topic);
      },

      methodologyClaimById: async (
        _: unknown,
        args: { driveId: string; documentId: string },
      ) => {
        const query = this.getQuery(args.driveId);
        return query.claimByDocumentId(args.documentId) ?? null;
      },

      methodologyStats: async (
        _: unknown,
        args: { driveId: string },
      ) => {
        const query = this.getQuery(args.driveId);
        return query.stats();
      },

      methodologyConnectionsFrom: async (
        _: unknown,
        args: { driveId: string; documentId: string },
      ) => {
        const query = this.getQuery(args.driveId);
        return query.connectionsFrom(args.documentId);
      },

      methodologyConnectionsTo: async (
        _: unknown,
        args: { driveId: string; targetRef: string },
      ) => {
        const query = this.getQuery(args.driveId);
        return query.connectionsTo(args.targetRef);
      },
    },
  };

  constructor(args: SubgraphArgs) {
    super(args);
  }

  private getQuery(driveId: string) {
    const queryBuilder = MethodologyIndexerProcessor.query(
      driveId,
      this.relationalDb as any,
    );
    return createMethodologyQuery(queryBuilder as unknown as Kysely<MethodologyDB>);
  }
}
