# Graph Indexer Improvements Plan

Status: **Pending**
Created: 2026-04-04

## Problem

The graph indexer currently indexes 5 fields per note (title, description, noteType, status) and edges (source, target, linkType). But each knowledge note has ~30 fields including topics, full content, provenance, confidence, scope, and context — all dropped during indexing. This makes the subgraph unable to answer common queries like "find all notes about topic X", "search content for keyword", "what did author Y write", or "notes created this week".

Additionally, search is keyword-only (`LIKE '%term%'`). A query like "how does storage work?" won't find "Reactor is a storage node supporting multiple adapters" unless the exact words match.

## Current Schema

```
graph_nodes: id, document_id, title, description, note_type, status, updated_at
graph_edges: id, source_document_id, target_document_id, link_type, target_title, updated_at
```

---

## Phase 1: Rich Relational Index (Topics, Content, Provenance)

### Schema Changes

**New table: `graph_topics`**

```sql
CREATE TABLE graph_topics (
  id VARCHAR(255) PRIMARY KEY,
  document_id VARCHAR(255) NOT NULL,
  name VARCHAR(255) NOT NULL,
  updated_at VARCHAR(50) NOT NULL
);
CREATE INDEX idx_graph_topics_doc ON graph_topics(document_id);
CREATE INDEX idx_graph_topics_name ON graph_topics(name);
```

**New columns on `graph_nodes`**

```sql
ALTER TABLE graph_nodes ADD COLUMN content TEXT;
ALTER TABLE graph_nodes ADD COLUMN author VARCHAR(255);
ALTER TABLE graph_nodes ADD COLUMN source_origin VARCHAR(50);
ALTER TABLE graph_nodes ADD COLUMN created_at VARCHAR(50);
```

### Processor Changes

**File:** `processors/graph-indexer/index.ts`

In `onOperations()` reconciliation loop, add:

1. Index content + provenance on the node upsert (content, author, source_origin, created_at)
2. Reconcile topics: delete old → insert new from `global.topics[]`
3. Clean up topics in `deleteNode()`

### Schema Type Changes

**File:** `processors/graph-indexer/schema.ts`

```typescript
export interface GraphNode {
  // ...existing fields...
  content: string | null;          // NEW
  author: string | null;           // NEW
  source_origin: string | null;    // NEW
  created_at: string | null;       // NEW
}

export interface GraphTopic {       // NEW
  id: string;
  document_id: string;
  name: string;
  updated_at: string;
}

export interface DB {
  graph_nodes: GraphNode;
  graph_edges: GraphEdge;
  graph_topics: GraphTopic;        // NEW
}
```

### New Subgraph Queries

**Topic queries:**
- `knowledgeGraphTopics(driveId)` — all topics with note counts
- `knowledgeGraphByTopic(driveId, topic)` — notes tagged with a topic
- `knowledgeGraphRelatedByTopic(driveId, documentId, limit?)` — notes sharing topics with a given note (semantic neighbors by topic affinity)

**Content search:**
- `knowledgeGraphFullSearch(driveId, query, limit?)` — LIKE search across title + description + content

**Provenance queries:**
- `knowledgeGraphByAuthor(driveId, author)` — notes by author
- `knowledgeGraphByOrigin(driveId, origin)` — notes by source origin (DERIVED, IMPORT, MANUAL, SESSION_MINE)
- `knowledgeGraphRecent(driveId, limit?, since?)` — recently created/updated notes

**Bidirectional traversal:**
- `knowledgeGraphNeighborhood(driveId, documentId, depth?)` — BFS following BOTH forward and backward links

**Cluster detection:**
- `knowledgeGraphClusters(driveId, minSize?)` — groups of notes connected by edges AND shared topics

### Query Layer Optimizations

Move `stats()`, `density()`, `orphanNodes()` from JS in-memory computation to SQL `COUNT`/`JOIN` queries. Batch N+1 node lookups in `connections()` into single `WHERE IN` queries.

### New GraphQL Types

```graphql
type TopicInfo { name: String!, noteCount: Int! }
type RelatedNode { node: KnowledgeGraphNode!, sharedTopics: [String!]!, sharedTopicCount: Int! }
type Cluster { id: String!, topic: String!, nodes: [KnowledgeGraphNode!]!, edgeCount: Int! }
```

### Files to modify

| File | Changes |
|------|---------|
| `processors/graph-indexer/schema.ts` | Add `GraphTopic`, extend `GraphNode`, update `DB` |
| `processors/graph-indexer/migrations.ts` | Add `graph_topics` table, add columns to `graph_nodes` |
| `processors/graph-indexer/index.ts` | Index topics, content, provenance in `onOperations()` |
| `processors/graph-indexer/query.ts` | Add new queries, optimize stats/density/connections |
| `subgraphs/knowledge-graph/subgraph.ts` | Add new GraphQL types + resolvers, update `KnowledgeGraphNode` |

---

## Phase 2: Semantic Search via Embeddings (pgvector + Transformers.js)

### Proven feasibility

Tested end-to-end on 2026-04-04:
- Standalone PGlite with `@electric-sql/pglite/vector` extension — works
- pgvector HNSW index with cosine similarity search — works
- `@huggingface/transformers@4.0.1` with `Supabase/gte-small` model (384 dimensions, q8 quantized) — works
- Semantic search accuracy: "how does storage work?" → correctly returns "Reactor is a storage node" (0.83 similarity) over keyword-irrelevant notes

### Why a separate PGlite instance

The reactor's PGlite (used by the processor namespace) does NOT load the pgvector extension — it's instantiated without `extensions: { vector }` in both Connect (`pglite.worker.js`) and Switchboard (`server.js`). Changing this requires upstream PRs to `@powerhousedao/connect` and `@powerhousedao/switchboard`.

A **standalone PGlite instance** with the vector extension avoids this dependency entirely. The processor writes relational data to the reactor's PGlite (existing) and embeddings to its own PGlite (new). The subgraph queries both.

### Architecture

```
GraphIndexerProcessor
  │
  ├──▶ Reactor's PGlite (namespaced, no pgvector)
  │     graph_nodes, graph_edges, graph_topics
  │
  └──▶ Embedding PGlite (standalone, WITH pgvector)
        note_embeddings (document_id, embedding vector(384))
        HNSW index for fast similarity search

Transformers.js (lazy-loaded gte-small model, ~33MB first load)
  title + " " + description + " " + content → 384-dim vector
```

### New files

| File | Purpose |
|------|---------|
| `processors/graph-indexer/embedding-store.ts` | Standalone PGlite with pgvector — create, upsert, search, close |
| `processors/graph-indexer/embedder.ts` | Transformers.js wrapper — lazy model loading, text → vector |

### Embedding Store (`embedding-store.ts`)

```typescript
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";

// Singleton — one instance per process
let db: PGlite | null = null;

export async function getEmbeddingDb(): Promise<PGlite> {
  if (db) return db;
  db = new PGlite({
    // Browser: "idb://knowledge-embeddings"
    // Node: "./.ph/knowledge-embeddings"
    extensions: { vector },
  });
  await db.exec("CREATE EXTENSION IF NOT EXISTS vector");
  await db.exec(`
    CREATE TABLE IF NOT EXISTS note_embeddings (
      document_id VARCHAR(255) PRIMARY KEY,
      embedding vector(384) NOT NULL,
      updated_at VARCHAR(50) NOT NULL
    )
  `);
  await db.exec(`
    CREATE INDEX IF NOT EXISTS idx_note_embeddings_hnsw
    ON note_embeddings USING hnsw (embedding vector_cosine_ops)
  `);
  return db;
}

export async function upsertEmbedding(documentId: string, embedding: number[]): Promise<void> {
  const edb = await getEmbeddingDb();
  await edb.query(
    `INSERT INTO note_embeddings (document_id, embedding, updated_at)
     VALUES ($1, $2, $3)
     ON CONFLICT (document_id) DO UPDATE SET embedding = $2, updated_at = $3`,
    [documentId, JSON.stringify(embedding), new Date().toISOString()]
  );
}

export async function searchSimilar(queryEmbedding: number[], limit = 10): Promise<Array<{ documentId: string; similarity: number }>> {
  const edb = await getEmbeddingDb();
  const results = await edb.query(
    `SELECT document_id, 1 - (embedding <=> $1::vector) as similarity
     FROM note_embeddings
     ORDER BY embedding <=> $1::vector
     LIMIT $2`,
    [JSON.stringify(queryEmbedding), limit]
  );
  return results.rows as Array<{ document_id: string; similarity: number }>;
}

export async function deleteEmbedding(documentId: string): Promise<void> {
  const edb = await getEmbeddingDb();
  await edb.query("DELETE FROM note_embeddings WHERE document_id = $1", [documentId]);
}
```

### Embedder (`embedder.ts`)

```typescript
import { pipeline, type FeatureExtractionPipeline } from "@huggingface/transformers";

let extractor: FeatureExtractionPipeline | null = null;

export async function getExtractor(): Promise<FeatureExtractionPipeline> {
  if (extractor) return extractor;
  extractor = await pipeline("feature-extraction", "Supabase/gte-small", {
    dtype: "q8",
  });
  return extractor;
}

export async function generateEmbedding(text: string): Promise<number[]> {
  const ext = await getExtractor();
  const result = await ext(text, { pooling: "mean", normalize: true });
  return Array.from(result.data);
}
```

### Processor integration

In `onOperations()`, after the existing relational upsert:

```typescript
// Generate embedding asynchronously (don't block the operation pipeline)
const text = [global.title, global.description, global.content]
  .filter(Boolean)
  .join(" ");
if (text.length > 0) {
  generateEmbedding(text)
    .then((embedding) => upsertEmbedding(documentId, embedding))
    .catch((err) => console.warn(`[GraphIndexer] Embedding failed for ${documentId}:`, err));
}
```

Embedding generation is fire-and-forget — it doesn't block operation processing. The embedding store catches up asynchronously.

### New subgraph queries

```graphql
# Semantic search — find notes by meaning
knowledgeGraphSemanticSearch(driveId: ID!, query: String!, limit: Int): [SemanticResult!]!

# Find notes similar to a given note
knowledgeGraphSimilar(driveId: ID!, documentId: String!, limit: Int): [SemanticResult!]!

type SemanticResult {
  node: KnowledgeGraphNode!
  similarity: Float!
}
```

### Subgraph resolver pattern

```typescript
knowledgeGraphSemanticSearch: async (_, args) => {
  // 1. Generate query embedding
  const queryEmbedding = await generateEmbedding(args.query);
  // 2. Search embedding store
  const matches = await searchSimilar(queryEmbedding, args.limit ?? 10);
  // 3. Join with relational data for full node info
  const query = this.getQuery(args.driveId);
  return Promise.all(matches.map(async (m) => ({
    node: await query.nodeByDocumentId(m.documentId),
    similarity: m.similarity,
  })));
},
```

### Performance considerations

| Metric | Value | Note |
|--------|-------|------|
| Model download | ~33MB | One-time, cached after first load |
| Embedding generation | ~50ms per note | With q8 quantization on CPU |
| Full vault reindex (189 notes) | ~10 seconds | Async, non-blocking |
| HNSW search query | <5ms | Sub-millisecond at 1000 nodes |
| Storage overhead | ~300 bytes per embedding | 384 floats * 4 bytes = 1.5KB, but pgvector compresses |

### Persistence paths

| Environment | Embedding PGlite path | Rationale |
|-------------|----------------------|-----------|
| Connect (browser) | `idb://knowledge-embeddings` | IndexedDB, survives page reloads |
| Switchboard (server) | `./.ph/knowledge-embeddings` | Filesystem, survives restarts |

Detection: check `typeof window !== "undefined"` to pick the right path.

### Files to create/modify

| File | Action |
|------|--------|
| `processors/graph-indexer/embedding-store.ts` | **Create** — standalone PGlite with pgvector |
| `processors/graph-indexer/embedder.ts` | **Create** — Transformers.js wrapper |
| `processors/graph-indexer/index.ts` | **Modify** — call embedder in onOperations |
| `subgraphs/knowledge-graph/subgraph.ts` | **Modify** — add semantic search resolvers |
| `package.json` | **Modify** — add `@huggingface/transformers` dependency |

### Migration path to upstream pgvector

When Powerhouse eventually adds `vector` to the reactor's PGlite:
1. Move `note_embeddings` table into the processor's namespace (same DB)
2. Remove standalone PGlite instance
3. Subgraph queries simplify to single-DB joins
4. Everything else (model, embedder, API) stays identical

---

## Implementation Order

Phase 1 and Phase 2 can proceed **in parallel** since Phase 2 uses a separate database.

```
Phase 1: topics, content, provenance, SQL optimization
  ├── 1a. Schema + migrations (additive, safe)
  ├── 1b. Processor: index new fields
  ├── 1c. Query layer: new methods + optimizations
  ├── 1d. Subgraph: new GraphQL queries
  └── 1e. Reindex mutation: populate new fields

Phase 2: semantic embeddings
  ├── 2a. embedding-store.ts + embedder.ts (new files)
  ├── 2b. Processor: generate embeddings in onOperations
  ├── 2c. Subgraph: semantic search + similar notes resolvers
  └── 2d. Reindex mutation: populate embeddings
```

## Verification

```bash
# Build check
bun tsc --noEmit
bun eslint processors/ subgraphs/

# Phase 1 queries
switchboard query '{ knowledgeGraphTopics(driveId: "<UUID>") { name noteCount } }'
switchboard query '{ knowledgeGraphFullSearch(driveId: "<UUID>", query: "PGlite") { title } }'
switchboard query '{ knowledgeGraphByAuthor(driveId: "<UUID>", author: "knowledge-agent") { title } }'
switchboard query '{ knowledgeGraphRelatedByTopic(driveId: "<UUID>", documentId: "<NOTE>") { node { title } sharedTopics } }'

# Phase 2 queries
switchboard query '{ knowledgeGraphSemanticSearch(driveId: "<UUID>", query: "how does storage work?") { node { title } similarity } }'
switchboard query '{ knowledgeGraphSimilar(driveId: "<UUID>", documentId: "<NOTE>", limit: 5) { node { title } similarity } }'
```
