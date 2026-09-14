#!/usr/bin/env node
/**
 * Regenerate .opencode/agent/knowledge-agent.md from the plugin's AGENT.md.
 *
 * The OpenCode agent file is the plugin's canonical instruction set wrapped in
 * OpenCode-specific frontmatter and a preamble that rewrites the things Claude
 * Code supplies implicitly: where the plugin root is, how Claude Code tool
 * names map to OpenCode ones, and that the plugin's hooks do not run here.
 *
 * It drifts silently — the body is a copy, so every AGENT.md edit leaves it
 * stale with no warning. Run this after changing the plugin.
 *
 *   node scripts/sync-opencode-agent.mjs          # write
 *   node scripts/sync-opencode-agent.mjs --check  # exit 1 if stale
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const PLUGIN =
  process.env.POWERHOUSE_KNOWLEDGE_ROOT ??
  "/home/beast/Documents/Powerhouse/powerhouse-knowledge";
const src = join(PLUGIN, "AGENT.md");
const out = join(root, ".opencode", "agent", "knowledge-agent.md");

const FRONTMATTER = `---
description: AI agent for managing a Powerhouse Knowledge Vault — seeding sources, extracting atomic notes, connecting and verifying them over the vault's REST API and the Switchboard CLI.
mode: primary
---
`;

const PREAMBLE = `> **OpenCode adaptation of the powerhouse-knowledge \`knowledge-agent\`.**
> The body below is derived from the plugin's canonical \`AGENT.md\` (generated into
> \`agents/knowledge-agent.md\`). Regenerate with \`node scripts/sync-opencode-agent.mjs\`;
> do not hand-edit the body.
>
> **Plugin root:** \`${PLUGIN}\`. Every relative path in the text below — \`skills/…\`,
> \`CONFIGURATION.md\`, \`scripts/…\`, \`data/methodology/…\` — resolves against that plugin root,
> NOT against the current project directory. Read them via absolute paths, e.g.
> \`${PLUGIN}/skills/setup/SKILL.md\`.
>
> **Tool mapping (OpenCode):** the text speaks in Claude Code terms. Substitute OpenCode
> equivalents: "Subagent"/"Agent" tool → the \`task\` tool (\`subagent_type: "general"\` or
> \`"explore"\`); invoke a skill → OpenCode's native \`skill\` tool; Read/Grep/Glob/WebFetch →
> \`read\`/\`grep\`/\`glob\`/\`webfetch\`; run a shell command → \`bash\`; create/edit/delete files →
> \`write\`/\`edit\`.
>
> **The plugin's hooks are NOT active under OpenCode.** The automatic \`PreToolUse\`/\`PostToolUse\`
> hooks (action linting, signed-write gating, post-apply read-back) do not run here. Run
> \`node ${PLUGIN}/scripts/lint-actions.mjs <actions.json>\` yourself before a
> \`switchboard docs apply\`, and read state back manually after every write. The REST surface
> performs the equivalent checks server-side, so writes over HTTP are validated either way.

`;

const body = readFileSync(src, "utf8");
const hash = createHash("sha256").update(body).digest("hex").slice(0, 16);
const marker = `<!-- GENERATED from ${PLUGIN}/AGENT.md (sha256:${hash}) by scripts/sync-opencode-agent.mjs — edit the plugin, not this file -->\n\n`;
const rendered = FRONTMATTER + PREAMBLE + marker + body;

if (process.argv.includes("--check")) {
  let current = "";
  try {
    current = readFileSync(out, "utf8");
  } catch {
    /* missing counts as stale */
  }
  if (current !== rendered) {
    console.error(
      ".opencode/agent/knowledge-agent.md is stale — run: node scripts/sync-opencode-agent.mjs",
    );
    process.exit(1);
  }
  console.log(".opencode/agent/knowledge-agent.md is up to date");
  process.exit(0);
}

writeFileSync(out, rendered);
console.log(
  `wrote .opencode/agent/knowledge-agent.md from the plugin (${rendered.split("\n").length} lines, sha256:${hash})`,
);
