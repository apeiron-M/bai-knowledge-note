# Switchboard CLI Bugs & Gaps for Knowledge Vault

Issues discovered during end-to-end testing of the Knowledge Vault plugin with the switchboard CLI (v1.0.6).

---

## Bug 1: `docs create` times out on schema introspection

**Severity:** High — blocks primary document creation flow

**Steps to reproduce:**
```bash
switchboard docs create --type bai/source --name "Test Source" --drive cli-vault
```

**Expected:** Creates the document and returns its ID.

**Actual:** Times out with `Error: Failed to connect to http://localhost:4001/graphql: operation timed out`

**Notes:** `switchboard ping` returns 11ms, so the connection is fine. The timeout happens during schema introspection for the document type, not the actual creation. Likely the introspection query for bai/* models is too heavy or hits a slow path.

**Workaround:** Use MCP HTTP endpoint for creation:
```bash
curl -s -X POST http://localhost:4001/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"createDocument","arguments":{"documentType":"bai/source","driveId":"<uuid>","name":"Test","parentFolder":"<folder>"}},"id":1}'
```

---

## Bug 2: `models list` shows `powerhouse/*` prefix instead of `bai/*`

**Severity:** Medium — confusing, causes wrong type names in commands

**Steps to reproduce:**
```bash
switchboard models list --format json
```

**Expected:** Shows `bai/source`, `bai/knowledge-note`, etc. (matching the document model JSON files)

**Actual:** Shows `powerhouse/source`, `powerhouse/knowledge-note`, etc.

**Notes:** The document-model JSON files define `"id": "bai/source"`, MCP tools use `bai/source` successfully, and the drive tree shows `bai/source`. Only the CLI `models list` shows `powerhouse/*`. Likely the CLI reads from a different schema endpoint or normalizes the prefix.

---

## Bug 3: `createEmptyDocument` + `ADD_FILE` creates ghost nodes

**Severity:** High — documents invisible in Connect

**Steps to reproduce:**
```bash
# Create standalone document
DOC_ID=$(curl -s http://localhost:4001/graphql/r/ \
  -H "Content-Type: application/json" \
  -d '{"query":"mutation { createEmptyDocument(documentType: \"bai/source\") { id } }"}' \
  | node -p "JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).data.createEmptyDocument.id")

# Add to drive
switchboard docs apply <drive-id> --wait --actions '[{"type":"ADD_FILE","input":{"id":"'$DOC_ID'","name":"Test","documentType":"bai/source","parentFolder":"<folder>"},"scope":"global"}]'
```

**Expected:** Document appears in Connect and CLI tree.

**Actual:** CLI tree shows the document. Connect doesn't — the document is a ghost node. Connect's PGLite never fetched the standalone document because it wasn't linked atomically during creation.

**Root cause:** `createEmptyDocument` creates a document without drive linkage. `ADD_FILE` adds a file node to the drive, but Connect's sync doesn't know to fetch the standalone document.

**Fix needed:** The CLI's `docs create --drive <slug>` should do atomic creation (like MCP `createDocument` with `driveId`), not `createEmptyDocument` + `ADD_FILE`.

---

## Bug 4: `docs create --drive` doesn't support `--parent-folder`

**Severity:** Medium — can't place documents in subfolders via CLI

**Steps to reproduce:**
```bash
switchboard docs create --type bai/knowledge-note --name "Test" --drive cli-vault --parent-folder <folder-uuid>
```

**Expected:** Creates document in the specified folder.

**Actual:** `--parent-folder` flag doesn't exist. Documents can only be created at the drive root via CLI, then moved manually.

**Fix needed:** Add `--parent-folder <UUID>` option to `docs create`.

---

## Bug 5: Rapid `ADD_FOLDER` / `ADD_FILE` operations produce null `action.id` in sync stream

**Severity:** Critical — breaks Connect sync entirely

**Steps to reproduce:**
1. Create a drive with `knowledge-vault` editor
2. Open in Connect — auto-init creates 12 folders + 4 singletons rapidly
3. Sync the drive to a remote Switchboard
4. Open in Connect on another machine — sync fails with:
```
Cannot return null for non-nullable field Action.id
```

**Root cause:** When Connect dispatches `addFolder()` / `addDocument()` rapidly from React hooks, some operations get stored with `action.id: null` in the operation log. When these operations sync to a remote Switchboard, the GraphQL schema rejects them because `Action.id` is non-nullable.

**Affected operations:** `ADD_FOLDER`, `ADD_FILE` on the drive document, dispatched from `@powerhousedao/reactor-browser`'s `addFolder()` and `addDocument()` functions.

**Workaround:** Add 500ms+ delays between each operation (we did this in `use-drive-init.ts`). This reduces but may not eliminate the issue.

**Fix needed:** Ensure every operation stored in the operation log has a non-null `action.id`, regardless of dispatch timing.

---

## Bug 6: `docs tree --format json` doesn't return folder IDs in a usable format

**Severity:** Low — forces using GraphQL for folder ID lookup

**Steps to reproduce:**
```bash
switchboard docs tree cli-vault --format json
```

**Expected:** JSON with folder IDs easily extractable (e.g., `{"id": "...", "name": "sources", "kind": "folder"}`).

**Actual:** Returns a nested document tree structure that's hard to parse for folder IDs. The flat node list from the drive state (via GraphQL) is more useful for scripting.

**Workaround:** Use GraphQL directly:
```bash
curl -s http://localhost:4001/graphql/r/ -H "Content-Type: application/json" \
  -d '{"query":"query { document(identifier: \"<drive-uuid>\") { document { state } } }"}'
```

---

## Bug 7: `docs apply` reverses operation order for dependent actions

**Severity:** High — breaks any reducer with sequential dependencies

**Steps to reproduce:**
```bash
switchboard docs apply <pipeline-queue-id> --wait --actions '[
  {"type":"ADD_TASK","input":{"id":"task-1",...},"scope":"global"},
  {"type":"ASSIGN_TASK","input":{"taskId":"task-1",...},"scope":"global"},
  {"type":"ADVANCE_PHASE","input":{"taskId":"task-1",...},"scope":"global"}
]'
```

**Expected:** Operations execute in array order: ADD_TASK first, then ASSIGN_TASK, then ADVANCE_PHASE.

**Actual:** Operations are stored in reversed order. ASSIGN_TASK and ADVANCE_PHASE execute before ADD_TASK, causing "Task not found" errors because the task doesn't exist yet.

**Visible in Connect:** Revision history shows ADD_TASK at the highest revision number (last) and ASSIGN_TASK at the lowest (first). All dependent operations have `Error: Task not found`.

**Root cause:** The batch submission stores operations with reversed indices, or the reactor processes them in LIFO order instead of FIFO.

**Workaround:** Dispatch dependent operations **one at a time** via `docs mutate`:
```bash
switchboard docs mutate <id> --op addTask --input '{...}'
switchboard docs mutate <id> --op assignTask --input '{...}'
switchboard docs mutate <id> --op advancePhase --input '{...}'
```

**Note:** `docs apply` is safe for **independent** actions on the same document (e.g., SET_TITLE + SET_DESCRIPTION + SET_CONTENT). Only fails when later actions depend on earlier ones creating state.

---

## Summary

| Bug | Severity | Blocks | Workaround |
|-----|----------|--------|------------|
| `docs create` timeout | High | CLI doc creation | Use MCP HTTP |
| `models list` wrong prefix | Medium | Confusion | Use `bai/*` in MCP |
| Ghost nodes from `createEmpty` + `ADD_FILE` | High | Connect visibility | Use MCP `createDocument` |
| No `--parent-folder` on create | Medium | Folder placement | Use MCP HTTP |
| Null `action.id` in sync | Critical | Remote sync | Add delays |
| `docs tree --format json` | Low | Scripting | Use GraphQL |

---

## How MCP Fixes It: Atomic Document Creation

The MCP `createDocument` tool uses `createDocumentInDrive` from `@powerhousedao/reactor`, which executes document creation and drive linking as a single atomic batch. This is the pattern the CLI should replicate.

### MCP Tool Handler

**File:** `@powerhousedao/reactor-mcp/dist/src/tools/reactor.js` (lines 314-329)

```javascript
createDocument: toolWithCallback(createDocumentTool, async (params) => {
    if (params.driveId) {
        const module = await getDocumentModelModule(params.documentType);
        if (!module) {
            throw new Error(`Document model for type '${params.documentType}' not found`);
        }
        const document = module.utils.createDocument();
        if (params.name) {
            document.header.name = params.name;
        }
        const created = await client.createDocumentInDrive(
            params.driveId,
            document,
            params.parentFolder
        );
        return { documentId: created.header.id };
    }
    // Fallback: standalone document (no drive)
    const created = await client.createEmpty(params.documentType, {});
    return { documentId: created.header.id };
})
```

When `driveId` is provided:
1. Loads the document model module for the type
2. Creates a fresh document instance via `module.utils.createDocument()`
3. Sets the name on the header
4. Calls `client.createDocumentInDrive()` with the drive ID and optional parent folder

### The Atomic `createDocumentInDrive` Method

**File:** `@powerhousedao/reactor/dist/src/index.js` (lines 511-579)

```javascript
async createDocumentInDrive(driveId, document, parentFolder, signal) {
    const documentId = document.header.id;

    const createInput = {
        model: document.header.documentType,
        version: 0,
        documentId: document.header.id,
        signing: {
            nonce: "",
            publicKey: {},
            signature: document.header.id,
            documentType: document.header.documentType,
            createdAtUtcIso: new Date().toISOString()
        },
        slug: document.header.slug,
        name: document.header.name,
        branch: document.header.branch,
        meta: document.header.meta,
        protocolVersions: document.header.protocolVersions ?? { "base-reducer": 2 }
    };

    // ── Job 1: Create the document itself ──
    const documentActions = await signActions([
        createDocumentAction(createInput),
        upgradeDocumentAction({
            model: document.header.documentType,
            documentId,
            fromVersion: 0,
            toVersion: /* spec version */,
            initialState: /* from document model */
        }),
        addRelationshipAction(driveId, documentId, "child")
    ], this.signer, signal);

    // ── Job 2: Add file node to the drive ──
    const driveActions = await signActions([
        addFile({
            id: documentId,
            name: document.header.name || documentId,
            documentType: document.header.documentType,
            parentFolder    // ← folder placement happens here
        })
    ], this.signer, signal);

    // ── Execute BOTH atomically via batch ──
    const batchResult = await this.reactor.executeBatch({
        jobs: [
            {
                key: "document",
                documentId,
                scope: getSharedActionScope(documentActions),
                branch: "main",
                actions: documentActions,
                dependsOn: []           // ← runs first
            },
            {
                key: "drive",
                documentId: driveId,
                scope: getSharedActionScope(driveActions),
                branch: "main",
                actions: driveActions,
                dependsOn: ["document"]  // ← runs AFTER document created
            }
        ]
    }, signal);

    // Wait for both jobs to complete
    const completedJobs = await Promise.all(
        Object.values(batchResult.jobs).map(
            (job) => this.waitForJob(job, signal)
        )
    );

    // Check for errors
    for (const job of completedJobs) {
        if (job.status === "FAILED") {
            throw new Error(job.error?.message);
        }
    }

    return this.reactor.get(documentId);
}
```

### Why This Works

1. **`executeBatch`** ensures both jobs succeed or both fail — no ghost nodes possible
2. **Dependency ordering** (`dependsOn: ["document"]`) — the drive's `ADD_FILE` only executes after the document exists
3. **All actions are signed** with proper `action.id` values via `signActions()` — no null IDs in sync stream
4. **Single batch** — Connect's sync sees one atomic operation, not two separate mutations that can race

### Why `createEmptyDocument` + `ADD_FILE` Breaks

```
createEmptyDocument → creates document (standalone, no drive link)
                      ↓
ADD_FILE on drive    → creates file node pointing to document ID
                      ↓
Connect sync         → sees file node, but never fetched the standalone document
                      → ghost node: file reference exists, document invisible
```

The two operations are not linked. The reactor doesn't know they're related. Connect's PGLite only tracks documents that were created through proper drive linkage.

### What the CLI Needs

The CLI's `docs create --drive <slug> --parent-folder <uuid>` should:

1. **Load the document model** for the type (same as MCP does)
2. **Create a document instance** via `module.utils.createDocument()`
3. **Call `createDocumentInDrive`** on the reactor client (or the equivalent GraphQL mutation that triggers `executeBatch`)
4. **Return the document ID**

This is essentially the same code path as the MCP handler — the CLI just needs to call the same reactor client method instead of doing `createEmptyDocument` + separate `ADD_FILE`.

### Alternative: GraphQL Batch Mutation

If the CLI can't call the reactor client directly, expose `createDocumentInDrive` as a GraphQL mutation:

```graphql
mutation CreateDocumentInDrive(
    $documentType: String!
    $driveId: String!
    $name: String
    $parentFolder: String
) {
    createDocumentInDrive(
        documentType: $documentType
        driveId: $driveId
        name: $name
        parentFolder: $parentFolder
    ) {
        id
        documentType
        name
    }
}
```

This would let the CLI (and any HTTP client) do atomic creation without needing direct reactor client access.
