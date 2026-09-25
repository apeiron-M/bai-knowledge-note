
import { gql } from "graphql-tag";
import type { DocumentNode } from "graphql";

export const schema: DocumentNode = gql`
"""
MySubgraph_1252105 Queries
"""
type MySubgraph_1252105Queries {
    example(driveId: String!): String
}

type Query {
    mySubgraph_1252105: MySubgraph_1252105Queries!
}

`
