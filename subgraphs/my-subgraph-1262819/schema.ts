
import { gql } from "graphql-tag";
import type { DocumentNode } from "graphql";

export const schema: DocumentNode = gql`
"""
MySubgraph_1262819 Queries
"""
type MySubgraph_1262819Queries {
    example(driveId: String!): String
}

type Query {
    mySubgraph_1262819: MySubgraph_1262819Queries!
}

`
