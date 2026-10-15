import { describe, expect, it } from "vitest";
import { ProviderError } from "./completions-client.js";
import { classifyFailure } from "./failure.js";

const or = (status: number, message: string, raw?: string) =>
  new ProviderError(
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

  it("a network failure is 'unreachable', with a CORS hint when the endpoint is on this machine", () => {
    const plain = classifyFailure(new TypeError("Failed to fetch"));
    expect(plain.kind).toBe("unreachable");
    expect(plain.message).toContain("Failed to fetch");
    expect(plain.message).not.toContain("OLLAMA_ORIGINS");

    const local = classifyFailure(new TypeError("Failed to fetch"), {
      label: "localhost:11434",
      completionsUrl: "http://localhost:11434/v1/chat/completions",
    });
    expect(local.kind).toBe("unreachable");
    expect(local.message).toContain("localhost:11434");
    expect(local.message).toContain("OLLAMA_ORIGINS");

    const remote = classifyFailure(new TypeError("Failed to fetch"), {
      label: "llm.example",
      completionsUrl: "https://llm.example/v1/chat/completions",
    });
    expect(remote.message).not.toContain("OLLAMA_ORIGINS");
  });

  it("a refused key is 'auth' on any endpoint", () => {
    expect(classifyFailure(or(401, "No auth credentials found")).kind).toBe("auth");
    expect(classifyFailure(new ProviderError(403, "forbidden", "{}", "llm.example", false)).kind).toBe("auth");
  });

  it("outside OpenRouter a 429 is the server throttling, never the free-quota story", () => {
    const f = classifyFailure(new ProviderError(429, "slow down", "{}", "localhost:11434", false));
    expect(f.kind).toBe("model-unavailable");
    expect(f.message).toBe("slow down");
  });

  it("anything else is reported verbatim", () => {
    expect(classifyFailure(new Error("odd")).message).toBe("odd");
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

describe("a service that is busy for a moment", () => {
  const viaApp = (status: number) => new ProviderError(status, "ChatGPT answered 504 (Gateway time-out)", "", "gpt-6.1-sol on your ChatGPT plan", false);

  it("is busy — not a missing model — on the desktop app's gateway or a server you named", () => {
    for (const status of [408, 502, 504, 524]) {
      expect(classifyFailure(viaApp(status))).toEqual({ kind: "busy", message: "ChatGPT answered 504 (Gateway time-out)" });
    }
  });

  it("leaves a 503 as a model that cannot be served: the gateway already asked again", () => {
    expect(classifyFailure(viaApp(503)).kind).toBe("model-unavailable");
  });

  it("stays unavailable on OpenRouter, where a 5xx names one model and the next turn moves on", () => {
    expect(classifyFailure(or(504, "Gateway time-out")).kind).toBe("model-unavailable");
  });

  it("does not make a server error that is not a timeout look like one", () => {
    expect(classifyFailure(viaApp(500)).kind).toBe("model-unavailable");
  });
});
