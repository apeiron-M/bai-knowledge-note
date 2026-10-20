/** The less-travelled branches: each one is a real input a workflow can produce. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { shapeSearch, searchAction } from "../lib/actions/search.js";
import { describeAuthFailure, knowledgeVaultAuth } from "../lib/auth.js";
import { normalizeBaseUrl, readAuth } from "../lib/common/auth-value.js";
import { describeCause, KnowledgeVaultClient } from "../lib/common/client.js";
import { classify, KnowledgeVaultApiError, readErrorBody } from "../lib/common/errors.js";
import { driveProp } from "../lib/common/props.js";
import { ADDRESS, DRIVE, GOOD_TOKEN, startVaultServer, type VaultServer } from "./vault-server.js";

let server: VaultServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
  vi.unstubAllGlobals();
});

describe("the drive dropdown", () => {
  const options = (auth: unknown) => driveProp.options({ auth } as never, {} as never);

  it("asks for a connection before it has one", async () => {
    await expect(options(undefined)).resolves.toMatchObject({ disabled: true, options: [] });
  });

  it("lists the vaults the bearer can read", async () => {
    server = await startVaultServer();
    await expect(options({ base_url: server.baseUrl, token: GOOD_TOKEN })).resolves.toEqual({
      disabled: false,
      placeholder: "Choose a vault",
      options: [{ label: DRIVE.name, value: DRIVE.id }],
    });
  });

  it("says when there is nothing to choose", async () => {
    server = await startVaultServer({ drives: [] });
    await expect(options({ base_url: server.baseUrl, token: GOOD_TOKEN })).resolves.toMatchObject({ placeholder: "This identity can read no vault" });
  });

  it("shows why it could not list, instead of failing the form", async () => {
    server = await startVaultServer();
    await expect(options({ base_url: server.baseUrl, token: "stale" })).resolves.toMatchObject({ disabled: true, placeholder: expect.stringContaining("Could not list vaults") as string });
  });
});

describe("the connection label and failures", () => {
  it("omits the expiry for a token that carries none", async () => {
    server = await startVaultServer({ drives: [DRIVE, { ...DRIVE, id: "d2" }] });
    const label = await knowledgeVaultAuth.getConnectionIdentifier!({ auth: { base_url: server.baseUrl, token: GOOD_TOKEN } } as never);
    expect(label).toBe(`${ADDRESS.slice(0, 6)}…${ADDRESS.slice(-4)} @ ${new URL(server.baseUrl).host} · 2 vaults`);
  });

  it("does not blame the egress list for an unreachable public host", () => {
    const error = new KnowledgeVaultApiError("Could not reach the Switchboard: ENOTFOUND", { category: "network", detail: { code: "ENOTFOUND" } });
    expect(describeAuthFailure(error)).toBe("The Switchboard is unreachable: Could not reach the Switchboard: ENOTFOUND");
    expect(describeAuthFailure(new KnowledgeVaultApiError("t", { category: "timeout" }))).toBe("The Switchboard is unreachable: t");
    expect(describeAuthFailure(new KnowledgeVaultApiError("c", { category: "config" }))).toBe("c");
  });

  it("names a local address it could not reach, with detail as text or data", () => {
    expect(describeAuthFailure(new KnowledgeVaultApiError("m", { category: "network", detail: "ECONNREFUSED: 127.0.0.1" }))).toMatch(/\(ECONNREFUSED: 127\.0\.0\.1\).*EGRESS/);
    expect(describeAuthFailure(new KnowledgeVaultApiError("ECONNREFUSED", { category: "network", detail: 5 }))).toMatch(/\(5\)/);
    expect(describeAuthFailure(new KnowledgeVaultApiError("ECONNREFUSED", { category: "network", detail: true }))).toMatch(/\(true\)/);
    expect(describeAuthFailure(new KnowledgeVaultApiError("ECONNREFUSED", { category: "network" }))).toMatch(/\(ECONNREFUSED\)/);
  });

  it("keeps a non-address identity as it is", async () => {
    server = await startVaultServer();
    const client = new KnowledgeVaultClient({ baseUrl: server.baseUrl, token: GOOD_TOKEN });
    await expect(client.ping(true)).rejects.toMatchObject({ status: 401, category: "credential" });
  });
});

describe("the auth value", () => {
  it.each([undefined, "", "  "])("refuses a missing base URL (%j)", (raw) => {
    expect(() => normalizeBaseUrl(raw)).toThrow("Base URL is required");
  });
  it("refuses a connection with no props or no token", () => {
    expect(() => readAuth(null)).toThrow(/No Knowledge Vault connection/);
    expect(() => readAuth({ base_url: "https://v.example" })).toThrow(/no API token/);
  });
});

describe("the client", () => {
  it("reports a timeout as retryable", async () => {
    vi.stubGlobal("fetch", (_u: unknown, init: { signal: AbortSignal }) =>
      new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })))),
    );
    const client = new KnowledgeVaultClient({ baseUrl: "https://v.example", token: "t" });
    await expect(client.request({ path: "ping", timeoutMs: 5 })).rejects.toMatchObject({ category: "timeout", retryable: true });
  });

  it("times out a response whose body stalls halfway", async () => {
    const stalled = (error: Error) => async () => ({ ok: true, status: 200, text: async () => { throw error; } }) as unknown as Response;
    const client = (error: Error) => new KnowledgeVaultClient({ baseUrl: "https://v.example", token: "t" }, stalled(error) as unknown as typeof fetch);
    await expect(client(Object.assign(new Error("The operation was aborted"), { name: "AbortError" })).request({ path: "graph.json" })).rejects.toMatchObject({ category: "timeout", message: "The request timed out" });
    await expect(client(new Error("terminated")).request({ path: "graph.json" })).rejects.toMatchObject({ category: "network", retryable: true });
  });

  it("keeps a proxy's plain-text error and a non-JSON success body", async () => {
    vi.stubGlobal("fetch", async (url: URL) =>
      url.pathname.endsWith("/bad") ? new Response("upstream down", { status: 502 }) : new Response("not json", { status: 200 }),
    );
    const client = new KnowledgeVaultClient({ baseUrl: "https://v.example", token: "t" });
    await expect(client.request({ path: "bad" })).rejects.toMatchObject({ message: "upstream down", status: 502, category: "server", retryable: true });
    await expect(client.request({ path: "ok", query: { a: 1, skip: undefined, none: null, empty: "" } })).resolves.toBe("not json");
    await expect(client.request({ path: "ok", method: "POST", json: { x: 1 } })).resolves.toBe("not json");
  });

  it("describes a cause with or without a code", () => {
    expect(describeCause("s")).toBe("s");
    expect(describeCause(new Error("plain"))).toBe("plain");
    expect(describeCause(Object.assign(new Error("f"), { cause: new Error("inner") }))).toBe("inner");
    expect(describeCause(Object.assign(new Error("f"), { cause: Object.assign(new Error("refused"), { code: "ECONNREFUSED" }) }))).toBe("ECONNREFUSED: refused");
  });
});

describe("error bodies and statuses", () => {
  it.each([
    [undefined, {}],
    ["", {}],
    [42, {}],
    [{ message: "m" }, { message: "m", code: undefined }],
    [{ detail: " d " }, { message: "d", code: undefined }],
    [{ error: "e", code: "LINT_REACTOR" }, { message: "e", code: "LINT_REACTOR" }],
  ])("reads %j", (body, want) => expect(readErrorBody(body)).toEqual(want));

  it.each([
    [401, "credential"],
    [403, "permission"],
    [404, "not_found"],
    [409, "conflict"],
    [429, "rate_limit"],
    [422, "validation"],
    [418, "server"],
  ])("classifies a bare %i as %s", (status, category) => expect(classify(status, undefined).category).toBe(category));

  it("falls back to the status for a code it does not know", () => {
    expect(classify(403, "SOMETHING_NEW")).toEqual({ category: "permission", retryable: false });
  });
});

describe("search shaping", () => {
  it("names a hit by its id when it has no title, and passes no content it was not given", () => {
    const shaped = shapeSearch({ query: "q", hits: [{ node: { documentId: "x1" }, similarity: 0.5 }] }, 0, false);
    expect(shaped.hits[0]).toEqual({ id: "x1", title: "x1", description: null, similarity: 0.5, document_type: null, note_type: null, status: null });
    expect(shaped).toMatchObject({ related: [], links: [], first_title: "x1" });
    expect(shapeSearch({ query: "q", hits: [] }, 0, false)).toMatchObject({ count: 0, first_id: null, first_title: null });
    expect(shapeSearch({ query: "q", hits: [{ node: {}, similarity: 0.5 }] }, 0, false).hits[0]?.id).toBe("");
  });

  it("falls back to the defaults for limits that are not numbers", async () => {
    server = await startVaultServer();
    await searchAction.run({
      auth: { type: "CUSTOM_AUTH", props: { base_url: server.baseUrl, token: GOOD_TOKEN } },
      propsValue: { drive: DRIVE.id, query: "q", limit: "lots", related: "7", min_similarity: undefined },
    } as never);
    expect(server.requests.at(-1)?.query).toMatchObject({ limit: "6", related: "7" });
  });
});
