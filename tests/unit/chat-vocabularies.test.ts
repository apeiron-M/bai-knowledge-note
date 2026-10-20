import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { utils as pipelineQueue } from "document-models/pipeline-queue";
import { buildRuntimeCatalog } from "../../editors/knowledge-vault/chat/core/catalog-models.js";
import {
  CLAIM_KINDS,
  KN_LIST_METADATA_FIELDS,
  KN_STRING_METADATA_FIELDS,
  MOC_STRING_METADATA_FIELDS,
  NOTE_TYPES,
  PIPELINE_DEPTHS,
  PIPELINE_PHASES,
  PIPELINE_TASK_TYPES,
  REPORT_MODES,
  VAULT_DIMENSIONS,
  VAULT_MAINTENANCE_CONDITIONS,
  VAULT_VOCABULARY_KEYS,
  VOCABULARIES,
} from "../../editors/knowledge-vault/chat/core/vocabularies.js";

const read = (path: string) =>
  readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

/** String literals of `const <name> = [ ... ]` in a source file. */
function arrayLiteral(path: string, name: string, nth = 0): string[] {
  const src = read(path);
  const re = new RegExp(`const ${name}(?::[^=]+)? = \\[([^\\]]*)\\]`, "g");
  const m = [...src.matchAll(re)].at(nth);
  if (!m) throw new Error(`${name} not found in ${path}`);
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
}

/** Keys of `const <name>: Record<string, string> = { ... }`. */
function objectKeys(path: string, name: string): string[] {
  const m = read(path).match(new RegExp(`const ${name}[^=]*= \\{([^}]*)\\}`));
  if (!m) throw new Error(`${name} not found in ${path}`);
  return [...m[1].matchAll(/^\s*([\w-]+):/gm)].map((x) => x[1]);
}

const sorted = (xs: readonly string[]) => [...xs].sort();

// The app's lists are canonical (round 7). If one of these fails, the app
// changed: update vocabularies.ts and bump PROMPT_FORMAT_VERSION.
describe("canonical vocabularies match their app sources", () => {
  const kn = "document-models/knowledge-note/v1/src/reducers/content.ts";
  const vc =
    "document-models/vault-config/v1/src/reducers/config-management.ts";

  it("reducer lists", () => {
    expect(arrayLiteral(kn, "STRING_METADATA_FIELDS")).toEqual([
      ...KN_STRING_METADATA_FIELDS,
    ]);
    expect(arrayLiteral(kn, "LIST_METADATA_FIELDS")).toEqual([
      ...KN_LIST_METADATA_FIELDS,
    ]);
    expect(
      arrayLiteral(
        "document-models/moc/v1/src/reducers/moc-management.ts",
        "STRING_METADATA_FIELDS",
      ),
    ).toEqual([...MOC_STRING_METADATA_FIELDS]);
    expect(arrayLiteral(vc, "DIMENSION_KEYS")).toEqual([...VAULT_DIMENSIONS]);
    expect(arrayLiteral(vc, "VOCABULARY_KEYS")).toEqual([
      ...VAULT_VOCABULARY_KEYS,
    ]);
    expect(arrayLiteral(vc, "MAINTENANCE_KEYS")).toEqual([
      ...VAULT_MAINTENANCE_CONDITIONS,
    ]);
  });

  it("editor lists", () => {
    expect(
      arrayLiteral("editors/knowledge-note-editor/editor.tsx", "NOTE_TYPES"),
    ).toEqual([...NOTE_TYPES]);
    const rc = "editors/research-claim-editor/editor.tsx";
    const options = [...read(rc).matchAll(/<option value="([^"]+)"/g)].map(
      (m) => m[1],
    );
    expect(options).toEqual([...CLAIM_KINDS]);
    expect(sorted(objectKeys(rc, "KIND_COLORS"))).toEqual(sorted(CLAIM_KINDS));
    expect(
      sorted(
        objectKeys("editors/pipeline-queue-editor/editor.tsx", "PHASE_COLORS"),
      ),
    ).toEqual(sorted(PIPELINE_PHASES));
  });

  it("pipeline-queue seed data", () => {
    const { phaseOrder } = pipelineQueue.createDocument().state.global;
    expect(phaseOrder.map((p) => p.taskType)).toEqual([...PIPELINE_TASK_TYPES]);
    expect(sorted([...new Set(phaseOrder.flatMap((p) => p.phases))])).toEqual(
      sorted(PIPELINE_PHASES),
    );
    expect(read("editors/source-editor/editor.tsx")).toContain(
      'taskType: "claim"',
    );
  });

  it("conventions without an app list", () => {
    const doc = read("arscontexta-remote-knowledge-base.md");
    expect(doc).toContain(`Processing depth: ${PIPELINE_DEPTHS.join(", ")}`);
    expect(doc).toContain(`Report mode: ${REPORT_MODES.join(", ")}`);
    expect(read(vc)).toContain('depth: "standard"');
  });

  it("the runtime catalog applies every vocabulary as an enum", () => {
    const catalog = buildRuntimeCatalog();
    for (const [key, values] of Object.entries(VOCABULARIES)) {
      const [model, op, path] = key.split(":");
      const e = catalog.find((c) => c.key === `${model}:${op}`);
      expect(e?.vocabulary[path]).toEqual(values);
    }
  });
});
