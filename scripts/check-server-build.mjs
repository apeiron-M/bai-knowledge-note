#!/usr/bin/env node
/**
 * The server build must not need anything the Switchboard cannot install.
 *
 * `ph-cli build` lists each package the server build needs that carries a
 * WebAssembly module or a native addon in dist/powerhouse.manifest.json's
 * `externalDependencies`, and the Switchboard's registry loader then refuses this
 * package's subgraphs and processors unless the host has installed every one of
 * them ("…its subgraphs and processors are not loaded, its document models and
 * pieces are"). 1.0.54-dev.41 carried the browser vault — knowledge-vault-landing's
 * "Try on web", with docling.rs-wasm and PGlite — into the server build: on the
 * cloud it served document models only, with no knowledgeGraph, no REST routes and
 * no graph indexer.
 *
 * The browser vault reaches only the browser build, through `#browser-vault`
 * (package.json "imports"; browser/unavailable.ts in the server build). This checks
 * the result after `ph-cli build` (the build script) and again before packing
 * (prepack), so a publish cannot ship it. See CLAUDE.md. Node only.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const dist = "dist";
const problems = [];
const manifestPath = join(dist, "powerhouse.manifest.json");
if (!existsSync(manifestPath)) {
  console.error(`[server-build] ${manifestPath} is missing; build first`);
  process.exit(1);
}
const external = JSON.parse(readFileSync(manifestPath, "utf8")).externalDependencies ?? {};
const names = Object.keys(external);
if (names.length > 0) {
  problems.push(
    `the manifest lists externalDependencies the Switchboard would have to install: ${names.map((n) => `${n}@${external[n]}`).join(", ")}`,
  );
}

const walk = (dir) =>
  existsSync(dir)
    ? readdirSync(dir).flatMap((f) => {
        const p = join(dir, f);
        return statSync(p).isDirectory() ? walk(p) : [p];
      })
    : [];
const scripts = (dir) => walk(dir).filter((f) => /\.m?js$/.test(f));

for (const file of scripts(join(dist, "node"))) {
  const src = readFileSync(file, "utf8");
  if (/["'`]docling\.rs-wasm(\/[^"'`]*)?["'`]/.test(src)) problems.push(`${file} imports docling.rs-wasm`);
  if (src.includes("#browser-vault")) problems.push(`${file} names #browser-vault: the build left it unresolved`);
}
const browser = scripts(join(dist, "browser"));
for (const file of browser) {
  if (readFileSync(file, "utf8").includes("#browser-vault")) problems.push(`${file} names #browser-vault: the build left it unresolved`);
}
// The landing site still needs the browser vault from the browser build.
if (!browser.some((file) => readFileSync(file, "utf8").includes("bootBrowserVault"))) {
  problems.push("the browser build no longer carries the browser vault (no bootBrowserVault): knowledge-vault-landing needs it");
}

if (problems.length > 0) {
  console.error(`[server-build] the build would not load on a Switchboard as it should:\n  ${problems.join("\n  ")}`);
  process.exit(1);
}
console.log("[server-build] ok: no external dependencies; the browser vault is in the browser build only");
