import { describe, expect, it } from "vitest";
import { C_ARTIFACTS } from "../../editors/knowledge-vault/chat/core/model-manifest.js";
import {
  normalizeModelUrl,
  resolveCSources,
} from "../../editors/knowledge-vault/chat/core/model-source.js";

describe("resolveCSources", () => {
  it("defaults to the same-origin dev paths of the measured files (config C)", () => {
    const s = resolveCSources({});
    expect(s.lora).toMatchObject({
      url: C_ARTIFACTS.lora.devPath,
      from: "default",
      matchesManifest: true,
    });
    expect(s.kev).toMatchObject({ url: C_ARTIFACTS.kev.devPath, from: "default" });
    expect(s.config).toBe("C");
    expect(s.lora.label).toBe(
      "X5 LoRA 350M: LFM2.5-350M-vault-x5a-20261023-Q4_K_M.gguf (from this origin)",
    );
  });

  it("resolves a base URL to <base>/<manifest file> for both models", () => {
    const s = resolveCSources({ baseUrl: "https://models.example.org/c/" });
    expect(s.lora.url).toBe(
      "https://models.example.org/c/LFM2.5-350M-vault-x5a-20261023-Q4_K_M.gguf",
    );
    expect(s.kev.url).toBe(
      "https://models.example.org/c/Kev-0.8B-vault-ft1-20261024-Q4_K_M.gguf",
    );
    expect(s.lora.from).toBe("base-setting");
    expect(s.config).toBe("C");
    expect(s.kev.label).toContain("(from models.example.org)");
  });

  it("orders setting > base setting > env > base env > default", () => {
    const env = {
      loraUrl: "http://localhost:8099/env-lora.gguf",
      baseUrl: "https://cdn.example.org/m",
    };
    expect(resolveCSources({ loraUrl: "/x.gguf", baseUrl: "/b" }, env).lora.url).toBe("/x.gguf");
    expect(resolveCSources({ baseUrl: "/b" }, env).lora.from).toBe("base-setting");
    expect(resolveCSources({}, env).lora).toMatchObject({ from: "env", url: env.loraUrl });
    expect(resolveCSources({}, env).kev.from).toBe("base-env");
  });

  it("keeps VITE_CHAT_MODEL_URL as the LoRA's env alias", () => {
    const s = resolveCSources({}, { modelUrl: "/old/r8.gguf" });
    expect(s.lora).toMatchObject({ url: "/old/r8.gguf", from: "env", matchesManifest: false });
    expect(s.config).toBe("custom");
    expect(s.lora.label).toBe("Custom GGUF: r8.gguf (from this origin)");
  });

  it("ignores values that are not URLs", () => {
    expect(normalizeModelUrl("model.gguf")).toBeNull();
    expect(normalizeModelUrl(" /m.gguf ")).toBe("/m.gguf");
    expect(resolveCSources({ loraUrl: "model.gguf" }).lora.from).toBe("default");
  });
});
