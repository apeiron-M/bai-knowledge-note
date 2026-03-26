#!/usr/bin/env node
/**
 * Import existing Obsidian vault notes into KnowledgeNote documents via MCP.
 *
 * Usage:
 *   node scripts/import-vault.mjs [--dry-run] [--limit N]
 *
 * Reads all .md files from the vault notes/ directory, parses YAML frontmatter,
 * extracts content body, Topics, and Relevant Notes sections, then dispatches
 * operations via the local Reactor GraphQL API.
 */

import fs from "node:fs";
import path from "node:path";

// ─── Config ───
const VAULT_NOTES_DIR = "/mnt/f/PowerhouseVault/knowledge/notes";
const REACTOR_ENDPOINT = "http://localhost:4001/graphql/r/";
const DRIVE_ID = "vetra-beff16e3"; // local vetra drive — change for production
const DOCUMENT_TYPE = "bai/knowledge-note";

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const limitIdx = args.indexOf("--limit");
const LIMIT = limitIdx !== -1 ? parseInt(args[limitIdx + 1], 10) : Infinity;

// ─── Frontmatter fields → metadata field mapping ───
// Maps vault frontmatter keys to KnowledgeNote schema field names
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
  status: "decisionStatus", // architecture-decision status maps here
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
  applies_to: "models", // applies_to is a list of model names
  editors: "models", // editors field maps to models list
};

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
    // List item continuation
    if (currentList && /^\s+-\s+/.test(line)) {
      let val = line.replace(/^\s+-\s+/, "").trim();
      // Strip wikilink brackets and quotes
      val = val
        .replace(/^\[\[/, "")
        .replace(/\]\]$/, "")
        .replace(/^"/, "")
        .replace(/"$/, "");
      currentList.push(val);
      continue;
    }

    // New key
    const kvMatch = line.match(/^([a-z_]+):\s*(.*)/);
    if (kvMatch) {
      currentKey = kvMatch[1];
      const value = kvMatch[2].trim();

      if (value === "") {
        // Could be start of a list
        currentList = [];
        frontmatter[currentKey] = currentList;
      } else {
        currentList = null;
        // Strip quotes
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
  // Extract title (first # heading)
  const titleMatch = body.match(/^#\s+(.+)$/m);
  const title = titleMatch ? titleMatch[1].trim() : null;

  // Split at --- separators to find Topics and Relevant Notes sections
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
      if (line.startsWith("Relevant Notes:")) {
        currentSection = "relevant";
        continue;
      }
      if (currentSection && line.startsWith("- ")) {
        const wikiMatch = line.match(/\[\[(.+?)\]\]/);
        if (wikiMatch) {
          if (currentSection === "topics") {
            topics.push(wikiMatch[1]);
          } else {
            relevantNotes.push(wikiMatch[1]);
          }
        }
      }
    }
  }

  // Content is everything after the title line, before the first --- separator
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

  // Title
  const title = parsed.title || filename.replace(/\.md$/, "");
  actions.push({
    type: "SET_TITLE",
    input: { title, updatedAt: created },
    scope: "global",
  });

  // Description
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

  // Note type
  if (frontmatter.type) {
    actions.push({
      type: "SET_NOTE_TYPE",
      input: { noteType: frontmatter.type, updatedAt: created },
      scope: "global",
    });
  }

  // Content
  if (parsed.content) {
    actions.push({
      type: "SET_CONTENT",
      input: { content: parsed.content, updatedAt: created },
      scope: "global",
    });
  }

  // Provenance
  actions.push({
    type: "SET_PROVENANCE",
    input: {
      author: "apeiron",
      sourceOrigin: "IMPORT",
      createdAt: created,
    },
    scope: "global",
  });

  // Type-specific string metadata
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

  // Type-specific list metadata
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

  // Frontmatter topics (some notes have topics in frontmatter as a list)
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

  // Body topics
  for (const topicName of parsed.topics) {
    // Avoid duplicate if already added from frontmatter
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

  // Relevant notes as links (RELATES_TO default, no targetDocumentId since we don't know IDs yet)
  for (const noteTitle of parsed.relevantNotes) {
    actions.push({
      type: "ADD_LINK",
      input: {
        id: generateId(),
        targetDocumentId: "unresolved",
        targetTitle: noteTitle,
        linkType: "RELATES_TO",
      },
      scope: "global",
    });
  }

  return actions;
}

// ─── Reactor API ───

let actionCounter = 0;

async function createDocument(name) {
  // Create standalone document (no drive assignment — drives have a rebuild issue)
  const res = await fetch(REACTOR_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: `mutation { createEmptyDocument(documentType: "${DOCUMENT_TYPE}") { id } }`,
    }),
  });
  const json = await res.json();
  if (json.errors) {
    throw new Error(`createDocument failed: ${JSON.stringify(json.errors)}`);
  }
  return json.data.createEmptyDocument.id;
}

async function dispatchActions(documentId, actions) {
  const ts = String(Date.now());
  const formattedActions = actions.map((a) => ({
    id: `import-action-${++actionCounter}`,
    timestampUtcMs: ts,
    type: a.type,
    input: a.input,
    scope: a.scope,
  }));

  const res = await fetch(REACTOR_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: `mutation M($docId: String!, $actions: [JSONObject!]!) { mutateDocument(documentIdentifier: $docId, actions: $actions) { id } }`,
      variables: { docId: documentId, actions: formattedActions },
    }),
  });
  const json = await res.json();
  if (json.errors) {
    throw new Error(`dispatchActions failed: ${JSON.stringify(json.errors)}`);
  }
  return json.data.mutateDocument.id;
}

// ─── Main ───

async function main() {
  const files = fs
    .readdirSync(VAULT_NOTES_DIR)
    .filter((f) => f.endsWith(".md"))
    .slice(0, LIMIT);

  console.log(
    `\nImporting ${files.length} notes from vault${DRY_RUN ? " (DRY RUN)" : ""}...\n`,
  );

  const results = { success: 0, skipped: 0, failed: 0, errors: [] };
  const documentMap = []; // title → documentId for future link resolution

  for (const file of files) {
    const filePath = path.join(VAULT_NOTES_DIR, file);
    const raw = fs.readFileSync(filePath, "utf-8");
    const { frontmatter, body } = parseFrontmatter(raw);
    const parsed = parseBody(body);
    const actions = buildActions(frontmatter, parsed, file);

    const title = parsed.title || file.replace(/\.md$/, "");
    const type = frontmatter.type || "unknown";

    if (DRY_RUN) {
      console.log(`  [dry] ${title} (${type}) — ${actions.length} actions`);
      for (const a of actions) {
        const preview =
          a.type === "SET_CONTENT"
            ? `${a.input.content.slice(0, 60)}...`
            : JSON.stringify(a.input).slice(0, 80);
        console.log(`         ${a.type}: ${preview}`);
      }
      results.success++;
      continue;
    }

    try {
      const docId = await createDocument(title);
      await dispatchActions(docId, actions);
      documentMap.push({ title, docId, type });
      console.log(
        `  [ok] ${title} (${type}) — ${actions.length} actions → ${docId}`,
      );
      results.success++;
    } catch (err) {
      console.error(`  [FAIL] ${title}: ${err.message}`);
      results.failed++;
      results.errors.push({ file, error: err.message });
    }
  }

  console.log(`\n--- Import Summary ---`);
  console.log(`  Success: ${results.success}`);
  console.log(`  Failed:  ${results.failed}`);
  if (results.errors.length) {
    console.log(`\n  Errors:`);
    for (const e of results.errors) {
      console.log(`    ${e.file}: ${e.error}`);
    }
  }

  // Write document map for link resolution
  if (!DRY_RUN && documentMap.length > 0) {
    const mapPath = path.join(
      process.cwd(),
      "scripts",
      "import-document-map.json",
    );
    fs.writeFileSync(mapPath, JSON.stringify(documentMap, null, 2));
    console.log(`\n  Document map written to ${mapPath}`);
    console.log(
      `  Use this to resolve 'unresolved' targetDocumentId values in links.`,
    );
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
