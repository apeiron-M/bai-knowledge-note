/**
 * M2 vault equality: the manifest `nl-generate` writes to chat-manifest/
 * (from the specs, reducers, barrels and chat.overrides.ts) equals the
 * vault's hand-written tables it replaced, and Kev's option text equals the
 * frozen training/kev/data/catalog.json.
 *
 * The hand tables (DEFAULT_FIELD_OVERRIDES, REF_EXTRACTORS, STATE_CHOICES,
 * CURRENT_LISTS, VOCABULARIES, OP_DESCRIPTIONS and the hand-assembled
 * VAULT_MANIFEST) were compared directly, function outputs included, until
 * they were deleted (vault a9f25fb8). What remains of them is
 * tests/fixtures/chat-manifest/hand-tables.sha256.json: the sha256 of each
 * section of `probeManifest(hand VAULT_MANIFEST)`, the function tables as
 * their outputs on the probe states. The catalog is also rebuilt from the
 * barrels' own spec objects (`buildRuntimeCatalog`).
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { kevRequest, type CatalogEntry } from "nl-runtime";
import { describe, expect, it } from "vitest";
import { chatManifest } from "../../chat-manifest/index.js";
import { buildRuntimeCatalog } from "../../editors/knowledge-vault/chat/core/catalog-models.js";
import { VAULT_MANIFEST } from "../../editors/knowledge-vault/chat/vault-manifest.js";
import { kevCatalogJson } from "../../training/kev/dump-catalog.js";
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

  it("dump-catalog.ts, reading the manifest, reproduces catalog.json byte for byte", () => {
    expect(kevCatalogJson(gen)).toBe(frozenText);
  });
});
