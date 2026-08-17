#!/usr/bin/env node
/**
 * Install this repo's Claude Code skills into another project.
 *
 * Two things get installed:
 *   1. The powerhouse-knowledge plugin (16 skills: seed, extract, connect,
 *      synthesize, verify, pipeline, health, graph, search, setup, import,
 *      export, watch, projects, skills, cli-reference) — via the marketplace
 *      at github.com/liberuum/powerhouse-knowledge, which this repo tracks as
 *      the submodule .claude/plugins/powerhouse-knowledge.
 *   2. This repo's own project skills under .claude/skills/, minus the ones
 *      listed in EXCLUDED_SKILLS below.
 *
 * Usage:
 *   node scripts/install-skills.mjs <target-project-dir> [options]
 *
 * Options:
 *   --scope <user|project|local>  Where the plugin is declared. Default: project
 *                                 (writes <target>/.claude/settings.json so the
 *                                 install travels with the repo for teammates).
 *   --local                       Use this repo's submodule checkout as the
 *                                 marketplace source instead of GitHub. For
 *                                 developing the plugin itself.
 *   --plugin-only                 Skip copying .claude/skills/.
 *   --skills-only                 Skip the plugin, only copy .claude/skills/.
 *   --dry-run                     Print what would run, change nothing.
 */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SUBMODULE_DIR = join(REPO_ROOT, ".claude", "plugins", "powerhouse-knowledge");
const MARKETPLACE_REPO = "liberuum/powerhouse-knowledge";
const MARKETPLACE_NAME = "powerhouse-knowledge";
const PLUGIN_ID = "powerhouse-knowledge@powerhouse-knowledge";

/** Skills present in .claude/skills/ that should NOT be propagated. */
const EXCLUDED_SKILLS = new Set(["vercel-react-best-practices"]);

// Windows resolves `claude`/`git` to .cmd shims, which Node refuses to spawn
// without a shell.
const NEEDS_SHELL = process.platform === "win32";

function die(msg) {
  console.error(`error: ${msg}`);
  process.exit(1);
}

function usage() {
  console.log(
    [
      "Usage: node scripts/install-skills.mjs <target-project-dir> [options]",
      "",
      "Options:",
      "  --scope <user|project|local>  Plugin declaration scope (default: project)",
      "  --local                       Use the local submodule as marketplace source",
      "  --plugin-only                 Skip copying .claude/skills/",
      "  --skills-only                 Skip the plugin install",
      "  --dry-run                     Print actions without performing them",
    ].join("\n"),
  );
}

// ── args ────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
let target = "";
let scope = "project";
let useLocal = false;
let doPlugin = true;
let doSkills = true;
let dryRun = false;

for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--scope") scope = argv[++i] ?? "";
  else if (a === "--local") useLocal = true;
  else if (a === "--plugin-only") doSkills = false;
  else if (a === "--skills-only") doPlugin = false;
  else if (a === "--dry-run") dryRun = true;
  else if (a === "-h" || a === "--help") {
    usage();
    process.exit(0);
  } else if (a.startsWith("-")) die(`unknown option: ${a}`);
  else if (target) die(`unexpected argument: ${a}`);
  else target = a;
}

if (!target) die("missing target project directory (see --help)");
if (!existsSync(target) || !statSync(target).isDirectory())
  die(`target is not a directory: ${target}`);
target = resolve(target);
if (target === REPO_ROOT) die("target is this repo; nothing to install");
if (!["user", "project", "local"].includes(scope))
  die(`--scope must be user, project, or local (got: ${scope})`);

// ── helpers ─────────────────────────────────────────────────────────────────
function run(cmd, args, opts = {}) {
  if (dryRun) {
    console.log(`  [dry-run] ${cmd} ${args.join(" ")}`);
    return { status: 0, stdout: "" };
  }
  const res = spawnSync(cmd, args, {
    stdio: "inherit",
    shell: NEEDS_SHELL,
    ...opts,
  });
  if (res.error?.code === "ENOENT") die(`command not found: ${cmd}`);
  if (!opts.allowFailure && res.status !== 0)
    die(`${cmd} ${args.join(" ")} exited with status ${res.status}`);
  return res;
}

function hasClaudeCli() {
  const res = spawnSync("claude", ["--version"], {
    encoding: "utf8",
    shell: NEEDS_SHELL,
  });
  return !res.error && res.status === 0;
}

console.log(`Installing into: ${target}`);

// ── 1. plugin ───────────────────────────────────────────────────────────────
if (doPlugin) {
  if (!dryRun && !hasClaudeCli())
    die("the 'claude' CLI is not on PATH — needed to install the plugin (use --skills-only to skip)");

  let source = MARKETPLACE_REPO;
  if (useLocal) {
    if (!existsSync(join(SUBMODULE_DIR, ".claude-plugin", "marketplace.json"))) {
      console.log(`==> initializing submodule ${SUBMODULE_DIR}`);
      run("git", [
        "-C",
        REPO_ROOT,
        "submodule",
        "update",
        "--init",
        "--depth",
        "1",
        "--",
        ".claude/plugins/powerhouse-knowledge",
      ]);
    }
    source = SUBMODULE_DIR;
  }

  // `add` is idempotent and re-declares at the requested scope even when the
  // marketplace is already cached on disk. Don't gate it on `marketplace list`
  // — that lists the user-level cache regardless of scope, so a marketplace
  // added for some other project would wrongly suppress the declaration here.
  console.log(`==> registering marketplace (${source}) at scope=${scope}`);
  run("claude", ["plugin", "marketplace", "add", source, "--scope", scope], { cwd: target });
  run("claude", ["plugin", "marketplace", "update", MARKETPLACE_NAME], {
    cwd: target,
    allowFailure: true,
  });

  console.log(`==> installing ${PLUGIN_ID} at scope=${scope}`);
  run("claude", ["plugin", "install", PLUGIN_ID, "--scope", scope], { cwd: target });
}

// ── 2. project skills ───────────────────────────────────────────────────────
if (doSkills) {
  const srcSkills = join(REPO_ROOT, ".claude", "skills");
  if (existsSync(srcSkills)) {
    const destSkills = join(target, ".claude", "skills");
    console.log(`==> copying project skills to ${destSkills}`);
    if (!dryRun) mkdirSync(destSkills, { recursive: true });

    for (const name of readdirSync(srcSkills)) {
      const src = join(srcSkills, name);
      if (EXCLUDED_SKILLS.has(name)) {
        console.log(`    skip ${name} (excluded)`);
        continue;
      }
      // existsSync follows symlinks, so a dangling link reads as missing.
      if (!existsSync(src)) {
        console.log(`    skip ${name} (broken symlink)`);
        continue;
      }
      if (!existsSync(join(src, "SKILL.md"))) {
        console.log(`    skip ${name} (no SKILL.md)`);
        continue;
      }
      console.log(`    ${name}`);
      if (!dryRun) {
        rmSync(join(destSkills, name), { recursive: true, force: true });
        cpSync(src, join(destSkills, name), { recursive: true, dereference: true });
      }
    }
  }
}

console.log();
console.log(`Done. Restart Claude Code in ${target} — skills register at session start.`);
console.log(`Verify with: cd ${target} && claude plugin list`);
