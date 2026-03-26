# Knowledge Vault — User Guide

## What is the Knowledge Vault?

The Knowledge Vault is a knowledge management platform built on Powerhouse document models. It lets you capture, connect, verify, and navigate atomic knowledge claims through a structured processing pipeline. Think of it as a team-shared Zettelkasten with a graph database, processing queue, and AI agent integration.

## Getting Started

### 1. Start the Server

```bash
ph vetra --watch
```

This starts:
- **Reactor** at `http://localhost:4001` (document storage + API)
- **Connect UI** at `http://localhost:3001` (web interface)
- **MCP server** at `http://localhost:4001/mcp` (AI agent access)
- **Graph processor** watching for note changes (auto-syncs the knowledge graph)

### 2. Open the App

Navigate to `http://localhost:3001` in your browser. You'll see the Powerhouse Connect interface.

If this is a fresh drive, the Knowledge Vault app will **automatically initialize** the folder structure on first load:

```
/knowledge/              — your notes and MOCs live here
  /knowledge/inbox/      — unprocessed sources waiting for extraction
  /knowledge/insights/   — extracted atomic knowledge claims
/sources/                — archived source material
/ops/                    — operational coordination
  /ops/sessions/         — session transcripts
  /ops/health/           — health reports
  /ops/queue/            — pipeline queue (auto-created singleton)
/self/                   — system identity and configuration
  /self/methodology/     — methodology notes
/research/               — bundled research claims (249 TFT claims)
```

Three singleton documents are also auto-created:
- **PipelineQueue** in `/ops/queue/` — tracks processing tasks
- **KnowledgeGraph** in `/knowledge/` — materialized graph of all notes
- **VaultConfig** in `/self/` — vault configuration and dimensions

### 3. Explore the Interface

The Knowledge Vault app has a **dark theme** (Catppuccin Mocha) with:

**Left Sidebar** (4 tabs):
- **Notes** — all knowledge notes grouped by status (Canonical, In Review, Draft, Archived)
- **MOCs** — Maps of Content grouped by tier (Hub, Domain, Topic)
- **Signals** — pending observations (amber) and open tensions (red)
- **Tree** — full drive folder structure with expand/collapse

**Top Bar** (5 tabs):
- **Notes** — card grid of all knowledge notes
- **Graph** — interactive force-directed graph visualization
- **Sources** — source documents by processing status
- **Pipeline** — processing queue dashboard with task progress
- **Health** — vault health metrics and diagnostics

**Create Menu** (top right "New" button):
- Knowledge Note, Map of Content, Source, Observation, Tension

## Creating Your First Note

1. Click **New** → **Knowledge Note**
2. Give it a name in the dialog
3. The note opens in the **Knowledge Note Editor**:
   - **Title** — a prose sentence making one claim (e.g., "Spreading activation explains why wiki links aid recall")
   - **Description** — ~150 chars, adds info beyond the title
   - **Note Type** — concept, decision, pattern, observation, etc.
   - **Topics** — tag with topic names
   - **Content** — markdown body (Preview mode by default, click to Edit)
   - **Status** — set provenance first, then submit for review
   - **Links** — connect to other notes with typed links
   - **Metadata** — optional fields in the right sidebar

### Setting Provenance

Before you can submit a note for review, you must set **provenance** (who wrote it):
1. In the right sidebar, click **Set provenance**
2. Enter your name and select the source origin (Manual, Import, etc.)
3. Click **Save**

### Lifecycle Flow

Every note follows this lifecycle:

```
DRAFT → IN_REVIEW → CANONICAL → ARCHIVED
                 ↘ DRAFT (rejected)
                          ARCHIVED → DRAFT (restored)
```

1. **Draft** — work in progress. Click "Submit for Review" (enter your name)
2. **In Review** — click "Approve" (enter reviewer name, must differ from author) or "Reject" (with reason)
3. **Canonical** — verified knowledge. Can be "Archived" (with reason)
4. **Archived** — can be "Restored to Draft"

### Linking Notes

The Links tab lets you connect notes:

1. Switch to the **Links** tab
2. Click **+ Add link**
3. **Search drive** — type to search existing notes by title, click to select
4. **Manual entry** — enter a title and optional document ID
5. Choose a link type:
   - **Relates to** — general connection
   - **Builds on** — extends the target
   - **Contradicts** — challenges the target
   - **Supersedes** — replaces the target
   - **Derived from** — extracted from the target

## The Processing Pipeline

The Knowledge Vault implements the **6 Rs** processing pipeline:

| Phase | What Happens | How to Trigger |
|-------|-------------|----------------|
| **Record** | Capture source material | Create a Source document |
| **Reduce** | Extract atomic claims | Use `/powerhouse-knowledge:extract` or manually create notes |
| **Reflect** | Find connections between notes | Use the Links tab or `/powerhouse-knowledge:connect` |
| **Reweave** | Update older notes with new context | Edit existing notes, add backward links |
| **Verify** | Quality check: recite + schema + health | Use `/powerhouse-knowledge:verify` |
| **Rethink** | Challenge assumptions | Review observations and tensions |

### Pipeline Dashboard

The **Pipeline** tab shows:
- Task counts by status (Pending, In Progress, Blocked, Done, Failed)
- Phase progress bars for each task
- Tasks auto-advance through phases as work is completed

## Maps of Content (MOCs)

MOCs are navigation and synthesis documents. They organize notes by topic.

### Creating a MOC

1. Click **New** → **Map of Content**
2. Fill in the form:
   - **Title** — the topic name
   - **Description** — what this topic covers
   - **Orientation** — 2-3 sentences synthesizing the topic
   - **Tier** — Hub (top-level), Domain (mid-level), or Topic (leaf)
3. Click **Create MOC**

### Managing Core Ideas

In the MOC editor:
- **Core Ideas** — add notes with a context phrase explaining why they matter in this topic
- **Tensions** — unresolved conflicts within the topic
- **Open Questions** — unexplored directions
- **Child MOCs** — link to sub-topics

## Ingesting Sources

1. Click **New** → **Source**
2. Fill in the ingest form:
   - **Title** — source name
   - **Content** — paste the full source text
   - **Type** — Article, Paper, Transcript, etc.
   - **Author/URL** — provenance info
3. Click **Ingest Source**

The source starts in **INBOX** status. Extract claims from it to create knowledge notes.

## Observations and Tensions

### Observations

Capture friction signals — things that surprised you, process improvements, quality issues:

1. Click **New** → **Observation**
2. Fill in title, description, category (Methodology, Process, Friction, Surprise, Quality)
3. Later: **Promote** to a permanent note, **Implement** in the system, or **Archive**

### Tensions

Record contradictions between claims:

1. Click **New** → **Tension**
2. Describe what's in tension and which notes are involved
3. Later: **Resolve** (with explanation) or **Dissolve** (wasn't real)

Pending observations and open tensions appear in the sidebar **Signals** tab.

## The Graph View

The **Graph** tab shows an interactive visualization of all notes and their connections:

- **Nodes** = notes, sized by link count
- **Edges** = links, colored by type
- **Status colors**: amber (Draft), blue (In Review), green (Canonical), gray (Archived)
- **Hover** to highlight connected nodes
- **Click** a node to open the note
- **Legend** at bottom shows color meanings

The graph auto-syncs via the **Graph Indexer Processor** — any changes to notes (via UI or API) are reflected in the graph.

## Vault Configuration

The VaultConfig editor (open the VaultConfig document in `/self/`) lets you configure:

- **8 Dimensions** — sliders for granularity, organization, linking, processing, navigation, maintenance, schema, automation (1-5 scale)
- **Vocabulary** — customize domain-specific terms
- **Pipeline** — processing depth, auto-chaining, extraction selectivity
- **Maintenance Thresholds** — when to trigger health checks
- **Features** — enable/disable feature blocks
- **Extraction Categories** — domain-specific claim types

## Health Reports

The **Health** tab shows the latest vault diagnostics:

- **Overall status** — PASS, WARN, or FAIL
- **Graph metrics** — note count, MOC count, density, orphans, dangling links, coverage
- **Check results** — per-category pass/warn/fail with affected items
- **Recommendations** — what to fix next

Generate health reports via the plugin: `/powerhouse-knowledge:health`

## AI Agent Integration

Install the `powerhouse-knowledge` Claude Code plugin for AI-assisted knowledge management:

```bash
claude --plugin-dir /path/to/powerhouse-knowledge
```

### Available Skills

| Skill | What it does |
|-------|-------------|
| `/powerhouse-knowledge:search <query>` | Search notes by title, type, topic |
| `/powerhouse-knowledge:extract <source>` | Extract atomic claims from source material |
| `/powerhouse-knowledge:connect <note>` | Find and create connections between notes |
| `/powerhouse-knowledge:verify <note>` | Run quality checks (recite + schema + health) |
| `/powerhouse-knowledge:health` | Generate vault health report |
| `/powerhouse-knowledge:graph` | Graph analysis (triangles, bridges, clusters) |
| `/powerhouse-knowledge:seed <source>` | Ingest source material |

## Keyboard Shortcuts

These are standard Powerhouse Connect shortcuts:
- **Ctrl+Z** — Undo last operation
- **Ctrl+Shift+Z** — Redo
- **Double-click** document name in toolbar — rename

## Revision History

Click the **clock icon** in the DocumentToolbar to see the full operation history for any document. Each revision shows:
- Operation type and timestamp
- Signature verification status
- Error status

## FAQ

**Q: Why can't I approve my own note?**
A: The self-approval guard prevents the author from approving their own work. Have a different team member (or use a different actor name) to approve.

**Q: Why is the graph empty?**
A: The graph auto-syncs when notes exist. Create at least one note with a link to see the graph populate.

**Q: Where do new notes go?**
A: Notes created via the app are placed in the drive root. You can organize them into folders using the Connect file manager. The drive auto-creates the Ars Contexta folder structure on first load.

**Q: How do I query the graph via API?**
A: The Knowledge Graph Subgraph exposes GraphQL queries at `http://localhost:4001/graphql`:
```graphql
query {
  knowledgeGraphNodes(driveId: "remote-knowledge-vault") {
    documentId
    title
    status
  }
  knowledgeGraphStats(driveId: "remote-knowledge-vault") {
    nodeCount
    edgeCount
    orphanCount
  }
}
```
