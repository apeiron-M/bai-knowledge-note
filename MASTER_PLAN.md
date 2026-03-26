# Knowledge Vault Master Plan

## Vision

Build a complete, production-grade knowledge management platform on Powerhouse document models. The system has three layers: **document models** (data), **processor + subgraph** (server-side sync & API), and a **Claude Code plugin** (AI agent integration). Humans interact via the Knowledge Vault app and editors in Connect. AI agents interact via MCP tools backed by the subgraph API.

Based on the [Ars Contexta Remote Knowledge Base Specification](arscontexta-remote-knowledge-base.md).

---

## Current Status (2026-03-26)

### Document Models — 11 total, ALL DONE

| # | Model ID | Name | Operations | Purpose | Location |
|---|----------|------|-----------|---------|----------|
| 1 | `bai/knowledge-note` | KnowledgeNote | 26 ops, 5 modules | Atomic knowledge claim | `document-models/knowledge-note/v1/` |
| 2 | `bai/knowledge-graph` | KnowledgeGraph | 7 ops, 3 modules | Materialized graph (nodes + edges) | `document-models/knowledge-graph/v1/` |
| 3 | `bai/moc` | Moc | 12 ops, 1 module | Map of Content — navigation + synthesis | `document-models/moc/v1/` |
| 4 | `bai/source` | Source | 4 ops, 1 module | Ingested source material | `document-models/source/v1/` |
| 5 | `bai/pipeline-queue` | PipelineQueue | 7 ops, 1 module | Processing pipeline state (singleton) | `document-models/pipeline-queue/v1/` |
| 6 | `bai/observation` | Observation | 4 ops, 1 module | Operational learning signal | `document-models/observation/v1/` |
| 7 | `bai/tension` | Tension | 4 ops, 1 module | Unresolved contradiction | `document-models/tension/v1/` |
| 8 | `bai/vault-config` | VaultConfig | 8 ops, 1 module | Live vault configuration (singleton) | `document-models/vault-config/v1/` |
| 9 | `bai/derivation` | Derivation | 4 ops, 1 module | Derivation audit trail (singleton) | `document-models/derivation/v1/` |
| 10 | `bai/health-report` | HealthReport | 2 ops, 1 module | Vault diagnostics | `document-models/health-report/v1/` |
| 11 | `bai/research-claim` | ResearchClaim | 4 ops, 1 module | Bundled research (249 claims) | `document-models/research-claim/v1/` |

**Total: ~82 operations, 34 test files, 133 tests passing**

### Editors — 3 DONE

| Editor | Type | Document Types | Location |
|--------|------|---------------|----------|
| KnowledgeNoteEditor | Document editor | `bai/knowledge-note` | `editors/knowledge-note-editor/` |
| KnowledgeGraphEditor | Document editor | `bai/knowledge-graph` | `editors/knowledge-graph-editor/` |
| KnowledgeVault | Drive app | `bai/knowledge-note`, `bai/knowledge-graph` | `editors/knowledge-vault/` |

### Processor — DONE

| Processor | Watches | Writes to | Location |
|-----------|---------|-----------|----------|
| GraphIndexerProcessor | `bai/knowledge-note` ops | `graph_nodes` + `graph_edges` tables | `processors/graph-indexer/` |

Uses **resultingState reconciliation** pattern from recipes repo: deduplicates operations per document, reads full state, upserts node, reconciles edges. Handles DELETE_DOCUMENT with cascade.

### Subgraph — DONE

| Subgraph | Queries | Location |
|----------|---------|----------|
| KnowledgeGraphSubgraph | nodes, edges, stats, orphans, connections (BFS) | `subgraphs/knowledge-graph/` |

Extends `BaseSubgraph` from `@powerhousedao/reactor-api`. Uses `GraphIndexerProcessor.query()` for namespaced DB access.

### Plugin — DONE

| Plugin | Skills | Location |
|--------|--------|----------|
| powerhouse-knowledge | 7 skills + 1 agent | `/home/p/Powerhouse/powerhouse-knowledge/` |

Skills: search, extract, connect, verify, health, graph, seed. MCP-backed agent with pipeline awareness.

### Infrastructure — DONE

| Component | Status |
|-----------|--------|
| Package.json (dev105) | Done |
| CLAUDE.md | Done |
| Dark theme (Catppuccin Mocha) | Done — editor, vault app, revision history |
| DocumentToolbar styling guide | Done — `DocumentToolbarStyling.md` |
| Bun as package manager | Done |

---

## What Remains

### Phase E: Integrate New Doc Models into Knowledge Vault App

The vault app currently only shows `bai/knowledge-note` documents. It needs updating to support all 11 doc types.

**E1. MOC Navigation Sidebar**
- Replace status-grouped note list with MOC hierarchy tree (Hub → Domain → Topic)
- Each MOC shows its core ideas as child nodes
- Click MOC to see its detail view with orientation, tensions, open questions

**E2. Source Inbox Tab**
- New tab alongside Notes and Graph: "Sources"
- Shows `bai/source` documents grouped by status (INBOX, EXTRACTING, EXTRACTED)
- "Ingest Source" button to create new source docs

**E3. Pipeline Dashboard Tab**
- New tab: "Pipeline"
- Shows `bai/pipeline-queue` singleton with tasks by phase/status
- Visual pipeline progress (extract → reflect → reweave → verify)
- Task assignment and status updates

**E4. Observations & Tensions Panel**
- Collapsible panel showing pending observations and open tensions
- Quick capture buttons for new observations/tensions
- Promote observation → creates knowledge note

**E5. Health Dashboard Tab**
- Shows latest `bai/health-report` document
- Graph metrics visualization (density, orphans, MOC coverage)
- Recommendations list with action buttons

**E6. Vault Configuration Editor**
- New document editor for `bai/vault-config`
- 8 dimension sliders (granularity, organization, linking, etc.)
- Vocabulary mapper table
- Feature toggle switches
- Pipeline config form
- Maintenance threshold inputs

**E7. Drive Folder Organization**
- Auto-create folder structure on drive init:
  - `/knowledge/` — notes + MOCs
  - `/sources/` — source documents
  - `/operations/` — pipeline-queue, health-reports, observations, tensions
  - `/system/` — vault-config, derivation
  - `/research/` — research claims

**E8. Update Vault App Config**
- Add all doc types to `allowedDocumentTypes` in config.ts
- Update processor filter to watch new doc types
- Update subgraph to expose new doc type queries

### Phase F: Enhanced Subgraph Queries

Extend the GraphQL API with queries from the Ars Contexta spec:

```graphql
# Note queries
searchNotes(query: String!, limit: Int): [NoteResult!]!
notesByKind(kind: NoteKind!): [NoteResult!]!
notesByStatus(status: NoteStatus!): [NoteResult!]!
backlinks(noteId: PHID!): [NoteResult!]!

# Graph analysis
triangles(limit: Int): [Triangle!]!
bridges: [NoteResult!]!
density: Float!

# MOC queries
mocsByTier(tier: MocTier!): [MocResult!]!
mocNotes(mocId: PHID!): [NoteResult!]!

# Pipeline queries
queueStatus: QueueSummary!
tasksByPhase(phase: String!): [TaskResult!]!

# Health queries
latestHealth: HealthSummary!

# Traversal
traverseForward(noteId: PHID!, depth: Int!): [TraversalNode!]!
traverseBackward(noteId: PHID!, depth: Int!): [TraversalNode!]!
```

### Phase G: Migration Tooling

**G1. Import Script Updates**
- Update `scripts/import-vault.mjs` to create MOCs alongside notes
- Extract wiki links as typed connections with context phrases
- Create pipeline-queue singleton on import
- Organize into folder structure

**G2. Research Claim Population**
- Import 249 research claims from Ars Contexta methodology directory
- Create research claim documents with full content and connections
- Populate `/research/` folder

### Phase H: Production Deployment

**H1. Publish npm Package**
- Publish `knowledge-note` package to npm
- Add to remote reactor's packages config
- Re-import data to production drive

**H2. Plugin Distribution**
- Publish `powerhouse-knowledge` to GitHub
- Submit to Claude Code marketplace
- Document installation and configuration

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────┐
│                    HUMAN INTERFACE                       │
│                                                         │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │ Knowledge   │  │ Note Editor  │  │ Graph Editor  │  │
│  │ Vault App   │  │ (dark theme) │  │ (sync + viz)  │  │
│  └──────┬──────┘  └──────┬───────┘  └──────┬────────┘  │
│         │                │                  │           │
│         └────────────────┼──────────────────┘           │
│                          │                              │
└──────────────────────────┼──────────────────────────────┘
                           │
                    ┌──────┴──────┐
                    │   Connect   │
                    │   (React)   │
                    └──────┬──────┘
                           │
┌──────────────────────────┼──────────────────────────────┐
│                    POWERHOUSE REACTOR                    │
│                                                         │
│  ┌─────────────────────────────────────────────────┐    │
│  │              11 Document Models                  │    │
│  │  knowledge-note | knowledge-graph | moc          │    │
│  │  source | pipeline-queue | observation           │    │
│  │  tension | vault-config | derivation             │    │
│  │  health-report | research-claim                  │    │
│  └─────────────────────┬───────────────────────────┘    │
│                        │                                │
│  ┌─────────────────────┼───────────────────────────┐    │
│  │  GraphIndexerProcessor                          │    │
│  │  (watches note ops → updates relational DB)     │    │
│  └─────────────────────┬───────────────────────────┘    │
│                        │                                │
│  ┌─────────────────────┼───────────────────────────┐    │
│  │  KnowledgeGraphSubgraph                         │    │
│  │  (GraphQL API: nodes, edges, stats, orphans)    │    │
│  └─────────────────────┬───────────────────────────┘    │
│                        │                                │
│  ┌─────────────────────┼───────────────────────────┐    │
│  │  MCP Server (localhost:4001/mcp)                │    │
│  │  + WebSocket (localhost:4001/graphql/subscriptions) │ │
│  └─────────────────────┬───────────────────────────┘    │
│                        │                                │
└────────────────────────┼────────────────────────────────┘
                         │
┌────────────────────────┼────────────────────────────────┐
│                   AI AGENT INTERFACE                     │
│                                                         │
│  ┌─────────────────────────────────────────────────┐    │
│  │  powerhouse-knowledge plugin                    │    │
│  │  7 skills: search, extract, connect, verify,    │    │
│  │           health, graph, seed                   │    │
│  │  1 agent: knowledge-agent (Opus)                │    │
│  │  MCP → reactor-mcp                              │    │
│  └─────────────────────────────────────────────────┘    │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

## Processing Pipeline (The 6 Rs)

```
Source Material
      │
      ▼
  1. RECORD (/seed)
      │ Creates bai/source + pipeline task
      ▼
  2. REDUCE (/extract)
      │ Extracts bai/knowledge-note claims
      ▼
  3. REFLECT (/connect)
      │ Finds connections, updates MOCs
      ▼
  4. REWEAVE (backward connections)
      │ Updates older notes with new context
      ▼
  5. VERIFY (/verify)
      │ Recite test + schema + health check
      ▼
  6. RETHINK (/reassess)
      │ Challenge assumptions against evidence
      ▼
  Canonical Knowledge Graph
```

Each phase advances `bai/pipeline-queue` tasks via ADVANCE_PHASE operations.

## Key Reference Files

| Purpose | File |
|---------|------|
| Ars Contexta full spec | `arscontexta-remote-knowledge-base.md` |
| Processor patterns | `/home/p/Powerhouse/recipes/relational-db-subgraph/src/` |
| Subgraph patterns | `/home/p/Powerhouse/recipes/audit-trail/src/subgraph.ts` |
| BaseSubgraph type | `node_modules/@powerhousedao/reactor-api/dist/src/graphql/base-subgraph.d.ts` |
| OperationWithContext | `node_modules/@powerhousedao/shared/dist/document-model/core/operations.d.ts` |
| Plugin | `/home/p/Powerhouse/powerhouse-knowledge/` |
| Ars Contexta local plugin | `/home/p/Powerhouse/arscontexta/` |
| Toolbar styling guide | `DocumentToolbarStyling.md` |

## Quality Metrics

- **TypeScript**: Zero errors (`bun run tsc`)
- **Build**: Clean (`bun run build`)
- **Tests**: 133/133 passing across 34 test files
- **Lint**: Zero errors in project code (warnings only in gen/ files)
