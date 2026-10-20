import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchDocumentState } from "./document-state.js";

function mockFetchOnce(body: unknown, ok = true) {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok,
    status: ok ? 200 : 502,
    json: () => Promise.resolve(body),
  }) as unknown as typeof fetch;
}
afterEach(() => vi.restoreAllMocks());

describe("fetchDocumentState", () => {
  it("returns the document when the reactor has it", async () => {
    mockFetchOnce({
      data: {
        document: {
          document: {
            id: "d1",
            name: "Note",
            documentType: "bai/knowledge-note",
            createdAtUtcIso: "2026-01-01T00:00:00Z",
            lastModifiedAtUtcIso: "2026-01-02T00:00:00Z",
            state: { global: { title: "T" } },
          },
        },
      },
    });
    const doc = await fetchDocumentState("d1");
    expect(doc?.id).toBe("d1");
    expect(doc?.documentType).toBe("bai/knowledge-note");
    expect(doc?.lastModifiedAtUtcIso).toBe("2026-01-02T00:00:00Z");
    expect(doc?.state).toEqual({ global: { title: "T" } });
  });

  it("parses state that arrives as a JSON string", async () => {
    mockFetchOnce({
      data: {
        document: {
          document: {
            id: "d1",
            name: null,
            documentType: null,
            state: '{"global":{"title":"T"}}',
          },
        },
      },
    });
    expect((await fetchDocumentState("d1"))?.state).toEqual({
      global: { title: "T" },
    });
  });

  it("returns null when the reactor has no such document", async () => {
    mockFetchOnce({ errors: [{ message: "not found" }] });
    expect(await fetchDocumentState("d1")).toBeNull();

    mockFetchOnce({ data: { document: null } });
    expect(await fetchDocumentState("d1")).toBeNull();

    mockFetchOnce({ data: { document: { document: { id: "d1" } } } });
    expect(await fetchDocumentState("d1")).toBeNull();
  });

  // Transport failures must be distinguishable from "missing": the caching
  // hook keeps the last good body on a blip but evicts on a real absence.
  it("throws on a non-OK response so callers can keep stale state", async () => {
    mockFetchOnce({}, false);
    await expect(fetchDocumentState("d1")).rejects.toThrow(/502/);
  });

  it("throws on a network failure", async () => {
    globalThis.fetch = vi
      .fn()
      .mockRejectedValue(
        new TypeError("Failed to fetch"),
      ) as unknown as typeof fetch;
    await expect(fetchDocumentState("d1")).rejects.toThrow(/Failed to fetch/);
  });

  it("sends the id as a variable, not interpolated into the query", async () => {
    mockFetchOnce({ data: { document: null } });
    await fetchDocumentState('x") { evil }');
    const [, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as {
      query: string;
      variables: { id: string };
    };
    expect(body.variables.id).toBe('x") { evil }');
    expect(body.query).not.toContain("evil");
  });
});
