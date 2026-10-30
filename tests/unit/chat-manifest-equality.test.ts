/**
 * M2 vault equality: the generated chat-manifest/ equals the deleted hand
 * tables (vault a9f25fb8), kept as per-section sha256 digests in
 * tests/fixtures/chat-manifest/hand-tables.sha256.json, and Kev's option
 * text equals the frozen training/kev/data/catalog.json.
 * M5 moved the `catalog` digest on purpose: the 30 bai/project and bai/wbs
 * spec descriptions, filled to ship with the LoRA m2bv. Blanking those 30
 * gives the old digest (003101889179…). catalog.json stays frozen (the eval
 * rig pins its sha) with their empty `specDescription`.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { kevRequest, type CatalogEntry } from "nl-runtime";
import { describe, expect, it } from "vitest";
import { chatManifest } from "../../chat-manifest/index.js";
import { buildRuntimeCatalog } from "../../editors/knowledge-vault/chat/core/catalog-models.js";
import { VAULT_MANIFEST } from "../../editors/knowledge-vault/chat/vault-manifest.js";
import { kevCatalog } from "nl/gen";
import {
  plainEntry,
  probeDigest,
  probeManifest,
  probeStates,
} from "./chat-manifest-probe.js";

const gen = chatManifest;
const states = probeStates();
const frozen = JSON.parse(
  readFileSync(
    new URL(
      "../fixtures/chat-manifest/hand-tables.sha256.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as Record<string, string>;
const digest = probeDigest(gen);
const probe = probeManifest(gen, { catalog: false, states });
const count = (t: object) =>
  Object.values(t).flatMap((p) => Object.keys(p as object)).length;

describe("generated chat manifest vs the hand tables", () => {
  it("catalog equals buildRuntimeCatalog() (the barrels' specs), entry for entry", () => {
    const rebuilt = buildRuntimeCatalog();
    expect(gen.catalog.map((e) => e.key)).toEqual(rebuilt.map((e) => e.key));
    expect(gen.catalog).toHaveLength(100);
    expect(gen.catalog.map(plainEntry)).toEqual(rebuilt.map(plainEntry));
    // The same barrel module: the very same action creators.
    expect(gen.catalog.every((e, i) => e.creator === rebuilt[i].creator)).toBe(
      true,
    );
    expect(digest.catalog).toBe(frozen.catalog);
  });

  it("field overrides equal DEFAULT_FIELD_OVERRIDES (all 7 derived)", () => {
    expect(Object.keys(gen.fieldOverrides)).toHaveLength(7);
    expect(digest.fieldOverrides).toBe(frozen.fieldOverrides);
  });

  it("ref extractors return what REF_EXTRACTORS returned, on every probe state", () => {
    expect(Object.keys(gen.refExtractors)).toHaveLength(40);
    expect(count(gen.refExtractors)).toBe(47);
    // Not vacuous: the rich state yields candidates for every path.
    const rich = Object.values(
      probe.refExtractors as Record<
        string,
        Record<string, { rich: unknown[] }>
      >,
    )
      .flatMap((p) => Object.values(p))
      .filter((r) => r.rich.length > 0);
    expect(rich).toHaveLength(47);
    expect(digest.refExtractors).toBe(frozen.refExtractors);
  });

  it("state choices and current lists equal STATE_CHOICES and CURRENT_LISTS", () => {
    expect(count(gen.stateChoices)).toBe(2);
    expect(count(gen.currentLists)).toBe(3);
    expect(digest.stateChoices).toBe(frozen.stateChoices);
    expect(digest.currentLists).toBe(frozen.currentLists);
  });

  it("vocabularies equal VOCABULARIES, values in order", () => {
    expect(Object.keys(gen.vocabularies)).toHaveLength(13);
    expect(digest.vocabularies).toBe(frozen.vocabularies);
  });

  it("descriptions equal OP_DESCRIPTIONS (99 global + 1 local)", () => {
    expect(Object.keys(gen.opDescriptions)).toHaveLength(100);
    expect(digest.opDescriptions).toBe(frozen.opDescriptions);
  });

  it("the whole manifest equals the hand-assembled VAULT_MANIFEST", () => {
    expect(digest).toEqual(frozen);
    expect(VAULT_MANIFEST).toBe(gen);
  });
});

describe("Kev option text vs the frozen catalog.json", () => {
  const FROZEN = new URL(
    "../../training/kev/data/catalog.json",
    import.meta.url,
  );
  const frozenText = readFileSync(FROZEN, "utf8");
  const frozen = JSON.parse(frozenText) as {
    key: string;
    model: string;
    override: string | null;
  }[];
  const global = gen.catalog.filter((e) => e.scope === "global");

  it("is the shipped file (sha256 b257573b…)", () => {
    expect(createHash("sha256").update(frozenText).digest("hex")).toMatch(
      /^b257573b/,
    );
  });

  it("matches on 99/99 ops, in the same order", () => {
    expect(global.map((e) => e.key)).toEqual(frozen.map((f) => f.key));
    expect(global).toHaveLength(99);
    const text = Object.fromEntries(
      frozen.map((f) => [f.key, f.override ?? undefined]),
    );
    const byModel = new Map<string, CatalogEntry[]>();
    for (const e of global)
      byModel.set(e.model, [...(byModel.get(e.model) ?? []), e]);
    let ops = 0;
    for (const cands of byModel.values()) {
      const fromManifest = kevRequest("probe", cands, gen.opDescriptions);
      const fromFrozen = kevRequest("probe", cands, text);
      expect(fromManifest).toEqual(fromFrozen);
      ops += cands.length;
    }
    expect(ops).toBe(99);
  });

  it("nl's Kev catalog (`nl gen kev-catalog`), reading the manifest, reproduces catalog.json byte for byte but the 30 filled spec descriptions", () => {
    const app = { catalog: gen.catalog, manifest: gen } as unknown as Parameters<typeof kevCatalog>[0];
    const filled = new Set(["project", "wbs"]);
    const expected = (
      JSON.parse(frozenText) as (Record<string, unknown> & (typeof frozen)[number])[]
    ).map((f) =>
      filled.has(f.model) ? { ...f, specDescription: f.override } : f,
    );
    expect(expected.filter((f) => filled.has(f.model))).toHaveLength(30);
    expect(JSON.stringify(kevCatalog(app), null, 1)).toBe(
      JSON.stringify(expected, null, 1),
    );
  });
});
