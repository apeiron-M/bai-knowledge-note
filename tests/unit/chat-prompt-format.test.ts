import { describe, expect, it } from "vitest";
import {
  labelRefCandidates,
  refEnumValues,
} from "../../editors/knowledge-vault/chat/core/args-grammar.js";
import {
  argsMessages,
  step2Order,
} from "../../editors/knowledge-vault/chat/core/args-step.js";
import { buildVaultCatalog } from "../../editors/knowledge-vault/chat/core/catalog-models.js";
import { buildModelSchema } from "../../editors/knowledge-vault/chat/core/op-catalog.js";
import {
  forcedOpsText,
  scoringMessages,
  toOptions,
} from "../../editors/knowledge-vault/chat/core/op-scorer.js";
import { PROMPT_FORMAT_VERSION } from "../../editors/knowledge-vault/chat/core/prompt-format.js";
import { VOCABULARIES } from "../../editors/knowledge-vault/chat/core/vocabularies.js";

const catalog = buildVaultCatalog({ vocabularies: VOCABULARIES });

// Pins the bytes a fine-tune is trained on. If this fails, bump
// PROMPT_FORMAT_VERSION and regenerate any training data.
describe("prompt format", () => {
  it("is version r6.1", () => {
    expect(PROMPT_FORMAT_VERSION).toBe("r6.1");
  });

  it("builds step 1 exactly", () => {
    const tension = catalog.filter(
      (c) => c.docType === "bai/tension" && c.scope === "global",
    );
    const m = scoringMessages(
      "that conflict is settled",
      toOptions(tension, "key"),
      "ops",
    );
    expect(m).toEqual([
      {
        role: "system",
        content:
          'You choose the document operations that carry out the user\'s request. Answer with JSON: {"ops": [...]} lists the operations in the order they run, and {"ops": []} means the request needs no document change.',
      },
      {
        role: "user",
        content: [
          "Operations:",
          "- tension:CREATE_TENSION: Identify a new contradiction (fields: title, description, content, involvedRefs)",
          "- tension:RESOLVE_TENSION: Mark as resolved with explanation (fields: resolution)",
          "- tension:DISSOLVE_TENSION: Mark as dissolved (apparent, not real) (fields: resolution)",
          "- tension:ADD_INVOLVED_REF: Add a note to the tension (fields: ref)",
          "",
          "Request: that conflict is settled",
        ].join("\n"),
      },
    ]);
    expect(forcedOpsText(["tension:RESOLVE_TENSION"])).toBe(
      '{"ops": ["tension:RESOLVE_TENSION"]}',
    );
    expect(forcedOpsText([])).toBe('{"ops": []}');
  });

  it("builds step 2 exactly", () => {
    const e = catalog.find((c) => c.key === "wbs:SET_GOAL_STATUS");
    if (!e) throw new Error("missing op");
    const refs = labelRefCandidates({
      id: [
        { id: "g-1", label: "Ship the beta" },
        { id: "g-2", label: "Set up CI" },
      ],
    });
    const schema = buildModelSchema(e, { refCandidates: refEnumValues(refs) });
    const props = schema.properties as Record<string, unknown>;
    const order = step2Order(schema, ["id"], []);
    expect(order).toEqual(["id", "status", "blockReason", "outcome"]);
    const ordered = {
      ...schema,
      properties: Object.fromEntries(order.map((k) => [k, props[k]])),
    };
    const m = argsMessages("the CI goal is blocked on hardware", e, ordered, {
      id: ["Ship the beta", "Set up CI"],
    });
    expect(m).toEqual([
      {
        role: "system",
        content:
          "You extract the arguments for a document operation from the user's request. Copy names and text from the request exactly. Answer with JSON.",
      },
      {
        role: "user",
        content: [
          "Operation: SET_GOAL_STATUS - set goal status",
          'Choices for id: "Ship the beta", "Set up CI"',
          'Arguments: {"id": choice, "status": "BLOCKED" | "COMPLETED" | "IN_PROGRESS" | "IN_REVIEW" | "TODO" | "WONT_DO", "blockReason"?: string | null, "outcome"?: string | null}',
          "Request: the CI goal is blocked on hardware",
        ].join("\n"),
      },
    ]);
  });
});
