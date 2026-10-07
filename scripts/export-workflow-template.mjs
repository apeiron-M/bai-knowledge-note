#!/usr/bin/env node
// Export a workflow and its connection from a Switchboard as the pipeline
// template the desktop app instantiates per vault (spec §4.5, §7.5).
//
//   node scripts/export-workflow-template.mjs --profile remote-powerhouse-knowledge \
//     --workflow <workflow document id> --connection <connection document id> \
//     [--out pieces/knowledge-vault/templates/pipeline.json] [--url https://host/graphql]
//
// Auth: SWITCHBOARD_TOKEN, or `switchboard [-p <profile>] auth token`. The URL
// comes from --url or the profile (`switchboard config show`). Read-only: two
// document reads. The result carries no secret values — only placeholders for
// the secret refs — and the script refuses to write a template in which any
// concrete value survived.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { deriveIds, templatize } from "./lib/workflow-template.mjs";

const arg = (key, fallback) => {
  const i = process.argv.indexOf(`--${key}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const profile = arg("profile");
const cli = (...args) => execFileSync("switchboard", [...(profile ? ["-p", profile] : []), ...args], { encoding: "utf8" }).trim();
const url = arg("url") ?? JSON.parse(cli("config", "show", "--format", "json")).url;
const token = process.env.SWITCHBOARD_TOKEN ?? cli("auth", "token");
const out = arg("out", "pieces/knowledge-vault/templates/pipeline.json");
const workflowId = arg("workflow");
const connectionId = arg("connection");
if (!workflowId || !connectionId) {
  console.error("usage: --workflow <id> --connection <id> [--profile <name>] [--url <graphql url>] [--out <file>]");
  process.exit(2);
}

async function gql(query, variables) {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ query, variables }) });
  const json = await res.json();
  if (json.errors?.length) throw new Error(json.errors.map((e) => e.message).join("; "));
  return json.data;
}

/** Every global operation of a document, in order, as { type, input, error }. */
async function operations(id) {
  const ops = [];
  let cursor;
  let documentType;
  for (;;) {
    const data = await gql(
      `query($id: String!, $cursor: String) { document(idOrSlug: $id) { document { documentType operations(paging: { limit: 500, cursor: $cursor }) { items { index error action { type input } } hasNextPage cursor } } } }`,
      { id, cursor },
    );
    const doc = data.document.document;
    documentType = doc.documentType;
    for (const item of doc.operations.items) ops.push({ index: item.index, type: item.action.type, input: item.action.input ?? {}, error: item.error });
    if (!doc.operations.hasNextPage) break;
    cursor = doc.operations.cursor;
  }
  ops.sort((a, b) => a.index - b.index);
  return { documentType, ops: ops.map(({ type, input, error }) => ({ type, input, error })) };
}

const [wf, conn] = await Promise.all([operations(workflowId), operations(connectionId)]);
if (wf.documentType !== "powerhouse/workflow" || conn.documentType !== "powerhouse/connection") {
  throw new Error(`unexpected document types: ${wf.documentType} / ${conn.documentType}`);
}
const docs = { workflow: wf.ops, connection: conn.ops };
const ids = deriveIds(docs);
const template = templatize(docs, ids);
// Nothing environment-specific may survive. Checked before the provenance block
// is attached: that block names the source Switchboard and documents on purpose.
const bare = JSON.stringify(template);
for (const [name, value] of Object.entries({ driveId: ids.driveId, connectionId: ids.connectionId, origin: ids.switchboardOrigin, model: ids.model, pieceVersion: ids.pieceVersion, ...ids.secretRefs })) {
  if (typeof value === "string" && value && bare.includes(value)) throw new Error(`concrete value survived in the template: ${name}`);
}
template.source = { switchboard: new URL(url).origin, workflowId, connectionId };
const text = JSON.stringify(template, null, 2) + "\n";
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, text);
console.log(`template → ${out}: ${template.workflow.operations.length} workflow ops, ${template.connection.operations.length} connection ops, placeholders ${template.placeholders.join(" ")}`);
