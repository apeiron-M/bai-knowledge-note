import { type BaseSubgraph } from "@powerhousedao/reactor-api";

export const getResolvers = (
  subgraph: BaseSubgraph,
): Record<string, unknown> => {
  const reactor = subgraph.reactorClient;

  return {
    Query: {
      mySubgraph_1252105: () => ({}), // namespace resolver for nested queries
    },
    MySubgraph_1252105Queries: {
      example: async (parent: unknown, args: { driveId: string }) => {
        return "example";
      },
    },
  };
};
