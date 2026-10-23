import { describe, expect, it } from "vitest";
import { DEFAULT_MODEL } from "../../editors/knowledge-vault/chat/core/llm-client.js";
import {
  normalizeModelUrl,
  resolveModelSource,
} from "../../editors/knowledge-vault/chat/core/model-source.js";

const R8 =
  "/training/artifacts/round8/gguf/LFM2.5-350M-vault-r8a-20261022-Q4_K_M.gguf";

describe("resolveModelSource", () => {
  it("defaults to the base model from Hugging Face, marked unmeasured", () => {
    const m = resolveModelSource(null, undefined);
    expect(m.source).toEqual({ kind: "hf", ...DEFAULT_MODEL });
    expect(m.from).toBe("default");
    expect(m.measured).toBe(false);
    expect(m.label).toContain("Base model");
  });

  it("prefers the tab setting over the env var", () => {
    const m = resolveModelSource(R8, "http://localhost:8099/other.gguf");
    expect(m.source).toEqual({ kind: "url", url: R8 });
    expect(m.from).toBe("setting");
    expect(m.measured).toBe(true);
    expect(m.label).toBe(
      "Round 8 fine-tune: LFM2.5-350M-vault-r8a-20261022-Q4_K_M.gguf (from this origin)",
    );
  });

  it("uses the env var when no setting is saved", () => {
    const m = resolveModelSource("  ", "http://localhost:8099/x.gguf");
    expect(m.from).toBe("env");
    expect(m.measured).toBe(false);
    expect(m.label).toBe("Custom GGUF: x.gguf (from localhost:8099)");
    expect(m.key).toBe("url:http://localhost:8099/x.gguf");
  });

  it("ignores values that are not URLs", () => {
    expect(normalizeModelUrl("model.gguf")).toBeNull();
    expect(normalizeModelUrl(" /m.gguf ")).toBe("/m.gguf");
    expect(resolveModelSource("model.gguf", undefined).from).toBe("default");
  });
});
