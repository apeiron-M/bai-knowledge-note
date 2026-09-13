import type { IReactorClient } from "@powerhousedao/reactor";
import type {
  BaseSubgraph,
  IAuthorizationService,
} from "@powerhousedao/reactor-api";

export interface HttpRouteDeps {
  reactorClient: Pick<
    IReactorClient,
    "get" | "getOperations" | "execute" | "executeAsync" | "waitForJob"
  >;
  resolveCanonicalDocumentId: BaseSubgraph["resolveCanonicalDocumentId"];
  authorization: Pick<
    IAuthorizationService,
    "canRead" | "canWrite" | "canMutate" | "isSupremeAdmin"
  >;
  now(): Date;
  uuid(): string;
}
