import { type BaseSubgraph } from "@powerhousedao/reactor-api";

export const getResolvers = (
  subgraph: BaseSubgraph,
): Record<string, unknown> => {
  const reactor = subgraph.reactorClient;

  return {
    Query: {
      http: () => ({}), // namespace resolver for nested queries
    },
    HttpQueries: {
      example: async (parent: unknown, args: { driveId: string }) => {
        return "example";
      },
    },
  };
};
