import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The browser vault (Try on web) runs the pipeline's stages in the page, where `node:*` modules do
 * not exist: the landing's browser bundle maps them to an empty module, so an import from one is
 * undefined at runtime. These files must stay plain logic plus fetch and Web APIs.
 */
const BROWSER_SAFE = [
  "agent/staged.ts",
  "agent/write.ts",
  "agent/connect.ts",
  "agent/synthesize.ts",
  "agent/pipeline.ts",
  "agent/verify.ts",
  "agent/windows.ts",
  "agent/llm.ts",
  "agent/extract.ts",
  "common/client.ts",
  "common/errors.ts",
];

describe("pipeline code a browser can run", () => {
  it.each(BROWSER_SAFE)("%s imports no node: module", (file) => {
    const source = readFileSync(new URL(`../lib/${file}`, import.meta.url), "utf8");
    expect(source).not.toMatch(/from "node:/);
  });
});
