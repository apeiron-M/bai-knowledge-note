import { resetLocation } from "../../../shared/test/browser-globals.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  beginOAuth,
  clearKey,
  completeOAuthFromUrl,
  getStoredKey,
  pkceChallenge,
  readReturnIntent,
  storeKey,
  validateKey,
} from "./openrouter-auth.js";

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  resetLocation();
});
afterEach(() => vi.restoreAllMocks());

describe("pkceChallenge", () => {
  it("produces the RFC 7636 Appendix B reference challenge", async () => {
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    expect(await pkceChallenge(verifier)).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
  });
});

describe("key storage", () => {
  it("round-trips and clears", () => {
    expect(getStoredKey()).toBeNull();
    storeKey("sk-or-v1-abc");
    expect(getStoredKey()).toBe("sk-or-v1-abc");
    clearKey();
    expect(getStoredKey()).toBeNull();
  });
});

describe("beginOAuth", () => {
  it("stores a verifier and the return intent, then redirects with S256", async () => {
    resetLocation("http://localhost:3000/d/vault?x=1");
    await beginOAuth({ driveId: "d1", draft: "half-typed" });

    const verifier = sessionStorage.getItem("bai-chat:pkce-verifier:v1");
    expect(verifier).toBeTruthy();
    expect(verifier!.length).toBeGreaterThanOrEqual(43);
    expect(
      JSON.parse(sessionStorage.getItem("bai-chat:oauth-return:v1")!),
    ).toEqual({ driveId: "d1", draft: "half-typed" });

    const url = new URL(location.href);
    expect(url.origin + url.pathname).toBe("https://openrouter.ai/auth");
    expect(url.searchParams.get("callback_url")).toBe(
      "http://localhost:3000/d/vault?x=1",
    );
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBe(
      await pkceChallenge(verifier!),
    );
  });
});

describe("readReturnIntent", () => {
  it("returns the intent once and clears it", () => {
    sessionStorage.setItem(
      "bai-chat:oauth-return:v1",
      JSON.stringify({ driveId: "d1", draft: "hello" }),
    );
    expect(readReturnIntent()).toEqual({ driveId: "d1", draft: "hello" });
    expect(readReturnIntent()).toBeNull();
  });

  it("returns null when absent or malformed", () => {
    expect(readReturnIntent()).toBeNull();
    sessionStorage.setItem("bai-chat:oauth-return:v1", "{not json");
    expect(readReturnIntent()).toBeNull();
    sessionStorage.setItem(
      "bai-chat:oauth-return:v1",
      JSON.stringify({ draft: "x" }),
    );
    expect(readReturnIntent()).toBeNull();
  });
});

describe("completeOAuthFromUrl", () => {
  it("returns null when there is no code in the URL", async () => {
    expect(await completeOAuthFromUrl()).toBeNull();
  });

  it("exchanges the code, stores the key and strips the code", async () => {
    sessionStorage.setItem("bai-chat:pkce-verifier:v1", "verifier-123");
    resetLocation("http://localhost:3000/app?code=abc123&other=keep");
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ key: "sk-or-v1-xyz" }),
    }) as unknown as typeof fetch;

    const result = await completeOAuthFromUrl();

    expect(result).toEqual({ key: "sk-or-v1-xyz" });
    expect(getStoredKey()).toBe("sk-or-v1-xyz");
    expect(location.search).not.toContain("code=");
    expect(location.search).toContain("other=keep");
    expect(sessionStorage.getItem("bai-chat:pkce-verifier:v1")).toBeNull();

    const [url, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0] as [string, RequestInit];
    expect(url).toBe("https://openrouter.ai/api/v1/auth/keys");
    expect(JSON.parse(init.body as string)).toEqual({
      code: "abc123",
      code_verifier: "verifier-123",
      code_challenge_method: "S256",
    });
  });

  it("returns null and still strips the code when the exchange fails", async () => {
    sessionStorage.setItem("bai-chat:pkce-verifier:v1", "verifier-123");
    resetLocation("http://localhost:3000/app?code=abc123");
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({}),
    }) as unknown as typeof fetch;

    expect(await completeOAuthFromUrl()).toBeNull();
    expect(location.search).not.toContain("code=");
    expect(getStoredKey()).toBeNull();
  });

  it("returns null without calling the network when the verifier is gone", async () => {
    resetLocation("http://localhost:3000/app?code=abc123");
    globalThis.fetch = vi.fn() as unknown as typeof fetch;

    expect(await completeOAuthFromUrl()).toBeNull();
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(location.search).not.toContain("code=");
  });
});

describe("validateKey", () => {
  it("is true on 200 and false on anything else", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue({ ok: true }) as unknown as typeof fetch;
    expect(await validateKey("k")).toBe(true);
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue({ ok: false }) as unknown as typeof fetch;
    expect(await validateKey("k")).toBe(false);
    globalThis.fetch = vi
      .fn()
      .mockRejectedValue(new Error("x")) as unknown as typeof fetch;
    expect(await validateKey("k")).toBe(false);
  });

  it("sends the key as a bearer token", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue({ ok: true }) as unknown as typeof fetch;
    await validateKey("sk-test");
    const [, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer sk-test",
    );
  });
});
