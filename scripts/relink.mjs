#!/usr/bin/env node
/**
 * One-off: resolve forward-reference links after a `switchboard import`.
 *
 * Sequential one-pass imports leave knowledge-note `links[].targetDocumentId`
 * pointing at the original remote UUIDs whenever the link target hadn't been
 * created at the moment the source doc's `ADD_LINK` op was dispatched. This
 * script does the deferred-rewrite pass the CLI doesn't yet have:
 *
 *   1. Walk the export directory to learn each (remote_id, name, type) triple
 *      from the `.phd` archives' header.json
 *   2. Read the target drive to learn each (local_id, name, type)
 *   3. Match by (name, type) to build remote_id → local_id
 *   4. For every knowledge-note on the target drive, dispatch
 *      REMOVE_LINK + ADD_LINK pairs for any link whose targetDocumentId is a
 *      known remote id; skip links that already point at a local id or at a
 *      genuinely unknown id.
 *
 * Usage:
 *   node scripts/relink.mjs --profile <name> --drive <id|slug> --export <dir>
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
const get = (n, fb) => {
  const i = args.indexOf(n);
  return i !== -1 ? args[i + 1] : fb;
};
const PROFILE = get("--profile", "local");
const DRIVE = get("--drive", null);
const EXPORT_DIR = get("--export", null);
if (!DRIVE || !EXPORT_DIR) {
  console.error(
    "Usage: node scripts/relink.mjs --profile <name> --drive <id|slug> --export <dir>",
  );
  process.exit(2);
}

function gqlUrlFromProfile(profile) {
  const out = execFileSync(
    "switchboard",
    ["config", "list", "--format", "json"],
    { encoding: "utf-8" },
  );
  const list = JSON.parse(out);
  const hit = list.find((p) => p.name === profile);
  if (!hit) throw new Error(`profile '${profile}' not found`);
  return hit.url;
}

async function gql(url, query, variables = {}) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const j = await r.json();
  if (j.errors) throw new Error(j.errors.map((e) => e.message).join("; "));
  return j.data;
}

function listPhd(dir) {
  const out = [];
  function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && e.name.endsWith(".phd")) out.push(p);
    }
  }
  walk(dir);
  return out;
}

function readPhdHeader(phdPath) {
  // Use unzip -p to stream a single file from the archive without extracting.
  const out = spawnSync("unzip", ["-p", phdPath, "header.json"], {
    encoding: "utf-8",
  });
  if (out.status !== 0)
    throw new Error(`unzip failed for ${phdPath}: ${out.stderr}`);
  return JSON.parse(out.stdout);
}

function applyActions(profile, docId, actions) {
  if (!actions.length) return;
  const tmp = path.join(
    os.tmpdir(),
    `relink-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`,
  );
  fs.writeFileSync(tmp, JSON.stringify(actions));
  try {
    const r = spawnSync(
      "switchboard",
      [
        "--profile",
        profile,
        "docs",
        "apply",
        docId,
        "--file",
        tmp,
        "--wait",
        "--format",
        "json",
      ],
      { encoding: "utf-8" },
    );
    if (r.status !== 0)
      throw new Error(`docs apply failed: ${r.stderr || r.stdout}`);
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch {}
  }
}

let counter = 0;
const newLinkId = () => `relink-${Date.now()}-${++counter}`;

async function main() {
  const url = gqlUrlFromProfile(PROFILE);
  console.log(`profile  : ${PROFILE} (${url})`);
  console.log(`drive    : ${DRIVE}`);
  console.log(`export   : ${EXPORT_DIR}`);

  // Step 1: read all .phd headers → remote (id, name, type)
  const phdFiles = listPhd(EXPORT_DIR);
  console.log(`scanning ${phdFiles.length} .phd files for remote ids...`);
  const remoteByKey = new Map(); // `${type}::${name}` → remote_id
  const allRemoteIds = new Set();
  for (const p of phdFiles) {
    try {
      const h = readPhdHeader(p);
      if (!h.id || !h.name || !h.documentType) continue;
      remoteByKey.set(`${h.documentType}::${h.name}`, h.id);
      allRemoteIds.add(h.id);
    } catch (e) {
      console.warn(`  WARN ${p}: ${e.message}`);
    }
  }
  console.log(`  remote ids: ${allRemoteIds.size}`);

  // Step 2: read target drive nodes → local (id, name, type)
  const drive = (
    await gql(
      url,
      `query($id:String!){document(identifier:$id){document{state}}}`,
      { id: DRIVE },
    )
  ).document.document;
  const nodes = drive.state.global.nodes ?? [];
  const fileNodes = nodes.filter((n) => n.kind === "file");
  console.log(`  local files: ${fileNodes.length}`);

  // Step 3: build remote → local map by (type, name)
  const r2l = new Map();
  let matched = 0,
    missingLocal = 0;
  for (const n of fileNodes) {
    const key = `${n.documentType}::${n.name}`;
    const remoteId = remoteByKey.get(key);
    if (remoteId) {
      r2l.set(remoteId, n.id);
      matched++;
    } else {
      missingLocal++;
    }
  }
  const localIds = new Set(fileNodes.map((n) => n.id));
  console.log(
    `  matched remote→local: ${matched} (no remote match for ${missingLocal} local nodes)`,
  );

  // Step 4: walk knowledge-notes, fix links
  const notes = fileNodes.filter(
    (n) => n.documentType === "bai/knowledge-note",
  );
  console.log(`\nrelinking ${notes.length} knowledge-notes...`);
  let alreadyLocal = 0,
    repointed = 0,
    unresolvable = 0,
    docsTouched = 0;

  for (let i = 0; i < notes.length; i++) {
    const n = notes[i];
    let doc;
    try {
      doc = (
        await gql(
          url,
          `query($id:String!){document(identifier:$id){document{state}}}`,
          { id: n.id },
        )
      ).document.document;
    } catch (e) {
      console.warn(
        `  [${i + 1}/${notes.length}] fetch failed ${n.id}: ${e.message}`,
      );
      continue;
    }
    const links = doc.state?.global?.links ?? [];
    if (!links.length) continue;

    const actions = [];
    for (const l of links) {
      const t = l.targetDocumentId;
      if (!t) continue;
      if (localIds.has(t)) {
        alreadyLocal++;
        continue;
      }
      const newTarget = r2l.get(t);
      if (!newTarget) {
        unresolvable++;
        continue;
      }
      actions.push({
        type: "REMOVE_LINK",
        input: { id: l.id },
        scope: "global",
      });
      actions.push({
        type: "ADD_LINK",
        input: {
          id: newLinkId(),
          targetDocumentId: newTarget,
          targetTitle: l.targetTitle ?? null,
          linkType: l.linkType ?? "RELATES_TO",
        },
        scope: "global",
      });
      repointed++;
    }

    if (actions.length) {
      try {
        applyActions(PROFILE, n.id, actions);
        docsTouched++;
        if (docsTouched % 10 === 0) {
          console.log(
            `  [${i + 1}/${notes.length}] touched=${docsTouched} repointed=${repointed}`,
          );
        }
      } catch (e) {
        console.warn(
          `  apply failed ${n.id}: ${(e.message || "").slice(0, 200)}`,
        );
      }
    }
  }

  console.log(`\n=== relink summary ===`);
  console.log(`  docs touched      : ${docsTouched}`);
  console.log(`  links repointed   : ${repointed}`);
  console.log(`  already local     : ${alreadyLocal}`);
  console.log(`  unresolvable      : ${unresolvable}`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
