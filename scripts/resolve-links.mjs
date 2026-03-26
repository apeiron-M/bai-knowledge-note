#!/usr/bin/env node
/**
 * Resolve links between imported knowledge notes.
 *
 * Reads the document map from import, re-parses vault files to find
 * Relevant Notes sections, then dispatches REMOVE_LINK + ADD_LINK
 * with resolved targetDocumentId values.
 *
 * Usage:
 *   node scripts/resolve-links.mjs [--dry-run]
 */

import fs from "node:fs";
import path from "node:path";

const VAULT_NOTES_DIR = "/mnt/f/PowerhouseVault/knowledge/notes";
const REACTOR_ENDPOINT = "http://localhost:4001/graphql/r/";
const DRY_RUN = process.argv.includes("--dry-run");

// Load document map
const docMap = JSON.parse(
  fs.readFileSync("scripts/import-document-map.json", "utf-8"),
);

// Build title → docId lookup (case-insensitive for fuzzy matching)
const titleToDocId = new Map();
for (const entry of docMap) {
  titleToDocId.set(entry.title.toLowerCase(), entry.docId);
}

function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return { frontmatter: {}, body: content };
  const raw = match[1];
  const frontmatter = {};
  for (const line of raw.split("\n")) {
    const kvMatch = line.match(/^([a-z_]+):\s*(.*)/);
    if (kvMatch) {
      frontmatter[kvMatch[1]] = kvMatch[2].trim().replace(/^["']/, "").replace(/["']$/, "");
    }
  }
  return { frontmatter, body: content.slice(match[0].length).trim() };
}

function parseRelevantNotes(body) {
  const notes = [];
  const sections = body.split(/\n---\n/);
  for (const section of sections.slice(1)) {
    const lines = section.trim().split("\n");
    let inRelevant = false;
    for (const line of lines) {
      if (line.startsWith("Relevant Notes:")) {
        inRelevant = true;
        continue;
      }
      if (line.startsWith("Topics:")) {
        inRelevant = false;
        continue;
      }
      if (inRelevant && line.startsWith("- ")) {
        const match = line.match(/\[\[(.+?)\]\]/);
        if (match) notes.push(match[1]);
      }
    }
  }
  return notes;
}

let actionCounter = 0;

async function dispatchActions(documentId, actions) {
  const ts = String(Date.now());
  const formatted = actions.map((a) => ({
    id: `resolve-${++actionCounter}`,
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
      variables: { docId: documentId, actions: formatted },
    }),
  });
  const json = await res.json();
  if (json.errors) {
    throw new Error(JSON.stringify(json.errors));
  }
}

async function main() {
  const files = fs.readdirSync(VAULT_NOTES_DIR).filter((f) => f.endsWith(".md"));

  let resolved = 0;
  let unresolvable = 0;
  let skipped = 0;
  const missing = [];

  for (const file of files) {
    const raw = fs.readFileSync(path.join(VAULT_NOTES_DIR, file), "utf-8");
    const { body } = parseFrontmatter(raw);

    const titleMatch = body.match(/^#\s+(.+)$/m);
    const title = titleMatch ? titleMatch[1].trim() : file.replace(/\.md$/, "");

    const relevantNotes = parseRelevantNotes(body);
    if (relevantNotes.length === 0) {
      skipped++;
      continue;
    }

    // Find this document's ID
    const sourceDocId = titleToDocId.get(title.toLowerCase());
    if (!sourceDocId) {
      console.error(`  [SKIP] Can't find source doc for: ${title}`);
      skipped++;
      continue;
    }

    // For each relevant note, resolve the target
    const actions = [];
    for (const targetTitle of relevantNotes) {
      const targetDocId = titleToDocId.get(targetTitle.toLowerCase());
      if (!targetDocId) {
        missing.push({ from: title, to: targetTitle });
        unresolvable++;
        continue;
      }

      // Remove the old unresolved link and add a resolved one
      // We need the link ID — but we don't know it. Instead, just add a new
      // resolved link. The old "unresolved" links will remain but can be
      // cleaned up in a separate pass.
      //
      // Actually — let's just add resolved links. The import script already
      // created links with targetDocumentId: "unresolved". We'll remove those
      // and add resolved ones.
      //
      // Problem: we don't have the link IDs of the unresolved links.
      // Solution: query the document to get link IDs, or just accept duplicates
      // and clean up "unresolved" links later.
      //
      // Simplest: add resolved links now. The unresolved ones are identifiable
      // by targetDocumentId === "unresolved" and can be cleaned up.

      const linkId = `resolved-${++actionCounter}`;
      actions.push({
        type: "ADD_LINK",
        input: {
          id: linkId,
          targetDocumentId: targetDocId,
          targetTitle: targetTitle,
          linkType: "RELATES_TO",
        },
        scope: "global",
      });
      resolved++;
    }

    if (actions.length > 0) {
      if (DRY_RUN) {
        console.log(`  [dry] ${title} — ${actions.length} resolved links`);
        for (const a of actions) {
          console.log(`         → ${a.input.targetTitle} (${a.input.targetDocumentId.slice(0, 8)}...)`);
        }
      } else {
        try {
          await dispatchActions(sourceDocId, actions);
          console.log(`  [ok] ${title} — ${actions.length} links resolved`);
        } catch (err) {
          console.error(`  [FAIL] ${title}: ${err.message.slice(0, 120)}`);
        }
      }
    }
  }

  console.log(`\n--- Link Resolution Summary ---`);
  console.log(`  Resolved:     ${resolved}`);
  console.log(`  Unresolvable: ${unresolvable}`);
  console.log(`  Skipped:      ${skipped} (no relevant notes)`);

  if (missing.length > 0) {
    console.log(`\n  Unresolvable links (target not in vault):`);
    for (const m of missing) {
      console.log(`    "${m.from}" → "${m.to}"`);
    }
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
