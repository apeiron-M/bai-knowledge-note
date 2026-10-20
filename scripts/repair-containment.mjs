#!/usr/bin/env node
/**
 * Give every document in a vault drive the drive's "child" relationship.
 *
 * WHY THIS EXISTS
 *
 * Containment has two halves: the drive's file tree (`ADD_FILE`) and a "child"
 * relationship from the drive to the document. The reactor acts on the second:
 * document permissions inherit through it (reactor-api walks
 * `getIncomingRelationships(id, "child")`), and the drive's sync collection is
 * built from it. The reactor's own addFile writes both. Until 2026-10-20 the
 * vault's batched creates (`POST notes`, `POST sources/batch`) wrote only the
 * tree, so every note and map they made sat in the drive without the
 * relationship. A user given READ on the drive could open sources but no note or
 * map ("Forbidden: insufficient permissions to read this document"), and a
 * reactor syncing the drive never received them.
 *
 * This finds the tree's documents the drive has no "child" relationship to and
 * adds it, in batches, to the drive's document-scope log — the same operation
 * the reactor writes. It changes nothing else, and a document that already has
 * the relationship is left alone, so it is safe to re-run.
 *
 * Usage:
 *   node scripts/repair-containment.mjs --drive <driveId|slug>            # dry run
 *   node scripts/repair-containment.mjs --drive <driveId|slug> --apply
 *
 *   --types <t,…>  only these document types (default: every file in the tree)
 *   --limit <n>    add at most n (a canary before the full run)
 *   --batch <n>    relationships per write (default 50)
 *   --apply        write; omit for a dry run
 *
 * Auth: SWITCHBOARD_TOKEN, or falls back to `switchboard auth token`; the caller
 * needs WRITE on the drive. Origin: SWITCHBOARD_ORIGIN, default
 * http://localhost:4001. Node only — no bun APIs.
 */
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const driveRef = flag("--drive");
const apply = args.includes("--apply");
const types = flag("--types")?.split(",").map((t) => t.trim()).filter(Boolean);
const limit = flag("--limit") ? Number(flag("--limit")) : Infinity;
const batch = Math.max(1, Number(flag("--batch", "50")));
const origin = (process.env.SWITCHBOARD_ORIGIN ?? "http://localhost:4001").replace(/\/$/, "");
if (!driveRef) {
  console.error("usage: node scripts/repair-containment.mjs --drive <driveId|slug> [--types t,…] [--limit n] [--batch n] [--apply]");
  process.exit(2);
}
const token =
  process.env.SWITCHBOARD_TOKEN ||
  (() => {
    try {
      return execFileSync("switchboard", ["auth", "token"], { encoding: "utf8" }).trim().split("\n").pop();
    } catch {
      return "";
    }
  })();

async function gql(query, variables = {}) {
  const res = await fetch(`${origin}/graphql`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ query, variables }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok && !body.data) {
    throw new Error(`HTTP ${res.status} from ${origin}/graphql: ${JSON.stringify(body.errors ?? body).slice(0, 300)}`);
  }
  return body;
}

const chunks = (list, size) => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size));
const countByType = (nodes) =>
  Object.entries(nodes.reduce((m, n) => ({ ...m, [n.documentType]: (m[n.documentType] ?? 0) + 1 }), {}))
    .map(([t, n]) => `${n} ${t}`)
    .join(", ");

// 1. The drive and its tree.
const driveRes = await gql(`query($id:String!){document(identifier:$id){document{id name documentType state}}}`, { id: driveRef });
const drive = driveRes.data?.document?.document;
if (!drive) {
  console.error(`No drive ${driveRef} at ${origin}: ${JSON.stringify(driveRes.errors ?? []).slice(0, 300)}`);
  process.exit(1);
}
if (drive.documentType !== "powerhouse/document-drive") {
  console.error(`${driveRef} is a ${drive.documentType}, not a drive`);
  process.exit(1);
}
const state = typeof drive.state === "string" ? JSON.parse(drive.state) : drive.state;
const files = (state?.global?.nodes ?? []).filter((n) => n.kind === "file" && (!types || types.includes(n.documentType)));

// 2. Every document the drive already has a "child" relationship to — paged, not one query per document.
async function childrenOfDrive() {
  const ids = new Set();
  let cursor;
  for (;;) {
    const r = await gql(
      `query($s:String!,$p:PagingInput){documentOutgoingRelationshipEdges(sourceIdOrSlug:$s, relationshipType:"child", paging:$p){hasNextPage cursor items{targetId}}}`,
      { s: drive.id, p: { limit: 500, ...(cursor ? { cursor } : {}) } },
    );
    if (r.errors?.length) throw new Error(`listing the drive's child relationships: ${r.errors[0].message}`);
    const page = r.data.documentOutgoingRelationshipEdges;
    for (const item of page.items) ids.add(item.targetId);
    if (!page.hasNextPage || !page.cursor || page.cursor === cursor) return ids;
    cursor = page.cursor;
  }
}
const linked = await childrenOfDrive();
const unlinked = files.filter((n) => !linked.has(n.id));
console.log(`${drive.name} (${drive.id}) at ${origin}`);
console.log(`  ${files.length} file(s) in the tree${types ? ` of type ${types.join(", ")}` : ""}; ${linked.size} child relationship(s) from the drive`);

// 3. Only documents that still exist — a tree node can outlive its document.
const missing = [];
const gone = [];
for (const group of chunks(unlinked, 50)) {
  const vars = Object.fromEntries(group.map((n, i) => [`i${i}`, n.id]));
  const r = await gql(
    `query(${group.map((_, i) => `$i${i}:String!`).join(",")}){${group.map((_, i) => `d${i}:document(identifier:$i${i}){document{id}}`).join(" ")}}`,
    vars,
  );
  const errorAt = new Map((r.errors ?? []).map((e) => [e.path?.[0], e.message ?? ""]));
  group.forEach((n, i) => {
    if (r.data?.[`d${i}`]?.document?.id) return missing.push(n);
    const msg = errorAt.get(`d${i}`) ?? "no document";
    if (/not found|deleted|purged|no document/i.test(msg)) return gone.push(n);
    throw new Error(`${n.id} (${n.name}): ${msg}`);
  });
}
console.log(`  missing the relationship: ${missing.length}${missing.length ? ` (${countByType(missing)})` : ""}`);
if (gone.length) console.log(`  in the tree but no longer a document, left alone: ${gone.length}`);

if (!apply) {
  if (missing.length) console.log("Dry run: nothing written. Re-run with --apply to add them.");
  process.exit(0);
}

// 4. Add them, a batch per job, onto the drive's document-scope log. Submitted
//    with executeAsync and followed by jobStatus, NOT the synchronous execute:
//    the job is READ_READY in well under a second, but execute then re-reads the
//    drive at the job's consistency token, and for a relationship whose source is
//    a drive that read did not return within 300 s (6.2.3-dev.66, 2026-10-20).
async function settle(jobId) {
  const deadline = Date.now() + 120_000;
  for (;;) {
    const r = await gql(`query($j:String!){jobStatus(jobId:$j){status error errorName}}`, { j: jobId });
    const job = r.data?.jobStatus;
    if (job?.status === "READ_READY") return null;
    if (job?.status === "FAILED") return job.error ?? job.errorName ?? "job failed";
    if (r.errors?.length && !job) return r.errors[0].message;
    if (Date.now() > deadline) return `job ${jobId} still ${job?.status ?? "unknown"} after 120 s`;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}
const todo = missing.slice(0, limit);
let added = 0;
const failed = [];
for (const group of chunks(todo, batch)) {
  const actions = group.map((n) => ({
    id: randomUUID(),
    type: "ADD_RELATIONSHIP",
    scope: "document",
    timestampUtcMs: new Date().toISOString(),
    input: { sourceId: drive.id, targetId: n.id, relationshipType: "child" },
  }));
  const r = await gql(`mutation($id:String!,$a:[ActionInput!]!){executeAsync(documentIdOrSlug:$id, actions:$a){id}}`, { id: drive.id, a: actions });
  const error = r.errors?.length ? r.errors[0].message : await settle(r.data.executeAsync.id);
  if (error) failed.push({ count: group.length, error, first: group[0].id });
  else added += group.length;
  console.log(`  … ${added + failed.reduce((sum, f) => sum + f.count, 0)}/${todo.length}`);
}

// 5. Read back — a dispatch is not a result.
const after = await childrenOfDrive();
const stillMissing = todo.filter((n) => !after.has(n.id));
console.log(`settled: ${added}; refused: ${failed.reduce((s, f) => s + f.count, 0)}; confirmed by read-back: ${todo.length - stillMissing.length}/${todo.length}`);
for (const f of failed.slice(0, 5)) console.log(`  refused batch starting ${f.first}: ${f.error}`);
if (missing.length > todo.length) console.log(`--limit left ${missing.length - todo.length} for a later run`);
process.exit(failed.length || stillMissing.length ? 1 : 0);
