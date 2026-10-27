import { afterEach, describe, expect, it, vi } from "vitest";
import {
  kevReasonText,
  loraAloneText,
  readChatSettings,
  SETTING_KEYS,
} from "../../editors/knowledge-vault/hooks/use-chat-llm.js";
import { kevBlocker } from "../../editors/knowledge-vault/hooks/chat-models.js";

function memoryStorage(init: Record<string, string>) {
  const m = new Map(Object.entries(init));
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    map: m,
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("chat settings", () => {
  it("defaults: decision model on, branch trie, no URLs", () => {
    vi.stubGlobal("localStorage", memoryStorage({}));
    expect(readChatSettings()).toEqual({
      loraUrl: null,
      kevUrl: null,
      baseUrl: null,
      useKev: true,
      trieMode: "branch",
    });
  });

  it("migrates the pre-C model URL to the LoRA URL", () => {
    const s = memoryStorage({ [SETTING_KEYS.legacyModelUrl]: "/r8.gguf" });
    vi.stubGlobal("localStorage", s);
    expect(readChatSettings().loraUrl).toBe("/r8.gguf");
    expect(s.map.has(SETTING_KEYS.legacyModelUrl)).toBe(false);
  });

  it("reads the toggle and the dev trie mode", () => {
    vi.stubGlobal(
      "localStorage",
      memoryStorage({ [SETTING_KEYS.useKev]: "0", [SETTING_KEYS.trieMode]: "exact" }),
    );
    expect(readChatSettings()).toMatchObject({ useKev: false, trieMode: "exact" });
  });
});

describe("fallback labels", () => {
  it("names the reason and the LoRA-alone numbers", () => {
    expect(loraAloneText(kevReasonText({ reason: "unavailable", detail: "404" }))).toBe(
      "LoRA alone (decision model unavailable: 404): held-out-6 84.5% op, no ask step",
    );
    expect(kevReasonText({ reason: "off" })).toBe("turned off");
  });

  it("blocks Kev when off or without WebGPU (no CPU fallback)", () => {
    expect(kevBlocker(false)).toBe("off");
    // node has no navigator.gpu
    expect(kevBlocker(true)).toMatch(/no WebGPU/);
  });
});
