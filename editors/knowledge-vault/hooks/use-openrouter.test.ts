import "../../shared/test/browser-globals.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_MODEL,
  fetchToolCapableModels,
  readStoredModel,
  resolveModel,
  storeModel,
  type ModelInfo,
} from "./use-openrouter.js";

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("fetchToolCapableModels", () => {
  it("keeps only models that support tool calling, sorted by name", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          data: [
            {
              id: "z/tools",
              name: "Zed",
              context_length: 1000,
              supported_parameters: ["tools"],
              pricing: { prompt: "0.000001", completion: "0.000002" },
            },
            {
              id: "b/none",
              name: "Bee",
              context_length: 1000,
              supported_parameters: ["temperature"],
              pricing: { prompt: "0", completion: "0" },
            },
            {
              id: "a/tools",
              name: "Ay",
              context_length: 200000,
              supported_parameters: ["tools", "tool_choice"],
              pricing: { prompt: "0.000003", completion: "0.000015" },
            },
          ],
        }),
    }) as unknown as typeof fetch;

    const models = await fetchToolCapableModels();
    expect(models.map((m) => m.id)).toEqual(["a/tools", "z/tools"]);
    expect(models[0]).toEqual({
      id: "a/tools",
      name: "Ay",
      contextLength: 200000,
      promptPrice: 0.000003,
      completionPrice: 0.000015,
    });
    expect(
      (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0],
    ).toBe("https://openrouter.ai/api/v1/models");
  });

  it("tolerates entries with missing fields", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          data: [{ id: "x/y", supported_parameters: ["tools"] }],
        }),
    }) as unknown as typeof fetch;
    const models = await fetchToolCapableModels();
    expect(models).toEqual([
      {
        id: "x/y",
        name: "x/y",
        contextLength: 0,
        promptPrice: 0,
        completionPrice: 0,
      },
    ]);
  });

  it("returns an empty list rather than throwing when the catalog is unreachable or malformed", async () => {
    globalThis.fetch = vi
      .fn()
      .mockRejectedValue(new Error("offline")) as unknown as typeof fetch;
    expect(await fetchToolCapableModels()).toEqual([]);

    globalThis.fetch = vi
      .fn()
      .mockResolvedValue({
        ok: false,
        json: () => Promise.resolve({}),
      }) as unknown as typeof fetch;
    expect(await fetchToolCapableModels()).toEqual([]);

    globalThis.fetch = vi
      .fn()
      .mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ nope: 1 }),
      }) as unknown as typeof fetch;
    expect(await fetchToolCapableModels()).toEqual([]);
  });
});

describe("model preference", () => {
  const catalog: ModelInfo[] = [
    {
      id: "a/one",
      name: "One",
      contextLength: 1,
      promptPrice: 0,
      completionPrice: 0,
    },
    {
      id: DEFAULT_MODEL,
      name: "Default",
      contextLength: 1,
      promptPrice: 0,
      completionPrice: 0,
    },
  ];

  it("round-trips the stored model id", () => {
    expect(readStoredModel()).toBeNull();
    storeModel("a/one");
    expect(readStoredModel()).toBe("a/one");
  });

  it("keeps a stored model that is in the catalog", () => {
    expect(resolveModel("a/one", catalog)).toEqual({
      model: "a/one",
      fellBack: false,
    });
  });

  it("falls back to the default and says so when the stored model left the catalog", () => {
    expect(resolveModel("gone/model", catalog)).toEqual({
      model: DEFAULT_MODEL,
      fellBack: true,
    });
  });

  it("uses the default without flagging when nothing is stored", () => {
    expect(resolveModel(null, catalog)).toEqual({
      model: DEFAULT_MODEL,
      fellBack: false,
    });
  });

  it("trusts the stored model while the catalog is still empty", () => {
    // An unreachable catalog must not silently swap the user's choice.
    expect(resolveModel("a/one", [])).toEqual({
      model: "a/one",
      fellBack: false,
    });
  });

  it("falls back to the first catalog entry if even the default is missing", () => {
    const noDefault = [catalog[0]];
    expect(resolveModel("gone/model", noDefault)).toEqual({
      model: "a/one",
      fellBack: true,
    });
  });
});
