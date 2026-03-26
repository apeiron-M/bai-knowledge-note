#!/usr/bin/env node
/**
 * Generates MCP commands to import vault notes.
 * Outputs a JSON file of {title, actions[]} that can be fed to MCP tools.
 *
 * Usage:
 *   node scripts/import-via-mcp.mjs
 *
 * Produces: scripts/mcp-import-batch.json
 */

import fs from "node:fs";
import path from "node:path";

const VAULT_NOTES_DIR = "/mnt/f/PowerhouseVault/knowledge/notes";

const STRING_FIELD_MAP = {
  scope: "scope", confidence: "confidence", severity: "severity",
  editor: "editor", model_id: "modelId", model: "model", version: "version",
  file_path: "filePath", computes: "computes", context: "context",
  decision_status: "decisionStatus", source_type: "sourceType",
  target_type: "targetType", relation_type: "relationType",
  cardinality: "cardinality", error_message: "errorMessage",
  root_cause: "rootCause", correct_pattern: "correctPattern",
  status: "decisionStatus",
};

const LIST_FIELD_MAP = {
  modules: "modules", models: "models", hooks_used: "hooksUsed",
  dispatch_targets: "dispatchTargets", inputs: "inputs", outputs: "outputs",
  consumed_by: "consumedBy", alternatives: "alternatives",
  consequences: "consequences", applies_to: "models", editors: "models",
};

let idCounter = 0;
function genId() { return `imp-${Date.now()}-${++idCounter}`; }

function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return { frontmatter: {}, body: content };
  const raw = match[1];
  const fm = {};
  let currentKey = null, currentList = null;
  for (const line of raw.split("\n")) {
    if (currentList && /^\s+-\s+/.test(line)) {
      let val = line.replace(/^\s+-\s+/, "").trim()
        .replace(/^\[\[/, "").replace(/\]\]$/, "")
        .replace(/^"/, "").replace(/"$/, "");
      currentList.push(val);
      continue;
    }
    const kv = line.match(/^([a-z_]+):\s*(.*)/);
    if (kv) {
      currentKey = kv[1];
      const v = kv[2].trim();
      if (v === "") { currentList = []; fm[currentKey] = currentList; }
      else { currentList = null; fm[currentKey] = v.replace(/^["']/, "").replace(/["']$/, ""); }
    }
  }
  return { frontmatter: fm, body: content.slice(match[0].length).trim() };
}

function parseBody(body) {
  const titleMatch = body.match(/^#\s+(.+)$/m);
  const title = titleMatch ? titleMatch[1].trim() : null;
  const sections = body.split(/\n---\n/);
  const topics = [], relevantNotes = [];
  for (const sec of sections.slice(1)) {
    let cur = null;
    for (const line of sec.trim().split("\n")) {
      if (line.startsWith("Topics:")) { cur = "topics"; continue; }
      if (line.startsWith("Relevant Notes:")) { cur = "relevant"; continue; }
      if (cur && line.startsWith("- ")) {
        const m = line.match(/\[\[(.+?)\]\]/);
        if (m) (cur === "topics" ? topics : relevantNotes).push(m[1]);
      }
    }
  }
  let content = sections[0];
  if (titleMatch) content = content.slice(content.indexOf(titleMatch[0]) + titleMatch[0].length).trim();
  return { title, content, topics, relevantNotes };
}

const files = fs.readdirSync(VAULT_NOTES_DIR).filter(f => f.endsWith(".md"));
const batch = [];

for (const file of files) {
  const raw = fs.readFileSync(path.join(VAULT_NOTES_DIR, file), "utf-8");
  const { frontmatter: fm, body } = parseFrontmatter(raw);
  const parsed = parseBody(body);
  const title = parsed.title || file.replace(/\.md$/, "");
  const created = fm.created ? new Date(fm.created).toISOString() : new Date().toISOString();

  const actions = [];

  actions.push({ type: "SET_TITLE", input: { title, updatedAt: created }, scope: "global" });

  if (fm.description) {
    const desc = fm.description.length > 200 ? fm.description.slice(0, 197) + "..." : fm.description;
    actions.push({ type: "SET_DESCRIPTION", input: { description: desc, updatedAt: created }, scope: "global" });
  }

  if (fm.type) actions.push({ type: "SET_NOTE_TYPE", input: { noteType: fm.type, updatedAt: created }, scope: "global" });
  if (parsed.content) actions.push({ type: "SET_CONTENT", input: { content: parsed.content, updatedAt: created }, scope: "global" });

  actions.push({ type: "SET_PROVENANCE", input: { author: "apeiron", sourceOrigin: "IMPORT", createdAt: created }, scope: "global" });

  for (const [fmKey, schemaField] of Object.entries(STRING_FIELD_MAP)) {
    if (fm[fmKey] && fmKey !== "type") {
      actions.push({ type: "SET_METADATA_FIELD", input: { field: schemaField, value: fm[fmKey], updatedAt: created }, scope: "global" });
    }
  }
  for (const [fmKey, schemaField] of Object.entries(LIST_FIELD_MAP)) {
    if (fm[fmKey] && Array.isArray(fm[fmKey])) {
      actions.push({ type: "SET_METADATA_LIST_FIELD", input: { field: schemaField, values: fm[fmKey], updatedAt: created }, scope: "global" });
    }
  }

  // Topics from frontmatter
  const addedTopics = new Set();
  if (fm.topics && Array.isArray(fm.topics)) {
    for (const t of fm.topics) {
      const clean = t.replace(/^\[\[/, "").replace(/\]\]$/, "").replace(/^"/, "").replace(/"$/, "");
      actions.push({ type: "ADD_TOPIC", input: { id: genId(), name: clean }, scope: "global" });
      addedTopics.add(clean);
    }
  }
  // Topics from body
  for (const t of parsed.topics) {
    if (!addedTopics.has(t)) {
      actions.push({ type: "ADD_TOPIC", input: { id: genId(), name: t }, scope: "global" });
      addedTopics.add(t);
    }
  }

  batch.push({ title, type: fm.type || "unknown", actions });
}

// Write batch file
fs.writeFileSync("scripts/mcp-import-batch.json", JSON.stringify(batch, null, 2));
console.log(`Prepared ${batch.length} notes for MCP import → scripts/mcp-import-batch.json`);
console.log(`Total actions: ${batch.reduce((s, b) => s + b.actions.length, 0)}`);
