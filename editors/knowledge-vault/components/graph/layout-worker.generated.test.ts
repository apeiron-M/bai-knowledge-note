import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  LAYOUT_WORKER_HASH,
  LAYOUT_WORKER_SOURCE,
} from "./layout-worker.generated.js";

const dir = join(__dirname);
const sources = ["force-layout.ts", "layout-core.ts", "layout-worker-entry.ts"];

/** Must match sourceHash() in scripts/build-graph-worker.mjs. */
function sourceHash(): string {
  const h = createHash("sha256");
  for (const f of sources)
    h.update(readFileSync(join(dir, f), "utf8")).update("\0");
  return h.digest("hex").slice(0, 16);
}

describe("layout-worker.generated.ts", () => {
  it("was built from the current layout sources (else run: bun run graph-worker)", () => {
    expect(LAYOUT_WORKER_HASH).toBe(sourceHash());
  });

  it("is one self-contained classic script", () => {
    expect(LAYOUT_WORKER_SOURCE.startsWith("(function")).toBe(true);
    expect(LAYOUT_WORKER_SOURCE).not.toMatch(/\bimport\s*[({"']|\brequire\(/);
  });
});
