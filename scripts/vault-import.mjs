#!/usr/bin/env node
/**
 * Import a vault dump (produced by vault-export.mjs) into any switchboard drive.
 *
 * Usage:
 *   node scripts/vault-import.mjs --profile <name> --drive <id|slug> [--in <dir>] [--dry-run] [--limit N] [--include-singletons]
 *
 * Defaults:
 *   --profile local
 *   --drive   local-knowledge-hub
 *   --in      ./scripts/vault-dump
 *
 * Behavior:
 *   Phase 0: Map dump folders → existing drive folders by name (creates missing ones).
 *   Phase 1: Create each document via `switchboard docs create` and apply state-derived actions.
 *            Singletons (vault-config, knowledge-graph, health-report, pipeline-queue)
 *            are skipped by default — local already initializes them.
 *   Phase 2: Resolve cross-document links via the old→new ID map.
 *   Phase 3: Resolve MOC core ideas + child refs via the same map.
 */

import fs from "node:fs";
import path from "node:path";
import {
  buildKnowledgeNoteActions,
  buildMocActions,
  buildSourceActions,
  cliApplyActions,
  cliCreateDoc,
  cliIntrospect,
  fetchDocument,
  genActionId,
  resolveProfileUrl,
  SINGLETON_TYPES,
} from "./lib/sb-client.mjs";

const args = process.argv.slice(2);
function getArg(n, fb) { const i = args.indexOf(n); return i !== -1 ? args[i + 1] : fb; }
const PROFILE = getArg("--profile", "local");
const DRIVE = getArg("--drive", "local-knowledge-hub");
const IN_DIR = path.resolve(getArg("--in", "./scripts/vault-dump"));
const DRY_RUN = args.includes("--dry-run");
const INCLUDE_SINGLETONS = args.includes("--include-singletons");
const limitIdx = args.indexOf("--limit");
const LIMIT = limitIdx !== -1 ? parseInt(args[limitIdx + 1], 10) : Infinity;

function readJson(p) { return JSON.parse(fs.readFileSync(p, "utf-8")); }
function writeJson(p, d) { fs.writeFileSync(p, JSON.stringify(d, null, 2)); }
function delay(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function main() {
  console.log(`\n=== Vault Import ===`);
  console.log(`Profile:    ${PROFILE} (${resolveProfileUrl(PROFILE)})`);
  console.log(`Drive:      ${DRIVE}`);
  console.log(`Dump:       ${IN_DIR}`);
  console.log(`Dry run:    ${DRY_RUN}`);
  console.log(`Limit:      ${LIMIT === Infinity ? "none" : LIMIT}`);
  console.log(`Singletons: ${INCLUDE_SINGLETONS ? "INCLUDED" : "skipped"}\n`);

  // Refresh schema cache for this profile so action validation is current.
  if (!DRY_RUN) {
    console.log("Refreshing introspection...");
    cliIntrospect(PROFILE);
  }

  const manifest = readJson(path.join(IN_DIR, "manifest.json"));
  console.log(`Source:    ${manifest.driveName} (${manifest.endpoint})`);
  console.log(`Exported:  ${manifest.exportedAt}`);
  console.log(`Documents: ${manifest.totalDocuments}\n`);

  // ─── Phase 0: Reconcile folder tree ───
  console.log("=== Phase 0: Reconcile folders ===");
  const targetUrl = resolveProfileUrl(PROFILE);
  const driveDoc = DRY_RUN ? null : await fetchDocument(targetUrl, DRIVE);
  if (!DRY_RUN && !driveDoc) {
    throw new Error(`Drive '${DRIVE}' not found on profile '${PROFILE}'`);
  }
  const liveNodes = driveDoc?.state?.global?.nodes ?? [];
  const liveFolders = liveNodes.filter((n) => n.kind === "folder");

  const oldFolderIdToNew = new Map();
  const sortedDumpFolders = topoSortFolders(manifest.folderStructure);

  for (const f of sortedDumpFolders) {
    const newParent = f.parentFolder ? oldFolderIdToNew.get(f.parentFolder) ?? null : null;
    const match = liveFolders.find(
      (lf) =>
        lf.name === f.name &&
        ((newParent === null && (lf.parentFolder ?? null) === null) ||
         lf.parentFolder === newParent),
    );
    if (match) {
      oldFolderIdToNew.set(f.id, match.id);
      continue;
    }
    if (DRY_RUN) {
      oldFolderIdToNew.set(f.id, `dry-folder-${f.name}`);
      console.log(`  Would create folder: ${f.name}`);
      continue;
    }
    const newId = await createFolder(driveDoc.id, f.name, newParent);
    if (newId) {
      oldFolderIdToNew.set(f.id, newId);
      console.log(`  Created folder: ${f.name} → ${newId}`);
    } else {
      console.warn(`  Failed to create folder: ${f.name}`);
    }
    await delay(150);
  }
  console.log(`  Mapped ${oldFolderIdToNew.size}/${manifest.folderStructure.length} folders\n`);

  // ─── Phase 1: Create documents + apply state actions ───
  console.log("=== Phase 1: Create documents ===");
  const oldIdToNew = new Map();
  const linkQueue = [];
  const mocRefQueue = [];
  const counts = { ok: 0, fail: 0, skip: 0 };
  const errors = [];

  const orderedTypes = [
    "bai/knowledge-note",
    "bai/source",
    "bai/research-claim",
    "bai/observation",
    "bai/tension",
    "bai/derivation",
    "bai/moc",
  ];
  if (INCLUDE_SINGLETONS) orderedTypes.unshift(...SINGLETON_TYPES);

  const queue = orderedTypes
    .flatMap((t) => manifest.documents.filter((d) => d.documentType === t))
    .slice(0, LIMIT);

  for (let i = 0; i < queue.length; i++) {
    const entry = queue[i];
    const tag = `[${i + 1}/${queue.length}]`;

    if (!INCLUDE_SINGLETONS && SINGLETON_TYPES.has(entry.documentType)) {
      counts.skip++;
      continue;
    }

    const docPath = path.join(IN_DIR, entry.subfolder, entry.filename);
    if (!fs.existsSync(docPath)) {
      console.error(`${tag} MISSING FILE: ${docPath}`);
      counts.fail++;
      continue;
    }
    const doc = readJson(docPath);
    const state = doc.state ?? {};

    let actions = [];
    try {
      switch (entry.documentType) {
        case "bai/knowledge-note":
          actions = buildKnowledgeNoteActions(state);
          if (state.global?.links?.length) {
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
        case "bai/moc": {
          actions = buildMocActions(state);
          const coreIdeas = (state.global?.coreIdeas ?? []).map((ci) => ({
            noteRef: ci.noteRef,
            contextPhrase: ci.contextPhrase ?? null,
            sortOrder: ci.sortOrder ?? 0,
            addedAt: ci.addedAt ?? new Date().toISOString(),
          }));
          const childRefs = state.global?.childRefs ?? [];
          if (coreIdeas.length || childRefs.length) {
            mocRefQueue.push({ oldDocId: doc.id, coreIdeas, childRefs });
          }
          break;
        }
        case "bai/source":
          actions = buildSourceActions(state);
          break;
        default:
          actions = []; // singletons, others — leave to drive init
      }
    } catch (err) {
      console.error(`${tag} build error: ${entry.name} — ${err.message}`);
      counts.fail++;
      continue;
    }

    if (DRY_RUN) {
      oldIdToNew.set(doc.id, `dry-${i}`);
      console.log(`${tag} ${entry.documentType} — ${entry.name} (${actions.length} actions)`);
      counts.ok++;
      continue;
    }

    try {
      const parentFolder = entry.parentFolder ? oldFolderIdToNew.get(entry.parentFolder) : undefined;
      const newId = cliCreateDoc(PROFILE, {
        type: entry.documentType,
        name: entry.name,
        drive: DRIVE,
        parentFolder,
      });
      oldIdToNew.set(doc.id, newId);
      if (actions.length) cliApplyActions(PROFILE, newId, actions);
      console.log(`${tag} ${entry.documentType} — ${entry.name} → ${newId}`);
      counts.ok++;
      await delay(80);
    } catch (err) {
      console.error(`${tag} ERROR: ${entry.name} — ${err.message.slice(0, 200)}`);
      counts.fail++;
      errors.push({ name: entry.name, error: err.message });
    }
  }

  writeJson(path.join(IN_DIR, "id-mapping.json"), Object.fromEntries(oldIdToNew));
  console.log(`\nCreated: ${counts.ok}, failed: ${counts.fail}, skipped: ${counts.skip}\n`);

  if (DRY_RUN) {
    console.log("Dry run complete. No documents created.\n");
    return;
  }

  // ─── Phase 2: Resolve links ───
  console.log("=== Phase 2: Resolve links ===");
  let linksOk = 0, linksMissing = 0;
  for (const { oldDocId, links } of linkQueue) {
    const newDocId = oldIdToNew.get(oldDocId);
    if (!newDocId) continue;
    const linkActions = [];
    for (const l of links) {
      const newTarget = oldIdToNew.get(l.targetOldId);
      if (newTarget) {
        linkActions.push({
          type: "ADD_LINK",
          input: {
            id: genActionId("link"),
            targetDocumentId: newTarget,
            targetTitle: l.targetTitle,
            linkType: l.linkType,
          },
          scope: "global",
        });
        linksOk++;
      } else {
        linksMissing++;
      }
    }
    if (linkActions.length) {
      try { cliApplyActions(PROFILE, newDocId, linkActions); }
      catch (err) { console.error(`  link error ${newDocId}: ${err.message.slice(0, 200)}`); }
    }
  }
  console.log(`  Resolved ${linksOk} links, ${linksMissing} unresolved\n`);

  // ─── Phase 3: Resolve MOC refs ───
  console.log("=== Phase 3: Resolve MOC core ideas + child refs ===");
  let refsOk = 0, refsMissing = 0;
  for (const { oldDocId, coreIdeas, childRefs } of mocRefQueue) {
    const newDocId = oldIdToNew.get(oldDocId);
    if (!newDocId) continue;
    const refActions = [];
    for (const ci of coreIdeas) {
      const newNote = oldIdToNew.get(ci.noteRef);
      if (newNote) {
        refActions.push({
          type: "ADD_CORE_IDEA",
          input: {
            id: genActionId("ci"),
            noteRef: newNote,
            contextPhrase: ci.contextPhrase ?? "",
            sortOrder: ci.sortOrder ?? 0,
            addedAt: ci.addedAt,
          },
          scope: "global",
        });
        refsOk++;
      } else { refsMissing++; }
    }
    for (const oldChild of childRefs) {
      const newChild = oldIdToNew.get(oldChild);
      if (newChild) {
        refActions.push({ type: "ADD_CHILD_MOC", input: { childRef: newChild }, scope: "global" });
        refsOk++;
      } else { refsMissing++; }
    }
    if (refActions.length) {
      try { cliApplyActions(PROFILE, newDocId, refActions); }
      catch (err) { console.error(`  moc ref error ${newDocId}: ${err.message.slice(0, 200)}`); }
    }
  }
  console.log(`  Resolved ${refsOk} MOC refs, ${refsMissing} unresolved\n`);

  console.log("=== Import Summary ===");
  console.log(`  Documents:    ok=${counts.ok}, fail=${counts.fail}, skip=${counts.skip}`);
  console.log(`  Links:        ok=${linksOk}, missing=${linksMissing}`);
  console.log(`  MOC refs:     ok=${refsOk}, missing=${refsMissing}`);
  console.log(`  ID mapping:   ${path.join(IN_DIR, "id-mapping.json")}`);
}

function topoSortFolders(folders) {
  const sorted = [];
  const remaining = [...folders];
  const seen = new Set();
  while (remaining.length) {
    const ready = remaining.filter(
      (f) => f.parentFolder === null || seen.has(f.parentFolder),
    );
    if (!ready.length) {
      console.warn(`  WARN: ${remaining.length} orphan folder(s): ${remaining.map((f) => f.name).join(", ")}`);
      break;
    }
    sorted.push(...ready);
    for (const r of ready) {
      seen.add(r.id);
      remaining.splice(remaining.indexOf(r), 1);
    }
  }
  return sorted;
}

async function createFolder(driveDocId, name, parentFolderId) {
  const action = {
    type: "ADD_FOLDER",
    input: {
      id: genActionId("folder"),
      name,
      ...(parentFolderId ? { parentFolder: parentFolderId } : {}),
    },
    scope: "global",
  };
  cliApplyActions(PROFILE, driveDocId, [action]);
  await delay(200);
  const drive = await fetchDocument(resolveProfileUrl(PROFILE), DRIVE);
  const nodes = drive?.state?.global?.nodes ?? [];
  const created = nodes.find(
    (n) =>
      n.kind === "folder" &&
      n.name === name &&
      ((parentFolderId ?? null) === (n.parentFolder ?? null)),
  );
  return created?.id ?? null;
}

main().catch((err) => { console.error("Fatal:", err); process.exit(1); });
