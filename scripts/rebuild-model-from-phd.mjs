#!/usr/bin/env node
/**
 * rebuild-model-from-phd.mjs — load a `powerhouse/document-model` snapshot
 * (`backup-documents/*.phd`) into a reactor as real operations.
 *
 * The `.phd` backups Vetra writes are STATE snapshots: `operations.json` is
 * empty. `switchboard import` replays operations, so on these files it creates
 * a blank document and pushes nothing (Connect's drag-and-drop imports the
 * snapshot directly, which is why that path works). This script turns the
 * snapshot's state into the action stream that produces it — SET_MODEL_*,
 * SET_STATE_SCHEMA, ADD_MODULE, ADD_OPERATION (schema + reducer),
 * ADD_OPERATION_ERROR, … — keeping every module / operation / error id, so
 * codegen regenerates byte-identical files. Dispatch goes through the
 * reactor's MCP endpoint (`addActions`), the sanctioned way to change a model.
 *
 * Usage:
 *   node scripts/rebuild-model-from-phd.mjs <file.phd> --doc <document-id> [--origin http://localhost:4001] [--verify-only]
 *   node scripts/rebuild-model-from-phd.mjs <file.phd> --create --drive vetra-<hash> [--origin …]
 *
 * --doc          an existing (blank or stale) document-model document to fill
 * --create       create the document in --drive first (MCP createDocument)
 * --verify-only  read the document back and compare it to the snapshot; write nothing
 * Auth: SWITCHBOARD_TOKEN, else `switchboard auth token`.
 * Exit 0 when the read-back equals the snapshot, 1 otherwise.
 */
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";

// ---- minimal zip reader (the backups are a handful of deflated JSON files) ----
function readZip(buf) {
  const files = {};
  let p = 0;
  while (p + 30 <= buf.length && buf.readUInt32LE(p) === 0x04034b50) {
    const method = buf.readUInt16LE(p + 8);
    const csize = buf.readUInt32LE(p + 18);
    const nameLen = buf.readUInt16LE(p + 26);
    const extraLen = buf.readUInt16LE(p + 28);
    const name = buf.subarray(p + 30, p + 30 + nameLen).toString("utf8");
    const start = p + 30 + nameLen + extraLen;
    const data = buf.subarray(start, start + csize);
    files[name] = method === 8 ? inflateRawSync(data) : method === 0 ? data : null;
    if (files[name] === null) throw new Error(`unsupported zip method ${method} for ${name}`);
    p = start + csize;
  }
  return files;
}

const args = process.argv.slice(2);
const file = args.find((a) => a.endsWith(".phd"));
const opt = (n, d) => { const i = args.indexOf(n); return i === -1 ? d : args[i + 1]; };
const VERIFY = args.includes("--verify-only");
const CREATE = args.includes("--create");
const ORIGIN = (opt("--origin", process.env.SWITCHBOARD_ORIGIN ?? "http://localhost:4001")).replace(/\/$/, "");
if (!file || (!opt("--doc") && !CREATE)) { console.error("usage: <file.phd> (--doc <id> | --create --drive <slug>)"); process.exit(1); }
const TOKEN = process.env.SWITCHBOARD_TOKEN ?? execSync("switchboard auth token", { encoding: "utf8" }).trim();

// ---- MCP over Streamable HTTP ----
let sid = null;
async function rpc(method, params, id = 1) {
  const headers = { authorization: `Bearer ${TOKEN}`, "content-type": "application/json", accept: "application/json, text/event-stream" };
  if (sid) headers["mcp-session-id"] = sid;
  // A JSON-RPC notification carries no id and gets no result.
  const isNotification = method.startsWith("notifications/");
  const body = isNotification ? { jsonrpc: "2.0", method, params } : { jsonrpc: "2.0", id, method, params };
  const r = await fetch(`${ORIGIN}/mcp`, { method: "POST", headers, body: JSON.stringify(body) });
  sid ??= r.headers.get("mcp-session-id");
  if (isNotification) return null;
  const text = await r.text();
  for (const line of text.split("\n")) {
    const l = line.replace(/^data: /, "").trim();
    if (!l.startsWith("{")) continue;
    const j = JSON.parse(l);
    if (j.error) throw new Error(`MCP ${method}: ${JSON.stringify(j.error).slice(0, 400)}`);
    return j.result;
  }
  return null;
}
async function tool(name, args_) {
  const res = await rpc("tools/call", { name, arguments: args_ }, 2);
  const text = res?.content?.[0]?.text ?? "";
  try { return JSON.parse(text); } catch { return text; }
}
await rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "rebuild-model-from-phd", version: "1" } });
await rpc("notifications/initialized", {});

// ---- snapshot → actions ----
const zip = readZip(readFileSync(file));
const g = JSON.parse(zip["state.json"].toString("utf8")).global;
if (JSON.parse(zip["header.json"].toString("utf8")).documentType !== "powerhouse/document-model") { console.error("not a document-model snapshot"); process.exit(1); }
const spec = g.specifications[0];
const act = (type, input) => ({ type, input, scope: "global" });
const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined));
const A = [act("SET_MODEL_NAME", { name: g.name }), act("SET_MODEL_ID", { id: g.id })];
if (g.extension) A.push(act("SET_MODEL_EXTENSION", { extension: g.extension }));
if (g.description) A.push(act("SET_MODEL_DESCRIPTION", { description: g.description }));
if (g.author?.name) A.push(act("SET_AUTHOR_NAME", { authorName: g.author.name }));
if (g.author?.website) A.push(act("SET_AUTHOR_WEBSITE", { authorWebsite: g.author.website }));
for (const scope of ["global", "local"]) {
  const st = spec.state[scope];
  if (st?.schema) A.push(act("SET_STATE_SCHEMA", { scope, schema: st.schema }));
  if (st?.initialValue) A.push(act("SET_INITIAL_STATE", { scope, initialValue: st.initialValue }));
  for (const ex of st?.examples ?? []) A.push(act("ADD_STATE_EXAMPLE", { scope, id: ex.id, example: ex.value }));
}
for (const cl of spec.changeLog ?? []) A.push(act("ADD_CHANGE_LOG_ITEM", { id: cl.id, content: cl.content }));
for (const m of spec.modules) {
  A.push(act("ADD_MODULE", clean({ id: m.id, name: m.name, description: m.description })));
  for (const o of m.operations) {
    A.push(act("ADD_OPERATION", clean({ moduleId: m.id, id: o.id, name: o.name, schema: o.schema, description: o.description, template: o.template, reducer: o.reducer, scope: o.scope })));
    for (const e of o.errors ?? []) A.push(act("ADD_OPERATION_ERROR", clean({ operationId: o.id, id: e.id, errorCode: e.code, errorName: e.name, errorDescription: e.description, errorTemplate: e.template })));
    for (const ex of o.examples ?? []) A.push(act("ADD_OPERATION_EXAMPLE", { operationId: o.id, id: ex.id, example: ex.value }));
  }
}

// ---- target document ----
let docId = opt("--doc");
if (CREATE && !VERIFY) {
  const drive = opt("--drive"); if (!drive) { console.error("--create needs --drive"); process.exit(1); }
  const created = await tool("createDocument", { documentType: "powerhouse/document-model", name: g.name, driveId: drive });
  docId = created?.id ?? created?.documentId ?? created?.document?.header?.id;
  if (!docId) { console.error("createDocument returned no id:", JSON.stringify(created).slice(0, 300)); process.exit(1); }
  console.log(`created ${docId} in ${drive}`);
}
if (!VERIFY) {
  console.log(`${g.name}: dispatching ${A.length} actions to ${docId}`);
  const res = await tool("addActions", { documentId: docId, actions: A });
  console.log("  result:", JSON.stringify(res).slice(0, 200));
}

// ---- read back and compare ----
const doc = await tool("getDocument", { id: docId });
const cur = doc.document.state.global;
const norm = (x) => JSON.stringify(x);
// key-sorted deep copy, so two objects compare equal regardless of key order
const canon = (x) =>
  JSON.parse(
    JSON.stringify(x, (k, v) =>
      v && typeof v === "object" && !Array.isArray(v)
        ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))
        : v,
    ),
  );
const mism = [];
for (const k of ["id", "name", "description", "extension", "author"]) if (norm(canon(cur[k])) !== norm(canon(g[k]))) mism.push(k);
if (norm(canon(cur.specifications[0].state)) !== norm(canon(spec.state))) mism.push("state");
const opsOf = (s) => Object.fromEntries(s.modules.flatMap((m) => m.operations.map((o) => [`${m.id}/${o.id}`, norm(canon({ name: o.name, scope: o.scope, schema: o.schema, reducer: o.reducer, description: o.description, template: o.template, errors: o.errors, examples: o.examples }))])));
const a = opsOf(cur.specifications[0]), b = opsOf(spec);
for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) if (a[k] !== b[k]) mism.push(`op ${k}`);
const errs = (doc.document.operations?.global ?? []).filter((o) => o.error);
console.log(`  read-back: ${mism.length ? "MISMATCH " + mism.join(", ") : "IDENTICAL to snapshot"} | operations with reducer error: ${errs.length}`);
process.exit(mism.length ? 1 : 0);
