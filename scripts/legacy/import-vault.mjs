#!/usr/bin/env node
/**
 * Import existing Obsidian/Ars Contexta vault notes into bai/knowledge-note documents.
 *
 * Usage:
 *   node scripts/import-vault.mjs --drive-id <UUID> --vault-path <path> [--dry-run] [--limit N] [--create-mocs]
 *
 * Two-pass process:
 *   Pass 1: Create all note documents via MCP, build title→docId map
 *   Pass 2: Resolve [[wiki links]] in Relevant Notes → ADD_LINK with targetDocumentId
 *   Pass 3 (optional): Create MOC documents from topic groupings
 *
 * Uses MCP Streamable HTTP transport (SSE responses) at localhost:4001/mcp
 * This ensures proper document-to-drive linkage (no ghost nodes).
 */

import fs from "node:fs";
import path from "node:path";
import { verifyDriveNodes } from "./lib/verify-drive-nodes.mjs";

// ─── CLI Args ───
const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const CREATE_MOCS = args.includes("--create-mocs");
const limitIdx = args.indexOf("--limit");
const LIMIT = limitIdx !== -1 ? parseInt(args[limitIdx + 1], 10) : Infinity;

const driveIdIdx = args.indexOf("--drive-id");
const DRIVE_ID = driveIdIdx !== -1 ? args[driveIdIdx + 1] : null;

const vaultPathIdx = args.indexOf("--vault-path");
const VAULT_PATH = vaultPathIdx !== -1 ? args[vaultPathIdx + 1] : null;

const MCP_URL = "http://localhost:4001/mcp";

if (!DRIVE_ID || !VAULT_PATH) {
  console.error(
    "Usage: node import-vault.mjs --drive-id <UUID> --vault-path <path> [--dry-run] [--limit N] [--create-mocs]",
  );
  process.exit(1);
}

// ─── Frontmatter fields → metadata field mapping ───
const STRING_FIELD_MAP = {
  scope: "scope",
  confidence: "confidence",
  severity: "severity",
  editor: "editor",
  model_id: "modelId",
  model: "model",
  version: "version",
  file_path: "filePath",
  computes: "computes",
  context: "context",
  decision_status: "decisionStatus",
  source_type: "sourceType",
  target_type: "targetType",
  relation_type: "relationType",
  cardinality: "cardinality",
  error_message: "errorMessage",
  root_cause: "rootCause",
  correct_pattern: "correctPattern",
  status: "decisionStatus",
};

const LIST_FIELD_MAP = {
  modules: "modules",
  models: "models",
  hooks_used: "hooksUsed",
  dispatch_targets: "dispatchTargets",
  inputs: "inputs",
  outputs: "outputs",
  consumed_by: "consumedBy",
  alternatives: "alternatives",
  consequences: "consequences",
  applies_to: "models",
  editors: "models",
};

// ─── MCP HTTP Client (Streamable HTTP / SSE) ───
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
  return `import-${Date.now()}-${++idCounter}`;
}

function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return { frontmatter: {}, body: content };

  const raw = match[1];
  const frontmatter = {};
  let currentKey = null;
  let currentList = null;

  for (const line of raw.split("\n")) {
    if (currentList && /^\s+-\s+/.test(line)) {
      let val = line.replace(/^\s+-\s+/, "").trim();
      val = val
        .replace(/^\[\[/, "")
        .replace(/\]\]$/, "")
        .replace(/^"/, "")
        .replace(/"$/, "");
      currentList.push(val);
      continue;
    }

    const kvMatch = line.match(/^([a-z_]+):\s*(.*)/);
    if (kvMatch) {
      currentKey = kvMatch[1];
      const value = kvMatch[2].trim();
      if (value === "") {
        currentList = [];
        frontmatter[currentKey] = currentList;
      } else {
        currentList = null;
        frontmatter[currentKey] = value
          .replace(/^["']/, "")
          .replace(/["']$/, "");
      }
    }
  }

  const body = content.slice(match[0].length).trim();
  return { frontmatter, body };
}

function parseBody(body) {
  const titleMatch = body.match(/^#\s+(.+)$/m);
  const title = titleMatch ? titleMatch[1].trim() : null;

  const sections = body.split(/\n---\n/);
  const mainContent = sections[0];

  const topics = [];
  const relevantNotes = [];

  for (const section of sections.slice(1)) {
    const lines = section.trim().split("\n");
    let currentSection = null;

    for (const line of lines) {
      if (line.startsWith("Topics:")) {
        currentSection = "topics";
        continue;
      }
      if (/^Relevant Notes:|^Related Notes:/.test(line)) {
        currentSection = "relevant";
        continue;
      }
      if (currentSection && line.startsWith("- ")) {
        const wikiMatch = line.match(/\[\[(.+?)\]\]/);
        if (wikiMatch) {
          if (currentSection === "topics") topics.push(wikiMatch[1]);
          else relevantNotes.push(wikiMatch[1]);
        }
      }
    }
  }

  let content = mainContent;
  if (titleMatch) {
    content = content
      .slice(content.indexOf(titleMatch[0]) + titleMatch[0].length)
      .trim();
  }

  return { title, content, topics, relevantNotes };
}

function buildActions(frontmatter, parsed, filename) {
  const now = new Date().toISOString();
  const created = frontmatter.created
    ? new Date(frontmatter.created).toISOString()
    : now;
  const actions = [];

  const title = parsed.title || filename.replace(/\.md$/, "");
  actions.push({
    type: "SET_TITLE",
    input: { title, updatedAt: created },
    scope: "global",
  });

  if (frontmatter.description) {
    const desc =
      frontmatter.description.length > 200
        ? frontmatter.description.slice(0, 197) + "..."
        : frontmatter.description;
    actions.push({
      type: "SET_DESCRIPTION",
      input: { description: desc, updatedAt: created },
      scope: "global",
    });
  }

  if (frontmatter.type) {
    actions.push({
      type: "SET_NOTE_TYPE",
      input: { noteType: frontmatter.type, updatedAt: created },
      scope: "global",
    });
  }

  if (parsed.content) {
    actions.push({
      type: "SET_CONTENT",
      input: { content: parsed.content, updatedAt: created },
      scope: "global",
    });
  }

  actions.push({
    type: "SET_PROVENANCE",
    input: { author: "apeiron", sourceOrigin: "IMPORT", createdAt: created },
    scope: "global",
  });

  for (const [fmKey, schemaField] of Object.entries(STRING_FIELD_MAP)) {
    if (frontmatter[fmKey] && fmKey !== "type") {
      actions.push({
        type: "SET_METADATA_FIELD",
        input: {
          field: schemaField,
          value: frontmatter[fmKey],
          updatedAt: created,
        },
        scope: "global",
      });
    }
  }

  for (const [fmKey, schemaField] of Object.entries(LIST_FIELD_MAP)) {
    if (frontmatter[fmKey] && Array.isArray(frontmatter[fmKey])) {
      actions.push({
        type: "SET_METADATA_LIST_FIELD",
        input: {
          field: schemaField,
          values: frontmatter[fmKey],
          updatedAt: created,
        },
        scope: "global",
      });
    }
  }

  // Topics from frontmatter
  if (frontmatter.topics && Array.isArray(frontmatter.topics)) {
    for (const topicName of frontmatter.topics) {
      const cleanName = topicName
        .replace(/^\[\[/, "")
        .replace(/\]\]$/, "")
        .replace(/^"/, "")
        .replace(/"$/, "");
      actions.push({
        type: "ADD_TOPIC",
        input: { id: generateId(), name: cleanName },
        scope: "global",
      });
    }
  }

  // Topics from body
  for (const topicName of parsed.topics) {
    const alreadyAdded = actions.some(
      (a) => a.type === "ADD_TOPIC" && a.input.name === topicName,
    );
    if (!alreadyAdded) {
      actions.push({
        type: "ADD_TOPIC",
        input: { id: generateId(), name: topicName },
        scope: "global",
      });
    }
  }

  return { actions, relevantNotes: parsed.relevantNotes, title };
}

// ─── Find folder IDs ───
async function findFolders(driveId) {
  const result = await mcpCall("getDocument", { id: driveId });
  const nodes = result?.document?.state?.global?.nodes ?? [];

  // Find /knowledge/ folder
  const knowledgeFolder = nodes.find(
    (n) =>
      n.kind === "folder" && n.name === "knowledge" && n.parentFolder == null,
  );
  // Find /knowledge/notes/ subfolder
  const notesFolder = knowledgeFolder
    ? nodes.find(
        (n) =>
          n.kind === "folder" &&
          n.name === "notes" &&
          n.parentFolder === knowledgeFolder.id,
      )
    : null;

  return {
    knowledgeFolderId: knowledgeFolder?.id ?? null,
    notesFolderId: notesFolder?.id ?? null,
  };
}

// ─── Main ───
async function main() {
  console.log(`\n=== Knowledge Note Import ===`);
  console.log(`Vault path:  ${VAULT_PATH}`);
  console.log(`Drive ID:    ${DRIVE_ID}`);
  console.log(`Create MOCs: ${CREATE_MOCS}`);
  console.log(`Dry run:     ${DRY_RUN}`);
  console.log(`Limit:       ${LIMIT === Infinity ? "none" : LIMIT}\n`);

  // Find folder IDs
  const { knowledgeFolderId, notesFolderId } = await findFolders(DRIVE_ID);
  console.log(`Knowledge folder: ${knowledgeFolderId ?? "NOT FOUND"}`);
  console.log(
    `Notes folder:     ${notesFolderId ?? "NOT FOUND (will use knowledge folder)"}\n`,
  );

  const parentFolder = notesFolderId ?? knowledgeFolderId;

  // Read all .md files
  const files = fs
    .readdirSync(VAULT_PATH)
    .filter((f) => f.endsWith(".md"))
    .slice(0, LIMIT);

  console.log(`Found ${files.length} note files\n`);

  // ─── PASS 1: Create documents ───
  console.log("=== PASS 1: Creating note documents ===\n");
  const titleToDocId = new Map();
  const noteData = [];
  const topicToNotes = new Map(); // For MOC creation

  const results = { success: 0, failed: 0, errors: [] };

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const filePath = path.join(VAULT_PATH, file);
    const raw = fs.readFileSync(filePath, "utf-8");
    const { frontmatter, body } = parseFrontmatter(raw);
    const parsed = parseBody(body);
    const { actions, relevantNotes, title } = buildActions(
      frontmatter,
      parsed,
      file,
    );

    noteData.push({ title, relevantNotes });

    // Track topics for MOC creation
    const allTopics = [...parsed.topics];
    if (frontmatter.topics && Array.isArray(frontmatter.topics)) {
      for (const t of frontmatter.topics) {
        const clean = t.replace(/^\[\[/, "").replace(/\]\]$/, "");
        if (!allTopics.includes(clean)) allTopics.push(clean);
      }
    }
    for (const topic of allTopics) {
      const list = topicToNotes.get(topic) ?? [];
      list.push(title);
      topicToNotes.set(topic, list);
    }

    const progress = `[${i + 1}/${files.length}]`;
    const type = frontmatter.type || "unknown";

    if (DRY_RUN) {
      console.log(
        `${progress} ${title} (${type}) \u2014 ${actions.length} actions, ${relevantNotes.length} links`,
      );
      titleToDocId.set(title, `dry-run-${i}`);
      results.success++;
      continue;
    }

    try {
      // Create document via MCP (atomically linked to drive + folder)
      const createArgs = {
        documentType: "bai/knowledge-note",
        driveId: DRIVE_ID,
        name: title,
      };
      if (parentFolder) createArgs.parentFolder = parentFolder;

      const createResult = await mcpCall("createDocument", createArgs);
      const docId = createResult.documentId;

      if (!docId) {
        console.error(`${progress} FAILED to create: ${title}`);
        results.failed++;
        continue;
      }

      // Populate note data (exclude link actions — those go in pass 2)
      const contentActions = actions.filter((a) => a.type !== "ADD_LINK");
      await mcpCall("addActions", {
        documentId: docId,
        actions: contentActions,
      });

      titleToDocId.set(title, docId);
      console.log(`${progress} ${title} (${type}) \u2192 ${docId}`);
      results.success++;

      // Delay between each doc to prevent drive mutation race conditions
      await new Promise((r) => setTimeout(r, 100));
    } catch (err) {
      console.error(`${progress} ERROR: ${title} \u2014 ${err.message}`);
      results.failed++;
      results.errors.push({ file, error: err.message });
    }
  }

  // Save document map
  const mapPath = path.join(
    path.dirname(new URL(import.meta.url).pathname),
    "import-document-map.json",
  );
  const mapData = Object.fromEntries(titleToDocId);
  fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2));
  console.log(
    `\nSaved document map to ${mapPath} (${titleToDocId.size} entries)\n`,
  );

  if (DRY_RUN) {
    console.log("Dry run complete. No documents created.\n");
    if (CREATE_MOCS) {
      console.log(`Would create ${topicToNotes.size} MOCs:`);
      for (const [topic, notes] of topicToNotes) {
        if (notes.length >= 2)
          console.log(`  ${topic} (${notes.length} notes)`);
      }
    }
    return;
  }

  // ─── VERIFY: Ensure all docs have drive file nodes ───
  await verifyDriveNodes(
    DRIVE_ID,
    titleToDocId,
    "bai/knowledge-note",
    parentFolder,
  );

  // ─── PASS 2: Resolve links ───
  console.log("=== PASS 2: Resolving links ===\n");

  let linksResolved = 0;
  let linksUnresolved = 0;

  for (const { title, relevantNotes } of noteData) {
    const docId = titleToDocId.get(title);
    if (!docId || relevantNotes.length === 0) continue;

    const linkActions = [];

    for (const targetTitle of relevantNotes) {
      const targetDocId = titleToDocId.get(targetTitle);
      if (targetDocId) {
        linkActions.push({
          type: "ADD_LINK",
          input: {
            id: generateId(),
            targetDocumentId: targetDocId,
            targetTitle,
            linkType: "RELATES_TO",
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
        await mcpCall("addActions", {
          documentId: docId,
          actions: linkActions,
        });
      } catch (err) {
        console.error(`Link error for "${title}": ${err.message}`);
      }
    }
  }

  console.log(`Links resolved: ${linksResolved}`);
  console.log(`Links unresolved: ${linksUnresolved}\n`);

  // ─── PASS 3: Create MOCs (optional) ───
  if (CREATE_MOCS) {
    console.log("=== PASS 3: Creating MOC documents ===\n");

    let mocsCreated = 0;
    // Only create MOCs for topics with 2+ notes
    const mocTopics = [...topicToNotes.entries()].filter(
      ([, notes]) => notes.length >= 2,
    );

    for (const [topic, noteTitles] of mocTopics) {
      try {
        const createResult = await mcpCall("createDocument", {
          documentType: "bai/moc",
          driveId: DRIVE_ID,
          name: topic,
          parentFolder: knowledgeFolderId,
        });
        const mocId = createResult.documentId;

        if (!mocId) {
          console.error(`  FAILED to create MOC: ${topic}`);
          continue;
        }

        // Build MOC actions: set title + add core ideas
        const mocActions = [
          { type: "SET_MOC_TITLE", input: { title: topic }, scope: "global" },
          {
            type: "SET_MOC_DESCRIPTION",
            input: {
              description: `Map of Content for ${topic} — ${noteTitles.length} notes`,
            },
            scope: "global",
          },
          {
            type: "SET_TIER",
            input: { tier: noteTitles.length >= 10 ? "DOMAIN" : "TOPIC" },
            scope: "global",
          },
        ];

        // Add core ideas linking to notes
        for (const noteTitle of noteTitles.slice(0, 20)) {
          const noteDocId = titleToDocId.get(noteTitle);
          if (noteDocId) {
            mocActions.push({
              type: "ADD_CORE_IDEA",
              input: {
                id: generateId(),
                noteRef: noteDocId,
                noteTitle,
                role: `Key note on ${topic}`,
              },
              scope: "global",
            });
          }
        }

        await mcpCall("addActions", { documentId: mocId, actions: mocActions });
        console.log(
          `  MOC: ${topic} (${noteTitles.length} notes) \u2192 ${mocId}`,
        );
        mocsCreated++;
      } catch (err) {
        console.error(`  MOC error for "${topic}": ${err.message}`);
      }
    }

    console.log(`\nMOCs created: ${mocsCreated}\n`);
  }

  // ─── Summary ───
  console.log("=== Import Summary ===");
  console.log(`  Notes created:    ${results.success}`);
  console.log(`  Notes failed:     ${results.failed}`);
  console.log(`  Links resolved:   ${linksResolved}`);
  console.log(`  Links unresolved: ${linksUnresolved}`);
  if (CREATE_MOCS) {
    const mocCount = [...topicToNotes.values()].filter(
      (n) => n.length >= 2,
    ).length;
    console.log(`  MOCs created:     ${mocCount}`);
  }
  console.log(`\n=== Import complete ===\n`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
