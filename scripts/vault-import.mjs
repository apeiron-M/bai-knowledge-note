#!/usr/bin/env node
/**
 * Import a vault dump (produced by vault-export.mjs) into any switchboard drive.
 *
 * Usage:
 *   node scripts/vault-import.mjs --profile <name> --drive <id|slug> [--in <dir>] [--dry-run] [--limit N] [--include-singletons] [--throttle <ms>] [--skip-types <type1,type2>]
 *
 * Defaults:
 *   --profile local
 *   --drive   local-knowledge-hub
 *   --in      ./scripts/vault-dump
 *   --throttle 80    (ms between docs — bump to 1000+ for slow remote uploads)
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
const THROTTLE_MS = parseInt(getArg("--throttle", "80"), 10) || 80;
const SKIP_TYPES = new Set(
  (getArg("--skip-types", "") || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);

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
  console.log(`Throttle:   ${THROTTLE_MS}ms between docs`);
  console.log(`Skip types: ${SKIP_TYPES.size ? [...SKIP_TYPES].join(", ") : "(none)"}`);
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
  const liveFiles = liveNodes.filter((n) => n.kind === "file");

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

  // Live-drive lookup: (name | documentType | newParentFolderId) → existing id.
  // Used in Phase 1 to detect docs already present on the destination — whether
  // hand-created, left over from a previous run that didn't persist
  // id-mapping.json, or carried over from a different import. We treat a hit as
  // "already there, reuse its id"; the dump's old id is mapped to the live id
  // so Phase 2/3 still wire up that doc's links/refs against the right node.
  const liveDocByKey = new Map();
  for (const f of liveFiles) {
    const parent = f.parentFolder ?? "";
    liveDocByKey.set(`${f.name}|${f.documentType ?? ""}|${parent}`, f.id);
  }

  // ─── Phase 1: Create documents + apply state actions ───
  console.log("=== Phase 1: Create documents ===");
  const oldIdToNew = new Map();
  // Incremental mode: load existing id-mapping.json so re-runs skip already
  // imported docs but still queue their links/MOC refs for Phase 2/3.
  const mappingPath = path.join(IN_DIR, "id-mapping.json");
  if (fs.existsSync(mappingPath)) {
    try {
      const existing = readJson(mappingPath);
      for (const [oldId, newId] of Object.entries(existing)) {
        oldIdToNew.set(oldId, newId);
      }
      console.log(`  Loaded ${oldIdToNew.size} entries from existing id-mapping.json (incremental)\n`);
    } catch (err) {
      console.warn(`  Could not load existing id-mapping.json: ${err.message}\n`);
    }
  }
  const linkQueue = [];
  const mocRefQueue = [];
  const counts = { ok: 0, fail: 0, skip: 0, already: 0, matched: 0 };
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
    if (SKIP_TYPES.has(entry.documentType)) {
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

    // Incremental: if this old ID is already mapped, queue links/refs above
    // but skip create+apply.
    if (oldIdToNew.has(doc.id)) {
      counts.already++;
      continue;
    }

    // Live-drive match: if a document with the same name + type already
    // exists under the same (mapped) parent folder, reuse its id instead of
    // creating a duplicate. Captures destinations seeded by hand and partial
    // previous runs that didn't persist id-mapping.json.
    if (!DRY_RUN) {
      const newParentForLookup = entry.parentFolder
        ? (oldFolderIdToNew.get(entry.parentFolder) ?? "")
        : "";
      const liveKey = `${entry.name}|${entry.documentType}|${newParentForLookup}`;
      const liveId = liveDocByKey.get(liveKey);
      if (liveId) {
        oldIdToNew.set(doc.id, liveId);
        writeJson(mappingPath, Object.fromEntries(oldIdToNew));
        console.log(
          `${tag} ${entry.documentType} — ${entry.name} → already on drive (${liveId.slice(0, 8)}...), reusing`,
        );
        counts.matched++;
        continue;
      }
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
      // Persist the mapping after each successful create so a crash leaves
      // a recoverable state for the next incremental run.
      writeJson(mappingPath, Object.fromEntries(oldIdToNew));
      await delay(THROTTLE_MS);
    } catch (err) {
      console.error(`${tag} ERROR: ${entry.name} — ${err.message.slice(0, 200)}`);
      counts.fail++;
      errors.push({ name: entry.name, error: err.message });
    }
  }

  writeJson(mappingPath, Object.fromEntries(oldIdToNew));
  console.log(
    `\nCreated: ${counts.ok}, matched-on-drive: ${counts.matched}, already-mapped: ${counts.already}, failed: ${counts.fail}, skipped: ${counts.skip}\n`,
  );

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
  console.log(`  Documents:    ok=${counts.ok}, already=${counts.already}, fail=${counts.fail}, skip=${counts.skip}`);
  console.log(`  Links:        ok=${linksOk}, missing=${linksMissing}`);
  console.log(`  MOC refs:     ok=${refsOk}, missing=${refsMissing}`);
  console.log(`  ID mapping:   ${mappingPath}`);
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
