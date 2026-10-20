import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { knowledgeVault } from "../index.js";

const lib = (p: string) => readFileSync(new URL(`../lib/${p}`, import.meta.url), "utf8");

describe("what the pieces say about verify", () => {
  it("labels the trigger's verify phase by what it is", () => {
    const src = lib("triggers/new-pipeline-task.ts");
    expect(src).toContain('{ label: "verify: placed, to check", value: "verify" }');
    expect(src).not.toContain("verify: waiting for review");
  });
  it("describes the Place step as advancing to the next step", () => {
    const d = (knowledgeVault.actions()["place-in-mocs"] as unknown as { description: string }).description;
    expect(d).toContain("advances the pipeline task to verify, the next step.");
    expect(d).not.toMatch(/waits for your review/);
  });
  it("hands off to verify, not to review", () => {
    const src = lib("actions/place-in-mocs.ts");
    expect(src.match(/Next: verify\./g)).toHaveLength(2);
    expect(src).not.toContain("Ready for review.");
  });
  it("says verify approves nothing and its advance completes the task", () => {
    const src = lib("agent/verify.ts");
    expect(src).toContain("Nothing is approved: the notes stay in review for a person, and this step's advance completes the task.");
    expect(src).not.toContain("after review");
  });
});
