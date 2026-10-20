
import { gql } from "graphql-tag";
import type { DocumentNode } from "graphql";

export const schema: DocumentNode = gql`
"""
Http Queries
"""
type HttpQueries {
    example(driveId: String!): String
}

type Query {
    http: HttpQueries!
}

`
