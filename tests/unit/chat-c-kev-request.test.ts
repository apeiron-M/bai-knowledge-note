import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  KEV_NONE_NAME,
  kevOptionProbs,
  kevRequest,
} from "../../editors/knowledge-vault/chat/core/kev-request.js";
import { OP_DESCRIPTIONS } from "../../editors/knowledge-vault/chat/core/op-descriptions.js";
import { v1Catalog } from "../../editors/knowledge-vault/chat/core/catalog-models.js";

interface KevCatalogRow {
  key: string;
  model: string;
  opName: string;
  override: string;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// The rig's frozen Kev catalog (training/kev/data/catalog.json, sha b257573b).
const raw: unknown = JSON.parse(
  readFileSync(
    new URL("../../training/kev/data/catalog.json", import.meta.url),
    "utf8",
  ),
);
const kevCatalog: KevCatalogRow[] = (Array.isArray(raw) ? raw : [])
  .filter(isRecord)
  .map((r) => ({
    key: String(r.key),
    model: String(r.model),
    opName: String(r.opName),
    override: String(r.override),
  }));

/** decide.mjs (W3, variant desc, descField override, server runtime) verbatim. */
function decideMjsBody(utterance: string, model: string, candidates: string[]) {
  const human = (s: string) => s.toLowerCase().replace(/[_-]+/g, " ");
  const byKey = new Map(kevCatalog.map((c) => [c.key, c]));
  const opts = candidates.map((k) => {
    const c = byKey.get(k);
    if (!c) throw new Error(`no Kev catalog row ${k}`);
    return { name: human(c.opName), desc: c.override };
  });
  opts.push({
    name: "answer a question",
    desc: "The user only asks a question about the document or wants information; no operation is applied.",
  });
  return {
    state: `Request: ${utterance}`,
    questions: {
      q0: {
        type: "choice",
        instructions: `Which operation should be applied to this ${human(model)} document to carry out the request?`,
        criteria: Object.fromEntries(opts.map((o) => [o.name, o.desc])),
      },
    },
  };
}

const catalog = v1Catalog();
const global = catalog.filter((e) => e.scope === "global");
const models = [...new Set(global.map((e) => e.docType))];

describe("kevRequest", () => {
  it("uses OP_DESCRIPTIONS, which equal the rig catalog's override on 99/99 ops", () => {
    expect(kevCatalog).toHaveLength(99);
    expect(global.map((e) => e.key)).toEqual(kevCatalog.map((c) => c.key));
    for (const c of kevCatalog) expect(OP_DESCRIPTIONS[c.key], c.key).toBe(c.override);
  });

  it.each(models)("is byte-equal to decide.mjs's body for %s", (docType) => {
    const cands = global.filter((e) => e.docType === docType);
    const utterance = "please do the thing to this document";
    const req = kevRequest(utterance, cands);
    const want = decideMjsBody(
      utterance,
      cands[0].model,
      cands.map((c) => c.key),
    );
    expect(JSON.stringify(req.body)).toBe(JSON.stringify(want));
    expect(req.names.at(-1)).toBe(KEV_NONE_NAME);
    expect(req.names).toHaveLength(cands.length + 1);
    expect(new Set(req.names).size).toBe(req.names.length);
    expect(req.keys).toEqual(cands.map((c) => c.key));
  });

  it("does not use the runtime catalog's description", () => {
    const cands = global.filter((e) => e.docType === "bai/knowledge-note");
    const req = kevRequest("x", cands);
    const texts = Object.values(req.body.questions.q0.criteria);
    const differs = cands.filter((c, i) => c.description !== texts[i]);
    expect(differs.length).toBeGreaterThan(0);
  });

  it("rejects mixed models", () => {
    const a = global.find((e) => e.docType === "bai/knowledge-note");
    const b = global.find((e) => e.docType === "bai/project");
    if (!a || !b) throw new Error("catalog");
    expect(() => kevRequest("x", [a, b])).toThrow(/not a/);
  });
});

describe("kevOptionProbs", () => {
  const cands = global.filter((e) => e.docType === "bai/health-report");
  const req = kevRequest("x", cands);

  it("maps probabilities back in option order", () => {
    const probabilities = Object.fromEntries(
      [...req.names].reverse().map((n, i) => [n, i / 10]),
    );
    const got = kevOptionProbs(req, { answers: { q0: { probabilities } } });
    expect(got).toEqual(req.names.map((n) => probabilities[n]));
  });

  it("throws on a missing option or answer", () => {
    expect(() => kevOptionProbs(req, { answers: {} })).toThrow(/q0/);
    expect(() =>
      kevOptionProbs(req, { answers: { q0: { probabilities: {} } } }),
    ).toThrow(/no probability/);
  });
});
