import type { IRelationalDb } from "@powerhousedao/shared/processors";
import { sql } from "kysely";

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

  // --- Operation history ---

  await db.schema
    .createTable("graph_operations")
    .addColumn("id", "varchar(255)", (col) => col.primaryKey())
    .addColumn("document_id", "varchar(255)", (col) => col.notNull())
    .addColumn("operation_type", "varchar(100)", (col) => col.notNull())
    .addColumn("timestamp", "varchar(50)", (col) => col.notNull())
    .addColumn("index", "integer", (col) => col.notNull())
    .addColumn("scope", "varchar(20)", (col) => col.notNull())
    .addColumn("summary", "text")
    .addColumn("input_json", "text")
    .addColumn("signer_address", "varchar(255)")
    .addColumn("signer_app", "varchar(255)")
    .ifNotExists()
    .execute();

  await db.schema
    .createIndex("idx_graph_ops_doc")
    .on("graph_operations")
    .column("document_id")
    .ifNotExists()
    .execute();

  await db.schema
    .createIndex("idx_graph_ops_timestamp")
    .on("graph_operations")
    .column("timestamp")
    .ifNotExists()
    .execute();

  await db.schema
    .createIndex("idx_graph_ops_type")
    .on("graph_operations")
    .column("operation_type")
    .ifNotExists()
    .execute();

  // Add signer columns to graph_operations (idempotent)
  for (const col of ["signer_address", "signer_app", "signer_key"]) {
    try {
      await db.schema
        .alterTable("graph_operations")
        .addColumn(col, "varchar(255)")
        .execute();
    } catch {
      // column likely already exists — ignore
    }
  }
  // The full signature tuple. `text`, not varchar: a tuple is ~300 chars
  // today and the format is the reactor's to grow.
  try {
    await db.schema
      .alterTable("graph_operations")
      .addColumn("signature", "text")
      .execute();
  } catch {
    // column likely already exists — ignore
  }

  // --- Edge metadata ---
  //
  // The reactor stores an opaque jsonb per relationship; the vault reads
  // `reason` / `confidence` out of it (edge-metadata.ts). Kept as text here
  // so the projection has no dialect-specific column type.
  try {
    await db.schema
      .alterTable("graph_edges")
      .addColumn("metadata", "text")
      .execute();
  } catch {
    // column likely already exists — ignore
  }

  // --- Document kind ---
  //
  // `document_type` lets consumers separate knowledge (notes, MoCs, research
  // claims) from the meta-documents indexed alongside them (tensions,
  // observations). Rows that predate the column are backfilled from the only
  // signal they carry: the MoC status sentinel. Everything else in a
  // pre-existing projection was a knowledge note, because nothing else was
  // indexed before this column existed.
  try {
    await db.schema
      .alterTable("graph_nodes")
      .addColumn("document_type", "varchar(100)")
      .execute();
  } catch {
    // column likely already exists — ignore
  }
  await db
    .updateTable("graph_nodes")
    .set({
      document_type: sql`case when status = 'MOC' then 'bai/moc' else 'bai/knowledge-note' end`,
    })
    .where("document_type", "is", null)
    .execute();
  await db.schema
    .createIndex("idx_graph_nodes_document_type")
    .on("graph_nodes")
    .column("document_type")
    .ifNotExists()
    .execute();

  // When the document entered the vault: its header's createdAtUtcIso.
  // `created_at` is when it was written (provenance) — weeks earlier for an
  // imported note — so the source timeline needs both. Rows that predate the
  // column stay null until their next operation or a reindex: nothing in the
  // index knows the header's time.
  await db.schema
    .alterTable("graph_nodes")
    .addColumn("added_at", "varchar(50)", (col) => col.ifNotExists())
    .execute();
  // Rows that predate the column: the document's first recorded operation is
  // the best the index knows of when it arrived. Its next operation replaces
  // the estimate with the header's own time (the live write keeps the
  // earliest), as does a reindex. Only nulls are touched, and only ISO times
  // are trusted — anything else would not sort with them.
  await db
    .updateTable("graph_nodes")
    .set((eb) => ({
      added_at: eb
        .selectFrom("graph_operations")
        .select((o) => o.fn.min<string>("graph_operations.timestamp").as("first"))
        .whereRef("graph_operations.document_id", "=", "graph_nodes.document_id")
        .where("graph_operations.timestamp", "like", "____-__-__T%"),
    }))
    .where("added_at", "is", null)
    .execute();

  // A small row per source document — see `GraphSource` in schema.ts.
  await db.schema
    .createTable("graph_sources")
    .ifNotExists()
    .addColumn("document_id", "varchar(255)", (col) => col.primaryKey())
    .addColumn("row_json", "text", (col) => col.notNull())
    .addColumn("revision", "integer", (col) => col.notNull().defaultTo(-1))
    .addColumn("version", "integer", (col) => col.notNull().defaultTo(1))
    .addColumn("updated_at", "varchar(50)", (col) => col.notNull())
    .execute();
  for (const [name, fallback] of [["revision", -1], ["version", 1]] as const) {
    await db.schema
      .alterTable("graph_sources")
      .addColumn(name, "integer", (col) => col.notNull().defaultTo(fallback).ifNotExists())
      .execute();
  }

  // Durable embedding store — replaces the separate memory:// PGlite that
  // lost every vector on restart. Lives in the same per-drive namespace as
  // graph_nodes, so it persists wherever graph_nodes provably persists.
  // Vectors are JSON-encoded float arrays with cosine computed in JS: exact,
  // no pgvector dependency, measured 2.1ms at 521 notes / 25ms at 100k.
  // `model` + `dims` make future model swaps incremental re-embeds.
  await db.schema
    .createTable("note_embeddings")
    .ifNotExists()
    .addColumn("document_id", "varchar(255)", (col) => col.primaryKey())
    .addColumn("embedding", "text", (col) => col.notNull())
    .addColumn("dims", "integer", (col) => col.notNull())
    .addColumn("model", "varchar(255)", (col) => col.notNull())
    .addColumn("content_hash", "varchar(64)", (col) => col.notNull())
    .addColumn("updated_at", "varchar(50)", (col) => col.notNull())
    .execute();
}

export async function down(db: IRelationalDb<any>): Promise<void> {
  await db.schema.dropTable("graph_sources").ifExists().execute();
  await db.schema.dropTable("note_embeddings").ifExists().execute();
  await db.schema.dropTable("graph_operations").ifExists().execute();
  await db.schema.dropTable("graph_topics").ifExists().execute();
  await db.schema.dropTable("graph_edges").ifExists().execute();
  await db.schema.dropTable("graph_nodes").ifExists().execute();
}
