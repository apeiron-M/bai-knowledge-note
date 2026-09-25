import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Guards against a Powerhouse package we pin falling behind the stack.
 *
 * `ph use dev` only updates the packages on its own list. A stack package
 * added by hand is not on it, so it silently stays behind while everything
 * else moves. `@powerhousedao/reactor-attachments` did exactly that, twice:
 * it is pinned directly because reactor-browser re-exports the attachment
 * types but not the factories we call (`createAttachmentClient`,
 * `createRef`, `createRemoteAttachmentService`), and it sat at dev.11 while
 * the stack went to dev.20 and then dev.24. `editors/knowledge-vault/lib/
 * attachments.ts` built its attachment service with dev.11 code and handed it
 * to dev.24's `setAttachmentService`.
 *
 * Each pin is compared with what the installed stack packages themselves
 * declare for it, not with one "stack version": not every @powerhousedao
 * package is versioned in lockstep (document-engineering is 1.40.5 while the
 * rest are 6.2.3-dev.x), and a single-version rule would flag it wrongly.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const SECTIONS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
] as const;

/** The stack packages whose own dependencies define what "in step" means. */
const STACK = [
  "reactor",
  "reactor-api",
  "reactor-browser",
  "connect",
  "switchboard",
  "shared",
] as const;

type Manifest = Partial<
  Record<(typeof SECTIONS)[number], Record<string, string>>
>;

function readManifest(path: string): Manifest {
  return JSON.parse(readFileSync(path, "utf8")) as Manifest;
}

function isStackPackage(name: string): boolean {
  return name.startsWith("@powerhousedao/") || name === "document-model";
}

/** Every stack package we pin, with each version we pin it at. */
function ourPins(): Map<string, Set<string>> {
  const manifest = readManifest(join(ROOT, "package.json"));
  const pins = new Map<string, Set<string>>();
  for (const section of SECTIONS) {
    for (const [name, version] of Object.entries(manifest[section] ?? {})) {
      if (!isStackPackage(name)) continue;
      const versions = pins.get(name) ?? new Set<string>();
      versions.add(version);
      pins.set(name, versions);
    }
  }
  return pins;
}

/** For each dependency name: which installed stack package declares which version. */
function stackDeclarations(): Map<string, Map<string, string>> {
  const declared = new Map<string, Map<string, string>>();
  for (const pkg of STACK) {
    const path = join(ROOT, "node_modules", "@powerhousedao", pkg, "package.json");
    if (!existsSync(path)) continue;
    const manifest = readManifest(path);
    for (const section of ["dependencies", "peerDependencies"] as const) {
      for (const [name, version] of Object.entries(manifest[section] ?? {})) {
        const byPackage = declared.get(name) ?? new Map<string, string>();
        byPackage.set(pkg, version);
        declared.set(name, byPackage);
      }
    }
  }
  return declared;
}

describe("Powerhouse stack versions", () => {
  it("pins every stack package at the version the stack itself depends on", () => {
    const declared = stackDeclarations();
    const mismatches: string[] = [];

    for (const [name, versions] of ourPins()) {
      if (versions.size > 1) {
        mismatches.push(
          `${name}: package.json pins it at ${[...versions].join(" and ")} in different sections`,
        );
        continue;
      }
      const [ours] = versions;
      const theirs = declared.get(name);
      if (!theirs) continue; // nothing in the stack depends on it (e.g. ph-cli)

      const disagreeing = [...theirs].filter(([, version]) => version !== ours);
      if (disagreeing.length === 0) continue;

      const wanted = disagreeing[0][1];
      mismatches.push(
        `${name}: we pin ${ours}, but ${disagreeing
          .map(([pkg, version]) => `${pkg} depends on ${version}`)
          .join(", ")} — run: bun add --exact ${name}@${wanted}`,
      );
    }

    expect(mismatches).toEqual([]);
  });

  it("actually compares against an installed stack", () => {
    // Without node_modules there is nothing to compare with, and the check
    // above would pass vacuously. Prove it looked at the package that
    // drifted.
    const declared = stackDeclarations();
    expect(declared.get("@powerhousedao/reactor-attachments")?.size ?? 0).toBeGreaterThan(0);
    expect(ourPins().has("@powerhousedao/reactor-attachments")).toBe(true);
  });
});
