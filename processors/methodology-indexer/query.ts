import type { Kysely } from "kysely";
import type {
  MethodologyDB,
  MethodologyClaim,
  MethodologyConnection,
} from "./schema.js";

export interface ClaimResult {
  id: string;
  documentId: string;
  title: string | null;
  description: string | null;
  kind: string | null;
  topics: string[];
  methodology: string[];
  updatedAt: string;
}

export interface ConnectionResult {
  id: string;
  sourceDocumentId: string;
  targetRef: string;
  contextPhrase: string | null;
  updatedAt: string;
}

function rowToClaim(row: MethodologyClaim): ClaimResult {
  return {
    id: row.id,
    documentId: row.document_id,
    title: row.title,
    description: row.description,
    kind: row.kind,
    topics: row.topics ? JSON.parse(row.topics) : [],
    methodology: row.methodology ? JSON.parse(row.methodology) : [],
    updatedAt: row.updated_at,
  };
}

function rowToConnection(row: MethodologyConnection): ConnectionResult {
  return {
    id: row.id,
    sourceDocumentId: row.source_document_id,
    targetRef: row.target_ref,
    contextPhrase: row.context_phrase,
    updatedAt: row.updated_at,
  };
}

export function createMethodologyQuery(db: Kysely<MethodologyDB>) {
  return {
    async allClaims(): Promise<ClaimResult[]> {
      const rows = await db
        .selectFrom("methodology_claims")
        .selectAll()
        .execute();
      return rows.map(rowToClaim);
    },

    async claimCount(): Promise<number> {
      const rows = await db
        .selectFrom("methodology_claims")
        .selectAll()
        .execute();
      return rows.length;
    },

    async claimByDocumentId(
      documentId: string,
    ): Promise<ClaimResult | undefined> {
      const row = await db
        .selectFrom("methodology_claims")
        .where("document_id", "=", documentId)
        .selectAll()
        .executeTakeFirst();
      return row ? rowToClaim(row) : undefined;
    },

    async claimsByKind(kind: string): Promise<ClaimResult[]> {
      const rows = await db
        .selectFrom("methodology_claims")
        .where("kind", "=", kind)
        .selectAll()
        .execute();
      return rows.map(rowToClaim);
    },

    async searchClaims(query: string, limit = 50): Promise<ClaimResult[]> {
      const q = `%${query.toLowerCase()}%`;
      const rows = await db
        .selectFrom("methodology_claims")
        .where((eb) =>
          eb.or([
            eb(eb.fn("lower", ["title"]), "like", q),
            eb(eb.fn("lower", ["description"]), "like", q),
            eb(eb.fn("lower", ["topics"]), "like", q),
          ]),
        )
        .selectAll()
        .limit(limit)
        .execute();
      return rows.map(rowToClaim);
    },

    async claimsByTopic(topic: string): Promise<ClaimResult[]> {
      const q = `%"${topic.toLowerCase()}"%`;
      const rows = await db
        .selectFrom("methodology_claims")
        .where((eb) => eb(eb.fn("lower", ["topics"]), "like", q))
        .selectAll()
        .execute();
      return rows.map(rowToClaim);
    },

    async connectionsFrom(documentId: string): Promise<ConnectionResult[]> {
      const rows = await db
        .selectFrom("methodology_connections")
        .where("source_document_id", "=", documentId)
        .selectAll()
        .execute();
      return rows.map(rowToConnection);
    },

    async connectionsTo(targetRef: string): Promise<ConnectionResult[]> {
      const rows = await db
        .selectFrom("methodology_connections")
        .where("target_ref", "=", targetRef)
        .selectAll()
        .execute();
      return rows.map(rowToConnection);
    },

    async stats(): Promise<{
      claimCount: number;
      connectionCount: number;
      kindDistribution: Record<string, number>;
    }> {
      const claims = await db
        .selectFrom("methodology_claims")
        .selectAll()
        .execute();
      const connections = await db
        .selectFrom("methodology_connections")
        .selectAll()
        .execute();

      const kindDist: Record<string, number> = {};
      for (const c of claims) {
        const k = c.kind ?? "unknown";
        kindDist[k] = (kindDist[k] ?? 0) + 1;
      }

      return {
        claimCount: claims.length,
        connectionCount: connections.length,
        kindDistribution: kindDist,
      };
    },
  };
}
