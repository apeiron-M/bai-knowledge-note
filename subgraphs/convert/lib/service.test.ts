import { describe, expect, it } from "vitest";
import { createHttpConversionService } from "./service.js";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

/** fetch's input is `RequestInfo | URL`; the client always passes a string. */
const toUrl = (input: RequestInfo | URL): string =>
  typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

interface Call {
  url: string;
  init: RequestInit;
}

/**
 * A fetch double that records each call. Returning `Promise.resolve(...)`
 * rather than writing `async` keeps `require-await` quiet, and `toUrl` keeps
 * the input narrow enough to compare.
 */
function fakeFetch(respond: (call: Call) => Response) {
  const calls: Call[] = [];
  const impl = ((input: RequestInfo | URL, init?: RequestInit) => {
    const call: Call = { url: toUrl(input), init: init ?? {} };
    calls.push(call);
    try {
      return Promise.resolve(respond(call));
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }) as typeof fetch;
  return { calls, impl };
}

/** Captures the rejection so its fields can be asserted without an `any`. */
async function conversionError(
  fetchImpl: typeof fetch,
): Promise<{ status: number; code: string; message: string }> {
  const service = createHttpConversionService({
    baseUrl: "http://127.0.0.1:5099",
    fetchImpl,
  });
  try {
    await service.convert({ filename: "a.pdf", bytes: new Uint8Array([1]) });
  } catch (error) {
    return error as { status: number; code: string; message: string };
  }
  throw new Error("expected the conversion to reject");
}

describe("createHttpConversionService — failure mapping", () => {
  it("maps a non-2xx from the service to CONVERT_UNAVAILABLE with the status", async () => {
    // A backend that answers 500 is *reachable but broken* — reporting it as
    // "unreachable" without the status would leave an operator guessing.
    const { impl } = fakeFetch(() => json({ error: "models missing" }, 500));

    const error = await conversionError(impl);

    expect(error.status).toBe(502);
    expect(error.code).toBe("CONVERT_UNAVAILABLE");
    expect(error.message).toContain("500");
  });

  it("describes a rejection that is not an Error at all", async () => {
    // fetch can reject with anything, and `String(error)` is the only safe read.
    // Built by hand because both `Promise.reject(nonError)` and `throw` of a
    // literal are lint errors — and a non-Error rejection is the point here.
    const nonError: unknown = "socket closed";
    const rejecting = (() =>
      Promise.resolve().then(() => {
        throw nonError;
      })) as typeof fetch;

    const error = await conversionError(rejecting);

    expect(error.status).toBe(502);
    expect(error.code).toBe("CONVERT_UNAVAILABLE");
    expect(error.message).toContain("socket closed");
  });
});

describe("createHttpConversionService", () => {
  it("posts the bytes with the filename and maps a 2xx body", async () => {
    const { calls, impl } = fakeFetch(() =>
      json({
        markdown: "# Hi",
        chunks: [{ text: "Hi", headings: ["Hi"] }],
        format: "md",
      }),
    );
    const service = createHttpConversionService({
      baseUrl: "http://convert.test/",
      fetchImpl: impl,
    });

    const result = await service.convert({
      filename: "Book chapter.pdf",
      bytes: new Uint8Array([1, 2, 3]),
    });

    expect(calls).toHaveLength(1);
    const call = calls[0];
    // `encodeURIComponent`, so a space is %20 — not the `+` a form encoding
    // would produce. The service reads it back with URLSearchParams, which
    // decodes either, but the client sends what it says it sends.
    expect(call.url).toBe("http://convert.test/convert?filename=Book%20chapter.pdf");
    expect(call.init.method).toBe("POST");
    expect((call.init.headers as Record<string, string>)["content-type"]).toBe(
      "application/octet-stream",
    );
    expect(result.markdown).toBe("# Hi");
    expect(result.chunks).toHaveLength(1);
    expect(result.format).toBe("md");
  });

  it("strips trailing slashes from the base url", async () => {
    const { calls, impl } = fakeFetch(() => json({ markdown: "", chunks: [] }));
    const service = createHttpConversionService({
      baseUrl: "http://convert.test///",
      fetchImpl: impl,
    });
    await service.convert({ filename: "a.md", bytes: new Uint8Array([1]) });
    expect(calls[0].url).toBe("http://convert.test/convert?filename=a.md");
  });

  it("sends the api key when configured", async () => {
    const { calls, impl } = fakeFetch(() => json({ markdown: "", chunks: [] }));
    const service = createHttpConversionService({
      baseUrl: "http://convert.test",
      apiKey: "secret",
      fetchImpl: impl,
    });
    await service.convert({ filename: "a.md", bytes: new Uint8Array([1]) });
    expect((calls[0].init.headers as Record<string, string>)["x-api-key"]).toBe("secret");
  });

  it("sends no api key header when none is configured", async () => {
    const { calls, impl } = fakeFetch(() => json({ markdown: "", chunks: [] }));
    const service = createHttpConversionService({
      baseUrl: "http://convert.test",
      fetchImpl: impl,
    });
    await service.convert({ filename: "a.md", bytes: new Uint8Array([1]) });
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBeUndefined();
    // An absent key must not clear the content type.
    expect(headers["content-type"]).toBe("application/octet-stream");
  });

  it("raises CONVERT_UNAVAILABLE when the service rejects", async () => {
    const { impl } = fakeFetch(() => json({ error: "no models" }, 500));
    const service = createHttpConversionService({
      baseUrl: "http://convert.test",
      fetchImpl: impl,
    });
    await expect(
      service.convert({ filename: "a.pdf", bytes: new Uint8Array([1]) }),
    ).rejects.toMatchObject({ code: "CONVERT_UNAVAILABLE", status: 502 });
  });

  it("keeps the service's own detail in the message", async () => {
    // The service answers 415 with a `missing[]` list when models are absent;
    // that has to survive the mapping, or the UI cannot tell the user what to
    // fetch.
    const { impl } = fakeFetch(() =>
      json({ error: "cannot convert pdf without the docling models", missing: ["pdfium"] }, 415),
    );
    const service = createHttpConversionService({
      baseUrl: "http://convert.test",
      fetchImpl: impl,
    });
    await expect(
      service.convert({ filename: "a.pdf", bytes: new Uint8Array([1]) }),
    ).rejects.toThrow(/415[\s\S]*docling models/);
  });

  it("raises CONVERT_UNAVAILABLE when the service is unreachable", async () => {
    const { impl } = fakeFetch(() => {
      throw new Error("ECONNREFUSED");
    });
    const service = createHttpConversionService({
      baseUrl: "http://convert.test",
      fetchImpl: impl,
    });
    await expect(
      service.convert({ filename: "a.pdf", bytes: new Uint8Array([1]) }),
    ).rejects.toMatchObject({ code: "CONVERT_UNAVAILABLE" });
  });

  it("treats a body that is not the agreed shape as unavailable, not as success", async () => {
    // docling-serve answers `{ document: { md_content, … } }`; if someone points
    // CONVERT_SERVICE_URL at it without an adapter, that must surface as an
    // error rather than as a source with no text.
    const { impl } = fakeFetch(() =>
      json({ document: { md_content: "# Hi" }, status: "success" }),
    );
    const service = createHttpConversionService({
      baseUrl: "http://convert.test",
      fetchImpl: impl,
    });
    await expect(
      service.convert({ filename: "a.pdf", bytes: new Uint8Array([1]) }),
    ).rejects.toMatchObject({ code: "CONVERT_UNAVAILABLE", status: 502 });
  });

  it("reports health verbatim", async () => {
    const { calls, impl } = fakeFetch(() =>
      json({
        ok: true,
        backend: "docling.rs",
        ready: false,
        missing: ["pdfium"],
        formats: ["md", "pdf"],
      }),
    );
    const service = createHttpConversionService({
      baseUrl: "http://convert.test",
      fetchImpl: impl,
    });
    const health = await service.health();
    expect(calls[0].url).toBe("http://convert.test/health");
    expect(calls[0].init.method).toBe("GET");
    expect(health.ready).toBe(false);
    expect(health.missing).toEqual(["pdfium"]);
  });
});
