import {
  accepts,
  buildTrainingCatalog,
  PROMPT_FORMAT_VERSION,
  scopedCandidates,
  step1Prompt,
  step1Target,
  step2Prompt,
  step2Target,
} from "nl/gen";
import { fillArgsStep, V1_ARGS, type CompleteJson, type WllamaChatMessage } from "nl-runtime";
import { describe, expect, it } from "vitest";
import { chatManifest } from "../../chat-manifest/index.js";

const catalog = buildTrainingCatalog(chatManifest);
const entry = (key: string) => {
  const e = catalog.find((c) => c.key === key);
  if (!e) throw new Error(`missing ${key}`);
  return e;
};

const STEP1_SYSTEM =
  'You choose the document operations that carry out the user\'s request. Answer with JSON: {"ops": [...]} lists the operations in the order they run, and {"ops": []} means the request needs no document change.';
const STEP2_SYSTEM =
  "You extract the arguments for a document operation from the user's request. Copy names and text from the request exactly. Answer with JSON.";

// The expected strings are the r6.1 bytes of the results doc ("Final
// runtime prompt format (r6.1)").
describe("training renderer, prompt format r6.1", () => {
  it("is the core's version", () => {
    expect(PROMPT_FORMAT_VERSION).toBe("r6.1");
  });

  it("renders step 1 over every op of the scoped model", () => {
    const cands = scopedCandidates(catalog, "bai/tension");
    const s1 = step1Prompt("that conflict is settled", cands);
    expect(s1.messages).toEqual([
      { role: "system", content: STEP1_SYSTEM },
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
    const gold = step1Target("tension:RESOLVE_TENSION", cands);
    expect(gold).toBe('{"ops": ["tension:RESOLVE_TENSION"]}');
    expect(step1Target(null, cands)).toBe('{"ops": []}');
    expect(step1Target("wbs:CREATE_GOAL", cands)).toBeNull();
    expect(accepts(s1.grammar, gold ?? "")).toBe(true);
    expect(accepts(s1.grammar, '{"ops": []}')).toBe(true);
    expect(accepts(s1.grammar, '{"ops": ["wbs:CREATE_GOAL"]}')).toBe(false);
  });

  it("renders step 2 with labeled refs, the safe gate and the fixed key order", () => {
    const refs = {
      id: [
        { id: "g-1", label: "Ship the beta" },
        { id: "g-2", label: "Set up CI" },
      ],
    };
    const u = "the CI goal is blocked on hardware";
    const s2 = step2Prompt(u, entry("wbs:SET_GOAL_STATUS"), refs);
    if (!s2) throw new Error("no step 2");
    expect(s2.messages).toEqual([
      { role: "system", content: STEP2_SYSTEM },
      {
        role: "user",
        content: [
          "Operation: SET_GOAL_STATUS - set goal status",
          'Choices for id: "Ship the beta", "Set up CI"',
          // `outcome` is gated out: the request does not mention it.
          'Arguments: {"id": choice, "status": "BLOCKED" | "COMPLETED" | "IN_PROGRESS" | "IN_REVIEW" | "TODO" | "WONT_DO", "blockReason"?: string | null}',
          `Request: ${u}`,
        ].join("\n"),
      },
    ]);
    const target = step2Target(s2, {
      blockReason: "hardware",
      status: "BLOCKED",
      id: "g-2",
    });
    expect(target).toBe(
      '{"id": "Set up CI", "status": "BLOCKED", "blockReason": "hardware"}',
    );
    expect(accepts(s2.grammar, target)).toBe(true);
  });

  it("uses the canonical vocabularies as enums", () => {
    const s2 = step2Prompt(
      "queue a claim task for the Raft paper",
      entry("pipeline-queue:ADD_TASK"),
    );
    expect(s2?.messages[1].content).toContain(
      '"taskType": "claim" | "enrichment"',
    );
  });

  it("matches the prompt the runtime's step 2 sends", async () => {
    const refs = {
      id: [
        { id: "t-1", label: "distributed systems" },
        { id: "t-2", label: "machine learning" },
      ],
    };
    const u = "drop the machine learning tag";
    const e = entry("knowledge-note:REMOVE_TOPIC");
    let sent: WllamaChatMessage[] = [];
    const completeJson: CompleteJson = (m) => {
      sent = m;
      return Promise.resolve({
        text: "{}",
        parsed: {},
        chunks: 1,
        finishReason: "stop",
        timingsOnLastChunk: false,
        wallMs: 0,
      });
    };
    await fillArgsStep(u, e, refs, {
      ...V1_ARGS,
      scoreRefs: false,
      completeJson,
      scoreText: () => Promise.reject(new Error("unused")),
    });
    expect(step2Prompt(u, e, refs)?.messages).toEqual(sent);
  });
});
