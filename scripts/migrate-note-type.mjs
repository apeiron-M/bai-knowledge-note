#!/usr/bin/env node
/**
 * migrate-note-type.mjs — normalise every bai/knowledge-note's `noteType` on a
 * drive to the `NoteType` enum (CONCEPT, DECISION, PATTERN, OBSERVATION,
 * PROCEDURE, ARCHITECTURE, BUG_PATTERN, INTEGRATION, WORKFLOW, REFERENCE).
 *
 * Why: until the enum, `noteType` was a free string and real drives hold four
 * spellings of one value (`concept`, `CONCEPT`, `bug-pattern`, `BUG-PATTERN`)
 * plus values outside the vocabulary. The reducer now rejects anything but the
 * enum, so stored state has to be brought to it once.
 *
 * What it does, per note: read `state.global.noteType` over REST, map it, and
 * (with --apply) dispatch one SET_NOTE_TYPE through `POST actions`, then read
 * the note back and confirm. Default is a DRY RUN that prints the plan.
 *
 * Mapping: case-insensitive, `-`/space → `_`, so all ten values and their
 * variants map mechanically. A value that does not map is reported and the
 * script exits 2 — give it an explicit rule:
 *   --map RELATION=CONCEPT            every note with that value
 *   --set <documentId>=ARCHITECTURE   one note
 * Notes with a null noteType are reported, never touched.
 *
 * Side effect: SET_NOTE_TYPE stamps `provenance.updatedAt`, so migrated notes
 * read as recently updated to knowledgeGraphRecent / knowledgeGraphStale.
 *
 * Usage:
 *   node scripts/migrate-note-type.mjs --drive <uuid> [--origin http://localhost:4001] [--apply]
 *        [--map OLD=NEW]... [--set id=NEW]... [--concurrency 8]
 * Auth: SWITCHBOARD_TOKEN, else `switchboard auth token`.
 * Runbook (remote deploy order, overrides, record): docs/migrations/2026-09-17-note-type-enum.md
 */
import { execSync } from "node:child_process";

const NOTE_TYPES = ["CONCEPT","DECISION","PATTERN","OBSERVATION","PROCEDURE","ARCHITECTURE","BUG_PATTERN","INTEGRATION","WORKFLOW","REFERENCE"];

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i === -1 ? def : args[i + 1]; };
const multi = (name) => args.flatMap((a, i) => (a === name ? [args[i + 1]] : []));
const APPLY = args.includes("--apply");
const ORIGIN = (opt("--origin", process.env.SWITCHBOARD_ORIGIN ?? "http://localhost:4001")).replace(/\/$/, "");
const DRIVE = opt("--drive");
const CONCURRENCY = Number(opt("--concurrency", "8"));
if (!DRIVE) { console.error("--drive <uuid> is required"); process.exit(1); }

const valueMap = new Map();
for (const m of multi("--map")) { const [o, n] = m.split("="); valueMap.set(o, n); }
const perNote = new Map();
for (const s of multi("--set")) { const [id, n] = s.split("="); perNote.set(id, n); }
for (const v of [...valueMap.values(), ...perNote.values()]) {
  if (!NOTE_TYPES.includes(v)) { console.error(`target ${v} is not a NoteType (${NOTE_TYPES.join(", ")})`); process.exit(1); }
}

const TOKEN = process.env.SWITCHBOARD_TOKEN ?? execSync("switchboard auth token", { encoding: "utf8" }).trim();
const BASE = `${ORIGIN}/api/@powerhousedao/knowledge-note`;
const H = { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" };

async function gql(query, variables) {
  const r = await fetch(`${ORIGIN}/graphql`, { method: "POST", headers: H, body: JSON.stringify({ query, variables }) });
  const j = await r.json();
  if (j.errors) throw new Error(JSON.stringify(j.errors).slice(0, 400));
  return j.data;
}
async function getNote(id) {
  const r = await fetch(`${BASE}/notes/${id}?drive=${DRIVE}`, { headers: H });
  if (!r.ok) throw new Error(`GET notes/${id} → ${r.status}`);
  return r.json();
}
function canonical(raw, id) {
  if (perNote.has(id)) return perNote.get(id);
  if (raw == null || raw === "") return null;
  if (valueMap.has(raw)) return valueMap.get(raw);
  const norm = String(raw).trim().toUpperCase().replace(/[-\s]+/g, "_");
  return NOTE_TYPES.includes(norm) ? norm : undefined; // undefined = unmappable
}
async function pool(items, n, fn) {
  const out = new Array(items.length); let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
  }));
  return out;
}

// 1. enumerate notes (graph index — one call), then read authoritative state per note
const data = await gql(`query($d: ID!) { knowledgeGraphNodes(driveId: $d) { documentId documentType } }`, { d: DRIVE });
const ids = data.knowledgeGraphNodes.filter((n) => n.documentType === "bai/knowledge-note").map((n) => n.documentId);
console.log(`${APPLY ? "APPLY" : "DRY RUN"} · drive ${DRIVE} · ${ids.length} notes indexed`);

const plan = await pool(ids, CONCURRENCY, async (id) => {
  const doc = await getNote(id);
  const raw = doc?.state?.global?.noteType ?? null;
  return { id, raw, to: canonical(raw, id) };
});

const groups = { change: [], keep: [], nullType: [], unmappable: [] };
for (const p of plan) {
  if (p.raw == null && p.to == null) groups.nullType.push(p);
  else if (p.to === undefined) groups.unmappable.push(p);
  else if (p.raw === p.to) groups.keep.push(p);
  else groups.change.push(p);
}
const tally = (list) => { const t = {}; for (const p of list) { const k = `${p.raw} → ${p.to}`; t[k] = (t[k] ?? 0) + 1; } return t; };
console.log(`already canonical: ${groups.keep.length}`);
console.log(`to change: ${groups.change.length}`, tally(groups.change));
if (groups.nullType.length) console.log(`null noteType (untouched): ${groups.nullType.length}`, groups.nullType.map((p) => p.id).join(" "));
if (groups.unmappable.length) {
  console.log(`UNMAPPABLE (${groups.unmappable.length}) — add --map OLD=NEW or --set id=NEW:`);
  for (const p of groups.unmappable) console.log(`  ${p.id}  ${JSON.stringify(p.raw)}`);
  process.exit(2);
}
if (!APPLY) { console.log("dry run — nothing written. Re-run with --apply."); process.exit(0); }

// 2. apply, one SET_NOTE_TYPE per note, then read back
const results = await pool(groups.change, CONCURRENCY, async (p) => {
  const body = { documentId: p.id, wait: true, actions: [{ type: "SET_NOTE_TYPE", scope: "global", input: { noteType: p.to, updatedAt: new Date().toISOString() } }] };
  const r = await fetch(`${BASE}/actions`, { method: "POST", headers: H, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) return { ...p, ok: false, why: `${r.status} ${j.error?.message ?? j.message ?? JSON.stringify(j).slice(0, 200)}` };
  const opErr = (j.operations ?? []).find((o) => o.error)?.error;
  if (opErr) return { ...p, ok: false, why: `reducer: ${opErr}` };
  const after = (await getNote(p.id))?.state?.global?.noteType;
  return { ...p, ok: after === p.to, why: after === p.to ? "" : `read back ${JSON.stringify(after)}` };
});
const failed = results.filter((r) => !r.ok);
console.log(`written and verified: ${results.length - failed.length}/${results.length}`);
for (const f of failed) console.log(`  FAILED ${f.id} ${f.raw} → ${f.to}: ${f.why}`);
process.exit(failed.length ? 1 : 0);
