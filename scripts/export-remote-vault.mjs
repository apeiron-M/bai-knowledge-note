#!/usr/bin/env node
/**
 * Export the remote knowledge vault from switchboard-dev into JSON files.
 * Creates a local backup in scripts/remote-knowledge-vault/ that can be
 * used to restore documents after upgrading the document models.
 *
 * Usage:
 *   node scripts/export-remote-vault.mjs [--endpoint URL] [--drive-id UUID]
 *
 * Defaults:
 *   --endpoint  https://switchboard-dev.powerhouse.xyz/graphql/r
 *   --drive-id  cbbc2a6c-65ba-4732-b3cd-c4796ddcb734  (powerhouse vault)
 *
 * Output:
 *   scripts/remote-knowledge-vault/
 *     drive.json              — drive document (folder tree + node list)
 *     knowledge-notes/        — one JSON per knowledge-note
 *     mocs/                   — one JSON per MOC
 *     sources/                — one JSON per source
 *     singletons/             — knowledge-graph, vault-config, health-report, pipeline-queue
 *     manifest.json           — summary: counts, export timestamp, drive info
 */

import fs from "node:fs";
import path from "node:path";

// ─── CLI Args ───
const args = process.argv.slice(2);
function getArg(name, fallback) {
  const idx = args.indexOf(name);
  return idx !== -1 ? args[idx + 1] : fallback;
}

const ENDPOINT = getArg(
  "--endpoint",
  "https://switchboard-dev.powerhouse.xyz/graphql/r",
);
const DRIVE_ID = getArg(
  "--drive-id",
  "cbbc2a6c-65ba-4732-b3cd-c4796ddcb734",
);
const OUT_DIR = path.join(
  path.dirname(new URL(import.meta.url).pathname),
  "remote-knowledge-vault",
);

// ─── GraphQL Client ───
async function gql(query, variables = {}) {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) {
    throw new Error(
      `GraphQL error: ${json.errors.map((e) => e.message).join("; ")}`,
    );
  }
  return json.data;
}

// ─── Fetch a single document by ID ───
async function fetchDocument(id) {
  const data = await gql(
    `query ($id: String!) {
      document(identifier: $id) {
        document {
          id
          name
          documentType
          state
          createdAtUtcIso
          lastModifiedAtUtcIso
        }
      }
    }`,
    { id },
  );
  return data.document.document;
}

// ─── Helpers ───
function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function sanitizeFilename(name) {
  return name.replace(/[^a-zA-Z0-9_\-. ]/g, "_").slice(0, 100);
}

// ─── Document type → subfolder mapping ───
const TYPE_FOLDERS = {
  "bai/knowledge-note": "knowledge-notes",
  "bai/moc": "mocs",
  "bai/source": "sources",
  "bai/knowledge-graph": "singletons",
  "bai/vault-config": "singletons",
  "bai/health-report": "singletons",
  "bai/pipeline-queue": "singletons",
  "bai/research-claim": "research-claims",
  "bai/observation": "observations",
  "bai/tension": "tensions",
  "bai/derivation": "derivations",
};

// ─── Main ───
async function main() {
  console.log(`\n=== Export Remote Knowledge Vault ===`);
  console.log(`Endpoint:  ${ENDPOINT}`);
  console.log(`Drive ID:  ${DRIVE_ID}`);
  console.log(`Output:    ${OUT_DIR}\n`);

  // Clean and create output directory
  if (fs.existsSync(OUT_DIR)) {
    fs.rmSync(OUT_DIR, { recursive: true });
  }
  ensureDir(OUT_DIR);

  // 1. Fetch drive document
  console.log("Fetching drive document...");
  const drive = await fetchDocument(DRIVE_ID);
  writeJson(path.join(OUT_DIR, "drive.json"), drive);

  const nodes = drive.state?.global?.nodes ?? [];
  const fileNodes = nodes.filter((n) => n.kind === "file");
  const folderNodes = nodes.filter((n) => n.kind === "folder");

  console.log(
    `  ${fileNodes.length} files, ${folderNodes.length} folders\n`,
  );

  // Count by type
  const typeCounts = {};
  for (const node of fileNodes) {
    const t = node.documentType ?? "unknown";
    typeCounts[t] = (typeCounts[t] || 0) + 1;
  }
  console.log("Document types:");
  for (const [type, count] of Object.entries(typeCounts).sort(
    (a, b) => b[1] - a[1],
  )) {
    console.log(`  ${type}: ${count}`);
  }
  console.log();

  // Create subdirectories
  const subfolders = new Set(Object.values(TYPE_FOLDERS));
  for (const folder of subfolders) {
    ensureDir(path.join(OUT_DIR, folder));
  }

  // 2. Fetch each document
  const results = { success: 0, failed: 0, errors: [] };
  const exportedDocs = [];

  for (let i = 0; i < fileNodes.length; i++) {
    const node = fileNodes[i];
    const progress = `[${i + 1}/${fileNodes.length}]`;
    const subfolder = TYPE_FOLDERS[node.documentType] ?? "other";
    ensureDir(path.join(OUT_DIR, subfolder));

    try {
      const doc = await fetchDocument(node.id);
      const filename = `${sanitizeFilename(node.name)}_${node.id.slice(0, 8)}.json`;
      writeJson(path.join(OUT_DIR, subfolder, filename), doc);

      exportedDocs.push({
        id: node.id,
        name: node.name,
        documentType: node.documentType,
        subfolder,
        filename,
        parentFolder: node.parentFolder ?? null,
      });

      console.log(
        `${progress} ${node.documentType} — ${node.name}`,
      );
      results.success++;
    } catch (err) {
      console.error(`${progress} FAILED: ${node.name} — ${err.message}`);
      results.failed++;
      results.errors.push({
        id: node.id,
        name: node.name,
        error: err.message,
      });
    }
  }

  // 3. Write manifest
  const manifest = {
    exportedAt: new Date().toISOString(),
    endpoint: ENDPOINT,
    driveId: DRIVE_ID,
    driveName: drive.name,
    folderStructure: folderNodes.map((f) => ({
      id: f.id,
      name: f.name,
      parentFolder: f.parentFolder ?? null,
    })),
    typeCounts,
    totalDocuments: fileNodes.length,
    exported: results.success,
    failed: results.failed,
    errors: results.errors,
    documents: exportedDocs,
  };
  writeJson(path.join(OUT_DIR, "manifest.json"), manifest);

  // Summary
  console.log(`\n=== Export Summary ===`);
  console.log(`  Documents exported: ${results.success}`);
  console.log(`  Documents failed:   ${results.failed}`);
  console.log(`  Output:             ${OUT_DIR}`);
  console.log(`  Manifest:           ${path.join(OUT_DIR, "manifest.json")}`);
  console.log(`\n=== Export complete ===\n`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
