# Knowledge Vault Master Plan

## Vision

Build a complete, production-grade knowledge management platform on Powerhouse document models. The system has three layers: **document models** (data), **processor + subgraph** (server-side sync & API), and a **Claude Code plugin** (AI agent integration). Humans interact via the Knowledge Vault app and editors in Connect. AI agents interact via MCP tools backed by the subgraph API.

Based on the [Ars Contexta Remote Knowledge Base Specification](arscontexta-remote-knowledge-base.md).

---

## Status: 2026-03-26

### DONE

| Component | Details |
|-----------|---------|
| **11 Document Models** | knowledge-note (26 ops), knowledge-graph (7), moc (12), source (4), pipeline-queue (7), observation (4), tension (4), vault-config (8), derivation (4), health-report (2), research-claim (4) — 82 ops total |
| **8 Editors** | knowledge-note, knowledge-graph, moc, source, pipeline-queue, observation, vault-config + Knowledge Vault drive app — all dark-themed Catppuccin Mocha |
| **Graph Indexer Processor** | Watches `bai/knowledge-note` ops via `onOperations`, uses resultingState reconciliation, `startFrom: "beginning"` for replay, imports from `@powerhousedao/shared/processors` |
| **Knowledge Graph Subgraph** | 9 GraphQL queries (nodes, edges, stats, orphans, connections, backlinks, density, nodesByStatus, debug). Uses `GraphIndexerProcessor.query(driveId, db)` for namespaced access |
| **Claude Code Plugin** | 11 skills (search, extract, connect, verify, health, graph, seed, pipeline, watch, import, export) + knowledge-agent + CONFIGURATION.md |
| **Vault App** | 6 tabs (Notes, Graph, Sources, Pipeline→editor, Health→live, Config→editor), folder tree sidebar, create dialog with folder placement, auto-init drive structure |
| **Drive Auto-Init** | Nested Ars Contexta folder structure (/knowledge/notes, /sources, /ops/queue, /self, /research) + 3 singletons (PipelineQueue, KnowledgeGraph, VaultConfig) |
| **Health Dashboard** | Live-computed metrics from all docs, 7 check categories, actionable buttons (click note name → opens editor) |
| **Dark Theme** | All editors + revision history via CSS scoped to `data-document-type^="bai/"` |
| **Tests** | 184 tests across 35 files: reducer state mutations, lifecycle state machine, pipeline queue, graph DB operations, query layer (orphans/BFS/density), integration |
| **Documentation** | MASTER_PLAN.md, USER_GUIDE.md, DocumentToolbarStyling.md, CONFIGURATION.md |

### Key Patterns Learned

| Pattern | Details |
|---------|---------|
| **MCP createDocument** | Use `driveId` (UUID, never slug) + `parentFolder` (UUID) for correct folder placement. Works for knowledge-note. Source/other types: create with driveId (no parentFolder) → lands at root → DELETE_NODE + ADD_FILE to move to folder |
| **Processor imports** | Use `@powerhousedao/shared/processors` for `RelationalDbProcessor`, `ProcessorFilter`, `IRelationalDb`. Use `@powerhousedao/shared/document-model` for `OperationWithContext` |
| **Processor factory** | Must be synchronous (not async). Returns async inner function. Call `initAndUpgrade()` in factory. Add `startFrom: "beginning"` |
| **Subgraph queries** | Use `GraphIndexerProcessor.query(driveId, db as any)` for namespaced DB access (not `withSchema`) |
| **GraphQL mutations** | Need `timestampUtcMs` as ISO string on each action |
| **Drive hooks** | Use `useSelectedDriveId()` in React components (Connect handles routing). Use `useSelectedDrive()[0].header.id` only in hooks that call `addDocument`/`addFolder` |

---

## What Remains

### Phase F: Enhanced Subgraph Queries (Partial)

Done:
- `knowledgeGraphNodesByStatus`, `knowledgeGraphBacklinks`, `knowledgeGraphDensity`, `knowledgeGraphDebug`

Still needed:
- `searchNotes(query, limit)` — full-text search across titles/descriptions
- `triangles(limit)` — find synthesis opportunities (A→C, B→C, A-/→B)
- `bridges` — critical nodes whose removal disconnects the graph
- `mocsByTier(tier)` — MOCs grouped by hub/domain/topic
- `traverseForward/Backward(noteId, depth)` — N-hop traversal
- `queueStatus` — pipeline task summary

### Phase G: Migration Tooling

**G1. Import Script Updates**
- Update `scripts/import-vault.mjs` for new folder structure
- Two-pass: create docs → resolve wiki links as typed connections
- Create MOCs from folder/tag structure
- Use the proven create+move pattern for folder placement

**G2. Research Claim Population**
- Import 249 research claims from `/home/p/Powerhouse/arscontexta/` methodology directory
- Create `bai/research-claim` documents in `/research/` folder
- Resolve inter-claim connections

### Phase H: Production Deployment

**H1. Publish npm Package**
- Publish `knowledge-note` to npm
- Deploy to remote reactor
- Re-import vault data

**H2. Plugin Distribution**
- Push `powerhouse-knowledge` to GitHub repo
- Submit to Claude Code marketplace
- Write installation guide

### Known Issues

| Issue | Severity | Workaround |
|-------|----------|------------|
| MCP `createDocument` with `parentFolder` fails silently for some doc types (source, observation) | Medium | Create at root → DELETE_NODE + ADD_FILE to move |
| Codegen generates `KnowledgeNote_Local_State` (wrong type name) in `gen/local/operations.ts` | Low | Manual fix after each `ph generate` |
| Graph View auto-sync fingerprint only checks note count/titles/links — misses content changes | Low | Manual refresh or open Graph tab |
| Source docs created via MCP before server restart become orphan children (relationship exists but no file node) | Medium | Create standalone → ADD_FILE on drive, or use switchboard CLI |

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    HUMAN INTERFACE                       │
│                                                         │
│  Knowledge Vault App (6 tabs)                           │
│  ├── Notes (card grid)                                  │
│  ├── Graph (Cytoscape force-directed)                   │
│  ├── Sources (grouped by status)                        │
│  ├── Pipeline → opens PipelineQueue editor              │
│  ├── Health (live metrics + actionable buttons)         │
│  └── Config → opens VaultConfig editor                  │
│                                                         │
│  8 Document Editors (dark theme)                        │
│  Sidebar: Notes | MOCs | Signals | Folder Tree          │
│  Create Dialog with folder placement                    │
└─────────────────────────────────────────────────────────┘
                           │
┌──────────────────────────┼──────────────────────────────┐
│                    POWERHOUSE REACTOR                    │
│                                                         │
│  11 Document Models (82 operations)                     │
│  GraphIndexer Processor (PGlite relational DB)          │
│  KnowledgeGraph Subgraph (9 GraphQL queries)            │
│  MCP Server (localhost:4001/mcp)                        │
│  WebSocket (localhost:4001/graphql/subscriptions)        │
│  Drive REST (localhost:4001/d/<slug>)                   │
└─────────────────────────────────────────────────────────┘
                           │
┌──────────────────────────┼──────────────────────────────┐
│                   AI AGENT INTERFACE                     │
│                                                         │
│  powerhouse-knowledge plugin (11 skills + agent)        │
│  ├── Core: search, extract, connect, verify,            │
│  │         health, graph, seed                          │
│  ├── Automation: pipeline, watch, import, export        │
│  └── Connection: MCP (default) + WebSocket (real-time)  │
└─────────────────────────────────────────────────────────┘
```

## Processing Pipeline

```
Source → SEED → EXTRACT claims → CONNECT to graph → REWEAVE older notes → VERIFY quality
              ↓                    ↓                    ↓                    ↓
         bai/source           bai/knowledge-note    ADD_LINK ops       RECORD_VERIFICATION
         INGEST_SOURCE        SET_TITLE/CONTENT     (typed links)      (recite+schema+health)
              ↓                    ↓                    ↓                    ↓
         Pipeline Queue tracks each phase via ADVANCE_PHASE with handoff data
```

## Quality Metrics

- **TypeScript**: Zero errors
- **Build**: Clean (`bun run build`)
- **Tests**: 184 passing across 35 files (34 passed, 1 skipped)
- **Processor**: Live-indexing via `onOperations` with resultingState reconciliation
- **Subgraph**: 9 GraphQL queries including debug endpoint
