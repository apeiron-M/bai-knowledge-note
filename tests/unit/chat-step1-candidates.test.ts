// Step 1's candidate list and pick (R2c), from the v1 pipeline's tests. M5
// removed the v1 pipeline (`runV1`, the embedding step 1) and its cases.
import { describe, expect, it } from "vitest";
import { buildRuntimeCatalog } from "../../editors/knowledge-vault/chat/core/catalog-models.js";
import { NONE_KEY } from "../../editors/knowledge-vault/chat/core/op-scorer.js";
import {
  step1Candidates,
  step1Pick,
  V1_STEP1,
} from "../../editors/knowledge-vault/chat/core/step1-candidates.js";
import { scopedCandidates } from "nl/gen";

const catalog = buildRuntimeCatalog();

describe("step-1 candidates (round 9 R2c)", () => {
  it("serves exactly the training renderer's full-list candidates for every model", () => {
    const docTypes = [...new Set(catalog.map((e) => e.docType))];
    expect(docTypes.length).toBe(12);
    for (const docType of docTypes) {
      const served = step1Candidates(V1_STEP1, {
        scopedHits: [],
        catalog,
        docType,
      }).map((e) => e.key);
      expect(served).toEqual(
        scopedCandidates(catalog, docType).map((e) => e.key),
      );
      expect(served.length).toBeGreaterThan(0);
    }
  });

  it("step1Pick reads keys, the empty list and junk", () => {
    expect(step1Pick({ ops: ["a:B"] }, ["a:B"])).toBe("a:B");
    expect(step1Pick({ ops: [] }, ["a:B"])).toBe(NONE_KEY);
    expect(step1Pick({ ops: ["a:C"] }, ["a:B"])).toBeNull();
    expect(step1Pick("x", ["a:B"])).toBeNull();
  });
});
