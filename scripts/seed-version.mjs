#!/usr/bin/env node
/*
  Recompute a browser seed's `version` after editing it by hand:

    node scripts/seed-version.mjs browser/seed/guide-vault.json

  The version is the one build-browser-seed.mjs writes — sha256 of the content (everything but the
  version, in file order), first 12 hex digits — so a returning visitor's vault can tell the guide
  changed and offer a reset.
*/
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const file = process.argv[2];
if (!file) {
  console.error("usage: node scripts/seed-version.mjs <seed.json>");
  process.exit(1);
}
const { version: previous, ...content } = JSON.parse(readFileSync(file, "utf8"));
const version = createHash("sha256").update(JSON.stringify(content)).digest("hex").slice(0, 12);
writeFileSync(file, `${JSON.stringify({ version, ...content }, null, 1)}\n`);
console.log(`seed ${previous} → ${version}`);
