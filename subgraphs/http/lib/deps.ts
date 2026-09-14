import type { IReactorClient } from "@powerhousedao/reactor";
import type {
  BaseSubgraph,
  IAuthorizationService,
} from "@powerhousedao/reactor-api";
import type { createGraphQuery } from "../../../processors/graph-indexer/query.js";

export type GraphQuery = ReturnType<typeof createGraphQuery>;

export interface HttpRouteDeps {
  reactorClient: Pick<
    IReactorClient,
    | "get"
    | "getOperations"
    | "execute"
    | "executeAsync"
    | "waitForJob"
    | "find"
    | "createDocumentInDrive"
    | "getDocumentModelModule"
  >;
  resolveCanonicalDocumentId: BaseSubgraph["resolveCanonicalDocumentId"];
  authorization: Pick<
    IAuthorizationService,
    "canRead" | "canWrite" | "canMutate" | "isSupremeAdmin"
  >;
  now(): Date;
  uuid(): string;
}
