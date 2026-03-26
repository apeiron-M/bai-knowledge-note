# Ars Contexta Remote Knowledge Base — Specification

## Built on Powerhouse Document Models

**Version:** 0.1.0-draft
**Date:** 2026-03-26
**Status:** Proposal

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [What Is Ars Contexta](#2-what-is-ars-contexta)
3. [How Ars Contexta Operates](#3-how-ars-contexta-operates)
4. [Architecture: Local System to Remote Platform](#4-architecture-local-system-to-remote-platform)
5. [Document Model Design](#5-document-model-design)
6. [Multi-User Collaboration Model](#6-multi-user-collaboration-model)
7. [Processing Pipeline as Operations](#7-processing-pipeline-as-operations)
8. [Graph Query Layer](#8-graph-query-layer)
9. [Editor Specifications](#9-editor-specifications)
10. [Subgraph API Design](#10-subgraph-api-design)
11. [Migration Path](#11-migration-path)
12. [Implementation Phases](#12-implementation-phases)

---

## 1. Executive Summary

Ars Contexta is a knowledge management system that generates cognitive architectures for AI agents. Today it runs as a **local filesystem-based graph database** — markdown files are nodes, wiki links are edges, YAML frontmatter is the property store, and ripgrep is the query engine.

This spec proposes rebuilding Ars Contexta as a **remote, multi-user knowledge platform** using Powerhouse document models. Every concept — notes, MOCs, observations, tensions, the processing queue, the derivation system — becomes a document type with typed operations, deterministic reducers, and sync-capable state. Multiple users with different roles (researcher, curator, reviewer, consumer) can interact with the same knowledge graph through a shared Powerhouse drive.

### Why Powerhouse Document Models

| Local Filesystem (Current) | Powerhouse Document Models (Proposed) |
|---|---|
| Single user, single machine | Multi-user, remote-first, sync-capable |
| Git for history | Operation log with cryptographic hashing |
| ripgrep for queries | GraphQL subgraph API |
| Bash scripts for graph analysis | Typed reducers + computed graph metrics |
| No access control | Role-based scopes (global/local state) |
| No schema enforcement at runtime | Zod validation on every operation |
| File conflicts on concurrent edits | Conflict-free operation merging |
| Manual backups | Drive-level replication |

### What This Enables

- **Shared knowledge graphs** — teams build and traverse a common knowledge base
- **Role-based contribution** — researchers extract, curators connect, reviewers verify
- **Canonical source of truth** — one drive holds the authoritative graph, consumers subscribe
- **API-first** — subgraphs expose the knowledge graph as a queryable GraphQL endpoint
- **Processing pipeline as operations** — every phase (extract, connect, reweave, verify) is a typed state transition with full audit trail
- **Cross-vault linking** — documents in different drives can reference each other via PHID

---

## 2. What Is Ars Contexta

### 2.1 Core Philosophy

The name connects to a tradition. **Ars Combinatoria** (Llull's rotating wheels), **Ars Memoria** (Bruno's memory palaces), **Ars Contexta**: the art of context. These were external thinking systems — tools to think with, not just store in. The missing piece: they required a human mind to traverse. Now LLMs can traverse. The wheels can spin again.

Ars Contexta generates **agent-native knowledge systems** from conversation. You describe how you think and work. The engine derives a cognitive architecture — folder structure, context files, processing pipeline, hooks, navigation maps, and note templates — tailored to your domain and backed by **249 interconnected research claims**.

### 2.2 The Derivation Engine

Unlike template-based tools, Ars Contexta uses **derivation, not templating**. Every configuration choice traces to specific research claims through an 8-dimension parameter space:

| Dimension | Spectrum | What It Controls |
|---|---|---|
| **Granularity** | Atomic <-> Coarse | Note size, extraction depth, reweaving scope |
| **Organization** | Flat <-> Hierarchical | Folder structure, MOC tier count, navigation paths |
| **Linking** | Implicit <-> Explicit | Connection discovery method (semantic vs manual) |
| **Processing** | Minimal <-> Intense | Extraction selectivity, connection density, reweaving frequency |
| **Navigation** | Linear <-> 3-Tier | MOC structure (hub -> domains -> topics) |
| **Maintenance** | Manual <-> Condition-based | When health checks trigger, when reweaving happens |
| **Schema** | Convention <-> Dense | Required fields, enum validation, template rigor |
| **Automation** | Manual <-> Full | Which hooks are active, pipeline automation level |

The derivation system has three layers:
- **`config.yaml`** — the "what" (current settings)
- **`derivation.md`** — the "why" (reasoning and rationale for each choice, with confidence scores)
- **`derivation-manifest.md`** — the "how" (vocabulary mapping, active feature blocks, platform hints)

### 2.3 The 15 Kernel Primitives

Every Ars Contexta system includes these invariants, regardless of configuration:

| # | Primitive | Layer | What It Enables |
|---|---|---|---|
| 1 | **Markdown + YAML frontmatter** | Foundation | Plain text graph database — the file IS the artifact |
| 2 | **Wiki links as graph edges** | Foundation | `[[note title]]` creates navigable relationships via spreading activation |
| 3 | **Filesystem graph database** | Foundation | Nodes (files), edges (wiki links), properties (YAML), queries (ripgrep) |
| 4 | **MOC hierarchy** | Convention | Hub -> domain -> topic -> notes. Attention management, not just organization |
| 5 | **Tree injection** | Convention | Agent sees full structure immediately. Orientation before action |
| 6 | **Description field** | Convention | ~150 char progressive disclosure. Filter-before-read |
| 7 | **Topics footer** | Convention | Bidirectional MOC navigation. Notes declare MOC membership |
| 8 | **Schema enforcement** | Convention | Templates define required fields. Validation catches what instruction-following misses |
| 9 | **Self space** | Convention | Agent persistent mind: identity, methodology, goals |
| 10 | **Session rhythm** | Convention | Orient -> Work -> Persist cycle. Prevents cold starts and attention residue |
| 11 | **Semantic search** | Automation | Meaning-based discovery across vocabularies. Complements structural navigation |
| 12 | **Discovery-first design** | Convention | Everything optimized for future agent findability |
| 13 | **Operational learning loop** | Convention | Observations + tensions accumulate, threshold triggers review, system evolves |
| 14 | **Task stack** | Convention | Lifecycle backbone. Every note flows through a task state |
| 15 | **Session capture** | Automation | Every session transcript saved. Friction detection on transcripts |

These primitives form a dependency DAG:

```
markdown-yaml --> description-field --> discovery-first
            \--> topics-footer --------/
            \--> schema-enforcement --> operational-learning-loop --> methodology-folder
            \--> self-space                                     \--> session-capture
            \--> session-rhythm --> task-stack
                                \--> session-capture
wiki-links --> moc-hierarchy --> topics-footer
          \--> semantic-search
          \--> unique-addresses (filesystem graph DB)
tree-injection (standalone)
```

### 2.4 Three-Space Architecture

Every system separates content into three spaces with fundamentally different durability profiles:

| Space | Purpose | Growth | Load Pattern | Durability |
|---|---|---|---|---|
| **self/** | Agent persistent mind — identity, methodology, goals | Slow (tens of files) | Full load at session start | Permanent |
| **notes/** | Knowledge graph — the reason the system exists | Steady (10-50/week) | Progressive disclosure | Permanent |
| **ops/** | Operational coordination — queue, sessions, health | Fluctuating | Targeted reads | Temporal |

**Names adapt to domain vocabulary** (`notes/` might become `reflections/`, `claims/`, `decisions/`), but the three-space separation is invariant. Conflating any two spaces produces predictable failures (see Section 2.5).

#### Content Promotion Rule

Content moves from temporal to durable, never the reverse:
```
ops/observations/ -> notes/       (when observation proves durable)
ops/observations/ -> self/        (when observation is about agent operation)
ops/sessions/     -> self/memory/ (when session insight is significant)
```

#### Memory Type Routing

```
Is this about the agent itself?
|-- YES: Durable self-knowledge? -> self/  |  Temporal? -> ops/
|-- NO:  Domain knowledge?
    |-- YES: Durable + composable + worth finding? -> notes/
    |        Temporal? -> ops/observations/ (may promote later)
    |-- NO:  Operational coordination? -> ops/
```

### 2.5 Six Failure Modes of Space Conflation

| Conflation | What Breaks |
|---|---|
| **Ops into Notes** | Search returns processing debris alongside real knowledge. Note counts inflated with temporal content |
| **Self into Notes** | Schema confusion. Agent methodology mixed with domain insights. Search pollution |
| **Notes into Ops** | Insights trapped in session logs, never promoted. Knowledge doesn't compound |
| **Self into Ops** | Identity scattered across 50 session logs instead of curated files. Orientation fails |
| **Ops into Self** | Self/ becomes too large to load. Temporal state treated as identity |
| **Notes into Self** | Self/ bloats. Domain knowledge hidden from notes/ search |

### 2.6 The Research Knowledge Base

The `methodology/` directory contains **249 interconnected research claims** about tools for thought, knowledge management, and agent-native cognitive architecture. These claims synthesize:

- Zettelkasten, Cornell Note-Taking, Evergreen Notes, PARA, GTD
- Memory Palaces, Cognitive Science (extended mind, spreading activation, generation effect)
- Network Theory (small-world topology, betweenness centrality)
- Agent Architecture (context windows, session boundaries, multi-agent patterns)

Each claim follows a standard format:

```yaml
---
description: <~150 char progressive disclosure summary>
kind: research
topics: ["[[moc-name]]", "[[moc-name]]"]
methodology: ["Cognitive Science", "Zettelkasten"]
source: [[source-reference]]
---

# <Prose-sentence title that makes one claim>

<400-1500 words of argumentative prose with inline [[wiki links]] to other claims>

---

Relevant Notes:
- [[other-claim]] -- <context phrase explaining the relationship>
```

Claims are organized into MOCs (Maps of Content) with this structure:

```markdown
---
description: <what this topic covers>
type: moc
---

# Topic Name

Brief orientation (2-3 sentences)

## Core Ideas
- [[claim title]] -- <context phrase: why this matters here>
- [[another claim]] -- <what this adds to the topic>

## Tensions
<Unresolved conflicts>

## Open Questions
<Unexplored directions>

---
Topics:
- [[parent-moc]]
```

### 2.7 The Processing Pipeline (The 6 Rs)

Extending Cornell Note-Taking's 5 Rs with a meta-cognitive layer:

| Phase | What Happens | Skill |
|---|---|---|
| **Record** | Zero-friction capture into inbox/ | Manual |
| **Reduce** | Extract atomic claims with domain-native categories | `/reduce` |
| **Reflect** | Find connections via dual discovery (MOC + semantic), update MOCs | `/reflect` |
| **Reweave** | Backward pass — update older notes with new context | `/reweave` |
| **Verify** | Cold-read prediction test + schema check + health check | `/verify` |
| **Rethink** | Challenge system assumptions against accumulated evidence | `/rethink` |

#### Phase Details

**REDUCE (Extract)**
- Scans source material for atomic claims using domain-specific extraction categories
- Categories customizable per domain (e.g., solutions, decisions, patterns, tensions, anti-patterns)
- Semantic search for duplicate detection (exact match + similarity)
- Comprehensive extraction: skip rate < 10% for domain-relevant sources
- Output: per-claim queue entry with `current_phase: create`

**REFLECT (Connect)**
- **Dual discovery**: MOC exploration (curated navigation) + semantic search (concept matching)
- Every connection must pass the **articulation test**: "[[A]] connects to [[B]] because [specific reason]"
- Updates MOC Core Ideas with context phrases
- Detects synthesis opportunities (when 2+ notes suggest a higher-order claim)

**REWEAVE (Revisit)**
- Backward pass: finds NEWER notes that should link to this older note
- Actions: add connections, rewrite prose, sharpen claims, split notes, challenge claims
- Answers: "if I wrote this note today with everything I now know, what would change?"

**VERIFY (Validate)**
- **Recite**: Cold-read prediction test — read title+description only, predict content, compare against actual
- **Validate**: Schema check (required fields, enum values, YAML integrity)
- **Review**: 5 health checks (frontmatter, description quality, MOC connection, link density >= 2, link resolution)

**RETHINK (Reassess)**
- Six-phase evidence-driven system evolution:
  1. Drift check (methodology notes vs config.yaml alignment)
  2. Triage (PROMOTE / IMPLEMENT / METHODOLOGY / ARCHIVE / KEEP PENDING)
  3. Methodology folder updates
  4. Pattern detection (recurring themes, contradiction clusters)
  5. Proposal generation (scope-limited by evidence strength)
  6. User approval (never auto-implements)

#### Fresh Context Per Phase

Each phase runs in its own context window via subagent spawning. LLM attention degrades as context fills. By spawning a fresh subagent per phase, every phase operates in the "smart zone."

```
/ralph 5
  |-- Read queue, find next unblocked task
  |-- Spawn subagent (fresh context)
  |   +-- Runs skill, updates task file, returns handoff
  |-- Parse handoff, capture learnings
  |-- Advance phase in queue
  +-- Repeat for 5 tasks
```

### 2.8 The Queue System

```yaml
schema_version: 3
phase_order:
  claim: [create, reflect, reweave, verify]
  enrichment: [enrich, reflect, reweave, verify]

tasks:
  - id: batch-id
    type: extract | claim | enrichment
    status: pending | done
    target: "claim title"
    batch: "source-batch-id"
    file: "batch-123.md"
    current_phase: null | phase_name
    completed_phases: []
```

State machine: after each phase, phase moves from `current_phase` to `completed_phases`, next phase becomes `current_phase`. Final phase marks `status: done`.

### 2.9 Vocabulary Transformation

The derivation-manifest enables complete domain vocabulary customization:

| Universal Term | Example Domain Terms |
|---|---|
| notes | insights, entities, concepts, reflections, decisions |
| inbox | journal, encounters, queue |
| reduce | distill, surface, break-down |
| reflect | connect, weave, synthesize |
| reweave | revisit, refresh, reconsider |
| topic_map | map, hub, network |
| description | summary, abstract, claim |

### 2.10 Maintenance Conditions

| Condition | Check | Threshold | Action |
|---|---|---|---|
| orphan_notes | Notes with zero incoming links | Any orphans | Run /reflect |
| dangling_links | `[[X]]` where X.md doesn't exist | Any dangling | Run /graph health |
| inbox_pressure | Unprocessed files count | > 5 items | /reduce |
| observation_accumulation | Pending observations | >= 10 | /rethink |
| tension_accumulation | Pending tensions | >= 5 | /rethink |
| moc_oversize | Linked notes per MOC | > 40 notes | Split MOC |
| stale_notes | Modified > 30d + < 2 links | > 10 notes | /reweave |

### 2.11 Quality Gates

| Anti-Pattern | Prevention Mechanism |
|---|---|
| **Collector's Fallacy** | Mandatory /reflect phase creates connections before moving on |
| **Temporal Staleness** | /reweave revisits older notes with new understanding |
| **Schema Erosion** | Mandatory /verify checks at pipeline end |
| **Orphan Drift** | Condition-based maintenance detects orphans |
| **Context Contamination** | /ralph mandates fresh subagent per phase |
| **Cognitive Outsourcing** | /next recommends but never executes; human decides |

---

## 3. How Ars Contexta Operates

### 3.1 Session Lifecycle

```
SESSION START (hook fires)
  |-- Inject workspace tree (full file structure)
  |-- Load self/ (identity, methodology, goals)
  |-- Check maintenance conditions (orphans, dangling, inbox pressure)
  |-- Surface reminders (ops/reminders.md)
  |
WORK PHASE
  |-- User initiates skill (/reduce, /reflect, etc.)
  |-- Skill reads ops/derivation-manifest.md (vocabulary + config)
  |-- Skill reads ops/config.yaml (processing depth)
  |-- Skill queries knowledge graph (ripgrep + semantic search + MOC traversal)
  |-- Skill writes results (new notes, updated MOCs, queue progression)
  |-- PostToolUse hook validates schema on every write
  |-- PostToolUse hook auto-commits to git
  |
SESSION END (hook fires)
  |-- Save session transcript to ops/sessions/
  |-- Update goals (self/goals.md or ops/goals.md)
  |-- Persist orientation state for next session
```

### 3.2 Knowledge Graph Query Patterns

**Level 1: Field-Level (Property queries)**
```bash
rg '^type: pattern' notes/           # Find all notes of specific type
rg '^description:.*friction' notes/  # Scan descriptions for keyword
rg '^topics:.*[[methodology]]' notes/ # Find notes by MOC membership
```

**Level 2: Node-Level (Neighborhood inspection)**
- Extract outgoing links from a note
- Find backlinks (what points to this note)
- Count connections per note

**Level 3: Graph-Level (Structural analysis)**
- **Triangles**: A->B, A->C but B-/->C — synthesis opportunities
- **Bridges**: Notes whose removal would disconnect the graph
- **Clusters**: Connected components (isolated topic groups)
- **Hubs**: Authority (high incoming) vs hub (high outgoing) scores
- **Density**: links / (N * (N-1)) — overall connectivity metric

### 3.3 Connection Finding (Dual Discovery)

When connecting a new note to the existing graph:

```
1. MOC Discovery (curated path):
   |-- Find MOCs that relate to the new note's topic
   |-- Browse Core Ideas in those MOCs
   |-- Identify candidates sharing a MOC

2. Semantic Discovery (meaning path):
   |-- Run semantic search for conceptually similar notes
   |-- Surface notes that share meaning but not keywords
   |-- Cross-vocabulary matching

3. Evaluation:
   |-- For each candidate: does it genuinely relate?
   |-- Articulation test: "[[A]] connects to [[B]] because [reason]"
   |-- If YES: add wiki links, update MOCs
   |-- If NO: skip (avoid noise)
```

### 3.4 Operational Learning Loop

```
CAPTURE
  |-- /remember captures friction (explicit, contextual, or session mining)
  |-- Creates atomic notes in ops/observations/ or ops/tensions/

ACCUMULATE
  |-- Observations: status pending -> promoted -> implemented -> archived
  |-- Tensions: status open -> resolved -> dissolved
  |-- Methodology notes: category (processing, capture, connection, maintenance, voice, behavior, quality)

REVIEW (triggered by thresholds)
  |-- /rethink triages accumulated evidence
  |-- Detects patterns (3+ notes in same category)
  |-- Generates proposals with evidence strength

EVOLVE (requires human approval)
  |-- Implement approved changes to config, context file, templates
  |-- Never auto-implements
```

---

## 4. Architecture: Local System to Remote Platform

### 4.1 Conceptual Mapping

| Ars Contexta (Local) | Powerhouse (Remote) |
|---|---|
| Markdown file | Document |
| Wiki link `[[title]]` | Document reference (PHID link) |
| YAML frontmatter | Document state (global scope) |
| File content (prose body) | Document state field (content) |
| Folder (notes/, ops/, self/) | Drive folder |
| ripgrep query | GraphQL subgraph query |
| Bash graph scripts | Processor / computed fields |
| Git history | Operation log with hashing |
| Local file system | Powerhouse Drive |
| Single user | Multi-user with roles |
| Processing queue (JSON) | Queue document with typed operations |
| Template `_schema` blocks | Document model schema (GraphQL) |
| Hook-based validation | Reducer-level validation + operation errors |

### 4.2 Drive Layout

```
Ars Contexta Drive (powerhouse/document-drive)
|
|-- /knowledge/                  # The knowledge graph (notes space)
|   |-- notes (type: arscontexta/note)
|   |-- mocs (type: arscontexta/moc)
|
|-- /sources/                    # Inbox + archive (ops space)
|   |-- source documents (type: arscontexta/source)
|
|-- /operations/                 # Operational coordination (ops space)
|   |-- pipeline queue (type: arscontexta/pipeline-queue)
|   |-- health reports (type: arscontexta/health-report)
|   |-- observations (type: arscontexta/observation)
|   |-- tensions (type: arscontexta/tension)
|
|-- /system/                     # System configuration (self space)
|   |-- vault config (type: arscontexta/vault-config)
|   |-- derivation record (type: arscontexta/derivation)
|   |-- methodology (type: arscontexta/methodology-note)
|
|-- /research/                   # Bundled research knowledge base
|   |-- research claims (type: arscontexta/research-claim)
|   |-- research mocs (type: arscontexta/moc)
```

### 4.3 Document Model Inventory

| Document Model ID | Purpose | Count per Vault |
|---|---|---|
| `arscontexta/note` | Atomic knowledge claim | Hundreds-thousands |
| `arscontexta/moc` | Map of Content (navigation + synthesis) | Tens |
| `arscontexta/source` | Ingested source material | Tens-hundreds |
| `arscontexta/pipeline-queue` | Processing pipeline state (singleton) | 1 |
| `arscontexta/health-report` | Point-in-time vault diagnostics | Rolling |
| `arscontexta/observation` | Operational learning (friction signal) | Tens |
| `arscontexta/tension` | Unresolved contradiction | Tens |
| `arscontexta/vault-config` | Live configuration (singleton) | 1 |
| `arscontexta/derivation` | Derivation record + manifest (singleton) | 1 |
| `arscontexta/methodology-note` | Self-knowledge about vault behavior | Tens |
| `arscontexta/research-claim` | Bundled research claim (read-only for users) | 249 |

---

## 5. Document Model Design

### 5.1 `arscontexta/note` — Atomic Knowledge Claim

The core unit of the knowledge graph. Each note makes one claim, titled as a prose sentence.

#### State Schema (Global)

```graphql
type NoteState {
  """Prose-sentence title that makes one claim"""
  title: String!

  """~150 char summary that adds information beyond the title"""
  description: String!

  """Full argumentative prose body with inline references"""
  content: String!

  """Note type classification"""
  kind: NoteKind!

  """Processing status"""
  status: NoteStatus!

  """Domain-specific extraction category"""
  category: String

  """Source this note was extracted from"""
  sourceRef: PHID

  """MOCs this note belongs to (topics footer equivalent)"""
  topics: [PHID!]!

  """Explicit outgoing connections with context phrases"""
  connections: [NoteConnection!]!

  """Inline wiki-link references found in content"""
  inlineRefs: [PHID!]!

  """Domain-specific custom fields from template"""
  customFields: [CustomField!]!

  """Who created this note"""
  createdBy: String

  """When this note was created"""
  createdAt: DateTime

  """When this note was last modified"""
  updatedAt: DateTime

  """Confidence level in the claim"""
  confidence: ConfidenceLevel

  """Pipeline batch this note belongs to"""
  batchId: String

  """Verification result from /verify phase"""
  verification: VerificationResult
}

type NoteConnection {
  id: OID!
  """PHID of the connected note"""
  targetRef: PHID!
  """Why this connection exists (articulation test result)"""
  contextPhrase: String!
  """Who created this connection"""
  createdBy: String
  """When this connection was created"""
  createdAt: DateTime
}

type CustomField {
  id: OID!
  key: String!
  value: String!
}

type VerificationResult {
  """Recite test passed"""
  recitePassed: Boolean
  """Schema validation passed"""
  schemaPassed: Boolean
  """Health checks passed"""
  healthPassed: Boolean
  """Overall verification status"""
  status: VerificationStatus
  """Verification notes"""
  notes: String
  """When verification was performed"""
  verifiedAt: DateTime
  """Who performed verification"""
  verifiedBy: String
}

enum NoteKind {
  CLAIM
  PATTERN
  COMPARISON
  TENSION
  ANTI_PATTERN
  IMPLEMENTATION
  ENRICHMENT
  SYNTHESIS
}

enum NoteStatus {
  DRAFT
  IN_PIPELINE
  CONNECTED
  VERIFIED
  ARCHIVED
}

enum ConfidenceLevel {
  SPECULATIVE
  EMERGING
  ESTABLISHED
  FOUNDATIONAL
}

enum VerificationStatus {
  PASS
  WARN
  FAIL
}
```

#### Operations (Module: `note-management`)

| Operation | Input | What It Does |
|---|---|---|
| `CREATE_NOTE` | title, description, content, kind, category, sourceRef, createdBy, createdAt | Initialize a new atomic note |
| `UPDATE_CONTENT` | content, updatedAt, updatedBy | Update the prose body |
| `UPDATE_DESCRIPTION` | description, updatedAt | Update the progressive disclosure summary |
| `SHARPEN_TITLE` | title, updatedAt | Refine the claim statement |
| `SET_STATUS` | status | Transition note status |
| `SET_CONFIDENCE` | confidence | Update confidence level |
| `SET_CUSTOM_FIELD` | key, value | Set a domain-specific custom field |
| `REMOVE_CUSTOM_FIELD` | key | Remove a custom field |

#### Operations (Module: `connections`)

| Operation | Input | What It Does |
|---|---|---|
| `ADD_CONNECTION` | id, targetRef, contextPhrase, createdBy, createdAt | Add an explicit connection with articulation |
| `UPDATE_CONNECTION` | id, contextPhrase, updatedAt | Update a connection's context phrase |
| `REMOVE_CONNECTION` | id | Remove a connection |
| `ADD_TOPIC` | topicRef | Associate note with a MOC |
| `REMOVE_TOPIC` | topicRef | Remove MOC association |
| `SET_INLINE_REFS` | refs: [PHID!] | Update inline references extracted from content |

#### Operations (Module: `verification`)

| Operation | Input | What It Does |
|---|---|---|
| `RECORD_VERIFICATION` | recitePassed, schemaPassed, healthPassed, status, notes, verifiedAt, verifiedBy | Record a verification result |
| `CLEAR_VERIFICATION` | — | Clear verification (note was modified after verification) |

#### Reducer Rules

- All timestamps and IDs come from action input (pure deterministic reducers)
- `UPDATE_CONTENT` automatically clears verification (content changed since last verify)
- `ADD_CONNECTION` validates targetRef is not self-referencing
- `SET_STATUS` enforces valid transitions: DRAFT -> IN_PIPELINE -> CONNECTED -> VERIFIED

#### Operation Errors

| Error | Operation | Condition |
|---|---|---|
| `SelfReferenceError` | ADD_CONNECTION | targetRef equals document's own PHID |
| `DuplicateConnectionError` | ADD_CONNECTION | Connection to same targetRef already exists |
| `ConnectionNotFoundError` | UPDATE_CONNECTION, REMOVE_CONNECTION | Connection ID doesn't exist |
| `InvalidStatusTransitionError` | SET_STATUS | Status transition not allowed |
| `DuplicateTopicError` | ADD_TOPIC | Topic already in topics array |
| `TopicNotFoundError` | REMOVE_TOPIC | Topic PHID not in topics array |

---

### 5.2 `arscontexta/moc` — Map of Content

Navigation + synthesis documents. Hub -> domain -> topic hierarchy.

#### State Schema (Global)

```graphql
type MocState {
  """MOC title"""
  title: String!

  """What this topic covers"""
  description: String!

  """Orientation prose (2-3 sentences, the synthesis payload)"""
  orientation: String!

  """MOC tier in hierarchy"""
  tier: MocTier!

  """Core ideas with context phrases — the attention management payload"""
  coreIdeas: [MocEntry!]!

  """Unresolved conflicts within this topic"""
  tensions: [MocTensionEntry!]!

  """Unexplored directions"""
  openQuestions: [String!]!

  """Agent navigation notes — traversal strategy hints"""
  agentNotes: [String!]!

  """Parent MOC reference"""
  parentRef: PHID

  """Child MOC references"""
  childRefs: [PHID!]!

  """Total note count (for oversize detection)"""
  noteCount: Int!

  createdAt: DateTime
  updatedAt: DateTime
}

type MocEntry {
  id: OID!
  """Reference to the note"""
  noteRef: PHID!
  """Why this note matters in this topic context"""
  contextPhrase: String!
  """Ordering within Core Ideas"""
  sortOrder: Int!
  addedAt: DateTime
  addedBy: String
}

type MocTensionEntry {
  id: OID!
  """Description of the tension"""
  description: String!
  """Notes involved in this tension"""
  involvedRefs: [PHID!]!
  addedAt: DateTime
}

enum MocTier {
  HUB
  DOMAIN
  TOPIC
}
```

#### Operations (Module: `moc-management`)

| Operation | Input | What It Does |
|---|---|---|
| `CREATE_MOC` | title, description, orientation, tier, parentRef, createdAt | Initialize a new MOC |
| `UPDATE_ORIENTATION` | orientation, updatedAt | Update the synthesis paragraph |
| `UPDATE_DESCRIPTION` | description, updatedAt | Update the progressive disclosure summary |
| `ADD_CORE_IDEA` | id, noteRef, contextPhrase, sortOrder, addedAt, addedBy | Add a note to Core Ideas with context |
| `UPDATE_CORE_IDEA` | id, contextPhrase, sortOrder | Update a core idea's context phrase or order |
| `REMOVE_CORE_IDEA` | id | Remove a note from Core Ideas |
| `ADD_TENSION` | id, description, involvedRefs, addedAt | Add an unresolved tension |
| `REMOVE_TENSION` | id | Remove a tension (resolved or dissolved) |
| `ADD_OPEN_QUESTION` | question | Add an unexplored direction |
| `REMOVE_OPEN_QUESTION` | question | Remove an open question |
| `ADD_AGENT_NOTE` | note | Add a traversal strategy hint |
| `ADD_CHILD_MOC` | childRef | Add a child MOC reference |
| `REMOVE_CHILD_MOC` | childRef | Remove a child MOC reference |
| `REORDER_CORE_IDEAS` | ids: [OID!] | Reorder core ideas |

#### Reducer Rules

- `ADD_CORE_IDEA` increments `noteCount`
- `REMOVE_CORE_IDEA` decrements `noteCount`
- Context phrases are mandatory (bare links are address books, not maps)
- `noteCount` > 40 triggers a recommendation to split the MOC

---

### 5.3 `arscontexta/source` — Ingested Source Material

#### State Schema (Global)

```graphql
type SourceState {
  """Source title"""
  title: String!

  """Source description"""
  description: String

  """Full source content"""
  content: String!

  """Source type"""
  sourceType: SourceType!

  """Processing status"""
  status: SourceStatus!

  """Provenance — where this came from"""
  provenance: Provenance

  """Claims extracted from this source"""
  extractedClaims: [PHID!]!

  """Extraction statistics"""
  extractionStats: ExtractionStats

  createdAt: DateTime
  createdBy: String
}

type Provenance {
  """Original URL if web source"""
  url: URL
  """Author of original source"""
  author: String
  """Date of original publication"""
  publishedAt: DateTime
  """How this source was obtained"""
  method: String
  """Research tool used"""
  tool: String
}

type ExtractionStats {
  """Total claims extracted"""
  claimCount: Int!
  """Claims skipped (with reason)"""
  skippedCount: Int!
  """Skip rate (must be < 10% for domain-relevant sources)"""
  skipRate: Float!
  extractedAt: DateTime
  extractedBy: String
}

enum SourceType {
  ARTICLE
  PAPER
  BOOK_CHAPTER
  TRANSCRIPT
  DOCUMENTATION
  CONVERSATION
  WEB_PAGE
  MANUAL_ENTRY
}

enum SourceStatus {
  INBOX
  EXTRACTING
  EXTRACTED
  ARCHIVED
}
```

#### Operations (Module: `source-management`)

| Operation | Input | What It Does |
|---|---|---|
| `INGEST_SOURCE` | title, content, sourceType, provenance, createdAt, createdBy | Add new source material |
| `SET_STATUS` | status | Transition source status |
| `ADD_EXTRACTED_CLAIM` | claimRef | Link an extracted claim to this source |
| `RECORD_EXTRACTION_STATS` | claimCount, skippedCount, skipRate, extractedAt, extractedBy | Record extraction statistics |

---

### 5.4 `arscontexta/pipeline-queue` — Processing Pipeline State

Singleton document per vault. The lifecycle backbone.

#### State Schema (Global)

```graphql
type PipelineQueueState {
  """Schema version for queue format"""
  schemaVersion: Int!

  """Phase ordering per task type"""
  phaseOrder: [PhaseOrderEntry!]!

  """All tasks in the pipeline"""
  tasks: [PipelineTask!]!

  """Completed task count (for stats)"""
  completedCount: Int!

  """Active task count"""
  activeCount: Int!

  """Last processing timestamp"""
  lastProcessedAt: DateTime
}

type PhaseOrderEntry {
  taskType: String!
  phases: [String!]!
}

type PipelineTask {
  id: OID!
  """Task type: extract, claim, enrichment, maintenance"""
  taskType: String!
  """Current status"""
  status: TaskStatus!
  """Human-readable target description"""
  target: String!
  """Batch identifier"""
  batchId: String
  """Reference to the note/source being processed"""
  documentRef: PHID
  """Current pipeline phase"""
  currentPhase: String
  """Phases already completed"""
  completedPhases: [String!]!
  """Phase-specific handoff data"""
  handoffs: [PhaseHandoff!]!
  """Who is currently working on this task"""
  assignedTo: String
  """When this task was created"""
  createdAt: DateTime!
  """When this task was last updated"""
  updatedAt: DateTime
}

type PhaseHandoff {
  id: OID!
  phase: String!
  """What was done in this phase"""
  workDone: String!
  """Files modified during this phase"""
  filesModified: [String!]!
  """Learnings captured (friction, surprise, methodology, process gaps)"""
  learnings: [PhaseLearning!]!
  completedAt: DateTime!
  completedBy: String
}

type PhaseLearning {
  id: OID!
  category: LearningCategory!
  description: String!
}

enum TaskStatus {
  PENDING
  IN_PROGRESS
  BLOCKED
  DONE
  FAILED
}

enum LearningCategory {
  FRICTION
  SURPRISE
  METHODOLOGY
  PROCESS_GAP
}
```

#### Operations (Module: `queue-management`)

| Operation | Input | What It Does |
|---|---|---|
| `ADD_TASK` | id, taskType, target, batchId, documentRef, currentPhase, createdAt | Add a new task to the pipeline |
| `ASSIGN_TASK` | taskId, assignedTo, updatedAt | Assign task to a processor |
| `ADVANCE_PHASE` | taskId, handoff (PhaseHandoff input), updatedAt | Complete current phase, advance to next |
| `COMPLETE_TASK` | taskId, updatedAt | Mark task as done |
| `FAIL_TASK` | taskId, reason, updatedAt | Mark task as failed |
| `BLOCK_TASK` | taskId, reason, updatedAt | Mark task as blocked |
| `UNBLOCK_TASK` | taskId, updatedAt | Unblock a task |

#### Reducer Rules

- `ADVANCE_PHASE` moves `currentPhase` to `completedPhases`, sets next phase from `phaseOrder`
- `ADVANCE_PHASE` on the final phase automatically calls `COMPLETE_TASK` logic
- `COMPLETE_TASK` increments `completedCount`, decrements `activeCount`
- `ADD_TASK` increments `activeCount`

---

### 5.5 `arscontexta/observation` — Operational Learning Signal

#### State Schema (Global)

```graphql
type ObservationState {
  """Prose-sentence title describing what was observed"""
  title: String!

  """Summary of the observation"""
  description: String!

  """Full observation content"""
  content: String

  """Observation category"""
  category: ObservationCategory!

  """Processing status"""
  status: ObservationStatus!

  """When this was observed"""
  observedAt: DateTime!

  """Who observed this"""
  observedBy: String

  """If promoted, reference to the resulting note"""
  promotedTo: PHID

  """If promoted, when"""
  promotedAt: DateTime
}

enum ObservationCategory {
  METHODOLOGY
  PROCESS
  FRICTION
  SURPRISE
  QUALITY
}

enum ObservationStatus {
  PENDING
  PROMOTED
  IMPLEMENTED
  ARCHIVED
}
```

#### Operations (Module: `observation-management`)

| Operation | Input | What It Does |
|---|---|---|
| `CREATE_OBSERVATION` | title, description, content, category, observedAt, observedBy | Capture a new friction signal |
| `PROMOTE_OBSERVATION` | promotedTo, promotedAt | Promote to a permanent note |
| `IMPLEMENT_OBSERVATION` | — | Mark as implemented in system |
| `ARCHIVE_OBSERVATION` | — | Archive (no longer relevant) |

---

### 5.6 `arscontexta/tension` — Unresolved Contradiction

#### State Schema (Global)

```graphql
type TensionState {
  """What is in tension"""
  title: String!

  """Description of the conflict"""
  description: String!

  """Full analysis of the tension"""
  content: String

  """Notes/claims involved in this tension"""
  involvedRefs: [PHID!]!

  """Current status"""
  status: TensionStatus!

  """When this tension was identified"""
  observedAt: DateTime!

  """Who identified it"""
  observedBy: String

  """Resolution explanation (if resolved)"""
  resolution: String

  """When resolved"""
  resolvedAt: DateTime
}

enum TensionStatus {
  OPEN
  RESOLVED
  DISSOLVED
}
```

#### Operations (Module: `tension-management`)

| Operation | Input | What It Does |
|---|---|---|
| `CREATE_TENSION` | title, description, content, involvedRefs, observedAt, observedBy | Identify a new contradiction |
| `RESOLVE_TENSION` | resolution, resolvedAt | Mark as resolved with explanation |
| `DISSOLVE_TENSION` | resolution, resolvedAt | Mark as dissolved (tension was apparent, not real) |
| `ADD_INVOLVED_REF` | ref | Add a note to the tension |

---

### 5.7 `arscontexta/vault-config` — Live Configuration (Singleton)

#### State Schema (Global)

```graphql
type VaultConfigState {
  """Vault name"""
  name: String!

  """Domain description"""
  domain: String!

  """Eight configuration dimensions"""
  dimensions: DimensionConfig!

  """Vocabulary mapping"""
  vocabulary: VocabularyMap!

  """Active feature blocks"""
  features: [String!]!

  """Processing pipeline configuration"""
  pipeline: PipelineConfig!

  """Maintenance condition thresholds"""
  maintenance: MaintenanceConfig!

  """Domain-specific extraction categories"""
  extractionCategories: [ExtractionCategory!]!

  """Note template schema (required fields, enums)"""
  noteSchema: NoteSchemaConfig!

  """MOC template schema"""
  mocSchema: MocSchemaConfig!

  updatedAt: DateTime
}

type DimensionConfig {
  granularity: DimensionPosition!
  organization: DimensionPosition!
  linking: DimensionPosition!
  processing: DimensionPosition!
  navigation: DimensionPosition!
  maintenance: DimensionPosition!
  schema: DimensionPosition!
  automation: DimensionPosition!
}

type DimensionPosition {
  """Position on the spectrum (1-5)"""
  value: Int!
  """Confidence in this position"""
  confidence: Float!
  """Rationale for this position"""
  rationale: String
}

type VocabularyMap {
  notes: String!
  inbox: String!
  reduce: String!
  reflect: String!
  reweave: String!
  verify: String!
  rethink: String!
  topicMap: String!
  description: String!
}

type PipelineConfig {
  """Processing depth: quick, standard, deep"""
  depth: String!
  """Whether pipeline chains automatically"""
  autoChain: Boolean!
  """Extraction selectivity threshold"""
  extractionSelectivity: Float!
}

type MaintenanceConfig {
  orphanThreshold: Int!
  danglingThreshold: Int!
  inboxPressure: Int!
  observationAccumulation: Int!
  tensionAccumulation: Int!
  mocOversize: Int!
  staleNoteDays: Int!
}

type ExtractionCategory {
  id: OID!
  name: String!
  description: String!
  """Whether this category is active"""
  active: Boolean!
}

type NoteSchemaConfig {
  requiredFields: [String!]!
  optionalFields: [String!]!
  kindValues: [String!]!
  confidenceValues: [String!]!
}

type MocSchemaConfig {
  requiredFields: [String!]!
  tierValues: [String!]!
}
```

#### Operations (Module: `config-management`)

| Operation | Input | What It Does |
|---|---|---|
| `INITIALIZE_CONFIG` | name, domain, dimensions, vocabulary, features, pipeline, maintenance, extractionCategories, noteSchema, mocSchema, updatedAt | Initialize vault configuration |
| `UPDATE_DIMENSION` | dimension (key), value, confidence, rationale, updatedAt | Update a dimension position |
| `UPDATE_VOCABULARY` | key, value, updatedAt | Update a vocabulary term |
| `UPDATE_PIPELINE_CONFIG` | depth, autoChain, extractionSelectivity, updatedAt | Update pipeline settings |
| `UPDATE_MAINTENANCE_THRESHOLD` | condition (key), threshold, updatedAt | Update a maintenance threshold |
| `ADD_EXTRACTION_CATEGORY` | id, name, description, active | Add an extraction category |
| `TOGGLE_EXTRACTION_CATEGORY` | id, active | Enable/disable a category |
| `TOGGLE_FEATURE` | feature, enabled | Enable/disable a feature block |

---

### 5.8 `arscontexta/derivation` — Derivation Record (Singleton)

#### State Schema (Global)

```graphql
type DerivationState {
  """Arscontexta version used for derivation"""
  engineVersion: String!

  """When the derivation was performed"""
  derivedAt: DateTime!

  """The original conversation signals that drove derivation"""
  signals: [DerivationSignal!]!

  """Dimension derivation rationale"""
  dimensionRationale: [DimensionRationale!]!

  """Research claims that backed each decision"""
  claimReferences: [ClaimReference!]!

  """Feature block activation decisions"""
  featureDecisions: [FeatureDecision!]!

  """Coherence validation results"""
  coherenceResults: [CoherenceCheck!]!

  """Re-derivation history"""
  reseedHistory: [ReseedEntry!]!
}

type DerivationSignal {
  id: OID!
  """What the user said"""
  utterance: String!
  """What dimension(s) this influenced"""
  influencedDimensions: [String!]!
  """How it was interpreted"""
  interpretation: String!
}

type DimensionRationale {
  dimension: String!
  position: Int!
  confidence: Float!
  """Full reasoning for this choice"""
  rationale: String!
  """Research claims supporting this choice"""
  supportingClaims: [PHID!]!
  """Known failure modes at this position"""
  failureModes: [String!]!
}

type ClaimReference {
  id: OID!
  """Reference to the research claim document"""
  claimRef: PHID!
  """Which decision this claim supports"""
  supportsDecision: String!
  """How strong the support is"""
  strength: String!
}

type FeatureDecision {
  feature: String!
  enabled: Boolean!
  rationale: String!
  """Claims supporting this decision"""
  supportingClaims: [PHID!]!
}

type CoherenceCheck {
  """Which dimensions were checked"""
  dimensionPair: [String!]!
  """Whether the combination is coherent"""
  coherent: Boolean!
  """Explanation of coherence or incoherence"""
  explanation: String!
}

type ReseedEntry {
  id: OID!
  """When the reseed was performed"""
  reseededAt: DateTime!
  """Why the reseed was triggered"""
  reason: String!
  """What changed"""
  changes: [String!]!
}
```

---

### 5.9 `arscontexta/health-report` — Vault Diagnostics

#### State Schema (Global)

```graphql
type HealthReportState {
  """When this report was generated"""
  generatedAt: DateTime!

  """Who generated it"""
  generatedBy: String

  """Report mode: quick, full, three-space"""
  mode: String!

  """Overall health status"""
  overallStatus: HealthStatus!

  """Individual check results"""
  checks: [HealthCheck!]!

  """Graph metrics at time of report"""
  graphMetrics: GraphMetrics!

  """Recommended actions"""
  recommendations: [String!]!
}

type HealthCheck {
  id: OID!
  """Check category"""
  category: HealthCategory!
  """Result"""
  status: HealthStatus!
  """Details"""
  message: String!
  """Affected items (PHIDs or descriptions)"""
  affectedItems: [String!]!
}

type GraphMetrics {
  noteCount: Int!
  mocCount: Int!
  connectionCount: Int!
  density: Float!
  orphanCount: Int!
  danglingLinkCount: Int!
  mocCoverage: Float!
  averageLinksPerNote: Float!
}

enum HealthCategory {
  SCHEMA_COMPLIANCE
  ORPHAN_DETECTION
  LINK_HEALTH
  DESCRIPTION_QUALITY
  THREE_SPACE_BOUNDARIES
  PROCESSING_THROUGHPUT
  STALE_NOTES
  MOC_COHERENCE
}

enum HealthStatus {
  PASS
  WARN
  FAIL
}
```

---

### 5.10 `arscontexta/research-claim` — Bundled Research (Read-heavy)

#### State Schema (Global)

```graphql
type ResearchClaimState {
  """Prose-sentence title"""
  title: String!

  """Progressive disclosure summary"""
  description: String!

  """Full argumentative prose"""
  content: String!

  """Research kind"""
  kind: String!

  """Methodology traditions referenced"""
  methodology: [String!]!

  """Source references"""
  sources: [String!]!

  """MOC membership"""
  topics: [PHID!]!

  """Connections to other research claims"""
  connections: [ResearchConnection!]!
}

type ResearchConnection {
  id: OID!
  targetRef: PHID!
  contextPhrase: String!
}
```

This model is primarily read-only for end users. The 249 claims are populated by the Ars Contexta maintainers and serve as the reference knowledge base that backs derivation decisions.

---

## 6. Multi-User Collaboration Model

### 6.1 Roles

| Role | What They Do | Permissions |
|---|---|---|
| **Researcher** | Ingests sources, extracts claims, creates notes | Create sources, notes, observations. Run extract pipeline |
| **Curator** | Connects notes, maintains MOCs, finds synthesis | Create/update connections, MOCs. Run reflect/reweave phases |
| **Reviewer** | Verifies quality, validates schema, approves promotions | Run verify phase, record verification results, promote observations |
| **Architect** | Configures vault, manages derivation, evolves system | Update vault-config, derivation. Run rethink |
| **Consumer** | Reads and traverses the knowledge graph | Read-only access to notes, MOCs, research claims |
| **Operator** | Manages pipeline queue, monitors health | Manage pipeline-queue, generate health reports |

### 6.2 Scope Mapping to Powerhouse

Powerhouse document models support `global` and `local` state scopes:

- **Global state**: Shared among all users. This is the canonical knowledge graph.
- **Local state**: Private to each user.

| Data | Scope | Rationale |
|---|---|---|
| Note content, connections, verification | Global | Canonical knowledge — everyone sees the same graph |
| Note reading position, personal bookmarks | Local | Personal navigation state |
| MOC structure, core ideas | Global | Shared navigation map |
| Personal annotation on a note | Local | User-specific commentary |
| Pipeline queue state | Global | Shared workflow coordination |
| Task assignment | Global | Everyone sees who is working on what |
| User's draft notes (pre-submit) | Local | Work in progress, not yet canonical |
| Vault configuration | Global | Shared system settings |

### 6.3 Workflow: Multi-User Processing Pipeline

```
RESEARCHER ingests source
  |-- Creates arscontexta/source document
  |-- Pipeline-queue gets ADD_TASK (type: extract)
  |
RESEARCHER (or AI agent) runs extract phase
  |-- Creates arscontexta/note documents (status: DRAFT)
  |-- Pipeline-queue ADVANCE_PHASE (extract -> reflect)
  |
CURATOR runs reflect phase
  |-- Adds connections (ADD_CONNECTION with context phrases)
  |-- Updates MOCs (ADD_CORE_IDEA with context phrases)
  |-- Pipeline-queue ADVANCE_PHASE (reflect -> reweave)
  |
CURATOR runs reweave phase
  |-- Updates older notes with connections to new content
  |-- Pipeline-queue ADVANCE_PHASE (reweave -> verify)
  |
REVIEWER runs verify phase
  |-- RECORD_VERIFICATION on each note
  |-- Pipeline-queue ADVANCE_PHASE (verify -> done)
  |
CONSUMER reads the verified knowledge graph
  |-- Traverses MOCs, follows connections
  |-- Queries via GraphQL subgraph
```

### 6.4 Conflict Resolution

Powerhouse's operation log handles concurrent edits:

- **No conflicts on different notes**: Two users editing different notes produces no conflict
- **Concurrent edits on same note**: Operations are ordered by timestamp; both are applied in sequence
- **Contradictory operations**: The operation log preserves both; reducers apply deterministically
- **Connection disputes**: Both connections exist until explicitly removed

For semantic conflicts (two users disagree on a connection), the `arscontexta/tension` document type captures the disagreement explicitly.

---

## 7. Processing Pipeline as Operations

### 7.1 Phase-to-Operation Mapping

Each processing phase maps to specific document model operations:

| Phase | Primary Document | Operations Used |
|---|---|---|
| **Seed** | `source`, `pipeline-queue` | `INGEST_SOURCE`, `ADD_TASK` |
| **Extract** | `note`, `source`, `pipeline-queue` | `CREATE_NOTE` (per claim), `ADD_EXTRACTED_CLAIM`, `RECORD_EXTRACTION_STATS`, `ADVANCE_PHASE` |
| **Reflect** | `note`, `moc`, `pipeline-queue` | `ADD_CONNECTION`, `ADD_TOPIC`, `ADD_CORE_IDEA`, `ADVANCE_PHASE` |
| **Reweave** | `note`, `moc`, `pipeline-queue` | `UPDATE_CONTENT`, `ADD_CONNECTION`, `SHARPEN_TITLE`, `ADVANCE_PHASE` |
| **Verify** | `note`, `pipeline-queue` | `RECORD_VERIFICATION`, `ADVANCE_PHASE` or `COMPLETE_TASK` |
| **Rethink** | `observation`, `tension`, `vault-config` | `PROMOTE_OBSERVATION`, `RESOLVE_TENSION`, `UPDATE_DIMENSION` |

### 7.2 Batch Processing

The `/ralph` orchestrator pattern maps to:

1. Read `pipeline-queue` document for next unblocked task
2. Dispatch processing operations to the relevant note/moc documents
3. Record phase handoff in `pipeline-queue` via `ADVANCE_PHASE`
4. Repeat

In a multi-user context, `ASSIGN_TASK` prevents duplicate work. The pipeline-queue's global state ensures all users see the current queue status.

### 7.3 Handoff Protocol as Operations

The current handoff block:
```
=== RALPH HANDOFF ===
Work Done: ...
Files Modified: ...
Learnings: ...
Queue Updates: ...
```

Becomes the `PhaseHandoff` type embedded in `ADVANCE_PHASE` operations — a typed, queryable, auditable record of every processing step.

---

## 8. Graph Query Layer

### 8.1 Subgraph: Knowledge Graph Queries

A Powerhouse subgraph exposes the knowledge graph as a GraphQL API:

```graphql
type Query {
  """Get a note by PHID"""
  ArsContexta_note(id: PHID!): NoteState

  """Search notes by description keyword"""
  ArsContexta_searchNotes(query: String!, limit: Int): [NoteState!]!

  """Get all notes connected to a given note"""
  ArsContexta_connections(noteId: PHID!, depth: Int): [ConnectionResult!]!

  """Get backlinks — what notes connect TO this note"""
  ArsContexta_backlinks(noteId: PHID!): [NoteState!]!

  """Get all notes in a MOC"""
  ArsContexta_mocNotes(mocId: PHID!): [NoteState!]!

  """Find orphan notes (zero incoming connections)"""
  ArsContexta_orphans: [NoteState!]!

  """Find dangling references (target doesn't exist)"""
  ArsContexta_danglingLinks: [DanglingLink!]!

  """Graph density metric"""
  ArsContexta_density: Float!

  """Find synthesis opportunities (open triangles)"""
  ArsContexta_triangles(limit: Int): [Triangle!]!

  """Find bridge notes (removal would disconnect graph)"""
  ArsContexta_bridges: [NoteState!]!

  """Get notes by kind"""
  ArsContexta_notesByKind(kind: NoteKind!): [NoteState!]!

  """Get notes by status"""
  ArsContexta_notesByStatus(status: NoteStatus!): [NoteState!]!

  """Get pipeline queue status"""
  ArsContexta_queueStatus: QueueSummary!

  """Get vault health summary"""
  ArsContexta_health: HealthSummary!

  """Traverse forward from a note N hops"""
  ArsContexta_traverseForward(noteId: PHID!, depth: Int!): [TraversalNode!]!

  """Traverse backward from a note N hops"""
  ArsContexta_traverseBackward(noteId: PHID!, depth: Int!): [TraversalNode!]!

  """Get notes by MOC tier"""
  ArsContexta_mocsByTier(tier: MocTier!): [MocState!]!

  """Full-text search across note content"""
  ArsContexta_fullTextSearch(query: String!, limit: Int): [SearchResult!]!
}

type ConnectionResult {
  note: NoteState!
  contextPhrase: String!
  depth: Int!
}

type DanglingLink {
  sourceNote: NoteState!
  targetRef: PHID!
}

type Triangle {
  noteA: NoteState!
  noteB: NoteState!
  noteC: NoteState!
  """Which pair is missing the connection"""
  missingEdge: [PHID!]!
}

type QueueSummary {
  totalTasks: Int!
  pendingTasks: Int!
  inProgressTasks: Int!
  completedTasks: Int!
  tasksByPhase: [PhaseCount!]!
}

type PhaseCount {
  phase: String!
  count: Int!
}

type HealthSummary {
  noteCount: Int!
  mocCount: Int!
  connectionCount: Int!
  density: Float!
  orphanCount: Int!
  danglingCount: Int!
  mocCoverage: Float!
  pendingObservations: Int!
  pendingTensions: Int!
  overallStatus: HealthStatus!
}

type TraversalNode {
  note: NoteState!
  depth: Int!
  path: [PHID!]!
}

type SearchResult {
  note: NoteState!
  matchContext: String!
  relevanceScore: Float!
}
```

### 8.2 Subgraph: Mutations (Processing API)

```graphql
type Mutation {
  """Ingest a new source and create extract task"""
  ArsContexta_seedSource(
    title: String!
    content: String!
    sourceType: SourceType!
    provenance: ProvenanceInput
  ): SeedResult!

  """Run extraction on a source, creating note documents"""
  ArsContexta_extract(
    sourceId: PHID!
    claims: [ClaimInput!]!
  ): ExtractResult!

  """Add a connection between two notes"""
  ArsContexta_connect(
    sourceNoteId: PHID!
    targetNoteId: PHID!
    contextPhrase: String!
  ): ConnectionResult!

  """Record a verification result"""
  ArsContexta_verify(
    noteId: PHID!
    recitePassed: Boolean!
    schemaPassed: Boolean!
    healthPassed: Boolean!
    notes: String
  ): VerificationResult!

  """Capture an operational observation"""
  ArsContexta_observe(
    title: String!
    description: String!
    category: ObservationCategory!
  ): ObservationState!

  """Report a tension between notes"""
  ArsContexta_reportTension(
    title: String!
    description: String!
    involvedNoteIds: [PHID!]!
  ): TensionState!
}
```

### 8.3 Processor: Graph Metrics Computation

A Powerhouse processor runs periodically to compute graph-level metrics:

- **Orphan detection**: Scan all notes, find those with zero incoming connections
- **Dangling link detection**: Scan all connections, verify target documents exist
- **Density calculation**: `connections / (noteCount * (noteCount - 1))`
- **Triangle detection**: For each pair (A,B) sharing a connection to C, check if A<->B exists
- **Bridge detection**: Identify notes whose removal increases connected component count
- **MOC coverage**: Percentage of notes appearing in at least one MOC

Results are written as `arscontexta/health-report` documents.

---

## 9. Editor Specifications

### 9.1 Knowledge Graph Explorer (Primary Editor)

An editor for browsing and navigating the knowledge graph:

- **Graph visualization**: Interactive node-link diagram (notes as nodes, connections as edges)
- **MOC navigation**: Hierarchical tree view (hub -> domain -> topic)
- **Note reader**: Markdown rendering with clickable `[[wiki links]]` resolved to document references
- **Connection panel**: List of outgoing/incoming connections with context phrases
- **Search**: Full-text + field-level search
- **Filters**: By kind, status, confidence, MOC membership

### 9.2 Note Editor

An editor for creating and editing individual notes:

- **Title field**: Prose-sentence input with claim articulation guide
- **Description field**: 150-char progressive disclosure summary
- **Content editor**: Rich markdown editor with wiki-link autocomplete
- **Connection manager**: Add/remove connections with context phrase input
- **Topic selector**: MOC membership picker
- **Custom fields**: Domain-specific field editor
- **Verification badge**: Shows current verification status

### 9.3 Pipeline Dashboard

An editor for managing the processing pipeline:

- **Queue view**: Tasks by status and phase
- **Assignment**: Claim/release tasks
- **Phase progress**: Visual pipeline showing phases completed/remaining
- **Batch view**: Group tasks by source batch
- **Stats**: Extraction rates, processing throughput, completion times

### 9.4 Health Dashboard

An editor for monitoring vault health:

- **Metrics overview**: Note count, density, orphans, dangling links, MOC coverage
- **Trend charts**: Growth over time
- **Alert list**: Conditions exceeding thresholds
- **Action recommendations**: What to do about each alert

### 9.5 Vault Configuration Editor

An editor for managing vault settings:

- **Dimension sliders**: 8 dimensions with position, confidence, rationale
- **Vocabulary mapper**: Domain term customization
- **Feature toggles**: Enable/disable feature blocks
- **Pipeline config**: Depth, auto-chain, selectivity
- **Maintenance thresholds**: Configurable triggers

---

## 10. Subgraph API Design

### 10.1 Architecture

```
Client (Browser / AI Agent / CLI)
  |
  v
GraphQL Subgraph API
  |
  v
Powerhouse Reactor
  |
  v
Document Drive (arscontexta documents)
```

### 10.2 Authentication & Authorization

- Drive-level access control via Powerhouse's existing auth layer
- Role-based filtering via subgraph resolvers
- Consumer role: read-only queries
- Researcher/Curator/Reviewer: mutations scoped to their role
- Architect: full configuration access

### 10.3 Real-time Subscriptions

```graphql
type Subscription {
  """New note created in the knowledge graph"""
  ArsContexta_noteCreated: NoteState!

  """Note connection added"""
  ArsContexta_connectionAdded: ConnectionEvent!

  """Pipeline task status changed"""
  ArsContexta_taskUpdated: PipelineTask!

  """Health alert triggered"""
  ArsContexta_healthAlert: HealthCheck!
}
```

### 10.4 AI Agent Integration

AI agents interact with the knowledge base through the same subgraph API:

```
AI Agent (Claude Code, etc.)
  |-- Queries: ArsContexta_searchNotes, ArsContexta_connections, etc.
  |-- Mutations: ArsContexta_seedSource, ArsContexta_extract, ArsContexta_connect
  |-- Uses: MCP tools that wrap the GraphQL API
```

The MCP tool wrapper enables AI agents to interact with the remote knowledge base using the same skill patterns as the local filesystem version, but backed by Powerhouse documents instead of markdown files.

---

## 11. Migration Path

### 11.1 From Local Vault to Remote Drive

| Local Artifact | Migration Target |
|---|---|
| Each `notes/*.md` file | `arscontexta/note` document in `/knowledge/` folder |
| Each MOC `notes/*-moc.md` | `arscontexta/moc` document in `/knowledge/` folder |
| `inbox/*.md` files | `arscontexta/source` documents in `/sources/` folder |
| `ops/queue/queue.json` | `arscontexta/pipeline-queue` document in `/operations/` |
| `ops/observations/*.md` | `arscontexta/observation` documents in `/operations/` |
| `ops/tensions/*.md` | `arscontexta/tension` documents in `/operations/` |
| `ops/config.yaml` | `arscontexta/vault-config` document in `/system/` |
| `ops/derivation.md` + `derivation-manifest.md` | `arscontexta/derivation` document in `/system/` |
| `ops/health/*.md` | `arscontexta/health-report` documents in `/operations/` |
| `methodology/*.md` (249 claims) | `arscontexta/research-claim` documents in `/research/` |
| YAML frontmatter | Document state fields |
| Wiki links `[[title]]` | PHID references in connections |
| Prose body | `content` field |
| File modification history | Operation log |

### 11.2 Migration Script Requirements

1. Parse each markdown file's YAML frontmatter into document state
2. Resolve wiki links to PHIDs (requires a title -> PHID mapping pass)
3. Extract inline `[[references]]` from content and populate `inlineRefs`
4. Convert MOC Core Ideas sections into `MocEntry` arrays
5. Preserve timestamps from file metadata
6. Validate all connections resolve (no dangling links post-migration)

### 11.3 Bidirectional Sync (Optional)

For users who want to keep using the local filesystem alongside the remote drive:

- **Local -> Remote**: File watcher detects markdown changes, dispatches operations to Powerhouse
- **Remote -> Local**: Webhook/subscription renders documents back to markdown files
- **Conflict resolution**: Operation log is authoritative; local files are regenerated on conflict

---

## 12. Implementation Phases

### Phase 1: Core Document Models

**Goal**: Define and implement the foundational document models.

1. `arscontexta/note` — the atomic knowledge unit
2. `arscontexta/moc` — navigation and synthesis
3. `arscontexta/vault-config` — configuration singleton

**Deliverables**: Document model definitions, reducers, generated types, basic tests.

### Phase 2: Operational Models

**Goal**: Implement the processing pipeline and operational learning.

4. `arscontexta/pipeline-queue` — processing lifecycle
5. `arscontexta/source` — source material management
6. `arscontexta/observation` — friction capture
7. `arscontexta/tension` — contradiction tracking

**Deliverables**: Queue management, phase progression, handoff protocol.

### Phase 3: System Models

**Goal**: Implement derivation and diagnostics.

8. `arscontexta/derivation` — derivation record
9. `arscontexta/health-report` — vault diagnostics
10. `arscontexta/research-claim` — bundled research (read-heavy, 249 claims)

**Deliverables**: Derivation system, health reporting, research knowledge base.

### Phase 4: Graph Subgraph

**Goal**: Expose the knowledge graph as a queryable GraphQL API.

- Graph traversal queries (connections, backlinks, forward/backward traversal)
- Graph analysis queries (orphans, triangles, bridges, density)
- Pipeline queries (queue status, task management)
- Health queries (metrics, alerts)

**Deliverables**: Subgraph with full query/mutation/subscription support.

### Phase 5: Editors

**Goal**: Build the user-facing editors.

- Knowledge Graph Explorer (primary navigation editor)
- Note Editor (create/edit notes)
- Pipeline Dashboard (queue management)
- Health Dashboard (metrics and alerts)
- Vault Configuration Editor (system settings)

**Deliverables**: Five editors registered in the Powerhouse manifest.

### Phase 6: Migration Tooling

**Goal**: Enable migration from local vaults to remote drives.

- Markdown parser (YAML frontmatter + wiki links + content)
- Title-to-PHID resolver
- Batch document creation via MCP tools
- Validation suite (post-migration integrity checks)

**Deliverables**: Migration CLI, validation reports, bidirectional sync (optional).

### Phase 7: AI Agent Integration

**Goal**: Enable AI agents to interact with the remote knowledge base.

- MCP tool wrappers for subgraph API
- Skill adapters (local skill -> remote API calls)
- Fresh-context-per-phase orchestration via Powerhouse processors

**Deliverables**: MCP server, adapted skills, orchestration processor.

---

## Appendix A: Glossary

| Term | Definition |
|---|---|
| **Note** | Atomic knowledge claim. One idea, titled as a prose sentence |
| **MOC** | Map of Content. Navigation + synthesis document organizing notes by topic |
| **Wiki link** | `[[note title]]` reference creating a graph edge between notes |
| **Context phrase** | Brief explanation of WHY a connection exists. Required for every link in a MOC |
| **Articulation test** | Quality gate: "[[A]] connects to [[B]] because [specific reason]" |
| **Cold-read test** | Verification method: predict note content from title+description alone |
| **Spreading activation** | Cognitive model: reading one note primes related notes through graph edges |
| **Progressive disclosure** | Each layer (title -> description -> content) reveals more but costs more tokens |
| **Derivation** | Configuration method: reasoning from research principles, not copying templates |
| **Three spaces** | Architectural invariant: self (identity), notes (knowledge), ops (coordination) |
| **Kernel primitive** | One of 15 invariant features present in every generated system |
| **Feature block** | Optional, toggleable capability (e.g., semantic search, personality, multi-domain) |
| **Observation** | Captured friction signal. May be promoted to a permanent note |
| **Tension** | Identified contradiction between existing knowledge claims |
| **PHID** | Powerhouse ID. Globally unique document identifier |
| **Reducer** | Pure, deterministic function that applies an operation to document state |
| **Subgraph** | GraphQL schema extension exposing document-level queries and mutations |
| **Processor** | Background computation that reads documents and produces derived outputs |

## Appendix B: Research Claim Categories (249 Claims)

The bundled research knowledge base covers these topic areas:

| MOC | Focus | Claim Count |
|---|---|---|
| **agent-cognition** | Context windows, attention degradation, session boundaries | ~50 |
| **graph-structure** | Network topology, link density, small-world properties | ~40 |
| **processing-pipeline** | Extraction, connection, verification, quality gates | ~35 |
| **maintenance-evolution** | Operational learning, drift detection, system evolution | ~30 |
| **automation-hooks** | Hook-based enforcement, determinism boundary, graduated response | ~30 |
| **capture-methodology** | Note-taking traditions, atomic claims, composability | ~25 |
| **navigation-discovery** | MOC design, progressive disclosure, semantic search | ~25 |
| **platform-architecture** | Multi-platform adaptation, capability tiers, plugin design | ~14 |

## Appendix C: Dimension Coherence Constraints

Certain dimension combinations create failures:

| Combination | Problem | Mitigation |
|---|---|---|
| Atomic granularity + 2-tier navigation | Too many notes for flat MOC list | Require 3-tier navigation |
| Dense schema + minimal processing | Schema checked but rarely enforced | Increase processing or reduce schema |
| Full automation + coarse granularity | Automated pipeline over-processes large notes | Match automation to granularity |
| Implicit linking + minimal maintenance | Connections never made explicit, graph stays sparse | Increase either linking or maintenance |

---

*This specification is a living document. It will evolve as implementation proceeds and as the Ars Contexta research knowledge base itself evolves.*
