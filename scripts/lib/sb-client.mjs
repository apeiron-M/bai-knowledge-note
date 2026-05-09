/**
 * Switchboard sync helpers.
 *
 * Two transports:
 *   - GraphQL (raw fetch) — for reads (drive tree, document state)
 *   - switchboard CLI     — for writes (docs create, docs apply)
 *
 * Reading via GraphQL keeps the export portable (no auth assumed) and the
 * write path through the CLI lets us reuse profile config + token handling
 * without re-implementing it.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// ─── Profile / URL resolution ───

let profileUrlCache = null;

export function listProfiles() {
  if (profileUrlCache) return profileUrlCache;
  const res = spawnSync("switchboard", ["config", "list", "--format", "json"], {
    encoding: "utf-8",
  });
  if (res.status !== 0) {
    throw new Error(`switchboard config list failed: ${res.stderr}`);
  }
  const arr = JSON.parse(res.stdout);
  profileUrlCache = Object.fromEntries(arr.map((p) => [p.name, p.url]));
  return profileUrlCache;
}

export function resolveProfileUrl(profile) {
  const profiles = listProfiles();
  if (!(profile in profiles)) {
    throw new Error(
      `Unknown profile '${profile}'. Available: ${Object.keys(profiles).join(", ")}`,
    );
  }
  return profiles[profile];
}

// ─── Raw GraphQL ───

export async function gql(url, query, variables = {}) {
  const res = await fetch(url, {
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

const DOC_QUERY = `query ($id: String!) {
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
}`;

export async function fetchDocument(url, id) {
  const data = await gql(url, DOC_QUERY, { id });
  return data?.document?.document ?? null;
}

// ─── Switchboard CLI invokers ───

function runCli(profile, args, { input } = {}) {
  const res = spawnSync(
    "switchboard",
    ["--profile", profile, ...args, "--format", "json"],
    { encoding: "utf-8", input },
  );
  if (res.status !== 0) {
    throw new Error(
      `switchboard ${args.join(" ")} failed (exit ${res.status}): ${res.stderr || res.stdout}`,
    );
  }
  return res.stdout;
}

export function cliIntrospect(profile) {
  const res = spawnSync("switchboard", ["--profile", profile, "introspect"], {
    encoding: "utf-8",
  });
  if (res.status !== 0) {
    throw new Error(`switchboard introspect failed: ${res.stderr}`);
  }
}

export function cliListDrives(profile) {
  const out = runCli(profile, ["drives", "list"]);
  return JSON.parse(out);
}

export function cliListDocs(profile, drive) {
  const out = runCli(profile, ["docs", "list", "--drive", drive]);
  return JSON.parse(out);
}

export function cliCreateDoc(profile, { type, name, drive, parentFolder }) {
  const args = [
    "docs",
    "create",
    "--type",
    type,
    "--name",
    name,
    "--drive",
    drive,
  ];
  if (parentFolder) args.push("--parent-folder", parentFolder);
  const out = runCli(profile, args);
  const obj = JSON.parse(out);
  if (!obj.id) {
    throw new Error(`docs create returned no id: ${out}`);
  }
  return obj.id;
}

export function cliDeleteDoc(profile, id) {
  return runCli(profile, ["docs", "delete", id, "-y"]);
}

/**
 * Apply a batch of actions to a document via `switchboard docs apply --file`.
 * Returns the parsed CLI output (jobId + status).
 */
export function cliApplyActions(profile, docId, actions, { wait = true } = {}) {
  if (!actions?.length) return { skipped: true };
  const tmp = path.join(
    os.tmpdir(),
    `sb-apply-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`,
  );
  fs.writeFileSync(tmp, JSON.stringify(actions));
  try {
    const args = ["docs", "apply", docId, "--file", tmp];
    if (wait) args.push("--wait");
    const stdout = runCli(profile, args);
    return parseApplyOutput(stdout);
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch {}
  }
}

function parseApplyOutput(stdout) {
  // CLI emits multiple JSON blobs separated by status lines. Take the last
  // valid JSON object so we get the final job result.
  const matches = stdout.match(/\{[\s\S]*?\n\}/g) ?? [];
  const last = matches[matches.length - 1] ?? matches[0];
  if (!last) return { raw: stdout };
  try {
    return JSON.parse(last);
  } catch {
    return { raw: stdout };
  }
}

// ─── Action builders (current schema) ───
//
// Build current-schema-compliant actions from an exported document state.
// Replays of the raw operation history fail when remote ops were captured
// against an older schema (e.g. SET_TITLE without `updatedAt`), so we
// reconstruct from the final state instead.

let idCounter = 0;
function genId(prefix = "sync") {
  return `${prefix}-${Date.now()}-${++idCounter}`;
}

export function buildKnowledgeNoteActions(state) {
  const g = state.global ?? {};
  const now = new Date().toISOString();
  const createdAt = g.provenance?.createdAt ?? now;
  const actions = [];

  if (g.title) {
    actions.push({
      type: "SET_TITLE",
      input: { title: g.title, updatedAt: createdAt },
      scope: "global",
    });
  }
  if (g.description) {
    actions.push({
      type: "SET_DESCRIPTION",
      input: { description: g.description, updatedAt: now },
      scope: "global",
    });
  }
  if (g.noteType) {
    actions.push({
      type: "SET_NOTE_TYPE",
      input: { noteType: g.noteType, updatedAt: now },
      scope: "global",
    });
  }
  if (g.content) {
    actions.push({
      type: "SET_CONTENT",
      input: { content: g.content, updatedAt: now },
      scope: "global",
    });
  }
  if (g.status && g.status !== "DRAFT") {
    actions.push({
      type: "SET_STATUS",
      input: { status: g.status },
      scope: "global",
    });
  }
  if (g.provenance) {
    actions.push({
      type: "SET_PROVENANCE",
      input: {
        author: g.provenance.author ?? null,
        sourceOrigin: g.provenance.sourceOrigin ?? null,
        createdAt: g.provenance.createdAt ?? createdAt,
      },
      scope: "global",
    });
  }
  for (const t of g.topics ?? []) {
    const name = typeof t === "string" ? t : t.name;
    if (name) {
      actions.push({
        type: "ADD_TOPIC",
        input: { id: genId("topic"), name },
        scope: "global",
      });
    }
  }

  const stringFields = [
    "scope",
    "confidence",
    "severity",
    "editor",
    "modelId",
    "model",
    "version",
    "filePath",
    "computes",
    "context",
    "decisionStatus",
    "sourceType",
    "targetType",
    "relationType",
    "cardinality",
    "errorMessage",
    "rootCause",
    "correctPattern",
  ];
  for (const f of stringFields) {
    if (g[f]) {
      actions.push({
        type: "SET_METADATA_FIELD",
        input: { field: f, value: g[f], updatedAt: now },
        scope: "global",
      });
    }
  }
  const listFields = [
    "modules",
    "models",
    "hooksUsed",
    "dispatchTargets",
    "inputs",
    "outputs",
    "consumedBy",
    "alternatives",
    "consequences",
  ];
  for (const f of listFields) {
    if (Array.isArray(g[f]) && g[f].length > 0) {
      actions.push({
        type: "SET_METADATA_LIST_FIELD",
        input: { field: f, values: g[f], updatedAt: now },
        scope: "global",
      });
    }
  }

  return actions;
}

export function buildMocActions(state) {
  const g = state.global ?? {};
  const now = new Date().toISOString();
  const actions = [
    {
      type: "CREATE_MOC",
      input: {
        title: g.title ?? "Untitled MOC",
        description: g.description ?? "",
        orientation: g.orientation ?? "",
        tier: g.tier ?? "TOPIC",
        parentRef: g.parentRef ?? null,
        createdAt: g.createdAt ?? now,
      },
      scope: "global",
    },
  ];
  for (const q of g.openQuestions ?? []) {
    actions.push({
      type: "ADD_OPEN_QUESTION",
      input: { question: q },
      scope: "global",
    });
  }
  return actions;
}

export function buildSourceActions(state) {
  const g = state.global ?? {};
  const now = new Date().toISOString();
  const actions = [];
  if (g.title || g.content) {
    actions.push({
      type: "INGEST_SOURCE",
      input: {
        title: g.title ?? "Untitled",
        content: g.content ?? "",
        sourceType: g.sourceType ?? "ARTICLE",
        description: g.description ?? undefined,
        author: g.provenance?.author ?? undefined,
        url: g.provenance?.url ?? undefined,
        createdAt: g.createdAt ?? now,
        createdBy: g.createdBy ?? undefined,
      },
      scope: "global",
    });
  }
  if (g.status && g.status !== "INBOX") {
    actions.push({
      type: "SET_SOURCE_STATUS",
      input: { status: g.status },
      scope: "global",
    });
  }
  for (const ref of g.extractedClaims ?? []) {
    actions.push({
      type: "ADD_EXTRACTED_CLAIM",
      input: { claimRef: ref },
      scope: "global",
    });
  }
  if (g.extractionStats) {
    actions.push({
      type: "RECORD_EXTRACTION_STATS",
      input: {
        claimCount: g.extractionStats.claimCount ?? 0,
        skippedCount: g.extractionStats.skippedCount ?? 0,
        skipRate: g.extractionStats.skipRate ?? 0,
      },
      scope: "global",
    });
  }
  return actions;
}

export function genActionId(prefix) {
  return genId(prefix);
}

export const SINGLETON_TYPES = new Set([
  "bai/knowledge-graph",
  "bai/vault-config",
  "bai/health-report",
  "bai/pipeline-queue",
]);

export const TYPE_FOLDERS = {
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
