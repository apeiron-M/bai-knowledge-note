#!/usr/bin/env node
/**
 * Export a knowledge vault drive from any switchboard profile into JSON files.
 *
 * Usage:
 *   node scripts/vault-export.mjs --profile <name> --drive <id|slug> [--out <dir>]
 *
 * Defaults:
 *   --profile remote-dev
 *   --drive   powerhouse-vault
 *   --out     ./scripts/vault-dump
 *
 * Output layout:
 *   <out>/drive.json
 *   <out>/manifest.json          (counts, folder tree, per-doc metadata)
 *   <out>/<subfolder>/<name>_<id8>.json
 */

import fs from "node:fs";
import path from "node:path";
import {
  fetchDocument,
  resolveProfileUrl,
  TYPE_FOLDERS,
} from "./lib/sb-client.mjs";

const args = process.argv.slice(2);
function getArg(name, fallback) {
  const idx = args.indexOf(name);
  return idx !== -1 ? args[idx + 1] : fallback;
}

const PROFILE = getArg("--profile", "remote-dev");
const DRIVE = getArg("--drive", "powerhouse-vault");
const OUT_DIR = path.resolve(getArg("--out", "./scripts/vault-dump"));

function ensureDir(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }
function writeJson(p, data) { fs.writeFileSync(p, JSON.stringify(data, null, 2)); }
function sanitize(name) { return name.replace(/[^a-zA-Z0-9_\-. ]/g, "_").slice(0, 100); }

async function main() {
  const url = resolveProfileUrl(PROFILE);

  console.log(`\n=== Vault Export ===`);
  console.log(`Profile:  ${PROFILE} (${url})`);
  console.log(`Drive:    ${DRIVE}`);
  console.log(`Output:   ${OUT_DIR}\n`);

  if (fs.existsSync(OUT_DIR)) fs.rmSync(OUT_DIR, { recursive: true });
  ensureDir(OUT_DIR);

  console.log("Fetching drive document...");
  const drive = await fetchDocument(url, DRIVE);
  if (!drive) throw new Error(`Drive '${DRIVE}' not found via ${url}`);
  writeJson(path.join(OUT_DIR, "drive.json"), drive);

  const nodes = drive.state?.global?.nodes ?? [];
  const fileNodes = nodes.filter((n) => n.kind === "file");
  const folderNodes = nodes.filter((n) => n.kind === "folder");

  console.log(`  ${fileNodes.length} files, ${folderNodes.length} folders\n`);

  const typeCounts = {};
  for (const n of fileNodes) {
    const t = n.documentType ?? "unknown";
    typeCounts[t] = (typeCounts[t] || 0) + 1;
  }
  console.log("Document types:");
  for (const [t, c] of Object.entries(typeCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${t}: ${c}`);
  }
  console.log();

  for (const folder of new Set(Object.values(TYPE_FOLDERS))) {
    ensureDir(path.join(OUT_DIR, folder));
  }
  ensureDir(path.join(OUT_DIR, "other"));

  const exported = [];
  const errors = [];

  for (let i = 0; i < fileNodes.length; i++) {
    const n = fileNodes[i];
    const subfolder = TYPE_FOLDERS[n.documentType] ?? "other";
    const progress = `[${i + 1}/${fileNodes.length}]`;
    try {
      const doc = await fetchDocument(url, n.id);
      const filename = `${sanitize(n.name ?? n.id)}_${n.id.slice(0, 8)}.json`;
      writeJson(path.join(OUT_DIR, subfolder, filename), doc);
      exported.push({
        id: n.id,
        name: n.name,
        documentType: n.documentType,
        subfolder,
        filename,
        parentFolder: n.parentFolder ?? null,
      });
      if (i % 20 === 0 || i === fileNodes.length - 1) {
        console.log(`${progress} ${n.documentType} — ${n.name}`);
      }
    } catch (err) {
      console.error(`${progress} FAILED: ${n.name} — ${err.message}`);
      errors.push({ id: n.id, name: n.name, error: err.message });
    }
  }

  const manifest = {
    exportedAt: new Date().toISOString(),
    profile: PROFILE,
    endpoint: url,
    driveId: drive.id,
    driveSlug: DRIVE,
    driveName: drive.name,
    folderStructure: folderNodes.map((f) => ({
      id: f.id,
      name: f.name,
      parentFolder: f.parentFolder ?? null,
    })),
    typeCounts,
    totalDocuments: fileNodes.length,
    exported: exported.length,
    failed: errors.length,
    errors,
    documents: exported,
  };
  writeJson(path.join(OUT_DIR, "manifest.json"), manifest);

  console.log(`\n=== Export Summary ===`);
  console.log(`  Exported:  ${exported.length}/${fileNodes.length}`);
  console.log(`  Failed:    ${errors.length}`);
  console.log(`  Manifest:  ${path.join(OUT_DIR, "manifest.json")}`);
}

main().catch((err) => { console.error("Fatal:", err); process.exit(1); });
