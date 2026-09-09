/**
 * Reads the host's permission tables directly.
 *
 * ## Why this is possible
 *
 * `DocumentPermission`, `DocumentProtection` and `OperationUserPermission` live
 * in the `public` schema of the same database this subgraph's relational handle
 * points at. That is not an assumption — it is why enabling document
 * permissions once collided with the read model's own `kysely_migration_lock`
 * table. Same database, same connection.
 *
 * ## Two things it deliberately does not assume
 *
 * **That the tables exist.** Without document permissions enabled they are
 * absent, so a missing relation returns `available: false` rather than
 * throwing. "Authorization is off" and "nobody has access" must not look alike.
 *
 * **That they will keep existing.** These are reactor-api's tables, and the
 * auth-scope roadmap plans to express them as in-document grants and then
 * retire them. When that lands this returns `available: false` and callers
 * degrade rather than break.
 */
import { sql, type Kysely } from "kysely";
import type { ISubgraph } from "@powerhousedao/reactor-api";
import type { IRelationalDb } from "@powerhousedao/shared/processors";
import { GraphIndexerProcessor } from "../../processors/graph-indexer/index.js";

type PermissionRow = {
  documentId: string;
  userAddress: string;
  permission: string;
  grantedBy: string | null;
};
type ProtectionRow = {
  documentId: string;
  protected: boolean;
  ownerAddress: string | null;
};
type OperationRow = {
  documentId: string;
  operationType: string;
  userAddress: string;
};

type Grant = {
  documentId: string;
  documentTitle: string | null;
  documentType: string | null;
  userAddress: string;
  permission: string;
  grantedBy: string | null;
};

export type AccessMapResult = {
  available: boolean;
  driveGrants: Grant[];
  documentGrants: Grant[];
  protections: {
    documentId: string;
    documentTitle: string | null;
    protected: boolean;
    ownerAddress: string | null;
  }[];
  operationGrants: {
    documentId: string;
    documentTitle: string | null;
    operationType: string;
    userAddress: string;
  }[];
  distinctAddresses: number;
  documentsWithOwnGrants: number;
};

const UNAVAILABLE: AccessMapResult = {
  available: false,
  driveGrants: [],
  documentGrants: [],
  protections: [],
  operationGrants: [],
  distinctAddresses: 0,
  documentsWithOwnGrants: 0,
};

function isMissingRelation(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /does not exist|no such table|undefined table/i.test(msg);
}

/** Human-readable names, from the graph projection — the only place on the
 *  server that maps a document id to a title. A document the indexer has not
 *  seen simply has no title; that is not an error. */
async function titlesFor(
  subgraph: ISubgraph,
  driveId: string,
): Promise<Map<string, { title: string | null; type: string | null }>> {
  const out = new Map<string, { title: string | null; type: string | null }>();
  try {
    const db = GraphIndexerProcessor.query(
      driveId,
      subgraph.relationalDb as unknown as IRelationalDb,
    );
    const nodes = await db
      .selectFrom("graph_nodes")
      .select(["document_id", "title", "document_type"])
      .execute();
    for (const n of nodes) {
      out.set(n.document_id, {
        title: n.title ?? null,
        type: n.document_type ?? null,
      });
    }
  } catch {
    // No projection for this drive yet. Ids without titles are still useful.
  }
  return out;
}

export async function readAccessMap(
  subgraph: ISubgraph,
  driveId: string,
): Promise<AccessMapResult> {
  const db = subgraph.relationalDb as unknown as Kysely<unknown>;

  let permissions: PermissionRow[];
  let protections: ProtectionRow[];
  let operations: OperationRow[];
  try {
    const [p, pr, op] = await Promise.all([
      sql<PermissionRow>`select "documentId", "userAddress", "permission", "grantedBy" from public."DocumentPermission"`.execute(
        db,
      ),
      sql<ProtectionRow>`select "documentId", "protected", "ownerAddress" from public."DocumentProtection"`.execute(
        db,
      ),
      sql<OperationRow>`select "documentId", "operationType", "userAddress" from public."OperationUserPermission"`.execute(
        db,
      ),
    ]);
    permissions = p.rows;
    protections = pr.rows;
    operations = op.rows;
  } catch (err) {
    if (isMissingRelation(err)) return UNAVAILABLE;
    throw err;
  }

  const titles = await titlesFor(subgraph, driveId);
  const name = (id: string) => titles.get(id)?.title ?? null;
  const type = (id: string) => titles.get(id)?.type ?? null;

  const decorate = (r: PermissionRow): Grant => ({
    documentId: r.documentId,
    documentTitle: name(r.documentId),
    documentType: type(r.documentId),
    userAddress: r.userAddress,
    permission: r.permission,
    grantedBy: r.grantedBy,
  });

  const onDrive = (id: string) => id === driveId;

  return {
    available: true,
    driveGrants: permissions.filter((r) => onDrive(r.documentId)).map(decorate),
    documentGrants: permissions
      .filter((r) => !onDrive(r.documentId))
      .map(decorate),
    protections: protections.map((r) => ({
      documentId: r.documentId,
      documentTitle: name(r.documentId),
      protected: r.protected,
      ownerAddress: r.ownerAddress,
    })),
    operationGrants: operations.map((r) => ({
      documentId: r.documentId,
      documentTitle: name(r.documentId),
      operationType: r.operationType,
      userAddress: r.userAddress,
    })),
    distinctAddresses: new Set(
      permissions.map((r) => r.userAddress.toLowerCase()),
    ).size,
    documentsWithOwnGrants: new Set(
      permissions.filter((r) => !onDrive(r.documentId)).map((r) => r.documentId),
    ).size,
  };
}
