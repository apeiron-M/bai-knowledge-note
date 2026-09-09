import { describe, expect, it, vi } from "vitest";
import {
  createRecorder,
  operationKeyFromBody,
  startRequestMetrics,
  stopRequestMetrics,
  summarize,
  type RequestSample,
} from "./request-metrics.js";

function sample(key: string, at: number, bytes = 0): RequestSample {
  return { key, at, bytes };
}

describe("operationKeyFromBody", () => {
  it("prefers an explicit operationName", () => {
    const body = JSON.stringify({ operationName: "VaultIndex", query: "query Other {a}" });
    expect(operationKeyFromBody("http://x/graphql", "POST", body)).toBe("VaultIndex");
  });

  it("falls back to the name declared in the query", () => {
    const body = JSON.stringify({ query: "query VaultIndexTree($id: String!) { document }" });
    expect(operationKeyFromBody("http://x/graphql", "POST", body)).toBe("VaultIndexTree");
  });

  it("uses the first field of an anonymous operation", () => {
    const body = JSON.stringify({ query: "{ knowledgeGraphNodes(driveId: 1) { id } }" });
    expect(operationKeyFromBody("http://x/graphql", "POST", body)).toBe(
      "knowledgeGraphNodes",
    );
  });

  it("groups a non-GraphQL request by method and path, ignoring the query string", () => {
    expect(operationKeyFromBody("http://x/api/thing?page=2", "get", undefined)).toBe(
      "GET /api/thing",
    );
  });

  it("does not throw on a malformed body", () => {
    expect(operationKeyFromBody("http://x/graphql", "POST", "{not json")).toBe(
      "POST /graphql",
    );
  });
});

describe("summarize", () => {
  it("groups by key and totals count and bytes", () => {
    const report = summarize([
      sample("A", 1_000, 10),
      sample("B", 1_100, 20),
      sample("A", 2_000, 30),
    ]);
    expect(report.totalRequests).toBe(3);
    expect(report.totalBytes).toBe(60);
    expect(report.groups[0]).toMatchObject({ key: "A", count: 2, bytes: 40 });
  });

  it("reports the median gap between repeats", () => {
    const report = summarize([
      sample("A", 0),
      sample("A", 100),
      sample("A", 200),
      sample("A", 300),
    ]);
    expect(report.groups[0].medianGapMs).toBe(100);
  });

  it("leaves the gap null for a single call", () => {
    expect(summarize([sample("A", 5)]).groups[0].medianGapMs).toBeNull();
  });

  it("flags a tight repeated key as a loop suspect", () => {
    const tight = Array.from({ length: 8 }, (_, i) => sample("Loop", i * 200));
    expect(summarize(tight).suspects.map((s) => s.key)).toEqual(["Loop"]);
  });

  it("does not flag a slow poll as a loop", () => {
    const poll = Array.from({ length: 8 }, (_, i) => sample("Poll", i * 30_000));
    expect(summarize(poll).suspects).toEqual([]);
  });

  it("does not flag a short burst, however tight", () => {
    const burst = Array.from({ length: 3 }, (_, i) => sample("Burst", i * 10));
    expect(summarize(burst).suspects).toEqual([]);
  });

  it("measures the window across all samples", () => {
    expect(summarize([sample("A", 1_000), sample("B", 4_000)]).windowMs).toBe(3_000);
  });
});

describe("createRecorder", () => {
  it("bounds the buffer, keeping the most recent samples", () => {
    const recorder = createRecorder(3);
    for (let i = 0; i < 6; i++) recorder.record(sample("A", i));
    expect(recorder.samples.map((s) => s.at)).toEqual([3, 4, 5]);
  });

  it("clears", () => {
    const recorder = createRecorder();
    recorder.record(sample("A", 1));
    recorder.clear();
    expect(recorder.samples).toEqual([]);
  });
});

describe("startRequestMetrics", () => {
  it("records the wrapped call and still returns the real response", async () => {
    const scope = {
      fetch: vi.fn().mockResolvedValue(
        new Response("hello", { headers: { "content-length": "5" } }),
      ) as unknown as typeof fetch,
    };
    const recorder = startRequestMetrics(scope);
    try {
      const response = await scope.fetch("http://x/graphql", {
        method: "POST",
        body: JSON.stringify({ query: "query Ping {a}" }),
      });
      expect(await response.text()).toBe("hello");
      expect(recorder.samples).toHaveLength(1);
      expect(recorder.samples[0]).toMatchObject({ key: "Ping", bytes: 5 });
    } finally {
      stopRequestMetrics();
    }
  });

  it("restores the original fetch on stop", () => {
    const original = vi.fn().mockResolvedValue(new Response("{}")) as unknown as typeof fetch;
    const scope = { fetch: original };
    startRequestMetrics(scope);
    expect(scope.fetch).not.toBe(original);
    stopRequestMetrics();
    expect(scope.fetch).toBe(original);
  });

  it("is idempotent — a second start does not double-wrap", () => {
    const scope = {
      fetch: vi.fn().mockResolvedValue(new Response("{}")) as unknown as typeof fetch,
    };
    const first = startRequestMetrics(scope);
    const wrapped = scope.fetch;
    const second = startRequestMetrics(scope);
    try {
      expect(second).toBe(first);
      expect(scope.fetch).toBe(wrapped);
    } finally {
      stopRequestMetrics();
    }
  });
});
