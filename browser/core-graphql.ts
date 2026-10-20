/**
 * The part of the Switchboard's core GraphQL the vault app reads, answered by
 * the in-page engine: `document`, `findDocuments`, `documentOperations` and
 * `documentModels`, with the field names and shapes the Switchboard uses.
 * Writes do not come through here — the browser host performs them itself
 * (see `KnowledgeVaultHostDocuments`).
 */
import type { IReactorClient } from "@powerhousedao/reactor";
import type { DocumentModelModule, Operation, PHDocument } from "document-model";
import { buildSchema, type ExecutionResult } from "graphql";
import { attachResolvers, execute, passThroughScalar, type GraphQLBody } from "./graphql-runtime.js";

const SDL = `
  scalar JSONObject
  scalar DateTime

  type Revision { scope: String! revision: Int! }

  type PHDocument {
    id: String!
    slug: String
    preferredEditor: String
    meta: JSONObject
    protocolVersions: JSONObject
    name: String!
    documentType: String!
    state: JSONObject!
    revisionsList: [Revision!]!
    createdAtUtcIso: DateTime!
    lastModifiedAtUtcIso: DateTime!
    operations(filter: DocumentOperationsFilterInput, paging: PagingInput): ReactorOperationResultPage!
  }

  input DocumentOperationsFilterInput {
    branch: String
    scopes: [String!]
    actionTypes: [String!]
    sinceRevision: Int
    timestampFrom: String
    timestampTo: String
  }

  type DocumentWithChildren { document: PHDocument! childIds: [String!]! }

  type PHDocumentResultPage {
    items: [PHDocument!]!
    totalCount: Int!
    hasNextPage: Boolean!
    hasPreviousPage: Boolean!
    cursor: String
  }

  type ReactorSignerUser { address: String! networkId: String! chainId: Int! }
  type ReactorSignerApp { name: String! key: String! }
  type ReactorSigner { user: ReactorSignerUser app: ReactorSignerApp signatures: [String!]! }
  type ActionContext { signer: ReactorSigner }
  type Action {
    id: String!
    type: String!
    timestampUtcMs: String!
    input: JSONObject!
    scope: String!
    context: ActionContext
  }
  type ReactorOperation {
    index: Int!
    timestampUtcMs: String!
    hash: String!
    skip: Int!
    error: String
    deniedReason: String
    id: String
    action: Action!
  }
  type ReactorOperationResultPage {
    items: [ReactorOperation!]!
    totalCount: Int!
    hasNextPage: Boolean!
    hasPreviousPage: Boolean!
    cursor: String
  }

  type DocumentModelInfo { id: String! name: String! specification: JSONObject }
  type DocumentModelResultPage {
    items: [DocumentModelInfo!]!
    totalCount: Int!
    hasNextPage: Boolean!
    hasPreviousPage: Boolean!
    cursor: String
  }

  input SearchFilterInput { type: String parentId: String identifiers: [String!] }
  input ViewFilterInput { branch: String scopes: [String!] }
  input PagingInput { limit: Int offset: Int cursor: String }
  input OperationsFilterInput {
    documentIdOrSlug: String
    branch: String
    scopes: [String!]
    actionTypes: [String!]
    sinceRevision: Int
    timestampFrom: String
    timestampTo: String
  }

  type Query {
    document(idOrSlug: String!, view: ViewFilterInput): DocumentWithChildren
    findDocuments(search: SearchFilterInput!, view: ViewFilterInput, paging: PagingInput): PHDocumentResultPage!
    documentOperations(filter: OperationsFilterInput!, paging: PagingInput): ReactorOperationResultPage!
    documentModels(namespace: String, paging: PagingInput): DocumentModelResultPage!
    "Access management does not apply to a vault that lives in one browser: nobody administers it."
    canManage(documentId: ID!): Boolean!
  }
`;

type Paging = { limit?: number | null; offset?: number | null; cursor?: string | null };
type View = { branch?: string | null; scopes?: string[] | null };

function viewOf(view: View | null | undefined) {
  if (!view) return undefined;
  return {
    ...(view.branch ? { branch: view.branch } : {}),
    ...(view.scopes ? { scopes: view.scopes } : {}),
  };
}

function pagingOf(paging: Paging | null | undefined) {
  const cursor = paging?.cursor ?? (paging?.offset ? String(paging.offset) : "0");
  return { cursor, limit: paging?.limit ?? 100 };
}

function page<T>(results: T[], nextCursor: string | undefined, cursor: string) {
  return {
    items: results,
    totalCount: results.length,
    hasNextPage: Boolean(nextCursor),
    hasPreviousPage: cursor !== "0",
    cursor: nextCursor ?? null,
  };
}

/** The drive's own node ids, when the document is a drive. */
function childIdsOf(doc: PHDocument): string[] {
  const nodes = (doc.state as { global?: { nodes?: Array<{ id: string }> } }).global?.nodes;
  return Array.isArray(nodes) ? nodes.map((n) => n.id) : [];
}

function signaturesOf(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((s) => (Array.isArray(s) ? s.join(", ") : String(s)));
}

export type CoreGraphQLService = { execute(body: GraphQLBody): Promise<ExecutionResult> };

type OperationsFilter = {
  branch?: string | null;
  scopes?: string[] | null;
  actionTypes?: string[] | null;
  sinceRevision?: number | null;
  timestampFrom?: string | null;
  timestampTo?: string | null;
};

export function createCoreGraphQLService(
  client: IReactorClient,
  models: readonly DocumentModelModule[],
): CoreGraphQLService {
  /** One page of a document's operations, as `documentOperations` and `PHDocument.operations` both answer it. */
  const operationsPage = async (documentId: string, filter: OperationsFilter, paging: Paging | undefined) => {
    const page_ = pagingOf(paging);
    const ops = await client.getOperations(
      documentId,
      viewOf({ branch: filter.branch ?? null, scopes: filter.scopes ?? null }),
      {
        ...(filter.actionTypes ? { actionTypes: filter.actionTypes } : {}),
        ...(filter.sinceRevision != null ? { sinceRevision: filter.sinceRevision } : {}),
        ...(filter.timestampFrom ? { timestampFrom: filter.timestampFrom } : {}),
        ...(filter.timestampTo ? { timestampTo: filter.timestampTo } : {}),
      },
      page_,
    );
    return page(ops.results, ops.nextCursor, page_.cursor);
  };
  const resolvers = {
    JSONObject: passThroughScalar("JSONObject"),
    DateTime: passThroughScalar("DateTime"),
    Query: {
      document: async (_: unknown, args: { idOrSlug: string; view?: View }) => {
        const doc = await client.get<PHDocument>(args.idOrSlug, viewOf(args.view));
        return { document: doc, childIds: childIdsOf(doc) };
      },
      findDocuments: async (
        _: unknown,
        args: { search: { type?: string | null; parentId?: string | null; identifiers?: string[] | null }; view?: View; paging?: Paging },
      ) => {
        const paging = pagingOf(args.paging);
        const found = await client.find(
          {
            ...(args.search.type ? { type: args.search.type } : {}),
            ...(args.search.parentId ? { parentId: args.search.parentId } : {}),
            ...(args.search.identifiers ? { ids: args.search.identifiers } : {}),
          },
          viewOf(args.view),
          paging,
        );
        return page(found.results, found.nextCursor, paging.cursor);
      },
      documentOperations: async (
        _: unknown,
        args: {
          filter: {
            documentIdOrSlug?: string | null;
            branch?: string | null;
            scopes?: string[] | null;
            actionTypes?: string[] | null;
            sinceRevision?: number | null;
            timestampFrom?: string | null;
            timestampTo?: string | null;
          };
          paging?: Paging;
        },
      ) => {
        const { filter } = args;
        if (!filter.documentIdOrSlug) throw new Error("documentOperations needs a documentIdOrSlug.");
        return operationsPage(filter.documentIdOrSlug, filter, args.paging);
      },
      canManage: () => false,
      documentModels: () => {
        const items = models.map((m) => ({
          id: m.documentModel.global.id,
          name: m.documentModel.global.name,
          specification: m.documentModel.global.specifications.at(-1) ?? null,
        }));
        return page(items, undefined, "0");
      },
    },
    PHDocument: {
      id: (d: PHDocument) => d.header.id,
      slug: (d: PHDocument) => d.header.slug,
      preferredEditor: (d: PHDocument) =>
        (d.header.meta as { preferredEditor?: string } | undefined)?.preferredEditor ?? null,
      meta: (d: PHDocument) => d.header.meta ?? null,
      protocolVersions: (d: PHDocument) => d.header.protocolVersions ?? null,
      name: (d: PHDocument) => d.header.name,
      documentType: (d: PHDocument) => d.header.documentType,
      state: (d: PHDocument) => d.state,
      revisionsList: (d: PHDocument) =>
        Object.entries(d.header.revision).map(([scope, revision]) => ({ scope, revision })),
      createdAtUtcIso: (d: PHDocument) => d.header.createdAtUtcIso,
      lastModifiedAtUtcIso: (d: PHDocument) => d.header.lastModifiedAtUtcIso,
      operations: async (d: PHDocument, args: { filter?: OperationsFilter | null; paging?: Paging }) =>
        operationsPage(d.header.id, args.filter ?? {}, args.paging),
    },
    ReactorOperation: {
      id: (o: Operation) => o.id,
      error: (o: Operation) => o.error ?? null,
    },
    ActionContext: {
      signer: (ctx: { signer?: Record<string, unknown> } | undefined) => {
        const signer = ctx?.signer;
        if (!signer) return null;
        return { ...signer, signatures: signaturesOf(signer.signatures) };
      },
    },
  };
  const schema = attachResolvers(buildSchema(SDL), resolvers);
  return { execute: (body) => execute(schema, body, {}) };
}
