/**
 * Just enough GraphQL server for the in-page origin: wire a resolver map onto a
 * schema built from SDL, and execute a request body. graphql-js only — the
 * package declares `graphql`, not a schema toolkit.
 */
import {
  graphql,
  GraphQLObjectType,
  GraphQLScalarType,
  type ExecutionResult,
  type GraphQLFieldResolver,
  type GraphQLSchema,
} from "graphql";

type FieldResolver = GraphQLFieldResolver<unknown, unknown>;
export type ResolverMap = Record<string, unknown>;

/** Attach `resolvers` (`{ Type: { field: fn } }`) to `schema`, in place. */
export function attachResolvers(schema: GraphQLSchema, resolvers: ResolverMap): GraphQLSchema {
  for (const [typeName, entry] of Object.entries(resolvers)) {
    const type = schema.getType(typeName);
    if (type instanceof GraphQLScalarType && entry instanceof GraphQLScalarType) {
      type.serialize = entry.serialize.bind(entry);
      type.parseValue = entry.parseValue.bind(entry);
      type.parseLiteral = entry.parseLiteral.bind(entry);
      continue;
    }
    if (!(type instanceof GraphQLObjectType) || !entry || typeof entry !== "object") continue;
    const fields = type.getFields();
    for (const [fieldName, resolver] of Object.entries(entry as Record<string, unknown>)) {
      if (!(fieldName in fields)) continue;
      const field = fields[fieldName];
      if (typeof resolver === "function") field.resolve = resolver as FieldResolver;
      else if (resolver && typeof resolver === "object" && "resolve" in resolver) {
        field.resolve = (resolver as { resolve: FieldResolver }).resolve;
      }
    }
  }
  return schema;
}

export type GraphQLBody = {
  query?: unknown;
  variables?: unknown;
  operationName?: unknown;
};

export async function execute(
  schema: GraphQLSchema,
  body: GraphQLBody,
  contextValue: unknown,
): Promise<ExecutionResult> {
  if (typeof body.query !== "string") {
    return { errors: [{ message: "A GraphQL request needs a query." }] } as unknown as ExecutionResult;
  }
  return graphql({
    schema,
    source: body.query,
    variableValues:
      body.variables && typeof body.variables === "object"
        ? (body.variables as Record<string, unknown>)
        : undefined,
    operationName: typeof body.operationName === "string" ? body.operationName : undefined,
    contextValue,
  });
}

/** A JSON value passed through unchanged, for `JSONObject`-style scalars. */
export const passThroughScalar = (name: string): GraphQLScalarType =>
  new GraphQLScalarType({
    name,
    serialize: (value) => value,
    parseValue: (value) => value,
    parseLiteral: (ast) => {
      // Literals in queries are rare for these scalars; strings and numbers suffice.
      if ("value" in ast) return ast.value;
      return null;
    },
  });
