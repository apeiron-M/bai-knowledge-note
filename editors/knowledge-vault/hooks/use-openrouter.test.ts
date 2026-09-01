import "../../shared/test/browser-globals.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FALLBACK_MODEL,
  MIN_DEFAULT_CONTEXT,
  fetchToolCapableModels,
  pickDefaultModel,
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
              created: 1700000000,
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
      created: 1700000000,
      contextLength: 200000,
      promptPrice: 0.000003,
      completionPrice: 0.000015,
      free: false,
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
        created: 0,
        contextLength: 0,
        promptPrice: 0,
        completionPrice: 0,
        free: true,
      },
    ]);
  });

  it("returns an empty list rather than throwing when the catalog is unreachable or malformed", async () => {
    globalThis.fetch = vi
      .fn()
      .mockRejectedValue(new Error("offline")) as unknown as typeof fetch;
    expect(await fetchToolCapableModels()).toEqual([]);

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({}),
    }) as unknown as typeof fetch;
    expect(await fetchToolCapableModels()).toEqual([]);

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ nope: 1 }),
    }) as unknown as typeof fetch;
    expect(await fetchToolCapableModels()).toEqual([]);
  });
});

const m = (id: string, o: Partial<ModelInfo> = {}): ModelInfo => ({
  id,
  name: id,
  created: 0,
  contextLength: 200_000,
  promptPrice: 0.000001,
  completionPrice: 0.000002,
  free: false,
  ...o,
});
const FREE = { promptPrice: 0, completionPrice: 0, free: true };

describe("pickDefaultModel", () => {
  it("chooses the newest free model with a usable context window", () => {
    const catalog = [
      m("old/free", { ...FREE, created: 100 }),
      m("new/free", { ...FREE, created: 300 }),
      m("newest/tiny-free", {
        ...FREE,
        created: 400,
        contextLength: MIN_DEFAULT_CONTEXT - 1,
      }),
      m("newest/paid", { created: 500 }),
      m(FALLBACK_MODEL, { created: 50 }),
    ];
    expect(pickDefaultModel(catalog)).toBe("new/free");
  });

  it("detects free by price, not by an id suffix", () => {
    expect(
      pickDefaultModel([
        m("vendor/model", { ...FREE, created: 1 }),
        m("x/y:free", { created: 2 }),
      ]),
    ).toBe("vendor/model");
  });

  it("falls back to the paid fallback when no free model qualifies, then to the first entry", () => {
    expect(pickDefaultModel([m("a/paid"), m(FALLBACK_MODEL)])).toBe(
      FALLBACK_MODEL,
    );
    expect(pickDefaultModel([m("a/paid"), m("b/paid")])).toBe("a/paid");
  });

  it("returns the fallback id for an empty catalog", () => {
    expect(pickDefaultModel([])).toBe(FALLBACK_MODEL);
  });
});

describe("model preference", () => {
  const catalog = [
    m("a/one"),
    m("free/new", { ...FREE, created: 9 }),
    m(FALLBACK_MODEL),
  ];

  it("round-trips the stored model id", () => {
    expect(readStoredModel()).toBeNull();
    storeModel("a/one");
    expect(readStoredModel()).toBe("a/one");
  });

  it("keeps a stored model that is in the catalog, even if a free one exists", () => {
    expect(resolveModel("a/one", catalog)).toEqual({
      model: "a/one",
      fellBack: false,
    });
  });

  it("uses the newest free model without flagging when nothing is stored", () => {
    expect(resolveModel(null, catalog)).toEqual({
      model: "free/new",
      fellBack: false,
    });
  });

  it("falls back to the newest free model and says so when the stored model left the catalog", () => {
    expect(resolveModel("gone/model", catalog)).toEqual({
      model: "free/new",
      fellBack: true,
    });
  });

  it("trusts the stored model while the catalog is still empty", () => {
    // An unreachable catalog must not silently swap the user's choice.
    expect(resolveModel("a/one", [])).toEqual({
      model: "a/one",
      fellBack: false,
    });
    expect(resolveModel(null, [])).toEqual({
      model: FALLBACK_MODEL,
      fellBack: false,
    });
  });
});
