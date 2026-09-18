#!/usr/bin/env node
/**
 * Upgrade existing documents across a document-model version bump.
 *
 * WHY THIS EXISTS
 *
 * The reactor serves a document's state as a raw snapshot read of
 * reactor."DocumentSnapshot".content — the reducer never runs at read time, and
 * `initialState` is the *same object* as `state`. A document's initial values are
 * frozen at creation into its UPGRADE_DOCUMENT(fromVersion: 0) operation and are
 * never refreshed from the currently-loaded module. So when a model gains a
 * non-nullable field, every pre-existing document keeps the old shape forever:
 * editing it does not help (the reducer runs on the stored state) and neither
 * does a cold rebuild (it replays from the frozen seed).
 *
 * The supported repair is a real version bump — specifications[] gains a v2, the
 * codegen emits upgrades/v2.ts, and each document is walked forward with an
 * UPGRADE_DOCUMENT action. The executor validates the document's stamped version
 * and a per-scope revision snapshot, runs the upgrade reducer (which migrates
 * BOTH state and initialState), and marks the result __migrated so every scope is
 * reindexed. A document already at the target version is a no-op success, so this
 * script is safe to re-run.
 *
 * Usage:
 *   node scripts/upgrade-documents.mjs --drive <driveId> [--type bai/source]
 *   node scripts/upgrade-documents.mjs --drive <driveId> --type bai/source --apply
 *
 *   --drive <id>      drive to sweep (required)
 *   --type <t>        only documents of this documentType (comma-separated).
 *                     Defaults to the models that actually have a v2:
 *                     bai/source, bai/knowledge-note, bai/vault-config, bai/pipeline-queue
 *   --all-types       sweep every document type on the drive (rarely what you want)
 *   --to <n>          target version (default: the model's latest registered version)
 *   --expect <field>  global-state field that must be present after the upgrade
 *   --concurrency <n> default 4
 *   --apply           actually dispatch; omit for a dry run
 *
 * Auth: SWITCHBOARD_TOKEN, or falls back to `switchboard auth token`.
 * Origin: SWITCHBOARD_ORIGIN, default http://localhost:4001
 *
 * Exit: 0 clean · 1 one or more documents failed · 2 nothing to do / bad input
 */
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i === -1 ? d : args[i + 1]; };
const APPLY = args.includes("--apply");
const DRIVE = opt("--drive");
// Only these models have a v2 in this package. Sweeping a type with no
// registered upgrade path makes the executor fail with ManifestNotFoundError
// on every document, so an un-narrowed run defaults to the bumped set rather
// than to "everything on the drive". --all-types overrides.
const BUMPED_TYPES = ["bai/source", "bai/knowledge-note", "bai/vault-config", "bai/pipeline-queue"];
const TYPES = opt("--type")
  ? new Set(opt("--type").split(","))
  : args.includes("--all-types") ? null : new Set(BUMPED_TYPES);
const TO = opt("--to") ? Number(opt("--to")) : undefined;
const EXPECT = opt("--expect");
const CONCURRENCY = Number(opt("--concurrency", "4"));

if (!DRIVE) { console.error("--drive <driveId> is required"); process.exit(2); }

const ORIGIN = (process.env.SWITCHBOARD_ORIGIN ?? "http://localhost:4001").replace(/\/$/, "");
const TOKEN = process.env.SWITCHBOARD_TOKEN ?? execSync("switchboard auth token", { encoding: "utf8" }).trim();
const H = { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" };

async function gql(query, variables) {
  const r = await fetch(`${ORIGIN}/graphql`, { method: "POST", headers: H, body: JSON.stringify({ query, variables }) });
  const j = await r.json();
  if (j.errors) throw new Error(j.errors.map((e) => e.message).join("; "));
  return j.data;
}

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  }));
  return out;
}

/** The document's stamped model version; 0/absent means "predates versioning" == 1. */
const stampedVersion = (state) => {
  const v = state?.document?.version;
  return v && v > 0 ? v : 1;
};

const readDoc = async (id) => {
  const d = await gql(`query($id: String!){ document(identifier:$id){ document{ state } } }`, { id });
  const s = d.document.document.state;
  return typeof s === "string" ? JSON.parse(s) : s;
};

// Enumerate over GraphQL, not `switchboard docs list` — the CLI resolves the
// drive through its own active profile, so against a remote SWITCHBOARD_ORIGIN
// it would list the LOCAL drive while the upgrades were dispatched remotely.
const driveState = await readDoc(DRIVE);
const nodes = driveState.global?.nodes ?? [];
const docs = nodes
  .map((n) => ({ id: n.id, type: n.documentType, name: n.name }))
  .filter((d) => d.id && d.type && (!TYPES || TYPES.has(d.type)));

if (!docs.length) { console.error(`no documents matched on drive ${DRIVE}`); process.exit(2); }
console.log(`drive ${DRIVE} · ${docs.length} candidate documents${TYPES ? ` (${[...TYPES].join(", ")})` : " (ALL types — --all-types)"}`);
{
  const unknown = [...(TYPES ?? [])].filter((t) => !BUMPED_TYPES.includes(t));
  if (unknown.length) console.log(`WARNING: ${unknown.join(", ")} have no v2 in this package; every upgrade will fail`);
}

const plan = await pool(docs, CONCURRENCY, async (d) => {
  try {
    const state = await readDoc(d.id);
    const from = stampedVersion(state);
    const hasField = EXPECT ? EXPECT in (state.global ?? {}) : undefined;
    return { ...d, from, hasField, needs: TO === undefined ? hasField === false : from < TO };
  } catch (e) { return { ...d, failed: String(e.message).slice(0, 160) }; }
});

const broken = plan.filter((p) => p.failed);
const todo = plan.filter((p) => !p.failed && p.needs);
const done = plan.filter((p) => !p.failed && !p.needs);

const byType = (rows) => rows.reduce((a, r) => ((a[r.type] = (a[r.type] ?? 0) + 1), a), {});
console.log(`already current: ${done.length}`, byType(done));
console.log(`to upgrade:      ${todo.length}`, byType(todo));
if (broken.length) console.log(`unreadable:      ${broken.length}`, broken.slice(0, 3).map((b) => `${b.id} ${b.failed}`));
if (EXPECT) console.log(`(a document counts as needing the upgrade when "${EXPECT}" is absent from state.global)`);

if (!todo.length) { console.log("nothing to do"); process.exit(broken.length ? 1 : 0); }
if (!APPLY) { console.log("\nDRY RUN — re-run with --apply to dispatch UPGRADE_DOCUMENT"); process.exit(0); }

const TARGET = (p) => TO ?? p.from + 1;

const results = await pool(todo, CONCURRENCY, async (p) => {
  try {
    // ActionInput requires an id and an ISO-8601 timestamp — despite the field
    // name, `timestampUtcMs` is rejected when given epoch milliseconds.
    const action = {
      id: randomUUID(),
      type: "UPGRADE_DOCUMENT",
      scope: "document",
      timestampUtcMs: new Date().toISOString(),
      input: { documentId: p.id, model: p.type, fromVersion: p.from, toVersion: TARGET(p) },
    };
    await gql(
      `mutation($id: String!, $a: [ActionInput!]!){ execute(documentIdentifier: $id, actions: $a){ id } }`,
      { id: p.id, a: [action] },
    );
    const after = await readDoc(p.id);
    const okVersion = stampedVersion(after) >= TARGET(p);
    const okField = EXPECT ? EXPECT in (after.global ?? {}) : true;
    return {
      ...p,
      ok: okVersion && okField,
      why: okVersion ? (okField ? "" : `"${EXPECT}" still absent`) : `still v${stampedVersion(after)}`,
    };
  } catch (e) {
    return { ...p, ok: false, why: String(e.message).slice(0, 160) };
  }
});

const failed = results.filter((r) => !r.ok);
console.log(`\nupgraded: ${results.length - failed.length}/${results.length}`);
for (const f of failed.slice(0, 20)) console.log(`  FAILED ${f.type} ${f.id} — ${f.why}`);
process.exit(failed.length ? 1 : 0);
