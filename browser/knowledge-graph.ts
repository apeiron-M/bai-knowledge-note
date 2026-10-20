/**
 * The `knowledgeGraph` subgraph, executed in the page: the same schema and the
 * same resolvers the Switchboard serves, over the in-page engine's relational
 * database and reactor client. Only the subgraph class stays server-side.
 */
import type { BaseSubgraph } from "@powerhousedao/reactor-api";
import { buildASTSchema, concatAST, parse, type ExecutionResult } from "graphql";
import { getResolvers } from "../subgraphs/knowledge-graph/resolvers.js";
import { schema as knowledgeGraphSchema } from "../subgraphs/knowledge-graph/schema.js";
import { reindexDrive } from "../subgraphs/knowledge-graph/helpers/reindex.js";
import { attachResolvers, execute, type GraphQLBody } from "./graphql-runtime.js";

/** The schema extends Query and Mutation; on the Switchboard those come from the host. */
const BASE = parse(`
  type Query { _browserHost: Boolean }
  type Mutation { _browserHost: Boolean }
`);

export type KnowledgeGraphService = {
  execute(body: GraphQLBody): Promise<ExecutionResult>;
  /** Rebuild the drive's index from its documents and relationships. */
  reindex(driveId: string): Promise<{ indexedNodes: number; indexedEdges: number; errors: string[] }>;
};

export function createKnowledgeGraphService(subgraph: BaseSubgraph): KnowledgeGraphService {
  const schema = attachResolvers(
    buildASTSchema(concatAST([BASE, knowledgeGraphSchema])),
    getResolvers(subgraph),
  );
  return {
    execute: (body) => execute(schema, body, {}),
    reindex: (driveId) => reindexDrive(subgraph as never, driveId),
  };
}
