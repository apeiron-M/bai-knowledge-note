#!/usr/bin/env node
/**
 * Import Ars Contexta research claims into bai/research-claim documents.
 *
 * Usage:
 *   node scripts/import-research-claims.mjs --drive-id <UUID> --vault-path <path> [--dry-run] [--limit N]
 *
 * Two-pass process:
 *   Pass 1: Create all claim documents via MCP createDocument (with driveId + parentFolder),
 *           then populate via MCP addActions with CREATE_CLAIM
 *   Pass 2: Resolve [[wiki links]] in Relevant Notes -> ADD_RESEARCH_CONNECTION
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
const limitIdx = args.indexOf("--limit");
const LIMIT = limitIdx !== -1 ? parseInt(args[limitIdx + 1], 10) : Infinity;

const driveIdIdx = args.indexOf("--drive-id");
const DRIVE_ID = driveIdIdx !== -1 ? args[driveIdIdx + 1] : null;

const vaultPathIdx = args.indexOf("--vault-path");
const VAULT_PATH =
  vaultPathIdx !== -1
    ? args[vaultPathIdx + 1]
    : "/home/p/Powerhouse/arscontexta/methodology/";

const MCP_URL = "http://localhost:4001/mcp";
const DOCUMENT_TYPE = "bai/research-claim";

if (!DRIVE_ID) {
  console.error(
    "Usage: node import-research-claims.mjs --drive-id <UUID> [--vault-path <path>] [--dry-run] [--limit N]",
  );
  process.exit(1);
}

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

  // Parse SSE response: "event: message\ndata: {...}"
  const dataMatch = text.match(/^data:\s*(.+)$/m);
  if (!dataMatch) throw new Error(`MCP ${toolName}: no data in response`);

  const json = JSON.parse(dataMatch[1]);
  if (json.error) throw new Error(`MCP ${toolName}: ${json.error.message}`);

  // Extract structured content or text content
  const result = json.result;
  if (result?.structuredContent) return result.structuredContent;
  if (result?.content?.[0]?.text) return JSON.parse(result.content[0].text);
  return result;
}

// ─── YAML Frontmatter Parser ───
function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: content };

  const yamlStr = match[1];
  const body = match[2];
  const frontmatter = {};

  for (const line of yamlStr.split("\n")) {
    const kv = line.match(/^(\w+):\s*(.+)$/);
    if (kv) {
      let value = kv[2].trim();
      if (value.startsWith("[") && value.endsWith("]")) {
        value = value
          .slice(1, -1)
          .split(",")
          .map((s) => s.trim().replace(/^["']|["']$/g, ""));
      }
      if (typeof value === "string") {
        value = value.replace(/^["']|["']$/g, "");
      }
      frontmatter[kv[1]] = value;
    }
  }

  return { frontmatter, body };
}

// ─── Extract Relevant Notes section ───
function extractRelevantNotes(body) {
  const relevantMatch = body.match(
    /(?:^|\n)(?:Relevant Notes|Related Notes|Relevant notes):?\s*\n([\s\S]*?)(?:\n(?:Topics|---)|$)/i,
  );
  if (!relevantMatch) return [];

  const lines = relevantMatch[1]
    .split("\n")
    .filter((l) => l.trim().startsWith("-"));
  return lines
    .map((line) => {
      const linkMatch = line.match(/\[\[([^\]]+)\]\]/);
      const contextMatch = line.match(/\]\]\s*[-\u2013\u2014]\s*(.+)/);
      return {
        targetTitle: linkMatch?.[1] ?? null,
        contextPhrase: contextMatch?.[1]?.trim() ?? "",
      };
    })
    .filter((l) => l.targetTitle);
}

// ─── Extract Topics section ───
function extractTopics(body, frontmatter) {
  const topics = new Set();

  if (Array.isArray(frontmatter.topics)) {
    for (const t of frontmatter.topics) {
      topics.add(t.replace(/\[\[|\]\]/g, "").trim());
    }
  }

  const topicsMatch = body.match(/(?:^|\n)Topics:\s*\n([\s\S]*?)(?:\n---|$)/i);
  if (topicsMatch) {
    for (const line of topicsMatch[1].split("\n")) {
      const linkMatch = line.match(/\[\[([^\]]+)\]\]/);
      if (linkMatch) topics.add(linkMatch[1].trim());
    }
  }

  return [...topics];
}

// ─── Strip wiki links from content for clean storage ───
function getContentBody(body) {
  const sectionMatch = body.match(
    /^([\s\S]*?)(?:\n(?:Relevant Notes|Topics|Related Notes):)/i,
  );
  return (sectionMatch?.[1] ?? body).trim();
}

// ─── Find research folder ID ───
async function findResearchFolder(driveId) {
  const result = await mcpCall("getDocument", { id: driveId });
  const nodes = result?.document?.state?.global?.nodes ?? [];
  const researchFolder = nodes.find(
    (n) =>
      n.kind === "folder" && n.name === "research" && n.parentFolder == null,
  );
  return researchFolder?.id ?? null;
}

// ─── Main ───
async function main() {
  console.log(`\n=== Research Claims Import ===`);
  console.log(`Vault path: ${VAULT_PATH}`);
  console.log(`Drive ID:   ${DRIVE_ID}`);
  console.log(`Doc type:   ${DOCUMENT_TYPE}`);
  console.log(`Dry run:    ${DRY_RUN}`);
  console.log(`Limit:      ${LIMIT === Infinity ? "none" : LIMIT}\n`);

  // Find research folder
  const researchFolderId = await findResearchFolder(DRIVE_ID);
  console.log(
    `Research folder: ${researchFolderId ?? "NOT FOUND (will add to drive root)"}\n`,
  );

  // Read all .md files
  const files = fs
    .readdirSync(VAULT_PATH)
    .filter((f) => f.endsWith(".md"))
    .slice(0, LIMIT);

  console.log(`Found ${files.length} claim files\n`);

  // ─── PASS 1: Create documents ───
  console.log("=== PASS 1: Creating claim documents ===\n");
  const titleToDocId = new Map();
  const claimData = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const filePath = path.join(VAULT_PATH, file);
    const raw = fs.readFileSync(filePath, "utf-8");
    const { frontmatter, body } = parseFrontmatter(raw);

    const title = file.replace(/\.md$/, "");
    const description = frontmatter.description ?? "";
    const kind = frontmatter.kind ?? "research";
    const methodology = Array.isArray(frontmatter.methodology)
      ? frontmatter.methodology
      : [];
    const sources = frontmatter.source
      ? [String(frontmatter.source).replace(/\[\[|\]\]/g, "")]
      : [];
    const topics = extractTopics(body, frontmatter);
    const content = getContentBody(body);
    const relevantNotes = extractRelevantNotes(body);

    claimData.push({ title, relevantNotes });

    const progress = `[${i + 1}/${files.length}]`;

    if (DRY_RUN) {
      console.log(
        `${progress} ${title} (${topics.join(", ")}) \u2014 ${relevantNotes.length} links`,
      );
      titleToDocId.set(title, `dry-run-${i}`);
      continue;
    }

    try {
      // Step 1: Create document via MCP (atomically linked to drive + folder)
      const createArgs = {
        documentType: DOCUMENT_TYPE,
        driveId: DRIVE_ID,
        name: title,
      };
      if (researchFolderId) createArgs.parentFolder = researchFolderId;

      const createResult = await mcpCall("createDocument", createArgs);
      const docId = createResult.documentId;

      if (!docId) {
        console.error(`${progress} FAILED to create: ${title}`);
        continue;
      }

      // Step 2: Populate claim data via MCP addActions
      await mcpCall("addActions", {
        documentId: docId,
        actions: [
          {
            type: "CREATE_CLAIM",
            input: {
              title,
              description,
              content,
              kind,
              methodology,
              sources,
              topics,
            },
            scope: "global",
          },
        ],
      });

      titleToDocId.set(title, docId);
      console.log(`${progress} ${title} \u2192 ${docId}`);

      // Delay between each doc to prevent drive mutation race conditions
      await new Promise((r) => setTimeout(r, 100));
    } catch (err) {
      console.error(`${progress} ERROR: ${title} \u2014 ${err.message}`);
    }
  }

  // Save document map
  const mapPath = path.join(
    path.dirname(new URL(import.meta.url).pathname),
    "research-claims-map.json",
  );
  const mapData = Object.fromEntries(titleToDocId);
  fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2));
  console.log(
    `\nSaved document map to ${mapPath} (${titleToDocId.size} entries)\n`,
  );

  if (DRY_RUN) {
    console.log("Dry run complete. No documents created.\n");
    return;
  }

  // ─── VERIFY: Ensure all docs have drive file nodes ───
  await verifyDriveNodes(
    DRIVE_ID,
    titleToDocId,
    DOCUMENT_TYPE,
    researchFolderId,
  );

  // ─── PASS 2: Resolve links ───
  console.log("=== PASS 2: Resolving cross-claim links ===\n");

  let linksResolved = 0;
  let linksUnresolved = 0;

  for (const { title, relevantNotes } of claimData) {
    const docId = titleToDocId.get(title);
    if (!docId || relevantNotes.length === 0) continue;

    const linkActions = [];

    for (const { targetTitle, contextPhrase } of relevantNotes) {
      const targetDocId = titleToDocId.get(targetTitle);
      if (targetDocId) {
        linkActions.push({
          type: "ADD_RESEARCH_CONNECTION",
          input: {
            id: `link-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            targetRef: targetDocId,
            contextPhrase: contextPhrase || `Related to ${targetTitle}`,
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

  console.log(`\nLinks resolved: ${linksResolved}`);
  console.log(`Links unresolved: ${linksUnresolved}`);
  console.log(`\n=== Import complete ===\n`);
}

main().catch(console.error);
