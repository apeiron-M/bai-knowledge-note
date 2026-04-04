import type { IRelationalDb } from "@powerhousedao/shared/processors";

export async function up(db: IRelationalDb<any>): Promise<void> {
  await db.schema
    .createTable("graph_nodes")
    .addColumn("id", "varchar(255)", (col) => col.primaryKey())
    .addColumn("document_id", "varchar(255)", (col) => col.notNull().unique())
    .addColumn("title", "varchar(1024)")
    .addColumn("description", "text")
    .addColumn("note_type", "varchar(255)")
    .addColumn("status", "varchar(50)")
    .addColumn("updated_at", "varchar(50)", (col) => col.notNull())
    .ifNotExists()
    .execute();

  await db.schema
    .createTable("graph_edges")
    .addColumn("id", "varchar(255)", (col) => col.primaryKey())
    .addColumn("source_document_id", "varchar(255)", (col) => col.notNull())
    .addColumn("target_document_id", "varchar(255)", (col) => col.notNull())
    .addColumn("link_type", "varchar(100)")
    .addColumn("target_title", "varchar(1024)")
    .addColumn("updated_at", "varchar(50)", (col) => col.notNull())
    .ifNotExists()
    .execute();

  // Indexes for query performance
  await db.schema
    .createIndex("idx_graph_edges_source")
    .on("graph_edges")
    .column("source_document_id")
    .ifNotExists()
    .execute();

  await db.schema
    .createIndex("idx_graph_edges_target")
    .on("graph_edges")
    .column("target_document_id")
    .ifNotExists()
    .execute();

  await db.schema
    .createIndex("idx_graph_nodes_status")
    .on("graph_nodes")
    .column("status")
    .ifNotExists()
    .execute();

  // --- Phase 1: topics, content, provenance ---

  // Add new columns to graph_nodes (wrap each in try/catch for idempotency)
  for (const col of ["content", "author", "source_origin", "created_at"]) {
    try {
      await db.schema
        .alterTable("graph_nodes")
        .addColumn(col, col === "content" ? "text" : "varchar(1024)")
        .execute();
    } catch {
      // column likely already exists — ignore
    }
  }

  // Create graph_topics table
  await db.schema
    .createTable("graph_topics")
    .addColumn("id", "varchar(255)", (col) => col.primaryKey())
    .addColumn("document_id", "varchar(255)", (col) => col.notNull())
    .addColumn("name", "varchar(512)", (col) => col.notNull())
    .addColumn("updated_at", "varchar(50)", (col) => col.notNull())
    .ifNotExists()
    .execute();

  await db.schema
    .createIndex("idx_graph_topics_document_id")
    .on("graph_topics")
    .column("document_id")
    .ifNotExists()
    .execute();

  await db.schema
    .createIndex("idx_graph_topics_name")
    .on("graph_topics")
    .column("name")
    .ifNotExists()
    .execute();
}

export async function down(db: IRelationalDb<any>): Promise<void> {
  await db.schema.dropTable("graph_topics").ifExists().execute();
  await db.schema.dropTable("graph_edges").ifExists().execute();
  await db.schema.dropTable("graph_nodes").ifExists().execute();
}
