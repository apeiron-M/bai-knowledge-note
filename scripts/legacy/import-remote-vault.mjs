#!/usr/bin/env node
/**
 * Import documents from an exported vault backup (scripts/remote-knowledge-vault/)
 * into a new drive via local MCP.
 *
 * Recreates:
 *   1. Folder structure
 *   2. Singleton documents (vault-config, knowledge-graph, health-report, pipeline-queue)
 *   3. Knowledge notes (with all state: title, content, topics, metadata, provenance)
 *   4. MOCs (with core ideas, tensions, child refs)
 *   5. Sources (with content, provenance, extraction stats)
 *   6. Inter-document links (resolved via old→new ID mapping)
 *
 * Usage:
 *   node scripts/import-remote-vault.mjs --drive-id <UUID> [--dry-run] [--limit N] [--backup-dir <path>]
 *
 * Requires: ph vetra running on localhost:4001
 */

import fs from "node:fs";
import path from "node:path";
import { verifyDriveNodes } from "./verify-drive-nodes.mjs";

// ─── CLI Args ───
const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const limitIdx = args.indexOf("--limit");
const LIMIT = limitIdx !== -1 ? parseInt(args[limitIdx + 1], 10) : Infinity;

function getArg(name, fallback) {
  const idx = args.indexOf(name);
  return idx !== -1 ? args[idx + 1] : fallback;
}

const DRIVE_ID = getArg("--drive-id", null);
const BACKUP_DIR = getArg(
  "--backup-dir",
  path.join(path.dirname(new URL(import.meta.url).pathname), "remote-knowledge-vault"),
);
const MCP_URL = "http://localhost:4001/mcp";

// --skip-types <comma-list>: skip docs of these types entirely.
// Useful when the target drive already has singletons (from useDriveInit)
// or when we want to exclude problematic types like bai/source until
// schema-drift is resolved.
const SKIP_TYPES = new Set(
  (getArg("--skip-types", "") || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);

// --throttle <ms>: sleep between each operation. Higher values give the
// reactor (and Connect's polling channel) time to digest each batch
// before the next lands, which avoids overwhelming the outbox queue when
// importing hundreds of docs. Default 250ms — bump to 500-1000 for very
// slow targets or when Connect's IndexedDB sync seems to be stalling.
const THROTTLE_MS = parseInt(getArg("--throttle", "250"), 10) || 250;

if (!DRIVE_ID) {
  console.error(
    "Usage: node import-remote-vault.mjs --drive-id <UUID> [--dry-run] [--limit N] [--backup-dir <path>] [--skip-types <type1,type2,...>]",
  );
  process.exit(1);
}

if (SKIP_TYPES.size > 0) {
  console.log(`Skipping types: ${[...SKIP_TYPES].join(", ")}\n`);
}

// ─── MCP HTTP Client ───
let mcpRequestId = 0;

async function mcpCall(toolName, toolArgs) {
  const res = await fetch(MCP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "tools/call",
      params: { name: toolName, arguments: toolArgs },
      id: ++mcpRequestId,
    }),
  });

  const text = await res.text();
  const dataMatch = text.match(/^data:\s*(.+)$/m);
  if (!dataMatch) throw new Error(`MCP ${toolName}: no data in response`);

  const json = JSON.parse(dataMatch[1]);
  if (json.error) throw new Error(`MCP ${toolName}: ${json.error.message}`);

  const result = json.result;
  if (result?.structuredContent) return result.structuredContent;
  if (result?.content?.[0]?.text) return JSON.parse(result.content[0].text);
  return result;
}

// ─── Helpers ───
let idCounter = 0;
function generateId() {
  return `restore-${Date.now()}-${++idCounter}`;
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

// ─── Build actions from exported state ───

function buildKnowledgeNoteActions(state) {
  const g = state.global;
  const now = new Date().toISOString();
  const actions = [];

  if (g.title) {
    actions.push({
      type: "SET_TITLE",
      input: { title: g.title, updatedAt: g.provenance?.createdAt ?? now },
      scope: "global",
    });
  }
  if (g.description) {
    actions.push({
      type: "SET_DESCRIPTION",
      input: { description: g.description, updatedAt: now },
      scope: "global",
    });
  }
  if (g.noteType) {
    actions.push({
      type: "SET_NOTE_TYPE",
      input: { noteType: g.noteType, updatedAt: now },
      scope: "global",
    });
  }
  if (g.content) {
    actions.push({
      type: "SET_CONTENT",
      input: { content: g.content, updatedAt: now },
      scope: "global",
    });
  }
  if (g.status && g.status !== "DRAFT") {
    actions.push({
      type: "SET_STATUS",
      input: { status: g.status },
      scope: "global",
    });
  }
  if (g.provenance) {
    actions.push({
      type: "SET_PROVENANCE",
      input: {
        author: g.provenance.author ?? null,
        sourceOrigin: g.provenance.sourceOrigin ?? null,
        createdAt: g.provenance.createdAt ?? now,
      },
      scope: "global",
    });
  }

  // Topics
  for (const topic of g.topics ?? []) {
    const name = typeof topic === "string" ? topic : topic.name;
    if (name) {
      actions.push({
        type: "ADD_TOPIC",
        input: { id: generateId(), name },
        scope: "global",
      });
    }
  }

  // Metadata fields (string fields)
  const metadataFields = [
    "scope", "confidence", "severity", "editor", "modelId", "model",
    "version", "filePath", "computes", "context", "decisionStatus",
    "sourceType", "targetType", "relationType", "cardinality",
    "errorMessage", "rootCause", "correctPattern",
  ];
  for (const field of metadataFields) {
    if (g[field]) {
      actions.push({
        type: "SET_METADATA_FIELD",
        input: { field, value: g[field], updatedAt: now },
        scope: "global",
      });
    }
  }

  // Metadata list fields
  const listFields = [
    "modules", "models", "hooksUsed", "dispatchTargets",
    "inputs", "outputs", "consumedBy", "alternatives", "consequences",
  ];
  for (const field of listFields) {
    if (g[field] && Array.isArray(g[field]) && g[field].length > 0) {
      actions.push({
        type: "SET_METADATA_LIST_FIELD",
        input: { field, values: g[field], updatedAt: now },
        scope: "global",
      });
    }
  }

  // Links are handled in pass 2 (need old→new ID mapping)
  return actions;
}

function buildMocActions(state) {
  const g = state.global;
  const now = new Date().toISOString();
  const actions = [];

  actions.push({
    type: "CREATE_MOC",
    input: {
      title: g.title ?? "Untitled MOC",
      description: g.description ?? "",
      orientation: g.orientation ?? "",
      tier: g.tier ?? "TOPIC",
      parentRef: g.parentRef ?? null,
      createdAt: g.createdAt ?? now,
    },
    scope: "global",
  });

  // Core ideas are handled in pass 2 (need ID mapping)
  // Open questions
  for (const q of g.openQuestions ?? []) {
    actions.push({
      type: "ADD_OPEN_QUESTION",
      input: { question: q },
      scope: "global",
    });
  }

  return actions;
}

function buildSourceActions(state) {
  const g = state.global;
  const now = new Date().toISOString();
  const actions = [];

  if (g.title || g.content) {
    actions.push({
      type: "INGEST_SOURCE",
      input: {
        title: g.title ?? "Untitled",
        content: g.content ?? "",
        sourceType: g.sourceType ?? "ARTICLE",
        description: g.description ?? undefined,
        author: g.provenance?.author ?? undefined,
        url: g.provenance?.url ?? undefined,
        createdAt: g.createdAt ?? now,
        createdBy: g.createdBy ?? undefined,
      },
      scope: "global",
    });
  }

  if (g.status && g.status !== "INBOX") {
    actions.push({
      type: "SET_SOURCE_STATUS",
      input: { status: g.status },
      scope: "global",
    });
  }

  // Extracted claims
  for (const ref of g.extractedClaims ?? []) {
    actions.push({
      type: "ADD_EXTRACTED_CLAIM",
      input: { claimRef: ref },
      scope: "global",
    });
  }

  if (g.extractionStats) {
    actions.push({
      type: "RECORD_EXTRACTION_STATS",
      input: {
        claimCount: g.extractionStats.claimCount ?? 0,
        skippedCount: g.extractionStats.skippedCount ?? 0,
        skipRate: g.extractionStats.skipRate ?? 0,
      },
      scope: "global",
    });
  }

  return actions;
}

// ─── Main ───
async function main() {
  console.log(`\n=== Import Remote Vault Backup ===`);
  console.log(`Backup dir:  ${BACKUP_DIR}`);
  console.log(`Drive ID:    ${DRIVE_ID}`);
  console.log(`Dry run:     ${DRY_RUN}`);
  console.log(`Limit:       ${LIMIT === Infinity ? "none" : LIMIT}\n`);

  // Load manifest
  const manifest = readJson(path.join(BACKUP_DIR, "manifest.json"));
  console.log(`Backup from: ${manifest.exportedAt}`);
  console.log(`Original:    ${manifest.driveName} (${manifest.driveId})`);
  console.log(`Documents:   ${manifest.totalDocuments}\n`);

  // ─── Phase 0: Recreate folder structure ───
  console.log("=== Phase 0: Creating folder structure ===\n");

  const oldFolderIdToNew = new Map();
  const folderStructure = manifest.folderStructure;

  // Topo-sort: root folders first, then descendants. Track sorted-ids
  // separately so each batch sees the previous batch as "done" — without
  // this, only root folders make it through (every nested folder becomes
  // a false orphan because its parent's id isn't yet in the map).
  const sorted = [];
  const sortedIds = new Set();
  const remaining = [...folderStructure];
  while (remaining.length > 0) {
    const batch = remaining.filter(
      (f) => f.parentFolder === null || sortedIds.has(f.parentFolder),
    );
    if (batch.length === 0) {
      console.warn(`  Circular/orphan folders: ${remaining.map((f) => f.name).join(", ")}`);
      break;
    }
    sorted.push(...batch);
    for (const b of batch) {
      sortedIds.add(b.id);
      remaining.splice(remaining.indexOf(b), 1);
    }
  }

  // Cache the drive's existing folders ONCE so we can match-and-reuse by
  // (name, parentFolder) instead of always creating a new one. Without
  // this, useDriveInit-seeded folders get duplicated as `<name> (copy) 1`.
  let liveFolders = [];
  if (!DRY_RUN) {
    try {
      const driveDoc = await mcpCall("getDocument", { id: DRIVE_ID });
      liveFolders = (driveDoc?.document?.state?.global?.nodes ?? []).filter(
        (n) => n.kind === "folder",
      );
    } catch {
      // empty drive — fine, liveFolders stays []
    }
  }

  for (const folder of sorted) {
    const parentId = folder.parentFolder
      ? oldFolderIdToNew.get(folder.parentFolder)
      : undefined;

    if (DRY_RUN) {
      oldFolderIdToNew.set(folder.id, `dry-folder-${folder.name}`);
      console.log(`  Would create folder: ${folder.name}`);
      continue;
    }

    // Match-and-reuse: if a folder of this name already exists with the
    // matching parent, take its id and skip creation.
    const existing = liveFolders.find(
      (n) =>
        n.name === folder.name &&
        ((parentId ?? null) === (n.parentFolder ?? null)),
    );
    if (existing) {
      oldFolderIdToNew.set(folder.id, existing.id);
      console.log(`  Reused folder:  ${folder.name} → ${existing.id}`);
      continue;
    }

    try {
      const actions = [
        {
          type: "ADD_FOLDER",
          input: {
            id: generateId(),
            name: folder.name,
            ...(parentId ? { parentFolder: parentId } : {}),
          },
          scope: "global",
        },
      ];
      await mcpCall("addActions", {
        documentId: DRIVE_ID,
        actions,
      });

      // Refresh drive to find the new folder's id (and update the cache
      // so subsequent matches see it).
      const driveDoc = await mcpCall("getDocument", { id: DRIVE_ID });
      liveFolders = (driveDoc?.document?.state?.global?.nodes ?? []).filter(
        (n) => n.kind === "folder",
      );
      const newFolder = liveFolders.find(
        (n) =>
          n.name === folder.name &&
          ((parentId ?? null) === (n.parentFolder ?? null)),
      );

      if (newFolder) {
        oldFolderIdToNew.set(folder.id, newFolder.id);
        console.log(`  Created folder: ${folder.name} → ${newFolder.id}`);
      } else {
        console.warn(`  Folder created but ID not found: ${folder.name}`);
      }
      await delay(300);
    } catch (err) {
      console.error(`  Failed to create folder ${folder.name}: ${err.message}`);
    }
  }

  console.log(`\nFolders: ${oldFolderIdToNew.size}/${folderStructure.length}\n`);

  // ─── Phase 1: Create documents ───
  console.log("=== Phase 1: Creating documents ===\n");

  const oldIdToNew = new Map();
  const linkQueue = []; // {newDocId, links: [{targetOldId, linkType, targetTitle}]}
  const mocCoreIdeaQueue = []; // {newDocId, coreIdeas: [{noteRef(old), contextPhrase, sortOrder}], childRefs: [oldId]}

  // Incremental mode: load id-mapping.json from a previous run so we can
  // skip docs already imported and still resolve their links in Phase 2.
  // The map is preserved verbatim and merged with newly-created docs.
  const idMapPath = path.join(BACKUP_DIR, "id-mapping.json");
  let preExistingCount = 0;
  if (fs.existsSync(idMapPath)) {
    try {
      const existing = readJson(idMapPath);
      for (const [oldId, newId] of Object.entries(existing)) {
        if (typeof newId === "string" && newId.length > 0 && !newId.startsWith("dry-")) {
          oldIdToNew.set(oldId, newId);
          preExistingCount++;
        }
      }
      if (preExistingCount > 0) {
        console.log(`Loaded ${preExistingCount} pre-existing mapping(s) from previous run; will skip those docs.\n`);
      }
    } catch (err) {
      console.warn(`Could not read existing id-mapping.json: ${err.message}\n`);
    }
  }

  // Process order: singletons → knowledge-notes → sources → mocs.
  // Drop the always-skip drive doc plus anything in --skip-types (e.g.
  // singletons when target was created via Connect's useDriveInit, or
  // bai/source while INGEST_SOURCE schema-drift is unresolved).
  const docEntries = manifest.documents.filter(
    (d) =>
      d.documentType !== "powerhouse/document-drive" &&
      !SKIP_TYPES.has(d.documentType),
  );
  const orderedEntries = [
    ...docEntries.filter((d) => ["bai/knowledge-graph", "bai/vault-config", "bai/health-report", "bai/pipeline-queue"].includes(d.documentType)),
    ...docEntries.filter((d) => d.documentType === "bai/knowledge-note"),
    ...docEntries.filter((d) => d.documentType === "bai/source"),
    ...docEntries.filter((d) => d.documentType === "bai/research-claim"),
    ...docEntries.filter((d) => d.documentType === "bai/observation"),
    ...docEntries.filter((d) => d.documentType === "bai/tension"),
    ...docEntries.filter((d) => d.documentType === "bai/derivation"),
    ...docEntries.filter((d) => d.documentType === "bai/moc"),
  ].slice(0, LIMIT);

  const results = { success: 0, failed: 0, errors: [] };

  for (let i = 0; i < orderedEntries.length; i++) {
    const entry = orderedEntries[i];
    const progress = `[${i + 1}/${orderedEntries.length}]`;

    // Read exported document
    const docPath = path.join(BACKUP_DIR, entry.subfolder, entry.filename);
    if (!fs.existsSync(docPath)) {
      console.error(`${progress} MISSING FILE: ${docPath}`);
      results.failed++;
      continue;
    }

    const doc = readJson(docPath);
    const state = doc.state;

    // Incremental skip: if a previous run already mapped this old id to a
    // new one, don't try to create it again. We still queue its links so
    // Phase 2 can re-resolve them against the now-larger map.
    const alreadyImported = oldIdToNew.has(doc.id);
    if (alreadyImported) {
      if (entry.documentType === "bai/knowledge-note" && state.global?.links?.length > 0) {
        linkQueue.push({
          oldDocId: doc.id,
          links: state.global.links.map((l) => ({
            targetOldId: l.targetDocumentId,
            linkType: l.linkType ?? "RELATES_TO",
            targetTitle: l.targetTitle ?? null,
          })),
        });
      }
      if (entry.documentType === "bai/moc") {
        const coreIdeas = (state.global?.coreIdeas ?? []).map((ci) => ({
          noteRef: ci.noteRef,
          contextPhrase: ci.contextPhrase ?? null,
          sortOrder: ci.sortOrder ?? 0,
          addedAt: ci.addedAt ?? new Date().toISOString(),
        }));
        const childRefs = state.global?.childRefs ?? [];
        if (coreIdeas.length > 0 || childRefs.length > 0) {
          mocCoreIdeaQueue.push({
            oldDocId: doc.id,
            coreIdeas,
            childRefs,
          });
        }
      }
      console.log(`${progress} SKIP (already imported): ${entry.name}`);
      results.success++;
      continue;
    }

    // Determine parent folder in new drive
    const oldParentFolder = entry.parentFolder;
    const newParentFolder = oldParentFolder
      ? oldFolderIdToNew.get(oldParentFolder)
      : undefined;

    // Build actions based on document type
    let actions;
    try {
      switch (entry.documentType) {
        case "bai/knowledge-note":
          actions = buildKnowledgeNoteActions(state);
          // Queue links for pass 2
          if (state.global?.links?.length > 0) {
            linkQueue.push({
              oldDocId: doc.id,
              links: state.global.links.map((l) => ({
                targetOldId: l.targetDocumentId,
                linkType: l.linkType ?? "RELATES_TO",
                targetTitle: l.targetTitle ?? null,
              })),
            });
          }
          break;
        case "bai/moc":
          actions = buildMocActions(state);
          // Queue core ideas + child refs for pass 2
          const coreIdeas = (state.global?.coreIdeas ?? []).map((ci) => ({
            noteRef: ci.noteRef,
            contextPhrase: ci.contextPhrase ?? null,
            sortOrder: ci.sortOrder ?? 0,
            addedAt: ci.addedAt ?? new Date().toISOString(),
          }));
          const childRefs = state.global?.childRefs ?? [];
          if (coreIdeas.length > 0 || childRefs.length > 0) {
            mocCoreIdeaQueue.push({
              oldDocId: doc.id,
              coreIdeas,
              childRefs,
            });
          }
          break;
        case "bai/source":
          actions = buildSourceActions(state);
          break;
        default:
          // For singletons and other types, skip content actions
          // (they'll be initialized by the drive init hook)
          actions = [];
          break;
      }
    } catch (err) {
      console.error(`${progress} ACTION BUILD ERROR: ${entry.name} — ${err.message}`);
      results.failed++;
      continue;
    }

    if (DRY_RUN) {
      oldIdToNew.set(doc.id, `dry-${i}`);
      console.log(
        `${progress} ${entry.documentType} — ${entry.name} (${actions.length} actions)`,
      );
      results.success++;
      continue;
    }

    try {
      // Create document via MCP
      const createArgs = {
        documentType: entry.documentType,
        driveId: DRIVE_ID,
        name: entry.name,
      };
      if (newParentFolder) createArgs.parentFolder = newParentFolder;

      const createResult = await mcpCall("createDocument", createArgs);
      const newDocId = createResult.documentId;

      if (!newDocId) {
        console.error(`${progress} CREATE FAILED: ${entry.name}`);
        results.failed++;
        continue;
      }

      oldIdToNew.set(doc.id, newDocId);

      // Apply actions
      if (actions.length > 0) {
        await mcpCall("addActions", { documentId: newDocId, actions });
      }

      console.log(
        `${progress} ${entry.documentType} — ${entry.name} → ${newDocId}`,
      );
      results.success++;
      await delay(THROTTLE_MS);
    } catch (err) {
      console.error(`${progress} ERROR: ${entry.name} — ${err.message}`);
      results.failed++;
      results.errors.push({ name: entry.name, error: err.message });
    }
  }

  // Save ID mapping
  const mapPath = path.join(BACKUP_DIR, "id-mapping.json");
  writeJson(mapPath, Object.fromEntries(oldIdToNew));
  console.log(`\nSaved ID mapping to ${mapPath} (${oldIdToNew.size} entries)\n`);

  if (DRY_RUN) {
    console.log("Dry run complete. No documents created.\n");
    return;
  }

  // ─── Phase 2: Resolve links ───
  console.log("=== Phase 2: Resolving links ===\n");

  let linksResolved = 0;
  let linksUnresolved = 0;

  for (const { oldDocId, links } of linkQueue) {
    const newDocId = oldIdToNew.get(oldDocId);
    if (!newDocId) continue;

    const linkActions = [];
    for (const link of links) {
      const newTargetId = oldIdToNew.get(link.targetOldId);
      if (newTargetId) {
        linkActions.push({
          type: "ADD_LINK",
          input: {
            id: generateId(),
            targetDocumentId: newTargetId,
            targetTitle: link.targetTitle,
            linkType: link.linkType,
          },
          scope: "global",
        });
        linksResolved++;
      } else {
        linksUnresolved++;
      }
    }

    if (linkActions.length > 0) {
      try {
        await mcpCall("addActions", { documentId: newDocId, actions: linkActions });
        await delay(THROTTLE_MS);
      } catch (err) {
        console.error(`Link error for ${newDocId}: ${err.message}`);
      }
    }
  }

  console.log(`Links resolved:   ${linksResolved}`);
  console.log(`Links unresolved: ${linksUnresolved}\n`);

  // ─── Phase 3: Resolve MOC core ideas + child refs ───
  console.log("=== Phase 3: Resolving MOC references ===\n");

  let refsResolved = 0;
  let refsUnresolved = 0;

  for (const { oldDocId, coreIdeas, childRefs } of mocCoreIdeaQueue) {
    const newDocId = oldIdToNew.get(oldDocId);
    if (!newDocId) continue;

    const refActions = [];

    for (const ci of coreIdeas) {
      const newNoteRef = oldIdToNew.get(ci.noteRef);
      if (newNoteRef) {
        refActions.push({
          type: "ADD_CORE_IDEA",
          input: {
            id: generateId(),
            noteRef: newNoteRef,
            contextPhrase: ci.contextPhrase ?? "",
            sortOrder: ci.sortOrder ?? 0,
            addedAt: ci.addedAt,
          },
          scope: "global",
        });
        refsResolved++;
      } else {
        refsUnresolved++;
      }
    }

    for (const oldChildRef of childRefs) {
      const newChildRef = oldIdToNew.get(oldChildRef);
      if (newChildRef) {
        refActions.push({
          type: "ADD_CHILD_MOC",
          input: { childRef: newChildRef },
          scope: "global",
        });
        refsResolved++;
      } else {
        refsUnresolved++;
      }
    }

    if (refActions.length > 0) {
      try {
        await mcpCall("addActions", { documentId: newDocId, actions: refActions });
        await delay(THROTTLE_MS);
      } catch (err) {
        console.error(`MOC ref error for ${newDocId}: ${err.message}`);
      }
    }
  }

  console.log(`MOC refs resolved:   ${refsResolved}`);
  console.log(`MOC refs unresolved: ${refsUnresolved}\n`);

  // ─── Summary ───
  console.log("=== Import Summary ===");
  console.log(`  Documents created:    ${results.success}`);
  console.log(`  Documents failed:     ${results.failed}`);
  console.log(`  Links resolved:       ${linksResolved}`);
  console.log(`  Links unresolved:     ${linksUnresolved}`);
  console.log(`  MOC refs resolved:    ${refsResolved}`);
  console.log(`  MOC refs unresolved:  ${refsUnresolved}`);
  console.log(`  ID mapping:           ${mapPath}`);
  console.log(`\n=== Import complete ===\n`);
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
