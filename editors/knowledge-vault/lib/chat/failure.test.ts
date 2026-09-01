import { describe, expect, it } from "vitest";
import { OpenRouterError } from "./openrouter-client.js";
import { classifyFailure } from "./failure.js";

const or = (status: number, message: string, raw?: string) =>
  new OpenRouterError(
    status,
    message,
    raw ?? JSON.stringify({ error: { code: status, message } }),
  );

describe("classifyFailure", () => {
  it("402 is a credits problem", () => {
    const f = classifyFailure(
      or(402, "This request requires more credits, or fewer max_tokens."),
    );
    expect(f.kind).toBe("credits");
    expect(f.message).toContain("credits");
  });

  it("a free-tier 429 is the account-wide quota — never a reason to try another model", () => {
    for (const msg of [
      "Rate limit exceeded: free-models-per-day",
      "Rate limit exceeded: free-models-per-min",
      "Rate limit exceeded",
    ]) {
      expect(classifyFailure(or(429, msg)).kind).toBe("free-quota");
    }
  });

  it("a 429 that names an upstream provider is that model being throttled, not the account", () => {
    const raw = JSON.stringify({
      error: {
        code: 429,
        message: "Provider returned error",
        metadata: { provider_name: "SomeLab", raw: "too many requests" },
      },
    });
    expect(classifyFailure(or(429, "Provider returned error", raw)).kind).toBe(
      "model-unavailable",
    );
  });

  it("5xx and 'no endpoints' mean the model is unavailable", () => {
    expect(classifyFailure(or(502, "Provider returned error")).kind).toBe(
      "model-unavailable",
    );
    expect(classifyFailure(or(503, "Service unavailable")).kind).toBe(
      "model-unavailable",
    );
    expect(
      classifyFailure(or(404, "No endpoints found for x/y:free.")).kind,
    ).toBe("model-unavailable");
  });

  it("an abort is its own kind and carries no user-facing alarm", () => {
    const e = new DOMException("The user aborted a request.", "AbortError");
    expect(classifyFailure(e).kind).toBe("aborted");
  });

  it("anything else is reported verbatim", () => {
    const f = classifyFailure(new TypeError("Failed to fetch"));
    expect(f.kind).toBe("other");
    expect(f.message).toContain("Failed to fetch");
    expect(classifyFailure("weird").kind).toBe("other");
  });

  it("keeps the provider's own wording in every message", () => {
    const f = classifyFailure(
      or(
        402,
        "Insufficient credits. Add more at openrouter.ai/settings/credits",
      ),
    );
    expect(f.message).toContain("Insufficient credits");
  });
});
