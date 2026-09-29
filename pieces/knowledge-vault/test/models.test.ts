import { describe, expect, it } from "vitest";
import { LlmClient, MODEL_CRITERIA, vaultModelLabel, vaultModels } from "../lib/agent/llm.js";

const OR = { baseUrl: "https://openrouter.ai/api/v1", apiKey: "k" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const model = (id: string, iq: number | null, prompt: string, completion: string, name = id) => ({ id, name, pricing: { prompt, completion }, benchmarks: iq === null ? null : { artificial_analysis: { intelligence_index: iq } } });
const catalogue = [
  model("openai/gpt-6-luna", 37.3, "0.00000005", "0.00000025", "GPT-6 Luna"),
  model("deepseek/deepseek-v4.1-flash", 39.5, "0.0000003", "0.0000012", "DeepSeek"),
  model("vendor/strong-cheap", 44, "0.0000001", "0.0000005", "Strong Cheap"),
  model("vendor/weak", 20, "0.0000001", "0.0000005", "Weak"),
  model("anthropic/claude-sonnet-5.5", 56, "0.000002", "0.00001", "Claude Sonnet 5.5"),
  model("anthropic/claude-sonnet-5.5:batch", 56, "0.000001", "0.000005"),
  model("vendor/strong-cheap:free", null, "0", "0", "Strong Cheap (free)"),
  model("vendor/unscored:free", null, "0", "0", "Unscored free"),
];
function openRouter(endpoints: (id: string) => Response | Promise<Response> = () => json({ data: { endpoints: [{ supported_parameters: ["response_format"], throughput_last_30m: { p50: 80 } }, { supported_parameters: ["response_format"], throughput_last_30m: { p50: 120 } }, { supported_parameters: [], throughput_last_30m: { p50: 999 } }] } })) {
  const urls: string[] = [];
  const fetchImpl = (async (url: string) => {
    urls.push(String(url));
    if (String(url).includes("/endpoints")) return endpoints(String(url));
    return json({ data: catalogue });
  }) as unknown as typeof fetch;
  return { fetchImpl, urls, llm: new LlmClient(OR, fetchImpl) };
}

describe("the vault's model list", () => {
  it("offers cheap models that qualify, tested first and slow ones last, free twins scored by their paid model", async () => {
    const { llm, fetchImpl, urls } = openRouter();
    const list = await vaultModels(llm, "", fetchImpl);
    expect(list.map((m) => m.id)).toEqual(["openai/gpt-6-luna", "vendor/strong-cheap", "vendor/strong-cheap:free", "deepseek/deepseek-v4.1-flash"]);
    expect(urls[0]).toBe("https://openrouter.ai/api/v1/models?supported_parameters=reasoning,response_format");
    expect(list[1]).toMatchObject({ intelligence: 44, tokensPerSecond: 120, free: false });
    expect(list[2]).toMatchObject({ intelligence: 44, free: true });
    expect(list.map(vaultModelLabel)).toEqual([
      "GPT-6 Luna — IQ 37 · $0.05 / $0.25 per M · tested: 10 s a stage",
      "Strong Cheap — IQ 44 · $0.10 / $0.50 per M · ~120 tok/s",
      "Strong Cheap (free) — IQ 44 · free · ~120 tok/s",
      "DeepSeek — IQ 40 · $0.30 / $1.20 per M · slow here: reasons at length",
    ]);
    expect(MODEL_CRITERIA).toEqual({ minIntelligence: 35, maxOutputPerM: 2 });
  });

  it("finds any model by name, labelling an expensive one as such", async () => {
    const { llm, fetchImpl } = openRouter(() => { throw new Error("down"); });
    const found = await vaultModels(llm, " Sonnet ", fetchImpl);
    expect(found.map((m) => m.id)).toEqual(["anthropic/claude-sonnet-5.5"]);
    expect(vaultModelLabel(found[0])).toBe("Claude Sonnet 5.5 — IQ 56 · $2.00 / $10.00 per M · tested: 6 s a stage · not a cheap model");
  });

  it("leaves speed unknown when a provider list fails, and reports a refused key", async () => {
    const quiet = openRouter(() => json({}, 500));
    expect((await vaultModels(quiet.llm, "strong", quiet.fetchImpl)).map((m) => m.tokensPerSecond)).toEqual([null, null]);
    const empty = openRouter(() => json({ data: { endpoints: [] } }));
    expect(vaultModelLabel((await vaultModels(empty.llm, "strong-cheap:free", empty.fetchImpl))[0])).toBe("Strong Cheap (free) — IQ 44 · free");
    const refused = (async () => json({ error: { message: "bad key" } }, 401)) as unknown as typeof fetch;
    await expect(vaultModels(new LlmClient(OR, refused), "", refused)).rejects.toMatchObject({ category: "credential" });
    const bare = (async () => json({})) as unknown as typeof fetch;
    expect(await vaultModels(new LlmClient(OR, bare), "", bare)).toEqual([]);
    const odd = (async () => json({ data: [{ id: "x/odd", pricing: { prompt: "n/a" } }, { name: "no id" }] })) as unknown as typeof fetch;
    expect(vaultModelLabel((await vaultModels(new LlmClient(OR, odd), "odd", odd))[0])).toBe("x/odd");
  });

  it("lists another provider's models as they are, searchable", async () => {
    const other = (async () => json({ data: [{ id: "gpt-x", name: "GPT X", pricing: { prompt: "0.000001", completion: "0.000002" } }, { id: "tiny" }] })) as unknown as typeof fetch;
    const llm = new LlmClient({ baseUrl: "https://api.example.com/v1", apiKey: "k" }, other);
    expect((await vaultModels(llm, "", other)).map(vaultModelLabel)).toEqual(["GPT X — $1.00 / $2.00 per M", "tiny"]);
    expect((await vaultModels(llm, "gpt", other)).map((m) => m.id)).toEqual(["gpt-x"]);
  });
});
