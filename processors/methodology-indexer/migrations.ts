import type { IRelationalDb } from "@powerhousedao/shared/processors";

export async function up(db: IRelationalDb<any>): Promise<void> {
  await db.schema
    .createTable("methodology_claims")
    .addColumn("id", "varchar(255)", (col) => col.primaryKey())
    .addColumn("document_id", "varchar(255)", (col) => col.notNull().unique())
    .addColumn("title", "varchar(1024)")
    .addColumn("description", "text")
    .addColumn("kind", "varchar(100)")
    .addColumn("topics", "text") // JSON array as string
    .addColumn("methodology", "text") // JSON array as string
    .addColumn("updated_at", "varchar(50)", (col) => col.notNull())
    .ifNotExists()
    .execute();

  await db.schema
    .createTable("methodology_connections")
    .addColumn("id", "varchar(255)", (col) => col.primaryKey())
    .addColumn("source_document_id", "varchar(255)", (col) => col.notNull())
    .addColumn("target_ref", "varchar(255)", (col) => col.notNull())
    .addColumn("context_phrase", "text")
    .addColumn("updated_at", "varchar(50)", (col) => col.notNull())
    .ifNotExists()
    .execute();

  await db.schema
    .createIndex("idx_methodology_claims_kind")
    .on("methodology_claims")
    .column("kind")
    .ifNotExists()
    .execute();

  await db.schema
    .createIndex("idx_methodology_connections_source")
    .on("methodology_connections")
    .column("source_document_id")
    .ifNotExists()
    .execute();
}

export async function down(db: IRelationalDb<any>): Promise<void> {
  await db.schema.dropTable("methodology_connections").ifExists().execute();
  await db.schema.dropTable("methodology_claims").ifExists().execute();
}
