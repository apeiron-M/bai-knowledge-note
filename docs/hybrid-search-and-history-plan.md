# Hybrid Search + Knowledge History Tracking

Status: **Pending**
Created: 2026-04-05

## Part 1: Hybrid Search with Reciprocal Rank Fusion

### Problem

Currently semantic and keyword search are separate modes the user toggles between. A query like "reactor storage adapters" might miss a note titled "The Reactor is a storage node" if the user is in keyword mode (because "adapters" isn't in the title), or miss a note containing the exact phrase "PGlite adapter" if in semantic mode (because the embedding focuses on meaning not exact terms).

### Solution: Reciprocal Rank Fusion (RRF)

Run BOTH keyword and semantic search, then merge results using RRF — a simple algorithm that combines ranked lists without needing normalized scores:

```
RRF_score(doc) = Σ 1 / (k + rank_in_list)
```

Where `k` is a constant (typically 60) that prevents top-ranked items from dominating. A document appearing at rank 1 in keyword AND rank 3 in semantic gets: `1/61 + 1/63 = 0.0323`. A document at rank 1 in only keyword gets: `1/61 = 0.0164`. The combined result surfaces notes that match on both dimensions.

### Implementation

**File:** `processors/graph-indexer/query.ts`

Add `hybridSearch(query, embeddingFn, limit)` method:

```typescript
async hybridSearch(
  query: string,
  queryEmbedding: number[],
  limit = 20,
): Promise<Array<GraphNodeResult & { score: number; matchedBy: string[] }>> {
  const K = 60;

  // Run both searches in parallel
  const [keywordResults, semanticResults] = await Promise.all([
    this.fullSearch(query, limit * 2),
    this.searchByEmbedding(queryEmbedding, limit * 2),
  ]);

  // Build RRF scores
  const scores = new Map<string, { score: number; matchedBy: string[]; node: GraphNodeResult }>();

  keywordResults.forEach((node, rank) => {
    const existing = scores.get(node.documentId) ?? { score: 0, matchedBy: [], node };
    existing.score += 1 / (K + rank);
    existing.matchedBy.push("keyword");
    scores.set(node.documentId, existing);
  });

  semanticResults.forEach((result, rank) => {
    const existing = scores.get(result.documentId) ?? { score: 0, matchedBy: [], node: result };
    existing.score += 1 / (K + rank);
    if (!existing.matchedBy.includes("semantic")) existing.matchedBy.push("semantic");
    scores.set(result.documentId, existing);
  });

  // Sort by combined score, return top N
  return [...scores.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ score, matchedBy, node }) => ({ ...node, score, matchedBy }));
}
```

Note: `searchByEmbedding` is a new method that takes a pre-computed embedding vector and queries the embedding store, returning `GraphNodeResult[]`. This avoids double-embedding the query.

**File:** `subgraphs/knowledge-graph/subgraph.ts`

Add new query:

```graphql
type HybridResult {
  node: KnowledgeGraphNode!
  score: Float!
  matchedBy: [String!]!  # ["keyword", "semantic"] or just one
}

knowledgeGraphHybridSearch(driveId: ID!, query: String!, limit: Int): [HybridResult!]!
```

Resolver:
1. Generate query embedding via `generateEmbedding(query)`
2. Call `query.hybridSearch(query, embedding, limit)`
3. Return combined results with scores and match explanations

**File:** `editors/knowledge-vault/hooks/use-graph-search.ts`

Replace the mode toggle with a single "Hybrid" default mode:
- `SearchMode = "hybrid" | "semantic" | "keyword"`
- Default: `"hybrid"` — uses `knowledgeGraphHybridSearch`
- Fallbacks: `"semantic"` and `"keyword"` still available

**File:** `editors/knowledge-vault/components/SearchView.tsx`

Update the mode toggle to 3 modes. Update the result card to show `matchedBy` badges ("keyword", "semantic", or both).

### Files to modify

| File | Changes |
|------|---------|
| `processors/graph-indexer/query.ts` | Add `hybridSearch()` method |
| `processors/graph-indexer/embedding-store.ts` | Add `searchByEmbeddingRaw()` returning node results |
| `subgraphs/knowledge-graph/subgraph.ts` | Add `HybridResult` type + `knowledgeGraphHybridSearch` query |
| `editors/knowledge-vault/hooks/use-graph-search.ts` | Add hybrid mode, make it default |
| `editors/knowledge-vault/components/SearchView.tsx` | Update mode toggle, show match source badges |

---

## Part 2: Knowledge History & Evolution Tracking

### The Opportunity

Every `bai/knowledge-note` document has a complete operation history — every SET_TITLE, SET_CONTENT, ADD_LINK, SET_STATUS etc. is an immutable, append-only event with timestamp, index, hash, and signer. This is already built into Powerhouse's event sourcing architecture. The vault today doesn't surface this — you can see the current state of a note but not how it evolved.

From the knowledge vault research:
- *"Every document modification is an immutable, append-only operation that can be replayed to reconstruct state at any point in time"*
- *"Actions become operations after dispatch adding metadata: index provides ordering, hash enables integrity verification, timestamp records when"*
- *"The revision history timeline lets users navigate document history visually, putting the editor into read-only mode at a selected revision"*

### What this enables for a knowledge vault

1. **Note evolution timeline** — See how a knowledge claim changed: title refined, content expanded, links added, status promoted. "This note started as a vague observation, got connected to 5 other notes, and was promoted to CANONICAL."

2. **Knowledge graph evolution** — When was each link created? Which connections are old vs recent? Show the graph at a point in time. "Show me the graph as it was 2 weeks ago."

3. **Author contribution tracking** — Who created what, when? Activity heatmaps. "Show all notes knowledge-agent created this week."

4. **Claim provenance chain** — A note DERIVED_FROM a source → source was ingested on date X → note extracted on date Y → linked to 3 notes on date Z → promoted to CANONICAL on date W. Full lineage.

5. **Knowledge decay detection** — Notes that haven't been touched in months while related notes have evolved. "These 15 notes are stale — their neighbors have been updated but they haven't."

### Implementation approach

#### Phase A: Index operation history in the processor

**New table: `graph_operations`**

```sql
CREATE TABLE graph_operations (
  id VARCHAR(255) PRIMARY KEY,
  document_id VARCHAR(255) NOT NULL,
  operation_type VARCHAR(100) NOT NULL,   -- SET_TITLE, ADD_LINK, SET_STATUS, etc.
  timestamp VARCHAR(50) NOT NULL,
  index INTEGER NOT NULL,
  scope VARCHAR(20) NOT NULL,             -- global, local
  summary TEXT,                           -- human-readable: "Title changed to '...'"
  input_json TEXT                         -- the operation input as JSON
);
CREATE INDEX idx_graph_ops_doc ON graph_operations(document_id);
CREATE INDEX idx_graph_ops_timestamp ON graph_operations(timestamp);
CREATE INDEX idx_graph_ops_type ON graph_operations(operation_type);
```

**Processor change:** In `onOperations()`, instead of only keeping the last operation per document, also insert each operation into `graph_operations` with a human-readable summary.

Summary generation logic:
- `SET_TITLE` → "Title changed to '{input.title}'"
- `SET_CONTENT` → "Content updated ({length} chars)"
- `ADD_LINK` → "Linked to '{input.targetTitle}' ({input.linkType})"
- `REMOVE_LINK` → "Removed link to '{input.targetTitle}'"
- `SET_STATUS` → "Status changed to {input.status}"
- `ADD_TOPIC` → "Added topic #{input.name}"
- `SET_PROVENANCE` → "Provenance set: {input.author}, {input.sourceOrigin}"

#### Phase B: New subgraph queries

```graphql
type OperationRecord {
  id: String!
  documentId: String!
  operationType: String!
  timestamp: String!
  index: Int!
  summary: String
}

# History of a single note
knowledgeGraphHistory(driveId: ID!, documentId: String!, limit: Int): [OperationRecord!]!

# Recent activity across all notes
knowledgeGraphActivity(driveId: ID!, limit: Int, since: String): [OperationRecord!]!

# Activity by operation type (e.g., all ADD_LINK operations)
knowledgeGraphActivityByType(driveId: ID!, operationType: String!, limit: Int): [OperationRecord!]!

# Stale notes — notes not modified since a given date while neighbors have been
knowledgeGraphStale(driveId: ID!, since: String!, limit: Int): [KnowledgeGraphNode!]!
```

#### Phase C: Editor integration

**Note History panel** — In the knowledge-note-editor, add a "History" tab showing the note's operation timeline. Each entry shows: timestamp, operation type, summary. Clicking an entry could use the existing `useDocumentOperations(documentId)` hook + revision timeline to show the note at that point in time.

**Vault Activity feed** — In the vault drive-app, add an "Activity" tab (or section in the existing Health tab) showing recent operations across all notes. Filter by operation type, author, date range.

**Graph time-travel** — In GraphView, add a date slider. The subgraph would filter `graph_operations` to reconstruct which nodes and edges existed at that date. This is the most complex feature but the most powerful.

### Existing hooks to reuse

| Hook | From | Purpose |
|------|------|---------|
| `useDocumentOperations(documentId)` | `@powerhousedao/reactor-browser` | Fetch full operation list for a document |
| `useSelectedTimelineRevision` | `@powerhousedao/reactor-browser` | Get/set the currently selected revision |
| `setRevisionHistoryVisible` | `@powerhousedao/reactor-browser` | Show/hide the revision history panel |
| `useTimelineItems(documentId)` | `@powerhousedao/common` | Get timeline candle data for visualization |

### Files to create/modify

| File | Changes |
|------|---------|
| `processors/graph-indexer/schema.ts` | Add `GraphOperation` interface, add to `DB` |
| `processors/graph-indexer/migrations.ts` | Add `graph_operations` table + indexes |
| `processors/graph-indexer/index.ts` | Index operations with summaries in `onOperations()` |
| `processors/graph-indexer/query.ts` | Add `history()`, `activity()`, `activityByType()`, `staleNodes()` |
| `subgraphs/knowledge-graph/subgraph.ts` | Add `OperationRecord` type + 4 new queries |
| `editors/knowledge-vault/hooks/use-graph-search.ts` | Add hybrid mode |
| `editors/knowledge-vault/components/SearchView.tsx` | Update for hybrid results |

---

## Implementation Order

```
Part 1: Hybrid Search (can ship independently)
  1a. Add hybridSearch to query layer
  1b. Add searchByEmbeddingRaw to embedding-store
  1c. Add knowledgeGraphHybridSearch to subgraph
  1d. Make hybrid the default in the editor
  1e. Update SearchView UI

Part 2: Knowledge History (can ship independently, phased)
  Phase A: Index operations (processor + migrations)
  Phase B: Subgraph queries (history, activity, stale)
  Phase C: Editor integration (history panel, activity feed)
  Phase D: Graph time-travel (advanced, date slider on GraphView)
```

## Verification

```bash
bun tsc --noEmit
bun eslint processors/ subgraphs/ editors/knowledge-vault/

# Part 1
switchboard query '{ knowledgeGraphHybridSearch(driveId: "<UUID>", query: "reactor storage") { node { title } score matchedBy } }'

# Part 2
switchboard query '{ knowledgeGraphHistory(driveId: "<UUID>", documentId: "<NOTE-ID>", limit: 20) { operationType timestamp summary } }'
switchboard query '{ knowledgeGraphActivity(driveId: "<UUID>", limit: 10) { documentId operationType summary timestamp } }'
switchboard query '{ knowledgeGraphStale(driveId: "<UUID>", since: "2026-03-01") { title documentId } }'
```
