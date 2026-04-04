# bai-knowledge-note

A Powerhouse Vetra package for team-wide institutional memory — atomic knowledge notes with typed content, structured links, lifecycle states, and provenance tracking.

## Architecture

```
bai-knowledge-note/
├── document-models/     11 document models (data schemas + reducers)
├── editors/             10 editors + 1 drive-app (UI layer)
├── processors/          Graph indexer (data pipeline)
├── subgraphs/           Knowledge graph (GraphQL query API)
├── powerhouse.manifest.json
└── powerhouse.config.json
```

## Document Models

11 document types defining the knowledge vault's data layer:

| Model | Type | Role |
|-------|------|------|
| **KnowledgeNote** | `bai/knowledge-note` | Atomic knowledge claims with title, content, typed links, topics, provenance |
| **Moc** | `bai/moc` | Maps of Content — topic navigation hubs organizing notes into clusters |
| **Source** | `bai/source` | Raw ingested material (articles, transcripts, documentation) |
| **ResearchClaim** | `bai/research-claim` | Ars Contexta methodology foundation (249 claims) |
| **KnowledgeGraph** | `bai/knowledge-graph` | Materialized graph singleton |
| **PipelineQueue** | `bai/pipeline-queue` | Processing task tracker singleton |
| **HealthReport** | `bai/health-report` | Point-in-time vault diagnostics |
| **VaultConfig** | `bai/vault-config` | Vault configuration singleton |
| **Observation** | `bai/observation` | Operational learning signals |
| **Tension** | `bai/tension` | Unresolved contradictions between claims |
| **Derivation** | `bai/derivation` | Configuration audit trail |

Each model lives in `document-models/<name>/v1/` with `gen/` (auto-generated types, action creators) and `src/` (hand-written reducers).

## Editors

React components for viewing and editing each document type. All editors use the `useSelectedXDocument()` hook pattern from `@powerhousedao/reactor-browser` which returns `[document, dispatch]`.

### Drive App: Knowledge Vault

The main entry point (`editors/knowledge-vault/`). Registered as a drive-app in the manifest — this is what users see when they open the drive in Connect. Features:

- **Notes tab** — Paginated grid of NoteCards with status badges, topics, and link counts
- **Graph tab** — Cytoscape.js visualization with fcose layout, semantic clustering around MOC hubs, position persistence across sessions, and cross-cluster edge separation
- **Sources tab** — Ingested source material with status tracking
- **Pipeline tab** — Processing queue with phase tracking
- **Health tab** — Vault diagnostics dashboard
- **Config tab** — Vault configuration

### Document Editors

| Editor | Document Type | Purpose |
|--------|--------------|---------|
| `knowledge-note-editor` | `bai/knowledge-note` | Textarea editor with markdown preview, links section, topic management |
| `moc-editor` | `bai/moc` | Core ideas, tensions, open questions, child MOC references |
| `source-editor` | `bai/source` | Source ingestion with content preview and extraction stats |
| `research-claim-editor` | `bai/research-claim` | Methodology claim viewer |
| `health-report-editor` | `bai/health-report` | Health check results |
| `pipeline-queue-editor` | `bai/pipeline-queue` | Task queue management |
| `observation-editor` | `bai/observation` | Operational signals |
| `tension-editor` | `bai/tension` | Contradiction tracking |
| `vault-config-editor` | `bai/vault-config` | Configuration management |
| `knowledge-graph-editor` | `bai/knowledge-graph` | Graph document viewer |

## Processor: Graph Indexer

The data pipeline that turns document operations into a queryable relational index (`processors/graph-indexer/`).

### How it works

**Registration:** `processors/factory.ts` → `graph-indexer/factory.ts` — called once per drive on startup. Creates a namespaced PGlite store (`GraphIndexerProcessor_<driveId>`) and registers a filter for `bai/knowledge-note` + `powerhouse/document-drive` operations.

**Processing:** `onOperations()` is called whenever matching operations occur:

1. **Deduplicates** — keeps only the last operation per document in a batch
2. **Handles deletions** — `DELETE_NODE` on the drive removes the node + all edges from the index
3. **Filters** — skips anything that isn't `bai/knowledge-note`
4. **Reconciles** — for each changed document, reads `context.resultingState`:
   - Upserts into `graph_nodes` (id, title, description, noteType, status)
   - Deletes old edges for that source document
   - Inserts new edges from the note's `links[]` array

**Schema:**

```
graph_nodes: id, document_id, title, description, note_type, status, updated_at
graph_edges: id, source_document_id, target_document_id, link_type, target_title, updated_at
```

Indexes on `source_document_id`, `target_document_id`, and `status` for query performance.

**On disconnect:** No-op — preserves indexed data across restarts. The reactor does not replay historical operations, so wiping tables would leave the index permanently empty.

## Subgraph: Knowledge Graph

GraphQL query layer exposing the indexed data (`subgraphs/knowledge-graph/`). Registered at `/graphql/knowledgeGraph`.

### Queries

| Query | Description |
|-------|-------------|
| `knowledgeGraphNodes(driveId)` | All indexed nodes |
| `knowledgeGraphEdges(driveId)` | All indexed edges |
| `knowledgeGraphStats(driveId)` | Node count, edge count, orphan count |
| `knowledgeGraphSearch(driveId, query, limit?)` | Text search on title + description |
| `knowledgeGraphOrphans(driveId)` | Nodes with no incoming edges |
| `knowledgeGraphConnections(driveId, documentId, depth?)` | BFS traversal from a node |
| `knowledgeGraphBacklinks(driveId, documentId)` | Edges pointing TO a document |
| `knowledgeGraphForwardLinks(driveId, documentId)` | Edges pointing FROM a document |
| `knowledgeGraphTriangles(driveId, limit?)` | Pairs that share a target but aren't linked |
| `knowledgeGraphBridges(driveId)` | Articulation points that connect clusters |
| `knowledgeGraphDensity(driveId)` | Graph density metric |
| `knowledgeGraphDebug(driveId)` | Raw DB rows for debugging |

### Mutations

| Mutation | Description |
|----------|-------------|
| `knowledgeGraphReindex(driveId)` | Backfill the index by reading all notes — use when the processor missed historical operations |

## Deep Dive: Processor + Subgraph Architecture

### The Problem They Solve

Powerhouse documents are stored as **operation logs** (event sourcing). To read a note's title, you replay all its operations to reconstruct the current state. This works for individual documents, but becomes expensive when you need to:

- Search across 500+ notes by keyword
- Find all notes linking to a specific note
- Calculate graph metrics (density, orphans, bridges)
- Render a graph visualization of all notes and edges

Without an index, every query would require loading and replaying every document in the drive. The processor + subgraph pattern solves this by maintaining a **materialized read model** — a relational projection of document state that's always up to date.

### How the Processor Works (Write Path)

The `GraphIndexerProcessor` sits between the Reactor and a PGlite relational database. It implements the `RelationalDbProcessor` base class from `@powerhousedao/shared/processors`.

```
┌─────────────────────────────────────────────────────┐
│                      Reactor                        │
│                                                     │
│  Document A  ──op──▶ ┌───────────────────────────┐  │
│  Document B  ──op──▶ │   GraphIndexerProcessor   │  │
│  Document C  ──op──▶ │                           │  │
│  Drive (delete)──op─▶│  filter:                  │  │
│                      │   bai/knowledge-note      │  │
│                      │   powerhouse/document-drive│  │
│                      │                           │  │
│                      │  onOperations(ops[]):      │  │
│                      │   1. deduplicate           │  │
│                      │   2. handle deletions      │  │
│                      │   3. upsert graph_nodes    │  │
│                      │   4. reconcile graph_edges │  │
│                      └──────────┬────────────────┘  │
│                                 │                    │
│                      ┌──────────▼────────────────┐  │
│                      │    PGlite (namespaced)    │  │
│                      │                           │  │
│                      │  graph_nodes              │  │
│                      │    id, document_id, title  │  │
│                      │    description, note_type  │  │
│                      │    status, updated_at      │  │
│                      │                           │  │
│                      │  graph_edges              │  │
│                      │    id, source_document_id  │  │
│                      │    target_document_id      │  │
│                      │    link_type, target_title │  │
│                      └───────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

**Key design decisions:**

1. **Filter-based subscription** — The processor declares interest in specific document types and scopes. The Reactor only sends matching operations, avoiding unnecessary work:
   ```typescript
   const filter: ProcessorFilter = {
     branch: ["main"],
     documentId: ["*"],
     documentType: ["bai/knowledge-note", "powerhouse/document-drive"],
     scope: ["global"],
   };
   ```

2. **State reconciliation, not event replay** — The processor doesn't interpret individual operations (SET_TITLE, ADD_LINK, etc.). Instead, it reads `context.resultingState` — the full document state after the operation — and upserts the entire node + edges. This means it doesn't need to know the document model's operation semantics.

3. **Namespace isolation** — Each drive gets its own PGlite namespace (`GraphIndexerProcessor_<driveId>`), so multiple drives don't interfere with each other. The namespace is derived deterministically from the drive ID.

4. **Idempotent migrations** — Tables and indexes are created with `ifNotExists`, so the processor can restart safely without schema conflicts.

5. **No-op on disconnect** — The processor preserves its data across server restarts. Since the Reactor doesn't replay historical operations to processors, wiping on disconnect would leave the index empty until new edits arrive.

### How the Subgraph Works (Read Path)

The `KnowledgeGraphSubgraph` extends `BaseSubgraph` from `@powerhousedao/reactor-api` and exposes the indexed data via GraphQL at `/graphql/knowledgeGraph`.

```
┌──────────────────────────────────────────────────┐
│              GraphQL Clients                     │
│                                                  │
│  Connect UI ─────────┐                           │
│  AI Agent (MCP) ─────┤                           │
│  Switchboard CLI ────┤  query / mutation         │
│  Third-party app ────┤                           │
│  curl / Postman ─────┘                           │
│                      │                           │
│           ┌──────────▼───────────────────┐       │
│           │   /graphql/knowledgeGraph    │       │
│           │                              │       │
│           │   KnowledgeGraphSubgraph     │       │
│           │     ├─ getDb(driveId)        │       │
│           │     │    → namespaced Kysely │       │
│           │     ├─ getQuery(driveId)     │       │
│           │     │    → typed query API   │       │
│           │     ├─ reindexDrive()        │       │
│           │     │    → backfill from     │       │
│           │     │      reactorClient     │       │
│           │     └─ ensureGraphDoc()      │       │
│           │          → auto-create       │       │
│           │            bai/knowledge-    │       │
│           │            graph doc         │       │
│           └──────────┬───────────────────┘       │
│                      │                           │
│           ┌──────────▼───────────────────┐       │
│           │  PGlite (same namespace as   │       │
│           │  the processor writes to)    │       │
│           └──────────────────────────────┘       │
└──────────────────────────────────────────────────┘
```

**The subgraph reads from the same PGlite tables the processor writes to.** This is the key architectural link — the processor is the write path, the subgraph is the read path, and they share a namespace.

The subgraph provides two levels of query abstraction:

1. **`getDb(driveId)`** — Returns a typed `Kysely<DB>` instance scoped to the processor's namespace. This centralizes the `IRelationalDbLegacy → IRelationalDb → Kysely` cast in one place.

2. **`getQuery(driveId)`** — Wraps `getDb` with the `createGraphQuery()` helper that provides high-level methods (`allNodes()`, `searchNodes()`, `connections()`, `triangles()`, `bridges()`, etc.). All queries use Kysely's type-safe query builder.

### How Third-Party Plugins Can Use This

Any application that can make GraphQL requests to the Reactor's endpoint can query the knowledge graph. The subgraph is accessible at `/graphql/knowledgeGraph` (local: `http://localhost:4001/graphql/knowledgeGraph`, remote: `https://your-switchboard.example.com/graphql/knowledgeGraph`).

**Example: Search notes from any client**

```graphql
query SearchNotes($driveId: ID!, $query: String!) {
  knowledgeGraphSearch(driveId: $driveId, query: $query, limit: 20) {
    documentId
    title
    description
    noteType
    status
  }
}
```

**Example: Get graph structure for visualization**

```graphql
query GraphData($driveId: ID!) {
  knowledgeGraphNodes(driveId: $driveId) {
    documentId
    title
    noteType
    status
  }
  knowledgeGraphEdges(driveId: $driveId) {
    sourceDocumentId
    targetDocumentId
    linkType
    targetTitle
  }
  knowledgeGraphStats(driveId: $driveId) {
    nodeCount
    edgeCount
    orphanCount
  }
}
```

**Example: Find synthesis opportunities (triangles)**

```graphql
query FindTriangles($driveId: ID!) {
  knowledgeGraphTriangles(driveId: $driveId, limit: 10) {
    noteA { documentId title }
    noteB { documentId title }
    sharedTarget { documentId title }
  }
}
```

**Example: Backfill the index after deployment**

```graphql
mutation Reindex($driveId: ID!) {
  knowledgeGraphReindex(driveId: $driveId) {
    indexedNodes
    indexedEdges
    errors
  }
}
```

**Using the Switchboard CLI:**

```bash
# Search
switchboard query '{ knowledgeGraphSearch(driveId: "<UUID>", query: "reactor") { documentId title } }'

# Stats
switchboard query '{ knowledgeGraphStats(driveId: "<UUID>") { nodeCount edgeCount orphanCount } }'

# Reindex
switchboard query 'mutation { knowledgeGraphReindex(driveId: "<UUID>") { indexedNodes indexedEdges errors } }'
```

**Using MCP (for AI agents):**

AI agents connected via MCP can't call the subgraph directly, but they can use `mcp__reactor-mcp__getDocument` to read individual documents. The Switchboard CLI provides the fastest path for agents to query the graph index — the `powerhouse-knowledge` plugin uses this pattern.

### Why This Pattern Matters

The processor + subgraph pattern is the recommended way to build **read-optimized projections** in Powerhouse:

| Concern | Without processor | With processor |
|---------|------------------|----------------|
| Search 500 notes by keyword | Load all 500 documents, replay ops, scan content | Single SQL `LIKE` query on `graph_nodes.title` |
| Find orphan notes | Load all docs, build adjacency list in memory | `SELECT * FROM graph_nodes WHERE document_id NOT IN (SELECT target_document_id FROM graph_edges)` |
| Graph density | Load everything, count manually | Two `COUNT(*)` queries |
| Incremental updates | Reload everything on each change | Upsert one row per changed document |

The same pattern can be applied to any domain — an invoice tracker could project invoice totals into a summary table, a project manager could index task statuses, etc. The processor handles the write path (operation → relational row), and the subgraph handles the read path (GraphQL → SQL → response).

## Data Flow

```
User edits a note in the editor
  → dispatch(setTitle({...}))
    → operation recorded on the document
      → Reactor sends operation to GraphIndexerProcessor
        → Processor upserts graph_nodes + graph_edges in PGlite
          → Subgraph queries return updated data
            → GraphView in the drive-app renders the graph
```

## Drive Structure

Documents are organized into folders within the drive:

| Folder | Document Types | Purpose |
|--------|---------------|---------|
| `/knowledge/notes/` | `bai/knowledge-note` | Atomic knowledge claims |
| `/knowledge/` | `bai/moc` | Maps of Content |
| `/sources/` | `bai/source` | Raw input material |
| `/research/` | `bai/research-claim` | Methodology foundation |
| `/ops/queue/` | `bai/pipeline-queue` | Pipeline singleton |
| `/ops/health/` | `bai/health-report` | Health report singleton |
| `/ops/sessions/` | `bai/observation` | Operational signals |
| `/self/` | `bai/knowledge-graph`, `bai/vault-config` | Singletons |

## Development

```bash
# Install dependencies
bun install

# Start Vetra Studio with live code generation
ph vetra --watch

# Type check
bun tsc --noEmit

# Lint
bun eslint <file>

# Format
bun prettier --write <file>

# Run tests
bun test
```

### Subgraph Endpoint Configuration

The Search tab and other editor features that query the Knowledge Graph subgraph need to reach the reactor's GraphQL endpoint. The endpoint is resolved automatically in most cases:

| Environment | How it works |
|-------------|-------------|
| **`ph vetra --watch`** (local dev) | Auto-detected: Vite runs on port 3000/3001, subgraph at `http://localhost:4001/graphql/knowledgeGraph` |
| **Connect production** (same origin) | Auto-detected: relative path `/graphql/knowledgeGraph` |
| **Deployed** (Connect and Switchboard on different domains) | Set `VITE_SUBGRAPH_URL` env var |

For deployed environments where Connect runs on a different domain than the Switchboard (e.g., `connect.example.com` vs `switchboard-dev.powerhouse.xyz`), create a `.env` file:

```bash
# .env
VITE_SUBGRAPH_URL=https://switchboard-dev.powerhouse.xyz/graphql/knowledgeGraph
```

This is only needed when the app and reactor are on different origins. Local development and same-origin deployments work without any configuration.

## Graph View

The knowledge graph visualization uses `cytoscape-fcose` (force-directed layout) with semantic clustering:

- **MOC hubs** act as cluster anchors with higher repulsion, pulling their CORE_IDEA-linked notes into visible topic neighborhoods
- **Cross-cluster edges** have weak elasticity and long ideal lengths, preventing topic groups from collapsing together
- **Position persistence** via localStorage — positions survive tab switches and page reloads. New nodes are placed by fcose while existing nodes stay pinned
- **MOC group drag** — dragging a MOC diamond moves its entire cluster of connected notes
- **Re-layout button** clears cached positions and recomputes a fresh layout

## License

AGPL-3.0-only
