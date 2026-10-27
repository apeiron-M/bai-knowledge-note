import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  fuseAndGate,
  kevScores,
  logT1,
  lsm,
} from "../../editors/knowledge-vault/chat/core/fusion.js";
import {
  artifactMismatch,
  C_ARTIFACTS,
  C_FUSION,
} from "../../editors/knowledge-vault/chat/core/model-manifest.js";

const FX = new URL("../fixtures/chat-c/", import.meta.url);

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function jsonl(name: string): Record<string, unknown>[] {
  return readFileSync(new URL(name, FX), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l): unknown => JSON.parse(l))
    .filter(isRecord);
}

const strs = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => String(x)) : [];
const nums = (v: unknown): number[] =>
  Array.isArray(v) ? v.map((x) => Number(x)) : [];
function numRecord(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (isRecord(v)) for (const [k, x] of Object.entries(v)) out[k] = Number(x);
  return out;
}

interface Step1Row {
  candidates: string[];
  loraPick: string;
  loraExact: Record<string, number>;
  loraBranch: Record<string, number>;
}
interface KevRow {
  candidates: string[];
  servedT: number;
  probs: number[];
  logprobsT1: number[];
}
interface Expected {
  id: string;
  loraPick: string;
  fusedPick: string;
  gate: { pick: string; asked: boolean; offered: string[] };
  p?: Record<string, number>;
}

const step1 = new Map<string, Step1Row>(
  jsonl("step1.jsonl").map((r) => [
    String(r.id),
    {
      candidates: strs(r.candidates),
      loraPick: String(r.loraPick),
      loraExact: numRecord(r.loraExact),
      loraBranch: numRecord(r.loraBranch),
    },
  ]),
);
const kev = new Map<string, KevRow>(
  jsonl("kev.jsonl").map((r) => {
    const one = isRecord(r.oneStage) ? r.oneStage : {};
    return [
      String(r.id),
      {
        candidates: strs(r.candidates),
        servedT: Number(r.servedT),
        probs: nums(one.probs),
        logprobsT1: nums(one.logprobsT1),
      },
    ];
  }),
);
const expectedRaw: unknown = JSON.parse(
  readFileSync(new URL("expected-decisions.json", FX), "utf8"),
);
function expectedFor(mode: "exact" | "branch"): Expected[] {
  if (!isRecord(expectedRaw) || !isRecord(expectedRaw.modes)) return [];
  const m = expectedRaw.modes[mode];
  if (!isRecord(m) || !Array.isArray(m.decisions)) return [];
  return m.decisions.filter(isRecord).map((d) => {
    const g = isRecord(d.gate) ? d.gate : {};
    return {
      id: String(d.id),
      loraPick: String(d.loraPick),
      fusedPick: String(d.fusedPick),
      gate: {
        pick: String(g.pick),
        asked: g.asked === true,
        offered: strs(g.offered),
      },
      p: d.p === undefined ? undefined : numRecord(d.p),
    };
  });
}

describe("configuration C fixtures", () => {
  it("Kev candidates are the step-1 candidates plus none, in order", () => {
    expect(step1.size).toBe(228);
    for (const [id, s] of step1) {
      const k = kev.get(id);
      expect(k, id).toBeDefined();
      expect(
        k?.candidates.map((c) => (c === "__none__" ? "none" : c)),
        id,
      ).toEqual([...s.candidates, "none"]);
    }
  });

  it("logT1 reproduces decide.mjs's stored logprobsT1", () => {
    let worst = 0;
    for (const k of kev.values()) {
      expect(k.servedT).toBe(C_ARTIFACTS.kev.servedT);
      const got = logT1(k.probs, k.servedT);
      got.forEach((x, i) => (worst = Math.max(worst, Math.abs(x - k.logprobsT1[i]))));
    }
    expect(worst).toBeLessThanOrEqual(1e-9);
  });
});

describe.each(["exact", "branch"] as const)(
  "fuseAndGate vs the rig's evaluate.decide (%s trie scores)",
  (mode) => {
    const expected = expectedFor(mode);

    it("covers the 216 dev single rows", () => {
      expect(expected).toHaveLength(216);
    });

    it("gives identical picks, asks and offered order, |dp| <= 1e-9", () => {
      let worstP = 0;
      let asked = 0;
      for (const e of expected) {
        const s = step1.get(e.id);
        const k = kev.get(e.id);
        if (!s || !k) throw new Error(`missing rows for ${e.id}`);
        expect(s.loraPick, e.id).toBe(e.loraPick);
        if (s.loraPick === "none") {
          // the no-action rule: none, nothing asked (applied by the pipeline)
          expect(e.gate).toEqual({ pick: "none", asked: false, offered: [] });
          continue;
        }
        const lora = mode === "exact" ? s.loraExact : s.loraBranch;
        const d = fuseAndGate(s.candidates, lora, kevScores(s.candidates, k.logprobsT1));
        expect(d.pick, e.id).toBe(e.fusedPick);
        expect(
          { pick: d.pick, asked: d.asked, offered: d.offered },
          e.id,
        ).toEqual(e.gate);
        if (d.asked) asked++;
        for (const [o, p] of Object.entries(e.p ?? {}))
          worstP = Math.max(worstP, Math.abs(d.p[o] - p));
      }
      expect(worstP).toBeLessThanOrEqual(1e-9);
      expect(asked).toBe(29);
    });
  },
);

describe("fuseAndGate", () => {
  const keys = ["m:A", "m:B", "m:C", "m:D"];
  const flat = { "m:A": 0, "m:B": 0, "m:C": 0, "m:D": 0, none: 0 };

  it("breaks exact ties by catalog order and asks", () => {
    const d = fuseAndGate(keys, flat, flat);
    expect(d.ranking).toEqual(keys);
    expect(d.pick).toBe("m:A");
    expect(d.asked).toBe(true);
    expect(d.offered).toEqual(["m:A", "m:B", "m:C"]);
  });

  it("does not ask when the fused margin is at least tau", () => {
    const lora = { ...flat, "m:C": 30 };
    const k = { ...flat, "m:C": 30 };
    const d = fuseAndGate(keys, lora, k);
    expect(d.pick).toBe("m:C");
    expect(d.margin).toBeGreaterThanOrEqual(C_FUSION.tau);
    expect(d.asked).toBe(false);
    expect(d.offered).toEqual([]);
  });

  it("never picks none even when none dominates", () => {
    const d = fuseAndGate(keys, { ...flat, none: 50 }, { ...flat, none: 50 });
    expect(d.pick).not.toBe("none");
    expect(d.p.none).toBeGreaterThan(0.99);
  });

  it("does not ask with a single op", () => {
    const d = fuseAndGate(["m:A"], { "m:A": -5, none: 0 }, { "m:A": -5, none: 0 });
    expect(d).toMatchObject({ pick: "m:A", asked: false, margin: 1 });
  });

  it("rejects a missing score", () => {
    expect(() => fuseAndGate(keys, { "m:A": 0 }, flat)).toThrow(/LoRA score/);
    expect(() => kevScores(keys, [0, 0])).toThrow(/options/);
  });

  it("lsm normalises over the given options", () => {
    const l = lsm({ a: 1, b: 2, none: 3 }, ["a", "b", "none"], 2);
    const sum = Object.values(l).reduce((s, x) => s + Math.exp(x), 0);
    expect(sum).toBeCloseTo(1, 12);
  });
});

describe("artifactMismatch", () => {
  const kevMeta = {
    "general.architecture": "qwen35",
    "general.name": "Kev-0.8B-vault-ft1",
    "qwen35.decision.type": "kev",
    "qwen35.decision.temperature.choice": "2.700700",
  };

  it("accepts the measured Kev metadata (6-dp temperature string)", () => {
    expect(
      artifactMismatch(C_ARTIFACTS.kev, { bytes: 529_595_072, meta: kevMeta }),
    ).toBeNull();
  });

  it("flags size, architecture and temperature differences", () => {
    expect(artifactMismatch(C_ARTIFACTS.kev, { bytes: 1, meta: kevMeta })).toMatch(/size/);
    expect(
      artifactMismatch(C_ARTIFACTS.kev, {
        bytes: 0,
        meta: { ...kevMeta, "qwen35.decision.temperature.choice": "2.351096" },
      }),
    ).toMatch(/temperature/);
    expect(
      artifactMismatch(C_ARTIFACTS.lora, {
        bytes: 0,
        meta: { "general.architecture": "qwen35" },
      }),
    ).toMatch(/architecture/);
  });

  it("checks the LoRA tokenizer, not its general.name", () => {
    const meta = {
      "general.architecture": "lfm2",
      "general.name": "Merged",
      "tokenizer.ggml.pre": "lfm2",
    };
    expect(
      artifactMismatch(C_ARTIFACTS.lora, { bytes: 229_312_224, meta, nVocab: 65536 }),
    ).toBeNull();
    expect(
      artifactMismatch(C_ARTIFACTS.lora, { bytes: 0, meta, nVocab: 32000 }),
    ).toMatch(/vocabulary/);
  });
});
