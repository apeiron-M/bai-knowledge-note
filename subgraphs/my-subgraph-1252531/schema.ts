
import { gql } from "graphql-tag";
import type { DocumentNode } from "graphql";

export const schema: DocumentNode = gql`
"""
MySubgraph_1252531 Queries
"""
type MySubgraph_1252531Queries {
    example(driveId: String!): String
}

type Query {
    mySubgraph_1252531: MySubgraph_1252531Queries!
}

`
