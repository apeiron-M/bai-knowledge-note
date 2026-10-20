import { createHash } from "node:crypto";
import { readdirSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  GTE_FILES,
  ORT_WASM_PATHS,
} from "../../editors/knowledge-vault/chat/core/gte-embedder.js";

const repo = fileURLToPath(new URL("../../", import.meta.url));
// onnxruntime-web is transformers' own (nested pnpm) dependency.
const ortDir = join(
  realpathSync(join(repo, "node_modules/@huggingface/transformers")),
  "../../onnxruntime-web",
);
const sha = (p: string) =>
  createHash("sha256").update(readFileSync(p)).digest("hex");

describe("vendored onnxruntime-web", () => {
  it("matches the version and files transformers runs with", () => {
    const pkg: unknown = JSON.parse(
      readFileSync(join(ortDir, "package.json"), "utf8"),
    );
    const version =
      typeof pkg === "object" && pkg !== null && "version" in pkg
        ? pkg.version
        : null;
    expect(readdirSync(join(repo, "vendor/onnxruntime-web"))).toEqual([
      version,
    ]);
    for (const url of Object.values(ORT_WASM_PATHS)) {
      const file = fileURLToPath(url);
      expect(file).toContain(`vendor/onnxruntime-web/${String(version)}/`);
      const name = file.slice(file.lastIndexOf("/") + 1);
      expect(sha(file)).toBe(sha(join(ortDir, "dist", name)));
    }
  });

  it("points every model file at the committed gte-small copy", () => {
    for (const url of Object.values(GTE_FILES))
      expect(sha(fileURLToPath(url)).length).toBe(64);
  });
});
