import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { completeJson, isDroppedConnection, isTimeout, LlmClient, modelCalls } from "../lib/agent/llm.js";
import { patientFetch } from "../lib/agent/patient-fetch.js";

let server: Server | undefined;
afterEach(async () => {
  vi.unstubAllGlobals();
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  server = undefined;
});
async function serve(handler: Parameters<typeof createServer>[1]): Promise<string> {
  server = createServer(handler);
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

/** Node's fetch gives up past five minutes; a local model's answer may come later (patient-fetch.ts). */
describe("patientFetch: a local model's call, without fetch's five-minute limits", () => {
  it("posts the request and gives back the answer as a Response", async () => {
    const base = await serve((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        res.writeHead(200, { "content-type": "application/json", "x-seen": req.headers.authorization ?? "" });
        const echoed: unknown = JSON.parse(body);
        res.end(JSON.stringify({ echoed }));
      });
    });
    const response = await patientFetch(`${base}/chat/completions`, { method: "POST", headers: { Authorization: "Bearer k", "Content-Type": "application/json" }, body: JSON.stringify({ a: 1 }) });
    expect(response.status).toBe(200);
    expect(response.headers.get("x-seen")).toBe("Bearer k");
    expect(await response.json()).toEqual({ echoed: { a: 1 } });
  });

  it("waits for an answer that starts late, as long as the call's own signal allows", async () => {
    const base = await serve((_req, res) => void setTimeout(() => res.end("{}"), 300));
    const response = await patientFetch(base, { signal: AbortSignal.timeout(5_000) });
    expect(await response.text()).toBe("{}");
  });

  it("stops at the call's own timeout, reported as one", async () => {
    const base = await serve(() => {}); // never answers
    const error = await patientFetch(base, { signal: AbortSignal.timeout(100) }).catch((e: unknown) => e);
    expect(isTimeout(error)).toBe(true);
  });

  it("reports an answer cut off half-way as a dropped connection, which the caller retries", async () => {
    const base = await serve((_req, res) => {
      res.writeHead(200, { "content-length": "1000" });
      res.write("{\"partial\":");
      setTimeout(() => res.socket?.destroy(), 20);
    });
    const error = await patientFetch(base).catch((e: unknown) => e);
    expect(isDroppedConnection(error)).toBe(true);
  });
});

describe("a local model's staged calls", () => {
  const local = { apiKey: "k", baseUrl: "http://127.0.0.1:4201/llm/v1", defaultModel: "gpt-oss-20b", locality: "local" as const };

  it("reach the model through the client's local fetch, not fetch", async () => {
    // The desktop app's gateway says what runs now; only the completion goes through the local fetch.
    const global = vi.fn(async (url: string) => (url.endsWith("/active") ? new Response(JSON.stringify({ model: "gpt-oss-20b", locality: "local" })) : new Response("unexpected", { status: 500 })));
    vi.stubGlobal("fetch", global);
    const localFetch = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: "{\"ok\":true}" } }] })));
    const client = new LlmClient(local, global as unknown as typeof fetch, localFetch as unknown as typeof fetch);
    const { value } = await completeJson(client, { model: "gpt-oss-20b", system: "s", user: "u" });
    expect(value).toEqual({ ok: true });
    expect(localFetch).toHaveBeenCalledWith(`${local.baseUrl}/chat/completions`, expect.objectContaining({ method: "POST" }));
    expect(global.mock.calls.every(([url]) => String(url).endsWith("/active"))).toBe(true);
  });

  it("ask a local model's server for the reasoning effort in the form it reads; a hosted provider keeps its own", async () => {
    const bodyOf = async (locality: "local" | "hosted") => {
      const global = vi.fn(async (url: string) => (url.endsWith("/active") ? new Response(JSON.stringify({ model: "gpt-oss-20b", locality })) : new Response("unexpected", { status: 500 })));
      vi.stubGlobal("fetch", global);
      let sent: Record<string, unknown> = {};
      const answer = vi.fn(async (_url: string, init: { body?: string }) => {
        sent = JSON.parse(init.body ?? "{}") as Record<string, unknown>;
        return new Response(JSON.stringify({ choices: [{ message: { content: "{}" } }] }));
      });
      // A hosted connection set up by the app also carries a locality; its calls go through fetch.
      const client = new LlmClient({ ...local, locality }, global as unknown as typeof fetch, answer as unknown as typeof fetch);
      if (locality === "hosted") global.mockImplementation(async (url: string, init?: { body?: string }) => (url.endsWith("/active") ? new Response(JSON.stringify({ model: "m", locality })) : answer(url, init ?? {})));
      await completeJson(client, { model: "gpt-oss-20b", system: "s", user: "u", reasoningEffort: "low" });
      vi.unstubAllGlobals();
      return sent;
    };
    expect(await bodyOf("local")).toMatchObject({ reasoning: { effort: "low" }, reasoning_effort: "low" });
    const hosted = await bodyOf("hosted");
    expect(hosted).toMatchObject({ reasoning: { effort: "low" } });
    expect(hosted).not.toHaveProperty("reasoning_effort");
  });

  it("go one after another on a local model, all at once on a hosted one", async () => {
    const overlap = async (locality: "local" | "hosted") => {
      const llm = { active: async () => ({ model: "m", locality, contextTokens: null, fromGateway: true }) } as unknown as LlmClient;
      let running = 0;
      let most = 0;
      await modelCalls(llm, [1, 2, 3, 4], async () => {
        most = Math.max(most, ++running);
        await new Promise((resolve) => setTimeout(resolve, 10));
        running--;
      });
      return most;
    };
    expect(await overlap("local")).toBe(1);
    expect(await overlap("hosted")).toBe(4);
  });
});
