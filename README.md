# bai-knowledge-note

A Powerhouse Vetra package for team-wide institutional memory — atomic knowledge notes with typed content, structured links, lifecycle states, and provenance tracking.

Read by humans in the Knowledge Vault app; written by agents through the [powerhouse-knowledge](https://github.com/liberuum/powerhouse-knowledge) plugin.

## Architecture

```
bai-knowledge-note/
├── document-models/     12 document models (data schemas + reducers)
├── editors/             11 editors + 1 drive-app (UI layer)
├── processors/          1 processor: the graph indexer (write path)
├── subgraphs/           3 subgraphs: knowledge-graph, access, http (read path)
├── scripts/             maintenance and sync tooling
├── tests/               unit, processor and integration suites
├── docs/                http-api.md, plans, upstream bug logs
├── powerhouse.manifest.json
└── powerhouse.config.json
```

## Document Models

12 document types defining the knowledge vault's data layer:

| Model | Type | Indexed | Role |
|-------|------|---------|------|
| **KnowledgeNote** | `bai/knowledge-note` | ✅ knowledge | Atomic knowledge claims with title, content, typed links, topics, provenance |
| **Moc** | `bai/moc` | ✅ knowledge | Maps of Content — topic navigation hubs organizing notes into clusters |
| **ResearchClaim** | `bai/research-claim` | ✅ knowledge | Ars Contexta methodology foundation (249 claims) |
| **Tension** | `bai/tension` | ✅ meta | Unresolved contradictions between claims |
| **Observation** | `bai/observation` | ✅ meta | Operational learning signals |
| **ScopeOfWork** | `powerhouse/scopeofwork` | ✅ execution | Envelopes (the projects), priced deliverables, roadmaps, milestones, contributors |
| **Work Breakdown Structure** | `bai/wbs` | ✅ execution | Goal tree that delivers one envelope: statuses, assignees, dependencies |
| **Source** | `bai/source` | ❌ | Raw ingested material (articles, transcripts, documentation) |
| **PipelineQueue** | `bai/pipeline-queue` | ❌ | Processing task tracker singleton |
| **HealthReport** | `bai/health-report` | ❌ | Point-in-time vault diagnostics |
| **VaultConfig** | `bai/vault-config` | ❌ | Vault configuration singleton |
| **Derivation** | `bai/derivation` | ❌ | Configuration audit trail |

Each model lives in `document-models/<name>/v1/` with `gen/` (auto-generated types, action creators) and `src/` (hand-written reducers). Sources, the health report, the pipeline queue, the vault config and derivations are **not** indexed — read those by id (`GET notes/:id`); see *Processor* below for why.

There is **no** `bai/knowledge-graph` document. The graph is the indexer's tables, exposed through the subgraph of the same name.

## Editors

React components for viewing and editing each document type. All editors use the `useSelectedXDocument()` hook pattern from `@powerhousedao/reactor-browser`, which returns `[document, dispatch]`.

### Drive App: Knowledge Vault

The main entry point (`editors/knowledge-vault/`). Registered as an app in `powerhouse.manifest.json` — this is what users see when they open the drive in Connect. Twelve views:

| View | What it shows |
|------|---------------|
| **Chat** | Read-only agent over the graph index (see *Chat* below) |
| **Search** | Semantic and keyword search with hit neighbourhoods |
| **Notes** | Paginated grid of NoteCards with status badges, topics, link counts |
| **Graph** | Cytoscape.js / PixiJS visualization with fcose layout and semantic clustering |
| **Sources** | Ingested source material, navigable as folders under `/sources` |
| **Projects** | Scopes of work |
| **Scope** | Nested scope-of-work detail (envelopes, deliverables, milestones, WBS trees) |
| **Access** | Documents, grants and protections (needs `canManage`) |
| **Activity** | Drive-wide operation log, newest first, with signer and app |
| **Pipeline** | Processing queue with phase tracking |
| **Health** | Vault diagnostics dashboard |
| **Config** | Vault configuration |

The sidebar groups them: Chat, Search, Notes, Graph, Sources, Projects and Scope are the main items; Access, Activity, Pipeline, Health and Config sit under settings; Add Source, Knowledge Note and Map of Content are the create actions.

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
| `wbs-editor` | `bai/wbs` | Work breakdown structure |
| `scope-of-work` | `powerhouse/scopeofwork` | Scope of work |

`editors/editors.ts` is the registration list; `editors/shared/` holds cross-editor building blocks (theme provider, request metrics).

## Processor: Graph Indexer

The data pipeline that turns document operations into a queryable relational index (`processors/graph-indexer/`).

### How it works

**Registration:** `processors/factory.ts` picks the app-specific builder list (`processors/switchboard.ts` registers the graph indexer; `processors/connect.ts` registers none) — called once per drive on startup. It creates a namespaced PGlite store (`GraphIndexerProcessor_<driveId>`) and registers a filter for:

```typescript
const filter: ProcessorFilter = {
  branch: ["main"],
  documentId: ["*"],
  documentType: [...INDEXED_DOCUMENT_TYPES, "powerhouse/document-drive"],
  scope: ["global"],
};
```

`INDEXED_DOCUMENT_TYPES` is defined once in `processors/graph-indexer/project.ts` — it is the single source of truth for both the live processor and the reindex mutation, which used to carry two copies of the mapping and drifted.

**Processing:** `onOperations()` is called whenever matching operations occur:

1. **Deduplicates** — keeps only the last operation per document in a batch
2. **Handles deletions** — `DELETE_NODE` on the drive removes the node + all edges from the index
3. **Filters** — skips anything that isn't an indexed type
4. **Reconciles** — for each changed document, reads `context.resultingState` and calls `projectNode()`:
   - Upserts into `graph_nodes` (id, title, description, content, note_type, status, author, source_origin, document_type, timestamps)
   - Deletes old edges for that source document
   - Inserts new edges from the document's links

**Schema:**

```
graph_nodes       id, document_id, document_type, title, description, content,
                  note_type, status, author, source_origin, created_at, updated_at
graph_edges       id, source_document_id, target_document_id, link_type,
                  target_title, metadata, updated_at
graph_topics      id, document_id, name, updated_at
graph_operations  id, document_id, operation_type, timestamp, index, scope,
                  summary, input_json, signer_address, signer_app, signer_key,
                  signature
note_embeddings   document_id, embedding, dims, model, content_hash, updated_at
```

Indexes on `source_document_id`, `target_document_id`, `status`, `document_type`, topic `document_id`/`name`, and operation `document_id`/`timestamp`/`operation_type`.

Embeddings are JSON-encoded float arrays with cosine computed in JS — exact, and no pgvector dependency (measured ~2.1 ms at 521 notes, ~25 ms at 100k). `model` and `dims` are stored per row so a model swap re-embeds incrementally rather than wholesale.

**Semantic search:** the processor computes a 384-dim embedding per note server-side (gte-small via Transformers.js) on every content change, plus a boot-time backfill for documents the embedder has not reached. `knowledgeGraphMissingEmbeddings` is the check for a degraded index.

**Knowledge vs meta vs execution.** `document_type` on the row lets every consumer draw the line itself. `knowledgeGraphOrphans` and the "every note has ≥ 2 connections" standard count only `KNOWLEDGE_NODE_TYPES` (`knowledge-note`, `moc`, `research-claim`) — a tension, observation, scope or work breakdown has, by design, nothing pointing at it. MoCs, scopes and WBS trees take a sentinel `status` (`MOC`, `SCOPE`, `WBS`) so a DRAFT scope cannot surface as a draft note; their real lifecycle lives in `note_type`.

**On disconnect:** No-op — preserves indexed data across restarts. The reactor does not replay historical operations, so wiping tables would leave the index permanently empty.

## Subgraphs

Three subgraphs ship with the package:

| Subgraph | Endpoint | Role |
|----------|----------|------|
| **knowledge-graph** | `/graphql/knowledgeGraph` | Every query over the indexed graph |
| **access** | `/graphql/access` | Who has access to what |
| **http** | `/api/@powerhousedao/knowledge-note/*` | The REST write path and read shortcuts |

### Knowledge Graph

GraphQL query layer exposing the indexed data (`subgraphs/knowledge-graph/`).

#### Queries

Every query takes `driveId` as its first argument; it is omitted below.

**Search and retrieval**

| Query | Description |
|-------|-------------|
| `knowledgeGraphSemanticSearch(query, mode?, limit?, includeArchived?)` | **Start here.** Plain-language search; the query is embedded server-side. Select `related` for a hit's one-hop neighbourhood and `linkedHits` for the edges to OTHER hits — select both: `related` excludes nodes that are themselves hits, so a `CONTRADICTS` between two results only ever arrives through `linkedHits`. Neither costs a query per hit. Falls back to keyword search when embeddings are unavailable |
| `knowledgeGraphSearchByEmbedding(query, embedding, mode, limit?, includeArchived?)` | Same ranking from a client-supplied vector |
| `knowledgeGraphFullSearch(query, limit?, includeArchived?)` | Keyword search over title + description + content. **ANDs its terms** — pass 1–2 distinctive words, not a sentence |
| `knowledgeGraphSearch(query, limit?)` | Keyword search over title + description only |
| `knowledgeGraphSimilar(documentId, limit?, includeArchived?)` | Semantic neighbours of a note |
| `knowledgeGraphNodeByDocumentId(documentId)` | One node, with content |
| `knowledgeGraphMissingEmbeddings` | Documents the embedder has not reached; should be empty |

**Browsing**

| Query | Description |
|-------|-------------|
| `knowledgeGraphNodes` / `knowledgeGraphEdges` | The whole graph, one call each |
| `knowledgeGraphNodesByStatus(status)` | Nodes in a lifecycle state; `"MOC"`, `"SCOPE"` and `"WBS"` are sentinels for those kinds |
| `knowledgeGraphNodesByType(documentType)` | All nodes of one document type |
| `knowledgeGraphByTopic(topic, includeArchived?)` / `knowledgeGraphTopics` | Topic membership / the topic vocabulary with counts |
| `knowledgeGraphRelatedByTopic(documentId, limit?)` | Notes sharing topics, ranked by overlap |
| `knowledgeGraphByAuthor(author)` / `knowledgeGraphByOrigin(origin)` | Provenance |
| `knowledgeGraphRecent(limit?, since?)` / `knowledgeGraphStale(since, limit?)` | Recency |

**Structure**

| Query | Description |
|-------|-------------|
| `knowledgeGraphConnections(documentId, depth?)` | Breadth-first walk out from a node, one query per depth level |
| `knowledgeGraphBacklinks(documentId)` / `knowledgeGraphForwardLinks(documentId)` | Edges into / out of a document, with `reason` and `confidence` |
| `knowledgeGraphOrphans` | Knowledge nodes with no incoming knowledge edge |
| `knowledgeGraphTriangles(limit?)` | Pairs that share a target but are not linked to each other |
| `knowledgeGraphBridges` | Articulation points — the notes holding two clusters together, and what archiving one would strand. One DFS pass (Tarjan), O(V+E). **Requires write**: a curation question, not a discovery one |
| `knowledgeGraphStats` / `knowledgeGraphDensity` | Per-kind counts, articulation coverage / density |

**Audit** (privileged — these expose operation diffs and signer addresses)

| Query | Description |
|-------|-------------|
| `knowledgeGraphHistory(documentId, limit?)` | Operations on one document |
| `knowledgeGraphActivity(limit?, since?)` / `knowledgeGraphActivityByType(operationType, limit?)` | Drive-wide operation log |
| `knowledgeGraphDebug` | Raw projection rows |

#### Mutations

| Mutation | Description |
|----------|-------------|
| `knowledgeGraphReindex(driveId)` | Backfill the index by reading all documents — use when the processor missed historical operations. Reindex does not re-embed |

### Access

`subgraphs/access/` answers "who has access to what" from the host's own tables, server-side. The host owns the address-to-document relation but exposes it one document at a time, or for the calling user alone; answering it from a client cost one request per document — around 1,500 round trips on a full vault.

| Query | Description |
|-------|-------------|
| `accessMap(driveId)` | Every grant, protection and operation restriction in a drive, in one call. **Requires ADMIN of the drive** — it publishes the whole access list. `available: false` means the Switchboard runs without document permissions enabled (the tables do not exist), not that nobody has access |
| `canManage(documentId)` | Whether the caller administers this document — supreme admin, owner, or an ADMIN grant. A boolean, so asking has no side effects |

### HTTP

`subgraphs/http/` is the REST surface agents write through — the only surface that can place a document in a folder and set a link's `reason`. Base path:

```
<origin>/api/@powerhousedao/knowledge-note/<path>
```

Every route matches in registration order and answers as a Fetch handler. `auth` is enforced by the host, and a route written as `renown` still checks `ctx.user` in its handler, because a host with authentication disabled serves every route anonymously. Every route that reads the index takes `drive` (a document UUID).

| Group | Routes |
|-------|--------|
| Status | `GET ping`, `GET health.json`, `GET badge.svg` (**public** — the status word only, 5-minute cache) |
| Discovery | `GET drives` (only knowledge-vault drives the caller may read), `GET search` (semantic; `Accept: text/markdown` renders a digest) |
| Notes | `GET notes/:id`, `GET notes/:id.md` (markdown with YAML frontmatter) |
| Graph | `GET stats`, `GET density`, `GET topics`, `GET topics/:name`, `GET orphans`, `GET triangles`, `GET bridges`\*, `GET graph.json`, `GET embeddings/missing` |
| Neighbourhood | `GET notes/:id/similar`, `/links`, `/backlinks`, `/connections` — each with edge reasons |
| Audit | `GET activity`, `GET notes/:id/history`\*, `GET access-map`† |
| LLM docs | `GET llms.txt` (`renown-optional`), `GET llms-full.txt` (`renown-optional`; `includeDrafts=1` to inline every non-archived note) |
| Ingest | `POST sources`, `POST sources/folders`, `POST notes` (up to 25 with their actions, placed in one containment dispatch), `POST tasks/:id/claim` |
| Write | `POST actions`, `POST relationships` / `PATCH relationships` / `DELETE relationships` |
| Admin | `POST admin/reindex`† |

\* requires `canWrite` — a curation question, not a discovery one. † requires `canManage`.

Every route that creates documents **undoes its own work on failure** — creation and containment are separate reactor jobs, and a document stranded at the drive root is invisible to folder views and the pipeline. Placement is the API's job: `POST sources` takes content, not a location, and resolves `/sources` from the drive's own tree at request time. Full route contracts — bodies, responses, error codes, write semantics — are in **[docs/http-api.md](docs/http-api.md)**.

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
│                      │   indexed document types  │  │
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
│                      │                           │  │
│                      │  graph_topics             │  │
│                      │  graph_operations         │  │
│                      │  note_embeddings          │  │
│                      └───────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

**Key design decisions:**

1. **Filter-based subscription** — The processor declares interest in specific document types and scopes. The Reactor only sends matching operations, avoiding unnecessary work.
2. **State reconciliation, not event replay** — The processor doesn't interpret individual operations (SET_TITLE, ADD_LINK, etc.). Instead, it reads `context.resultingState` — the full document state after the operation — and upserts the entire node + edges. This means it doesn't need to know the document model's operation semantics.
3. **One projection function, two callers** — `projectNode()` in `project.ts` maps state → row for both the live processor and the `reindex` mutation. Kept in one place because two copies drifted more than once.
4. **Namespace isolation** — Each drive gets its own PGlite namespace (`GraphIndexerProcessor_<driveId>`), so multiple drives don't interfere with each other. The namespace is derived deterministically from the drive ID.
5. **Idempotent migrations** — Tables and indexes are created with `ifNotExists`, and later columns are added in try/catch, so the processor can restart safely without schema conflicts.
6. **No-op on disconnect** — The processor preserves its data across server restarts. Since the Reactor doesn't replay historical operations to processors, wiping on disconnect would leave the index empty until new edits arrive.

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
│           │     └─ reindexDrive()        │       │
│           │          → backfill from     │       │
│           │            reactorClient     │       │
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

AI agents connected via MCP can't call the subgraph directly, but they can use `mcp__reactor-mcp__getDocument` to read individual documents. The Switchboard CLI provides the fastest path for agents to query the graph index — the [powerhouse-knowledge](https://github.com/liberuum/powerhouse-knowledge) plugin uses this pattern, alongside the REST surface above.

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

The same operation log is what the HTTP surface reads back, what the app's Activity view lists with its signer, and what the audit queries (`knowledgeGraphHistory`, `knowledgeGraphActivity`) expose.

## Drive Structure

A vault drive is scaffolded to the Ars Contexta layout on first open (`editors/knowledge-vault/hooks/use-drive-init.ts`), which also creates the three singletons:

```
/knowledge/              notes, MOCs
  /knowledge/notes/      bai/knowledge-note
  /knowledge/inbox/      unprocessed captures
  /knowledge/insights/   synthesized insights
/sources/                bai/source — nested folders group a book's chapters
/projects/               powerhouse/scopeofwork + bai/wbs
/ops/                    operational coordination
  /ops/sessions/         session transcripts
  /ops/health/           bai/health-report (singleton)
  /ops/queue/            bai/pipeline-queue (singleton)
/self/                   system identity & config
  /self/methodology/     methodology notes — bai/vault-config (singleton) sits at /self/
```

Placement of everything created over HTTP follows the document type, and no client chooses a folder:

| Folder | Document Types |
|--------|---------------|
| `/sources` | `bai/source` (a `parentFolder` may name a subfolder of it, and nothing else) |
| `/knowledge/notes` | `bai/knowledge-note` |
| `/knowledge` | `bai/moc` |
| `/projects` | `powerhouse/scopeofwork`, `bai/wbs` |
| `/ops` | `bai/tension`, `bai/observation` |

`bai/research-claim` is created under `research` by the app's create dialog; `bai/derivation` has no folder rule of its own. Both are outside the HTTP creation path.

The folder *rule* lives in `subgraphs/http/lib/vault-folders.ts`; the folder **id** is never hardcoded, because ids differ per drive and this package serves several. A create whose target folder is missing fails `400 FOLDER_UNRESOLVED` having created nothing — it never falls back to the drive root, because a document at the root is invisible to the pipeline and to the app's folder views.

## Repository Layout

| Path | Contents |
|------|----------|
| `document-models/` | One directory per model: `gen/` (generated) + `src/reducers/` (hand-written) |
| `editors/` | The drive-app, eleven document editors, `shared/` building blocks |
| `processors/graph-indexer/` | Projection, migrations, embedder, query helpers, automation |
| `subgraphs/` | `knowledge-graph`, `access`, `http` |
| `scripts/` | `atlas-sync/`, `drive-sync/`, `lead-import/`, `reactor-repair/`, plus `check-index-drift.mjs`, `repair-ordinal-gap.mjs`, `repair-read-model-checkpoint.mjs`, `fetch-model.mjs`, `copy-runtime-assets.mjs`, `cors-proxy.mjs`, `sync-opencode-agent.mjs` |
| `tests/` | `unit/`, `processor/`, `integration/`, `helpers/` |
| `docs/` | `http-api.md`, `plans/`, `superpowers/` (specs and plans), `upstream-bugs-*.md` |
| `docker/` | Switchboard and Connect container entrypoints |
| `backup-documents/` | `.phd` snapshots of every document model |

## Development

```bash
bun install

# Start Vetra Studio with live code generation
ph vetra --watch

# Type check
bun run tsc

# Lint (oxlint, type-aware)
bun run lint
bun run lint:fix

# Format (oxfmt)
bun run format

# Tests
bun run test            # vitest run
bun run test:coverage   # document model reducers must stay ≥ 95%

# Circular-import check
bun run check-circular-imports
```

After changing a document model, a new editor or a new subgraph: run `bun run tsc`, `bun run lint:fix` and `bun run test:coverage`. Reducers are pure synchronous functions and are held at or above 95% coverage on lines, branches, functions and statements — lower the threshold or exclude files is not an option; add tests in `document-models/<name>/v<n>/tests/`.

### Subgraph Endpoint Configuration

The Search tab and other editor features that query the Knowledge Graph subgraph need to reach the reactor's GraphQL endpoint. The endpoint is resolved automatically in most cases (`editors/knowledge-vault/hooks/subgraph-endpoint.ts`):

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

### Vault Authorization

The package declares five config vars (`powerhouse.manifest.json`), which a deployment must set:

| Var | Meaning |
|-----|---------|
| `AUTH_ENABLED` | Verify Renown bearer tokens and resolve the caller's identity |
| `ADMINS` | Comma-separated addresses that bypass every permission check (give it at least two) |
| `DOCUMENT_PERMISSIONS_ENABLED` | Enable per-document READ/WRITE/ADMIN grants; runs the permission migrations at boot |
| `DEFAULT_PROTECTION` | Documents are protected by default and need an explicit grant |
| `REQUIRE_AUTHENTICATED_CALLER` | Reject anonymous GraphQL callers with 401 before any resolver runs (needs `AUTH_ENABLED=true`) |

## Graph View

The knowledge graph visualization uses `cytoscape-fcose` (force-directed layout) with semantic clustering:

- **MOC hubs** act as cluster anchors with higher repulsion, pulling their CORE_IDEA-linked notes into visible topic neighborhoods
- **Cross-cluster edges** have weak elasticity and long ideal lengths, preventing topic groups from collapsing together
- **Position persistence** via localStorage — positions survive tab switches and page reloads. New nodes are placed by fcose while existing nodes stay pinned
- **MOC group drag** — dragging a MOC diamond moves its entire cluster of connected notes
- **Re-layout button** clears cached positions and recomputes a fresh layout

`GraphViewPixi.tsx` is the large-graph renderer alongside the cytoscape view.

## Chat: choose where the model runs

The vault's chat is a read-only agent over the graph index. Which model answers is up to you; the connect screen offers three routes, all stored only in your browser:

| Route | When | How |
|-------|------|-----|
| **OpenRouter** | You want hosted models with a free tier | Sign in (browser OAuth) or paste a key. Tool-capable models are listed live; free ones are picked by default. |
| **Your own endpoint** | You run Ollama, LM Studio, vLLM, llama.cpp, or a gateway | Enter the base URL (`http://localhost:11434/v1`), an API key if the server needs one, and optionally a model id. The vault probes `/models`, lets you pick, and talks to `/chat/completions`. |
| **Connect's AI settings** | Your Connect has *Settings → AI assistant* configured | One click reuses that endpoint and model. Choosing a different model turns it into a vault-owned endpoint; Connect's settings are left untouched. |

Because the browser calls the server directly, a local server must allow the Connect origin: Ollama `OLLAMA_ORIGINS="http://localhost:3000"` (or your Connect URL), LM Studio "enable CORS" in the server tab, vLLM/llama.cpp their CORS flag. The model must support tool calling; the vault's tools are how it reads anything.

### What the chat can ask the vault

Sixteen read-only tools: thirteen over the vault, three reaching outside it.

| Tool | Answers |
|------|---------|
| `search_vault` | The default entry point. Semantic search over notes, MOCs, tensions, observations, scopes and work breakdowns — ranked `hits`, the `related` neighbourhood one link out, and `contested` (any hit another note CONTRADICTS or SUPERSEDES). Read `contested` first: a disputed hit answered alone is wrong, not thin. Does not search sources |
| `read_note` | One note's full text, by document id |
| `related_notes` / `linked_notes` | Semantic neighbours / every edge of one specific note |
| `list_topics` / `notes_by_topic` | The topic vocabulary with counts / notes under a topic |
| `list_documents` / `read_document` | Membership and content for document types the index does not hold (sources, the queue, the health report, the config) |
| `list_projects` | The vault's scopes of work |
| `vault_stats` | Counts across the vault — notes, MOCs, edges, orphans, tensions |
| `recent_changes` | *Which* documents changed and when — every type, newest first, optionally narrowed by `documentType` or `since`. Membership comes from the drive tree, times from the reactor's `lastModifiedAtUtcIso`, human titles from the graph index |
| `document_history` | *Who* changed one document, when, and *what* — the newest operations with the signing address, the app used, and a phrase per change (the same vocabulary the Activity view shows). Works for every document type |
| `vault_editors` | Who edits the vault, ranked: ENS name, address, apps, documents touched, last active. Grouped by person, so one address editing through two apps is one editor, and it reports how many operations carry no signature at all |
| `search_web` | A ranked result list for a query. Uses [Tavily](https://tavily.com) when this browser has a key stored (`bai-chat-web:v1` → `{"tavilyKey":"tvly-…"}`), otherwise DuckDuckGo's results read through [r.jina.ai](https://jina.ai/reader) — no key, no account |
| `read_url` | The text of one public page, including plain JSON when the address is an API. Private and loopback addresses are refused. A 404 or an empty shell comes back flagged, so a missing page cannot read as an answer |
| `ens_lookup` | An Ethereum address ↔ its ENS name, through `api.ensdata.net` — the same service the vault's signer badges use, so the chat and the UI never disagree (`api.ensideas.com` stands behind it when that rate-limits) |

"Who made the last change in the vault?" is two chained: `recent_changes` for the document, `document_history` for the person.

`document_history` and `vault_editors` resolve ENS themselves, so a person is named `liberuum.eth (0xadbA…BcA4)` rather than as a bare address.

Only DuckDuckGo survives a browser-side fetch among the keyless engines (Bing, Mojeek, Startpage, Brave and Ecosia all block the reader with 403/422/Cloudflare, and Marginalia's search page returns its syntax help). A Tavily key is the way to better results.

The vault is answered from the vault first. A web result is never cited as `[[documentId]]` — the model cites it as a markdown link — and page text is treated as untrusted input exactly like note content. Queries and the addresses read leave the browser for whichever service serves them, which is why the keyless path is a public reader rather than anything of ours.

The chat has no shell or code-execution tool, and will not get one: it reads note and web text that anyone can write, and a tool that executes would turn any of that text into a way to run commands on the reader's machine.

## Connect's AI assistant can read the vault

Connect's built-in assistant (reactor-browser `ai`, Sept 2026 onwards) merges every installed package's `aiTools` export into its tool set. This package exports its thirteen vault read tools (`editors/knowledge-vault/lib/chat/ai-tools.ts`), typed after `PhAiToolDescriptor` and flagged `readOnlyHint`, so asking Connect's assistant "what does the vault say about X" runs the vault's search and returns cited notes without approval prompts. Calls default to the drive you have open; pass `driveId` to read another vault. Unlike the vault's own chat, the web tools are not exported. Older Connect versions ignore the export.

## License

AGPL-3.0-only
