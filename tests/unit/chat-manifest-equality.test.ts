/**
 * M2 vault equality: the manifest `nl-generate` writes to chat-manifest/
 * (from the specs, reducers, barrels and chat.overrides.ts) equals the
 * vault's hand-written tables, and Kev's option text equals the frozen
 * training/kev/data/catalog.json.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { kevRequest, type CatalogEntry } from "nl-runtime";
import { describe, expect, it } from "vitest";
import { chatManifest } from "../../chat-manifest/index.js";
import { buildRuntimeCatalog } from "../../editors/knowledge-vault/chat/core/catalog-models.js";
import { DEFAULT_FIELD_OVERRIDES } from "../../editors/knowledge-vault/chat/core/op-catalog.js";
import { OP_DESCRIPTIONS } from "../../editors/knowledge-vault/chat/core/op-descriptions.js";
import {
  CURRENT_LISTS,
  REF_EXTRACTORS,
  STATE_CHOICES,
} from "../../editors/knowledge-vault/chat/core/ref-candidates.js";
import { VOCABULARIES } from "../../editors/knowledge-vault/chat/core/vocabularies.js";
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
const asManifest = (
  t: Pick<typeof gen, "refExtractors" | "stateChoices" | "currentLists">,
) => ({ ...gen, ...t, crossDocument: undefined });

describe("generated chat manifest vs the hand tables", () => {
  it("catalog equals buildRuntimeCatalog(), entry for entry", () => {
    const hand = buildRuntimeCatalog();
    expect(gen.catalog.map((e) => e.key)).toEqual(hand.map((e) => e.key));
    expect(gen.catalog).toHaveLength(100);
    expect(gen.catalog.map(plainEntry)).toEqual(hand.map(plainEntry));
    // The same barrel module: the very same action creators.
    expect(gen.catalog.every((e, i) => e.creator === hand[i].creator)).toBe(
      true,
    );
  });

  it("field overrides equal DEFAULT_FIELD_OVERRIDES (all 7 derived)", () => {
    expect(gen.fieldOverrides).toEqual(DEFAULT_FIELD_OVERRIDES);
    expect(Object.keys(gen.fieldOverrides)).toHaveLength(7);
  });

  it("ref extractors return what REF_EXTRACTORS returns, on every probe state", () => {
    expect(Object.keys(gen.refExtractors).sort()).toEqual(
      Object.keys(REF_EXTRACTORS).sort(),
    );
    const paths = Object.values(gen.refExtractors).flatMap((p) =>
      Object.keys(p),
    );
    expect(paths).toHaveLength(47);
    const g = probeManifest(asManifest(gen), { catalog: false, states });
    const h = probeManifest(
      asManifest({ ...gen, refExtractors: REF_EXTRACTORS }),
      { catalog: false, states },
    );
    expect(g.refExtractors).toEqual(h.refExtractors);
    // The probe is not vacuous: the rich state yields candidates for every path.
    const rich = Object.values(
      g.refExtractors as Record<string, Record<string, { rich: unknown[] }>>,
    )
      .flatMap((p) => Object.values(p))
      .filter((r) => r.rich.length > 0);
    expect(rich).toHaveLength(47);
  });

  it("state choices and current lists equal STATE_CHOICES and CURRENT_LISTS", () => {
    const g = probeManifest(asManifest(gen), { catalog: false, states });
    const h = probeManifest(
      asManifest({
        ...gen,
        stateChoices: STATE_CHOICES,
        currentLists: CURRENT_LISTS,
      }),
      { catalog: false, states },
    );
    expect(Object.keys(g.stateChoices as object)).toHaveLength(2);
    expect(Object.keys(g.currentLists as object)).toHaveLength(3);
    expect(g.stateChoices).toEqual(h.stateChoices);
    expect(g.currentLists).toEqual(h.currentLists);
  });

  it("vocabularies equal VOCABULARIES, values in order", () => {
    expect(gen.vocabularies).toEqual(VOCABULARIES);
    expect(Object.keys(gen.vocabularies)).toHaveLength(13);
  });

  it("descriptions equal OP_DESCRIPTIONS (99 global + 1 local)", () => {
    expect(gen.opDescriptions).toEqual(OP_DESCRIPTIONS);
    expect(Object.keys(gen.opDescriptions)).toHaveLength(100);
  });

  it("the whole manifest equals chat/vault-manifest.ts VAULT_MANIFEST", () => {
    expect(probeManifest(gen, { states })).toEqual(
      probeManifest(VAULT_MANIFEST, { states }),
    );
  });

  it("every probed section hashes as the hand tables did (frozen digest)", () => {
    // tests/fixtures/chat-manifest/hand-tables.sha256.json: probeDigest of the
    // hand-written VAULT_MANIFEST, taken before the hand tables were deleted.
    const frozen = JSON.parse(
      readFileSync(
        new URL(
          "../fixtures/chat-manifest/hand-tables.sha256.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ) as Record<string, string>;
    expect(probeDigest(gen)).toEqual(frozen);
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
