import { afterEach, describe, expect, it } from "vitest";
import { knowledgeVault } from "../index.js";
import type { shapeSearch } from "../lib/actions/search.js";
import { searchAction } from "../lib/actions/search.js";
import { checkConnection, describeAuthFailure, knowledgeVaultAuth, tokenExpiry } from "../lib/auth.js";
import { AUTH_PROP_ORDER, normalizeBaseUrl, readAuth } from "../lib/common/auth-value.js";
import { KnowledgeVaultClient } from "../lib/common/client.js";
import { classify, KnowledgeVaultApiError } from "../lib/common/errors.js";
import { ADDRESS, DRIVE, GOOD_TOKEN, startVaultServer, type VaultServer } from "./vault-server.js";

let server: VaultServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});
const clientOf = (baseUrl: string, token = GOOD_TOKEN) => new KnowledgeVaultClient({ baseUrl, token });

describe("the piece definition", () => {
  // Tests that call actions one by one never import index.ts; this one does,
  // so an action left out of the piece fails here.
  it("ships exactly these actions and triggers", () => {
    expect(Object.keys(knowledgeVault.actions()).sort()).toEqual(["connect-notes", "extract-claims", "ingest-source", "place-in-mocs", "search", "verify-notes"]);
    expect(Object.keys(knowledgeVault.triggers())).toEqual(["new-pipeline-task"]);
  });
});

describe("the base URL", () => {
  it.each([
    ["https://vault.example.com/", "https://vault.example.com"],
    ["  http://localhost:4001 ", "http://localhost:4001"],
  ])("accepts %j", (raw, want) => expect(normalizeBaseUrl(raw)).toBe(want));

  it.each(["https://vault.example.com/graphql", "https://vault.example.com/api", "https://vault.example.com/api/@powerhousedao/knowledge-note", "vault.example.com", "ftp://x.y"])(
    "refuses %j",
    (raw) => expect(() => normalizeBaseUrl(raw)).toThrow(KnowledgeVaultApiError),
  );

  it("reads both auth shapes: the action envelope and the flat validate value", () => {
    const flat = { base_url: "https://v.example", token: "t" };
    expect(readAuth(flat)).toEqual({ baseUrl: "https://v.example", token: "t" });
    expect(readAuth({ type: "CUSTOM_AUTH", props: flat })).toEqual({ baseUrl: "https://v.example", token: "t" });
  });
});

describe("error classification", () => {
  it("carries no own property for an absent field, so nothing crosses IPC as \"undefined\"", () => {
    const error = new KnowledgeVaultApiError("x", { category: "config" });
    expect(Object.keys(error).sort()).toEqual(["category", "name", "retryable"]);
    const full = new KnowledgeVaultApiError("x", { category: "validation", status: 400, code: "LINT_REACTOR", detail: [] });
    expect(full).toMatchObject({ status: 400, code: "LINT_REACTOR", detail: [] });
  });

  it("lets the vault's code decide over the status", () => {
    expect(classify(502, "CREATE_FAILED")).toEqual({ category: "server", retryable: true });
    expect(classify(502, "INGEST_REJECTED")).toEqual({ category: "server", retryable: false });
    expect(classify(400, "LINT_REACTOR")).toEqual({ category: "validation", retryable: false });
    expect(classify(503, "READ_BACK_INCOMPLETE")).toEqual({ category: "unconfirmed", retryable: false });
    expect(classify(503, undefined)).toEqual({ category: "server", retryable: true });
    expect(classify(413, undefined).category).toBe("validation");
  });
});

describe("the connection check, against the vault's real routes", () => {
  it("passes and names the identity and how many vaults it reads", async () => {
    server = await startVaultServer();
    await expect(checkConnection(clientOf(server.baseUrl))).resolves.toEqual({ address: ADDRESS, vaults: 1 });
    const label = await knowledgeVaultAuth.getConnectionIdentifier!({ auth: { base_url: server.baseUrl, token: GOOD_TOKEN } } as never);
    expect(label).toMatch(/^0xadba…bca4 @ 127\.0\.0\.1:\d+ · 1 vault$/);
  });

  it("says the token was rejected", async () => {
    server = await startVaultServer();
    const result = await knowledgeVaultAuth.validate!({ auth: { base_url: server.baseUrl, token: "stale" } } as never);
    expect(result.valid).toBe(false);
    expect((result as { error?: string }).error).toMatch(/rejected the token/);
  });

  it("says when the host resolves no caller identity", async () => {
    server = await startVaultServer({ identity: false });
    await expect(checkConnection(clientOf(server.baseUrl))).rejects.toThrow(/does not resolve caller identity/);
  });

  it("says when the identity can read no vault", async () => {
    server = await startVaultServer({ drives: [] });
    await expect(checkConnection(clientOf(server.baseUrl))).rejects.toThrow(/can read no vault/);
  });

  it("points a refused local address at the egress allow-list", async () => {
    // A port that was just free: nothing listens, so the connect is refused.
    const probe = await startVaultServer();
    const closedUrl = probe.baseUrl;
    await probe.close();
    const result = await knowledgeVaultAuth.validate!({ auth: { base_url: closedUrl, token: GOOD_TOKEN } } as never);
    expect(result.valid).toBe(false);
    expect((result as { error?: string }).error).toMatch(/PH_WORKFLOWS_EGRESS_ALLOW_ADDRESSES/);
  });

  it("maps every failure category to a sentence", () => {
    expect(describeAuthFailure(new KnowledgeVaultApiError("x", { category: "not_found" }))).toMatch(/not with a knowledge vault/);
    expect(describeAuthFailure(new Error("plain"))).toBe("plain");
    expect(describeAuthFailure("text")).toBe("text");
  });

  it("reads a JWT's expiry for the label, and ignores a token that is not one", () => {
    const payload = btoa(JSON.stringify({ exp: 1791203974 })).replace(/=+$/, "");
    expect(tokenExpiry(`h.${payload}.s`)).toBe("2026-10-05");
    expect(tokenExpiry("not-a-jwt")).toBeUndefined();
  });
});

describe("search", () => {
  const run = (propsValue: Record<string, unknown>, baseUrl: string) =>
    searchAction.run({ auth: { type: "CUSTOM_AUTH", props: { base_url: baseUrl, token: GOOD_TOKEN } }, propsValue } as never);

  it("calls the real search route and flattens the hits for later steps", async () => {
    server = await startVaultServer();
    const out = (await run({ drive: DRIVE.id, query: "how does sync work", limit: 99, include_content: true }, server.baseUrl)) as ReturnType<typeof shapeSearch>;
    expect(server.requests.at(-1)).toMatchObject({ path: "search", query: { drive: DRIVE.id, q: "how does sync work", mode: "semantic", limit: "25", related: "10", content: "1" } });
    expect(out.count).toBe(3);
    expect(out.first_id).toBe("n1");
    expect(out.first_title).toBe("Sync works by channels");
    expect(out.hits[0]).toMatchObject({ id: "n1", similarity: 0.91, document_type: null, note_type: "concept", status: "CANONICAL", content: "body" });
  });

  it("filters weak matches and MoCs on request", async () => {
    server = await startVaultServer();
    const out = (await run({ drive: DRIVE.id, query: "sync", min_similarity: 0.5, exclude_mocs: true }, server.baseUrl)) as ReturnType<typeof shapeSearch>;
    expect(out.hits.map((h) => h.id)).toEqual(["n1"]);
    expect(server.requests.at(-1)?.query.content).toBeUndefined();
  });

  it("adds the route's own markdown digest when asked", async () => {
    server = await startVaultServer();
    const out = (await run({ drive: DRIVE.id, query: "sync", as_markdown: true }, server.baseUrl)) as { markdown: string };
    expect(server.requests.at(-1)?.accept).toBe("text/markdown");
    expect(out.markdown).toContain("Sync works by channels");
  });

  it("surfaces the route's 400 as a validation error, not a crash", async () => {
    server = await startVaultServer();
    await expect(run({ drive: "", query: "x" }, server.baseUrl)).rejects.toMatchObject({ status: 400, category: "validation", code: "BAD_REQUEST" });
  });
});

describe("a pasted token", () => {
  it.each([
    ["eyJa.b.c", "eyJa.b.c"],
    ["  eyJa.b.c\n", "eyJa.b.c"],
    ["Bearer eyJa.b.c", "eyJa.b.c"],
    ['"bearer  eyJa.b.c"\n', "eyJa.b.c"],
  ])("%j is sent as the bare token", (pasted, sent) => {
    expect(readAuth({ base_url: "https://v.test", token: pasted }).token).toBe(sent);
  });
  it("that is only whitespace or quotes counts as missing", () => {
    expect(() => readAuth({ base_url: "https://v.test", token: " '' \n" })).toThrow(/no API token/);
  });
  it("gets a failure message that names what was actually wrong", () => {
    expect(describeAuthFailure(new KnowledgeVaultApiError("x", { category: "credential", status: 401 }))).toMatch(/Paste only the token/);
    expect(describeAuthFailure(new KnowledgeVaultApiError("The LLM provider rejected the API key.", { category: "credential" }))).toBe("The LLM provider rejected the API key.");
  });
});

describe("a connection made in Studio on dev.28", () => {
  it("stores fields by position; they are read back by name", () => {
    const credentials = readAuth({ props: { "0": "https://v.test", "1": "Bearer eyJa.b.c", "2": "sk-or-1", "4": "m/x" } });
    expect(credentials).toMatchObject({ baseUrl: "https://v.test", token: "eyJa.b.c", llm: { apiKey: "sk-or-1", defaultModel: "m/x" } });
  });
  it("declares its props in the order the position mapping assumes", () => {
    expect(Object.keys((knowledgeVaultAuth as unknown as { props: Record<string, unknown> }).props)).toEqual([...AUTH_PROP_ORDER]);
  });
  it("leaves named props alone", () => {
    expect(readAuth({ base_url: "https://v.test", token: "t", "0": "https://other.test" }).baseUrl).toBe("https://v.test");
  });
});
