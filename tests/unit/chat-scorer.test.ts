import { describe, expect, it } from "vitest";
import { buildVaultCatalog } from "../../editors/knowledge-vault/chat/core/catalog-models.js";
import type { ScoreText } from "../../editors/knowledge-vault/chat/core/llm-client.js";
import {
  aggregate,
  argmax,
  averageByKey,
  calibrate,
  CONTENT_FREE,
  forcedOpText,
  fuse,
  gbnfLiteral,
  literalGrammar,
  NONE_KEY,
  optionLabels,
  pickFromRequests,
  rotate,
  rotationOffsets,
  scoreOptions,
  scoringMessages,
  toOptions,
} from "../../editors/knowledge-vault/chat/core/op-scorer.js";
import { selectOpMessages } from "../../editors/knowledge-vault/chat/core/generator.js";
import { accepts } from "./gbnf-recognizer.js";

const catalog = buildVaultCatalog();
const pick = (...keys: string[]) =>
  keys.map((k) => {
    const e = catalog.find((c) => c.key === k);
    if (!e) throw new Error(k);
    return e;
  });

describe("grammar literals", () => {
  it("accepts exactly the forced text", () => {
    const text = forcedOpText('say "hi"\\ now\n');
    const g = literalGrammar(text);
    expect(accepts(g, text)).toBe(true);
    expect(accepts(g, `${text} `)).toBe(false);
    expect(accepts(g, text.slice(0, -1))).toBe(false);
  });

  it("escapes control characters as hex", () => {
    expect(gbnfLiteral("a\u0001b")).toBe('"a\\x01b"');
    expect(accepts(literalGrammar("a\u0001b"), "a\u0001b")).toBe(true);
  });

  it("forces compact JSON", () => {
    expect(forcedOpText("add topic")).toBe('{"op": "add topic"}');
  });
});

describe("labels and prompt", () => {
  it("keeps the round-1 prompt for key labels", () => {
    const cands = pick("knowledge-note:ADD_TOPIC", "knowledge-note:SET_TITLE");
    expect(scoringMessages("x", toOptions(cands, "key"))).toEqual(
      selectOpMessages("x", cands),
    );
  });

  it("uses words and disambiguates duplicates by model", () => {
    const cands = pick("project:SET_OWNER", "wbs:SET_OWNER", "wbs:ADD_NOTE");
    expect(optionLabels(cands, "readable")).toEqual([
      "set owner (project)",
      "set owner (wbs)",
      "add note",
    ]);
    expect(optionLabels(cands, "key")).toEqual(cands.map((c) => c.key));
  });

  it("disambiguates multi-word model names with spaces", () => {
    const cands = pick(
      "knowledge-note:SET_METADATA_FIELD",
      "moc:SET_METADATA_FIELD",
    );
    expect(optionLabels(cands, "readable")).toEqual([
      "set metadata field (knowledge note)",
      "set metadata field (moc)",
    ]);
  });
});

describe("score arithmetic", () => {
  it("aggregates by sum or mean", () => {
    expect(aggregate([-1, -2, -3], "sum")).toBe(-6);
    expect(aggregate([-1, -2, -3], "mean")).toBe(-2);
    expect(aggregate([], "sum")).toBe(-Infinity);
  });

  it("calibrates by subtracting content-free scores", () => {
    expect(calibrate([-5, -2], [-4, -1])).toEqual([-1, -1]);
  });

  it("rotates and spreads offsets", () => {
    expect(rotate([1, 2, 3, 4, 5], 2)).toEqual([3, 4, 5, 1, 2]);
    expect(rotate([1, 2, 3], -1)).toEqual([3, 1, 2]);
    expect(rotate([], 3)).toEqual([]);
    expect(rotationOffsets(5, 3)).toEqual([0, 2, 3]);
    expect(rotationOffsets(5, 1)).toEqual([0]);
    expect(rotationOffsets(2, 3)).toEqual([0, 1]);
  });

  it("averages by key across runs", () => {
    const avg = averageByKey([
      new Map([
        ["a", -1],
        ["b", -3],
      ]),
      new Map([["a", -3]]),
    ]);
    expect(avg.get("a")).toBe(-2);
    expect(avg.get("b")).toBe(-3);
  });

  it("fuses with normalized BM25", () => {
    expect(fuse([-1, -2], [10, 5], 2)).toEqual([1, -1]);
    expect(fuse([-1, -2], [0, 0], 2)).toEqual([-1, -2]);
  });

  it("argmax prefers the earliest tie", () => {
    expect(argmax([1, 3, 3])).toBe(1);
    expect(argmax([])).toBe(-1);
  });
});

describe("scoreOptions + pickFromRequests", () => {
  const cands = pick(
    "knowledge-note:ADD_TOPIC",
    "knowledge-note:REMOVE_TOPIC",
    "knowledge-note:SET_TITLE",
  );
  // Fake model: under the utterance REMOVE_TOPIC is likeliest, but it is
  // also the prior favourite under N/A, so calibration should flip to
  // ADD_TOPIC. Each option scores one point lower per list position.
  const raw: Record<string, number> = {
    "knowledge-note:ADD_TOPIC": -2,
    "knowledge-note:REMOVE_TOPIC": -0.5,
    "knowledge-note:SET_TITLE": -6,
    [NONE_KEY]: -9,
  };
  const prior: Record<string, number> = {
    "knowledge-note:ADD_TOPIC": -4,
    "knowledge-note:REMOVE_TOPIC": -1,
    "knowledge-note:SET_TITLE": -5,
    [NONE_KEY]: -9,
  };
  const scoreText: ScoreText = (messages, grammar) => {
    const user = messages[1].content;
    const cf = user.endsWith(`Request: ${CONTENT_FREE}`);
    const m = /"op\\": \\"(.*)\\"}"$/.exec(grammar);
    const key = m ? m[1] : "";
    const lines = user.split("\n").filter((l) => l.startsWith("- "));
    const pos = lines.findIndex((l) => l.startsWith(`- ${key}:`));
    const lp = (cf ? prior : raw)[key] - pos;
    return Promise.resolve({
      text: forcedOpText(key),
      tokens: [{ token: "x", logprob: lp, bytes: null, top_logprobs: [] }],
      finishReason: "stop",
      wallMs: 10,
    });
  };
  const keys = cands.map((c) => c.key);

  it("picks raw argmax, calibrated argmax, and order-averaged", async () => {
    const reqs = await scoreOptions("tag it", cands, {
      scoreText,
      style: "key",
      offsets: [0, 1],
      contentFree: true,
    });
    expect(reqs).toHaveLength(12);
    const s1 = pickFromRequests(reqs, keys, {
      aggregate: "sum",
      calibrated: false,
      offsets: [0],
    });
    expect(s1.key).toBe("knowledge-note:REMOVE_TOPIC");
    expect(s1.wallMs).toBe(30);
    const s2 = pickFromRequests(reqs, keys, {
      aggregate: "sum",
      calibrated: true,
      offsets: [0],
    });
    expect(s2.key).toBe("knowledge-note:ADD_TOPIC");
    expect(s2.scores["knowledge-note:ADD_TOPIC"]).toBe(2);
    expect(s2.wallMs).toBe(60);
    const s3 = pickFromRequests(reqs, keys, {
      aggregate: "sum",
      calibrated: true,
      offsets: [0, 1],
    });
    expect(s3.key).toBe("knowledge-note:ADD_TOPIC");
    expect(s3.wallMs).toBe(120);
  });

  it("can add the none pseudo-candidate", async () => {
    const reqs = await scoreOptions("tag it", cands, {
      scoreText,
      style: "key",
      offsets: [0],
      contentFree: false,
      includeNone: true,
    });
    expect(reqs.map((r) => r.key)).toEqual([...keys, NONE_KEY]);
    const p = pickFromRequests(reqs, [...keys, NONE_KEY], {
      aggregate: "mean",
      calibrated: true,
      offsets: [0],
    });
    // Calibrated requested but no content-free requests: nothing scores.
    expect(p.key).toBeNull();
  });
});
